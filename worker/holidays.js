import { DAY_MS, HOUR_MS, TZ_OFFSET_MS, weekStartMs } from "./scoring.js";

// 节假日数据来自 NateScarlet/holiday-cn（按国务院办公厅通知生成），拉到后缓存在 settings 表里，
// 同时在 isolate 内存里放一份。拉不到数据不影响使用：退回默认周五到周日，家长照样能手工设置。
const CACHE_PREFIX = "holiday_cn_";
const SUCCESS_TTL_MS = 30 * DAY_MS;
const FAILURE_TTL_MS = 6 * HOUR_MS;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_PERIODS = 40;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SOURCES = [
  (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`
];

const memory = new Map();
const inflight = new Map();

export function holidayCacheKey(year) {
  return `${CACHE_PREFIX}${year}`;
}

export function beijingYear(ms) {
  return new Date(Number(ms) + TZ_OFFSET_MS).getUTCFullYear();
}

function dateMs(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

// 把逐天的放假日期合并成连续区间：2026-10-01..2026-10-07 -> 一个区间。
export function periodsFromDays(days) {
  const offDays = (Array.isArray(days) ? days : [])
    .filter((day) => day && day.isOffDay)
    .map((day) => ({ name: String(day.name || "节假日").trim() || "节假日", date: day.date, ms: dateMs(day.date) }))
    .filter((day) => day.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  const periods = [];
  for (const day of offDays) {
    const last = periods[periods.length - 1];
    if (last && day.ms <= last.endMs) continue;
    if (last && day.ms - last.endMs === DAY_MS) {
      last.end = day.date;
      last.endMs = day.ms;
      continue;
    }
    periods.push({ name: day.name, start: day.date, end: day.date, startMs: day.ms, endMs: day.ms });
  }
  return periods;
}

async function fetchPeriods(year, fetchImpl) {
  for (const build of SOURCES) {
    try {
      const response = await fetchImpl(build(year), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response || !response.ok) continue;
      const data = await response.json();
      if (!data || !Array.isArray(data.days)) continue;
      return periodsFromDays(data.days).slice(0, MAX_PERIODS);
    } catch {
      // 换下一个源；都失败就返回 null，本次按“没有节假日数据”处理
    }
  }
  return null;
}

async function readCache(db, key) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCache(db, key, value) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run();
}

async function loadPeriods(db, year, now, fetchImpl) {
  const key = holidayCacheKey(year);
  const cached = await readCache(db, key);
  const fetchedAt = cached && Number.isFinite(Date.parse(cached.fetchedAt || "")) ? Date.parse(cached.fetchedAt) : null;
  if (cached && Array.isArray(cached.periods) && fetchedAt !== null && now - fetchedAt < SUCCESS_TTL_MS) return cached.periods;
  if (cached && cached.periods === null && fetchedAt !== null && now - fetchedAt < FAILURE_TTL_MS) return null;

  const fetched = await fetchPeriods(year, fetchImpl);
  if (fetched) {
    await saveCache(db, key, { periods: fetched, fetchedAt: new Date(now).toISOString() });
    return fetched;
  }
  // 拉失败（或者这一年还没出安排）时，别把其他请求刚写好的成功结果盖掉。
  const latest = await readCache(db, key);
  if (latest && Array.isArray(latest.periods)) return latest.periods;
  await saveCache(db, key, { periods: null, fetchedAt: new Date(now).toISOString() });
  return null;
}

export async function loadHolidayPeriods(db, year, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const key = holidayCacheKey(year);
  const hit = memory.get(key);
  if (hit && now - hit.at < MEMORY_TTL_MS) return hit.periods;
  if (inflight.has(key)) return inflight.get(key);
  const task = loadPeriods(db, year, now, fetchImpl);
  inflight.set(key, task);
  try {
    const periods = await task;
    memory.set(key, { periods, at: now });
    return periods;
  } finally {
    inflight.delete(key);
  }
}

// 放假区间 [start, end]（都按北京日期）在这周里生效时的默认时间：
// 清单截止仍是本周周五 21:00（不晚于收工），提前分三档挪到假期最后一天的 15:00 / 18:00 / 21:00，收工截止是假期最后一天 24:00。
export function deriveScheduleFromRange(weekKey, startMs, endMs) {
  const weekStart = weekStartMs(weekKey);
  if (!Number.isFinite(weekStart) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  if (endMs < weekStart) return null;
  return {
    fridayChecklist: Math.min(weekStart + 21 * HOUR_MS, endMs + 15 * HOUR_MS),
    saturdayEarly: endMs + 15 * HOUR_MS,
    saturdayMid: endMs + 18 * HOUR_MS,
    saturdayHard: endMs + 21 * HOUR_MS,
    weekEnd: endMs + DAY_MS
  };
}

// 这一周的窗口是周五 00:00 ~ 周一 00:00；跟它有交集的长假就算这一周的放假区间。
export function holidayScheduleForWeek(weekKey, periods) {
  const start = weekStartMs(weekKey);
  if (!Number.isFinite(start)) return null;
  const end = start + 3 * DAY_MS;
  const period = (Array.isArray(periods) ? periods : []).find((item) => item.startMs < end && item.endMs + DAY_MS > start);
  if (!period) return null;
  const hours = deriveScheduleFromRange(weekKey, period.startMs, period.endMs);
  if (!hours) return null;
  return { name: period.name, rangeStart: period.start, rangeEnd: period.end, ...hours };
}
