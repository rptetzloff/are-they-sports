import test from 'node:test'
import assert from 'node:assert/strict'
import { gameRow, isoDate, isScoringPlay, scoringRow, sources } from '../sports/mlb.js'

// The MLB adapter. The second sport is the one that tests whether the seam is
// real, so these tests are written to fail if the row shape drifts apart from
// football's rather than only if baseball breaks.

const info = (over = {}) => ({
	gid: 'MIL198210120', date: '19821012', season: '1982', gametype: 'regular',
	visteam: 'SLN', hometeam: 'MIL', vruns: '3', hruns: '5', ...over,
})

test('Retrosheet dates become ISO', () => {
	// Everything downstream compares and sorts dates as strings, so 19821012 and
	// 1982-10-12 cannot both be in circulation.
	assert.equal(isoDate('19821012'), '1982-10-12')
	assert.equal(isoDate(19821012), '1982-10-12')
})

test('anything not eight digits is passed through untouched', () => {
	// A date that is already ISO must not be re-sliced into nonsense.
	assert.equal(isoDate('1982-10-12'), '1982-10-12')
	assert.equal(isoDate(''), '')
})

test('the home club sees its own runs as scoreFor', () => {
	const r = gameRow(info(), 'MIL')
	assert.equal(r.scoreFor, '5')
	assert.equal(r.scoreAgainst, '3')
	assert.equal(r.result, 'WIN')
	assert.equal(r.location, 'home')
	assert.equal(r.Opponent, 'SLN')
	assert.equal(r.date, '1982-10-12')
})

test('the visiting club sees the same game inverted', () => {
	const r = gameRow(info(), 'SLN')
	assert.equal(r.scoreFor, '3')
	assert.equal(r.result, 'LOSS')
	assert.equal(r.location, 'away')
})

test('a club that was not playing gets nothing', () => {
	assert.equal(gameRow(info(), 'CHN'), null)
})

test('the Seattle Pilots season resolves under its own code', () => {
	// The franchise spent 1969 in Seattle, which is why a team manifest carries
	// a list of source ids rather than one string. The adapter knows nothing
	// about that; it just answers per code.
	const r = gameRow(info({ season: '1969', hometeam: 'SE1' }), 'SE1')
	assert.equal(r.location, 'home')
	assert.equal(r.Opponent, 'SLN')
})

test('an unplayed game is kept with no result', () => {
	assert.equal(gameRow(info({ vruns: '', hruns: '' }), 'MIL').result, '')
})

test('gametype words map to the same two flags football uses', () => {
	assert.equal(gameRow(info({ gametype: 'regular' }), 'MIL').regular_season, '1')
	assert.equal(gameRow(info({ gametype: 'regular' }), 'MIL').playoff, '0')
	assert.equal(gameRow(info({ gametype: 'divisionseries' }), 'MIL').regular_season, '0')
	assert.equal(gameRow(info({ gametype: 'divisionseries' }), 'MIL').playoff, '1')
})

test('only the World Series sets the championship field', () => {
	// A best-of-seven, so the field marks the round and the tally decides the
	// title by wins against losses within it. An LCS game must not set it, or a
	// pennant becomes a championship.
	assert.equal(gameRow(info({ gametype: 'lcs' }), 'MIL').championship, '')
	assert.equal(gameRow(info({ gametype: 'wildcard' }), 'MIL').championship, '')
	assert.equal(gameRow(info({ gametype: 'worldseries' }), 'MIL').championship, '1982')
})

test('a World Series loss still marks the round', () => {
	// The round is a fact about the game; who won is decided by counting. If
	// this field were set only on wins, the series rule would have nothing to
	// count against.
	const r = gameRow(info({ gametype: 'worldseries', vruns: '9', hruns: '1' }), 'MIL')
	assert.equal(r.championship, '1982')
	assert.equal(r.result, 'LOSS')
})

test('the row shape is the same one football produces', () => {
	// The whole seam. If either adapter grows or loses a key, downstream code
	// that never learns which league it is reading will start seeing undefined —
	// which is exactly the failure the football site shipped for months.
	assert.deepEqual(Object.keys(gameRow(info(), 'MIL')).sort(), [
		'Opponent', 'championship', 'date', 'gid', 'location',
		'playoff', 'regular_season', 'result', 'scoreAgainst', 'scoreFor', 'season',
		// Baseball has no weeks and says so with null. The key exists because
		// the shape is the seam: a key present in one sport and absent in the
		// other is how downstream code starts reading undefined.
		'week',
	])
})

// --- play-by-play ---

test('a play scored if its runs column is non-zero', () => {
	// Pure, exactly like football's. An earlier draft of the adapter claimed
	// baseball needed the previous row's running score and built a seam argument
	// on it; the column was guessed rather than read.
	assert.equal(isScoringPlay({ runs: '2' }), true)
	assert.equal(isScoringPlay({ runs: '0' }), false)
	assert.equal(isScoringPlay({ runs: '' }), false)
})

test('a scoring play keeps the score before it, not after', () => {
	// So a reader can render the running score without recomputing, and so the
	// play reads the way a box score does.
	const r = scoringRow({
		gid: 'MIL198210120', inning: '4', top_bot: '1', batteam: 'MIL',
		batter: ' yountr001 ', pitcher: 'sutts101', runs: '2',
		score_v: '0', score_h: '3', junk: 'dropped',
	})
	assert.equal(r.top, false)
	assert.equal(r.batter, 'yountr001')
	assert.equal(r.runs, 2)
	assert.equal(r.preH, 3)
	assert.equal(r.preV, 0)
})

test('top_bot is zero for the top of the inning', () => {
	assert.equal(scoringRow({ top_bot: '0', runs: '1', score_v: '0', score_h: '0' }).top, true)
})

test('runs and scores come out as numbers, not strings', () => {
	// They are summed and compared downstream, and '3' + '2' is '32'.
	const r = scoringRow({ runs: '2', score_v: '1', score_h: '3', top_bot: '0' })
	assert.equal(typeof r.runs, 'number')
	assert.equal(typeof r.preV, 'number')
	assert.equal(typeof r.preH, 'number')
})

test('there is no pre-coverage era to fill', () => {
	// Retrosheet covers the franchise's whole existence, so unlike football
	// there is no seed source. The builder already treats one as optional.
	assert.equal(sources.seedResults, undefined)
	assert.equal(sources.playByPlay.firstSeason, 1969)
})
