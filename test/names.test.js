import test from 'node:test'
import assert from 'node:assert/strict'
import { loadNames, mlbIndex, nflIndex, resolver, spanFor } from '../lib/names.js'
import { isoDate, collapseNames } from '../scripts/names.mjs'
import { loadIndex } from '../lib/indices.js'
import { loadDivisions } from '../lib/scope.js'

// Codes to display names. The two sports resolve differently on purpose,
// because only one of them has a source that publishes eras.

// --- the generator ---

test('Retrosheet dates become ISO', () => {
	assert.equal(isoDate('4/8/1969'), '1969-04-08')
	assert.equal(isoDate('10/2/1969'), '1969-10-02')
	assert.equal(isoDate('12/31/2024'), '2024-12-31')
})

test('a missing end date stays empty, meaning current', () => {
	// Not today's date, and not a far-future sentinel. Empty is the only value
	// that does not go stale.
	assert.equal(isoDate(''), '')
	assert.equal(isoDate(undefined), '')
})

test('a date that is not a date yields empty rather than nonsense', () => {
	assert.equal(isoDate('not a date'), '')
	assert.equal(isoDate('1969-04-08'), '')
})

test('rows differing only by division collapse into one name span', () => {
	// The Brewers appear four times in Retrosheet under one name, because they
	// changed division three times and league once. A name table should say
	// "Milwaukee Brewers, 1970 to now" and not repeat itself four times.
	const out = collapseNames([
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1970-04-07', to: '1971-09-30' },
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1972-04-15', to: '1993-10-03' },
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1998-03-31', to: '' },
	])
	assert.equal(out.length, 1)
	assert.equal(out[0].name, 'Milwaukee Brewers')
	assert.equal(out[0].from, '1970-04-07')
	// An open-ended end wins: the club still exists.
	assert.equal(out[0].to, '')
})

test('a rename under one code is not collapsed away', () => {
	// The case the name comparison exists for. SE1 to MIL below also changes
	// code, so a collapse keyed on code alone still separates those two — the
	// Angels are the real test, because ANA covers both Anaheim and Los Angeles.
	const out = collapseNames([
		{ current: 'ANA', code: 'ANA', city: 'Anaheim', nickname: 'Angels', from: '1997-04-02', to: '2004-10-03' },
		{ current: 'ANA', code: 'ANA', city: 'Los Angeles', nickname: 'Angels', from: '2005-04-05', to: '' },
	])
	assert.equal(out.length, 2)
	assert.deepEqual(out.map((o) => o.name), ['Anaheim Angels', 'Los Angeles Angels'])
})

test('a genuine rename is not collapsed away', () => {
	const out = collapseNames([
		{ current: 'MIL', code: 'SE1', city: 'Seattle', nickname: 'Pilots', from: '1969-04-08', to: '1969-10-02' },
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1970-04-07', to: '' },
	])
	assert.equal(out.length, 2)
	assert.deepEqual(out.map((o) => o.name), ['Seattle Pilots', 'Milwaukee Brewers'])
})

// --- spans ---

const SPANS = [
	{ name: 'Los Angeles Angels', from: '2005-04-05', to: '' },
	{ name: 'Anaheim Angels', from: '1997-04-02', to: '2004-10-03' },
	{ name: 'California Angels', from: '1965-09-02', to: '1996-09-29' },
]

test('an open end survives a later row that closes earlier', () => {
	// Retrosheet's file is ordered, so in practice the open-ended row is last
	// and a naive `last.to = r.to` gets the same answer — which is why the
	// mutant deleting the guard survived. The guard is against unordered input,
	// and a name table that silently ended a franchise early would be a bad way
	// to find out the assumption broke.
	const out = collapseNames([
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1998-03-31', to: '' },
		{ current: 'MIL', code: 'MIL', city: 'Milwaukee', nickname: 'Brewers', from: '1970-04-07', to: '1997-09-28' },
	])
	assert.equal(out.length, 1)
	assert.equal(out[0].to, '', 'a closed span overwrote an open one')
})

test('a date picks the name that was in use', () => {
	assert.equal(spanFor(SPANS, '1975-06-01').name, 'California Angels')
	assert.equal(spanFor(SPANS, '2000-06-01').name, 'Anaheim Angels')
	assert.equal(spanFor(SPANS, '2024-06-01').name, 'Los Angeles Angels')
})

test('the boundaries belong to the span they close', () => {
	assert.equal(spanFor(SPANS, '1996-09-29').name, 'California Angels')
	assert.equal(spanFor(SPANS, '1997-04-02').name, 'Anaheim Angels')
})

test('no date means the current name', () => {
	assert.equal(spanFor(SPANS, undefined).name, 'Los Angeles Angels')
	assert.equal(spanFor(SPANS, '').name, 'Los Angeles Angels')
})

test('an open-ended span covers anything after it starts', () => {
	assert.equal(spanFor(SPANS, '2099-01-01').name, 'Los Angeles Angels')
})

test('a date before the code existed falls back to its oldest name', () => {
	// Rather than returning nothing. In practice this cannot arise from real
	// rows — Retrosheet game data uses the code that was current at the time,
	// so a 1975 Angels game says CAL and never ANA — but a lookup that returns
	// null here would put an empty label on a page.
	assert.equal(spanFor(SPANS, '1900-01-01').name, 'California Angels')
})

// --- indexing ---

