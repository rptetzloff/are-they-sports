import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shell, clubConfig } from '../lib/web.js'
import { navFor, leadersCsv, managersCsv, biofileCsv, createFront } from '../lib/web-routes.js'
import { loadSports, loadTeams } from '../lib/teams.js'
import { loadHistory, resolver } from '../lib/names.js'
// The page's parsers, which read the club's ids when they load: the club is
// described first, as the server's shell does for the browser.
globalThis.CLUB = { team: 'Brewers', fullName: 'Milwaukee Brewers', teamIds: ['MIL', 'SE1'], copy: {}, site: {} }
const { parseTeamstatsMgr, parseManagersCsv, parseBiofile } = await import('../web/mlb/coaches-core.js')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const SPORTS = ['mlb', 'nba', 'nhl', 'wnba', 'mls']

// The club pages ported from the baseball site (Ray, 2026-10-20: "we need all
// pages to match the general format.... fixed footer, etc.").

// A season of leader rows as store.leaderGames returns them: A opens, B
// stands in for one game, A returns; C opens the next season.
const row = (leader, name, gameId, season, date) => ({ leader, name, franchise: 'MIL', gameId, season, date, result: 'WIN' })
const ROWS = [
	row('aaa01', 'Ann Able', 'MIL202004010', 2020, '2020-04-01'),
	row('bbb01', 'Bo Baker, Jr.', 'MIL202004020', 2020, '2020-04-02'),
	row('aaa01', 'Ann Able', 'MIL202004030', 2020, '2020-04-03'),
	row('ccc01', 'Cy Cole', 'SE1202104010', 2021, '2021-04-01'),
]

test('who led each game is in teamstats\' columns, from the club\'s side', () => {
	const games = [
		{ id: 'MIL202004010', home: 'MIL', away: 'CHN' },
		{ id: 'MIL202004020', home: 'CHN', away: 'MIL' },
		{ id: 'MIL202004030', home: 'MIL', away: 'CHN' },
		{ id: 'SE1202104010', home: 'SE1', away: 'OAK' },
	]
	const csv = leadersCsv(ROWS, games, ['MIL', 'SE1'])
	assert.equal(csv.split('\n')[0], 'gid,team,mgr')
	assert.match(csv, /^MIL202004020,MIL,bbb01$/m, 'the away side was not the club')
	assert.match(csv, /^SE1202104010,SE1,ccc01$/m)
	// The page reads it with teamstats' own parser, which keeps the club's rows.
	const mgr = parseTeamstatsMgr(leadersCsv(ROWS, games, ['MIL', 'SE1']))
	assert.equal(mgr.get('MIL202004020'), 'bbb01')
	// A game the club's file does not have is left out, not guessed at.
	assert.ok(!leadersCsv(ROWS, games.slice(1), ['MIL']).includes('MIL202004010'))
})

test('official spells leave out whoever only ever stood in', () => {
	const csv = managersCsv(ROWS)
	assert.deepEqual(csv.trim().split('\n'), [
		'name,start_date,end_date',
		'aaa01,4/1/2020,4/1/2020',
		'aaa01,4/3/2020,4/3/2020',
		'ccc01,4/1/2021,4/1/2021',
	])
	// In the page's own form: ISO dates, one row a spell.
	assert.deepEqual(parseManagersCsv(csv).map((t) => [t.mgrId, t.startDate]),
		[['aaa01', '2020-04-01'], ['aaa01', '2020-04-03'], ['ccc01', '2021-04-01']])
})

test('leaders\' names survive a comma', () => {
	const names = parseBiofile(biofileCsv(ROWS))
	assert.equal(names.get('bbb01'), 'Bo Baker, Jr.')
	assert.equal(names.size, 3)
})

test('a club page is titled for itself and its way back names the question', async () => {
	const teams = await loadTeams()
	const brewers = teams.find((t) => t.sport === 'mlb' && t.id === 'brewers')
	const cfg = clubConfig({ team: brewers, current: { espnAbbr: 'MIL' } })
	const html = shell(read('web/mlb/history.html'), { config: cfg, page: 'History', base: '/mlb/brewers' })
	assert.match(html, /<title>Brewers History<\/title>/)
	assert.match(html, /class="records-back"><i class="mdi mdi-arrow-left"><\/i> Are the Brewers On TV\?<\/a>/)
	assert.ok(html.includes('<base href="/mlb/brewers/">'))
	// The front page keeps its question.
	assert.match(shell(read('web/mlb/index.html'), { config: cfg }), /<title>Are the Brewers On TV\?<\/title>/)
})

