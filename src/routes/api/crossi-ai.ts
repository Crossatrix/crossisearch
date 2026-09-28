import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ prompt: z.string().min(1).max(8000) });

function extract(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["response", "text", "output", "answer", "message", "content", "result", "reply"]) {
      const v = d[k];
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const inner = extract(v);
        if (inner) return inner;
      }
    }
    const choices = d.choices as Array<{ message?: { content?: string } }> | undefined;
    if (choices?.[0]?.message?.content) return choices[0].message.content;
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
          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45000) });
          const raw = await res.text();
          let text = raw;
          try {
            text = extract(JSON.parse(raw)) || raw;
          } catch {
            /* plain text */
          }
          if (!res.ok) return Response.json({ error: "AI request failed" }, { status: 502 });
          return Response.json({ text: text.trim() });
        } catch {
          return Response.json({ error: "AI request timed out" }, { status: 504 });
        }
      },
    },
  },
});
