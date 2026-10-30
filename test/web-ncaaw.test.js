// Women's college basketball's page (web/ncaaw), men's with the WNIT's name and
// women's notes, and its bracket's seeds and regions (scripts/ncaaw-seeds.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILY, ESPN_LEAGUE, TEMPLATES } from '../lib/web.js'
import { POLLED } from '../lib/polls.js'
import { BRACKETED } from '../lib/seasons.js'
import { buildBracket, bracketPage, nitGames, tournamentSeeds } from '../lib/bracket.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
globalThis.CLUB = { team: 'UConn Huskies', fullName: 'UConn Huskies', teamIds: ['CONN'], copy: {}, site: { espnAbbr: 'CONN', espnSlug: '41' } }
const { SITE } = await import('../web/ncaaw/site.js')
const { roundCodeOf, ROUND_LABEL, ROUND_ORDER, parseCurrentNamesCsv } = await import('../web/ncaaw/records-core.js')
const { postseasonTier } = await import('../web/ncaaw/history-chart.js')

test('women\'s is men\'s page, with its own league and polls', () => {
	assert.equal(FAMILY.ncaaw, 'mlb')
	assert.equal(ESPN_LEAGUE.ncaaw, 'basketball/womens-college-basketball')
	assert.equal(TEMPLATES.ncaaw, TEMPLATES.mlb)
	assert.equal(POLLED.ncaaw.league, 'basketball/womens-college-basketball')
	assert.equal(BRACKETED.has('ncaaw'), true)
	assert.equal(SITE.seasonLabel(2015), '2014-2015')
})

test('ESPN\'s women\'s notes and the page\'s round names land on the same codes', () => {
	assert.deepEqual([
		'NCAA Women\'s Championship - First Four',
		'NCAA Women\'s Championship - Regional 3 in Birmingham - 1st Round',
		'NCAA Women\'s Championship - Regional 4 in Spokane - 2nd Round',
		'NCAA Women\'s Championship - Regional 4 in Spokane - Sweet 16',
		'NCAA WOMEN\'S CHAMPIONSHIP - DES MOINES REGION - ELITE 8',
		'NCAA Women\'s Championship - Final Four',
		'NCAA Women\'s Championship - National Championship',
		'NCAA Women\'s Championship',
		'WNIT - First Round',
		'Women\'s NIT - Championship',
		'WOMEN\'S NIT - CHAMPIONSHIP',
		'Women\'s Basketball Invitation Tournament - Final',
		'WBIT - Second Round',
	].map(roundCodeOf), ['FF', 'R64', 'R32', 'S16', 'E8', 'F4', 'W', 'NCAA', 'NIT', 'NIT', 'NIT', 'POST', 'POST'])
	for (const code of Object.keys(ROUND_ORDER)) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
	assert.equal(ROUND_LABEL.NIT, 'WNIT')
	assert.equal(postseasonTier({ postseason: 'NIT' }), 'other')
})

test('every tournament\'s seeds: 32 first-round games, four regions, 1 to 16 in each', () => {
	const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/ncaaw-seeds.csv'), 'utf8'))
	const seasons = Map.groupBy(rows, (r) => Number(r.season))
	assert.ok(seasons.size >= 25)
	assert.equal(seasons.has(2020), false, 'the 2020 tournament was cancelled')
	for (const [season, games] of seasons) {
		const opening = Map.groupBy(games.filter((g) => g.region), (g) => g.region)
		assert.equal(opening.size, 4, `${season}'s regions`)
		for (const [region, list] of opening) {
			assert.equal(list.length, 8, `${season} ${region}`)
			assert.ok(list.every((g) => Number(g.home_seed) + Number(g.away_seed) === 17), `${season} ${region}'s pairings`)
			assert.deepEqual(list.flatMap((g) => [Number(g.home_seed), Number(g.away_seed)]).sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1))
		}
		// The First Four came in with the 68-team field of 2022.
		assert.equal(games.length, season >= 2022 ? 36 : 32, `${season}'s games`)
	}
})

