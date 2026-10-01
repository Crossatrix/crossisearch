import { useEffect, useMemo, useRef, useState } from "react";
import type { DevEntry, DevKind } from "@/lib/cnet-devtools";

type Tab = "activity" | "console" | "source";
type Props = {
  entries: DevEntry[];
  t0: number;
  /** null = this page isn't a Crossinet site (built-in page / not found) */
  site: { allowed: boolean; disabledBy: "domain" | "page" | null; host: string } | null;
  source: string;
  edited: boolean;
  onRun: (code: string) => void;
  onClear: () => void;
  onApplySource: (html: string) => void;
  onResetSource: () => void;
  onClose: () => void;
};

const CONSOLE_KINDS: DevKind[] = ["log", "info", "warn", "error", "debug", "input", "result"];
const GROUPS: { id: string; label: string; kinds: DevKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "net", label: "Network", kinds: ["net"] },
  { id: "script", label: "Scripts & timers", kinds: ["script", "timer"] },
  { id: "event", label: "Events", kinds: ["event", "lifecycle"] },
  { id: "log", label: "Console", kinds: ["log", "info", "debug", "input", "result"] },
  { id: "err", label: "Warnings & errors", kinds: ["warn", "error"] },
];

const KIND_STYLE: Record<DevKind, string> = {
  log: "", info: "text-sky-500", debug: "text-muted-foreground",
  warn: "text-yellow-500 bg-yellow-500/10", error: "text-destructive bg-destructive/10",
  input: "text-primary", result: "text-muted-foreground",
  net: "text-emerald-500", event: "text-violet-400", timer: "text-orange-400",
  script: "text-cyan-400", lifecycle: "text-pink-400", system: "text-muted-foreground italic",
};
const KIND_TAG: Partial<Record<DevKind, string>> = {
  net: "NET", event: "EVENT", timer: "TIMER", script: "SCRIPT", lifecycle: "PAGE", system: "BROWSER",
  warn: "WARN", error: "ERROR", info: "INFO", debug: "DEBUG", log: "LOG",
};

function Row({ e, t0, tag }: { e: DevEntry; t0: number; tag: boolean }) {
  const prefix = e.kind === "input" ? "› " : e.kind === "result" ? "← " : "";
  return (
    <div className={"flex gap-2 px-2 py-0.5 border-b border-border/40 font-mono text-xs " + KIND_STYLE[e.kind]}>
      <span className="text-muted-foreground shrink-0 w-14 text-right">+{Math.max(0, e.ts - t0)}ms</span>
      {tag && <span className="shrink-0 w-14 opacity-70">{KIND_TAG[e.kind] ?? e.kind.toUpperCase()}</span>}
      <span className="whitespace-pre-wrap break-all min-w-0">{prefix}{e.text}</span>
    </div>
  );
}

export function DevTools(p: Props) {
  const [tab, setTab] = useState<Tab>("console");
  const [group, setGroup] = useState("all");
  const [draft, setDraft] = useState("");
  const [src, setSrc] = useState(p.source);
  const hist = useRef<string[]>([]);
  const histPos = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSrc(p.source), [p.source]);

  const shown = useMemo(() => {
    if (tab === "console") return p.entries.filter((e) => CONSOLE_KINDS.includes(e.kind) || e.kind === "system");
    const g = GROUPS.find((x) => x.id === group);
    return g?.kinds ? p.entries.filter((e) => g.kinds!.includes(e.kind)) : p.entries;
  }, [p.entries, tab, group]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, tab]);

  const submit = () => {
    const code = draft.trim();
    if (!code) return;
    hist.current.push(code);
    histPos.current = -1;
    setDraft("");
    p.onRun(code);
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={"px-3 py-1 text-sm border-b-2 " + (tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );

  return (
    <div className="sticky bottom-0 z-30 h-80 flex flex-col border-t-2 border-primary bg-card">
      <div className="flex items-center gap-1 px-2 border-b border-border">
        {tabBtn("activity", "Activity")}
        {tabBtn("console", "Console")}
        {tabBtn("source", "Source")}
        {p.edited && <span className="ml-2 text-xs text-yellow-500">● source edited (temporary)</span>}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {p.site?.allowed && tab !== "source" && (
            <button type="button" onClick={p.onClear} className="text-muted-foreground hover:text-foreground">Clear</button>
          )}
          <button type="button" aria-label="Close console" onClick={p.onClose} className="text-muted-foreground hover:text-destructive">✕</button>
        </div>
      </div>

      {!p.site ? (
        <p className="p-6 text-sm text-muted-foreground">The console is only available on Crossinet sites. Open a site to inspect it.</p>
      ) : !p.site.allowed ? (
        <div className="p-6 text-sm">
          <p className="font-semibold mb-1">🔒 Console disabled by the publisher</p>
          <p className="text-muted-foreground">
            The owner of {p.site.host} has turned off the developer console {p.site.disabledBy === "page" ? "for this page" : "for this site"}.
          </p>
        </div>
      ) : tab === "source" ? (
        <div className="flex-1 flex flex-col min-h-0 p-2 gap-2">
          <p className="text-xs text-muted-foreground">
            The page as it runs (CSS/JS files inlined). Edit it and apply — your changes are only for this tab and disappear when you leave or reload.
          </p>
          <textarea
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-0 w-full bg-background border border-border rounded-md p-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => p.onApplySource(src)} className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-sm font-semibold">Apply temporarily</button>
            <button type="button" onClick={p.onResetSource} disabled={!p.edited} className="px-3 py-1 rounded-md border border-border text-sm disabled:opacity-50">Reset to original</button>
          </div>
        </div>
      ) : (
        <>
          {tab === "activity" && (
            <div className="flex gap-1 px-2 py-1 border-b border-border overflow-x-auto">
              {GROUPS.map((g) => (
                <button key={g.id} type="button" onClick={() => setGroup(g.id)}
                  className={"px-2 py-0.5 rounded-full text-xs border whitespace-nowrap " + (group === g.id ? "border-primary text-primary" : "border-border text-muted-foreground")}>
                  {g.label}
                </button>
              ))}
            </div>
          )}
          <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
            {shown.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nothing here yet.</p>}
            {shown.map((e) => <Row key={e.id} e={e} t0={p.t0} tag={tab === "activity"} />)}
          </div>
          {tab === "console" && (
            <div className="border-t border-border">
              <p className="px-2 pt-1 text-[11px] text-yellow-500">
                ⚠ Only run code you wrote or understand. Anyone who tells you to paste something here may be trying to take over your account.
              </p>
              <div className="flex items-start gap-2 px-2 pb-2">
                <span className="font-mono text-primary pt-1">›</span>
                <textarea
                  value={draft}
                  rows={1}
                  spellCheck={false}
                  placeholder="Type JavaScript and press Enter (try help)"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                    else if (e.key === "ArrowUp" && hist.current.length && !draft.includes("\n")) {
                      e.preventDefault();
                      histPos.current = histPos.current < 0 ? hist.current.length - 1 : Math.max(0, histPos.current - 1);
                      setDraft(hist.current[histPos.current]);
                    } else if (e.key === "ArrowDown" && histPos.current >= 0) {
                      e.preventDefault();
                      histPos.current += 1;
                      if (histPos.current >= hist.current.length) { histPos.current = -1; setDraft(""); }
                      else setDraft(hist.current[histPos.current]);
                    }
                  }}
                  className="flex-1 bg-background border border-border rounded-md px-2 py-1 font-mono text-xs resize-none outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
