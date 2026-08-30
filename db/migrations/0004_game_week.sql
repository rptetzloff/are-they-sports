-- Which week of the season a game belongs to, where the source says.
--
-- Nullable, and NULL means "this source has no week", not "week zero". The two
-- football sources differ: nflverse carries a real week on all 7,548 of its
-- games from 1999 on, and the FiveThirtyEight seed covering 1920-1998 has no
-- week column at all. Baseball has no weeks and never will.
--
-- Not derived, and that is the point of storing it. Deriving a week from dates
-- looks obvious — seasons start in September and weeks are seven days — and was
-- measured against nflverse's own numbers across four clubs: wrong for 322 of
-- 1,816 games, 17.7%. A postponement shifts every week after it, and 2001 lost
-- its week 2 to September 11th and replayed it at the end of the season, so
-- every later game that year is off by one. A schedule page that quietly
-- mislabels a fifth of its games is worse than one that says it does not know.
--
-- So a season with no weeks groups by date and says so, rather than being given
-- numbers that would be wrong.

ALTER TABLE game ADD COLUMN week INT CHECK (week IS NULL OR week > 0);

-- Existing rows keep NULL until the next load, which is correct rather than a
-- gap to backfill: a row loaded before this column existed has no week recorded
-- and inventing one here would be the same mistake in SQL.
COMMENT ON COLUMN game.week IS 'Week of season from the source; NULL where the source has none (pre-1999 football, all baseball)';
