import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { franchiseMap } from '../scripts/load.mjs'
import { checksum, migrationFiles, plan } from '../scripts/migrate.mjs'
import { parseCsv } from '../lib/csv.js'

// Three layers, and which one a given run covers depends on what is available.
// That is stated here rather than left for a green run to imply:
//
//   pure          franchiseMap and plan. Always run.
//   schema        constraints and the upsert rule, against a live Postgres with
//                 fixtures these tests create and roll back. Needs DATABASE_URL.
//                 CI provides one.
//   loaded data   the Packers record and the Bears series, against a database
//                 someone has run scripts/load.mjs into. Needs 490MB of fetched
//                 sources, so CI cannot do it and skips with a reason.

const names = (rows) => rows.map(([code, name, kind]) => ({ code, name, kind }))
const divs = (codes) => codes.map((code) => ({ code }))

// --- franchise mapping ---

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
	// Not the first seen, and not alphabetical. A franchise is keyed by what it
	// is called now, because that is what the division table and every URL says.
	const m = franchiseMap(
		names([['OAK', 'Las Vegas Raiders', 'alias'], ['LV', 'Las Vegas Raiders', 'current']]),
		divs(['LV']))
	assert.equal(m.get('OAK').franchise, 'LV')
})

test('a franchise no longer in the league still resolves', () => {
	// 62 football codes are defunct clubs, none in a division table. They must
	// still map to something: a game referencing them has to load.
	assert.equal(franchiseMap(names([['AKR', 'Akron Pros', 'derived']]), divs([])).get('AKR').franchise, 'AKR')
})

test('a code with no name is not silently merged with another', () => {
	// Grouping is by display name, so a nameless code has nothing to group with.
	// Merging them under one empty name would collapse every unnamed club into a
	// single franchise that had played itself.
	const m = franchiseMap(names([['AKR', '', ''], ['RAC', '', '']]), divs([]))
	assert.equal(m.get('AKR'), undefined)
	assert.equal(m.get('RAC'), undefined)
})

test('the real football tables collapse the aliases and nothing else', () => {
	const m = franchiseMap(
		parseCsv(readFileSync(new URL('../data/reference/nfl-names.csv', import.meta.url), 'utf8')),
		parseCsv(readFileSync(new URL('../data/reference/nfl-divisions.csv', import.meta.url), 'utf8')))
	assert.equal(m.get('SD').franchise, 'LAC')
	assert.equal(m.get('STL').franchise, 'LA')
	assert.equal(m.get('OAK').franchise, 'LV')
	assert.equal(m.get('WSH').franchise, 'WAS')
	for (const code of ['GB', 'CHI', 'DET', 'MIN']) assert.equal(m.get(code).franchise, code)
})

// --- migration planning ---

const f = (id, sum) => ({ id, sum })

test('an unapplied migration is pending', () => {
	assert.deepEqual(plan([f('0001_a.sql', 'x')], []).pending, ['0001_a.sql'])
})

test('an applied migration is not reapplied', () => {
	// The only property that makes it safe to point this at a server.
	const p = plan([f('0001_a.sql', 'x')], [{ id: '0001_a.sql', checksum: 'x' }])
	assert.deepEqual(p.pending, [])
	assert.deepEqual(p.changed, [])
})

test('an applied migration that changed on disk is refused, not reapplied', () => {
	// Editing an applied migration means file and database disagree: every fresh
	// environment gets the edit, every existing one keeps the old, and nothing
	// reports a problem.
	const p = plan([f('0001_a.sql', 'edited')], [{ id: '0001_a.sql', checksum: 'x' }])
	assert.deepEqual(p.changed, ['0001_a.sql'])
	assert.deepEqual(p.pending, [])
})

test('a migration applied but absent from the checkout is reported, not fatal', () => {
	// A checkout can legitimately be older than the database. Worth saying;
	// not worth refusing over.
	const p = plan([], [{ id: '0001_a.sql', checksum: 'x' }])
	assert.deepEqual(p.missing, ['0001_a.sql'])
	assert.deepEqual(p.changed, [])
})

test('migrations apply in filename order, which is why they are numbered', () => {
	// Ten in, lexical order stops matching chronological order unless padded.
	const p = plan([f('0002_b.sql', 'y'), f('0001_a.sql', 'x'), f('0010_c.sql', 'z')], [])
	assert.deepEqual(p.pending, ['0002_b.sql', '0001_a.sql', '0010_c.sql'])
	// The ordering guarantee belongs to migrationFiles, which sorts.
	assert.deepEqual([...migrationFiles()].sort(), migrationFiles())
})

