import test from 'node:test'
import assert from 'node:assert/strict'
import { daysToNextGame, latestSeason, recordText, seasonTally, seasonVerdict, verdictText } from '../lib/core.js'
import { loadIndex } from '../lib/indices.js'
import { loadTeam } from '../lib/teams.js'

// Resolved against their sports, which is the shape everything actually uses.
const packers = await loadTeam('packers')
const brewers = await loadTeam('brewers')

// The record core, ported from the two sites. Rows in, numbers out.

const g = (over = {}) => ({
	season: '2024', regular_season: '1', playoff: '0', championship: '', result: 'WIN', ...over,
})
const post = (over = {}) => g({ regular_season: '0', playoff: '1', ...over })

test('regular season results are counted separately from the postseason', () => {
	const t = seasonTally([g(), g(), g({ result: 'LOSS' }), post(), post({ result: 'LOSS' })], packers)
	assert.equal(t.wins, 2)
	assert.equal(t.losses, 1)
	assert.deepEqual(t.postseason, { w: 1, l: 1, t: 0 })
})

test('a postseason of ties alone does not count as one', () => {
	// Preserved from the site's inline version rather than tidied. The only rows
	// that could produce it are unplayed or malformed, and showing "0-0-1" for
	// them would be worse than showing nothing.
	assert.equal(seasonTally([g(), post({ result: 'TIE' })], packers).postseason, null)
})

test('no postseason games means no postseason line at all', () => {
	assert.equal(seasonTally([g(), g()], packers).postseason, null)
})

test('a championship is decided by wins against losses within the round', () => {
	// The series rule. Right for a best-of-seven and right for a one-game final,
	// which is exactly why both sports can share it.
	const won = seasonTally([
		post({ championship: '1982', result: 'WIN' }), post({ championship: '1982', result: 'WIN' }),
		post({ championship: '1982', result: 'WIN' }), post({ championship: '1982', result: 'WIN' }),
		post({ championship: '1982', result: 'LOSS' }), post({ championship: '1982', result: 'LOSS' }),
		post({ championship: '1982', result: 'LOSS' }),
	], brewers)
	assert.equal(won.championshipName, 'World Series 1982')
})

test('losing the series is not winning it', () => {
	const lost = seasonTally([
		post({ championship: '1982', result: 'WIN' }), post({ championship: '1982', result: 'WIN' }),
		post({ championship: '1982', result: 'WIN' }), post({ championship: '1982', result: 'LOSS' }),
		post({ championship: '1982', result: 'LOSS' }), post({ championship: '1982', result: 'LOSS' }),
		post({ championship: '1982', result: 'LOSS' }),
	], brewers)
	assert.equal(lost.championshipName, null)
})

test('a one-game final works under the same rule', () => {
	assert.equal(seasonTally([post({ championship: '2010', result: 'WIN' })], packers).championshipName,
		'Super Bowl 2010')
	assert.equal(seasonTally([post({ championship: '2010', result: 'LOSS' })], packers).championshipName, null)
})

test('the championship is named in the club\'s own vocabulary', () => {
	// Not one phrase with a noun swapped — the manifest carries the whole name.
	assert.match(seasonTally([post({ championship: '2010' })], packers).championshipName, /^Super Bowl/)
	assert.match(seasonTally([post({ championship: '1982' })], brewers).championshipName, /^World Series/)
})

test('undefeated so far is not the same as a finished perfect season', () => {
	// A team can be answering yes to this in October. Merging it with the
	// records page's notion would either announce a finished perfect season in
	// week three, or refuse to call a team undefeated while it is.
	assert.equal(seasonTally([g(), g(), g()], packers).undefeated, true)
	assert.equal(seasonTally([g(), g({ result: 'LOSS' })], packers).undefeated, false)
})

test('a season with no wins is not undefeated', () => {
	// The guard that stops an empty season claiming one.
	assert.equal(seasonTally([], packers).undefeated, false)
	assert.equal(seasonTally([g({ result: 'TIE' })], packers).undefeated, false)
})

test('a season with ties and no losses is still undefeated', () => {
	// 1929 went 12-0-1. Undefeated, not perfect — the site is named for the
	// distinction.
	const t = seasonTally([g(), g(), g({ result: 'TIE' })], packers)
	assert.equal(t.undefeated, true)
	assert.equal(recordText(t), '2-0-1')
})

// --- the verdict ---

test('a season that has not started gets its own answer', () => {
	// It used to be NO. The site told a team that had not lost a game that it
	// was not undefeated, because only two answers existed.
	assert.equal(seasonVerdict({ wins: 0, losses: 0, daysToNextGame: 3 }), 'not-started')
	assert.equal(verdictText('not-started', packers), 'GO PACK GO')
	assert.equal(verdictText('not-started', brewers), 'GO BREW CREW')
})

test('the deep offseason is a different answer from the week before the opener', () => {
	// Four states, not three. The football site says OFFSEASON in August and
	// GO PACK GO once a game is close, and collapsing them made this repo
	// answer GO PACK GO on a day the live site said OFFSEASON.
	assert.equal(seasonVerdict({ wins: 0, losses: 0, daysToNextGame: 60 }), 'offseason')
	assert.equal(seasonVerdict({ wins: 0, losses: 0, daysToNextGame: null }), 'offseason')
	assert.equal(seasonVerdict({ wins: 0, losses: 0, daysToNextGame: 30 }), 'not-started')
	assert.equal(verdictText('offseason', packers), 'OFFSEASON')
	// Not vocabulary: both sites say the same word, and it is not a cheer.
	assert.equal(verdictText('offseason', brewers), 'OFFSEASON')
})

