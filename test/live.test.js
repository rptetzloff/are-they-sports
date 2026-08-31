import test from 'node:test'
import assert from 'node:assert/strict'
import mlb, { liveGameRow, numberEvents } from '../sports/mlb.js'
import nfl from '../sports/nfl.js'
import { codeTable } from '../lib/codes.js'
import { readFileSync } from 'node:fs'
import { SQL_UPSERT_LIVE, lockKeyFor, refreshLive } from '../lib/live.js'

// The live feed. Retrosheet publishes annually, so between March and the World
// Series the authoritative source has nothing for the season being played and a
// club page answers about last year. Every bug below was found by comparing a
// count against what the season actually was.

const CODES = codeTable('mlb')
const ctx = { eraCodeOf: CODES.eraCodeOf, franchiseOf: CODES.franchiseOf, knows: CODES.knows }

const event = (over = {}) => ({
	id: '401874913',
	date: '2026-08-29T17:05Z',
	season: { year: 2026, type: 2 },
	competitions: [{
		status: { type: { state: 'post', name: 'STATUS_FINAL', completed: true } },
		competitors: [
			{ homeAway: 'home', team: { abbreviation: 'NYY' }, score: '0' },
			{ homeAway: 'away', team: { abbreviation: 'BOS' }, score: '6' },
		],
		...over.competition,
	}],
	...over.event,
})
const withStatus = (type) => event({ competition: { status: { type } } })

test('the id is built in Retrosheet shape, from the era code', () => {
	// Games are keyed on (sport, id). ESPN's own id would make the same game a
	// second row the moment Retrosheet published the season, and every club
	// would have played everything twice.
	assert.equal(liveGameRow(event(), ctx).id, 'NYA202608290')
})

test('the id uses the era code and the row the franchise', () => {
	// Retrosheet writes ATH202507040 for a game whose franchise is OAK. The two
	// are different strings and both are needed.
	const e = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'ATH' }, score: '3' },
		{ homeAway: 'away', team: { abbreviation: 'SEA' }, score: '1' },
	] } })
	const r = liveGameRow(e, ctx)
	assert.ok(r.id.startsWith('ATH2026'), `id is ${r.id}`)
	assert.equal(r.home, 'OAK')
})

test('ESPN codes resolve to Retrosheet franchises', () => {
	const r = liveGameRow(event(), ctx)
	assert.equal(r.home, 'NYA')
	assert.equal(r.away, 'BOS')
})

// --- what is not a played game ---

test('a postponed game is not stored at all', () => {
	// Two things wrong with it. STATUS_POSTPONED is also state `post` and carries
	// a 0-0 score, so reading the state stored thirteen postponements in three
	// months as nil-nil finals — the Brewers had 140 games by August 30 when they
	// had played 137.
	//
	// And it is not a fixture on that date either: it is replayed later, usually
	// as half of a doubleheader. Boston's April 5th 2025 game against St. Louis
	// became the second game of April 6th, and Retrosheet has no record of it on
	// the 5th at all. Kept as `scheduled` it was a row nothing would supersede.
	assert.equal(liveGameRow(withStatus({ state: 'post', name: 'STATUS_POSTPONED', completed: false }), ctx), null)
})

test('a game in progress is not final', () => {
	const r = liveGameRow(withStatus({ state: 'in', name: 'STATUS_IN_PROGRESS', completed: false }), ctx)
	assert.equal(r.status, 'scheduled')
	assert.equal(r.homeScore, null)
})

test('a scheduled game is not a nil-nil draw', () => {
	const r = liveGameRow(withStatus({ state: 'pre', name: 'STATUS_SCHEDULED', completed: false }), ctx)
	assert.equal(r.status, 'scheduled')
	assert.equal(r.homeScore, null, 'a game that has not started was stored as 0-0')
})

test('a completed game keeps its scores', () => {
	const r = liveGameRow(event(), ctx)
	assert.equal(r.status, 'final')
	assert.equal(r.homeScore, 0)
	assert.equal(r.awayScore, 6)
})

// --- what is not a game ---

test('spring training is not the season', () => {
	// March 2026 is 321 preseason events against 76 regular-season ones. Loaded
	// as real games it gave the Brewers 26 games in March.
	assert.equal(liveGameRow(event({ event: { season: { year: 2026, type: 1 } } }), ctx), null)
})

test('the All-Star game is not two clubs', () => {
	// It arrives as AL against NL, and both were registered as franchises.
	const e = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'NL' }, score: '4' },
		{ homeAway: 'away', team: { abbreviation: 'AL' }, score: '2' },
	] } })
	assert.equal(liveGameRow(e, ctx), null)
})

test('a postseason fixture with no teams yet is not a game', () => {
	const e = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'TBD' }, score: '0' },
		{ homeAway: 'away', team: { abbreviation: 'TBD' }, score: '0' },
	] } })
	assert.equal(liveGameRow(e, ctx), null)
})

