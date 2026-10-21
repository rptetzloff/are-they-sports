import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BY_SPORT, COMMON, limitationsHtml } from '../lib/limitations.js'
import { navFor, createFront } from '../lib/web-routes.js'
import { shell, clubConfig } from '../lib/web.js'
import { SPORTS, loadSports, loadTeams } from '../lib/teams.js'
import { loadHistory, resolver } from '../lib/names.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// The limitations page (Ray, 2026-10-20: "a limitations page that explains
// any limitations to the data that exist").

test('every sport has its own list, and the page escapes it', () => {
	for (const s of SPORTS) assert.ok(BY_SPORT[s]?.length, `${s} has no limitations listed`)
	assert.ok(COMMON.length)
	const html = limitationsHtml('nfl', 'NFL')
	assert.match(html, /<h2 class="history-section-title">NFL<\/h2>/)
	assert.equal((html.match(/<li>/g) ?? []).length, BY_SPORT.nfl.length + COMMON.length)
	assert.ok(html.includes("FiveThirtyEight's game results"), 'an apostrophe was mangled')
	assert.ok(limitationsHtml('nba', '<b>').includes('<h2 class="history-section-title">&lt;b&gt;</h2>'), 'the heading is not escaped')
})

test('"no coaches page" is said exactly where the nav has no coaches link', () => {
	// The line is a fact about the nav, so the nav decides it: when a sport's
	// coaches arrive and its link comes back, this goes red until the line goes.
	for (const s of SPORTS) {
		const linked = /href="(?:coaches|managers)"/.test(navFor(read(`web/${s}/index.html`), s))
		const said = BY_SPORT[s].some((l) => /no coaches page/.test(l))
		assert.equal(said, !linked, `${s}: nav ${linked ? 'links' : 'has no'} coaches page, limitations ${said ? 'say' : 'do not say'} there is none`)
	}
})

test('the Disclaimer links to it, from every page the shell builds', async () => {
	const teams = await loadTeams()
	const cfg = clubConfig({ team: teams.find((t) => t.id === 'brewers'), current: { espnAbbr: 'MIL' } })
	const html = shell(read('web/mlb/index.html'), { config: cfg, creditHtml: '<p>credit</p>' })
	assert.match(html, /<template id="data-credit"><p>credit<\/p><p class="limitations-link"><a href="limitations">What this data does not cover<\/a><\/p><\/template>/)
})

test('a club and a league each serve it, under their own footer', async () => {
	const teams = await loadTeams()
	const adapters = await loadSports()
	const make = (league) => createFront({
		league, team: teams.find((t) => t.sport === 'nfl' && t.id === 'packers'), franchise: 'GB', adapter: adapters.nfl, namer: resolver('nfl'),
		history: loadHistory('nfl'), currentCodes: new Set(), palette: null, base: league ? '/nfl' : '/nfl/packers', clubs: [],
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map() },
		creditHtml: '<p>credit</p>', origin: () => 'http://x',
	})
	const get = async (front, path) => {
		const url = new URL(`http://x${path}`)
		const res = { writeHead() {}, end() {} }
		let body = null
		const handled = await front({ headers: {} }, res, url.pathname, url, (r, b) => { body = b })
		return { handled, body }
	}
	const club = await get(await make(false), '/limitations')
	assert.equal(club.handled, true)
	assert.match(club.body, /<title>Packers Data Limitations<\/title>/)
	assert.match(club.body, /Hugh Devore/)
	assert.ok(club.body.includes('href="coaches"'), 'the club\'s footer')
	assert.ok(!club.body.includes('aria-current="page"'), 'a footer link marked as this page')
	assert.ok(!club.body.includes('<!-- footer -->') && !club.body.includes('<!-- limitations -->'))
	const league = await get(await make(true), '/limitations')
	assert.equal(league.handled, true)
	assert.match(league.body, /<title>NFL Data Limitations<\/title>/)
	assert.ok(league.body.includes('href="standings"'), 'the league\'s footer')
})

test('every sport\'s front end carries the same page', () => {
	const copies = SPORTS.map((s) => read(`web/${s}/limitations.html`))
	assert.equal(new Set(copies).size, 1)
})
