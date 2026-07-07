import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import {
  isAdmin,
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from "@/lib/crossi.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Crossi Search" },
      { name: "description", content: "Crossi Search admin tools." },
    ],
  }),
  component: AdminPage,
});

type KeyRow = {
  id: string;
  label: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function AdminPage() {
  const session = useSession();
  const navigate = useNavigate();
  const checkAdmin = useServerFn(isAdmin);
  const listKeys = useServerFn(listApiKeys);
  const createKey = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);

  const [admin, setAdmin] = useState<boolean | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setAdmin(false);
      return;
    }
    checkAdmin({ data: { user_id: session.user.id } }).then((r) =>
      setAdmin(r.admin),
    );
  }, [session, checkAdmin]);

  useEffect(() => {
    if (!admin || !session) return;
    listKeys({ data: { user_id: session.user.id, scope: "write" } }).then((r) => {
      if ("keys" in r) setKeys(r.keys as KeyRow[]);
    });
  }, [admin, session, listKeys]);

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-6">
          <h1 className="text-2xl font-bold mb-3">Sign in required</h1>
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

  if (admin === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Checking access…</p>
        </main>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-6">
          <h1 className="text-2xl font-bold mb-2">Not authorized</h1>
          <p className="text-muted-foreground">This page is admin-only.</p>
        </main>
      </div>
    );
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await createKey({
        data: { user_id: session!.user.id, label: label.trim() },
      });
      if ("error" in r && r.error) {
        setErr(r.error);
      } else if ("key" in r) {
        setNewKey(r.key ?? null);
        setLabel("");
        const refreshed = await listKeys({ data: { user_id: session!.user.id } });
        if ("keys" in refreshed) setKeys(refreshed.keys as KeyRow[]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this API key? It will stop working immediately.")) return;
    const r = await revoke({ data: { user_id: session!.user.id, id } });
    if ("error" in r && r.error) {
      setErr(r.error);
      return;
    }
    const refreshed = await listKeys({ data: { user_id: session!.user.id } });
    if ("keys" in refreshed) setKeys(refreshed.keys as KeyRow[]);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            API keys for programmatic submissions to Crossi Search.
          </p>
        </div>

        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Create API key</h2>
          <form onSubmit={onCreate} className="flex flex-col sm:flex-row gap-3">
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. crawler-1)"
              className="flex-1 bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </form>
          {err && <p className="text-destructive text-sm">{err}</p>}
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

        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Existing keys</h2>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <li key={k.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{k.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(k.created_at).toLocaleString()}
                      {k.last_used_at
                        ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
                        : " · never used"}
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
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card border border-border rounded-xl p-6 text-sm space-y-3">
          <h2 className="text-lg font-semibold">Using the API</h2>
          <p className="text-muted-foreground">
            POST to <code className="bg-secondary px-1.5 py-0.5 rounded">/api/public/submit</code>{" "}
            with header <code className="bg-secondary px-1.5 py-0.5 rounded">x-api-key</code>.
          </p>
          <pre className="bg-background border border-border rounded p-3 text-xs overflow-x-auto">{`# Submit a page
curl -X POST https://crossisearch.lovable.app/api/public/submit \\
  -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"page","url":"https://example.com"}'

# Submit a file
curl -X POST https://crossisearch.lovable.app/api/public/submit \\
  -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"file","filename":"notes.txt","mime_type":"text/plain","content_base64":"SGVsbG8="}'`}</pre>
        </section>
      </main>
    </div>
  );
}
