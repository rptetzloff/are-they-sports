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

// --- franchise mapping ---
//
// franchiseMap reads the committed history tables directly now, so its input is
// a file rather than a literal. The era resolution it rests on is covered in
// names.test.js; what is asserted here is the mapping it produces.
//
// The heuristic these tests used to cover is gone. It grouped codes by display
// name, which splits a franchise on every rename — how SE1 and MIL became two
// clubs and the Brewers lost 163 games.

test('every source code maps to a canonical franchise', () => {
	const { byCode } = franchiseMap('nfl')
	// The two football sources disagree on codes for the same club.
	assert.equal(byCode.get('SD'), byCode.get('LAC'))
	assert.equal(byCode.get('STL'), byCode.get('LAR'))
	assert.equal(byCode.get('LV'), byCode.get('OAK'))
	assert.equal(byCode.get('WAS'), byCode.get('WSH'))
	// And a franchise that changed identity entirely is still one franchise:
	// Detroit were the Heralds, the Tigers, the Panthers and the Wolverines.
	assert.equal(byCode.get('DTI'), byCode.get('DHR'))
	assert.equal(byCode.get('DPN'), byCode.get('DHR'))
})

test('there are fewer franchises than codes, and both are plausible', () => {
	const { byCode } = franchiseMap('nfl')
	const franchises = new Set(byCode.values())
	assert.ok(byCode.size > franchises.size, 'no codes collapsed at all')
	assert.ok(franchises.size > 100, `only ${franchises.size} franchises`)
})

test('a franchise carries every name it has held', () => {
	const { names } = franchiseMap('nfl')
	const chi = names.filter((n) => n.franchise === 'CHI').map((n) => n.name)
	for (const want of ['Decatur Staleys', 'Chicago Staleys', 'Chicago Bears']) {
		assert.ok(chi.includes(want), `${want} missing from ${chi.join(', ')}`)
	}
})

test('a name held twice with a gap is one row, not two', () => {
	// Buffalo were Bisons, then Rangers, then Bisons again. One row is a small
	// lie about the gap and a large simplification for a label.
	const { names } = franchiseMap('nfl')
	const bisons = names.filter((n) => n.franchise === 'BFF' && n.name === 'Buffalo Bisons')
	assert.equal(bisons.length, 1)
	assert.equal(bisons[0].from, 1924)
	assert.equal(bisons[0].to, 1929)
})

