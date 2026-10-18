import {
  atLeast,
  clearCookie,
  countUsers,
  createSession,
  createUser,
  currentUser,
  ROLE_LABEL,
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
  canonicalWeekKey,
  completionRate,
  computeAutoScore,
  normalizeDetail,
  resolveWeekDeadlines,
  scheduleHint,
  scheduleLabel,
  shiftWeek,
  totalOf,
  weekStartMs,
  weekKeyOf,
  weekLabel
} from "./scoring.js";
import { beijingYear, deriveScheduleFromRange, holidayScheduleForWeek, loadHolidayPeriods } from "./holidays.js";
import { bool, constantTimeEqual, fail, integer, json, nowIso, optionalText, readJson, text } from "./util.js";
import { actionPrefixes, logAudit, mapAuditRow } from "./audit.js";

const ROUTES = [];
const SETTLE_RATE_KEY = "settle_rate";
const TASK_FIELD_LABEL = {
  title: "标题",
  subject: "科目",
  est_minutes: "预估分钟",
  plan_slot: "计划时段",
  note: "备注",
  quality: "质量分",
  actual_minutes: "实际分钟",
  sort_order: "顺序"
};
const OPTION_FIELD_LABEL = {
  title: "名称",
  subject: "科目",
  est_minutes: "预估分钟",
  points: "积分",
  sort_order: "顺序",
  weekly: "每周固定",
  active: "启用",
  description: "备注"
};
const OPTION_TYPE_LABEL = { homework: "常用作业", reward: "奖励", bonus: "加分项", deduction: "扣分项" };
const SETTING_FIELD_LABEL = {
  webdav_url: "地址",
  webdav_username: "用户名",
  webdav_path: "目录",
  webdav_keep: "保留份数",
  webdav_enabled: "启用状态",
  webdav_password: "密码"
};
const fieldList = (fields, labels) => fields.map((item) => labels[item.replace(" = ?", "")] || item.replace(" = ?", "")).join(", ");

function route(method, pattern, minRole, handler) {
  ROUTES.push({ method, pattern, minRole, handler });
}

function pickWeek(url) {
  return canonicalWeekKey(url.searchParams.get("week")) || weekKeyOf();
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

const SCHEDULE_COLUMNS = {
  fridayChecklist: "checklist_at",
  saturdayEarly: "early_at",
  saturdayMid: "mid_at",
  saturdayHard: "hard_at",
  weekEnd: "week_end"
};
const SCHEDULE_LIMIT_MS = 60 * 24 * 60 * 60 * 1000;

function mapSchedule(row) {
  if (!row) return null;
  const schedule = {};
  for (const [key, column] of Object.entries(SCHEDULE_COLUMNS)) {
    const value = row[column];
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) schedule[key] = ms;
  }
  schedule.rangeStart = row.range_start || null;
  schedule.rangeEnd = row.range_end || null;
  schedule.note = row.note || null;
  return schedule;
}

async function loadSchedule(db, weekKey) {
  const row = await db.prepare("SELECT * FROM week_schedules WHERE week_key = ?").bind(weekKey).first();
  return mapSchedule(row);
}

