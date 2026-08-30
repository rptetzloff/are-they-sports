/** The record book.
 *
 *  Ported from `computeSuperlatives` and `computeSeasonHistory` in the football
 *  site's records-core.js, where they already serve twelve lists from one pass.
 *  Rows in, ranked lists out; no rendering, no clock.
 *
 *  Two things changed in the port, both because this serves two sports.
 *
 *  `seasonSettled` was a calendar rule — a season labelled Y runs into January
 *  of Y+1, so by March of Y+1 it is over. That is football's calendar, and
 *  baseball's season ends in the October of its own year. The data already knows
 *  which seasons are finished: one with no unplayed games is settled. Sport
 *  neutral, and it stops depending on a clock at all.
 *
 *  Streaks span seasons or do not, per `rules.streaksSpanSeasons`. The original
 *  hardcoded spanning, with a comment explaining that baseball would want the
 *  opposite — so this takes the rule the manifests already declare.
 */

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

/** "12–0–1", with en-dashes, matching both sites. */
export const rec = (w, l, t) => (t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`);

/** The distinct championship names in one season's finals, most significant
 *  first. A Super Bowl outranks a league championship played to reach it. */
const CHAMPIONSHIP_RANK = (name) => (name === 'Super Bowl' ? 0 : 1);
const titleNames = (games) => [...new Set(games.map((g) => g.championshipTitle).filter(Boolean))]
	.sort((a, b) => CHAMPIONSHIP_RANK(a) - CHAMPIONSHIP_RANK(b) || a.localeCompare(b));

/** Everything the records page shows, from one pass over a club's games. */
export function computeRecords(rows, { top = 5, streaksSpanSeasons = true } = {}) {
	const games = rows
		.filter((r) => RESULTS.has(r.result))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const regular = games.filter((r) => r.regular_season === '1');

	// Which seasons are finished, from the data rather than a calendar. A season
	// with a scheduled game left is still being played, and a club sitting at
	// 3-0 in September must not top a list of best seasons at 1.000.
	const unfinished = new Set(
		rows.filter((r) => !r.result).map((r) => parseInt(r.season, 10)));
	const settled = (yr) => !unfinished.has(yr);

	const seasons = new Map();
	for (const g of regular) {
		const yr = parseInt(g.season, 10);
		if (!seasons.has(yr)) seasons.set(yr, []);
		seasons.get(yr).push(g);
	}
	const years = [...seasons.keys()].sort((a, b) => a - b);
	const seasonRange = { first: years[0], last: years.at(-1) };

	/** Leading run of `result` games to open each season. */
	const seasonStarts = (result) => {
		const out = [];
		for (const yr of years) {
			let n = 0;
			for (const g of seasons.get(yr)) {
				if (g.result === result) n++;
				else break;
			}
			if (n > 0) out.push({ season: yr, games: n });
		}
		return out.sort((a, b) => b.games - a.games || a.season - b.season).slice(0, top);
	};

	// One row per season, from the same pass that finds the unbeaten ones.
	const losslessSeasons = [];
	const seasonRows = [];
	for (const yr of years) {
		let w = 0, l = 0, t = 0;
		for (const g of seasons.get(yr)) {
			if (g.result === 'WIN') w++;
			else if (g.result === 'LOSS') l++;
			else t++;
		}
		if (l === 0 && w > 0 && settled(yr)) losslessSeasons.push({ season: yr, wins: w, record: rec(w, l, t) });
		const played = w + l + t;
		seasonRows.push({
			season: yr, wins: w, losses: l, ties: t, record: rec(w, l, t),
			// Ties count half, as everywhere else.
			winPct: played ? (w + t / 2) / played : 0,
		});
	}
	losslessSeasons.sort((a, b) => b.wins - a.wins || a.season - b.season);

	// Settled seasons only. Win percentage, then the count that makes the season
	// more extreme, then the earlier year.
	//
	// "More extreme" means MORE wins for a best season and MORE losses for a
	// worst one. That is the symmetry, and the port got the second half backwards
	// — `a.losses - b.losses` put FEWER losses first, so 0-10 outranked 0-16 as
	// the worst season a club ever had. The live football site still does this,
	// and its comment says exactly what the code should do while the code does
	// the opposite, which is why nobody caught it in either repo.
	//
	// The reasoning offered for it here was that a short winless season "lost
	// less and still won nothing". That is a defence of the output rather than a
	// rule: at the same .000, losing sixteen is worse than losing ten by every
	// reading anyone actually uses, and it is the mirror of 15-0 beating 4-0.
	const completed = seasonRows.filter((r) => settled(r.season) && (r.wins + r.losses + r.ties) > 0);
	const bestSeasons = completed.slice()
		.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || a.season - b.season).slice(0, top);
	const worstSeasons = completed.slice()
		.sort((a, b) => a.winPct - b.winPct || b.losses - a.losses || a.season - b.season).slice(0, top);

	/** Runs of one result. A tie ends a win streak, by record-book convention.
	 *
	 *  Whether a season boundary ends one is the manifest's call. Football's
	 *  longest is 15 games from December 2010 into December 2011, and ending it
	 *  at the boundary would erase the record the list exists to show; across 162
	 *  baseball games the within-season run is what anyone means.
	 */
	const streaksOf = (result) => {
		const streaks = [];
		let run = null;
		const endRun = () => { if (run) { streaks.push(run); run = null; } };
		let lastSeason = null;
		for (const g of regular) {
			if (!streaksSpanSeasons && lastSeason !== null && g.season !== lastSeason) endRun();
			lastSeason = g.season;
			if (g.result === result) {
				if (!run) run = { games: 0, start: null, end: null };
				run.games++;
				if (!run.start) run.start = g;
				run.end = g;
			} else {
				endRun();
			}
		}
		endRun();
		return streaks;
	};

	const rankStreaks = (list) => list
		.sort((a, b) => b.games - a.games || (a.start.date < b.start.date ? -1 : 1))
		.slice(0, top)
		.map((s) => ({
			games: s.games,
			startDate: s.start.date, endDate: s.end.date,
			startSeason: parseInt(s.start.season, 10), endSeason: parseInt(s.end.season, 10),
		}));

	const gameInfo = (g) => {
		const pf = parseInt(g.scoreFor, 10) || 0;
		const pa = parseInt(g.scoreAgainst, 10) || 0;
		return {
			// The game id, because a league-wide view sees every game twice —
			// once per club — and a tie is a tie for both. Date plus opponent
			// would collide on a doubleheader, which baseball has.
			gid: g.gid,
			date: g.date, season: parseInt(g.season, 10), opponent: g.Opponent,
			pf, pa,
			playoff: g.regular_season !== '1',
			championship: Boolean(g.championship && g.championship.trim()),
		};
	};

	/** Biggest margins, either direction: margin, then the winner's score, then date. */
	const lopsided = (result) => games
		.filter((g) => g.result === result)
		.map(gameInfo)
		.sort((a, b) => Math.abs(b.pf - b.pa) - Math.abs(a.pf - a.pa)
			|| Math.max(b.pf, b.pa) - Math.max(a.pf, a.pa)
			|| (a.date < b.date ? -1 : 1))
		.slice(0, top);

	// Every tie ever, not a top-N list; newest first.
	const ties = games.filter((g) => g.result === 'TIE').map(gameInfo).reverse();

	const postseason = games.filter((g) => g.regular_season !== '1');
	const bySeasonPost = new Map();
	for (const g of postseason) {
		const yr = parseInt(g.season, 10);
		if (!bySeasonPost.has(yr)) bySeasonPost.set(yr, []);
		bySeasonPost.get(yr).push(g);
	}
	const playoffAppearances = [...bySeasonPost.entries()]
		.map(([season, list]) => {
			const w = list.filter((g) => g.result === 'WIN').length;
			const l = list.filter((g) => g.result === 'LOSS').length;
			const titles = list.filter((g) => g.championship && g.championship.trim());
			return {
				season,
				games: list.length,
				record: rec(w, l, 0),
				// A title is more championship-round wins than losses, which is
				// the series rule seasonTally uses and is right for a
				// best-of-seven as well as a one-game final. The original asked
				// whether the last postseason game was a win, which is the same
				// answer for football and the wrong one for baseball.
				won: titles.filter((g) => g.result === 'WIN').length
					> titles.filter((g) => g.result === 'LOSS').length,
				championship: titles.length > 0,
				// EVERY name, not the first. A season can have more than one
				// final: the Packers won the NFL Championship and Super Bowl I
				// in 1966, and both games are in the data. Keeping titles[0]
				// labelled that season "NFL Championship" and undercounted their
				// Super Bowls by two — which is the number anyone checks.
				//
				// Sorted so the most significant leads: a Super Bowl outranks
				// the league final that fed into it.
				title: titleNames(titles)[0] ?? null,
				titleNames: titleNames(titles),
			};
		})
		.sort((a, b) => b.season - a.season);

	return {
		seasonRange,
		// Every season, not a ranking. The club page never needed it; a league
		// table does, because an all-time record is the sum of them and summing
		// the top five is not the same number.
		everySeason: seasonRows,
		bestSeasons,
		worstSeasons,
		bestStarts: seasonStarts('WIN'),
		worstStarts: seasonStarts('LOSS'),
		losslessSeasons,
		winStreaks: rankStreaks(streaksOf('WIN')),
		loseStreaks: rankStreaks(streaksOf('LOSS')),
		lopsidedWins: lopsided('WIN'),
		lopsidedLosses: lopsided('LOSS'),
		ties,
		playoffAppearances,
		championshipAppearances: playoffAppearances
			.filter((a) => a.championship)
			.map((a) => ({ season: a.season, won: a.won, record: a.record, title: a.title, titleNames: a.titleNames })),
	};
}
