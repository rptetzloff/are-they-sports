/** A club's whole history as one chart, and the numbers under it.
 *
 *  Ported from the football site's `history.js` and `history-chart.js`, with
 *  one deliberate reduction: that page is interactive — metrics toggle, hovering
 *  a season shows its numbers, clicking opens it, and coach-era bands run across
 *  the top. This one is server-rendered SVG with no client script, because
 *  everything else here is and adding a bundle for one page is how the two sites
 *  ended up with a 1,355-line `main.js` that neither of them tested.
 *
 *  What is lost and what replaces it:
 *
 *  - Hover tooltips become a table under the chart. Every season is listed with
 *    its record, percentage and both score totals, and every season links to
 *    itself, so the information is all present and reachable without script.
 *  - Metric toggles become one plotted line — win percentage — with the score
 *    totals in the table. Plotting points-for on the same axis as a percentage
 *    needed two scales in the original and is the part of that chart that reads
 *    worst.
 *  - **Coach-era bands are absent, and are now possible.** REVERSED: this said
 *    they need "a coaches table, which this repo has no source for", and that
 *    was true of the repo and not of the sources. `game_leader` now names who
 *    led each side of each game — every baseball season since 1871 and every
 *    football season since 1999 — so a band is a query rather than a gap.
 *    Football before 1999 is stated per tenure rather than per game, which is
 *    exactly the shape a band wants anyway.
 *
 *    Still absent because nobody has drawn it, which is a different sentence
 *    from the one that was here, and the reason to change it now is that the
 *    old one would have stopped the next person from looking.
 *
 *  The chart draws no axis numbers for the same reason the sparkline does not:
 *  a percentage between 0 and 1 with a line at .500 is legible without them, and
 *  the exact figures are in the table.
 */

/** Points to plot, from `computeRecords().everySeason`.
 *
 *  No filtering. A season with nothing played is not in `everySeason` at all —
 *  the rows are built from a map keyed by the seasons that HAVE completed games,
 *  so a club whose current season has not started simply ends at last year.
 *
 *  This began with a `wins + losses + ties > 0` guard against exactly that, and
 *  a mutation run deleting the guard changed nothing because there is nothing
 *  for it to catch. Left in, it would read as evidence that empty seasons reach
 *  here, which is the kind of comment-by-code this repo keeps removing.
 */
export function historyPoints(everySeason) {
	return everySeason
		.map((s) => ({
			season: s.season,
			pct: s.winPct,
			record: s.record,
			pf: s.pf,
			pa: s.pa,
			champion: Boolean(s.champion),
			// The final itself, so the table can name what was actually played
			// for and say how it went. A boolean here printed the club's MODERN
			// championship noun beside every title season -- "Super Bowl" over
			// 1936 -- and gave a season the club reached the final and lost the
			// same blank cell as a season it missed the playoffs.
			final: s.final ?? null,
			lossless: Boolean(s.lossless),
		}));
}

/** Where each season sits, and the shape of the line, in viewBox units.
 *
 *  Separated from the markup so the geometry can be tested as numbers. The
 *  football site's chart is 142 lines of SVG assembly with the arithmetic inline,
 *  and the bug it shipped — a season plotted one column off — is exactly the
 *  kind only visible when the numbers are checked directly.
 */
export function chartGeometry(points, { width = 1000, height = 340, pad = 24 } = {}) {
	if (!points.length) return { points: [], width, height, pad, mid: height / 2 };
	const w = width - pad * 2;
	const h = height - pad * 2;
	// A single season is centred: there is no span to spread it across, and
	// dividing by zero would put it at NaN. Guarded once, at the point of use —
	// guarding the step as well was a second check for the same thing and a
	// mutant removing it changed nothing.
	const solo = points.length < 2;
	const step = solo ? 0 : w / (points.length - 1);
	const placed = points.map((p, i) => ({
		...p,
		x: pad + (solo ? w / 2 : i * step),
		// Percentage runs 0 at the bottom to 1 at the top, so y is inverted.
		y: pad + (1 - p.pct) * h,
	}));
	return { points: placed, width, height, pad, mid: pad + 0.5 * h };
}
