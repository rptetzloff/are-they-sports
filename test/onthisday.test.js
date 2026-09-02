import test from 'node:test'
import assert from 'node:assert/strict'
import { anniversaryOf, onThisDay, summarise, windowAround } from '../lib/onthisday.js'
import { onThisDayPanel } from '../lib/render.js'
import { loadSports } from '../lib/teams.js'

const adapters = await loadSports()

/** One played game. */
const g = (date, over = {}) => ({
	date, season: date.slice(0, 4), result: 'WIN',
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10', location: 'home', ...over,
})

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

test('an exact window is one day', () => {
	assert.deepEqual(windowAround('2026-09-02', 0), ['09-02'])
})

test('a window crosses the new year', () => {
	// The boundary every date bug in this repo has been about. Three days either
	// side of January 1 reaches back into December, and arithmetic done on the
	// month and day alone would produce 01--02 and 01-00.
	assert.deepEqual(windowAround('2027-01-01', 3),
		['12-29', '12-30', '12-31', '01-01', '01-02', '01-03', '01-04'])
})

test('a window over a leap day includes it', () => {
	// February 29 is included when the reference year has one, and simply never
	// matches in other years — which is the right answer for a panel about
	// anniversaries rather than a reason to special-case it.
	assert.ok(windowAround('2028-02-28', 2).includes('02-29'))
	assert.ok(!windowAround('2027-02-28', 2).includes('02-29'))
})

test('an unusable date yields no window rather than throwing', () => {
	assert.deepEqual(windowAround('not-a-date', 3), [])
	assert.deepEqual(onThisDay([g('2011-09-08')], { today: '' }), [])
})

// ---------------------------------------------------------------------------
// Which games
// ---------------------------------------------------------------------------

test('an exact window matches only the same month and day', () => {
	const rows = [g('2011-09-08'), g('2012-09-09'), g('2010-09-08')]
	const got = onThisDay(rows, { today: '2026-09-08' })
	assert.deepEqual(got.map((x) => x.date), ['2011-09-08', '2010-09-08'])
})

test('a window pulls in the days either side', () => {
	// The sport rule doing its work: a club playing seventeen games a year has
	// empty calendar dates by the hundred, so an exact match shows nothing for
	// most of the year.
	const rows = [g('2011-09-05'), g('2012-09-11'), g('2013-09-08')]
	const got = onThisDay(rows, { today: '2026-09-08', windowDays: 3 })
	assert.deepEqual(got.map((x) => x.date).sort(),
		['2011-09-05', '2012-09-11', '2013-09-08'])
})

test('the current season is not "on this day"', () => {
	// A game played an hour ago is already the answer at the top of the page.
	// Repeating it under a heading about other years reads as a mistake.
	const rows = [g('2026-09-08'), g('2011-09-08')]
	const got = onThisDay(rows, { today: '2026-09-08', currentSeason: '2026' })
	assert.deepEqual(got.map((x) => x.season), ['2011'])
})

test('a game that has not been played is not shown', () => {
	// A fixture on today's date in a future season has no result, and a panel
	// about what happened must not list something that has not.
	const rows = [g('2011-09-08'), g('2027-09-08', { result: '' })]
	assert.deepEqual(onThisDay(rows, { today: '2026-09-08' }).map((x) => x.season), ['2011'])
})

test('newest first, and the order is stable', () => {
	const rows = [g('1994-09-08'), g('2011-09-08'), g('1968-09-08')]
	assert.deepEqual(onThisDay(rows, { today: '2026-09-08' }).map((x) => x.season),
		['2011', '1994', '1968'])
})

test('an exact anniversary is told apart from a near one', () => {
	assert.equal(anniversaryOf(g('2011-09-08'), '2026-09-08'), 'exact')
	assert.equal(anniversaryOf(g('2011-09-05'), '2026-09-08'), 'near')
})

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

test('the summary counts results and the years covered', () => {
	const s = summarise([
		g('2011-09-08'), g('1994-09-08', { result: 'LOSS' }), g('1968-09-08', { result: 'TIE' }),
	])
	assert.deepEqual([s.count, s.wins, s.losses, s.ties], [3, 1, 1, 1])
	assert.deepEqual([s.first, s.last], [1968, 2011])
})

test('nothing to summarise is zero rather than NaN', () => {
	// Math.min of an empty list is Infinity, which renders as a heading reading
	// "Infinity–-Infinity".
	const s = summarise([])
	assert.deepEqual([s.count, s.first, s.last], [0, null, null])
})

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

const TEAM = { nouns: { team: 'Packers' }, rules: {} }

test('an empty panel says so instead of disappearing', () => {
	// An absent panel and a panel with no matches look identical, and only one
	// of them means this club has never played on this date.
	const html = onThisDayPanel({ games: [], summary: summarise([]), today: '2026-09-08', team: TEAM })
	assert.ok(html.includes('never played on this date'))
})

test('the heading does not call a nearby game an anniversary', () => {
	// With a three-day window, six of every seven games shown are not on this
	// date at all, and a panel headed "On this date" would be wrong about them.
	const games = [g('2011-09-05')]
	const exact = onThisDayPanel({ games, summary: summarise(games), today: '2026-09-08', team: TEAM })
	assert.ok(exact.includes('On this date'))
	const near = onThisDayPanel({
		games, summary: summarise(games), today: '2026-09-08', team: TEAM, windowDays: 3,
	})
	assert.ok(near.includes('Around this date'))
	assert.ok(!near.includes('On this date'))
})

test('the window is the sport rule, not a constant here', () => {
	// Declared long before anything read it: exact for baseball, three days
	// either side for football. This is the first thing to use it, and reading a
	// number written in the panel instead would put a football rule on a
	// baseball page.
	assert.equal(adapters.mlb.defaults.rules.onThisDayWindowDays, 0)
	assert.equal(adapters.nfl.defaults.rules.onThisDayWindowDays, 3)
})

test('an away game says so, and the score belongs to this club', () => {
	const games = [g('2011-09-08', { location: 'away', scoreFor: '7', scoreAgainst: '34' })]
	const html = onThisDayPanel({ games, summary: summarise(games), today: '2026-09-08', team: TEAM })
	assert.ok(html.includes('@ '))
	assert.ok(html.includes('7–34'))
})
