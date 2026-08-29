import test from 'node:test'
import assert from 'node:assert/strict'
import { renderNdjson, splitCsvLine } from '../scripts/build.mjs'

// The parsing and serialisation the whole pipeline rests on.
//
// These need no sources. The only checks this repo had before were comparisons
// against the two live sites, which are strong but need 490MB of fetched data
// and two sibling checkouts — so they cannot run in CI and will not outlive
// those repos.

test('a plain row splits on commas', () => {
	assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c'])
})

test('commas inside quotes do not split the row', () => {
	// This is not hypothetical. nflverse play descriptions contain commas in
	// nearly every row: "(4:15) A.Rodgers pass short right to D.Adams to GB 42
	// for 8 yards (J.Smith, T.Jones)." A naive split misaligns every column
	// after `desc` — and the result parses fine and is wrong.
	assert.deepEqual(
		splitCsvLine('2024,"A.Rodgers pass to D.Adams, 8 yards",GB'),
		['2024', 'A.Rodgers pass to D.Adams, 8 yards', 'GB'],
	)
})

test('a doubled quote inside a quoted field is one quote', () => {
	assert.deepEqual(splitCsvLine('a,"he said ""hi""",b'), ['a', 'he said "hi"', 'b'])
})

test('empty fields survive, including at the ends', () => {
	// Unplayed games have empty scores, and the adapters test for exactly that.
	assert.deepEqual(splitCsvLine('a,,c'), ['a', '', 'c'])
	assert.deepEqual(splitCsvLine(',b,'), ['', 'b', ''])
})

test('a single field with no commas is still a row', () => {
	assert.deepEqual(splitCsvLine('solo'), ['solo'])
})

test('ndjson writes a header line and then one line per entry', () => {
	const buf = renderNdjson([{ a: 1 }, { a: 2 }])
	const lines = buf.toString().split('\n').filter(Boolean)
	assert.equal(lines.length, 3)
	assert.deepEqual(JSON.parse(lines[0]), { kind: 'map', size: 2 })
	assert.deepEqual(JSON.parse(lines[1]), { a: 1 })
})

test('the header carries the entry count, so a truncated file is detectable', () => {
	// A file cut off mid-write otherwise becomes an index that is quietly short.
	const lines = renderNdjson([1, 2, 3, 4]).toString().split('\n').filter(Boolean)
	assert.equal(JSON.parse(lines[0]).size, 4)
	assert.equal(lines.length - 1, 4)
})

test('an empty index is still a valid file', () => {
	// Football before 1999 has no play-by-play, so this is the ordinary case
	// rather than an error.
	const lines = renderNdjson([]).toString().split('\n').filter(Boolean)
	assert.equal(lines.length, 1)
	assert.equal(JSON.parse(lines[0]).size, 0)
})

test('extra metadata rides on the header, not the entries', () => {
	const lines = renderNdjson([{ a: 1 }], { sport: 'nfl' }).toString().split('\n').filter(Boolean)
	assert.equal(JSON.parse(lines[0]).sport, 'nfl')
	assert.deepEqual(JSON.parse(lines[1]), { a: 1 })
})

test('every line is independently parseable', () => {
	// The reason for this format: a reader parses one line at a time and the
	// transient is one entry. Reading a whole index as a string is what put the
	// baseball server past a 512MB cap.
	for (const line of renderNdjson([{ a: 1 }, { b: 2 }]).toString().split('\n').filter(Boolean)) {
		assert.doesNotThrow(() => JSON.parse(line))
	}
})
