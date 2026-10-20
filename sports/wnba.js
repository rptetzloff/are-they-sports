/** The WNBA adapter: where the league's games come from, and how they become rows.
 *
 *  Two sources, split at the season being played:
 *
 *    1997-2025  the WNBA's own game logs (stats.wnba.com), committed as
 *               data/reference/wnba-games.csv: that site answers only a
 *               browser, and finished seasons do not change. ESPN lists the
 *               same games and, against these, has none of 1997's scores and
 *               thirteen errors in 2002-2019 (the file's header lists them).
 *               Ray chose the league's records for every finished season,
 *               credited, on 2026-10-20.
 *    2026-      sportsdataverse's espn_wnba_schedules, one CSV per season, and
 *               ESPN's scoreboard for a season whose file is missing or short.
 *
 *  A SEASON IS THE CALENDAR YEAR. The WNBA plays from May to October, and every
 *  source writes 2026 for the season played in 2026.
 *
 *  WHAT COUNTS: regular season and playoffs. Not the All-Star game and not the
 *  Commissioner's Cup final, which the league leaves out of the standings.
 *
 *  ONE CODE TWO CLUBS: the first Portland Fire (2000-2002) and today's (2026)
 *  are different franchises, and every source calls both POR. Before 2026 POR is
 *  read as POF, the first Fire's code in data/reference/wnba-franchise-history.csv.
 */

const SDV = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_wnba_schedules';

/** A source's code for a club, as this repo's: POR before 2026 is the first Fire. */
export const clubCode = (code, season) => (code === 'POR' && Number(season) < 2026 ? 'POF' : code);

export const sources = {
	/** One file per season, from the first not in the league's logs. */
	schedules: {
		url: (season) => `${SDV}/wnba_schedule_${season}.csv`,
		perSeason: true,
		from: 2026,
	},
	/** The WNBA's own 1997-2025, committed; see the file's header. */
	history: {
		reference: 'wnba-games.csv',
		useBefore: 2026,
	},
	live: {
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${yyyymmdd}&limit=200`,
		/** May through October of the season's own year. */
		daysOf(season) {
			const out = [];
			for (let m = 5; m <= 10; m++) {
				const days = new Date(Date.UTC(season, m, 0)).getUTCDate();
				for (let d = 1; d <= days; d++) out.push(`${season}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);
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
		source: 'espn',
	},
};

export const credits = [
	{
		name: 'WNBA',
		url: 'https://www.wnba.com',
		note: 'every game from 1997 to 2025, from the league\'s own stats',
	},
	{
		name: 'sportsdataverse',
		url: 'https://github.com/sportsdataverse/sportsdataverse-data',
		note: 'WNBA schedules and results from 2026',
		licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/wnba/',
		note: 'scores for the season being played',
	},
];

/** ESPN's type abbreviations that are not games between two clubs that count. */
const NOT_COUNTED = new Set(['ALLSTAR', 'CC']);

/** ESPN's words for the playoff rounds, which it names from 2022. A playoff game
 *  without one gets no stage. */
const ROUNDS = new Set(['RD16', 'QTR', 'SEMI', 'FINAL']);
const stageOf = (abbr) => (ROUNDS.has(abbr) ? abbr : null);

/** Regular season, playoffs, or neither, for one sportsdataverse row. From 2024
 *  the files leave `season_type` empty; ESPN's type word still says it — STD in
 *  the regular season, a round's word in the playoffs (2024's 240 STD games are
 *  its whole regular season, 12 clubs of 40). */
function typeOf(r) {
	const t = Number(r.season_type);
	if (t === 2 || t === 3) return t;
	if (r.season_type) return null;
	if (r.type_abbreviation === 'STD') return 2;
	if (ROUNDS.has(r.type_abbreviation)) return 3;
	return null;
}

