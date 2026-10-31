// Men's college hockey (Division I): sports/ncaah.js, its games file and champions.
// ESPN's scoreboards from 2003-04, Wikipedia's bracket for the tournament, and a
// shootout counted as a tie.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sport, { bracketGames, endingOf, eventFields, gameRow, liveGameRow, scoresOf, sources } from '../sports/ncaah.js'
import { parseCsv } from '../lib/csv.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory } from '../lib/names.js'
import { loadTeams } from '../lib/teams.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const games = () => parseCsv(read('data/reference/ncaah-games.csv'))

const event = ({ status = 'Final', home = '4', away = '2', type = 2, notes = [], completed = true, name = 'STATUS_FINAL' } = {}) => ({
	id: '401800000', date: '2026-01-11T00:00Z', season: { year: 2026, type },
	competitions: [{
		status: { type: { name, completed, shortDetail: status } }, neutralSite: false, notes,
		competitors: [
			{ homeAway: 'home', score: home, team: { id: '2172', location: 'Denver' } },
			{ homeAway: 'away', score: away, team: { id: '275', location: 'Wisconsin' } },
		],
	}],
})
const live = (e, over = {}) => liveGameRow(e, { franchiseOf: (id) => id, knows: () => true, queryDate: '20260110', ...over })

test('how a game ended, from ESPN\'s status', () => {
	assert.equal(endingOf('Final'), 'REG')
	assert.equal(endingOf('Final/OT'), 'OT')
	assert.equal(endingOf('Final/SO'), 'SO')
})

test('a shootout is a tie: ESPN\'s extra goal comes back off, and a level score stays', () => {
	assert.deepEqual(scoresOf(6, 5, 'SO'), [5, 5])
	assert.deepEqual(scoresOf(3, 4, 'SO'), [3, 3])
	assert.deepEqual(scoresOf(2, 2, 'SO'), [2, 2])
	// Overtime is a real result.
	assert.deepEqual(scoresOf(6, 5, 'OT'), [6, 5])
	const r = live(event({ status: 'Final/SO', home: '6', away: '5' }))
	assert.deepEqual([r.homeScore, r.awayScore, r.ending], [5, 5, 'SO'])
})

test('a live game: ESPN\'s ids, the asked-for date, the season from that date', () => {
	const r = live(event())
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['401800000', 2026, '2026-01-10', 'regular', null, '2172', '275', 4, 2, 'final', 'espn'])
})

test('no result to keep: called off, or final with no score behind it', () => {
	assert.equal(live(event({ name: 'STATUS_POSTPONED' })), null)
	assert.equal(live(event({ name: 'STATUS_CANCELED' })), null)
	assert.equal(live(event({ home: '0', away: '0' })), null)
	assert.equal(live(event({ home: null, away: null })), null)
})

test('a game to come is scheduled, and a game between two non-clubs is none', () => {
	const r = live(event({ completed: false, name: 'STATUS_SCHEDULED', status: '1/10 - 7:00 PM', home: '0', away: '0' }))
	assert.deepEqual([r.status, r.homeScore, r.awayScore, r.ending], ['scheduled', null, null, null])
	assert.equal(live(event(), { knows: () => false }), null)
})

test('ESPN\'s notes name the rounds it marks, from 2022', () => {
	const round = (headline) => live(event({ type: 3, notes: [{ headline }] }))
	assert.deepEqual(['stage', 'round'].map((k) => round('NCAA Men\'s Hockey Championship - Fargo Regional Semifinal')[k]), ['S16', 'playoff'])
	assert.equal(round('NCAA Men\'s Hockey Championship - Fargo Regional Final').stage, 'E8')
	assert.deepEqual(['stage', 'round'].map((k) => round('NCAA Men\'s Hockey National Championship')[k]), ['FINAL', 'championship'])
	assert.equal(live(event({ type: 3 })).stage, 'NCAA')
})

test('a Frozen Four game is F4', () => {
	assert.equal(live(event({ type: 3, notes: [{ headline: 'NCAA Men\'s Hockey Championship - Frozen Four' }] })).stage, 'F4')
})

test('an event carries what the games file keeps', () => {
	const g = eventFields(event({ notes: [{ headline: 'Beanpot Tournament' }] }), '20260110')
	assert.deepEqual([g.homeName, g.awayName, g.title, g.played], ['Denver', 'Wisconsin', 'Beanpot Tournament', true])
})

