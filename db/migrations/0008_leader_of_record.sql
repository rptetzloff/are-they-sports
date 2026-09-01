-- Who held the job, as distinct from who ran the game.
--
-- `game_leader.leader` used to mean "the manager Retrosheet names for this
-- game", and that is not the question a leaders page asks. Retrosheet is right:
-- when Bobby Cox was ejected, Bobby Dews managed the rest of the game and the
-- game log says so. But a coaching record is a tenure, and crediting Dews with
-- three wins in 1980 took them off Cox — who came out 2493-1998 against a
-- published 2504-2001, a gap of about 0.3% made entirely of ejections,
-- illnesses and suspensions.
--
-- So the columns are split rather than the fact being thrown away:
--
--   leader  who HELD the job. This is what every record on the page counts.
--   ran     who actually managed the game, when that was somebody else.
--           NULL otherwise, which is the overwhelming majority of rows.
--
-- Keeping `ran` costs a sparse column and preserves a fact the source went to
-- the trouble of recording. Overwriting it would mean the fold could never be
-- re-tuned, or even audited, without reloading 435,812 rows from the game logs.
--
-- THE FOLD IS NOT A GAME COUNT. A stint is credited back only when the SAME
-- leader is on both sides of it, because that is what separates covering an
-- absence from taking the job:
--
--     Cox ... Dews (3) ... Cox           Dews was covering. Fold.
--     Cox ... Gonzalez (162) ...         Cox left. Gonzalez held the job.
--     Cox ... an interim (25) ... Snitker  A firing. The interim keeps his row.
--
-- Measured before the threshold was chosen: baseball has 1,019 stints bracketed
-- by the same manager against 1,236 that hand over to somebody else, and no
-- handover is folded at any length, because it fails the same-leader test rather
-- than the length test. The length is `rules.fillInMaxGames` on the sport --
-- fifteen games for baseball, which is what build_coach_tenures.py uses, and
-- three for football.
--
-- Football folds nothing at all, and that is a measurement rather than an
-- oversight: of 246 runs of consecutive games under one coach, exactly two are
-- bracketed by the same coach, and both are 50+ games -- real tenures, not
-- fill-ins. nflverse names the head coach of record for every game and never the
-- assistant who stood in.

ALTER TABLE game_leader
	ADD COLUMN IF NOT EXISTS ran TEXT;

-- No foreign key onto `leader`, deliberately. `ran` names somebody who may have
-- managed a single game and who the page never lists, and requiring a `leader`
-- row for them would put people in the identity table whose only purpose is to
-- be excluded from it. The id still comes from the same source and the same
-- pass, so it joins when a caller wants it.

CREATE INDEX IF NOT EXISTS game_leader_stand_ins ON game_leader (sport, ran)
	WHERE ran IS NOT NULL;

COMMENT ON COLUMN game_leader.leader IS
	'Who held the job for this game. What the leaders page counts.';
COMMENT ON COLUMN game_leader.ran IS
	'Who actually ran the game, when a stand-in did. NULL when that is the leader.';
