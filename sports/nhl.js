/** The NHL adapter: where hockey's games come from, and how they become rows.
 *
 *  ONE SOURCE, the league's own: the NHL's stats API lists a whole season's
 *  games in one request (api.nhle.com/stats/rest/en/game), every season back to
 *  1917-18, and its schedule API (api-web.nhle.com) scores the season being
 *  played with the same game ids — so a live row and the authoritative one are
 *  the same row, as with basketball's ESPN ids. Ray approved using it on
 *  2026-10-19, with the NHL credited.
 *
 *  A SEASON IS THE YEAR IT ENDS: the API's 20232024 is 2024, as the NHL writes
 *  it and data/reference/nhl-franchise-history.csv is built to match.
 *
 *  WHAT COUNTS: regular season (game type 2) and playoffs (3), including the
 *  Stanley Cup Finals of 1918 to 1926 against the western leagues' champions,
 *  which the reference table names from the NHL's own records. Not the
 *  preseason or the All-Star game.
 *
 *  THE ROUND is in the id: a playoff game is YYYY03RRSG — round in two digits,
 *  then series and game (2023030417 is round 4, series 1, game 7) —
 *  and that holds back to 1918. `stage` is R1, R2 ...; the season's last round
 *  is the Stanley Cup Final, which the load marks as the championship round.
 *
 *  HOW IT ENDED is the period count: 4 in a regular-season game is overtime and
 *  5 a shootout; a playoff game has no shootout, so anything past 3 is overtime.
 *  `ending` (0014) keeps it, because a hockey record counts overtime losses.
 */

const STATS = 'https://api.nhle.com/stats/rest/en';

/** The western clubs the NHL's champions met in the Cup Finals of 1918-1926,
 *  by the stats API's team id. Its team list does not carry them; the codes and
 *  names are the NHL's own game records', as in the reference table. */
export const WESTERN_CLUBS = { 7284: 'CAT', 7285: 'EDE', 7286: 'SMT', 7287: 'VMA', 7288: 'VMI', 7289: 'VIC' };

