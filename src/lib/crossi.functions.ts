import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CROSSATRIX_AUTH_URL = "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/crossatrix-auth";
const CROSSATRIX_CROIN_URL =
  "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/croins";

const SITEMAP_PAGE_LIMIT = 80;
export const SUBMISSIONS_BUCKET = "submissions";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const TEXT_EXT = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "log",
  "tsv",
]);

function classifyFile(filename: string, mime?: string): "image" | "text" | "other" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (TEXT_EXT.has(ext)) return "text";
  return "other";
}

function stripHtml(html: string): { title: string; text: string; description: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: titleMatch ? titleMatch[1].trim().slice(0, 300) : "",
    description: descMatch ? descMatch[1].trim().slice(0, 500) : "",
    text: text.slice(0, 20000),
  };
}

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim());
    if (locs.length >= SITEMAP_PAGE_LIMIT) break;
  }
  return locs;
}

const UA = "Mozilla/5.0 (compatible; CrossiSearchBot/1.0; +https://crossisearch.lovable.app)";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

// Ping a URL — returns true if the server responded at all (any status).
// Throws (caught) when DNS/connection/timeout fails => site doesn't exist.
async function pingUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return !!res;
  } catch {
    // HEAD may be rejected — try GET
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      return !!res;
    } catch {
      return false;
    }
  }
}

// Check if a URL can be embedded in an iframe by inspecting response headers.
// Returns 'allowed' | 'blocked' | null (couldn't determine).
async function checkIframeable(url: string): Promise<"allowed" | "blocked" | null> {
  const inspect = (headers: Headers): "allowed" | "blocked" | null => {
    const xfo = headers.get("x-frame-options")?.toLowerCase().trim();
    if (xfo && (xfo === "deny" || xfo === "sameorigin" || xfo.startsWith("allow-from"))) {
      return "blocked";
    }
    const csp = headers.get("content-security-policy")?.toLowerCase() || "";
    const match = csp.match(/frame-ancestors([^;]*)/);
    if (match) {
      const val = match[1].trim();
      if (val === "'none'" || val === "none") return "blocked";
      if (!val.includes("*") && !val.includes("http:") && !val.includes("https:")) {
        return "blocked";
      }
    }
    return "allowed";
  };
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status >= 500) return null;
    return inspect(res.headers);
  } catch {
    return null;
  }
}

async function awardCroins(userId: string, amount: number, description: string) {
  const apiKey = process.env.CROSSATRIX_API_KEY;
  if (!apiKey) return;
  try {
    await fetch(CROSSATRIX_CROIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ action: "credit", user_id: userId, amount, description }),
    });
  } catch (e) {
    console.error("Croin award error", e);
  }
}

// ========== LOGIN ==========
export const crossatrixLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const res = await fetch(CROSSATRIX_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (body as { error?: string }).error || "Login failed" };

    // Auto-grant admin to seeded owner emails
    try {
      const userObj = (body as { user?: { id: string; email: string } }).user;
      if (userObj?.id && userObj?.email) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("admin_emails")
          .select("email")
          .eq("email", userObj.email.toLowerCase())
          .maybeSingle();
        if (row) {
          await supabaseAdmin
            .from("user_roles")
            .upsert(
              { user_id: userObj.id, role: "admin" },
              { onConflict: "user_id,role", ignoreDuplicates: true },
            );
        }
      }
    } catch (e) {
      console.error("admin auto-grant failed", e);
    }

    return body as { user: { id: string; email: string }; access_token: string };
  });

// ========== INTERNAL: shared indexing primitives ==========
async function alreadyIndexed(url: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("pages").select("id").eq("url", url).maybeSingle();
  return !!data;
}

async function indexPage(
  pageUrl: string,
  submittedBy: string,
  sourceSitemap?: string,
  { allowStub = false }: { allowStub?: boolean } = {},
): Promise<boolean> {
  if (await alreadyIndexed(pageUrl)) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let title = pageUrl;
  let description = "";
  let text = "";
  let fetched = false;
  try {
    const html = await fetchText(pageUrl);
    fetched = true;
    if (/<html|<!doctype/i.test(html)) {
      const parsed = stripHtml(html);
      title = parsed.title || pageUrl;
      description = parsed.description;
      text = parsed.text;
    } else {
      text = html.replace(/\s+/g, " ").trim().slice(0, 20000);
    }
  } catch {
    if (!allowStub) return false;
    try {
      const u = new URL(pageUrl);
      title = u.hostname + (u.pathname === "/" ? "" : u.pathname);
      description = `Submitted page on ${u.hostname}`;
      text = title;
    } catch {
      return false;
    }
  }
  void fetched;
  const iframeStatus = await checkIframeable(pageUrl);
  const { error } = await supabaseAdmin.from("pages").insert({
    url: pageUrl,
    title,
    description,
    content: text,
    source_sitemap: sourceSitemap,
    submitted_by: submittedBy,
    kind: "page",
    file_kind: null,
    mime_type: null,
    iframe_status: iframeStatus,
  });
  return !error;
}

