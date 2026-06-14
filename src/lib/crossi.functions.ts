import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CROSSATRIX_AUTH_URL =
  "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/crossatrix-auth";
const CROSSATRIX_CROIN_URL =
  "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/crossatrix-auth";

const SITEMAP_PAGE_LIMIT = 80;
export const SUBMISSIONS_BUCKET = "submissions";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const TEXT_EXT = new Set(["txt", "md", "csv", "json", "html", "htm", "xml", "yaml", "yml", "log", "tsv"]);

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
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  );
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

const UA =
  "Mozilla/5.0 (compatible; CrossiSearchBot/1.0; +https://crossisearch.lovable.app)";

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
  });

// ========== SEARCH ==========
export const searchPages = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      query: z.string().min(1).max(500),
      kind: z.enum(["page", "file"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim();
    const safe = q.replace(/[,()%*]/g, " ").trim();
    const term = `%${safe}%`;

    let query = supabaseAdmin
      .from("pages")
      .select("id,url,title,description,content,kind,mime_type,file_kind,storage_path")
      .or(`title.ilike.${term},description.ilike.${term},content.ilike.${term}`)
      .limit(30);
    if (data.kind) query = query.eq("kind", data.kind);

    const { data: rows } = await query;
    const results = rows || [];

    const out = await Promise.all(
      results.map(async (r) => {
        const snippet =
          r.description ||
          (r.content
            ? r.content.slice(0, 240) + (r.content.length > 240 ? "…" : "")
            : "");
        let displayUrl = r.url;
        const storagePath = (r as { storage_path?: string }).storage_path;
        if (r.kind === "file" && (storagePath || r.url.startsWith("storage://"))) {
          const path = storagePath || r.url.replace(`storage://${SUBMISSIONS_BUCKET}/`, "");
          const { data: signed } = await supabaseAdmin.storage
            .from(SUBMISSIONS_BUCKET)
            .createSignedUrl(path, 3600);
          displayUrl = signed?.signedUrl || r.url;
        }
        return {
          id: r.id as string,
          url: displayUrl,
          title: (r.title as string) || (r.url as string),
          snippet,
          kind: r.kind as string,
          mime_type: (r as { mime_type?: string | null }).mime_type ?? null,
          file_kind: (r as { file_kind?: string | null }).file_kind ?? null,
        };
      }),
    );

    return { results: out };
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

export const listApiKeys = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await requireAdmin(data.user_id))) return { error: "Forbidden" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("api_keys")
      .select("id,label,created_by,created_at,last_used_at,revoked_at")
      .order("created_at", { ascending: false });
    return { keys: rows || [] };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), label: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    if (!(await requireAdmin(data.user_id))) return { error: "Forbidden" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const plain =
      "csk_" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    const hash = await sha256Hex(plain);
    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .insert({ key_hash: hash, label: data.label, created_by: data.user_id })
      .select("id,label,created_at")
      .single();
    if (error || !row) return { error: error?.message || "Failed to create key" };
    return { key: plain, id: row.id, label: row.label, created_at: row.created_at };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!(await requireAdmin(data.user_id))) return { error: "Forbidden" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) return { error: error.message };
    return { success: true };
  });

// ========== PUBLIC API: shared helpers ==========
export async function validateApiKey(plain: string): Promise<{ id: string; created_by: string } | null> {
  if (!plain || !plain.startsWith("csk_")) return null;
  const hash = await sha256Hex(plain);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("api_keys")
    .select("id,created_by,revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  await supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { id: data.id, created_by: data.created_by };
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
