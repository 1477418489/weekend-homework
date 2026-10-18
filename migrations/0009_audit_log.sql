-- 操作日志：谁在什么时候做了什么（登录、作业、加分、结算、兑换、账号、设置）。
-- 家庭场景数据量很小，写入失败也不能影响主流程，日志保留 400 天。
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target TEXT,
  week_key TEXT,
  detail TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, id);
