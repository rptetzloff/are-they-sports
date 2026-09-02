import test from 'node:test'
import assert from 'node:assert/strict'
import { leaderColumns, numberLeaders } from '../lib/leaders.js'
import { leadersPage } from '../lib/render.js'
import { parseSort, sortRows } from '../lib/sort.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')

const who = (leader, firstSeason, lastSeason, over = {}) => ({
	leader, name: leader, firstSeason, lastSeason,
	w: 10, l: 10, t: 0, winPct: 0.5, playoffW: 0, playoffL: 0,
	titles: [], basis: 'counted', interim: false, ...over,
})

const labels = (list) => numberLeaders(list).map((r) => [r.leader, r.label])

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

test('the people who held the job are numbered 1..N in the order they arrived', () => {
	assert.deepEqual(labels([
		who('lambeau', 1921, 1949),
		who('ronzani', 1950, 1953),
		who('blackbourn', 1954, 1957),
	]), [['lambeau', '1'], ['ronzani', '2'], ['blackbourn', '3']])
})

test('a stand-in gets a fraction under the coach before them', () => {
	// Mike McCarthy is Green Bay's fourteenth head coach and Joe Philbin is
	// 14.1, so the club's own count survives and the column still sorts as a
	// number.
	assert.deepEqual(labels([
		who('mccarthy', 2006, 2018),
		who('philbin', 2018, 2018, { interim: true }),
		who('lafleur', 2019, 2025),
	]), [['mccarthy', '1'], ['philbin', '1.1'], ['lafleur', '2']])
})

test('two stand-ins in a row are .1 and .2, not .1 twice', () => {
	assert.deepEqual(labels([
		who('rhule', 2020, 2022),
		who('wilks', 2022, 2022, { interim: true }),
		who('tabor', 2023, 2023, { interim: true }),
		who('canales', 2024, 2024),
	]), [['rhule', '1'], ['wilks', '1.1'], ['tabor', '1.2'], ['canales', '2']])
})

test('the fraction resets after the next person holds the job', () => {
	assert.deepEqual(labels([
		who('a', 2000, 2001),
		who('b', 2002, 2002, { interim: true }),
		who('c', 2003, 2004),
		who('d', 2005, 2005, { interim: true }),
	]), [['a', '1'], ['b', '1.1'], ['c', '2'], ['d', '2.1']])
})

test('somebody who stood in before anyone had held the job gets 0.1', () => {
	// Nothing in this data does it and a club joining mid-season would. No
	// number at all is worse: the column is what a reader scans.
	assert.deepEqual(labels([
		who('caretaker', 1920, 1920, { interim: true }),
		who('first', 1921, 1925),
	]), [['caretaker', '0.1'], ['first', '1']])
})

test('numbering is by arrival, whatever order the rows are in', () => {
	// The page is sortable. Numbering the array as handed over would renumber
	// everyone the moment somebody clicked "W".
	assert.deepEqual(labels([
		who('lafleur', 2019, 2025),
		who('lambeau', 1921, 1949),
	]).sort(), [['lafleur', '2'], ['lambeau', '1']])
})

test('the input order is preserved, only the numbers are added', () => {
	// The caller sorts. Returning them in arrival order would silently undo the
	// reader's chosen column.
	const list = [who('z', 2019, 2025), who('a', 1921, 1949)]
	assert.deepEqual(numberLeaders(list).map((r) => r.leader), ['z', 'a'])
})

