import test from 'node:test'
import assert from 'node:assert/strict'
import {
	championsPage, headToHeadPage, historyPage, leadersPage, leagueRecordsPage,
	opponentPage, standingsPage,
} from '../lib/render.js'
import { STYLE } from '../lib/style.js'
import { computeHeadToHead, opponentDetail } from '../lib/headtohead.js'
import { loadTeam } from '../lib/teams.js'

// Does a table fit a phone?
//
// It did not, on four pages, and nothing here could have said so: rendering
// happens in a browser and `node --test` has no layout engine. The measurement
// that found it drives Chrome over the DevTools protocol and reads
// `documentElement.scrollWidth`, which needs a browser and a loaded database,
// so it cannot run in CI. **This file is the part of that check a test can
// hold**, and it is deliberately two halves that only mean something together:
//
//   1. the stylesheet gives the table containers a horizontal scroll, and
//   2. every table this repo renders is inside one of those containers.
//
// Either alone is satisfiable while the page still overflows.
//
// What it does NOT prove: that the rule works. `overflow-x: auto` could be
// misspelled into a property no browser has and both halves would still pass.
// The browser measurement is the stronger check and it is recorded in the
// commit rather than here.

const COLORS = { base: '#203731', accent: '#FFB612', text: '#ffffff' }
const packers = await loadTeam('packers')

/** The class list of the innermost element still open where a table starts.
 *
 *  A scanner rather than a regular expression, because the question is about
 *  NESTING and `indexOf` on the nearest preceding `<section` answers a
 *  different one — a table after a closed section would look enclosed by it.
 */
