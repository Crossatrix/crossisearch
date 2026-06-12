import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Header } from "@/components/Header";
import { crossatrixLogin } from "@/lib/crossi.functions";
import { setSession } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Crossi Search" },
      { name: "description", content: "Sign in with your Crossatrix account to submit pages to Crossi Search." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const login = useServerFn(crossatrixLogin);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await login({ data: { email, password } });
      if ("error" in res && res.error) {
        setErr(res.error);
      } else if ("access_token" in res) {
        setSession({ user: res.user, access_token: res.access_token });
        navigate({ to: "/" });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md bg-card border border-border rounded-xl p-8 space-y-5"
        >
          <div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Use your Crossatrix account.
            </p>
          </div>
          <div>
            <label htmlFor="email" className="block text-sm mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 outline-none focus:border-primary"
            />
          </div>
          {err && <p className="text-destructive text-sm">{err}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
