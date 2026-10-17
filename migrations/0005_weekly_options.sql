ALTER TABLE options ADD COLUMN weekly INTEGER NOT NULL DEFAULT 0;

INSERT INTO options (type, title, subject, sort_order, active, weekly, created_at)
SELECT 'homework', '单词背诵默写', '英语', 160, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '单词背诵默写' AND IFNULL(subject, '') = '英语');

INSERT INTO options (type, title, subject, sort_order, active, weekly, created_at)
SELECT 'homework', '语法背诵默写', '英语', 170, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '语法背诵默写' AND IFNULL(subject, '') = '英语');

INSERT INTO options (type, title, subject, sort_order, active, weekly, created_at)
SELECT 'homework', '练习题', '英语', 180, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM options WHERE type = 'homework' AND title = '练习题' AND IFNULL(subject, '') = '英语');
