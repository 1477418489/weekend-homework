import {
  atLeast,
  clearCookie,
  countUsers,
  createSession,
  createUser,
  currentUser,
  destroySession,
  publicUser,
  setPassword,
  sessionCookie,
  verifyCredentials
} from "./auth.js";
import { backupLog, readSettings, runBackup, saveSettings, dumpAll } from "./backup.js";
import {
  SCORE_KEYS,
  SCORE_LABEL,
  SCORE_MAX,
  WEEK_HINT,
  completionRate,
  computeAutoScore,
  isWeekKey,
  normalizeDetail,
  totalOf,
  weekKeyOf,
  weekLabel
} from "./scoring.js";
import { bool, constantTimeEqual, fail, integer, json, nowIso, optionalText, readJson, text } from "./util.js";

const ROUTES = [];
const SETTLE_RATE_KEY = "settle_rate";

function route(method, pattern, minRole, handler) {
  ROUTES.push({ method, pattern, minRole, handler });
}

function pickWeek(url) {
  const value = url.searchParams.get("week");
  return isWeekKey(value) ? value : weekKeyOf();
}

function cookieOptions(request) {
  return { secure: new URL(request.url).protocol === "https:" };
}

async function readOptionalJson(request) {
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const length = Number(request.headers.get("Content-Length") || 0);
  if (!contentType && !length) return { body: {} };
  return readJson(request);
}

function mapTask(row) {
  return {
    id: row.id,
    weekKey: row.week_key,
    title: row.title,
    subject: row.subject,
    estMinutes: row.est_minutes,
    planSlot: row.plan_slot,
    note: row.note,
    status: row.status,
    quality: row.quality,
    actualMinutes: row.actual_minutes,
    sortOrder: row.sort_order,
    sourceOptionId: row.source_option_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    doneBy: row.done_by,
    doneAt: row.done_at,
    doneVia: row.done_via,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at
  };
}

function mapBonus(row) {
  return { id: row.id, kind: row.kind, title: row.title, points: row.points, createdAt: row.created_at };
}

function mapRedemption(row) {
  return {
    id: row.id,
    weekKey: row.week_key,
    title: row.title,
    points: row.points,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    note: row.note
  };
}

function mapOption(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    subject: row.subject,
    estMinutes: row.est_minutes,
    points: row.points,
    sortOrder: row.sort_order,
    weekly: Boolean(row.weekly),
    active: Boolean(row.active)
  };
}

async function loadWeek(env, weekKey) {
  const [tasks, bonusItems, score, redemptions] = await Promise.all([
    env.DB.prepare("SELECT * FROM tasks WHERE week_key = ? ORDER BY sort_order, id").bind(weekKey).all(),
    env.DB.prepare("SELECT * FROM bonus_items WHERE week_key = ? ORDER BY id").bind(weekKey).all(),
    env.DB.prepare("SELECT * FROM week_scores WHERE week_key = ?").bind(weekKey).first(),
    env.DB.prepare("SELECT * FROM redemptions WHERE week_key = ? ORDER BY id DESC").bind(weekKey).all()
  ]);
  return {
    tasks: tasks.results,
    bonusItems: bonusItems.results,
    score,
    redemptions: redemptions.results
  };
}

export async function previousRates(db, weekKey) {
  const rows = await db.prepare("SELECT DISTINCT week_key FROM tasks WHERE week_key < ? ORDER BY week_key DESC LIMIT 2").bind(weekKey).all();
  const rates = [];
  for (const row of rows.results) {
    const tasks = await db.prepare("SELECT status FROM tasks WHERE week_key = ?").bind(row.week_key).all();
    rates.push(completionRate(tasks.results));
  }
  return rates;
}

async function accountOf(db) {
  const [earned, spent, pending] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM week_scores").first(),
    db.prepare("SELECT COALESCE(SUM(points), 0) AS total FROM redemptions WHERE status = 'approved'").first(),
    db.prepare("SELECT COALESCE(SUM(points), 0) AS total FROM redemptions WHERE status = 'pending'").first()
  ]);
  const earnedTotal = Number(earned?.total) || 0;
  const spentTotal = Number(spent?.total) || 0;
  return { earned: earnedTotal, spent: spentTotal, pending: Number(pending?.total) || 0, balance: earnedTotal - spentTotal };
}

async function readSettleRate(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(SETTLE_RATE_KEY).first();
  const rate = Number(row?.value);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 100) : 0;
}

