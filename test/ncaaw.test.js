// Women's college basketball (Division I): sports/ncaaw.js, its reference files
// and champions, by the rules Ray chose for the men's (2026-10-26): every
// Division I programme, the champion the NCAA tournament's, and a conference
// tournament counted as the conferences count it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sport, { espnGameRow, liveGameRow, postseasonOf, stageOf, sources, walkRounds } from '../sports/ncaaw.js'
import { parseCsv } from '../lib/csv.js'
import { codeTable } from '../lib/codes.js'
import { loadHistory } from '../lib/names.js'
import { loadTeams } from '../lib/teams.js'
import { espnTarget, leagueEndpoints } from '../lib/espn.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const row = (over = {}) => ({
	id: '401746075', game_id: '401746075', season: '2025', season_type: '2', game_date: '2025-01-05',
	status_type_name: 'STATUS_FINAL', status_type_completed: 'TRUE', neutral_site: 'FALSE', tournament_id: '', notes_headline: '',
	home_id: '41', home_location: 'UConn', home_score: '82', away_id: '2579', away_location: 'South Carolina', away_score: '59', ...over,
})

test('a game: ESPN\'s ids, its local date, and either way of writing true', () => {
	const r = espnGameRow(row())
	assert.deepEqual([r.id, r.season, r.date, r.round, r.stage, r.home, r.away, r.homeScore, r.awayScore, r.status, r.source],
		['401746075', 2025, '2025-01-05', 'regular', null, '41', '2579', 82, 59, 'final', 'sportsdataverse'])
	assert.equal(espnGameRow(row({ status_type_completed: 'true' })).status, 'final')
	assert.equal(espnGameRow(row({ neutral_site: 'true' })).neutral, true)
})

test('what is no game: called off, sides not yet known, a 0-0, a game a finished season never played', () => {
	assert.equal(espnGameRow(row({ status_type_name: 'STATUS_POSTPONED' })), null)
	assert.equal(espnGameRow(row({ status_type_name: 'STATUS_CANCELED' })), null)
	assert.equal(espnGameRow(row({ home_id: '-1' })), null)
	assert.equal(espnGameRow(row({ home_score: '0', away_score: '0' })), null)
	const later = row({ status_type_name: 'STATUS_SCHEDULED', status_type_completed: 'FALSE', home_score: '', away_score: '' })
	assert.equal(espnGameRow(later).status, 'scheduled')
	assert.equal(espnGameRow(later, { finished: true }), null)
})

test('a forfeit counts, and ESPN\'s EXH is no exhibition: the MEAC tournament\'s games are filed so', () => {
	const f = espnGameRow(row({ status_type_name: 'STATUS_FORFEIT', home_score: '2', away_score: '0' }))
	assert.deepEqual([f.status, f.homeScore, f.awayScore], ['final', 2, 0])
	assert.equal(espnGameRow(row({ type_abbreviation: 'EXH', notes_headline: 'MEAC WOMEN\'S TOURNAMENT - SEMIFINAL' })).round, 'regular')
})

test('which postseason, by ESPN\'s tournament id, else the note', () => {
	assert.equal(postseasonOf('22', ''), 'NCAA')
	assert.equal(postseasonOf('22.0', ''), 'NCAA')
	assert.equal(postseasonOf('37', ''), 'NIT')
	assert.equal(postseasonOf('38', ''), 'WBI')
	assert.equal(postseasonOf('62', ''), 'WBIT')
	assert.equal(postseasonOf('', 'WNIT CHAMPIONSHIP'), 'NIT')
	assert.equal(postseasonOf('', 'WBI TOURNAMENT - 1ST ROUND'), 'WBI')
	assert.equal(postseasonOf('', 'WBIT - 1st Round'), 'WBIT')
	assert.equal(postseasonOf('', 'EAST REGIONAL AT DAYTON OH'), 'NCAA')
	assert.equal(postseasonOf('', ''), 'POST')
	// No First Four numbered as a first round, as the men's 2011 to 2015 did.
	assert.equal(stageOf('22', 'NCAA WOMEN\'S CHAMPIONSHIP - SPOKANE REGION - 1ST ROUND'), 'R64')
	assert.equal(stageOf('22', 'NCAA Women\'s Championship - Regional 4 in Spokane - Elite 8'), 'E8')
	assert.equal(stageOf('22', 'EAST REGION AT MANHATTAN KS'), 'NCAA')
	assert.equal(stageOf('37', 'WOMEN\'S NIT - 1ST ROUND'), 'NIT')
})