const game = (id, home, away, homeScore, awayScore, date, stage, title = '') => ({ id, season: 2027, date, stage, home, away, homeScore, awayScore, title })

test('a women\'s region is named by its seeds file, whatever the games\' titles say', () => {
	const final = game('9', 'A', 'B', 70, 60, '2027-04-05', 'FINAL')
	const semis = [game('7', 'A', 'C', 70, 60, '2027-04-03', 'F4'), game('8', 'B', 'D', 70, 60, '2027-04-03', 'F4')]
	const tops = ['A', 'C', 'B', 'D'].map((t, i) => game(`e${i}`, t, `${t}2`, 70, 60, '2027-03-28', 'E8', 'NCAA WOMEN\'S CHAMPIONSHIP'))
	const seeds = new Map(tops.map((g, i) => [g.id, { region: `City ${i} regional` }]))
	const { regions } = buildBracket([final, ...semis, ...tops], { seeds, finalId: '9' })
	assert.deepEqual(regions.map((r) => r.name).sort(), ['City 0 regional', 'City 1 regional', 'City 2 regional', 'City 3 regional'])
})

test('the WNIT\'s final by its title, and a game\'s summary links women\'s ESPN', () => {
	const games = [game('1', 'A', 'B', 70, 60, '2027-04-01', 'NIT', 'Women\'s NIT - Semifinals'), game('2', 'A', 'C', 70, 60, '2027-04-05', 'NIT', 'WNIT CHAMPIONSHIP')]
	assert.deepEqual(nitGames(games).map((g) => g.stage), ['NIT', 'FINAL'])
	const bracket = buildBracket(nitGames(games), { halves: true })
	const html = bracketPage({ season: 2027, seasons: [2027], bracket, team: (code) => ({ name: code, href: null }), heading: '2026-2027 WNIT',
		colors: { base: '#111', accent: '#eee', dark: [], light: [] }, summaryUrl: '/ncaaw/api/espn/x/summary?event=', espnLeague: 'womens-college-basketball' })
	assert.match(html, /espn\.com\/womens-college-basketball\/game/)
	assert.doesNotMatch(html, /espn\.com\/mens-college-basketball/)
})

test('the file reads by sport: women\'s has regions, men\'s cities', () => {
	const [{ region }] = [...tournamentSeeds('ncaaw', 2015).values()]
	assert.match(region, /regional$/)
	assert.deepEqual([...tournamentSeeds('ncaam', 2025).values()].every((s) => s.region === null), true)
})

test('a club with little or no record has share lines all the same, in every sport', async () => {
	// UConn has never opened a season with a loss, and West Florida had played
	// three games: each list came up empty, its first entry was read anyway, and
	// the whole records page said it could not load the game data.
	const empty = new Proxy({}, { get: () => [] })
	const lists = ['best-starts', 'worst-starts', 'win-streaks', 'losing-streaks', 'lopsided-wins', 'worst-losses', 'best-seasons', 'worst-seasons']
	for (const sport of ['mlb', 'nfl', 'nba', 'nhl', 'wnba', 'mls', 'ncaaf', 'ncaam', 'ncaaw']) {
		const { recordsCopy } = await import(`../web/${sport}/records-core.js`)
		for (const slug of lists) assert.ok(recordsCopy(slug, empty).title, `${sport} ${slug}`)
	}
})

test('an opponent that is no club reads by its school, with no mascot', () => {
	const names = 'franchiseName,teamName,league,division,city,team,alternate,startDate,endDate,locationCity,locationState\nCONN,CONN,NCAAW,,UConn,Huskies,,10/1/2000,,,\n42,42,NCAAW,,Hartford,,,,,,\n'
	assert.deepEqual(parseCurrentNamesCsv(names).teamNames, { CONN: 'UConn Huskies', 42: 'Hartford' })
})
