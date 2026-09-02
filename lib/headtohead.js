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
export function computeHeadToHead(rows, { isCurrent = null } = {}) {
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
		// Carried so the opponent page can split home from away without going
		// back to the rows. It was the one field this dropped, and the split is
		// the first thing the baseball site's breakdown shows.
		home: g.location === 'home',
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
			// Null, not false, when nobody asked. A page that cannot tell a
			// defunct franchise from a current one must not draw a filter that
			// claims it can, and `false` everywhere would look like an answer.
			current: isCurrent ? isCurrent(code) : null,
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

/** The games a set of filters leaves.
 *
 *  Applied to the ROWS and not to the totals, which is the whole reason this
 *  exists: a home-only record is not recoverable from an all-venues one. The
 *  two sites do the same -- `vs.js` filters the parsed rows and calls
 *  `computeHeadToHead` again on the subset.
 *
 *  Unknown values pass everything rather than nothing. A hand-typed
 *  `?venue=stadium` should show the table, the same way an unknown sort key
 *  falls back instead of erroring.
 */
export function filterGames(rows, { venue = 'all', type = 'all' } = {}) {
	if (venue === 'all' && type === 'all') return rows;
	return rows.filter((g) => {
		if (venue === 'home' && g.location !== 'home') return false;
		if (venue === 'away' && g.location === 'home') return false;
		if (type === 'regular' && g.regular_season !== '1') return false;
		if (type === 'playoffs' && g.regular_season === '1') return false;
		return true;
	});
}

/** One split's totals. */
const tally = (list) => {
	const c = { WIN: 0, LOSS: 0, TIE: 0 };
	for (const g of list) c[g.result]++;
	const games = c.WIN + c.LOSS + c.TIE;
	return {
		games,
		wins: c.WIN, losses: c.LOSS, ties: c.TIE,
		record: rec(c.WIN, c.LOSS, c.TIE),
		winPct: games ? (c.WIN + c.TIE / 2) / games : 0,
	};
};

/** Everything the page about ONE opponent shows beyond the game list.
 *
 *  Ported from the baseball site's `computeOpponentDetail`, which the football
 *  site does not have at all -- 206 lines of `h2h-core.js` there against 118
 *  here, and this is most of the difference. It is sport-neutral as written,
 *  so both get it.
 *
 *  `eraOf` names the opponent as they were called at the time, which is what
 *  turns one franchise row into "Boston Braves 12-8, Milwaukee Braves 40-33,
 *  Atlanta Braves ...". Optional: without it the era table is simply absent,
 *  because a caller with no resolver has nothing true to put in it.
 *
 *  The shutout counts are NOT sport-neutral in meaning -- a 0-0 football game is
 *  a tie and a scoreless baseball game goes to extras -- but the count is, and
 *  both sports call a win where the other side scored nothing a shutout.
 */
export function opponentDetail(meetings, { eraOf = null } = {}) {
	if (!meetings.length) return null;
	const games = [...meetings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	let pf = 0, pa = 0, shutouts = 0, shutoutLosses = 0;
	for (const g of games) {
		pf += g.pf;
		pa += g.pa;
		if (g.result === 'WIN' && g.pa === 0) shutouts++;
		if (g.result === 'LOSS' && g.pf === 0) shutoutLosses++;
	}

	// The longest run either way, over every meeting in date order. Not the same
	// as the CURRENT streak, which `computeHeadToHead` already carries.
	let run = 0, last = null, longestWin = 0, longestLoss = 0;
	for (const g of games) {
		run = g.result === last ? run + 1 : 1;
		last = g.result;
		if (g.result === 'WIN' && run > longestWin) longestWin = run;
		if (g.result === 'LOSS' && run > longestLoss) longestLoss = run;
	}

	const eras = [];
	if (eraOf) {
		// Grouped by the name in force, in first-meeting order, so the list reads
		// as the franchise's history rather than as a ranking.
		const byEra = new Map();
		for (const g of games) {
			const name = eraOf(g);
			if (!byEra.has(name)) byEra.set(name, []);
			byEra.get(name).push(g);
		}
		for (const [name, list] of byEra) eras.push({ name, ...tally(list) });
	}

	return {
		overall: tally(games),
		// "Last 10" where there have been fewer than ten is the whole history
		// again, which duplicates the overall row rather than saying something.
		// The count travels with it so the heading can say what it is.
		recent: tally(games.slice(-10)),
		home: tally(games.filter((g) => g.home)),
		away: tally(games.filter((g) => !g.home)),
		regular: tally(games.filter((g) => !g.playoff)),
		post: tally(games.filter((g) => g.playoff)),
		// Only when there is more than one era. A single-era table is a heading
		// over a row that repeats the overall record.
		eras: eras.length > 1 ? eras : [],
		pointsFor: pf,
		pointsAgainst: pa,
		differential: pf - pa,
		shutouts,
		shutoutLosses,
		longestWinStreak: longestWin,
		longestLossStreak: longestLoss,
	};
}