test('a person with two spells is counted once, by the job they held', () => {
	// Ray McLean stood in for Green Bay in 1953 and was the head coach in 1958;
	// the club counts him once, as its fourth. This table is a row per PERSON,
	// where the football site is a row per stint — and the site's version keys a
	// span back to the coach's whole career, so a man with two spans gets two
	// rows carrying identical totals.
	assert.deepEqual(labels([
		who('ronzani', 1950, 1953),
		who('mclean', 1953, 1958),
		who('blackbourn', 1954, 1957),
	]), [['ronzani', '1'], ['mclean', '2'], ['blackbourn', '3']])
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const LEADERS = numberLeaders([
	who('mccarthy', 2006, 2018, { name: 'Mike McCarthy', w: 125, l: 77, t: 2 }),
	who('philbin', 2018, 2018, { name: 'Joe Philbin', w: 2, l: 2, interim: true }),
	who('lafleur', 2019, 2025, { name: 'Matt LaFleur', w: 76, l: 40, t: 1 }),
])

const render = (over = {}) => leadersPage({
	team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
	leaders: LEADERS, base: '/nfl/packers', path: '/nfl/packers/coaches',
	columns: leaderColumns({ ties: true, leaderNoun: 'Coach' }), ...over,
})

test('the number is the first column and is on every row', () => {
	const html = render()
	assert.match(html, />#</)
	for (const label of ['1', '1.1', '2']) {
		assert.ok(html.includes(`<td class="dim">${label}</td>`), `no row numbered ${label}`)
	}
})

test('the number column sorts as a NUMBER, so 10 does not come before 2', () => {
	// Through `sortRows`, not through the page. `leadersPage` renders the order
	// it is handed — the server sorts — so asserting the rendered order proves
	// only what the fixture already said. Both versions of this test did that,
	// and a mutation making the column sort as text passed under them.
	//
	// Eleven coaches, because three cannot fail either: "1", "1.1", "2" sort
	// the same as text and as numbers. That is the zero-padded sort test this
	// repo already records, where 0001/0002/0010 made lexical and numeric order
	// identical and the test passed under the bug it was written for.
	const cols = leaderColumns({ leaderNoun: 'Coach' })
	const params = new URLSearchParams('sort=num&dir=asc')
	const many = numberLeaders(Array.from({ length: 11 }, (_, i) =>
		who(`c${i}`, 1920 + i * 5, 1924 + i * 5, { name: `Coach ${i + 1}` })))
	const order = sortRows(many, cols, parseSort(params, cols, null), (r) => r.leader)
	assert.deepEqual(order.map((r) => r.label),
		['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
})

test('a fraction sorts between the whole numbers either side of it', () => {
	const cols = leaderColumns({ leaderNoun: 'Coach' })
	const params = new URLSearchParams('sort=num&dir=asc')
	const order = sortRows(LEADERS, cols, parseSort(params, cols, null), (r) => r.leader)
	assert.deepEqual(order.map((r) => r.label), ['1', '1.1', '2'])
})

test('hiding the stand-ins is a link, and the way back exists on the filtered page', () => {
	// Both sites use a checkbox and remember it in localStorage; a link needs no
	// script and makes the filtered view a URL somebody can send.
	assert.match(render(), /Hide 1 interim coach/)
	// Counted from the UNFILTERED set. Counting the rows on screen makes the
	// link vanish the moment it is used, with no way back.
	const filtered = render({ leaders: LEADERS.filter((r) => !r.interim), standIns: 1, params: new URLSearchParams('interim=hide') })
	assert.match(filtered, /Show 1 interim coach/)
})

test('the toggle keeps every other parameter, so it does not throw away the sort', () => {
	const html = render({ params: new URLSearchParams('sort=w&dir=desc') })
	assert.match(html, /href="\/nfl\/packers\/coaches\?sort=w&amp;dir=desc&amp;interim=hide"/)
})

test('a club with no stand-ins is not offered the toggle', () => {
	// A control that can never change the table is worse than no control — the
	// same call the head-to-head "current franchises" checkbox makes.
	const html = render({ leaders: LEADERS.filter((r) => !r.interim) })
	assert.ok(!/interim coach/.test(html), 'a toggle was drawn with nothing to hide')
})

test('the share row sits below the table, not above it as a control', () => {
	const html = render({ share: '<details class="switcher share">x</details>' })
	assert.ok(html.indexOf('leaders-table') < html.indexOf('class="switcher share"'),
		'share is drawn above the table')
})

test('no share row renders nothing', () => {
	assert.ok(!render().includes('switcher share'))
})
