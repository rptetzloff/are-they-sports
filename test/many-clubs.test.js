// A page of every club, with more clubs than the pool has connections by two
// hundred times. Added with women's college basketball, which took the scope to
// 1,036 clubs and a cold /records past the pool's timeout, and with it the
// process: a league route's rejection had nothing to catch it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimited } from '../lib/derived.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const server = readFileSync(join(ROOT, 'server.js'), 'utf8')

test('at most the limit at once, every item, in the items\' order', async () => {
	let running = 0, most = 0
	const out = await mapLimited(Array.from({ length: 50 }, (_, i) => i), 4, async (n) => {
		most = Math.max(most, ++running)
		await new Promise((r) => setTimeout(r, n % 3))
		running--
		return n * 2
	})
	assert.equal(most, 4)
	assert.deepEqual(out, Array.from({ length: 50 }, (_, i) => i * 2))
	assert.deepEqual(await mapLimited([], 4, async () => 1), [])
	assert.deepEqual(await mapLimited([1], 4, async (n) => n + 1), [2])
})

test('a failure rejects, and the rest of the queue is not started on its account', async () => {
	const seen = []
	await assert.rejects(mapLimited([1, 2, 3], 1, async (n) => {
		seen.push(n)
		if (n === 2) throw new Error('no connection')
	}), /no connection/)
	assert.deepEqual(seen, [1, 2])
})

test('a page reads every club once: its sports share one read, held as a promise', () => {
	// `loaded ??= await ...` is unset until the read ends, so each sport began
	// its own: nine reads of every club at once.
	assert.doesNotMatch(server, /=> \(loaded \?\?= await/)
	assert.equal(server.match(/loaded \?\?= mapLimited\(withGames, READ_AT_ONCE,/g)?.length, 3)
	assert.doesNotMatch(server, /Promise\.all\(\s*withGames\.map/)
})

test('a request that fails answers 500 and leaves the process running', () => {
	assert.match(server, /createServer\(\(req, res\) => handle\(req, res\)\.catch\(/)
	assert.doesNotMatch(server, /createServer\(async/)
})
