// Men's college hockey's page (web/ncaah): women's basketball's with the NHL's
// periods, and its bracket's seeds and regions (scripts/ncaah-games.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILY, ESPN_LEAGUE, TEMPLATES } from '../lib/web.js'
import { POLLED, createPolls, latestOf, weeksOf } from '../lib/polls.js'
import { BRACKETED, HAS_NIT } from '../lib/seasons.js'
import { buildBracket, bracketPage, tournamentSeeds } from '../lib/bracket.js'
import { parseCsv } from '../lib/csv.js'
import { rankingsPage } from '../lib/render.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
globalThis.CLUB = { team: 'Denver Pioneers', fullName: 'Denver Pioneers', teamIds: ['DEN'], copy: {}, site: { espnAbbr: 'DEN', espnSlug: '2172' } }
const { SITE } = await import('../web/ncaah/site.js')
const { espnEnding, roundCodeOf, ROUND_LABEL, ROUND_ORDER } = await import('../web/ncaah/records-core.js')
const { postseasonTier, POSTSEASON } = await import('../web/ncaah/history-chart.js')

test('hockey is women\'s page, with its own league, words and poll', () => {
	assert.equal(FAMILY.ncaah, 'mlb')
	assert.equal(ESPN_LEAGUE.ncaah, 'hockey/mens-college-hockey')
	assert.equal(TEMPLATES.ncaah, TEMPLATES.mlb)
	assert.equal(POLLED.ncaah.league, 'hockey/mens-college-hockey')
	assert.equal(BRACKETED.has('ncaah'), true)
	assert.equal(HAS_NIT.has('ncaah'), false)
	assert.equal(SITE.scoreNoun, 'goals')
	assert.equal(SITE.seasonLabel(2026), '2025-2026')
	assert.ok(SITE.records.includes('ties'))
})

test('ESPN\'s hockey notes and the page\'s round names land on the same codes', () => {
	assert.deepEqual([
		'NCAA Men\'s Hockey Championship - Fargo Regional Semifinal',
		'NCAA Men\'s Hockey Championship - Fargo Regional Final',
		'NCAA Men\'s Hockey Championship - Frozen Four',
		'NCAA Men\'s Hockey National Championship',
		'NCAA Men\'s Hockey Championship',
	].map(roundCodeOf), ['S16', 'E8', 'F4', 'W', 'NCAA'])
	for (const code of ['S16', 'E8', 'F4', 'W', 'NCAA']) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
	assert.ok(ROUND_ORDER.W > ROUND_ORDER.F4)
	assert.equal(postseasonTier({ postseason: 'F4' }), 'lcs')
	assert.equal(POSTSEASON.lcs.label, 'Frozen Four')
})

