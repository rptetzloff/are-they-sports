/** The women's college basketball (Division I) adapter: where its games come
 *  from, and how they become rows.
 *
 *  One source of ESPN's records, twice over: sportsdataverse's
 *  espn_womens_college_basketball_schedules, one CSV a season from 2000-01 (2000
 *  and before are 404s), and ESPN's scoreboard for the season being played and
 *  for what those files lack (data/reference/ncaaw-games-added.csv, 676 games,
 *  all but one of 2001-02). Both name a game by ESPN's event id, so a live row is
 *  replaced in place, and a side by ESPN's team id, so this needs none of men's
 *  two numberings.
 *
 *  THE CLUBS ARE TODAY'S DIVISION I, every programme, as for the men (Ray,
 *  2026-10-26). A game counts when one of them played in it; every other team
 *  is a franchise with no page, named from the games.
 *
 *  A SEASON IS THE YEAR IT ENDS: 2024-25 is 2025.
 *
 *  WHAT COUNTS, as for the men: a conference tournament is the regular
 *  season's, as ESPN files it; the postseason is the NCAA tournament, the WNIT
 *  and the rest. The champion is the NCAA tournament's, from its final; 1982 to
 *  2000, before the games here, from data/reference/ncaaw-champions.csv.
 *
 *  WHAT THE FILES DO NOT SAY. ESPN's type word is no guide: the MEAC tournament's
 *  games of 2010 to 2023 are "EXH", and every one of them was played and counted,
 *  so nothing here is dropped for it. The tournament's id begins in 2003, and
 *  its notes name no round until 2008 ("EAST REGION AT MANHATTAN KS") and in 2001
 *  say nothing at all, so walkRounds reads the rounds back from each final.
 */
import { defaults as mens, gameName, roundOf } from './ncaam.js';

const SDV = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_womens_college_basketball_schedules';

