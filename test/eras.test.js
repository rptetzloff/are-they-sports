import test from 'node:test'
import assert from 'node:assert/strict'
import { bandLabel, chartGeometry, coachEras } from '../lib/history.js'
import { leaderStints } from '../lib/leaders.js'
import { historyPage } from '../lib/render.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')

const pts = (from, to) => Array.from({ length: to - from + 1 },
	(_, i) => ({ season: from + i, pct: 0.5, record: '8–8', pf: 300, pa: 300, champion: false, final: null, lossless: false }))
const placed = (from, to) => chartGeometry(pts(from, to)).points

/** Games under one leader. */
const spell = (franchise, leader, name, season, from, games) => Array.from({ length: games }, (_, i) => ({
	leader, name, franchise, season: String(season),
	date: `${season}-09-${String(from + i).padStart(2, '0')}`, result: 'WIN',
}))

// ---------------------------------------------------------------------------
// Stints
// ---------------------------------------------------------------------------

test('a leader with two spells at one club is two stints, not one career', () => {
	// Harvey Kuenn managed the Brewers in 1975 and again in 1982-83. One band
	// spanning 1975 to 1983 draws straight over Alex Grammas, George Bamberger,
	// Buck Rodgers and Rene Lachemann, who held the job for seven of those nine
	// years between them.
	const rows = [
		...spell('MIL', 'kuenn', 'Harvey Kuenn', 1975, 1, 3),
		...spell('MIL', 'grammas', 'Alex Grammas', 1976, 1, 3),
		...spell('MIL', 'kuenn', 'Harvey Kuenn', 1982, 1, 3),
	]
	assert.deepEqual(leaderStints(rows).map((t) => [t.leader, t.from, t.to]),
		[['kuenn', 1975, 1975], ['grammas', 1976, 1976], ['kuenn', 1982, 1982]])
})

test('a stint runs across seasons while the same person holds the job', () => {
	const rows = [
		...spell('GB', 'lombardi', 'Vince Lombardi', 1959, 1, 3),
		...spell('GB', 'lombardi', 'Vince Lombardi', 1960, 1, 3),
	]
	const [only] = leaderStints(rows)
	assert.equal(only.from, 1959)
	assert.equal(only.to, 1960)
	assert.equal(only.games, 6)
})

test('stints come out in date order, whatever order the rows arrived in', () => {
	// `leaderGames` has no ORDER BY on the season.
	const rows = [
		...spell('GB', 'lafleur', 'Matt LaFleur', 2019, 1, 2),
		...spell('GB', 'mccarthy', 'Mike McCarthy', 2018, 1, 2),
	]
	assert.deepEqual(leaderStints(rows).map((t) => t.leader), ['mccarthy', 'lafleur'])
})

test('the rows are sorted BEFORE they are cut into stints, not after', () => {
	// Sorting the finished stints hides this: with each leader's rows already
	// contiguous, the outer sort puts them back in the right order and the
	// missing inner sort changes nothing. Interleave them and it does — one
	// spell becomes three, and the middle man gets a band inside somebody
	// else's era.
	const rows = [
		...spell('GB', 'mccarthy', 'Mike McCarthy', 2018, 1, 1),
		...spell('GB', 'lafleur', 'Matt LaFleur', 2019, 1, 1),
		...spell('GB', 'mccarthy', 'Mike McCarthy', 2018, 2, 1),
	]
	assert.deepEqual(leaderStints(rows).map((t) => [t.leader, t.games]),
		[['mccarthy', 2], ['lafleur', 1]])
})

test('two clubs are two timelines, never one interleaved run', () => {
	const rows = [
		...spell('GB', 'a', 'A One', 2018, 1, 2),
		...spell('CHI', 'b', 'B Two', 2018, 1, 2),
		...spell('GB', 'a', 'A One', 2019, 1, 2),
	]
	// Interleaved into one run these are three stints — A, B, A — and Green Bay
	// gets a band with Chicago's season cut out of the middle of it.
	const stints = leaderStints(rows)
	assert.equal(stints.length, 2)
	assert.deepEqual(stints.map((t) => [t.franchise, t.leader]).sort(),
		[['CHI', 'b'], ['GB', 'a']])
	const gb = stints.find((t) => t.franchise === 'GB')
	assert.deepEqual([gb.from, gb.to], [2018, 2019])
})

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

