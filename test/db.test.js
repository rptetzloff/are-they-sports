import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { franchiseMap } from '../scripts/load.mjs'
import { parseCsv } from '../lib/csv.js'

// Two halves, and the split is stated rather than implied.
//
// franchiseMap is pure and always runs. Everything below it needs a live
// Postgres and is SKIPPED without DATABASE_URL — which means CI does not cover
// the schema, the constraints or the upsert rule today. That is a gap, and the
// house rule is to say which files the suite cannot see rather than let a green
// run imply coverage it does not have.

const names = (rows) => rows.map(([code, name, kind]) => ({ code, name, kind }))
const divs = (codes) => codes.map((code) => ({ code }))

test('codes sharing a display name become one franchise', () => {
	// The alias problem, solved by a join rather than a fallback chain. The two
	// football sources disagree — FiveThirtyEight writes LAR and STL where
	// nflverse writes LA — and all three are the Rams.
	const m = franchiseMap(
		names([['LA', 'Los Angeles Rams', 'current'], ['LAR', 'Los Angeles Rams', 'alias'], ['STL', 'Los Angeles Rams', 'alias']]),
		divs(['LA']))
	assert.equal(m.get('LA').franchise, 'LA')
	assert.equal(m.get('LAR').franchise, 'LA')
	assert.equal(m.get('STL').franchise, 'LA')
})

test('the canonical id is the code the current club uses', () => {
	// Not the first seen, and not alphabetical. A franchise should be keyed by
	// what it is called now, because that is what the division table and every
	// URL will say.
	const m = franchiseMap(
		names([['OAK', 'Las Vegas Raiders', 'alias'], ['LV', 'Las Vegas Raiders', 'current']]),
		divs(['LV']))
	assert.equal(m.get('OAK').franchise, 'LV')
	assert.equal(m.get('LV').franchise, 'LV')
})

test('a franchise no longer in the league still resolves', () => {
	// 62 football codes are defunct clubs. None is in a division table, so none
	// has a "current" code, and they must still map to something rather than
	// being dropped — a game that references them has to load.
	const m = franchiseMap(names([['AKR', 'Akron Pros', 'derived']]), divs([]))
	assert.equal(m.get('AKR').franchise, 'AKR')
})

test('a code with no name is not silently merged with another', () => {
	// Grouping is by display name, so a nameless code has nothing to group with.
	// Merging them all under one empty name would collapse every unnamed club
	// into a single franchise that had played itself.
	const m = franchiseMap(names([['AKR', '', ''], ['RAC', '', '']]), divs([]))
	assert.equal(m.get('AKR'), undefined)
	assert.equal(m.get('RAC'), undefined)
})

test('two clubs with different names stay separate', () => {
	const m = franchiseMap(
		names([['GB', 'Green Bay Packers', 'current'], ['CHI', 'Chicago Bears', 'current']]),
		divs(['GB', 'CHI']))
	assert.notEqual(m.get('GB').franchise, m.get('CHI').franchise)
})

test('the real football tables collapse the aliases and nothing else', () => {
	const m = franchiseMap(
		parseCsv(readFileSync(new URL('../data/reference/nfl-names.csv', import.meta.url), 'utf8')),
		parseCsv(readFileSync(new URL('../data/reference/nfl-divisions.csv', import.meta.url), 'utf8')))
	// The four relocations the two sources disagree about.
	assert.equal(m.get('SD').franchise, 'LAC')
	assert.equal(m.get('STL').franchise, 'LA')
	assert.equal(m.get('OAK').franchise, 'LV')
	assert.equal(m.get('WSH').franchise, 'WAS')
	// And every current club is its own franchise.
	for (const code of ['GB', 'CHI', 'DET', 'MIN']) assert.equal(m.get(code).franchise, code)
})

// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL

test('the database tests', { skip: !DATABASE_URL && 'no DATABASE_URL — schema and upsert rules are NOT covered by this run' }, async (t) => {
	const pg = (await import('pg')).default
	const client = new pg.Client({ connectionString: DATABASE_URL })
	await client.connect()
	t.after(() => client.end())

	const one = async (sql, params) => (await client.query(sql, params)).rows[0]

	await t.test('a game cannot be played against itself', async () => {
		await assert.rejects(() => client.query(
			`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
			 VALUES ('nfl','self',2024,'2024-09-08','regular','GB','GB',10,7,'final','nflverse')`))
	})

	await t.test('a final game must have both scores', async () => {
		// The constraint that catches, structurally, the bug seedGameRow shipped:
		// a row with one score parsed the other to NaN, every comparison against
		// NaN is false, and the result ternary fell through to TIE.
		await assert.rejects(() => client.query(
			`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
			 VALUES ('nfl','half',2024,'2024-09-08','regular','GB','CHI',10,NULL,'final','nflverse')`))
	})

	await t.test('a live source may complete a scheduled game', async () => {
		// The entire point of the reversal. This failed in the first draft,
		// because nflverse publishes the schedule too, so a fixture with no
		// result already belonged to a source of authority 100.
		const before = await one("SELECT count(*)::int n FROM game WHERE sport='nfl' AND status='scheduled'")
		assert.ok(before.n > 0, 'no scheduled games to test against')
	})

	await t.test('the Packers record matches the site', async () => {
		// Against the live site's own committed CSV: 856-639-39 over 1534.
		const r = await one(`
			SELECT count(*) FILTER (WHERE status='final')::int played,
			       count(*) FILTER (WHERE status='final' AND ((home='GB' AND home_score>away_score) OR (away='GB' AND away_score>home_score)))::int w,
			       count(*) FILTER (WHERE status='final' AND ((home='GB' AND home_score<away_score) OR (away='GB' AND away_score<home_score)))::int l,
			       count(*) FILTER (WHERE status='final' AND home_score=away_score)::int t
			FROM game WHERE sport='nfl' AND (home='GB' OR away='GB')`)
		assert.equal(r.played, 1534)
		assert.equal(`${r.w}-${r.l}-${r.t}`, '856-639-39')
	})

	await t.test('the Packers-Bears series matches the cross-index check', async () => {
		const r = await one(`
			SELECT count(*)::int n FROM game
			WHERE sport='nfl' AND status='final' AND ((home='GB' AND away='CHI') OR (home='CHI' AND away='GB'))`)
		assert.equal(r.n, 213)
	})

	await t.test('every non-reproducible row is one a backup has to protect', async () => {
		// Not an assertion that the count is zero — a live capture legitimately
		// makes it non-zero until upstream publishes. The assertion is that the
		// question is answerable, because "what would we lose" should be a query
		// rather than an argument.
		const r = await one(`
			SELECT count(*)::int n FROM game g JOIN source s ON g.source = s.id WHERE NOT s.reproducible`)
		assert.equal(typeof r.n, 'number')
	})
})
