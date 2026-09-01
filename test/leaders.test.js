import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	creditFillIns, leaderColumns, mergeLeaders, nflLeaderResolver, rankLeaders, slugFor,
	tallyLeaders, tallyTenures,
} from '../lib/leaders.js'
import { leaderRows as nflLeaderRows } from '../sports/nfl.js'
import { leaderRows as mlbLeaderRows, gameLogId, gameLogNames } from '../sports/mlb.js'
import { parseView } from '../lib/routes.js'
import { leadersPage, siteNav } from '../lib/render.js'
import { parseCsv, splitCsvLine } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** One game-leader row, in the shape a join of game_leader against game gives. */
const g = (over = {}) => ({
	leader: 'smith-joe', name: 'Joe Smith', franchise: 'GB',
	season: 1970, round: 'regular', title: null, result: 'WIN', ...over,
})

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('a slug is surname first, so the same person gets the same id from two files', () => {
	assert.equal(slugFor('Jim Mora'), 'mora-jim')
	// The middle initial is KEPT. It is the only thing distinguishing the father
	// from the son, so stripping it as noise would merge two people.
	assert.equal(slugFor('Jim L. Mora'), 'mora-jim-l')
	assert.notEqual(slugFor('Jim L. Mora'), slugFor('Jim E. Mora'))
})

test('spelling differences that are not different people collapse to one id', () => {
	// nflverse and Wikipedia do not agree about apostrophes or accents, and a
	// coach who changed spelling between eras must not become two coaches.
	assert.equal(slugFor("Bill O'Brien"), slugFor('Bill OBrien'))
	assert.equal(slugFor('José Fernández'), 'fernandez-jose')
})

test('the resolver tells the two Moras apart by club and season', () => {
	// The bug this whole id scheme exists for: nflverse writes `Jim Mora` for
	// Indianapolis in 1999 and Atlanta in 2004, and they are a father and a son.
	const table = [
		{ leaderId: 'mora-jim-e', name: 'Jim E. Mora', nflverseName: 'Jim Mora', franchiseAbbrv: 'IND', firstSeason: 1998, lastSeason: 2001 },
		{ leaderId: 'mora-jim-e', name: 'Jim E. Mora', nflverseName: 'Jim Mora', franchiseAbbrv: 'NO', firstSeason: 1986, lastSeason: 1996 },
		{ leaderId: 'mora-jim-l', name: 'Jim L. Mora', nflverseName: 'Jim Mora', franchiseAbbrv: 'ATL', firstSeason: 2004, lastSeason: 2006 },
		{ leaderId: 'mora-jim-l', name: 'Jim L. Mora', nflverseName: 'Jim Mora', franchiseAbbrv: 'SEA', firstSeason: 2009, lastSeason: 2009 },
	]
	const resolve = nflLeaderResolver(table)
	assert.equal(resolve('Jim Mora', 'IND', 1999), 'mora-jim-e')
	assert.equal(resolve('Jim Mora', 'ATL', 2004), 'mora-jim-l')
	assert.equal(resolve('Jim Mora', 'SEA', 2009), 'mora-jim-l')
	// Without the table they would all be one person, which is the failure.
	const naive = nflLeaderResolver([])
	assert.equal(naive('Jim Mora', 'IND', 1999), naive('Jim Mora', 'ATL', 2004))
})

test('a name the curated table has never seen still resolves, by slug', () => {
	// Curation is only needed where a name is ambiguous. Requiring a row per
	// coach would mean transcribing 177 modern names to say what games already
	// say, and a missing row must not drop a coach off the page.
	const resolve = nflLeaderResolver([])
	assert.equal(resolve('Matt LaFleur', 'GB', 2019), 'lafleur-matt')
})

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test('regular season and postseason are counted separately', () => {
	// The sources disagree about whether they are one: Retrosheet and nflverse
	// count playoff games inside w/l and Wikipedia does not. Blending them makes
	// the two halves of the football table incomparable.
	const [r] = tallyLeaders([
		g({ result: 'WIN' }), g({ result: 'LOSS' }),
		g({ round: 'playoff', result: 'WIN' }),
		g({ round: 'playoff', result: 'LOSS' }),
	])
	assert.deepEqual([r.w, r.l], [1, 1])
	assert.deepEqual([r.playoffW, r.playoffL], [1, 1])
})

