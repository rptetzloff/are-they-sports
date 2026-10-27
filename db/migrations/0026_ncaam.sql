-- Men's college basketball (Division I).
--
-- `cbbd` is CollegeBasketballData.com's API, every game from 1949-50, read with
-- CollegeFootballData's key (CBBD_API_KEY, else CFBD_API_KEY). Reproducible: the
-- load fetches it again. Authority 100, so it replaces ESPN's live rows.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('cbbd', 100, TRUE, 'Men''s college basketball 1949-50+, CollegeBasketballData.com''s API')
ON CONFLICT (id) DO NOTHING;
