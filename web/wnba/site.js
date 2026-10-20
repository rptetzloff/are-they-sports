// What this site calls things — the WNBA's copy.
//
// The front end is the baseball site's (web/mlb) by way of basketball's
// (web/nba), and this is its site.js with the WNBA's words: points, the WNBA
// Finals, coaches. Who the club is arrives
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
	championship: 'WNBA Finals',
	leaderNoun: 'coach',
	leaderPlural: 'coaches',
	/** No WNBA season has ended without a loss; the word is here for the
	 *  sentence that says so. */
	losslessSeasonNoun: 'Undefeated',
	meetingNoun: 'meeting',
	meetingPlural: 'meetings',

	/** The codes the games CSV names this club by — franchise codes, from the
	 *  manifest. */
	teamIds: CLUB.teamIds,
	parkNames: {},

	// --- rules, not words ---
	/** Within a season, as in baseball and the NBA: 44 games is long enough
	 *  that the in-season run is the record anyone quotes. */
	streaksSpanSeasons: false,
	perfectSeasonIsPlausible: false,
	onThisDayWindowDays: 0,

	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'world-series-appearances',
	],

	/** A season's name: the WNBA plays from May to October, so a season is the
	 *  year it is played in, as every source writes it. */
	seasonLabel: (season) => String(season),

	copy: {
		noWorldSeries: `The ${T} have not yet reached the WNBA Finals.`,
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
