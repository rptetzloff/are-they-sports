import test from 'node:test'
import assert from 'node:assert/strict'
import { FAMILY, ESPN_LEAGUE, mlsGametype, currentNamesCsv, gameinfoRow } from '../lib/web.js'
import { playoffRoundOf, playoffEvents, soccerSchedule, winnerOf, withPageStatus } from '../lib/espn-soccer.js'
import { seriesRounds } from '../scripts/load.mjs'

// The front end reads its club from window.CLUB at import; set one first.
globalThis.CLUB = { team: 'Galaxy', fullName: 'LA Galaxy', teamIds: ['LA'], copy: {}, site: { espnAbbr: 'LA' } }
const { SITE, seasonRecord } = await import('../web/mls/site.js')
const { roundCodeOf, ROUND_LABEL, computeSeasonHistory, postseasonSeries, parseCurrentNamesCsv, nameForFranchiseAt, nickForFranchiseAt } = await import('../web/mls/records-core.js')
const { raceNumbers, racePanelHtml, standingsRows, playoffPicture, worldSeriesTitle } = await import('../web/mls/playoff-core.js')
const { bracketSeries, bracketHtml, bracketGames } = await import('../web/mls/bracket-core.js')

test('MLS is served by the baseball-shaped front end, its seasons one year each', () => {
	assert.equal(FAMILY.mls, 'mlb')
	assert.equal(ESPN_LEAGUE.mls, 'soccer/usa.1')
	assert.equal(SITE.seasonLabel(2026), '2026')
	assert.equal(SITE.championship, 'MLS Cup')
})

test('a record is W-L-T from 2000, W-L before, and a playoff record W-L', () => {
	assert.equal(seasonRecord({ w: 19, l: 8, t: 7 }, { season: 2024 }), '19-8-7')
	assert.equal(seasonRecord({ w: 19, l: 8, t: 0 }, { season: 2024 }), '19-8-0')
	// 1996-1999 had no draws: Tampa Bay's 1996.
	assert.equal(seasonRecord({ w: 20, l: 12, t: 0 }, { season: 1996 }), '20-12')
	assert.equal(seasonRecord({ w: 5, l: 0 }, { season: 2024, regular: false }), '5-0')
})

test('seasons rank by points percentage, three a win and one a draw', () => {
	const g = (result) => ({ season: '2024', date: '2024-05-01', result, regular_season: '1', playoff: '0', championship: '', gametype: 'R', scoreFor: '1', scoreAgainst: '1' })
	const [s] = computeSeasonHistory([g('WIN'), g('TIE'), g('LOSS')])
	assert.equal(s.winPct, 4 / 9)
	assert.equal(s.record, '1–1–1')
})

test('a round is named counting back from MLS Cup', () => {
	// 1996-2010: three rounds.
	assert.deepEqual(['R1', 'R2', 'R3'].map((s) => mlsGametype(s, 3)), ['D', 'L', 'W'])
	// 2011-2022: four.
	assert.deepEqual(['R1', 'R2', 'R3', 'R4'].map((s) => mlsGametype(s, 4)), ['F', 'D', 'L', 'W'])
	// 2023-: a wild card first.
	assert.deepEqual(['R1', 'R2', 'R3', 'R4', 'R5'].map((s) => mlsGametype(s, 5)), ['X', 'F', 'D', 'L', 'W'])
	assert.equal(mlsGametype('Conference Finals', 5), null)
	for (const code of ['X', 'F', 'D', 'L', 'W']) assert.equal(roundCodeOf(ROUND_LABEL[code]), code, ROUND_LABEL[code])
})

