-- Overtime and shootout losses in a stated tenure.
--
-- Hockey's coaches come as tenures (data/reference/nhl-coaches.csv, from
-- Wikipedia's lists and counted from the games where a coach had every game of
-- his seasons), and a hockey record is wins, losses, ties and overtime losses:
-- from 1999-2000 a loss in overtime or a shootout is its own column, worth a
-- point. Folding them into losses would understate every modern coach's points
-- and into ties would invent ties after 2005. Zero for every other sport.
ALTER TABLE leader_tenure ADD COLUMN IF NOT EXISTS otl INT NOT NULL DEFAULT 0;
ALTER TABLE leader_tenure DROP CONSTRAINT IF EXISTS tenure_otl_nonnegative;
ALTER TABLE leader_tenure ADD CONSTRAINT tenure_otl_nonnegative CHECK (otl >= 0);
