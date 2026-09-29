import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type Shortcut, UNITS, convert, evaluate, findUnit } from "@/lib/search-shortcuts";

async function askAI(prompt: string): Promise<string> {
  const res = await fetch("/api/crossi-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const j = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(j.error || "Request failed");
  return j.text || "";
}

const TITLES: Record<Shortcut["type"], string> = {
  translate: "Translate",
  calc: "Calculator",
  ai: "Crossi AI Chat · Crossi 6.0 Lite",
  convert: "Unit Converter",
  timer: "Timer & Stopwatch",
  random: "Coin & Dice",
  color: "Color Picker",
};

const btn = "px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-60";
const field = "bg-background border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary";

export function ShortcutWidget({ sc }: { sc: Shortcut }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-card border border-primary/40 rounded-xl mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">{TITLES[sc.type]}</span>
        <button onClick={() => setOpen(!open)} className="text-muted-foreground hover:text-foreground" aria-label="Toggle">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="p-5">
          {sc.type === "translate" && <Translate sc={sc} />}
          {sc.type === "calc" && <Calc initial={sc.expr} />}
          {sc.type === "ai" && <AIChat initial={sc.prompt} />}
          {sc.type === "convert" && <Converter sc={sc} />}
          {sc.type === "timer" && <Timer sc={sc} />}
          {sc.type === "random" && <Random sc={sc} />}
          {sc.type === "color" && <ColorPick initial={sc.color} />}
        </div>
      )}
    </div>
  );
}

const LANGS: Record<string, string> = {
  English: "en", German: "de", French: "fr", Spanish: "es", Italian: "it", Portuguese: "pt",
  Dutch: "nl", Polish: "pl", Turkish: "tr", Russian: "ru", Ukrainian: "uk", Chinese: "zh-CN",
  Japanese: "ja", Korean: "ko", Arabic: "ar", Hindi: "hi",
};

