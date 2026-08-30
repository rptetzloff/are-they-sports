import test from 'node:test'
import assert from 'node:assert/strict'
import { computeRecords, pct, rec } from '../lib/records.js'
import { titleHeading } from '../lib/render.js'
import { loadIndex } from '../lib/indices.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')
const REAL = loadIndex('packers', 'games').entries

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

/** A season's worth of regular-season games from a pattern. */
const season = (year, pattern, over = {}) => pattern.split('').map((c, i) => ({
	result: RESULTS[c] ?? '',
	date: `${year}-09-${String(i + 1).padStart(2, '0')}`,
	season: String(year),
	regular_season: '1',
	playoff: '0',
	championship: '',
	Opponent: 'CHI',
	scoreFor: '20',
	scoreAgainst: '10',
	location: 'home',
	...over,
}))

test('a record is written with en-dashes, and ties only when there are some', () => {
	assert.equal(rec(12, 0, 1), '12–0–1')
	assert.equal(rec(15, 1, 0), '15–1')
})

// --- settled seasons ---

test('a season with a game left to play is excluded from every ranking', () => {
	// A club sitting at 3-0 in September would otherwise top the best-seasons
	// list at 1.000 and claim an undefeated season it has not finished.
	const rows = [
		...season(1929, 'WWWWW'),
		...season(2026, 'WWW'),
		...season(2026, '', {}), // nothing
		{ ...season(2026, 'W')[0], result: '', date: '2026-12-01' },
	]
	const r = computeRecords(rows)
	assert.deepEqual(r.bestSeasons.map((s) => s.season), [1929])
	assert.deepEqual(r.losslessSeasons.map((s) => s.season), [1929])
})

test('settledness comes from the data, not from a calendar', () => {
	// The football site decided this by date — a season labelled Y is over by
	// March of Y+1 — which is football's calendar and wrong for baseball, whose
	// season ends in the October of its own year. A season with no unplayed
	// games is finished in either sport.
	const finished = computeRecords(season(2026, 'WWWW'))
	assert.deepEqual(finished.losslessSeasons.map((s) => s.season), [2026])
})

// --- seasons ---

test('best and worst seasons rank by win percentage, ties counting half', () => {
	// 1929 at 12-0-1 is .962 and outranks a 15-1 at .938, which is the order the
	// live site shows.
	const r = computeRecords([...season(1929, 'WWWWWWWWWWWWT'), ...season(2011, 'WWWWWWWWWWWWWWWL')])
	assert.deepEqual(r.bestSeasons.map((s) => s.season), [1929, 2011])
	assert.deepEqual(r.worstSeasons.map((s) => s.season), [2011, 1929])
})

test('a lossless season needs a win, and tolerates ties', () => {
	// 1929 went 12-0-1: undefeated, not perfect. A season of nothing but ties is
	// neither.
	const r = computeRecords([...season(1929, 'WWT'), ...season(1930, 'TT')])
	assert.deepEqual(r.losslessSeasons.map((s) => s.season), [1929])
})

// --- starts ---

test('a start is the leading run of one result, and stops at the first other', () => {
	const r = computeRecords([...season(2011, 'WWWWWLWWW'), ...season(1929, 'WWLWW')])
	assert.deepEqual(r.bestStarts, [{ season: 2011, games: 5 }, { season: 1929, games: 2 }])
})

test('a season that opens with a loss has no winning start at all', () => {
	const r = computeRecords(season(1986, 'LLWWW'))
	assert.deepEqual(r.bestStarts, [])
	assert.deepEqual(r.worstStarts, [{ season: 1986, games: 2 }])
})

// --- streaks ---