test('rounds are counted from the Final back, so a wild card is a round before Round One', () => {
	// 2025's West as it was played, in short: the wild card on the 22nd, Round
	// One from the 24th to November 9th — one series beginning before the wild
	// card's winner played — then a semifinal, a final and MLS Cup.
	const g = (date, home, away, round = 'playoff') => ({ season: 2025, date, home, away, round })
	const games = [
		g('2025-10-22', 'POR', 'RSL'),
		g('2025-10-24', 'MIN', 'SEA'), g('2025-10-28', 'SEA', 'MIN'), g('2025-11-08', 'MIN', 'SEA'),
		g('2025-10-27', 'SD', 'POR'), g('2025-11-01', 'POR', 'SD'),
		g('2025-11-23', 'SD', 'MIN'),
		g('2025-11-29', 'VAN', 'SD'),
		g('2025-12-06', 'MIA', 'VAN', 'championship'),
	]
	const r = seriesRounds(games)
	const of = (a, b) => r.get(`2025|${[a, b].sort().join('|')}`)
	assert.deepEqual([of('POR', 'RSL'), of('MIN', 'SEA'), of('POR', 'SD'), of('MIN', 'SD'), of('SD', 'VAN'), of('MIA', 'VAN')], [1, 2, 2, 3, 4, 5])
	// A seed with a bye meets a first-round winner in the second round: the
	// WNBA's 1999, Houston's bye and Los Angeles's first-round win.
	const w = seriesRounds([
		{ season: 1999, date: '1999-08-26', home: 'LAS', away: 'SAC', round: 'playoff' },
		{ season: 1999, date: '1999-08-28', home: 'HOU', away: 'LAS', round: 'playoff' },
		{ season: 1999, date: '1999-09-02', home: 'HOU', away: 'NYL', round: 'championship' },
	])
	assert.deepEqual([...w.values()], [1, 2, 3])
})

test('a calendar-year league\'s names run January to December', () => {
	const rows = [{ franchiseAbbrv: 'RBNY', teamAbbrv: 'MET', teamName: 'MetroStars', startSeason: '1996', endSeason: '2005' }]
	assert.match(currentNamesCsv(rows, { calendarYear: true }), /,1\/1\/1996,12\/31\/2005,/)
	assert.match(currentNamesCsv(rows), /,10\/1\/1995,9\/30\/2005,/)
})

test('a club with no city is named by its whole name, and shortened to MLS\'s short name', () => {
	const csv = 'franchiseName,teamName,league,division,city,team,alternate,startDate,endDate\nRSL,RSL,MLS,,,Real Salt Lake,Salt Lake,1/1/2005,\nDC,DC,MLS,,,D.C. United,,1/1/1996,\n'
	const { franchiseEras } = parseCurrentNamesCsv(csv)
	assert.equal(nameForFranchiseAt(franchiseEras, 'RSL', 20240601), 'Real Salt Lake')
	assert.equal(nickForFranchiseAt(franchiseEras, 'RSL', 20240601), 'Salt Lake')
	assert.equal(nickForFranchiseAt(franchiseEras, 'DC', 20240601), 'D.C. United')
})

test('the games file carries a shootout, and its winner', () => {
	const g = { id: 'x', season: 2009, date: '2009-11-22', round: 'championship', stage: 'R3', home: 'LA', away: 'RSL',
		homeScore: 1, awayScore: 1, homePens: 4, awayPens: 5, winner: 'RSL', status: 'final' }
	const row = gameinfoRow(g)
	assert.deepEqual([row.hpens, row.vpens, row.wteam, row.lteam], [4, 5, 'RSL', 'LA'])
})

test('a finished season\'s series were won if the club went on: the 2005 MetroStars', () => {
	// Two legs against New England, one win each, out on aggregate.
	const games = [
		{ round: 'Conference Semifinal', opponent: 'New England', result: 'WIN' },
		{ round: 'Conference Semifinal', opponent: 'New England', result: 'LOSS' },
	]
	assert.equal(postseasonSeries(games, { settled: true })[0].state, 'lost')
	// The Galaxy's 2014: a two-legged final won 1-1 on wins, then MLS Cup.
	const won = postseasonSeries([
		{ round: 'Conference Final', opponent: 'Seattle', result: 'WIN' },
		{ round: 'Conference Final', opponent: 'Seattle', result: 'LOSS' },
		{ round: 'MLS Cup', opponent: 'New England', result: 'WIN' },
	], { settled: true })
	assert.deepEqual(won.map((s) => s.state), ['won', 'won'])
})

// --- ESPN, made the page's shape (lib/espn-soccer.js) ------------------------