/** A single-elimination field of `teams` clubs, its final last, each game a day
 *  of its own round: 8 teams is 7 games. */
function field(teams, { stage = 'POST', firstDay = 1 } = {}) {
	const games = []
	let alive = Array.from({ length: teams }, (_, i) => `T${i}`)
	let day = firstDay, n = 0
	while (alive.length > 1) {
		const next = []
		for (let i = 0; i < alive.length; i += 2) {
			games.push({ id: `g${n++}`, season: 2001, date: `2001-03-${String(day).padStart(2, '0')}`, stage, home: alive[i], away: alive[i + 1], homeScore: 70, awayScore: 60 })
			next.push(alive[i])
		}
		alive = next
		day++
	}
	return games
}

test('the rounds are read back from the final, whatever the games were filed as', () => {
	const games = field(64)
	assert.equal(games.length, 63)
	const { stages, final } = walkRounds(games)
	assert.equal(final, games.at(-1).id)
	const count = {}
	for (const s of stages.values()) count[s] = (count[s] ?? 0) + 1
	assert.deepEqual(count, { R64: 32, R32: 16, S16: 8, E8: 4, F4: 2, FINAL: 1 })
	assert.equal(stages.get(games[0].id), 'R64')
	// A game already right is left alone.
	const named = games.map((g) => ({ ...g, stage: stages.get(g.id) }))
	assert.equal(walkRounds(named).stages.size, 0)
})

test('a game behind the round of 64 is the First Four, and a loser\'s earlier win does not move it', () => {
	const games = field(64)
	// T0 and T99 played in, T0 winning, before the first round.
	const ff = { id: 'ff', season: 2023, date: '2001-02-28', stage: 'NCAA', home: 'T0', away: 'T99', homeScore: 55, awayScore: 50 }
	const { stages } = walkRounds([...games, ff])
	assert.equal(stages.get('ff'), 'FF')
	// A side's conference win is not in the list; a season's WNIT game, filed as
	// such, is passed over even where a club could be in both.
	const wnit = { id: 'w', season: 2001, date: '2001-02-27', stage: 'NIT', home: 'T1', away: 'T98', homeScore: 70, awayScore: 60 }
	assert.equal(walkRounds([...games, wnit]).stages.has('w'), false)
})

test('2001\'s unlabelled games: what no walk reaches is the WNIT\'s, not an NCAA game', () => {
	const ncaa = field(8)
	const other = field(4, { firstDay: 2 }).map((g) => ({ ...g, id: `o${g.id}`, home: `W${g.home}`, away: `W${g.away}` }))
	// The other tournament ends a day before the NCAA's final, so the final is found.
	const { stages, final } = walkRounds([...ncaa, ...other])
	assert.equal(final, ncaa.at(-1).id)
	for (const g of other) assert.equal(stages.get(g.id), 'NIT')
	// From 2010 the WBI was played too, and an unnamed game may be either.
	const later = other.map((g) => ({ ...g, season: 2012 }))
	assert.equal(walkRounds([...ncaa, ...later]).stages.has(later[0].id), false)
})

test('the final is the tournament\'s, not a later WNIT game, and the one named so where two share its day', () => {
	const games = field(4)
	const wnit = { id: 'w', season: 2015, date: '2001-04-30', stage: 'NIT', home: 'A', away: 'B', homeScore: 2, awayScore: 1 }
	assert.equal(walkRounds([...games, wnit]).final, games.at(-1).id)
	const last = games.at(-1)
	const named = games.map((g) => (g === last ? { ...g, stage: 'FINAL' } : g))
	const same = { id: 'x', season: 2015, date: last.date, stage: 'POST', home: 'C', away: 'D', homeScore: 2, awayScore: 1 }
	assert.equal(walkRounds([same, ...named]).final, last.id)
})

test('ESPN\'s scoreboard: a final is the championship round, a game between two others none', () => {
	const event = (over = {}) => ({
		id: '401856590', date: '2026-04-05T19:00Z', season: { year: 2026, type: 3 },
		competitions: [{
			neutralSite: true, tournamentId: 22,
			notes: [{ headline: 'NCAA Women\'s Basketball Championship - National Championship' }],
			status: { type: { name: 'STATUS_FINAL', completed: true } },
			competitors: [
				{ homeAway: 'home', score: '79', team: { id: '26' } },
				{ homeAway: 'away', score: '51', team: { id: '2579' } },
			],
			...over,
		}],
	})
	const opts = { franchiseOf: (id) => ({ 26: 'UCLA', 2579: 'SC' }[id] ?? id), knows: (id) => id === '26' || id === '2579' }
	const r = liveGameRow(event(), opts)
	assert.deepEqual([r.round, r.stage, r.home, r.away, r.homeScore, r.status, r.source], ['championship', 'FINAL', 'UCLA', 'SC', 79, 'final', 'espn'])
	assert.equal(liveGameRow(event({ tournamentId: 37, notes: [{ headline: 'Women\'s NIT - Semifinal' }] }), opts).stage, 'NIT')
	assert.equal(liveGameRow(event({ competitors: [
		{ homeAway: 'home', score: '1', team: { id: '1' } }, { homeAway: 'away', score: '0', team: { id: '2' } },
	] }), opts), null)
	assert.equal(liveGameRow(event({ status: { type: { name: 'STATUS_POSTPONED' } } }), opts), null)
})

