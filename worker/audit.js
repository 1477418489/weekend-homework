import { nowIso } from "./util.js";

const MAX_DETAIL = 300;
const MAX_TARGET = 120;
const RETENTION_DAYS = 400;

export function clientIp(request) {
  const direct = request?.headers?.get("CF-Connecting-IP");
  if (direct) return direct.slice(0, 60);
  const forwarded = request?.headers?.get("X-Forwarded-For");
  return forwarded ? forwarded.split(",")[0].trim().slice(0, 60) : null;
}

export function actionPrefixes(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[a-z_.]{1,32}$/.test(item))
    .slice(0, 8);
}

const clip = (value, max) => (value === null || value === undefined || value === "" ? null : String(value).slice(0, max));

export async function logAudit(db, { user, action, target = null, weekKey = null, detail = null, request = null }) {
  try {
    await db
      .prepare("INSERT INTO audit_log (at, actor_id, actor_name, actor_role, action, target, week_key, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        nowIso(),
        user?.id ?? null,
        clip(user?.display_name ?? user?.name, 40),
        clip(user?.role, 12),
        action,
        clip(target, MAX_TARGET),
        clip(weekKey, 20),
        clip(detail, MAX_DETAIL),
        clientIp(request)
      )
      .run();
  } catch (error) {
    console.error("audit_log_failed", action, error?.message || String(error));
  }
}

export async function pruneAuditLog(db, days = RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const result = await db.prepare("DELETE FROM audit_log WHERE at < ?").bind(cutoff).run();
  return Number(result?.meta?.changes) || 0;
}

export function mapAuditRow(row) {
  return {
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    action: row.action,
    target: row.target,
    weekKey: row.week_key,
    detail: row.detail,
    ip: row.ip
  };
}
