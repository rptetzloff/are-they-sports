import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nba, { espnGameRow, eloGameRow, liveGameRow, championshipTitle } from '../sports/nba.js'
import { codeTable } from '../lib/codes.js'
import { isSeasonal, loadHistory, resolver } from '../lib/names.js'
import { loadDivisions } from '../lib/scope.js'
import { csvRows } from '../lib/csv.js'

// --- what counts ------------------------------------------------------------

const espn = (o) => ({ id: '401', season: '2025', season_type: '2', type_abbreviation: 'STD', game_date: '2025-01-05',
	home_abbreviation: 'MIL', away_abbreviation: 'CHI', home_score: '112', away_score: '104',
	status_type_completed: 'TRUE', status_type_name: 'STATUS_FINAL', neutral_site: 'FALSE', ...o })

test('a regular-season ESPN game is a regular-season row, on its local date', () => {
	const r = espnGameRow(espn())
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['401', 2025, '2025-01-05', 'regular', null, 'MIL', 'CHI', 112, 104, 'final', 'sportsdataverse'])
})

test('the Finals are the championship round, and every playoff game keeps its round', () => {
	assert.deepEqual(
		['RD16', 'QTR', 'SEMI', 'FINAL'].map((t) => { const r = espnGameRow(espn({ season_type: '3', type_abbreviation: t })); return `${r.round}/${r.stage}` }),
		['playoff/RD16', 'playoff/QTR', 'playoff/SEMI', 'championship/FINAL'])
})

test('the play-in, the All-Star game, the Cup final and a postponement do not count', () => {
	// As the NBA counts them: the play-in is neither season, and the Cup final
	// is the one Cup game outside the standings.
	assert.equal(espnGameRow(espn({ season_type: '5' })), null)
	assert.equal(espnGameRow(espn({ type_abbreviation: 'ALLSTAR' })), null)
	assert.equal(espnGameRow(espn({ type_abbreviation: 'CC' })), null)
	assert.equal(espnGameRow(espn({ season_type: '1' })), null)
	assert.equal(espnGameRow(espn({ status_type_name: 'STATUS_POSTPONED', status_type_completed: 'FALSE' })), null)
	// An unplayed game is a fixture, not a 0-0 result.
	const later = espnGameRow(espn({ status_type_completed: 'FALSE', status_type_name: 'STATUS_SCHEDULED' }))
	assert.deepEqual([later.status, later.homeScore, later.awayScore], ['scheduled', null, null])
})

const elo = (o) => ({ game_id: '194611010TRH', lg_id: 'NBA', _iscopy: '0', year_id: '1947', date_game: '11/1/1946',
	is_playoffs: '0', team_id: 'TRH', pts: '66', opp_id: 'NYK', opp_pts: '68', game_location: 'H', ...o })

test('a FiveThirtyEight game is read once, from the home side', () => {
	const r = eloGameRow(elo())
	assert.deepEqual([r.id, r.season, r.date, r.home, r.away, r.homeScore, r.awayScore, r.round, r.neutral],
		['194611010TRH', 1947, '1946-11-01', 'TRH', 'NYK', 66, 68, 'regular', false])
	// The other copy of the same game, and an ABA game, are not rows.
	assert.equal(eloGameRow(elo({ _iscopy: '1' })), null)
	assert.equal(eloGameRow(elo({ lg_id: 'ABA' })), null)
	// From the away side, the clubs swap.
	const away = eloGameRow(elo({ game_location: 'A' }))
	assert.deepEqual([away.home, away.away, away.homeScore, away.awayScore], ['NYK', 'TRH', 68, 66])
	assert.equal(eloGameRow(elo({ game_location: 'N' })).neutral, true)
	assert.equal(eloGameRow(elo({ is_playoffs: '1' })).round, 'playoff')
})

