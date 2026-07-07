import { createFileRoute } from "@tanstack/react-router";
import {
  validateApiKey,
  apiSubmitPage,
  apiSubmitFile,
} from "@/lib/crossi.functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, Authorization",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const Route = createFileRoute("/api/public/submit")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("x-api-key") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
          "";
        const auth = await validateApiKey(apiKey);
        if (!auth) return json({ error: "Invalid or revoked API key" }, 401);
        if (auth.scope !== "write") {
          return json({ error: "This key is not authorized for submissions" }, 403);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const b = body as Record<string, unknown>;
        const kind = b.kind;

        if (kind === "page") {
          const url = typeof b.url === "string" ? b.url : "";
          if (!url) return json({ error: "Missing url" }, 400);
          try {
            new URL(url);
          } catch {
            return json({ error: "Invalid url" }, 400);
          }
          const r = await apiSubmitPage(url, auth.created_by);
          return json(r, "error" in r ? 400 : 200);
        }

        if (kind === "file") {
          const filename = typeof b.filename === "string" ? b.filename : "";
          const mimeType = typeof b.mime_type === "string" ? b.mime_type : null;
          const content = typeof b.content_base64 === "string" ? b.content_base64 : "";
          if (!filename || !content) {
            return json({ error: "Missing filename or content_base64" }, 400);
          }
          if (filename.length > 255) return json({ error: "Filename too long" }, 400);
          let bytes: Uint8Array;
          try {
            bytes = base64ToBytes(content);
          } catch {
            return json({ error: "Invalid base64 content" }, 400);
          }
          if (bytes.length > 25 * 1024 * 1024) {
            return json({ error: "File too large (max 25MB)" }, 400);
          }
          const r = await apiSubmitFile(filename, mimeType, bytes, auth.created_by);
          return json(r, "error" in r ? 400 : 200);
        }

        return json({ error: "kind must be 'page' or 'file'" }, 400);
      },
    },
  },
});
