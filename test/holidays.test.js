import assert from "node:assert/strict";
import test from "node:test";

import { deriveScheduleFromRange, holidayScheduleForWeek, loadHolidayPeriods, periodsFromDays } from "../worker/holidays.js";

const at = (value) => Date.parse(`${value}T00:00:00+08:00`);
const fixtureDays = [
  { name: "元旦", date: "2025-12-31", isOffDay: false },
  { name: "元旦", date: "2026-01-01", isOffDay: true },
  { name: "元旦", date: "2026-01-02", isOffDay: true },
  { name: "元旦", date: "2026-01-03", isOffDay: true },
  { name: "国庆节", date: "2026-09-30", isOffDay: false },
  { name: "国庆节", date: "2026-10-01", isOffDay: true },
  { name: "国庆节", date: "2026-10-02", isOffDay: true },
  { name: "国庆节", date: "2026-10-03", isOffDay: true },
  { name: "国庆节", date: "2026-10-04", isOffDay: true },
  { name: "国庆节", date: "2026-10-05", isOffDay: true },
  { name: "国庆节", date: "2026-10-06", isOffDay: true },
  { name: "国庆节", date: "2026-10-07", isOffDay: true },
  { name: "国庆节", date: "2026-10-08", isOffDay: false }
];

test("periodsFromDays 把连续放假日合并成区间", () => {
  const periods = periodsFromDays(fixtureDays);
  assert.equal(periods.length, 2);
  assert.deepEqual(
    periods.map((item) => [item.name, item.start, item.end]),
    [["元旦", "2026-01-01", "2026-01-03"], ["国庆节", "2026-10-01", "2026-10-07"]]
  );
});

test("deriveScheduleFromRange 按假期最后一天排提前分和收工", () => {
  const derived = deriveScheduleFromRange("2026-10-02", at("2026-10-01"), at("2026-10-07"));
  assert.equal(derived.fridayChecklist, at("2026-10-02") + 21 * 3600000);
  assert.equal(derived.saturdayEarly, at("2026-10-07") + 15 * 3600000);
  assert.equal(derived.saturdayMid, at("2026-10-07") + 18 * 3600000);
  assert.equal(derived.saturdayHard, at("2026-10-07") + 21 * 3600000);
  assert.equal(derived.weekEnd, at("2026-10-08"));
  assert.equal(deriveScheduleFromRange("2026-10-16", at("2026-10-01"), at("2026-10-07")), null);
});

test("holidayScheduleForWeek 只在本周窗口碰到放假时生效", () => {
  const periods = periodsFromDays(fixtureDays);
  const national = holidayScheduleForWeek("2026-10-02", periods);
  assert.equal(national.name, "国庆节");
  assert.equal(national.rangeStart, "2026-10-01");
  assert.equal(national.rangeEnd, "2026-10-07");
  assert.equal(national.weekEnd, at("2026-10-08"));
  assert.equal(holidayScheduleForWeek("2026-10-09", periods), null);
  assert.equal(holidayScheduleForWeek("2026-09-25", periods), null);
  const newYear = holidayScheduleForWeek("2026-01-02", periods);
  assert.equal(newYear.name, "元旦");
  assert.equal(newYear.rangeStart, "2026-01-01");
});

function fakeDb(store = new Map()) {
  return {
    store,
    prepare() {
      return {
        bind(key, value, updatedAt) {
          return {
            first: async () => (store.has(key) ? { value: store.get(key).value, updated_at: store.get(key).updatedAt } : null),
            run: async () => {
              store.set(key, { value, updatedAt });
              return {};
            },
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
}

const jsonResponse = (days) => ({ ok: true, json: async () => ({ days }) });

test("loadHolidayPeriods 拉一次后走缓存，拉不到时用旧缓存", async () => {
  const db = fakeDb();
  let calls = 0;
  const first = await loadHolidayPeriods(db, 2026, {
    now: Date.parse("2026-10-18T10:00:00+08:00"),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(fixtureDays);
    }
  });
  assert.equal(calls, 1);
  assert.equal(first.length, 2);
  const cached = await loadHolidayPeriods(db, 2026, {
    now: Date.parse("2026-10-19T10:00:00+08:00"),
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(cached, first);

  const stale = await loadHolidayPeriods(db, 2026, {
    now: Date.parse("2026-12-18T10:00:00+08:00"),
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    }
  });
  assert.equal(calls, 3);
  assert.deepEqual(stale, first);
});

test("loadHolidayPeriods 拉不到又没缓存时返回 null，并在短时间内不再重试", async () => {
  const db = fakeDb();
  let calls = 0;
  const missing = await loadHolidayPeriods(db, 2027, {
    now: Date.parse("2026-10-18T10:00:00+08:00"),
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    }
  });
  assert.equal(missing, null);
  const again = await loadHolidayPeriods(db, 2027, {
    now: Date.parse("2026-10-18T11:00:00+08:00"),
    fetchImpl: async () => {
      calls += 1;
      throw new Error("offline");
    }
  });
  assert.equal(again, null);
  assert.equal(calls, 2);
});
