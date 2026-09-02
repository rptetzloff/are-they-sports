import test from 'node:test'
import assert from 'node:assert/strict'
import { computeHeadToHead, filterGames, opponentDetail } from '../lib/headtohead.js'
import { currentFranchises } from '../lib/names.js'
import { headToHeadPage, h2hColumns, opponentPage } from '../lib/render.js'
import { parseSort } from '../lib/sort.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

/** Games against one opponent. `where` alternates home and away unless fixed. */
const vs = (opponent, pattern, {
	year = 2000, playoff = false, home = null, pf = '20', pa = '10',
} = {}) => pattern.split('').map((c, i) => ({
	result: RESULTS[c],
	date: `${year + i}-09-01`,
	season: String(year + i),
	regular_season: playoff ? '0' : '1',
	location: (home ?? i % 2 === 0) ? 'home' : 'away',
	Opponent: opponent,
	scoreFor: pf,
	scoreAgainst: pa,
}))

// ---------------------------------------------------------------------------
// filterGames
// ---------------------------------------------------------------------------

test('venue and type filter the games, not the totals', () => {
	// The whole reason the filters run over rows and the page recomputes: a
	// home-only record cannot be recovered from an all-venues one, so filtering
	// the finished opponent list would have to make the numbers up.
	const rows = [
		...vs('CHI', 'WW', { home: true }),
		...vs('CHI', 'LL', { home: false }),
	]
	assert.equal(computeHeadToHead(rows).opponents[0].record, '2–2')
	assert.equal(computeHeadToHead(filterGames(rows, { venue: 'home' })).opponents[0].record, '2–0')
	assert.equal(computeHeadToHead(filterGames(rows, { venue: 'away' })).opponents[0].record, '0–2')
})

test('away is everything that is not home, rather than a value of its own', () => {
	// A neutral-site game has to land somewhere, and counting it as neither
	// would make home + away disagree with the total — which is the first thing
	// anyone checks on a splits table.
	const rows = [
		...vs('CHI', 'W', { home: true }),
		...vs('CHI', 'L', { year: 2010, home: false }),
		{ ...vs('CHI', 'W', { year: 2020 })[0], location: 'neutral' },
	]
	const home = computeHeadToHead(filterGames(rows, { venue: 'home' })).opponents[0]
	const away = computeHeadToHead(filterGames(rows, { venue: 'away' })).opponents[0]
	assert.equal(home.games + away.games, rows.length)
	assert.equal(away.games, 2)
})

test('type splits the regular season from everything else', () => {
	const rows = [...vs('CHI', 'WW'), ...vs('CHI', 'L', { year: 2010, playoff: true })]
	assert.equal(filterGames(rows, { type: 'regular' }).length, 2)
	assert.equal(filterGames(rows, { type: 'playoffs' }).length, 1)
})

test('an unknown filter value shows everything rather than nothing', () => {
	// A hand-typed `?venue=stadium` should show the table. Same rule the sort
	// parameter already follows: a cosmetic parameter falls back, it does not
	// produce an empty page a reader will read as "no games".
	const rows = vs('CHI', 'WWLL')
	assert.equal(filterGames(rows, { venue: 'stadium', type: 'friendly' }).length, 4)
	assert.equal(filterGames(rows, {}).length, 4)
	// And the untouched case is the same array, not a copy: this runs on every
	// unfiltered request.
	assert.equal(filterGames(rows, { venue: 'all', type: 'all' }), rows)
})

// ---------------------------------------------------------------------------
// currentFranchises
// ---------------------------------------------------------------------------

test('the current franchises are the ones whose latest era is the latest era', () => {
	// 32 football clubs and 30 baseball ones, read out of the franchise history
	// table. The football site hardcodes 31 names; the baseball site derives it
	// from the games, which would call 28 football franchises defunct because a
	// club meets fourteen of thirty-one in a season.
	const nfl = currentFranchises('nfl')
	assert.equal(nfl.size, 32)
	assert.ok(nfl.has('GB'))
	assert.ok(!nfl.has('RII'), 'the Rock Island Independents are not still playing')
	assert.equal(currentFranchises('mlb').size, 30)
})

