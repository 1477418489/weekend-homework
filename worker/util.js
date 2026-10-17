export const encoder = new TextEncoder();
export const MAX_BODY_BYTES = 262144;

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function fail(error, status = 400, detail) {
  return json(detail === undefined ? { error } : { error, detail }, status);
}

export function toBase64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function constantTimeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

export async function readJson(request) {
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return { response: fail("invalid_request", 415) };
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return { response: fail("invalid_origin", 403) };
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return { response: fail("payload_too_large", 413) };
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { response: fail("payload_too_large", 413) };
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) return { response: fail("invalid_request", 400) };
    return { body };
  } catch {
    return { response: fail("invalid_request", 400) };
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function text(value, maxLength = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function optionalText(value, maxLength = 500) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function integer(value, { min = 0, max = 100000, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  return value === 1 || value === "1" || value === "true";
}