test('no basketball is left in what a visitor reads', () => {
	const words = /Final Four|Sweet 16|Elite Eight|\bW?NIT\b|Top 25|🏀/
	const page = readdirSync(join(ROOT, 'web/ncaah')).filter((f) => /\.(js|html)$/.test(f))
	const allowed = new Set(['league-core.js'])
	for (const f of page.filter((n) => !allowed.has(n))) {
		const text = read(`web/ncaah/${f}`).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
		// The round's code is the page's own, shared with basketball's; its label is not.
		assert.doesNotMatch(text.replace(/\bNIT\b(?=:|')/g, ''), words, f)
	}
})

test('a game\'s ending, from ESPN\'s status, and its line score\'s three periods', () => {
	const ended = (shortDetail, period = 3) => espnEnding({ competitions: [{ status: { period, type: { shortDetail } } }] })
	assert.equal(ended('Final'), 'REG')
	assert.equal(ended('Final/OT', 4), 'OT')
	assert.equal(ended('Final/2OT', 5), 'OT')
	assert.equal(ended('Final/SO', 5), 'SO')
	const main = read('web/ncaah/main.js')
	assert.match(main, /i < 3 \? String\(i \+ 1\) : i === 3 \? 'OT'/)
	assert.match(main, /endingSuffix\(g\.ending\)/)
})

test('USCHO\'s poll: its id is this week\'s, not the AP\'s, and only for hockey', async () => {
	assert.equal(latestOf({ rankings: [{ id: '10624' }], latestSeason: { year: 2027 }, latestWeek: { number: 5 } }).poll, 10624)
	assert.match(weeksOf(2027, 1, 'ncaah', 10624)[0].url, /hockey\/leagues\/mens-college-hockey\/seasons\/2027\/types\/2\/weeks\/1\/rankings\/10624$/)
	assert.match(weeksOf(2027, 1, 'ncaam')[0].url, /rankings\/1$/)
	const asked = []
	const polls = createPolls({
		sport: 'ncaah',
		getJson: async (url) => {
			asked.push(url)
			if (url.endsWith('/rankings')) return { rankings: [{ id: '10624' }], latestSeason: { year: 2027 }, latestWeek: { number: 2 } }
			return { ranks: [{ current: 3, team: { $ref: 'x/seasons/2027/teams/2172?lang=en' } }] }
		},
	})
	const got = await polls()
	assert.equal(got.length, 2)
	assert.equal(got[1].ranks.get('2172'), 3)
	assert.ok(asked.slice(1).every((u) => u.endsWith('/rankings/10624')))
})

test('a poll ESPN has no votes for shows none, rather than a column of zeros', () => {
	const poll = (points, firstPlaceVotes) => ({
		type: 'USCHOMENSPOLL', name: 'USCHO Men\'s Poll', week: 'Week 5',
		ranks: [{ current: 1, previous: 1, points, firstPlaceVotes, record: '7-0', team: { id: '130', name: 'Michigan Wolverines', school: 'Michigan' } }],
		others: [{ points, team: { id: '111', name: 'Northeastern Huskies' } }],
	})
	const page = (p) => rankingsPage({ polls: [p], heading: 'x', colors: {}, clubUrl: () => null, footer: '' })
	const none = page(poll(0, 0))
	assert.match(none, /Others receiving votes: Northeastern Huskies</)
	assert.doesNotMatch(none, /first-place votes/)
	const some = page(poll(76, 3))
	assert.match(some, /Northeastern Huskies 76/)
	assert.match(some, /In brackets, first-place votes/)
})

const seedRows = () => parseCsv(read('data/reference/ncaah-seeds.csv'))

test('every tournament\'s seeds: four regions, 1 to 4 meeting 4 to 1', () => {
	const seasons = Map.groupBy(seedRows(), (r) => Number(r.season))
	assert.equal(seasons.has(2020), false, 'the 2020 tournament was cancelled')
	assert.equal(seasons.size, 22)
	for (const [season, games] of seasons) {
		const regions = Map.groupBy(games.filter((g) => g.region), (g) => g.region)
		assert.equal(regions.size, 4, `${season}'s regions`)
		for (const list of regions.values()) assert.ok(list.every((g) => /^[1-4]$/.test(g.home_seed) && /^[1-4]$/.test(g.away_seed)), `${season}'s seeds`)
	}
})

const games = () => parseCsv(read('data/reference/ncaah-games.csv'))
const storeRows = (season) => games().filter((g) => Number(g.season) === season && g.stage).map((g) => ({
	id: g.id, season, date: g.date, stage: g.stage, home: g.home, away: g.away, title: g.title || null, status: 'final',
	homeScore: Number(g.home_score), awayScore: Number(g.away_score),
}))

test('every bracket places every game, though a regional\'s rounds can share a date', () => {
	for (const season of new Set(seedRows().map((r) => Number(r.season)))) {
		const b = buildBracket(storeRows(season), { seeds: tournamentSeeds('ncaah', season) })
		assert.deepEqual(b.unplaced.map((g) => g.id), [], String(season))
		assert.equal(b.regions.length, 4, String(season))
		assert.equal(b.semis.length, 2, String(season))
	}
	const sameDay = Map.groupBy(storeRows(2011).filter((g) => g.stage === 'S16' || g.stage === 'E8'), (g) => g.date)
	assert.ok([...sameDay.values()].some((l) => new Set(l.map((g) => g.stage)).size === 2), '2011 is a season it matters in')
})

test('a bracket page says Frozen Four, and its summary counts three periods and hockey\'s numbers', () => {
	const bracket = buildBracket(storeRows(2026), { seeds: tournamentSeeds('ncaah', 2026) })
	const html = bracketPage({
		season: 2026, seasons: [2025, 2026], bracket, team: (code) => ({ name: code, href: null }), heading: '2025-2026 NCAA Tournament', colors: {},
		finalTitle: 'Frozen Four', summaryUrl: '/ncaah/api/espn/apis/site/v2/sports/hockey/mens-college-hockey/summary?event=', base: '/ncaah/bracket', espnLeague: 'mens-college-hockey',
	})
	assert.match(html, /Frozen Four/)
	assert.doesNotMatch(html, /Final Four/)
	assert.match(html, /const HOCKEY = true/)
	assert.match(html, /shotsTotal/)
	assert.match(html, /espn\.com\/mens-college-hockey\/game/)
})

test('a game Wikipedia alone has opens no summary: ESPN has none to give', () => {
	const bracket = buildBracket(storeRows(2019), { seeds: tournamentSeeds('ncaah', 2019) })
	const html = bracketPage({
		season: 2019, seasons: [2019], bracket, team: (code) => ({ name: code, href: null }), heading: 'x', colors: {},
		summaryUrl: '/x?event=', base: '/ncaah/bracket', espnLeague: 'mens-college-hockey',
	})
	assert.equal((html.match(/data-game="/g) ?? []).length, 12)
})

test('the spring workflow adds hockey\'s season, and a run with nothing new writes nothing', () => {
	assert.match(read('.github/workflows/seeds.yml'), /node scripts\/ncaah-games\.mjs/)
	const script = read('scripts/ncaah-games.mjs')
	assert.match(script, /Nothing new: the files reach/)
	assert.match(script, /season === 2021 \? 13 : 15/)
})

test('the limitations say what the reader needs about a shootout and the missing games', async () => {
	const { BY_SPORT } = await import('../lib/limitations.js')
	const text = BY_SPORT.ncaah.join(' ')
	assert.match(text, /shootout counts as a tie/)
	assert.match(text, /178 games/)
	assert.match(text, /USCHO/)
})