const SIXTEEN = `{{16TeamBracket
|subgroup1='''Midwest''' – '''[[Scheels Arena|Fargo]]''' – Fri/Sat
|RD1-seed01=1
|RD1-team01=[[2023–24 Boston College Eagles men's ice hockey season|Boston College]] (1)
|RD1-score01=6
|RD1-seed02=4
|RD1-team02='''Michigan Tech'''
|RD1-score02=7*
|RD1-seed03=2
|RD1-team03=<s>Michigan</s><sup>†</sup>
|RD1-score03=–
|RD1-seed04='''3'''
|RD1-team04='''Minnesota–Duluth'''
|RD1-score04=–
|RD4-seed01=E3
|RD4-team01=Yale
|RD4-score01=4
|RD4-seed02=W2
|RD4-team02=Quinnipiac
|RD4-score02=0
}}`

test('a bracket: its link and bold ways of writing a name, overall seeds, overtime, and a game nobody played', () => {
	const g = bracketGames(SIXTEEN)
	assert.equal(g.length, 2)
	assert.deepEqual([g[0].stage, g[0].region, g[0].team1, g[0].team2, g[0].score1, g[0].score2, g[0].seed1, g[0].overall1, g[0].ot],
		['S16', 'Midwest', 'Boston College', 'Michigan Tech', 6, 7, '1', 1, true])
	assert.deepEqual([g[1].stage, g[1].team1, g[1].score1, g[1].region], ['FINAL', 'Yale', 4, null])
})

test('2013\'s page draws each regional as its own bracket', () => {
	const page = `==Regionals==
===East Regional – [[Providence, Rhode Island]]===
{{4TeamBracket
| RD1-seed1=1
| RD1-team1='''Quinnipiac (1)'''
| RD1-score1= '''4'''
| RD1-seed2=4
| RD1-team2=Canisius
| RD1-score2= 3
| RD2-seed1=1
| RD2-team1=Quinnipiac
| RD2-score1=5
| RD2-seed2=3
| RD2-team2=Union
| RD2-score2=1
}}
==Frozen Four==
{{4TeamBracket
| RD1-seed1=1
| RD1-team1=Quinnipiac
| RD1-score1=4
| RD1-seed2=2
| RD1-team2=St. Cloud State
| RD1-score2=1
| RD2-seed1=1
| RD2-team1=Quinnipiac
| RD2-score1=0
| RD2-seed2=4
| RD2-team2=Yale
| RD2-score2=4
}}`
	assert.deepEqual(bracketGames(page).map((g) => [g.stage, g.region, g.team1]), [
		['S16', 'East', 'Quinnipiac'], ['E8', 'East', 'Quinnipiac'], ['F4', null, 'Quinnipiac'], ['FINAL', null, 'Quinnipiac'],
	])
})

test('a row of the file becomes a game, and what it says about the round holds', () => {
	const r = gameRow({ id: 'wp2015002', season: '2015', date: '2015-03-27', stage: 'S16', ending: 'REG', home: '155', home_name: 'North Dakota', home_score: '4', away: '2514', away_name: 'Quinnipiac', away_score: '1', neutral: 'true', source: 'wikipedia', title: '' })
	assert.deepEqual([r.round, r.stage, r.homeScore, r.neutral, r.status, r.source, r.title], ['playoff', 'S16', 4, true, 'final', 'wikipedia', null])
	assert.equal(gameRow({ id: '1', season: '2015', date: '2015-01-01', stage: 'FINAL', ending: 'REG', home: '1', home_score: '1', away: '2', away_score: '0', neutral: 'true', source: 'ncaah-file' }).round, 'championship')
})

test('the file: every season from 2003-04, its games a real season\'s, and no game twice', () => {
	const rows = games()
	const by = Map.groupBy(rows, (g) => Number(g.season))
	assert.deepEqual([...by.keys()].sort((a, b) => a - b)[0], sources.history.from)
	for (const [season, list] of by) {
		// 2020-21 was the short one; 2019-20 stopped before its tournament.
		assert.ok(list.length >= (season === 2021 ? 500 : 1000), `${season}: ${list.length}`)
		assert.ok(list.every((g) => g.date > `${season - 1}-08` && g.date < `${season}-05`), `${season}: a date out of its season`)
	}
	assert.equal(new Set(rows.map((g) => g.id)).size, rows.length)
	const seen = new Set()
	for (const g of rows) {
		const key = `${g.date} ${[g.home, g.away].sort().join(' ')}`
		assert.ok(!seen.has(key), `twice: ${key}`)
		seen.add(key)
	}
})

