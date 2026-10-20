import test from 'node:test'
import assert from 'node:assert/strict'
import { gameinfoCsv, gameinfoRow, nhlGametype, FAMILY, ESPN_LEAGUE } from '../lib/web.js'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Jets', fullName: 'Winnipeg Jets', teamIds: ['WPG'], copy: {}, site: { espnAbbr: 'WPG' } }
const { SITE, hockeyRecord } = await import('../web/nhl/site.js')
const { roundCodeOf, ROUND_LABEL, computeSeasonHistory, seasonTally, hyphenRecord, isOtLoss, espnEnding } = await import('../web/nhl/records-core.js')
const { worldSeriesTitle, raceNumbers, racePanelHtml, standingsRows, playoffPicture, seriesCountdown } = await import('../web/nhl/playoff-core.js')
const { liveDetail, liveDetailHtml, periodName } = await import('../web/nhl/live-core.js')

test('hockey is served by the baseball-shaped front end, from ESPN\'s hockey paths', () => {
	assert.equal(FAMILY.nhl, 'mlb')
	assert.equal(ESPN_LEAGUE.nhl, 'hockey/nhl')
	assert.equal(SITE.seasonLabel(2027), '2026-2027')
	assert.equal(SITE.championship, 'Stanley Cup Final')
})

test('a record is written as the NHL wrote it in that season', () => {
	// W-L-T until 1998-99; W-L-T-OTL from 1999-2000 until the shootout;
	// W-L-OTL since, the third number shown even at zero, as the NHL does.
	assert.equal(hockeyRecord({ w: 43, l: 27, t: 10 }, { season: 1985 }), '43-27-10')
	assert.equal(hockeyRecord({ w: 40, l: 30, t: 0 }, { season: 1985 }), '40-30')
	assert.equal(hockeyRecord({ w: 35, l: 30, t: 10, otl: 7 }, { season: 2003 }), '35-30-10-7')
	assert.equal(hockeyRecord({ w: 4, l: 2, otl: 2 }, { season: 2027 }), '4-2-2')
	assert.equal(hockeyRecord({ w: 4, l: 2, otl: 0 }, { season: 2027 }), '4-2-0')
	// The postseason has no ties or overtime losses.
	assert.equal(hockeyRecord({ w: 3, l: 1 }, { season: 2027, regular: false }), '3-1')
	assert.equal(hockeyRecord({ w: 4, l: 2, otl: 2 }, { season: 2027, dash: '–' }), '4–2–2')
})

const game = (season, result, ending, over = {}) => ({
	season: String(season), date: `${season - 1}-11-01`, result, ending, regular_season: '1', playoff: '0',
	championship: '', gametype: 'R', scoreFor: '3', scoreAgainst: '2', ...over,
})

test('an overtime loss is a regular-season loss past regulation, from 1999-2000 on', () => {
	assert.equal(isOtLoss(game(2027, 'LOSS', 'OT')), true)
	assert.equal(isOtLoss(game(2027, 'LOSS', 'SO')), true)
	assert.equal(isOtLoss(game(2027, 'LOSS', 'REG')), false)
	// Before the point for an overtime loss, it was a loss.
	assert.equal(isOtLoss(game(1990, 'LOSS', 'OT')), false)
	// A playoff loss in overtime is a loss.
	assert.equal(isOtLoss(game(2027, 'LOSS', 'OT', { regular_season: '0', playoff: '1' })), false)
	assert.equal(isOtLoss(game(2027, 'WIN', 'OT')), false)
})

test('a season counts its overtime losses apart, and ranks by points percentage', () => {
	const rows = [game(2027, 'WIN', 'REG'), game(2027, 'WIN', 'SO'), game(2027, 'LOSS', 'REG'), game(2027, 'LOSS', 'OT')]
	const tally = seasonTally(rows)
	assert.deepEqual([tally.wins, tally.losses, tally.ties, tally.otl], [2, 1, 0, 1])
	assert.equal(tally.undefeated, false)
	// An overtime loss is still a loss to "undefeated".
	assert.equal(seasonTally([game(2027, 'WIN', 'REG'), game(2027, 'LOSS', 'OT')]).undefeated, false)
	const [s] = computeSeasonHistory(rows)
	assert.equal(s.record, '2–1–1')
	// Five points of eight.
	assert.equal(s.winPct, 5 / 8)
	assert.equal(hyphenRecord(rows), '2-1-1')
})

