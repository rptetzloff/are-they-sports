import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'
import { codeTable } from '../lib/codes.js'
import { resolver } from '../lib/names.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHAMPS = join(ROOT, 'data/reference/nfl-champions.csv')
const rows = parseCsv(readFileSync(CHAMPS, 'utf8'))

const METHODS = new Set(['standings', 'playoff game', 'championship game'])

// ---------------------------------------------------------------------------
// The curated file
// ---------------------------------------------------------------------------

test('every champion code names a franchise the reference table knows', () => {
	// Three codes in the supplied version were wrong and every one of them
	// RESOLVED — CRA is the Chicago Rockets, NYY the NFL New York Bulldogs, BDA
	// the Brooklyn Dodgers. A code that resolves to the wrong club is the silent
	// failure this repo keeps recording, so this only proves the codes are real;
	// the game-level check below is what proves they are the right ones.
	const codes = codeTable('nfl')
	const unknown = []
	for (const r of rows) {
		if (!codes.knows(r.champion)) unknown.push(`${r.season} ${r.league} ${r.champion}`)
		if (r.runnerUp && !codes.knows(r.runnerUp)) unknown.push(`${r.season} ${r.league} ${r.runnerUp}`)
	}
	assert.deepEqual(unknown, [])
})

test('a standings title has no opponent, and a game title has one', () => {
	// Recording a runner-up for a season decided on the final standings would
	// invent a game that was never played.
	for (const r of rows) {
		assert.ok(METHODS.has(r.method), `${r.season}: unknown method ${r.method}`)
		if (r.method === 'standings') {
			assert.equal(r.runnerUp, '', `${r.season} ${r.league} names a runner-up for a standings title`)
		} else {
			assert.notEqual(r.runnerUp, '', `${r.season} ${r.league} was decided by a game with nobody to beat`)
		}
	}
})

test('one champion per league per season', () => {
	// The primary key of the table. Two rows for one league-season would drop
	// one silently at load rather than failing.
	const seen = new Set()
	for (const r of rows) {
		const key = `${r.season}|${r.league}`
		assert.ok(!seen.has(key), `two champions for ${key}`)
		seen.add(key)
	}
})

test('nobody beat themselves', () => {
	for (const r of rows) assert.notEqual(r.champion, r.runnerUp, `${r.season}: champion is its own runner-up`)
})

test('the file covers the era it claims and stops where the games take over', () => {
	const seasons = rows.map((r) => Number(r.season))
	assert.equal(Math.min(...seasons), 1920)
	assert.equal(Math.max(...seasons), 1969)
	// The standings era is the reason this file exists: twelve seasons plus the
	// 1932 tie-breaker that no derivation can reach.
	assert.equal(rows.filter((r) => r.method === 'standings').length, 12)
	assert.equal(rows.filter((r) => r.method === 'playoff game').length, 1)
})

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL

