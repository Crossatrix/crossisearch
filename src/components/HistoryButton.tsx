import { useEffect, useRef, useState } from "react";
import { History, X, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useHistory, clearHistory, removeSearch } from "@/lib/search-history";

type Props = {
  currentTab?: "web" | "files";
};

export function HistoryButton({ currentTab = "web" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const history = useHistory();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const recent = history.slice(0, 8);
  const top = [...history].sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Search history"
        title="Search history"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
      >
        <History className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-xl shadow-xl z-50 text-left">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              History
            </span>
            {history.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Clear all search history and cache?")) clearHistory();
                }}
                className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No searches yet.
            </div>
          ) : (
            <>
              {top.length > 0 && (
                <div className="px-2 py-2">
                  <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Most searched
                  </div>
                  {top.map((e) => (
                    <button
                      key={"top-" + e.q}
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: "/search", search: { q: e.q, tab: currentTab } });
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-secondary text-sm"
                    >
                      <span className="truncate">{e.q}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        ×{e.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="px-2 py-2 border-t border-border">
                <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Recent
                </div>
                {recent.map((e) => (
                  <div
                    key={"rec-" + e.q}
                    className="group flex items-center gap-1 rounded hover:bg-secondary"
                  >
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate({ to: "/search", search: { q: e.q, tab: currentTab } });
                      }}
                      className="flex-1 text-left px-2 py-1.5 text-sm truncate"
                    >
                      {e.q}
                    </button>
                    <button
                      onClick={() => removeSearch(e.q)}
                      aria-label={`Remove ${e.q}`}
                      className="p-1 mr-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