test('an unplayed game credits nobody', () => {
	// nflverse names the 2026 Giants' coach on games nobody has played, which is
	// how a club page knows who is in charge. Counting them would hand him
	// sixteen results he has not had.
	assert.deepEqual(tallyLeaders([g({ result: '' }), g({ result: null })]), [])
})

test('a title is winning the championship ROUND, not a game in it', () => {
	// A World Series is best-of-seven. Counting a win would have credited a
	// manager with a title for losing a series 4-3, and the database holds 707
	// baseball championship games against 60 Super Bowls.
	const lost = tallyLeaders([
		...Array(3).fill(0).map(() => g({ round: 'championship', result: 'WIN' })),
		...Array(4).fill(0).map(() => g({ round: 'championship', result: 'LOSS' })),
	])
	assert.deepEqual(lost[0].titles, [])

	const won = tallyLeaders([
		...Array(4).fill(0).map(() => g({ round: 'championship', result: 'WIN' })),
		...Array(3).fill(0).map(() => g({ round: 'championship', result: 'LOSS' })),
	])
	assert.equal(won[0].titles.length, 1)
})

test('a title is decided per season and club, not across a career', () => {
	// Four championship wins in one season and four losses in another is one
	// title and one defeat, never a wash. Tallying the round in one bucket would
	// have made it nothing at all.
	const r = tallyLeaders([
		...Array(4).fill(0).map(() => g({ season: 1961, round: 'championship', result: 'WIN' })),
		...Array(4).fill(0).map(() => g({ season: 1962, round: 'championship', result: 'LOSS' })),
	])
	assert.deepEqual(r[0].titles.map((t) => t.season), [1961])
})

test('a tie is half a win', () => {
	// Dividing by decided games instead would rank 12-0-1 above 13-0.
	const [r] = tallyLeaders([g({ result: 'WIN' }), g({ result: 'TIE' })])
	assert.equal(r.t, 1)
	assert.equal(r.winPct, 0.75)
})

test('one leader at two clubs is one person', () => {
	const [r] = tallyLeaders([g({ franchise: 'GB' }), g({ franchise: 'DAL' })])
	assert.deepEqual(r.franchises, ['DAL', 'GB'])
	assert.equal(r.w, 2)
})

// ---------------------------------------------------------------------------
// Who held the job, as opposed to who ran the game
// ---------------------------------------------------------------------------

/** A club's games in order, from a compact `leader:count` script per season. */
const clubSeason = (franchise, season, script, from = 0) => {
	const out = []
	let n = from
	for (const part of script.split(' ')) {
		const [leader, count] = part.split(':')
		for (let i = 0; i < Number(count); i++) out.push({ franchise, season, leader, gameId: `g${n++}` })
	}
	return out
}

test('a stand-in covering an absence is credited to the manager', () => {
	// Retrosheet names who RAN the game, so an ejection puts the bench coach in
	// the record. Bobby Cox came out 2493-1998 against a published 2504-2001,
	// and the difference was Bobby Dews and Pat Corrales.
	const games = clubSeason('ATL', 1980, 'cox:80 dews:3 cox:79')
	const credited = creditFillIns(games, 45)
	assert.equal(new Set(credited.values()).size, 1, 'Dews should not appear at all')
	assert.equal(credited.get('ATL|g80'), 'cox')
})

test('an interim after a firing keeps their own games', () => {
	// The manager does not come back, so nothing encloses the interim. This is
	// the case the rule must never fold, and length is not what saves it.
	const games = clubSeason('ATL', 2016, 'gonzalez:37 snitker:125')
	const credited = creditFillIns(games, 45)
	assert.equal(credited.get('ATL|g0'), 'gonzalez')
	assert.equal(credited.get('ATL|g37'), 'snitker')
})

