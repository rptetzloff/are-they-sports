import test from 'node:test'
import assert from 'node:assert/strict'
import { markInterim, mergeLeaders, tallyLeaders, tallyTenures } from '../lib/leaders.js'
import { leadersPage } from '../lib/render.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')

/** Games under one leader, in order. `from` is the game number within the
 *  season, so 1 is the opener. */
const spell = (franchise, leader, season, from, games) => Array.from({ length: games }, (_, i) => ({
	leader, name: leader, franchise, season: String(season),
	date: `${season}-09-${String(from + i).padStart(2, '0')}`,
	round: 'regular', title: null, result: 'WIN',
}))

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test('somebody who took over mid-season and did not come back is an interim', () => {
	// Joe Philbin took Green Bay's last four games of 2018 after Mike McCarthy
	// was sacked, and Matt LaFleur opened 2019.
	const rows = [
		...spell('GB', 'mccarthy', 2018, 1, 12),
		...spell('GB', 'philbin', 2018, 13, 4),
		...spell('GB', 'lafleur', 2019, 1, 17),
	]
	assert.deepEqual([...markInterim(rows)], ['philbin'])
})

test('somebody who took over mid-season and kept the job is NOT an interim', () => {
	// Jason Garrett took Dallas in November 2010 and held it for nine years.
	// Six more read the same way on the first condition alone — Doug Marrone,
	// Mike Tice, Dave McGinnis, Leslie Frazier, Dick LeBeau, Tom Cable — which
	// is why the second condition exists.
	const rows = [
		...spell('DAL', 'phillips', 2010, 1, 8),
		...spell('DAL', 'garrett', 2010, 9, 8),
		...spell('DAL', 'garrett', 2011, 1, 16),
	]
	assert.deepEqual([...markInterim(rows)], [])
})

test('a coach who opened a season and was then sacked is NOT an interim', () => {
	// The condition the source data gets wrong. `build_coach_tenures.py` flags
	// "at most 60 games, followed by somebody else, in an adjacent season",
	// which describes a coach who was FIRED as well as one who stood in — 24 of
	// the 57 people it flags were permanent head coaches, Marty Schottenheimer
	// and Urban Meyer among them.
	const rows = [
		...spell('ARI', 'wilks', 2018, 1, 16),
		...spell('ARI', 'kingsbury', 2019, 1, 16),
	]
	assert.deepEqual([...markInterim(rows)], [])
})

test('a stand-in in the last season on record is marked, and the limit is stated', () => {
	// There is no following season to check, so the second condition cannot be
	// tested. Marked anyway, and deliberately: somebody who took over mid-season
	// and has not yet opened one IS an interim as things stand, which is what
	// every source says about them at the time. It can turn out wrong — the
	// stand-in gets the job, opens next season, and the mark disappears on the
	// next load — and that is the right direction to be wrong in.
	//
	// The first draft of this test asserted the opposite, cautiously and with no
	// reason behind it. Left as a reversal rather than deleted.
	const rows = [
		...spell('GB', 'mccarthy', 2018, 1, 12),
		...spell('GB', 'philbin', 2018, 13, 4),
	]
	assert.deepEqual([...markInterim(rows)], ['philbin'])
})

test('the answer is per CLUB, and merged across clubs the conservative one wins', () => {
	// Steve Wilks opened 2018 for Arizona and stood in for Carolina in 2022.
	// Both are true. A page about Carolina should say the one that is true
	// there; a page about both should not call a head coach an interim.
	const carolina = [
		...spell('CAR', 'rhule', 2022, 1, 5),
		...spell('CAR', 'wilks', 2022, 6, 12),
		...spell('CAR', 'reich', 2023, 1, 11),
	]
	const arizona = [
		...spell('ARI', 'wilks', 2018, 1, 16),
		...spell('ARI', 'kingsbury', 2019, 1, 16),
	]
	assert.deepEqual([...markInterim(carolina)], ['wilks'])
	assert.deepEqual([...markInterim([...carolina, ...arizona])], [])
})

