import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSchedule } from '../lib/schedule.js'

// A whole league's season, grouped into the periods that sport plays in.

const club = (id, code) => ({ id, sport: 'nfl', sourceIds: [code], nouns: { team: id, fullName: id } })

/** One club's view of one game. */
const g = (over = {}) => ({
	gid: 'g1', date: '2024-09-08', season: '2024', regular_season: '1', playoff: '0',
	championship: '', championshipTitle: null, Opponent: 'CHI',
	result: 'WIN', scoreFor: '24', scoreAgainst: '17', location: 'home', week: 1,
	...over,
})

test('an empty league schedules nothing rather than throwing', () => {
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [] }])
	assert.equal(s.season, null)
	assert.deepEqual(s.periods, [])
	assert.equal(s.games, 0)
})

test('the latest season is shown when none is asked for', () => {
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [
		g({ gid: 'a', season: '2023', date: '2023-09-10' }),
		g({ gid: 'b', season: '2024', date: '2024-09-08' }),
	] }])
	assert.equal(s.season, 2024)
	assert.deepEqual(s.seasons, [2023, 2024])
	assert.equal(s.games, 1)
})

test('a named season is shown instead', () => {
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [
		g({ gid: 'a', season: '2023', date: '2023-09-10' }),
		g({ gid: 'b', season: '2024', date: '2024-09-08' }),
	] }], { season: 2023 })
	assert.equal(s.season, 2023)
	assert.equal(s.periods[0].games[0].gid, 'a')
})

// --- the double-counting rule ---

test('a game between two clubs in scope is one fixture', () => {
	// Both clubs have the same game from opposite sides. Listing a league
	// schedule without deduplicating shows every divisional game twice.
	const s = computeSchedule([
		{ team: club('packers', 'GB'), rows: [g({ gid: 'x', Opponent: 'CHI', location: 'home' })] },
		{ team: club('bears', 'CHI'), rows: [g({ gid: 'x', Opponent: 'GB', location: 'away', result: 'LOSS', scoreFor: '17', scoreAgainst: '24' })] },
	])
	assert.equal(s.games, 1)
})

test('a deduplicated fixture keeps home and away the right way round', () => {
	// The bug this guards: keeping whichever perspective arrives first would
	// make the away club the home side half the time, and the score would follow
	// it. Listed away-club-first on purpose.
	const s = computeSchedule([
		{ team: club('bears', 'CHI'), rows: [g({ gid: 'x', Opponent: 'GB', location: 'away', result: 'LOSS', scoreFor: '17', scoreAgainst: '24' })] },
		{ team: club('packers', 'GB'), rows: [g({ gid: 'x', Opponent: 'CHI', location: 'home' })] },
	])
	const [fixture] = s.periods[0].games
	assert.equal(fixture.home, 'GB')
	assert.equal(fixture.away, 'CHI')
	assert.equal(fixture.homeScore, 24)
	assert.equal(fixture.awayScore, 17)
})

test('a game seen only from the away side is still right', () => {
	// A club in scope playing one that is not. There is no home perspective to
	// prefer, so the away row has to be flipped.
	const s = computeSchedule([
		{ team: club('packers', 'GB'), rows: [g({ gid: 'x', Opponent: 'DAL', location: 'away', result: 'WIN', scoreFor: '31', scoreAgainst: '10' })] },
	])
	const [fixture] = s.periods[0].games
	assert.equal(fixture.home, 'DAL')
	assert.equal(fixture.away, 'GB')
	assert.equal(fixture.homeScore, 10)
	assert.equal(fixture.awayScore, 31)
})

// --- periods ---

test('football groups by week, in week order', () => {
	const rows = [
		g({ gid: 'c', week: 3, date: '2024-09-22' }),
		g({ gid: 'a', week: 1, date: '2024-09-08' }),
		g({ gid: 'b', week: 2, date: '2024-09-15' }),
	]
	const s = computeSchedule([{ team: club('packers', 'GB'), rows }], { period: 'week' })
	assert.equal(s.weeksKnown, true)
	assert.deepEqual(s.periods.map((p) => p.week), [1, 2, 3])
})

test('week order is numeric, so week 10 follows week 9', () => {
	// Sorting the keys as strings puts w10 before w2, which is the classic
	// version of this bug and the reason a sort test needs a two-digit week.
	const rows = [
		g({ gid: 'b', week: 10, date: '2024-11-10' }),
		g({ gid: 'a', week: 9, date: '2024-11-03' }),
	]
	const s = computeSchedule([{ team: club('packers', 'GB'), rows }], { period: 'week' })
	assert.deepEqual(s.periods.map((p) => p.week), [9, 10])
})

test('two games in one week are one period', () => {
	const rows = [
		g({ gid: 'a', week: 1, date: '2024-09-08' }),
		g({ gid: 'b', week: 1, date: '2024-09-09', Opponent: 'DAL' }),
	]
	const s = computeSchedule([{ team: club('packers', 'GB'), rows }], { period: 'week' })
	assert.equal(s.periods.length, 1)
	assert.equal(s.periods[0].games.length, 2)
})

