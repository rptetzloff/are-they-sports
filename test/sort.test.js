import test from 'node:test'
import assert from 'node:assert/strict'
import { column, parseSort, sortHref, sortRows, sortState } from '../lib/sort.js'
import { historyColumns, ALL_TIME_COLUMNS, sortableHead, standingsColumns } from '../lib/render.js'
import { leaderColumns, LEADERS_DEFAULT_SORT } from '../lib/leaders.js'

const COLS = [
	column('name', 'Name', (r) => r.name),
	column('w', 'W', (r) => r.w, { numeric: true }),
	// A column that cannot be sorted, which every real table has: provenance,
	// a title marker, a spacer.
	{ key: null, label: '' },
]
const params = (qs) => new URLSearchParams(qs)

// ---------------------------------------------------------------------------
// Choosing a column
// ---------------------------------------------------------------------------

test('a keyless column is never chosen', () => {
	// THE BUG THIS EXISTS FOR. `params.get('sort')` returns null when the
	// parameter is absent, and a column declared `{ key: null }` matched that
	// null exactly — so every request WITHOUT a sort selected the unsortable
	// column and died on a missing accessor, while `?sort=w` worked perfectly.
	const s = parseSort(params(''), COLS, 'w')
	assert.equal(s.key, 'w')
	assert.notEqual(s.key, null)
	// And it cannot be reached by asking for it either.
	assert.equal(parseSort(params('sort='), COLS, 'w').key, 'w')
})

test('no sort asked for and no default means leave the rows alone', () => {
	// A feature that adds an option must not take the existing order away. The
	// all-time table arrives ordered by win percentage and the standings arrive
	// in standing order; falling back to the first column re-sorted both
	// alphabetically by club, which nobody asked for.
	assert.equal(parseSort(params(''), COLS, null), null)
	const rows = [{ name: 'b', w: 1 }, { name: 'a', w: 2 }]
	assert.deepEqual(sortRows(rows, COLS, null).map((r) => r.name), ['b', 'a'])
})

test('an unknown column falls back rather than erroring', () => {
	// A stale bookmark or a hand-typed URL should show the table, not a 400.
	assert.equal(parseSort(params('sort=nonsense'), COLS, 'w').key, 'w')
})

test('the first click on a column means what a reader means', () => {
	// Nobody clicking "W" wants fewest wins, and nobody clicking a name wants Z
	// first. The direction is per column rather than one global rule.
	assert.equal(parseSort(params('sort=w'), COLS, 'name').dir, 'desc')
	assert.equal(parseSort(params('sort=name'), COLS, 'w').dir, 'asc')
	// An explicit direction still wins.
	assert.equal(parseSort(params('sort=w&dir=asc'), COLS, 'name').dir, 'asc')
})

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test('numeric columns sort as numbers, not as text', () => {
	// The trap CLAUDE.md records from a sort test that could not fail: with
	// zero-padded values lexical and numeric order are identical, so the test
	// passes under the bug. 9 against 10 is the pair that tells them apart.
	const rows = [{ w: 9 }, { w: 10 }, { w: 100 }]
	assert.deepEqual(sortRows(rows, COLS, { key: 'w', dir: 'asc' }).map((r) => r.w), [9, 10, 100])
	assert.deepEqual(sortRows(rows, COLS, { key: 'w', dir: 'desc' }).map((r) => r.w), [100, 10, 9])
})

test('the order is total, so equal rows do not reshuffle', () => {
	// A comparator returning 0 leaves the order to whatever the query returned,
	// and these rows come from a query whose own order can change. A table that
	// reshuffles two equal rows between requests looks broken in a way nobody
	// can reproduce.
	const rows = [{ name: 'zeta', w: 5 }, { name: 'alpha', w: 5 }, { name: 'mid', w: 5 }]
	const once = sortRows(rows, COLS, { key: 'w', dir: 'desc' }, (r) => r.name)
	const again = sortRows([...rows].reverse(), COLS, { key: 'w', dir: 'desc' }, (r) => r.name)
	assert.deepEqual(once.map((r) => r.name), again.map((r) => r.name))
	assert.deepEqual(once.map((r) => r.name), ['alpha', 'mid', 'zeta'])
})

test('rows with no value sort last, whichever way the column goes', () => {
	// A club with no value has not got a very small one. Putting it at the
	// bottom either way says so; sorting it as zero would rank it above real
	// losses in one direction and below real wins in the other.
	const rows = [{ w: 5 }, { w: null }, { w: 1 }]
	assert.deepEqual(sortRows(rows, COLS, { key: 'w', dir: 'desc' }).map((r) => r.w), [5, 1, null])
	assert.deepEqual(sortRows(rows, COLS, { key: 'w', dir: 'asc' }).map((r) => r.w), [1, 5, null])
})

test('sorting does not mutate what it was given', () => {
	const rows = [{ w: 1 }, { w: 9 }]
	sortRows(rows, COLS, { key: 'w', dir: 'desc' })
	assert.deepEqual(rows.map((r) => r.w), [1, 9])
})

