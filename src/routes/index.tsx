import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/Header";
import { HistoryButton } from "@/components/HistoryButton";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crossi Search" },
      {
        name: "description",
        content:
          "Crossi Search — a community-powered web search. Indexes only user-submitted sitemaps and files, with AI overviews by Crossi 5.1 Lite.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center px-6 -mt-16">
        <h1 className="text-6xl sm:text-7xl font-bold tracking-tight mb-10">
          <span className="text-primary">Crossi</span>{" "}
          <span className="text-foreground">Search</span>
        </h1>
        <form
          className="w-full max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim())
              navigate({ to: "/search", search: { q: q.trim() } });
          }}
        >
          <div className="flex items-center bg-card border border-border rounded-full px-5 py-3 focus-within:border-primary transition">
            <svg
              className="w-5 h-5 text-muted-foreground mr-3 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
              />
            </svg>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the community-indexed web"
              className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex justify-center gap-3 mt-6">
            <button
              type="submit"
              className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition"
            >
              Crossi Search
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/submit" })}
              className="px-6 py-2.5 rounded-md border border-border hover:bg-secondary transition"
            >
              Submit a page
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/docs" })}
              className="px-6 py-2.5 rounded-md border border-border hover:bg-secondary transition"
            >
              Docs
            </button>
          </div>
        </form>
        <p className="text-muted-foreground text-sm mt-10 text-center max-w-lg">
          Only pages and files submitted by Crossatrix members are searchable.
          Earn <span className="text-primary font-semibold">100 Croins</span>{" "}
          per page or sitemap,{" "}
          <span className="text-primary font-semibold">50 Croins</span> per file.
        </p>
      </main>
    </div>
  );
}
