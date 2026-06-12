// Crossatrix auth stored in localStorage.
export type CrossatrixUser = { id: string; email: string; admin?: boolean };
export type CrossatrixSession = { user: CrossatrixUser; access_token: string };

const KEY = "crossi_session";

export function getSession(): CrossatrixSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CrossatrixSession;
  } catch {
    return null;
  }
}

export function setSession(s: CrossatrixSession) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("crossi-auth"));
}

export function clearSession() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("crossi-auth"));
}

import { useEffect, useState } from "react";

export function useSession(): CrossatrixSession | null {
  const [s, setS] = useState<CrossatrixSession | null>(null);
  useEffect(() => {
    setS(getSession());
    const handler = () => setS(getSession());
    window.addEventListener("crossi-auth", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("crossi-auth", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return s;
}

export function isAdmin(session: CrossatrixSession | null): boolean {
  if (!session) return false;
  return session.user.email === "Cross.a.trix.owner@hotmail.com";
}