test('a band ends where the next one starts, so no two overlap', () => {
	// A stint's last season is one the next man also worked. Drawing each band
	// to its own bounds overlaps every boundary by a year.
	const eras = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2003 },
		{ leader: 'b', name: 'Bob Beta', from: 2003, to: 2005 },
	], placed(2000, 2005))
	assert.equal(eras.length, 2)
	assert.equal(eras[0].toIndex, eras[1].fromIndex)
	for (const e of eras) assert.ok(e.toIndex > e.fromIndex, `${e.label} has no width`)
})

test('the last band reaches the end of the chart, even for a single season', () => {
	// It did not. The boundary and the chart's right edge are the same x, so the
	// final band came out zero wide and was filtered away — Pat Murphy vanished
	// off the first version of this.
	const eras = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2004 },
		{ leader: 'b', name: 'Bob Beta', from: 2005, to: 2005 },
	], placed(2000, 2005))
	assert.equal(eras.length, 2)
	assert.equal(eras.at(-1).label, 'Beta')
	assert.ok(eras.at(-1).toIndex > eras.at(-1).fromIndex)
})

test('a season with two men in it is split between them', () => {
	// Both start in the same year, so one of them gets a zero-width band unless
	// the season is divided.
	const eras = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2002, to: 2002 },
		{ leader: 'b', name: 'Bob Beta', from: 2002, to: 2005 },
	], placed(2000, 2005))
	assert.equal(eras.length, 2)
	assert.ok(eras[0].toIndex > eras[0].fromIndex, 'the first man has no band')
	assert.ok(eras[1].fromIndex > eras[0].fromIndex, 'both bands start at the same place')
})

test('bands are positioned by INDEX, not by season arithmetic', () => {
	// `chartGeometry` spaces points evenly however far apart their seasons are,
	// so a club that missed years has a chart where 1942 and 1946 are
	// neighbours. Bands computed from season numbers drift off the line.
	const gappy = chartGeometry([1941, 1946, 1947].map((season) => ({ season, pct: 0.5 }))).points
	const eras = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 1941, to: 1941 },
		{ leader: 'b', name: 'Bob Beta', from: 1946, to: 1947 },
	], gappy)
	// Three points, so indices 0..2. Beta starts at point 1, half a slot back.
	assert.equal(eras[1].fromIndex, 0.5)
	assert.equal(eras[1].toIndex, 2)
})

test('a stint outside the charted seasons is dropped, not drawn off the edge', () => {
	// The Braves have managers from 1871 and this repo's games start later.
	assert.deepEqual(coachEras([{ leader: 'a', name: 'Ann Alpha', from: 1871, to: 1875 }], placed(2000, 2005)), [])
	assert.deepEqual(coachEras([], placed(2000, 2005)), [])
	assert.deepEqual(coachEras([{ leader: 'a', name: 'A B', from: 2000, to: 2001 }], []), [])
})

test('bands are ordered by when they started, not by how they arrived', () => {
	// The stints come from two sources — runs of games and the curated tenures —
	// concatenated. Unsorted, a band ends at the START of whichever stint
	// happened to follow it in the array, so boundaries cross and bands overlap.
	const eras = coachEras([
		{ leader: 'b', name: 'Bob Beta', from: 2003, to: 2005 },
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2003 },
	], placed(2000, 2005))
	assert.deepEqual(eras.map((e) => e.label), ['Alpha', 'Beta'])
	assert.ok(eras[0].toIndex <= eras[1].fromIndex, 'the bands overlap')
})

test('a band with no width is dropped rather than drawn as a hairline', () => {
	// Reachable when two stints begin in seasons the club did not play, which
	// both clamp to the same end of the chart. The Braves' 1870s and a
	// wartime gap are the shapes that get here.
	const sparse = chartGeometry([2000, 2005].map((season) => ({ season, pct: 0.5 }))).points
	const eras = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2002, to: 2002 },
		{ leader: 'b', name: 'Bob Beta', from: 2003, to: 2005 },
	], sparse)
	for (const e of eras) assert.ok(e.toIndex > e.fromIndex, `${e.label} has no width`)
})

test('a band knows the years it covers, which is not where it is drawn', () => {
	// The drawn range runs to the next man's start; the years are the stint's
	// own, and that is what the hover text says.
	const [band] = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2003 },
		{ leader: 'b', name: 'Bob Beta', from: 2003, to: 2005 },
	], placed(2000, 2005))
	assert.equal(band.from, 2000)
	assert.equal(band.to, 2003)
	assert.equal(band.name, 'Ann Alpha')
})

