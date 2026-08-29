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
			titleName = `${team.nouns.championship} ${g.championship.toUpperCase()}`;
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
export function seasonVerdict({ wins, losses, ties = 0, isPastSeason = false }) {
	const played = wins + losses + ties;
	// A finished season with no games is a data gap, not a season about to
	// begin, and saying GO PACK GO about 1943 would be strange.
	if (played === 0 && !isPastSeason) return 'not-started';
	if (losses === 0 && wins > 0) return 'undefeated';
	return 'no';
}

/** The words for a verdict.
 *
 *  Only 'not-started' is vocabulary. YES and NO are the site's own joke and are
 *  not something another club would translate.
 */
export function verdictText(verdict, team) {
	if (verdict === 'not-started') return team.copy.seasonNotStarted;
	return verdict === 'undefeated' ? 'YES' : 'NO';
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