test('a stand-in at the START of a season is still a stand-in', () => {
	// Don Zimmer managed the first 36 games of 1999 while Joe Torre was treated
	// for cancer. Nothing in 1999 comes before him, so a rule that only looked
	// within the season could not see it — and Torre stayed 21 wins short of his
	// published record. The previous season is what shows Torre was there first.
	const games = [
		...clubSeason('NYA', 1998, 'torre:162'),
		...clubSeason('NYA', 1999, 'zimmer:36 torre:126', 162),
	]
	const credited = creditFillIns(games, 45)
	assert.equal(credited.get('NYA|g162'), 'torre', 'Zimmer 1999 was not folded')
})

test('a manager whose season is broken up by ejections keeps it', () => {
	// THE FALSE POSITIVE THAT SHAPED THE RULE. A season reads
	// Cooper(1) Garner(37) Cooper(1), so adjacency alone calls GARNER the
	// stand-in and hands his season to his own bench coach. Only comparing how
	// much of the season each managed puts it the right way round.
	// The prior season is not decoration. Without it Cooper's first game is the
	// first game the club ever played, which has nothing before it and so can
	// never fold — the fixture would pass while testing the edge rule instead of
	// this one.
	const games = [
		...clubSeason('HOU', 2005, 'garner:162'),
		...clubSeason('HOU', 2006, 'cooper:1 garner:37 cooper:1', 162),
	]
	const credited = creditFillIns(games, 45)
	assert.equal(credited.get('HOU|g163'), 'garner', 'Garner lost his own season')
	// The leading fill-in is Garner's: it has him on both sides.
	assert.equal(credited.get('HOU|g162'), 'garner')
	// The trailing one is NOT, and that is correct rather than a gap. It is the
	// last game in this fixture, so nothing follows it to hand back to. In the
	// real data Cooper carried on into 2007, which makes it part of a 163-game
	// run and a tenure rather than a fill-in either way.
	assert.equal(credited.get('HOU|g200'), 'cooper')
})

test('the backstop keeps a long absence from becoming a fold', () => {
	// Bob Coleman managed 46 games of the 1943 Braves after Casey Stengel was
	// hit by a taxi, and every published record credits Coleman. 36 folds and 46
	// does not, which is a narrower gap than it looks — see sports/mlb.js for
	// the sweep that put the line at 45.
	const short = creditFillIns(clubSeason('ATL', 1943, 'stengel:50 sub:36 stengel:70'), 45)
	assert.equal(short.get('ATL|g50'), 'stengel')

	const long = creditFillIns(clubSeason('ATL', 1943, 'stengel:50 coleman:46 stengel:60'), 45)
	assert.equal(long.get('ATL|g50'), 'coleman')
})

test('an absence covered by two different people still folds', () => {
	// Ted Turner managed one game of the 1977 Braves and Vern Benson the next,
	// before Dave Bristol came back. Neither has the same person on both sides,
	// so a run-at-a-time rule left both on the page with a one-game career — and
	// the Braves listed 44 managers where two of them were the owner and a coach
	// covering a fortnight.
	const games = clubSeason('ATL', 1977, 'bristol:80 turner:1 benson:1 bristol:80')
	const credited = creditFillIns(games, 45)
	assert.equal(new Set(credited.values()).size, 1, 'Turner and Benson should both fold')
	assert.equal(credited.get('ATL|g80'), 'bristol')
	assert.equal(credited.get('ATL|g81'), 'bristol')
})

test('a window of stand-ins is bounded as a whole, not one at a time', () => {
	// Three people covering 20 games each is 60 games of absence, and folding
	// them individually would slip all of it under a 45-game backstop.
	const games = clubSeason('ATL', 1977, 'a:60 b:20 c:20 d:20 a:60')
	const credited = creditFillIns(games, 45)
	assert.equal(credited.get('ATL|g60'), 'b', 'a 60-game window folded under a 45 cap')
})

test('a leader at the edge of a club’s history is never a stand-in', () => {
	// Nothing comes before the first run or after the last, so there is nobody
	// to have handed back to.
	const credited = creditFillIns(clubSeason('GB', 1921, 'lambeau:2 someone:1'), 45)
	assert.equal(credited.get('GB|g2'), 'someone')
})

// ---------------------------------------------------------------------------
// The two eras
// ---------------------------------------------------------------------------

