import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	TEMPLATES, recolor, gameinfoRow, gameinfoCsv, GAMEINFO_HEADER, nflGameRow, seasonRecordsCsv,
	franchiseAliases, shell, clubConfig, assetFor, clubFileFor,
} from '../lib/web.js'
import { navFor } from '../lib/web-routes.js'
import { endpointsFor, espnTarget, ttlFor, FINAL_TTL, IDLE_TTL, TTL } from '../lib/espn.js'
import { stageFromNotes } from '../sports/mlb.js'
import { liveGameRow } from '../sports/nfl.js'
import { displayName, loadHistory } from '../lib/names.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// --- colour -----------------------------------------------------------------

test('each stylesheet is unchanged for the club it came from', () => {
	// The whole claim of "exactly like the site" for the Brewers and the Packers
	// rests on this: the remap must be the identity for the source palette,
	// however the palette's hex happens to be cased.
	for (const [sport, palette] of [['mlb', { base: '#12284B', accent: '#FFC52F' }], ['nfl', { base: '#203731', accent: '#FFB612' }]]) {
		const css = read(`web/${sport}/styles.css`)
		assert.equal(recolor(css, sport, palette), css, `${sport} stylesheet changed for its own club`)
	}
})

test('every colour a template lists is actually in its stylesheet', () => {
	// A listed colour the file no longer uses means the list was written
	// against a different file, and a brand colour added since is being missed.
	for (const [sport, t] of Object.entries(TEMPLATES)) {
		const css = read(`web/${sport}/styles.css`).toLowerCase()
		for (const hex of [...t.dark, ...t.accentFamily, ...t.tint]) {
			assert.ok(css.includes(hex), `${sport}: ${hex} is listed but not in styles.css`)
		}
		for (const triplet of Object.keys(t.rgb)) {
			assert.ok(css.includes(`: ${triplet};`), `${sport}: rgb ${triplet} is listed but not in styles.css`)
		}
	}
})

const BRAND = {
	mlb: ['#12284b', '#1a3558', '#1a3a6b', '#1a3660', '#16305a', '#16294a', '#0d1d38', '#ffc52f', '#ffd45e', '#e0a820', '#8a5d00', '#f3f5f9', '#eef2f8', '#e9eef6'],
	nfl: ['#203731', '#152a1e', '#1a2e28', '#ffb612', '#ffd050', '#8a5d00', '#f4f6f2', '#e8eee9'],
}
// Basketball's, hockey's, the WNBA's and MLS's stylesheets are baseball's, so their brand colours
// are the Brewers'.
BRAND.nba = BRAND.mlb
BRAND.nhl = BRAND.mlb
BRAND.wnba = BRAND.mlb
BRAND.mls = BRAND.mlb
BRAND.ncaam = BRAND.mlb
// College football's is the NFL's.
BRAND.ncaaf = BRAND.nfl

test('another club loses every brand colour and keeps every other one', () => {
	const cubs = { base: '#0e3386', accent: '#cc3433' }
	for (const sport of Object.keys(TEMPLATES)) {
		const css = read(`web/${sport}/styles.css`)
		const out = recolor(css, sport, cubs).toLowerCase()
		// Written out here rather than read from TEMPLATES, so that dropping a
		// colour from the list is caught instead of being agreed with.
		for (const hex of BRAND[sport]) {
			assert.ok(!out.includes(hex), `${sport}: ${hex} survived the remap`)
		}
		// Trophy gold and the win green are nobody's brand.
		const count = (s, x) => s.toLowerCase().split(x).length - 1
		for (const generic of ['#ffd700', '#4caf50']) {
			assert.equal(count(out, generic), count(css, generic), `${sport}: ${generic} was moved`)
		}
		assert.ok(out.includes(cubs.base) && out.includes(cubs.accent))
	}
})

// --- history ----------------------------------------------------------------

