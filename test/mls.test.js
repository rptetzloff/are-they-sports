import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mls, { gameRow, seasonId, localDate, fetchSeason, REGULAR, PLAYOFFS } from '../sports/mls.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory, resolver } from '../lib/names.js'
import { loadDivisions } from '../lib/scope.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const history = loadHistory('mls')
const table = codeTable('mls', history)
const opts = { franchiseOf: table.franchiseOf, knows: table.knows }

// --- a game -----------------------------------------------------------------

// MLS's own 1996 Western semifinal: level, the Galaxy through on penalties.
const match = (o) => ({ competition_id: PLAYOFFS, match_id: 'MLS-MAT-0008VG', season: 1996, match_type: 'Semifinals',
	section_name: 'Conference Finals', planned_kickoff_time: '1996-10-13T21:30:00Z', neutral_venue: false,
	home_team_id: 'MLS-CLU-00000K', home_team_name: 'Kansas City Wiz', away_team_id: 'MLS-CLU-00000G', away_team_name: 'LA Galaxy',
	home_team_goals: 1, away_team_goals: 1, home_team_penalty_goals: 1, away_team_penalty_goals: 3, match_status: 'finalWhistle', ...o })

test('a match becomes a row, its shootout kept apart from its score', () => {
	const r = gameRow(match(), opts)
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.homePens, r.awayPens, r.ending, r.status, r.source],
		['MLS-MAT-0008VG', 1996, '1996-10-13', 'playoff', 'Conference Finals', 'SKC', 'LA', 1, 1, 1, 3, 'SO', 'final', 'mls'])
	// No shootout: no penalties, no ending.
	const plain = gameRow(match({ home_team_goals: 2, home_team_penalty_goals: undefined, away_team_penalty_goals: undefined }), opts)
	assert.deepEqual([plain.homePens, plain.awayPens, plain.ending], [null, null, null])
	assert.equal(gameRow(match({ match_type: 'Final' }), opts).round, 'championship')
	assert.equal(gameRow(match({ competition_id: REGULAR }), opts).round, 'regular')
})

test('only the regular season and the Cup playoffs count, and a placeholder club is no club', () => {
	assert.equal(gameRow(match({ competition_id: 'MLS-COM-000003' }), opts), null)
	assert.equal(gameRow(match({ home_team_name: 'TBC Home', home_team_id: 'MLS-CLU-00001H' }), opts), null)
	// Refused by name too, for a caller that does not ask the franchise table.
	assert.equal(gameRow(match({ home_team_name: 'TBC Home', home_team_id: 'MLS-CLU-00001H' }), { franchiseOf: (c) => c }), null)
	// A game not yet played has no score and no shootout.
	const later = gameRow(match({ match_status: 'scheduled' }), opts)
	assert.deepEqual([later.status, later.homeScore, later.homePens, later.ending], ['scheduled', null, null, null])
})

test('a match is filed under its date where it was played, not in UTC', () => {
	// 7:30 p.m. in Los Angeles is 02:30 the next morning in UTC.
	assert.equal(localDate('2025-06-01T02:30:00Z'), '2025-05-31')
	// An early-afternoon game in the east is the same day everywhere.
	assert.equal(localDate('2025-06-01T17:00:00Z'), '2025-06-01')
})

test('a season\'s MLS id is one step in base 36 a year', () => {
	// As MLS's own list gives them.
	assert.equal(seasonId(1996), 'MLS-SEA-0001JG')
	assert.equal(seasonId(2015), 'MLS-SEA-0001JZ')
	assert.equal(seasonId(2016), 'MLS-SEA-0001K0')
	assert.equal(seasonId(2026), 'MLS-SEA-0001KA')
	assert.equal(mls.sources.live.url('20261018'), 'https://stats-api.mlssoccer.com/matches/seasons/MLS-SEA-0001KA?match_date=2026-10-18&per_page=500')
})

