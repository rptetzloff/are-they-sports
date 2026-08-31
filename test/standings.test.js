import test from 'node:test'
import assert from 'node:assert/strict'
import { computeStandings, gamesBack, playedSeasons } from '../lib/standings.js'

// Where every club finished, for a season. Computed from games rather than
// fetched, so a season from 1962 works exactly as one being played does.

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

const entry = (club, conference, division, pattern, over = {}) => ({
	conference,
	division,
	team: { id: club.toLowerCase(), sport: 'nfl', nouns: { team: club, fullName: club } },
	rows: pattern.split('').map((c, i) => ({
		result: RESULTS[c] ?? '',
		date: `2011-09-${String(i + 1).padStart(2, '0')}`,
		season: '2011',
		regular_season: '1',
		scoreFor: '20',
		scoreAgainst: '10',
		...over,
	})),
})

test('clubs are ordered by percentage, best first', () => {
	const s = computeStandings([
		entry('Bills', 'AFC', 'East', 'LLLLLLW'),
		entry('Patriots', 'AFC', 'East', 'WWWWWWL'),
		entry('Jets', 'AFC', 'East', 'WWWLLLL'),
	], { season: 2011 })
	assert.deepEqual(s.groups[0].clubs.map((c) => c.club), ['Patriots', 'Jets', 'Bills'])
})

test('games back is half the win gap plus the loss gap', () => {
	// The number people actually want: a club level on percentage but with fewer
	// games played is still half a game back.
	const s = computeStandings([
		entry('Patriots', 'AFC', 'East', 'WWWWWWWWWWWWWLLL'),
		entry('Jets', 'AFC', 'East', 'WWWWWWWWLLLLLLLL'),
	], { season: 2011 })
	const [lead, second] = s.groups[0].clubs
	assert.equal(lead.gb, 0)
	// 13-3 against 8-8: five wins and five losses apart, so five games back.
	assert.equal(second.gb, 5)
})

test('games back uses both gaps, which matters mid-season', () => {
	// With both clubs on the same number of games the win gap and the loss gap
	// are equal, so halving their sum is the same as taking either — and a
	// mutant dropping the loss gap survived a fixture where every club had
	// played sixteen.
	//
	// Unequal games played is the case games-back exists for. 10-2 against 8-6
	// is two wins and four losses apart: three games, not two.
	const s = computeStandings([
		entry('Brewers', 'NL', 'Central', 'WWWWWWWWWWLL'),
		entry('Cubs', 'NL', 'Central', 'WWWWWWWWLLLLLL'),
	], { season: 2011 })
	const [lead, second] = s.groups[0].clubs
	assert.equal(lead.record, '10–2')
	assert.equal(second.record, '8–6')
	assert.equal(second.gb, 3)
})

test('a club level on percentage but with games in hand is half a game back', () => {
	// 2-1 against 4-2 is the same .667, and the shorter club is half a game
	// behind — which is the number a standings page is for.
	const s = computeStandings([
		entry('Reds', 'NL', 'Central', 'WWWWLL'),
		entry('Pirates', 'NL', 'Central', 'WWL'),
	], { season: 2011 })
	const byClub = new Map(s.groups[0].clubs.map((c) => [c.club, c]))
	assert.equal(byClub.get('Reds').gb, 0)
	assert.equal(byClub.get('Pirates').gb, 0.5)
})

test('the leader is never behind itself', () => {
	const s = computeStandings([entry('Bears', 'NFC', 'North', 'LLLL')], { season: 2011 })
	assert.equal(s.groups[0].clubs[0].gb, 0)
	assert.equal(gamesBack(0), '—')
})

test('half games are shown, whole ones are not padded', () => {
	assert.equal(gamesBack(0.5), '0.5')
	assert.equal(gamesBack(5), '5')
	assert.equal(gamesBack(17.5), '17.5')
	assert.equal(gamesBack(0), '—')
})

test('ties count half, as everywhere else', () => {
	const s = computeStandings([entry('Packers', 'NFC', 'North', 'WWTL')], { season: 2011 })
	const [gb] = s.groups[0].clubs
	assert.equal(gb.record, '2–1–1')
	assert.equal(gb.pct, (2 + 0.5) / 4)
})

// --- what does not count ---

test('the postseason is not in the standings', () => {
	// A club that went 13-3 and won three playoff games did not finish 16-3, and
	// no standings table has ever said so.
	const e = entry('Packers', 'NFC', 'North', 'WWWL')
	e.rows.push({ ...e.rows[0], regular_season: '0', playoff: '1', result: 'WIN', date: '2012-01-15' })
	const s = computeStandings([e], { season: 2011 })
	assert.equal(s.groups[0].clubs[0].record, '3–1')
})

