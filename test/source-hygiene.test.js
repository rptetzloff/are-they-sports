import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['scripts', 'sports', 'teams', 'test']

/** Every source file under a directory, including one level of subdirectory.
 *
 *  It listed only the top level, and `teams/` gained per-sport subdirectories —
 *  so the moment the manifests moved, this scanned NONE of them. Every check in
 *  this file would still have passed, over nothing, which is precisely the
 *  failure the file exists to catch. The count assertion below is what noticed.
 */
const sources = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
	? readdirSync(join(ROOT, d, e.name))
		.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
		.map((f) => `${d}/${e.name}/${f}`)
	: (e.name.endsWith('.js') || e.name.endsWith('.mjs') ? [`${d}/${e.name}`] : [])))

const files = DIRS.flatMap(sources)

test('the scan is actually looking at the source', () => {
	// The failure this whole file exists to prevent is a check that passes
	// because it is looking at nothing. Name the count and the known files.
	assert.ok(files.length >= 8, `only found ${files.length} source files`)
	// Named per directory, because a total can stay healthy while one directory
	// silently drops to zero — which is what happened when teams/ gained
	// subdirectories and this scanner did not follow.
	for (const d of DIRS) {
		assert.ok(sources(d).length > 0, `no source files found under ${d}/`)
	}
	for (const expected of ['scripts/build.mjs', 'sports/nfl.js', 'teams/nfl/packers.js']) {
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

test('the stylesheet contains no backtick outside its own template markers', () => {
	// lib/style.js is one big template literal. A backtick anywhere inside it —
	// including inside a CSS comment, quoting a selector the way prose does —
	// ends the literal, and everything after it is parsed as JavaScript. The
	// error points at the next colon, which is a CSS property somewhere below,
	// so the message never names the real cause.
	//
	// Third occurrence. CLAUDE.md records two, and the third happened while
	// writing the comment that warns about it: the prose quoted the :target
	// pseudo-class in backticks. A screenshot cannot catch this one — the module
	// does not load at all — but nothing failed until a page was requested,
	// because no test imported the stylesheet on its own.
	const lines = readFileSync(join(ROOT, 'lib/style.js'), 'utf8').split(/\r?\n/)
	// Between the line that OPENS the template and the line that closes it,
	// there may be no backtick at all. Outside those bounds the file's own JSDoc
	// quotes selectors and filenames freely, which is fine and is why this is
	// bounded rather than a whole-file scan.
	const open = lines.findIndex((l) => /^export const STYLE = `$/.test(l.trim()))
	const close = lines.findIndex((l, i) => i > open && l.trim().startsWith('`'))
	assert.ok(open >= 0, 'did not find the stylesheet template — this is not reading the file')
	assert.ok(close > open, 'did not find the end of the stylesheet template')
	assert.ok(close - open > 100, `the template is only ${close - open} lines, which cannot be the stylesheet`)
	const offenders = lines.slice(open + 1, close)
		.map((line, i) => [open + 2 + i, line.trim()])
		.filter(([, line]) => line.includes('`'))
	assert.deepEqual(offenders.map(([n]) => n), [],
		`backtick inside the stylesheet: ${offenders.map(([n, l]) => `line ${n}: ${l}`).join(' | ')}`)
})

test('every lib module actually parses', () => {
	// The stylesheet broke and the failure surfaced as one test file refusing to
	// load, several imports away from the file at fault. Importing each module
	// on its own names the file that is broken.
	const libs = readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js'))
	assert.ok(libs.length >= 10, `only found ${libs.length} lib modules`)
	return Promise.all(libs.map((f) => import(`../lib/${f}`).catch((e) => {
		assert.fail(`lib/${f} does not parse: ${e.message}`)
	})))
})
