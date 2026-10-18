import assert from "node:assert/strict";
import test from "node:test";

import { actionPrefixes, clientIp, logAudit, mapAuditRow, pruneAuditLog } from "../worker/audit.js";

function fakeDb(onRun) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const record = { sql, args: [] };
      calls.push(record);
      return {
        bind(...args) {
          record.args = args;
          return this;
        },
        run: async () => (onRun ? onRun(record) : { meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({ results: [] })
      };
    }
  };
}

const headers = (map) => ({ get: (key) => map[key] ?? null });

test("logAudit 写入时间、操作人、动作与 IP", async () => {
  const db = fakeDb();
  await logAudit(db, {
    user: { id: 7, display_name: "李俊成", role: "student" },
    action: "task.done",
    target: "数学卷子 P32",
    weekKey: "2026-10-16",
    detail: "学生打卡 · 实际 25 分钟",
    request: { headers: headers({ "CF-Connecting-IP": "1.2.3.4" }) }
  });
  const [call] = db.calls;
  assert.match(call.sql, /INSERT INTO audit_log/);
  assert.equal(call.args[1], 7);
  assert.equal(call.args[2], "李俊成");
  assert.equal(call.args[3], "student");
  assert.equal(call.args[4], "task.done");
  assert.equal(call.args[5], "数学卷子 P32");
  assert.equal(call.args[6], "2026-10-16");
  assert.equal(call.args[7], "学生打卡 · 实际 25 分钟");
  assert.equal(call.args[8], "1.2.3.4");
  assert.match(String(call.args[0]), /^\d{4}-\d{2}-\d{2}T/);
});

test("logAudit 截断超长字段并允许匿名操作", async () => {
  const db = fakeDb();
  await logAudit(db, { action: "auth.login_failed", target: "x".repeat(300), detail: "y".repeat(500) });
  const [call] = db.calls;
  assert.equal(call.args[1], null);
  assert.equal(call.args[2], null);
  assert.equal(call.args[5].length, 120);
  assert.equal(call.args[7].length, 300);
});

test("logAudit 写库失败不影响主流程", async () => {
  const db = fakeDb(() => {
    throw new Error("D1 down");
  });
  await assert.doesNotReject(() => logAudit(db, { action: "task.add" }));
});

test("clientIp 优先 CF 头，回退到 X-Forwarded-For", () => {
  assert.equal(clientIp({ headers: headers({ "CF-Connecting-IP": "9.9.9.9" }) }), "9.9.9.9");
  assert.equal(clientIp({ headers: headers({ "X-Forwarded-For": "8.8.8.8, 10.0.0.1" }) }), "8.8.8.8");
  assert.equal(clientIp({ headers: headers({}) }), null);
  assert.equal(clientIp(null), null);
  assert.equal(clientIp({ headers: headers({ "CF-Connecting-IP": "1".repeat(120) }) }).length, 60);
});

test("actionPrefixes 只留合法前缀并限量", () => {
  assert.deepEqual(actionPrefixes("task.,bonus."), ["task.", "bonus."]);
  assert.deepEqual(actionPrefixes(" task., ,999,<script>,auth."), ["task.", "auth."]);
  assert.equal(actionPrefixes("a.,b.,c.,d.,e.,f.,g.,h.,i.,j.").length, 8);
  assert.deepEqual(actionPrefixes(""), []);
  assert.deepEqual(actionPrefixes(null), []);
});

test("pruneAuditLog 按保留天数切时间点", async () => {
  const db = fakeDb();
  const changes = await pruneAuditLog(db, 400);
  const [call] = db.calls;
  assert.match(call.sql, /DELETE FROM audit_log WHERE at < \?/);
  const cutoff = Date.parse(call.args[0]);
  const expected = Date.now() - 400 * 24 * 3600 * 1000;
  assert.ok(Math.abs(cutoff - expected) < 5000);
  assert.equal(changes, 1);
});

test("mapAuditRow 转成前端字段", () => {
  assert.deepEqual(
    mapAuditRow({ id: 3, at: "2026-10-18T03:38:17.889Z", actor_id: 2, actor_name: "李俊成", actor_role: "student", action: "task.done", target: "数学", week_key: "2026-10-16", detail: "学生打卡", ip: "127.0.0.1" }),
    { id: 3, at: "2026-10-18T03:38:17.889Z", actorId: 2, actorName: "李俊成", actorRole: "student", action: "task.done", target: "数学", weekKey: "2026-10-16", detail: "学生打卡", ip: "127.0.0.1" }
  );
});
