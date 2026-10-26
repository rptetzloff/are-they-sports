/** The college football (FBS) adapter: where its games come from, and how they
 *  become rows.
 *
 *  One source for every season: CollegeFootballData.com's API, which needs a key
 *  (CFBD_API_KEY; free, 1,000 calls a month). One call a season, 1869 on, and a
 *  finished season is kept once fetched (data/sources/cfbd), so a reload spends
 *  calls only on the season being played. ESPN's scoreboard keeps that season
 *  current between loads (`live`), under the same ids: CollegeFootballData
 *  numbers modern games with ESPN's own ids, and names every side by ESPN's
 *  team id, back to the 1800s.
 *
 *  THE CLUBS ARE TODAY'S FBS, 138 programmes (data/reference/ncaaf-franchise-
 *  history.csv). A game counts when one of them played in it, whatever division
 *  the other side was in: Wisconsin's games against North Dakota State are
 *  Wisconsin's record too. Every other team becomes a franchise of its own with
 *  no page, named from the games (scripts/load.mjs).
 *
 *  A SEASON IS THE YEAR IT STARTS. The bowls and the playoff run into January
 *  and belong to the season before, as CollegeFootballData writes them.
 *
 *  THE CHAMPION is the winner of the game that decided it, where there was one:
 *  the College Football Playoff's final from 2014, the BCS's title game from
 *  1998 to 2013. Before 1998 nothing decided it on the field, and the AP poll's
 *  final No. 1 stands, from its first season, 1936 (Ray, 2026-10-25). Those are
 *  data/reference/ncaaf-champions.csv, made by scripts/ncaaf-champions.mjs.
 */

const API = 'https://api.collegefootballdata.com';

