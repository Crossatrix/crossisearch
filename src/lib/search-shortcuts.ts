export type Shortcut =
  | { type: "translate"; text: string; to: string }
  | { type: "calc"; expr: string }
  | { type: "ai"; prompt: string }
  | { type: "convert"; value: string; from: string; to: string }
  | { type: "timer"; seconds: number; mode: "timer" | "stopwatch" }
  | { type: "random"; mode: "coin" | "dice"; sides: number }
  | { type: "color"; color: string };

export function detectShortcut(raw: string): Shortcut | null {
  const q = raw.trim();
  const l = q.toLowerCase();
  if (!q) return null;

  let m = l.match(/^(translate|translation|übersetzen|übersetze)\b\s*(.*)$/i);
  if (m) {
    const rest = q.slice(m[1].length).trim();
    const tm = rest.match(/^(.*?)\s+(?:to|into|in|nach|auf)\s+([a-zA-ZäöüÄÖÜ]+)$/i);
    return tm
      ? { type: "translate", text: tm[1], to: tm[2] }
      : { type: "translate", text: rest, to: "English" };
  }

  if (/^(calc|calculator|rechner|taschenrechner)$/.test(l)) return { type: "calc", expr: "" };
  m = q.match(/^(?:calc|calculator)\s+(.+)$/i);
  if (m) return { type: "calc", expr: m[1] };
  if (/^[\d\s.+\-*/%^()]+$/.test(q) && /\d/.test(q) && /[+\-*/%^]/.test(q))
    return { type: "calc", expr: q };

  m = q.match(/^(ai|chat|ask ai)\b\s*(.*)$/i);
  if (m) return { type: "ai", prompt: m[2] };

  if (/^(convert|converter|unit converter)$/.test(l))
    return { type: "convert", value: "1", from: "km", to: "mi" };
  m = l.match(/^(?:convert\s+)?(-?[\d.]+)\s*([a-z°]+)\s+(?:to|in)\s+([a-z°]+)$/);
  if (m && findUnit(m[2]) && findUnit(m[3]) && findUnit(m[2])!.cat === findUnit(m[3])!.cat)
    return { type: "convert", value: m[1], from: findUnit(m[2])!.id, to: findUnit(m[3])!.id };

  if (/^(stopwatch|stoppuhr)$/.test(l)) return { type: "timer", seconds: 0, mode: "stopwatch" };
  m = l.match(/^(?:timer|countdown)(?:\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hours?)?)?$/);
  if (m) {
    const n = m[1] ? parseInt(m[1], 10) : 5;
    const u = m[2] || "m";
    const mult = u.startsWith("h") ? 3600 : u.startsWith("s") ? 1 : 60;
    return { type: "timer", seconds: n * mult, mode: "timer" };
  }

  if (/^(flip a coin|coin flip|flip coin|coin|heads or tails)$/.test(l))
    return { type: "random", mode: "coin", sides: 2 };
  m = l.match(/^(?:roll\s+(?:a\s+)?)?(?:die|dice|d(\d+))$/) || l.match(/^roll\s+d(\d+)$/);
  if (m) return { type: "random", mode: "dice", sides: m[1] ? Math.max(2, Math.min(1000, +m[1])) : 6 };

  if (/^(color picker|colour picker|color|colour)$/.test(l)) return { type: "color", color: "#f5b82e" };
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(q)) return { type: "color", color: q };
  if (/^(rgb|hsl)a?\(.+\)$/i.test(q)) return { type: "color", color: q };

  return null;
}

export type Unit = { id: string; label: string; cat: string; f: number; aliases: string[] };
export const UNITS: Unit[] = [
  { id: "m", label: "Meters", cat: "length", f: 1, aliases: ["m", "meter", "meters"] },
  { id: "km", label: "Kilometers", cat: "length", f: 1000, aliases: ["km", "kilometer", "kilometers"] },
  { id: "cm", label: "Centimeters", cat: "length", f: 0.01, aliases: ["cm"] },
  { id: "mm", label: "Millimeters", cat: "length", f: 0.001, aliases: ["mm"] },
  { id: "mi", label: "Miles", cat: "length", f: 1609.344, aliases: ["mi", "mile", "miles"] },
  { id: "ft", label: "Feet", cat: "length", f: 0.3048, aliases: ["ft", "foot", "feet"] },
  { id: "in", label: "Inches", cat: "length", f: 0.0254, aliases: ["inch", "inches"] },
  { id: "kg", label: "Kilograms", cat: "mass", f: 1, aliases: ["kg", "kilo", "kilos", "kilogram", "kilograms"] },
  { id: "g", label: "Grams", cat: "mass", f: 0.001, aliases: ["g", "gram", "grams"] },
  { id: "lb", label: "Pounds", cat: "mass", f: 0.45359237, aliases: ["lb", "lbs", "pound", "pounds"] },
  { id: "oz", label: "Ounces", cat: "mass", f: 0.028349523, aliases: ["oz", "ounce", "ounces"] },
  { id: "c", label: "Celsius", cat: "temp", f: 0, aliases: ["c", "°c", "celsius"] },
  { id: "f", label: "Fahrenheit", cat: "temp", f: 0, aliases: ["f", "°f", "fahrenheit"] },
  { id: "k", label: "Kelvin", cat: "temp", f: 0, aliases: ["k", "kelvin"] },
  { id: "b", label: "Bytes", cat: "data", f: 1, aliases: ["b", "byte", "bytes"] },
  { id: "kb", label: "Kilobytes", cat: "data", f: 1e3, aliases: ["kb"] },
  { id: "mb", label: "Megabytes", cat: "data", f: 1e6, aliases: ["mb"] },
  { id: "gb", label: "Gigabytes", cat: "data", f: 1e9, aliases: ["gb"] },
  { id: "tb", label: "Terabytes", cat: "data", f: 1e12, aliases: ["tb"] },
  { id: "l", label: "Liters", cat: "volume", f: 1, aliases: ["l", "liter", "liters", "litre"] },
  { id: "ml", label: "Milliliters", cat: "volume", f: 0.001, aliases: ["ml"] },
  { id: "gal", label: "Gallons (US)", cat: "volume", f: 3.785411784, aliases: ["gal", "gallon", "gallons"] },
];

export function findUnit(s: string) {
  return UNITS.find((u) => u.aliases.includes(s.toLowerCase()) || u.id === s.toLowerCase());
}

export function convert(v: number, from: Unit, to: Unit): number {
  if (from.cat === "temp") {
    const c = from.id === "c" ? v : from.id === "f" ? ((v - 32) * 5) / 9 : v - 273.15;
    return to.id === "c" ? c : to.id === "f" ? (c * 9) / 5 + 32 : c + 273.15;
  }
  return (v * from.f) / to.f;
}

/** Safe arithmetic evaluator (no eval). Supports + - * / % ^ parentheses. */
export function evaluate(expr: string): number {
  const s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  function num(): number {
    if (peek() === "(") {
      i++;
      const v = add();
      if (s[i++] !== ")") throw new Error("paren");
      return v;
    }
    if (peek() === "-") { i++; return -num(); }
    if (peek() === "+") { i++; return num(); }
    const m = s.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
    if (!m) throw new Error("num");
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function pow(): number {
    const b = num();
    if (peek() === "^") { i++; return Math.pow(b, pow()); }
    return b;
  }
  function mul(): number {
    let v = pow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++];
      const r = pow();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function add(): number {
    let v = mul();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = mul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = add();
  if (i !== s.length) throw new Error("trail");
  return v;
}