const sb = (id, slug, date, home, away, hs, as_, hp = null, ap = null, completed = true) => ({
	id, date, season: { year: 2025, type: 13124, slug },
	competitions: [{ status: { type: { completed, state: completed ? 'post' : 'pre', name: completed ? 'STATUS_FULL_TIME' : 'STATUS_SCHEDULED', shortDetail: hp == null ? 'FT' : 'FT-Pens' } },
		notes: [{ headline: 'MIN win series 2-1' }],
		competitors: [
			{ id: home, homeAway: 'home', team: { id: home, abbreviation: home }, score: String(hs), ...(hp == null ? {} : { shootoutScore: hp }) },
			{ id: away, homeAway: 'away', team: { id: away, abbreviation: away }, score: String(as_), ...(ap == null ? {} : { shootoutScore: ap }) },
		] }],
})

test('a playoff round, and its conference, from ESPN\'s season slug', () => {
	assert.deepEqual(playoffRoundOf('western-conference-playoffs---round-one'), { round: 'Round One', conference: 'West' })
	assert.deepEqual(playoffRoundOf('eastern-conference-playoffs---wild-card'), { round: 'Wild Card', conference: 'East' })
	assert.deepEqual(playoffRoundOf('eastern-conference-playoffs---semifinals'), { round: 'Conference Semifinal', conference: 'East' })
	assert.deepEqual(playoffRoundOf('western-conference-playoffs---final'), { round: 'Conference Final', conference: 'West' })
	assert.deepEqual(playoffRoundOf('mls-cup'), { round: 'MLS Cup', conference: '' })
	assert.equal(playoffRoundOf('2025-mls-regular-season'), null)
})

test('playoff games become the page\'s: typed 3, noted, numbered, the shootout\'s winner the winner', () => {
	const ev = playoffEvents([
		sb('2', 'western-conference-playoffs---round-one', '2025-10-28T02:00Z', 'SEA', 'MIN', 2, 1),
		sb('1', 'western-conference-playoffs---round-one', '2025-10-24T02:00Z', 'MIN', 'SEA', 1, 0),
		sb('3', 'western-conference-playoffs---round-one', '2025-11-08T22:00Z', 'MIN', 'SEA', 3, 3, 7, 6),
		sb('9', '2025-mls-regular-season', '2025-10-18T22:00Z', 'MIN', 'SEA', 1, 1),
	])
	assert.deepEqual(ev.map((e) => e.competitions[0].notes[0].headline), ['West Round One - Game 1', 'West Round One - Game 2', 'West Round One - Game 3'])
	assert.ok(ev.every((e) => e.season.type === 3 && e.competitions[0].status.type.name === 'STATUS_FINAL'))
	const so = ev[2].competitions[0].competitors
	assert.deepEqual(so.map((c) => [c.team.abbreviation, c.winner]), [['MIN', true], ['SEA', false]])
	assert.equal(winnerOf(sb('d', 'x', 'd', 'A', 'B', 1, 1)), null)
	// The bracket reads them as a best-of-three Minnesota won 2-1.
	const [series] = bracketSeries(bracketGames(ev))
	assert.equal(series.code, 'F')
	assert.equal(series.teams.find((t) => t.abbr === 'MIN').wins, 2)
	assert.equal(series.winner, 'MIN')
})

