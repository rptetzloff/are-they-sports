-- The WNBA's own records as a source.
--
-- `wnba` is the league's stats site (stats.wnba.com), for the five seasons ESPN
-- does not cover whole: 1997-2001, committed as
-- data/reference/wnba-games-1997-2001.csv because that site answers only a
-- browser. Reproducible, because the file is in the repository. Authority 100,
-- as the other leagues' own records. Ray approved using it on 2026-10-20, with
-- the WNBA credited as the source.
INSERT INTO source (id, authority, reproducible, note) VALUES
	('wnba', 100, TRUE, 'WNBA 1997-2001, the league''s own game logs (stats.wnba.com), committed')
ON CONFLICT (id) DO NOTHING;
