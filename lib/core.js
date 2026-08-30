/** The record core: counting games, and deciding what the answer is.
 *
 *  Ported from `records-core.js` and `lib/season-state.js` on the two sites,
 *  where these are already byte-identical to each other. The only change is
 *  where the vocabulary comes from — a team manifest here, a `site.js` there —
 *  so the comments explaining *why* each rule is what it is come across with
 *  them rather than being rediscovered.
 *
 *  Pure. Rows in, numbers out. The reason that matters: on the football site the
 *  equivalent logic lives in `main.js`, which fetches its own CSV in the browser
 *  and is unreachable from `node --test`. 118 tests passed there while every
 *  past season rendered a 0-0 record and a schedule of 0-0 ties.
 */

import { escapeHtml } from './html.js';

/** Wins, losses, ties, postseason and championship for one season's rows. */
export function seasonTally(rows, team) {
	let wins = 0, losses = 0, ties = 0;
	let postWins = 0, postLosses = 0, postTies = 0;
	let titleWins = 0, titleLosses = 0, titleName = null;

	for (const g of rows) {
		if (g.regular_season === '1') {
			if (g.result === 'WIN') wins++;
			else if (g.result === 'LOSS') losses++;
			else if (g.result === 'TIE') ties++;
		} else if (g.playoff === '1') {
			if (g.result === 'WIN') postWins++;
			else if (g.result === 'LOSS') postLosses++;
			else if (g.result === 'TIE') postTies++;
		}
		if (g.championship && g.championship.trim() !== '') {
			// The game's own title when the data knows it, because the name is
			// era-dependent and the manifest's noun is not: 1936 was the NFL
			// Championship, and calling it a Super Bowl because the club plays
			// for one now would be wrong by thirty years.
			titleName = `${g.championshipTitle || team.nouns.championship} ${g.championship.toUpperCase()}`;
			if (g.result === 'WIN') titleWins++;
			else if (g.result === 'LOSS') titleLosses++;
		}
	}

	return {
		wins, losses, ties,
		// A postseason of ties alone does not count as one. Preserved from the
		// site's inline version rather than tidied: the only rows that could
		// produce it are unplayed or malformed, and showing "0-0-1" for them
		// would be worse than showing nothing.
		postseason: (postWins > 0 || postLosses > 0)
			? { w: postWins, l: postLosses, t: postTies }
			: null,
		// The series rule. More championship-round wins than losses wins the
		// title, which is right for a best-of-seven World Series and also right
		// for a one-game Super Bowl — which is why both sports share it.
		championshipName: titleWins > titleLosses ? titleName : null,
		// Undefeated *so far*. A team can be answering yes to this in October;
		// the records page's notion of an undefeated season additionally
		// requires the season to have finished. Merging the two would either
		// announce a finished perfect season in week three, or refuse to call a
		// team undefeated while it is.
		undefeated: losses === 0 && wins > 0,
	};
}

/** Which of the three answers the front page gives.
 *
 *  Three, not two. Both callers on the football site computed
 *  `losses === 0 && wins > 0` inline and handed a boolean onward, which meant a
 *  season that had not started had to be one of the two available answers. It
 *  was NO — the site told a team that had not lost a game that it was not
 *  undefeated.
 */
export function seasonVerdict({ wins, losses, ties = 0, isPastSeason = false, daysToNextGame = null }) {
	const played = wins + losses + ties;
	// A finished season with no games is a data gap, not a season about to
	// begin, and saying GO PACK GO about 1943 would be strange.
	if (played === 0 && !isPastSeason) {
		// Four states, not three. The football site distinguishes the deep
		// offseason from the week before the opener, and this collapsed them:
		// it answered GO PACK GO in August, where the live site says OFFSEASON.
		//
		// The site's own rule is a month window plus "no game within 30 days".
		// The month window is redundant — a club with no game inside thirty days
		// is in its offseason whatever the calendar says, and the data already
		// knows when the next game is. Keeping the month test would additionally
		// be wrong for any sport whose calendar differs, which is the whole
		// point of this repo.
		if (daysToNextGame === null || daysToNextGame > 30) return 'offseason';
		return 'not-started';
	}
	if (losses === 0 && wins > 0) return 'undefeated';
	return 'no';
}

/** Days until the club's next unplayed game, or null if it has none.
 *
 *  `now` is a parameter rather than read from the clock, so the thing that
 *  decides what the front page says can be tested.
 */
