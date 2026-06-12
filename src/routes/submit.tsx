import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import { submitUrl, getDailyCap } from "@/lib/crossi.functions";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit a page — Crossi Search" },
      {
        name: "description",
        content:
          "Submit a sitemap, page, or file to the Crossi Search index. Earn Croins for every accepted submission.",
      },
    ],
  }),
  component: SubmitPage,
});

function SubmitPage() {
  const session = useSession();
  const navigate = useNavigate();
  const submit = useServerFn(submitUrl);
  const cap = useServerFn(getDailyCap);

  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<"page" | "file">("page");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [capN, setCapN] = useState<number>(20);

  useEffect(() => {
    if (!session) return;
    cap({ data: { user_id: session.user.id } }).then((r) => {
      setUsed(r.used);
      setCapN(r.cap);
    });
  }, [session, cap]);

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center px-6">
          <h1 className="text-2xl font-bold mb-3">Sign in to submit</h1>
          <p className="text-muted-foreground mb-6 text-center max-w-sm">
            Submissions require a Crossatrix account so we can reward your Croins.
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

  const reward = kind === "file" ? 50 : 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await submit({
        data: { user_id: session!.user.id, url, kind },
      });
      if ("error" in res && res.error) {
        setErr(res.error);
      } else if ("success" in res) {
        setMsg(
          `Indexed ${res.indexed} ${res.indexed === 1 ? "item" : "items"}. You earned ${res.croins} Croins.`,
        );
        setUrl("");
        const cc = await cap({ data: { user_id: session!.user.id } });
        setUsed(cc.used);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex justify-center px-6 py-12">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-xl bg-card border border-border rounded-xl p-8 space-y-5 h-fit"
        >
          <div>
            <h1 className="text-2xl font-bold">Submit to Crossi Search</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Add a sitemap, single page, or file URL. Only submitted content is searchable.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1.5">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["sitemap", "page", "file"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={
                    "py-2 rounded-md border text-sm transition " +
                    (kind === k
                      ? "bg-primary text-primary-foreground border-primary font-semibold"
                      : "border-border hover:bg-secondary")
                  }
                >
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="url" className="block text-sm mb-1.5">
              URL
            </label>
            <input
              id="url"
              type="url"
              required
              placeholder={
                kind === "sitemap"
                  ? "https://example.com/sitemap.xml"
                  : kind === "file"
                    ? "https://example.com/doc.txt"
                    : "https://example.com/page"
              }
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Reward:{" "}
              <span className="text-primary font-semibold">{reward} Croins</span>
            </span>
            {used !== null && (
              <span className="text-muted-foreground">
                Today: {used}/{capN}
              </span>
            )}
          </div>

          {err && <p className="text-destructive text-sm">{err}</p>}
          {msg && <p className="text-primary text-sm">{msg}</p>}

          <button
            type="submit"
            disabled={loading || (used !== null && used >= capN)}
            className="w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? "Indexing…" : "Submit"}
          </button>
        </form>
      </main>
    </div>
  );
}
