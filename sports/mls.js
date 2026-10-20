/** The MLS adapter: where soccer's games come from, and how they become rows.
 *
 *  ONE SOURCE, the league's own: MLS's stats API (stats-api.mlssoccer.com) has
 *  every game since 1996, regular season and Cup playoffs, with every score and
 *  every shootout from 1996 to 1999 and from 2013. Ray approved it on
 *  2026-10-20, with MLS credited. The same API scores the season being played,
 *  under the same ids, so live rows and authoritative ones are one row.
 *
 *  THE 2000-2012 PLAYOFF SHOOTOUTS are not in it. The eight that decided a
 *  game or a series are data/reference/mls-shootouts.csv, from Wikipedia, each
 *  tied to MLS's match id; see its header.
 *
 *  A SHOOTOUT WINNER WINS (Ray, 2026-10-20), as MLS's own 1996-1999 standings
 *  count it: Tampa Bay's 1996 is 20-0-12. The score stays the score; the
 *  shootout is homePens and awayPens, and the game's winner (0016) reads them
 *  when the score is level.
 *
 *  A SEASON IS THE CALENDAR YEAR, MLS Cup in December included.
 *
 *  WHAT COUNTS: the regular season (MLS-COM-000001) and the Cup playoffs
 *  (000002). From 2023 a season's matches include MLS NEXT Pro, Leagues Cup and
 *  the rest, which do not.
 */

const API = 'https://stats-api.mlssoccer.com';
export const REGULAR = 'MLS-COM-000001';
export const PLAYOFFS = 'MLS-COM-000002';
const COUNTED = new Set([REGULAR, PLAYOFFS]);

/** MLS's id for a season: one step in base 36 a year, 1996's 0001JG to 2026's
 *  0001KA, which the season being played is worked out from. A season MLS
 *  numbered otherwise would answer 404, and the load says which. */
export const seasonId = (season) =>
	`MLS-SEA-${(Number.parseInt('0001JG', 36) + Number(season) - 1996).toString(36).toUpperCase().padStart(6, '0')}`;

/** A season's counted matches, page by page. */
export async function fetchSeason(season, { get = fetchJson } = {}) {
	const out = [];
	for (const competition of [REGULAR, PLAYOFFS]) {
		let token = '';
		do {
			const j = await get(`${API}/matches/seasons/${seasonId(season)}?match_date%5Bgte%5D=${season}-01-01&match_date%5Blte%5D=${season}-12-31`
				+ `&competition_id=${competition}&per_page=500${token ? `&page_token=${encodeURIComponent(token)}` : ''}`);
			out.push(...(j.schedule ?? []));
			token = j.next_page_token || '';
		} while (token);
	}
	return out;
}

async function fetchJson(url) {
	for (let i = 0; ; i++) {
		const r = await fetch(url, { headers: { 'User-Agent': 'are-they-sports' } });
		if (r.ok) return r.json();
		await r.body?.cancel().catch(() => {});
		if (i >= 4 || (r.status !== 429 && r.status < 500)) throw new Error(`${r.status} ${r.statusText} for ${url}`);
		await new Promise((res) => setTimeout(res, 5000 * 2 ** i));
	}
}

export const sources = {
	/** Every season's matches, fetched a page at a time (fetchSeason). */
	schedules: { perSeason: true, from: 1996, fetch: fetchSeason },
	/** The 2000-2012 playoff shootouts MLS's data lacks. */
	shootouts: { reference: 'mls-shootouts.csv' },
	live: {
		url: (yyyymmdd) => `${API}/matches/seasons/${seasonId(yyyymmdd.slice(0, 4))}?match_date=${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}&per_page=500`,
		/** MLS answers `schedule`, not ESPN's `events`. */
		eventsOf: (json) => json?.schedule ?? [],
		/** Mid-February to mid-December: the first matchday to MLS Cup. */
		daysOf(season) {
			const out = [];
			for (let d = new Date(Date.UTC(season, 1, 15)); d <= new Date(Date.UTC(season, 11, 15)); d.setUTCDate(d.getUTCDate() + 1)) {
				out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
			}
			return out;
		},
		recentDays(now) {
			const day = (offset) => {
				const d = new Date(now);
				d.setUTCDate(d.getUTCDate() + offset);
				return d.toISOString().slice(0, 10).replace(/-/g, '');
			};
			return [day(-2), day(-1), day(0)];
		},
		/** The calendar year. */
		seasonOf: (date) => date.getUTCFullYear(),
		source: 'mls',
	},
};