async function translateText(text: string, targetLang: string): Promise<string> {
  // Free MyMemory translation API — no AI, no API key
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${encodeURIComponent(targetLang)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Translation failed");
  const j = (await res.json()) as { responseData?: { translatedText?: string } };
  const out = j.responseData?.translatedText?.trim();
  if (!out) throw new Error("No translation returned");
  return out;
}

function Translate({ sc }: { sc: Extract<Shortcut, { type: "translate" }> }) {
  const initialTo = Object.keys(LANGS).find((l) => l.toLowerCase() === sc.to.toLowerCase()) || "English";
  const [text, setText] = useState(sc.text);
  const [to, setTo] = useState(initialTo);
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setOut(await translateText(text, LANGS[to] || "en"));
    } catch (e) {
      setOut((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { if (sc.text) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Enter text" className={field + " resize-none"} />
      <div className={field + " min-h-[6rem] whitespace-pre-wrap"}>{busy ? <span className="text-muted-foreground">Translating…</span> : out}</div>
      <div className="flex gap-2 sm:col-span-2">
        <select value={to} onChange={(e) => setTo(e.target.value)} className={field}>
          {Object.keys(LANGS).map((l) => <option key={l}>{l}</option>)}
        </select>
        <button onClick={run} disabled={busy} className={btn}>Translate</button>
      </div>
    </div>
  );
}

function Calc({ initial }: { initial: string }) {
  const [expr, setExpr] = useState(initial);
  let result = "";
  try {
    if (expr.trim()) {
      const v = evaluate(expr);
      result = Number.isFinite(v) ? String(+v.toPrecision(12)) : "Error";
    }
  } catch { result = ""; }
  const keys = ["(", ")", "%", "C", "7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "^", "+"];
  const press = (k: string) => (k === "C" ? setExpr("") : setExpr(expr + k));
  return (
    <div className="max-w-sm">
      <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && result && setExpr(result)} className={field + " w-full text-right text-lg"} />
      <div className="text-right text-2xl font-semibold text-primary h-9 mt-1">{result && `= ${result}`}</div>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {keys.map((k) => (
          <button key={k} onClick={() => press(k)} className="py-2 rounded-md bg-secondary hover:bg-secondary/70 text-sm font-medium">{k}</button>
        ))}
        <button onClick={() => setExpr(expr.slice(0, -1))} className="py-2 rounded-md bg-secondary text-sm col-span-2">⌫</button>
        <button onClick={() => result && setExpr(result)} className={btn + " col-span-2"}>=</button>
      </div>
    </div>
  );
}

function AIChat({ initial }: { initial: string }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    const history = next.slice(-10).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n");
    try {
      const reply = await askAI(next.length > 1 ? `${history}\nAssistant:` : text);
      setMsgs((m) => [...m, { role: "ai", text: reply || "(no response)" }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { if (initial) send(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);
  return (
    <div>
      <div className="max-h-80 overflow-y-auto space-y-2 mb-3">
        {msgs.length === 0 && <p className="text-sm text-muted-foreground">Temporary chat — nothing is saved.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={"text-sm whitespace-pre-wrap rounded-lg px-3 py-2 max-w-[85%] " + (m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary")}>{m.text}</div>
        ))}
        {busy && <div className="text-sm text-muted-foreground">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message Crossi AI" className={field + " flex-1 min-w-0"} />
        <button disabled={busy} className={btn}>Send</button>
        {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="px-3 text-sm text-muted-foreground">Clear</button>}
      </form>
    </div>
  );
}

function Converter({ sc }: { sc: Extract<Shortcut, { type: "convert" }> }) {
  const [value, setValue] = useState(sc.value);
  const [from, setFrom] = useState(sc.from);
  const [to, setTo] = useState(sc.to);
  const f = findUnit(from)!;
  const opts = UNITS.filter((u) => u.cat === f.cat);
  const t = opts.find((u) => u.id === to) || opts[0];
  const n = parseFloat(value);
  const out = Number.isFinite(n) ? +convert(n, f, t).toPrecision(8) : "";
  return (
    <div className="space-y-3">
      <select value={f.cat} onChange={(e) => { const c = UNITS.filter((u) => u.cat === e.target.value); setFrom(c[0].id); setTo(c[1].id); }} className={field}>
        {["length", "mass", "temp", "data", "volume"].map((c) => <option key={c} value={c}>{c === "temp" ? "Temperature" : c[0].toUpperCase() + c.slice(1)}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} className={field + " w-28"} inputMode="decimal" />
        <select value={f.id} onChange={(e) => setFrom(e.target.value)} className={field}>{opts.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
        <span>=</span>
        <span className="text-xl font-semibold text-primary">{out}</span>
        <select value={t.id} onChange={(e) => setTo(e.target.value)} className={field}>{opts.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
      </div>
    </div>
  );
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

function Timer({ sc }: { sc: Extract<Shortcut, { type: "timer" }> }) {
  const [mode, setMode] = useState(sc.mode);
  const [total, setTotal] = useState(sc.seconds * 1000 || 300000);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const startRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - elapsed;
    const id = setInterval(() => {
      const e = Date.now() - startRef.current;
      setElapsed(e);
      if (mode === "timer" && e >= total) { setRunning(false); setElapsed(total); }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, total]);
  const reset = () => { setRunning(false); setElapsed(0); setLaps([]); };
  const done = mode === "timer" && elapsed >= total;
  return (
    <div>
      <div className="flex gap-1 mb-4">
        {(["timer", "stopwatch"] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); reset(); }} className={"px-3 py-1 text-sm rounded-md " + (mode === m ? "bg-primary text-primary-foreground" : "bg-secondary")}>{m === "timer" ? "Timer" : "Stopwatch"}</button>
        ))}
      </div>
      <div className={"text-5xl font-semibold tabular-nums mb-4 " + (done ? "text-primary animate-pulse" : "")}>
        {mode === "timer" ? fmt(Math.max(0, total - elapsed) + 999) : fmt(elapsed) + "." + Math.floor((elapsed % 1000) / 100)}
      </div>
      {mode === "timer" && !running && elapsed === 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {[1, 5, 10, 15, 30].map((m) => <button key={m} onClick={() => setTotal(m * 60000)} className="px-2 py-1 text-xs rounded-md bg-secondary">{m} min</button>)}
          <input type="number" min={1} placeholder="min" onChange={(e) => +e.target.value > 0 && setTotal(+e.target.value * 60000)} className={field + " w-20 py-1"} />
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={() => (done ? reset() : setRunning(!running))} className={btn}>{running ? "Pause" : done ? "Restart" : "Start"}</button>
        {mode === "stopwatch" && running && <button onClick={() => setLaps([elapsed, ...laps])} className="px-3 py-1.5 rounded-md bg-secondary text-sm">Lap</button>}
        <button onClick={reset} className="px-3 py-1.5 rounded-md bg-secondary text-sm">Reset</button>
      </div>
      {laps.length > 0 && (
        <ol className="mt-3 text-sm space-y-1 tabular-nums">
          {laps.map((l, i) => <li key={i}>Lap {laps.length - i}: {fmt(l)}.{Math.floor((l % 1000) / 100)}</li>)}
        </ol>
      )}
    </div>
  );
}

function Random({ sc }: { sc: Extract<Shortcut, { type: "random" }> }) {
  const [mode, setMode] = useState(sc.mode);
  const [sides, setSides] = useState(sc.sides === 2 ? 6 : sc.sides);
  const [res, setRes] = useState<string>("");
  const [spin, setSpin] = useState(false);
  const roll = () => {
    setSpin(true);
    setTimeout(() => {
      setRes(mode === "coin" ? (Math.random() < 0.5 ? "Heads" : "Tails") : String(1 + Math.floor(Math.random() * sides)));
      setSpin(false);
    }, 400);
  };
  useEffect(() => { roll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-1">
        {(["coin", "dice"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={"px-3 py-1 text-sm rounded-md " + (mode === m ? "bg-primary text-primary-foreground" : "bg-secondary")}>{m === "coin" ? "Coin" : "Dice"}</button>)}
      </div>
      <div className={"w-28 h-28 flex items-center justify-center text-2xl font-bold border-4 border-primary text-primary transition-transform duration-300 " + (mode === "coin" ? "rounded-full " : "rounded-2xl ") + (spin ? "rotate-[360deg] scale-90 opacity-50" : "")}>{spin ? "…" : res}</div>
      <div className="flex items-center gap-2">
        {mode === "dice" && (
          <select value={sides} onChange={(e) => setSides(+e.target.value)} className={field}>
            {[4, 6, 8, 10, 12, 20, 100].map((s) => <option key={s} value={s}>d{s}</option>)}
          </select>
        )}
        <button onClick={roll} className={btn}>{mode === "coin" ? "Flip" : "Roll"}</button>
      </div>
    </div>
  );
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("").toLowerCase();
  if (typeof document === "undefined") return "#f5b82e";
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#f5b82e";
  ctx.fillStyle = "#000";
  ctx.fillStyle = c;
  return /^#/.test(ctx.fillStyle) ? ctx.fillStyle : "#f5b82e";
}

function ColorPick({ initial }: { initial: string }) {
  const [hex, setHex] = useState("#f5b82e");
  useEffect(() => setHex(toHex(initial)), [initial]);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h = Math.round(h * 60 < 0 ? h * 60 + 360 : h * 60);
  }
  const values = [hex.toUpperCase(), `rgb(${r}, ${g}, ${b})`, `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`];
  return (
    <div className="flex flex-wrap items-center gap-5">
      <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className="w-24 h-24 rounded-lg cursor-pointer bg-transparent" />
      <div className="space-y-2">
        {values.map((v) => (
          <button key={v} onClick={() => navigator.clipboard?.writeText(v)} title="Copy" className="block font-mono text-sm px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/70">{v}</button>
        ))}
      </div>
    </div>
  );
}
