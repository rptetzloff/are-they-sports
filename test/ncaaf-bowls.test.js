// College football's bowls by name (Ray, 2026-10-26: "bowl games should be
// noted in history... and schedules") and its conference championships.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bowlName, bowlRows } from '../lib/bowls.js'
import { cfbdGameRow } from '../sports/ncaaf.js'
import { nflGameRow, NFL_GAMES_HEADER } from '../lib/web.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('a bowl\'s name without its sponsor or, from ESPN, its place', () => {
	assert.equal(bowlName('Rose Bowl Game Presented by Prudential'), 'Rose Bowl Game')
	assert.equal(bowlName('CFP NATIONAL CHAMPIONSHIP GAME PRES. BY AT&T'), 'CFP National Championship Game')
	assert.equal(bowlName('ROSE BOWL AT PASADENA CA'), 'Rose Bowl')
	assert.equal(bowlName('R+L CARRIERS NEW ORLEANS BOWL'), 'R+L Carriers New Orleans Bowl', 'a sponsor in the name is the name')
	assert.equal(bowlName('Scooter\'s Coffee Frisco Bowl'), 'Scooter\'s Coffee Frisco Bowl')
})

test('Wikipedia\'s four ways of setting out a bowl', () => {
	// 1950: a cell a team, a cell a score.
	const fifty = bowlRows('|-\n| align=center|[[1951 Sugar Bowl|Sugar Bowl]]\n| No. 7 [[1950 Kentucky Wildcats football team|Kentucky]]\n| 13\n| No. 1 [[1950 Oklahoma Sooners football team|Oklahoma]]\n| align=right|7\n|-')
	assert.deepEqual(fifty.map((r) => [r.year, r.bowl, r.scores]), [[1951, 'Sugar Bowl', [13, 7]]])
	// 1965: the score as a pair in its own cell.
	const sixtyFive = bowlRows('|-\n| [[1965 Liberty Bowl|LIBERTY]]\n| Memphis, TN\n| December 18\n| No. 17 [[1965 Ole Miss Rebels football team|Mississippi]]\n| 13–7\n| [[1965 Auburn Tigers football team|Auburn]]\n|}')
	assert.deepEqual(sixtyFive.map((r) => [r.bowl, r.scores]), [['Liberty Bowl', [13, 7]]])
	// 1975: the result in one cell, a team and score a line; records in brackets are no score.
	const seventyFive = bowlRows('|-\n|[[1975 Liberty Bowl|Liberty Bowl]]\n|[[1975 USC Trojans football team|USC]] (7–4)<br>No. 2 [[1975 Texas A&M Aggies football team|Texas A&M]] (10–1)\n|\'\'\'USC 20\'\'\'<br>Texas A&M 0\n|-')
	assert.deepEqual(seventyFive.map((r) => [r.bowl, r.scores]), [['Liberty Bowl', [20, 0]]])
	// 1985: each team's score right after its link.
	const eightyFive = bowlRows('|-\n|[[1985 California Bowl|California Bowl]]\n|\'\'\'[[1985 Fresno State Bulldogs football team|Fresno State]]\'\'\' 51 (10–0–1),<br/>[[1985 Bowling Green Falcons football team|Bowling Green]] 7 (11–0)\n|-')
	assert.deepEqual(eightyFive.map((r) => [r.bowl, r.scores, r.teams]), [['California Bowl', [51, 7], ['Fresno State', 'Bowling Green']]])
	// A January game named for its month keeps the bowl's own name.
	assert.equal(bowlRows('|-\n| [[1966 Cotton Bowl Classic (January)|COTTON]]\n| 14\n| 7\n|-')[0].bowl, 'Cotton Bowl Classic')
})

test('a conference championship filed as postseason is its regular season\'s, by name; independents\' December games are bowls', () => {
	const g = (over) => ({ id: 1, season: 1998, week: 1, seasonType: 'postseason', startDate: '1998-12-05T20:00:00.000Z', completed: true,
		homeId: 2633, homeTeam: 'Tennessee', homeConference: 'SEC', homePoints: 24, awayId: 344, awayTeam: 'Mississippi State', awayConference: 'SEC', awayPoints: 14, ...over })
	const sec = cfbdGameRow(g())
	assert.deepEqual([sec.round, sec.stage, sec.week, sec.title], ['regular', null, null, 'SEC Championship'])
	// Two independents in December: the 1966 Liberty Bowl.
	assert.equal(cfbdGameRow(g({ homeConference: 'FBS Independents', awayConference: 'FBS Independents' })).round, 'playoff')
	// A bowl between two of a conference, played after mid-December, stays one.
	assert.equal(cfbdGameRow(g({ startDate: '1999-01-01T20:00:00.000Z' })).round, 'playoff')
})

test('the club page\'s games file names the bowl; the NFL\'s rows leave it empty', () => {
	assert.equal(NFL_GAMES_HEADER.at(-1), 'bowl')
	const game = { home: 'WIS', away: 'UCLA', homeScore: 38, awayScore: 31, status: 'final', season: 1998, date: '1999-01-01', round: 'playoff', title: 'Rose Bowl' }
	assert.equal(nflGameRow(game, 'WIS', (c) => c, 'ncaaf').bowl, 'Rose Bowl')
	assert.equal(nflGameRow(game, 'WIS', (c) => c).bowl, '')
	assert.equal(nflGameRow({ ...game, round: 'championship', title: 'College Football Playoff' }, 'WIS', (c) => c, 'ncaaf').bowl, '', 'a title game is named in its own column')
})

test('the bowls file names nineteen in twenty before 2002 and every one after', () => {
	const rows = parseCsv(read('data/reference/ncaaf-bowls.csv'))
	assert.ok(rows.length > 1600, `${rows.length}`)
	assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'a game named once')
	const wis = rows.filter((r) => ['1993', '1998', '1999'].includes(r.season) && /Rose Bowl/.test(r.bowl))
	assert.ok(wis.length >= 3, 'Wisconsin\'s three Rose Bowls of the 1990s are among them')
	assert.ok(rows.some((r) => r.season === '1901' && r.bowl === 'Rose Bowl'), 'the first bowl, Michigan\'s 1902 Rose Bowl')
	// The page says it: history notes and schedule rows.
	assert.match(read('web/ncaaf/history.js'), /the \$\{s\.bowl\.name\}/)
	assert.match(read('web/ncaaf/main.js'), /g\.bowl \? \[g\.bowl\]/)
})
