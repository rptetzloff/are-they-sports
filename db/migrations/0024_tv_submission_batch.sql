-- A whole lineup suggested at once.
--
-- A suggestion was one channel. A provider's whole lineup is many, and sent
-- one at a time it was a dozen forms and a dozen cards to approve. Now a
-- lineup is its channels as submissions sharing a batch (the first one's id),
-- shown to the admin as one card and approved or rejected together; each
-- channel is still applied as one would be (lib/tv-admin.js applyChannel).
-- NULL for a single channel.
ALTER TABLE tv_submission ADD COLUMN IF NOT EXISTS batch INTEGER;
CREATE INDEX IF NOT EXISTS tv_submission_batch ON tv_submission (batch) WHERE batch IS NOT NULL;
