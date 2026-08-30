/** Head-to-head: a club against each of its opponents.
 *
 *  Ported from h2h-core.js on the football site, minus the largest thing in it.
 *  That file carries `canonicalOpponent` and a set of current franchise names,
 *  because it works with display names and has to know that "St. Louis Rams" and
 *  "Los Angeles Rams" are one opponent. Here the rows already carry canonical
 *  franchises — the database resolved them at load — so grouping is a Map and
 *  the name is looked up once, for display, by the era of each game.
 *
 *  Pure. Rows in, one entry per opponent out.
 */

import { rec } from './records.js';

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

/** Everything the head-to-head pages show, from one pass. */
export function computeHeadToHead(rows) {
	const games = rows
		.filter((g) => RESULTS.has(g.result))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	const byOpp = new Map();
	for (const g of games) {
		if (!g.Opponent) continue;
		if (!byOpp.has(g.Opponent)) byOpp.set(g.Opponent, []);
		byOpp.get(g.Opponent).push(g);
	}

	const info = (g) => ({
		date: g.date,
		season: parseInt(g.season, 10),
		result: g.result,
		pf: parseInt(g.scoreFor, 10) || 0,
		pa: parseInt(g.scoreAgainst, 10) || 0,
		playoff: g.regular_season !== '1',
	});

	const opponents = [...byOpp.entries()].map(([code, list]) => {
		const count = { WIN: 0, LOSS: 0, TIE: 0 };
		const playoff = { WIN: 0, LOSS: 0, TIE: 0 };
		let biggestWin = null;
		let worstLoss = null;
		for (const g of list) {
			count[g.result]++;
			if (g.regular_season !== '1') playoff[g.result]++;
			const x = info(g);
			if (g.result === 'WIN' && (!biggestWin || x.pf - x.pa > biggestWin.pf - biggestWin.pa)) biggestWin = x;
			if (g.result === 'LOSS' && (!worstLoss || x.pa - x.pf > worstLoss.pa - worstLoss.pf)) worstLoss = x;
		}

		// The current run against this opponent, however it is going.
		const last = list.at(-1);
		let streak = 1;
		for (let i = list.length - 2; i >= 0 && list[i].result === last.result; i--) streak++;

		const playoffGames = playoff.WIN + playoff.LOSS + playoff.TIE;
		return {
			code,
			slug: code.toLowerCase(),
			games: list.length,
			wins: count.WIN, losses: count.LOSS, ties: count.TIE,
			record: rec(count.WIN, count.LOSS, count.TIE),
			// Ties count half, as everywhere else.
			winPct: (count.WIN + count.TIE / 2) / list.length,
			playoffGames,
			playoffRecord: playoffGames ? rec(playoff.WIN, playoff.LOSS, playoff.TIE) : null,
			first: info(list[0]),
			last: info(last),
			streak: { result: last.result, count: streak },
			biggestWin,
			worstLoss,
			meetings: list.map(info),
		};
	}).sort((a, b) => b.games - a.games || (a.code < b.code ? -1 : 1));

	return { opponents, bySlug: new Map(opponents.map((o) => [o.slug, o])) };
}

/** "Won 4 straight" / "Lost 2 straight" / "Drawn the last 1".
 *
 *  A run of one game is still a run, and saying "Won 1 straight" reads badly, so
 *  it says what the last meeting was instead.
 */
export function streakSentence(streak, team) {
	const verb = { WIN: 'Won', LOSS: 'Lost', TIE: 'Tied' }[streak.result];
	if (streak.count === 1) return `${verb} the last meeting`;
	return `${verb} ${streak.count} straight`;
}