test('a current row beats an alias for the same code, in either order', () => {
	// Both orders, because the first version of this test put `current` last —
	// where it wins whether or not the guard exists, so the mutant that deleted
	// the guard survived.
	const current = { code: 'LAC', name: 'Los Angeles Chargers', kind: 'current' }
	const alias = { code: 'LAC', name: 'Wrong Chargers', kind: 'alias' }
	assert.equal(nflIndex([alias, current]).get('LAC'), 'Los Angeles Chargers')
	assert.equal(nflIndex([current, alias]).get('LAC'), 'Los Angeles Chargers')
})

test('a nameless row is skipped rather than blanking a code', () => {
	assert.equal(nflIndex([{ code: 'AKR', name: '', kind: 'current' }]).get('AKR'), undefined)
	assert.equal(mlbIndex([{ code: 'X', name: '', from: '', to: '' }]).get('X'), undefined)
})

test('baseball spans come back newest first', () => {
	const idx = mlbIndex([
		{ code: 'ANA', name: 'Anaheim Angels', from: '1997-04-02', to: '2004-10-03' },
		{ code: 'ANA', name: 'Los Angeles Angels', from: '2005-04-05', to: '' },
	])
	assert.equal(idx.get('ANA')[0].name, 'Los Angeles Angels')
})

// --- the resolvers, against the committed tables ---

test('the five codes the derived table missed all resolve', () => {
	// SD, WAS, STL, LA and LV are the nflverse-era codes for clubs the
	// FiveThirtyEight-derived table names under LAC, WSH, LAR and OAK. One
	// club's games contain both sets, because the two eras come from different
	// files, and without the alias rows these five resolve to nothing.
	const nfl = resolver('nfl')
	assert.equal(nfl('SD').name, 'Los Angeles Chargers')
	assert.equal(nfl('STL').name, 'Los Angeles Rams')
	assert.equal(nfl('LA').name, 'Los Angeles Rams')
	assert.equal(nfl('LV').name, 'Las Vegas Raiders')
	assert.equal(nfl('WAS').name, 'Washington Commanders')
})

test('football ignores dates, and says so rather than pretending', () => {
	// A 1995 Rams game was played in St. Louis. No source publishes football
	// eras, so this returns the current name and flags that it is not history.
	const nfl = resolver('nfl')
	assert.equal(nfl('STL', '1995-09-10').name, 'Los Angeles Rams')
	assert.equal(nfl('STL', '1995-09-10').isHistorical, false)
})

test('baseball honours dates, and says so', () => {
	const mlb = resolver('mlb')
	assert.equal(mlb('SE1', '1969-06-01').name, 'Seattle Pilots')
	assert.equal(mlb('SE1', '1969-06-01').isHistorical, true)
})

test('the same code in two sports is two different clubs', () => {
	// MIL is the Milwaukee Badgers in football and the Milwaukee Brewers in
	// baseball. Resolution is per sport for exactly this reason, and a single
	// shared table would have to pick one.
	assert.equal(resolver('nfl')('MIL').name, 'Milwaukee Badgers')
	assert.equal(resolver('mlb')('MIL').name, 'Milwaukee Brewers')
})

test('an unknown code returns the code, not an empty label', () => {
	// 62 football codes have no name yet. Showing "AKR" is honest; showing ""
	// looks like a rendering bug, and throwing would take down a page over a
	// label.
	for (const sport of ['nfl', 'mlb']) {
		const r = resolver(sport)('ZZZ')
		assert.equal(r.name, 'ZZZ', `${sport} blanked an unknown code`)
		assert.equal(r.known, false)
	}
})

test('the curated table names every current club exactly once', () => {
	const rows = loadNames('nfl').filter((r) => r.kind === 'current')
	assert.equal(rows.length, 32)
	assert.equal(new Set(rows.map((r) => r.code)).size, 32)
	assert.equal(new Set(rows.map((r) => r.name)).size, 32)
})

test('every club in the division tables has a name', () => {
	// The join the selector depends on: a code in the membership table with no
	// name renders as a bare code next to clubs that have one.
	//
	// The first version of this test read the *name* table and asserted those
	// codes resolve, which is a tautology — it could not fail. It has to load
	// the division tables, which are the other side of the join.
	for (const [sport, size] of [['nfl', 32], ['mlb', 30]]) {
		const resolve = resolver(sport)
		const codes = loadDivisions(sport).map((r) => r.code)
		assert.equal(codes.length, size, `${sport} division table has ${codes.length} clubs`)
		for (const code of codes) assert.ok(resolve(code).known, `${sport} ${code} has no name`)
	}
})

test('every opponent either club has ever played resolves to a name', () => {
	// The measurement that matters, against the real data rather than the
	// tables agreeing with themselves. Before the derived table was added as a
	// fallback this was 36 of 66 for the Packers.
	for (const [id, sport] of [['packers', 'nfl'], ['brewers', 'mlb']]) {
		const resolve = resolver(sport)
		const codes = [...new Set(loadIndex(id, 'games').entries.map((g) => g.Opponent).filter(Boolean))]
		const unnamed = codes.filter((c) => !resolve(c).known)
		assert.deepEqual(unnamed, [], `${id} has unnamed opponents: ${unnamed.join(' ')}`)
		assert.ok(codes.length > 30, `${id} only had ${codes.length} opponents — is the index loaded?`)
	}
})
