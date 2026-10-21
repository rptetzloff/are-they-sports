import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crumbsHtml, shell, clubConfig } from '../lib/web.js'
import { tvStatusOf, tvLineOf } from '../web/nfl/scoreboard-core.js'
import { loadTeams } from '../lib/teams.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// Ray, 2026-10-21: "I think we should be changing the question to are they on
// tv? not are they undefeated? also, a way on a club page (if not in single
// club mode) to get back to the league/main page".

const event = (broadcasts, { state = 'pre', date = '2026-10-25T20:25:00Z' } = {}) => ({
	date, competitions: [{ status: { type: { state } }, broadcasts }],
})
const b = (name, type) => ({ media: { shortName: name }, type: { shortName: type } })

test('football answers the TV question from ESPN\'s word for each broadcast', () => {
	assert.equal(tvStatusOf(event([b('FOX', 'TV')])), 'yes')
	assert.equal(tvStatusOf(event([b('Prime Video', 'Streaming'), b('KMSP', 'TV')])), 'yes')
	assert.equal(tvStatusOf(event([b('Prime Video', 'Streaming')])), 'streaming')
	assert.equal(tvStatusOf(event([b('WTMJ', 'Radio')])), 'no')
	assert.equal(tvStatusOf(event([{ type: { shortName: 'TV' } }])), 'no', 'a broadcast without a name is nothing to watch')
	assert.equal(tvStatusOf(null), 'no')
})

test('the answer\'s second line says when and where', () => {
	assert.equal(tvLineOf(event([b('Fox', 'TV'), b('Fox', 'TV')]), { timeZone: 'America/Chicago' }), 'Sun, Oct 25, 3:25 PM · Fox')
	assert.equal(tvLineOf(event([b('NBC', 'TV')], { state: 'in' })), 'On now · NBC')
	assert.equal(tvLineOf(null), '')
})

test('every baseball-family page asks the TV question of every club', () => {
	for (const s of ['mlb', 'nba', 'nhl', 'wnba', 'mls']) {
		const main = read(`web/${s}/main.js`)
		assert.ok(main.includes('tvStatus = this.getTvStatus(tvGame);'), s)
		assert.ok(!main.includes('SITE.tv ? this.getTvStatus'), `${s} still asks only clubs with listings`)
	}
})

test('a club page in a site of many clubs starts with the way back up', async () => {
	const clubs = [
		{ sport: 'nfl', teamId: 'packers', name: 'Green Bay Packers', href: '/nfl/packers/' },
		{ sport: 'mlb', teamId: 'brewers', name: 'Milwaukee Brewers', href: '/mlb/brewers/' },
	]
	const html = crumbsHtml(clubs, { sport: 'nfl', teamId: 'packers' })
	assert.match(html, /<a href="\/">.*All clubs<\/a>/)
	assert.match(html, /<a href="\/nfl\/">.*NFL<\/a>/)
	// One club is its own site: no main page, no league page.
	assert.equal(crumbsHtml(clubs.slice(0, 1), { sport: 'nfl', teamId: 'packers' }), '')

	const teams = await loadTeams()
	const cfg = clubConfig({ team: teams.find((t) => t.id === 'packers'), current: { espnAbbr: 'GB' } })
	// First in the body, above the front page's grid.
	const club = shell(read('web/nfl/index.html'), { config: cfg, clubs, current: { sport: 'nfl', teamId: 'packers' }, base: '/nfl/packers' })
	assert.match(club, /<body>\s*<nav class="club-crumbs"/)
	// A league's page is not a club's, and has its own way home.
	const league = shell(read('web/nfl/league.html'), { config: cfg, clubs, current: { sport: 'nfl', teamId: null }, base: '/nfl' })
	assert.ok(!league.includes('club-crumbs'))
	assert.ok(!shell(read('web/nfl/index.html'), { config: cfg, clubs: clubs.slice(0, 1), current: { sport: 'nfl', teamId: 'packers' } }).includes('club-crumbs'))
})
