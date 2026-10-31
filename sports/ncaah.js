/** The men's college hockey (Division I) adapter: where its games come from, and
 *  how they become rows.
 *
 *  ONE SOURCE, ESPN's scoreboards, a day at a time. Nobody publishes them as files
 *  and they take no date range, so scripts/ncaah-games.mjs read all 4,800 days once
 *  and wrote data/reference/ncaah-games.csv, which the load reads: a deployed load
 *  makes no history calls. The season being played comes from the same scoreboard,
 *  with the same ids, so a live row and its later history row are one game.
 *
 *  THE GAMES BEGIN WITH 2003-04. ESPN has 2002-03 and nothing before it, but a
 *  fifth of that season has no score (247 of 1,107, most of February and March),
 *  which would make every record in it wrong. College Hockey News goes back to
 *  1948-49, and its terms forbid copying it without written permission, which we
 *  do not have. So it is not a source here, and its name should not be read as one.
 *
 *  THE CLUBS ARE TODAY'S DIVISION I, as for basketball. A game counts when one of
 *  them played in it; every other team is a franchise with no page.
 *
 *  A SEASON IS THE YEAR IT ENDS: 2024-25 is 2025.
 *
 *  WHAT COUNTS: a conference tournament is the regular season's, as ESPN files it;
 *  the postseason is the NCAA tournament. 2020 has none: it was cancelled.
 *
 *  THE TOURNAMENT is Wikipedia's bracket. ESPN marks it only from 2022 and has lost
 *  nine of its games (2011, 2015, 2016, 2017, 2019), so bracketGames reads the
 *  field and its rounds, and the games file matches them to ESPN's ids and adds
 *  the ones it lacks. Rounds use basketball's names for the same sizes: a regional
 *  semifinal is S16, a regional final E8, the Frozen Four F4.
 *
 *  A SHOOTOUT IS A TIE. The NCAA keeps win-loss-tie and counts a game settled in a
 *  shootout as a tie; only a conference's standings give it to anyone. ESPN adds a
 *  goal to the winner, 6-5 for what was 5-5, so scoresOf takes it back off.
 *  `ending` keeps that it went to one.
 *
 *  WHAT THE SCOREBOARDS DO NOT SAY. 178 "final" games have no score or are 0-0 with
 *  no plays, and ESPN's summaries are as empty: the score is lost, and 13 of them
 *  are one night, January 30, 2026. Hockey can end 0-0 and now and then does, but
 *  these cannot be told from those, so none is loaded. Nor are four games of a
 *  year before filed on the same weekend a year late (their ids are their true
 *  dates), which scripts/ncaah-games.mjs knows by ESPN's season.
 */
import { gameName, roundOf } from './ncaam.js';

export const sources = {
	/** The games file's first season, and what scripts/ncaah-games.mjs reads. */
	history: { reference: 'ncaah-games.csv', from: 2004 },
	live: {
		// No `groups`: this league has none, and asking for basketball's 50 gives
		// an empty day.
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-college-hockey/scoreboard?dates=${yyyymmdd}&limit=200`,
		/** Late September of the year before to the Frozen Four's April. */
		daysOf(season) {
			const out = [];
			const d = new Date(Date.UTC(season - 1, 8, 25));
			const end = new Date(Date.UTC(season, 3, 20));
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
		name: 'ESPN',
		url: 'https://www.espn.com/mens-college-hockey/',
		note: 'every game from 2003-04, from its scoreboards',
	},
];

/** A tournament game's round, from ESPN's note: basketball's words, but for the
 *  Frozen Four's. */
export const stageOf = (notes) => (/frozen four/i.test(notes) ? 'F4' : roundOf(notes) ?? 'NCAA');

/** How a game ended, from ESPN's status: `Final`, `Final/OT`, `Final/SO`. */
export function endingOf(detail) {
	const d = String(detail ?? '');
	if (/\/SO\b/.test(d)) return 'SO';
	if (/OT\b/.test(d)) return 'OT';
	return 'REG';
}

/** A game's two scores as they stand in the record: a shootout's winner gives back
 *  the goal ESPN added. 86 of the 98 have it; the rest are already level. */
export function scoresOf(home, away, ending) {
	const h = Number(home), a = Number(away);
	if (ending === 'SO' && Math.abs(h - a) === 1) return [Math.min(h, a), Math.min(h, a)];
	return [h, a];
}

/** One game as a row, from anything that gives the fields: the games file's row or
 *  an event read by eventFields. Null is a game with no result to keep. */
function toRow(g, franchiseOf = (id) => id) {
	const played = g.played;
	if (played && !Number(g.homeScore) && !Number(g.awayScore)) return null;
	const ending = played ? g.ending : null;
	const [homeScore, awayScore] = played ? scoresOf(g.homeScore, g.awayScore, ending) : [null, null];
	return {
		id: g.id,
		season: g.season,
		date: g.date,
		round: g.stage === 'FINAL' ? 'championship' : g.stage ? 'playoff' : 'regular',
		stage: g.stage,
		ending,
		home: franchiseOf(g.home),
		away: franchiseOf(g.away),
		homeScore,
		awayScore,
		neutral: g.neutral,
		status: played ? 'final' : 'scheduled',
		source: g.source,
		week: null,
		title: g.title,
	};
}

/** One row of data/reference/ncaah-games.csv as a game row. */
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
	const type = event.season?.type ?? 2;
	if (type !== 2 && type !== 3) return null;
	if (/POSTPONED|CANCELED/.test(comp.status?.type?.name ?? '')) return null;
	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!/^\d+$/.test(home?.team?.id ?? '') || !/^\d+$/.test(away?.team?.id ?? '')) return null;
	const date = queryDate ? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}` : String(event.date).slice(0, 10);
	const notes = (comp.notes ?? []).map((n) => n.headline).join(' ');
	const post = type === 3;
	return {
		id: String(event.id),
		season: sources.live.seasonOf(new Date(`${date}T12:00:00Z`)),
		// ESPN's own, to tell a game filed a year late.
		filedSeason: event.season?.year ?? null,
		date,
		stage: post ? stageOf(notes) : null,
		ending: endingOf(comp.status?.type?.shortDetail),
		home: String(home.team.id),
		homeName: home.team.location,
		homeScore: home.score,
		away: String(away.team.id),
		awayName: away.team.location,
		awayScore: away.score,
		neutral: Boolean(comp.neutralSite),
		played: comp.status?.type?.completed === true,
		source: 'espn',
		title: gameName(notes),
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

const STAGES = ['S16', 'E8', 'F4', 'FINAL'];

/** The text of each template of a kind, by its braces. */
function templates(wikitext, name) {
	const out = [];
	for (const m of wikitext.matchAll(new RegExp(`\\{\\{\\s*${name}`, 'gi'))) {
		let depth = 0, end = m.index;
		for (; end < wikitext.length; end++) {
			if (wikitext.startsWith('{{', end)) { depth++; end++; } else if (wikitext.startsWith('}}', end)) { depth--; end++; if (!depth) break; }
		}
		out.push(wikitext.slice(m.index, end));
	}
	return out;
}

const plain = (s) => String(s ?? '').replace(/<s>.*?<\/s>/g, '').replace(/<[^>]+>/g, '')
	.replace(/\{\{[^|}]*\|([^}]*)\}\}/g, '$1').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').trim();

/** A bracket template's fields, by name. Its numbers are written team1 and team01,
 *  and a value can hold a link's or a template's own bar. */
function fieldsOf(body) {
	const fields = new Map();
	for (const m of body.matchAll(/\|\s*(RD\d-(?:seed|team|score)\d+|RD1-group\d|subgroup\d)\s*=\s*((?:\[\[[^\]]*\]\]|\{\{[^}]*\}\}|[^\n|])*)/g)) {
		fields.set(m[1].replace(/(\D)0+(\d)/, '$1$2'), m[2]);
	}
	return fields;
}