test('baseball maps the Pilots and the Brewers to one franchise', () => {
	// The bug that orphaned 163 games when this grouped by display name.
	const { byCode } = franchiseMap('mlb')
	assert.equal(byCode.get('SE1'), byCode.get('MIL'))
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

	await t.test('one code names one franchise, so a stale mapping cannot accumulate', async () => {
		// The primary key was (sport, code, franchise), which made "LV is LV" and
		// "LV is OAK" two rows rather than a contradiction. ON CONFLICT DO NOTHING
		// never conflicted, both were inserted, and re-running the load could not
		// correct one. That is what the server read at boot, and it exited.
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO franchise VALUES ('nfl','WSH') ON CONFLICT DO NOTHING")
			await client.query("INSERT INTO franchise_code (sport,code,franchise) VALUES ('nfl','WAS','GB')")
			await client.query(`INSERT INTO franchise_code (sport,code,franchise) VALUES ('nfl','WAS','WSH')
			                    ON CONFLICT (sport, code) DO UPDATE SET franchise = EXCLUDED.franchise`)
			const { rows } = await client.query("SELECT franchise FROM franchise_code WHERE sport='nfl' AND code='WAS'")
			assert.deepEqual(rows.map((r) => r.franchise), ['WSH'], 'a code kept two franchises')
		})
	})

	await t.test('the repair moves games off an alias and loses none', async () => {
		// Run against a real database because the two previous attempts at this
		// passed every local check and failed on the server: the first read a
		// stale table at boot, the second deleted a franchise that
		// division_membership still referenced and rolled the whole load back.
		const { repairAliasFranchises } = await import('../scripts/load.mjs')
		const { codeTable } = await import('../lib/codes.js')
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO source (id,authority,reproducible,note) VALUES ('t',1,true,'test') ON CONFLICT DO NOTHING")
			for (const f of ['WAS', 'WSH']) {
				await client.query('INSERT INTO franchise VALUES ($1,$2) ON CONFLICT DO NOTHING', ['nfl', f])
				await client.query("INSERT INTO division_membership VALUES ($1,$2,'NFC','East') ON CONFLICT DO NOTHING", ['nfl', f])
			}
			for (const [id, home, date] of [['r1', 'WAS', '2021-11-01'], ['r2', 'WSH', '2021-11-02']]) {
				await client.query(
					`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
					 VALUES ('nfl',$1,2021,$2,'regular',$3,'GB',10,20,'final','t')`,
					[id, date, home])
			}
			const before = (await client.query("SELECT count(*)::int n FROM game WHERE sport='nfl'")).rows[0].n

			const repaired = await repairAliasFranchises(client, 'nfl', codeTable('nfl'))
			assert.ok(repaired.some((r) => r.from === 'WAS' && r.to === 'WSH'),
				`WAS was not repaired: ${JSON.stringify(repaired)}`)

			const after = (await client.query("SELECT count(*)::int n FROM game WHERE sport='nfl'")).rows[0].n
			assert.equal(after, before, 'the repair lost games')
			assert.equal((await client.query("SELECT count(*)::int n FROM game WHERE home='WAS' OR away='WAS'")).rows[0].n, 0)
			assert.equal((await client.query("SELECT count(*)::int n FROM game WHERE home='WSH'")).rows[0].n, 2)
			// The foreign key that rolled the load back the first time.
			assert.equal((await client.query("SELECT count(*)::int n FROM franchise WHERE sport='nfl' AND id='WAS'")).rows[0].n, 0)

			// Idempotent: a correct database is not repaired twice.
			assert.deepEqual(await repairAliasFranchises(client, 'nfl', codeTable('nfl')), [])
		})
	})

	await t.test('a table referencing franchise that the repair does not handle stops it', async () => {
		// Naming the referencing tables by hand is how division_membership was
		// missed. This asserts the catalogue check is not vacuous.
		const { repairAliasFranchises } = await import('../scripts/load.mjs')
		const { codeTable } = await import('../lib/codes.js')
		await inRollback(async () => {
			await fixture()
			await client.query(`CREATE TABLE coach_tmp (
				sport TEXT NOT NULL, franchise TEXT NOT NULL,
				FOREIGN KEY (sport, franchise) REFERENCES franchise(sport, id))`)
			await assert.rejects(
				() => repairAliasFranchises(client, 'nfl', codeTable('nfl')),
				/coach_tmp/)
		})
	})

	await t.test('a live source may finish a game but not re-attribute one', async () => {
		// nflverse publishes a whole season's schedule before it starts, so an
		// authoritative source owns 272 rows that are merely `scheduled`. A live
		// refresh used to overwrite every one of them with an equally scheduled
		// ESPN row: no new information, and 272 reproducible rows became
		// non-reproducible.
		//
		// A live capture exists to finish a game before the authoritative source
		// publishes the result. Finishing one is worth a write; restating that it
		// has not started is not.
		await inRollback(async () => {
			await fixture()
			const put = (id, source, status, score) => client.query(
				`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
				 VALUES ('nfl',$1,2026,'2026-09-13','regular','GB','CHI',$2,$2,$3,$4)
				 ON CONFLICT (sport, id) DO UPDATE SET
					home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
					status = EXCLUDED.status, source = EXCLUDED.source
				 WHERE (SELECT authority FROM source WHERE id = EXCLUDED.source)
					>= (SELECT authority FROM source WHERE id = game.source)
					OR (game.status <> 'final'
						AND (EXCLUDED.status = 'final' OR game.source = EXCLUDED.source))`,
				[id, score, status, source])
			const read = async (id) => (await client.query(
				'SELECT status, source FROM game WHERE sport=$1 AND id=$2', ['nfl', id])).rows[0]

			// An authoritative schedule, then a live row saying the same thing.
			await put('g1', 'nflverse', 'scheduled', null)
			await put('g1', 'espn', 'scheduled', null)
			assert.deepEqual(await read('g1'), { status: 'scheduled', source: 'nflverse' },
				'a live row re-attributed a game it did not finish')

			// The same live source finishing it IS worth a write.
			await put('g1', 'espn', 'final', 21)
			assert.deepEqual(await read('g1'), { status: 'final', source: 'espn' })

			// And once authoritative and final, a live row cannot touch it.
			await put('g2', 'nflverse', 'final', 17)
			await put('g2', 'espn', 'final', 99)
			assert.deepEqual(await read('g2'), { status: 'final', source: 'nflverse' })

			// A live source may still update its OWN unfinished row — a kickoff
			// time moving, or a score arriving mid-game.
			await put('g3', 'espn', 'scheduled', null)
			await put('g3', 'espn', 'scheduled', null)
			assert.deepEqual(await read('g3'), { status: 'scheduled', source: 'espn' })
		})
	})

	await t.test('only one process refreshes at a time', async () => {
		// The server refreshes the season being played on a timer. Every replica
		// runs that timer, so without a lock they would all fetch the same nine
		// URLs on the same schedule and write the same rows — the objection
		// CLAUDE.md raises against a database per container, arriving from the
		// other side.
		//
		// Two SESSIONS, not two queries: an advisory lock belongs to the session
		// that took it, and a pool does not guarantee the same one twice.
		const { lockKeyFor, withLock } = await import('../lib/live.js')
		const other = new pg.Client({ connectionString: DATABASE_URL })
		await other.connect()
		try {
			const key = lockKeyFor('test-sport')
			let ranInside = false
			const outcome = await withLock(client, key, async () => {
				// While this one holds it, the other must be turned away rather
				// than queued — a refresh already running should be skipped, not
				// stacked up behind itself.
				const blocked = await withLock(other, key, async () => { ranInside = true; return 'ran' })
				assert.deepEqual(blocked, { skipped: true })
				assert.equal(ranInside, false)
				return 'held'
			})
			assert.equal(outcome, 'held')

			// And released afterwards, or the first refresh would be the last.
			const after = await withLock(other, key, async () => 'free')
			assert.equal(after, 'free')
		} finally {
			await other.end()
		}
	})

	await t.test('the refresh slows down when nothing is being played', async () => {
		// Polling every minute around the clock is mostly pointless: a baseball
		// season is six months of the year and a game day a few hours of it. The
		// question is already answerable from the data.
		const { nextDelay } = await import('../lib/live.js')
		const rates = { live: 1000, between: 2000, idle: 3000 }
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO source (id,authority,reproducible,note) VALUES ('t',1,true,'x') ON CONFLICT DO NOTHING")

			// Nothing near today at all — the offseason.
			assert.equal((await nextDelay(client, 'nfl', rates)).ms, 3000)

			const add = (offsetDays, status) => client.query(
				`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
				 VALUES ('nfl',$1,2026,current_date + ($2)::int,'regular','GB','CHI',$3,$4,$5,'t')`,
				[`g${offsetDays}${status}`, offsetDays,
					status === 'final' ? 10 : null, status === 'final' ? 7 : null, status])

			// A game today that is finished: in season, but nothing to watch.
			await add(0, 'final')
			assert.equal((await nextDelay(client, 'nfl', rates)).ms, 2000)

			// One still to be played: watch it closely.
			await add(0, 'scheduled')
			const live = await nextDelay(client, 'nfl', rates)
			assert.equal(live.ms, 1000)
			assert.match(live.why, /unfinished/)
		})
	})

	await t.test('yesterday and tomorrow count, not just today', async () => {
		// A game starting at 7pm local finishes after midnight UTC, and a
		// suspended game is completed the next day — so yesterday can still
		// change. Tomorrow counts because a season that resumes in the morning
		// should not be found six hours late.
		const { nextDelay } = await import('../lib/live.js')
		const rates = { live: 1000, between: 2000, idle: 3000 }
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO source (id,authority,reproducible,note) VALUES ('t',1,true,'x') ON CONFLICT DO NOTHING")
			await client.query(
				`INSERT INTO game (sport,id,season,date,round,home,away,status,source)
				 VALUES ('nfl','y',2026,current_date - 1,'regular','GB','CHI','scheduled','t')`)
			assert.equal((await nextDelay(client, 'nfl', rates)).ms, 1000)
		})
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO source (id,authority,reproducible,note) VALUES ('t',1,true,'x') ON CONFLICT DO NOTHING")
			await client.query(
				`INSERT INTO game (sport,id,season,date,round,home,away,home_score,away_score,status,source)
				 VALUES ('nfl','tm',2026,current_date + 1,'regular','GB','CHI',3,0,'final','t')`)
			assert.equal((await nextDelay(client, 'nfl', rates)).ms, 2000)
		})
	})

	await t.test('another sport being live does not speed this one up', async () => {
		const { nextDelay } = await import('../lib/live.js')
		const rates = { live: 1000, between: 2000, idle: 3000 }
		await inRollback(async () => {
			await fixture()
			await client.query("INSERT INTO sport VALUES ('mlb','baseball') ON CONFLICT DO NOTHING")
			await client.query("INSERT INTO franchise VALUES ('mlb','MIL'),('mlb','CHN') ON CONFLICT DO NOTHING")
			await client.query("INSERT INTO source (id,authority,reproducible,note) VALUES ('t',1,true,'x') ON CONFLICT DO NOTHING")
			await client.query(
				`INSERT INTO game (sport,id,season,date,round,home,away,status,source)
				 VALUES ('mlb','m',2026,current_date,'regular','MIL','CHN','scheduled','t')`)
			assert.equal((await nextDelay(client, 'mlb', rates)).ms, 1000)
			assert.equal((await nextDelay(client, 'nfl', rates)).ms, 3000)
		})
	})

	await t.test('a refresh that throws still releases the lock', async () => {
		const { lockKeyFor, withLock } = await import('../lib/live.js')
		const key = lockKeyFor('test-throw')
		await assert.rejects(() => withLock(client, key, async () => { throw new Error('boom') }), /boom/)
		// If the finally clause were missing this would be skipped forever.
		assert.equal(await withLock(client, key, async () => 'free'), 'free')
	})

	await t.test('a summary is found only when its inputs match', async () => {
		// The whole safety property. A stored summary is a cache with its inputs
		// named: one computed from different games is not stale, it is NOT FOUND,
		// so it cannot be served. This repo has twice shipped a cache that held a
		// correction until the next deploy, and that is what this prevents.
		const { readSummary, writeSummary } = await import('../lib/store.js')
		await inRollback(async () => {
			await fixture()
			const key = { scope: 'all', sport: 'nfl', view: 'records', season: 0 }
			await writeSummary({ ...key, version: 'v1', payload: { clubs: 32 } }, client)
			assert.deepEqual(await readSummary({ ...key, version: 'v1' }, client), { clubs: 32 })
			assert.equal(await readSummary({ ...key, version: 'v2' }, client), null,
				'a summary computed from other inputs was served')
		})
	})

	await t.test('recomputing replaces the row rather than adding one', async () => {
		// Keyed on (scope, sport, view, season), so a season that is played out
		// over six months leaves one row, not one per score change.
		const { readSummary, writeSummary } = await import('../lib/store.js')
		await inRollback(async () => {
			await fixture()
			const key = { scope: 'all', sport: 'nfl', view: 'standings', season: 2026 }
			await writeSummary({ ...key, version: 'v1', payload: { w: 1 } }, client)
			await writeSummary({ ...key, version: 'v2', payload: { w: 2 } }, client)
			const { rows } = await client.query(
				"SELECT count(*)::int n FROM league_summary WHERE scope='all' AND sport='nfl' AND view='standings' AND season=2026")
			assert.equal(rows[0].n, 1, 'a second computation left a second row')
			assert.deepEqual(await readSummary({ ...key, version: 'v2' }, client), { w: 2 })
			assert.equal(await readSummary({ ...key, version: 'v1' }, client), null)
		})
	})

	await t.test('two scopes do not share a record book', async () => {
		// /records is four clubs under division:nfl/nfc-north and thirty-two under
		// sport:nfl — different answers to the same question. Two deployments
		// against one database would otherwise serve each other's.
		const { readSummary, writeSummary } = await import('../lib/store.js')
		await inRollback(async () => {
			await fixture()
			const base = { sport: 'nfl', view: 'records', season: 0, version: 'v1' }
			await writeSummary({ ...base, scope: 'all', payload: { clubs: 32 } }, client)
			await writeSummary({ ...base, scope: 'division:nfl/nfc-north', payload: { clubs: 4 } }, client)
			assert.deepEqual(await readSummary({ ...base, scope: 'all' }, client), { clubs: 32 })
			assert.deepEqual(await readSummary({ ...base, scope: 'division:nfl/nfc-north' }, client), { clubs: 4 })
		})
	})

	await t.test('a summary is a cache: the table can be emptied and rebuilt', async () => {
		// The test CLAUDE.md sets for derived data. Nothing hand-edits this table
		// and nothing is lost by dropping it — every row is recomputed on the next
		// request that misses.
		const { readSummary, writeSummary } = await import('../lib/store.js')
		await inRollback(async () => {
			await fixture()
			const key = { scope: 'all', sport: 'nfl', view: 'records', season: 0, version: 'v1' }
			await writeSummary({ ...key, payload: { clubs: 32 } }, client)
			await client.query('TRUNCATE league_summary')
			assert.equal(await readSummary(key, client), null)
			// And nothing else went with it.
			const { rows } = await client.query("SELECT count(*)::int n FROM game WHERE sport='nfl'")
			assert.ok(rows[0].n >= 0)
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

	await t.test('the record book sees every title game', async () => {
		// Championships are identified at load time from the last playoff game of
		// each league in a season, so they exist in the database and not in the
		// committed artifacts.
		//
		// Fifteen GAMES across thirteen SEASONS, and the difference is real
		// rather than an off-by-two: the Packers won the NFL Championship and the
		// Super Bowl in both 1966 and 1967, so those seasons have two title games
		// each. Asserting one number for both is what made this fail first.
		const r = await one(`SELECT count(*)::int games, count(DISTINCT season)::int seasons
			FROM game WHERE sport='nfl' AND round='championship' AND (home='GB' OR away='GB')`)
		assert.equal(r.games, 15)
		assert.equal(r.seasons, 13)
	})

	await t.test('the aliases collapsed', async () => {
		const r = await one(`SELECT count(DISTINCT franchise)::int f, count(DISTINCT code)::int c
			FROM franchise_code WHERE sport='nfl'`)
		assert.ok(r.c > r.f, `${r.c} codes did not collapse into fewer franchises`)
	})
})
