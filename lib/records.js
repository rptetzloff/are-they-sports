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

/** ".5708", a winning percentage over a century of games.
 *
 *  No leading zero, which is how both sports write it. Four decimals rather
 *  than the conventional three, and that part is measured rather than chosen:
 *  across the 32 current NFL clubs, three decimals produces THREE collisions —
 *  Cowboys and Packers both at .571, Vikings and Dolphins and Chiefs all at
 *  .550, Saints and Lions at .463. Four produces none.
 *
 *  The Cowboys are .57094 and the Packers .57080, which is a real gap after
 *  1,500 games apiece and one the third decimal simply deletes. A table whose
 *  whole job is ranking clubs must not print the same number for two of them.
 *
 *  Three for a single season, where 17 games cannot resolve a fourth decimal and
 *  ".5588" claims a precision the sample does not have. That is what `digits`
 *  is for, added when the history page became the first thing to render a
 *  season percentage — which the previous version of this comment said would
 *  happen, and it did.
 *
 *  Two things this is NOT. It is not extra precision over the "57.1" it
 *  replaced — a percentage at one decimal and a rate at three are the same
 *  three significant figures, and an earlier draft of this comment claimed
 *  otherwise. And a perfect record keeps its leading 1, because "1.0000" is
 *  read instantly and ".0000" is the opposite number.
 */
export const pct = (p, digits = 4) => (p >= 1 ? p.toFixed(digits) : p.toFixed(digits).replace(/^0/, ''));

/** A Super Bowl outranks the league championship played to reach it.
 *
 *  The `titleNames` helper that used to sit here is gone: `finalOf` now answers
 *  the same question from the per-round tally, and two implementations of "which
 *  of this season's finals matters most" is how the chart came to disagree with
 *  the record card. */
const CHAMPIONSHIP_RANK = (name) => (name === 'Super Bowl' ? 0 : 1);