export const sources = {
	/** One call a season, every division; the load keeps the games a club played. */
	cfbd: {
		url: (season) => `${API}/games?year=${season}&seasonType=both`,
		first: 1869,
		key: 'CFBD_API_KEY',
	},
	live: {
		// FBS games only (ESPN's group 80): a game a club played in is one.
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yyyymmdd}&groups=80&limit=300`,
		/** Late August to the middle of January. */
		daysOf(season) {
			const out = [];
			const d = new Date(Date.UTC(season, 7, 20));
			const end = new Date(Date.UTC(season + 1, 0, 20));
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
		/** The year a season starts: January's games are the season before's. */
		seasonOf: (date) => (date.getUTCMonth() < 7 ? date.getUTCFullYear() - 1 : date.getUTCFullYear()),
		source: 'espn',
	},
};

export const credits = [
	{
		name: 'CollegeFootballData.com',
		url: 'https://collegefootballdata.com',
		note: 'every FBS programme\'s games from 1869, and the AP poll\'s champions',
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/college-football/',
		note: 'scores for the season being played, and each programme\'s conference and colours',
	},
];

/** A game's day where it was played, near enough: US Eastern. A 7 pm kickoff
 *  in Hawaii is the next day in UTC and the same day here. */
const easternDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** The BCS's title game each season, by its two sides (ESPN's ids): it was one
 *  of four bowls in turn to 2005 and its own game from 2006, and
 *  CollegeFootballData's notes name it in some seasons and leave every bowl of
 *  1998-2002 and 2007 blank, so the pair is what finds it. */
const BCS_TITLE = {
	1998: [2633, 52], // Tennessee, Florida State (Fiesta)
	1999: [52, 259], // Florida State, Virginia Tech (Sugar)
	2000: [201, 52], // Oklahoma, Florida State (Orange)
	2001: [2390, 158], // Miami, Nebraska (Rose)
	2002: [194, 2390], // Ohio State, Miami (Fiesta)
	2003: [99, 201], // LSU, Oklahoma (Sugar)
	2004: [30, 201], // USC, Oklahoma (Orange)
	2005: [251, 30], // Texas, USC (Rose)
	2006: [57, 194], // Florida, Ohio State
	2007: [99, 194], // LSU, Ohio State
	2008: [57, 201], // Florida, Oklahoma
	2009: [333, 251], // Alabama, Texas
	2010: [2, 2483], // Auburn, Oregon
	2011: [333, 99], // Alabama, LSU
	2012: [333, 87], // Alabama, Notre Dame
	2013: [52, 2], // Florida State, Auburn
};

/** Whether a postseason game decided the national title: the CFP's final from
 *  2014, named in CollegeFootballData's and ESPN's notes ("College Football
 *  Playoff National Championship Presented by AT&T"); the BCS's, 1998-2013,
 *  the postseason game between that season's pair. Null before 1998. */
export function titleOf(season, notes, homeId, awayId) {
	if (season >= 2014) return /(college football playoff|cfp) national championship/i.test(String(notes ?? '')) ? 'College Football Playoff' : null;
	const pair = BCS_TITLE[season];
	if (!pair) return null;
	const sides = [Number(homeId), Number(awayId)];
	return pair.every((id) => sides.includes(id)) ? 'BCS National Championship' : null;
}

/** A playoff game, from 2014: any note naming the College Football Playoff. */
const isPlayoff = (season, notes) => season >= 2014 && /(college football playoff|\bcfp\b)/i.test(String(notes ?? ''));

/** One CollegeFootballData game as a game row, or null for one that does not
 *  count. `finished` says the season is over, when a game never completed was
 *  cancelled rather than still to come (2020 lost dozens). Sides are ESPN's team
 *  ids, as text: the codes the franchise table knows a club by. */
export function cfbdGameRow(g, { finished = false } = {}) {
	if (g?.id == null || g.homeId == null || g.awayId == null) return null;
	const played = g.completed === true && g.homePoints != null && g.awayPoints != null;
	if (!played && finished) return null;
	const season = Number(g.season);
	const post = g.seasonType === 'postseason';
	const title = post ? titleOf(season, g.notes, g.homeId, g.awayId) : null;
	return {
		id: String(g.id),
		season,
		date: easternDay(g.startDate),
		round: !post ? 'regular' : title ? 'championship' : 'playoff',
		stage: !post ? null : isPlayoff(season, g.notes) || (title && season >= 2014) ? 'CFP' : 'BOWL',
		home: String(g.homeId),
		away: String(g.awayId),
		homeScore: played ? Number(g.homePoints) : null,
		awayScore: played ? Number(g.awayPoints) : null,
		neutral: g.neutralSite === true,
		status: played ? 'final' : 'scheduled',
		source: 'cfbd',
		week: post ? null : Number(g.week) || null,
		title,
	};
}

/** One ESPN scoreboard event as a game row, or null. The id is ESPN's, which
 *  CollegeFootballData's next load will carry too; the sides are ESPN's team
 *  ids, as above. A game between two teams the franchise table does not know
 *  is not a club's and is left out. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (comp.status?.type?.name === 'STATUS_POSTPONED' || comp.status?.type?.name === 'STATUS_CANCELED') return null;
	const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
	const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!homeC?.team?.id || !awayC?.team?.id) return null;
	const home = String(homeC.team.id), away = String(awayC.team.id);
	if (knows && !knows(home) && !knows(away)) return null;
	const date = queryDate
		? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}`
		: easternDay(event.date);
	const season = Number(event.season?.year ?? sources.live.seasonOf(new Date(event.date)));
	const played = comp.status?.type?.completed === true;
	const post = type === 3;
	const notes = (comp.notes ?? []).map((n) => n.headline).join(' ');
	const title = post ? titleOf(season, notes, home, away) : null;
	return {
		id: String(event.id),
		season,
		date,
		round: !post ? 'regular' : title ? 'championship' : 'playoff',
		stage: !post ? null : isPlayoff(season, notes) || (title && season >= 2014) ? 'CFP' : 'BOWL',
		home: franchiseOf(home),
		away: franchiseOf(away),
		homeScore: played ? Number(homeC.score) : null,
		awayScore: played ? Number(awayC.score) : null,
		neutral: Boolean(comp.neutralSite),
		status: played ? 'final' : 'scheduled',
		source: 'espn',
		week: post ? null : Number(event.week?.number) || null,
	};
}

/** ESPN ids are unique, and nobody plays twice in a day. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

/** What the title was called in a season: the AP's before 1998. */
export const championshipTitle = (season) => (season >= 2014 ? 'College Football Playoff'
	: season >= 1998 ? 'BCS National Championship' : 'AP national title');

export const defaults = {
	nouns: {
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'national championship',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Football's list: unbeaten seasons happen most years, and ties until 1996. */
	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'lossless-seasons', 'win-streaks', 'losing-streaks',
		'lopsided-wins', 'worst-losses', 'playoff-appearances',
		'championship-appearances', 'ties',
	],
	rules: {
		/** As the NFL's: a streak is a streak across a winter. */
		streaksSpanSeasons: true,
		fillInMaxGames: 5,
		losslessSeasonIsPlausible: true,
		/** A dozen games a season, so three days either side. */
		onThisDayWindowDays: 3,
		schedulePeriod: 'week',
	},
};

export const sport = {
	id: 'ncaaf',
	name: 'college football',
	sources,
	credits,
	defaults,
	cfbdGameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	titleOf,
	gameKey: 'id',
};

export default sport;