async function indexFileFromStorage(
  storagePath: string,
  filename: string,
  mimeType: string | null,
  submittedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const fileUrl = `storage://${SUBMISSIONS_BUCKET}/${storagePath}`;
  if (await alreadyIndexed(fileUrl)) {
    return { ok: false, error: "This file has already been submitted." };
  }
  const kind = classifyFile(filename, mimeType ?? undefined);
  let textContent = filename;
  if (kind === "text") {
    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from(SUBMISSIONS_BUCKET)
      .download(storagePath);
    if (!dlErr && blob) {
      const raw = await blob.text().catch(() => "");
      textContent = /<html|<!doctype/i.test(raw)
        ? stripHtml(raw).text
        : raw.replace(/\s+/g, " ").trim().slice(0, 20000);
      if (!textContent) textContent = filename;
    }
  }
  const { error } = await supabaseAdmin.from("pages").insert({
    url: fileUrl,
    title: filename,
    description: "",
    content: textContent,
    submitted_by: submittedBy,
    kind: "file",
    file_kind: kind,
    mime_type: mimeType,
    storage_path: storagePath,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ========== SUBMIT (user) ==========
export const submitUrl = createServerFn({ method: "POST" })
  .inputValidator(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("page"),
        user_id: z.string().min(1),
        url: z.string().url(),
      }),
      z.object({
        kind: z.literal("file"),
        user_id: z.string().min(1),
        storage_path: z.string().min(1),
        filename: z.string().min(1).max(255),
        mime_type: z.string().max(255).optional(),
      }),
    ]),
  )
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      if (data.kind === "file") {
        const r = await indexFileFromStorage(
          data.storage_path,
          data.filename,
          data.mime_type ?? null,
          data.user_id,
        );
        if (!r.ok) return { error: r.error || "Submission failed" };
        await awardCroins(data.user_id, 50, "Crossi Search file submission");
        await supabaseAdmin.from("submissions").insert({
          user_id: data.user_id,
          url: data.filename,
          kind: "file",
          croins_awarded: 50,
        });
        return { success: true, indexed: 1, croins: 50 };
      }

      if (await alreadyIndexed(data.url)) {
        return { error: "This page has already been submitted." };
      }
      // Ping check — reject if site doesn't exist
      const reachable = await pingUrl(data.url);
      if (!reachable) {
        return { error: "This site doesn't seem to exist or isn't reachable." };
      }

      let indexed = 0;
      if (await indexPage(data.url, data.user_id, undefined, { allowStub: true })) indexed++;
      try {
        const origin = new URL(data.url).origin;
        const sitemapUrl = origin + "/sitemap.xml";
        const xml = await fetchText(sitemapUrl);
        const locs = extractLocs(xml);
        for (const loc of locs) {
          if (loc === data.url) continue;
          if (await indexPage(loc, data.user_id, sitemapUrl)) indexed++;
        }
      } catch {
        /* no sitemap — ok */
      }

      if (indexed === 0) return { error: "Could not index the submitted page." };

      await awardCroins(data.user_id, 100, `Crossi Search page submission (${indexed} pages)`);
      await supabaseAdmin.from("submissions").insert({
        user_id: data.user_id,
        url: data.url,
        kind: "page",
        croins_awarded: 100,
      });
      return { success: true, indexed, croins: 100 };
    } catch (e) {
      console.error("submitUrl failed", e);
      return { error: e instanceof Error ? e.message : "Submission failed" };
    }
  });

// ========== SEARCH ==========
export type SearchResultOut = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  kind: string;
  mime_type: string | null;
  file_kind: string | null;
  iframe_status: string | null;
};

