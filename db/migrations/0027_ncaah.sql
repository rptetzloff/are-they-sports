-- Men's college hockey (Division I).
--
-- `ncaah-file` is data/reference/ncaah-games.csv, ESPN's scoreboards as they were
-- read once by scripts/ncaah-games.mjs. Reproducible: the file is in the repository.
-- Authority 100, so it replaces ESPN's live rows. Its nine tournament games ESPN
-- lacks are source `wikipedia`.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('ncaah-file', 100, TRUE, 'Men''s college hockey 2003-04+, ESPN''s scoreboards as kept in data/reference')
ON CONFLICT (id) DO NOTHING;