test('days to the next game is measured from a given date, not the clock', () => {
	const rows = [
		{ result: 'WIN', date: '2026-01-01' },
		{ result: '', date: '2026-09-13' },
		{ result: '', date: '2026-09-20' },
	]
	assert.equal(daysToNextGame(rows, new Date('2026-08-29T00:00:00Z')), 15)
	// A club with nothing left to play has no next game, which is the deep
	// offseason rather than a season about to start.
	assert.equal(daysToNextGame([{ result: 'WIN', date: '2026-01-01' }], new Date('2026-08-29T00:00:00Z')), null)
})

test('an unplayed game in the past is not the next game', () => {
	// A postponed or abandoned fixture keeps its original date and never gets a
	// result. Without the date filter it becomes "the next game", forever, and
	// the club never reaches its offseason again.
	const rows = [
		{ result: '', date: '2026-03-01' },
		{ result: '', date: '2026-09-13' },
	]
	assert.equal(daysToNextGame(rows, new Date('2026-08-29T00:00:00Z')), 15)
	// And with only the stale one left, there is no next game at all.
	assert.equal(daysToNextGame([rows[0]], new Date('2026-08-29T00:00:00Z')), null)
})

test('a finished season with no games is a data gap, not a season about to begin', () => {
	// Saying GO PACK GO about 1943 would be strange.
	assert.equal(seasonVerdict({ wins: 0, losses: 0, isPastSeason: true }), 'no')
})

test('no losses and at least one win is yes', () => {
	assert.equal(seasonVerdict({ wins: 3, losses: 0 }), 'undefeated')
	// Three exclamation marks, which is what both sites say.
	assert.equal(verdictText('undefeated', packers), 'YES!!!')
})

test('one loss is no', () => {
	assert.equal(seasonVerdict({ wins: 15, losses: 1 }), 'no')
	assert.equal(verdictText('no', packers), 'NO')
})

test('a season of ties alone has started, so it is not not-started', () => {
	assert.equal(seasonVerdict({ wins: 0, losses: 0, ties: 1 }), 'no')
})

// --- picking the season to show ---

test('the latest season is the newest in the data, not the calendar year', () => {
	// Retrosheet lags, so the newest baseball season here is 2025 while the
	// newest football season is 2026. Anything keyed to today's date would show
	// an empty 2026 for the Brewers.
	const l = latestSeason([g({ season: '2024' }), g({ season: '2026' }), g({ season: '2025' })])
	assert.equal(l.season, '2026')
	assert.equal(l.rows.length, 1)
})

test('a season with games left to play is not past', () => {
	const l = latestSeason([g({ season: '2026', result: '' }), g({ season: '2026', result: 'WIN' })])
	assert.equal(l.isPastSeason, false)
})

test('a season with every game played is past', () => {
	const l = latestSeason([g({ season: '2025' }), g({ season: '2025', result: 'LOSS' })])
	assert.equal(l.isPastSeason, true)
})

test('a season that has not started at all is not past', () => {
	// All scheduled, none played. This is the case the third answer exists for,
	// and calling it past would collapse it back into NO.
	const l = latestSeason([g({ season: '2026', result: '' }), g({ season: '2026', result: '' })])
	assert.equal(l.isPastSeason, false)
	const t = seasonTally(l.rows, packers)
	assert.equal(seasonVerdict({ ...t, isPastSeason: l.isPastSeason, daysToNextGame: 5 }), 'not-started')
})

test('no rows at all is null rather than a crash', () => {
	assert.equal(latestSeason([]), null)
})

test('the record shows ties only when there are some', () => {
	assert.equal(recordText({ wins: 13, losses: 3, ties: 0 }), '13-3')
	assert.equal(recordText({ wins: 12, losses: 0, ties: 1 }), '12-0-1')
})

// --- against the real data ---

test('the clubs this checkout has built produce a coherent verdict', () => {
	// Relations and floors, never a snapshot: the artifacts are rebuilt from
	// refreshed sources, so pinning today's record would fail for reasons that
	// are not defects.
	for (const team of [packers, brewers]) {
		const latest = latestSeason(loadIndex(team.id, 'games').entries)
		assert.ok(latest, `${team.id} has no seasons`)
		const tally = seasonTally(latest.rows, team)
		const verdict = seasonVerdict({ ...tally, isPastSeason: latest.isPastSeason })
		assert.ok(['undefeated', 'offseason', 'not-started', 'no'].includes(verdict))
		// The invariant that ties the two together: the three answers are
		// mutually exclusive and the tally has to agree with the one chosen.
		if (verdict === 'undefeated') assert.equal(tally.losses, 0)
		if (verdict === 'not-started' || verdict === 'offseason') assert.equal(tally.wins + tally.losses + tally.ties, 0)
		assert.ok(verdictText(verdict, team).length > 0, `${team.id} renders an empty verdict`)
	}
})

test('a real season never counts more games than it has rows', () => {
	// The arithmetic that caught a 175-game 1982 as correct rather than wrong:
	// 163 regular season including a tie, 5 ALCS, 7 World Series.
	const latest = latestSeason(loadIndex('brewers', 'games').entries)
	const t = seasonTally(latest.rows, brewers)
	const counted = t.wins + t.losses + t.ties + (t.postseason ? t.postseason.w + t.postseason.l + t.postseason.t : 0)
	assert.ok(counted <= latest.rows.length, `counted ${counted} of ${latest.rows.length} rows`)
})

test('a whitespace-only championship is not a championship', () => {
	// The guard is `trim() !== ''`, not truthiness, and a string of spaces is
	// truthy. Upstream fields are not reliably empty when they mean empty.
	assert.equal(seasonTally([post({ championship: '   ', result: 'WIN' })], packers).championshipName, null)
	assert.equal(seasonTally([post({ championship: '', result: 'WIN' })], packers).championshipName, null)
})
