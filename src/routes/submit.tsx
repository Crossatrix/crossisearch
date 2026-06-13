import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Header } from "@/components/Header";
import { useSession } from "@/lib/auth";
import { submitUrl } from "@/lib/crossi.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit to Crossi Search" },
      {
        name: "description",
        content:
          "Submit a page or upload a file to the Crossi Search index. Earn Croins for each new submission.",
      },
    ],
  }),
  component: SubmitPage,
});

function SubmitPage() {
  const session = useSession();
  const navigate = useNavigate();
  const submit = useServerFn(submitUrl);

  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"page" | "file">("page");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      if (kind === "file") {
        if (!file) {
          setErr("Choose a file to upload.");
          return;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${session!.user.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("submissions")
          .upload(path, file, { upsert: false });
        if (upErr) {
          setErr(upErr.message);
          return;
        }
        const res = await submit({
          data: {
            kind: "file",
            user_id: session!.user.id,
            storage_path: path,
            filename: file.name,
          },
        });
        if ("error" in res && res.error) {
          setErr(res.error);
        } else if ("success" in res) {
          setMsg(`File indexed. You earned ${res.croins} Croins.`);
          setFile(null);
          (document.getElementById("file-input") as HTMLInputElement | null)?.value &&
            ((document.getElementById("file-input") as HTMLInputElement).value = "");
        }
      } else {
        const res = await submit({
          data: { kind: "page", user_id: session!.user.id, url },
        });
        if ("error" in res && res.error) {
          setErr(res.error);
        } else if ("success" in res) {
          setMsg(
            `Indexed ${res.indexed} ${res.indexed === 1 ? "page" : "pages"}. You earned ${res.croins} Croins.`,
          );
          setUrl("");
        }
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
              Add a page URL (we'll auto-pull its sitemap.xml) or upload a file directly.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["page", "file"] as const).map((k) => (
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

          {kind === "page" ? (
            <div>
              <label htmlFor="url" className="block text-sm mb-1.5">
                URL
              </label>
              <input
                id="url"
                type="url"
                required
                placeholder="https://example.com/page"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="file-input" className="block text-sm mb-1.5">
                File
              </label>
              <input
                id="file-input"
                type="file"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:font-semibold"
              />
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Reward:{" "}
              <span className="text-primary font-semibold">{reward} Croins</span>
            </span>
          </div>

          {err && <p className="text-destructive text-sm">{err}</p>}
          {msg && <p className="text-primary text-sm">{msg}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? "Submitting…" : "Submit"}
          </button>
        </form>
      </main>
    </div>
  );
}
