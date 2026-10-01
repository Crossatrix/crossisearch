import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useBrowserState, CNET_HOME, titleFor } from "@/lib/cnet-browser";
import { z } from "zod";
import { unzipSync, strFromU8 } from "fflate";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import {
  cnetAddTld,
  cnetBuyDomain,
  cnetDeleteFile,
  cnetIsAdmin,
  cnetListFiles,
  cnetListTlds,
  cnetMyDomains,
  cnetResolve,
  cnetSaveFile,
  cnetRemoveTld,
  cnetDeleteDomain,
  cnetSaveMany,
} from "@/lib/cnet.functions";

export const Route = createFileRoute("/browser")({
  validateSearch: z.object({ url: z.string().catch("cnet://home.cat") }),
  head: () => ({
    meta: [
      { title: "Crossinet Browser — Crossi Search" },
      { name: "description", content: "Browse Crossinet sites at cnet:// addresses." },
      { property: "og:title", content: "Crossinet Browser" },
      { property: "og:description", content: "Browse Crossinet sites at cnet:// addresses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrowserPage,
});

function parse(url: string) {
  const u = url.trim().replace(/^cnet:\/\//i, "");
  const i = u.indexOf("/");
  const host = (i < 0 ? u : u.slice(0, i)).toLowerCase();
  const path = i < 0 ? "/" : u.slice(i);
  return { host, path };
}

const NAV_SCRIPT = `<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href');if(!h||h.startsWith('#')||/^https?:/i.test(h))return;e.preventDefault();parent.postMessage({cnetNav:h},'*');});</script>`;

function BrowserPage() {
  const { url } = Route.useSearch();
  const navigate = useNavigate();
  const [input, setInput] = useState(url);
  const [showFav, setShowFav] = useState(false);
  const { host, path } = parse(url);
  const { state, ready, update } = useBrowserState();
  const restored = useRef(false);
  const go = (u: string) => navigate({ to: "/browser", search: { url: u.startsWith("cnet://") ? u : "cnet://" + u } });

  // Restore last active tab on first load when opened at the default page.
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const saved = state.tabs[state.active]?.url;
    if (url === CNET_HOME && saved && saved !== url) go(saved);
  }, [ready, state]);

  // Keep the active tab in sync with the current address.
  useEffect(() => {
    if (!ready || !restored.current) return;
    const cur = state.tabs[state.active];
    if (cur?.url === url) return;
    update((s) => {
      const tabs = s.tabs.length ? [...s.tabs] : [{ url, title: titleFor(url) }];
      const a = Math.min(s.active, tabs.length - 1);
      tabs[a] = { url, title: titleFor(url) };
      return { ...s, tabs, active: a };
    });
  }, [url, ready]);

  const switchTab = (i: number) => {
    update((s) => ({ ...s, active: i }));
    go(state.tabs[i].url);
  };
  const newTab = () => {
    update((s) => ({ ...s, tabs: [...s.tabs, { url: CNET_HOME, title: titleFor(CNET_HOME) }], active: s.tabs.length }));
    go(CNET_HOME);
  };
  const closeTab = (i: number) => {
    const tabs = state.tabs.filter((_, j) => j !== i);
    if (!tabs.length) tabs.push({ url: CNET_HOME, title: titleFor(CNET_HOME) });
    let active = state.active;
    if (i < active || active >= tabs.length) active = Math.max(0, active - 1);
    if (i === state.active) active = Math.min(i, tabs.length - 1);
    update((s) => ({ ...s, tabs, active }));
    go(tabs[active].url);
  };
  const isFav = state.favorites.some((f) => f.url === url);
  const toggleFav = () =>
    update((s) => ({
      ...s,
      favorites: isFav ? s.favorites.filter((f) => f.url !== url) : [...s.favorites, { url, title: titleFor(url) }],
    }));

  useEffect(() => setInput(url), [url]);
  useEffect(() => {
    const h = (e: MessageEvent) => {
      const t = (e.data as { cnetNav?: string })?.cnetNav;
      if (typeof t !== "string") return;
      if (t.startsWith("cnet://")) return go(t);
      const base = path.replace(/[^/]*$/, "");
      go(`cnet://${host}${t.startsWith("/") ? t : base + t}`);
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  });

  let body;
  if (host === "admin.domain.cat") body = <AdminPage />;
  else if (host === "domain.cat" && path.startsWith("/options")) body = <OptionsPage />;
  else if (host === "domain.cat") body = <BuyPage go={go} />;
  else body = <SiteView host={host} path={path} />;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="px-2 pt-2 flex gap-1 overflow-x-auto border-b border-border">
        {state.tabs.map((t, i) => (
          <div
            key={i}
            className={"flex items-center gap-2 max-w-[200px] px-3 py-1.5 rounded-t-md border border-b-0 text-sm cursor-pointer " + (i === state.active ? "border-primary bg-card text-primary" : "border-border text-muted-foreground")}
            onClick={() => switchTab(i)}
          >
            <span className="truncate">{t.title}</span>
            <button
              aria-label="Close tab"
              onClick={(e) => { e.stopPropagation(); closeTab(i); }}
              className="hover:text-destructive"
            >✕</button>
          </div>
        ))}
        <button aria-label="New tab" onClick={newTab} className="px-3 text-lg hover:text-primary">+</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) go(input.trim());
        }}
        className="px-4 py-2 border-b border-border flex gap-2 relative"
      >
        <button type="button" onClick={() => history.back()} className="px-3 rounded-md border border-border">←</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 min-w-0 bg-card border border-border rounded-full px-4 py-1.5 outline-none focus:border-primary" />
        <button type="button" aria-label="Favorite" onClick={toggleFav} className={"px-2 text-xl " + (isFav ? "text-primary" : "text-muted-foreground")}>{isFav ? "★" : "☆"}</button>
        <button type="button" onClick={() => setShowFav((v) => !v)} className="px-3 rounded-md border border-border text-sm">Favorites</button>
        <button className="px-4 rounded-full bg-primary text-primary-foreground font-semibold">Go</button>
        {showFav && (
          <div className="absolute right-4 top-full mt-1 z-20 w-72 bg-card border border-border rounded-md shadow-lg p-2">
            {state.favorites.length === 0 && <p className="text-sm text-muted-foreground p-2">No favorites yet. Click ☆ to add one.</p>}
            {state.favorites.map((f) => (
              <div key={f.url} className="flex items-center gap-2 text-sm">
                <button type="button" className="flex-1 truncate text-left px-2 py-1 rounded hover:text-primary" onClick={() => { setShowFav(false); go(f.url); }}>{f.title}</button>
                <button type="button" aria-label="Remove favorite" className="text-destructive px-1" onClick={() => update((s) => ({ ...s, favorites: s.favorites.filter((x) => x.url !== f.url) }))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </form>
      <div className="flex-1 flex flex-col">{body}</div>
    </div>
  );
}

function SiteView({ host, path }: { host: string; path: string }) {
  const resolve = useServerFn(cnetResolve);
  const [html, setHtml] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setHtml(undefined);
    resolve({ data: { host, path } }).then((r) => setHtml(r.found ? r.html : null));
  }, [host, path, resolve]);
  if (html === undefined) return <p className="p-8 text-muted-foreground">Loading…</p>;
  if (html === null)
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold mb-2">Site not found</h1>
        <p className="text-muted-foreground">cnet://{host}{path} doesn't exist. Buy domains at cnet://domain.cat</p>
      </div>
    );
  return <iframe title={host} srcDoc={NAV_SCRIPT + html} sandbox="allow-scripts allow-forms allow-modals" className="flex-1 w-full min-h-[80vh] bg-white" />;
}

function LoginNeeded() {
  return <p className="p-8">Please <a href="/auth" className="text-primary underline">log in</a> with your Crossatrix account.</p>;
}

function AdminPage() {
  const session = useSession();
  const check = useServerFn(cnetIsAdmin);
  const list = useServerFn(cnetListTlds);
  const add = useServerFn(cnetAddTld);
  const rm = useServerFn(cnetRemoveTld);
  const [admin, setAdmin] = useState(false);
  const [tlds, setTlds] = useState<{ tld: string; price_croins: number }[]>([]);
  const [tld, setTld] = useState("");
  const [price, setPrice] = useState(100);
  const [msg, setMsg] = useState("");
  const load = () => list().then((r) => setTlds(r.tlds));
  useEffect(() => {
    if (session) check({ data: { email: session.user.email } }).then((r) => setAdmin(r.admin));
    load();
  }, [session]);
  if (!session) return <LoginNeeded />;
  if (!admin) return <p className="p-8">Access denied.</p>;
  return (
    <div className="max-w-xl mx-auto p-6 w-full">
      <h1 className="text-2xl font-bold mb-4">Crossinet TLD Admin</h1>
      <form
        className="flex gap-2 mb-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await add({ data: { user_id: session.user.id, email: session.user.email, tld: tld.toLowerCase().replace(/^\./, ""), price } });
          setMsg("error" in r && r.error ? r.error : "Saved");
          load();
        }}
      >
        <input value={tld} onChange={(e) => setTld(e.target.value)} placeholder="tld (e.g. web)" className="flex-1 bg-card border border-border rounded-md px-3 py-2" />
        <input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} className="w-28 bg-card border border-border rounded-md px-3 py-2" />
        <button className="px-4 rounded-md bg-primary text-primary-foreground font-semibold">Add</button>
      </form>
      {msg && <p className="text-sm mb-4">{msg}</p>}
      <ul className="space-y-1">{tlds.map((t) => <li key={t.tld} className="flex justify-between border-b border-border py-1"><span>.{t.tld}</span><span>{t.price_croins} Croins <button className="ml-3 text-destructive" onClick={async () => { if (!confirm(`Remove .${t.tld}? All its domains and sites will be deleted.`)) return; const r = await rm({ data: { user_id: session.user.id, email: session.user.email, tld: t.tld } }); setMsg("error" in r && r.error ? r.error : "Removed"); load(); }}>✕</button></span></li>)}</ul>
    </div>
  );
}