/** One game of a template: the sides of its round's Nth pair, or null where it was
 *  not played (2021's Michigan, withdrawn). */
function gameOf(fields, round, n) {
	const side = (i) => {
		const raw = plain(fields.get(`RD${round}-team${i}`));
		const score = fields.get(`RD${round}-score${i}`) ?? '';
		return {
			name: raw.replace(/\s*\(\d+\)\s*/g, '').replace(/[†‡*]/g, '').trim(),
			overall: Number(raw.match(/\((\d+)\)/)?.[1]) || null,
			seed: plain(fields.get(`RD${round}-seed${i}`)),
			score: plain(score).match(/\d+/)?.[0],
			ot: score.includes('*'),
		};
	};
	const a = side(n * 2 + 1), b = side(n * 2 + 2);
	if (a.score === undefined || b.score === undefined || !a.name || !b.name) return null;
	return {
		team1: a.name, team2: b.name, score1: Number(a.score), score2: Number(b.score),
		seed1: a.seed, seed2: b.seed, overall1: a.overall, overall2: b.overall, ot: a.ot || b.ot,
	};
}

/** Every game of a tournament page's bracket, as `{ stage, round, region, team1,
 *  team2, score1, score2, seed1, seed2, overall1, overall2, ot }`, the winner the
 *  higher score and a side's name the page's own.
 *
 *  One 16TeamBracket, but for 2013's page, which draws each regional and the Frozen
 *  Four as a 4TeamBracket of their own. */
export function bracketGames(wikitext) {
	const games = [];
	const [whole] = templates(wikitext, '16TeamBracket');
	if (whole) {
		const fields = fieldsOf(whole);
		const regions = [1, 2, 3, 4].map((i) => plain(fields.get(`RD1-group${i}`) ?? fields.get(`subgroup${i}`)).split(/\s[–-]\s/)[0].trim());
		STAGES.forEach((stage, r) => {
			const count = 8 >> r;
			for (let n = 0; n < count; n++) {
				const game = gameOf(fields, r + 1, n);
				if (game) games.push({ stage, round: r + 1, region: r < 2 ? regions[Math.floor(n / (count / 4))] : null, ...game });
			}
		});
		return games;
	}
	for (const body of templates(wikitext, '4TeamBracket')) {
		const fields = fieldsOf(body);
		const before = wikitext.slice(0, wikitext.indexOf(body));
		const heading = [...before.matchAll(/^={2,4}\s*(.+?)\s*={2,4}\s*$/gm)].at(-1)?.[1] ?? '';
		const regional = /regional/i.test(heading);
		const region = regional ? plain(heading).split(/\s[–-]\s/)[0].replace(/\s*Regional$/i, '').trim() : null;
		const rounds = regional ? [['S16', 1], ['E8', 2]] : [['F4', 3], ['FINAL', 4]];
		rounds.forEach(([stage, round], r) => {
			for (let n = 0; n < 2 >> r; n++) {
				const game = gameOf(fields, r + 1, n);
				if (game) games.push({ stage, round, region, ...game });
			}
		});
	}
	return games.sort((a, b) => a.round - b.round);
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
	/** The NHL's list: ties stay, because the game can still end tied, and an
	 *  unbeaten season is not plausible over thirty-odd games. */
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
		/** A conference is ranked by its conference games, as basketball's are. */
		standingsByConference: true,
	},
};

export const sport = {
	id: 'ncaah',
	name: 'men\'s college hockey',
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
