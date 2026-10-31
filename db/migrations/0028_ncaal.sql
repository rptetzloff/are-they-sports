-- Men's college lacrosse (Division I).
--
-- `ncaal-file` is data/reference/ncaal-games.csv, ESPN's scoreboards as they were
-- read once by scripts/ncaal-games.mjs. Reproducible: the file is in the repository.
-- Authority 100, so it replaces ESPN's live rows.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('ncaal-file', 100, TRUE, 'Men''s college lacrosse 2025+, ESPN''s scoreboards as kept in data/reference')
ON CONFLICT (id) DO NOTHING;
