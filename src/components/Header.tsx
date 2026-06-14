import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSession, clearSession } from "@/lib/auth";
import { isAdmin } from "@/lib/crossi.functions";

export function Header() {
  const session = useSession();
  const navigate = useNavigate();
  const checkAdmin = useServerFn(isAdmin);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setAdmin(false);
      return;
    }
    checkAdmin({ data: { user_id: session.user.id } }).then((r) => setAdmin(r.admin));
  }, [session, checkAdmin]);

  return (
    <header className="w-full border-b border-border">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-bold tracking-tight">
          <span className="text-primary">Crossi</span>{" "}
          <span className="text-foreground">Search</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            to="/submit"
            className="px-3 py-1.5 rounded-md hover:bg-secondary transition"
          >
            Submit
          </Link>
          {admin && (
            <Link
              to="/admin"
              className="px-3 py-1.5 rounded-md hover:bg-secondary transition"
            >
              Admin
            </Link>
          )}
          {session ? (
            <>
              <span className="hidden sm:inline text-muted-foreground">
                {session.user.email}
              </span>
              <button
                onClick={() => {
                  clearSession();
                  navigate({ to: "/" });
                }}
                className="px-3 py-1.5 rounded-md border border-border hover:bg-secondary transition"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
