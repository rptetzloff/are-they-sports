// College football's page (web/ncaaf), the NFL's adapted: what the server
// gives it and the rules its own copy changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FAMILY, ESPN_LEAGUE, TEMPLATES, nflGameRow } from '../lib/web.js'
import { endpointsFor, leagueEndpoints, espnTarget } from '../lib/espn.js'
import { resolver } from '../lib/names.js'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Ohio State Buckeyes', fullName: 'Ohio State Buckeyes', teamIds: ['OSU'], copy: {}, site: { standingsTitles: [1942, 1968] } }
const { SITE } = await import('../web/ncaaf/site.js')
const { computeSeasonHistory, computeSuperlatives } = await import('../web/ncaaf/records-core.js')

test('college football is football: the NFL\'s page, ESPN\'s college league', () => {
	assert.equal(FAMILY.ncaaf, 'nfl')
	assert.equal(ESPN_LEAGUE.ncaaf, 'football/college-football')
	assert.equal(TEMPLATES.ncaaf, TEMPLATES.nfl)
	assert.equal(SITE.championship, 'National Championship')
})

test('a title game carries its own name; other postseason games none', () => {
	const g = (over) => ({ home: 'OSU', away: 'ORE', homeScore: 42, awayScore: 20, status: 'final', season: 2014, date: '2015-01-12', neutral: true, ...over })
	const nameOf = (code) => code
	assert.equal(nflGameRow(g({ round: 'championship', title: 'College Football Playoff' }), 'OSU', nameOf, 'ncaaf').superbowl, 'College Football Playoff')
	assert.equal(nflGameRow(g({ round: 'playoff', stage: 'BOWL' }), 'OSU', nameOf, 'ncaaf').superbowl, '')
	// The NFL's are unchanged: a numeral, and only on a Super Bowl.
	assert.equal(nflGameRow(g({ season: 2010, round: 'championship', title: 'Super Bowl', stage: 'SB' }), 'OSU', nameOf).superbowl, 'xlv')
	assert.equal(nflGameRow(g({ season: 1962, round: 'championship', title: 'NFL Championship' }), 'OSU', nameOf).superbowl, '')
})

test('college\'s scoreboard is always the whole FBS; the NFL\'s is as asked', () => {
	const league = leagueEndpoints({ league: 'football/college-football' })
	assert.equal(espnTarget(league, 'apis/site/v2/sports/football/college-football/scoreboard', 'week=8'),
		'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?week=8&groups=80&limit=300')
	// A club's page too: an unranked club's live game is not on ESPN's default.
	const club = endpointsFor({ league: 'football/college-football', slug: '275' })
	assert.match(espnTarget(club, 'apis/site/v2/sports/football/college-football/scoreboard', ''), /\?groups=80&limit=300$/)
	// The visitor cannot ask for something else under those names.
	assert.equal(espnTarget(league, 'apis/site/v2/sports/football/college-football/scoreboard', 'groups=5'), null)
	const nfl = leagueEndpoints({ league: 'football/nfl' })
	assert.equal(espnTarget(nfl, 'apis/site/v2/sports/football/nfl/scoreboard', 'week=8'), 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=8')
})

test('an opponent that is no club is named from ncaaf-opponents.csv', () => {
	const name = resolver('ncaaf')
	assert.equal(name('266', { season: 1892 }).name, 'Beloit')
	assert.equal(name('WIS', { season: 2025 }).name, 'Wisconsin Badgers')
	// Unknown everywhere: the code, as before.
	assert.equal(name('999999', { season: 2025 }).name, '999999')
})

const row = (season, result, { reg = true, title = '' } = {}) => ({
	season: String(season), date: `${season}-10-01`, result, regular_season: reg ? '1' : '0', playoff: reg ? '0' : '1',
	championship: title, scoreFor: '30', scoreAgainst: '10',
})

test('a bowl win is not a title; the title game and the AP\'s No. 1 are', () => {
	const now = new Date('2026-10-25')
	const seasons = computeSeasonHistory([
		...Array.from({ length: 11 }, () => row(2013, 'WIN')), row(2013, 'WIN', { reg: false }), // won the Orange Bowl
		...Array.from({ length: 12 }, () => row(2014, 'WIN')), row(2014, 'WIN', { reg: false, title: 'College Football Playoff' }),
		...Array.from({ length: 9 }, () => row(1942, 'WIN')), // the AP's No. 1 (standingsTitles)
	], { now })
	const by = Object.fromEntries(seasons.map((s) => [s.season, s]))
	assert.equal(by[2013].champion, false, 'a bowl win')
	assert.equal(by[2014].champion, true)
	assert.equal(by[2014].championship, true)
	assert.equal(by[1942].champion, true, 'the AP poll\'s title')
})

test('a season counts in the season lists only from five games on record', () => {
	const now = new Date('2026-10-25')
	const s = computeSuperlatives([
		row(1897, 'LOSS'), // one game on record: not the worst season ever
		row(1898, 'WIN'), // nor an unbeaten one
		...['WIN', 'WIN', 'LOSS', 'LOSS', 'LOSS', 'LOSS'].map((r) => row(1947, r)),
		...Array.from({ length: 6 }, () => row(2002, 'WIN')),
	], { now })
	assert.deepEqual(s.worstSeasons.map((x) => x.season), [1947, 2002])
	assert.deepEqual(s.perfectSeasons.map((x) => x.season), [2002])
})
