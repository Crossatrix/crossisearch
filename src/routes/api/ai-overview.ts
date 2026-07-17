import { createFileRoute } from "@tanstack/react-router";
import { searchPagesCore } from "@/lib/crossi.functions";

// Streaming AI overview endpoint. Runs its own quick search so it can start
// in parallel with the main search request from the client.
export const Route = createFileRoute("/api/ai-overview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { query?: string; kind?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        const query = (body.query || "").trim();
        if (!query) return new Response("Missing query", { status: 400 });
        const kind: "page" | "file" | null =
          body.kind === "page" || body.kind === "file" ? body.kind : "page";

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("", { status: 200 });

        // Get sources in parallel with what the client is fetching.
        const results = await searchPagesCore(query, kind, 8);
        if (results.length === 0) return new Response("", { status: 200 });

        const systemPrompt =
          "You are Crossi 5.1 Lite, the AI overview engine inside Crossi Search. Given a user query and a short list of indexed result snippets, write a concise 2-4 sentence overview answering the query. Only use the provided sources. If they don't answer the query, say so briefly. No markdown headings, no lists, plain prose.";
        const userPrompt = `Query: ${query}\n\nSources:\n${results
          .map((s, i) => `[${i + 1}] ${s.url}`)
          .join("\n")}`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!upstream.ok || !upstream.body) {
          return new Response("", { status: 200 });
        }

        // Parse upstream SSE, emit plain text chunks to the client.
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const raw of lines) {
                  const line = raw.trim();
                  if (!line.startsWith("data:")) continue;
                  const payload = line.slice(5).trim();
                  if (!payload || payload === "[DONE]") continue;
                  try {
                    const j = JSON.parse(payload) as {
                      choices?: Array<{ delta?: { content?: string } }>;
                    };
                    const delta = j.choices?.[0]?.delta?.content;
                    if (delta) controller.enqueue(encoder.encode(delta));
                  } catch {
                    /* ignore partial */
                  }
                }
              }
            } catch {
              /* ignore */
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
