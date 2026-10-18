import { handleApi } from "./api.js";
import { cleanupSessions } from "./auth.js";
import { pruneAuditLog } from "./audit.js";
import { runBackup } from "./backup.js";
import { fail } from "./util.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB) return fail("database_not_configured", 503);
      return handleApi(request, env);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupSessions(env.DB));
    ctx.waitUntil(pruneAuditLog(env.DB));
    ctx.waitUntil(runBackup(env, { trigger: "cron" }));
  }
};
