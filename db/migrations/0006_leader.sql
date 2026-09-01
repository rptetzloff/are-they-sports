-- Who led a club, per game rather than per tenure.
--
-- The leaders page -- `/coaches` for football, `/managers` for baseball -- has
-- been linked from every club page since the nav existed, answering 404. The
-- reason recorded in CLAUDE.md was that it "needs a curated coaches/managers
-- table nobody publishes". That was measured and is now only half true, which
-- is why this migration exists:
--
--   * MLB. Retrosheet's game logs carry a manager ID and name for each side of
--     every game, back to 1871. Checked against the loaded database: 217,906 of
--     225,713 final games, 96.5%. Nobody had to curate anything.
--   * NFL 1999+. nflverse's schedules.csv -- the file scripts/fetch.mjs already
--     pulls -- has `home_coach` and `away_coach` columns. 7,548 of 7,548 source
--     rows join to a game row, zero misses. This was free and unread for as long
--     as the page has 404'd.
--   * NFL 1920-1998. Genuinely absent. The FiveThirtyEight seed file is
--     date,season,neutral,playoff,team1,team2,elo*,score*,result1 and has no
--     coach column, so there is no per-game source and no build produces one.
--
-- So the original claim survives for exactly one of the three, and that one gets
-- the curated tier: data/reference/nfl-coaches.csv, the same shape of file as
-- nfl-franchise-history.csv and for the same reason. Two representations,
-- because the sources genuinely differ -- not because one is a convenience copy
-- of the other.
--
-- WHAT THIS DOES NOT COVER, said here so the next person does not measure it
-- again and conclude the load is broken:
--
--   * MLB 2026. Retrosheet publishes game logs annually; the season being played
--     is not in them. 2,058 final 2026 games have no leader row and will get one
--     when Retrosheet publishes.
--   * The Negro Leagues. gameinfo.csv includes them -- CAG, KCM, HOM, MEM, BIR
--     and others, about 8,220 games concentrated in 1937-1949 -- but Retrosheet
--     publishes their games as .EBR event files under alldata/ngl_b, not as game
--     logs, so a game-log parse cannot see them. None of those clubs appear in
--     any scope, so no page is wrong; the rows are simply absent, and closing
--     the gap means an EBR parser rather than a bigger glob.

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

-- Curated from Wikipedia. Authority 50: below every published feed, because it
-- is a tertiary source transcribed by a scraper, and above nothing else because
-- for NFL 1920-1998 there IS nothing else.
--
-- `reproducible` is TRUE, and the distinction matters. It is not `manual`, which
-- means "corrected by hand IN the database" and must be backed up. This rebuilds
-- from a committed CSV and a checkout, which is the test CLAUDE.md sets.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('wikipedia', 50, TRUE, 'Curated from Wikipedia into data/reference/. NFL coaches 1920-1998, where no feed publishes them')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- A person who led a club. One row per person per sport, not per tenure.
--
-- THE ID IS THE POINT, and it is CLAUDE.md's "a club is a sport and an id, never
-- an id" rule arriving a second time with a different noun. A leader is a
-- person; a name is a spelling. nflverse writes `Jim Mora` for ATL, IND and SEA
-- across 1999-2009, which is Jim Mora Sr. at Indianapolis and his son at Atlanta
-- and Seattle collapsed into one string. Key the leaders page on the name and it
-- serves one coach with a twenty-year career and three clubs: no error, no
-- failing test, and a page that reads correctly.
--
-- Baseball needs none of this because Retrosheet already solved it. Its manager
-- IDs are 1:1 with names across all 1,490 (id, name) pairs in the game logs --
-- the single exception being the empty id paired with the literal `(none)`,
-- which is a placeholder and not a person. So `id` is Retrosheet's for MLB and
-- a slug this repo assigns for NFL, and the football slug is exactly the work
-- baseball gets for free.
CREATE TABLE leader (
	sport  TEXT NOT NULL REFERENCES sport(id),
	id     TEXT NOT NULL,
	name   TEXT NOT NULL,
	source TEXT NOT NULL REFERENCES source(id),
	PRIMARY KEY (sport, id)
);

-- ---------------------------------------------------------------------------
-- Attribution
-- ---------------------------------------------------------------------------

