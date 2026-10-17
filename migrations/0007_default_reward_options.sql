INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'reward', '自由玩 1 小时', NULL, NULL, 20, 210, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'reward' AND title = '自由玩 1 小时');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'reward', '看一场电影', NULL, NULL, 40, 220, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'reward' AND title = '看一场电影');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'reward', '一杯奶茶 / 饮料', NULL, NULL, 15, 230, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'reward' AND title = '一杯奶茶 / 饮料');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'reward', '周末和朋友出去玩半天', NULL, NULL, 60, 240, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'reward' AND title = '周末和朋友出去玩半天');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'reward', '买一本想看的书', NULL, NULL, 50, 250, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'reward' AND title = '买一本想看的书');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'bonus', '主动多刷一套题', NULL, NULL, 5, 310, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'bonus' AND title = '主动多刷一套题');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'bonus', '主动帮家里做家务', NULL, NULL, 3, 320, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'bonus' AND title = '主动帮家里做家务');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'deduction', '作业拖拉、超时未交', NULL, NULL, 5, 410, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'deduction' AND title = '作业拖拉、超时未交');

INSERT INTO options (type, title, subject, est_minutes, points, sort_order, active, weekly, created_at)
SELECT 'deduction', '字迹潦草、敷衍了事', NULL, NULL, 3, 420, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'deduction' AND title = '字迹潦草、敷衍了事');
