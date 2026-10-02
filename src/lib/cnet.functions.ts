import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CROIN_URL = "https://digjxtmzafzcgytgcwmb.supabase.co/functions/v1/croins";
const CNET_ADMINS = ["cross.a.trix.owner@hotmail.com", "moritz.loeseke7@gmail.com"];
const label = z.string().regex(/^[a-z0-9-]{1,40}$/);
const user = { user_id: z.string().min(1), email: z.string().min(1) };

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
const RESERVED: Record<string, string> = {
  "domain.cat": "",
  "admin.domain.cat": "",
  "home.cat": "cross.a.trix.owner@hotmail.com",
};
async function croin(action: "debit" | "credit", user_id: string, amount: number, description: string) {
  const key = process.env.CROSSATRIX_API_KEY;
  if (!key) return false;
  const res = await fetch(CROIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ action, user_id, amount, description }),
  }).catch(() => null);
  return !!res?.ok;
}
const isCnetAdmin = (email: string) => CNET_ADMINS.includes(email.toLowerCase());
const isCaller = async (userId: string, email?: string) =>
  (await import("./session.server")).isCaller(userId, email);
const DENY = { error: "Unauthorized - please sign in again" };
const normPath = (p: string) => {
  let s = ("/" + (p || "").replace(/^\/+/, "")).replace(/\/+$/, "");
  if (!s || s === "/") s = "/index.html";
  if (!/\.[a-z0-9]+$/i.test(s)) s += "/index.html";
  return s.replace(/\/\/+/g, "/");
};

export const cnetIsAdmin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string() }))
  .handler(async ({ data }) => ({ admin: isCnetAdmin(data.email) }));

export const cnetListTlds = createServerFn({ method: "POST" }).handler(async () => {
  const s = await db();
  const { data } = await s.from("cnet_tlds").select("tld,price_croins").order("tld");
  return { tlds: data ?? [] };
});

export const cnetAddTld = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ...user, tld: label, price: z.number().int().min(0).max(1_000_000) }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id, data.email))) return DENY;
    if (!isCnetAdmin(data.email)) return { error: "Not allowed" };
    const s = await db();
    const { error } = await s
      .from("cnet_tlds")
      .upsert({ tld: data.tld, price_croins: data.price, created_by: data.user_id });
    return error ? { error: error.message } : { success: true };
  });

export const cnetBuyDomain = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ...user, name: label, tld: label }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id, data.email))) return DENY;
    const s = await db();
    const domain = `${data.name}.${data.tld}`;
    const { data: t } = await s.from("cnet_tlds").select("price_croins").eq("tld", data.tld).maybeSingle();
    if (!t) return { error: "Unknown TLD" };
    const { data: taken } = await s.from("cnet_domains").select("id").eq("domain", domain).maybeSingle();
    if (taken) return { error: "Domain already taken" };
    const reserved = RESERVED[domain];
    if (reserved !== undefined && reserved !== data.email.toLowerCase()) return { error: "This domain is reserved" };
    if (t.price_croins > 0 && reserved === undefined) {
      const key = process.env.CROSSATRIX_API_KEY;
      if (!key) return { error: "Billing unavailable" };
      const res = await fetch(CROIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          action: "debit",
          user_id: data.user_id,
          amount: t.price_croins,
          description: `Crossinet domain ${domain}`,
        }),
      }).catch(() => null);
      if (!res || !res.ok) return { error: `Not enough Croins. ${t.price_croins} required.` };
    }
    const { data: row, error } = await s
      .from("cnet_domains")
      .insert({ domain, tld: data.tld, owner_id: data.user_id, owner_email: data.email })
      .select("id")
      .single();
    if (error) return { error: error.code === "23505" ? "Domain already taken" : error.message };
    await s.from("cnet_files").insert({
      domain_id: row.id,
      host: domain,
      path: "/index.html",
      title: domain,
      content: `<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h1>${domain}</h1><p>Welcome to my Crossinet site.</p></body></html>`,
    });
    return { success: true, domain };
  });

export const cnetMyDomains = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return { domains: [] };
    const s = await db();
    const { data: rows } = await s.from("cnet_domains").select("id,domain,console_disabled").eq("owner_id", data.user_id).order("domain");
    return { domains: rows ?? [] };
  });

async function ownedDomain(userId: string, domainId: string) {
  const s = await db();
  const { data } = await s.from("cnet_domains").select("id,domain").eq("id", domainId).eq("owner_id", userId).maybeSingle();
  return data;
}

