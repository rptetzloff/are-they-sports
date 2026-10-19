// Shared (browser + node) all-time head-to-head records vs every opponent,
// computed from data/packers_games.csv. Pure functions only — no fs/fetch/DOM.
import { rec, formatDate } from './records-core.js';
import { SITE } from './site.js';

export const slugifyOpponent = (name) =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The CSV's pre-1999 rows (FiveThirtyEight) map franchises to modern names,
// but the 1999+ rows (nflverse) use as-of-game names, splitting relocated
// franchises in two. Fold those eras together. (Baltimore Colts and Dallas
// Texans are NOT aliases — those are distinct defunct franchises.)
const FRANCHISE_ALIASES = {
	'St. Louis Rams': 'Los Angeles Rams',
	'San Diego Chargers': 'Los Angeles Chargers',
	'Oakland Raiders': 'Las Vegas Raiders',
};
// In are-they-sports the server sends every name each franchise has carried,
// mapped to its latest (SITE.franchiseAliases, from the franchise history
// table), because the names here are era-correct before 1999 too: a 1950
// game is against the Chicago Cardinals, and they still fold into Arizona.
// The three above stay as the fallback the site always had.
export const canonicalOpponent = (name) => SITE.franchiseAliases?.[name] || FRANCHISE_ALIASES[name] || name;

// The other active NFL franchises, by the canonical names used in the CSV.
// In are-they-sports the server lists them per club from the franchise
// history table, because "the 31 others" is a different 31 for every club.
const CURRENT_FRANCHISES = new Set(SITE.currentFranchises ?? []);

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

// rows: parsed CSV rows. Returns { opponents, bySlug } — opponents sorted by
// meetings played (rivals first), then name. All games count (playoffs
// included); the playoff split is broken out per opponent.
export function computeHeadToHead(rows) {
	const games = rows
		.filter((g) => RESULTS.has(g.result))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	const byOpp = new Map();
	for (const g of games) {
		const name = canonicalOpponent(g.Opponent);
		if (!byOpp.has(name)) byOpp.set(name, []);
		byOpp.get(name).push(g);
	}

	const info = (g) => ({
		date: g.date, season: parseInt(g.season, 10),
		result: g.result,
		pf: parseInt(g.scoreFor, 10) || 0,
		pa: parseInt(g.scoreAgainst, 10) || 0,
	});

	const opponents = [...byOpp.entries()].map(([name, list]) => {
		const count = { WIN: 0, LOSS: 0, TIE: 0 };
		const playoff = { WIN: 0, LOSS: 0, TIE: 0 };
		let biggestWin = null;
		for (const g of list) {
			const r = g.result;
			count[r]++;
			if (g.regular_season !== '1') playoff[r]++;
			if (r === 'WIN') {
				const w = info(g);
				if (!biggestWin || w.pf - w.pa > biggestWin.pf - biggestWin.pa) biggestWin = w;
			}
		}
		const last = list[list.length - 1];
		let streak = 1;
		for (let i = list.length - 2; i >= 0 && list[i].result === last.result; i--) streak++;
		const playoffGames = playoff.WIN + playoff.LOSS + playoff.TIE;
		return {
			name, slug: slugifyOpponent(name),
			current: CURRENT_FRANCHISES.has(name),
			games: list.length,
			wins: count.WIN, losses: count.LOSS, ties: count.TIE,
			record: rec(count.WIN, count.LOSS, count.TIE),
			winPct: (count.WIN + count.TIE / 2) / list.length,
			playoffGames,
			playoffRecord: playoffGames ? rec(playoff.WIN, playoff.LOSS, playoff.TIE) : null,
			first: info(list[0]), last: info(last),
			streak: { result: last.result, count: streak },
			biggestWin,
		};
	}).sort((a, b) => b.games - a.games || (a.name < b.name ? -1 : 1));

	return { opponents, bySlug: new Map(opponents.map((o) => [o.slug, o])) };
}

// "The Packers have won the last 8 meetings." / single-game fallback.
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
