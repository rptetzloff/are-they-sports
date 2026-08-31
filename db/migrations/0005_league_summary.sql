-- What a finished season works out to, stored instead of worked out again.
--
-- A season that has been played does not change. The record book for 1962 is
-- the same on every request, in every container, after every restart — and it
-- was being recomputed for all of them, from 471,453 game rows, because nothing
-- wrote the answer down. Measured: 232-400ms per computation against 2-5ms to
-- read one row.
--
-- This is derived data and stays derived. Nothing hand-edits it, every row
-- names the inputs it came from, and the whole table can be dropped and rebuilt
-- from `game` — which is the test CLAUDE.md sets for a committed artifact, and
-- the reason this is a cache and not a source. `version` is what makes that
-- true rather than hopeful: a row whose version does not match its inputs is
-- ignored and recomputed, so a stale summary can be wrong for one request and
-- not for a deployment.
--
-- Keyed by view and season rather than one blob per sport, because they are
-- invalidated on different schedules: the standings for 2011 never move again,
-- while the ones for the season being played move every time a game ends.

CREATE TABLE IF NOT EXISTS league_summary (
	-- The scope this was computed for, not just the sport. `/records` under
	-- SCOPE=division:nfl/nfc-north is four clubs and under SCOPE=sport:nfl is
	-- thirty-two, and they are different answers to the same question. Keyed on
	-- the sport alone, a division deployment and a league one sharing a database
	-- would serve each other's record books.
	scope        text        NOT NULL,
	sport        text        NOT NULL REFERENCES sport(id),
	view         text        NOT NULL,
	-- 0 for the views that are not about one season, so the key can be simple.
	-- A nullable column in a primary key is not one.
	season       int         NOT NULL DEFAULT 0,

	-- What the inputs were when this was computed: every club's franchise and
	-- the stamp its rows were last observed at, plus the build that computed it.
	-- The build matters because a change to how records are computed does not
	-- move any stamp — without it, a deploy that fixed a records bug would keep
	-- serving the bug from this table.
	version      text        NOT NULL,

	payload      jsonb       NOT NULL,
	computed_at  timestamptz NOT NULL DEFAULT now(),

	PRIMARY KEY (scope, sport, view, season)
);

-- The whole read path: one lookup by the primary key. No index beyond it is
-- needed and none is added, because an index nothing uses is a write cost that
-- looks like diligence.

COMMENT ON TABLE league_summary IS
	'Derived league-wide results, keyed by the inputs they were computed from. Safe to TRUNCATE: every row rebuilds on demand.';
