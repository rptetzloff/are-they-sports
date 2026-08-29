import test from 'node:test'
import assert from 'node:assert/strict'
import { renderNdjson } from '../scripts/build.mjs'

// Artifact serialisation.

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
