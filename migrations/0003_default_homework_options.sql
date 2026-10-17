INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '背诵课文', '语文', 30, 10, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '背诵课文' AND IFNULL(subject, '') = '语文');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '周记 / 作文', '语文', 60, 20, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '周记 / 作文' AND IFNULL(subject, '') = '语文');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '字词默写', '语文', 20, 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '字词默写' AND IFNULL(subject, '') = '语文');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '做试卷', '数学', 90, 40, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '做试卷' AND IFNULL(subject, '') = '数学');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '错题订正', '数学', 30, 50, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '错题订正' AND IFNULL(subject, '') = '数学');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '背单词', '英语', 20, 60, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '背单词' AND IFNULL(subject, '') = '英语');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '背诵课文', '英语', 30, 70, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '背诵课文' AND IFNULL(subject, '') = '英语');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '听力训练', '英语', 20, 80, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '听力训练' AND IFNULL(subject, '') = '英语');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '做试卷', '物理', 45, 90, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '做试卷' AND IFNULL(subject, '') = '物理');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '错题订正', '物理', 30, 100, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '错题订正' AND IFNULL(subject, '') = '物理');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '做试卷', '化学', 45, 110, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '做试卷' AND IFNULL(subject, '') = '化学');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '背诵知识点', '历史', 30, 120, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '背诵知识点' AND IFNULL(subject, '') = '历史');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '背诵知识点', '道法', 30, 130, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '背诵知识点' AND IFNULL(subject, '') = '道法');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '复习背诵', '生物', 30, 140, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '复习背诵' AND IFNULL(subject, '') = '生物');

INSERT INTO options (type, title, subject, est_minutes, sort_order, active, created_at)
SELECT 'homework', '复习背诵', '地理', 30, 150, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '复习背诵' AND IFNULL(subject, '') = '地理');
