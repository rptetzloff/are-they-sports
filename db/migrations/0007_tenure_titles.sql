-- Championships won during a stated tenure.
--
-- Without this the leaders page said Vince Lombardi won nothing. His record
-- read 89-29 with a 9-1 postseason, which is right, above a blank in the
-- championship column — and the two together are a page confidently reporting
-- that the man the trophy is named after never won one.
--
-- The cause is the split this schema is built on. A counted tenure derives its
-- titles from the games, because `game.round = 'championship'` is right there.
-- A stated tenure has no games to derive from, and Wikipedia's coach tables
-- carry a W/L and no honours column, so there was nowhere for the fact to live.
--
-- It is NOT stated, though, and that is why this is a list of seasons rather
-- than a count. Every pre-1999 championship game is in `game` with its title
-- already identified by the load; what is missing is only which coach was in
-- charge, and the curated file answers that from the tenure's season span. So
-- these seasons are counted from games exactly the way the postseason W/L on
-- the same row already is — over seasons no other tenure at that club claims,
-- and left out where two tenures share one, because nothing says who coached
-- which game of a shared season.
--
-- A season list, not a number, so the page can print "1961, 1962, 1965, 1966,
-- 1967" the way it does for a counted coach and the two eras render the same.
-- An integer would have been smaller and would have made the two halves of the
-- table visibly different for no reason a reader could act on.

ALTER TABLE leader_tenure
	ADD COLUMN IF NOT EXISTS title_seasons INT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN leader_tenure.title_seasons IS
	'Seasons this tenure won the championship round. Counted from games over unshared seasons, not transcribed.';
