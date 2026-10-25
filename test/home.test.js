// The home page: every league's games for a day (lib/today.js) and the page
// that shows them (lib/home.js, filled by web/home/home.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { gameOf, todayGames } from '../lib/today.js'
import { homePage } from '../lib/home.js'

const event = (over = {}) => ({
	id: '401', date: '2026-10-25T20:25Z',
	competitions: [{
		status: { type: { state: 'in', shortDetail: '6:33 - 3rd' } },
		broadcasts: [{ names: ['Fox'] }, { names: ['Fox', 'NFL+'] }],
		competitors: [
			{ homeAway: 'away', score: '14', team: { displayName: 'Green Bay Packers', shortDisplayName: 'Packers', abbreviation: 'GB', logo: 'gb.png' } },
			{ homeAway: 'home', score: '17', records: [{ summary: '4-2' }], team: { displayName: 'Detroit Lions', shortDisplayName: 'Lions', abbreviation: 'DET' } },
		],
	}],
	...over,
})
const clubs = new Map([
	['nfl|green bay packers', { url: '/nfl/packers/', key: 'nfl/packers' }],
	['mls|short:lafc', { url: '/mls/lafc/', key: 'mls/lafc' }],
])

test('a game is its state, its clubs with their pages here, and every network once', () => {
	const g = gameOf(event(), 'nfl', clubs)
	assert.equal(g.state, 'in')
	assert.equal(g.status, '6:33 - 3rd')
	assert.deepEqual([g.away.short, g.away.score, g.away.url, g.away.key], ['Packers', '14', '/nfl/packers/', 'nfl/packers'])
	// A club with no page here is named, not linked.
	assert.deepEqual([g.home.short, g.home.url, g.home.record], ['Lions', null, '4-2'])
	assert.deepEqual(g.tv, ['Fox', 'NFL+'])
	// ESPN's LAFC is matched by its short name within its sport.
	const lafc = gameOf(event({ competitions: [{ ...event().competitions[0], competitors: [
		{ homeAway: 'away', team: { displayName: 'LA Galaxy', shortDisplayName: 'Galaxy' } },
		{ homeAway: 'home', team: { displayName: 'LAFC', shortDisplayName: 'LAFC' } }] }] }), 'mls', clubs)
	assert.equal(lafc.home.url, '/mls/lafc/')
})

test('each league\'s scoreboard is read for the day, and one that fails says so', async () => {
	const asked = []
	const espn = async (url) => {
		asked.push(url)
		if (url.includes('hockey')) return { status: 503, body: '' }
		return { status: 200, body: JSON.stringify({ events: url.includes('football') ? [event()] : [] }) }
	}
	const leagues = await todayGames({ sports: ['nfl', 'nhl', 'mls'], date: '20261025', espn, clubs })
	assert.deepEqual(asked, [
		'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261025',
		'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261025',
		'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=20261025',
	])
	assert.deepEqual(leagues.map((l) => [l.label, l.games.length, Boolean(l.error)]), [['NFL', 1, false], ['NHL', 0, true], ['MLS', 0, false]])
})

test('the page has a section a league, my teams, and every club to find and pin', () => {
	const html = homePage({
		leagues: [{ sport: 'nfl', label: 'NFL', href: '/nfl/' }, { sport: 'mls', label: 'MLS', href: null }],
		clubs: [{ sport: 'nfl', key: 'nfl/packers', name: 'Green Bay Packers', url: '/nfl/packers/', available: true },
			{ sport: 'mls', key: 'mls/lafc', name: 'Los Angeles <FC>', url: null, available: false }],
	})
	assert.match(html, /<section class="lg" data-sport="nfl"/)
	assert.match(html, /<a href="\/nfl\/">NFL<\/a>/)
	assert.match(html, /id="mine" hidden/)
	assert.match(html, /data-leagues="\[&quot;nfl&quot;,&quot;mls&quot;\]"/)
	assert.match(html, /data-pin="nfl\/packers"/)
	assert.match(html, /Los Angeles &lt;FC&gt;/)
	assert.match(html, /<script type="module" src="\/home.js"><\/script>/)
	// Its own list class: the site's .games has a height of its own and scrolls.
	assert.ok(!/class="games"/.test(html))
})

test('with a market, an NFL game says whether its station carries it', async () => {
	const nfl = (away, home, network) => ({
		id: away, date: '2026-10-25T17:00Z', season: { year: 2026, type: 2 }, week: { number: 7 },
		competitions: [{ status: { type: { state: 'post' } }, broadcasts: [{ names: [network] }], competitors: [
			{ homeAway: 'away', team: { displayName: away } }, { homeAway: 'home', team: { displayName: home } }] }],
	})
	const espn = async () => ({ status: 200, body: JSON.stringify({ events: [
		nfl('San Francisco 49ers', 'Atlanta Falcons', 'Fox'), nfl('Tampa Bay Buccaneers', 'Carolina Panthers', 'Fox')] }) })
	const asked = []
	const coverage = async (season, week) => {
		asked.push(`${season}|${week}`)
		return { url: 'u', national: [], regional: [{ network: 'FOX', window: 'EARLY', map: 'm', posted: true,
			games: ['San Francisco @ Atlanta', 'Tampa Bay @ Carolina'], byDma: { Wausau: 'San Francisco @ Atlanta' } }] }
	}
	const [league] = await todayGames({ sports: ['nfl'], date: '20261025', espn, dma: 'Wausau', coverage })
	assert.deepEqual(asked, ['2026|7'], 'the week\'s maps read once')
	assert.deepEqual(league.games.map((g) => g.coverage?.carried), [true, false])
	assert.equal(league.games[1].coverage.other, 'San Francisco @ Atlanta')
	// Without a market, nothing is read and nothing is said.
	const [plain] = await todayGames({ sports: ['nfl'], date: '20261025', espn, coverage })
	assert.ok(plain.games.every((g) => !g.coverage))
})