export const sources = {
	/** One file per season: every game, with team ids, scores and periods. */
	schedules: {
		url: (season) => `${STATS}/game?cayenneExp=season=${season - 1}${season}`,
		perSeason: true,
		from: 1918,
	},
	/** The team ids' codes. */
	teams: { url: `${STATS}/team` },
	live: {
		url: (yyyymmdd) => `https://api-web.nhle.com/v1/score/${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
		/** The schedule API answers `games`, not ESPN's `events`. */
		eventsOf: (json) => json?.games ?? [],
		/** October of the year before through June of the season's own year. */
		daysOf(season) {
			const out = [];
			const add = (year, month) => {
				const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
				for (let d = 1; d <= days; d++) out.push(`${year}${String(month).padStart(2, '0')}${String(d).padStart(2, '0')}`);
			};
			for (let m = 10; m <= 12; m++) add(season - 1, m);
			for (let m = 1; m <= 6; m++) add(season, m);
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
		/** From August a date belongs to the season that ends next year. */
		seasonOf: (date) => (date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()),
		source: 'nhl',
	},
};

export const credits = [
	{
		name: 'NHL',
		url: 'https://www.nhl.com',
		note: 'every game since 1917, from the league\'s public stats and schedule APIs',
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/nhl/',
		note: 'schedules and scores on the front page',
	},
];

/** A playoff game's round, from its id: YYYY03RRSG. */
export const roundOf = (id) => {
	const s = String(id);
	return /^\d{4}03\d{4}$/.test(s) ? Number(s.slice(6, 8)) || null : null;
};

/** How a game was settled, from how many periods it ran. */
export function endingOf(gameType, period) {
	const p = Number(period);
	if (!p) return null;
	if (p <= 3) return 'REG';
	if (gameType === 3) return 'OT';
	return p === 4 ? 'OT' : 'SO';
}

/** One stats-API game as a row, or null. `codeOf` turns a team id into the
 *  NHL's three-letter code (its team list, plus WESTERN_CLUBS). */
export function gameRow(g, codeOf) {
	if (g.gameType !== 2 && g.gameType !== 3) return null;
	const home = codeOf(g.homeTeamId);
	const away = codeOf(g.visitingTeamId);
	if (!home || !away) return null;
	// 6 is final and 7 official; anything else is not a result yet.
	const final = g.gameStateId === 7 || g.gameStateId === 6;
	const playoff = g.gameType === 3;
	// A playoff game not played is an "if necessary" game its series never
	// needed: 17 in 2024 and 23 in 2026, sitting in finished seasons. One still
	// to come is the front page's to show, from ESPN; it is stored once played.
	if (playoff && !final) return null;
	const round = playoff ? roundOf(g.id) : null;
	return {
		id: String(g.id),
		season: Number(String(g.season).slice(4)),
		date: g.gameDate,
		// The Final is found after the load, as the season's last round.
		round: playoff ? 'playoff' : 'regular',
		stage: round ? `R${round}` : null,
		ending: final ? endingOf(g.gameType, g.period) : null,
		home,
		away,
		homeScore: final ? Number(g.homeScore) : null,
		awayScore: final ? Number(g.visitingScore) : null,
		neutral: false,
		status: final ? 'final' : 'scheduled',
		source: 'nhl',
	};
}

/** One schedule-API game (api-web.nhle.com/v1/score) as a row, or null. */
export function liveGameRow(game, { franchiseOf, knows }) {
	if (game?.gameType !== 2 && game?.gameType !== 3) return null;
	const home = game.homeTeam?.abbrev;
	const away = game.awayTeam?.abbrev;
	if (!home || !away) return null;
	if (knows && (!knows(home) || !knows(away))) return null;
	if (game.gameScheduleState === 'PPD' || game.gameScheduleState === 'CNCL') return null;
	const final = game.gameState === 'OFF' || game.gameState === 'FINAL';
	const playoff = game.gameType === 3;
	// As gameRow: a playoff game is stored once played.
	if (playoff && !final) return null;
	const round = playoff ? roundOf(game.id) : null;
	return {
		id: String(game.id),
		season: Number(String(game.season).slice(4)),
		date: game.gameDate,
		round: playoff ? 'playoff' : 'regular',
		stage: round ? `R${round}` : null,
		ending: final ? (game.gameOutcome?.lastPeriodType ?? null) : null,
		home: franchiseOf(home),
		away: franchiseOf(away),
		homeScore: final ? Number(game.homeTeam.score) : null,
		awayScore: final ? Number(game.awayTeam.score) : null,
		neutral: Boolean(game.neutralSite),
		status: final ? 'final' : 'scheduled',
		source: 'nhl',
		week: null,
	};
}

/** A game's points in the standings, from one club's side: two a win, one a
 *  tie, and from 1999-2000 one for a loss in overtime or a shootout — the NHL
 *  ranks by them, not by winning percentage. */
export function standingsPoints(g) {
	if (g.result === 'WIN') return 2;
	if (g.result === 'TIE') return 1;
	if (g.result === 'LOSS' && Number(g.season) >= 2000 && (g.ending === 'OT' || g.ending === 'SO')) return 1;
	return 0;
}

/** No doubleheaders, and the NHL's ids are unique. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

/** The Final has been the Stanley Cup Final in every season here: the NHL's
 *  champions played for the Cup from the league's first season, against the
 *  western leagues' until 1926 and within the NHL after. */
export const championshipTitle = () => 'Stanley Cup Final';

export const defaults = {
	nouns: {
		scoreNoun: 'goals',
		scoreForLabel: 'Goals For',
		scoreAgainstLabel: 'Goals Against',
		championship: 'Stanley Cup',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Football's list without the lossless seasons, which no NHL club has had.
	 *  Ties stay: the game could end tied until 2005. */
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
	id: 'nhl',
	name: 'hockey',
	sources,
	credits,
	defaults,
	gameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	standingsPoints,
	gameKey: 'id',
};

export default sport;
