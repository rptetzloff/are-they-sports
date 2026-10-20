import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import wnba, { clubCode, roundOf, espnGameRow, statsGameRow, liveGameRow } from '../sports/wnba.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory, resolver } from '../lib/names.js'
import { loadDivisions } from '../lib/scope.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- a game -----------------------------------------------------------------

test('the first Portland Fire is POF, and today\'s is POR', () => {
	// Every source calls both POR; a code naming two clubs merges their histories.
	assert.equal(clubCode('POR', 2001), 'POF')
	assert.equal(clubCode('POR', 2002), 'POF')
	assert.equal(clubCode('POR', 2026), 'POR')
	assert.equal(clubCode('SEA', 2001), 'SEA')
})

test('the league\'s ids name the round from 2002, and not before', () => {
	assert.equal(roundOf('1040200103'), 1)
	assert.equal(roundOf('1042500304'), 3)
	assert.equal(roundOf('1041600405'), 4)
	// 1997-2001 number their playoff games in order: 1049700003 is not round 0.
	assert.equal(roundOf('1049700003'), null)
	assert.equal(roundOf('1040100019'), null)
	// A regular-season id is not a playoff id, whatever its digits.
	assert.equal(roundOf('1022500101'), null)
})

test('a row of the league\'s file becomes a game, its round from its id', () => {
	const row = (o) => ({ game_id: '1040200103', season: '2002', season_type: 'playoffs', date: '2002-08-20',
		home: 'NYL', away: 'IND', home_score: '75', away_score: '60', ...o })
	const r = statsGameRow(row())
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['1040200103', 2002, '2002-08-20', 'playoff', 'R1', 'NYL', 'IND', 75, 60, 'final', 'wnba'])
	const reg = statsGameRow(row({ game_id: '1020000001', season: '2000', season_type: 'regular', home: 'POR', away: 'SEA' }))
	assert.equal(reg.round, 'regular')
	assert.equal(reg.stage, null)
	assert.equal(reg.home, 'POF')
})

const sdv = (o) => ({ id: '401918013', season: '2026', season_type: '', type_abbreviation: 'STD', game_date: '2026-06-01',
	home_abbreviation: 'POR', away_abbreviation: 'SEA', home_score: '80', away_score: '75', status_type_completed: 'TRUE',
	status_type_name: 'STATUS_FINAL', neutral_site: 'FALSE', ...o })

test('a sportsdataverse row without a season type is read by its type word', () => {
	// From 2024 the files leave season_type empty; STD is the regular season,
	// a round's word the playoffs.
	assert.equal(espnGameRow(sdv()).round, 'regular')
	assert.equal(espnGameRow(sdv()).home, 'POR')
	const semi = espnGameRow(sdv({ type_abbreviation: 'SEMI' }))
	assert.deepEqual([semi.round, semi.stage], ['playoff', 'SEMI'])
	assert.equal(espnGameRow(sdv({ type_abbreviation: 'FINAL' })).round, 'championship')
	// Where the season type is given, it decides.
	assert.equal(espnGameRow(sdv({ season_type: '3', type_abbreviation: 'STD' })).round, 'playoff')
	// The All-Star game and the Commissioner's Cup final do not count, and a
	// fragment of a broken line is not a game.
	assert.equal(espnGameRow(sdv({ type_abbreviation: 'ALLSTAR' })), null)
	assert.equal(espnGameRow(sdv({ type_abbreviation: 'CC' })), null)
	// 2022's Cup final carries season type 2, and still does not count.
	assert.equal(espnGameRow(sdv({ season_type: '2', type_abbreviation: 'CC' })), null)
	assert.equal(espnGameRow(sdv({ id: " 'progressiveDownload'" })), null)
	assert.equal(espnGameRow(sdv({ season_type: '1' })), null)
})