test('every tournament is whole: fifteen games, thirteen in 2021, none in 2020, one final', () => {
	const by = Map.groupBy(games().filter((g) => g.stage), (g) => Number(g.season))
	assert.equal(by.has(2020), false)
	for (const [season, list] of by) {
		assert.equal(list.length, season === 2021 ? 13 : 15, String(season))
		assert.equal(list.filter((g) => g.stage === 'FINAL').length, 1)
		assert.equal(list.filter((g) => g.stage === 'F4').length, 2)
		assert.ok(list.every((g) => g.neutral === 'true'))
		assert.ok(list.every((g) => g.home_score !== g.away_score), `${season}: a tournament game tied`)
	}
	assert.equal(games().filter((g) => g.source === 'wikipedia').length, 9)
})

test('the finals name the champions the table does, up to where the table stops', () => {
	const table = parseCsv(read('data/reference/ncaah-champions.csv'))
	const franchises = parseCsv(read('data/reference/ncaah-franchise-history.csv'))
	const codeOf = new Map(franchises.map((r) => [r.idAbbrv, r.franchiseAbbrv]))
	const winner = new Map(games().filter((g) => g.stage === 'FINAL')
		.map((g) => [Number(g.season), codeOf.get(Number(g.home_score) > Number(g.away_score) ? g.home : g.away)]))
	const checked = table.filter((r) => winner.has(Number(r.season)))
	assert.ok(checked.length >= 12)
	for (const r of checked) assert.equal(winner.get(Number(r.season)), r.champion, r.season)
})

test('champions from 1948, none of them lost, and 2003 the last with no game', () => {
	const rows = parseCsv(read('data/reference/ncaah-champions.csv'))
	assert.equal(rows[0].season, '1948')
	assert.equal(rows[0].championName, 'Michigan')
	assert.equal(rows.find((r) => r.season === '2003').championName, 'Minnesota')
	assert.ok(rows.every((r) => r.champion))
})

test('every game names a club or an opponent, and a manifest for every club', async () => {
	const franchises = parseCsv(read('data/reference/ncaah-franchise-history.csv'))
	const clubs = new Set(franchises.map((r) => r.idAbbrv))
	const others = new Set(parseCsv(read('data/reference/ncaah-opponents.csv')).map((r) => r.id))
	const named = (id) => clubs.has(id) || others.has(id)
	for (const g of games()) assert.ok(named(g.home) || named(g.away), g.id)
	assert.equal(readdirSync(join(ROOT, 'teams/ncaah')).length, franchises.length)
	assert.equal(franchises.length, 63)
	const codes = codeTable('ncaah', loadHistory('ncaah'))
	assert.ok(codes.knows('2172'))
	assert.equal((await loadTeams()).filter((t) => t.sport === 'ncaah').length, 63)
})

test('every club has a colour, and its school\'s, not whoever holds its id elsewhere', () => {
	const rows = parseCsv(read('data/reference/ncaah-franchise-history.csv'))
	for (const r of rows) assert.match(r.colorA, /^#[0-9A-F]{6}$/, r.city)
	const by = (id) => rows.find((r) => r.idAbbrv === id)
	// Virginia Tech's, Washington State's and an English club's, had ids been trusted.
	assert.notEqual(by('132').colorA, '#7B2129')
	assert.notEqual(by('134').colorA, '#94022A')
	assert.notEqual(by('2594').colorA, '#C8142F')
	assert.equal(by('2172').city, 'Denver')
})

test('white text can be read on every club\'s ground', () => {
	const lum = (hex) => {
		const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
			.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
		return 0.2126 * r + 0.7152 * g + 0.0722 * b
	}
	const contrast = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)
	const rows = parseCsv(read('data/reference/ncaah-franchise-history.csv'))
	for (const r of rows) {
		assert.ok(contrast(r.colorA, '#FFFFFF') >= 3, `${r.city} ${r.colorA}`)
		if (r.colorB) assert.ok(contrast(r.colorA, r.colorB) >= 2.5, `${r.city}'s accent ${r.colorB}`)
	}
	const tech = rows.find((r) => r.city === 'Michigan Tech')
	assert.deepEqual([tech.colorA, tech.colorB], ['#000000', '#FFCD00'])
})

test('the adapter says what the rest of the site asks of it', () => {
	assert.equal(sport.id, 'ncaah')
	assert.equal(sport.championshipTitle(), 'NCAA Tournament')
	assert.ok(sport.defaults.records.includes('ties'))
	assert.equal(sources.live.seasonOf(new Date('2026-10-31')), 2027)
	assert.equal(sources.live.seasonOf(new Date('2026-04-11')), 2026)
	assert.ok(!sources.live.url('20260110').includes('groups'))
	assert.equal(sources.live.daysOf(2026).length, 208)
})