async function weekPayload(env, weekKey) {
  const data = await loadWeek(env, weekKey);
  const [rates, rate] = await Promise.all([previousRates(env.DB, weekKey), readSettleRate(env.DB)]);
  const auto = computeAutoScore({ weekKey, tasks: data.tasks, bonusItems: data.bonusItems, prevRates: rates });
  const confirmed = data.tasks.filter((task) => task.status === "confirmed").length;
  return {
    weekKey,
    label: weekLabel(weekKey),
    isCurrent: weekKey === weekKeyOf(),
    hint: WEEK_HINT,
    rate,
    scoreKeys: SCORE_KEYS.map((key) => ({ key, label: SCORE_LABEL[key], max: SCORE_MAX[key] })),
    tasks: data.tasks.map(mapTask),
    bonusItems: data.bonusItems.map(mapBonus),
    redemptions: data.redemptions.map(mapRedemption),
    score: data.score
      ? { detail: JSON.parse(data.score.detail), total: data.score.total, settledAt: data.score.settled_at, note: data.score.note, rate: data.score.settle_rate ?? null }
      : null,
    auto,
    summary: {
      total: data.tasks.length,
      done: data.tasks.filter((task) => task.status === "done").length,
      confirmed,
      pending: data.tasks.filter((task) => task.status === "pending").length,
      rate: completionRate(data.tasks)
    },
    account: await accountOf(env.DB)
  };
}

route("GET", /^\/api\/status$/, null, async ({ env }) => {
  const total = await countUsers(env.DB);
  return json({
    mode: total > 0 ? "login" : env.SETUP_TOKEN ? "setup" : "closed",
    version: env.APP_VERSION || "dev",
    weekKey: weekKeyOf()
  });
});

route("POST", /^\/api\/setup$/, null, async ({ env, request }) => {
  if (!env.SETUP_TOKEN) return fail("setup_disabled", 503);
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const { setupToken, password } = parsed.body;
  const username = (text(parsed.body.username, 40) || "admin").toLowerCase();
  const displayName = text(parsed.body.displayName, 40) || "管理员";
  if (typeof setupToken !== "string" || !constantTimeEqual(setupToken, env.SETUP_TOKEN)) return fail("invalid_setup_token", 401);
  if (typeof password !== "string" || password.length < 6) return fail("invalid_password", 400);
  if (await countUsers(env.DB)) return fail("already_initialized", 409);
  await createUser(env.DB, { username, displayName, role: "admin", password });
  const user = await verifyCredentials(env.DB, username, password);
  const token = await createSession(env.DB, user.id);
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token, cookieOptions(request)) });
});

route("POST", /^\/api\/login$/, null, async ({ env, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const username = text(parsed.body.username, 40);
  const { password } = parsed.body;
  if (!username || typeof password !== "string") return fail("invalid_credentials", 401);
  const user = await verifyCredentials(env.DB, username.toLowerCase(), password);
  if (!user) return fail("invalid_credentials", 401);
  const token = await createSession(env.DB, user.id);
  return json({ user: publicUser(user), weekKey: weekKeyOf() }, 200, { "Set-Cookie": sessionCookie(token, cookieOptions(request)) });
});

route("POST", /^\/api\/logout$/, "student", async ({ env, request }) => {
  await destroySession(env.DB, request);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(cookieOptions(request)) });
});

route("GET", /^\/api\/me$/, "student", async ({ env, user }) => {
  return json({ user: publicUser(user), weekKey: weekKeyOf(), version: env.APP_VERSION || "dev" });
});

route("GET", /^\/api\/week$/, "student", async ({ env, url }) => {
  return json(await weekPayload(env, pickWeek(url)));
});

route("GET", /^\/api\/account$/, "student", async ({ env }) => {
  const rows = await env.DB.prepare("SELECT week_key, total, settled_at, settle_rate FROM week_scores ORDER BY week_key DESC LIMIT 12").all();
  return json({
    account: await accountOf(env.DB),
    rate: await readSettleRate(env.DB),
    weeks: rows.results.map((row) => ({ weekKey: row.week_key, total: row.total, settledAt: row.settled_at, rate: row.settle_rate ?? null }))
  });
});

