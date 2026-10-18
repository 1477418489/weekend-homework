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

// 首页里这些引用会被重写成 ?v=<APP_VERSION>，配合长缓存跳过弱网下每次打开都要往复校验的往返。
const VERSIONED_ASSETS = ["/style.css", "/app.js"];
const LONG_CACHE = "public, max-age=604800, immutable";

export function assetCacheControl(url, version) {
  const requested = url.searchParams.get("v");
  return requested && requested === version ? LONG_CACHE : null;
}

export function injectAssetVersions(html, version) {
  if (!version) return html;
  const suffix = `?v=${encodeURIComponent(version)}`;
  return VERSIONED_ASSETS.reduce((result, path) => result.replaceAll(`"${path}"`, `"${path}${suffix}"`), html);
}

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
    const cacheControl = assetCacheControl(url, env.APP_VERSION);
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    if ((response.headers.get("Content-Type") ?? "").includes("text/html")) {
      const html = await response.text();
      return new Response(injectAssetVersions(html, env.APP_VERSION), { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupSessions(env.DB));
    ctx.waitUntil(pruneAuditLog(env.DB));
    ctx.waitUntil(runBackup(env, { trigger: "cron" }));
  }
};