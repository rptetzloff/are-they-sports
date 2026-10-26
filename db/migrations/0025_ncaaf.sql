-- College football (FBS).
--
-- `cfbd` is CollegeFootballData.com's API, every game from 1869, read with a
-- key (CFBD_API_KEY). Reproducible: the load fetches it again. Authority 100,
-- as the other sports' records of finished seasons, so it replaces ESPN's live
-- rows when it publishes.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('cfbd', 100, TRUE, 'College football 1869+, CollegeFootballData.com''s API (needs CFBD_API_KEY)')
ON CONFLICT (id) DO NOTHING;

-- Before 1998 no game decided college football's title, and the AP poll's
-- final No. 1 stands as its champion (data/reference/ncaaf-champions.csv): a
-- fourth way a title is decided, beside the three 0010 allows.
ALTER TABLE championship DROP CONSTRAINT IF EXISTS championship_method_check;
ALTER TABLE championship
	ADD CONSTRAINT championship_method_check
	CHECK (method IN ('standings', 'playoff game', 'championship game', 'championship series', 'poll'));
-- A poll's title, like a standings title, has no game.
ALTER TABLE championship DROP CONSTRAINT IF EXISTS standings_have_no_game;
ALTER TABLE championship
	ADD CONSTRAINT standings_have_no_game CHECK (
		(method IN ('standings', 'poll') AND game_id IS NULL)
		OR (method NOT IN ('standings', 'poll')));
