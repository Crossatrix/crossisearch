import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ prompt: z.string().min(1).max(8000) });

function extract(data: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (typeof data === "string") {
    const s = data.trim();
    // Handle stringified JSON payloads (double-encoded responses)
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        const inner = extract(JSON.parse(s), depth + 1);
        if (inner) return inner;
      } catch {
        /* not JSON */
      }
    }
    return s;
  }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["response", "text", "output", "answer", "message", "content", "result", "reply", "data"]) {
      const v = d[k];
      if (typeof v === "string") {
        const inner = extract(v, depth + 1);
        if (inner) return inner;
      }
      if (v && typeof v === "object") {
        const inner = extract(v, depth + 1);
        if (inner) return inner;
      }
    }
    const choices = d.choices as Array<{ message?: { content?: string } }> | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
  }
  return "";
}

async function askCrossi(url: string): Promise<string> {
  // Retry up to 3 times on empty responses
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const raw = await res.text();
    if (!res.ok) throw new Error("upstream");
    let text = "";
    try {
      text = extract(JSON.parse(raw));
    } catch {
      text = raw.trim();
    }
    if (text.trim()) return text.trim();
    // Empty response — wait briefly and retry
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  return "";
}

export const Route = createFileRoute("/api/crossi-ai")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        const key = process.env["CROSSI_AI"];
        if (!key) return Response.json({ error: "AI not configured" }, { status: 500 });
        const url = new URL("https://hqibtbdovjcocqgwqwbw.supabase.co/functions/v1/public-api");
        url.searchParams.set("key", key);
        url.searchParams.set("model", "Crossi_6.0_Lite");
        url.searchParams.set("prompt", parsed.prompt);
        try {
          const text = await askCrossi(url.toString());
          if (!text) return Response.json({ error: "AI returned an empty response" }, { status: 502 });
          return Response.json({ text });
        } catch {
          return Response.json({ error: "AI request timed out" }, { status: 504 });
        }
      },
    },
  },
});