test('championships in the database', { skip: !DATABASE_URL && 'no DATABASE_URL — the championship table is NOT covered by this run' }, async (t) => {
	const pg = (await import('pg')).default
	const client = new pg.Client({ connectionString: DATABASE_URL })
	await client.connect()
	t.after(() => client.end())
	const q = async (sql, args = []) => (await client.query(sql, args)).rows

	const loaded = (await q("SELECT count(*)::int n FROM championship WHERE sport = 'nfl'"))[0].n
	const anyGames = (await q("SELECT count(*)::int n FROM game WHERE sport = 'nfl'"))[0].n > 0

	await t.test('the curated champions agree with the ones the games derive', {
		skip: !anyGames && 'no football games loaded',
	}, async () => {
		// THE REASON THE 51 DERIVABLE ROWS ARE KEPT. The load marks a champion by
		// finding the last playoff game of a league in a season, and until this
		// file existed that rule had never been checked against anything. The
		// check found three wrong codes in the curated file on its first run,
		// which is the check earning its keep before it was committed.
		//
		// A disagreement is reported, never resolved: two independent sources
		// differing is a thing for a person to look at.
		const bad = await q(`
			SELECT c.season, c.league, c.champion, g.home, g.away, g.home_score, g.away_score
			  FROM championship c JOIN game g ON g.sport = c.sport AND g.id = c.game_id
			 WHERE c.sport = 'nfl'
			   AND c.champion <> CASE WHEN g.home_score > g.away_score THEN g.home ELSE g.away END`)
		assert.deepEqual(bad, [], 'a champion did not win the game it is linked to')
	})

	await t.test('every curated champion won a championship game that season', {
		skip: !anyGames && 'no football games loaded',
	}, async () => {
		// AGAINST THE FILE, not against the loaded table. The check above joins
		// on `game_id`, which the LOAD computed from this file — so a wrong code
		// committed to the CSV passes until somebody reloads. A mutation run
		// proved it: changing the AAFC champion back to the code that resolves
		// to the Chicago Rockets changed no test result.
		//
		// This is the check that found those three codes in the first place, and
		// it belongs where it can fail on the file alone.
		const finals = await q(`
			SELECT season, home, away, home_score, away_score FROM game
			 WHERE sport = 'nfl' AND round = 'championship' AND status = 'final'`)
		const winners = new Map()
		for (const g of finals) {
			const w = g.home_score > g.away_score ? g.home : g.away
			if (!winners.has(g.season)) winners.set(g.season, new Set())
			winners.get(g.season).add(w)
		}
		const codes = codeTable('nfl')
		const wrong = []
		for (const r of rows) {
			if (r.method !== 'championship game') continue
			const champ = codes.franchiseOf(r.champion)
			if (!winners.get(Number(r.season))?.has(champ)) {
				wrong.push(`${r.season} ${r.league}: ${r.championName} (${r.champion}) won no championship game`)
			}
		}
		assert.deepEqual(wrong, [])
	})

	await t.test('a standings champion topped its league, or says why not', {
		skip: !anyGames && 'no football games loaded',
	}, async () => {
		// The twelve standings seasons have no game to point at, which is why
		// they are curated — and left the only rows in this file that nothing
		// checked at all. A mutation run showed it: changing the 1929 champion
		// from Green Bay to the Bears changed no test result.
		//
		// But the title was awarded ON the standings, so the champion should top
		// its own league. Nine of the twelve do. The three that do not are each
		// documented in the row's own note, and requiring the note is what turns
		// an exception into a record rather than a hole:
		//
		//   1920  Akron tied Buffalo on percentage; the title was voted on
		//   1925  Pottsville finished ahead and was suspended
		//   1930  the league excluded ties from percentage and this repo does not
		const tally = await q(`
			SELECT g.season, s.fr AS club,
			       count(*) FILTER (WHERE res.r = 'W')::int w,
			       count(*) FILTER (WHERE res.r = 'L')::int l,
			       count(*) FILTER (WHERE res.r = 'T')::int t
			  FROM game g
			  CROSS JOIN LATERAL (VALUES (g.home), (g.away)) AS s(fr)
			  CROSS JOIN LATERAL (SELECT CASE
			      WHEN g.home_score = g.away_score THEN 'T'
			      WHEN (g.home = s.fr) = (g.home_score > g.away_score) THEN 'W'
			      ELSE 'L' END) AS res(r)
			 WHERE g.sport = 'nfl' AND g.status = 'final' AND g.season < 1933
			 GROUP BY g.season, s.fr`)
		const bySeason = new Map()
		for (const c of tally) {
			if (!bySeason.has(c.season)) bySeason.set(c.season, [])
			bySeason.get(c.season).push(c)
		}
		const pct = (c) => (c.w + c.l + c.t ? (c.w + c.t / 2) / (c.w + c.l + c.t) : 0)
		const league = resolver('nfl')
		const leagueOf = (club, season) => league(club, { season: String(season) }).league ?? ''

		const bad = []
		for (const r of rows.filter((x) => x.method === 'standings')) {
			const season = Number(r.season)
			const all = bySeason.get(season) ?? []
			const mine = leagueOf(r.champion, season)
			const inLeague = all.filter((c) => leagueOf(c.club, season) === mine)
			const champ = inLeague.find((c) => c.club === r.champion)
			assert.ok(champ, `${season}: champion ${r.champion} played no games`)

			// How many clubs finished STRICTLY ahead, not what index a sort put
			// the champion at. In 1924 Cleveland went 7-1-1 and Duluth 5-1, both
			// exactly .8333, and whichever the sort happened to place first
			// decided whether this test passed — the same non-total-ordering
			// flaw lib/sort.js has a test for. A tie is not being beaten.
			const better = inLeague.filter((c) => pct(c) > pct(champ)).length
			if (better === 0) continue
			// One club ahead is a documented dispute. Three would mean the row
			// is simply wrong, and no note could explain it.
			assert.ok(better === 1,
				`${season}: champion ${r.champion} finished behind ${better} clubs in its league`)
			if (!r.notes || r.notes.length < 20) {
				bad.push(`${season} ${r.champion} finished behind a club and the row does not say why`)
			}
		}
		assert.deepEqual(bad, [])
	})

	await t.test('every season with a game has one, and the standings era has none', {
		skip: !loaded && 'championship table is empty',
	}, async () => {
		// The constraint the schema states, asserted against real rows: a title
		// taken on standings has no game to point at, and one taken in a game
		// does. That split is the entire reason this table exists.
		const wrong = await q(`
			SELECT season, league, method FROM championship
			 WHERE sport = 'nfl'
			   AND ((method = 'standings' AND game_id IS NOT NULL)
			     OR (method <> 'standings' AND game_id IS NULL))`)
		assert.deepEqual(wrong, [])
	})

	await t.test('Super Bowls I to IV are champions in their own right', {
		skip: !loaded && 'championship table is empty',
	}, async () => {
		// Keyed by season alone, the derived pass skipped every season the
		// curated file mentions — and 1966 to 1969 each have a curated NFL and
		// AFL champion, so the four games the era is remembered for were dropped.
		// Green Bay's 1966 read "NFL Championship" with no Super Bowl beside it.
		const early = await q(`
			SELECT season, champion FROM championship
			 WHERE sport = 'nfl' AND title = 'Super Bowl' AND season < 1970
			 ORDER BY season`)
		assert.deepEqual(early.map((r) => `${r.season} ${r.champion}`),
			['1966 GB', '1967 GB', '1968 NYJ', '1969 KC'])
	})

	await t.test('a club counts a season once, however many titles it held', {
		skip: !loaded && 'championship table is empty',
	}, async () => {
		// Green Bay won the 1966 NFL Championship and then Super Bowl I. Two
		// rows, one championship season — and counting rows gives Lombardi seven
		// where he won five.
		const gb = await q(`
			SELECT count(*)::int rows, count(DISTINCT season)::int seasons
			  FROM championship WHERE sport = 'nfl' AND champion = 'GB'`)
		assert.ok(gb[0].rows > gb[0].seasons, 'expected a club with two titles in one season')
		assert.equal(gb[0].seasons, 13, 'Green Bay has thirteen championship seasons')
	})
})