const mlbGame = (o) => ({ id: 'MIL201810190', season: 2018, date: '2018-10-19', round: 'playoff', stage: 'lcs',
	home: 'MIL', away: 'LAN', homeScore: 7, awayScore: 2, neutral: false, status: 'final', ...o })

test('a baseball game becomes the gameinfo row the page parses', () => {
	const r = gameinfoRow(mlbGame())
	assert.deepEqual(
		[r.gid, r.visteam, r.hometeam, r.date, r.number, r.gametype, r.vruns, r.hruns, r.wteam, r.lteam, r.season],
		['MIL201810190', 'LAN', 'MIL', '20181019', '0', 'lcs', 2, 7, 'MIL', 'LAN', 2018])
	// The second game of a doubleheader is numbered by its id.
	assert.equal(gameinfoRow(mlbGame({ id: 'CHA196904202' })).number, '2')
	// No round stored is the regular season, which is what Retrosheet writes.
	assert.equal(gameinfoRow(mlbGame({ stage: null, round: 'regular' })).gametype, 'regular')
	// A playoff game loaded before `stage` existed stays a postseason game.
	assert.equal(gameinfoRow(mlbGame({ stage: null, round: 'playoff' })).gametype, 'postseason')
	assert.equal(gameinfoRow(mlbGame({ stage: null, round: 'championship' })).gametype, 'worldseries')
	// An unplayed game has no score and no winner, rather than a 0-0 tie.
	const pending = gameinfoRow(mlbGame({ status: 'scheduled', homeScore: null, awayScore: null }))
	assert.deepEqual([pending.vruns, pending.hruns, pending.wteam, pending.lteam], ['', '', '', ''])
})

test('the gameinfo file has the header the page reads by name', () => {
	const [head, line] = gameinfoCsv([mlbGame()]).trim().split('\n')
	assert.deepEqual(head.split(','), GAMEINFO_HEADER)
	assert.equal(line.split(',').length, GAMEINFO_HEADER.length)
	// The live season's lines go out without one: the page prepends it.
	assert.ok(!gameinfoCsv([mlbGame()], { header: false }).startsWith('gid,'))
})

const nflGame = (o) => ({ id: 'x', season: 2010, date: '2011-02-06', round: 'championship', stage: 'SB', title: 'Super Bowl',
	home: 'PIT', away: 'GB', homeScore: 25, awayScore: 31, neutral: true, status: 'final', ...o })
const named = (code, season) => `${code}@${season}`

test('a football game becomes the football site\'s row, from the club\'s side', () => {
	const r = nflGameRow(nflGame(), 'GB', named)
	assert.deepEqual([r.result, r.team_score, r.opponent_score, r.location, r.Opponent, r.regular_season, r.playoff],
		['WIN', 31, 25, 'NEUTRAL', 'PIT@2010', '0', '1'])
})

test('a Super Bowl carries its numeral, and an NFL Championship does not', () => {
	// The 1966 season's final was Super Bowl I.
	assert.equal(nflGameRow(nflGame({ season: 1966, stage: null }), 'GB', named).superbowl, 'i')
	assert.equal(nflGameRow(nflGame(), 'GB', named).superbowl, 'xlv')
	assert.equal(nflGameRow(nflGame({ season: 1996 }), 'GB', named).superbowl, 'xxxi')
	assert.equal(nflGameRow(nflGame({ season: 1965, stage: null, title: 'NFL Championship' }), 'GB', named).superbowl, '')
})

test('season records split regular season from postseason', () => {
	const rows = [
		{ season: 1929, regular_season: '1', result: 'WIN' },
		{ season: 1929, regular_season: '1', result: 'TIE' },
		{ season: 1929, regular_season: '0', result: 'LOSS' },
		{ season: 1929, regular_season: '1', result: '' },
	]
	assert.equal(seasonRecordsCsv(rows).trim().split('\n')[1], '1929,1,0,1,0,1,0')
})