function containersOfTables(html) {
	const found = []
	const open = []
	const tag = /<(\/?)(section|div|table)\b([^>]*)>/g
	let m
	while ((m = tag.exec(html))) {
		const [, closing, name, attrs] = m
		if (name === 'table') {
			if (!closing) found.push(open.map((o) => o.cls).reverse())
			continue
		}
		if (closing) open.pop()
		else if (!attrs.trimEnd().endsWith('/')) {
			open.push({ cls: (/class="([^"]*)"/.exec(attrs) ?? [, ''])[1] })
		}
	}
	return found
}

/** Does any enclosing container carry a class the scroll rule names? */
const scrollable = (stack) => stack.some((cls) => /\b(panel|record-card)\b/.test(cls))

// ---------------------------------------------------------------------------
// The stylesheet half
// ---------------------------------------------------------------------------

test('the table containers scroll horizontally rather than pushing the page', () => {
	// Measured at 390px: /history overflowed by 59px, /vs by 41, /coaches by 174
	// and /managers by 76, every one of them a table. The rest of the site
	// already fit.
	const rule = /\.panel,\s*\.record-card\s*\{[^}]*overflow-x:\s*auto/
	assert.match(STYLE, rule)
})

test('cells stop wrapping on a phone, where the table can scroll instead', () => {
	// Lombardi's Titles cell is "1961, 1962, 1965, 1966, 1967" and broke onto
	// five lines, making his row five rows tall — while the column itself was
	// scrolled out of sight, so a reader saw an unexplained gap and nothing to
	// explain it.
	const mobile = STYLE.slice(STYLE.indexOf('@media (max-width: 600px)'))
	assert.ok(mobile, 'there is no phone breakpoint at all')
	assert.match(mobile, /white-space:\s*nowrap/)
})

// ---------------------------------------------------------------------------
// The markup half
// ---------------------------------------------------------------------------

const games = 'WWLT'.split('').map((c, i) => ({
	result: { W: 'WIN', L: 'LOSS', T: 'TIE' }[c],
	date: `${2000 + i}-09-01`, season: String(2000 + i),
	regular_season: '1', location: i % 2 ? 'away' : 'home',
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10',
}))
const h2h = computeHeadToHead(games)
const resolve = (code) => ({ name: code })
const common = { team: packers, colors: COLORS, resolve, base: '/nfl/packers' }

const LINE = { club: 'Packers', teamId: 'packers', sport: 'nfl', w: 13, l: 3, t: 0, pct: 0.8125, gb: 0, record: '13–3', pf: 0, pa: 0 }
const EMPTY_LEAGUE = {
	clubs: 1, seasonRange: { first: 1921, last: 2025 }, titles: [],
	allTime: [{ club: 'Packers', teamId: 'packers', sport: 'nfl', record: '1–0', winPct: 1, from: 1921, to: 2025 }],
	bestSeasons: [], worstSeasons: [], losslessSeasons: [], bestStarts: [], worstStarts: [],
	winStreaks: [], loseStreaks: [], lopsidedWins: [], ties: [],
}

// Named, so the gap is visible. Every page below renders a table, and the check
// fails if one of them stops -- a page silently dropping its table would
// otherwise pass this by having nothing to find.
//
// Absent on purpose: `clubPage` and `leagueSchedulePage` draw their schedules as
// a grid of cards rather than a table, and `missingSeasonPage` has no table at
// all. Those three are the whole remainder.
const PAGES = [
	['head-to-head', () => headToHeadPage({ ...common, opponents: h2h.opponents, path: '/nfl/packers/vs' })],
	['opponent', () => opponentPage({
		...common, opponent: h2h.opponents[0], name: 'Chicago Bears',
		detail: opponentDetail(h2h.opponents[0].meetings),
	})],
	['leaders', () => leadersPage({
		...common, noun: 'coaches',
		leaders: [{ name: 'Curly Lambeau', firstSeason: 1921, lastSeason: 1949, w: 209, l: 104, t: 21, winPct: 0.657, playoffW: 0, playoffL: 0, titles: [{ season: 1929 }, { season: 1930 }], basis: 'counted' }],
	})],
	['history', () => historyPage({
		...common,
		points: [
			{ season: 2010, pct: 0.625, record: '10–6', pf: 388, pa: 240, champion: true, lossless: false },
			{ season: 2011, pct: 0.9375, record: '15–1', pf: 560, pa: 359, champion: false, lossless: false },
		],
	})],
	['league records', () => leagueRecordsPage({
		league: EMPTY_LEAGUE, heading: 'Every club', colors: COLORS, clubs: [],
	})],
	['standings', () => standingsPage({
		standings: { season: 2025, clubs: 1, groups: [{ conference: 'NFC', division: 'North', clubs: [LINE] }] },
		heading: 'Every club', colors: COLORS, clubs: [], seasons: [2025],
	})],
	['champions', () => championsPage({
		champions: [{ season: 1929, sport: 'nfl', champion: 'GB', name: 'Green Bay Packers', title: 'NFL Championship', method: 'standings' }],
		heading: 'NFL champions', colors: COLORS, clubs: [],
	})],
]

test('every table is inside a container the scroll rule covers', () => {
	// The half that cannot be forgotten by the next person to add a table: the
	// rule is on the CONTAINERS, so a new table inherits it — unless somebody
	// puts one somewhere else, which is what this catches.
	const stray = []
	for (const [name, render] of PAGES) {
		const stacks = containersOfTables(render())
		if (!stacks.length) { stray.push(`${name}: renders no table at all`); continue }
		for (const stack of stacks) {
			if (!scrollable(stack)) stray.push(`${name}: table inside [${stack.join(' > ') || 'nothing'}]`)
		}
	}
	assert.deepEqual(stray, [], `tables that cannot scroll:\n${stray.join('\n')}`)
})

test('the scanner is looking at nesting, not at the nearest preceding tag', () => {
	// Written because the obvious version of this check — find the last
	// `<section` before the table — passes on markup where the section has
	// already closed, which is exactly the case it exists to catch.
	assert.deepEqual(
		containersOfTables('<section class="panel"></section><table></table>'),
		[[]],
	)
	assert.deepEqual(
		containersOfTables('<section class="panel"><table></table></section>'),
		[['panel']],
	)
	assert.equal(scrollable([]), false)
	assert.equal(scrollable(['record-card league-wide']), true)
})