test('the postseason is a playoff game, and the round is left to the real source', () => {
	const r = liveGameRow(event({ event: { season: { year: 2026, type: 3 } } }), ctx)
	assert.equal(r.round, 'playoff')
	// Never `championship`: which series it was is not guessed from a live feed.
	assert.notEqual(r.round, 'championship')
})

test('every live row names the live source', () => {
	// Authority 10 and not reproducible, so an authoritative load supersedes it.
	assert.equal(liveGameRow(event(), ctx).source, 'espn')
})

// --- doubleheaders ---

test('two games between the same clubs on one day are numbered', () => {
	// Retrosheet writes 0 for a single game and 1 and 2 for a doubleheader, and
	// ESPN says nothing about which is which.
	const first = event({ event: { id: 'a', date: '2026-08-29T17:05Z' } })
	const second = event({ event: { id: 'b', date: '2026-08-29T23:05Z' } })
	// Both input orders, because a mutant replacing the sort with `reverse()`
	// survived: given the events already in reverse, reversing them happens to
	// sort them. Only feeding both orders shows the difference.
	for (const input of [[second, first], [first, second]]) {
		const numbered = numberEvents(input)
		assert.deepEqual(numbered.map((n) => n.number).sort(), [1, 2])
		// Ordered by start time: the earlier game is 1.
		assert.equal(numbered.find((n) => n.number === 1).event.date, '2026-08-29T17:05Z')
	}
})

test('a lone game is numbered zero', () => {
	assert.deepEqual(numberEvents([event()]).map((n) => n.number), [0])
})

test('different clubs on the same day are each zero', () => {
	// numberEvents is given ONE day's events, so it groups by club alone. It used
	// to group by the event's own date as well, which splits a doubleheader
	// whenever the second game runs past midnight UTC: a Colorado double on April
	// 20th 2025 had games at 20:10Z and 01:10Z, landed in two groups, and both
	// came out numbered 0 with the same id.
	const a = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'NYY' }, score: '1' },
		{ homeAway: 'away', team: { abbreviation: 'BOS' }, score: '0' },
	] } })
	const b = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'CHC' }, score: '2' },
		{ homeAway: 'away', team: { abbreviation: 'STL' }, score: '3' },
	] } })
	assert.deepEqual(numberEvents([a, b]).map((n) => n.number), [0, 0])
})

test('a doubleheader spanning midnight UTC is still one doubleheader', () => {
	const early = event({ event: { id: 'a', date: '2025-04-20T20:10Z' } })
	const late = event({ event: { id: 'b', date: '2025-04-21T01:10Z' } })
	assert.deepEqual(numberEvents([early, late]).map((n) => n.number).sort(), [1, 2])
})

test('the date comes from the request, not the event', () => {
	// Event timestamps are UTC and Retrosheet files the LOCAL date. A 7:05pm
	// game in Texas is stamped 2025-03-29T00:05Z and belongs to the 28th; read
	// off the event it was filed a day late, collided with the next day's game,
	// and only 76% of a season's ids matched what Retrosheet had published.
	const e = event({ event: { date: '2025-03-29T00:05Z' } })
	assert.equal(liveGameRow(e, { ...ctx, queryDate: '20250328' }).date, '2025-03-28')
	assert.equal(liveGameRow(e, { ...ctx, queryDate: '20250328' }).id, 'NYA202503280')
	// Without one it falls back to the event, which is what the id would have
	// been before.
	assert.equal(liveGameRow(e, ctx).date, '2025-03-29')
})

test('an event with no competition is skipped rather than throwing', () => {
	assert.equal(liveGameRow({ id: 'x', date: '2026-08-29T17:05Z' }, ctx), null)
	assert.deepEqual(numberEvents([{ id: 'x', date: '2026-08-29T17:05Z' }]), [])
})

test('the adapter exposes the live mappers on its default export', () => {
	// `loadSports` hands the server each adapter's DEFAULT export. These were
	// only named exports, and the command-line loader imported the whole module
	// namespace — so the CLI worked and the server failed with "numberEvents is
	// not a function" on its first refresh.
	assert.equal(typeof mlb.liveGameRow, 'function')
	assert.equal(typeof mlb.numberEvents, 'function')
	assert.equal(typeof mlb.sources.live?.url, 'function')
	assert.equal(typeof mlb.sources.live?.seasonOf, 'function')
	assert.equal(typeof mlb.sources.live?.daysOf, 'function')
	assert.equal(typeof mlb.sources.live?.recentDays, 'function')
})

test('a sport with no live feed says so rather than half-declaring one', () => {
	// Football has no live source yet. What must not happen is a `live` block
	// with pieces missing, which would fail at the first refresh rather than at
	// boot.
	const cfg = nfl.sources.live
	if (cfg) {
		assert.equal(typeof cfg.url, 'function', 'nfl declares a live source with no url')
		assert.equal(typeof cfg.seasonOf, 'function')
		assert.equal(typeof nfl.liveGameRow, 'function')
		assert.equal(typeof nfl.numberEvents, 'function')
	} else {
		assert.equal(cfg, undefined)
	}
})

