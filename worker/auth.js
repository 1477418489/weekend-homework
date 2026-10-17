import { constantTimeEqual, fromBase64, nowIso, randomToken, toBase64 } from "./util.js";

const PASSWORD_ITERATIONS = 100000;
export const SESSION_COOKIE = "hw_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ROLE_RANK = { student: 1, parent: 2, admin: 3 };
export const ROLE_LABEL = { student: "学生", parent: "家长", admin: "管理员" };

export async function hashPassword(password, saltBytes) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PASSWORD_ITERATIONS },
    material,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export async function createUser(db, { username, displayName, role, password }) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toBase64(saltBytes);
  const passwordHash = await hashPassword(password, saltBytes);
  await db
    .prepare("INSERT INTO users (username, display_name, role, salt, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .bind(username, displayName, role, salt, passwordHash, nowIso())
    .run();
}

export async function setPassword(db, userId, password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  await db
    .prepare("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?")
    .bind(toBase64(saltBytes), await hashPassword(password, saltBytes), userId)
    .run();
}

export async function countUsers(db) {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM users").first();
  return Number(row?.total) || 0;
}

export async function verifyCredentials(db, username, password) {
  const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!user || !user.active) return null;
  const expected = await hashPassword(password, fromBase64(user.salt));
  return constantTimeEqual(expected, user.password_hash) ? user : null;
}

export async function createSession(db, userId) {
  const token = randomToken(32);
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString())
    .run();
  return token;
}

export function sessionCookie(token, { secure = true } = {}) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie({ secure = true } = {}) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function currentUser(db, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT users.*, sessions.expires_at AS session_expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .bind(token)
    .first();
  if (!row || !row.active) return null;
  if (Date.parse(row.session_expires_at) < Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

export async function destroySession(db, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export async function cleanupSessions(db) {
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()).run();
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    roleLabel: ROLE_LABEL[user.role] || user.role
  };
}

export function atLeast(user, role) {
  return (ROLE_RANK[user?.role] || 0) >= ROLE_RANK[role];
}