test('a career straddling 1999 is one row, marked as part stated', () => {
	// Mike Shanahan and Dan Reeves both do. Reporting them as two coaches would
	// be the codeIndex bug again: one person, split by which file described them.
	const counted = tallyLeaders([g({ leader: 'shanahan-mike', season: 1999 })])
	const stated = tallyTenures([{
		leader: 'shanahan-mike', name: 'Mike Shanahan', franchise: 'DEN',
		firstSeason: 1995, lastSeason: 1998, w: 47, l: 17, t: 0, playoffW: 7, playoffL: 1,
	}])
	const [r] = mergeLeaders(counted, stated)
	assert.equal(r.basis, 'mixed')
	assert.equal(r.w, 48)
	assert.equal(r.firstSeason, 1995)
	assert.equal(r.lastSeason, 1999)
})

test('merging does not hand a champion two rings', () => {
	// mergeLeaders is given already-finished records, so their titles are
	// resolved. Carrying the round tallies through would let `finish` derive
	// them a second time.
	const counted = tallyLeaders(
		Array(4).fill(0).map(() => g({ season: 1966, round: 'championship', result: 'WIN' })))
	assert.equal(counted[0].titles.length, 1)
	const [r] = mergeLeaders(counted, [])
	assert.equal(r.titles.length, 1)
})

test('a stated tenure carries the championships it won', () => {
	// Without this the page reported that Vince Lombardi won nothing, directly
	// above his 9-1 postseason record.
	const [r] = tallyTenures([{
		leader: 'lombardi-vince', name: 'Vince Lombardi', franchise: 'GB',
		firstSeason: 1959, lastSeason: 1967, w: 89, l: 29, t: 4,
		playoffW: 9, playoffL: 1, titleSeasons: [1961, 1962, 1965, 1966, 1967],
	}])
	assert.equal(r.titles.length, 5)
	assert.deepEqual(r.titles.map((t) => t.season), [1961, 1962, 1965, 1966, 1967])
})

test('an unknown stated record is not a 0-0 record', () => {
	// Fifteen pre-1999 tenures cannot be resolved — co-head coaches, and
	// mid-season changes this data cannot split. Loading them as nought and
	// nought would render a real record for a coach nobody counted.
	const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/nfl-coaches.csv'), 'utf8'))
	const unresolved = rows.filter((r) => r.basis === 'unresolved')
	assert.ok(unresolved.length > 0, 'expected some unresolved rows to guard')
	for (const r of unresolved) {
		assert.equal(r.w, '', `${r.name} has a stated W despite being unresolved`)
		assert.equal(r.l, '', `${r.name} has a stated L despite being unresolved`)
	}
})

test('ranking is by wins, and total', () => {
	// By wins rather than percentage: a percentage table is topped by an interim
	// who went 1-0 in one game, which is true and useless.
	const ranked = rankLeaders([
		{ leader: 'b', w: 1, l: 0, games: 1, winPct: 1 },
		{ leader: 'a', w: 100, l: 90, games: 190, winPct: 0.526 },
	])
	assert.deepEqual(ranked.map((r) => r.leader), ['a', 'b'])
})

// ---------------------------------------------------------------------------
// The adapters, against real source shapes
// ---------------------------------------------------------------------------

test('a Retrosheet game log row yields both managers, keyed to the gid', () => {
	// The offsets were wrong once and the load still looked healthy — 1,488
	// people and 427,433 attributions, all of them UMPIRES. Fields 77-88 are six
	// umpire slots and the managers are at 89-92, and the row that convinced the
	// first version otherwise was from 1871, when five umpire slots were empty
	// and the managers happened to land exactly where they were expected.
	const f = Array(161).fill('')
	f[0] = '20240315'; f[1] = '0'; f[3] = 'LAN'; f[6] = 'SDN'
	f[77] = 'barkl901'; f[78] = 'Lance Barksdale'   // an umpire, not a manager
	f[89] = 'robed001'; f[90] = 'Dave Roberts'
	f[91] = 'shilm801'; f[92] = 'Mike Shildt'
	const rows = mlbLeaderRows(f)
	assert.deepEqual(rows.map((r) => r.leaderName), ['Dave Roberts', 'Mike Shildt'])
	assert.deepEqual(rows.map((r) => r.code), ['LAN', 'SDN'])
	assert.equal(rows[0].gameId, 'SDN202403150')
})