test('the season: 2000-01 on, the year it ends, Division I\'s group on every call', () => {
	assert.equal(sources.schedules.from, 2001)
	assert.equal(sources.live.seasonOf(new Date(Date.UTC(2026, 9, 30))), 2027)
	assert.equal(sources.live.seasonOf(new Date(Date.UTC(2026, 3, 5))), 2026)
	assert.match(sources.live.url('20260405'), /womens-college-basketball.*groups=50&limit=400/)
	// ESPN's Division I, whatever the page asks.
	assert.match(espnTarget(leagueEndpoints({ league: 'basketball/womens-college-basketball' }), 'apis/site/v2/sports/basketball/womens-college-basketball/scoreboard', 'dates=20261110'), /groups=50&limit=400$/)
	assert.equal(sport.defaults.rules.standingsByConference, true)
})

test('every Division I programme is a club with a page and one conference', async () => {
	const history = loadHistory('ncaaw')
	assert.ok(history.length >= 360, `${history.length} programmes`)
	const codes = codeTable('ncaaw', history)
	// ESPN's id, which every game names a side by, finds the club.
	assert.equal(codes.franchiseOf('41'), 'CONN')
	assert.equal(codes.franchiseOf('2633'), 'TENN')
	const divisions = parseCsv(read('data/reference/ncaaw-divisions.csv'))
	assert.equal(divisions.length, history.length)
	assert.ok(divisions.every((d) => d.conference), 'each has a conference')
	assert.equal(new Set(divisions.map((d) => d.conference)).size, 31)
	// One conference, one spelling, across the two sports.
	const mens = new Set(parseCsv(read('data/reference/ncaam-divisions.csv')).map((d) => d.conference))
	for (const c of new Set(divisions.map((d) => d.conference))) assert.ok(mens.has(c), c)
	const clubs = (await loadTeams()).filter((t) => t.sport === 'ncaaw')
	assert.equal(clubs.length, history.length)
	assert.equal(readdirSync(join(ROOT, 'teams', 'ncaaw')).length, history.length)
	assert.equal(clubs.find((t) => t.id === 'uconn').nouns.team, 'UConn Huskies')
	for (const t of clubs) assert.equal(codes.franchiseOf(t.site.espnSlug), t.sourceIds[0], t.id)
})

test('the champions before the games begin, and a list that runs on to check them', () => {
	const rows = parseCsv(read('data/reference/ncaaw-champions.csv'))
	const known = new Set(loadHistory('ncaaw').map((r) => r.franchiseAbbrv))
	const season = new Map(rows.map((r) => [Number(r.season), r]))
	// 1982 to the last, and none in 2020.
	assert.equal(Math.min(...season.keys()), 1982)
	assert.equal(season.has(2020), false)
	assert.equal(season.get(1982).championName, 'Louisiana Tech')
	assert.equal(season.get(1995).champion, 'CONN')
	for (const r of rows) assert.ok(known.has(r.champion), `${r.season} ${r.championName}`)
	const titles = (code) => rows.filter((r) => r.champion === code).length
	assert.ok(titles('CONN') >= 12)
	assert.ok(titles('TENN') >= 8)
})

test('what the files lack comes in their columns, and sits in the seasons they are short', () => {
	const added = parseCsv(read('data/reference/ncaaw-games-added.csv'))
	assert.ok(added.length >= 600)
	assert.ok(added.every((r) => espnGameRow(r, { finished: true })), 'each is a game')
	assert.ok(added.every((r) => r.season === '2001' || r.season === '2002'))
	// Washington over Oklahoma, the game 2001's bracket was short.
	const w = espnGameRow(added.find((r) => r.season === '2001'))
	assert.deepEqual([w.home, w.away, w.homeScore, w.awayScore], ['201', '264', 67, 84])
})