test('every era of a football franchise folds into its latest name', () => {
	const aliases = franchiseAliases(loadHistory('nfl'), displayName)
	assert.equal(aliases['Chicago Cardinals'], 'Arizona Cardinals')
	assert.equal(aliases['Portsmouth Spartans'], 'Detroit Lions')
	assert.equal(aliases['St. Louis Rams'], 'Los Angeles Rams')
	// Two different franchises were the New York Yankees; folding the name
	// into either would merge them.
	assert.equal(aliases['New York Yankees'], undefined)
	// A current name is never an alias of itself.
	assert.equal(aliases['Green Bay Packers'], undefined)
})

test('a name two franchises carried folds into neither', () => {
	// The real New York Yankees cannot test this: both are defunct and each one's
	// latest name is its own, so they never reach the ambiguity check.
	const rows = [
		{ franchiseAbbrv: 'A', city: 'Old', teamName: 'Name', startSeason: '1920' },
		{ franchiseAbbrv: 'A', city: 'New', teamName: 'A', startSeason: '1950' },
		{ franchiseAbbrv: 'B', city: 'Old', teamName: 'Name', startSeason: '1930' },
		{ franchiseAbbrv: 'B', city: 'New', teamName: 'B', startSeason: '1960' },
	]
	assert.deepEqual(franchiseAliases(rows, displayName), {})
})

// --- ESPN -------------------------------------------------------------------

test('the proxy allows this club\'s schedule and nobody else\'s', () => {
	const eps = endpointsFor({ league: 'baseball/mlb', slug: 'chc', standings: true })
	assert.equal(espnTarget(eps, 'apis/site/v2/sports/baseball/mlb/teams/chc/schedule', 'seasontype=2&season=2026'),
		'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/chc/schedule?season=2026&seasontype=2')
	assert.equal(espnTarget(eps, 'apis/site/v2/sports/baseball/mlb/teams/mil/schedule', ''), null)
	assert.equal(espnTarget(eps, 'apis/site/v2/sports/baseball/mlb/summary', 'event=401;rm'), null)
	assert.equal(espnTarget(eps, 'apis/site/v2/sports/baseball/mlb/summary', 'event=1&x=2'), null)
	// Football's front page never asked for standings, so it cannot.
	const nfl = endpointsFor({ league: 'football/nfl', slug: 'gb' })
	assert.equal(espnTarget(nfl, 'apis/v2/sports/football/nfl/standings', 'group=8'), null)
})

test('a schedule is cached for a day once every game in it is over', () => {
	const post = JSON.stringify({ events: [{ competitions: [{ status: { type: { state: 'post' } } }] }] })
	const later = JSON.stringify({ events: [{ date: '2030-01-01T00:00Z', competitions: [{ status: { type: { state: 'pre' } } }] }] })
	const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/gb/schedule'
	assert.equal(ttlFor(url, 200, post), FINAL_TTL)
	assert.equal(ttlFor(url, 200, later, Date.parse('2029-06-01')), IDLE_TTL)
	assert.equal(ttlFor(url, 500, post), TTL)
})

// --- rounds -----------------------------------------------------------------

test('a baseball postseason note names its round as Retrosheet would', () => {
	const of = (h) => stageFromNotes([{ headline: h }])
	assert.equal(of('NLWC - Game 1'), 'wildcard')
	assert.equal(of('AL Wild Card Game 2'), 'wildcard')
	assert.equal(of('ALDS - Game 3'), 'divisionseries')
	assert.equal(of('NLCS - Game 6'), 'lcs')
	assert.equal(of('World Series - Game 1'), 'worldseries')
	// Not `playoff`, which is Retrosheet's word for a tiebreaker.
	assert.equal(of('Postseason'), 'postseason')
})

test('a live football playoff game is staged as nflverse stages it', () => {
	const event = (week) => ({
		season: { type: 3, year: 2025 }, week: { number: week }, date: '2026-01-11T18:00Z',
		competitions: [{ status: { type: { completed: false } }, competitors: [
			{ homeAway: 'home', team: { abbreviation: 'PHI' } }, { homeAway: 'away', team: { abbreviation: 'GB' } }] }],
	})
	const ctx = { franchiseOf: (c) => c, knows: () => true, codeIn: (c) => c }
	assert.deepEqual([1, 2, 3, 5].map((w) => liveGameRow(event(w), ctx).stage), ['WC', 'DIV', 'CON', 'SB'])
})

