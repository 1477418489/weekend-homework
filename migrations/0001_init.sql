CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'parent', 'student')),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('homework', 'reward', 'bonus', 'deduction')),
  title TEXT NOT NULL,
  subject TEXT,
  est_minutes INTEGER,
  points INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_options_type ON options(type, active, sort_order);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  est_minutes INTEGER,
  plan_slot TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'confirmed')),
  quality INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_option_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  done_by INTEGER,
  done_at TEXT,
  done_via TEXT,
  confirmed_by INTEGER,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week_key, sort_order, id);

CREATE TABLE IF NOT EXISTS bonus_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bonus', 'deduction')),
  title TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bonus_week ON bonus_items(week_key);

CREATE TABLE IF NOT EXISTS week_scores (
  week_key TEXT PRIMARY KEY,
  detail TEXT NOT NULL,
  total INTEGER NOT NULL,
  settled_by INTEGER,
  settled_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  points INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by INTEGER,
  requested_at TEXT NOT NULL,
  decided_by INTEGER,
  decided_at TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemptions_week ON redemptions(week_key);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT,
  filename TEXT,
  bytes INTEGER
);