test('an unplayed game is not a loss', () => {
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], result: '', scoreFor: '', scoreAgainst: '', date: '2011-12-01' })
	assert.equal(computeStandings([e], { season: 2011 }).groups[0].clubs[0].record, '3–0')
})

test('another season is not in this one', () => {
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], season: '2010', result: 'LOSS' })
	assert.equal(computeStandings([e], { season: 2011 }).groups[0].clubs[0].record, '3–0')
})

test('a club that did not play that season is absent, not shown at 0-0', () => {
	// The Texans did not exist in 1961. A row of zeroes would read as a club that
	// lost nothing rather than one that was not there.
	const s = computeStandings([
		entry('Packers', 'NFC', 'North', 'WWW'),
		entry('Texans', 'AFC', 'South', ''),
	], { season: 2011 })
	assert.equal(s.clubs, 1)
	assert.deepEqual(s.groups.map((g) => g.division), ['North'])
})

test('a club with no manifest is skipped rather than throwing', () => {
	const s = computeStandings([{ conference: 'NFC', division: 'North', team: undefined, rows: [] }], { season: 2011 })
	assert.equal(s.clubs, 0)
	assert.deepEqual(s.groups, [])
})

// --- grouping ---

test('clubs are grouped conference then division', () => {
	const s = computeStandings([
		entry('Packers', 'NFC', 'North', 'WWW'),
		entry('Bears', 'NFC', 'North', 'LLL'),
		entry('Patriots', 'AFC', 'East', 'WWW'),
	], { season: 2011 })
	assert.equal(s.groups.length, 2)
	const north = s.groups.find((g) => g.division === 'North')
	assert.equal(north.conference, 'NFC')
	assert.deepEqual(north.clubs.map((c) => c.club), ['Packers', 'Bears'])
})

test('two conferences sharing a division name are two tables', () => {
	// AFC North and NFC North are different divisions; so are AL and NL Central.
	// Keying the group on the division alone merges eight clubs into one table
	// and computes games-back across both — and passes a test that groups North
	// against East, because those names do not collide.
	const s = computeStandings([
		entry('Packers', 'NFC', 'North', 'WWWW'),
		entry('Ravens', 'AFC', 'North', 'WWWL'),
		entry('Bears', 'NFC', 'North', 'LLLL'),
	], { season: 2011 })
	assert.equal(s.groups.length, 2)
	const afc = s.groups.find((g) => g.conference === 'AFC')
	const nfc = s.groups.find((g) => g.conference === 'NFC')
	assert.deepEqual(afc.clubs.map((c) => c.club), ['Ravens'])
	assert.deepEqual(nfc.clubs.map((c) => c.club), ['Packers', 'Bears'])
	// And each leads its own division: the 3-1 Ravens are not a game back of a
	// club they never played.
	assert.equal(afc.clubs[0].gb, 0)
	assert.equal(nfc.clubs[0].gb, 0)
})

test('games back is per division, not across the league', () => {
	// A club leading a weak division is not behind the best team in the league.
	const s = computeStandings([
		entry('Patriots', 'AFC', 'East', 'WWWWWWWWWWWWWLLL'),
		entry('Bears', 'NFC', 'North', 'WWWWWWWWLLLLLLLL'),
	], { season: 2011 })
	for (const g of s.groups) assert.equal(g.clubs[0].gb, 0)
})

test('with no season named, every season counts as one', () => {
	// Used by nothing today, and the behaviour should be predictable rather than
	// accidental: a null season means "do not filter".
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], season: '2010', result: 'LOSS' })
	assert.equal(computeStandings([e]).groups[0].clubs[0].record, '3–1')
})

// --- which season is "current" ---

test('a season with only scheduled games is not one that was played', () => {
	// The 2026 fixtures were in the database in August 2026, months before a snap.
	// Defaulting to the latest season WITH ROWS headed the page "NFL 2026" over
	// "no games on record" — a season every visitor would read as current.
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], season: '2026', result: '', scoreFor: '', scoreAgainst: '' })
	assert.deepEqual(playedSeasons([e]), [2011])
})

test('played seasons are every season with a result, oldest first', () => {
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], season: '2009', result: 'LOSS' })
	e.rows.push({ ...e.rows[0], season: '2010', result: 'WIN' })
	assert.deepEqual(playedSeasons([e]), [2009, 2010, 2011])
})

test('a playoff run is not a season of its own', () => {
	// A club whose only 2012 row is a January playoff game did not play a 2012
	// season, and the nav must not offer one.
	const e = entry('Packers', 'NFC', 'North', 'WWW')
	e.rows.push({ ...e.rows[0], season: '2012', regular_season: '0', result: 'WIN' })
	assert.deepEqual(playedSeasons([e]), [2011])
})

test('played seasons survives clubs with no rows at all', () => {
	assert.deepEqual(playedSeasons([{ rows: [] }, {}]), [])
	assert.deepEqual(playedSeasons(undefined), [])
})
