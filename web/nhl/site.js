// What this site calls things — hockey's copy.
//
// The front end is the baseball site's (web/mlb) by way of basketball's
// (web/nba), and this is its site.js with hockey's words: goals, the Stanley
// Cup Final, coaches. Who the club is arrives as `window.CLUB`, which the
// server writes into the page from the club's manifest before any module runs
// (lib/web.js); see web/mlb/site.js for the reasoning, which is the same here.
//
// Pure data, no imports, readable from the browser, the server and a test.

const CLUB = globalThis.CLUB ?? { team: 'Team', fullName: 'Team', teamIds: [], copy: {}, site: {} };
if (typeof window !== 'undefined' && !globalThis.CLUB) console.error('site.js: window.CLUB is missing; the server did not describe the club');
const T = CLUB.team;

/** The first season (by the year it ends) in which an overtime loss earned a
 *  point and was counted apart from a loss: 1999-2000. Before it an overtime
 *  loss was a loss. */
export const FIRST_OTL_SEASON = 2000;

/** A hockey record as the NHL writes it for the season's era: W-L-T before
 *  1999-2000, W-L-T-OTL until the shootout ended ties in 2005-06, W-L-OTL
 *  since. L is regulation losses wherever OTL is shown. The postseason has no
 *  ties or overtime losses, so `regular: false` is W-L. */
export function hockeyRecord({ w = 0, l = 0, t = 0, otl = 0 }, { season, regular = true, dash = '-' } = {}) {
	if (!regular) return t > 0 ? [w, l, t].join(dash) : [w, l].join(dash);
	if (Number(season) >= FIRST_OTL_SEASON) return (t > 0 ? [w, l, t, otl] : [w, l, otl]).join(dash);
	return t > 0 ? [w, l, t].join(dash) : [w, l].join(dash);
}

export const SITE = {
	// --- identity ---
	team: CLUB.team,
	fullName: CLUB.fullName,

	// --- the sport's vocabulary ---
	scoreNoun: 'goals',
	scoreForLabel: 'Goals For',
	scoreAgainstLabel: 'Goals Against',
	championship: 'Stanley Cup Final',
	leaderNoun: 'coach',
	leaderPlural: 'coaches',
	/** No NHL season has ended without a loss; the word is here for the
	 *  sentence that says so. */
	losslessSeasonNoun: 'Undefeated',
	meetingNoun: 'meeting',
	meetingPlural: 'meetings',

	/** The codes the games CSV names this club by — franchise codes, from the
	 *  manifest. */
	teamIds: CLUB.teamIds,
	parkNames: {},

	// --- rules, not words ---
	/** Within a season, as in baseball and basketball: 82 games is long enough
	 *  that the in-season run is the record anyone quotes. */
	streaksSpanSeasons: false,
	perfectSeasonIsPlausible: false,
	onThisDayWindowDays: 0,

	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'world-series-appearances', 'ties',
	],

	/** A season's name. Hockey's run across New Year and every source counts
	 *  them by the year they end, so 2027 is the 2026-2027 season, written as
	 *  basketball's are. (Ray, 2026-10-19, for basketball: "2026-2027".) */
	seasonLabel: (season) => `${Number(season) - 1}-${season}`,

	/** The record line, in the NHL's form for the season's era. */
	record: hockeyRecord,

	copy: {
		noWorldSeries: `The ${T} have not yet reached the Stanley Cup Final.`,
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
