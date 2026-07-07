import { createFileRoute } from "@tanstack/react-router";
import { validateApiKey, apiSearch } from "@/lib/crossi.functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, Authorization",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra },
  });
}

async function handle(request: Request, query: string, kind: string | null, limit: number) {
  const apiKey =
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const auth = await validateApiKey(apiKey);
  if (!auth) return json({ error: "Invalid key, revoked, or daily limit reached" }, 429);
  if (auth.scope !== "read") {
    return json({ error: "This key is not authorized for search" }, 403);
  }
  if (!query) return json({ error: "Missing query" }, 400);
  const k = kind === "page" || kind === "file" ? kind : null;
  const n = Math.max(1, Math.min(50, limit || 20));
  const results = await apiSearch(query, k, n);
  const headers = {
    "X-RateLimit-Plan": auth.plan,
    "X-RateLimit-Limit": String(auth.limit),
    "X-RateLimit-Remaining": String(auth.remaining),
  };
  return json({ query, kind: k, count: results.length, results }, 200, headers);
}

export const Route = createFileRoute("/api/public/search")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const u = new URL(request.url);
        return handle(
          request,
          u.searchParams.get("q") || "",
          u.searchParams.get("kind"),
          parseInt(u.searchParams.get("limit") || "20", 10),
        );
      },
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        return handle(
          request,
          typeof body.query === "string" ? body.query : "",
          typeof body.kind === "string" ? body.kind : null,
          typeof body.limit === "number" ? body.limit : 20,
        );
      },
    },
  },
});
