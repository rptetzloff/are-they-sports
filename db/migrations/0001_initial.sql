-- The database, as a source of record.
--
-- THIS IS A REVERSAL, and a deliberate one. CLAUDE.md's three-tier rule says a
-- build must be reproducible from sources and a checkout, and that anything
-- which cannot be rebuilt is a source of record belonging in the curated tier.
-- A database that captures a result the moment a game ends, before nflverse's
-- weekly refresh publishes it, is not reproducible by definition.
--
-- The reason to accept that: with per-club NDJSON artifacts, recording one
-- finished game means rebuilding a club's entire index. That is exactly why the
-- two live sites carry their worst code — main.js fetching its own CSV in the
-- browser, and a refresh cadence done by hand. There is nowhere to write a
-- single result.
--
-- But "source of record" is too blunt as stated, so it is not what this models.
-- Every row carries provenance, and provenance says whether that row could be
-- rebuilt. Historical games are reproducible from nflverse, FiveThirtyEight and
-- Retrosheet and remain so. Live captures and hand corrections are not, and are
-- exactly what a backup has to protect. That turns an architectural claim into a
-- query:
--
--   SELECT count(*) FROM game g JOIN source s ON g.source = s.id
--    WHERE NOT s.reproducible;
--
-- If that is zero, the whole database can be thrown away and rebuilt.

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

-- Where a row came from, how much it is trusted, and whether it can be rebuilt.
--
-- `authority` exists so a live capture never overwrites an authoritative
-- *result*. ESPN gives a score minutes after the whistle; nflverse gives the
-- same score days later, having corrected it. Both are welcome and one wins,
-- and the rule is data rather than a branch in the loader.
--
-- Authority alone is not the rule, and getting that wrong broke the entire
-- point of live ingestion in the first draft. nflverse publishes the *schedule*
-- too, so a 2026 fixture with no result already belongs to a source of
-- authority 100 — and an ESPN capture at authority 10 could never fill it in.
-- Owning the row and owning the result are different things.
--
-- So the upsert rule is: a source may write if its authority is at least as
-- high, OR if the existing row is not yet final. A live feed may complete a
-- scheduled game; it may not revise a finished one. See scripts/load.mjs.
CREATE TABLE source (
	id            TEXT PRIMARY KEY,
	authority     INT     NOT NULL,
	reproducible  BOOLEAN NOT NULL,
	note          TEXT    NOT NULL
);

INSERT INTO source (id, authority, reproducible, note) VALUES
	('retrosheet',      100, TRUE,  'MLB, authoritative, published annually'),
	('nflverse',        100, TRUE,  'NFL 1999+, authoritative, refreshed weekly'),
	('fivethirtyeight',  90, TRUE,  'NFL 1920-1998. Their own endpoints are gone; the GitHub copy survives'),
	('manual',           80, FALSE, 'Corrected by hand. Beats every feed and must be backed up'),
	('espn',             10, FALSE, 'Live capture, superseded the moment an authoritative source publishes');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE sport (
	id    TEXT PRIMARY KEY,
	name  TEXT NOT NULL
);

-- A club, canonically. One row per franchise for its whole existence: the
-- Seattle Pilots and the Milwaukee Brewers are one franchise, and so are the
-- San Diego and Los Angeles Chargers.
CREATE TABLE franchise (
	sport  TEXT NOT NULL REFERENCES sport(id),
	id     TEXT NOT NULL,
	PRIMARY KEY (sport, id)
);

-- The codes sources use for a franchise.
--
-- This is the table that earns the schema. The two football sources disagree
-- with each other — FiveThirtyEight writes LAC, LAR, OAK, WSH where nflverse
-- writes SD, STL, LA, LV, WAS — and a club's own games contain both, because
-- the eras come from different files. Today that is patched with alias rows in
-- a CSV and a fallback chain; here it is a join.
--
-- Baseball needs the era columns for a different reason: MIL and SE1 are one
-- franchise, but which code a game uses depends on when it was played.
CREATE TABLE franchise_code (
	sport      TEXT NOT NULL,
	code       TEXT NOT NULL,
	franchise  TEXT NOT NULL,
	source     TEXT REFERENCES source(id),  -- NULL means every source uses it
	valid_from DATE,                        -- NULL means "since the beginning"
	valid_to   DATE,                        -- NULL means "still current"
	PRIMARY KEY (sport, code, franchise),
	FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id)
);

