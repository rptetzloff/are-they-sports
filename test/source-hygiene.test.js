import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['scripts', 'sports', 'teams', 'test']

const files = DIRS.flatMap((d) =>
	readdirSync(join(ROOT, d))
		.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
		.map((f) => d + '/' + f))

test('the scan is actually looking at the source', () => {
	// The failure this whole file exists to prevent is a check that passes
	// because it is looking at nothing. Name the count and the known files.
	assert.ok(files.length >= 8, `only found ${files.length} source files`)
	for (const expected of ['scripts/build.mjs', 'sports/nfl.js', 'teams/packers.js']) {
		assert.ok(files.includes(expected), `not scanning ${expected}`)
	}
})

test('no source file contains a control character', () => {
	// Found by accident: `scripts/franchises.mjs` had a NUL byte inside a
	// template literal, where `${code} ${name}` was actually `${code}\0${name}`.
	// It was written by a heredoc and never noticed, because nothing about it
	// fails. The Map key it built was still unique per pair, so the generated
	// table was correct and every test passed.
	//
	// What it cost was invisible: `file` reported the source as data, and grep
	// and git diff both treat a file with a NUL as binary and refuse to show its
	// contents. A mutation run that could not find a line it had just been shown
	// is what surfaced it.
	//
	// Tabs, newlines and carriage returns are the legitimate ones.
	for (const f of files) {
		const text = readFileSync(join(ROOT, f), 'utf8')
		const i = [...text].findIndex((c) => {
			const n = c.codePointAt(0)
			return n < 32 && n !== 9 && n !== 10 && n !== 13
		})
		assert.equal(i, -1,
			`${f} has a control character at offset ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 30), i + 30))}`)
	}
})

test('no source file has a UTF-8 replacement character', () => {
	// A mojibaked em-dash reads as a typo in a comment and is a sign a file was
	// written through something that lost the encoding.
	//
	// Built from its code point rather than written out, because the first
	// version of this test spelled the character literally and then failed on
	// itself. Which is the right answer to the question it asked, and the wrong
	// answer to the one it meant.
	const REPLACEMENT = String.fromCharCode(0xfffd)
	for (const f of files) {
		assert.ok(!readFileSync(join(ROOT, f), 'utf8').includes(REPLACEMENT), `${f} has mangled bytes`)
	}
})
