import { SITE } from '../site.js';

/** Which of the three answers the front page should give.
 *
 *  Extracted so it can be tested. The two callers that decide this — the live
 *  ESPN path and the CSV path — each computed `losses === 0 && wins > 0` inline
 *  and handed a boolean to displayResult, which meant there were only ever two
 *  answers available and a season that had not started had to be one of them.
 *  It was NO.
 *
 *  Returns 'undefeated' | 'not-started' | 'no'.
 */
export function seasonVerdict({ wins, losses, ties = 0, isPastSeason = false }) {
	const played = wins + losses + ties;
	// A finished season with no games is a data gap, not a season about to
	// begin, and saying GO PACK GO about 1943 would be strange. Past seasons
	// keep the old answer.
	if (played === 0 && !isPastSeason) return 'not-started';
	// Unchanged: wins > 0 is what stops an empty season claiming an undefeated
	// one, and it still does — the case it was guarding against now has its own
	// answer rather than being swept into NO.
	if (losses === 0 && wins > 0) return 'undefeated';
	return 'no';
}

/** The words for that verdict. Only 'not-started' is configurable; YES and NO
 *  are the site's own joke and are not vocabulary another club would change. */
export function verdictText(verdict, site = SITE) {
	return verdict === 'not-started' ? site.copy.seasonNotStarted : null;
}
