// Men's college basketball (Division I): sports/ncaam.js, its reference files
// and champions. Ray, 2026-10-26: every Division I programme; the champion is
// the NCAA tournament's; a conference tournament counts as the conferences
// count it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sport, { cbbdGameRow, liveGameRow, roundOf, postseasonOf, sources } from '../sports/ncaam.js'
import { parseCsv } from '../lib/csv.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory } from '../lib/names.js'
import { loadTeams } from '../lib/teams.js'
import { espnTarget, leagueEndpoints } from '../lib/espn.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const game = (over = {}) => ({
	id: 151, sourceId: '401715439', season: 2025, seasonType: 'regular', gameType: 'STD', tournament: null, status: 'final',
	startDate: '2024-11-06T00:00:00.000Z', neutralSite: false, homeTeamId: 355, homeTeam: 'Wisconsin', homePoints: 85,
	awayTeamId: 111, awayTeam: 'Holy Cross', awayPoints: 61, gameNotes: null, ...over,
})

test('a CollegeBasketballData game: ESPN\'s id where it has one, sides with a c, its Eastern day', () => {
	const r = cbbdGameRow(game())
	assert.deepEqual([r.id, r.season, r.round, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['401715439', 2025, 'regular', 'c355', 'c111', 85, 61, 'final', 'cbbd'])
	assert.equal(r.date, '2024-11-05', '7 pm Eastern is the next day in UTC')
	// An old game has no ESPN id, and keeps the API's own.
	assert.equal(cbbdGameRow(game({ sourceId: 'TRONO#95#128', id: 332899 })).id, 'cbbd-332899')
	assert.equal(cbbdGameRow(game({ status: 'scheduled', homePoints: null, awayPoints: null }), { finished: true }), null)
	// The API gives a game not yet played 0-0, and it is not final; a game
	// called off, or a "final" 0-0, is no game at all.
	const later = cbbdGameRow(game({ status: 'scheduled', homePoints: 0, awayPoints: 0 }))
	assert.deepEqual([later.status, later.homeScore, later.awayScore], ['scheduled', null, null])
	assert.equal(cbbdGameRow(game({ status: 'cancelled', homePoints: 0, awayPoints: 0 })), null)
	assert.equal(cbbdGameRow(game({ status: 'postponed' })), null)
	assert.equal(cbbdGameRow(game({ status: 'final', homePoints: 0, awayPoints: 0 })), null)
})

test('a conference tournament is the regular season\'s; the NCAA tournament, the NIT and the rest are postseason', () => {
	const conf = cbbdGameRow(game({ gameType: 'TRNMNT', gameNotes: 'Big Ten Tournament - 1st Round' }))
	assert.deepEqual([conf.round, conf.stage, conf.title], ['regular', null, 'Big Ten Tournament - 1st Round'])
	const s16 = cbbdGameRow(game({ seasonType: 'postseason', gameType: 'TRNMNT', tournament: 'NCAA', gameNotes: 'Men\'s Basketball Championship - East Region - Sweet 16' }))
	assert.deepEqual([s16.round, s16.stage], ['playoff', 'S16'])
	const nit = cbbdGameRow(game({ seasonType: 'postseason', gameType: 'TRNMNT', tournament: 'NIT', gameNotes: 'NIT - 1st Round' }))
	assert.deepEqual([nit.round, nit.stage], ['playoff', 'NIT'])
	// The final is marked after the load, from the season's NCAA games.
	assert.equal(cbbdGameRow(game({ seasonType: 'postseason', tournament: 'NCAA', gameNotes: 'Men\'s Basketball Championship - National Championship' })).stage, 'FINAL')
})

test('a round from its note, old notes and new', () => {
	assert.equal(roundOf('NCAA Men\'s Tourn., National - National Final'), 'FINAL')
	assert.equal(roundOf('NCAA Men\'s Tourn., National - National Third Place'), 'THIRD')
	assert.equal(roundOf('Men\'s Basketball Championship - Final Four'), 'F4')
	assert.equal(roundOf('Men\'s Basketball Championship - South Region - Elite 8'), 'E8')
	assert.equal(roundOf('Men\'s Basketball Championship - First Four'), 'FF')
	assert.equal(roundOf('NCAA MIDWEST REGION AT SPOKANE WA'), null)
	// A regional third-place game's teams lost in the regional semifinals.
	assert.equal(roundOf('NCAA Men\'s Tourn., East - Regional Third Place'), 'R3RD')
	// 2011 to 2015 counted the First Four as the first round.
	assert.equal(roundOf('MEN\'S BASKETBALL CHAMPIONSHIP - West - 1st ROUND', 2013), 'FF')
	assert.equal(roundOf('MEN\'S BASKETBALL CHAMPIONSHIP - West - 2nd ROUND', 2013), 'R64')
	assert.equal(roundOf('MEN\'S BASKETBALL CHAMPIONSHIP - West - 3rd ROUND', 2013), 'R32')
	assert.equal(roundOf('MEN\'S BASKETBALL CHAMPIONSHIP - West - 2nd ROUND', 2019), 'R32')
	assert.equal(roundOf('Men\'s Basketball Champ. - East - 1st Rd', 2008), 'R64')
	assert.equal(postseasonOf({ tournament: null, gameNotes: 'NCAA MIDWEST REGIONAL' }), 'NCAA')
	assert.equal(postseasonOf({ tournament: 'CBI', gameNotes: '' }), 'CBI')
})

test('a season is the year it ends; ESPN\'s live rows name clubs by ESPN\'s ids', () => {
	assert.equal(sources.live.seasonOf(new Date('2026-11-10T12:00Z')), 2027)
	assert.equal(sources.live.seasonOf(new Date('2027-03-20T12:00Z')), 2027)
	const codes = codeTable('ncaam', loadHistory('ncaam'))
	const event = { id: '401800001', date: '2026-11-04T00:00Z', season: { year: 2027, type: 2 },
		competitions: [{ status: { type: { completed: false, name: 'STATUS_SCHEDULED' } }, competitors: [
			{ homeAway: 'home', team: { id: '275' }, score: '0' }, { homeAway: 'away', team: { id: '99999' }, score: '0' }] }] }
	const r = liveGameRow(event, { franchiseOf: codes.franchiseOf, knows: codes.knows })
	assert.deepEqual([r.home, r.away, r.season], ['WIS', '99999', 2027])
	// CollegeBasketballData's 355 is Wisconsin; ESPN's 275 is too; neither is the other.
	assert.equal(codes.franchiseOf('c355'), 'WIS')
	assert.notEqual(codes.franchiseOf('355'), 'WIS')
	// ESPN's Division I, whatever the page asks.
	assert.match(espnTarget(leagueEndpoints({ league: 'basketball/mens-college-basketball' }), 'apis/site/v2/sports/basketball/mens-college-basketball/scoreboard', 'dates=20261110'), /groups=50&limit=400$/)
})

test('every Division I programme: one manifest each, its codes its own', async () => {
	const history = parseCsv(read('data/reference/ncaam-franchise-history.csv'))
	assert.equal(history.length, 365)
	const teams = (await loadTeams()).filter((t) => t.sport === 'ncaam')
	assert.equal(teams.length, 365)
	assert.equal(teams.length, readdirSync(join(ROOT, 'teams', 'ncaam')).length)
	const codes = codeTable('ncaam', loadHistory('ncaam'))
	for (const t of teams) assert.equal(codes.franchiseOf(t.site.espnSlug), t.sourceIds[0], t.id)
	assert.equal(sport.defaults.rules.standingsByConference, true)
})

test('the champions before the games: 1939 to 1949, each a club', () => {
	const rows = parseCsv(read('data/reference/ncaam-champions.csv'))
	assert.deepEqual(rows.map((r) => r.season), ['1939', '1940', '1941', '1942', '1943', '1944', '1945', '1946', '1947', '1948', '1949'])
	assert.deepEqual(rows.filter((r) => ['1941', '1948', '1949'].includes(r.season)).map((r) => r.champion), ['WIS', 'UK', 'UK'])
	assert.ok(rows.every((r) => r.champion), 'every champion is a club here')
})
