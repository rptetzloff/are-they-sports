/** The NBA adapter: where basketball's games come from, and how they become rows.
 *
 *  Two sources, split at 2002, the way football's are split at 1999:
 *
 *    1947-2001  FiveThirtyEight's nbaallelo.csv. Every BAA and NBA game, written
 *               twice (once from each side, `_iscopy`), with a playoff flag and
 *               no round. ABA games are in the same file and are not loaded: the
 *               NBA's own record books count Indiana, Denver, San Antonio and the
 *               Nets from 1977, and so does this.
 *    2002-      sportsdataverse's espn_nba_schedules, one CSV per season. ESPN's
 *               records, with the round on every playoff game from 2004;
 *               2002 and 2003 name none, and the load finds their Finals
 *               as it does FiveThirtyEight's.
 *
 *  A SEASON IS THE YEAR IT ENDS. 2026 is 2025-26, as ESPN, sportsdataverse and
 *  FiveThirtyEight all write it, and as data/reference/nba-franchise-history.csv
 *  is built to match. Football counts the year it starts; that difference is the
 *  live config's `seasonOf`, not a branch anywhere else.
 *
 *  WHAT COUNTS, as the NBA counts it: regular season and playoffs. Not the
 *  preseason, not the All-Star game, not the play-in (the league counts it as
 *  neither), and not the NBA Cup final, which is the one Cup game left out of
 *  the standings.
 */

const SDV = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules';

export const sources = {
	/** One file per season, 2002 on. 1994-2001 are published too and are not
	 *  used: FiveThirtyEight covers them, and one source per era is the rule the
	 *  football load already follows. */
	schedules: {
		url: (season) => `${SDV}/nba_schedule_${season}.csv`,
		perSeason: true,
		from: 2002,
	},
	history: {
		url: 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-elo/nbaallelo.csv',
		perSeason: false,
		useBefore: 2002,
	},
	live: {
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}&limit=200`,
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
		source: 'espn',
	},
};

export const credits = [
	{
		name: 'sportsdataverse',
		url: 'https://github.com/sportsdataverse/sportsdataverse-data',
		note: 'NBA schedules and results from 2002',
		licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
	},
	{
		name: 'FiveThirtyEight',
		url: 'https://github.com/fivethirtyeight/data/tree/master/nba-elo',
		note: 'NBA results 1947 to 2001',
		licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/nba/',
		note: 'scores for the season being played',
	},
];

/** ESPN's type abbreviations that are not games between two clubs that count. */
const NOT_COUNTED = new Set(['ALLSTAR', 'CC']);

/** One sportsdataverse row as a game row, or null for a game that does not count.
 *
 *  `stage` is ESPN's round word — RD16, QTR, SEMI, FINAL — as 0011 keeps every
 *  source's own. The Finals are the championship round; the champion is then
 *  whoever won it, which the championship pass works out as it does for the
 *  World Series. */
export function espnGameRow(r) {
	const type = Number(r.season_type);
	if (type !== 2 && type !== 3) return null;
	if (NOT_COUNTED.has(r.type_abbreviation)) return null;
	if (!r.home_abbreviation || !r.away_abbreviation) return null;
	// A postponed or cancelled fixture is not a game on that date; the makeup is
	// its own row. Kept, it sits in a finished season as a game never played.
	if (/POSTPONED|CANCELED|CANCELLED/.test(r.status_type_name)) return null;
	const played = /^true$/i.test(r.status_type_completed);
	const playoff = type === 3;
	return {
		id: String(r.id || r.game_id),
		season: Number(r.season),
		// The local date. `date` is UTC, and a night game is already tomorrow there.
		date: r.game_date,
		round: !playoff ? 'regular' : r.type_abbreviation === 'FINAL' ? 'championship' : 'playoff',
		stage: playoff ? (r.type_abbreviation || null) : null,
		home: r.home_abbreviation,
		away: r.away_abbreviation,
		homeScore: played ? Number(r.home_score) : null,
		awayScore: played ? Number(r.away_score) : null,
		neutral: /^true$/i.test(r.neutral_site),
		status: played ? 'final' : 'scheduled',
		source: 'sportsdataverse',
	};
}

/** One FiveThirtyEight row as a game row, or null.
 *
 *  Each game is written twice, once from each side; `_iscopy` 0 is the first,
 *  and `game_location` says which side was home (N for a neutral floor, where
 *  the row's own club is filed as home and `neutral` says it was not). */
export function eloGameRow(r) {
	if (r.lg_id !== 'NBA' || r._iscopy !== '0') return null;
	const m = String(r.date_game).match(/^(\d+)\/(\d+)\/(\d{4})$/);
	if (!m) return null;
	const date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
	const away = r.game_location === 'A';
	return {
		id: r.game_id,
		season: Number(r.year_id),
		date,
		// No round in this file. The Finals are found after the load, as the
		// last series of each postseason; see the championship pass.
		round: r.is_playoffs === '1' ? 'playoff' : 'regular',
		stage: null,
		home: away ? r.opp_id : r.team_id,
		away: away ? r.team_id : r.opp_id,
		homeScore: Number(away ? r.opp_pts : r.pts),
		awayScore: Number(away ? r.pts : r.opp_pts),
		neutral: r.game_location === 'N',
		status: 'final',
		source: 'fivethirtyeight',
	};
}

/** One ESPN scoreboard event as a game row, or null. The id is ESPN's, the same
 *  one the season's sportsdataverse release will carry, so the release replaces
 *  this row rather than adding a second. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (NOT_COUNTED.has(comp.type?.abbreviation)) return null;
	if (comp.status?.type?.name === 'STATUS_POSTPONED') return null;
	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!home?.team?.abbreviation || !away?.team?.abbreviation) return null;
	if (knows && (!knows(home.team.abbreviation) || !knows(away.team.abbreviation))) return null;
	const date = queryDate
		? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}`
		: String(event.date).slice(0, 10);
	const played = comp.status?.type?.completed === true;
	const playoff = type === 3;
	const stage = playoff ? (comp.type?.abbreviation ?? null) : null;
	return {
		id: String(event.id),
		season: Number(event.season?.year ?? date.slice(0, 4)),
		date,
		round: !playoff ? 'regular' : stage === 'FINAL' ? 'championship' : 'playoff',
		stage,
		home: franchiseOf(home.team.abbreviation),
		away: franchiseOf(away.team.abbreviation),
		homeScore: played ? Number(home.score) : null,
		awayScore: played ? Number(away.score) : null,
		neutral: Boolean(comp.neutralSite),
		status: played ? 'final' : 'scheduled',
		source: 'espn',
		week: null,
	};
}

/** No doubleheaders, and ESPN ids are unique, so every game is its own. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

/** What the final was called in a season: the BAA's for its three seasons, the
 *  NBA's since the 1949 merger. The noun true today is not true of 1947. */
export const championshipTitle = (season) => (season <= 1949 ? 'BAA Finals' : 'NBA Finals');

export const defaults = {
	nouns: {
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'NBA Finals',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Football's list without the two that cannot happen: no NBA season has
	 *  ended without a loss, and the game has no ties. */
	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'championship-appearances',
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
	id: 'nba',
	name: 'basketball',
	sources,
	credits,
	defaults,
	espnGameRow,
	eloGameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	gameKey: 'id',
};

export default sport;