function rangeMs(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return null;
  const start = Date.parse(`${rangeStart}T00:00:00.000+08:00`);
  const end = Date.parse(`${rangeEnd}T00:00:00.000+08:00`);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

// 大多数周只需要查当年的数据，只有周五~周日正好压着元旦才多看一年。
// cache 在一次请求内复用，避免一周查两遍。
async function holidayPeriodsForWeek(db, weekKey, cache = new Map()) {
  const start = weekStartMs(weekKey);
  const windowEnd = start + 3 * 24 * 60 * 60 * 1000;
  const years = new Set([beijingYear(start)]);
  if (beijingYear(windowEnd) !== beijingYear(start)) years.add(beijingYear(windowEnd));
  const lists = await Promise.all(
    [...years].map(async (year) => {
      if (!cache.has(year)) cache.set(year, await loadHolidayPeriods(db, year));
      return cache.get(year);
    })
  );
  return lists.filter(Boolean).flat();
}

// 一周的生效时间，优先级：家长手工设置 > 放假区间推算 > 默认周五到周日。
// 放假区间可能是家长填的，也可能是节假日接口自动给的，推算规则在 holidays.js。
async function weekPlan(db, weekKey, holidayCache = new Map()) {
  const [row, periods] = await Promise.all([loadSchedule(db, weekKey), holidayPeriodsForWeek(db, weekKey, holidayCache)]);
  const holiday = holidayScheduleForWeek(weekKey, periods);
  const manualRange = rangeMs(row?.rangeStart, row?.rangeEnd);
  const effectiveRange = manualRange || (holiday ? rangeMs(holiday.rangeStart, holiday.rangeEnd) : null);
  const derived = effectiveRange ? deriveScheduleFromRange(weekKey, effectiveRange.start, effectiveRange.end) : null;
  const overrides = {};
  if (row) {
    for (const key of Object.keys(SCHEDULE_COLUMNS)) {
      if (Number.isFinite(Number(row[key]))) overrides[key] = Number(row[key]);
    }
  }
  const custom = Boolean(row && (row.rangeStart || row.rangeEnd || Object.keys(overrides).length));
  return {
    deadlines: resolveWeekDeadlines(weekKey, { ...(derived || {}), ...overrides }),
    rangeStart: manualRange ? row.rangeStart : holiday?.rangeStart || null,
    rangeEnd: manualRange ? row.rangeEnd : holiday?.rangeEnd || null,
    holiday: holiday ? { name: holiday.name, start: holiday.rangeStart, end: holiday.rangeEnd } : null,
    note: row?.note || null,
    custom,
    source: custom ? "manual" : holiday ? "auto" : "default"
  };
}

// 这一周的收工时间不能拖进下一周新开始的假期；同一个长假（放假开始日期相同）不缩。
async function weekPlanForResponse(db, weekKey) {
  const holidayCache = new Map();
  const [plan, next] = await Promise.all([weekPlan(db, weekKey, holidayCache), weekPlan(db, shiftWeek(weekKey, 1), holidayCache)]);
  const nextStart = next.rangeStart ? Date.parse(`${next.rangeStart}T00:00:00.000+08:00`) : NaN;
  const sameRange = Boolean(plan.rangeStart) && next.rangeStart === plan.rangeStart;
  if (Number.isFinite(nextStart) && !sameRange && nextStart < plan.deadlines.weekEnd) plan.deadlines.weekEnd = nextStart;
  return plan;
}

function schedulePayload(plan) {
  return {
    source: plan.source,
    custom: plan.custom,
    rangeStart: plan.rangeStart,
    rangeEnd: plan.rangeEnd,
    holiday: plan.holiday,
    note: plan.note,
    deadlines: {
      fridayChecklist: plan.deadlines.fridayChecklist,
      saturdayEarly: plan.deadlines.saturdayEarly,
      saturdayMid: plan.deadlines.saturdayMid,
      saturdayHard: plan.deadlines.saturdayHard,
      weekEnd: plan.deadlines.weekEnd
    }
  };
}

function timestampMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
}

function isoSecond(ms) {
  return new Date(Math.round(ms / 1000) * 1000).toISOString();
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

// 连续达标周数：从最近一周往前数，完成率 ≥ 90% 算达标，放假没留作业的空周不断档。
async function streakOf(db, weekKey) {
  const rows = await db
    .prepare("SELECT week_key, COUNT(*) AS total, SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed FROM tasks WHERE week_key < ? GROUP BY week_key ORDER BY week_key DESC LIMIT 24")
    .bind(weekKey)
    .all();
  let streak = 0;
  for (const row of rows.results) {
    const total = Number(row.total) || 0;
    if (!total) continue;
    if ((Number(row.confirmed) || 0) / total >= 0.9) streak += 1;
    else break;
  }
  return streak;
}

async function readSettleRate(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(SETTLE_RATE_KEY).first();
  const rate = Number(row?.value);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 100) : 0;
}

