import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clubConfig, currentNamesCsv, gameinfoRow } from '../lib/web.js'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Bucks', fullName: 'Milwaukee Bucks', teamIds: ['MIL'], copy: {}, site: { espnAbbr: 'MIL' } }
const { SITE } = await import('../web/nba/site.js')
const { roundCodeOf, ROUND_LABEL } = await import('../web/nba/records-core.js')
const { worldSeriesTitle, raceNumbers, racePanelHtml, standingsRows, seriesCountdown } = await import('../web/nba/playoff-core.js')
const { bracketLayout, bracketSeries, bracketGames } = await import('../web/nba/bracket-core.js')
const { liveDetail, liveDetailHtml } = await import('../web/nba/live-core.js')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('a basketball season is written as the two years it spans', () => {
	// Ray, 2026-10-19: "2026-2027".
	assert.equal(SITE.seasonLabel(2027), '2026-2027')
	assert.equal(SITE.championship, 'NBA Finals')
})

test('ESPN\'s round notes become the four rounds, NBA Finals before conference finals', () => {
	assert.deepEqual(['NBA Finals - Game 7', 'East 1st Round - Game 3', 'West Semifinals - Game 5', 'East Finals - Game 2'].map(roundCodeOf),
		['W', 'F', 'D', 'L'])
	assert.deepEqual([ROUND_LABEL.F, ROUND_LABEL.D, ROUND_LABEL.L, ROUND_LABEL.W],
		['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'])
})

const final = (us, them, headline) => ({ competitions: [{ status: { type: { name: 'STATUS_FINAL' } }, notes: [{ headline }],
	competitors: [{ team: { abbreviation: 'MIL' }, score: String(us) }, { team: { abbreviation: 'PHX' }, score: String(them) }] }] })

test('the Finals are won with four wins in games the notes call the NBA Finals', () => {
	const three = [1, 2, 3].map(() => final(110, 100, 'NBA Finals - Game 1'))
	assert.equal(worldSeriesTitle(three), null)
	assert.equal(worldSeriesTitle([...three, final(105, 98, 'NBA Finals - Game 6')]), 'NBA Finals')
	// Four conference-finals wins are not a title.
	assert.equal(worldSeriesTitle([1, 2, 3, 4].map(() => final(110, 100, 'East Finals - Game 1'))), null)
	assert.equal(seriesCountdown({ state: 'won', code: 'W', round: 'NBA Finals' }), 'NBA champions!')
	assert.equal(seriesCountdown({ state: 'won', code: 'F', round: 'East 1st Round' }), 'Won the East 1st Round — on to the East Semifinals')
})

test('the race is six seeds in and four more in the play-in, over 82 games, with no division', () => {
	// A conference group is flat: no division children.
	const entry = (abbr, w, l, seed) => ({ team: { abbreviation: abbr }, stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'playoffSeed', value: seed }] })
	const data = { name: 'Eastern Conference', standings: { entries: [
		entry('BOS', 55, 20, 1), entry('NY', 50, 25, 6), entry('MIL', 44, 31, 8), entry('CHI', 40, 35, 10), entry('DET', 38, 37, 11)] } }
	const rows = standingsRows(data)
	assert.equal(rows.length, 5)
	const n = raceNumbers(rows)
	assert.deepEqual([n.gamesLeft, n.inPosition, n.inPlayIn], [7, false, true])
	// 83 - 44 wins - DET's 37 losses.
	assert.equal(n.playInMagic, 2)
	const html = racePanelHtml(n)
	assert.match(html, /Magic number for the play-in: <strong>2<\/strong>/)
	assert.doesNotMatch(html, /division|wild card/i)
})

const espnEvent = (id, headline, home, away, winner, date) => ({ id, date, season: { type: 3 }, competitions: [{
	notes: [{ headline }], status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
	competitors: [
		{ id: home, homeAway: 'home', team: { abbreviation: home, shortDisplayName: home }, score: 100, winner: winner === home },
		{ id: away, homeAway: 'away', team: { abbreviation: away, shortDisplayName: away }, score: 90, winner: winner === away },
	] }] })