test('two people covering one gap are both marked', () => {
	// A club can burn through two stand-ins in a season, and a rule that only
	// looks at the person before or after leaves one of them on the page as a
	// coach with a three-game career and no explanation.
	const rows = [
		...spell('CAR', 'rhule', 2022, 1, 5),
		...spell('CAR', 'wilks', 2022, 6, 6),
		...spell('CAR', 'tabor', 2022, 12, 6),
		...spell('CAR', 'canales', 2023, 1, 17),
	]
	assert.deepEqual([...markInterim(rows)].sort(), ['tabor', 'wilks'])
})

test('a row with no date cannot be placed in a season and is ignored', () => {
	// The whole rule is about ordering WITHIN a season, so a row that cannot be
	// ordered must not silently become the opener — which is what it does if it
	// is merely sorted, since undefined compares false both ways and stays put.
	assert.deepEqual([...markInterim([{ leader: 'x', franchise: 'GB', season: '2018' }])], [])
	const withStray = [
		{ leader: 'philbin', name: 'p', franchise: 'GB', season: '2018', result: 'WIN' },
		...spell('GB', 'mccarthy', 2018, 1, 12),
		...spell('GB', 'philbin', 2018, 13, 4),
		...spell('GB', 'lafleur', 2019, 1, 17),
	]
	assert.deepEqual([...markInterim(withStray)], ['philbin'],
		'a dateless row made the stand-in the opener')
})

test('the opener is the first game by DATE, not the first row the query returned', () => {
	// These rows arrive from a query with no ORDER BY on the season, so trusting
	// the order handed over is trusting Postgres to keep a promise it never
	// made.
	const rows = [
		...spell('GB', 'philbin', 2018, 13, 4),
		...spell('GB', 'lafleur', 2019, 1, 17),
		...spell('GB', 'mccarthy', 2018, 1, 12),
	]
	assert.deepEqual([...markInterim(rows)], ['philbin'])
})

test('each club is its own timeline, so one club cannot claim another season opener', () => {
	// Merged into one list, the earliest game of a calendar year wins for every
	// club in it — so a coach who genuinely opened his own club's season reads
	// as a stand-in because somebody else's club started a month earlier.
	const early = [
		...spell('CHI', 'alpha', 2018, 1, 4),
	]
	const late = [
		// Beta opens Green Bay's season, a fortnight after Chicago's, and that
		// is the only season Green Bay has on record. Give beta a second season
		// and the mutant passes anyway, because opening THAT one clears them —
		// which is how the first version of this test failed to catch it.
		...spell('GB', 'beta', 2018, 15, 4),
	]
	assert.deepEqual([...markInterim([...early, ...late])], [])
})

// ---------------------------------------------------------------------------
// Through the tallies
// ---------------------------------------------------------------------------

const ROWS = [
	...spell('GB', 'mccarthy', 2018, 1, 12),
	...spell('GB', 'philbin', 2018, 13, 4),
	...spell('GB', 'lafleur', 2019, 1, 17),
]

test('the flag reaches the tallied record', () => {
	const by = new Map(tallyLeaders(ROWS).map((r) => [r.leader, r.interim]))
	assert.equal(by.get('philbin'), true)
	assert.equal(by.get('mccarthy'), false)
})

test('a stated tenure carries the curated column', () => {
	// FALSE on all 382 rows of data/reference/nfl-coaches.csv today, so this
	// changes nothing yet and is wired so that the day those rows are filled the
	// page changes without another commit.
	const [row] = tallyTenures([{
		leader: 'devore', name: 'Hugh Devore', franchise: 'GB',
		firstSeason: 1953, lastSeason: 1953, w: 0, l: 2, t: 0, interim: true,
	}])
	assert.equal(row.interim, true)
})

