-- Penalties, and who won.
--
-- A soccer game can be level after extra time and still have a winner: the
-- shootout. MLS settled every level game that way in 1996-1999, and a playoff
-- game still is. The score stays the score (1-1); the shootout is its own pair
-- of numbers, NULL wherever there was none, which is every game of the other
-- sports.
--
-- `winner` is the one place a result is decided: the higher score, otherwise
-- the higher shootout, otherwise nobody (a draw, or a game not finished). Every
-- query that asked "home_score > away_score" asks this instead, so a shootout
-- winner is the winner everywhere at once. Ray chose it on 2026-10-20: the
-- shootout winner wins, as MLS's own 1996-1999 standings count it. For every
-- other sport it is the higher score, as before.
--
-- `mls` is MLS's own stats API (stats-api.mlssoccer.com), every game since 1996.
-- Authority 100, as the other leagues' own records. Ray approved it on
-- 2026-10-20, with MLS credited.
ALTER TABLE game ADD COLUMN IF NOT EXISTS home_pens integer;
ALTER TABLE game ADD COLUMN IF NOT EXISTS away_pens integer;
ALTER TABLE game DROP CONSTRAINT IF EXISTS game_pens_check;
ALTER TABLE game ADD CONSTRAINT game_pens_check CHECK ((home_pens IS NULL) = (away_pens IS NULL));

ALTER TABLE game DROP COLUMN IF EXISTS winner;
ALTER TABLE game ADD COLUMN winner text GENERATED ALWAYS AS (
	CASE
		WHEN status <> 'final' THEN NULL
		WHEN home_score > away_score THEN home
		WHEN away_score > home_score THEN away
		WHEN home_pens > away_pens THEN home
		WHEN away_pens > home_pens THEN away
	END) STORED;

INSERT INTO source (id, authority, reproducible, note) VALUES
	('mls', 100, TRUE, 'MLS 1996+, the league''s own stats API')
ON CONFLICT (id) DO NOTHING;