export const sources = {
	schedules: {
		url: (season) => `${SDV}/wbb_schedule_${season}.csv`,
		from: 2001,
	},
	live: {
		// Division I (ESPN's group 50): without it, a day is the ranked teams' games.
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?dates=${yyyymmdd}&groups=50&limit=400`,
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
		name: 'sportsdataverse',
		url: 'https://github.com/sportsdataverse/sportsdataverse-data',
		note: 'every Division I programme\'s games from 2000-01',
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com/womens-college-basketball/',
		note: 'scores for the season being played',
	},
];

/** ESPN's tournament ids, from 2003: the NCAA's, the WNIT's, the WBI's and the
 *  WBIT's. The WNIT is stage NIT, as the men's is. */
const TOURNAMENTS = { 22: 'NCAA', 37: 'NIT', 38: 'WBI', 62: 'WBIT' };
const OTHER_TOURNAMENTS = new Set(['NIT', 'WBI', 'WBIT']);

/** Which postseason a game is, from ESPN's id, else its note. POST where neither
 *  says: most of 2001 and 2002, which walkRounds sorts out. */
export function postseasonOf(tournamentId, notes) {
	const named = TOURNAMENTS[Number(tournamentId)];
	if (named) return named;
	const n = String(notes ?? '');
	if (/\bWBIT\b/i.test(n)) return 'WBIT';
	if (/\bWBI\b/i.test(n)) return 'WBI';
	if (/\bW?NIT\b/i.test(n)) return 'NIT';
	if (/\bNCAA\b|\bREGION(AL)?\b|\bFINAL FOUR\b/i.test(n)) return 'NCAA';
	return 'POST';
}

/** The stage a postseason game is filed under: the NCAA tournament's round where
 *  its note names one. Women's never numbered a First Four as the first round,
 *  so roundOf is asked without a season. */
export function stageOf(tournamentId, notes) {
	const which = postseasonOf(tournamentId, notes);
	return which === 'NCAA' ? (roundOf(notes) ?? 'NCAA') : which;
}

/** One sportsdataverse row as a game row, or null. `finished` says the season is
 *  over, when a game never completed is one that was not played. */
export function espnGameRow(r, { finished = false } = {}) {
	const type = Number(r.season_type);
	if (type !== 2 && type !== 3) return null;
	// -1 and -2 are ESPN's sides not yet known.
	if (!/^\d+$/.test(r.home_id) || !/^\d+$/.test(r.away_id)) return null;
	if (/POSTPONED|CANCELED|CANCELLED/.test(r.status_type_name)) return null;
	const played = /^true$/i.test(r.status_type_completed);
	if (!played && finished) return null;
	// 25 "final" 0-0s, 18 of them in 2017, are games never played: no basketball
	// game ends 0-0. A forfeit is 2-0, and counts: the conferences count it.
	if (played && !Number(r.home_score) && !Number(r.away_score)) return null;
	const post = type === 3;
	return {
		id: String(r.id || r.game_id),
		season: Number(r.season),
		// The local date. `date` is UTC, and a night game is already tomorrow there.
		date: r.game_date,
		// The final is marked after the load (walkRounds).
		round: post ? 'playoff' : 'regular',
		stage: post ? stageOf(r.tournament_id, r.notes_headline) : null,
		home: r.home_id,
		away: r.away_id,
		homeScore: played ? Number(r.home_score) : null,
		awayScore: played ? Number(r.away_score) : null,
		neutral: /^true$/i.test(r.neutral_site),
		status: played ? 'final' : 'scheduled',
		source: 'sportsdataverse',
		week: null,
		title: gameName(r.notes_headline),
	};
}

/** Back from the final, each side's rounds: a final's sides each came from the
 *  last game they won before it, and so on down. The last round's games, the
 *  sixth back from the final, are the round of 64; anything behind those is the
 *  First Four. */
const ROUNDS = ['FINAL', 'F4', 'E8', 'S16', 'R32', 'R64'];

/** One season's postseason games `{ id, date, stage, home, away, homeScore,
 *  awayScore }` as a Map of id to the stage each should be, for the games
 *  whose stage is wrong or unnamed; and `final`, the final's id. The games a
 *  walk reaches are the NCAA tournament's whatever they were filed as, which is
 *  what tells 2001's from its WNIT: no team played in both.
 *
 *  Before 2010 the WNIT was the only other postseason, so a game no walk reaches
 *  and no note names is the WNIT's. */
export function walkRounds(games) {
	const stages = new Map();
	const candidates = games.filter((g) => !OTHER_TOURNAMENTS.has(g.stage))
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const final = candidates.filter((g) => g.date === candidates.at(-1)?.date)
		.sort((a, b) => Number(b.stage === 'FINAL') - Number(a.stage === 'FINAL'))[0];
	if (!final) return { stages, final: null };
	const before = (club, date) => candidates.filter((g) => g.date < date && (g.home === club || g.away === club)
		&& (g.home === club ? g.homeScore > g.awayScore : g.awayScore > g.homeScore)).at(-1);
	const reached = new Set();
	const walk = (g, depth) => {
		reached.add(g.id);
		const stage = ROUNDS[depth] ?? 'FF';
		if (g.stage !== stage) stages.set(g.id, stage);
		for (const club of [g.home, g.away]) {
			const prior = before(club, g.date);
			if (prior && !reached.has(prior.id)) walk(prior, depth + 1);
		}
	};
	walk(final, 0);
	for (const g of games) {
		if (!reached.has(g.id) && g.stage === 'POST' && Number(g.season) < 2010) stages.set(g.id, 'NIT');
	}
	return { stages, final: final.id };
}

/** One ESPN scoreboard event as a game row, or null: a game between two
 *  non-clubs is none. */
export function liveGameRow(event, { franchiseOf, knows, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (/POSTPONED|CANCELED/.test(comp.status?.type?.name ?? '')) return null;
	const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
	const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!/^\d+$/.test(homeC?.team?.id ?? '') || !/^\d+$/.test(awayC?.team?.id ?? '')) return null;
	const home = String(homeC.team.id), away = String(awayC.team.id);
	if (knows && !knows(home) && !knows(away)) return null;
	const played = comp.status?.type?.completed === true;
	const notes = (comp.notes ?? []).map((n) => n.headline).join(' ');
	const post = type === 3;
	const stage = post ? stageOf(comp.tournamentId, notes) : null;
	return {
		id: String(event.id),
		season: Number(event.season?.year ?? sources.live.seasonOf(new Date(event.date))),
		date: queryDate ? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}` : String(event.date).slice(0, 10),
		round: stage === 'FINAL' ? 'championship' : post ? 'playoff' : 'regular',
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

/** ESPN ids are unique, and a club plays once a day. */
export const numberEvents = (events) => events.map((event) => ({ event, number: 0 }));

export const championshipTitle = () => 'NCAA Tournament';

export const defaults = mens;

export const sport = {
	id: 'ncaaw',
	name: 'women\'s college basketball',
	sources,
	credits,
	defaults,
	espnGameRow,
	liveGameRow,
	numberEvents,
	championshipTitle,
	gameKey: 'id',
};

export default sport;