test('each semifinal sits beside the two first-round series its teams came from', () => {
	// Four first-round series, each won 4-0; then BOS and MIL meet in one
	// semifinal. The pairing is read from who advanced, never from seeds.
	const sweep = (a, b, day) => [1, 2, 3, 4].map((g) => espnEvent(`${a}${g}`, `East 1st Round - Game ${g}`, a, b, a, `2025-04-${day + g}T00:00Z`))
	const games = bracketGames([
		...sweep('BOS', 'ORL', 10), ...sweep('NY', 'DET', 10), ...sweep('MIL', 'IND', 10), ...sweep('CLE', 'MIA', 10),
		espnEvent('S1', 'East Semifinals - Game 1', 'BOS', 'MIL', 'BOS', '2025-05-01T00:00Z'),
	])
	const lay = bracketLayout(bracketSeries(games))
	const first = lay.East.pairs[0]
	assert.equal(first.semi.teams.map((t) => t.abbr).sort().join(','), 'BOS,MIL')
	assert.deepEqual(first.feeders.map((s) => s.winner).sort(), ['BOS', 'MIL'])
	// The other two first-round series wait as a pair for their semifinal.
	assert.equal(lay.East.pairs[1].semi, null)
	assert.deepEqual(lay.East.pairs[1].feeders.map((s) => s.winner).sort(), ['CLE', 'NY'])
	assert.equal(lay.West.pairs.length, 0)
})

test('the live card reads the quarters, the leaders and the last play', () => {
	const summary = {
		header: { id: '401', competitions: [{ status: { type: { state: 'in', detail: 'Q3 4:12' } }, competitors: [
			{ homeAway: 'home', team: { id: '15', abbreviation: 'MIL' }, score: '70', linescores: [{ displayValue: '30' }, { displayValue: '25' }, { displayValue: '15' }] },
			{ homeAway: 'away', team: { id: '2', abbreviation: 'BOS' }, score: '66', linescores: [{ displayValue: '20' }, { displayValue: '30' }, { displayValue: '16' }] },
		] }] },
		leaders: [{ team: { abbreviation: 'MIL' }, leaders: [{ name: 'points', leaders: [{ athlete: { shortName: 'G. Antetokounmpo' }, displayValue: '31' }] }] }],
		plays: [{ text: 'Jump ball', period: { number: 1 } }, { text: 'Lillard makes 3-pt shot', period: { number: 3 }, clock: { displayValue: '4:12' } }],
	}
	const d = liveDetail(summary)
	assert.deepEqual([d.state, d.detail, d.teams.find((t) => t.abbr === 'MIL').score, d.teams.find((t) => t.abbr === 'MIL').leader.line],
		['in', 'Q3 4:12', 70, '31'])
	const html = liveDetailHtml(d)
	assert.match(html, /Q1.*Q2.*Q3.*Q4/s)
	assert.match(html, /G\. Antetokounmpo/)
	assert.match(html, /Q3 4:12 · Lillard makes 3-pt shot/)
	assert.equal(liveDetailHtml({ ...d, state: 'post' }), '')
})

test('a season-counted franchise table becomes the date spans the page compares against', () => {
	const csv = currentNamesCsv([
		{ franchiseAbbrv: 'OKC', teamAbbrv: 'SEA', league: 'NBA', division: '', city: 'Seattle', teamName: 'SuperSonics', alternateName: 'Sonics', startSeason: '2002', endSeason: '2008' },
		{ franchiseAbbrv: 'OKC', teamAbbrv: 'OKC', league: 'NBA', division: '', city: 'Oklahoma City', teamName: 'Thunder', alternateName: '', startSeason: '2009', endSeason: '' },
	])
	const [, sonics, thunder] = csv.trim().split('\n')
	assert.match(sonics, /,10\/1\/2001,9\/30\/2008,/)
	assert.match(thunder, /,10\/1\/2008,,/)
})

test('an ESPN event id is not a game number', () => {
	const g = { id: '401859967', season: 2026, date: '2026-06-19', round: 'championship', stage: 'FINAL', home: 'SAS', away: 'NYK', homeScore: 90, awayScore: 94, status: 'final' }
	assert.equal(gameinfoRow(g).number, '0')
	assert.equal(gameinfoRow(g).gametype, 'FINAL')
	assert.equal(gameinfoRow({ ...g, id: 'CHA196904202' }).number, '2')
})

test('a basketball club is told its conference\'s standings group', () => {
	const team = (o) => ({ sport: 'nba', id: 'x', sourceIds: ['X'], firstSeason: 1950, nouns: { team: 'X', fullName: 'X' }, copy: {}, ...o })
	assert.equal(clubConfig({ team: team(), current: { espnAbbr: 'MIL', conference: 'Eastern' } }).site.leagueGroup, 5)
	assert.equal(clubConfig({ team: team(), current: { espnAbbr: 'LAL', conference: 'Western' } }).site.leagueGroup, 6)
	assert.equal(clubConfig({ team: team(), current: { espnAbbr: 'MIL' } }).site.espnLeague, 'basketball/nba')
})

test('basketball\'s page carries every module the baseball page imports', () => {
	// main.js is the baseball page's; a module it imports that basketball has
	// no copy of would be a 404 and a blank page.
	const imports = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js'))
	const missing = imports('web/mlb').filter((f) => !imports('web/nba').includes(f))
	assert.deepEqual(missing, [])
})