test('every page has its own footer link marked, and its own share menu', () => {
	for (const sport of SPORTS) {
		const leader = /leaderPlural: '([a-z]+)'/.exec(read(`web/${sport}/site.js`))[1]
		for (const [page, href, share] of [['history', 'history.html', 'history-share'], ['records', 'records.html', 'records-share'],
			['vs', 'vs.html', 'h2h-share'], ['leaders', `${leader}.html`, 'managers-share']]) {
			const html = read(`web/${sport}/${page}.html`)
			assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, `${sport} ${page}`)
			assert.match(html, new RegExp(`<a href="${href}" class="footer-nav-link" aria-current="page">`), `${sport} ${page}`)
			assert.ok(html.includes(`id="${share}"`) && read(`web/${sport}/${page}.js`).includes(`'${share}'`), `${sport} ${page} share`)
			assert.ok(html.includes(`<script src="${page}.js" type="module">`), `${sport} ${page} script`)
			// The front page's footer, so the Disclaimer and the team changer come too.
			assert.ok(html.includes('license-modal.js') && html.includes('<div class="footer-share-wrap">'), `${sport} ${page} footer`)
		}
		for (const f of ['sortable.js', 'coaches-core.js']) assert.ok(existsSync(join(ROOT, 'web', sport, f)), `${sport} ${f}`)
	}
})

test('the coaches link waits for coaches; the other pages stay', () => {
	for (const sport of ['nba', 'nhl', 'wnba', 'mls']) {
		const html = navFor(read(`web/${sport}/history.html`), sport)
		assert.ok(!html.includes('href="coaches') && !html.includes('>Coaches<'), sport)
		assert.ok(html.includes('href="records"') && html.includes('href="vs"') && html.includes('href="history"'), sport)
	}
	assert.ok(navFor(read('web/mlb/history.html'), 'mlb').includes('href="managers"'))
})

// --- the routes -------------------------------------------------------------

async function front(sport, id, leaders = []) {
	const teams = await loadTeams()
	const team = teams.find((t) => t.sport === sport && t.id === id)
	const adapters = await loadSports()
	const sent = []
	const f = await createFront({
		team, franchise: team.franchise ?? team.sourceIds?.[0], adapter: adapters[sport], namer: resolver(sport),
		history: loadHistory(sport), currentCodes: new Set(), palette: null, base: `/${sport}/${id}`,
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map(), leaderGames: async () => leaders },
		creditHtml: '', origin: () => 'http://x',
	})
	const get = async (path) => {
		const url = new URL(`http://x${path}`)
		const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(b) { this.body = String(b ?? '') } }
		const handled = await f({ headers: {} }, res, url.pathname, url, (r, body, meta) => { r.status = 200; r.body = body; sent.push(meta) })
		return { handled, ...res, meta: sent.at(-1) }
	}
	return get
}

test('each page is served where the server-rendered one was; ?format=json still reaches that one', async () => {
	const get = await front('mlb', 'brewers')
	for (const [path, title, card] of [['/history', 'Brewers History', 'history'], ['/records', 'Brewers Records', 'records'],
		['/records/win-streaks', 'Brewers Records', 'records'], ['/vs/chicago-cubs', 'Brewers Head-to-Head', 'vs'],
		['/managers', 'Brewers Managers', 'managers'], ['/history.html', 'Brewers History', 'history']]) {
		const r = await get(path)
		assert.equal(r.handled, true, path)
		assert.ok(r.body.includes(`<title>${title}</title>`), `${path}: ${r.body.match(/<title>[^<]*/)}`)
		assert.deepEqual(r.meta, { card }, path)
		assert.ok(r.body.includes('window.CLUB'), `${path} has no club`)
	}
	assert.equal((await get('/records?format=json')).handled, false)
	// Only baseball's word for its leaders, and a slug only where the page reads one.
	assert.equal((await get('/coaches')).handled, false)
	assert.equal((await get('/history/1982')).handled, false)
	// The scripts are still files.
	assert.match((await get('/history.js')).headers['content-type'], /javascript/)
})

test('the leaders files come from game_leader, and say nobody when there is nobody', async () => {
	const withLeaders = await front('mlb', 'brewers', ROWS)
	assert.match((await withLeaders('/data/managers.csv')).body, /^ccc01,4\/1\/2021,4\/1\/2021$/m)
	assert.match((await withLeaders('/data/biofile0.csv')).body, /^aaa01,,,Ann Able$/m)
	const none = await front('nhl', 'wild')
	assert.equal((await none('/data/managers.csv')).body, 'name,start_date,end_date\n')
	assert.equal((await none('/data/leaders.csv')).body, 'gid,team,mgr\n')
	assert.match((await none('/data/biofile0.csv')).body, /^id,lastname,usename,fullname,birthdate/)
	assert.match((await none('/coaches')).body, /<title>Wild Coaches<\/title>/)
})
