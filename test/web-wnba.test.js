import test from 'node:test'
import assert from 'node:assert/strict'
import { FAMILY, ESPN_LEAGUE, wnbaGametype } from '../lib/web.js'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Aces', fullName: 'Las Vegas Aces', teamIds: ['LVA'], copy: {}, site: { espnAbbr: 'LV' } }
const { SITE } = await import('../web/wnba/site.js')
const { roundCodeOf, ROUND_LABEL } = await import('../web/wnba/records-core.js')
const { worldSeriesTitle, raceNumbers, racePanelHtml, standingsRows, leagueSeeds, seriesCountdown } = await import('../web/wnba/playoff-core.js')
const { bracketLayout, bracketSeries, bracketHtml, nextOpponentSeries } = await import('../web/wnba/bracket-core.js')

test('the WNBA is served by the baseball-shaped front end, its seasons one year each', () => {
	assert.equal(FAMILY.wnba, 'mlb')
	assert.equal(ESPN_LEAGUE.wnba, 'basketball/wnba')
	assert.equal(SITE.seasonLabel(2026), '2026')
	assert.equal(SITE.championship, 'WNBA Finals')
})

test('a round is named by where it falls against the Final', () => {
	// Two rounds (1997, 1998): the semifinals and the Finals.
	assert.deepEqual(['R1', 'R2'].map((s) => wnbaGametype(s, 2)), ['L', 'W'])
	// Three (1999-2015, 2022-): no Second Round.
	assert.deepEqual(['R1', 'R2', 'R3'].map((s) => wnbaGametype(s, 3)), ['F', 'L', 'W'])
	// Four (2016-2021).
	assert.deepEqual(['R1', 'R2', 'R3', 'R4'].map((s) => wnbaGametype(s, 4)), ['F', 'D', 'L', 'W'])
	// ESPN's words for the season being played are the page's to read.
	assert.equal(wnbaGametype('RD16', 3), null)
	assert.equal(wnbaGametype('R1', undefined), null)
})

test('ESPN\'s notes and the page\'s round names land on the same codes', () => {
	assert.deepEqual(['First Round - Game 1', 'WNBA Semifinals - Game 1', 'WNBA Finals - Game 1', 'Second Round'].map(roundCodeOf),
		['F', 'L', 'W', 'D'])
	for (const code of ['F', 'D', 'L', 'W']) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
})

const final = (us, them, headline) => ({ competitions: [{ status: { type: { name: 'STATUS_FINAL' } }, notes: [{ headline }],
	competitors: [{ team: { abbreviation: 'LV' }, score: String(us) }, { team: { abbreviation: 'PHX' }, score: String(them) }] }] })

test('the title is four wins in games the notes call the WNBA Finals', () => {
	const three = [1, 2, 3].map(() => final(90, 80, 'WNBA Finals - Game 1'))
	assert.equal(worldSeriesTitle(three), null)
	assert.equal(worldSeriesTitle([...three, final(97, 86, 'WNBA Finals - Game 4')]), 'WNBA Finals')
	assert.equal(worldSeriesTitle([1, 2, 3, 4].map(() => final(90, 80, 'WNBA Semifinals - Game 1'))), null)
	assert.equal(seriesCountdown({ state: 'won', code: 'W', round: 'WNBA Finals' }), 'WNBA champions!')
})

// The league as ESPN's standings answer it: two conferences, each seeded on
// its own. The WNBA's playoffs take the best eight overall.
const entry = (abbr, w, l, seed) => ({ team: { id: abbr, abbreviation: abbr },
	stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'playoffSeed', value: seed }] })
const league = (east, west) => ({ children: [
	{ name: 'Eastern Conference', standings: { entries: east } },
	{ name: 'Western Conference', standings: { entries: west } },
] })

test('the seeds are the league\'s, not each conference\'s', () => {
	// 2026's: the West's fourth (DAL, 27-17) is seeded above the East's fourth
	// (NY, 26-18), and the East's fifth (CHI, 16-28) is out.
	const rows = standingsRows(league(
		[entry('ATL', 30, 14, 1), entry('WSH', 28, 16, 2), entry('IND', 28, 16, 3), entry('NY', 26, 18, 4), entry('CHI', 16, 28, 5), entry('TOR', 11, 33, 6), entry('CON', 11, 33, 7)],
		[entry('MIN', 33, 11, 1), entry('GS', 32, 12, 2), entry('LV', 31, 13, 3), entry('DAL', 27, 17, 4), entry('POR', 17, 27, 5), entry('LA', 16, 28, 6), entry('PHX', 16, 28, 7), entry('SEA', 8, 36, 8)],
	))
	const seeds = leagueSeeds(rows).map((r) => r.abbr)
	assert.deepEqual(seeds.slice(0, 8), ['MIN', 'GS', 'LV', 'ATL', 'WSH', 'IND', 'DAL', 'NY'])
	assert.ok(!seeds.slice(0, 8).includes('CHI'))
})

