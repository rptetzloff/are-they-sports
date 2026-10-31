/** The men's college lacrosse (Division I) adapter: where its games come from, and
 *  how they become rows.
 *
 *  ONE SOURCE, ESPN's scoreboards, a day at a time, as for hockey: read once by
 *  scripts/ncaal-games.mjs into data/reference/ncaal-games.csv, which the load
 *  reads. The season being played comes from the same scoreboard, with the same
 *  ids, so a live row and its later history row are one game.
 *
 *  THE GAMES BEGIN WITH 2025. ESPN has a fraction of each day before that, 13 games
 *  of a Saturday in 2024 against 37 in 2025, so a record reaching further back would
 *  be wrong. 2025 has 577 games and 2026 has 579, and every club a full schedule.
 *  The NCAA's own site has the rest, and its terms forbid collecting it without
 *  written permission, which we do not have. So there are no all-time records yet.
 *
 *  THE CLUBS ARE TODAY'S DIVISION I. A game counts when one of them played in it;
 *  every other team is a franchise with no page.
 *
 *  A SEASON IS THE YEAR IT IS PLAYED: spring 2026 is 2026. From August the season
 *  being played is the next one, for its schedule.
 *
 *  WHAT COUNTS: a conference tournament is the regular season's, as ESPN files it;
 *  the postseason is the NCAA tournament. ESPN files that as the regular season too,
 *  so only its note says which games they are. Rounds use basketball's names for
 *  the same sizes: the first round is S16, the quarterfinals E8, the semifinals F4,
 *  and the two opening-round games FF.
 *
 *  A GAME CANNOT END LEVEL: overtime goes on until someone scores.
 */
import { gameName } from './ncaam.js';

export const sources = {
	/** The games file's first season, and what scripts/ncaal-games.mjs reads. */
	history: { reference: 'ncaal-games.csv', from: 2025 },
	live: {
		// No `groups`: as hockey's, this league has none to ask for.
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard?dates=${yyyymmdd}&limit=200`,
		/** Late January to the final on Memorial Day. */
		daysOf(season) {
			const out = [];
			const d = new Date(Date.UTC(season, 0, 20));
			const end = new Date(Date.UTC(season, 5, 5));
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
		/** The year a season is played: from August, the next one's. */
		seasonOf: (date) => (date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()),
		source: 'espn',
	},
};

export const credits = [
	{
		name: 'ESPN',
		url: 'https://www.espn.com/mens-college-lacrosse/',
		note: 'every game from 2025, from its scoreboards, and each tournament\'s seeds',
	},
];

/** A tournament game's round from ESPN's note, or null for any other game. Word by
 *  word, as each round's note is a subset of the next one's letters. */
export function stageOf(notes) {
	const n = String(notes ?? '');
	if (!/NCAA Men's Lacrosse Championship/i.test(n)) return null;
	if (/opening round/i.test(n)) return 'FF';
	if (/first round/i.test(n)) return 'S16';
	if (/quarterfinal/i.test(n)) return 'E8';
	if (/semifinal/i.test(n)) return 'F4';
	if (/\bfinal\b/i.test(n)) return 'FINAL';
	return 'NCAA';
}

/** How a game ended, from ESPN's status: `Final`, `Final/OT`, `Final/2OT`. */
export const endingOf = (detail) => (/OT\b/.test(String(detail ?? '')) ? 'OT' : 'REG');

/** One game as a row, from anything that gives the fields: the games file's row or
 *  an event read by eventFields. Null is a game with no result to keep. */
function toRow(g, franchiseOf = (id) => id) {
	const played = g.played;
	if (played && !Number(g.homeScore) && !Number(g.awayScore)) return null;
	return {
		id: g.id,
		season: g.season,
		date: g.date,
		round: g.stage === 'FINAL' ? 'championship' : g.stage ? 'playoff' : 'regular',
		stage: g.stage,
		ending: played ? g.ending : null,
		home: franchiseOf(g.home),
		away: franchiseOf(g.away),
		homeScore: played ? Number(g.homeScore) : null,
		awayScore: played ? Number(g.awayScore) : null,
		neutral: g.neutral,
		status: played ? 'final' : 'scheduled',
		source: g.source,
		week: null,
		title: g.title,
	};
}

/** One row of data/reference/ncaal-games.csv as a game row. */
export function gameRow(r) {
	return toRow({
		id: r.id, season: Number(r.season), date: r.date, stage: r.stage || null, ending: r.ending, home: r.home, away: r.away,
		homeScore: r.home_score, awayScore: r.away_score, neutral: r.neutral === 'true', played: true, source: r.source, title: r.title || null,
	});
}

/** One ESPN scoreboard event as fields, or null for a game that was called off. */
export function eventFields(event, queryDate = null) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	if (/POSTPONED|CANCELED/.test(comp.status?.type?.name ?? '')) return null;
	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!/^\d+$/.test(home?.team?.id ?? '') || !/^\d+$/.test(away?.team?.id ?? '')) return null;
	const date = queryDate ? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}` : String(event.date).slice(0, 10);
	const notes = (comp.notes ?? []).map((n) => n.headline).join(' ');
	const stage = stageOf(notes);
	return {
		id: String(event.id),
		season: sources.live.seasonOf(new Date(`${date}T12:00:00Z`)),
		date,
		stage,
		ending: endingOf(comp.status?.type?.shortDetail),
		home: String(home.team.id),
		homeName: home.team.location,
		homeScore: home.score,
		away: String(away.team.id),
		awayName: away.team.location,
		awayScore: away.score,
		// ESPN does not mark the tournament's neutral sites; its later rounds are all
		// at one, and a first-round game on a seed's own field is still its round.
		neutral: Boolean(comp.neutralSite) || stage === 'F4' || stage === 'FINAL',
		played: comp.status?.type?.completed === true,
		source: 'espn',
		title: stage ? null : gameName(notes),
	};
}

/** One ESPN scoreboard event as a game row, or null: a game between two non-clubs
 *  is none. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const g = eventFields(event, queryDate);
	if (!g) return null;
	if (knows && !knows(g.home) && !knows(g.away)) return null;
	return toRow(g, franchiseOf);
}

/** ESPN ids are unique, and a club plays once a day. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

export const championshipTitle = () => 'NCAA Tournament';

export const defaults = {
	nouns: {
		scoreNoun: 'goals',
		scoreForLabel: 'Goals For',
		scoreAgainstLabel: 'Goals Against',
		championship: 'NCAA Tournament',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		losslessSeasonNoun: 'undefeated',
	},
	/** Basketball's list: no ties, and a season of fifteen-odd games can be unbeaten. */
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
		/** A conference is ranked by its conference games, as basketball's are. */
		standingsByConference: true,
	},
};

export const sport = {
	id: 'ncaal',
	name: 'men\'s college lacrosse',
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
