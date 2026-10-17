export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const SCORE_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const SCORE_MAX = { A: 10, B: 10, C: 30, D: 20, E: 10, F: 10, G: 10, H: 10 };
export const SCORE_LABEL = {
  A: "清单分",
  B: "计划分",
  C: "完成分",
  D: "质量分",
  E: "提前分",
  F: "自检分",
  G: "复盘分",
  H: "连胜分"
};

export const WEEK_HINT = "周五 21:00 清单 / 周六 15:00-21:00 三档提前分 / 周六 21:00 硬截止";

const WEEK_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isWeekKey(value) {
  return typeof value === "string" && WEEK_KEY_PATTERN.test(value);
}

export function weekKeyOf(ms = Date.now()) {
  const local = new Date(ms + TZ_OFFSET_MS);
  const weekday = local.getUTCDay();
  const offset = (weekday + 2) % 7;
  local.setUTCDate(local.getUTCDate() - offset);
  return local.toISOString().slice(0, 10);
}

export function weekStartMs(weekKey) {
  return Date.parse(`${weekKey}T00:00:00.000+08:00`);
}

export function weekDeadlines(weekKey) {
  const start = weekStartMs(weekKey);
  return {
    fridayChecklist: start + 21 * HOUR_MS,
    saturdayEarly: start + 39 * HOUR_MS,
    saturdayMid: start + 42 * HOUR_MS,
    saturdayHard: start + 45 * HOUR_MS,
    weekEnd: start + 3 * DAY_MS
  };
}

export function weekLabel(weekKey) {
  const format = (ms) => {
    const date = new Date(ms + TZ_OFFSET_MS);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };
  const start = weekStartMs(weekKey);
  return `${format(start)} 周五 ~ ${format(start + 2 * DAY_MS)} 周日`;
}

export function shiftWeek(weekKey, deltaWeeks) {
  return weekKeyOf(weekStartMs(weekKey) + deltaWeeks * 7 * DAY_MS);
}

export function completionRate(tasks) {
  if (!tasks.length) return 0;
  const confirmed = tasks.filter((task) => task.status === "confirmed").length;
  return confirmed / tasks.length;
}

export function scoreFromRate(rate) {
  if (rate >= 0.9) return 30;
  if (rate >= 0.8) return 20;
  if (rate >= 0.7) return 10;
  return 0;
}

function scoreFromDeadlines(weekKey, lastDoneAt) {
  if (!lastDoneAt) return 0;
  const at = Date.parse(lastDoneAt);
  if (!Number.isFinite(at)) return 0;
  const deadlines = weekDeadlines(weekKey);
  if (at <= deadlines.saturdayEarly) return 10;
  if (at <= deadlines.saturdayMid) return 8;
  if (at <= deadlines.saturdayHard) return 5;
  return 0;
}

function qualityScore(tasks) {
  const bySubject = new Map();
  for (const task of tasks) {
    if (task.status !== "confirmed") continue;
    if (task.quality === null || task.quality === undefined) continue;
    const subject = task.subject || "其他";
    const bucket = bySubject.get(subject) || [];
    bucket.push(Math.min(4, Math.max(0, Number(task.quality) || 0)));
    bySubject.set(subject, bucket);
  }
  let total = 0;
  for (const values of bySubject.values()) {
    total += values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return Math.min(SCORE_MAX.D, Math.round(total));
}

export function computeAutoScore({ weekKey, tasks, bonusItems = [], prevRates = [] }) {
  const sortedCreated = tasks
    .map((task) => Date.parse(task.created_at))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const deadlines = weekDeadlines(weekKey);
  const A = sortedCreated.length && sortedCreated[0] <= deadlines.fridayChecklist ? SCORE_MAX.A : 0;

  const planned = tasks.filter((task) => task.plan_slot).length;
  const planRatio = tasks.length ? planned / tasks.length : 0;
  const B = planRatio >= 1 ? SCORE_MAX.B : planRatio >= 0.5 ? 5 : 0;

  const rate = completionRate(tasks);
  const C = tasks.length ? scoreFromRate(rate) : 0;
  const D = qualityScore(tasks);

  const doneTimes = tasks
    .filter((task) => task.done_at)
    .map((task) => Date.parse(task.done_at))
    .filter((value) => Number.isFinite(value));
  const E = doneTimes.length ? scoreFromDeadlines(weekKey, new Date(Math.max(...doneTimes)).toISOString()) : 0;

  const H = prevRates.length >= 2 && prevRates.slice(0, 2).every((value) => value >= 0.9) ? SCORE_MAX.H : 0;

  const bonus = bonusItems.filter((item) => item.kind === "bonus").reduce((sum, item) => sum + item.points, 0);
  const deduction = bonusItems.filter((item) => item.kind === "deduction").reduce((sum, item) => sum + item.points, 0);

  return {
    A,
    B,
    C,
    D,
    E,
    F: 0,
    G: 0,
    H,
    bonus,
    deduction,
    auto: { rate, planRatio, lastDoneAt: doneTimes.length ? new Date(Math.max(...doneTimes)).toISOString() : null }
  };
}

export function normalizeDetail(input, fallback = {}) {
  const detail = {};
  for (const key of SCORE_KEYS) {
    const value = Number(input?.[key]);
    const base = Number(fallback[key]) || 0;
    detail[key] = Number.isFinite(value) ? Math.min(SCORE_MAX[key], Math.max(0, Math.round(value))) : base;
  }
  const bonus = Number(input?.bonus);
  const deduction = Number(input?.deduction);
  detail.bonus = Number.isFinite(bonus) ? Math.max(0, Math.round(bonus)) : Number(fallback.bonus) || 0;
  detail.deduction = Number.isFinite(deduction) ? Math.max(0, Math.round(deduction)) : Number(fallback.deduction) || 0;
  detail.deduction = Math.min(detail.deduction, 30);
  return detail;
}

export function totalOf(detail) {
  const raw = SCORE_KEYS.reduce((sum, key) => sum + (Number(detail[key]) || 0), 0)
    + (Number(detail.bonus) || 0)
    - (Number(detail.deduction) || 0);
  return Math.max(0, raw);
}