-- Which leader led which side of one game.
--
-- Per game, not per date range, and that is the whole reason to prefer it. A
-- tenure with a start and an end cannot say who managed the second game of a
-- doubleheader when the first one got a manager fired, and it has to invent an
-- answer at every boundary. A row per game states it. Retrosheet's game ID is
-- home team + date + game number -- FW1187105040 -- so the two halves of a
-- doubleheader are distinct keys and nothing is guessed.
--
-- The franchise column says which SIDE, and it is not redundant with the game
-- row: a game has a home and an away club and each had its own leader, so the
-- key is the game and the side together.
--
-- Only final games are counted into a record. A scheduled row still carries a
-- leader and that is deliberate -- nflverse names the 2026 Giants' head coach on
-- games not yet played, which is how the page knows who is in charge now -- but
-- counting it would credit a coach with a game nobody has played.
CREATE TABLE game_leader (
	sport     TEXT NOT NULL,
	game_id   TEXT NOT NULL,
	-- Which club this person led in this game.
	franchise TEXT NOT NULL,
	leader    TEXT NOT NULL,
	source    TEXT NOT NULL REFERENCES source(id),
	PRIMARY KEY (sport, game_id, franchise),
	FOREIGN KEY (sport, game_id) REFERENCES game(sport, id) ON DELETE CASCADE,
	FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id),
	FOREIGN KEY (sport, leader) REFERENCES leader(sport, id)
);

-- The leaders page groups by leader within a scope's clubs, so this is the read
-- path. The primary key already serves the per-game lookup.
CREATE INDEX game_leader_by_franchise ON game_leader (sport, franchise, leader);
CREATE INDEX game_leader_by_leader    ON game_leader (sport, leader);

-- ---------------------------------------------------------------------------
-- The era with no per-game source
-- ---------------------------------------------------------------------------

-- A tenure stated rather than counted.
--
-- This exists for NFL 1920-1998 and nothing else. It is the shape the curated
-- file has, because Wikipedia publishes a coach's record as a total and not as
-- games, and no amount of loading turns a total back into 240 rows.
--
-- It is therefore NOT a summary of `game_leader` and must never be written from
-- one. Storing the same fact twice is the drift CLAUDE.md keeps describing, and
-- the check that it has not happened is that these rows and those rows never
-- cover the same season: a leaders page adds them, it does not reconcile them.
-- `db/migrations` cannot express "no overlap with a computed set", so
-- test/leaders.test.js asserts it instead.
--
-- W/L/T here are REGULAR SEASON, and the postseason is its own pair of columns.
-- That is not a stylistic choice: the derived sources count playoff games inside
-- w/l and Wikipedia does not, which is why 161 of 175 shared 1999+ NFL tenures
-- reconcile only after subtracting playoff wins from the derived side -- Bobby
-- Cox reads 2213-1774 in Retrosheet against 2149-1709 on Wikipedia, exactly his
-- postseason. Storing one blended number would bake that discrepancy in.
CREATE TABLE leader_tenure (
	sport        TEXT NOT NULL,
	franchise    TEXT NOT NULL,
	leader       TEXT NOT NULL,
	first_season INT  NOT NULL,
	last_season  INT  NOT NULL,
	w            INT  NOT NULL,
	l            INT  NOT NULL,
	t            INT  NOT NULL DEFAULT 0,
	playoff_w    INT  NOT NULL DEFAULT 0,
	playoff_l    INT  NOT NULL DEFAULT 0,
	-- An interim keeps their own row rather than folding into whoever followed,
	-- because "who was in charge for those four games" is the question the page
	-- answers. The curated file's own rule, carried through.
	interim      BOOLEAN NOT NULL DEFAULT FALSE,
	source       TEXT NOT NULL REFERENCES source(id),
	PRIMARY KEY (sport, franchise, leader, first_season),
	FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id),
	FOREIGN KEY (sport, leader) REFERENCES leader(sport, id),
	CONSTRAINT tenure_seasons_ordered CHECK (last_season >= first_season),
	CONSTRAINT tenure_counts_nonnegative CHECK (
		w >= 0 AND l >= 0 AND t >= 0 AND playoff_w >= 0 AND playoff_l >= 0)
);

CREATE INDEX leader_tenure_by_franchise ON leader_tenure (sport, franchise);

COMMENT ON TABLE leader IS
	'A person who led a club. Retrosheet''s manager id for MLB, an assigned slug for NFL.';
COMMENT ON TABLE game_leader IS
	'Who led each side of one game. Derived and reproducible; safe to delete and reload.';
COMMENT ON TABLE leader_tenure IS
	'Stated tenures for NFL 1920-1998, where no per-game source exists. Never written from game_leader.';
