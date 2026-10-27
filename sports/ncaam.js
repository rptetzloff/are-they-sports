/** The men's college basketball (Division I) adapter: where its games come
 *  from, and how they become rows.
 *
 *  One source: CollegeBasketballData.com's API, from the 1949-50 season, with
 *  CollegeFootballData's key (the two share one; CBBD_API_KEY, else
 *  CFBD_API_KEY). It answers at most 3,000 games a call, so a season is asked
 *  for a window of dates at a time, a window that comes back full halved and
 *  asked again; a finished season is kept (data/sources/cbbd). ESPN's
 *  scoreboard keeps the season being played current, under the same ids:
 *  CollegeBasketballData's sourceId is ESPN's event id for every modern game.
 *
 *  THE CLUBS ARE TODAY'S DIVISION I, every programme (Ray, 2026-10-26: "full
 *  team listings"). A game counts when one of them played in it; every other
 *  team is a franchise with no page, named from the games. Sides are
 *  CollegeBasketballData's team ids with a c (c355), the codes the franchise
 *  table knows its games by; ESPN's live rows name them by ESPN's ids.
 *
 *  A SEASON IS THE YEAR IT ENDS: 2024-25 is 2025, as CollegeBasketballData and
 *  the NBA here number them.
 *
 *  WHAT COUNTS, as the game counts it (Ray, 2026-10-26): a conference
 *  tournament is the regular season's, as CollegeBasketballData files it; the
 *  postseason is the NCAA tournament, the NIT and the rest. The champion is
 *  the NCAA tournament's, from its final; 1939 to 1949, before the games here,
 *  from data/reference/ncaam-champions.csv.
 */

const API = 'https://api.collegebasketballdata.com';