test('a live Finals game is staged, and its id is the one the release will carry', () => {
	const event = { id: '401767', date: '2026-06-05T00:30Z', season: { type: 3, year: 2026 }, competitions: [{
		type: { abbreviation: 'FINAL' }, status: { type: { completed: false, name: 'STATUS_IN_PROGRESS' } },
		competitors: [{ homeAway: 'home', team: { abbreviation: 'NY' }, score: '60' }, { homeAway: 'away', team: { abbreviation: 'SA' }, score: '58' }] }] }
	const r = liveGameRow(event, { franchiseOf: (c) => c, knows: () => true, queryDate: '20260604' })
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.status], ['401767', 2026, '2026-06-04', 'championship', 'FINAL', 'scheduled'])
	assert.equal(liveGameRow({ ...event, season: { type: 5, year: 2026 } }, { franchiseOf: (c) => c }), null)
})

test('a season is the year it ends', () => {
	const of = nba.sources.live.seasonOf
	assert.equal(of(new Date('2026-10-21T00:00Z')), 2027)
	assert.equal(of(new Date('2027-06-10T00:00Z')), 2027)
	assert.equal(of(new Date('2026-07-15T00:00Z')), 2026)
})

test('the final is named as its era named it', () => {
	assert.equal(championshipTitle(1947), 'BAA Finals')
	assert.equal(championshipTitle(1949), 'BAA Finals')
	assert.equal(championshipTitle(1950), 'NBA Finals')
})

// --- the franchise table ----------------------------------------------------

const history = loadHistory('nba')
const codes = codeTable('nba', history)

test('every source\'s spelling reaches the right franchise', () => {
	// ESPN's (NJ, SEA, NO, GS, UTAH) and FiveThirtyEight's (BRK, CHO, PHO), each
	// read from the games rather than assumed; see the file's header.
	const cases = { NJ: 'BKN', BRK: 'BKN', SEA: 'OKC', NO: 'NOP', NOK: 'NOP', CHO: 'CHA', CHH: 'CHA',
		PHO: 'PHX', GS: 'GSW', UTAH: 'UTA', WSH: 'WAS', NY: 'NYK', SA: 'SAS', TRH: 'TRH' }
	for (const [code, franchise] of Object.entries(cases)) assert.equal(codes.franchiseOf(code), franchise, code)
	// Not clubs, which the load refuses.
	for (const code of ['EAST', 'WEST', 'USA', 'WORLD', 'TBD']) assert.equal(codes.knows(code), false, code)
})

test('basketball\'s history is counted in seasons, and names follow the era', () => {
	assert.equal(isSeasonal(history), true)
	assert.equal(isSeasonal(loadHistory('mlb')), false)
	const name = resolver('nba')
	assert.equal(name('OKC', { season: 1979 }).name, 'Seattle SuperSonics')
	assert.equal(name('OKC', { season: 2009 }).name, 'Oklahoma City Thunder')
	assert.equal(name('NYK', { season: 2026 }).name, 'New York Knicks')
	assert.equal(name('TRH', { season: 1947 }).name, 'Toronto Huskies')
})

test('thirty current clubs, each with an ESPN code and a division, six of five', () => {
	const current = history.filter((r) => r.endSeason === '' && r.league === 'NBA')
	assert.equal(current.length, 30)
	for (const r of current) assert.ok(r.espnAbbrv && r.conference && r.division, `${r.teamAbbrv} is incomplete`)
	const divisions = loadDivisions('nba')
	assert.equal(divisions.length, 30)
	const sizes = Object.values(Object.groupBy(divisions, (d) => `${d.conference}/${d.division}`)).map((g) => g.length)
	assert.deepEqual(sizes, [5, 5, 5, 5, 5, 5])
})

// --- reading the source -----------------------------------------------------

test('a quoted field may hold a newline', async () => {
	// ESPN's schedule files carry JSON blobs in quotes. Split on every newline,
	// one game became a row per fragment.
	const dir = mkdtempSync(join(tmpdir(), 'csv-'))
	const path = join(dir, 'x.csv')
	writeFileSync(path, 'id,blob,n\n1,"{\n""a"": 1\n}",2\n3,plain,4\n')
	const rows = []
	for await (const r of csvRows(path)) rows.push(r)
	assert.deepEqual(rows, [{ id: '1', blob: '{\n"a": 1\n}', n: '2' }, { id: '3', blob: 'plain', n: '4' }])
})