test('a streak spans seasons when the sport says it does', () => {
	// Football's longest is 15 games from December 2010 into December 2011, and
	// ending runs at the boundary would erase the record the list exists to
	// show.
	const rows = [...season(2010, 'LWWWW'), ...season(2011, 'WWWWL')]
	const spanning = computeRecords(rows, { streaksSpanSeasons: true })
	assert.equal(spanning.winStreaks[0].games, 8)
	assert.equal(spanning.winStreaks[0].startSeason, 2010)
	assert.equal(spanning.winStreaks[0].endSeason, 2011)
})

test('and does not when it says it does not', () => {
	// Across 162 baseball games the within-season run is what anyone means.
	const rows = [...season(2010, 'LWWWW'), ...season(2011, 'WWWWL')]
	const split = computeRecords(rows, { streaksSpanSeasons: false })
	assert.equal(split.winStreaks[0].games, 4)
	assert.equal(split.winStreaks[0].startSeason, split.winStreaks[0].endSeason)
})

test('a tie ends a win streak, by record-book convention', () => {
	const r = computeRecords(season(1929, 'WWWTWW'))
	assert.equal(r.winStreaks[0].games, 3)
})

test('losing streaks are computed by the same function', () => {
	// Written twice is how the two lists drift apart.
	const r = computeRecords(season(1958, 'LLLLWL'))
	assert.equal(r.loseStreaks[0].games, 4)
	assert.equal(r.winStreaks[0].games, 1)
})

// --- games ---

test('the biggest wins rank by margin, then by the winner\'s score', () => {
	const rows = [
		{ ...season(1966, 'W')[0], scoreFor: '56', scoreAgainst: '3' },
		{ ...season(2005, 'W')[0], scoreFor: '52', scoreAgainst: '3' },
		{ ...season(1962, 'W')[0], scoreFor: '49', scoreAgainst: '0' },
	]
	// 53, then 49 and 49 — and the tiebreaker is the winner's score, so 2005's
	// 52 outranks 1962's 49. This test first expected the reverse, which was the
	// expectation being wrong rather than the rule.
	assert.deepEqual(computeRecords(rows).lopsidedWins.map((g) => g.season), [1966, 2005, 1962])
})

test('every tie is listed, newest first, rather than a top five', () => {
	const rows = [...season(1970, 'T'), ...season(1980, 'T'), ...season(1990, 'T')]
	const r = computeRecords(rows)
	assert.equal(r.ties.length, 3)
	assert.deepEqual(r.ties.map((g) => g.season), [1990, 1980, 1970])
})

// --- postseason ---

const post = (year, result, over = {}) => ({
	...season(year, 'W')[0], regular_season: '0', playoff: '1', result: RESULTS[result], ...over,
})

test('a title is decided by the round, not by the last game played', () => {
	// More championship-round wins than losses, which is the series rule
	// seasonTally uses. The football site asked whether the LAST postseason game
	// was a win — the same answer for single elimination and the wrong one for a
	// best-of-seven.
	const won = computeRecords([
		post(1982, 'W', { championship: '1982' }),
		post(1982, 'W', { championship: '1982' }),
		post(1982, 'W', { championship: '1982' }),
		post(1982, 'W', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
	])
	assert.equal(won.championshipAppearances[0].won, true)
})

test('losing the series is not winning it, however the last game went', () => {
	const lost = computeRecords([
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'L', { championship: '1982' }),
		post(1982, 'W', { championship: '1982' }),
	])
	assert.equal(lost.championshipAppearances[0].won, false)
})

test('a postseason without a title game is an appearance, not a championship', () => {
	const r = computeRecords([post(2020, 'W'), post(2020, 'L')])
	assert.equal(r.playoffAppearances[0].record, '1–1')
	assert.equal(r.playoffAppearances[0].championship, false)
	assert.deepEqual(r.championshipAppearances, [])
})

test('the postseason is excluded from season records', () => {
	// Otherwise a club that went 13-3 and lost a playoff game ranks below one
	// that went 13-3 and missed out.
	const r = computeRecords([...season(2011, 'WWWW'), post(2011, 'L')])
	assert.equal(r.bestSeasons[0].record, '4–0')
})