test('the race is for the eighth seed, over 44 games', () => {
	// Five games left. LV (27-12) and the best club out, POR (20-19): 45 - 27 - 19.
	const rows = standingsRows(league(
		[entry('ATL', 28, 11, 1), entry('WSH', 26, 13, 2), entry('IND', 25, 14, 3), entry('NY', 24, 15, 4), entry('CHI', 15, 24, 5)],
		[entry('MIN', 30, 9, 1), entry('GS', 29, 10, 2), entry('LV', 27, 12, 3), entry('DAL', 23, 16, 4), entry('POR', 20, 19, 5)],
	))
	const n = raceNumbers(rows, { team: 'LV' })
	assert.equal(n.gamesLeft, 5)
	assert.equal(n.seed, 4)
	assert.equal(n.spotMagic, 45 - 27 - 19)
	assert.match(racePanelHtml(n), /Clinched a playoff spot/)
	// POR, out: the last club in is DAL (23-16), so 45 - 23 - 19.
	const p = raceNumbers(rows, { team: 'POR' })
	assert.equal(p.spotElim, 3)
	assert.equal(p.spotBehind, 3)
	assert.match(racePanelHtml(p), /3 out of the eighth seed · elimination number <strong>3<\/strong>/)
})

// A best-of-n series as bracketSeries builds it.
const g = (code, round, a, b, aWins, bWins, n = 0) => {
	const games = []
	for (let i = 0; i < aWins + bWins; i++) {
		const aWon = i < aWins
		games.push({ id: `${a}${b}${i}`, round, code, league: '', n: i + 1, date: `2026-09-${String(20 + n + i).padStart(2, '0')}T23:00Z`,
			state: 'post', final: true, detail: 'Final',
			teams: [{ id: a, abbr: a, name: a, home: i % 2 === 0, score: aWon ? 90 : 80, winner: aWon },
				{ id: b, abbr: b, name: b, home: i % 2 === 1, score: aWon ? 80 : 90, winner: !aWon }] })
	}
	return games
}

test('the bracket is one bracket of eight: first round, semifinals, Finals', () => {
	// 2026's, as ESPN had it on 2026-10-20.
	const series = bracketSeries([
		...g('F', 'First Round', 'NY', 'MIN', 2, 0), ...g('F', 'First Round', 'ATL', 'WSH', 2, 0),
		...g('F', 'First Round', 'LV', 'IND', 2, 1), ...g('F', 'First Round', 'GS', 'DAL', 2, 1),
		...g('L', 'WNBA Semifinals', 'ATL', 'NY', 3, 0, 8), ...g('L', 'WNBA Semifinals', 'GS', 'LV', 3, 0, 8),
		...g('W', 'WNBA Finals', 'GS', 'ATL', 1, 1, 18),
	])
	const lay = bracketLayout(series)
	assert.equal(lay.pairs.length, 2)
	// Each semifinal beside the two first-round series its clubs won.
	const semiOf = (abbr) => lay.pairs.find((p) => p.semi.teams.some((t) => t.abbr === abbr))
	assert.deepEqual(semiOf('ATL').feeders.map((s) => s.teams.map((t) => t.abbr).sort().join('-')).sort(), ['ATL-WSH', 'MIN-NY'])
	assert.equal(lay.ws.teams.map((t) => t.abbr).join('-'), 'GS-ATL')
	assert.equal(lay.ws.winner, null)
	const html = bracketHtml(series, 'LV')
	assert.match(html, /First Round<\/div>.*Semifinals<\/div>.*Finals<\/div>/)
	assert.doesNotMatch(html, /East|West/)
	// A club in the semifinals watches the other one; one in the Finals, nothing.
	assert.equal(nextOpponentSeries(series, 'ATL'), null)
})

test('a club still in a semifinal watches the other one', () => {
	const series = bracketSeries([
		...g('L', 'WNBA Semifinals', 'ATL', 'NY', 2, 1, 8), ...g('L', 'WNBA Semifinals', 'GS', 'LV', 3, 0, 8),
	])
	assert.equal(nextOpponentSeries(series, 'ATL').teams.map((t) => t.abbr).join('-'), 'GS-LV')
})