async function weekPayload(env, weekKey) {
  const data = await loadWeek(env, weekKey);
  const [rates, rate, plan] = await Promise.all([
    previousRates(env.DB, weekKey),
    readSettleRate(env.DB),
    weekPlanForResponse(env.DB, weekKey)
  ]);
  const auto = computeAutoScore({ weekKey, tasks: data.tasks, bonusItems: data.bonusItems, prevRates: rates, deadlines: plan.deadlines });
  const confirmed = data.tasks.filter((task) => task.status === "confirmed").length;
  return {
    weekKey,
    label: scheduleLabel(weekKey, { rangeStart: plan.rangeStart, rangeEnd: plan.rangeEnd }),
    isCurrent: weekKey === weekKeyOf(),
    hint: scheduleHint(plan.deadlines),
    schedule: schedulePayload(plan),
    rate,
    scoreKeys: SCORE_KEYS.map((key) => ({ key, label: SCORE_LABEL[key], max: SCORE_MAX[key] })),
    tasks: data.tasks.map(mapTask),
    bonusItems: data.bonusItems.map(mapBonus),
    redemptions: data.redemptions.map(mapRedemption),
    score: data.score
      ? { detail: JSON.parse(data.score.detail), total: data.score.total, settledAt: data.score.settled_at, note: data.score.note, rate: data.score.settle_rate ?? null }
      : null,
    auto,
    streak: await streakOf(env.DB, weekKey),
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
  await logAudit(env.DB, { user, action: "setup.init", target: `@${username}`, detail: `初始化管理员 ${displayName}`, request });
  return json({ user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token, cookieOptions(request)) });
});

route("POST", /^\/api\/login$/, null, async ({ env, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const username = text(parsed.body.username, 40);
  const { password } = parsed.body;
  if (!username || typeof password !== "string") return fail("invalid_credentials", 401);
  const user = await verifyCredentials(env.DB, username.toLowerCase(), password);
  if (!user) {
    // 只记真实账号的失败尝试，避免陌生用户名把日志刷爆。
    const known = await env.DB.prepare("SELECT id, display_name, role FROM users WHERE username = ?").bind(username.toLowerCase()).first();
    if (known) await logAudit(env.DB, { user: known, action: "auth.login_failed", target: `@${known.display_name}`, detail: "密码不对", request });
    return fail("invalid_credentials", 401);
  }
  await logAudit(env.DB, { user, action: "auth.login", request });
  const token = await createSession(env.DB, user.id);
  return json({ user: publicUser(user), weekKey: weekKeyOf() }, 200, { "Set-Cookie": sessionCookie(token, cookieOptions(request)) });
});

route("POST", /^\/api\/logout$/, "student", async ({ env, user, request }) => {
  await destroySession(env.DB, request);
  await logAudit(env.DB, { user, action: "auth.logout", request });
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
  const weekKey = canonicalWeekKey(body.weekKey) || weekKeyOf();
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
  await logAudit(env.DB, { user, action: "task.add", target: title, weekKey, detail: [title, optionalText(body.subject, 20)].filter(Boolean).join(" · "), request });
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
  await logAudit(env.DB, { user, action: "task.update", target: task.title, weekKey: task.week_key, detail: fieldList(fields, TASK_FIELD_LABEL), request });
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("DELETE", /^\/api\/tasks\/(\d+)$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  await logAudit(env.DB, { user, action: "task.delete", target: task.title, weekKey: task.week_key, request });
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
  const doneVia = atLeast(user, "parent") ? "parent" : "student";
  await env.DB.prepare("UPDATE tasks SET status = 'done', done_by = ?, done_at = ?, done_via = ?, actual_minutes = ? WHERE id = ?")
    .bind(user.id, nowIso(), doneVia, actualMinutes, id)
    .run();
  await logAudit(env.DB, { user, action: "task.done", target: task.title, weekKey: task.week_key, detail: `${doneVia === "parent" ? "家长代办" : "学生打卡"}${actualMinutes === null ? "" : ` · 实际 ${actualMinutes} 分钟`}`, request });
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/confirm$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  if (task.status === "pending") return fail("not_done_yet", 409);
  await env.DB.prepare("UPDATE tasks SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?")
    .bind(user.id, nowIso(), id)
    .run();
  await logAudit(env.DB, { user, action: "task.confirm", target: task.title, weekKey: task.week_key, request });
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
  await logAudit(env.DB, { user, action: "task.complete", target: task.title, weekKey: task.week_key, request });
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/(\d+)\/reopen$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return fail("not_found", 404);
  await env.DB.prepare(
    `UPDATE tasks SET status = 'pending', done_by = NULL, done_at = NULL, done_via = NULL, confirmed_by = NULL, confirmed_at = NULL WHERE id = ?`
  )
    .bind(id)
    .run();
  await logAudit(env.DB, { user, action: "task.reopen", target: task.title, weekKey: task.week_key, detail: task.status === "confirmed" ? "撤销确认" : "撤销完成", request });
  return json({ ok: true, week: await weekPayload(env, task.week_key) });
});

route("POST", /^\/api\/tasks\/confirm-done$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const weekKey = canonicalWeekKey(parsed.body.weekKey) || weekKeyOf();
  const result = await env.DB.prepare("UPDATE tasks SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE week_key = ? AND status = 'done'")
    .bind(user.id, nowIso(), weekKey)
    .run();
  await logAudit(env.DB, { user, action: "task.confirm_all", weekKey, detail: `一键确认 ${Number(result?.meta?.changes) || 0} 条`, request });
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
  await logAudit(env.DB, { user, action: "option.add", target: title, detail: OPTION_TYPE_LABEL[type] });
  return true;
}

export { saveOption, streakOf };

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

route("PATCH", /^\/api\/options\/(\d+)$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const option = await env.DB.prepare("SELECT title, type FROM options WHERE id = ?").bind(id).first();
  if (!option) return fail("not_found", 404);
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
  await logAudit(env.DB, { user, action: "option.update", target: option.title, detail: `${OPTION_TYPE_LABEL[option.type] || option.type} · ${fieldList(fields, OPTION_FIELD_LABEL)}`, request });
  return json({ ok: true });
});

route("DELETE", /^\/api\/options\/(\d+)$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const option = await env.DB.prepare("SELECT title, type FROM options WHERE id = ?").bind(id).first();
  if (!option) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM options WHERE id = ?").bind(id).run();
  await logAudit(env.DB, { user, action: "option.delete", target: option.title, detail: OPTION_TYPE_LABEL[option.type] || option.type, request });
  return json({ ok: true });
});