export function normalizeQueryForSearch(query: string): string {
  return query
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchPagesCore(
  query: string,
  kind: "page" | "file" | null,
  limit: number,
): Promise<SearchResultOut[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const q = normalizeQueryForSearch(query);
  if (!q) return [];

  const { data: rpcRows, error } = await supabaseAdmin.rpc("search_pages_fuzzy", {
    q,
    kind_filter: kind ?? undefined,
    max_results: Math.min(60, Math.max(limit, 30)),
  });

  type Row = {
    id: string;
    url: string;
    title: string | null;
    description: string | null;
    content: string | null;
    kind: string;
    mime_type: string | null;
    file_kind: string | null;
    storage_path: string | null;
    created_at: string;
    score: number;
  };

  let results: Row[] = (rpcRows as Row[] | null) ?? [];
  if (error) {
    console.error("search_pages_fuzzy failed", error);
    results = [];
  }

  const fullQ = q;
  const ranked = results
    .map((r) => {
      let bonus = 0;
      const title = (r.title || "").toLowerCase();
      const url = (r.url || "").toLowerCase();
      let host = "";
      try {
        host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        /* ignore */
      }
      const hostBase = host.includes(".") ? host.split(".").slice(0, -1).join(".") : host;
      if (host === fullQ || hostBase === fullQ) bonus += 2;
      else if (host.includes(fullQ)) bonus += 0.5;
      if (title === fullQ) bonus += 1;
      else if (title.startsWith(fullQ)) bonus += 0.4;
      if (url.includes(fullQ)) bonus += 0.2;
      return { r, s: (r.score || 0) + bonus };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);

  const out = await Promise.all(
    ranked.map(async (r) => {
      const snippet =
        r.description ||
        (r.content ? r.content.slice(0, 240) + (r.content.length > 240 ? "…" : "") : "");
      let displayUrl = r.url;
      const storagePath = r.storage_path;
      if (r.kind === "file" && (storagePath || r.url.startsWith("storage://"))) {
        const path = storagePath || r.url.replace(`storage://${SUBMISSIONS_BUCKET}/`, "");
        const { data: signed } = await supabaseAdmin.storage
          .from(SUBMISSIONS_BUCKET)
          .createSignedUrl(path, 3600);
        displayUrl = signed?.signedUrl || r.url;
      }
      return {
        id: r.id,
        url: displayUrl,
        title: r.title || r.url,
        snippet,
        kind: r.kind,
        mime_type: r.mime_type ?? null,
        file_kind: r.file_kind ?? null,
      };
    }),
  );
  return out;
}

export async function apiSearch(
  query: string,
  kind: "page" | "file" | null,
  limit: number,
): Promise<SearchResultOut[]> {
  return searchPagesCore(query, kind, limit);
}

export const searchPages = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      query: z.string().min(1).max(500),
      kind: z.enum(["page", "file"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const results = await searchPagesCore(data.query, data.kind ?? null, 30);
    return { results };
  });

// ========== AI OVERVIEW ==========
export const aiOverview = createServerFn({ method: "POST" })
  .inputValidator(z.object({ query: z.string().min(1), sources: z.array(z.string()).max(20) }))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key || data.sources.length === 0) return { overview: "" };
    const systemPrompt =
      "You are Crossi 5.1 Lite, the AI overview engine inside Crossi Search. Given a user query and a short list of indexed result snippets, write a concise 2-4 sentence overview answering the query. Only use the provided sources. If they don't answer the query, say so briefly. No markdown headings, no lists, plain prose.";
    const userPrompt = `Query: ${data.query}\n\nSources:\n${data.sources
      .map((s, i) => `[${i + 1}] ${s}`)
      .join("\n")}`;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return { overview: "" };
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return { overview: j.choices?.[0]?.message?.content?.trim() ?? "" };
    } catch {
      return { overview: "" };
    }
  });

// ========== ADMIN: role check ==========
export const isAdmin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", data.user_id)
      .eq("role", "admin")
      .maybeSingle();
    return { admin: !!row };
  });

async function requireAdmin(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

// ========== ADMIN: delete page ==========
export const deletePage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), page_id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!(await requireAdmin(data.user_id))) return { error: "Forbidden" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("pages")
      .select("storage_path, kind, url")
      .eq("id", data.page_id)
      .maybeSingle();
    if (row?.kind === "file") {
      const path =
        (row as { storage_path?: string }).storage_path ||
        (row.url?.startsWith("storage://")
          ? row.url.replace(`storage://${SUBMISSIONS_BUCKET}/`, "")
          : null);
      if (path) await supabaseAdmin.storage.from(SUBMISSIONS_BUCKET).remove([path]);
    }
    const { error } = await supabaseAdmin.from("pages").delete().eq("id", data.page_id);
    if (error) return { error: error.message };
    return { success: true };
  });

// ========== ADMIN: API keys ==========
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ========== API KEYS (any signed-in user) ==========
export const PLAN_LIMITS: Record<string, { limit: number; croins: number; label: string }> = {
  free: { limit: 50, croins: 0, label: "Free" },
  advanced: { limit: 100, croins: 1000, label: "Advanced" },
  pro: { limit: 200, croins: 3000, label: "Pro" },
  business: { limit: 500, croins: 8000, label: "Business" },
  enterprise: { limit: -1, croins: 25000, label: "Enterprise" },
};

