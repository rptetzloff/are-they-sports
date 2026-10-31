// Men's college lacrosse: ESPN's scoreboards, kept in data/reference from 2025.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'
import { choosePalette, contrast } from '../lib/palette.js'
import { endingOf, eventFields, gameRow, liveGameRow, sources, stageOf } from '../sports/ncaal.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const games = () => parseCsv(read('data/reference/ncaal-games.csv'))
const clubs = () => parseCsv(read('data/reference/ncaal-franchise-history.csv'))

const event = ({ note, status = 'STATUS_FINAL', detail = 'Final', completed = true, home = '14', away = '9' } = {}) => ({
	id: '401870924', date: '2026-05-23T17:00Z', season: { year: 2026, type: 2 },
	competitions: [{
		neutralSite: false,
		notes: note ? [{ headline: note }] : [],
		status: { type: { name: status, shortDetail: detail, completed } },
		competitors: [
			{ homeAway: 'home', score: home, team: { id: '163', location: 'Princeton' } },
			{ homeAway: 'away', score: away, team: { id: '150', location: 'Duke' } },
		],
	}],
})

test('a tournament game\'s round is read from ESPN\'s note, since ESPN files it as the regular season', () => {
	const of = (round) => stageOf(`NCAA Men's Lacrosse Championship - ${round}`)
	assert.deepEqual(['Opening Round', 'First Round', 'Quarterfinals', 'Semifinals', 'Final'].map(of), ['FF', 'S16', 'E8', 'F4', 'FINAL'])
	assert.equal(stageOf('ACC Tournament - Semifinals'), null, 'a conference\'s tournament is the regular season\'s')
	assert.equal(stageOf('Ivy League Tournament Championship'), null)
	assert.equal(stageOf(''), null)
})

test('an event becomes fields: the semifinal is neutral, overtime is one ending, a called-off game is nothing', () => {
	const g = eventFields(event({ note: 'NCAA Men\'s Lacrosse Championship - Semifinals' }), '20260523')
	assert.equal(g.stage, 'F4')
	assert.equal(g.neutral, true)
	assert.equal(g.title, null)
	assert.equal(g.season, 2026)
	assert.equal(eventFields(event({ note: 'ACC Tournament - Semifinals' }), '20260424').title, 'ACC Tournament - Semifinals')
	assert.deepEqual(['Final', 'Final/OT', 'Final/2OT', 'Final/3OT'].map(endingOf), ['REG', 'OT', 'OT', 'OT'])
	assert.equal(eventFields(event({ status: 'STATUS_POSTPONED', completed: false, home: '0', away: '0' })), null)
	assert.equal(eventFields(event({ status: 'STATUS_CANCELED', completed: false, home: '0', away: '0' })), null)
})

test('a live game between two non-clubs is no row, and a season is the spring it is played', () => {
	assert.equal(liveGameRow(event(), { franchiseOf: (id) => id, knows: () => false }), null)
	assert.equal(liveGameRow(event(), { franchiseOf: () => 'PRIN', knows: () => true }).home, 'PRIN')
	assert.equal(sources.live.seasonOf(new Date('2026-05-25T12:00:00Z')), 2026)
	assert.equal(sources.live.seasonOf(new Date('2026-10-31T12:00:00Z')), 2027, 'next spring\'s schedule, from August')
	assert.equal(sources.live.daysOf(2026).at(-1), '20260605')
})

test('every season in the file is whole: a tournament of 17, a final, nothing level', () => {
	const rows = games()
	const seasons = Map.groupBy(rows, (g) => Number(g.season))
	assert.deepEqual([...seasons.keys()], [2025, 2026])
	assert.equal(seasons.get(2025).length, 577)
	assert.equal(seasons.get(2026).length, 570, 'the other nine of ESPN\'s 579 were postponed or cancelled')
	for (const [season, list] of seasons) {
		const rounds = Map.groupBy(list.filter((g) => g.stage), (g) => g.stage)
		assert.deepEqual([...rounds].map(([s, l]) => [s, l.length]).sort(), [['E8', 4], ['F4', 2], ['FF', 2], ['FINAL', 1], ['S16', 8]], String(season))
	}
	assert.ok(rows.every((g) => g.home_score !== g.away_score), 'overtime goes on until someone scores')
	assert.deepEqual(rows.filter((g) => g.stage === 'FINAL').map((g) => gameRow(g).round), ['championship', 'championship'])
})

test('the clubs: 77, each with a schedule, a conference and a page, and every game names two of them', () => {
	const list = clubs()
	assert.equal(list.length, 77)
	assert.equal(readdirSync(join(ROOT, 'teams/ncaal')).length, 77)
	const ids = new Set(list.map((c) => c.idAbbrv))
	assert.ok(games().every((g) => ids.has(g.home) && ids.has(g.away)))
	assert.ok(list.every((c) => c.conference), 'a club with no conference')
	assert.deepEqual([...new Set(list.map((c) => c.conference))].sort(), ['ACC', 'ASUN', 'America East', 'Atlantic 10', 'Big East', 'Big Ten', 'CAA', 'Ivy League', 'MAAC', 'NEC', 'Patriot League'])
	const by = (city) => list.find((c) => c.city === city)
	assert.equal(by('Massachusetts').teamName, 'Minutemen', 'ESPN\'s Minutewomen')
	assert.equal(by('Syracuse').conference, 'ACC')
	assert.equal(by('Denver').conference, 'Big East')
})

test('white text can be read on every club\'s ground', () => {
	for (const c of clubs()) {
		const { base } = choosePalette([c.colorA, c.colorB, c.colorC, c.colorD, c.colorE].filter(Boolean), { base: '#2a2a2a', accent: '#ffffff' })
		assert.ok(contrast(base, '#FFFFFF') >= 3.5, `${c.city} ${base}`)
	}
})

test('the champions before the games are Wikipedia\'s, and its last two agree with the finals', () => {
	const rows = parseCsv(read('data/reference/ncaal-champions.csv'))
	assert.equal(rows[0].season, '1971')
	assert.equal(rows[0].championName, 'Cornell')
	assert.equal(rows.some((r) => r.season === '2020'), false, 'cancelled')
	const codeOf = new Map(clubs().map((c) => [c.idAbbrv, c.franchiseAbbrv]))
	for (const g of games().filter((x) => x.stage === 'FINAL')) {
		const won = Number(g.home_score) > Number(g.away_score) ? g.home : g.away
		assert.equal(rows.find((r) => r.season === g.season).champion, codeOf.get(won), g.season)
	}
})