export function daysToNextGame(rows, now) {
	const today = now.toISOString().slice(0, 10);
	const upcoming = rows
		.filter((g) => !g.result && g.date >= today)
		.map((g) => g.date)
		.sort();
	if (!upcoming.length) return null;
	return Math.round((Date.parse(upcoming[0]) - Date.parse(today)) / 86_400_000);
}

/** The words for a verdict.
 *
 *  Only 'not-started' is vocabulary. YES and NO are the site's own joke and are
 *  not something another club would translate.
 */
export function verdictText(verdict, team) {
	if (verdict === 'offseason') return 'OFFSEASON';
	if (verdict === 'not-started') return team.copy.seasonNotStarted;
	// Three exclamation marks, which is what both sites say. "YES" is a
	// different sentence.
	return verdict === 'undefeated' ? 'YES!!!' : 'NO';
}

/** The latest season present in a club's rows, and whether it is over.
 *
 *  "Current" cannot mean today's calendar year: Retrosheet lags, so the newest
 *  baseball season here is 2025 while the newest football season is 2026. It
 *  also cannot mean "has unplayed games", because a finished season has none —
 *  that is the same distinction `isPastSeason` draws, so it is returned rather
 *  than inferred twice.
 */
export function latestSeason(rows) {
	const seasons = rows.map((g) => g.season).filter(Boolean);
	if (!seasons.length) return null;
	const season = seasons.reduce((a, b) => (a > b ? a : b));
	const inSeason = rows.filter((g) => g.season === season);
	return {
		season,
		rows: inSeason,
		// Over when nothing is left unplayed. A season yet to start is not over,
		// which is what keeps it eligible for the third answer — and `every`
		// already gives that, because a season of all-empty results fails it.
		//
		// A `&& some(played)` guard was here to cover the empty-rows case, where
		// `every` is vacuously true. It cannot happen: `season` is drawn from
		// these rows, so `inSeason` always has at least one. A mutation run
		// deleted it and changed no result.
		isPastSeason: inSeason.every((g) => g.result !== ''),
	};
}

