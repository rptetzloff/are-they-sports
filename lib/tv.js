/** TV providers and channels, from the database (0017_tv.sql), as the files
 *  the front pages read.
 *
 *  The pages parse two spreadsheets — channel_lookup.csv, a row a network and
 *  a column a provider, and provider_lookup.csv, a row a provider
 *  (web/<sport>/tv-core.js parseTvLookup) — and a third, simulcasts.csv. They
 *  were the Brewers' files and nobody else's. They are built here, for every
 *  club, from one shared table, in the same shape, so the pages did not
 *  change.
 *
 *  Pure apart from `readTv`, which takes the pool.
 */

/** Everything the lookup files are built from, in one read. */
export async function readTv(p) {
	const [providers, areas, networks, channels] = await Promise.all([
		p.query(`SELECT id, display_name AS "displayName", alternate_names AS "alternateNames", website_url AS "websiteUrl",
		                lineup_url AS "lineupUrl", logo_url AS "logoUrl", logo_bg AS "logoBg", display_logo AS "displayLogo"
		           FROM tv_provider ORDER BY id`),
		p.query('SELECT provider_id AS "providerId", position, name FROM tv_area ORDER BY provider_id, position'),
		p.query(`SELECT id, key, club, aliases, display_name AS "displayName", kind, description, website_url AS "websiteUrl"
		           FROM tv_network ORDER BY position, id`),
		p.query('SELECT provider_id AS "providerId", network_id AS "networkId", area, channel FROM tv_channel'),
	]);
	return { providers: providers.rows, areas: areas.rows, networks: networks.rows, channels: channels.rows };
}

/** A club's simulcast days. */
export async function readSimulcasts(p, sport, club) {
	const { rows } = await p.query(
		'SELECT date::text AS date, channels, note FROM tv_simulcast WHERE sport = $1 AND club = $2 ORDER BY date', [sport, club]);
	return rows;
}

const cell = (v) => {
	const s = v == null ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (values) => values.map(cell).join(',');

/** The networks a club's file lists: everyone's, and the club's own. */
const networksFor = (tv, club) => tv.networks.filter((n) => n.club == null || n.club === club);

/** channel_lookup.csv for one club ('mlb/brewers'): a network a row, a
 *  provider a column. A provider with more than one area gets its areas'
 *  channels in its areas' order, "11 (WZAW) | 1 (WLUK)", an empty place where
 *  an area has none — which tv-core.js keeps, so the next area's channel is
 *  not read as this one's. */
export function channelLookupCsv(tv, club) {
	const providers = tv.providers.map((p) => p.id);
	const areaCount = new Map();
	for (const a of tv.areas) areaCount.set(a.providerId, Math.max(areaCount.get(a.providerId) ?? 0, a.position + 1));
	const byCell = new Map();
	for (const c of tv.channels) {
		const k = `${c.networkId}|${c.providerId}`;
		if (!byCell.has(k)) byCell.set(k, { all: null, areas: new Map() });
		const e = byCell.get(k);
		if (c.area == null) e.all = c.channel;
		else e.areas.set(c.area, c.channel);
	}
	const valueOf = (networkId, providerId) => {
		const e = byCell.get(`${networkId}|${providerId}`);
		if (!e) return '';
		const n = areaCount.get(providerId) ?? 0;
		// One area or none: the channel is the provider's, whichever way it was set.
		if (n < 2) return e.all ?? e.areas.get(0) ?? '';
		if (!e.areas.size) return e.all ?? '';
		return Array.from({ length: n }, (_, i) => e.areas.get(i) ?? e.all ?? '').join(' | ');
	};
	const lines = [line(['key', 'alias', 'display_name', 'type', 'description', 'website_url', ...providers])];
	for (const n of networksFor(tv, club)) {
		lines.push(line([n.key, (n.aliases ?? []).join(','), n.displayName, n.kind, n.description ?? '', n.websiteUrl ?? '',
			...providers.map((p) => valueOf(n.id, p))]));
	}
	return lines.join('\n') + '\n';
}

/** provider_lookup.csv: a provider a row, its areas joined by bars. */
export function providerLookupCsv(tv) {
	const areas = new Map();
	for (const a of tv.areas) {
		if (!areas.has(a.providerId)) areas.set(a.providerId, []);
		areas.get(a.providerId)[a.position] = a.name;
	}
	const lines = [line(['provider', 'display_name', 'alternate_name', 'website_url', 'channel_lineup', 'service_areas', 'logo_url', 'logo_bg', 'display_logo'])];
	for (const p of tv.providers) {
		lines.push(line([p.id, p.displayName, (p.alternateNames ?? []).join(','), p.websiteUrl ?? '', p.lineupUrl ?? '',
			(areas.get(p.id) ?? []).filter(Boolean).join(' | '), p.logoUrl ?? '', p.logoBg ?? '', p.displayLogo ? 'yes' : '']));
	}
	return lines.join('\n') + '\n';
}

/** simulcasts.csv for one club. */
export function simulcastsCsv(rows) {
	return [line(['date', 'channels', 'note']), ...rows.map((r) => line([r.date, r.channels, r.note ?? '']))].join('\n') + '\n';
}
