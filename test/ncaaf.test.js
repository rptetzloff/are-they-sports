// College football (FBS): sports/ncaaf.js, its reference files and champions.
// Ray, 2026-10-25: FBS only, every season CollegeFootballData has, and the
// champion the game that decided it where one did, the AP's No. 1 before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sport, { cfbdGameRow, liveGameRow, titleOf, sources, championshipTitle } from '../sports/ncaaf.js'
import { parseCsv } from '../lib/csv.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory } from '../lib/names.js'
import { loadTeams } from '../lib/teams.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const game = (over = {}) => ({
	id: 401762791, season: 2025, week: 1, seasonType: 'regular', startDate: '2025-08-29T01:00:00.000Z', completed: true,
	neutralSite: false, homeId: 275, homeTeam: 'Wisconsin', homePoints: 17, awayId: 193, awayTeam: 'Miami (OH)', awayPoints: 0, notes: null,
	...over,
})

test('a CollegeFootballData game is a row, sides by ESPN id, on its Eastern day', () => {
	const r = cfbdGameRow(game())
	assert.deepEqual([r.id, r.season, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source, r.week],
		['401762791', 2025, 'regular', null, '275', '193', 17, 0, 'final', 'cfbd', 1])
	// 01:00 UTC on the 29th is the evening of the 28th where it was played.
	assert.equal(r.date, '2025-08-28')
	// Still to come, in the season being played; dropped once that season is over.
	const later = game({ completed: false, homePoints: null, awayPoints: null })
	assert.equal(cfbdGameRow(later).status, 'scheduled')
	assert.equal(cfbdGameRow(later, { finished: true }), null, 'a game a finished season never played was cancelled')
	assert.equal(cfbdGameRow(game({ homeId: null })), null)
})

test('postseason: a bowl, a playoff game, and the title game', () => {
	const bowl = cfbdGameRow(game({ seasonType: 'postseason', notes: 'Rate Bowl', week: 1 }))
	assert.deepEqual([bowl.round, bowl.stage, bowl.week], ['playoff', 'BOWL', null])
	const cfp = cfbdGameRow(game({ seasonType: 'postseason', notes: 'College Football Playoff First Round Game' }))
	assert.deepEqual([cfp.round, cfp.stage], ['playoff', 'CFP'])
	const final = cfbdGameRow(game({ season: 2025, seasonType: 'postseason', homeId: 84, awayId: 2390,
		notes: 'College Football Playoff National Championship Presented by AT&T' }))
	assert.deepEqual([final.round, final.stage, final.title], ['championship', 'CFP', 'College Football Playoff'])
})

test('the BCS title game is found by its pair, whatever the notes say', () => {
	// 1998-2002 and 2007 have no notes on any bowl.
	assert.equal(titleOf(2001, null, 158, 2390), 'BCS National Championship') // Nebraska v Miami, the Rose Bowl
	assert.equal(titleOf(2001, 'Rose Bowl', 30, 2390), null, 'another bowl that season is not the title game')
	assert.equal(titleOf(2007, '', 99, 194), 'BCS National Championship')
	assert.equal(titleOf(1997, 'Rose Bowl', 130, 264), null, 'no game decided it before 1998')
	assert.equal(titleOf(2014, 'CFP NATIONAL CHAMPIONSHIP GAME PRES. BY AT&T', 194, 2483), 'College Football Playoff')
	assert.equal(championshipTitle(1950), 'AP national title')
})

test('a season is the year it starts: January is the season before', () => {
	assert.equal(sources.live.seasonOf(new Date('2027-01-11T12:00Z')), 2026)
	assert.equal(sources.live.seasonOf(new Date('2026-09-05T12:00Z')), 2026)
	const days = sources.live.daysOf(2026)
	assert.equal(days[0], '20260820')
	assert.equal(days.at(-1), '20270120')
})

test('an ESPN event is a row under the same ids; two non-clubs are none', () => {
	const event = (homeId, awayId) => ({ id: '401769076', date: '2026-09-05T19:30Z', season: { year: 2026, type: 2 }, week: { number: 2 },
		competitions: [{ status: { type: { completed: false, name: 'STATUS_SCHEDULED' } }, competitors: [
			{ homeAway: 'home', team: { id: homeId }, score: '0' }, { homeAway: 'away', team: { id: awayId }, score: '0' }] }] })
	const codes = codeTable('ncaaf', loadHistory('ncaaf'))
	const r = liveGameRow(event('275', '2738'), { franchiseOf: codes.franchiseOf, knows: codes.knows })
	assert.deepEqual([r.id, r.home, r.away, r.status, r.week], ['401769076', 'WIS', '2738', 'scheduled', 2])
	assert.equal(liveGameRow(event('2738', '2739'), { franchiseOf: codes.franchiseOf, knows: codes.knows }), null)
})

test('138 programmes: one manifest each, its ESPN id the code its games use', async () => {
	const history = parseCsv(read('data/reference/ncaaf-franchise-history.csv'))
	const divisions = parseCsv(read('data/reference/ncaaf-divisions.csv'))
	assert.equal(history.length, 138)
	assert.deepEqual(divisions.map((d) => d.code).sort(), history.map((h) => h.franchiseAbbrv).sort())
	const teams = (await loadTeams()).filter((t) => t.sport === 'ncaaf')
	assert.equal(teams.length, readdirSync(join(ROOT, 'teams', 'ncaaf')).length)
	assert.equal(teams.length, 138)
	const codes = codeTable('ncaaf', loadHistory('ncaaf'))
	for (const t of teams) {
		assert.equal(codes.franchiseOf(t.site.espnSlug), t.sourceIds[0], `${t.id}: its ESPN id names another club`)
	}
	const wis = teams.find((t) => t.id === 'wisconsin')
	assert.equal(wis.nouns.team, 'Wisconsin Badgers', 'school and mascot: five programmes are the Tigers')
	assert.equal(sport.defaults.rules.schedulePeriod, 'week')
})

test('a champion every season from 1936, by the rule for its era', () => {
	const rows = parseCsv(read('data/reference/ncaaf-champions.csv'))
	const seasons = rows.map((r) => Number(r.season))
	assert.equal(seasons[0], 1936)
	assert.deepEqual(seasons, [...new Set(seasons)].sort((a, b) => a - b), 'one a season, in order')
	for (let s = 1936; s <= 2025; s++) assert.ok(seasons.includes(s), `${s} has no champion`)
	for (const r of rows) {
		const s = Number(r.season)
		const want = s >= 2014 ? 'College Football Playoff' : s >= 1998 ? 'BCS National Championship' : 'AP national title'
		assert.equal(r.title, want, `${s}`)
		assert.equal(r.method, s >= 1998 ? 'championship game' : 'poll', `${s}`)
		assert.equal(Boolean(r.gameId), s >= 1998, `${s}: a title game has its game, a poll none`)
	}
	// 2003, the split: the BCS's LSU, not the AP's USC.
	assert.equal(rows.find((r) => r.season === '2003').championName, 'LSU')
})
