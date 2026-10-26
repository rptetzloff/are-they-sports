// The strip of scores along the top of every page (lib/scorebar.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { scorebarSports, scorebarFor, scorebarHtml, withScorebar } from '../lib/scorebar.js'
import { todayGames } from '../lib/today.js'

const SPORTS = ['nfl', 'mlb', 'nba', 'nhl', 'wnba', 'mls']

test('every page offers every league, its own first; the admin none', () => {
	assert.deepEqual(scorebarSports('/', SPORTS), SPORTS)
	assert.deepEqual(scorebarSports('/nba/', SPORTS), ['nba', 'nfl', 'mlb', 'nhl', 'wnba', 'mls'])
	assert.deepEqual(scorebarSports('/nba/bucks/history', SPORTS)[0], 'nba')
	assert.deepEqual(scorebarSports('/nfl/standings', SPORTS), SPORTS)
	// Not "nba" for "wnba", and a path that is no league keeps the scope's order.
	assert.equal(scorebarSports('/wnba/fever/', SPORTS)[0], 'wnba')
	assert.deepEqual(scorebarSports('/nflx/', SPORTS), SPORTS)
	for (const p of ['/admin', '/admin/lineups/3', '/tv/submit', '/nfl/packers/tv/submit']) {
		assert.deepEqual(scorebarSports(p, SPORTS), [], p)
	}
	// The league the strip opens on: the page's own, or none, and then all.
	assert.equal(scorebarFor('/nba/bucks/', SPORTS).lead, 'nba')
	assert.equal(scorebarFor('/nfl/standings', SPORTS).lead, 'nfl')
	assert.equal(scorebarFor('/', SPORTS).lead, null)
	assert.equal(scorebarFor('/nflx/', SPORTS).lead, null)
})

test('the strip goes first in the body, with its leagues, its club and the way to choose', () => {
	const page = '<html><head></head><body class="undefeated">\n<nav class="club-crumbs"></nav></body></html>'
	const leagues = [{ sport: 'nba', label: 'NBA' }, { sport: 'nfl', label: 'NFL' }]
	const out = withScorebar(page, { leagues, club: 'nba/bucks', lead: 'nba' })
	const at = out.indexOf('<div id="scorebar"')
	assert.ok(at > out.indexOf('<body class="undefeated">') && at < out.indexOf('club-crumbs'))
	assert.match(out, /data-leagues="\[\{&quot;sport&quot;:&quot;nba&quot;,&quot;label&quot;:&quot;NBA&quot;\},/)
	assert.match(out, /data-club="nba\/bucks" data-lead="nba" hidden>/)
	// A list of leagues, and a second, hidden until a league has filters.
	assert.match(out, /<select class="sb-league" aria-label="League">/)
	assert.match(out, /<label class="sb-pick" hidden><span class="sb-cur" aria-hidden="true">All games<\/span><select class="sb-league sb-filter" aria-label="Which games">/)
	assert.doesNotMatch(withScorebar(page, { leagues }), /data-lead/)
	assert.match(out, /<div class="sb-panel" id="sb-panel" hidden>/)
	assert.match(out, /<script type="module" src="\/scorebar.js"><\/script>/)
	// No leagues, no strip.
	assert.equal(withScorebar(page, { leagues: [] }), page)
	assert.equal(scorebarHtml({ leagues: [] }), '')
})

test('football\'s week is its scoreboard asked for no day; the others keep the day', async () => {
	const asked = []
	const espn = async (url) => { asked.push(url); return { status: 200, body: '{"events":[]}' } }
	await todayGames({ sports: ['nfl', 'ncaaf', 'nba'], date: '20261025', espn, footballWeek: true })
	assert.deepEqual(asked, [
		'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
		// The whole FBS: without group 80 a week is only the ranked teams' games.
		'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300',
		'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261025',
	])
	// A day, for the home page, is still a day, and still the whole FBS.
	asked.length = 0
	await todayGames({ sports: ['ncaaf'], date: '20261024', espn })
	assert.deepEqual(asked, ['https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261024&groups=80&limit=300'])
})

test('each side carries its conference, division and poll rank, for the filters', async () => {
	const comp = (rank) => ({ homeAway: 'home', curatedRank: { current: rank }, team: { displayName: 'Green Bay Packers' } })
	const espn = async () => ({ status: 200, body: JSON.stringify({ events: [{ id: '1', competitions: [{ status: { type: { state: 'pre' } }, competitors: [
		comp(7), { homeAway: 'away', curatedRank: { current: 99 }, team: { displayName: 'Detroit Lions' } }] }] }] }) })
	const clubs = new Map([['nfl|green bay packers', { url: '/nfl/packers/', key: 'nfl/packers', conference: 'NFC', division: 'North' }]])
	const [nfl] = await todayGames({ sports: ['nfl'], date: '20261025', espn, clubs })
	const g = nfl.games[0]
	assert.deepEqual([g.home.conference, g.home.division, g.home.rank], ['NFC', 'North', 7])
	// 99 is ESPN's "unranked"; a club with no page here has no conference.
	assert.deepEqual([g.away.conference, g.away.division, g.away.rank], [null, null, null])
})