export const cnetListFiles = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), domain_id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return { files: [] };
    if (!(await ownedDomain(data.user_id, data.domain_id))) return { files: [] };
    const s = await db();
    const { data: rows } = await s.from("cnet_files").select("id,path,content,host").eq("domain_id", data.domain_id).order("path");
    return { files: rows ?? [] };
  });

export const cnetSaveFile = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      domain_id: z.string().uuid(),
      host: z.string().regex(/^([a-z0-9-]{1,40}\.)*[a-z0-9-]{1,40}\.[a-z0-9-]{1,40}$/),
      path: z.string().min(1).max(200),
      content: z.string().max(500_000),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    const d = await ownedDomain(data.user_id, data.domain_id);
    if (!d) return { error: "Not your domain" };
    if (data.host !== d.domain && !data.host.endsWith("." + d.domain)) return { error: "Host must be your domain or a subdomain" };
    const path = normPath(data.path);
    const title = data.content.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || data.host + path;
    const s = await db();
    const { error } = await s.from("cnet_files").upsert(
      { domain_id: d.id, host: data.host, path, content: data.content, title, updated_at: new Date().toISOString() },
      { onConflict: "host,path" },
    );
    return error ? { error: error.message } : { success: true };
  });

export const cnetDeleteFile = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), domain_id: z.string().uuid(), id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    if (!(await ownedDomain(data.user_id, data.domain_id))) return { error: "Not your domain" };
    const s = await db();
    await s.from("cnet_files").delete().eq("id", data.id).eq("domain_id", data.domain_id);
    return { success: true };
  });

export const cnetSetConsole = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), domain_id: z.string().uuid(), disabled: z.boolean() }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    if (!(await ownedDomain(data.user_id, data.domain_id))) return { error: "Not your domain" };
    const s = await db();
    const { error } = await s.from("cnet_domains").update({ console_disabled: data.disabled }).eq("id", data.domain_id).eq("owner_id", data.user_id);
    return error ? { error: error.message } : { success: true };
  });

// Publishers can also opt a single page out with <meta name="cnet-console" content="off">.
const META_OFF = [
  /<meta[^>]*name=["']cnet-console["'][^>]*content=["'](?:off|disabled|false|no)["'][^>]*>/i,
  /<meta[^>]*content=["'](?:off|disabled|false|no)["'][^>]*name=["']cnet-console["'][^>]*>/i,
];

export const cnetResolve = createServerFn({ method: "POST" })
  .inputValidator(z.object({ host: z.string().max(200), path: z.string().max(300) }))
  .handler(async ({ data }) => {
    const s = await db();
    const host = data.host.toLowerCase();
    const path = normPath(data.path);
    const { data: f } = await s.from("cnet_files").select("content,domain_id").eq("host", host).eq("path", path).maybeSingle();
    if (!f) return { found: false as const };
    const { data: dom } = await s.from("cnet_domains").select("console_disabled").eq("id", f.domain_id).maybeSingle();
    let html = f.content;
    const inlined: string[] = [];
    const missing: string[] = [];
    if (path.endsWith(".html") || path.endsWith(".htm")) {
      // Inline same-site CSS/JS so pages work inside the sandbox.
      const dir = path.replace(/[^/]*$/, "");
      const refs = new Set<string>();
      for (const m of html.matchAll(/(?:href|src)=["']([^"':]+\.(?:css|js))["']/gi)) refs.add(m[1]);
      if (refs.size) {
        const paths = [...refs].map((r) => (r.startsWith("/") ? r : normPath(dir + r)));
        const { data: assets } = await s.from("cnet_files").select("path,content").eq("host", host).in("path", paths);
        const map = new Map((assets ?? []).map((a) => [a.path, a.content]));
        html = html
          .replace(/<link[^>]*href=["']([^"':]+\.css)["'][^>]*>/gi, (m, r) => {
            const key = r.startsWith("/") ? r : normPath(dir + r);
            const c = map.get(key);
            (c != null ? inlined : missing).push(key);
            return c != null ? `<style>${c}</style>` : m;
          })
          .replace(/<script([^>]*)src=["']([^"':]+\.js)["']([^>]*)><\/script>/gi, (m, a, r, b) => {
            const key = r.startsWith("/") ? r : normPath(dir + r);
            const c = map.get(key);
            (c != null ? inlined : missing).push(key);
            return c != null ? `<script${a}${b}>${c.replace(/<\/script/gi, "<\\/script")}</script>` : m;
          });
      }
    }
    const metaOff = META_OFF.some((re) => re.test(f.content));
    const consoleAllowed = !(dom?.console_disabled ?? false) && !metaOff;
    const disabledBy = dom?.console_disabled ? "domain" : metaOff ? "page" : null;
    return { found: true as const, html, path, consoleAllowed, disabledBy, inlined, missing };
  });

export const cnetSearch = createServerFn({ method: "POST" })
  .inputValidator(z.object({ query: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const s = await db();
    const q = data.query.replace(/[%_,()]/g, " ").trim();
    if (!q) return { results: [] };
    const { data: rows } = await s
      .from("cnet_files")
      .select("id,host,path,title,content")
      .like("path", "%.htm%")
      .or(`title.ilike.%${q}%,host.ilike.%${q}%,content.ilike.%${q}%`)
      .limit(30);
    return {
      results: (rows ?? []).map((r) => ({
        id: r.id,
        url: `cnet://${r.host}${r.path === "/index.html" ? "" : r.path}`,
        title: r.title || r.host,
        snippet: r.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
      })),
    };
  });

export const cnetRemoveTld = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ...user, tld: label }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id, data.email))) return DENY;
    if (!isCnetAdmin(data.email)) return { error: "Not allowed" };
    const s = await db();
    const { data: ds } = await s.from("cnet_domains").select("id").eq("tld", data.tld);
    const ids = (ds ?? []).map((d) => d.id);
    if (ids.length) {
      await s.from("cnet_files").delete().in("domain_id", ids);
      await s.from("cnet_domains").delete().in("id", ids);
    }
    const { error } = await s.from("cnet_tlds").delete().eq("tld", data.tld);
    return error ? { error: error.message } : { success: true };
  });