test('the gid is built from the home club, so a doubleheader is two keys', () => {
	// 34,185 baseball dates carry two games. Matching on the date alone would
	// have to guess for every one of them.
	const f = Array(161).fill('')
	f[0] = '19730704'; f[3] = 'BS1'; f[6] = 'ELI'
	f[1] = '1'
	assert.equal(gameLogId(f), 'ELI197307041')
	f[1] = '2'
	assert.equal(gameLogId(f), 'ELI197307042')
})

test('Retrosheet’s (none) placeholder is not a manager', () => {
	// 148 rows carry a blank id and the literal string `(none)`. Loading them
	// creates one manager with 148 games across forty clubs and a century.
	const f = Array(161).fill('')
	f[0] = '19010101'; f[3] = 'BSN'; f[6] = 'PHI'
	f[89] = ''; f[90] = '(none)'
	f[91] = 'mackc101'; f[92] = 'Connie Mack'
	assert.deepEqual(mlbLeaderRows(f).map((r) => r.leaderName), ['Connie Mack'])

	// The name check on its own, which the row above cannot reach: every `(none)`
	// in the file today also has an empty id, so the empty-id guard fires first
	// and the name guard is never consulted. A mutation run is what showed that
	// — breaking the name check changed no test result, which is how this repo's
	// unreachable route tie-break was found and deleted.
	//
	// It is kept rather than deleted, because the two guard different things:
	// one says the field is missing, the other says Retrosheet filled it in with
	// a word meaning nobody. A future file with an id beside `(none)` would
	// otherwise put a manager called "(none)" on the page.
	const named = Array(161).fill('')
	named[0] = '19010101'; named[3] = 'BSN'; named[6] = 'PHI'
	named[89] = 'nonex001'; named[90] = '(none)'
	named[91] = 'mackc101'; named[92] = 'Connie Mack'
	assert.deepEqual(mlbLeaderRows(named).map((r) => r.leaderName), ['Connie Mack'])
})

test('the fetched file list covers every postseason round', () => {
	// THE BUG THIS EXISTS FOR. Reading a local directory uses a glob and cannot
	// miss a file. Fetching by name over HTTP can, and did: `gldv.txt` was left
	// out, the load reported 132 files fetched and no error, and 1,026
	// division-series attributions were simply absent — 0.2%, invisible in any
	// total. It was found by loading the same data twice and comparing.
	const names = gameLogNames(1897, 2025)
	for (const round of ['glws.txt', 'gllc.txt', 'glwc.txt', 'gldv.txt']) {
		assert.ok(names.includes(round), `${round} is not fetched, so that round has no managers`)
	}
	// The All-Star file is excluded on purpose: its sides are NLS and ALS rather
	// than clubs, and the load skips those games anyway.
	assert.ok(!names.includes('glas.txt'))
})

test('the fetched file list covers exactly the seasons asked for', () => {
	const names = gameLogNames(1999, 2001)
	assert.deepEqual(names.filter((n) => /^gl\d{4}\.txt$/.test(n)),
		['gl1999.txt', 'gl2000.txt', 'gl2001.txt'])
})

test('an nflverse schedules row yields both coaches with the season', () => {
	// The season travels because the resolver needs it: it is half of what tells
	// the two Moras apart.
	const rows = nflLeaderRows({
		game_id: '2004_01_SF_ATL', season: '2004',
		away_team: 'SF', away_coach: 'Dennis Erickson',
		home_team: 'ATL', home_coach: 'Jim Mora',
	})
	assert.deepEqual(rows, [
		{ gameId: '2004_01_SF_ATL', code: 'SF', leaderName: 'Dennis Erickson', season: 2004 },
		{ gameId: '2004_01_SF_ATL', code: 'ATL', leaderName: 'Jim Mora', season: 2004 },
	])
})

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

