// What this site calls things — basketball's copy.
//
// The front end is the baseball site's (web/mlb), and this is its site.js with
// basketball's words: points, the NBA Finals, coaches. Who the club is arrives
// as `window.CLUB`, which the server writes into the page from the club's
// manifest before any module runs (lib/web.js); see web/mlb/site.js for the
// reasoning, which is the same here.
//
// Pure data, no imports, readable from the browser, the server and a test.

const CLUB = globalThis.CLUB ?? { team: 'Team', fullName: 'Team', teamIds: [], copy: {}, site: {} };
if (typeof window !== 'undefined' && !globalThis.CLUB) console.error('site.js: window.CLUB is missing; the server did not describe the club');
const T = CLUB.team;

export const SITE = {
	// --- identity ---
	team: CLUB.team,
	fullName: CLUB.fullName,

	// --- the sport's vocabulary ---
	scoreNoun: 'points',
	scoreForLabel: 'Points For',
	scoreAgainstLabel: 'Points Against',
	championship: 'NBA Finals',
	leaderNoun: 'coach',
	leaderPlural: 'coaches',
	/** No NBA season has ended without a loss; the word is here for the
	 *  sentence that says so. */
	losslessSeasonNoun: 'Undefeated',
	meetingNoun: 'meeting',
	meetingPlural: 'meetings',

	/** The codes the games CSV names this club by — franchise codes, from the
	 *  manifest. */
	teamIds: CLUB.teamIds,
	parkNames: {},

	// --- rules, not words ---
	/** Within a season, as in baseball: 82 games is long enough that the
	 *  in-season run is the record anyone quotes. */
	streaksSpanSeasons: false,
	perfectSeasonIsPlausible: false,
	onThisDayWindowDays: 0,

	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'best-playoff-runs', 'world-series-appearances',
	],

	/** A season's name. Basketball's run across New Year and every source
	 *  counts them by the year they end, so 2027 is the 2026-2027 season, which
	 *  is how it is written here. (Ray, 2026-10-19: "2026-2027".) */
	seasonLabel: (season) => `${Number(season) - 1}-${season}`,

	copy: {
		noWorldSeries: `The ${T} have not yet reached the NBA Finals.`,
		noPlayoffs: `The ${T} have not yet reached the playoffs.`,
		noLosingStreak: `The ${T} have never lost consecutive games. Sure.`,
		noTies: `The ${T} have never tied a game.`,
		worstLossAside: "We don't talk about it.",
		worstStartAside: 'It happens to the best of us.',
		...CLUB.copy,
	},

	// --- the front page, from the club's manifest (lib/web.js clubConfig) ---
	...CLUB.site,
}

export default SITE
