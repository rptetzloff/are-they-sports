/** Who the data came from, said on the page.
 *
 *  This repo has never rendered a credit. Both live sites carry one, most of the
 *  sources ask for one, and Retrosheet REQUIRES one — so the absence was not a
 *  missing nicety, it was a licence term going unmet for as long as baseball has
 *  been loaded.
 *
 *  Credits are declared in `sports/<id>.js` beside the sources they describe,
 *  because that file already says where data comes from and a second list
 *  somewhere else is the drift CLAUDE.md keeps warning about. A deployment
 *  credits the sports IN ITS SCOPE and nothing else: a football-only site naming
 *  Retrosheet would be claiming a relationship it does not have, and a reader
 *  cannot tell a courtesy credit from a false one.
 *
 *  The repo-wide entries below are for data that is not a sport's: the curated
 *  reference files, whose contents came from somewhere even though no fetcher
 *  points at them.
 */

/** Sources used by every deployment, whatever its scope.
 *
 *  These are the third tier — curated and committed — and they are the ones
 *  easiest to forget, because nothing fetches them and no adapter declares
 *  them. The franchise histories carry hand-entered colours and eras; the
 *  coaches and champions files are transcribed from Wikipedia.
 */
export const REFERENCE_CREDITS = [
	{
		name: 'Wikipedia',
		url: 'https://en.wikipedia.org',
		note: 'NFL head coaches before 1999, and champions from 1920 to 1969',
	},
	{
		name: 'teamcolorcodes.com',
		url: 'https://teamcolorcodes.com',
		note: 'club colours in the franchise history tables',
	},
];

/** Every credit a deployment owes, for the sports it actually serves.
 *
 *  Deduped by name, because two sports can share a source — both use ESPN's
 *  public scoreboard for the season being played — and crediting it twice reads
 *  as a mistake rather than as thoroughness.
 *
 *  Ordered: sport sources first in the order their adapters declare them, then
 *  the reference credits. Stable, so the footer does not reshuffle between
 *  requests for two entries that compare equal.
 */
export function creditsFor(sports) {
	const out = [];
	const seen = new Set();
	const add = (c) => {
		if (!c?.name || seen.has(c.name)) return;
		seen.add(c.name);
		out.push(c);
	};
	for (const sport of sports) for (const c of sport?.credits ?? []) add(c);
	for (const c of REFERENCE_CREDITS) add(c);
	return out;
}

/** The credits that carry a licence notice which must be reproduced.
 *
 *  Separated because they are not the same kind of thing as a courtesy credit.
 *  A name in a list is politeness; Retrosheet's notice is a condition of use,
 *  and a page that shortens it to fit a footer has not met it.
 */
export const requiredNotices = (credits) => credits.filter((c) => c.notice);