test('the route is named by the sport, and only by the sport', () => {
	// `/coaches` for football and `/managers` for baseball. A club page must not
	// answer the other sport's noun, which would be the leaders page quietly
	// existing at two URLs.
	assert.deepEqual(parseView('/coaches', { leaderPlural: 'coaches' }), { view: 'leaders' })
	assert.equal(parseView('/managers', { leaderPlural: 'coaches' }), null)
	assert.deepEqual(parseView('/managers', { leaderPlural: 'managers' }), { view: 'leaders' })
	// With no club in hand there is no leaders route at all.
	assert.equal(parseView('/coaches'), null)
})

test('the nav links the leaders page, and the route answers it', () => {
	// This pairing is the whole point. The link was in the nav for as long as the
	// nav existed, answering 404, because the reachability test asked whether
	// every route is linked and never whether every link is a route.
	for (const noun of ['coaches', 'managers']) {
		const team = { nouns: { leaderPlural: noun }, colors: {} }
		const nav = siteNav('', team)
		assert.ok(nav.includes(`href="/${noun}"`), `${noun} not linked`)
		assert.deepEqual(parseView(`/${noun}`, { leaderPlural: noun }), { view: 'leaders' })
	}
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const TEAM = {
	nouns: {
		fullName: 'Green Bay Packers', leaderPlural: 'coaches',
		championship: 'Super Bowl',
	},
	colors: {},
}

const finished = (over = {}) => ({
	leader: 'lombardi-vince', name: 'Vince Lombardi', w: 89, l: 29, t: 4,
	playoffW: 9, playoffL: 1, titles: [{ season: 1966, title: null }],
	seasons: [1959], franchises: ['GB'], games: 122,
	firstSeason: 1959, lastSeason: 1967, winPct: 0.746, basis: 'counted', ...over,
})

test('the titles column is not named after the current championship', () => {
	// `Super Bowl` over Curly Lambeau's 1936, 1939 and 1944 is wrong by thirty
	// years — they were NFL Championships. The records page already learned this
	// and this table made the same mistake on its first render.
	const columns = leaderColumns({ titles: true, leaderNoun: 'Coach' })
	const html = leadersPage({ team: TEAM, colors: {}, leaders: [finished()], base: '', columns })
	// Scoped to the header. "Super Bowl" legitimately appears elsewhere on the
	// page — it is the club's championship noun — so asserting against the whole
	// document tests the wrong thing and fails for the right reason.
	const thead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
	assert.ok(thead.includes('>Titles<'), 'no Titles header')
	assert.ok(!thead.includes('Super Bowl'), 'headed with the current championship')
})

test('the body draws exactly the columns the header does', () => {
	// The body used to recompute which optional columns exist from the rows,
	// agreeing with the header only because both looked at the same array. A
	// header and a body that disagree about how many cells a row has is a table
	// that slides every column one to the left.
	const columns = leaderColumns({ ties: false, post: false, titles: false, leaderNoun: 'Coach' })
	const html = leadersPage({ team: TEAM, colors: {}, leaders: [finished()], base: '', columns })
	const headCells = (html.match(/<th[ >]/g) ?? []).length
	const bodyRow = html.slice(html.indexOf('<tbody>'))
	const bodyCells = (bodyRow.match(/<td[ >]/g) ?? []).length
	assert.equal(headCells, columns.length)
	assert.equal(bodyCells, columns.length)
})

test('a stated row says so on the page', () => {
	// Football before 1999 is transcribed and everything else is counted.
	// Rendering them identically would leave the page unable to say which of its
	// numbers it can stand behind.
	const html = leadersPage({
		team: TEAM, colors: {}, base: '',
		leaders: [finished({ basis: 'stated' }), finished({ leader: 'x', basis: 'mixed' })],
	})
	assert.ok(html.includes('>stated<'))
	assert.ok(html.includes('>part stated<'))
})

test('the table is given a width, or it renders as a narrow column', () => {
	// The bug CLAUDE.md opens with, arriving a third time: the page body is a
	// centred column flexbox, so a block with only a max-width is sized
	// shrink-to-fit. This table came out 550px wide in a 1400px viewport, and
	// only a screenshot showed it.
	const html = leadersPage({ team: TEAM, colors: {}, leaders: [finished()], base: '' })
	assert.ok(/class="record-card league-wide"/.test(html))
})

test('an empty leaders page says so rather than rendering a bare table', () => {
	const html = leadersPage({ team: TEAM, colors: {}, leaders: [], base: '' })
	assert.ok(html.includes('No one on record'))
})

// ---------------------------------------------------------------------------
// The curated file
// ---------------------------------------------------------------------------

const COACHES = join(ROOT, 'data/reference/nfl-coaches.csv')

test('the curated coaches file is committed and readable', { skip: !existsSync(COACHES) && 'no nfl-coaches.csv' }, () => {
	const rows = parseCsv(readFileSync(COACHES, 'utf8'))
	assert.ok(rows.length > 300, `only ${rows.length} rows`)
	for (const r of rows) {
		assert.ok(r.leaderId, 'a row has no leaderId')
		assert.ok(r.name, `${r.leaderId} has no name`)
		assert.ok(Number(r.firstSeason) >= 1920, `${r.name} starts at ${r.firstSeason}`)
		assert.ok(Number(r.statedLastSeason) < 1999,
			`${r.name} states a record through ${r.statedLastSeason}, which the games already count`)
		assert.ok(Number(r.lastSeason) >= Number(r.firstSeason), `${r.name} ends before it starts`)
	}
})

test('one leaderId never carries two different names', () => {
	// The id is the identity and the name is a label, so two labels on one id
	// means the page shows whichever was written last — which is how Jim E. Mora
	// appeared as plain `Jim Mora` on one row and not the other.
	const rows = parseCsv(readFileSync(COACHES, 'utf8'))
	const names = new Map()
	for (const r of rows) {
		if (!names.has(r.leaderId)) names.set(r.leaderId, new Set())
		names.get(r.leaderId).add(r.name)
	}
	const clashes = [...names].filter(([, s]) => s.size > 1)
	assert.deepEqual(clashes.map(([id, s]) => `${id}: ${[...s].join(' / ')}`), [])
})

test('no two curated tenures at one club claim the same first season', () => {
	// That is the primary key of leader_tenure, so a duplicate silently drops a
	// coach at load rather than failing.
	const rows = parseCsv(readFileSync(COACHES, 'utf8'))
	const seen = new Set()
	for (const r of rows) {
		const key = `${r.franchiseAbbrv}|${r.leaderId}|${r.firstSeason}`
		assert.ok(!seen.has(key), `duplicate tenure ${key}`)
		seen.add(key)
	}
})

test('every curated club code is one the franchise history knows', async () => {
	// A bare code is a bug waiting for a second sport, and a code the table has
	// never seen would load a tenure onto a club with no games.
	const { codeTable } = await import('../lib/codes.js')
	const codes = codeTable('nfl')
	const rows = parseCsv(readFileSync(COACHES, 'utf8'))
	const unknown = [...new Set(rows.map((r) => r.franchiseAbbrv))].filter((c) => !codes.knows(c))
	assert.deepEqual(unknown, [])
})

// ---------------------------------------------------------------------------
// A detector, not an assertion
// ---------------------------------------------------------------------------

test('no curated id looks like two people wearing one name', () => {
	// This cannot prove the Mora bug is gone — an ambiguous name the curated file
	// does not mention resolves to a single slug and merges two people silently,
	// and nothing in the data gives it away. So this FLAGS the shape instead:
	// one id whose tenures split into runs more than fifteen years apart at
	// different clubs is what a father and a son look like.
	//
	// A flag is not a fix. It is the difference between a gap that is known and
	// one that is not, and a name landing here needs a human, not a code change.
	const rows = parseCsv(readFileSync(COACHES, 'utf8'))
	const by = new Map()
	for (const r of rows) {
		if (!by.has(r.leaderId)) by.set(r.leaderId, [])
		by.get(r.leaderId).push({ club: r.franchiseAbbrv, first: Number(r.firstSeason), last: Number(r.lastSeason) })
	}
	// Checked by hand and genuinely one person. The detector fired on its first
	// run and was right to: Paddy Driscoll coached the Chicago Cardinals in
	// 1920-1922 and the Chicago Bears in 1956-1957, which is a 34-year gap and
	// two clubs and exactly what a father and a son look like. He was born in
	// 1895 and did both. Listing him here rather than widening the threshold,
	// because the threshold is what would have caught a real Mora.
	const CHECKED = new Set(['driscoll-paddy'])

	const suspect = []
	for (const [id, list] of by) {
		if (CHECKED.has(id)) continue
		const sorted = [...list].sort((a, b) => a.first - b.first)
		for (let i = 1; i < sorted.length; i++) {
			const gap = sorted[i].first - sorted[i - 1].last
			if (gap > 15 && sorted[i].club !== sorted[i - 1].club) {
				suspect.push(`${id} ${sorted[i - 1].club} to ${sorted[i].club}, ${gap} years apart`)
			}
		}
	}
	assert.deepEqual(suspect, [])
})

// ---------------------------------------------------------------------------
// Against the database, when there is one
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL

test('leaders in the database', { skip: !DATABASE_URL && 'no DATABASE_URL — the leader tables are NOT covered by this run' }, async (t) => {
	const pg = (await import('pg')).default
	const client = new pg.Client({ connectionString: DATABASE_URL })
	await client.connect()
	t.after(() => client.end())

	const loaded = async (sql, args = []) => (await client.query(sql, args)).rows

	await t.test('a stated tenure never overlaps the era the games count', async () => {
		// The claim db/migrations/0006 makes in prose, asserted instead. A stated
		// tenure reaching 1999 would be added to a counted record covering the
		// same seasons, and the coach would be paid twice for them.
		const bad = await loaded(
			'SELECT leader, franchise, last_season FROM leader_tenure WHERE last_season >= 1999')
		assert.deepEqual(bad, [])
	})

	await t.test('every attribution points at a game and a club that exist', async () => {
		// Foreign keys say this already; the test is here because a load that
		// silently skipped rows would leave the keys satisfied and the page short.
		const orphans = await loaded(`
			SELECT count(*)::int n FROM game_leader gl
			 WHERE NOT EXISTS (SELECT 1 FROM game g WHERE g.sport = gl.sport AND g.id = gl.game_id)`)
		assert.equal(orphans[0].n, 0)
	})

	await t.test('a leader is per sport, never per bare id', async () => {
		// Two clubs called MIL, and CLAUDE.md's rule arriving with a new noun.
		const dupes = await loaded(`
			SELECT id, count(DISTINCT sport)::int n FROM leader GROUP BY id HAVING count(DISTINCT sport) > 1`)
		// Sharing an id across sports is allowed by the key and would be a
		// coincidence of slugs, not an error — but it must not be silent.
		for (const d of dupes) assert.ok(d.n <= 2, `${d.id} spans ${d.n} sports`)
	})

	await t.test('nobody led two clubs in the same game', async () => {
		const both = await loaded(`
			SELECT game_id, count(*)::int n FROM game_leader
			 GROUP BY sport, game_id HAVING count(*) > 2`)
		assert.deepEqual(both, [])
	})

	// Relations and floors, never snapshots: the data is refreshed and a
	// snapshot fails for reasons that are not defects.
	const anyGames = (await loaded('SELECT count(*)::int n FROM game'))[0].n > 0
	await t.test('a loaded database attributes most of its final games', { skip: !anyGames && 'empty database' }, async () => {
		const [row] = await loaded(`
			SELECT g.sport,
			       count(*) FILTER (WHERE gl.leader IS NOT NULL)::int AS covered,
			       count(*)::int AS sides
			  FROM game g
			  CROSS JOIN LATERAL (VALUES (g.home), (g.away)) AS s(fr)
			  LEFT JOIN game_leader gl
			         ON gl.sport = g.sport AND gl.game_id = g.id AND gl.franchise = s.fr
			 WHERE g.status = 'final' AND g.sport = 'mlb'
			 GROUP BY g.sport`)
		if (!row) return
		// 94.7% measured. The floor is well below it because the shortfall is
		// real and explained: 2026 is not published by Retrosheet yet, and the
		// Negro Leagues are published as .EBR event files rather than game logs.
		assert.ok(row.covered / row.sides > 0.9,
			`only ${row.covered} of ${row.sides} baseball sides have a manager`)
	})
})