function BuyPage({ go }: { go: (u: string) => void }) {
  const session = useSession();
  const list = useServerFn(cnetListTlds);
  const buy = useServerFn(cnetBuyDomain);
  const [tlds, setTlds] = useState<{ tld: string; price_croins: number }[]>([]);
  const [name, setName] = useState("");
  const [tld, setTld] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    list().then((r) => { setTlds(r.tlds); setTld(r.tlds[0]?.tld ?? ""); });
  }, [list]);
  if (!session) return <LoginNeeded />;
  const price = tlds.find((t) => t.tld === tld)?.price_croins;
  return (
    <div className="max-w-xl mx-auto p-6 w-full">
      <h1 className="text-2xl font-bold mb-1">domain.cat</h1>
      <p className="text-muted-foreground mb-4">Buy a Crossinet domain with Croins. Each domain can only be owned once.</p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await buy({ data: { user_id: session.user.id, email: session.user.email, name: name.toLowerCase(), tld } });
          setBusy(false);
          setMsg("error" in r && r.error ? r.error : `You now own ${r.domain}!`);
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="yourname" className="flex-1 bg-card border border-border rounded-md px-3 py-2" />
        <select value={tld} onChange={(e) => setTld(e.target.value)} className="bg-card border border-border rounded-md px-2">
          {tlds.map((t) => <option key={t.tld} value={t.tld}>.{t.tld}</option>)}
        </select>
        <button disabled={busy || !name} className="px-4 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-60">Buy{price != null ? ` (${price})` : ""}</button>
      </form>
      {msg && <p className="text-sm mt-3">{msg}</p>}
      <button onClick={() => go("cnet://domain.cat/options")} className="mt-6 text-primary underline">Manage my domains →</button>
    </div>
  );
}