// --- the heading ---

test('the title list is named from the data when the data agrees', () => {
	// "Super Bowl appearances" over a list that is mostly NFL Championships is
	// wrong by thirty years: the manifest noun is what the club plays for now.
	assert.equal(titleHeading([{ title: 'World Series' }, { title: 'World Series' }], packers),
		'World Series appearances')
	assert.equal(titleHeading([{ title: 'Super Bowl' }, { title: 'NFL Championship' }], packers),
		'Championship games')
	// And falls back to the manifest when the data says nothing.
	assert.equal(titleHeading([{ title: null }], packers), 'Super Bowl appearances')
	assert.equal(titleHeading([], packers), 'Super Bowl appearances')
})

// --- against the real club ---

test('the Packers record book matches what is known about it', () => {
	// Relations and known facts, not a snapshot: 1929 is the only unbeaten
	// season, 1958 the worst, and the longest win streak is the 15 games from
	// 2010 into 2011 that CLAUDE.md cites as the reason streaks span seasons in
	// football.
	const r = computeRecords(REAL, { streaksSpanSeasons: packers.rules.streaksSpanSeasons })
	assert.deepEqual(r.losslessSeasons.map((s) => s.season), [1929])
	assert.equal(r.bestSeasons[0].season, 1929)
	assert.equal(r.worstSeasons[0].season, 1958)
	assert.equal(r.winStreaks[0].games, 15)
	assert.equal(r.winStreaks[0].startSeason, 2010)
	assert.equal(r.winStreaks[0].endSeason, 2011)
	assert.equal(r.ties.length, 39)
	// Not the championship count. Title games are identified at load time and
	// written to the database; the committed artifacts carry championship only
	// where nflverse marked a Super Bowl, so this source knows about one. The
	// thirteen are asserted against the database in db.test.js.
	assert.ok(r.playoffAppearances.length > 30)
})


test('seasons tied on percentage break by extremity, then by the earlier year', () => {
	// Untested, a mutant deleting both tiebreakers survived: nothing in the
	// fixtures had two seasons at the same percentage.
	//
	// Best: more wins first, because 15-0 is a better season than 4-0 at the
	// same 1.000. Then the earlier year, so the list is stable.
	//
	// The big season has to sit in a MIDDLE year for this to test anything.
	// Seasons reach the sort in year order and Array#sort is stable, so with the
	// biggest first the tiebreakers can be deleted without changing the output —
	// which is exactly what let a mutant survive here.
	const best = computeRecords([
		...season(1929, 'WWWW'),
		...season(1930, 'WWWWWWWW'),
		...season(1931, 'WWWW'),
	]).bestSeasons
	assert.deepEqual(best.map((s) => s.season), [1930, 1929, 1931])

	// Worst: MORE losses first, mirroring more wins being better. This test
	// asserted the opposite and argued for it — that a short winless season
	// "lost less and still won nothing" — which is a defence of the output
	// rather than a rule. At the same .000, 0-16 is a worse season than 0-10 by
	// every reading anyone uses, and the live football site still ranks them the
	// wrong way round.
	//
	// The big season sits in a MIDDLE year again, so the tiebreaker cannot be
	// deleted and pass on year order alone.
	const worst = computeRecords([
		...season(1930, 'LLLL'),
		...season(1929, 'LLLLLLLL'),
		...season(1931, 'LLLL'),
	]).worstSeasons
	assert.deepEqual(worst.map((s) => s.season), [1929, 1930, 1931])
})

