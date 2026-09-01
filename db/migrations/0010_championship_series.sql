-- A championship can be a series, and baseball's always is.
--
-- `method` was written for football, where a title is taken on the standings, in
-- a one-off tie-breaking playoff, or in a single scheduled final. Baseball has
-- none of those: a World Series is best-of-seven, and calling it a
-- "championship game" would be wrong about 121 seasons to make one CHECK
-- constraint pass.
--
-- The reason this matters now rather than when the table was added: the
-- championship table had exactly one consumer, the Titles column on the leaders
-- page, and football was the only sport with a gap that column could not fill.
-- A `/champions` page reads the table directly, so a sport missing from it is a
-- blank page rather than an absent column — the "looks complete, isn't" failure
-- this repo keeps recording, arriving as an empty table under an MLB scope.
--
-- So baseball's champions are derived into the same table. That IS storing
-- derived data, which the three-tier rule warns about, and it is the same
-- bargain `league_summary` and `game_leader` already make: the load rewrites it
-- every run, nothing hand-edits it, and dropping the table and reloading gives
-- the same rows. What it buys is one place a page can ask "who won this season"
-- without knowing which sport it is looking at, which is the seam this repo is
-- built on.
--
-- `game_id` for a series is the game that CLINCHED it, not the series. That is a
-- small lie and a useful link -- it is the game a reader wants when they click
-- 1955 -- so `method` says `championship series` and the column stays honest
-- about being one game of several.

ALTER TABLE championship DROP CONSTRAINT IF EXISTS championship_method_check;

ALTER TABLE championship
	ADD CONSTRAINT championship_method_check
	CHECK (method IN ('standings', 'playoff game', 'championship game', 'championship series'));

COMMENT ON COLUMN championship.game_id IS
	'The game that decided the title. For a series, the game that clinched it. NULL for a title taken on standings.';