-- Display names, by era.
--
-- Baseball fills this properly from Retrosheet: a 1969 game is the Seattle
-- Pilots. Football gets one open-ended row per franchise, because no source
-- publishes eras — so a 1995 Rams game says "Los Angeles Rams" though it was
-- played in St. Louis. The schema does not need to know which sport is which;
-- an open-ended span is simply what "we do not know when this changed" looks
-- like, and it stops being a special case the day someone traces a franchise.
CREATE TABLE franchise_name (
	sport      TEXT NOT NULL,
	franchise  TEXT NOT NULL,
	name       TEXT NOT NULL,
	valid_from DATE,
	valid_to   DATE,
	source     TEXT REFERENCES source(id),
	FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id)
);

CREATE INDEX franchise_name_lookup ON franchise_name (sport, franchise, valid_from);

-- ---------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------

-- One row per game, not one per club's view of it.
--
-- The committed artifacts store a game once for each club, so the Packers-Bears
-- series is 213 rows in two places, and a test exists purely to check the two
-- copies agree. Worse, a perspective row is lossy: it records an opponent and a
-- location but not which of the club's own codes applied, and for a neutral-site
-- game it cannot say which side the source called home. Those rows cannot
-- reconstruct a game, which is why this table is built from sources rather than
-- from them.
CREATE TABLE game (
	sport       TEXT NOT NULL REFERENCES sport(id),
	id          TEXT NOT NULL,
	season      INT  NOT NULL,
	date        DATE NOT NULL,
	-- regular | playoff | championship. The championship round is marked rather
	-- than the winner recorded, because a title is decided by counting wins
	-- against losses within the round — which is right for a best-of-seven World
	-- Series and right for a one-game Super Bowl, and is why both sports share
	-- the rule.
	round       TEXT NOT NULL CHECK (round IN ('regular', 'playoff', 'championship')),
	home        TEXT NOT NULL,
	away        TEXT NOT NULL,
	home_score  INT,
	away_score  INT,
	-- A neutral-site game has a nominal home side and no home advantage. Super
	-- Bowls are neutral, and calling one a home game puts it in the wrong bucket
	-- on every home/away split.
	neutral     BOOLEAN NOT NULL DEFAULT FALSE,
	status      TEXT NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'final')),
	source      TEXT NOT NULL REFERENCES source(id),
	observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (sport, id),
	FOREIGN KEY (sport, home) REFERENCES franchise(sport, id),
	FOREIGN KEY (sport, away) REFERENCES franchise(sport, id),
	-- A final game has both scores; a scheduled one has neither. This is the
	-- constraint that would have caught a half-recorded row, which the old
	-- adapter turned into a TIE because every comparison against NaN is false.
	CONSTRAINT scores_match_status CHECK (
		(status = 'final' AND home_score IS NOT NULL AND away_score IS NOT NULL)
		OR (status <> 'final' AND (home_score IS NULL) = (away_score IS NULL))
	),
	CONSTRAINT no_self_play CHECK (home <> away)
);

CREATE INDEX game_by_season ON game (sport, season);
CREATE INDEX game_by_home   ON game (sport, home, season);
CREATE INDEX game_by_away   ON game (sport, away, season);
CREATE INDEX game_by_date   ON game (sport, date);

-- Plays that scored. 95MB of league play-by-play reduces to this.
CREATE TABLE scoring_play (
	sport       TEXT NOT NULL,
	game_id     TEXT NOT NULL,
	seq         INT  NOT NULL,
	period      TEXT,
	clock       TEXT,
	team        TEXT,
	description TEXT,
	home_score  INT,
	away_score  INT,
	source      TEXT NOT NULL REFERENCES source(id),
	PRIMARY KEY (sport, game_id, seq),
	FOREIGN KEY (sport, game_id) REFERENCES game(sport, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

-- Current division membership, for scope resolution.
--
-- A snapshot on purpose, and the reason is written at length in
-- data/reference/*-divisions.csv: a division scope means today's clubs each with
-- their whole history, so the NL Central carries the Brewers' American League
-- seasons. Storing history here would invite someone to join on it and quietly
-- change what a division scope means.
CREATE TABLE division_membership (
	sport       TEXT NOT NULL,
	franchise   TEXT NOT NULL,
	conference  TEXT NOT NULL,
	division    TEXT NOT NULL,
	PRIMARY KEY (sport, franchise),
	FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id)
);