// ---------------------------------------------------------------------------
// What reached the coaches
// ---------------------------------------------------------------------------

const COACHES = join(ROOT, 'data/reference/nfl-coaches.csv')
const coaches = parseCsv(readFileSync(COACHES, 'utf8'))
/** Every title season a coach won at a club, across ALL their rows there.
 *
 *  Across rows, not the first one: the curated file splits a tenure wherever
 *  Wikipedia's table does, so Hank Stram has two Kansas City rows — the Dallas
 *  Texans years and the Chiefs years — carrying 1962 and 1969 separately.
 *  Reading only the first found one title and missed the other. */
const titlesOf = (id, club) => coaches
	.filter((c) => c.leaderId === id && c.franchiseAbbrv === club)
	.flatMap((c) => (c.titleSeasons ?? '').split(/\s+/))
	.filter(Boolean)
	.sort()

test('the standings era reaches the coaches who won it', () => {
	// The whole point. Curly Lambeau won six championships and the leaders page
	// showed three, because 1929, 1930 and 1931 were taken on the final
	// standings and counting championship games cannot see them.
	assert.deepEqual(titlesOf('lambeau-curly', 'GB'),
		['1929', '1930', '1931', '1936', '1939', '1944'])
})

test('a league title lost in the Super Bowl is not a championship', () => {
	// Kansas City won the 1966 AFL Championship and then LOST Super Bowl I;
	// Baltimore won the 1968 NFL Championship and then lost Super Bowl III.
	// Counting every league title credited Hank Stram and Don Shula with
	// championships their clubs did not win.
	assert.deepEqual(titlesOf('shula-don', 'IND'), [])
	assert.ok(!titlesOf('stram-hank', 'KC').includes('1966'))
	// The ones they did win are still there: Stram's 1962 AFL title came before
	// there was a Super Bowl to lose, and 1969 he won.
	assert.deepEqual(titlesOf('stram-hank', 'KC'), ['1962', '1969'])
	assert.deepEqual(titlesOf('shula-don', 'MIA'), ['1972', '1973'])
})

test('a coach with two titles in one season counts it once', () => {
	// Lombardi won the 1966 NFL Championship and Super Bowl I, and the 1967 NFL
	// Championship and Super Bowl II. Five championship seasons, nine rows.
	assert.deepEqual(titlesOf('lombardi-vince', 'GB'), ['1961', '1962', '1965', '1966', '1967'])
})
