// College basketball's page (web/ncaam), the NBA's adapted: the tournament's
// rounds, one game each, and a champion who won the national final.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FAMILY, ESPN_LEAGUE, TEMPLATES, gameinfoCsv } from '../lib/web.js'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Wisconsin Badgers', fullName: 'Wisconsin Badgers', teamIds: ['WIS'], copy: {}, site: { espnAbbr: 'WIS', espnSlug: '275' } }
const { SITE } = await import('../web/ncaam/site.js')
const { roundCodeOf, ROUND_LABEL, ROUND_ORDER, parseGameinfoCsv, computeSeasonHistory } = await import('../web/ncaam/records-core.js')
const { worldSeriesTitle, seriesCountdown, espnPostseasonGames } = await import('../web/ncaam/playoff-core.js')
const { postseasonTier } = await import('../web/ncaam/history-chart.js')

test('college basketball is the NBA\'s page with college\'s words', () => {
	assert.equal(FAMILY.ncaam, 'mlb')
	assert.equal(ESPN_LEAGUE.ncaam, 'basketball/mens-college-basketball')
	assert.equal(TEMPLATES.ncaam, TEMPLATES.mlb)
	assert.equal(SITE.championship, 'National Championship')
	assert.equal(SITE.seasonLabel(2015), '2014-2015')
})

test('ESPN\'s notes and the page\'s round names land on the same codes', () => {
	assert.deepEqual([
		'Men\'s Basketball Championship - South Region - First Four',
		'Men\'s Basketball Championship - South Region - 1st Round',
		'Men\'s Basketball Championship - South Region - 2nd Round',
		'Men\'s Basketball Championship - South Region - Sweet 16',
		'Men\'s Basketball Championship - South Region - Elite 8',
		'Men\'s Basketball Championship - Final Four',
		'Men\'s Basketball Championship - National Championship',
		'NIT - First Round',
		'CBI - Quarterfinals',
	].map(roundCodeOf), ['FF', 'R64', 'R32', 'S16', 'E8', 'F4', 'W', 'NIT', 'POST'])
	// A past season's games are named by the labels, and read back by them.
	for (const code of Object.keys(ROUND_ORDER)) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
})

// Wisconsin's 2015 by the server's codes: the final is W, every other stage
// as the load stored it (lib/web-routes.js).
const gametypeOf = (g) => (g.round === 'championship' ? 'W' : g.stage ?? null)
const game = (date, round, stage, us, them, home = true) => ({ id: date.replace(/-/g, ''), season: 2015, date, round, stage, status: 'final',
	home: home ? 'WIS' : 'DUKE', away: home ? 'DUKE' : 'WIS', homeScore: home ? us : them, awayScore: home ? them : us })
const csvOf = (games) => gameinfoCsv(games, { gametypeOf })
const names = 'franchiseName,teamName,league,division,city,team,alternate,startDate,endDate,locationCity,locationState\n'
const historyOf = (games) => computeSeasonHistory(parseGameinfoCsv(csvOf(games), names), { now: new Date('2026-10-26') })[0]

test('a season\'s finish is its deepest round; only the national final makes a champion', () => {
	const regular = game('2015-03-01', 'regular', null, 70, 60)
	const run = [regular, game('2015-03-20', 'playoff', 'R64', 86, 72), game('2015-03-22', 'playoff', 'R32', 72, 65),
		game('2015-03-26', 'playoff', 'S16', 79, 72), game('2015-03-28', 'playoff', 'E8', 85, 78), game('2015-04-04', 'playoff', 'F4', 71, 64)]
	const lost = historyOf([...run, game('2015-04-06', 'championship', 'FINAL', 63, 68)])
	assert.deepEqual([lost.postseason, lost.champion, lost.wins, lost.losses], ['W', false, 1, 0])
	assert.equal(postseasonTier(lost), 'wsApp')
	const won = historyOf([...run, game('2015-04-06', 'championship', 'FINAL', 68, 63)])
	assert.equal(won.champion, true)
	assert.equal(postseasonTier(won), 'wsWin')
	// Unbeaten is the title with no loss: a season with none on record and no
	// title is a season missing games (Duke's 1998-99).
	assert.equal(won.undefeated, true)
	assert.equal(lost.undefeated, false)
	assert.equal(historyOf([regular]).undefeated, false)
	// Winning the NIT is winning its last postseason game, and no title.
	const nit = historyOf([regular, game('2015-03-18', 'playoff', 'NIT', 70, 60), game('2015-04-02', 'playoff', 'NIT', 70, 60)])
	assert.deepEqual([nit.postseason, nit.champion], ['NIT', false])
	assert.equal(postseasonTier(nit), 'other')
	// A tournament the server does not name is postseason all the same.
	assert.equal(historyOf([regular, game('2015-03-18', 'playoff', 'CBI', 70, 60)]).postseason, 'POST')
	// Sweet 16, and a regional third-place game, are the regionals' tier.
	assert.equal(postseasonTier(historyOf([regular, game('2015-03-26', 'playoff', 'S16', 60, 70)])), 'division')
	assert.equal(postseasonTier({ postseason: 'R3RD' }), 'division')
})

const event = (headline, us, them) => ({ date: '2027-03-27T00:00Z', season: { year: 2027 }, competitions: [{ status: { type: { name: 'STATUS_FINAL', state: 'post' } }, notes: [{ headline }],
	competitors: [{ team: { abbreviation: 'WIS', shortDisplayName: 'Wisconsin' }, score: String(us), winner: us > them }, { team: { abbreviation: 'DUKE', shortDisplayName: 'Duke' }, score: String(them), winner: them > us }] }] })

test('one win in the national final is the title; each round is one game', () => {
	assert.equal(worldSeriesTitle([event('Men\'s Basketball Championship - Final Four', 71, 64)]), null)
	assert.equal(worldSeriesTitle([event('Men\'s Basketball Championship - National Championship', 68, 63)]), '2027 National')
	assert.equal(worldSeriesTitle([event('NIT - Championship', 68, 63)]), null)
	// The round is further along ESPN's note than the NBA's.
	const [g] = espnPostseasonGames([event('Men\'s Basketball Championship - West Region - Sweet 16', 79, 72)])
	assert.equal(g.round, 'Sweet 16')
	assert.equal(seriesCountdown({ state: 'won', code: 'S16', round: 'Sweet 16' }), 'Won the Sweet 16 game — on to the Elite Eight')
	assert.equal(seriesCountdown({ state: 'lost', code: 'W', round: 'National Championship', opponent: 'Duke Blue Devils' }),
		'Season over — lost to Duke Blue Devils in the National Championship')
	assert.equal(seriesCountdown({ state: 'won', code: 'W', round: 'National Championship' }), 'National champions!')
})