test('baseball has no defunct franchises on record, which is why it gets no filter', () => {
	// Not trivia: the page draws the checkbox only where it can narrow
	// something, and this is the measurement that decision rests on. If a
	// defunct baseball franchise is ever added, this fails and the control
	// should start appearing.
	const mlb = currentFranchises('mlb')
	assert.equal(mlb.size, 30)
	assert.ok(mlb.has('MIL'))
})

// ---------------------------------------------------------------------------
// opponentDetail
// ---------------------------------------------------------------------------

const detailOf = (rows, opts) => {
	const [o] = computeHeadToHead(rows).opponents
	return opponentDetail(o.meetings, opts)
}

test('the splits add up to the whole', () => {
	// The first thing a reader checks, and the first thing to go wrong if a
	// filter predicate is inverted anywhere.
	const d = detailOf([
		...vs('CHI', 'WWLT', { home: true }),
		...vs('CHI', 'WLL', { year: 2010, home: false }),
		...vs('CHI', 'W', { year: 2020, playoff: true, home: true }),
	])
	assert.equal(d.home.games + d.away.games, d.overall.games)
	assert.equal(d.regular.games + d.post.games, d.overall.games)
	assert.equal(d.overall.games, 8)
	assert.equal(d.home.games, 5)
	assert.equal(d.post.games, 1)
})

test('the longest streak is the longest, not the current one', () => {
	// `computeHeadToHead` already carries the run in progress. These are a
	// different question and a table showing them as the same number would be
	// wrong for every club that is not mid-record.
	const d = detailOf(vs('CHI', 'WWWWLLW'))
	assert.equal(d.longestWinStreak, 4)
	assert.equal(d.longestLossStreak, 2)
})

test('a shutout is a win where the other side scored nothing, both ways round', () => {
	const d = detailOf([
		...vs('CHI', 'W', { pf: '20', pa: '0' }),
		...vs('CHI', 'W', { year: 2010, pf: '20', pa: '3' }),
		...vs('CHI', 'L', { year: 2020, pf: '0', pa: '9' }),
	])
	assert.equal(d.shutouts, 1)
	assert.equal(d.shutoutLosses, 1)

	// A 0-0 TIE is not a shutout either way, and football has real ones — the
	// Giants and the Lions played one in 1943. Checking only the score, which
	// is the obvious way to write this, counts that game twice.
	const drawn = detailOf(vs('CHI', 'T', { pf: '0', pa: '0' }))
	assert.equal(drawn.shutouts, 0)
	assert.equal(drawn.shutoutLosses, 0)
	assert.equal(d.pointsFor, 40)
	assert.equal(d.pointsAgainst, 12)
	assert.equal(d.differential, 28)
})

test('the recent split is the last ten by date, not the last ten in the array', () => {
	const rows = [...vs('CHI', 'LLLLLLLLLLL'), ...vs('CHI', 'WWWWWWWWWW', { year: 2050 })].reverse()
	const d = detailOf(rows)
	assert.equal(d.recent.games, 10)
	assert.equal(d.recent.wins, 10)
})

test('the detail sorts what it is given rather than trusting the order', () => {
	// Reached DIRECTLY, because everything else here goes through
	// `computeHeadToHead`, which already sorts — so a mutation deleting the sort
	// inside `opponentDetail` changed no result and the guard read as dead code.
	// It is not dead: this is an exported function taking a plain array, and
	// three of its answers are chronological.
	//
	// Kept rather than deleted, which is the opposite call to the route
	// tie-break this repo removed for the same reason. The difference is that
	// the tie-break could not be reached by any caller and this can.
	const meeting = (season, result, home = true) => ({
		date: `${season}-09-01`, season, result, pf: 1, pa: 0, playoff: false, home,
	})
	const backwards = [
		meeting(2020, 'WIN'), meeting(2019, 'WIN'), meeting(2018, 'LOSS'), meeting(2017, 'WIN'),
	]
	const d = opponentDetail(backwards, { eraOf: (g) => (g.season < 2019 ? 'old' : 'new') })
	assert.equal(d.longestWinStreak, 2, 'the two 2019-2020 wins are only adjacent in date order')
	assert.deepEqual(d.eras.map((e) => e.name), ['old', 'new'])
	assert.equal(d.recent.games, 4)
})

test('with ten meetings or fewer the recent split repeats the total, and the page can tell', () => {
	// Rendered only when it differs. "Last 4" next to an identical "Overall" is
	// a row that says nothing twice.
	const d = detailOf(vs('CHI', 'WWLL'))
	assert.equal(d.recent.games, d.overall.games)
})