// --- the refresh that runs inside the server ---

test('the live upsert keeps the same authority rule as the loader', () => {
	// live.js duplicates the statement rather than importing it from
	// scripts/load.mjs, which is a command-line program that connects, migrates,
	// repairs and commits. The comment there says the two are asserted against
	// each other so they cannot drift — this is that assertion.
	const loader = readFileSync(new URL('../scripts/load.mjs', import.meta.url), 'utf8')
	const clause = (src) => src
		.slice(src.indexOf('WHERE (SELECT authority'))
		.split('`')[0]
		.replace(/\s+/g, ' ')
		.trim()
	assert.equal(clause(SQL_UPSERT_LIVE), clause(loader),
		'the live upsert and the loader disagree about when a row may be replaced')
	// And it is the rule that matters. A row may be replaced when the incoming
	// source is at least as authoritative, OR when what is there is not final —
	// and in that second case only if the incoming row FINISHES it or already
	// belongs to that source.
	//
	// The last part was missing and cost nothing until football gained a live
	// feed: nflverse publishes a whole season's schedule before it starts, so
	// 272 authoritative `scheduled` rows were overwritten by equally scheduled
	// ESPN ones, adding no information and turning 272 reproducible rows into
	// non-reproducible ones.
	assert.match(SQL_UPSERT_LIVE, /authority FROM source WHERE id = EXCLUDED\.source\)\s*>=/)
	assert.match(SQL_UPSERT_LIVE, /game\.status <> 'final'/)
	assert.match(SQL_UPSERT_LIVE, /EXCLUDED\.status = 'final' OR game\.source = EXCLUDED\.source/)
})

test('every sport gets its own lock key, and the same one every time', () => {
	// Two sports refreshing must not block each other, and a key that moved
	// between runs would let two containers poll at once.
	assert.equal(lockKeyFor('mlb'), lockKeyFor('mlb'))
	assert.notEqual(lockKeyFor('mlb'), lockKeyFor('nfl'))
	assert.equal(Number.isInteger(lockKeyFor('mlb')), true)
	// The sports still to come must not collide either.
	const keys = ['nfl', 'mlb', 'nba', 'nhl', 'mls', 'wnba'].map(lockKeyFor)
	assert.equal(new Set(keys).size, keys.length)
})

test('a sport with no live source is reported, not thrown', () => {
	// The server filters these out before ever calling, but a refresh asked for
	// a sport that cannot do it should say so rather than crash a timer.
	return refreshLive(null, 'nfl', { sources: {} }).then((r) => {
		assert.equal(r.ran, false)
		assert.match(r.reason, /no live source/)
	})
})

test('the refresh window covers local yesterday whatever the UTC hour', () => {
	// These dates are LOCAL and the clock is UTC. North American local dates lag
	// UTC by up to eight hours, so during a US evening the UTC date has already
	// rolled over — a two-day window covered local today and tomorrow and missed
	// local yesterday, which is exactly when last night's late game finishes.
	const days = (iso) => mlb.sources.live.recentDays(new Date(iso))
	// Mid-afternoon UTC: local yesterday and today are both in range.
	assert.deepEqual(days('2026-08-30T18:00Z'), ['20260828', '20260829', '20260830'])
	// Just past midnight UTC, which is a US evening on the 30th.
	assert.deepEqual(days('2026-08-31T01:00Z'), ['20260829', '20260830', '20260831'])
	// In both cases the local day before "now" is present.
	for (const iso of ['2026-08-30T18:00Z', '2026-08-31T01:00Z']) {
		assert.ok(days(iso).includes('20260829'), `${iso} missed the 29th`)
	}
})

test('a season backfill covers March through November', () => {
	// The World Series runs into November and openers are in March. A window
	// that stops in October loses the finals, which is the part of a season
	// anyone checks — and a mutant trimming the last month survived until this
	// asserted the ends.
	const days = mlb.sources.live.daysOf(2025)
	assert.equal(days[0], '20250301')
	assert.equal(days.at(-1), '20251130')
	assert.equal(days.length, 275)
	// Every day, not every month: February and December are out, and no day is
	// listed twice.
	assert.equal(new Set(days).size, days.length)
	assert.equal(days.filter((d) => d.slice(4, 6) === '11').length, 30)
	assert.equal(days.filter((d) => d.slice(4, 6) === '02').length, 0)
})

test('a leap February does not shift the season', () => {
	// The month lengths are computed, so a leap year is worth one assertion.
	assert.equal(mlb.sources.live.daysOf(2024).length, 275)
	assert.equal(mlb.sources.live.daysOf(2024).filter((d) => d.slice(4, 6) === '03').length, 31)
})
