import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import { listApiKeys, PLAN_LIMITS } from "@/lib/crossi.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "API Dashboard — Crossi Search" },
      {
        name: "description",
        content:
          "Your Crossi Search API keys — plan, daily limit, and remaining requests at a glance.",
      },
    ],
  }),
  component: DashboardPage,
});

type KeyRow = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  plan: string;
  daily_limit: number;
  requests_today: number;
  usage_day: string;
  plan_expires_at: string | null;
};

function DashboardPage() {
  const session = useSession();
  const navigate = useNavigate();
  const listKeys = useServerFn(listApiKeys);
  const [keys, setKeys] = useState<KeyRow[] | null>(null);

  useEffect(() => {
    if (!session) return;
    listKeys({ data: { user_id: session.user.id, scope: "read" } }).then((r) => {
      if ("keys" in r) setKeys(r.keys as KeyRow[]);
    });
  }, [session, listKeys]);

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

  const today = new Date().toISOString().slice(0, 10);
  const active = (keys ?? []).filter((k) => !k.revoked_at);
  const totalUsed = active.reduce(
    (n, k) => n + (k.usage_day === today ? k.requests_today : 0),
    0,
  );
  const totalLimit = active.reduce(
    (n, k) => (k.daily_limit < 0 ? n : n + k.daily_limit),
    0,
  );
  const anyInfinite = active.some((k) => k.daily_limit < 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">API Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Overview of your Crossi Search read API keys and today's usage.
            </p>
          </div>
          <Link
            to="/docs"
            className="text-sm px-4 py-2 rounded-md border border-border hover:bg-secondary transition"
          >
            Manage keys & plans →
          </Link>
        </div>

        {/* Summary */}
        <section className="grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Active keys" value={String(active.length)} />
          <SummaryCard
            label="Requests today"
            value={anyInfinite ? `${totalUsed}` : `${totalUsed} / ${totalLimit}`}
          />
          <SummaryCard
            label="Remaining today"
            value={
              anyInfinite
                ? "∞"
                : String(Math.max(0, totalLimit - totalUsed))
            }
          />
        </section>

        {/* Keys */}
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Your keys</h2>
          {keys === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              You don't have any API keys yet.{" "}
              <Link to="/docs" className="text-primary hover:underline">
                Create one in the docs
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => {
                const cfg = PLAN_LIMITS[k.plan] || PLAN_LIMITS.free;
                const used = k.usage_day === today ? k.requests_today : 0;
                const limit = k.daily_limit;
                const remaining =
                  limit < 0 ? -1 : Math.max(0, limit - used);
                const pct =
                  limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
                return (
                  <li key={k.id} className="py-4 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {k.label}
                          {k.revoked_at && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                              revoked
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {cfg.label} plan ·{" "}
                          {limit < 0 ? "Unlimited" : `${limit} req/day`}
                          {k.plan_expires_at
                            ? ` · renews ${new Date(k.plan_expires_at).toLocaleDateString()}`
                            : ""}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {limit < 0 ? `${used} today` : `${used} / ${limit}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {remaining < 0 ? "∞ remaining" : `${remaining} remaining`}
                        </div>
                      </div>
                    </div>
                    {limit > 0 && !k.revoked_at && (
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            pct >= 100
                              ? "bg-destructive"
                              : pct >= 80
                                ? "bg-yellow-500"
                                : "bg-primary"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
