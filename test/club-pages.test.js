import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shell, clubConfig } from '../lib/web.js'
import { navFor, leadersCsv, managersCsv, biofileCsv, coachesJson, createFront } from '../lib/web-routes.js'
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
	for (const sport of ['nba', 'wnba', 'mls']) {
		const html = navFor(read(`web/${sport}/history.html`), sport)
		assert.ok(!html.includes('href="coaches') && !html.includes('>Coaches<'), sport)
		assert.ok(html.includes('href="records"') && html.includes('href="vs"') && html.includes('href="history"'), sport)
	}
	assert.ok(navFor(read('web/mlb/history.html'), 'mlb').includes('href="managers"'))
	// Hockey's are stated tenures (data/reference/nhl-coaches.csv).
	assert.ok(navFor(read('web/nhl/history.html'), 'nhl').includes('href="coaches"'))
})

// --- the routes -------------------------------------------------------------

async function front(sport, id, leaders = [], tenures = []) {
	const teams = await loadTeams()
	const team = teams.find((t) => t.sport === sport && t.id === id)
	const adapters = await loadSports()
	const sent = []
	const f = await createFront({
		team, franchise: team.franchise ?? team.sourceIds?.[0], adapter: adapters[sport], namer: resolver(sport),
		history: loadHistory(sport), currentCodes: new Set(), palette: null, base: `/${sport}/${id}`,
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map(), leaderGames: async () => leaders, leaderTenures: async () => tenures },
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

// --- football ----------------------------------------------------------------
// The same pages for the NFL (Ray, 2026-10-20: the two sites were examples of
// one format), from the Packers site's, with the season table the others have.

test('football\'s pages carry its own footer, its share menu and the season table', () => {
	for (const [page, href] of [['history', 'history.html'], ['records', 'records.html'], ['vs', 'vs.html'], ['leaders', 'coaches.html']]) {
		const html = read(`web/nfl/${page}.html`)
		assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, page)
		assert.match(html, new RegExp(`<a href="${href}" class="footer-nav-link" aria-current="page">`), page)
		assert.ok(html.includes('<div class="footer-share" id="footer-share" role="menu" hidden></div>'), `${page} share`)
		assert.ok(html.includes(`<script src="${page}.js" type="module">`), `${page} script`)
	}
	assert.ok(read('web/nfl/history.html').includes('id="history-table-wrap"'))
	assert.ok(!read('web/nfl/leaders.html').includes('lightbox'), 'the photo viewer came without photos')
})

const coach = (leader, name, gameId, season, date, result = 'WIN') => ({ leader, name, franchise: 'GB', gameId, season, date, result, round: null, title: null })

test('a coach is one row, and each spell in charge its own band', () => {
	const tenures = [
		{ leader: 'mclean', name: 'Ray McLean', franchise: 'GB', firstSeason: 1953, lastSeason: 1953, w: 0, l: 1, t: 0, playoffW: 0, playoffL: 0, titleSeasons: [], interim: false },
		{ leader: 'black', name: 'Lisle Blackbourn', franchise: 'GB', firstSeason: 1954, lastSeason: 1957, w: 17, l: 31, t: 0, playoffW: 0, playoffL: 0, titleSeasons: [], interim: false },
		{ leader: 'mclean', name: 'Ray McLean', franchise: 'GB', firstSeason: 1958, lastSeason: 1958, w: 1, l: 10, t: 1, playoffW: 0, playoffL: 0, titleSeasons: [], interim: false },
	]
	const games = [
		coach('mcc', 'Mike McCarthy', 'g1', 2018, '2018-09-09'),
		coach('phil', 'Joe Philbin', 'g2', 2018, '2018-12-09', 'LOSS'),
		coach('laf', 'Matt LaFleur', 'g3', 2019, '2019-09-05'),
	]
	const { coaches, eras } = coachesJson(games, tenures)
	assert.deepEqual(coaches.map((c) => [c.label, c.name]), [['1', 'Ray McLean'], ['2', 'Lisle Blackbourn'], ['3', 'Mike McCarthy'], ['3.1', 'Joe Philbin'], ['4', 'Matt LaFleur']])
	assert.equal(coaches[0].w, 1)
	assert.equal(coaches[0].seasons, undefined, 'a Set does not survive JSON')
	assert.deepEqual(eras.map((e) => `${e.name} ${e.from}-${e.to}`),
		['Ray McLean 1953-1953', 'Lisle Blackbourn 1954-1957', 'Ray McLean 1958-1958', 'Mike McCarthy 2018-2018', 'Matt LaFleur 2019-2019'])
})

test('football\'s pages are served where the server-rendered ones were', async () => {
	const tenures = [{ leader: 'lamb', name: 'Curly Lambeau', franchise: 'GB', firstSeason: 1921, lastSeason: 1949, w: 209, l: 104, t: 21, playoffW: 3, playoffL: 2, titleSeasons: [], interim: false }]
	const get = await front('nfl', 'packers', [], tenures)
	for (const [path, title, card] of [['/history', 'Packers History', 'history'], ['/records/win-streaks', 'Packers Records', 'records'],
		['/vs/chicago-bears', 'Packers Head-to-Head', 'vs'], ['/coaches', 'Packers Coaches', 'coaches']]) {
		const r = await get(path)
		assert.equal(r.handled, true, path)
		assert.ok(r.body.includes(`<title>${title}</title>`), `${path}: ${r.body.match(/<title>[^<]*/)}`)
		assert.deepEqual(r.meta, { card }, path)
	}
	assert.equal((await get('/coaches?format=json')).handled, false)
	assert.equal((await get('/managers')).handled, false)
	const json = JSON.parse((await get('/data/coaches.json')).body)
	assert.deepEqual(json.coaches.map((c) => [c.name, c.w]), [['Curly Lambeau', 209]])
	assert.deepEqual(json.eras.map((e) => [e.from, e.to]), [[1921, 1949]])
})