/** One sportsdataverse row as a game row, or null for a game that does not count. */
export function espnGameRow(r) {
	if (!/^\d+$/.test(String(r.id || r.game_id || ''))) return null;
	const type = typeOf(r);
	if (type === null) return null;
	if (NOT_COUNTED.has(r.type_abbreviation)) return null;
	if (!r.home_abbreviation || !r.away_abbreviation) return null;
	if (/POSTPONED|CANCELED|CANCELLED/.test(r.status_type_name)) return null;
	const played = /^true$/i.test(r.status_type_completed);
	const playoff = type === 3;
	const season = Number(r.season);
	return {
		id: String(r.id || r.game_id),
		season,
		date: r.game_date,
		round: !playoff ? 'regular' : r.type_abbreviation === 'FINAL' ? 'championship' : 'playoff',
		stage: playoff ? stageOf(r.type_abbreviation) : null,
		home: clubCode(r.home_abbreviation, season),
		away: clubCode(r.away_abbreviation, season),
		homeScore: played ? Number(r.home_score) : null,
		awayScore: played ? Number(r.away_score) : null,
		neutral: /^true$/i.test(r.neutral_site),
		status: played ? 'final' : 'scheduled',
		source: 'sportsdataverse',
	};
}

/** A playoff game's round from the league's id, from 2002: 104 YY 00 R S G, so
 *  1040200103 is 2002, round 1, series 0, game 3. 1997-2001 number their
 *  playoff games in order instead (001 to 020), which leaves 0 where the round
 *  would be: no round. */
export const roundOf = (id) => {
	const m = /^104\d{2}00(\d)\d{2}$/.exec(String(id));
	return m && Number(m[1]) > 0 ? Number(m[1]) : null;
};

/** One row of the WNBA's own file as a game row. Every game in it was played.
 *  The stage is the round from the id, R1 to R4; the load marks each season's
 *  last as its Finals, and finds 1997-2001's as the NBA's are found. */
export function statsGameRow(r) {
	const season = Number(r.season);
	if (!season || !r.home || !r.away) return null;
	const playoff = r.season_type === 'playoffs';
	const round = playoff ? roundOf(r.game_id) : null;
	return {
		id: String(r.game_id),
		season,
		date: r.date,
		round: playoff ? 'playoff' : 'regular',
		stage: round ? `R${round}` : null,
		home: clubCode(r.home, season),
		away: clubCode(r.away, season),
		homeScore: Number(r.home_score),
		awayScore: Number(r.away_score),
		neutral: false,
		status: 'final',
		source: 'wnba',
	};
}

/** One ESPN scoreboard event as a game row, or null. The id is ESPN's, the same
 *  one the season's sportsdataverse release will carry. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (NOT_COUNTED.has(comp.type?.abbreviation)) return null;
	if (comp.status?.type?.name === 'STATUS_POSTPONED') return null;
	const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
	const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!homeC?.team?.abbreviation || !awayC?.team?.abbreviation) return null;
	const date = queryDate
		? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}`
		: String(event.date).slice(0, 10);
	const season = Number(event.season?.year ?? date.slice(0, 4));
	const home = clubCode(homeC.team.abbreviation, season);
	const away = clubCode(awayC.team.abbreviation, season);
	if (knows && (!knows(home) || !knows(away))) return null;
	const played = comp.status?.type?.completed === true;
	const playoff = type === 3;
	const stage = playoff ? stageOf(comp.type?.abbreviation) : null;
	return {
		id: String(event.id),
		season,
		date,
		round: !playoff ? 'regular' : stage === 'FINAL' ? 'championship' : 'playoff',
		stage,
		home: franchiseOf(home),
		away: franchiseOf(away),
		homeScore: played ? Number(homeC.score) : null,
		awayScore: played ? Number(awayC.score) : null,
		neutral: Boolean(comp.neutralSite),
		status: played ? 'final' : 'scheduled',
		source: 'espn',
		week: null,
	};
}

/** No doubleheaders, and ESPN ids are unique, so every game is its own. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

/** The WNBA Finals in every season, the single game of 1997 included. */
export const championshipTitle = () => 'WNBA Finals';

export const defaults = {
	nouns: {
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'WNBA Finals',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Basketball's list: no WNBA season has ended without a loss, and the game
	 *  has no ties. */
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
	id: 'wnba',
	name: 'women\'s basketball',
	sources,
	credits,
	defaults,
	espnGameRow,
	statsGameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	gameKey: 'id',
};

export default sport;
