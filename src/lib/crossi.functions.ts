import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CROSSATRIX_AUTH_URL =
  "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/crossatrix-auth";
const CROSSATRIX_CROIN_URL =
  "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/crossatrix-auth"; // croin endpoint shares base; same fn handles action
// Per docs, croin endpoint uses x-api-key + action body. Real path may differ; using same supabase fn host.
const CROSSI_AI_URL =
  "https://hqibtbdovjcocqgwqwbw.supabase.co/functions/v1/public-api";

const DAILY_CAP = 20;
const SITEMAP_PAGE_LIMIT = 80;

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

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "CrossiSearchBot/1.0 (+https://crossi.search)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function awardCroins(userId: string, amount: number, description: string) {
  const apiKey = process.env.CROSSATRIX_API_KEY;
  if (!apiKey) {
    console.warn("CROSSATRIX_API_KEY missing — skipping croin award");
    return;
  }
  try {
    const res = await fetch(CROSSATRIX_CROIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        action: "credit",
        user_id: userId,
        amount,
        description,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Croin award failed", res.status, body);
    }
  } catch (e) {
    console.error("Croin award error", e);
  }
}

// ========== LOGIN ==========
export const crossatrixLogin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const res = await fetch(CROSSATRIX_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: (body as { error?: string }).error || "Login failed" };
    }
    return body as { user: { id: string; email: string }; access_token: string };
  });

// ========== SUBMIT ==========
export const submitUrl = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      url: z.string().url(),
      kind: z.enum(["sitemap", "page", "file"]),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Daily cap
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.user_id)
      .gte("created_at", since);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) >= DAILY_CAP) {
      return {
        error: `Daily submission cap reached (${DAILY_CAP}). Try again tomorrow.`,
      };
    }

    const indexedUrls: string[] = [];
    let rewardAmount = 0;
    let reason = "";

    if (data.kind === "sitemap") {
      const xml = await fetchText(data.url);
      const locs = extractLocs(xml);
      if (locs.length === 0) return { error: "No <loc> entries found in sitemap." };

      for (const loc of locs) {
        try {
          const html = await fetchText(loc);
          const { title, description, text } = stripHtml(html);
          const { error } = await supabaseAdmin.from("pages").upsert(
            {
              url: loc,
              title: title || loc,
              description,
              content: text,
              source_sitemap: data.url,
              submitted_by: data.user_id,
              kind: "page",
            },
            { onConflict: "url", ignoreDuplicates: false },
          );
          if (!error) indexedUrls.push(loc);
        } catch (e) {
          console.warn("Skip", loc, e);
        }
      }
      if (indexedUrls.length === 0) return { error: "Could not index any pages from sitemap." };
      rewardAmount = 100;
      reason = `Crossi Search sitemap (${indexedUrls.length} pages)`;
    } else {
      // page or file
      const body = await fetchText(data.url);
      let title = data.url;
      let description = "";
      let text = body.slice(0, 20000);
      if (/<html|<!doctype/i.test(body)) {
        const parsed = stripHtml(body);
        title = parsed.title || data.url;
        description = parsed.description;
        text = parsed.text;
      } else {
        // plain text/file
        text = body.replace(/\s+/g, " ").trim().slice(0, 20000);
      }
      const { error } = await supabaseAdmin.from("pages").upsert(
        {
          url: data.url,
          title,
          description,
          content: text,
          submitted_by: data.user_id,
          kind: data.kind === "file" ? "file" : "page",
        },
        { onConflict: "url", ignoreDuplicates: false },
      );
      if (error) return { error: error.message };
      indexedUrls.push(data.url);
      rewardAmount = data.kind === "file" ? 50 : 100;
      reason =
        data.kind === "file"
          ? "Crossi Search file submission"
          : "Crossi Search page submission";
    }

    await awardCroins(data.user_id, rewardAmount, reason);

    await supabaseAdmin.from("submissions").insert({
      user_id: data.user_id,
      url: data.url,
      kind: data.kind,
      croins_awarded: rewardAmount,
    });

    return {
      success: true,
      indexed: indexedUrls.length,
      croins: rewardAmount,
    };
  });

// ========== SEARCH ==========
export const searchPages = createServerFn({ method: "POST" })
  .inputValidator(z.object({ query: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim();

    // Build a tsquery: split words, AND-join with :*
    const ts = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, "") + ":*")
      .filter((w) => w.length > 2)
      .join(" & ");

    let results: Array<{
      id: string;
      url: string;
      title: string | null;
      description: string | null;
      content: string | null;
      kind: string;
    }> = [];

    if (ts) {
      const { data: rows, error } = await supabaseAdmin
        .from("pages")
        .select("id,url,title,description,content,kind")
        .textSearch("fts", ts, { config: "english" })
        .limit(20);
      // Use raw rpc-like fallback if textSearch column missing — try ilike
      if (error || !rows) {
        const { data: fb } = await supabaseAdmin
          .from("pages")
          .select("id,url,title,description,content,kind")
          .or(
            `title.ilike.%${q}%,description.ilike.%${q}%,content.ilike.%${q}%`,
          )
          .limit(20);
        results = fb || [];
      } else {
        results = rows;
      }
    } else {
      const { data: fb } = await supabaseAdmin
        .from("pages")
        .select("id,url,title,description,content,kind")
        .or(`title.ilike.%${q}%,description.ilike.%${q}%,content.ilike.%${q}%`)
        .limit(20);
      results = fb || [];
    }

    return {
      results: results.map((r) => {
        const snippet =
          r.description ||
          (r.content
            ? r.content.slice(0, 240) + (r.content.length > 240 ? "…" : "")
            : "");
        return {
          id: r.id,
          url: r.url,
          title: r.title || r.url,
          snippet,
          kind: r.kind,
        };
      }),
    };
  });

// ========== AI OVERVIEW ==========
export const aiOverview = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      query: z.string().min(1),
      sources: z.array(z.string()).max(20),
    }),
  )
  .handler(async ({ data }) => {
    const key = process.env.CROSSI_AI_KEY;
    if (!key) return { overview: "" };
    if (data.sources.length === 0) return { overview: "" };

    const prompt = `Summarize these Search results for the query "${data.query}": ${data.sources.join(", ")}`;
    const url =
      CROSSI_AI_URL +
      "?key=" +
      encodeURIComponent(key) +
      "&model=" +
      encodeURIComponent("Crossi 5.1 Lite") +
      "&prompt=" +
      encodeURIComponent(prompt);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const txt = await res.text();
      if (!res.ok) return { overview: "" };
      try {
        const j = JSON.parse(txt);
        const out =
          (j.response as string) ||
          (j.result as string) ||
          (j.output as string) ||
          (j.text as string) ||
          (j.summary as string) ||
          txt;
        return { overview: String(out) };
      } catch {
        return { overview: txt };
      }
    } catch (e) {
      console.error("AI overview failed", e);
      return { overview: "" };
    }
  });

// ========== DAILY CAP CHECK ==========
export const getDailyCap = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string() }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.user_id)
      .gte("created_at", since);
    return { used: count ?? 0, cap: DAILY_CAP };
  });
