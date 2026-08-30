import test from 'node:test'
import assert from 'node:assert/strict'
import { chartGeometry, historyPoints } from '../lib/history.js'
import { computeRecords } from '../lib/records.js'
import { loadIndex } from '../lib/indices.js'

// A club's whole history as one chart. The geometry is separated from the markup
// so it can be checked as numbers — the football site's chart is 142 lines of
// SVG assembly with the arithmetic inline, and a season plotted one column off
// is only visible that way.

const season = (year, w, l, t = 0, over = {}) => [
	...Array.from({ length: w }, (_, i) => ({ result: 'WIN', scoreFor: '20', scoreAgainst: '10', ...base(year, `w${i}`), ...over })),
	...Array.from({ length: l }, (_, i) => ({ result: 'LOSS', scoreFor: '7', scoreAgainst: '21', ...base(year, `l${i}`), ...over })),
	...Array.from({ length: t }, (_, i) => ({ result: 'TIE', scoreFor: '14', scoreAgainst: '14', ...base(year, `t${i}`), ...over })),
]
const base = (year, id) => ({
	date: `${year}-09-01`, season: String(year), regular_season: '1', playoff: '0',
	championship: '', championshipTitle: null, Opponent: 'CHI', location: 'home', gid: `${year}-${id}`,
})

test('a season carries its points and its record', () => {
	const [s] = historyPoints(computeRecords(season(2011, 15, 1)).everySeason)
	assert.equal(s.season, 2011)
	assert.equal(s.record, '15–1')
	assert.equal(s.pf, 15 * 20 + 7)
	assert.equal(s.pa, 15 * 10 + 21)
})

test('points come from the regular season, not the playoffs', () => {
	// A playoff run would otherwise inflate the points of the seasons that had
	// one, beside a record that excludes them.
	const rows = [
		...season(2010, 10, 6),
		{ ...base(2010, 'p'), regular_season: '0', playoff: '1', result: 'WIN', scoreFor: '99', scoreAgainst: '0' },
	]
	const [s] = historyPoints(computeRecords(rows).everySeason)
	assert.equal(s.pf, 10 * 20 + 6 * 7)
	assert.equal(s.record, '10–6')
})

test('a season with nothing played is absent, not plotted at zero', () => {
	// A club whose current season has not started must not end its history with
	// a plunge to .000 that is not a result. It is absent upstream rather than
	// filtered here: `everySeason` is built from the seasons that HAVE completed
	// games, so there is nothing to drop. Asserted so that stays true — if a
	// zero-game row ever reaches everySeason, this is what catches it.
	const rows = [
		...season(2024, 12, 5),
		{ ...base(2025, 'x'), result: '', scoreFor: '', scoreAgainst: '' },
	]
	const points = historyPoints(computeRecords(rows).everySeason)
	assert.deepEqual(points.map((p) => p.season), [2024])
	for (const p of points) assert.ok(p.record !== '0–0', 'an empty season reached the chart')
})

test('a title season is marked, and an unbeaten one separately', () => {
	const rows = [
		...season(1929, 12, 0, 1),
		...season(1965, 10, 3, 1),
		{ ...base(1965, 'c'), regular_season: '0', playoff: '1', result: 'WIN', championship: '1965', championshipTitle: 'NFL Championship', scoreFor: '23', scoreAgainst: '12' },
	]
	const by = new Map(historyPoints(computeRecords(rows).everySeason).map((p) => [p.season, p]))
	assert.equal(by.get(1929).lossless, true)
	assert.equal(by.get(1929).champion, false, '1929 had no title game and must not be marked as won')
	assert.equal(by.get(1965).champion, true)
	assert.equal(by.get(1965).lossless, false)
})

test('a title LOST is not a title', () => {
	const rows = [
		...season(1997, 13, 3),
		{ ...base(1997, 'c'), regular_season: '0', playoff: '1', result: 'LOSS', championship: '1997', championshipTitle: 'Super Bowl', scoreFor: '24', scoreAgainst: '31' },
	]
	assert.equal(historyPoints(computeRecords(rows).everySeason)[0].champion, false)
})

// --- geometry ---

test('the first and last seasons sit at the edges', () => {
	const g = chartGeometry([{ season: 1, pct: 0.5 }, { season: 2, pct: 0.5 }, { season: 3, pct: 0.5 }],
		{ width: 100, height: 100, pad: 10 })
	assert.equal(g.points[0].x, 10)
	assert.equal(g.points.at(-1).x, 90)
	assert.equal(g.points[1].x, 50)
})

test('a percentage of one is at the top and zero at the bottom', () => {
	// y is inverted: a chart with .000 at the top would read as its own mirror.
	const g = chartGeometry([{ season: 1, pct: 1 }, { season: 2, pct: 0 }], { width: 100, height: 100, pad: 10 })
	assert.equal(g.points[0].y, 10)
	assert.equal(g.points[1].y, 90)
	assert.equal(g.mid, 50)
})

test('a single season is centred rather than at NaN', () => {
	// One point has no span to divide by, and dividing by zero puts it nowhere.
	const g = chartGeometry([{ season: 1, pct: 0.5 }], { width: 100, height: 100, pad: 10 })
	assert.equal(g.points.length, 1)
	assert.ok(Number.isFinite(g.points[0].x), `x is ${g.points[0].x}`)
	assert.equal(g.points[0].x, 50)
})

test('no seasons is an empty chart, not a crash', () => {
	const g = chartGeometry([])
	assert.deepEqual(g.points, [])
})

// --- against the real club ---

test('the Packers history spans every season they have played', () => {
	const points = historyPoints(computeRecords(loadIndex('packers', 'games').entries).everySeason)
	assert.equal(points[0].season, 1921)
	assert.ok(points.length > 100, `only ${points.length} seasons`)
	// Ordered, and one entry per season.
	const years = points.map((p) => p.season)
	assert.deepEqual(years, [...years].sort((a, b) => a - b))
	assert.equal(new Set(years).size, years.length)
	// 1929 is the unbeaten one, as everywhere else in this repo.
	assert.deepEqual(points.filter((p) => p.lossless).map((p) => p.season), [1929])
})