route("POST", /^\/api\/bonus$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = canonicalWeekKey(body.weekKey) || weekKeyOf();
  const kind = body.kind === "deduction" ? "deduction" : "bonus";
  const title = text(body.title, 120);
  const points = integer(body.points, { min: 0, max: 100, fallback: null });
  if (!title || points === null) return fail("invalid_item", 400);
  await env.DB.prepare("INSERT INTO bonus_items (week_key, kind, title, points, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(weekKey, kind, title, points, user.id, nowIso())
    .run();
  await logAudit(env.DB, { user, action: "bonus.add", target: title, weekKey, detail: `${kind === "bonus" ? "加分" : "扣分"} ${points} 分`, request });
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("DELETE", /^\/api\/bonus\/(\d+)$/, "parent", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const item = await env.DB.prepare("SELECT * FROM bonus_items WHERE id = ?").bind(id).first();
  if (!item) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM bonus_items WHERE id = ?").bind(id).run();
  await logAudit(env.DB, { user, action: "bonus.delete", target: item.title, weekKey: item.week_key, detail: `${item.kind === "bonus" ? "加分" : "扣分"} ${item.points} 分`, request });
  return json({ ok: true, week: await weekPayload(env, item.week_key) });
});

route("POST", /^\/api\/settle$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = canonicalWeekKey(body.weekKey) || weekKeyOf();
  const data = await loadWeek(env, weekKey);
  const rates = await previousRates(env.DB, weekKey);
  const plan = await weekPlanForResponse(env.DB, weekKey);
  const auto = computeAutoScore({ weekKey, tasks: data.tasks, bonusItems: data.bonusItems, prevRates: rates, deadlines: plan.deadlines });
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
  await logAudit(env.DB, { user, action: "settle.save", weekKey, detail: `本周总分 ${total}`, request });
  return json({ ok: true, total, detail, week: await weekPayload(env, weekKey) });
});

