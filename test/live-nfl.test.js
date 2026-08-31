import test from 'node:test'
import assert from 'node:assert/strict'
import nfl, { liveGameRow, liveWeek, numberEvents } from '../sports/nfl.js'
import { codeTable } from '../lib/codes.js'

// Football's live feed. Same shape as baseball's, and different in three ways
// that all had to be measured rather than assumed: the season crosses the new
// year, the id is nflverse's rather than Retrosheet's, and the postseason week
// numbering does not line up.

const CODES = codeTable('nfl')
const ctx = { franchiseOf: CODES.franchiseOf, knows: CODES.knows, codeIn: CODES.codeIn }

const event = (over = {}) => ({
	date: '2025-09-06T00:00Z',
	season: { year: 2025, type: 2 },
	week: { number: 1 },
	competitions: [{
		status: { type: { state: 'post', name: 'STATUS_FINAL', completed: true } },
		competitors: [
			{ homeAway: 'home', team: { abbreviation: 'LAC' }, score: '27' },
			{ homeAway: 'away', team: { abbreviation: 'KC' }, score: '21' },
		],
		...over.competition,
	}],
	...over.event,
})

test('the id is the one nflverse uses, from nflverse codes', () => {
	// Games are keyed on (sport, id). An ESPN id would make the same game a
	// second row the moment nflverse published the week.
	assert.equal(liveGameRow(event(), { ...ctx, queryDate: '20250905' }).id, '2025_01_KC_LAC')
})

test('clubs the two sources spell differently still produce nflverse ids', () => {
	// The Rams are LAR to ESPN and LA to nflverse; Washington is WSH and WAS.
	// Building the id from the franchise code would miss both.
	const e = event({ competition: { competitors: [
		{ homeAway: 'home', team: { abbreviation: 'WSH' }, score: '20' },
		{ homeAway: 'away', team: { abbreviation: 'LAR' }, score: '17' },
	] } })
	const r = liveGameRow(e, { ...ctx, queryDate: '20250905' })
	assert.equal(r.id, '2025_01_LA_WAS')
	// And the row itself carries the FRANCHISE codes, which is what the database
	// stores and what every other page resolves against.
	assert.equal(r.home, 'WSH')
	assert.equal(r.away, 'LAR')
})

// --- the week numbering ---

test('the regular season lines up', () => {
	assert.equal(liveWeek({ season: { type: 2 }, week: { number: 1 } }), 1)
	assert.equal(liveWeek({ season: { type: 2 }, week: { number: 18 } }), 18)
})

test('the postseason does not, and is mapped', () => {
	// ESPN restarts at 1 for the wild card; nflverse continues from 18 but skips
	// the Pro Bowl, which ESPN counts. Verified against both: the 2024 Super
	// Bowl is 2024_22_KC_PHI and ESPN has it as type 3 week 5.
	assert.equal(liveWeek({ season: { type: 3 }, week: { number: 1 } }), 19)
	assert.equal(liveWeek({ season: { type: 3 }, week: { number: 2 } }), 20)
	assert.equal(liveWeek({ season: { type: 3 }, week: { number: 3 } }), 21)
	assert.equal(liveWeek({ season: { type: 3 }, week: { number: 5 } }), 22)
})

test('the Pro Bowl is not a game', () => {
	// ESPN counts it as postseason week 4. It is also AFC against NFC, so the
	// club check would reject it anyway — both guards, because either alone
	// passing would be a coincidence.
	assert.equal(liveWeek({ season: { type: 3 }, week: { number: 4 } }), null)
	const e = event({
		event: { season: { year: 2024, type: 3 }, week: { number: 4 } },
		competition: { competitors: [
			{ homeAway: 'home', team: { abbreviation: 'NFC' }, score: '76' },
			{ homeAway: 'away', team: { abbreviation: 'AFC' }, score: '63' },
		] },
	})
	assert.equal(liveGameRow(e, ctx), null)
})

