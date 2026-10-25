/** ESPN, proxied and cached, for the adopted front end.
 *
 *  Ported from the baseball site's server.js and lib/espn-target.js, which the
 *  football site's lib/espn-proxy.js matches in every rule that matters: the
 *  same allowlist shape, the same TTL ladder, the same stale-on-error. The
 *  baseball one is the superset — it knows `/types/3` and day scoreboards,
 *  which its bracket needs — so it is the one taken.
 *
 *  What changed is only what was a literal. The sites each allowlisted ONE
 *  club's schedule (`teams/mil/schedule`, `teams/gb/schedule`); here the
 *  allowlist is built per deployment from the club's ESPN abbreviation, which
 *  the franchise history table already carries for every club.
 *
 *  The browser never names an upstream URL. It names a path from the table
 *  below and numeric parameters, and the URL is rebuilt from the table, so the
 *  proxy cannot be pointed anywhere else.
 */

const BASE = 'https://site.api.espn.com/';

/** The endpoints one club's front page uses, as path -> allowed params.
 *  `league` is ESPN's sport/league path, `slug` the club's lowercase abbr. */
export function endpointsFor({ league, slug, standings = false }) {
	const site = `apis/site/v2/sports/${league}`;
	const list = [
		[`${site}/teams/${slug}/schedule`, ['season', 'seasontype']],
		[`${site}/scoreboard`, []],
		[`${site}/summary`, ['event']],
	];
	// Only baseball's front page opens a standings table from ESPN; football's
	// never asked, and an endpoint nobody calls is surface for nothing.
	if (standings) list.push([`apis/v2/sports/${league}/standings`, ['group', 'season', 'level']]);
	return new Map(list.map(([path, params]) => [path, { path, params }]));
}

/** What a league's page may ask ESPN (web/<sport>/league.js): the
 *  scoreboard for any day or football week, and a game's summary. No team's
 *  schedule — the page is nobody's. */
export function leagueEndpoints({ league }) {
	const site = `apis/site/v2/sports/${league}`;
	return new Map([
		[`${site}/scoreboard`, ['dates', 'seasontype', 'week']],
		[`${site}/summary`, ['event']],
	].map(([path, params]) => [path, { path, params }]));
}

/** The upstream URL for a proxied request, or null to refuse it.
 *  `path` is the part after /api/espn/; `search` is the raw query string. */
export function espnTarget(endpoints, path, search = '') {
	const endpoint = endpoints.get(path);
	if (!endpoint) return null;
	const given = new URLSearchParams(search);
	for (const key of given.keys()) if (!endpoint.params.includes(key)) return null;
	const out = new URLSearchParams();
	for (const name of endpoint.params) {
		const value = given.get(name);
		if (value === null) continue;
		if (!/^\d{1,12}$/.test(value)) return null;
		out.set(name, String(Number.parseInt(value, 10)));
	}
	const query = out.toString();
	return `${BASE}${endpoint.path}${query ? `?${query}` : ''}`;
}

export const LIVE_TTL = 15 * 1000;
export const TTL = 60 * 1000;
export const IDLE_TTL = 60 * 60 * 1000;
export const FINAL_TTL = 24 * 60 * 60 * 1000;
// The shared cache's budget: a week's scoreboards and schedules for every
// club take a few megabytes; the rest is room for live summaries.
const MAX_BYTES = 128 * 1024 * 1024;
const GAME_SOON_MS = 2 * 60 * 60 * 1000;
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;
// How long past its lifetime an entry may stand in while ESPN is failing: ten
// minutes for anything that changes fast, its own lifetime for what does not.
const MAX_STALE_MS = 10 * 60 * 1000;

/** How long one upstream response stays fresh. The baseball site's rules,
 *  unchanged; see the header for why that one. */