route("DELETE", /^\/api\/settle$/, "admin", async ({ env, user, request, url }) => {
  const weekKey = pickWeek(url);
  await env.DB.prepare("DELETE FROM week_scores WHERE week_key = ?").bind(weekKey).run();
  await logAudit(env.DB, { user, action: "settle.clear", weekKey, request });
  return json({ ok: true, week: await weekPayload(env, weekKey) });
});

route("PUT", /^\/api\/rate$/, "parent", async ({ env, user, request }) => {
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
  await logAudit(env.DB, { user, action: "rate.save", detail: rate > 0 ? `1 积分 = ${value} 元` : "关闭折现", request });
  return json({ ok: true, rate: Number(value) });
});

route("GET", /^\/api\/schedule$/, "student", async ({ env, url }) => {
  const weekKey = pickWeek(url);
  const plan = await weekPlanForResponse(env.DB, weekKey);
  return json({
    weekKey,
    label: scheduleLabel(weekKey, { rangeStart: plan.rangeStart, rangeEnd: plan.rangeEnd }),
    hint: scheduleHint(plan.deadlines),
    schedule: schedulePayload(plan)
  });
});

route("PUT", /^\/api\/schedule$/, "parent", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const weekKey = canonicalWeekKey(body.weekKey) || weekKeyOf();
  const anchor = weekStartMs(weekKey);

  // 空值 = 用默认时间；给了值就必须是合法时间，并且落在这一周前后一个月内，避免手滑写成别的年份。
  const readTime = (value, label) => {
    if (value === undefined || value === null || value === "") return { value: null };
    const ms = timestampMs(value);
    if (ms === null) return { error: `invalid_${label}` };
    if (Math.abs(ms - anchor) > SCHEDULE_LIMIT_MS) return { error: `invalid_${label}` };
    return { value: ms };
  };

  const checklist = readTime(body.fridayChecklist, "checklist");
  const early = readTime(body.saturdayEarly, "early");
  const mid = readTime(body.saturdayMid, "mid");
  const hard = readTime(body.saturdayHard, "hard");
  const weekEndOverride = readTime(body.weekEnd, "week_end");
  const error = [checklist, early, mid, hard, weekEndOverride].find((item) => item.error);
  if (error) return fail(error.error, 400);

  const weekEnd = weekEndOverride.value ?? anchor + 3 * 24 * 60 * 60 * 1000;
  const ordered = [checklist.value, early.value, mid.value, hard.value].filter((value) => value !== null);
  for (const value of ordered) {
    if (value > weekEnd) return fail("invalid_schedule_order", 400);
  }
  const strict = [checklist.value, early.value, mid.value].filter((value) => value !== null);
  for (let index = 1; index < strict.length; index += 1) {
    if (strict[index] < strict[index - 1]) return fail("invalid_schedule_order", 400);
  }
  if (hard.value !== null && early.value !== null && hard.value < early.value) return fail("invalid_schedule_order", 400);

  const isWeekKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000+08:00`));
  const rangeStart = isWeekKey(body.rangeStart) ? body.rangeStart : null;
  const rangeEnd = isWeekKey(body.rangeEnd) ? body.rangeEnd : null;
  if ((rangeStart && !rangeEnd) || (!rangeStart && rangeEnd)) return fail("invalid_range", 400);
  if (rangeStart && rangeEnd && Date.parse(`${rangeEnd}T00:00:00.000+08:00`) < Date.parse(`${rangeStart}T00:00:00.000+08:00`)) {
    return fail("invalid_range", 400);
  }
  if ((rangeStart && Math.abs(Date.parse(`${rangeStart}T00:00:00.000+08:00`) - anchor) > SCHEDULE_LIMIT_MS) ||
      (rangeEnd && Math.abs(Date.parse(`${rangeEnd}T00:00:00.000+08:00`) - anchor) > SCHEDULE_LIMIT_MS)) {
    return fail("invalid_range", 400);
  }

  const note = optionalText(body.note, 60);
  const hasCustom = Boolean(rangeStart || note || checklist.value !== null || early.value !== null || mid.value !== null || hard.value !== null || weekEndOverride.value !== null);
  if (!hasCustom) {
    await env.DB.prepare("DELETE FROM week_schedules WHERE week_key = ?").bind(weekKey).run();
    await logAudit(env.DB, { user, action: "schedule.clear", weekKey, detail: "回到默认 / 自动时间", request });
    const plan = await weekPlanForResponse(env.DB, weekKey);
    return json({
      ok: true,
      weekKey,
      label: scheduleLabel(weekKey, { rangeStart: plan.rangeStart, rangeEnd: plan.rangeEnd }),
      hint: scheduleHint(plan.deadlines),
      schedule: schedulePayload(plan)
    });
  }

  await env.DB.prepare(
    `INSERT INTO week_schedules (week_key, checklist_at, early_at, mid_at, hard_at, week_end, range_start, range_end, note, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_key) DO UPDATE SET
       checklist_at = excluded.checklist_at,
       early_at = excluded.early_at,
       mid_at = excluded.mid_at,
       hard_at = excluded.hard_at,
       week_end = excluded.week_end,
       range_start = excluded.range_start,
       range_end = excluded.range_end,
       note = excluded.note,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  )
    .bind(
      weekKey,
      checklist.value === null ? null : isoSecond(checklist.value),
      early.value === null ? null : isoSecond(early.value),
      mid.value === null ? null : isoSecond(mid.value),
      hard.value === null ? null : isoSecond(hard.value),
      weekEndOverride.value === null ? null : isoSecond(weekEndOverride.value),
      rangeStart,
      rangeEnd,
      note,
      user.id,
      nowIso()
    )
    .run();
  await logAudit(env.DB, { user, action: "schedule.save", weekKey, detail: `${rangeStart ? `放假 ${rangeStart} ~ ${rangeEnd}` : "自定义时间"}${note ? ` · ${note}` : ""}`, request });
  const plan = await weekPlanForResponse(env.DB, weekKey);
  return json({
    ok: true,
    weekKey,
    label: scheduleLabel(weekKey, { rangeStart: plan.rangeStart, rangeEnd: plan.rangeEnd }),
    hint: scheduleHint(plan.deadlines),
    schedule: schedulePayload(plan)
  });
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
  const weekKey = canonicalWeekKey(body.weekKey) || weekKeyOf();
  const title = text(body.title, 120);
  const points = integer(body.points, { min: 1, max: 9999, fallback: null });
  if (!title || points === null) return fail("invalid_item", 400);
  await env.DB.prepare("INSERT INTO redemptions (week_key, title, points, status, requested_by, requested_at, note) VALUES (?, ?, ?, 'pending', ?, ?, ?)")
    .bind(weekKey, title, points, user.id, nowIso(), optionalText(body.note, 200))
    .run();
  await logAudit(env.DB, { user, action: "redemption.request", target: title, weekKey, detail: `申请 ${points} 分`, request });
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
  if (status === "approved" && row.status !== "approved" && !bool(parsed.body.allowNegative)) {
    const account = await accountOf(env.DB);
    if (account.balance < row.points) {
      return fail("insufficient_points", 409, { missing: row.points - account.balance, balance: account.balance, points: row.points });
    }
  }
  await env.DB.prepare("UPDATE redemptions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?")
    .bind(status, user.id, nowIso(), id)
    .run();
  await logAudit(env.DB, { user, action: "redemption.decide", target: row.title, weekKey: row.week_key, detail: `${status === "approved" ? "批准" : "驳回"} ${row.points} 分`, request });
  return json({ ok: true, week: await weekPayload(env, row.week_key) });
});