test('a club\'s schedule: results and fixtures for the regular season, its playoff games for the postseason', () => {
	const results = [sb('r1', '2026-mls-regular-season', '2026-03-01T02:00Z', 'LA', 'SD', 2, 1)]
	const fixtures = [sb('f1', '2026-mls-regular-season', '2026-10-26T02:00Z', 'LAFC', 'LA', 0, 0, null, null, false), results[0]]
	const reg = soccerSchedule({ type: 2, season: 2026, results, fixtures })
	assert.deepEqual(reg.events.map((e) => e.id), ['r1', 'f1'])
	// A playoff game, should a club's schedule ever carry one, is the postseason's.
	const withPlayoff = soccerSchedule({ type: 2, season: 2026, results: [...results, sb('p0', 'mls-cup', '2026-12-06T20:00Z', 'LA', 'NE', 1, 0)] })
	assert.deepEqual(withPlayoff.events.map((e) => e.id), ['r1'])
	assert.deepEqual(reg.events.map((e) => e.competitions[0].status.type.name), ['STATUS_FINAL', 'STATUS_SCHEDULED'])
	assert.equal(reg.requestedSeason.year, 2026)
	const po = playoffEvents([sb('p1', 'mls-cup', '2026-12-06T20:00Z', 'LA', 'NE', 1, 0)])
	assert.deepEqual(soccerSchedule({ type: 3, season: 2026, playoffs: po, teamId: 'LA' }).events.map((e) => e.id), ['p1'])
	assert.deepEqual(soccerSchedule({ type: 3, season: 2026, playoffs: po, teamId: 'SEA' }).events, [])
	assert.deepEqual(soccerSchedule({ type: 1, season: 2026 }).events, [])
	// A game being played reads as one, half-time and all.
	const live = withPageStatus({ competitions: [{ status: { type: { state: 'in', name: 'STATUS_SECOND_HALF' } } }] })
	assert.equal(live.competitions[0].status.type.name, 'STATUS_IN_PROGRESS')
})

test('MLS Cup is won in the one game whose note names it', () => {
	// As the server hands them over (playoffEvents).
	const [cup] = playoffEvents([sb('c', 'mls-cup', '2025-12-06T20:00Z', 'MIA', 'VAN', 3, 1)])
	assert.equal(worldSeriesTitle([cup], 'MIA'), 'MLS Cup')
	assert.equal(worldSeriesTitle([cup], 'VAN'), null)
	// 2021's, won on penalties: level on goals.
	const [pens] = playoffEvents([sb('p', 'mls-cup', '2021-12-11T20:00Z', 'POR', 'NYC', 1, 1, 2, 4)])
	assert.equal(worldSeriesTitle([pens], 'NYC'), 'MLS Cup')
	assert.equal(worldSeriesTitle([pens], 'POR'), null)
})

// A conference as ESPN's standings answer it.
const entry = (abbr, w, l, t, gp = w + l + t, rank = 99) => ({ team: { id: abbr, abbreviation: abbr },
	stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'ties', value: t }, { name: 'points', value: 3 * w + t },
		{ name: 'gamesPlayed', value: gp }, { name: 'pointDifferential', value: 0 }, { name: 'rank', value: rank }] })

test('the playoff picture is each conference\'s best nine, the eighth and ninth wild cards', () => {
	const west = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'LA', 'H', 'I', 'J'].map((abbr, i) => entry(abbr, 20 - i, 8 + i, 3, 31))
	const rows = standingsRows({ children: [{ name: 'Western Conference', standings: { entries: west } }] })
	const spot = Object.fromEntries(playoffPicture(rows).map((r) => [r.abbr, r.spot]))
	assert.deepEqual([spot.A, spot.G, spot.LA, spot.H, spot.I], ['div', 'div', 'wc', 'wc', null])
	// Three games left: LA has 3 x 13 + 3 = 42; I, the best club out, can reach
	// 3 x 11 + 3 + 9 = 45, so a spot needs 45 + 1 - 42.
	const n = raceNumbers(rows, { team: 'LA' })
	assert.deepEqual([n.points, n.gamesLeft, n.place, n.spotMagic], [42, 3, 8, 4])
	assert.match(racePanelHtml(n), /Magic number for a playoff spot: <strong>4<\/strong>/)
	assert.match(racePanelHtml(n), /8th in the Western, a wild card · 42 points · 3 games left/)
})

test('the bracket puts each conference\'s wild card above its Round One', () => {
	const ev = playoffEvents([
		sb('w', 'western-conference-playoffs---wild-card', '2025-10-22T02:00Z', 'POR', 'RSL', 1, 1, 4, 3),
		sb('a', 'western-conference-playoffs---round-one', '2025-10-24T02:00Z', 'SD', 'POR', 2, 0),
	])
	const html = bracketHtml(bracketSeries(bracketGames(ev)), 'LA')
	assert.match(html, /grid-row:2;grid-column:1">.*POR.*RSL/s)
	assert.match(html, /West R1/)
	assert.match(html, /aria-label="MLS Cup"/)
})
