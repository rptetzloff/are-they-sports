-- A source code belongs to exactly one franchise.
--
-- The primary key was (sport, code, franchise), which makes "LV is LV" and
-- "LV is OAK" two different rows rather than a contradiction. So the loader's
-- ON CONFLICT DO NOTHING never conflicted, both rows were inserted, and
-- franchise_code accumulated every mapping it had ever been told without any
-- way to correct one. Re-running the load could not fix it.
--
-- That is what rolled back the deployment of PR #29. The server asked the
-- database which franchise the Raiders' codes named, got LV and OAK, and
-- exited — one club's stale row taking all thirty-two clubs down, on a server
-- where redeploying could never help because the wrong data was not in the
-- image.
--
-- The server no longer asks this table at all; it resolves codes from the
-- reference CSV that ships with the code, which cannot be out of step with the
-- manifests written against it. The table stays because the loader records what
-- it actually mapped, which is worth having, but it is derived data and is
-- rebuilt per sport on every load now rather than appended to.
--
-- Emptied rather than deduplicated. Picking a survivor would need the reference
-- table, which SQL does not have, and the next `node scripts/load.mjs` writes
-- every row back from it. Nothing reads this table between the two: the boot
-- path that did is the thing being fixed.

DELETE FROM franchise_code;

ALTER TABLE franchise_code DROP CONSTRAINT franchise_code_pkey;
ALTER TABLE franchise_code ADD PRIMARY KEY (sport, code);
