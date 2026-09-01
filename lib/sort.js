/** Sorting a table by clicking its header, without any JavaScript.
 *
 *  This repo has none — zero `<script>` tags, zero event handlers — and the
 *  standings modal is a CSS `:target` on an anchor. So a sortable table is a
 *  header of LINKS and a `?sort=` parameter the server reads, which is the same
 *  shape as the `?format=json` that already hangs off every route.
 *
 *  The alternative was a few lines of client-side JavaScript, and it was
 *  rejected for a reason CLAUDE.md states at length: rendering that happens in
 *  the browser is not reachable from `node --test`. That is exactly how 118
 *  tests passed on the football site while every past season rendered a 0-0
 *  record. Sorting on the server means the order is a pure function of the
 *  request, a test can assert it, and the page works for a reader with no
 *  JavaScript at all.
 *
 *  What it costs is a round trip per click. That is the honest trade and it is
 *  small here: these pages are already server-rendered from a summary cache.
 */

/** A column that can be sorted on.
 *
 *  `get` pulls the value, `numeric` says how to compare, and `defaultDir` is
 *  the direction a reader means the FIRST time they click. Nobody clicking
 *  "Wins" wants fewest wins, and nobody clicking a name wants Z first — so the
 *  default is per column rather than a single global rule.
 */
export const column = (key, label, get, { numeric = false, defaultDir = numeric ? 'desc' : 'asc' } = {}) =>
	({ key, label, get, numeric, defaultDir });

/** Which column and direction a request asks for.
 *
 *  Unknown keys fall back rather than erroring, because a sort parameter is
 *  cosmetic: a stale bookmark or a hand-typed URL should show the table, not a
 *  400. An unknown key is not silently ignored either — the caller gets the
 *  fallback back and renders it as the active column, so the header always
 *  agrees with the rows underneath it.
 */
export function parseSort(params, columns, fallback) {
	// Only columns that HAVE a key can be sorted on, and filtering first is not
	// tidiness. `params.get('sort')` returns null when the parameter is absent,
	// and a column declared `{ key: null }` — which is how a provenance or
	// spacer column says it is not sortable — matched that null exactly. Every
	// request without an explicit sort selected the unsortable column and died
	// on a missing accessor, while `?sort=w` worked perfectly.
	// `wanted &&` is the whole guard, and it is load-bearing.
	// `params.get('sort')` returns null when the parameter is absent, and a
	// column declared `{ key: null }` — which is how a provenance or spacer
	// column says it is not sortable — matched that null exactly. Every request
	// WITHOUT an explicit sort selected the unsortable column and died on a
	// missing accessor, while `?sort=w` worked perfectly.
	//
	// A `columns.filter((c) => c.key)` was written alongside this and has been
	// removed: with the guard here and the `fallback ?` below, nothing could
	// reach it. A mutation run proved it by deleting the filter and changing no
	// test result — the same unreachable-defence finding this repo already
	// recorded for a route tie-break, and the reason that one was deleted too.
	const wanted = params?.get?.('sort') ?? null;
	const sortable = columns;
	const col = wanted ? sortable.find((c) => c.key === wanted) : null;
	// NULL means "leave the rows alone", and it is the answer whenever nothing
	// was asked for and the caller named no default. That is what keeps this
	// from changing pages it was only meant to add a choice to: the all-time
	// table arrives ordered by win percentage and the standings arrive in
	// standing order, and falling back to the first column instead re-sorted
	// both alphabetically by club. A feature that adds an option should not
	// silently take the existing order away.
	const base = col ?? (fallback ? sortable.find((c) => c.key === fallback) : null);
	if (!base) return null;
	const dir = params?.get?.('dir');
	return {
		key: base.key,
		// An explicit direction wins; otherwise the column's own default. This
		// is what makes one click on "Wins" mean "most wins" and one click on
		// "Coach" mean "A first" without the reader thinking about it.
		dir: dir === 'asc' || dir === 'desc' ? dir : base.defaultDir,
	};
}

/** Sort rows, leaving the input alone.
 *
 *  TOTAL, never merely correct. Two rows that compare equal are broken apart by
 *  `tieBreak`, because a comparator that returns 0 leaves the order to the
 *  engine's stability and the row order it was handed — and these rows arrive
 *  from a query whose own order can change. A table that reshuffles two equal
 *  rows between requests looks broken in a way nobody can reproduce.
 *
 *  Nulls sort last in both directions. A club with no value for a column has
 *  not got a very small value; putting it at the bottom either way says so.
 */
export function sortRows(rows, columns, sort, tieBreak = (r) => '') {
	// Guarded the same way `parseSort` is: a null key must never select the
	// keyless column, which has no accessor to call.
	const col = sort?.key ? columns.find((c) => c.key === sort.key && c.get) : null;
	if (!col) return [...rows];
	const sign = sort.dir === 'asc' ? 1 : -1;
	const cmp = (a, b) => {
		const x = col.get(a), y = col.get(b);
		const xEmpty = x === null || x === undefined || x === '';
		const yEmpty = y === null || y === undefined || y === '';
		if (xEmpty || yEmpty) {
			if (xEmpty && yEmpty) return 0;
			return xEmpty ? 1 : -1;   // last, whichever way the column is sorted
		}
		if (col.numeric) return (Number(x) - Number(y)) * sign;
		return String(x).localeCompare(String(y)) * sign;
	};
	return [...rows].sort((a, b) => cmp(a, b) || String(tieBreak(a)).localeCompare(String(tieBreak(b))));
}

/** The href for clicking a column header.
 *
 *  Clicking the column you are already sorted by REVERSES it; clicking another
 *  starts at that column's own default. Every other query parameter survives,
 *  which is not a detail: `?format=json` and the season parameters live in the
 *  same string, and a sort link that dropped them would quietly navigate a
 *  reader off the page they were looking at.
 */
export function sortHref(path, params, col, current) {
	const next = new URLSearchParams(params ?? '');
	const flip = current?.key === col.key && current.dir === col.defaultDir;
	next.set('sort', col.key);
	next.set('dir', flip ? (col.defaultDir === 'asc' ? 'desc' : 'asc') : col.defaultDir);
	const qs = next.toString();
	return qs ? `${path}?${qs}` : path;
}

/** What the header should say about the current sort, for a screen reader and
 *  for the arrow. `null` where the column is not the active one. */
export const sortState = (col, current) =>
	(current?.key === col.key ? (current.dir === 'asc' ? 'ascending' : 'descending') : null);
