import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Header } from "@/components/Header";
import { searchPages, aiOverview } from "@/lib/crossi.functions";

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
};

function SearchPage() {
  const { q, tab } = Route.useSearch();
  const navigate = useNavigate();
  const search = useServerFn(searchPages);
  const overview = useServerFn(aiOverview);

  const [input, setInput] = useState(q);
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [ov, setOv] = useState<string>("");
  const [ovLoading, setOvLoading] = useState(false);

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
        setResults(r.results);
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="border-b border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim())
              navigate({
                to: "/search",
                search: { q: input.trim(), tab },
              });
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
            <p className="text-lg mb-2">No {tab === "files" ? "files" : "results"} for "{q}"</p>
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
                  <p className="text-muted-foreground text-sm">
                    Generating overview…
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {ov}
                  </p>
                )}
              </div>
            )}

            {tab === "files" ? (
              <ul className="space-y-3">
                {results.map((r) => (
                  <li
                    key={r.id}
                    className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold truncate">
                        {r.title}
                      </div>
                      {r.snippet && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {r.snippet}
                        </p>
                      )}
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold shrink-0"
                    >
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-6">
                {results.map((r) => (
                  <li key={r.id}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block group"
                    >
                      <div className="text-xs text-muted-foreground truncate">
                        {r.url}
                      </div>
                      <div className="text-lg text-primary group-hover:underline">
                        {r.title}
                      </div>
                      {r.snippet && (
                        <p className="text-sm text-foreground/80 mt-1">
                          {r.snippet}
                        </p>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