type F = { id: string; path: string; content: string; host: string };

function OptionsPage() {
  const session = useSession();
  const mine = useServerFn(cnetMyDomains);
  const files = useServerFn(cnetListFiles);
  const save = useServerFn(cnetSaveFile);
  const del = useServerFn(cnetDeleteFile);
  const delDomain = useServerFn(cnetDeleteDomain);
  const saveMany = useServerFn(cnetSaveMany);
  const [domains, setDomains] = useState<{ id: string; domain: string }[]>([]);
  const [sel, setSel] = useState<{ id: string; domain: string } | null>(null);
  const [list, setList] = useState<F[]>([]);
  const [host, setHost] = useState("");
  const [path, setPath] = useState("/index.html");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (session) mine({ data: { user_id: session.user.id } }).then((r) => setDomains(r.domains));
  }, [session, mine]);
  const loadFiles = (d: { id: string; domain: string }) =>
    session && files({ data: { user_id: session.user.id, domain_id: d.id } }).then((r) => setList(r.files));
  if (!session) return <LoginNeeded />;
  return (
    <div className="max-w-5xl mx-auto p-6 w-full">
      <h1 className="text-2xl font-bold mb-4">My Crossinet domains</h1>
      {domains.length === 0 && <p className="text-muted-foreground">You don't own any domains yet.</p>}
      <div className="flex flex-wrap gap-2 mb-6">
        {domains.map((d) => (
          <button key={d.id} onClick={() => { setSel(d); setHost(d.domain); setPath("/index.html"); setContent(""); loadFiles(d); }}
            className={"px-3 py-1.5 rounded-md border " + (sel?.id === d.id ? "border-primary text-primary" : "border-border")}>{d.domain}</button>
        ))}
      </div>
      {sel && (
        <div className="flex flex-wrap gap-3 items-center mb-4 text-sm">
          <label className="px-3 py-1.5 rounded-md border border-border cursor-pointer hover:border-primary">
            Upload ZIP to page {path.replace(/\/[^/]*\.[a-z0-9]+$/i, "") || "/"}
            <input type="file" accept=".zip" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
                let list = Object.entries(entries).filter(([n, b]) => !n.endsWith("/") && !n.startsWith("__MACOSX") && /\.(html?|css|js|json|txt|svg|xml|md)$/i.test(n) && b.length < 500_000).map(([n, b]) => ({ path: n, content: strFromU8(b) }));
                const top = list[0]?.path.split("/")[0];
                if (top && list.every((f) => f.path.startsWith(top + "/"))) list = list.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));
                if (!list.length) return setMsg("No HTML/CSS/JS files in ZIP");
                const base = path.replace(/\/[^/]*\.[a-z0-9]+$/i, "");
                const r = await saveMany({ data: { user_id: session.user.id, domain_id: sel.id, host: host.toLowerCase(), base, files: list.slice(0, 300) } });
                setMsg("error" in r && r.error ? r.error : `Uploaded ${r.count} files`);
                loadFiles(sel);
              } catch { setMsg("Could not read ZIP"); }
            }} />
          </label>
          <span className="text-muted-foreground">Set the page path below (e.g. /blog) first — the ZIP's index.html becomes that page.</span>
          <button className="ml-auto text-destructive underline" onClick={async () => {
            if (!confirm(`Delete ${sel.domain}? All files are removed and you get 75% of the price back.`)) return;
            const r = await delDomain({ data: { user_id: session.user.id, domain_id: sel.id } });
            if ("error" in r && r.error) return setMsg(r.error);
            setMsg(`Deleted. Refunded ${r.refund} Croins.`);
            setDomains((ds) => ds.filter((d) => d.id !== sel.id));
            setSel(null);
          }}>Delete domain (75% refund)</button>
        </div>
      )}
      {sel && (
        <div className="grid md:grid-cols-[220px_1fr] gap-4">
          <ul className="space-y-1 text-sm">
            {list.map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <button className="truncate text-left hover:text-primary" onClick={() => { setHost(f.host); setPath(f.path); setContent(f.content); }}>{f.host === sel.domain ? "" : f.host.replace("." + sel.domain, "") + ":"}{f.path}</button>
                <button className="text-destructive" onClick={async () => { await del({ data: { user_id: session.user.id, domain_id: sel.id, id: f.id } }); loadFiles(sel); }}>✕</button>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={host} onChange={(e) => setHost(e.target.value)} className="flex-1 bg-card border border-border rounded-md px-3 py-2 text-sm" placeholder="sub.yourdomain.cat" />
              <input value={path} onChange={(e) => setPath(e.target.value)} className="flex-1 bg-card border border-border rounded-md px-3 py-2 text-sm" placeholder="/index.html, /style.css, /app.js" />
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={18} className="w-full bg-card border border-border rounded-md p-3 font-mono text-xs" placeholder="HTML, CSS or JS" />
            <div className="flex gap-3 items-center">
              <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold"
                onClick={async () => {
                  const r = await save({ data: { user_id: session.user.id, domain_id: sel.id, host: host.toLowerCase(), path, content } });
                  setMsg("error" in r && r.error ? r.error : "Saved");
                  loadFiles(sel);
                }}>Save file</button>
              <a href={`/browser?url=${encodeURIComponent(`cnet://${host}${path}`)}`} className="text-primary underline text-sm">Open</a>
              {msg && <span className="text-sm">{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
