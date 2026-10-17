import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAutoScore,
  normalizeDetail,
  scoreFromRate,
  shiftWeek,
  totalOf,
  weekDeadlines,
  weekKeyOf,
  weekLabel
} from "../worker/scoring.js";

const at = (text) => Date.parse(text);

test("weekKeyOf 以周五为界划分周末", () => {
  assert.equal(weekKeyOf(at("2026-10-16T00:30:00+08:00")), "2026-10-16");
  assert.equal(weekKeyOf(at("2026-10-16T23:59:00+08:00")), "2026-10-16");
  assert.equal(weekKeyOf(at("2026-10-18T23:30:00+08:00")), "2026-10-16");
  assert.equal(weekKeyOf(at("2026-10-19T09:00:00+08:00")), "2026-10-16");
  assert.equal(weekKeyOf(at("2026-10-22T23:59:00+08:00")), "2026-10-16");
  assert.equal(weekKeyOf(at("2026-10-23T00:01:00+08:00")), "2026-10-23");
});

test("shiftWeek 跨月正确", () => {
  assert.equal(shiftWeek("2026-10-16", 1), "2026-10-23");
  assert.equal(shiftWeek("2026-10-16", -1), "2026-10-09");
  assert.equal(shiftWeek("2026-02-27", 1), "2026-03-06");
});

test("weekDeadlines 对应周五 21:00 与周六三档", () => {
  const deadlines = weekDeadlines("2026-10-16");
  assert.equal(new Date(deadlines.fridayChecklist).toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(new Date(deadlines.saturdayEarly).toISOString(), "2026-10-17T07:00:00.000Z");
  assert.equal(new Date(deadlines.saturdayMid).toISOString(), "2026-10-17T10:00:00.000Z");
  assert.equal(new Date(deadlines.saturdayHard).toISOString(), "2026-10-17T13:00:00.000Z");
  assert.equal(weekLabel("2026-10-16"), "10/16 周五 ~ 10/18 周日");
});

test("scoreFromRate 按 90/80/70 分档", () => {
  assert.equal(scoreFromRate(1), 30);
  assert.equal(scoreFromRate(0.9), 30);
  assert.equal(scoreFromRate(0.85), 20);
  assert.equal(scoreFromRate(0.75), 10);
  assert.equal(scoreFromRate(0.5), 0);
});

function task(overrides) {
  return {
    status: "pending",
    subject: "数学",
    quality: null,
    plan_slot: null,
    created_at: "2026-10-16T12:00:00.000Z",
    done_at: null,
    ...overrides
  };
}

test("computeAutoScore 统计清单分、完成分、提前分与质量分", () => {
  const tasks = [
    task({ status: "confirmed", quality: 4, plan_slot: "周六上午", done_at: "2026-10-17T02:00:00.000Z" }),
    task({ status: "confirmed", quality: 3, plan_slot: "周六上午", done_at: "2026-10-17T03:00:00.000Z" }),
    task({ status: "confirmed", quality: 4, subject: "语文", plan_slot: "周六下午", done_at: "2026-10-17T05:00:00.000Z" })
  ];
  const auto = computeAutoScore({ weekKey: "2026-10-16", tasks, bonusItems: [{ kind: "bonus", points: 6 }] });
  assert.equal(auto.A, 10);
  assert.equal(auto.B, 10);
  assert.equal(auto.C, 30);
  assert.equal(auto.D, 8);
  assert.equal(auto.E, 10);
  assert.equal(auto.H, 0);
  assert.equal(auto.bonus, 6);
  assert.equal(auto.deduction, 0);
});

test("computeAutoScore 对未完成与超时给出零分", () => {
  const tasks = [
    task({ status: "pending", created_at: "2026-10-16T14:00:00.000Z" }),
    task({ status: "confirmed", quality: 2, created_at: "2026-10-16T14:30:00.000Z", done_at: "2026-10-18T01:00:00.000Z" })
  ];
  const auto = computeAutoScore({ weekKey: "2026-10-16", tasks });
  assert.equal(auto.A, 0);
  assert.equal(auto.B, 0);
  assert.equal(auto.C, 0);
  assert.equal(auto.E, 0);
});

test("computeAutoScore 连续两周达标给连胜分", () => {
  const auto = computeAutoScore({ weekKey: "2026-10-16", tasks: [], prevRates: [1, 0.95] });
  assert.equal(auto.H, 10);
});

test("normalizeDetail 限制上限并保留加分扣分", () => {
  const detail = normalizeDetail({ A: 999, B: -5, C: 20, D: 20, E: 8, F: 10, G: 10, H: 10, bonus: 12, deduction: 90 });
  assert.equal(detail.A, 10);
  assert.equal(detail.B, 0);
  assert.equal(detail.deduction, 30);
  assert.equal(detail.bonus, 12);
  assert.equal(totalOf(detail), 70);
});

test("normalizeDetail 在缺省时沿用系统分", () => {
  const detail = normalizeDetail({}, { A: 10, B: 5, C: 30, D: 16, E: 8, F: 0, G: 0, H: 0, bonus: 3, deduction: 0 });
  assert.equal(detail.A, 10);
  assert.equal(detail.B, 5);
  assert.equal(detail.D, 16);
  assert.equal(totalOf(detail), 72);
});