test('rounds are counted back from the Final, so a two-round season ends in a Final', () => {
	assert.deepEqual(['R1', 'R2', 'R3', 'R4'].map((s) => nhlGametype(s)), ['F', 'D', 'L', 'W'])
	// 1918-1967: two rounds, the semifinal and the Final.
	assert.deepEqual(['R1', 'R2'].map((s) => nhlGametype(s, 2)), ['L', 'W'])
	assert.deepEqual(['R1', 'R2', 'R3'].map((s) => nhlGametype(s, 3)), ['D', 'L', 'W'])
	assert.equal(nhlGametype(null), null)
	assert.equal(nhlGametype('STD'), null)
})

test('the gameinfo row carries how a game ended, and a sport can name its rounds', () => {
	const g = { id: '2025030411', season: 2026, date: '2026-06-04', round: 'championship', stage: 'R4',
		home: 'CAR', away: 'VGK', homeScore: 3, awayScore: 4, status: 'final', ending: 'OT' }
	const row = gameinfoRow(g, { gametypeOf: (x) => nhlGametype(x.stage, 4) })
	assert.equal(row.ending, 'OT')
	assert.equal(row.gametype, 'W')
	// Without one, the stored stage, as for basketball and baseball.
	assert.equal(gameinfoRow(g).gametype, 'R4')
	// An unplayed game has no ending yet.
	assert.equal(gameinfoRow({ ...g, status: 'scheduled', ending: null }).ending, '')
	const [header, line] = gameinfoCsv([g]).trim().split('\n')
	assert.equal(header.split(',').at(-1), 'ending')
	assert.equal(line.split(',').at(-1), 'OT')
})

test('ESPN\'s round notes and the page\'s own round names land on the same codes', () => {
	assert.deepEqual(['Stanley Cup Final - Game 3', 'East 1st Round - Game 4', 'West 2nd Round - Game 5', 'West Final - Game 4'].map(roundCodeOf),
		['W', 'F', 'D', 'L'])
	// Past seasons' series arrive named by ROUND_LABEL, and are read back by the
	// same patterns; a label they did not match would never close its series.
	for (const code of ['F', 'D', 'L', 'W']) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
})

const final = (us, them, headline) => ({ competitions: [{ status: { type: { name: 'STATUS_FINAL' } }, notes: [{ headline }],
	competitors: [{ team: { abbreviation: 'WPG' }, score: String(us) }, { team: { abbreviation: 'CAR' }, score: String(them) }] }] })

test('the Cup is won with four wins in games the notes call the Stanley Cup Final', () => {
	const three = [1, 2, 3].map(() => final(4, 2, 'Stanley Cup Final - Game 1'))
	assert.equal(worldSeriesTitle(three), null)
	assert.equal(worldSeriesTitle([...three, final(3, 2, 'Stanley Cup Final - Game 6')]), 'Stanley Cup Final')
	assert.equal(worldSeriesTitle([1, 2, 3, 4].map(() => final(4, 2, 'West Final - Game 1'))), null)
	assert.equal(seriesCountdown({ state: 'won', code: 'W', round: 'Stanley Cup Final' }), 'Stanley Cup champions!')
})

// A conference as ESPN's group=8 answers it: two divisions of entries.
const entry = (abbr, w, l, otl, gp = w + l + otl, seed = 99) => ({ team: { id: abbr, abbreviation: abbr },
	stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'otLosses', value: otl },
		{ name: 'points', value: 2 * w + otl }, { name: 'gamesPlayed', value: gp }, { name: 'playoffSeed', value: seed }] })
const conference = (central, pacific) => ({ children: [
	{ name: 'Central Division', standings: { entries: central } },
	{ name: 'Pacific Division', standings: { entries: pacific } },
] })

test('the playoff picture is each division\'s top three and two wild cards, by points', () => {
	const rows = standingsRows(conference(
		[entry('WPG', 50, 20, 4), entry('DAL', 48, 22, 4), entry('COL', 46, 24, 4), entry('MIN', 45, 25, 4), entry('STL', 44, 26, 4), entry('NSH', 30, 40, 4)],
		[entry('VGK', 47, 23, 4), entry('EDM', 40, 30, 4), entry('LAK', 39, 31, 4), entry('VAN', 30, 40, 4), entry('SEA', 28, 42, 4), entry('CGY', 27, 43, 4)],
	))
	const spot = Object.fromEntries(playoffPicture(rows).map((r) => [r.abbr, r.spot]))
	// The fourth- and fifth-best in the Central outscore the Pacific's third, and
	// still are the wild cards: the top three of each division come first.
	assert.deepEqual(spot, { WPG: 'div', DAL: 'div', COL: 'div', MIN: 'wc', STL: 'wc', NSH: null,
		VGK: 'div', EDM: 'div', LAK: 'div', VAN: null, SEA: null, CGY: null })
})

