import assert from "node:assert/strict";
import test from "node:test";

import { streakOf } from "../worker/api.js";

function dbWith(weeks) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        all: async () => ({ results: weeks })
      };
    }
  };
}

test("streakOf 从最近一周往前数连续达标", async () => {
  const db = dbWith([
    { week_key: "2026-10-09", total: 4, confirmed: 4 },
    { week_key: "2026-10-02", total: 5, confirmed: 5 },
    { week_key: "2026-09-25", total: 3, confirmed: 1 },
    { week_key: "2026-09-18", total: 4, confirmed: 4 }
  ]);
  assert.equal(await streakOf(db, "2026-10-16"), 2);
});

test("streakOf 跳过没留作业的放假周，遇到不达标就停", async () => {
  const db = dbWith([
    { week_key: "2026-10-09", total: 0, confirmed: 0 },
    { week_key: "2026-10-02", total: 4, confirmed: 4 },
    { week_key: "2026-09-25", total: 4, confirmed: 2 },
    { week_key: "2026-09-18", total: 4, confirmed: 4 }
  ]);
  assert.equal(await streakOf(db, "2026-10-16"), 1);
});
