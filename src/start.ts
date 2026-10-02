import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { getSession } from "./lib/auth";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Attaches the server-signed Crossi session token to every server fn call.
const attachCrossiSession = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const t = getSession()?.session_token;
  return next({ headers: t ? { "x-crossi-session": t } : {} });
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, attachCrossiSession],
  requestMiddleware: [errorMiddleware],
}));