/** Everything the records page shows, from one pass over a club's games. */
export function computeRecords(rows, { top = 5, streaksSpanSeasons = true, titles = [] } = {}) {
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

	// WHAT each season's final was and how it ended, per ROUND.
	//
	// Three things were wrong with the season-wide count this replaces, and the
	// third is the one that cost titles.
	//
	// It printed the club's MODERN championship noun, so Green Bay's 1936 read
	// "Super Bowl" thirty years early. It gave a season the club REACHED the
	// final and lost the same blank cell as a season it missed the playoffs. And
	// it added every championship-round game in a season together, so a club that
	// won one final and lost a bigger one came out level and counted as neither.
	//
	// That last is not hypothetical. Eight clubs played two finals in a season
	// between 1966 and 1969, and four of them won their league championship and
	// then lost the Super Bowl -- Kansas City in 1966, Oakland in 1967,
	// Baltimore in 1968, Minnesota in 1969. Every one of those league titles was
	// missing from this repo: the Chiefs showed five championships against a
	// published six, with 1966 absent.
	//
	// Per round fixes it, because the series rule is a question about ONE round.
	const finals = new Map();
	for (const g of games) {
		if (!(g.championship && g.championship.trim())) continue;
		const yr = parseInt(g.season, 10);
		if (!finals.has(yr)) finals.set(yr, new Map());
		const byName = finals.get(yr);
		// Empty string, not null, for a round the data does not name: all 707
		// baseball championship rows carry a null title, and they are one round.
		const name = g.championshipTitle ?? '';
		if (!byName.has(name)) byName.set(name, { w: 0, l: 0 });
		const c = byName.get(name);
		if (g.result === 'WIN') c.w++; else if (g.result === 'LOSS') c.l++;
	}

	const rankName = (a, b) => CHAMPIONSHIP_RANK(a) - CHAMPIONSHIP_RANK(b) || a.localeCompare(b);
	const methodOf = new Map();

	/** What one season's final was, or null.
	 *
	 *  The season's title is the most significant round it WON; where it won
	 *  none, the most significant round it reached. So Green Bay 1966 is a Super
	 *  Bowl (they won both games), Kansas City 1966 is an AFL Championship (they
	 *  won that and lost Super Bowl I), and Green Bay 1997 is a Super Bowl lost.
	 *
	 *  Shared by the chart, the table and the record card, so the three cannot
	 *  disagree about what a season was -- which they did: the chart marked the
	 *  Brewers' 1982 as a title because they won three games of a World Series
	 *  they lost 4-3, while the record card said they lost it.
	 */
	const finalOf = (yr) => {
		const byName = finals.get(yr);
		if (!byName) return null;
		const names = [...byName.keys()].sort(rankName);
		// The series rule, per round: more wins than losses. Right for a
		// best-of-seven as well as a one-game final, where "was the last game a
		// win" is the same answer in football and the wrong one in baseball.
		const won = names.filter((n) => byName.get(n).w > byName.get(n).l);
		return {
			title: (won[0] ?? names[0]) || null,
			won: won.length > 0,
			// Every round reached, most significant first. The record card lists
			// them, because a season can genuinely be two.
			titles: names.filter(Boolean),
			method: methodOf.get(yr) ?? null,
		};
	};

	// A title is a final WON, which is not the same as a championship-round game
	// won. The old rule was the latter, so the Brewers' 1982 -- three wins in a
	// World Series they lost -- was marked on the chart as a title, with a
	// tooltip reading "1982 - champions".
	const titleSeasons = new Set(
		[...finals.keys()].filter((yr) => finalOf(yr).won));

	// Titles the GAMES cannot show, from the championship table.
	//
	// Twelve NFL seasons were decided on the final standings, so there is no
	// game with a championship round to win and no derivation reaches them. The
	// Packers' history chart marked three titles where they won six, and the
	// record book listed the same three -- the data was not wrong, the question
	// simply had no answer where the answer was not a game.
	//
	// A union, not a replacement: everything derivable stays derived, and this
	// only adds what could not be. Passing nothing leaves this function exactly
	// as it was, which is what every test written before it relies on.
	const stated = titles.filter((t) => !titleSeasons.has(Number(t.season)));
	for (const t of stated) {
		const yr = Number(t.season);
		titleSeasons.add(yr);
		finals.set(yr, new Map([[t.title ?? '', { w: 1, l: 0 }]]));
		methodOf.set(yr, t.method ?? null);
	}

	const losslessSeasons = [];
	const seasonRows = [];
	for (const yr of years) {
		let w = 0, l = 0, t = 0, pf = 0, pa = 0;
		for (const g of seasons.get(yr)) {
			if (g.result === 'WIN') w++;
			else if (g.result === 'LOSS') l++;
			else t++;
			// Regular season only, matching the record beside it. A playoff run
			// would otherwise inflate the points of the seasons that had one.
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		const lossless = l === 0 && w > 0 && settled(yr);
		if (lossless) losslessSeasons.push({ season: yr, wins: w, record: rec(w, l, t) });
		const played = w + l + t;
		seasonRows.push({
			season: yr, wins: w, losses: l, ties: t, record: rec(w, l, t),
			// Ties count half, as everywhere else.
			winPct: played ? (w + t / 2) / played : 0,
			// For the history chart: the two score totals, whether the season
			// ended in a title, and whether it was unbeaten.
			pf, pa, champion: titleSeasons.has(yr), lossless,
			// The final itself, so the history table can name it and say how it
			// went. `champion` stays a boolean because the chart plots markers
			// from it and every test written before this asserts on it.
			final: finalOf(yr),
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
			// From `finalOf`, not recomputed here. Two answers to "did they win
			// the title that season" is one answer too many, and they had
			// already diverged: this counted championship-round games across the
			// whole season, so a club that won its league final and lost the
			// Super Bowl came out 1-1 and counted as neither.
			//
			// EVERY name, not the first. A season can have more than one final:
			// the Packers won the NFL Championship and Super Bowl I in 1966, and
			// both games are in the data. Keeping titles[0] labelled that season
			// "NFL Championship" and undercounted their Super Bowls by two —
			// which is the number anyone checks.
			const f = finalOf(season);
			return {
				season,
				games: list.length,
				record: rec(w, l, 0),
				won: Boolean(f?.won),
				championship: Boolean(f),
				title: f?.title ?? null,
				titleNames: f?.titles ?? [],
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
		// Appearances from games, plus the stated titles that had no game to
		// appear in. A standings title has no record and no opponent, and says
		// so rather than being given an invented 0-0.
		championshipAppearances: [
			...playoffAppearances
				.filter((a) => a.championship)
				.map((a) => ({ season: a.season, won: a.won, record: a.record, title: a.title, titleNames: a.titleNames })),
			...stated.map((t) => ({
				season: Number(t.season), won: true, record: null,
				title: t.title ?? null, titleNames: t.title ? [t.title] : [], method: t.method ?? null,
			})),
		].sort((a, b) => b.season - a.season),
	};
}
