import test from 'node:test'
import assert from 'node:assert/strict'
import { collapse, unnamedCodes } from '../scripts/franchises.mjs'

// The franchise table's one piece of judgement, tested without the 1.2MB of CSV
// it normally runs over.
//
// What this cannot test is whether the dates mean anything. They do not: they
// are the first and last game on which the corpus applied a label, which is a
// fact about the corpus and not about history. The generator's header says so
// at length. These tests pin what collapse does, not that the answer is true.

test('repeated observations of one pairing become one row', () => {
	assert.deepEqual(collapse([
		{ code: 'CHI', name: 'Chicago Bears', date: '1930-01-01' },
		{ code: 'CHI', name: 'Chicago Bears', date: '1995-01-01' },
	]), [{ code: 'CHI', name: 'Chicago Bears', first: '1930-01-01', last: '1995-01-01' }])
})

test('the bounds widen in both directions, whatever order rows arrive in', () => {
	// The seed file is not sorted by the pairing, so a first-wins or last-wins
	// implementation gets a range that happens to be right on sorted input.
	const [row] = collapse([
		{ code: 'CHI', name: 'Chicago Bears', date: '1960-01-01' },
		{ code: 'CHI', name: 'Chicago Bears', date: '1930-01-01' },
		{ code: 'CHI', name: 'Chicago Bears', date: '1995-01-01' },
		{ code: 'CHI', name: 'Chicago Bears', date: '1971-01-01' },
	])
	assert.equal(row.first, '1930-01-01')
	assert.equal(row.last, '1995-01-01')
})

test('one code under two names stays two rows', () => {
	// This is the whole reason the table is keyed by code AND date. LAC and LAR
	// each appear twice because some rows were labelled historically and others
	// were not; collapsing to one name per code would relabel every St. Louis
	// Rams game as Los Angeles.
	const rows = collapse([
		{ code: 'LAR', name: 'St. Louis Rams', date: '1995-09-10' },
		{ code: 'LAR', name: 'Los Angeles Rams', date: '2016-09-11' },
	])
	assert.equal(rows.length, 2)
	assert.deepEqual(rows.map((r) => r.name).sort(), ['Los Angeles Rams', 'St. Louis Rams'])
})

test('an observation with no name is dropped, not stored blank', () => {
	// A blank name would become a row claiming a code is named "", which reads
	// as resolved. Unresolved codes are emitted separately and marked as such.
	assert.deepEqual(collapse([
		{ code: 'AKR', name: '', date: '1920-10-03' },
		{ code: '', name: 'Nobody', date: '1920-10-03' },
	]), [])
})

test('rows come out sorted by code, then by first date', () => {
	// The file is committed and read by humans, so a stable order means a diff
	// shows what changed rather than a reshuffle.
	const rows = collapse([
		{ code: 'GB', name: 'Green Bay Packers', date: '1921-01-01' },
		{ code: 'CHI', name: 'Chicago Bears', date: '1990-01-01' },
		{ code: 'CHI', name: 'Chicago Staleys', date: '1921-01-01' },
	])
	assert.deepEqual(rows.map((r) => `${r.code} ${r.first}`),
		['CHI 1921-01-01', 'CHI 1990-01-01', 'GB 1921-01-01'])
})

test('a code with no name is reported, not omitted', () => {
	// 62 of 123 codes are unresolved. Emitting them as rows is what makes the
	// gap visible in the file rather than implied by an absence.
	assert.deepEqual(
		unnamedCodes(['GB', 'CHI', 'AKR'], [{ code: 'GB' }, { code: 'CHI' }]),
		['AKR'])
})

test('unresolved codes come out sorted and deduplicated by what is named', () => {
	assert.deepEqual(unnamedCodes(['RAC', 'AKR', 'MUN'], []), ['AKR', 'MUN', 'RAC'])
})

test('a code named under two labels counts as named once', () => {
	assert.deepEqual(unnamedCodes(['LAR'], [{ code: 'LAR' }, { code: 'LAR' }]), [])
})
