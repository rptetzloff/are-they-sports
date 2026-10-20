// What this site calls things — MLS's copy.
//
// The front end is the baseball site's (web/mlb) by way of hockey's (web/nhl),
// and this is its site.js with MLS's words: goals, MLS Cup, coaches. Who the
// club is arrives as `window.CLUB`, which the server writes into the page from
// the club's manifest before any module runs (lib/web.js); see web/mlb/site.js
// for the reasoning, which is the same here.
//
// Pure data, no imports, readable from the browser, the server and a test.

const CLUB = globalThis.CLUB ?? { team: 'Team', fullName: 'Team', teamIds: [], copy: {}, site: {} };
if (typeof window !== 'undefined' && !globalThis.CLUB) console.error('site.js: window.CLUB is missing; the server did not describe the club');
const T = CLUB.team;

/** The first season a game could end in a draw: until 2000 MLS settled every
 *  level game with a shootout. */
export const FIRST_DRAW_SEASON = 2000;

/** A record as MLS writes it: W-L-T, the third number shown even at zero, from
 *  2000; W-L before, when there were no draws. A shootout is a win or a loss
 *  (Ray, 2026-10-20), so a playoff record is W-L. `otl` is hockey's and is
 *  taken only so the shared code can pass it. */
export function seasonRecord({ w = 0, l = 0, t = 0 }, { season, regular = true, dash = '-' } = {}) {
	if (!regular) return [w, l].join(dash);
	return Number(season) >= FIRST_DRAW_SEASON || t > 0 ? [w, l, t].join(dash) : [w, l].join(dash);
}

export const SITE = {
	// --- identity ---
	team: CLUB.team,
	fullName: CLUB.fullName,

	// --- the sport's vocabulary ---
	scoreNoun: 'goals',
	scoreForLabel: 'Goals For',
	scoreAgainstLabel: 'Goals Against',
	championship: 'MLS Cup',
	leaderNoun: 'coach',
	leaderPlural: 'coaches',
	/** No MLS season has ended without a loss; the word is here for the
	 *  sentence that says so. */
	losslessSeasonNoun: 'Undefeated',
	meetingNoun: 'meeting',
	meetingPlural: 'meetings',

	/** The codes the games CSV names this club by — franchise codes, from the
	 *  manifest. */
	teamIds: CLUB.teamIds,
	parkNames: {},

	// --- rules, not words ---
	/** Within a season: 34 games, and the in-season run is the one quoted. */
	streaksSpanSeasons: false,
	perfectSeasonIsPlausible: false,
	onThisDayWindowDays: 0,

	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'world-series-appearances', 'ties',
	],

	/** A season's name: MLS plays from February to December, MLS Cup included,
	 *  so a season is the year it is played in. */
	seasonLabel: (season) => String(season),

	/** The record line, in MLS's form for the season's era. */
	record: seasonRecord,

	copy: {
		noWorldSeries: `The ${T} have not yet reached MLS Cup.`,
		noPlayoffs: `The ${T} have not yet reached the playoffs.`,
		noLosingStreak: `The ${T} have never lost consecutive games. Sure.`,
		noTies: `The ${T} have never drawn a game.`,
		worstLossAside: "We don't talk about it.",
		worstStartAside: 'It happens to the best of us.',
		...CLUB.copy,
	},

	// --- the front page, from the club's manifest (lib/web.js clubConfig) ---
	...CLUB.site,
}

export default SITE