export const listApiKeys = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      scope: z.enum(["read", "write"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("api_keys")
      .select(
        "id,label,created_by,created_at,last_used_at,revoked_at,plan,daily_limit,requests_today,usage_day,plan_expires_at,scope",
      )
      .eq("created_by", data.user_id);
    if (data.scope) q = q.eq("scope", data.scope);
    const { data: rows } = await q.order("created_at", { ascending: false });
    return { keys: rows || [] };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      label: z.string().min(1).max(100),
      scope: z.enum(["read", "write"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scope = data.scope ?? "read";
    if (scope === "write" && !(await requireAdmin(data.user_id))) {
      return { error: "Admin only" };
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const plain =
      (scope === "write" ? "csk_adm_" : "csk_") +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const hash = await sha256Hex(plain);
    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        key_hash: hash,
        label: data.label,
        created_by: data.user_id,
        scope,
        daily_limit: scope === "write" ? -1 : 50,
        plan: scope === "write" ? "admin" : "free",
      })
      .select("id,label,created_at")
      .single();
    if (error || !row) return { error: error?.message || "Failed to create key" };
    return { key: plain, id: row.id, label: row.label, created_at: row.created_at };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("created_by", data.user_id);
    if (error) return { error: error.message };
    return { success: true };
  });

export const upgradeApiKeyPlan = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      id: z.string().uuid(),
      plan: z.enum(["free", "advanced", "pro", "business", "enterprise"]),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = PLAN_LIMITS[data.plan];
    if (!cfg) return { error: "Unknown plan" };

    const { data: key } = await supabaseAdmin
      .from("api_keys")
      .select("id,created_by,revoked_at")
      .eq("id", data.id)
      .eq("created_by", data.user_id)
      .maybeSingle();
    if (!key || key.revoked_at) return { error: "Key not found" };

    if (cfg.croins > 0) {
      const apiKey = process.env.CROSSATRIX_API_KEY;
      if (!apiKey) return { error: "Billing unavailable" };
      try {
        const res = await fetch(CROSSATRIX_CROIN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({
            action: "debit",
            user_id: data.user_id,
            amount: cfg.croins,
            description: `Crossi Search API — ${cfg.label} plan (30 days)`,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return {
            error:
              (body as { error?: string }).error ||
              `Not enough Croins. ${cfg.croins} required.`,
          };
        }
      } catch {
        return { error: "Billing request failed" };
      }
    }

    const expires =
      data.plan === "free"
        ? null
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("api_keys")
      .update({
        plan: data.plan,
        daily_limit: cfg.limit,
        plan_expires_at: expires,
      })
      .eq("id", data.id);
    if (error) return { error: error.message };
    return { success: true, plan: data.plan, daily_limit: cfg.limit, expires_at: expires };
  });

// ========== PUBLIC API: shared helpers ==========
export async function validateApiKey(
  plain: string,
): Promise<
  | {
      id: string;
      created_by: string;
      remaining: number;
      limit: number;
      plan: string;
      scope: "read" | "write";
    }
  | null
> {
  if (!plain || !plain.startsWith("csk_")) return null;
  const hash = await sha256Hex(plain);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_api_key", { _hash: hash });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    id: string;
    created_by: string;
    plan: string;
    daily_limit: number;
    remaining: number;
    scope: "read" | "write";
  };
  return {
    id: row.id,
    created_by: row.created_by,
    remaining: row.remaining,
    limit: row.daily_limit,
    plan: row.plan,
    scope: row.scope,
  };
}

export async function apiSubmitPage(url: string, submittedBy: string) {
  if (await alreadyIndexed(url)) return { error: "Already submitted" };
  const reachable = await pingUrl(url);
  if (!reachable) return { error: "Site not reachable" };
  let indexed = 0;
  if (await indexPage(url, submittedBy, undefined, { allowStub: true })) indexed++;
  try {
    const origin = new URL(url).origin;
    const sitemapUrl = origin + "/sitemap.xml";
    const xml = await fetchText(sitemapUrl);
    for (const loc of extractLocs(xml)) {
      if (loc === url) continue;
      if (await indexPage(loc, submittedBy, sitemapUrl)) indexed++;
    }
  } catch {
    /* */
  }
  if (indexed === 0) return { error: "Could not index" };
  return { success: true, indexed };
}

export async function apiSubmitFile(
  filename: string,
  mimeType: string | null,
  bytes: Uint8Array,
  submittedBy: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `api/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(SUBMISSIONS_BUCKET)
    .upload(path, bytes, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { error: upErr.message };
  const r = await indexFileFromStorage(path, filename, mimeType, submittedBy);
  if (!r.ok) return { error: r.error || "Failed to index file" };
  return { success: true, indexed: 1 };
}
