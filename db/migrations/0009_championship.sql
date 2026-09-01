-- Who won a league, in a season, and how it was decided.
--
-- The database has always answered this by finding championship GAMES: the load
-- marks the last playoff game of a league in a season and calls its winner the
-- champion. That works from 1933 and cannot work before it, because there was no
-- championship game to win. The 1929, 1930 and 1931 Packers took the title on
-- the final standings, and no amount of reading the schedule finds that.
--
-- So twelve seasons were simply absent, and absent in the quiet way: Curly
-- Lambeau's leaders row showed three titles when he won six, and nothing in the
-- data was wrong — the question had no answer where the answer was not a game.
--
-- TWO KINDS OF ROW, one table, provenance per row:
--
--   curated   1920-1969, from data/reference/nfl-champions.csv. The only source
--             for the standings era, and an independent check on everything
--             after it.
--   derived   1970-, computed from the championship games the load already
--             identifies. Rewritten every load, so it cannot drift.
--
-- The overlap is the point rather than a duplication. 47 of the 51 curated rows
-- that DO have a game agree with what the load derives, and that is the first
-- time the derivation has been checked against anything at all. The four that
-- did not agree were three wrong codes in the curated file, found by this
-- comparison and corrected — the check earned its keep before it was committed.
--
-- `method` is not decoration. A title taken on standings, a title taken in a
-- one-off tie-breaking playoff, and a title taken in a scheduled final are three
-- different things, and a page that prints them identically is claiming the 1920
-- Akron Pros beat somebody.

CREATE TABLE championship (
	sport      TEXT NOT NULL REFERENCES sport(id),
	season     INT  NOT NULL,
	-- The league that awarded it. Two leagues ran in the same season for most of
	-- the 1960s and in 1946-1949, so this is part of the key: 1966 has an NFL
	-- champion and an AFL champion, and both are true.
	league     TEXT NOT NULL,
	champion   TEXT NOT NULL,
	-- NULL where there was nobody to beat. A standings title has no opponent,
	-- and recording one would invent a game.
	runner_up  TEXT,
	method     TEXT NOT NULL CHECK (method IN ('standings', 'playoff game', 'championship game')),
	-- What to call it: "NFL Championship", "AAFC Championship", "Super Bowl".
	-- Derived from the league and season rather than stored in the CSV, because
	-- it is a function of them and a stored copy could disagree.
	title      TEXT,
	-- The game that decided it, where one exists. NULL for the standings era,
	-- which is exactly the set of rows nothing could derive.
	game_id    TEXT,
	source     TEXT NOT NULL REFERENCES source(id),

	PRIMARY KEY (sport, season, league),
	FOREIGN KEY (sport, champion) REFERENCES franchise(sport, id),
	FOREIGN KEY (sport, runner_up) REFERENCES franchise(sport, id),
	FOREIGN KEY (sport, game_id) REFERENCES game(sport, id) ON DELETE SET NULL,
	-- A season decided by standings has no game and no opponent; one decided by
	-- a game has both. The constraint says so rather than a comment claiming it.
	CONSTRAINT standings_have_no_game CHECK (
		(method = 'standings' AND game_id IS NULL)
		OR (method <> 'standings')),
	CONSTRAINT champion_did_not_beat_itself CHECK (runner_up IS NULL OR runner_up <> champion)
);

CREATE INDEX championship_by_club ON championship (sport, champion);

COMMENT ON TABLE championship IS
	'League champions by season. Curated for 1920-1969, derived from games after. Safe to reload.';
COMMENT ON COLUMN championship.method IS
	'How the title was decided: standings, a tie-breaking playoff game, or a scheduled final.';
