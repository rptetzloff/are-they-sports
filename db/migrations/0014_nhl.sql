-- Hockey: how a game ended, and the league's own records as a source.
--
-- `ending` is REG, OT or SO: whether the game was settled in regulation, in
-- overtime, or in a shootout. A hockey record is wins, losses and OVERTIME
-- losses — "12-5-3" — because since 2005-06 a game tied after regulation is
-- worth a point to the loser, and before that it could end tied. Two scores
-- cannot say which: a 3-2 game reads the same either way. NULL where the source
-- does not say, which is every game of the other sports.
--
-- `nhl` is the NHL's public stats and schedule APIs (api.nhle.com and
-- api-web.nhle.com), the league's own record of every game since 1917, used
-- for both history and the season being played. Authority 100, as the other
-- leagues' authoritative sources. Ray approved using it on 2026-10-19, with the
-- NHL credited as the source.
ALTER TABLE game ADD COLUMN IF NOT EXISTS ending text;
ALTER TABLE game DROP CONSTRAINT IF EXISTS game_ending_check;
ALTER TABLE game ADD CONSTRAINT game_ending_check CHECK (ending IS NULL OR ending IN ('REG', 'OT', 'SO'));

INSERT INTO source (id, authority, reproducible, note) VALUES
	('nhl', 100, TRUE, 'NHL 1917+, the league''s own stats and schedule APIs')
ON CONFLICT (id) DO NOTHING;
