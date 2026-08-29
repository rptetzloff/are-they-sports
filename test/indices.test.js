import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtTeams, parseNdjson } from '../lib/indices.js'
import { renderNdjson } from '../scripts/build.mjs'

const LF = String.fromCharCode(10)

test('what the builder writes is what the reader reads', () => {
	// The round trip, which is where derivations break quietly. The baseball
	// site once tagged only the top level of its indices: the server booted,
	// logged success, served every page, and threw on every box score.
	const entries = [{ gid: 'a', result: 'WIN' }, { gid: 'b', result: 'LOSS' }]
	const { head, entries: back } = parseNdjson(renderNdjson(entries).toString())
	assert.equal(head.size, 2)
	assert.deepEqual(back, entries)
})

test('a truncated index is an error, not a shorter season', () => {
	// The reason the header carries a count. A short read is otherwise
	// indistinguishable from a club that played fewer games, and it stays that
	// way until someone counts by hand.
	const full = renderNdjson([{ a: 1 }, { a: 2 }, { a: 3 }]).toString()
	const cut = full.split(LF).slice(0, 3).join(LF)
	assert.throws(() => parseNdjson(cut), /declares 3 entries and carries 2/)
})

test('an empty file is an error rather than an empty index', () => {
	assert.throws(() => parseNdjson(''), /empty index/)
})

test('an index with no entries is legitimate and parses', () => {
	// Football before 1999 has no play-by-play, so a club can have a real,
	// empty scoring index. That is not the same as a truncated file, and the
	// count in the header is what tells them apart.
	const { head, entries } = parseNdjson(renderNdjson([]).toString())
	assert.equal(head.size, 0)
	assert.deepEqual(entries, [])
})

test('the clubs this checkout has built are the ones with manifests', () => {
	const built = builtTeams()
	assert.ok(built.has('packers'), 'packers not built')
	assert.ok(built.has('brewers'), 'brewers not built')
})

test('a directory without a manifest is not a built club', () => {
	// An interrupted build leaves the directory behind. Treating its presence as
	// proof is how a server decides it has data it does not have.
	//
	// This needs a fixture. Asserting against the real index directory could not
	// tell the two rules apart, because every directory in it happens to have a
	// manifest — a mutation that accepted any directory changed nothing, and the
	// test above passed either way.
	const dir = mkdtempSync(join(tmpdir(), 'ats-indices-'))
	try {
		mkdirSync(join(dir, 'finished'))
		writeFileSync(join(dir, 'finished', 'manifest.json'), '{}')
		mkdirSync(join(dir, 'interrupted'))
		assert.deepEqual([...builtTeams(dir)], ['finished'])
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('a missing index directory is empty, not a crash', () => {
	assert.deepEqual([...builtTeams('/no/such/directory/anywhere')], [])
})
