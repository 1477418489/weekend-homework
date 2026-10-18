-- 每周时间可以单独配置：节假日放假不一定落在周五到周日，
-- 家长可以为某一周改清单截止、提前分三档、收工截止（以及周标签的起止日期）。
CREATE TABLE IF NOT EXISTS week_schedules (
  week_key TEXT PRIMARY KEY,
  checklist_at TEXT,
  early_at TEXT,
  mid_at TEXT,
  hard_at TEXT,
  week_end TEXT,
  range_start TEXT,
  range_end TEXT,
  note TEXT,
  updated_by INTEGER,
  updated_at TEXT
);
