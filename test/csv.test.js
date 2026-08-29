import test from 'node:test'
import assert from 'node:assert/strict'
import { isSkippable, parseCsv, splitCsvLine } from '../lib/csv.js'

// Built from code points rather than written out. Three separate attempts to
// write these files through a shell heredoc collapsed a backslash-n into a real
// newline inside a string literal, which is a syntax error if you are lucky and
// a silently different string if you are not.
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13, 10)

// The CSV reading the whole pipeline rests on.
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

test('blank lines and # comments carry no data', () => {
	// Comments exist for the curated tier. A generated table keeps its warnings
	// in the generator; a hand-edited one cannot, because the warning has to be
	// in front of the person editing it.
	assert.equal(isSkippable('# a note'), true)
	assert.equal(isSkippable('   # indented'), true)
	assert.equal(isSkippable(''), true)
	assert.equal(isSkippable('   '), true)
	assert.equal(isSkippable('GB,NFC,North'), false)
	// Not a comment: a # anywhere but the start.
	assert.equal(isSkippable('GB,NFC,North # no'), false)
})

test('a commented file parses to its data rows only', () => {
	const rows = parseCsv([
		'# THIS IS A SNAPSHOT, NOT A HISTORY.',
		'#',
		'code,conference,division',
		'GB,NFC,North',
		'',
		'CHI,NFC,North',
	].join(LF))
	assert.deepEqual(rows, [
		{ code: 'GB', conference: 'NFC', division: 'North' },
		{ code: 'CHI', conference: 'NFC', division: 'North' },
	])
})

test('a comment cannot become the header', () => {
	// The failure this prevents: the first line is taken as the header, so a
	// leading comment would name every column after itself and every row would
	// come back keyed by prose. Nothing throws; the data is just gone.
	const [row] = parseCsv(['# note', 'code,conference', 'GB,NFC'].join(LF))
	assert.equal(row.code, 'GB')
	assert.equal(Object.keys(row).length, 2)
})

test('a trailing carriage return is not part of the last field', () => {
	// The reference files are hand-edited on Windows.
	const [row] = parseCsv(['code,division', 'GB,North', ''].join(CRLF))
	assert.equal(row.division, 'North')
})
