// Shared (browser + node) all-time head-to-head records vs every opponent,
// computed from data/brewers_games.csv. Pure functions only — no fs/fetch/DOM.
//
// Opponents are grouped by franchise (the stable `franchiseName` code from
// CurrentNames.csv), so a franchise that relocates or rebrands — e.g. the
// Athletics (Philadelphia → Kansas City → Oakland → Sacramento) — is one
// continuous opponent, not split across cities. The display name is the
// opponent's most recent era name (so the A's show as "Sacramento Athletics"
// today), and the slug is derived from that current name.
import { rec, formatDate } from './records-core.js';
import { SITE } from './site.js';

export const slugifyOpponent = (name) =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

// Per-opponent split counter. Returns an object with W/L/T fields plus
// totals helpers, useful for home/away, regular/post, and era breakdowns.
const splitCount = () => ({ WIN: 0, LOSS: 0, TIE: 0 });
const splitRec = (c) => rec(c.WIN, c.LOSS, c.TIE);
const splitGames = (c) => c.WIN + c.LOSS + c.TIE;
const splitPct = (c) => { const n = splitGames(c); return n ? (c.WIN + c.TIE / 2) / n : 0; };

// Detailed per-opponent breakdown derived purely from the parsed game rows.
// Splits: overall, home/away, regular/postseason, by era (the opponent's
// name at the time, e.g. "Tampa Bay Devil Rays" vs "Tampa Bay Rays").
// Also: longest win/loss streaks, biggest win, most lopsided loss, shutouts
// (both directions), and run differential. `rows` should already be scoped
// to the one opponent (all games with that franchise code).
export function computeOpponentDetail(rows) {
	const games = rows
		.filter((g) => RESULTS.has(g['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	if (!games.length) return null;

	const overall = splitCount();
	const home = splitCount();
	const away = splitCount();
	const regular = splitCount();
	const post = splitCount();
	const eraMap = new Map(); // eraName -> splitCount
	let runsFor = 0, runsAgainst = 0;
	let shutouts = 0, shutoutLosses = 0;
	let biggestWin = null, worstLoss = null;

	const bump = (c, r) => { c[r]++; };

	for (const g of games) {
		const r = g['result'];
		const pf = parseInt(g.scoreFor, 10) || 0;
		const pa = parseInt(g.scoreAgainst, 10) || 0;
		bump(overall, r);
		bump(g.location === 'home' ? home : away, r);
		if (g.regular_season === '1') bump(regular, r); else bump(post, r);
		const era = g.Opponent;
		if (!eraMap.has(era)) eraMap.set(era, splitCount());
		bump(eraMap.get(era), r);
		runsFor += pf; runsAgainst += pa;
		if (r === 'WIN' && pa === 0) shutouts++;
		if (r === 'LOSS' && pf === 0) shutoutLosses++;
		if (r === 'WIN') {
			if (!biggestWin || pf - pa > biggestWin.margin) biggestWin = { pf, pa, margin: pf - pa, date: g.date, season: parseInt(g.season, 10) };
		} else if (r === 'LOSS') {
			if (!worstLoss || pa - pf > worstLoss.margin) worstLoss = { pf, pa, margin: pa - pf, date: g.date, season: parseInt(g.season, 10) };
		}
	}

	// Streaks across all games (any venue/type), chronological.
	let curResult = null, curLen = 0, bestWin = 0, bestLoss = 0;
	for (const g of games) {
		const r = g['result'];
		if (r === curResult) curLen++;
		else { curResult = r; curLen = 1; }
		if (r === 'WIN' && curLen > bestWin) bestWin = curLen;
		if (r === 'LOSS' && curLen > bestLoss) bestLoss = curLen;
	}

	const eras = [...eraMap.entries()]
		.map(([name, c]) => ({ name, record: splitRec(c), games: splitGames(c), wins: c.WIN, losses: c.LOSS, ties: c.TIE, winPct: splitPct(c) }))
		.sort((a, b) => b.games - a.games || (a.name < b.name ? -1 : 1));

	// Most recent 10 meetings (any venue/type), chronological tail.
	const lastTen = splitCount();
	for (const g of games.slice(-10)) bump(lastTen, g['result']);

	return {
		games: games.length,
		overall: { record: splitRec(overall), games: splitGames(overall), wins: overall.WIN, losses: overall.LOSS, ties: overall.TIE, winPct: splitPct(overall) },
		lastTen: { record: splitRec(lastTen), games: splitGames(lastTen), wins: lastTen.WIN, losses: lastTen.LOSS, ties: lastTen.TIE, winPct: splitPct(lastTen) },
		home: { record: splitRec(home), games: splitGames(home), wins: home.WIN, losses: home.LOSS, ties: home.TIE, winPct: splitPct(home) },
		away: { record: splitRec(away), games: splitGames(away), wins: away.WIN, losses: away.LOSS, ties: away.TIE, winPct: splitPct(away) },
		regular: { record: splitRec(regular), games: splitGames(regular), wins: regular.WIN, losses: regular.LOSS, ties: regular.TIE, winPct: splitPct(regular) },
		post: { record: splitRec(post), games: splitGames(post), wins: post.WIN, losses: post.LOSS, ties: post.TIE, winPct: splitPct(post) },
		eras,
		runsFor, runsAgainst,
		runDiff: runsFor - runsAgainst,
		shutouts, shutoutLosses,
		bestWinStreak: bestWin, worstLossStreak: bestLoss,
		biggestWin, worstLoss,
		first: games[0], last: games[games.length - 1],
	};
}

// rows: parsed game rows (each carries a `franchise` code and an `Opponent`
// display name). Returns { opponents, bySlug, latestSeason } — opponents
// sorted by meetings played (rivals first), then name. All games count
// (playoffs included); the playoff split is broken out per opponent.
//
// A franchise is "current" if it appears in the latest season present in the
// data, so the "Current franchises only" filter stays accurate as franchises
// relocate or rebrand without needing a hardcoded list.
export function computeHeadToHead(rows) {
	const games = rows
		.filter((g) => RESULTS.has(g['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	let latestSeason = 0;
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (yr > latestSeason) latestSeason = yr;
	}

	const byFran = new Map();
	for (const g of games) {
		const key = g.franchise || g.Opponent;
		if (!byFran.has(key)) byFran.set(key, []);
		byFran.get(key).push(g);
	}

	const info = (g) => ({
		date: g.date, season: parseInt(g.season, 10),
		result: g['result'],
		pf: parseInt(g.scoreFor, 10) || 0,
		pa: parseInt(g.scoreAgainst, 10) || 0,
	});

	const opponents = [...byFran.entries()].map(([fran, list]) => {
		const count = { WIN: 0, LOSS: 0, TIE: 0 };
		const playoff = { WIN: 0, LOSS: 0, TIE: 0 };
		let biggestWin = null;
		for (const g of list) {
			const r = g['result'];
			count[r]++;
			if (g.regular_season !== '1') playoff[r]++;
			if (r === 'WIN') {
				const w = info(g);
				if (!biggestWin || w.pf - w.pa > biggestWin.pf - biggestWin.pa) biggestWin = w;
			}
		}
		const last = list[list.length - 1];
		let streak = 1;
		for (let i = list.length - 2; i >= 0 && list[i]['result'] === last['result']; i--) streak++;
		const playoffGames = playoff.WIN + playoff.LOSS + playoff.TIE;
		// Display name = the opponent's most recent era name. Games are sorted
		// ascending by date, so the last row carries the current-era name
		// (e.g. "Sacramento Athletics" for the A's franchise today).
		const name = last.Opponent;
		return {
			name, slug: slugifyOpponent(name),
			franchise: fran,
			current: parseInt(last.season, 10) === latestSeason,
			games: list.length,
			wins: count.WIN, losses: count.LOSS, ties: count.TIE,
			record: rec(count.WIN, count.LOSS, count.TIE),
			winPct: (count.WIN + count.TIE / 2) / list.length,
			playoffGames,
			playoffRecord: playoffGames ? rec(playoff.WIN, playoff.LOSS, playoff.TIE) : null,
			first: info(list[0]), last: info(last),
			streak: { result: last['result'], count: streak },
			biggestWin,
		};
	}).sort((a, b) => b.games - a.games || (a.name < b.name ? -1 : 1));

	return { opponents, bySlug: new Map(opponents.map((o) => [o.slug, o])) };
}

// "The Brewers have won the last 8 meetings." / single-game fallback.
export function streakSentence(o, site = SITE) {
	const { result, count } = o.streak;
	const verb = result === 'WIN' ? 'won' : result === 'LOSS' ? 'lost' : 'tied';
	if (count >= 2) return `The ${site.team} have ${verb} the last ${count} ${site.meetingPlural}.`;
	const noun = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'tie';
	return `Last ${site.meetingNoun}: a ${o.last.pf}–${o.last.pa} ${noun} on ${formatDate(o.last.date)}.`;
}

// Per-opponent copy shared by server OG meta and client share messages.
// slug 'overview'/unknown -> landing-page copy.
export function h2hCopy(slug, data, site = SITE) {
	const o = data.bySlug.get(slug);
	if (!o) {
		const top = data.opponents[0];
		return {
			title: `${site.team} All-Time Head-to-Head`,
			desc: `The ${site.team}' all-time record against all ${data.opponents.length} opponents they've ever faced. Most played: the ${top.name}, ${top.record} in ${top.games} ${site.meetingPlural}.`,
		};
	}
	return {
		title: `${site.team} vs ${o.name} — ${o.record} all-time`,
		desc: `The ${site.team} are ${o.record} all-time against the ${o.name} in ${meetings(o.games, site)}. ${streakSentence(o, site)}`,
	};
}

export const meetings = (n, site = SITE) => `${n} ${n === 1 ? site.meetingNoun : site.meetingPlural}`;
