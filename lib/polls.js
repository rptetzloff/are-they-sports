/** College football's AP poll, week by week this season, for a programme's
 *  page (Ray, 2026-10-26: its rank through the season, and this week's Top 25).
 *
 *  ESPN's site API answers only this week's polls, whatever week is asked; its
 *  core API has each week's: the preseason poll (season type 1, week 1) and
 *  every week since (type 2, weeks 1 to the latest). One process asks once for
 *  every club: a finished week's poll never changes and is kept, and the week
 *  being polled is asked again after ten minutes.
 */

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
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

/** The weeks of `season` up to `latest`, as the core API addresses them. */
export function weeksOf(season, latest) {
	const out = [{ url: `${CORE}/seasons/${season}/types/1/weeks/1/rankings/${AP}`, label: 'Preseason' }];
	for (let w = 1; w <= latest; w++) out.push({ url: `${CORE}/seasons/${season}/types/2/weeks/${w}/rankings/${AP}`, label: `Week ${w}` });
	return out;
}

/** The season's AP polls, oldest first. `getJson(url)` fetches; it is the one
 *  thing a test replaces. */
export function createPolls({ getJson = defaultGet, now = Date.now } = {}) {
	const kept = new Map(); // url -> { at, poll }
	let latest = { at: 0, value: null };
	return async function seasonPolls() {
		if (!latest.value || now() - latest.at > FRESH_MS) {
			const json = await getJson(SITE).catch(() => null);
			if (json) latest = { at: now(), value: latestOf(json) };
		}
		const { season, latest: last } = latest.value ?? {};
		if (!season) return [];
		const weeks = weeksOf(season, last);
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

/** The process's one, shared by every college club. */
let shared = null;
export const sharedPolls = () => (shared ??= createPolls());
