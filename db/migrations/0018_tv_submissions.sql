-- Channel submissions, and what became of each (Ray, 2026-10-21: "a framework
-- for submitting channels and approving them... database driven").
--
-- Anyone may submit, with no account; nothing changes the TV tables (0017)
-- until Ray approves it on /admin, behind the password Coolify holds
-- (ADMIN_PASSWORD). A submission names a provider, an area, a network and a
-- channel number, each either one already on file (its id) or a new one (its
-- name), and approving it creates whatever is new and sets the number
-- (lib/tv-admin.js applyChannel). What was applied is kept with it.
--
-- The submitter's address is not kept, only a keyed hash of it, which is
-- enough to see that thirty submissions came from one place.

CREATE TABLE tv_submission (
	id             serial PRIMARY KEY,
	created_at     timestamptz NOT NULL DEFAULT now(),
	provider_id    text REFERENCES tv_provider (id) ON DELETE SET NULL,
	provider_name  text,
	provider_url   text,
	area_name      text,
	network_id     integer REFERENCES tv_network (id) ON DELETE SET NULL,
	network_name   text,
	network_kind   text CHECK (network_kind IS NULL OR network_kind IN ('broadcast', 'cable', 'regional', 'streaming', 'radio')),
	channel        text NOT NULL CHECK (channel <> ''),
	note           text,
	contact        text,
	source_hash    text,
	status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
	reviewed_at    timestamptz,
	review_note    text,
	-- What approving it did: the provider, area, network and channel it set.
	applied        jsonb,
	CHECK (provider_id IS NOT NULL OR provider_name IS NOT NULL),
	CHECK (network_id IS NOT NULL OR network_name IS NOT NULL)
);
CREATE INDEX tv_submission_pending ON tv_submission (created_at) WHERE status = 'pending';
