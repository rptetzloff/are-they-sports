import test from 'node:test'
import assert from 'node:assert/strict'
import { gameRow, isScoringPlay, scoringRow, seedGameRow, sources } from '../sports/nfl.js'

// The NFL adapter: two sources with different shapes, both producing the row
// the core reads.

const sched = (over = {}) => ({
	game_id: '2024_01_GB_PHI', season: '2024', game_type: 'REG', gameday: '2024-09-06',
	away_team: 'GB', away_score: '29', home_team: 'PHI', home_score: '34', ...over,
})

test('the away team sees its own score as scoreFor', () => {
	const r = gameRow(sched(), 'GB')
	assert.equal(r.scoreFor, '29')
	assert.equal(r.scoreAgainst, '34')
	assert.equal(r.result, 'LOSS')
	assert.equal(r.location, 'away')
	assert.equal(r.Opponent, 'PHI')
})

test('the home team sees the same game the other way round', () => {
	const r = gameRow(sched(), 'PHI')
	assert.equal(r.scoreFor, '34')
	assert.equal(r.result, 'WIN')
	assert.equal(r.location, 'home')
	assert.equal(r.Opponent, 'GB')
})

test('a team that was not playing gets nothing', () => {
	// One league-wide file serves all 32 clubs, so this is the filter.
	assert.equal(gameRow(sched(), 'CHI'), null)
})

test('an equal score is a tie, not a win', () => {
	assert.equal(gameRow(sched({ away_score: '20', home_score: '20' }), 'GB').result, 'TIE')
})

test('an unplayed game is kept, with no result', () => {
	// Scheduled fixtures have empty scores. They are kept so a schedule can show
	// them; every compute function filters on result rather than assuming rows
	// are complete.
	const r = gameRow(sched({ away_score: '', home_score: '' }), 'GB')
	assert.equal(r.result, '')
	assert.equal(r.date, '2024-09-06')
})

test('regular season and postseason are distinguished', () => {
	assert.equal(gameRow(sched({ game_type: 'REG' }), 'GB').regular_season, '1')
	assert.equal(gameRow(sched({ game_type: 'REG' }), 'GB').playoff, '0')
	assert.equal(gameRow(sched({ game_type: 'DIV' }), 'GB').regular_season, '0')
	assert.equal(gameRow(sched({ game_type: 'DIV' }), 'GB').playoff, '1')
})

test('only the Super Bowl sets the championship field', () => {
	// The tally reads this as "more championship-round wins than losses", which
	// for a one-game final is simply whether it was won. A conference final must
	// not set it.
	assert.equal(gameRow(sched({ game_type: 'CON' }), 'GB').championship, '')
	assert.equal(gameRow(sched({ game_type: 'SB', season: '2010' }), 'GB').championship, '2010')
})

// --- the FiveThirtyEight seed, which has a different shape entirely ---

const seed = (over = {}) => ({
	date: '1967-01-01', season: '1966', neutral: '0', playoff: '',
	team1: 'GB', team2: 'DAL', score1: '34', score2: '27', ...over,
})

test('team1 is the home side in the seed file', () => {
	const r = seedGameRow(seed(), 'GB')
	assert.equal(r.location, 'home')
	assert.equal(r.scoreFor, '34')
	assert.equal(r.result, 'WIN')
})

test('a neutral-site game is neither home nor away', () => {
	// Super Bowls are neutral, and calling one a home game would put it in the
	// wrong bucket on every home/away split.
	assert.equal(seedGameRow(seed({ neutral: '1' }), 'GB').location, 'neutral')
})

test('the playoff column is a round code, not a flag', () => {
	assert.equal(seedGameRow(seed({ playoff: '' }), 'GB').regular_season, '1')
	assert.equal(seedGameRow(seed({ playoff: 'c' }), 'GB').playoff, '1')
	assert.equal(seedGameRow(seed({ playoff: 'c' }), 'GB').championship, '')
	assert.equal(seedGameRow(seed({ playoff: 's', season: '1966' }), 'GB').championship, '1966')
})

test('a row with no score is skipped rather than counted as a scoreless draw', () => {
	assert.equal(seedGameRow(seed({ score1: '', score2: '' }), 'GB'), null)
})

test('a genuine 0-0 game is kept', () => {
	// The guard above tests for an empty string, not falsiness — '0' is falsy in
	// the wrong hands and scoreless ties did happen in this era.
	const r = seedGameRow(seed({ score1: '0', score2: '0' }), 'GB')
	assert.equal(r.result, 'TIE')
})

test('the synthesised game id is stable and unique per meeting', () => {
	// The seed file has no game id. Two clubs cannot meet twice on one day, so
	// date plus both codes identifies a game.
	assert.equal(seedGameRow(seed(), 'GB').gid, '1967-01-01-GB-DAL')
	assert.equal(seedGameRow(seed(), 'DAL').gid, '1967-01-01-GB-DAL')
})

test('the two sources are split by season, and the cutoff is declared', () => {
	// nflverse is authoritative from 1999 and refreshed weekly; the seed stopped
	// in 2020 and its publisher no longer exists. Both describe 1999-2020, so
	// the builder takes whole eras rather than merging.
	assert.equal(sources.seedResults.useBefore, 1999)
	assert.equal(sources.playByPlay.firstSeason, 1999)
})

// --- play-by-play ---

test('nflverse flags scoring plays outright', () => {
	assert.equal(isScoringPlay({ sp: '1' }), true)
	assert.equal(isScoringPlay({ sp: '0' }), false)
	assert.equal(isScoringPlay({}), false)
})

test('a scoring play keeps only what a page shows', () => {
	// 372 columns in, seven out. This is where the reduction happens —
	// compression only pays back the JSON verbosity afterwards.
	const r = scoringRow({
		game_id: 'G1', qtr: '2', time: '3:41', desc: 'A.Rodgers 8 yd TD pass',
		total_home_score: '7', total_away_score: '14', posteam: 'GB', extra: 'dropped',
	})
	assert.deepEqual(Object.keys(r).sort(), ['clock', 'desc', 'gid', 'period', 'scoreAway', 'scoreHome', 'team'])
	assert.equal(r.desc, 'A.Rodgers 8 yd TD pass')
})

test('a half-recorded row is skipped, not called a tie', () => {
	// The guard used to check score1 only. With score2 missing, scoreAgainst
	// parsed to NaN, every comparison against NaN is false, and the result
	// ternary fell through to its last branch — so a 34-to-nothing game was
	// reported as a TIE, with a scoreAgainst of ''.
	assert.equal(seedGameRow(seed({ score2: '' }), 'GB'), null)
	assert.equal(seedGameRow(seed({ score1: '' }), 'GB'), null)
})

test('no seed row ever yields a NaN score', () => {
	// The general form of the same bug: whatever survives the guard has to be
	// two numbers, because everything downstream compares them.
	for (const over of [{}, { score1: '0', score2: '0' }, { neutral: '1' }, { playoff: 's' }]) {
		const r = seedGameRow(seed(over), 'GB')
		if (!r) continue
		assert.ok(Number.isFinite(parseInt(r.scoreFor, 10)), `scoreFor NaN for ${JSON.stringify(over)}`)
		assert.ok(Number.isFinite(parseInt(r.scoreAgainst, 10)), `scoreAgainst NaN for ${JSON.stringify(over)}`)
	}
})
