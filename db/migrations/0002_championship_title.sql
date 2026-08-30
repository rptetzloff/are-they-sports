-- What a championship game was actually called.
--
-- `round = 'championship'` says a game decided a title. It cannot say which
-- title, and the name is not derivable from the season alone: 1936 was the NFL
-- Championship, 1966 was both an NFL Championship and the first Super Bowl, and
-- a 1962 title in the AFL was the AFL Championship while the NFL played its own
-- that year.
--
-- Deriving it at render time would need the league of both clubs in that season,
-- which the renderer has no business knowing. The loader already resolves that
-- to decide which games are titles at all, so it writes the answer down.
--
-- Null for every other game, and for a championship whose league could not be
-- determined — in which case the page falls back to the club's own vocabulary
-- rather than inventing a name.
ALTER TABLE game ADD COLUMN title TEXT;

COMMENT ON COLUMN game.title IS
	'Display name of the title decided, e.g. "Super Bowl" or "NFL Championship". Null unless round = championship.';
