-- The source of every NBA game from 2002: sportsdataverse's espn_nba_schedules
-- releases, which are ESPN's own records republished season by season under
-- CC BY 4.0.
--
-- Authority 90, above the live capture (espn, 10) and below the leagues' own
-- archives. The ids are ESPN's event ids in both, so a game captured live during
-- a season is the same row the season's release later supersedes — which is the
-- only reason the ranking matters, and the upsert's WHERE clause reads it.
--
-- FiveThirtyEight (90) already exists, from football; its NBA file covers
-- 1947-2001 here.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('sportsdataverse', 90, TRUE, 'NBA 2002+, ESPN schedules republished under CC BY 4.0')
ON CONFLICT (id) DO NOTHING;
