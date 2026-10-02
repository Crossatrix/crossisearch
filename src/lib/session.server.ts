import { getRequest } from "@tanstack/react-start/server";

// Server-signed Crossi session tokens. Issued at login after Crossatrix
// verifies credentials; every privileged server fn checks the caller's
// claimed identity against this token.
const enc = new TextEncoder();
const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Server misconfigured");
  return crypto.subtle.importKey("raw", enc.encode("crossi-session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(id: string, email: string): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify({ id, email: email.toLowerCase(), exp: Date.now() + 30 * 864e5 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
  return `${payload}.${b64u(sig)}`;
}

export async function getCaller(): Promise<{ id: string; email: string } | null> {
  try {
    const tok = getRequest()?.headers.get("x-crossi-session");
    if (!tok) return null;
    const [payload, sig] = tok.split(".");
    if (!payload || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64u(sig), enc.encode(payload));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(fromB64u(payload))) as { id: string; email: string; exp: number };
    if (!c.id || c.exp < Date.now()) return null;
    return { id: c.id, email: c.email };
  } catch {
    return null;
  }
}

export async function isCaller(userId: string, email?: string): Promise<boolean> {
  const c = await getCaller();
  if (!c || c.id !== userId) return false;
  if (email !== undefined && c.email !== email.toLowerCase()) return false;
  return true;
}
