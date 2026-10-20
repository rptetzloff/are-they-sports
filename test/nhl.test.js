import test from 'node:test'
import assert from 'node:assert/strict'
import nhl, { gameRow, liveGameRow, roundOf, endingOf, WESTERN_CLUBS } from '../sports/nhl.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory, resolver } from '../lib/names.js'
import { loadDivisions } from '../lib/scope.js'
import { refreshLive } from '../lib/live.js'

// --- a game -----------------------------------------------------------------

const codes = { 1: 'MTL', 2: 'TOR', 7289: 'VIC' }
const codeOf = (id) => codes[id] ?? null
const stats = (o) => ({ id: 2023020335, season: 20232024, gameType: 2, gameDate: '2023-11-28', gameStateId: 7,
	homeTeamId: 1, visitingTeamId: 2, homeScore: 5, visitingScore: 4, period: 3, ...o })

test('a stats-API game becomes a row, its ending read from its periods', () => {
	const r = gameRow(stats(), codeOf)
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.ending, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['2023020335', 2024, '2023-11-28', 'regular', null, 'REG', 'MTL', 'TOR', 5, 4, 'final', 'nhl'])
	assert.equal(gameRow(stats({ period: 4 }), codeOf).ending, 'OT')
	assert.equal(gameRow(stats({ period: 5 }), codeOf).ending, 'SO')
	// A playoff game has no shootout: six periods is a long overtime.
	assert.equal(gameRow(stats({ id: 2023030417, gameType: 3, period: 6 }), codeOf).ending, 'OT')
})

test('the round is in the id, in two digits, back to the 1920s', () => {
	assert.deepEqual(['2023030417', '1927030211', '2023030111', '2023020335'].map(roundOf), [4, 2, 1, null])
	const r = gameRow(stats({ id: 2023030417, gameType: 3 }), codeOf)
	assert.deepEqual([r.round, r.stage], ['playoff', 'R4'])
	assert.deepEqual([endingOf(2, 3), endingOf(2, 4), endingOf(2, 5), endingOf(3, 7), endingOf(2, 0)], ['REG', 'OT', 'SO', 'OT', null])
})

test('the preseason, an unplayed playoff game and an unknown club are not rows', () => {
	assert.equal(gameRow(stats({ gameType: 1 }), codeOf), null)
	// "If necessary" games a series never needed: 17 in 2024, 23 in 2026.
	assert.equal(gameRow(stats({ id: 2023030116, gameType: 3, gameStateId: 1 }), codeOf), null)
	assert.equal(gameRow(stats({ homeTeamId: 99 }), codeOf), null)
	// An unplayed regular-season game is a fixture, not a 0-0 result.
	const later = gameRow(stats({ gameStateId: 1, homeScore: null, visitingScore: null }), codeOf)
	assert.deepEqual([later.status, later.homeScore, later.ending], ['scheduled', null, null])
	// The western clubs the Cup Finals were against are clubs here.
	assert.equal(gameRow(stats({ id: 1924030311, gameType: 3, visitingTeamId: 7289 }), codeOf).away, 'VIC')
	assert.equal(WESTERN_CLUBS[7289], 'VIC')
})

const score = { id: 2026020135, season: 20262027, gameType: 2, gameDate: '2026-10-18', gameState: 'OFF',
	homeTeam: { abbrev: 'MIN', score: 3 }, awayTeam: { abbrev: 'CBJ', score: 2 }, gameOutcome: { lastPeriodType: 'SO' } }

test('a live game from the NHL\'s own scoreboard has the stats API\'s id and its ending', () => {
	const r = liveGameRow(score, { franchiseOf: (c) => c, knows: () => true })
	assert.deepEqual([r.id, r.season, r.ending, r.status, r.home], ['2026020135', 2027, 'SO', 'final', 'MIN'])
	assert.equal(liveGameRow({ ...score, gameType: 3, id: 2026030111, gameState: 'FUT' }, { franchiseOf: (c) => c }), null)
	assert.equal(nhl.sources.live.seasonOf(new Date('2026-10-20T00:00Z')), 2027)
})

test('the live refresh reads the NHL\'s `games` and writes the ending in its column', async () => {
	const realFetch = globalThis.fetch
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ games: [score] }) })
	const writes = []
	const client = { query: async (sql, params) => { if (/INSERT INTO game/.test(sql)) writes.push({ sql, params }); return { rowCount: 1, rows: [] } } }
	try {
		await refreshLive(client, 'nhl', nhl, { now: new Date('2026-10-19T12:00Z') })
	} finally { globalThis.fetch = realFetch }
	assert.ok(writes.length, 'nothing was written')
	const { sql, params } = writes[0]
	const columns = sql.match(/INSERT INTO game \(([^)]*)\)/)[1].split(',').map((c) => c.trim())
	assert.equal(columns.length, 15)
	assert.equal(params[columns.indexOf('ending')], 'SO')
	assert.equal(params[columns.indexOf('id')], '2026020135')
})

// --- the franchise table ----------------------------------------------------

const history = loadHistory('nhl')
const table = codeTable('nhl', history)

test('every era\'s NHL code reaches the right franchise, and no code names two', () => {
	const cases = { WIN: 'UTA', PHX: 'UTA', ARI: 'UTA', WPG: 'WPG', ATL: 'WPG', DCG: 'DET', DFL: 'DET', TAN: 'TOR', TSP: 'TOR',
		AFM: 'CGY', KCS: 'NJD', CLR: 'NJD', QUE: 'COL', HFD: 'CAR', MNS: 'DAL', OAK: 'CLE', CGS: 'CLE',
		SEN: 'SLE', QBD: 'HAM', PIR: 'QUA', NYA: 'BRK', UTAH: 'UTA', LA: 'LAK', TB: 'TBL', NJ: 'NJD', SJ: 'SJS' }
	for (const [code, franchise] of Object.entries(cases)) assert.equal(table.franchiseOf(code), franchise, code)
	assert.equal(table.knows('TBD'), false)
})

test('names follow the era', () => {
	const name = resolver('nhl')
	assert.equal(name('UTA', { season: 1990 }).name, 'Winnipeg Jets')
	assert.equal(name('UTA', { season: 2026 }).name, 'Utah Mammoth')
	assert.equal(name('TOR', { season: 1920 }).name, 'Toronto St. Patricks')
	assert.equal(name('DET', { season: 1928 }).name, 'Detroit Cougars')
	assert.equal(name('VIC', { season: 1925 }).name, 'Victoria Cougars')
})

test('thirty-two clubs, each with an ESPN code and a division, four of eight', () => {
	const current = history.filter((r) => r.endSeason === '' && r.league === 'NHL')
	assert.equal(current.length, 32)
	for (const r of current) assert.ok(r.espnAbbrv && r.conference && r.division, `${r.teamAbbrv} is incomplete`)
	const sizes = Object.values(Object.groupBy(loadDivisions('nhl'), (d) => `${d.conference}/${d.division}`)).map((g) => g.length)
	assert.deepEqual(sizes, [8, 8, 8, 8])
})
