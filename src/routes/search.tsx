import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Header } from "@/components/Header";
import {
  searchPages,
  aiOverview,
  isAdmin,
  deletePage,
  testIframeStatus,
} from "@/lib/crossi.functions";
import { useSession } from "@/lib/auth";

const searchSchema = z.object({
  q: z.string().catch(""),
  tab: z.enum(["web", "files"]).catch("web"),
});

export const Route = createFileRoute("/search")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Crossi Search" },
      {
        name: "description",
        content: "Search the Crossi community-indexed web and files.",
      },
    ],
  }),
  component: SearchPage,
});

type Result = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  kind: string;
  mime_type: string | null;
  file_kind: string | null;
  iframe_status: string | null;
};

function SearchPage() {
  const { q, tab } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSession();
  const search = useServerFn(searchPages);
  const overview = useServerFn(aiOverview);
  const checkAdmin = useServerFn(isAdmin);
  const del = useServerFn(deletePage);
  const testIframe = useServerFn(testIframeStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [input, setInput] = useState(q);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [ov, setOv] = useState<string>("");
  const [ovLoading, setOvLoading] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setAdmin(false);
      return;
    }
    checkAdmin({ data: { user_id: session.user.id } }).then((r) => setAdmin(r.admin));
  }, [session, checkAdmin]);

  useEffect(() => {
    setInput(q);
    if (!q) {
      setResults([]);
      setOv("");
      return;
    }
    setLoading(true);
    setOv("");
    const kind = tab === "files" ? "file" : "page";
    search({ data: { query: q, kind } })
      .then((r) => {
        setResults(r.results as Result[]);
        if (tab === "web" && r.results.length > 0) {
          setOvLoading(true);
          overview({
            data: {
              query: q,
              sources: r.results.slice(0, 8).map((x) => x.url),
            },
          })
            .then((o) => setOv(o.overview))
            .finally(() => setOvLoading(false));
        }
      })
      .finally(() => setLoading(false));
  }, [q, tab, search, overview]);

  const goTab = (next: "web" | "files") =>
    navigate({ to: "/search", search: { q, tab: next } });

  async function onDelete(id: string) {
    if (!session) return;
    if (!confirm("Delete this result?")) return;
    const r = await del({ data: { user_id: session.user.id, page_id: id } });
    if ("error" in r && r.error) {
      alert(r.error);
      return;
    }
    setResults((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
  }

  async function onTestIframe(id: string) {
    if (!session) return;
    setTestingId(id);
    const r = await testIframe({ data: { user_id: session.user.id, page_id: id } });
    setTestingId(null);
    if ("error" in r && r.error) {
      alert(r.error);
      return;
    }
    if ("iframe_status" in r) {
      const status = r.iframe_status as string;
      setResults((prev) =>
        prev ? prev.map((x) => (x.id === id ? { ...x, iframe_status: status } : x)) : prev,
      );
    }
  }

  const imageResults = (results || []).filter((r) => r.file_kind === "image");
  const otherFileResults = (results || []).filter((r) => r.file_kind !== "image");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="border-b border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim())
              navigate({ to: "/search", search: { q: input.trim(), tab } });
          }}
          className="max-w-3xl mx-auto px-6 pt-4"
        >
          <div className="flex items-center bg-card border border-border rounded-full px-5 py-2.5 focus-within:border-primary">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-transparent outline-none"
              placeholder="Search"
            />
          </div>
        </form>
        <div className="max-w-3xl mx-auto px-6 pt-3 pb-0 flex gap-1">
          {(["web", "files"] as const).map((t) => (
            <button
              key={t}
              onClick={() => goTab(t)}
              className={
                "px-4 py-2 text-sm border-b-2 -mb-px transition " +
                (tab === t
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t === "web" ? "Web" : "Files"}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-3xl w-full mx-auto px-6 py-8 flex-1">
        {loading && <p className="text-muted-foreground">Searching…</p>}

        {!loading && results && results.length === 0 && q && (
          <div className="text-center py-16">
            <p className="text-lg mb-2">
              No {tab === "files" ? "files" : "results"} for "{q}"
            </p>
            <p className="text-muted-foreground text-sm">
              Be the first to{" "}
              <a href="/submit" className="text-primary underline">
                submit {tab === "files" ? "a file" : "a page"}
              </a>{" "}
              about this.
            </p>
          </div>
        )}

        {!loading && results && results.length > 0 && (
          <>
            {tab === "web" && (ov || ovLoading) && (
              <div className="bg-card border border-border rounded-xl p-5 mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    AI Overview · Crossi 5.1 Lite
                  </span>
                </div>
                {ovLoading ? (
                  <p className="text-muted-foreground text-sm">Generating overview…</p>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{ov}</p>
                )}
              </div>
            )}

            {tab === "files" ? (
              <div className="space-y-8">
                {imageResults.length > 0 && (
                  <div>
                    <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                      Images
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {imageResults.map((r) => (
                        <div
                          key={r.id}
                          className="bg-card border border-border rounded-lg overflow-hidden group relative"
                        >
                          <a href={r.url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={r.url}
                              alt={r.title}
                              loading="lazy"
                              className="w-full aspect-square object-cover"
                            />
                          </a>
                          <div className="p-2 text-xs truncate" title={r.title}>
                            {r.title}
                          </div>
                          {admin && (
                            <button
                              onClick={() => onDelete(r.id)}
                              className="absolute top-1.5 right-1.5 text-xs px-2 py-0.5 rounded bg-destructive/90 text-destructive-foreground opacity-0 group-hover:opacity-100 transition"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {otherFileResults.length > 0 && (
                  <div>
                    <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                      Files
                    </h2>
                    <ul className="space-y-3">
                      {otherFileResults.map((r) => (
                        <li
                          key={r.id}
                          className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-base font-semibold truncate">
                              {r.title}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {r.mime_type || r.file_kind || "file"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold"
                            >
                              Download
                            </a>
                            {admin && (
                              <button
                                onClick={() => onDelete(r.id)}
                                className="px-3 py-1.5 rounded-md text-sm border border-destructive/50 text-destructive hover:bg-destructive/10"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <ul className="space-y-6">
                {results.map((r) => (
                  <li key={r.id} className="group">
                    <div className="text-xs text-muted-foreground truncate">
                      {r.url}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-lg text-primary group-hover:underline"
                      >
                        {r.title}
                      </a>
                      {r.iframe_status === "allowed" && (
                        <button
                          onClick={() => setPreviewUrl(r.url)}
                          title="Preview in popup"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/50 text-primary text-xs font-medium hover:bg-primary/10 transition"
                        >
                          ▶ Preview
                        </button>
                      )}
                      {r.iframe_status == null && (
                        <span
                          title="Not yet tested for preview support"
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] uppercase tracking-wide"
                        >
                          Untested
                        </span>
                      )}
                    </div>
                    {r.snippet && (
                      <p className="text-sm text-foreground/80 mt-1">{r.snippet}</p>
                    )}
                    {admin && (
                      <div className="mt-1 flex items-center gap-3 text-xs">
                        {r.iframe_status == null && (
                          <button
                            onClick={() => onTestIframe(r.id)}
                            disabled={testingId === r.id}
                            className="text-primary hover:underline disabled:opacity-60"
                          >
                            {testingId === r.id ? "Testing…" : "Test iframe"}
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(r.id)}
                          className="text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border">
              <div className="text-xs text-muted-foreground truncate flex-1">
                {previewUrl}
              </div>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary"
              >
                Open ↗
              </a>
              <button
                onClick={() => setPreviewUrl(null)}
                className="text-sm px-2 py-1 rounded-md hover:bg-secondary"
              >
                ✕
              </button>
            </div>
            <iframe
              src={previewUrl}
              title="Preview"
              className="flex-1 w-full bg-background"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
      )}
    </div>
  );

}
