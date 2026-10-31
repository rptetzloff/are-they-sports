// Men's college basketball's rankings (Ray, 2026-10-27), as college
// football's (test/ncaaf-rankings.test.js): the week's polls on
// /ncaam/rankings, a team's place beside its name, its rank week by week.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { siteFooterHtml } from '../lib/render.js'
import { weeksOf, rankingsUrl, POLLED } from '../lib/polls.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('basketball\'s polls are ESPN\'s, its preseason poll the regular season\'s week 1', () => {
	assert.deepEqual(Object.keys(POLLED), ['ncaaf', 'ncaam', 'ncaaw', 'ncaah'])
	assert.equal(rankingsUrl('ncaam'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings')
	const core = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/2027/types/2/weeks'
	assert.deepEqual(weeksOf(2027, 2, 'ncaam'), [
		{ url: `${core}/1/rankings/1`, label: 'Preseason' },
		{ url: `${core}/2/rankings/1`, label: 'Week 2' },
	])
	// Football's keeps its own preseason season type.
	assert.match(weeksOf(2026, 1)[0].url, /college-football\/seasons\/2026\/types\/1\/weeks\/1\//)
	assert.equal(weeksOf(2026, 1).length, 2)
})

test('the footer links the polls on men\'s basketball\'s pages, not the NBA\'s', () => {
	assert.match(siteFooterHtml({ sport: 'ncaam' }), /href="\/ncaam\/rankings"[^>]*><i class="mdi mdi-format-list-numbered"><\/i><span class="footer-nav-label">Rankings/)
	assert.doesNotMatch(siteFooterHtml({ sport: 'nba' }), /rankings/)
})

test('a programme\'s page asks where it is ranked, and an opponent\'s rank is beside its name', async () => {
	const { createFront } = await import('../lib/web-routes.js')
	const { loadTeams, loadSports } = await import('../lib/teams.js')
	const { resolver, loadHistory } = await import('../lib/names.js')
	const teams = await loadTeams()
	const adapters = await loadSports()
	const espn = { rankings: [{ name: 'AP Top 25', type: 'ap', occurrence: { displayValue: 'Preseason' }, ranks: [
		{ current: 1, previous: 0, points: 1500, recordSummary: '0-0', team: { id: '57', location: 'Florida', name: 'Gators' } },
		{ current: 2, previous: 0, points: 1400, recordSummary: '0-0', team: { id: '275', location: 'Wisconsin', name: 'Badgers' } }] }] }
	let asked = null
	const espnStub = async (url) => { asked = url; return url.endsWith('/rankings') ? { status: 200, body: JSON.stringify(espn) } : null }
	const front = await createFront({
		league: false, team: teams.find((t) => t.sport === 'ncaam' && t.id === 'wisconsin'), franchise: 'WIS', adapter: adapters.ncaam,
		namer: resolver('ncaam'), history: loadHistory('ncaam'), currentCodes: new Set(), palette: null, base: '/ncaam/wisconsin',
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map() },
		creditHtml: '', origin: () => 'http://x', espn: espnStub,
		clubs: [{ sport: 'ncaam', teamId: 'wisconsin', name: 'Wisconsin Badgers', href: '/ncaam/wisconsin/' }],
		polls: async () => [{ label: 'Preseason', ranks: new Map([['275', 2]]) }],
	})
	let body = ''
	const res = { writeHead() {}, end(b) { body = String(b ?? '') } }
	assert.equal(await front({ headers: {} }, res, '/api/rank', new URL('http://x/api/rank'), () => {}), true)
	assert.equal(asked, rankingsUrl('ncaam'))
	const json = JSON.parse(body)
	assert.deepEqual(json.ranks, [{ poll: 'AP', rank: 2 }])
	assert.deepEqual(json.weeks, [{ week: 'Preseason', rank: 2 }])
	assert.equal(json.top.ranks[1].href, '/ncaam/wisconsin/')
	// The page: the rank under the record, the Rankings section, and the
	// opponent's rank on the schedule and the next game's card.
	const main = read('web/ncaam/main.js')
	assert.match(main, /fetch\('api\/rank'\)/)
	assert.match(main, /class="poll-rank" href="\.\.\/rankings"/)
	assert.match(main, /No\. \$\{opp\.curatedRank\.current\}/)
	assert.match(main, /No\. \$\{opponentRank\}/)
	assert.match(read('web/ncaam/index.html'), /id="polls-details"/)
	assert.match(read('web/ncaam/styles.css'), /\.poll-weeks \{/)
})