test('baseball groups by date, because a week is not a unit it plays in', () => {
	const rows = [
		g({ gid: 'a', date: '2024-04-01', week: null }),
		g({ gid: 'b', date: '2024-04-02', week: null }),
	]
	const s = computeSchedule([{ team: club('brewers', 'MIL'), rows }], { period: 'date' })
	assert.equal(s.weeksKnown, false)
	assert.deepEqual(s.periods.map((p) => p.date), ['2024-04-01', '2024-04-02'])
})

// --- the pre-1999 gap ---

test('a season whose games carry no week is grouped by date and says so', () => {
	// Not derived. Seven-day buckets anchored on the first game were measured
	// against nflverse's real numbers and are wrong for 17.7% of games, because
	// a postponement shifts every week after it — 2001 lost week 2 to September
	// 11th and replayed it at the end of the season.
	const rows = [
		g({ gid: 'a', season: '1967', date: '1967-09-17', week: null }),
		g({ gid: 'b', season: '1967', date: '1967-09-24', week: null }),
	]
	const s = computeSchedule([{ team: club('packers', 'GB'), rows }], { period: 'week' })
	assert.equal(s.weeksKnown, false, 'weeks were claimed for a season that has none')
	assert.deepEqual(s.periods.map((p) => p.kind), ['date', 'date'])
	assert.deepEqual(s.periods.map((p) => p.date), ['1967-09-17', '1967-09-24'])
})

test('one game missing a week does not lose its place in a season that has them', () => {
	// It falls back to its own date rather than vanishing, which is what a
	// `groups.get(key)` on an undefined key would have done.
	const rows = [
		g({ gid: 'a', week: 1, date: '2024-09-08' }),
		g({ gid: 'b', week: null, date: '2024-09-15' }),
	]
	const s = computeSchedule([{ team: club('packers', 'GB'), rows }], { period: 'week' })
	assert.equal(s.games, 2)
	assert.equal(s.periods.flatMap((p) => p.games).length, 2)
	assert.deepEqual(s.periods.map((p) => p.kind), ['week', 'date'])
})

// --- unplayed games ---

test('a scheduled game has no scores rather than zeroes', () => {
	// 0-0 is a real football score and a real tie. An unplayed game showing 0-0
	// is the failure the live site shipped for months.
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [
		g({ result: '', scoreFor: '', scoreAgainst: '' }),
	] }])
	const [fixture] = s.periods[0].games
	assert.equal(fixture.played, false)
	assert.equal(fixture.homeScore, null)
	assert.equal(fixture.awayScore, null)
})

test('a real 0-0 tie is played', () => {
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [
		g({ result: 'TIE', scoreFor: '0', scoreAgainst: '0' }),
	] }])
	const [fixture] = s.periods[0].games
	assert.equal(fixture.played, true)
	assert.equal(fixture.homeScore, 0)
	assert.equal(fixture.awayScore, 0)
})

test('the round is carried, so a playoff game is not shown as week eighteen', () => {
	const s = computeSchedule([{ team: club('packers', 'GB'), rows: [
		g({ gid: 'r', regular_season: '1' }),
		g({ gid: 'p', week: 20, date: '2025-01-12', regular_season: '0', playoff: '1' }),
		g({ gid: 'c', week: 22, date: '2025-02-09', regular_season: '0', playoff: '1', championship: '2024' }),
	] }])
	assert.deepEqual(s.periods.flatMap((p) => p.games).map((x) => x.round),
		['regular', 'playoff', 'championship'])
})

test('a neutral-site game is the same fixture whichever club is listed first', () => {
	// The one case where the two perspectives genuinely disagree: a
	// club-perspective row says `location: 'neutral'` and so no longer records
	// who was nominally home, leaving each club's row naming ITSELF the home
	// side. Without a tiebreak the fixture depends on scope order, which is how
	// the same game renders two ways on two deployments.
	const neutral = (opp) => g({ gid: 'sb', date: '1968-01-14', location: 'neutral', Opponent: opp })
	const gb = { team: club('packers', 'GB'), rows: [neutral('OAK')] }
	const oak = { team: club('raiders', 'OAK'), rows: [neutral('GB')] }
	const one = computeSchedule([gb, oak]).periods[0].games[0]
	const two = computeSchedule([oak, gb]).periods[0].games[0]
	assert.equal(one.neutral, true)
	assert.deepEqual([one.home, one.away], [two.home, two.away])
})

test('the period is the sport\'s, even when the rows carry weeks', () => {
	// Baseball rows would carry a week if a source ever supplied one, and the
	// sport still says dates. Tested with weeks PRESENT, because rows without
	// them group by date anyway and prove nothing about which rule applied.
	const rows = [
		g({ gid: 'a', date: '2024-04-01', week: 1 }),
		g({ gid: 'b', date: '2024-04-02', week: 1 }),
	]
	const s = computeSchedule([{ team: club('brewers', 'MIL'), rows }], { period: 'date' })
	assert.equal(s.weeksKnown, false)
	assert.equal(s.periods.length, 2, 'two dates were collapsed into one week')
	assert.deepEqual(s.periods.map((p) => p.kind), ['date', 'date'])
})
