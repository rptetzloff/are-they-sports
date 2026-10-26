import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	calendarPeriods, currentPeriod, footballBracketHtml, footballRounds, gameCardHtml, gameOf, gameRowsHtml,
	parsePeriodKey, periodQuery, pickGame, refreshMs, scoreText,
} from '../web/mlb/league-core.js'
import { espnTarget, leagueEndpoints } from '../lib/espn.js'
import { clubConfig, leagueConfig } from '../lib/web.js'
import { createFront } from '../lib/web-routes.js'
import { loadSports, loadTeams } from '../lib/teams.js'
import { loadHistory, resolver } from '../lib/names.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// League pages (Ray, 2026-10-20): "league pages that have weekly or daily
// schedules, playoff brackets and the ability to open a single game card",
// the card "in the slot where the single game card would be for a single team".

// --- periods ----------------------------------------------------------------

test('a calendar of game days is read as the days it lists', () => {
	const sb = { leagues: [{ calendarType: 'day', calendarIsWhitelist: true, calendar: ['2026-10-21T07:00Z', '2026-10-20T07:00Z', '2026-10-20T07:00Z'] }] }
	assert.deepEqual(calendarPeriods(sb).map((p) => p.key), ['d2026-10-20', 'd2026-10-21'])
	assert.equal(calendarPeriods(sb)[0].label, 'Tue, Oct 20, 2026')
})

test('baseball\'s calendar lists the days without games, which are left out of its span', () => {
	const sb = { leagues: [{
		calendarType: 'day', calendarIsWhitelist: false,
		calendarStartDate: '2026-07-12T07:00Z', calendarEndDate: '2026-07-18T07:00Z',
		calendar: ['2026-07-13T07:00Z', '2026-07-14T07:00Z', '2026-07-15T07:00Z', '2026-07-16T07:00Z'],
	}] }
	assert.deepEqual(calendarPeriods(sb).map((p) => p.day), ['2026-07-12', '2026-07-17', '2026-07-18'])
})

test('football\'s calendar is its weeks, by season type, without the off season', () => {
	const sb = {
		season: { year: 2026, type: 2 }, week: { number: 7 },
		leagues: [{ calendarType: 'list', calendar: [
			{ label: 'Preseason', value: '1', entries: [{ label: 'Hall of Fame Weekend', value: '1' }] },
			{ label: 'Regular Season', value: '2', entries: [{ label: 'Week 6', value: '6' }, { label: 'Week 7', value: '7' }] },
			{ label: 'Postseason', value: '3', entries: [{ label: 'Wild Card', value: '1', startDate: '2027-01-13T08:00Z' }] },
			{ label: 'Off Season', value: '4', entries: [{ label: 'Off Season', value: '1' }] },
		] }],
	}
	const periods = calendarPeriods(sb)
	assert.deepEqual(periods.map((p) => p.key), ['w2026-1-1', 'w2026-2-6', 'w2026-2-7', 'w2026-3-1'])
	assert.deepEqual(periods.map((p) => p.label), ['Preseason Hall of Fame Weekend', 'Week 6', 'Week 7', 'Wild Card'])
	assert.equal(currentPeriod(sb, periods).key, 'w2026-2-7')
	assert.equal(periodQuery(periods[2]), 'dates=2026&seasontype=2&week=7')
})

test('a period survives the URL', () => {
	assert.equal(periodQuery(parsePeriodKey('d2026-10-20')), 'dates=20261020')
	assert.equal(periodQuery(parsePeriodKey('w2025-3-1')), 'dates=2025&seasontype=3&week=1')
	for (const bad of ['', 'x', 'd2026-1-1', 'w2026-4-1', 'w2026-2-123', null]) assert.equal(parsePeriodKey(bad), null, String(bad))
	// The day a scoreboard shows, when its calendar does not list it.
	assert.equal(currentPeriod({ day: { date: '2026-10-23T07:00Z' } }, []).key, 'd2026-10-23')
})