// --- the page ---------------------------------------------------------------

const team = (o = {}) => ({ sport: 'mlb', id: 'cubs', sourceIds: ['CHN'], firstSeason: 1876,
	nouns: { team: 'Cubs', fullName: 'Chicago Cubs' }, copy: { seasonNotStarted: 'GO CUBS' }, ...o })

test('every club asks whether it is on TV; channel listings are a separate flag', () => {
	// Ray, 2026-10-21: the question is the TV one for every club, listings or not.
	const cfg = clubConfig({ team: team(), current: { espnAbbr: 'CHC', league: 'NL' } })
	assert.equal(cfg.site.title, 'Are the Cubs On TV?')
	assert.equal(cfg.site.tv, false)
	assert.deepEqual([cfg.site.espnAbbr, cfg.site.espnSlug, cfg.site.leagueGroup, cfg.site.tag], ['CHC', 'chc', 8, ''])
	const brewers = clubConfig({ team: team({ id: 'brewers', nouns: { team: 'Brewers', fullName: 'Milwaukee Brewers' }, site: { hashtag: '#ThisIsMyCrew' } }), current: { espnAbbr: 'MIL', league: 'NL' } })
	assert.equal(brewers.site.title, 'Are the Brewers On TV?')
	assert.equal(brewers.site.tag, ' #ThisIsMyCrew')
})

test('the shell carries the club, its question and its base', () => {
	const cfg = clubConfig({ team: team({ nouns: { team: 'Cubs</script>', fullName: 'x' } }), current: { espnAbbr: 'CHC' } })
	const html = shell(read('web/mlb/index.html'), { config: cfg, creditHtml: '<p class="notice">credit</p>', base: '/mlb/cubs' })
	// Before any module runs, and unable to close its own tag early: the script
	// as the browser will cut it, at the first </script>, still parses.
	assert.ok(html.indexOf('window.CLUB') < html.indexOf('main.js'))
	const script = html.slice(html.indexOf('window.CLUB = ') + 'window.CLUB = '.length).split('</script>')[0]
	assert.deepEqual(JSON.parse(script.replace(/;$/, '')), cfg)
	assert.match(html, /<title>Are the Cubs&lt;\/script&gt; On TV\?<\/title>/)
	assert.ok(!html.includes('Are the Brewers On TV?'), 'the source club\'s question survived')
	assert.ok(!html.includes('og:image') && !html.includes('twitter:'), 'the source site\'s preview tags survived')
	// The base comes before anything that resolves against it.
	assert.ok(html.includes('<base href="/mlb/cubs/">'))
	assert.ok(html.indexOf('<base ') < html.indexOf('styles.css'))
	assert.ok(html.includes('src="main.js"') && html.includes('href="styles.css"'))
	// A single-club scope is the root.
	assert.ok(shell(read('web/mlb/index.html'), { config: cfg }).includes('<base href="/">'))
	assert.ok(!html.includes('AreTheBrewersOnTV'))
	// The credit goes to the Disclaimer modal (Ray, 2026-10-19): out of the main
	// column, into a template the modal reads.
	assert.ok(!html.includes('<div id="data-credit"'), 'the credit is still in the main column')
	assert.ok(html.includes('<template id="data-credit"><p class="notice">credit</p><p class="limitations-link">'))
	assert.ok(!html.includes('Sunset Rd'), 'the outdated Retrosheet address survived')
})

