// Crossinet browser tabs + favorites.
// Saved to the signed-in Crossatrix account, or to localStorage when signed out.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/lib/auth";
import { cnetGetState, cnetSaveState } from "@/lib/cnet.functions";

export type Tab = { url: string; title: string };
export const CNET_HOME = "cnet://home.cat";

export type BrowserState = { tabs: Tab[]; active: number; favorites: Tab[] };

const DEFAULT: BrowserState = { tabs: [{ url: CNET_HOME, title: "home.cat" }], active: 0, favorites: [] };

const lsKey = (uid: string | null) => `cnet_browser_${uid ?? "guest"}`;

function readLocal(uid: string | null): BrowserState | null {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as BrowserState;
    if (!Array.isArray(v.tabs) || !v.tabs.length) return null;
    return { tabs: v.tabs, active: v.active ?? 0, favorites: Array.isArray(v.favorites) ? v.favorites : [] };
  } catch {
    return null;
  }
}

export function titleFor(url: string) {
  return url.replace(/^cnet:\/\//i, "").replace(/\/index\.html$/i, "") || "New tab";
}

export function useBrowserState() {
  const session = useSession();
  const uid = session?.user.id ?? null;
  const getState = useServerFn(cnetGetState);
  const saveState = useServerFn(cnetSaveState);
  const [state, setState] = useState<BrowserState>(DEFAULT);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Load (local first for instant paint, then the account copy).
  useEffect(() => {
    const scope = uid ?? "guest";
    if (loadedFor.current === scope) return;
    loadedFor.current = scope;
    const local = readLocal(uid);
    if (local) setState(local);
    setReady(true);
    if (!uid) return;
    let cancelled = false;
    getState({ data: { user_id: uid } })
      .then((r) => {
        if (cancelled) return;
        if (r.tabs.length) {
          setState({ tabs: r.tabs, active: Math.min(r.active, r.tabs.length - 1), favorites: r.favorites });
        } else if (!local) {
          setState(DEFAULT);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid, getState]);

  // Persist (debounced).
  const persist = useCallback(
    (next: BrowserState) => {
      setState(next);
      try {
        localStorage.setItem(lsKey(uid), JSON.stringify(next));
      } catch {
        /* storage full or blocked */
      }
      if (!uid) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveState({
          data: {
            user_id: uid,
            tabs: next.tabs.slice(0, 30),
            favorites: next.favorites.slice(0, 100),
            active: Math.min(next.active, 30),
          },
        }).catch(() => {});
      }, 800);
    },
    [uid, saveState],
  );

  const update = useCallback(
    (fn: (s: BrowserState) => BrowserState) => persist(fn(stateRef.current)),
    [persist],
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  return { state, ready, update };
}
