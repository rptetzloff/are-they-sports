import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Does the server actually serve these routes?
//
// Nothing here did, and it cost a shipped crash: a rename in the records handler
// was applied to the schedule handler too, which then referenced a variable that
// no longer existed. Every route under /schedule answered nothing at all — the
// process died on the request — and the whole suite stayed green, because every
// other test calls the pure functions directly and never starts a server.
//
// CLAUDE.md's rule is to know which files the suite cannot see and say so out
// loud. server.js was one of them. It is the largest file in the repo and the
// one that wires everything else together.
//
// This is a SMOKE test and is deliberately shallow: it asserts that a route
// answers and does not answer 500, not that the answer is right. What each page
// contains is asserted by the render and compute tests, which need no database.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4300 + (process.pid % 300)
const BASE = `http://127.0.0.1:${PORT}`

/** Routes that must not crash, and what a healthy answer looks like.
 *
 *  Against an EMPTY database every club is in scope and unavailable, which is a
 *  503 that names the missing build — that is the designed behaviour, not a
 *  failure, so both are accepted. What is never acceptable is a 500 or no answer
 *  at all.
 */
const ROUTES = [
	'/', '/healthz',
	'/records', '/standings', '/schedule',
	'/nfl/records', '/nfl/standings', '/nfl/schedule',
	'/mlb/records', '/mlb/standings', '/mlb/schedule',
	'/standings/2011', '/schedule/2011',
	'/nfl/schedule/2011', '/nfl/schedule/2011/w3',
	'/nfl/packers', '/nfl/packers/2011', '/nfl/packers/records', '/nfl/packers/records/win-streaks',
	'/nfl/packers/vs', '/nfl/packers/history',
	'/records?format=json', '/standings?format=json', '/schedule?format=json',
]

const start = () => new Promise((resolve, reject) => {
	const child = spawn(process.execPath, ['server.js'], {
		cwd: ROOT,
		env: {
			...process.env,
			PORT: String(PORT),
			SCOPE: 'all',
			// The live poller off: this must not reach ESPN from a test run.
			LIVE_REFRESH_MS: '0',
			// Pinned, so stored summaries from a previous run are neither reused
			// nor written under a version a real deployment would use.
			BUILD_SHA: 'routes-smoke-test',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let log = ''
	child.stdout.on('data', (d) => { log += d })
	child.stderr.on('data', (d) => { log += d })
	child.on('exit', (code) => reject(new Error(`server exited (${code}) before listening:\n${log}`)))

	const deadline = Date.now() + 30_000
	const poll = async () => {
		try {
			const res = await fetch(`${BASE}/healthz`)
			if (res.ok || res.status === 503) return resolve({ child, log: () => log })
		} catch { /* not up yet */ }
		if (Date.now() > deadline) return reject(new Error(`server never listened:\n${log}`))
		setTimeout(poll, 200)
	}
	poll()
})

test('every league and club route answers, and none of them is a 500', async (t) => {
	if (!process.env.DATABASE_URL) {
		return t.skip('no DATABASE_URL — the server reads games from Postgres at request time')
	}

	const server = await start()
	// Detached from the exit handler above, which exists only to fail startup.
	server.child.removeAllListeners('exit')
	try {
		const bad = []
		for (const route of ROUTES) {
			let status = 'no answer'
			try {
				status = (await fetch(BASE + route)).status
			} catch (e) {
				status = `threw: ${e.cause?.code ?? e.message}`
			}
			// 503 is a designed answer: a club in scope whose games are not loaded
			// reports itself unavailable rather than pretending to be empty.
			if (![200, 404, 503].includes(status)) bad.push(`${route} -> ${status}`)
		}
		assert.deepEqual(bad, [], `routes that did not answer healthily:\n${bad.join('\n')}\n\nserver log:\n${server.log()}`)

		// And it is still up. A route that crashes the process takes every later
		// request with it, which is how the schedule failure presented.
		assert.equal((await fetch(`${BASE}/healthz`)).status < 500, true, 'the server did not survive the sweep')
	} finally {
		server.child.kill()
	}
})

test('a record permalink answers, and one for a record the club does not publish does not', async (t) => {
	// The route pattern accepts any lowercase word, so an unchecked slug renders
	// the full record book under a title naming a record that is not there — a
	// soft 404 that returns 200 and gets indexed. Baseball is the live case:
	// `lossless-seasons` is a football card, and `/mlb/brewers/records/lossless-seasons`
	// has to be a 404 rather than the Brewers' whole record book.
	if (!process.env.DATABASE_URL) {
		return t.skip('no DATABASE_URL — the server reads games from Postgres at request time')
	}
	const server = await start()
	server.child.removeAllListeners('exit')
	try {
		const status = async (route) => (await fetch(BASE + route)).status
		const ok = await status('/nfl/packers/records/win-streaks')
		// 503 means this deployment has no games loaded for the club, which is
		// upstream of anything this test is about. Asserting the pair only when
		// the club is actually servable keeps it from passing vacuously.
		if (ok === 503) return t.skip('packers not loaded in this database')
		assert.equal(ok, 200)
		assert.equal(await status('/nfl/packers/records/no-hitters'), 404)
		if (await status('/mlb/brewers/records') === 200) {
			assert.equal(await status('/mlb/brewers/records/lossless-seasons'), 404)
		}
	} finally {
		server.child.kill()
	}
})