export const sources = {
	cbbd: {
		/** A season's games between two dates (ISO), the API's own season. */
		url: (season, from, to) => `${API}/games?season=${season}&startDateRange=${from}&endDateRange=${to}`,
		first: 1950,
		/** CollegeBasketballData answers at most this many a call. */
		cap: 3000,
		key: ['CBBD_API_KEY', 'CFBD_API_KEY'],
	},
	live: {
		// Division I (ESPN's group 50): without it, a day is the ranked teams' games.
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${yyyymmdd}&groups=50&limit=400`,
		/** November of the year before to the first days of April. */
		daysOf(season) {
			const out = [];
			const d = new Date(Date.UTC(season - 1, 10, 1));
			const end = new Date(Date.UTC(season, 3, 15));
			for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
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
		/** The year a season ends: from August, the next one's. */
		seasonOf: (date) => (date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()),
		source: 'espn',
	},
};

export const credits = [
	{
		name: 'CollegeBasketballData.com',
		url: 'https://collegebasketballdata.com',
		note: 'every Division I programme\'s games from 1949-50',
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/mens-college-basketball/',
		note: 'scores for the season being played',
	},
];

/** A game's day where it was played, near enough: US Eastern. */
const easternDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** A tournament game's round, from its note: "Men's Basketball Championship -
 *  East Region - Sweet 16", "NCAA Men's Tourn., National - National Final",
 *  "NCAA MIDWEST REGION AT SPOKANE WA". Null where the note does not say.
 *
 *  From 2011 to 2015 the NCAA numbered the First Four as the first round, so
 *  that season's "2nd Round" is the round of 64 and its "3rd Round" the round
 *  of 32. A regional third-place game (to 1975) was played by the regional
 *  semifinals' losers, and is no Final Four's. */
export function roundOf(notes, season = null) {
	const n = String(notes ?? '');
	if (/regional third place/i.test(n)) return 'R3RD';
	if (/third place|consolation/i.test(n)) return 'THIRD';
	if (/national championship|national final|championship game/i.test(n)) return 'FINAL';
	if (/final four|national semifinal/i.test(n)) return 'F4';
	if (/elite (8|eight)|regional final/i.test(n)) return 'E8';
	if (/sweet (16|sixteen)|regional semifinal/i.test(n)) return 'S16';
	const numbered = season >= 2011 && season <= 2015;
	if (numbered && /3rd round|third round/i.test(n)) return 'R32';
	if (/2nd round|second round/i.test(n)) return numbered ? 'R64' : 'R32';
	if (/1st (round|rd)\b|first round/i.test(n)) return numbered ? 'FF' : 'R64';
	if (/first four|opening round/i.test(n)) return 'FF';
	return null;
}

/** Which postseason a game is: the NCAA tournament, the NIT, the CBI, or
 *  another, from CollegeBasketballData's tournament field and its note. */
export function postseasonOf(g) {
	const t = String(g.tournament ?? '');
	const n = String(g.gameNotes ?? '');
	if (t === 'NCAA' || /\bNCAA\b|Men's Basketball Championship/i.test(n)) return 'NCAA';
	if (t === 'NIT' || /\bNIT\b|National Invitation/i.test(n)) return 'NIT';
	if (t) return t;
	return 'POST';
}

/** A game's name, for its schedule row: the note, sponsor-free. */
export const gameName = (notes) => String(notes ?? '').replace(/\s+(presented|pres\.?|powered)\s+by\s+.*$/i, '').trim() || null;

/** One CollegeBasketballData game as a game row, or null. `finished` says the
 *  season is over, when a game never completed was cancelled. The id is
 *  ESPN's where the game has one (every modern game), else the API's own. */
export function cbbdGameRow(g, { finished = false } = {}) {
	if (g?.id == null || g.homeTeamId == null || g.awayTeamId == null) return null;
	// A game called off is no game. The API gives every unplayed game 0-0, a
	// scheduled one too, and a hundred-odd "final" 0-0s are games never played:
	// no basketball game ends 0-0.
	if (g.status === 'cancelled' || g.status === 'postponed') return null;
	const scored = g.homePoints != null && g.awayPoints != null && !(Number(g.homePoints) === 0 && Number(g.awayPoints) === 0);
	if (g.status === 'final' && !scored) return null;
	const played = g.status === 'final';
	if (!played && finished) return null;
	const post = g.seasonType === 'postseason';
	const which = post ? postseasonOf(g) : null;
	const round = post && which === 'NCAA' ? roundOf(g.gameNotes, Number(g.season)) : null;
	return {
		id: /^\d+$/.test(String(g.sourceId ?? '')) ? String(g.sourceId) : `cbbd-${g.id}`,
		season: Number(g.season),
		date: easternDay(g.startDate),
		// The final is marked after the load, from the season's NCAA games
		// (scripts/load.mjs): a note can name it, and an old one may not.
		round: post ? 'playoff' : 'regular',
		stage: !post ? null : which === 'NCAA' ? (round ?? 'NCAA') : which,
		home: `c${g.homeTeamId}`,
		away: `c${g.awayTeamId}`,
		homeScore: played ? Number(g.homePoints) : null,
		awayScore: played ? Number(g.awayPoints) : null,
		neutral: g.neutralSite === true,
		status: played ? 'final' : 'scheduled',
		source: 'cbbd',
		week: null,
		// A tournament game's name, early-season ones and conference ones too.
		title: g.gameType === 'TRNMNT' || post ? gameName(g.gameNotes) : null,
	};
}

/** One ESPN scoreboard event as a game row, or null: ESPN's ids, which the
 *  franchise table knows each club by; a game between two non-clubs is none. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (/POSTPONED|CANCELED/.test(comp.status?.type?.name ?? '')) return null;
	const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
	const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!homeC?.team?.id || !awayC?.team?.id) return null;
	const home = String(homeC.team.id), away = String(awayC.team.id);
	if (knows && !knows(home) && !knows(away)) return null;
	const played = comp.status?.type?.completed === true;
	const notes = (comp.notes ?? []).map((n) => n.headline).join(' ');
	const post = type === 3;
	return {
		id: String(event.id),
		season: Number(event.season?.year ?? sources.live.seasonOf(new Date(event.date))),
		date: queryDate ? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}` : easternDay(event.date),
		round: post ? (roundOf(notes) === 'FINAL' ? 'championship' : 'playoff') : 'regular',
		stage: post ? (roundOf(notes) ?? 'POST') : null,
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

/** ESPN ids are unique, and a club plays once a day. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

export const championshipTitle = () => 'NCAA Tournament';

export const defaults = {
	nouns: {
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'NCAA Tournament',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Basketball's list: no ties, and an unbeaten season is rare enough (Indiana
	 *  1976, the last) to show. */
	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'lossless-seasons', 'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses',
		'playoff-appearances', 'championship-appearances',
	],
	rules: {
		streaksSpanSeasons: false,
		fillInMaxGames: 5,
		losslessSeasonIsPlausible: true,
		onThisDayWindowDays: 0,
		schedulePeriod: 'date',
		/** A conference is ranked by its conference games, as college
		 *  basketball's standings are read (lib/standings.js). */
		standingsByConference: true,
	},
};

export const sport = {
	id: 'ncaam',
	name: 'men\'s college basketball',
	sources,
	credits,
	defaults,
	cbbdGameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	gameKey: 'id',
};

export default sport;