// Wikipedia, for the 2000-2012 shootouts, is credited in lib/credits.js with
// the other sports' Wikipedia notes.
export const credits = [
	{
		name: 'MLS',
		url: 'https://www.mlssoccer.com',
		note: 'every game since 1996, from the league\'s own stats',
	},
];

/** A match's local date. MLS gives the kick-off in UTC, and an evening game in
 *  the west is already tomorrow there; read in Pacific time, every MLS kick-off
 *  (none is before 9 a.m. Pacific or after 3 a.m. Eastern) is on its own date. */
export const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso));

/** One MLS match as a row, or null for one that does not count.
 *
 *  `franchiseOf` takes MLS's team id, which the franchise table carries as
 *  mlsAbbrv: MLS's rows for 2013-2015 often have no three-letter code. The
 *  Final is the championship round; 2013-2015 name no round, and the load
 *  marks each of those seasons' last playoff game. */
export function gameRow(m, { franchiseOf, knows = null } = {}) {
	if (!COUNTED.has(m?.competition_id)) return null;
	if (!m.home_team_id || !m.away_team_id || /^TBC/i.test(`${m.home_team_name} ${m.away_team_name}`)) return null;
	if (knows && (!knows(m.home_team_id) || !knows(m.away_team_id))) return null;
	const final = m.match_status === 'finalWhistle';
	const playoff = m.competition_id === PLAYOFFS;
	const pens = final && m.home_team_penalty_goals != null && m.away_team_penalty_goals != null;
	return {
		id: m.match_id,
		season: Number(m.season),
		date: localDate(m.planned_kickoff_time),
		round: !playoff ? 'regular' : m.match_type === 'Final' ? 'championship' : 'playoff',
		// MLS's own word for the round, as 0011 keeps every source's.
		stage: playoff ? (m.section_name || m.match_type || null) : null,
		ending: pens ? 'SO' : null,
		home: franchiseOf(m.home_team_id),
		away: franchiseOf(m.away_team_id),
		homeScore: final ? Number(m.home_team_goals) : null,
		awayScore: final ? Number(m.away_team_goals) : null,
		homePens: pens ? Number(m.home_team_penalty_goals) : null,
		awayPens: pens ? Number(m.away_team_penalty_goals) : null,
		neutral: Boolean(m.neutral_venue),
		status: final ? 'final' : 'scheduled',
		source: 'mls',
	};
}

/** The live refresh's row: the same match, the same reading. */
export const liveGameRow = (m, opts) => gameRow(m, opts);

/** No doubleheaders, and MLS's ids are unique. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

export const championshipTitle = () => 'MLS Cup';

export const defaults = {
	nouns: {
		scoreNoun: 'goals',
		scoreForLabel: 'Goals For',
		scoreAgainstLabel: 'Goals Against',
		championship: 'MLS Cup',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Football's list without the lossless seasons, which no MLS club has had.
	 *  Ties stay: a draw has been a result since 2000. */
	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'championship-appearances', 'ties',
	],
	rules: {
		streaksSpanSeasons: false,
		fillInMaxGames: 5,
		losslessSeasonIsPlausible: false,
		onThisDayWindowDays: 0,
		schedulePeriod: 'date',
	},
};

export const sport = {
	id: 'mls',
	name: 'soccer',
	sources,
	credits,
	defaults,
	gameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	gameKey: 'id',
};

export default sport;
