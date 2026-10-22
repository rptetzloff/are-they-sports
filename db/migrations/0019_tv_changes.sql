-- Every change to the TV tables made on /admin, with what it was before and
-- after (lib/tv-listings.js). The full listings let Ray edit and delete
-- providers, areas, networks and channels in place (Ray, 2026-10-21: "can the
-- admin see the full channel listings?"), and a delete cannot be taken back
-- any other way; this is what was there, to put back by hand.
--
-- Approvals already keep what they applied on their submission (0018); they
-- are recorded here too, so this is the one list of what changed.

CREATE TABLE tv_change (
	id      serial PRIMARY KEY,
	at      timestamptz NOT NULL DEFAULT now(),
	-- 'channel.set', 'channel.clear', 'provider.edit', 'provider.delete',
	-- 'area.add', 'area.rename', 'area.delete', 'network.add', 'network.edit',
	-- 'network.delete', 'submission.approve'
	action  text NOT NULL,
	-- What it was done to, as a reader would name it: 'amherst · FOX · Portage'.
	subject text NOT NULL,
	before  jsonb,
	after   jsonb
);
CREATE INDEX tv_change_at ON tv_change (at DESC);

-- Amherst's logo was kept from the Brewers' site as '/logos/AmherstComm.svg',
-- from the root, which a site of many clubs answers for nobody. Relative, as
-- every path a club page uses is; every club serves it (data/tv-logos).
UPDATE tv_provider SET logo_url = 'logos/AmherstComm.svg' WHERE logo_url = '/logos/AmherstComm.svg';