test('the checksum changes when the file does', () => {
	assert.notEqual(checksum('CREATE TABLE a();'), checksum('CREATE TABLE a(); -- edited'))
	assert.equal(checksum('same'), checksum('same'))
})

// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL

test('schema', { skip: !DATABASE_URL && 'no DATABASE_URL — constraints and the upsert rule are NOT covered by this run' }, async (t) => {
	const pg = (await import('pg')).default
	const client = new pg.Client({ connectionString: DATABASE_URL })
	await client.connect()
	t.after(() => client.end())

	/** Each test runs in a transaction that is rolled back, so these need no
	 *  loaded data and leave none behind. That is what lets CI run them against
	 *  an empty database from a migration alone. */
	const inRollback = async (fn) => {
		await client.query('BEGIN')
		try { await fn() } finally { await client.query('ROLLBACK') }
	}

	/** Assert a statement is rejected by a named constraint.
	 *
	 *  The savepoint is not decoration. In Postgres the first failed statement
	 *  aborts the whole transaction, so a second expected failure comes back as
	 *  "current transaction is aborted" rather than the constraint that fired —
	 *  which is how a test asserting two rejections passes for one and fails for
	 *  the other while both constraints work correctly. That is exactly what
	 *  happened here, and the constraint was never the problem.
	 */
	let sp = 0
	const rejectedBy = async (fn, constraint) => {
		const name = `sp${sp++}`
		await client.query(`SAVEPOINT ${name}`)
		let err = null
		try { await fn() } catch (e) { err = e }
		await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
		assert.ok(err, 'statement was accepted but should have been rejected')
		if (constraint) assert.equal(err.constraint, constraint, `rejected by ${err.constraint}, expected ${constraint}`)
	}

	const fixture = async () => {
		await client.query("INSERT INTO sport VALUES ('nfl','football') ON CONFLICT DO NOTHING")
		await client.query("INSERT INTO franchise VALUES ('nfl','GB'),('nfl','CHI') ON CONFLICT DO NOTHING")
	}

	const game = (over = {}) => ({
		sport: 'nfl', id: 'g1', season: 2024, date: '2024-09-08', round: 'regular',
		home: 'GB', away: 'CHI', home_score: 24, away_score: 17,
		neutral: false, status: 'final', source: 'nflverse', ...over,
	})

	const insert = (g) => client.query(
		`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,neutral,status,source)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		[g.sport, g.id, g.season, g.date, g.round, g.home, g.away, g.home_score, g.away_score, g.neutral, g.status, g.source])

	await t.test('a good row is accepted', async () => {
		// The control. Without it every rejection below could be passing for the
		// wrong reason.
		await inRollback(async () => {
			await fixture()
			await insert(game())
		})
	})

	await t.test('a game cannot be played against itself', async () => {
		await inRollback(async () => {
			await fixture()
			await rejectedBy(() => insert(game({ away: 'GB' })), 'no_self_play')
		})
	})

	await t.test('a final game must carry both scores', async () => {
		// Catches structurally the bug seedGameRow shipped: one score present,
		// the other NaN, every comparison false, and the ternary falling to TIE.
		await inRollback(async () => {
			await fixture()
			await rejectedBy(() => insert(game({ away_score: null })), 'scores_match_status')
			await rejectedBy(() => insert(game({ home_score: null, away_score: null })), 'scores_match_status')
		})
	})

	await t.test('a scheduled game may have no scores, but not half of them', async () => {
		await inRollback(async () => {
			await fixture()
			await insert(game({ status: 'scheduled', home_score: null, away_score: null }))
			await rejectedBy(
				() => insert(game({ id: 'g2', status: 'scheduled', away_score: null })), 'scores_match_status')
		})
	})

	await t.test('a round outside the three is rejected', async () => {
		await inRollback(async () => {
			await fixture()
			await rejectedBy(() => insert(game({ round: 'preseason' })), 'game_round_check')
		})
	})

	await t.test('an unknown franchise is rejected', async () => {
		// The foreign key that stops a typo in a code becoming a club.
		await inRollback(async () => {
			await fixture()
			await rejectedBy(() => insert(game({ away: 'ZZZ' })))
		})
	})

	// --- the upsert rule ---

	const upsert = (g) => client.query(
		`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,neutral,status,source)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		 ON CONFLICT (sport,id) DO UPDATE SET
			home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score,
			status=EXCLUDED.status, source=EXCLUDED.source, observed_at=now()
		 WHERE (SELECT authority FROM source WHERE id=EXCLUDED.source)
			>= (SELECT authority FROM source WHERE id=game.source)
			OR game.status <> 'final'`,
		[g.sport, g.id, g.season, g.date, g.round, g.home, g.away, g.home_score, g.away_score, g.neutral, g.status, g.source])

	const read = async () => (await client.query("SELECT source, status, home_score FROM game WHERE id='g1'")).rows[0]

	await t.test('a live source may complete a scheduled game', async () => {
		// The entire point of the reversal, and it failed in the first draft:
		// nflverse publishes the schedule too, so a fixture with no result
		// already belonged to a source of authority 100 and ESPN could never
		// fill it in. Owning the row and owning the result are different things.
		await inRollback(async () => {
			await fixture()
			await insert(game({ status: 'scheduled', home_score: null, away_score: null }))
			await upsert(game({ source: 'espn', home_score: 31, away_score: 28 }))
			const r = await read()
			assert.equal(r.source, 'espn')
			assert.equal(r.status, 'final')
			assert.equal(r.home_score, 31)
		})
	})

	await t.test('a live source may not revise a final authoritative result', async () => {
		await inRollback(async () => {
			await fixture()
			await insert(game())
			await upsert(game({ source: 'espn', home_score: 99, away_score: 0 }))
			const r = await read()
			assert.equal(r.source, 'nflverse')
			assert.equal(r.home_score, 24)
		})
	})

	await t.test('an authoritative source supersedes a live capture', async () => {
		await inRollback(async () => {
			await fixture()
			await insert(game({ source: 'espn', home_score: 31, away_score: 28 }))
			await upsert(game({ source: 'nflverse', home_score: 30, away_score: 28 }))
			const r = await read()
			assert.equal(r.source, 'nflverse')
			assert.equal(r.home_score, 30)
		})
	})

	await t.test('a hand correction outranks a live feed and is not reproducible', async () => {
		await inRollback(async () => {
			await fixture()
			await insert(game({ source: 'espn', home_score: 31, away_score: 28 }))
			await upsert(game({ source: 'manual', home_score: 30, away_score: 28 }))
			assert.equal((await read()).source, 'manual')
			// Both are things this database originates, so both are what a
			// backup exists for. Ordered by id: espn, then manual.
			const { rows } = await client.query(
				"SELECT id, reproducible FROM source WHERE id IN ('manual','espn') ORDER BY id")
			assert.deepEqual(rows, [
				{ id: 'espn', reproducible: false },
				{ id: 'manual', reproducible: false },
			])
		})
	})

	await t.test('what a backup must protect is answerable as a query', async () => {
		// Not "is zero" — a live capture legitimately makes it non-zero until
		// upstream publishes. The point is that the question has an answer.
		const { rows } = await client.query(
			'SELECT count(*)::int n FROM game g JOIN source s ON g.source = s.id WHERE NOT s.reproducible')
		assert.equal(typeof rows[0].n, 'number')
	})
})

// ---------------------------------------------------------------------------

const loaded = async () => {
	if (!DATABASE_URL) return false
	const pg = (await import('pg')).default
	const c = new pg.Client({ connectionString: DATABASE_URL })
	await c.connect()
	try {
		const { rows } = await c.query("SELECT count(*)::int n FROM game WHERE sport='nfl'")
		return rows[0].n > 10000
	} catch { return false } finally { await c.end() }
}

const isLoaded = await loaded()

test('loaded data', { skip: !isLoaded && 'database has no loaded games — run scripts/load.mjs (needs fetched sources, so CI skips this)' }, async (t) => {
	const pg = (await import('pg')).default
	const client = new pg.Client({ connectionString: DATABASE_URL })
	await client.connect()
	t.after(() => client.end())
	const one = async (sql) => (await client.query(sql)).rows[0]

	await t.test('the Packers record matches the live site', async () => {
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
		const r = await one(`SELECT count(*)::int n FROM game
			WHERE sport='nfl' AND status='final' AND ((home='GB' AND away='CHI') OR (home='CHI' AND away='GB'))`)
		assert.equal(r.n, 213)
	})

	await t.test('the aliases collapsed', async () => {
		const r = await one(`SELECT count(DISTINCT franchise)::int f, count(DISTINCT code)::int c
			FROM franchise_code WHERE sport='nfl'`)
		assert.ok(r.c > r.f, `${r.c} codes did not collapse into fewer franchises`)
	})
})