export const cnetDeleteDomain = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1), domain_id: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    const d = await ownedDomain(data.user_id, data.domain_id);
    if (!d) return { error: "Not your domain" };
    const s = await db();
    const tld = d.domain.split(".").pop()!;
    const { data: t } = await s.from("cnet_tlds").select("price_croins").eq("tld", tld).maybeSingle();
    await s.from("cnet_files").delete().eq("domain_id", d.id);
    const { error } = await s.from("cnet_domains").delete().eq("id", d.id);
    if (error) return { error: error.message };
    const refund = RESERVED[d.domain] !== undefined ? 0 : Math.floor((t?.price_croins ?? 0) * 0.75);
    if (refund > 0) await croin("credit", data.user_id, refund, `Refund for Crossinet domain ${d.domain}`);
    return { success: true, refund };
  });

export const cnetSaveMany = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      domain_id: z.string().uuid(),
      host: z.string().regex(/^([a-z0-9-]{1,40}\.)*[a-z0-9-]{1,40}\.[a-z0-9-]{1,40}$/),
      base: z.string().max(200),
      files: z.array(z.object({ path: z.string().min(1).max(200), content: z.string().max(500_000) })).min(1).max(300),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    const d = await ownedDomain(data.user_id, data.domain_id);
    if (!d) return { error: "Not your domain" };
    if (data.host !== d.domain && !data.host.endsWith("." + d.domain)) return { error: "Host must be your domain or a subdomain" };
    const base = ("/" + data.base.replace(/^\/+|\/+$/g, "")).replace(/^\/$/, "");
    const now = new Date().toISOString();
    const rows = data.files.map((f) => {
      const path = normPath(base + "/" + f.path);
      const title = f.content.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || data.host + path;
      return { domain_id: d.id, host: data.host, path, content: f.content, title, updated_at: now };
    });
    const s = await db();
    const { error } = await s.from("cnet_files").upsert(rows, { onConflict: "host,path" });
    return error ? { error: error.message } : { success: true, count: rows.length };
  });

// ---- Browser tabs + favorites (per account) ----
const entry = z.object({ url: z.string().max(300), title: z.string().max(200) });

export const cnetGetState = createServerFn({ method: "POST" })
  .inputValidator(z.object({ user_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return { tabs: [], favorites: [], active: 0 };
    const s = await db();
    const { data: row } = await s
      .from("cnet_browser_state")
      .select("tabs,favorites,active_index")
      .eq("user_id", data.user_id)
      .maybeSingle();
    return {
      tabs: (row?.tabs as { url: string; title: string }[] | null) ?? [],
      favorites: (row?.favorites as { url: string; title: string }[] | null) ?? [],
      active: row?.active_index ?? 0,
    };
  });

export const cnetSaveState = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      user_id: z.string().min(1),
      tabs: z.array(entry).max(30),
      favorites: z.array(entry).max(100),
      active: z.number().int().min(0).max(30),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await isCaller(data.user_id))) return DENY;
    const s = await db();
    await s.from("cnet_browser_state").upsert({
      user_id: data.user_id,
      tabs: data.tabs,
      favorites: data.favorites,
      active_index: data.active,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  });
