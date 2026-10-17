import { nowIso } from "./util.js";

const BACKUP_PREFIX = "homework-";
const SETTING_KEYS = [
  "webdav_url",
  "webdav_username",
  "webdav_password",
  "webdav_path",
  "webdav_keep",
  "webdav_enabled"
];
const DUMP_TABLES = ["users", "options", "tasks", "bonus_items", "week_scores", "redemptions", "settings"];

export async function readSettings(db) {
  const rows = await db.prepare("SELECT key, value FROM settings").all();
  const map = {};
  for (const row of rows.results) map[row.key] = row.value;
  return map;
}

export async function saveSettings(db, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(key)) continue;
    await db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(key, value ?? "", nowIso())
      .run();
  }
}

export async function dumpAll(db) {
  const tables = {};
  for (const table of DUMP_TABLES) {
    const rows = await db.prepare(`SELECT * FROM ${table}`).all();
    tables[table] = rows.results;
  }
  return {
    format: "weekend-homework-backup",
    version: 1,
    exportedAt: nowIso(),
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    tables
  };
}

export async function backupLog(db, limit = 20) {
  const rows = await db.prepare("SELECT * FROM backup_log ORDER BY id DESC LIMIT ?").bind(limit).all();
  return rows.results.map((row) => ({
    id: row.id,
    at: row.at,
    ok: Boolean(row.ok),
    message: row.message,
    filename: row.filename,
    bytes: row.bytes
  }));
}

async function writeLog(db, { ok, message, filename = null, bytes = null }) {
  await db
    .prepare("INSERT INTO backup_log (at, ok, message, filename, bytes) VALUES (?, ?, ?, ?, ?)")
    .bind(nowIso(), ok ? 1 : 0, message, filename, bytes)
    .run();
  await db.prepare("DELETE FROM backup_log WHERE id NOT IN (SELECT id FROM backup_log ORDER BY id DESC LIMIT 200)").run();
}

function beijingStamp(ms = Date.now()) {
  const date = new Date(ms + 8 * 60 * 60 * 1000);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(
    date.getUTCMinutes()
  )}${pad(date.getUTCSeconds())}`;
}

function authHeaders(username, password) {
  if (!username) return {};
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
}

async function davFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new Error(`无法连接 WebDAV（${String(error?.message || error)}）`);
  }
}

async function ensureDirectory(dirUrl, headers) {
  const target = new URL(dirUrl);
  const segments = target.pathname.split("/").filter(Boolean);
  let path = "";
  for (const segment of segments) {
    path += `/${segment}`;
    const response = await davFetch(`${target.origin}${path}`, { method: "MKCOL", headers });
    if (response.status >= 400 && response.status !== 405 && response.status !== 301) {
      throw new Error(`创建目录失败（HTTP ${response.status}）`);
    }
  }
}

async function pruneOldBackups(dirUrl, headers, keep) {
  const response = await davFetch(dirUrl, {
    method: "PROPFIND",
    headers: { ...headers, Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
    body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>'
  });
  if (response.status >= 400) return 0;
  const xml = await response.text();
  const pattern = new RegExp(`${BACKUP_PREFIX}\\d{8}-\\d{6}\\.json$`);
  const files = [...xml.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*>/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"))
    .filter((href) => pattern.test(decodeURIComponent(href)))
    .sort();
  const stale = files.slice(0, Math.max(0, files.length - keep));
  let removed = 0;
  for (const href of stale) {
    const url = /^https?:\/\//i.test(href) ? href : new URL(href, dirUrl).toString();
    const deleted = await davFetch(url, { method: "DELETE", headers });
    if (deleted.ok || deleted.status === 204) removed += 1;
  }
  return removed;
}

export async function runBackup(env, { trigger = "cron" } = {}) {
  const settings = await readSettings(env.DB);
  const url = (settings.webdav_url || "").trim();
  const enabled = settings.webdav_enabled === "1";

  if (!url) {
    if (trigger === "cron") return { ok: false, skipped: true, message: "未配置 WebDAV 地址" };
    const message = "未配置 WebDAV 地址，请先在设置中填写";
    await writeLog(env.DB, { ok: false, message });
    return { ok: false, message };
  }
  if (trigger === "cron" && !enabled) return { ok: false, skipped: true, message: "定时备份已关闭" };

  const password = env.WEBDAV_PASSWORD || settings.webdav_password || "";
  const headers = authHeaders(settings.webdav_username || "", password);
  const folder = (settings.webdav_path || "weekend-homework").replace(/^\/+|\/+$/g, "");
  const dirUrl = `${url.replace(/\/+$/, "")}/${folder.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const filename = `${BACKUP_PREFIX}${beijingStamp()}.json`;
  const fileUrl = `${dirUrl}/${filename}`;

  try {
    await ensureDirectory(dirUrl, headers);
    const payload = JSON.stringify(await dumpAll(env.DB), null, 1);
    const uploaded = await davFetch(fileUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      body: payload
    });
    if (!uploaded.ok) throw new Error(`上传失败（HTTP ${uploaded.status} ${uploaded.statusText}）`);
    const keep = Math.max(1, Math.min(100, Number(settings.webdav_keep) || 14));
    let removed = 0;
    try {
      removed = await pruneOldBackups(dirUrl, headers, keep);
    } catch {
      removed = 0;
    }
    const message = `备份成功${removed ? `，清理 ${removed} 个旧文件` : ""}`;
    await writeLog(env.DB, { ok: true, message, filename, bytes: payload.length });
    return { ok: true, message, filename, bytes: payload.length, removed };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    await writeLog(env.DB, { ok: false, message, filename });
    return { ok: false, message, filename };
  }
}