test('eras are named by the resolver, in first-meeting order', () => {
	// One franchise, several names. This is what turns a single row into
	// "Chicago Staleys 0-1, Chicago Bears 109-97-6", and it is the reason the
	// era name cannot come from the opponent code.
	const d = detailOf([...vs('CHI', 'L', { year: 1921 }), ...vs('CHI', 'WW', { year: 1930 })], {
		eraOf: (g) => (g.season < 1922 ? 'Chicago Staleys' : 'Chicago Bears'),
	})
	assert.deepEqual(d.eras.map((e) => [e.name, e.record]), [['Chicago Staleys', '0–1'], ['Chicago Bears', '2–0']])
})

test('one era is no eras, and no resolver is no eras', () => {
	// A single-era table is a heading over a row that repeats the overall
	// record, so the list is empty and the page draws nothing.
	assert.deepEqual(detailOf(vs('CHI', 'WW'), { eraOf: () => 'Chicago Bears' }).eras, [])
	assert.deepEqual(detailOf(vs('CHI', 'WW')).eras, [])
})

test('an opponent with no meetings has no detail, rather than a detail of zeroes', () => {
	assert.equal(opponentDetail([]), null)
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const GAMES = [...vs('CHI', 'WWWW'), ...vs('MIN', 'WL', { year: 2010 }), ...vs('RII', 'W', { year: 1921 })]
const OPPONENTS = computeHeadToHead(GAMES, { isCurrent: (c) => c !== 'RII' }).opponents

const render = (over = {}) => headToHeadPage({
	team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
	opponents: OPPONENTS, resolve: (code) => ({ name: { CHI: 'Chicago Bears', MIN: 'Minnesota Vikings', RII: 'Rock Island Independents' }[code] ?? code }),
	base: '/nfl/packers', path: '/nfl/packers/vs', total: OPPONENTS.length, ...over,
})

const names = (html) => [...html.matchAll(/<td><a href="\/nfl\/packers\/vs\/[a-z]+">([^<]*)</g)].map((m) => m[1])

test('the three controls are on the page, as a form the server reads', () => {
	// A GET form and no script. The two sites wire an input and two selects to
	// change handlers and re-render in the browser, which `node --test` cannot
	// see — which is how 118 tests passed there while every past season rendered
	// 0-0.
	const html = render()
	assert.match(html, /<form class="filters" method="get" action="\/nfl\/packers\/vs">/)
	for (const name of ['q', 'venue', 'type']) {
		assert.match(html, new RegExp(`name="${name}"`), `no ${name} control`)
	}
	assert.ok(!html.includes('<script'))
	assert.ok(!html.includes('onchange'))
})

test('the current-franchises control appears only where it would narrow something', () => {
	// Every baseball franchise on record is current, so the control there would
	// be a checkbox that never changes the table. The baseball site does not
	// have one either, and this is the reason rather than a copied omission.
	assert.match(render({ hasHistorical: true }), /name="current"/)
	assert.ok(!render({ hasHistorical: false }).includes('name="current"'))
})

test('the sort survives applying a filter, and the filters survive sorting', () => {
	// Two directions, one bug each. Without the hidden fields, applying a filter
	// silently drops the column the reader chose; `sortHref` already carries the
	// filters the other way.
	const params = new URLSearchParams('sort=games&dir=asc&venue=home')
	const html = render({ params, sort: parseSort(params, h2hColumns(packers), null) })
	assert.match(html, /<input type="hidden" name="sort" value="games">/)
	assert.match(html, /<input type="hidden" name="dir" value="asc">/)
	assert.match(html, /href="\/nfl\/packers\/vs\?[^"]*venue=home/)
})

test('the selected filter values come back selected', () => {
	// A form that forgets what was asked for reads as a filter that did not
	// apply, and the reader clicks Apply again.
	const html = render({ params: new URLSearchParams('venue=away&type=playoffs&current=1&q=bear') })
	assert.match(html, /<option value="away" selected>/)
	assert.match(html, /<option value="playoffs" selected>/)
	assert.match(html, /value="bear"/)
	assert.match(render({ params: new URLSearchParams('current=1'), hasHistorical: true }), /name="current" value="1" checked/)
})

test('the count names both numbers whenever a filter is on', () => {
	// A filtered table reporting only its own length reads as the club's whole
	// history, which is the one way this feature could quietly lie.
	assert.match(render({ opponents: OPPONENTS.slice(0, 1), total: 3 }), /1 of 3 opponents/)
	assert.match(render(), /3 opponents/)
	assert.ok(!render().includes('of 3 opponents'))
})

test('filtering everything away says so, rather than showing an empty table', () => {
	const html = render({ opponents: [], total: 3 })
	assert.match(html, /No opponents match those filters/)
	assert.match(html, /0 of 3 opponents/)
	// The form is still there, or there is no way back.
	assert.match(html, /<form class="filters"/)
})

test('the clear link appears only when there is something to clear', () => {
	assert.match(render({ params: new URLSearchParams('venue=home') }), /class="clear"/)
	assert.ok(!render({ params: new URLSearchParams('') }).includes('class="clear"'))
})

test('the table sorts on the request, and record sorts by percentage', () => {
	// Sorting "10–5" and "2–1" as strings is alphabetical nonsense, and nobody
	// clicking Record means it.
	const columns = h2hColumns(packers)
	const by = (qs) => names(render({ params: new URLSearchParams(qs), sort: parseSort(new URLSearchParams(qs), columns, null) }))
	assert.deepEqual(by('sort=opponent&dir=asc'), ['Chicago Bears', 'Minnesota Vikings', 'Rock Island Independents'])
	assert.deepEqual(by('sort=games&dir=asc')[0], 'Rock Island Independents')
	// CHI 4-0, RII 1-0 are both 1.000 and MIN is .500, so record puts MIN last.
	assert.deepEqual(by('sort=record&dir=desc').at(-1), 'Minnesota Vikings')
})

test('with nothing asked for, the most-played opponent is still first', () => {
	// The order the page has always arrived in. A feature that adds a choice
	// must not take the existing order away — the same rule `parseSort` states
	// for the all-time table.
	assert.deepEqual(names(render())[0], 'Chicago Bears')
})

test('an opponent is named as it is called now, not as it was at the last meeting', () => {
	// The resolver is asked with no date. Naming from the last meeting made the
	// name a function of the filters — under `?venue=home` the last meeting is a
	// different game and can fall in an earlier era, which listed the "Oakland
	// Raiders" among CURRENT franchises.
	const seen = []
	render({ resolve: (code, when) => { seen.push(when); return { name: code } } })
	assert.ok(seen.length)
	assert.ok(seen.every((w) => w === undefined), `the resolver was given ${JSON.stringify(seen[0])}`)
})

// ---------------------------------------------------------------------------
// The opponent page
// ---------------------------------------------------------------------------

const opponentHtml = (over = {}) => {
	const [o] = computeHeadToHead([
		...vs('CHI', 'WWLT', { home: true }),
		...vs('CHI', 'WL', { year: 2010, home: false }),
	]).opponents
	return opponentPage({
		team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
		opponent: o, name: 'Chicago Bears', resolve: (code) => ({ name: code }),
		base: '/nfl/packers', detail: opponentDetail(o.meetings), ...over,
	})
}

test('the opponent page carries the splits, which is most of what it was missing', () => {
	// 206 lines of the baseball site's h2h-core against 118 here, and this was
	// the difference. The football site has none of it at all.
	const html = opponentHtml()
	for (const label of ['Overall', 'Home', 'Away', 'Regular season', 'Postseason', 'Splits']) {
		assert.ok(html.includes(label), `no ${label} row`)
	}
	assert.match(html, /Points for \/ against/)
})

test('the score label is built from the sport noun, not from scoreForLabel', () => {
	// "Points For" and "Runs Scored" do not share a second half to append
	// "/ against" to. `scoreNoun` does.
	const brewersish = { ...packers, nouns: { ...packers.nouns, scoreNoun: 'runs' } }
	assert.match(opponentHtml({ team: brewersish }), /Runs for \/ against/)
})

test('the opponent page still renders with no detail at all', () => {
	// `opponentDetail` returns null for an opponent with no meetings, and a page
	// that threw on it would take out a route over an empty list.
	const html = opponentHtml({ detail: null })
	assert.match(html, /Chicago Bears/)
	assert.ok(!html.includes('Splits'))
})