// --- games ------------------------------------------------------------------

const team = (id, abbr, name, homeAway, extra = {}) => ({
	homeAway, id, winner: extra.winner, score: extra.score, linescores: extra.lines?.map((value) => ({ value, displayValue: String(value) })),
	hits: extra.hits, errors: extra.errors, records: [{ type: 'total', summary: extra.record ?? '' }],
	team: { id, abbreviation: abbr, displayName: name, shortDisplayName: name.split(' ').at(-1), logo: `https://x/${abbr}.png` },
})
const event = (id, { state = 'post', date = '2026-10-20T23:00Z', away = {}, home = {}, note = '', tv = [], detail = 'Final', situation } = {}) => ({
	id, date, links: [{ rel: ['summary', 'desktop'], href: `https://espn.com/game/${id}` }],
	competitions: [{
		status: { type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED', shortDetail: detail } },
		notes: note ? [{ headline: note }] : [], broadcasts: tv.length ? [{ names: tv }] : [],
		venue: { fullName: 'Lambeau Field', address: { city: 'Green Bay', state: 'WI' } },
		situation,
		competitors: [team('9', 'GB', 'Green Bay Packers', 'home', home), team('3', 'CHI', 'Chicago <Bears>', 'away', away)],
	}],
})

test('a scoreboard game is read from both sides', () => {
	const g = gameOf(event('1', { home: { score: '24', winner: true, record: '5-1' }, away: { score: '17' }, tv: ['FOX', 'FOX'] }))
	assert.equal(g.home.name, 'Green Bay Packers')
	assert.equal(g.away.score, 17)
	assert.equal(g.home.record, '5-1')
	assert.deepEqual(g.tv, ['FOX'])
	assert.equal(g.espn, 'https://espn.com/game/1')
	assert.equal(scoreText(g), '17–24')
	// Not started: the start time, in the viewer's zone.
	const pre = gameOf(event('2', { state: 'pre', date: '2026-10-20T23:00:00Z' }))
	assert.equal(scoreText(pre, { timeZone: 'America/Chicago' }), '6:00 PM')
	// A shootout says so.
	const so = gameOf(event('3'))
	so.away.pens = 4; so.home.pens = 5
	assert.equal(scoreText(so), '0–0 (4–5 pens)')
})

test('the card opens on a live game, else the next, else the last', () => {
	const now = Date.parse('2026-10-20T20:00Z')
	const done = gameOf(event('a', { date: '2026-10-20T17:00Z' }))
	const later = gameOf(event('b', { state: 'pre', date: '2026-10-21T00:00Z' }))
	const soon = gameOf(event('c', { state: 'pre', date: '2026-10-20T22:00Z' }))
	const live = gameOf(event('d', { state: 'in', date: '2026-10-20T19:00Z' }))
	assert.equal(pickGame([done, later, soon, live], now).id, 'd')
	assert.equal(pickGame([done, later, soon], now).id, 'c')
	assert.equal(pickGame([done], now).id, 'a')
	assert.equal(pickGame([], now), null)
})

test('a row is the front page\'s row, the chosen game marked and names escaped', () => {
	const games = [gameOf(event('1', { away: { score: 17 }, home: { score: 24, winner: true }, tv: ['FOX'] })), gameOf(event('2', { state: 'pre' }))]
	const html = gameRowsHtml(games, { selected: '1' })
	assert.equal((html.match(/class="sched-row /g) ?? []).length, 2)
	assert.match(html, /data-key="1" role="button" tabindex="0" aria-label="Chicago &lt;Bears&gt; at Green Bay Packers" aria-current="true"/)
	assert.match(html, /<span class="league-won">Packers<\/span>/)
	assert.ok(!html.includes('<Bears>'))
	assert.equal(gameRowsHtml([]), '<div class="loading">No games.</div>')
})

test('the card names both clubs, links the ones with a page here, and draws the line score', () => {
	const g = gameOf(event('1', {
		home: { score: 5, winner: true, lines: [1, 0, 4], hits: 9, errors: 0 },
		away: { score: 2, lines: [0, 2, 0], hits: 6, errors: 1 },
	}))
	const html = gameCardHtml(g, { clubHref: (name) => (name === 'Green Bay Packers' ? '/nfl/packers/' : null) })
	assert.match(html, /<a href="\/nfl\/packers\/">Green Bay Packers<\/a>/)
	assert.match(html, /Chicago &lt;Bears&gt;/)
	assert.match(html, /<th>R<\/th><th>H<\/th><th>E<\/th>/)
	assert.match(html, /<th scope="row">GB<\/th><td>1<\/td><td>0<\/td><td>4<\/td><td class="league-total">5<\/td><td>9<\/td><td>0<\/td>/)
	assert.match(html, /Lambeau Field · Green Bay, WI/)
	// Before the game, no score and no line score; football's situation once live.
	const pre = gameCardHtml(gameOf(event('2', { state: 'pre' })))
	assert.ok(!pre.includes('league-score') && !pre.includes('league-linescore'))
	const live = gameCardHtml(gameOf(event('3', { state: 'in', detail: '3rd 4:12', situation: { downDistanceText: '3rd & 4 at GB 30', lastPlay: { text: 'Pass complete' } } })))
	assert.match(live, /3rd &amp; 4 at GB 30/)
	assert.match(live, /Pass complete/)
})

test('a period is fetched again while it has games to play, and not once it is over', () => {
	const now = Date.parse('2026-10-20T20:00Z')
	const at = (state, date) => gameOf(event('x', { state, date }))
	assert.equal(refreshMs([at('in', '2026-10-20T19:00Z')], now), 20_000)
	assert.equal(refreshMs([at('pre', '2026-10-20T19:30Z')], now), 60_000)
	assert.equal(refreshMs([at('pre', '2026-10-21T19:30Z')], now), 300_000)
	assert.equal(refreshMs([at('post', '2026-10-20T17:00Z')], now), null)
})

test('football\'s bracket is its rounds, AFC above NFC, without the Pro Bowl', () => {
	const rounds = footballRounds([
		{ label: 'Wild Card', key: 'w2025-3-1', events: [event('n', { note: 'NFC Wild Card Playoffs' }), event('a', { note: 'AFC Wild Card Playoffs' })] },
		{ label: 'Pro Bowl', key: 'w2025-3-4', events: [event('p', { note: 'Pro Bowl Games' })] },
	])
	assert.deepEqual(rounds.map((r) => [r.label, r.games.map((g) => g.id)]), [['Wild Card', ['a', 'n']]])
	const html = footballBracketHtml(rounds, { selected: 'n' })
	assert.match(html, /data-period="w2025-3-1"/)
	assert.match(html, /class="lb-g league-row-on" data-key="n"/)
	assert.equal(footballBracketHtml([]), null)
})

// --- the server ---------------------------------------------------------------

test('a league page may ask ESPN for any day or week, and for nobody\'s schedule', () => {
	const e = leagueEndpoints({ league: 'football/nfl' })
	assert.match(espnTarget(e, 'apis/site/v2/sports/football/nfl/scoreboard', 'dates=2026&seasontype=2&week=7'), /scoreboard\?dates=2026&seasontype=2&week=7$/)
	assert.equal(espnTarget(e, 'apis/site/v2/sports/football/nfl/teams/gb/schedule', ''), null)
	assert.equal(espnTarget(e, 'apis/site/v2/sports/football/nfl/scoreboard', 'limit=1000'), null)
	assert.equal(espnTarget(e, 'apis/site/v2/sports/football/nfl/scoreboard', 'dates=2026-10-20'), null)
})

test('the league\'s config is the club\'s, said of the league', async () => {
	const teams = await loadTeams()
	const packers = teams.find((t) => t.sport === 'nfl' && t.id === 'packers')
	const cfg = leagueConfig(clubConfig({ team: packers, current: { espnAbbr: 'GB' } }), 'nfl', 'week')
	assert.equal(cfg.team, 'NFL')
	assert.equal(cfg.fullName, 'National Football League')
	assert.deepEqual(cfg.teamIds, [])
	assert.equal(cfg.site.title, 'NFL Scores')
	assert.equal(cfg.site.period, 'week')
	assert.equal(cfg.site.espnSlug, null)
	assert.ok(!JSON.stringify(cfg).includes('Packers'), 'the club the config was built from is still named in it')
})

test('a league page answers for its page, files, ESPN and bracket, and leaves the rest to the server', async () => {
	const teams = await loadTeams()
	const adapters = await loadSports()
	const t = teams.find((x) => x.sport === 'mlb' && x.id === 'brewers')
	const front = await createFront({
		league: true, team: t, franchise: 'MIL', adapter: adapters.mlb, namer: resolver('mlb'),
		history: loadHistory('mlb'), currentCodes: new Set(), palette: null, base: '/mlb',
		clubs: [{ sport: 'mlb', teamId: 'brewers', name: 'Milwaukee Brewers', href: '/mlb/brewers/' }, { sport: 'nfl', teamId: 'packers', name: 'Green Bay Packers', href: '/nfl/packers/' }],
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map() },
		creditHtml: '', origin: () => 'http://x',
	})
	const get = async (path) => {
		const url = new URL(`http://x${path}`)
		const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(b) { this.body = String(b ?? '') } }
		const handled = await front({ headers: {} }, res, url.pathname, url, (r, body, meta) => { r.status = 200; r.body = body; r.meta = meta })
		return { handled, ...res }
	}
	const page = await get('/')
	assert.equal(page.handled, true)
	assert.match(page.body, /<title>MLB Scores<\/title>/)
	assert.match(page.body, /<h1 id="site-title" class="site-title">MLB Scores<\/h1>/)
	assert.ok(page.body.includes('<base href="/mlb/">'))
	assert.ok(page.body.includes('footer-club-menu'), 'no team menu')
	assert.match((await get('/league.js')).headers['content-type'], /javascript/)
	for (const p of ['/standings', '/schedule', '/records.html', '/history.html', '/data/gameinfo.csv', '/data/managers.csv', '/2024']) {
		assert.equal((await get(p)).handled, false, p)
	}
})

test('every sport\'s front end carries the same league page', () => {
	for (const f of ['league.html', 'league.js', 'league-core.js', 'league.css']) {
		const copies = ['mlb', 'nfl', 'nba', 'nhl', 'wnba', 'mls', 'ncaaf'].map((s) => read(`web/${s}/${f}`))
		assert.equal(new Set(copies).size, 1, `${f} has drifted between sports`)
	}
})

test('the club picker\'s league headings open the league pages', async () => {
	const { selectorPage } = await import('../lib/render.js')
	const clubs = [
		{ sport: 'nfl', code: 'GB', name: 'Green Bay Packers', available: true, url: '/nfl/packers' },
		{ sport: 'mlb', code: 'MIL', name: 'Milwaukee Brewers', available: true, url: '/mlb/brewers' },
	]
	const html = selectorPage({ scope: 'all', clubs, colors: { base: '#2a2a2a', accent: '#ffffff' }, heading: 'Every club', leagueHref: (s) => (s === 'nfl' ? '/nfl/' : null) })
	assert.match(html, /<h2 class="clubs-league"><a href="\/nfl\/" title="NFL scores and schedule">NFL <span class="dim">scores<\/span><\/a><\/h2>/)
	assert.match(html, /<h2 class="clubs-league">MLB<\/h2>/)
})