/** "12-0-1", with the ties part only when there are any. */
export function recordText({ wins, losses, ties }) {
	return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** Every season a club has rows for, oldest first. */
export function seasons(rows) {
	return [...new Set(rows.map((g) => g.season).filter(Boolean))].sort();
}

/** Days between two ISO dates. */
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** The sentence above the record.
 *
 *  Ported from records-core.js on the two sites, where it is already
 *  byte-identical between them. The only change is that dates arrive as ISO
 *  strings here rather than Date objects, so the arithmetic is explicit.
 *
 *  Six sentences, and the distinctions between them are the point: a finished
 *  season reads differently from a live one, losing the opener reads differently
 *  from losing later, and an unbeaten season reads differently from both.
 */
export function streakBanner(completedGames, { isPastSeason = false, team } = {}) {
	if (completedGames.length === 0) return null;
	const sorted = [...completedGames].sort((a, b) => (a.date < b.date ? -1 : 1));

	// A tie is not a loss, and this loop used to say it was: it broke on any
	// non-win, so the first tie became `firstLoss`. On the football site that
	// misreports the exact season it is named after — 1929 went WWWWWWWWWWTWW,
	// and the banner read "undefeated for 10 games before first loss" about a
	// season with no losses in it.
	//
	// The distinction is the whole point of the site. In football *perfect*
	// means no losses and no ties; *undefeated* allows them, which is why 1929
	// counts and why the manifest carries losslessSeasonNoun.
	let openingStreak = 0;
	let firstLoss = null;
	for (const g of sorted) {
		if (g.result === 'LOSS') { firstLoss = g; break; }
		openingStreak++;
	}

	const plural = (n, noun) => (n === 1 ? `1 ${noun}` : `${n} ${noun}s`);
	const daysToLoss = () => daysBetween(sorted[0].date, firstLoss.date);

	if (isPastSeason) {
		if (!firstLoss) {
			// The real record, not `${n}-0`. A season that ended unbeaten with
			// ties in it is undefeated and is not n-0, and printing n-0 would
			// quietly relabel 12-0-1 as 13-0.
			const w = sorted.filter((g) => g.result === 'WIN').length;
			const t = sorted.filter((g) => g.result === 'TIE').length;
			return `Finished the regular season undefeated — <strong>${t ? `${w}-0-${t}` : `${w}-0`}</strong>`;
		}
		if (openingStreak === 0) return 'Lost the opener — undefeated for <strong>0 games</strong> to start the season';
		// The day count is pluralised like the one below. It cannot read 1 in a
		// sport that plays weekly, so this changes nothing for football — but the
		// same function runs on the baseball site, where it read "1 days" on a
		// live page until the line was shared rather than merely copied.
		return `Undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}) to start the season before first loss`;
	}

	let winStreak = 0;
	for (let i = sorted.length - 1; i >= 0; i--) {
		if (sorted[i].result === 'WIN') winStreak++;
		else break;
	}

	if (!firstLoss) {
		// A run containing a tie is unbeaten, not a win streak. Calling it a
		// win streak is the same conflation that made a tie end the run.
		const tied = sorted.some((g) => g.result === 'TIE');
		return `Undefeated to start the season — <strong>${openingStreak}-game</strong> ${tied ? 'unbeaten run' : 'win streak'}`;
	}
	if (openingStreak === 0) return `Lost the opener. Currently on a <strong>${winStreak}-game</strong> win streak.`;
	return `The ${escapeHtml(team.nouns.team)} started the season undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}). Currently on a <strong>${winStreak}-game</strong> win streak.`;
}

/** The most recent completed season with no regular-season losses.
 *
 *  Completed, unlike seasonTally's `undefeated`, which answers "so far" and can
 *  be true in October. A season still being played is not an answer to "when
 *  was the last one".
 */
export function lastLosslessSeason(rows) {
	const bySeason = new Map();
	for (const g of rows) {
		if (!bySeason.has(g.season)) bySeason.set(g.season, []);
		bySeason.get(g.season).push(g);
	}
	let best = null;
	for (const [season, games] of bySeason) {
		if (games.some((g) => g.result === '')) continue;
		const reg = games.filter((g) => g.regular_season === '1');
		const wins = reg.filter((g) => g.result === 'WIN').length;
		const losses = reg.filter((g) => g.result === 'LOSS').length;
		const ties = reg.filter((g) => g.result === 'TIE').length;
		if (losses > 0 || wins === 0) continue;
		if (!best || season > best.season) best = { season, wins, losses, ties };
	}
	return best;
}

/** All-time head-to-head against every opponent a club has played.
 *
 *  Keyed by opponent code, because the schedule renders before names are
 *  resolved and resolution is per sport and dated.
 *
 *  Counted over completed games only. An unplayed fixture has no result and
 *  would otherwise be counted as neither, which is right, or as a tie, which is
 *  what a naive `result !== 'WIN'` would do.
 */
export function seriesRecords(rows) {
	const by = new Map();
	for (const g of rows) {
		if (!g.result || !g.Opponent) continue;
		if (!by.has(g.Opponent)) by.set(g.Opponent, { w: 0, l: 0, t: 0 });
		const r = by.get(g.Opponent);
		if (g.result === 'WIN') r.w++;
		else if (g.result === 'LOSS') r.l++;
		else r.t++;
	}
	const out = new Map();
	for (const [code, r] of by) out.set(code, r.t ? `${r.w}–${r.l}–${r.t}` : `${r.w}–${r.l}`);
	return out;
}

/** Win percentage per season, oldest first, for the history sparkline.
 *
 *  Regular season only. Including the postseason would move a club's line by
 *  whether it made the playoffs rather than by how it played, and a club that
 *  went 13-3 and lost one playoff game would show worse than one that went 13-3
 *  and missed out.
 *
 *  Ties count a half, which is how every league that has them computes a
 *  percentage — 12-0-1 is .962, not 1.000 and not .923.
 */
export function seasonWinPct(rows) {
	const by = new Map();
	for (const g of rows) {
		if (g.regular_season !== '1' || !g.result) continue;
		if (!by.has(g.season)) by.set(g.season, { w: 0, l: 0, t: 0 });
		const r = by.get(g.season);
		if (g.result === 'WIN') r.w++;
		else if (g.result === 'LOSS') r.l++;
		else r.t++;
	}
	return [...by.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([season, r]) => {
			const played = r.w + r.l + r.t;
			return { season, pct: played ? (r.w + r.t / 2) / played : 0 };
		});
}