// ---------------------------------------------------------------------------
// The label
// ---------------------------------------------------------------------------

test('a band is labelled with the surname, and co-coaches keep both', () => {
	// "Vince Lombardi" does not fit a nine-season band. The 1953 Packers were
	// Devore and McLean, and dropping either names the wrong man.
	assert.equal(bandLabel('Vince Lombardi'), 'Lombardi')
	assert.equal(bandLabel('Hugh Devore & Ray McLean'), 'Devore/McLean')
	assert.equal(bandLabel('Jim L. Mora'), 'Mora')
	assert.equal(bandLabel(''), '')
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const render = (over = {}) => historyPage({
	team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
	points: pts(2000, 2020), base: '/nfl/packers', ...over,
})

const ERAS = coachEras([
	{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2010 },
	{ leader: 'b', name: 'Bartholomew Beta', from: 2011, to: 2011 },
	{ leader: 'c', name: 'Cy Gamma', from: 2012, to: 2020 },
], placed(2000, 2020))

test('the bands are drawn behind the line, not over it', () => {
	// A translucent rectangle painted after the polyline dims the subject of the
	// chart. SVG has no z-index; paint order is the only control.
	//
	// NO band after the line, not merely the first one before it. Checking
	// `indexOf` on the first band is satisfied by markup that draws them in both
	// places, which is what a mutation run drew.
	const html = render({ eras: ERAS })
	const svg = html.slice(html.indexOf('<svg class="history-chart"'), html.indexOf('</svg>'))
	assert.ok(svg.includes('<g class="era'), 'no bands at all')
	assert.ok(!svg.slice(svg.indexOf('<polyline')).includes('<g class="era'),
		'a band is drawn over the line')
})

test('every era gets a band and a hover name, with the years it held', () => {
	const html = render({ eras: ERAS })
	assert.equal([...html.matchAll(/<g class="era/g)].length, 3)
	assert.match(html, /<title>Ann Alpha, 2000–2010<\/title>/)
	// A single season reads as one year, not as "2011–2011".
	assert.match(html, /<title>Bartholomew Beta, 2011<\/title>/)
})

test('bands alternate, so a boundary is visible without sixteen colours', () => {
	const html = render({ eras: ERAS })
	assert.equal([...html.matchAll(/<g class="era alt"/g)].length, 1)
})

test('a label is drawn only where it fits its OWN band', () => {
	// At a fixed 34px threshold "Gregg" and "Infante" both cleared it in
	// adjacent four-season bands and rendered touching, so the chart read
	// "Gregg Infante" as one man. Two names run together is worse than one name
	// missing: the band is still there and still names itself on hover.
	//
	// Two names in the SAME band width, so the only thing that differs is how
	// long the name is. A one-season band is 47px wide here, which fits "Beta"
	// and does not fit a fifteen-character surname — and the first version of
	// this test asserted the one-season band was never labelled, which was a
	// claim about the fixture rather than about the rule.
	const short = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2010 },
		{ leader: 'b', name: 'Bob Beta', from: 2011, to: 2011 },
		{ leader: 'c', name: 'Cy Gamma', from: 2012, to: 2020 },
	], placed(2000, 2020))
	const long = coachEras([
		{ leader: 'a', name: 'Ann Alpha', from: 2000, to: 2010 },
		{ leader: 'b', name: 'Bob Schottenheimerson', from: 2011, to: 2011 },
		{ leader: 'c', name: 'Cy Gamma', from: 2012, to: 2020 },
	], placed(2000, 2020))
	assert.match(render({ eras: short }), /class="era-label"[^>]*>Beta</)
	assert.ok(!render({ eras: long }).includes('>Schottenheimerson<'),
		'a name wider than its band was drawn into its neighbour')
	// And the long one still has a band and a hover name.
	assert.match(render({ eras: long }), /<title>Bob Schottenheimerson, 2011<\/title>/)
})

test('a club with no leaders on record says so rather than drawing nothing', () => {
	// The caption used to read "coach eras are not drawn on this chart", which
	// stopped being true. A blank chart with no explanation is the failure that
	// replaced it.
	const html = render({ eras: [] })
	assert.ok(!html.includes('<g class="era'))
	assert.match(html, /No coaches are on record for this club/)
	assert.ok(!/eras are not drawn/.test(html))
})

test('the caption tells a reader the bands are hoverable', () => {
	// There is no other way to find out: a native `<title>` gives no cursor and
	// no outline.
	assert.match(render({ eras: ERAS }), /hover one for the name and years/)
})
