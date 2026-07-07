import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  upgradeApiKeyPlan,
  PLAN_LIMITS,
} from "@/lib/crossi.functions";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "API Docs — Crossi Search" },
      {
        name: "description",
        content:
          "Crossi Search read API — endpoints, authentication, rate limits, and plan upgrades with Croins.",
      },
    ],
  }),
  component: DocsPage,
});

type KeyRow = {
  id: string;
  label: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  plan: string;
  daily_limit: number;
  requests_today: number;
  usage_day: string;
  plan_expires_at: string | null;
};

const PLAN_ORDER = ["free", "advanced", "pro", "business", "enterprise"] as const;

function DocsPage() {
  const session = useSession();
  const navigate = useNavigate();
  const listKeys = useServerFn(listApiKeys);
  const createKey = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);
  const upgrade = useServerFn(upgradeApiKeyPlan);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!session) return;
    const r = await listKeys({ data: { user_id: session.user.id, scope: "read" } });
    if ("keys" in r) setKeys(r.keys as KeyRow[]);
  }

  useEffect(() => {
    if (session) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-6">
          <h1 className="text-2xl font-bold mb-3">Sign in to view the API docs</h1>
          <p className="text-muted-foreground text-sm mb-5 text-center max-w-md">
            The Crossi Search read API is available to any signed-in Crossatrix
            member. Sign in to view docs and create API keys.
          </p>
          <button
            onClick={() => navigate({ to: "/auth" })}
            className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground font-semibold"
          >
            Sign in
          </button>
        </main>
      </div>
    );
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await createKey({
        data: { user_id: session!.user.id, label: label.trim() },
      });
      if ("error" in r && r.error) setErr(r.error);
      else if ("key" in r) {
        setNewKey(r.key ?? null);
        setLabel("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this API key? It will stop working immediately.")) return;
    const r = await revoke({ data: { user_id: session!.user.id, id } });
    if ("error" in r && r.error) setErr(r.error);
    else await refresh();
  }

  async function onUpgrade(id: string, plan: string) {
    const cfg = PLAN_LIMITS[plan];
    if (!cfg) return;
    const confirmMsg =
      cfg.croins > 0
        ? `Upgrade to ${cfg.label}? This costs ${cfg.croins} Croins and lasts 30 days.`
        : `Downgrade to Free plan?`;
    if (!confirm(confirmMsg)) return;
    setErr(null);
    setMsg(null);
    const r = await upgrade({
      data: {
        user_id: session!.user.id,
        id,
        plan: plan as "free" | "advanced" | "pro" | "business" | "enterprise",
      },
    });
    if ("error" in r && r.error) setErr(r.error);
    else {
      setMsg(`Key upgraded to ${cfg.label}.`);
      await refresh();
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 space-y-10">
        <div>
          <h1 className="text-3xl font-bold">Crossi Search API</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only API for searching community-indexed pages and files.
            Available to any signed-in Crossatrix member.
          </p>
        </div>

        {/* Docs */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4 text-sm">
          <h2 className="text-lg font-semibold">Search endpoint</h2>
          <p className="text-muted-foreground">
            Authenticate with header{" "}
            <code className="bg-secondary px-1.5 py-0.5 rounded">x-api-key</code>{" "}
            or{" "}
            <code className="bg-secondary px-1.5 py-0.5 rounded">
              Authorization: Bearer &lt;key&gt;
            </code>
            .
          </p>

          <div>
            <div className="font-medium mb-1">GET</div>
            <pre className="bg-background border border-border rounded p-3 text-xs overflow-x-auto">{`curl "https://crossisearch.lovable.app/api/public/search?q=android&limit=10" \\
  -H "x-api-key: YOUR_KEY"`}</pre>
          </div>

          <div>
            <div className="font-medium mb-1">POST</div>
            <pre className="bg-background border border-border rounded p-3 text-xs overflow-x-auto">{`curl -X POST https://crossisearch.lovable.app/api/public/search \\
  -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"android","kind":"page","limit":10}'`}</pre>
          </div>

          <div>
            <div className="font-medium mb-1">Parameters</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>
                <code className="bg-secondary px-1 rounded">q</code> /{" "}
                <code className="bg-secondary px-1 rounded">query</code> — required, 1–500 chars.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">kind</code> — optional,{" "}
                <code>page</code> or <code>file</code>.
              </li>
              <li>
                <code className="bg-secondary px-1 rounded">limit</code> — optional,
                default 20, max 50.
              </li>
            </ul>
          </div>

          <div>
            <div className="font-medium mb-1">Response</div>
            <pre className="bg-background border border-border rounded p-3 text-xs overflow-x-auto">{`{
  "query": "android",
  "kind": "page",
  "count": 2,
  "results": [
    {
      "id": "…",
      "url": "https://…",
      "title": "…",
      "snippet": "…",
      "kind": "page",
      "mime_type": null,
      "file_kind": null
    }
  ]
}`}</pre>
            <p className="text-muted-foreground mt-2">
              Every response includes rate-limit headers:{" "}
              <code className="bg-secondary px-1 rounded">X-RateLimit-Plan</code>,{" "}
              <code className="bg-secondary px-1 rounded">X-RateLimit-Limit</code>,{" "}
              <code className="bg-secondary px-1 rounded">X-RateLimit-Remaining</code>.
              When exceeded, the API returns <code>429</code>.
            </p>
          </div>
        </section>

        {/* Plans */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Requests / day</th>
                  <th className="py-2">Cost (per 30 days)</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_ORDER.map((p) => {
                  const cfg = PLAN_LIMITS[p];
                  return (
                    <tr key={p} className="border-t border-border">
                      <td className="py-2 pr-4 font-medium">{cfg.label}</td>
                      <td className="py-2 pr-4">
                        {cfg.limit < 0 ? "Unlimited" : cfg.limit}
                      </td>
                      <td className="py-2">
                        {cfg.croins === 0 ? "Free" : `${cfg.croins} Croins`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Paid plans are billed in Croins and last 30 days. When the plan
            expires the key automatically drops back to Free (50 requests/day).
          </p>
        </section>

        {/* Create key */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Create API key</h2>
          <form onSubmit={onCreate} className="flex flex-col sm:flex-row gap-3">
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. my-app)"
              className="flex-1 bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create key"}
            </button>
          </form>
          {err && <p className="text-destructive text-sm">{err}</p>}
          {msg && <p className="text-primary text-sm">{msg}</p>}
          {newKey && (
            <div className="bg-secondary/50 border border-primary/40 rounded-md p-4 space-y-2">
              <p className="text-sm font-semibold text-primary">
                Copy this key now — it won't be shown again.
              </p>
              <code className="block break-all text-xs bg-background border border-border rounded p-3">
                {newKey}
              </code>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(newKey)}
                  className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
                >
                  Copy
                </button>
                <button
                  onClick={() => setNewKey(null)}
                  className="px-3 py-1.5 text-sm rounded-md hover:bg-secondary"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Your keys */}
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Your keys</h2>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => {
                const cfg = PLAN_LIMITS[k.plan] || PLAN_LIMITS.free;
                return (
                  <li key={k.id} className="py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{k.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {cfg.label} · {k.daily_limit < 0 ? "∞" : k.daily_limit}{" "}
                          RPD · used today{" "}
                          {k.usage_day === new Date().toISOString().slice(0, 10)
                            ? k.requests_today
                            : 0}
                          {k.plan_expires_at
                            ? ` · renews ${new Date(k.plan_expires_at).toLocaleDateString()}`
                            : ""}
                          {k.revoked_at ? " · revoked" : ""}
                        </div>
                      </div>
                      {!k.revoked_at && (
                        <button
                          onClick={() => onRevoke(k.id)}
                          className="text-sm px-3 py-1.5 rounded-md border border-destructive/50 text-destructive hover:bg-destructive/10"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                    {!k.revoked_at && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {PLAN_ORDER.filter((p) => p !== k.plan).map((p) => {
                          const c = PLAN_LIMITS[p];
                          return (
                            <button
                              key={p}
                              onClick={() => onUpgrade(k.id, p)}
                              className="text-xs px-2.5 py-1 rounded-md border border-border hover:border-primary hover:bg-secondary transition"
                            >
                              {c.croins === 0
                                ? `Downgrade to ${c.label}`
                                : `→ ${c.label} (${c.croins} Croins)`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
