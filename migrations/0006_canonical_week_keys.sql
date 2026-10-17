-- 旧前端把「上一周/下一周」的周键算成目标周五的前一天(UTC 取日期),
-- 导致数据写进了非周五的周键。这里把每个周键归一到「最近的周五」。
UPDATE tasks SET week_key = date(week_key, CASE WHEN (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 <= 3
    THEN -((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7)
    ELSE 7 - ((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7) END || ' days')
WHERE (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 != 0;

UPDATE bonus_items SET week_key = date(week_key, CASE WHEN (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 <= 3
    THEN -((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7)
    ELSE 7 - ((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7) END || ' days')
WHERE (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 != 0;

UPDATE redemptions SET week_key = date(week_key, CASE WHEN (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 <= 3
    THEN -((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7)
    ELSE 7 - ((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7) END || ' days')
WHERE (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 != 0;

UPDATE OR IGNORE week_scores SET week_key = date(week_key, CASE WHEN (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 <= 3
    THEN -((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7)
    ELSE 7 - ((CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7) END || ' days')
WHERE (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 != 0;

DELETE FROM week_scores WHERE (CAST(strftime('%w', week_key) AS INTEGER) + 2) % 7 != 0;