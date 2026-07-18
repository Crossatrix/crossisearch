// Search history + result cache stored in localStorage.
// Scoped per user (or "guest" when signed out) so different Crossatrix
// accounts on the same device keep separate histories.

import { useEffect, useState } from "react";
import { getSession } from "@/lib/auth";

export type HistoryEntry = { q: string; count: number; last: number };

const EVT = "crossi-history";

function scope(): string {
  const s = getSession();
  return s ? `u:${s.user.id}` : "guest";
}

const histKey = () => `crossi_history_${scope()}`;
const cacheKey = (q: string) => `crossi_cache_${scope()}_${q.toLowerCase()}`;
const cacheIndexKey = () => `crossi_cache_index_${scope()}`;

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  return read<HistoryEntry[]>(histKey()) || [];
}

export function addSearch(q: string) {
  if (typeof window === "undefined") return;
  const query = q.trim();
  if (!query) return;
  const list = getHistory();
  const idx = list.findIndex((e) => e.q.toLowerCase() === query.toLowerCase());
  if (idx >= 0) {
    list[idx].count += 1;
    list[idx].last = Date.now();
    list[idx].q = query;
  } else {
    list.push({ q: query, count: 1, last: Date.now() });
  }
  // Keep top 100 by last-used
  list.sort((a, b) => b.last - a.last);
  const trimmed = list.slice(0, 100);
  localStorage.setItem(histKey(), JSON.stringify(trimmed));
  window.dispatchEvent(new Event(EVT));
}

export function removeSearch(q: string) {
  const list = getHistory().filter((e) => e.q.toLowerCase() !== q.toLowerCase());
  localStorage.setItem(histKey(), JSON.stringify(list));
  // drop its cache too
  localStorage.removeItem(cacheKey(q));
  window.dispatchEvent(new Event(EVT));
}

export function clearHistory() {
  if (typeof window === "undefined") return;
  const idx = read<string[]>(cacheIndexKey()) || [];
  for (const k of idx) localStorage.removeItem(k);
  localStorage.removeItem(cacheIndexKey());
  localStorage.removeItem(histKey());
  window.dispatchEvent(new Event(EVT));
}

export type CachedSearch = {
  results: unknown[];
  overview: string;
  tab: string;
  at: number;
};

export function getCached(q: string, tab: string): CachedSearch | null {
  if (typeof window === "undefined") return null;
  const v = read<CachedSearch>(cacheKey(`${tab}:${q}`));
  return v && v.tab === tab ? v : null;
}

export function setCached(q: string, tab: string, data: Omit<CachedSearch, "at" | "tab">) {
  if (typeof window === "undefined") return;
  const k = cacheKey(`${tab}:${q}`);
  const payload: CachedSearch = { ...data, tab, at: Date.now() };
  try {
    localStorage.setItem(k, JSON.stringify(payload));
    const idx = read<string[]>(cacheIndexKey()) || [];
    if (!idx.includes(k)) {
      idx.push(k);
      localStorage.setItem(cacheIndexKey(), JSON.stringify(idx));
    }
  } catch {
    /* quota; ignore */
  }
}

export function useHistory(): HistoryEntry[] {
  const [h, setH] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    const update = () => setH(getHistory());
    update();
    window.addEventListener(EVT, update);
    window.addEventListener("crossi-auth", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVT, update);
      window.removeEventListener("crossi-auth", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return h;
}