export function ttlFor(target, status, body, now = Date.now()) {
	if (status !== 200) return TTL;
	// Settled, but for three days ESPN still corrects a final's stats and moves
	// a postponed game: an hour then, a day after.
	const settled = (dates) => (dates.some((d) => now - Date.parse(d || '') < RECENT_MS) ? IDLE_TTL : FINAL_TTL);
	try {
		if (target.includes('/summary?')) {
			const comp = JSON.parse(body)?.header?.competitions?.[0];
			const st = comp?.status?.type;
			return st?.completed ? settled([comp?.date]) : st?.state === 'in' ? LIVE_TTL : TTL;
		}
		// A postseason's dates (/api/bracket) are set a season ahead.
		if (target.includes('/types/3')) return FINAL_TTL;
		// A schedule, or one day's scoreboard: settled once every game in it is.
		if (target.includes('/schedule') || target.includes('/scoreboard?dates=')) {
			const events = JSON.parse(body)?.events || [];
			let allDone = events.length > 0;
			for (const e of events) {
				const st = e?.competitions?.[0]?.status?.type;
				// 'post' covers finals AND postponements without a makeup date;
				// both are settled; for three days after, the hour's lifetime notices a
				// reschedule or a corrected score (settled, above).
				if (st?.state === 'post') continue;
				allDone = false;
				if (st?.state === 'in') return TTL;
				const startsIn = Date.parse(e?.date || '') - now;
				if (Number.isNaN(startsIn) || startsIn < GAME_SOON_MS) return TTL;
			}
			return allDone ? settled(events.map((e) => e?.date)) : IDLE_TTL;
		}
	} catch { /* unparseable: treat as volatile */ }
	return TTL;
}

/** The browser's max-age for a proxied response: short while anything could
 *  change, longer once the server has decided it will not. */
export function browserMaxAge(cacheState, ttl) {
	return cacheState === 'stale' || ttl <= TTL ? 15 : ttl === IDLE_TTL ? 300 : 3600;
}

/** One cache per process (lib/web-routes.js shares one across every club and
 *  league page: the key is the upstream URL, which is the same for all 32
 *  football clubs asking for the week's scoreboard). Requests arriving while
 *  the same URL is being fetched share that fetch, so a live game's viewers
 *  make one ESPN call per refresh between them, not one each. On a fetch error
 *  the last good entry is served as `stale`; with nothing cached the answer is
 *  null.
 *
 *  Bounded by bytes, not entries: a game summary is up to 600KB and a team's
 *  schedule a few, so a count said nothing about memory. Past the budget the
 *  expired go first, then the oldest -- never the whole cache at once, which
 *  dropped every live entry with it. */
export function createEspnCache({ fetchImpl = fetch, now = Date.now, maxBytes = MAX_BYTES } = {}) {
	const cache = new Map();
	const inFlight = new Map();
	let bytes = 0;
	const drop = (k) => { bytes -= cache.get(k).body.length; cache.delete(k); };
	const makeRoom = (size) => {
		if (bytes + size <= maxBytes) return;
		for (const [k, v] of cache) if (now() - v.at >= v.ttl) drop(k);
		// A Map iterates in insertion order, and a refetch re-inserts, so the
		// first key is the one fetched longest ago.
		for (const k of cache.keys()) { if (bytes + size <= maxBytes) break; drop(k); }
	};
	const espnFetch = async function espnFetch(target) {
		const hit = cache.get(target);
		if (hit && now() - hit.at < hit.ttl) return { ...hit, cacheState: 'hit' };
		if (!inFlight.has(target)) {
			inFlight.set(target, (async () => {
				try {
					const r = await fetchImpl(target);
					const body = await r.text();
					if (cache.has(target)) drop(target);
					makeRoom(body.length);
					const entry = { at: now(), status: r.status, body, ttl: ttlFor(target, r.status, body, now()) };
					cache.set(target, entry);
					bytes += body.length;
					return { ...entry, cacheState: 'miss' };
				} catch {
					// Never a live score from an hour ago presented as current.
					const usable = hit && now() - hit.at < hit.ttl + Math.max(MAX_STALE_MS, hit.ttl);
					return usable ? { ...hit, cacheState: 'stale' } : null;
				} finally {
					inFlight.delete(target);
				}
			})());
		}
		return inFlight.get(target);
	};
	// What it holds, for /healthz and the tests.
	espnFetch.stats = () => ({ entries: cache.size, bytes });
	return espnFetch;
}
