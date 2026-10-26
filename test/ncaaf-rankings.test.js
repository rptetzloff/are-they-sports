// College football's rankings (Ray, 2026-10-25: "we need rankings too"): the
// week's polls on /ncaaf/rankings, a team's place beside its name, and each
// season's final AP rank on a programme's history.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRankings, rankingsPage, siteFooterHtml } from '../lib/render.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const espn = {
	rankings: [
		{ name: 'AFCA Coaches Poll', type: 'usa', occurrence: { displayValue: 'Week 9' }, ranks: [
			{ current: 1, previous: 1, points: 1600, firstPlaceVotes: 60, recordSummary: '7-0', team: { id: '2390', location: 'Miami', name: 'Hurricanes' } }] },
		{ name: 'AP Top 25', type: 'ap', occurrence: { displayValue: 'Week 9' }, ranks: [
			{ current: 1, previous: 1, points: 1735, firstPlaceVotes: 59, recordSummary: '7-0', team: { id: '2390', location: 'Miami', name: 'Hurricanes' } },
			{ current: 2, previous: 0, points: 1600, firstPlaceVotes: 0, recordSummary: '6-1', team: { id: '194', location: 'Ohio State', name: 'Buckeyes' } },
			{ current: 3, previous: 1, points: 1500, recordSummary: '6-1', team: { id: '61', location: 'Georgia', name: 'Bulldogs' } }],
			others: [{ points: 76, team: { id: '2294', location: 'Iowa', name: 'Hawkeyes' } }] },
		{ name: 'Empty', type: 'x', ranks: [] },
	],
}

test('ESPN\'s polls, the AP\'s first, each team with its record, points and last week', () => {
	const polls = parseRankings(espn)
	assert.deepEqual(polls.map((p) => p.name), ['AP Top 25', 'AFCA Coaches Poll'], 'an empty poll is left out')
	const [ap] = polls
	assert.deepEqual(ap.ranks[0], { current: 1, previous: 1, points: 1735, firstPlaceVotes: 59, record: '7-0', team: { id: '2390', name: 'Miami Hurricanes', school: 'Miami' } })
	assert.equal(ap.ranks[1].previous, null, 'ESPN\'s 0 is not ranked last week')
	assert.deepEqual(ap.others, [{ points: 76, team: { id: '2294', name: 'Iowa Hawkeyes' } }])
	// The CFP's, when it is out, comes first.
	assert.equal(parseRankings({ rankings: [...espn.rankings, { name: 'CFP Rankings', type: 'cfp', ranks: espn.rankings[1].ranks }] })[0].name, 'CFP Rankings')
})

test('the page links each programme here, and says up, down or new', () => {
	const html = rankingsPage({ polls: parseRankings(espn), heading: 'NCAAF rankings', colors: { base: '#222', accent: '#fff' }, clubUrl: (id) => (id === '194' ? '/ncaaf/ohiostate/' : null) })
	// The full name, and the school alone for a phone.
	assert.match(html, /<a class="season-link strong" href="\/ncaaf\/ohiostate\/"><span class="rk-full">Ohio State Buckeyes<\/span><span class="rk-short">Ohio State<\/span><\/a>/)
	assert.match(html, /<b><span class="rk-full">Miami Hurricanes<\/span><span class="rk-short">Miami<\/span><\/b> <span class="dim">\(59\)<\/span>/)
	assert.match(html, /title="Not ranked last week">new</)
	assert.match(html, /class="rank-down" title="Down from 1">▼2</)
	assert.match(html, /Others receiving votes: Iowa Hawkeyes 76/)
	assert.match(rankingsPage({ polls: [], heading: 'h', colors: { base: '#222', accent: '#fff' } }), /No rankings just now/)
})

test('the footer links the polls on college football\'s pages and no other league\'s', () => {
	assert.match(siteFooterHtml({ sport: 'ncaaf' }), /href="\/ncaaf\/rankings"[^>]*><i class="mdi mdi-format-list-numbered"><\/i><span class="footer-nav-label">Rankings/)
	assert.doesNotMatch(siteFooterHtml({ sport: 'nfl' }), /rankings/)
})

test('a team\'s place in the poll is beside its name on the league page and a club\'s schedule', () => {
	// Every sport's league page is the same file, and only college has ranks.
	for (const s of ['nfl', 'ncaaf']) assert.match(read(`web/${s}/league-core.js`), /rank: c\.curatedRank\?\.current >= 1 && c\.curatedRank\.current <= 25/)
	assert.match(read('web/ncaaf/main.js'), /No\. \$\{opp\.curatedRank\.current\}/)
})

test('each finished season\'s final AP poll from 1936, ranks in order, teams by ESPN id', () => {
	const rows = parseCsv(read('data/reference/ncaaf-ap-final.csv'))
	const seasons = [...new Set(rows.map((r) => Number(r.season)))]
	assert.equal(seasons[0], 1936)
	for (let s = 1936; s <= 2025; s++) assert.ok(seasons.includes(s), `${s} has no final poll`)
	for (const s of seasons) {
		const ranks = rows.filter((r) => Number(r.season) === s).map((r) => Number(r.rank))
		assert.equal(Math.min(...ranks), 1, `${s} has no No. 1`)
		assert.ok(ranks.every((r) => r >= 1 && r <= 25), `${s}`)
	}
	// Agrees with the champions before 1998: the AP's No. 1 is the champion.
	const champs = parseCsv(read('data/reference/ncaaf-champions.csv')).filter((r) => r.method === 'poll')
	for (const c of champs) {
		const first = rows.find((r) => r.season === c.season && r.rank === '1')
		assert.equal(first?.team, c.champion, `${c.season}`)
	}
	assert.ok(rows.some((r) => r.season === '1942' && r.school === 'Wisconsin' && r.rank === '3'))
})

test('a programme\'s page asks where it is ranked this week, and says nothing unranked', async () => {
	const { createFront } = await import('../lib/web-routes.js')
	const { loadTeams, loadSports } = await import('../lib/teams.js')
	const { resolver, loadHistory } = await import('../lib/names.js')
	const teams = await loadTeams()
	const adapters = await loadSports()
	const espnStub = async (url) => (url.endsWith('/rankings') ? { status: 200, body: JSON.stringify(espn) } : null)
	const front = (id, code) => createFront({
		league: false, team: teams.find((t) => t.sport === 'ncaaf' && t.id === id), franchise: code, adapter: adapters.ncaaf,
		namer: resolver('ncaaf'), history: loadHistory('ncaaf'), currentCodes: new Set(), palette: null, base: `/ncaaf/${id}`, clubs: [],
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map() },
		creditHtml: '', origin: () => 'http://x', espn: espnStub,
	})
	const ask = async (id, code) => {
		let body = ''
		const res = { writeHead() {}, end(b) { body = String(b ?? '') } }
		const url = new URL('http://x/api/rank')
		const handled = await (await front(id, code))({ headers: {} }, res, '/api/rank', url, () => {})
		return { handled, json: JSON.parse(body) }
	}
	const osu = await ask('ohiostate', 'OSU')
	assert.equal(osu.handled, true)
	assert.deepEqual(osu.json, { week: 'Week 9', ranks: [{ poll: 'AP', rank: 2 }] })
	const wis = await ask('wisconsin', 'WIS')
	assert.deepEqual(wis.json.ranks, [], 'unranked: no line on the page')
	// The page draws it under the record, linked to the polls.
	assert.match(read('web/ncaaf/main.js'), /fetch\('api\/rank'\)/)
	assert.match(read('web/ncaaf/main.js'), /class="poll-rank" href="\.\.\/rankings"/)
})
