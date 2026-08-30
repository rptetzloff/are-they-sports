import test from 'node:test'
import assert from 'node:assert/strict'
import { computeHeadToHead, streakSentence } from '../lib/headtohead.js'
import { loadIndex } from '../lib/indices.js'

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

const vs = (opponent, pattern, { year = 2000, playoff = false } = {}) =>
	pattern.split('').map((c, i) => ({
		result: RESULTS[c],
		date: `${year + i}-09-01`,
		season: String(year + i),
		regular_season: playoff ? '0' : '1',
		Opponent: opponent,
		scoreFor: '20',
		scoreAgainst: '10',
	}))

test('one entry per opponent, most-played first', () => {
	const { opponents } = computeHeadToHead([...vs('CHI', 'WWWW'), ...vs('MIN', 'WL')])
	assert.deepEqual(opponents.map((o) => o.code), ['CHI', 'MIN'])
	assert.equal(opponents[0].games, 4)
})

test('a record counts wins, losses and ties, with ties half in the percentage', () => {
	const [o] = computeHeadToHead(vs('CHI', 'WWLT')).opponents
	assert.equal(o.record, '2–1–1')
	assert.equal(o.winPct, (2 + 0.5) / 4)
})

test('the postseason is counted separately, and is null when there is none', () => {
	const withPost = computeHeadToHead([
		...vs('CHI', 'WW'),
		...vs('CHI', 'L', { year: 2010, playoff: true }),
	]).opponents[0]
	assert.equal(withPost.record, '2–1')
	assert.equal(withPost.playoffRecord, '0–1')

	// Not "0–0", which reads as a postseason that happened and went nowhere.
	assert.equal(computeHeadToHead(vs('CHI', 'WW')).opponents[0].playoffRecord, null)
})

test('the streak is the current run, however it is going', () => {
	assert.deepEqual(computeHeadToHead(vs('CHI', 'WWLLL')).opponents[0].streak, { result: 'LOSS', count: 3 })
	assert.deepEqual(computeHeadToHead(vs('CHI', 'LLWW')).opponents[0].streak, { result: 'WIN', count: 2 })
})

test('a run of one says what the last meeting was', () => {
	// "Won 1 straight" reads badly.
	assert.equal(streakSentence({ result: 'WIN', count: 1 }), 'Won the last meeting')
	assert.equal(streakSentence({ result: 'WIN', count: 4 }), 'Won 4 straight')
	assert.equal(streakSentence({ result: 'TIE', count: 1 }), 'Tied the last meeting')
})

test('the biggest win and the worst loss are by margin', () => {
	const rows = [
		{ ...vs('CHI', 'W')[0], scoreFor: '30', scoreAgainst: '28' },
		{ ...vs('CHI', 'W')[0], date: '2001-09-01', season: '2001', scoreFor: '49', scoreAgainst: '0' },
		{ ...vs('CHI', 'L')[0], date: '2002-09-01', season: '2002', scoreFor: '3', scoreAgainst: '40' },
		{ ...vs('CHI', 'L')[0], date: '2003-09-01', season: '2003', scoreFor: '20', scoreAgainst: '21' },
	]
	const [o] = computeHeadToHead(rows).opponents
	assert.equal(o.biggestWin.season, 2001)
	assert.equal(o.worstLoss.season, 2002)
})

test('an opponent never beaten has no biggest win, rather than a fake one', () => {
	const [o] = computeHeadToHead(vs('CHI', 'LL')).opponents
	assert.equal(o.biggestWin, null)
	assert.ok(o.worstLoss)
})

test('unplayed games are not meetings', () => {
	const rows = [...vs('CHI', 'WW'), { ...vs('CHI', 'W')[0], result: '', date: '2030-09-01' }]
	assert.equal(computeHeadToHead(rows).opponents[0].games, 2)
})

test('a row with no opponent is skipped rather than grouped under nothing', () => {
	const rows = [...vs('CHI', 'W'), { ...vs('CHI', 'W')[0], Opponent: '' }]
	const { opponents } = computeHeadToHead(rows)
	assert.equal(opponents.length, 1)
	assert.equal(opponents[0].code, 'CHI')
})

test('the slug is the franchise code, so a URL survives a rename', () => {
	// The site slugified display names, which meant an opponent's URL changed
	// when the club moved city. The code does not move.
	assert.equal(computeHeadToHead(vs('CHI', 'W')).opponents[0].slug, 'chi')
	assert.ok(computeHeadToHead(vs('CHI', 'W')).bySlug.has('chi'))
})

test('meetings come back in order, oldest first', () => {
	const [o] = computeHeadToHead(vs('CHI', 'WLW')).opponents
	assert.deepEqual(o.meetings.map((m) => m.season), [2000, 2001, 2002])
	assert.equal(o.first.season, 2000)
	assert.equal(o.last.season, 2002)
})

test('the Packers head-to-head matches what is known about it', () => {
	// Bears 213 meetings at 109–98–6 is the number the cross-index check
	// produces from two separately built indices.
	const { opponents, bySlug } = computeHeadToHead(loadIndex('packers', 'games').entries)
	assert.equal(opponents[0].code, 'CHI')
	assert.equal(opponents[0].games, 213)
	assert.equal(opponents[0].record, '109–98–6')
	assert.equal(bySlug.get('det').games, 193)
	assert.ok(opponents.length > 55, `only ${opponents.length} opponents`)
	// Every meeting of every opponent adds up to every game played.
	const played = loadIndex('packers', 'games').entries.filter((g) => g.result).length
	assert.equal(opponents.reduce((n, o) => n + o.games, 0), played)
})