test('the race is counted in points: two a win, one an overtime loss', () => {
	// Ten games left each. The wild cards are MIN (94) and STL (92); NSH (86)
	// is the best club out.
	const rows = standingsRows(conference(
		[entry('WPG', 50, 18, 4, 72), entry('DAL', 48, 20, 4, 72), entry('COL', 46, 22, 4, 72), entry('MIN', 45, 23, 4, 72), entry('STL', 44, 24, 4, 72), entry('NSH', 41, 27, 4, 72)],
		[entry('VGK', 47, 21, 4, 72), entry('EDM', 40, 28, 4, 72), entry('LAK', 39, 29, 4, 72), entry('SEA', 20, 48, 4, 72)],
	))
	assert.deepEqual(playoffPicture(rows).filter((r) => r.spot === 'wc').map((r) => r.abbr), ['MIN', 'STL'])

	// WPG has 104. NSH can reach 86 + 20 = 106, so a spot needs 106 + 1 - 104;
	// the Central's second can reach 100 + 20 = 120, so the division 17.
	const n = raceNumbers(rows, { team: 'WPG' })
	assert.equal(n.points, 104)
	assert.equal(n.gamesLeft, 10)
	assert.equal(n.spotMagic, 3)
	assert.equal(n.divisionMagic, 17)
	assert.match(racePanelHtml(n), /Magic number for a playoff spot: <strong>3<\/strong>/)
	assert.match(racePanelHtml(n), /Magic number to win the Central: <strong>17<\/strong>/)

	// NSH, out: the last club in (STL, 92) is out of its reach once NSH's
	// 106 is passed, so its elimination number is 106 + 1 - 92.
	const v = raceNumbers(rows, { team: 'NSH' })
	assert.equal(v.spotBehind, 6)
	assert.equal(v.spotElim, 15)
	assert.match(racePanelHtml(v), /6 points out of the last wild card · elimination number <strong>15<\/strong>/)

	// SEA (44, can reach 64) is eliminated, and the panel goes.
	assert.equal(racePanelHtml(raceNumbers(rows, { team: 'SEA' })), null)
})

test('how an ESPN game ended, from its short detail or its periods', () => {
	const ev = (shortDetail, period) => ({ competitions: [{ status: { period, type: { shortDetail } } }] })
	// ESPN's own words, from the 2025-26 season's games.
	assert.equal(espnEnding(ev('Final', 3)), 'REG')
	assert.equal(espnEnding(ev('Final/OT', 4)), 'OT')
	assert.equal(espnEnding(ev('Final/2OT', 5)), 'OT')
	assert.equal(espnEnding(ev('Final/SO', 5)), 'SO')
	// No words, a fourth period: overtime.
	assert.equal(espnEnding(ev('', 4)), 'OT')
	// "SO" inside a word is not a shootout.
	assert.equal(espnEnding(ev('Postponed (SOCCER)', 0)), 'REG')
})

test('the line score names three periods, overtime, and a shootout only in the regular season', () => {
	assert.deepEqual([0, 1, 2, 3, 4].map((i) => periodName(i)), ['P1', 'P2', 'P3', 'OT', 'SO'])
	assert.deepEqual([3, 4, 5].map((i) => periodName(i, { regular: false })), ['OT', '2OT', '3OT'])
})

test('the live card shows each period and each side\'s points leader', () => {
	const summary = {
		header: { id: '1', season: { type: 2 }, competitions: [{ status: { type: { state: 'in', detail: '3rd 12:00' } }, competitors: [
			{ homeAway: 'away', team: { id: '1', abbreviation: 'WPG' }, score: '2', linescores: [{ displayValue: '1' }, { displayValue: '1' }, { displayValue: '0' }] },
			{ homeAway: 'home', team: { id: '2', abbreviation: 'CAR' }, score: '1', linescores: [{ displayValue: '0' }, { displayValue: '1' }, { displayValue: '0' }] },
		] }] },
		leaders: [{ team: { abbreviation: 'WPG' }, leaders: [{ name: 'points', leaders: [{ displayValue: '2', athlete: { shortName: 'K. Connor' } }] }] }],
		plays: [{ text: 'Goal scored', clock: { displayValue: '12:00' }, period: { displayValue: '3rd' } }],
	}
	const d = liveDetail(summary)
	assert.equal(d.regular, true)
	const html = liveDetailHtml(d)
	assert.match(html, /P1<\/span> <span class="live-inning">P2<\/span> <span class="live-inning">P3/)
	assert.match(html, /K\. Connor<\/strong> <span class="live-stats">2 PTS/)
	assert.match(html, /3rd 12:00 · Goal scored/)
})
