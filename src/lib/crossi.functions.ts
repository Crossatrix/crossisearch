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
      kind: z.enum(["page", "file"]),
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    async function indexPage(pageUrl: string, sourceSitemap?: string) {
      try {
        const html = await fetchText(pageUrl);
        let title = pageUrl;
        let description = "";
        let text = html.slice(0, 20000);
        if (/<html|<!doctype/i.test(html)) {
          const parsed = stripHtml(html);
          title = parsed.title || pageUrl;
          description = parsed.description;
          text = parsed.text;
        } else {
          text = html.replace(/\s+/g, " ").trim().slice(0, 20000);
        }
        const { error } = await supabaseAdmin.from("pages").upsert(
          {
            url: pageUrl,
            title,
            description,
            content: text,
            source_sitemap: sourceSitemap,
            submitted_by: data.user_id,
            kind: "page",
          },
          { onConflict: "url", ignoreDuplicates: false },
        );
        if (!error) indexedUrls.push(pageUrl);
      } catch (e) {
        console.warn("Skip", pageUrl, e);
      }
    }

    if (data.kind === "file") {
      const body = await fetchText(data.url);
      const text = body.replace(/\s+/g, " ").trim().slice(0, 20000);
      const { error } = await supabaseAdmin.from("pages").upsert(
        {
          url: data.url,
          title: data.url,
          description: "",
          content: text,
          submitted_by: data.user_id,
          kind: "file",
        },
        { onConflict: "url", ignoreDuplicates: false },
      );
      if (error) return { error: error.message };
      indexedUrls.push(data.url);
      rewardAmount = 50;
      reason = "Crossi Search file submission";
    } else {
      await indexPage(data.url);
      const origin = new URL(data.url).origin;
      const sitemapUrl = origin + "/sitemap.xml";
      try {
        const xml = await fetchText(sitemapUrl);
        const locs = extractLocs(xml);
        for (const loc of locs) {
          if (loc === data.url) continue;
          await indexPage(loc, sitemapUrl);
        }
      } catch (e) {
        console.warn("No sitemap at", sitemapUrl, e);
      }
      if (indexedUrls.length === 0) return { error: "Could not index the submitted page." };
      rewardAmount = 100;
      reason = `Crossi Search page submission (${indexedUrls.length} pages)`;
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
    // Escape PostgREST `or` filter: strip commas, parens, and percent signs
    const safe = q.replace(/[,()%*]/g, " ").trim();
    const term = `%${safe}%`;

    const { data: rows } = await supabaseAdmin
      .from("pages")
      .select("id,url,title,description,content,kind")
      .or(
        `title.ilike.${term},description.ilike.${term},content.ilike.${term}`,
      )
      .limit(20);
    const results = rows || [];

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
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { overview: "" };
    if (data.sources.length === 0) return { overview: "" };

    const systemPrompt =
      "You are Crossi 5.1 Lite, the AI overview engine inside Crossi Search. Given a user query and a short list of indexed result snippets, write a concise 2-4 sentence overview answering the query. Only use the provided sources. If they don't answer the query, say so briefly. No markdown headings, no lists, plain prose.";
    const userPrompt = `Query: ${data.query}\n\nSources:\n${data.sources
      .map((s, i) => `[${i + 1}] ${s}`)
      .join("\n")}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("AI overview gateway error", res.status, t);
        return { overview: "" };
      }
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const out = j.choices?.[0]?.message?.content?.trim() ?? "";
      return { overview: out };
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

// ========== DELETE ENTRY (ADMIN ONLY) ==========
export const deletePage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      page_id: z.string().uuid(),
      user_email: z.string().email(),
    }),
  )
  .handler(async ({ data }) => {
    // Only allow admin email to delete
    if (data.user_email !== "Cross.a.trix.owner@hotmail.com") {
      return { error: "Unauthorized: Admin access required" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Get page info before deletion for logging
    const { data: page } = await supabaseAdmin
      .from("pages")
      .select("url, title")
      .eq("id", data.page_id)
      .single();

    const { error } = await supabaseAdmin
      .from("pages")
      .delete()
      .eq("id", data.page_id);

    if (error) {
      return { error: error.message };
    }

    // Log the admin action
    await supabaseAdmin.from("admin_logs").insert({
      admin_email: data.user_email,
      action: "delete",
      target_table: "pages",
      target_id: data.page_id,
      details: { url: page?.url, title: page?.title },
    });

    return { success: true };
  });
