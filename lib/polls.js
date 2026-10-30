/** A college sport's AP poll, week by week this season, for a programme's
 *  page (Ray, 2026-10-26: its rank through the season, and this week's Top 25).
 *
 *  ESPN's site API answers only this week's polls, whatever week is asked; its
 *  core API has each week's. Football's preseason poll is season type 1, week
 *  1, and every week since type 2, weeks 1 to the latest; basketball's
 *  preseason poll is type 2's week 1 itself. One process asks once for every
 *  club: a finished week's poll never changes and is kept, and the week being
 *  polled is asked again after ten minutes.
 */

/** The sports with polls, by ESPN's address for each; football's preseason
 *  poll a season type of its own. */
export const POLLED = {
	ncaaf: { league: 'football/college-football', preseasonType: 1 },
	ncaam: { league: 'basketball/mens-college-basketball', preseasonType: null },
	ncaaw: { league: 'basketball/womens-college-basketball', preseasonType: null },
};
/** This week's polls, ESPN's site API. */
export const rankingsUrl = (sport) => `https://site.api.espn.com/apis/site/v2/sports/${POLLED[sport].league}/rankings`;
const coreOf = (sport) => { const [k, n] = POLLED[sport].league.split('/'); return `https://sports.core.api.espn.com/v2/sports/${k}/leagues/${n}`; };
const AP = 1;
const FRESH_MS = 10 * 60 * 1000;

/** `{ season, latest }` where `latest` is the last regular-season week ESPN has
 *  a poll for, from this week's rankings. */
export function latestOf(json) {
	const season = Number(json?.latestSeason?.year ?? json?.requestedSeason?.year) || null;
	const latest = Number(json?.latestWeek?.number) || 0;
	return { season, latest };
}

/** A core-API poll as `{ label, ranks: Map(teamId -> rank) }`. The team's id is
 *  the last number in its link: .../seasons/2026/teams/251?lang=en. */
export function pollOf(json, label) {
	const ranks = new Map();
	for (const r of json?.ranks ?? []) {
		const id = /\/teams\/(\d+)/.exec(r.team?.$ref ?? '')?.[1];
		if (id && r.current) ranks.set(id, r.current);
	}
	return { label: json?.occurrence?.displayValue || label, ranks };
}

/** The weeks of `season` up to `latest`, as the core API addresses them.
 *  Basketball's week 1 is its preseason poll (the poll's own name, which
 *  pollOf reads, says so); its label here is only for a week ESPN lacks. */
export function weeksOf(season, latest, sport = 'ncaaf') {
	const core = coreOf(sport);
	const pre = POLLED[sport].preseasonType;
	const out = pre ? [{ url: `${core}/seasons/${season}/types/${pre}/weeks/1/rankings/${AP}`, label: 'Preseason' }] : [];
	for (let w = 1; w <= latest; w++) out.push({ url: `${core}/seasons/${season}/types/2/weeks/${w}/rankings/${AP}`, label: !pre && w === 1 ? 'Preseason' : `Week ${w}` });
	return out;
}

/** The season's AP polls, oldest first. `getJson(url)` fetches; it is the one
 *  thing a test replaces. */
export function createPolls({ sport = 'ncaaf', getJson = defaultGet, now = Date.now } = {}) {
	const kept = new Map(); // url -> { at, poll }
	let latest = { at: 0, value: null };
	return async function seasonPolls() {
		if (!latest.value || now() - latest.at > FRESH_MS) {
			const json = await getJson(rankingsUrl(sport)).catch(() => null);
			if (json) latest = { at: now(), value: latestOf(json) };
		}
		const { season, latest: last } = latest.value ?? {};
		if (!season) return [];
		const weeks = weeksOf(season, last, sport);
		const polls = await Promise.all(weeks.map(async ({ url, label }, i) => {
			const have = kept.get(url);
			// Every week but the newest is settled.
			if (have && (i < weeks.length - 1 || now() - have.at < FRESH_MS)) return have.poll;
			const json = await getJson(url).catch(() => null);
			if (!json) return have?.poll ?? { label, ranks: new Map() };
			const poll = pollOf(json, label);
			kept.set(url, { at: now(), poll });
			return poll;
		}));
		// A week with no poll (2026 has none for week 1: the preseason's stood
		// until week 2) is no week of the season's.
		return polls.filter((p) => p.ranks.size);
	};
}

async function defaultGet(url) {
	const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	// No poll that week: an answer, kept like any other, not a failure.
	if (r.status === 404) return {};
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return r.json();
}

/** The process's one a sport, shared by every club of it. */
const shared = new Map();
export const sharedPolls = (sport = 'ncaaf') => {
	if (!shared.has(sport)) shared.set(sport, createPolls({ sport }));
	return shared.get(sport);
};