test('a scoreboard event is read under the club\'s code, and an All-Star side is refused', () => {
	const ev = (home, away) => ({ id: '1', date: '2026-06-01T23:00Z', season: { year: 2026, type: 2 }, competitions: [{
		type: { abbreviation: 'STD' }, status: { type: { completed: true, name: 'STATUS_FINAL' } },
		competitors: [{ homeAway: 'home', score: '80', team: { abbreviation: home } }, { homeAway: 'away', score: '75', team: { abbreviation: away } }] }] })
	const codes = codeTable('wnba', loadHistory('wnba'))
	const opts = { franchiseOf: codes.franchiseOf, knows: codes.knows, queryDate: '20260601' }
	const r = liveGameRow(ev('POR', 'LV'), opts)
	assert.deepEqual([r.home, r.away, r.date, r.season, r.source], ['POR', 'LVA', '2026-06-01', 2026, 'espn'])
	assert.equal(liveGameRow(ev('EAST', 'WEST'), opts), null)
	// A season reloaded from the scoreboard before 2026 reads POR as the first Fire.
	const old = { ...ev('POR', 'SEA'), season: { year: 2001, type: 2 } }
	assert.equal(liveGameRow(old, { ...opts, queryDate: '20010601' }).home, 'POF')
})

test('a season is the calendar year, played May to October', () => {
	assert.equal(wnba.sources.live.seasonOf(new Date('2026-01-15T12:00:00Z')), 2026)
	assert.equal(wnba.sources.live.seasonOf(new Date('2026-10-20T12:00:00Z')), 2026)
	const days = wnba.sources.live.daysOf(2026)
	assert.equal(days[0], '20260501')
	assert.equal(days.at(-1), '20261031')
})

// --- the franchise table ----------------------------------------------------

const history = loadHistory('wnba')
const table = codeTable('wnba', history)

test('every source\'s code reaches the right franchise, and no code names two', () => {
	const cases = {
		// The league's codes, ESPN's, and ours.
		UTA: 'LVA', UTH: 'LVA', SAN: 'LVA', SAS: 'LVA', SA: 'LVA', LV: 'LVA',
		DET: 'DAL', TUL: 'DAL', ORL: 'CON', CT: 'CON', CONN: 'CON',
		LOS: 'LAS', LA: 'LAS', NY: 'NYL', PHO: 'PHX', WSH: 'WAS', GS: 'GSV',
		HOU: 'HOU', SAC: 'SAC', CHA: 'CHA', CLE: 'CLE', MIA: 'MIA', POF: 'POF', POR: 'POR',
	}
	for (const [code, franchise] of Object.entries(cases)) assert.equal(table.franchiseOf(code), franchise, code)
	for (const notClub of ['EAST', 'WEST', 'USA', 'ALL']) assert.equal(table.knows(notClub), false, notClub)
})

test('names follow the era', () => {
	const name = resolver('wnba')
	assert.equal(name('LVA', { season: 1999 }).name, 'Utah Starzz')
	assert.equal(name('LVA', { season: 2010 }).name, 'San Antonio Silver Stars')
	assert.equal(name('DAL', { season: 2005 }).name, 'Detroit Shock')
	assert.equal(name('CON', { season: 2000 }).name, 'Orlando Miracle')
	assert.equal(name('POF', { season: 2001 }).name, 'Portland Fire')
	assert.equal(name('HOU', { season: 1997 }).name, 'Houston Comets')
})

test('fifteen clubs, each with an ESPN code and a conference, seven and eight', () => {
	const current = history.filter((r) => r.endSeason === '')
	assert.equal(current.length, 15)
	for (const r of current) assert.ok(r.espnAbbrv && r.conference, `${r.teamAbbrv} is incomplete`)
	const sizes = Object.values(Object.groupBy(loadDivisions('wnba'), (d) => d.conference)).map((g) => g.length).sort()
	assert.deepEqual(sizes, [7, 8])
})

// --- the league's own file ----------------------------------------------------

test('the league\'s file holds every game of 1997-2025, each season its full size', () => {
	const games = parseCsv(readFileSync(join(ROOT, 'data/reference/wnba-games.csv'), 'utf8'))
	assert.equal(games.length, 6669)
	const regular = (y) => games.filter((g) => g.season === String(y) && g.season_type === 'regular').length
	// Clubs times games, halved: 8 x 28, 16 x 32, 12 x 22 (2020), 13 x 44.
	assert.equal(regular(1997), 112)
	assert.equal(regular(2001), 256)
	assert.equal(regular(2020), 132)
	assert.equal(regular(2025), 286)
	// Every code in it is a club the table knows.
	for (const g of games) for (const c of [g.home, g.away]) assert.ok(table.knows(clubCode(c, g.season)), `${g.season} ${c}`)
	// The first Finals: one game, Houston 65, New York 51.
	const final = games.filter((g) => g.season === '1997' && g.season_type === 'playoffs').at(-1)
	assert.deepEqual([final.home, final.away, final.home_score, final.away_score], ['HOU', 'NYL', '65', '51'])
})
