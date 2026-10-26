// The strip of the day's scores along the top of every page (lib/scorebar.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { scorebarSports, scorebarHtml, withScorebar } from '../lib/scorebar.js'

const SPORTS = ['nfl', 'mlb', 'nba', 'nhl', 'wnba', 'mls']

test('a page shows its league\'s games, the home page every league\'s, the admin none', () => {
	assert.deepEqual(scorebarSports('/', SPORTS), SPORTS)
	assert.deepEqual(scorebarSports('/nba/', SPORTS), ['nba'])
	assert.deepEqual(scorebarSports('/nba/bucks/history', SPORTS), ['nba'])
	assert.deepEqual(scorebarSports('/nfl/standings', SPORTS), ['nfl'])
	// Not "wnba" for "nba", nor a sport outside the scope.
	assert.deepEqual(scorebarSports('/wnba/fever/', SPORTS), ['wnba'])
	assert.deepEqual(scorebarSports('/nhl/', ['nfl']), [])
	for (const p of ['/admin', '/admin/lineups/3', '/tv/submit', '/nfl/packers/tv/submit', '/healthz', '/nflx/']) {
		assert.deepEqual(scorebarSports(p, SPORTS), [], p)
	}
})

test('the strip goes first in the body, naming its leagues and its club', () => {
	const page = '<html><head></head><body class="undefeated">\n<nav class="club-crumbs"></nav></body></html>'
	const out = withScorebar(page, { sports: ['nba'], club: 'nba/bucks' })
	const at = out.indexOf('<div id="scorebar"')
	assert.ok(at > out.indexOf('<body class="undefeated">') && at < out.indexOf('club-crumbs'))
	assert.match(out, /data-sports="nba" data-club="nba\/bucks" hidden>/)
	assert.match(out, /<script type="module" src="\/scorebar.js"><\/script>/)
	// Hidden until it has games, so a day without any costs no space.
	assert.match(scorebarHtml({ sports: SPORTS }), /data-sports="nfl,mlb,nba,nhl,wnba,mls" hidden>/)
	// No leagues, no strip.
	assert.equal(withScorebar(page, { sports: [] }), page)
})