route("DELETE", /^\/api\/redemptions\/(\d+)$/, "admin", async ({ env, user, request, params }) => {
  const id = Number(params[0]);
  const row = await env.DB.prepare("SELECT * FROM redemptions WHERE id = ?").bind(id).first();
  if (!row) return fail("not_found", 404);
  await env.DB.prepare("DELETE FROM redemptions WHERE id = ?").bind(id).run();
  await logAudit(env.DB, { user, action: "redemption.delete", target: row.title, weekKey: row.week_key, request });
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

route("POST", /^\/api\/users$/, "admin", async ({ env, user, request }) => {
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
  await logAudit(env.DB, { user, action: "user.add", target: `@${username}`, detail: `${displayName} · ${ROLE_LABEL[role]}`, request });
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
  await logAudit(env.DB, {
    user,
    action: "user.update",
    target: `@${target.username}`,
    detail: [
      body.displayName !== undefined ? `改名叫 ${text(body.displayName, 40)}` : "",
      body.role !== undefined && nextRole !== target.role ? `角色 → ${ROLE_LABEL[nextRole]}` : "",
      body.active !== undefined && nextActive !== Boolean(target.active) ? (nextActive ? "启用" : "停用") : "",
      body.password !== undefined ? "重置密码" : ""
    ].filter(Boolean).join(" · "),
    request
  });
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

route("PUT", /^\/api\/settings$/, "admin", async ({ env, user, request }) => {
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
  await logAudit(env.DB, { user, action: "settings.save", detail: Object.keys(patch).map((key) => SETTING_FIELD_LABEL[key] || key).join(", "), request });
  return json({ ok: true });
});

route("POST", /^\/api\/backup\/run$/, "admin", async ({ env, user, request }) => {
  const result = await runBackup(env, { trigger: "manual" });
  await logAudit(env.DB, { user, action: "backup.run", detail: `${result?.ok ? "成功" : "失败"}${result?.message ? ` · ${result.message}` : ""}`, request });
  return json(result);
});

route("POST", /^\/api\/reset$/, "admin", async ({ env, user, request }) => {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  if (parsed.body.confirm !== "初始化") return fail("invalid_confirm", 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tasks"),
    env.DB.prepare("DELETE FROM bonus_items"),
    env.DB.prepare("DELETE FROM week_scores"),
    env.DB.prepare("DELETE FROM redemptions")
  ]);
  await logAudit(env.DB, { user, action: "reset.all", detail: "清空作业与分数", request });
  return json({ ok: true });
});

route("GET", /^\/api\/backup\/log$/, "admin", async ({ env, url }) => {
  const limit = integer(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 20 });
  return json({ log: await backupLog(env.DB, limit) });
});

route("GET", /^\/api\/audit$/, "admin", async ({ env, url }) => {
  const limit = integer(url.searchParams.get("limit"), { min: 1, max: 200, fallback: 50 });
  const before = integer(url.searchParams.get("before"), { min: 1, fallback: null });
  const actor = integer(url.searchParams.get("actor"), { min: 1, fallback: null });
  const week = canonicalWeekKey(url.searchParams.get("week"));
  const prefixes = actionPrefixes(url.searchParams.get("action"));
  const keyword = optionalText(url.searchParams.get("q"), 40);
  const where = [];
  const binds = [];
  if (before !== null) {
    where.push("id < ?");
    binds.push(before);
  }
  if (actor !== null) {
    where.push("actor_id = ?");
    binds.push(actor);
  }
  if (week) {
    where.push("week_key = ?");
    binds.push(week);
  }
  if (prefixes.length) {
    where.push(`(${prefixes.map(() => "action LIKE ?").join(" OR ")})`);
    binds.push(...prefixes.map((item) => `${item}%`));
  }
  if (keyword) {
    where.push("(COALESCE(detail, '') LIKE ? OR COALESCE(target, '') LIKE ? OR COALESCE(actor_name, '') LIKE ?)");
    binds.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
  const rows = await env.DB.prepare(sql).bind(...binds, limit + 1).all();
  const list = rows.results.map(mapAuditRow);
  const hasMore = list.length > limit;
  const entries = hasMore ? list.slice(0, limit) : list;
  return json({ entries, hasMore, nextBefore: entries.length ? entries[entries.length - 1].id : null });
});

route("GET", /^\/api\/export$/, "admin", async ({ env, user, request }) => {
  await logAudit(env.DB, { user, action: "export.json", request });
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