test('the nav keeps the pages that exist and drops the ones that do not yet', () => {
	const html = navFor(read('web/mlb/index.html'), 'mlb')
	assert.ok(html.includes('href="records"') && html.includes('href="managers"'))
	assert.ok(!html.includes('href="/records.html"'))
	assert.ok(!html.includes('href="ballparks"') && !html.includes('href="stats"'))
	assert.ok(!html.includes('>Ballparks<') && !html.includes('href="null"'), 'a missing page is still in the nav')
	assert.ok(html.includes('footer-share-trigger'), 'took more than the link')
	const nfl = navFor(read('web/nfl/index.html'), 'nfl')
	assert.ok(nfl.includes('href="coaches"') && !nfl.includes('href="splits"'))
})

test('the team changer lists every club, marks this one, and sits beside Share', () => {
	const clubs = [
		{ sport: 'mlb', teamId: 'brewers', name: 'Milwaukee Brewers', href: '/mlb/brewers/' },
		{ sport: 'nfl', teamId: 'packers', name: 'Green Bay Packers', href: '/nfl/packers/' },
		{ sport: 'nfl', teamId: 'bears', name: 'Chicago Bears', href: '/nfl/bears/' },
	]
	const cfg = clubConfig({ team: team(), current: { espnAbbr: 'GB' } })
	const html = shell(read('web/nfl/index.html'), { config: cfg, clubs, current: { sport: 'nfl', teamId: 'packers' }, base: '/nfl/packers' })
	const menu = html.slice(html.indexOf('footer-club-menu'), html.indexOf('<style>', html.indexOf('footer-club-menu')))
	// A group per sport, this club's open; a phone opens only that one, and a
	// desktop all of them (the toggle's script).
	assert.equal((menu.match(/<details class="footer-club-group"/g) ?? []).length, 2)
	assert.match(menu, /<details class="footer-club-group" data-sport="nfl" data-current open>/)
	assert.match(menu, /<details class="footer-club-group" data-sport="mlb">/)
	assert.match(html, /grid-template-columns: repeat\(auto-fill/)
	assert.equal((menu.match(/role="menuitem"/g) ?? []).length, 3)
	assert.match(menu, /aria-current="page"[^>]*>[^<]*<i[^>]*><\/i> Green Bay Packers/)
	// This club's sport first, alphabetical within it.
	// Headed by league (Ray, 2026-10-20), this club's first.
	assert.ok(menu.indexOf('</i> NFL</summary>') > 0)
	assert.ok(menu.indexOf('</i> NFL</summary>') < menu.indexOf('</i> MLB</summary>'))
	assert.ok(menu.indexOf('Chicago Bears') < menu.indexOf('Green Bay Packers'))
	// In the footer, immediately before Share.
	// (`footer-share-wrap` alone, without `footer-club-wrap`, is the Share menu.)
	const changer = html.indexOf('footer-club-wrap'), share = html.indexOf('<div class="footer-share-wrap">')
	assert.ok(html.indexOf('<footer') < changer && changer < share)
	// One club has nothing to change to.
	const solo = shell(read('web/nfl/index.html'), { config: cfg, clubs: clubs.slice(1, 2), current: { sport: 'nfl', teamId: 'packers' } })
	assert.ok(!solo.includes('footer-club'))
})

test('no game link is built while there is no game page', () => {
	// Both sites had /game/{id}; this repo does not yet, and every Box button
	// and score link went to a 404 that nobody clicked until a crawl did. Each
	// place that writes one must be behind SITE.gamePages, on its line or the
	// one before (a ternary's condition).
	assert.equal(clubConfig({ team: team(), current: { espnAbbr: 'CHC' } }).site.gamePages, false)
	const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : [])
	const unguarded = []
	for (const f of walk('web')) {
		const lines = read(f).split('\n')
		lines.forEach((l, i) => {
			if (/(['"`])game\/\$\{/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !`${lines[i - 1] ?? ''}${l}`.includes('SITE.gamePages')) unguarded.push(`${f}:${i + 1}`)
		})
	}
	assert.deepEqual(unguarded, [])
})

test('one disclaimer for every sport, naming that sport\'s league', () => {
	const copies = ['mlb', 'nfl', 'nba'].map((s) => read(`web/${s}/license-modal.js`))
	assert.equal(new Set(copies).size, 1, 'the three disclaimer copies have drifted')
	for (const s of ['mlb', 'nfl', 'nba']) assert.match(read(`web/${s}/index.html`), /<script src="license-modal\.js" defer><\/script>/, `${s} does not load it`)
	const league = (sport) => clubConfig({ team: team({ sport }), current: { espnAbbr: 'X' } }).site.leagueName
	assert.deepEqual(['mlb', 'nfl', 'nba'].map(league), ['Major League Baseball', 'the National Football League', 'the National Basketball Association'])
	// Nothing sport-specific is written into the modal itself.
	assert.doesNotMatch(copies[0], /Retrosheet at|Major League Baseball|Brewers/)
})

test('the front end names no path from the root', () => {
	// <base> places every path under the club, and a root-absolute one walks
	// out from under it: /data/games.csv under SCOPE=all is nobody's games.
	// Protocol-relative and external URLs are fine; so are regexes like "/g".
	const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(js|html)$/.test(e.name) ? [`${d}/${e.name}`] : [])
	const offenders = []
	for (const f of walk('web')) {
		const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n')
			.map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
		for (const m of code.matchAll(/(?:['"`]|(?:href|src)=")\/(?!\/|g[,)]|unknown)[a-z$]/g)) offenders.push(`${f}: ${m[0]}`)
	}
	assert.deepEqual(offenders, [])
})

test('the front end names no club', () => {
	// The point of the copy: every club fact arrives as window.CLUB. A literal
	// left behind is a Bears page saying Packers, which nothing would catch.
	// Comments are allowed to remember where the code came from.
	const offenders = []
	const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : [])
	// Per sport, because a code is only a club in its own sport: 'GB' in the
	// baseball standings is Games Behind. And by name rather than city, because
	// the league-wide name table rightly says Milwaukee Braves.
	// Basketball's page is the baseball site's, so its leftovers would be the
	// Brewers' codes.
	const CODES = { mlb: 'MIL|SE1|mil', nfl: 'GB|gb', nba: 'MIL|SE1|mil' }
	const literal = (sport) => new RegExp(`(['"\`])(?:${CODES[sport]})\\1|teams/(?:mil|gb)/|#ThisIsMyCrew|#GoPackGo|['"\`][^'"\`\\n]*\\b(?:Brewers|Packers|Green Bay)\\b`, 'g')
	const files = [...walk('web/mlb').map((f) => [f, 'mlb']), ...walk('web/nfl').map((f) => [f, 'nfl']), ...walk('web/nba').map((f) => [f, 'nba']),
		['lib/calendar.js', 'mlb'], ['lib/espn-box.js', 'nfl']]
	assert.ok(files.length >= 20, `only scanned ${files.length} files`)
	for (const [f, sport] of files) {
		const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
			.map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
		for (const m of code.matchAll(literal(sport))) offenders.push(`${f}: ${m[0]}`)
	}
	assert.deepEqual(offenders, [])
})

test('the calendar finds a simulcast on the club\'s own clock', async () => {
	// A 10:30pm Pacific game is already the next day in Central time and in UTC,
	// and simulcasts are filed under the club's date. On any other clock the
	// game is "not on TV". Pacific on purpose: the machine this was written on
	// runs Central, and a Central club passed here by falling back to it.
	const { buildCalendar } = await import('../lib/calendar.js')
	const { parseTvLookup } = await import('../web/mlb/tv-core.js')
	const lookup = parseTvLookup(read('test/fixtures/brewers-tv/channel_lookup.csv'), read('test/fixtures/brewers-tv/provider_lookup.csv'))
	const event = { id: '1', date: '2026-07-04T05:30Z', _t: 'regular', competitions: [{
		status: { type: { name: 'STATUS_SCHEDULED' } }, broadcasts: [], competitors: [
			{ homeAway: 'home', team: { abbreviation: 'MIL', shortDisplayName: 'Brewers' } },
			{ homeAway: 'away', team: { abbreviation: 'CHC', shortDisplayName: 'Cubs' } }] }] }
	const ics = buildCalendar([event], lookup, new Map([['2026-07-03', ['WMLW']]]),
		{ origin: 'https://example.test', club: { abbr: 'MIL', team: 'Brewers', timeZone: 'America/Los_Angeles' } })
	assert.match(ics, /SUMMARY:Brewers vs Cubs · WMLW/)
})

test('assets and club files cannot be read from outside their directories', () => {
	assert.ok(assetFor('mlb', '/main.js'))
	assert.equal(assetFor('mlb', '/index.html'), null, 'the shell is not an asset')
	assert.equal(assetFor('mlb', '/../../server.js'), null)
	assert.equal(assetFor('mlb', '/..%2f..%2fserver.js'), null)
	assert.ok(clubFileFor('nfl', 'packers', 'photos.csv'))
	assert.equal(clubFileFor('nfl', 'packers', '../../../package.json'), null)
})

test('the ESPN cache shares one fetch per URL and stays inside its byte budget', async () => {
	const { createEspnCache } = await import('../lib/espn.js')
	let fetches = 0
	let clock = 0
	const fetchImpl = async (url) => { fetches++; return { status: 200, text: async () => url.endsWith('big') ? 'x'.repeat(600) : 'y'.repeat(100) } }
	const espn = createEspnCache({ fetchImpl, now: () => clock, maxBytes: 1000 })
	// Two clubs asking for the same scoreboard at once: one fetch.
	await Promise.all([espn('https://site.api.espn.com/a'), espn('https://site.api.espn.com/a')])
	assert.equal(fetches, 1)
	assert.equal((await espn('https://site.api.espn.com/a')).cacheState, 'hit')
	// Past the budget the oldest goes, not everything.
	await espn('https://site.api.espn.com/b')
	await espn('https://site.api.espn.com/big')
	await espn('https://site.api.espn.com/big2-big')
	const { entries, bytes } = espn.stats()
	assert.ok(bytes <= 1000, `${bytes} bytes`)
	assert.ok(entries >= 1)
	assert.equal((await espn('https://site.api.espn.com/big2-big')).cacheState, 'hit')
})

test('a final is held an hour for three days, then a day', () => {
	const summary = (date) => JSON.stringify({ header: { competitions: [{ date, status: { type: { completed: true, state: 'post' } } }] } })
	const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=1'
	const now = Date.parse('2026-10-26T12:00:00Z')
	assert.equal(ttlFor(url, 200, summary('2026-10-25T17:00Z'), now), IDLE_TTL)
	assert.equal(ttlFor(url, 200, summary('2026-10-01T17:00Z'), now), FINAL_TTL)
})

test('stale ESPN data stands in only briefly when ESPN fails', async () => {
	const { createEspnCache } = await import('../lib/espn.js')
	let clock = 0
	let up = true
	const fetchImpl = async () => { if (!up) throw new Error('down'); return { status: 500, text: async () => 'x' } }
	const espn = createEspnCache({ fetchImpl, now: () => clock })
	await espn('https://site.api.espn.com/live')
	up = false
	clock = TTL + 60_000
	assert.equal((await espn('https://site.api.espn.com/live')).cacheState, 'stale')
	clock = TTL + 11 * 60_000
	assert.equal(await espn('https://site.api.espn.com/live'), null)
})

test('the footer is a tab bar up to 1000px in every stylesheet, where its full labels would wrap', () => {
	// Measured on 2026-10-25: from 641px the full labels took two rows on every
	// page until about 1,000px.
	for (const f of ['mlb', 'nfl', 'nba', 'nhl', 'wnba', 'mls', 'ncaaf', 'ncaam'].map((s) => `web/${s}/styles.css`).concat('lib/style.js')) {
		const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8')
		assert.match(css, /@media \(max-width: 1000px\) \{\s*\.footer-nav \{\s*gap: 0\.05rem;/, f)
	}
})