test('at the same winless percentage, more losses is the worse season', () => {
	// The case that prompted this: 0-16 must outrank 0-10 as the worst season a
	// club ever had. Both are .000, so only the tiebreaker separates them, and
	// it is the mirror of 15-0 beating 4-0 among the best.
	const r = computeRecords([...season(1942, 'LLLLLLLLLL'), ...season(2008, 'LLLLLLLLLLLLLLLL')])
	assert.deepEqual(r.worstSeasons.map((s) => `${s.season} ${s.record}`), ['2008 0–16', '1942 0–10'])

	// And the symmetry it mirrors, asserted in the same test so the two cannot
	// drift apart again.
	const b = computeRecords([...season(1929, 'WWWW'), ...season(1972, 'WWWWWWWWWWWWWW')])
	assert.deepEqual(b.bestSeasons.map((s) => s.season), [1972, 1929])
})

test('a season with two finals keeps both, most significant first', () => {
	// 1966: the Packers won the NFL Championship and then Super Bowl I, and both
	// games are in the data. Keeping only the first labelled that season "NFL
	// Championship" and undercounted their Super Bowls by two — four became two,
	// which is the number anyone actually checks.
	const r = computeRecords([
		post(1966, 'W', { championship: '1966', championshipTitle: 'NFL Championship', date: '1967-01-01' }),
		post(1966, 'W', { championship: '1966', championshipTitle: 'Super Bowl', date: '1967-01-15' }),
	])
	const [a] = r.championshipAppearances
	assert.deepEqual(a.titleNames, ['Super Bowl', 'NFL Championship'])
	assert.equal(a.title, 'Super Bowl', 'the league final outranked the Super Bowl it fed')
	assert.equal(a.won, true)
})

test('a single-final season is unchanged by that', () => {
	const r = computeRecords([post(1965, 'W', { championship: '1965', championshipTitle: 'NFL Championship' })])
	assert.deepEqual(r.championshipAppearances[0].titleNames, ['NFL Championship'])
	assert.equal(r.championshipAppearances[0].title, 'NFL Championship')
})

test('a winning percentage has no leading zero', () => {
	assert.equal(pct(0.5714), '.5714')
	assert.equal(pct(0.4633), '.4633')
	assert.equal(pct(0.0625), '.0625')
	assert.equal(pct(0), '.0000')
})

test('four decimals, because three cannot separate the clubs', () => {
	// Measured against all 32 current clubs: three decimals collides three
	// times — Cowboys and Packers, Vikings and Dolphins and Chiefs, Saints and
	// Lions. Four collides none. These are the real all-time figures for the
	// pair that prompted it, and a table whose job is ranking must not print
	// one number for two clubs.
	const cowboys = (576 + 7 / 2) / (576 + 432 + 7)
	const packers = (819 + 39 / 2) / (819 + 611 + 39)
	assert.equal(cowboys.toFixed(3), packers.toFixed(3), 'the premise no longer holds')
	assert.notEqual(pct(cowboys), pct(packers))
	assert.equal(pct(cowboys), '.5709')
	assert.equal(pct(packers), '.5708')
})

test('a perfect record keeps its leading one', () => {
	// "1.0000" is read instantly and ".0000" is the opposite number, so
	// stripping the zero cannot be unconditional.
	assert.equal(pct(1), '1.0000')
})

test('the percentage rounds rather than truncating', () => {
	assert.equal(pct(0.96155), '.9616')
	// And an exact-looking half is not one. 0.55555 is stored slightly BELOW
	// half, so it rounds down — JavaScript's number representation rather than
	// anything this function decides, pinned so it is not read as a bug.
	assert.equal(pct(0.55555), '.5555')
})

test('a season percentage is three decimals, a league table four', () => {
	// Four decimals exist because three could not separate the Cowboys from the
	// Packers over a century. A single season is seventeen games and cannot
	// resolve a fourth decimal at all: 9-7-1 is .559, and ".5588" claims a
	// precision the sample does not have.
	assert.equal(pct((9 + 0.5) / 17, 3), '.559')
	assert.equal(pct((9 + 0.5) / 17), '.5588')
	assert.equal(pct(1, 3), '1.000')
	assert.equal(pct(0, 3), '.000')
})