test('a season is fetched page by page, for each counted competition', async () => {
	const asked = []
	const get = async (url) => {
		asked.push(url)
		const page = new URL(url).searchParams.get('page_token')
		return url.includes(REGULAR) && !page ? { schedule: [{ match_id: 'a' }], next_page_token: 'tok' } : { schedule: [{ match_id: page ? 'b' : 'c' }] }
	}
	const got = await fetchSeason(2025, { get })
	assert.deepEqual(got.map((m) => m.match_id), ['a', 'b', 'c'])
	assert.equal(asked.length, 3)
	assert.ok(asked.every((u) => u.includes('MLS-SEA-0001K9')))
})

test('a season is the calendar year, mid-February to mid-December', () => {
	assert.equal(mls.sources.live.seasonOf(new Date('2026-12-06T20:00Z')), 2026)
	const days = mls.sources.live.daysOf(2026)
	assert.deepEqual([days[0], days.at(-1)], ['20260215', '20261215'])
})

// --- the franchise table ----------------------------------------------------

test('MLS\'s team ids join a club\'s names, and no code names two clubs', () => {
	const cases = {
		'MLS-CLU-00000K': 'SKC', KCW: 'SKC', SKC: 'SKC',
		'MLS-CLU-00000B': 'RBNY', MET: 'RBNY', RBNY: 'RBNY',
		'MLS-CLU-00000Q': 'SJ', 'MLS-CLU-00007V': 'TBM', 'MLS-CLU-00007W': 'MIAF', 'MLS-CLU-000034': 'CHV',
		MIA: 'MIA', LA: 'LA', LAFC: 'LAFC',
	}
	for (const [code, franchise] of Object.entries(cases)) assert.equal(table.franchiseOf(code), franchise, code)
	assert.equal(table.knows('MLS-CLU-00001H'), false, 'the TBC placeholder')
})

test('names follow the era', () => {
	const name = resolver('mls')
	assert.equal(name('SKC', { season: 1996 }).name, 'Kansas City Wiz')
	assert.equal(name('SKC', { season: 2005 }).name, 'Kansas City Wizards')
	assert.equal(name('SKC', { season: 2026 }).name, 'Sporting Kansas City')
	assert.equal(name('RBNY', { season: 2000 }).name, 'New York/New Jersey MetroStars')
	assert.equal(name('SJ', { season: 1997 }).name, 'San Jose Clash')
})

test('thirty clubs, each with an ESPN code and a conference, fifteen and fifteen', () => {
	const current = history.filter((r) => r.endSeason === '')
	assert.equal(current.length, 30)
	for (const r of current) assert.ok(r.espnAbbrv && r.conference && r.mlsAbbrv, `${r.teamAbbrv} is incomplete`)
	const sizes = Object.values(Object.groupBy(loadDivisions('mls'), (d) => d.conference)).map((g) => g.length)
	assert.deepEqual(sizes, [15, 15])
})

test('the 2000-2012 shootouts: eight, each on a game of its own season, two of them MLS Cups', () => {
	const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/mls-shootouts.csv'), 'utf8'))
	assert.equal(rows.length, 8)
	for (const r of rows) {
		assert.ok(Number(r.season) >= 2000 && Number(r.season) <= 2012, r.match_id)
		assert.ok(table.knows(r.home) && table.knows(r.away), r.match_id)
		assert.notEqual(r.home_pens, r.away_pens, r.match_id)
		assert.match(r.source, /^https:\/\/en\.wikipedia\.org\/wiki\//)
	}
	// 2006 and 2009: Houston and Real Salt Lake won MLS Cup on penalties.
	const cup = (date) => rows.find((r) => r.date === date)
	assert.deepEqual([cup('2006-11-12').away, cup('2006-11-12').score, Number(cup('2006-11-12').away_pens) > Number(cup('2006-11-12').home_pens)], ['HOU', '1-1', true])
	assert.deepEqual([cup('2009-11-22').away, cup('2009-11-22').score, Number(cup('2009-11-22').away_pens) > Number(cup('2009-11-22').home_pens)], ['RSL', '1-1', true])
})