test('preseason is not the season', () => {
	assert.equal(liveWeek({ season: { type: 1 }, week: { number: 1 } }), null)
	assert.equal(liveGameRow(event({ event: { season: { year: 2025, type: 1 }, week: { number: 1 } } }), ctx), null)
})

test('an event with no week is skipped rather than numbered NaN', () => {
	assert.equal(liveWeek({ season: { type: 2 } }), null)
	assert.equal(liveGameRow(event({ event: { week: {} } }), ctx), null)
})

// --- the season crossing the new year ---

test('January and February belong to the previous season', () => {
	// The 2024 season ends with a Super Bowl in February 2025. A calendar year
	// would file it as 2025, where it matches nothing.
	const of = nfl.sources.live.seasonOf
	assert.equal(of(new Date('2026-09-15T00:00Z')), 2026)
	assert.equal(of(new Date('2026-12-25T00:00Z')), 2026)
	assert.equal(of(new Date('2027-01-10T00:00Z')), 2026)
	assert.equal(of(new Date('2027-02-08T00:00Z')), 2026)
})

test('a season backfill runs September through February', () => {
	const days = nfl.sources.live.daysOf(2024)
	assert.equal(days[0], '20240901')
	assert.equal(days.at(-1), '20250228')
	assert.equal(new Set(days).size, days.length)
	// The Super Bowl is in February of the following year and must be in range.
	assert.ok(days.includes('20250209'))
})

test('a leap February is a day longer', () => {
	assert.equal(nfl.sources.live.daysOf(2023).filter((d) => d.startsWith('202402')).length, 29)
	assert.equal(nfl.sources.live.daysOf(2024).filter((d) => d.startsWith('202502')).length, 28)
})

// --- the rest of the shape ---

test('a postponed game is not stored', () => {
	const e = event({ competition: { status: { type: { state: 'post', name: 'STATUS_POSTPONED', completed: false } } } })
	assert.equal(liveGameRow(e, ctx), null)
})

test('an unfinished game has no scores', () => {
	const e = event({ competition: { status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } } } })
	const r = liveGameRow(e, ctx)
	assert.equal(r.status, 'scheduled')
	assert.equal(r.homeScore, null)
})

test('the postseason is a playoff, never a championship', () => {
	// Which game was the final is decided by the load's championship pass, which
	// knows the leagues and their eras. The first version of that pass promoted a
	// conference title by guessing; a live feed must not guess at all.
	const e = event({ event: { season: { year: 2024, type: 3 }, week: { number: 5 } } })
	assert.equal(liveGameRow(e, ctx).round, 'playoff')
})

test('the week is carried onto the row', () => {
	// The league schedule groups football by week, and a live row with no week
	// would fall out of its group and be listed by date instead.
	assert.equal(liveGameRow(event(), ctx).week, 1)
	assert.equal(liveGameRow(event({ event: { season: { year: 2024, type: 3 }, week: { number: 5 } } }), ctx).week, 22)
})

test('football has no doubleheaders, so every game is its own', () => {
	assert.deepEqual(numberEvents([event(), event()]).map((n) => n.number), [0, 0])
	assert.deepEqual(numberEvents([{ id: 'no competition' }]), [])
	assert.deepEqual(numberEvents(undefined), [])
})

test('the adapter exposes what the server calls', () => {
	// loadSports hands the server the DEFAULT export. Baseball's live mappers
	// were only named exports, so the CLI worked and the server failed on its
	// first refresh.
	assert.equal(typeof nfl.liveGameRow, 'function')
	assert.equal(typeof nfl.numberEvents, 'function')
	assert.equal(typeof nfl.sources.live?.url, 'function')
	assert.equal(typeof nfl.sources.live?.daysOf, 'function')
	assert.equal(typeof nfl.sources.live?.recentDays, 'function')
	assert.equal(typeof nfl.sources.live?.seasonOf, 'function')
})