test('merging the two eras keeps the conservative answer', () => {
	// AND, not OR. A coach whose career straddles 1999 is one row, and standing
	// in for three games in one era does not make a twenty-three-season career
	// an interim spell.
	const counted = tallyLeaders([
		...spell('ATL', 'reeves', 2003, 1, 10),
		...spell('ATL', 'phillips', 2003, 11, 3),
		...spell('ATL', 'mora', 2004, 1, 16),
	])
	const stated = tallyTenures([{
		leader: 'reeves', name: 'Dan Reeves', franchise: 'DEN',
		firstSeason: 1981, lastSeason: 1992, w: 110, l: 73, t: 1, interim: false,
	}])
	const by = new Map(mergeLeaders(counted, stated).map((r) => [r.leader, r.interim]))
	assert.equal(by.get('reeves'), false)
	assert.equal(by.get('phillips'), true)

	// The case that makes it AND rather than OR: the counted era says stand-in
	// and the stated era says head coach. OR would call a twenty-three-season
	// career an interim on the strength of three games.
	const stoodIn = tallyLeaders([
		...spell('ATL', 'reeves', 2003, 1, 10),
		...spell('ATL', 'phillips', 2003, 11, 3),
		...spell('ATL', 'mora', 2004, 1, 16),
	]).filter((r) => r.leader === 'phillips')
	const wasBoss = tallyTenures([{
		leader: 'phillips', name: 'Wade Phillips', franchise: 'BUF',
		firstSeason: 1998, lastSeason: 1999, w: 29, l: 19, t: 0, interim: false,
	}])
	assert.equal(mergeLeaders(stoodIn, wasBoss)[0].interim, false)
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const leaders = [
	{ name: 'Mike McCarthy', leader: 'mccarthy', firstSeason: 2006, lastSeason: 2018, w: 125, l: 77, t: 2, winPct: 0.617, playoffW: 10, playoffL: 8, titles: [], basis: 'counted', interim: false },
	{ name: 'Joe Philbin', leader: 'philbin', firstSeason: 2018, lastSeason: 2018, w: 2, l: 2, t: 0, winPct: 0.5, playoffW: 0, playoffL: 0, titles: [], basis: 'counted', interim: true },
]
const render = (over = {}) => leadersPage({
	team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
	leaders, base: '/nfl/packers', ...over,
})

test('an interim is marked in the table, with the word for anyone who cannot read a star', () => {
	// Both sites use an asterisk with a title. A separate column was the
	// alternative and is a column of blanks: 1 of 17 rows for the Packers.
	const html = render()
	assert.match(html, /<b>Joe Philbin<\/b><span class="interim" title="Interim">\*<\/span>/)
	assert.ok(!/<b>Mike McCarthy<\/b><span class="interim"/.test(html))
})

test('the headline count excludes interims and says that it does', () => {
	// How both sites report it, and how a club counts its own: Green Bay's
	// fifteenth head coach is Matt LaFleur whether or not somebody stood in
	// along the way. Printing the total makes the page disagree with the club;
	// printing the smaller number with nothing to explain it makes the page
	// disagree with its own table.
	assert.match(render(), /1 coaches <span class="dim">plus 1 interim<\/span>/)
})

test('a club with no interim on record says nothing about them', () => {
	// Against the MARKUP, not against the page. The stylesheet is inlined, so
	// the class name appears in every rendering whether a row wears it or not —
	// second time that has caught a test here, after the record-card focus ring.
	const html = render({ leaders: [leaders[0]] })
	assert.ok(!html.includes('class="interim"'), 'a row is marked where none should be')
	assert.ok(!/plus \d+ interim/.test(html), 'the count offers an interim tally with nothing in it')
	assert.match(html, /1 coaches,/)
})

test('the page can carry more than one limit, and skips the ones that do not apply', () => {
	// Two different gaps: the leaders starting later than the games, and interim
	// being answerable only where there are per-game records. A single `note`
	// string could hold one of them.
	const html = render({ notes: ['Games are on record from 1921.', null, 'Interim coaches are marked from 1999.'] })
	assert.match(html, /Games are on record from 1921\./)
	assert.match(html, /Interim coaches are marked from 1999\./)
	assert.equal([...html.matchAll(/<p class="dim">/g)].length, 2)
})