// ---------------------------------------------------------------------------
// The links
// ---------------------------------------------------------------------------

test('clicking the sorted column reverses it, and another column starts fresh', () => {
	const current = { key: 'w', dir: 'desc' }
	const w = COLS.find((c) => c.key === 'w')
	const name = COLS.find((c) => c.key === 'name')
	assert.match(sortHref('/coaches', params(''), w, current), /sort=w&dir=asc/)
	assert.match(sortHref('/coaches', params(''), name, current), /sort=name&dir=asc/)
	// And reversing back.
	assert.match(sortHref('/coaches', params(''), w, { key: 'w', dir: 'asc' }), /sort=w&dir=desc/)
})

test('a sort link keeps every other query parameter', () => {
	// `?format=json` and the season parameters live in the same string. A sort
	// link that dropped them would quietly navigate a reader off the page they
	// were looking at.
	const href = sortHref('/standings', params('format=json&season=2011'),
		COLS.find((c) => c.key === 'w'), null)
	assert.match(href, /format=json/)
	assert.match(href, /season=2011/)
	assert.match(href, /sort=w/)
})

test('only the active column reports a sort state', () => {
	const w = COLS.find((c) => c.key === 'w')
	assert.equal(sortState(w, { key: 'w', dir: 'asc' }), 'ascending')
	assert.equal(sortState(w, { key: 'name', dir: 'asc' }), null)
	assert.equal(sortState(w, null), null)
})

// ---------------------------------------------------------------------------
// The header markup
// ---------------------------------------------------------------------------

test('a keyless column renders as text, not a dead link', () => {
	// A header that looks clickable and is not is worse than one that does not.
	const html = sortableHead(COLS, { current: null, path: '/x', params: params('') })
	assert.equal((html.match(/<a class="sort/g) ?? []).length, 2)
	assert.ok(html.includes('<th></th>'))
})

test('the active column is marked for a reader who cannot see the arrow', () => {
	const html = sortableHead(COLS, { current: { key: 'w', dir: 'desc' }, path: '/x', params: params('') })
	assert.ok(html.includes('aria-sort="descending"'))
	// Exactly one column claims it.
	assert.equal((html.match(/aria-sort/g) ?? []).length, 1)
})

// ---------------------------------------------------------------------------
// The real tables
// ---------------------------------------------------------------------------

test('the leaders page defaults to chronological, earliest first', () => {
	// It was most wins first, which is what both live sites do on their leaders
	// boards and is the wrong default here: this page is a list of everyone who
	// held the job rather than a ranking.
	const cols = leaderColumns({ ties: true, post: true, titles: true })
	const s = parseSort(params(''), cols, LEADERS_DEFAULT_SORT)
	assert.deepEqual(s, { key: 'seasons', dir: 'asc' })

	const rows = [
		{ leader: 'c', name: 'Cox', firstSeason: 1978, w: 2149 },
		{ leader: 's', name: 'Selee', firstSeason: 1897, w: 425 },
		{ leader: 'n', name: 'Snitker', firstSeason: 2016, w: 811 },
	]
	assert.deepEqual(sortRows(rows, cols, s, (r) => r.leader).map((r) => r.name),
		['Selee', 'Cox', 'Snitker'])
})

test('every real table sorts by a key its rows actually carry', () => {
	// The accessors were written against remembered row shapes and three of them
	// were wrong: `allTime` carries `wins` and not `w`, and a history point has
	// no win count at all. A column whose getter returns undefined for every row
	// sorts nothing and reports no error.
	const allTime = { club: 'Packers', wins: 809, winPct: 0.552, from: 1921 }
	for (const c of ALL_TIME_COLUMNS.filter((x) => x.key)) {
		assert.notEqual(c.get(allTime), undefined, `all-time column ${c.key} reads nothing`)
	}
	const team = { nouns: { scoreForLabel: 'Points For', scoreAgainstLabel: 'Points Against' } }
	const point = { season: 2011, pct: 0.9375, record: '15–1', pf: 560, pa: 359 }
	for (const c of historyColumns(team).filter((x) => x.key)) {
		assert.notEqual(c.get(point), undefined, `history column ${c.key} reads nothing`)
	}
	const line = { club: 'Packers', w: 15, l: 1, t: 0, pct: 0.9375, gb: 0 }
	for (const c of standingsColumns(true).filter((x) => x.key)) {
		assert.notEqual(c.get(line), undefined, `standings column ${c.key} reads nothing`)
	}
})

test('the history table does not offer to sort a record string', () => {
	// "12–0–1" has no useful order: sorting the text puts 9–7 above 12–4. Pct is
	// the next column and orders the same rows the way a reader clicking
	// "Record" would mean.
	const team = { nouns: { scoreForLabel: 'Points For', scoreAgainstLabel: 'Points Against' } }
	const record = historyColumns(team).find((c) => c.label === 'Record')
	assert.equal(record.key, null)
})