route("POST", /^\/api\/tasks$/, "student", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = isWeekKey(body.weekKey) ? body.weekKey : weekKeyOf();
  const title = text(body.title, 120);
  if (!title) return fail("invalid_title", 400);
  const [next, existing] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM tasks WHERE week_key = ?").bind(weekKey).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM tasks WHERE week_key = ?").bind(weekKey).first()
  ]);
  const baseOrder = Number(next?.value) || 1;
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO tasks (week_key, title, subject, est_minutes, plan_slot, note, status, sort_order, source_option_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  )
    .bind(
      weekKey,
      title,
      optionalText(body.subject, 20),
      integer(body.estMinutes, { min: 0, max: 600, fallback: null }),
      optionalText(body.planSlot, 40),
      optionalText(body.note, 500),
      baseOrder,
      integer(body.sourceOptionId, { fallback: null }),
      user.id,
      createdAt
    )
    .run();
  if (!Number(existing?.total)) {
    const fixed = await env.DB.prepare(
      "SELECT id, title, subject, est_minutes FROM options WHERE type = 'homework' AND weekly = 1 AND active = 1 ORDER BY sort_order, id"
    ).all();
    if (fixed.results.length) {
      await env.DB.batch(
        fixed.results.map((option, index) =>
          env.DB.prepare(
            `INSERT INTO tasks (week_key, title, subject, est_minutes, plan_slot, note, status, sort_order, source_option_id, created_by, created_at)
             VALUES (?, ?, ?, ?, NULL, NULL, 'pending', ?, ?, ?, ?)`
          ).bind(weekKey, option.title, option.subject, option.est_minutes, baseOrder + index + 1, option.id, user.id, createdAt)
        )
      );
    }
  }
  if (bool(body.saveAsOption)) await saveOption(env, user, { type: "homework", title, subject: body.subject, estMinutes: body.estMinutes });
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("PATCH", /^\/api\/tasks\/(\d+)$/, "student", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  if (task.status === "confirmed" && !atLeast(user, "parent")) return fail("confirmed_locked", 403);
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const fields = [];
  const values = [];
  const assign = (column, value) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (body.title !== undefined) {
    const title = text(body.title, 120);
    if (!title) return fail("invalid_title", 400);
    assign("title", title);
  }
  if (body.subject !== undefined) assign("subject", optionalText(body.subject, 20));
  if (body.estMinutes !== undefined) assign("est_minutes", integer(body.estMinutes, { min: 0, max: 600, fallback: null }));
  if (body.planSlot !== undefined) assign("plan_slot", optionalText(body.planSlot, 40));
  if (body.note !== undefined) assign("note", optionalText(body.note, 500));
  if (body.quality !== undefined) {
    if (!atLeast(user, "parent")) return fail("forbidden", 403);
    assign("quality", integer(body.quality, { min: 0, max: 4, fallback: null }));
  }
  if (body.actualMinutes !== undefined) assign("actual_minutes", integer(body.actualMinutes, { min: 0, max: 600, fallback: null }));
  if (body.sortOrder !== undefined) assign("sort_order", integer(body.sortOrder, { min: 0, max: 9999, fallback: 0 }));
  if (!fields.length) return fail("nothing_to_update", 400);
  values.push(id);
  await env.DB.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("DELETE", /^\/api\/tasks\/(\d+)$/, "parent", async ({ env, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT week_key FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/done$/, "student", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  if (task.status === "confirmed") return fail("already_confirmed", 409);
  const parsed = await readOptionalJson(request);
  if (parsed.response) return parsed.response;
  const actualMinutes = integer(parsed.body.actualMinutes, { min: 0, max: 600, fallback: task.actual_minutes ?? null });
  await env.DB.prepare("UPDATE tasks SET status = 'done', done_by = ?, done_at = ?, done_via = ?, actual_minutes = ? WHERE id = ?")
    .bind(user.id, nowIso(), atLeast(user, "parent") ? "parent" : "student", actualMinutes, id)
    .run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/confirm$/, "parent", async ({ env, user, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  if (task.status === "pending") return fail("not_done_yet", 409);
  await env.DB.prepare("UPDATE tasks SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?")
    .bind(user.id, nowIso(), id)
    .run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/complete$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  const parsed = await readOptionalJson(request);
  if (parsed.response) return parsed.response;
  const actualMinutes = integer(parsed.body.actualMinutes, { min: 0, max: 600, fallback: task.actual_minutes ?? null });
  const at = nowIso();
  await env.DB.prepare(
    `UPDATE tasks SET status = 'confirmed', done_by = ?, done_at = ?, done_via = 'parent', confirmed_by = ?, confirmed_at = ?, actual_minutes = ? WHERE id = ?`
  )
    .bind(user.id, at, user.id, at, actualMinutes, id)
    .run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/reopen$/, "parent", async ({ env, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  await env.DB.prepare(
    `UPDATE tasks SET status = 'pending', done_by = NULL, done_at = NULL, done_via = NULL, confirmed_by = NULL, confirmed_at = NULL WHERE id = ?`
  )
    .bind(id)
    .run();
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/confirm-done$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const weekKey = isWeekKey(parsed.body.weekKey) ? parsed.body.weekKey : weekKeyOf();
  await env.DB.prepare("UPDATE tasks SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE week_key = ? AND status = 'done'")
    .bind(user.id, nowIso(), weekKey)
    .run();
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

async function saveOption(env, user, body) {
  const title = text(body.title, 120);
  if (!title) return null;
  const type = ["homework", "reward", "bonus", "deduction"].includes(body.type) ? body.type : "homework";
  await env.DB.prepare(
    "INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)"
  )
    .bind(
      type,
      title,
      optionalText(body.subject, 20),
      integer(body.estMinutes, { min: 0, max: 600, fallback: null }),
      integer(body.points, { min: -100, max: 200, fallback: null }),
      integer(body.sortOrder, { min: 0, max: 9999, fallback: 0 }),
      bool(body.weekly) ? 1 : 0,
      user.id,
      nowIso()
    )
    .run();
  return true;
}

export { saveOption };

route("GET", /^\/api\/options$/, "student", async ({ env, url }) => {
  const type = url.searchParams.get("type");
  const includeInactive = url.searchParams.get("all") === "1";
  const rows = includeInactive
    ? await env.DB.prepare("SELECT * FROM options ORDER BY type, sort_order, id").all()
    : await env.DB.prepare("SELECT * FROM options WHERE active = 1 ORDER BY type, sort_order, id").all();
  const list = rows.results.map(mapOption);
  return json({ options: type ? list.filter((item) => item.type === type) : list });
});

route("POST", /^\/api\/options$/, "student", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const created = await saveOption(env, user, parsed.body);
  if (!created) return fail("invalid_title", 400);
  return json({ ok: true });
});

route("PATCH", /^\/api\/options\/(\d+)$/, "parent", async ({ env, request, params }) => {
  const id = Number(params[0]);
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const fields = [];
  const values = [];
  const assign = (column, value) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (body.title !== undefined) {
    const title = text(body.title, 120);
    if (!title) return fail("invalid_title", 400);
    assign("title", title);
  }
  if (body.subject !== undefined) assign("subject", optionalText(body.subject, 20));
  if (body.estMinutes !== undefined) assign("est_minutes", integer(body.estMinutes, { min: 0, max: 600, fallback: null }));
  if (body.points !== undefined) assign("points", integer(body.points, { min: -100, max: 200, fallback: null }));
  if (body.sortOrder !== undefined) assign("sort_order", integer(body.sortOrder, { min: 0, max: 9999, fallback: 0 }));
  if (body.weekly !== undefined) assign("weekly", bool(body.weekly) ? 1 : 0);
  if (body.active !== undefined) assign("active", bool(body.active) ? 1 : 0);
  if (!fields.length) return fail("nothing_to_update", 400);
  values.push(id);
  await env.DB.prepare(`UPDATE options SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return json({ ok: true });
});

route("DELETE", /^\/api\/options\/(\d+)$/, "parent", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM options WHERE id = ?").bind(Number(params[0])).run();
  return json({ ok: true });
});

route("POST", /^\/api\/bonus$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = isWeekKey(body.weekKey) ? body.weekKey : weekKeyOf();
  const kind = body.kind === "deduction" ? "deduction" : "bonus";
  const title = text(body.title, 120);
  const points = integer(body.points, { min: 0, max: 100, fallback: null });
  if (!title || points === null) return fail("invalid_item", 400);
  await env.DB.prepare("INSERT INTO bonus_items (week_key, kind, title, points, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(weekKey, kind, title, points, user.id, nowIso())
    .run();
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("DELETE", /^\/api\/bonus\/(\d+)$/, "parent", async ({ env, params }) => {
  const id = Number(params[0]);
  const item = await env.DB.prepare("SELECT week_key FROM bonus_items WHERE id = ?").bind(id).first();
  if (!item) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM bonus_items WHERE id = ?").bind(id).run();
  return json({ ok: true, week: await weekPayload(env, item.week_key) });
});

route("POST", /^\/api\/settle$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = isWeekKey(body.weekKey) ? body.weekKey : weekKeyOf();
  const data = await loadWeek(env, weekKey);
  const rates = await previousRates(env.DB, weekKey);
  const auto = computeAutoScore({ weekKey, tasks: data.tasks, bonusItems: data.bonusItems, prevRates: rates });
  const detail = normalizeDetail(body.detail, auto);
  detail.auto = auto.auto;
  const total = totalOf(detail);
  const rate = await readSettleRate(env.DB);
  await env.DB.prepare(
    `INSERT INTO week_scores (week_key, detail, total, settled_by, settled_at, note, settle_rate) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_key) DO UPDATE SET detail = excluded.detail, total = excluded.total, settled_by = excluded.settled_by,
       settled_at = excluded.settled_at, note = excluded.note, settle_rate = excluded.settle_rate`
  )
    .bind(weekKey, JSON.stringify(detail), total, user.id, nowIso(), optionalText(body.note, 300), rate)
    .run();
  return json({ ok: true, total, detail, week: await weekPayload(env, weekKey) });
});

route("DELETE", /^\/api\/settle$/, "admin", async ({ env, url }) => {
  const weekKey = pickWeek(url);
  await env.DB.prepare("DELETE FROM week_scores WHERE week_key = ?").bind(weekKey).run();
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("PUT", /^\/api\/rate$/, "parent", async ({ env, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const rate = Number(parsed.body.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return fail("invalid_rate", 400);
  const value = String(Math.round(rate * 10000) / 10000);
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(SETTLE_RATE_KEY, value, nowIso())
    .run();
  return json({ ok: true, rate: Number(value) });
});

route("GET", /^\/api\/redemptions$/, "student", async ({ env, url }) => {
  if (url.searchParams.get("all") === "1") {
    const rows = await env.DB.prepare("SELECT * FROM redemptions ORDER BY id DESC LIMIT 200").all();
    return json({ redemptions: rows.results.map(mapRedemption), account: await accountOf(env.DB) });
  }
  const weekKey = pickWeek(url);
  const rows = await env.DB.prepare("SELECT * FROM redemptions WHERE week_key = ? ORDER BY id DESC").bind(weekKey).all();
  return json({ redemptions: rows.results.map(mapRedemption), account: await accountOf(env.DB) });
});

route("POST", /^\/api\/redemptions$/, "student", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = isWeekKey(body.weekKey) ? body.weekKey : weekKeyOf();
  const title = text(body.title, 120);
  const points = integer(body.points, { min: 1, max: 9999, fallback: null });
  if (!title || points === null) return fail("invalid_item", 400);
  await env.DB.prepare("INSERT INTO redemptions (week_key, title, points, status, requested_by, requested_at, note) VALUES (?, ?, ?, 'pending', ?, ?, ?)")
    .bind(weekKey, title, points, user.id, nowIso(), optionalText(body.note, 200))
    .run();
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("POST", /^\/api\/redemptions\/(\d+)\/decide$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const status = parsed.body.status === "approved" ? "approved" : parsed.body.status === "rejected" ? "rejected" : null;
  if (!status) return fail("invalid_status", 400);
  const row = await env.DB.prepare("SELECT * FROM redemptions WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);
  await env.DB.prepare("UPDATE redemptions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?")
    .bind(status, user.id, nowIso(), id)
    .run();
  return json({ ok: true, week: await weekPayload(env, row.week_key) });
});

route("DELETE", /^\/api\/redemptions\/(\d+)$/, "admin", async ({ env, params }) => {
  const id = Number(params[0]);
  const row = await env.DB.prepare("SELECT week_key FROM redemptions WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM redemptions WHERE id = ?").bind(id).run();
  return json({ ok: true, week: await weekPayload(env, row.week_key) });
});

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at
  };
}

route("GET", /^\/api\/users$/, "admin", async ({ env }) => {
  const rows = await env.DB.prepare("SELECT * FROM users ORDER BY id").all();
  return json({ users: rows.results.map(mapUser) });
});

route("POST", /^\/api\/users$/, "admin", async ({ env, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const username = text(body.username, 40)?.toLowerCase();
  const displayName = text(body.displayName, 40);
  const role = ["admin", "parent", "student"].includes(body.role) ? body.role : "student";
  if (!username || !/^[a-z0-9_.-]{2,40}$/.test(username)) return fail("invalid_username", 400);
  if (!displayName) return fail("invalid_display_name", 400);
  if (typeof body.password !== "string" || body.password.length < 6) return fail("invalid_password", 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return fail("username_taken", 409);
  await createUser(env.DB, { username, displayName, role, password: body.password });
  return json({ ok: true });
});

route("PATCH", /^\/api\/users\/(\d+)$/, "admin", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!target) return fail("not_found", 404);
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;

  const nextRole = ["admin", "parent", "student"].includes(body.role) ? body.role : target.role;
  const nextActive = body.active === undefined ? Boolean(target.active) : bool(body.active);
  if (id === user.id && (!nextActive || nextRole !== "admin")) return fail("cannot_lock_self", 409);
  if (target.role === "admin" && (nextRole !== "admin" || !nextActive)) {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").first();
    if ((Number(admins?.total) || 0) <= 1) return fail("last_admin", 409);
  }

  const fields = [];
  const values = [];
  const assign = (column, value) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (body.displayName !== undefined) {
    const displayName = text(body.displayName, 40);
    if (!displayName) return fail("invalid_display_name", 400);
    assign("display_name", displayName);
  }
  if (body.role !== undefined) assign("role", nextRole);
  if (body.active !== undefined) assign("active", nextActive ? 1 : 0);
  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < 6) return fail("invalid_password", 400);
  }
  if (fields.length) {
    values.push(id);
    await env.DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  }
  if (body.password !== undefined) {
    await setPassword(env.DB, id, body.password);
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
  }
  return json({ ok: true });
});

route("GET", /^\/api\/settings$/, "admin", async ({ env }) => {
  const settings = await readSettings(env.DB);
  return json({
    webdav: {
      url: settings.webdav_url || "",
      username: settings.webdav_username || "",
      path: settings.webdav_path || "weekend-homework",
      keep: Number(settings.webdav_keep) || 14,
      enabled: settings.webdav_enabled === "1",
      hasSavedPassword: Boolean(settings.webdav_password),
      hasEnvPassword: Boolean(env.WEBDAV_PASSWORD)
    },
    log: await backupLog(env.DB, 15)
  });
});

route("PUT", /^\/api\/settings$/, "admin", async ({ env, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const patch = {};
  if (body.url !== undefined) {
    const url = optionalText(body.url, 300);
    if (url && !/^https?:\/\//i.test(url)) return fail("invalid_url", 400);
    patch.webdav_url = url || "";
  }
  if (body.username !== undefined) patch.webdav_username = optionalText(body.username, 120) || "";
  if (body.path !== undefined) patch.webdav_path = (optionalText(body.path, 120) || "weekend-homework").replace(/^\/+|\/+$/g, "");
  if (body.keep !== undefined) patch.webdav_keep = String(integer(body.keep, { min: 1, max: 100, fallback: 14 }));
  if (body.enabled !== undefined) patch.webdav_enabled = bool(body.enabled) ? "1" : "0";
  if (typeof body.password === "string") patch.webdav_password = body.password;
  await saveSettings(env.DB, patch);
  return json({ ok: true });
});

route("POST", /^\/api\/backup\/run$/, "admin", async ({ env }) => {
  return json(await runBackup(env, { trigger: "manual" }));
});

route("GET", /^\/api\/backup\/log$/, "admin", async ({ env, url }) => {
  const limit = integer(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 20 });
  return json({ log: await backupLog(env.DB, limit) });
});

route("GET", /^\/api\/export$/, "admin", async ({ env }) => {
  const payload = JSON.stringify(await dumpAll(env.DB), null, 2);
  return new Response(payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="homework-export-${weekKeyOf()}.json"`,
      "Cache-Control": "no-store"
    }
  });
});

export async function handleApi(request, env) {
  const url = new URL(request.url);
  for (const item of ROUTES) {
    if (item.method !== request.method) continue;
    const matched = item.pattern.exec(url.pathname);
    if (!matched) continue;
    try {
      let user = null;
      if (item.minRole) {
        user = await currentUser(env.DB, request);
        if (!user) return fail("unauthorized", 401);
        if (!atLeast(user, item.minRole)) return fail("forbidden", 403);
      }
      return await item.handler({ request, env, url, user, params: matched.slice(1) });
    } catch (error) {
      console.error("api_error", url.pathname, error?.stack || String(error));
      return fail("server_error", 500);
    }
  }
  return fail("not_found", 404);
}
