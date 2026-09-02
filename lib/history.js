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

/** The surname, which is what fits in a band.
 *
 *  "Vince Lombardi" is 96px at the size these labels are drawn and a band of
 *  nine seasons on a 105-season chart is 78px. Co-coaches keep both surnames
 *  joined -- the 1953 Packers were Devore and McLean, and dropping either names
 *  the wrong man.
 */
export const bandLabel = (name) => String(name)
	.split(/\s*&\s*|\s+and\s+/)
	.map((part) => part.trim().split(/\s+/).pop())
	.filter(Boolean)
	.join('/');

/** Coach eras as bands on the chart, positioned on the same grid as the line.
 *
 *  Positioned by INDEX, not by season arithmetic, because `chartGeometry` is:
 *  it spaces points evenly however far apart their seasons are, so a club with a
 *  gap in its history has a chart where 1942 and 1946 are neighbours. Bands
 *  computed from season numbers would drift away from the line they sit under.
 *
 *  **A band ends where the next one starts**, rather than at its own last
 *  season. Those are different: a stint's last season is one the next man also
 *  worked, so drawing both to their own bounds overlaps every boundary by a
 *  year. The last band runs to the end of the chart.
 *
 *  **Where a season had more than one man, it is split evenly between them.**
 *  That is an approximation and a deliberate one. The exact answer is available
 *  for the counted era -- `leaderStints` carries first and last game dates --
 *  and is not available at all for football before 1999, where the curated file
 *  knows only seasons. Splitting by count is one rule for both, never produces a
 *  zero-width band, and puts the boundary in the middle of a season that was
 *  genuinely divided. The baseball site positions by exact date and the football
 *  site by whole season, so this sits between them.
 */
export function coachEras(stints, points) {
	if (!points.length || !stints.length) return [];
	const indexOf = new Map(points.map((p, i) => [p.season, i]));
	const first = points[0].season;
	const last = points[points.length - 1].season;

	// Only stints that overlap the charted seasons at all. A club whose games
	// start in 1901 and whose leaders start in 1871 -- the Braves -- would
	// otherwise place bands off the left edge.
	const shown = stints
		.filter((t) => t.to >= first && t.from <= last)
		.sort((a, b) => a.from - b.from || a.to - b.to);
	if (!shown.length) return [];

	// How many stints begin in each season, so a shared season can be divided.
	const startsIn = new Map();
	for (const t of shown) {
		const yr = Math.max(t.from, first);
		startsIn.set(yr, (startsIn.get(yr) ?? 0) + 1);
	}
	const seen = new Map();

	const at = (season, share) => {
		const i = indexOf.get(season);
		// A season with no point on the chart -- the club did not play it --
		// clamps to the nearest end rather than vanishing.
		if (i === undefined) return season < first ? 0 : points.length - 1;
		return i + share;
	};

	const placed = shown.map((t) => {
		const yr = Math.max(t.from, first);
		const n = startsIn.get(yr) ?? 1;
		const k = seen.get(yr) ?? 0;
		seen.set(yr, k + 1);
		return { stint: t, start: at(yr, n > 1 ? k / n : 0) };
	});

	// Half a slot either side, because a point is the MIDDLE of its season and a
	// band covers the whole of it. Without that the final band is zero wide
	// whenever the last coach has one season -- the boundary and the chart's
	// right edge are the same x -- which is how Pat Murphy disappeared off the
	// first version of this. Clamped to the chart, so the first and last bands
	// give up their outer half rather than drawing past the line.
	const endIndex = points.length - 1;
	return placed.map((p, i) => {
		const from = Math.max(0, p.start - 0.5);
		const to = i + 1 < placed.length
			? Math.min(endIndex, placed[i + 1].start - 0.5)
			: endIndex;
		return {
			leader: p.stint.leader,
			name: p.stint.name,
			label: bandLabel(p.stint.name),
			from: p.stint.from,
			to: p.stint.to,
			// Fractional positions on the points index, for the renderer to turn
			// into x coordinates the same way it places the line.
			fromIndex: from,
			toIndex: to,
		};
	}).filter((b) => b.toIndex > b.fromIndex);
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
