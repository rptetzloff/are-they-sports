import test from 'node:test'
import assert from 'node:assert/strict'
import {
	byFranchise, colorsFor, displayName, isoDate, loadHistory, mlbIndex, nflIndex, resolver, spanForDate, spanForSeason,
} from '../lib/names.js'
import { loadIndex } from '../lib/indices.js'
import { loadDivisions } from '../lib/scope.js'

// Codes to display names. Both sports resolve by era now — football's history
// table is the source that did not exist until it did.

// --- the baseball generator ---

test('Retrosheet dates become ISO', () => {
	assert.equal(isoDate('4/8/1969'), '1969-04-08')
	assert.equal(isoDate('10/2/1969'), '1969-10-02')
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

// --- spans ---

const SPANS = [
	{ name: 'Los Angeles Angels', from: '2005-04-05', to: '' },
	{ name: 'Anaheim Angels', from: '1997-04-02', to: '2004-10-03' },
	{ name: 'California Angels', from: '1965-09-02', to: '1996-09-29' },
]

test('a date picks the name that was in use', () => {
	assert.equal(spanForDate(SPANS, '1975-06-01').name, 'California Angels')
	assert.equal(spanForDate(SPANS, '2000-06-01').name, 'Anaheim Angels')
	assert.equal(spanForDate(SPANS, '2024-06-01').name, 'Los Angeles Angels')
})

test('the boundaries belong to the span they close', () => {
	assert.equal(spanForDate(SPANS, '1996-09-29').name, 'California Angels')
	assert.equal(spanForDate(SPANS, '1997-04-02').name, 'Anaheim Angels')
})

test('no date means the current name', () => {
	assert.equal(spanForDate(SPANS, undefined).name, 'Los Angeles Angels')
	assert.equal(spanForDate(SPANS, '').name, 'Los Angeles Angels')
})

test('an open-ended span covers anything after it starts', () => {
	assert.equal(spanForDate(SPANS, '2099-01-01').name, 'Los Angeles Angels')
})

const SEASONS = [
	{ name: 'Chicago Bears', from: 1922, to: 2026 },
	{ name: 'Chicago Staleys', from: 1921, to: 1921 },
	{ name: 'Decatur Staleys', from: 1919, to: 1920 },
]

test('a season picks the identity that was in use', () => {
	// Football's history is keyed on seasons, not dates. An NFL season crosses
	// the new year — a January 2011 game belongs to 2010 — so one cannot be
	// derived from the other.
	assert.equal(spanForSeason(SEASONS, '1919').name, 'Decatur Staleys')
	assert.equal(spanForSeason(SEASONS, '1921').name, 'Chicago Staleys')
	assert.equal(spanForSeason(SEASONS, '2024').name, 'Chicago Bears')
})

test('season bounds are inclusive at both ends', () => {
	assert.equal(spanForSeason(SEASONS, '1920').name, 'Decatur Staleys')
	assert.equal(spanForSeason(SEASONS, '1922').name, 'Chicago Bears')
})

test('no season means the current identity', () => {
	assert.equal(spanForSeason(SEASONS, undefined).name, 'Chicago Bears')
})

test('a season outside every span falls back rather than blanking', () => {
	assert.equal(spanForSeason(SEASONS, '1850').name, 'Decatur Staleys')
	assert.equal(spanForSeason(SEASONS, '2099').name, 'Chicago Bears')
})

// --- indexing ---

test('a nameless row is skipped rather than blanking a code', () => {
	assert.equal(nflIndex([{ teamAbbrv: 'AKR', city: '', teamName: '' }]).get('AKR'), undefined)
	// Under the old column names this row had no `teamAbbrv` at all, so it was
	// skipped for the wrong reason and the assertion held vacuously.
	assert.equal(mlbIndex([{ teamAbbrv: 'X', city: '', teamName: '' }]).get('X'), undefined)
})

test('both sports name their columns the same way', () => {
	// This used to assert the opposite, and was titled "the baseball columns are
	// not what their names suggest": `teamName` was the CODE and `team` was the
	// nickname. Taking them at face value gave a franchise called "MIL" playing
	// a club called "Brewers", and reading them at face value is exactly what
	// lib/codes.js did — building an empty MLB table with no error.
	//
	// So the file was renamed to football's convention rather than the trap
	// being documented forever. `franchiseAbbrv` joins eras, `teamAbbrv` names
	// one, `teamName` is the nickname. One rule now reads both sports.
	const idx = mlbIndex([{
		franchiseAbbrv: 'MIL', teamAbbrv: 'SE1', city: 'Seattle', teamName: 'Pilots',
		startDate: '4/8/1969', endDate: '10/2/1969', league: 'AL', colorA: '#0033A0',
	}])
	const [span] = idx.get('SE1')
	assert.equal(span.name, 'Seattle Pilots')
	assert.equal(span.franchise, 'MIL')
	assert.equal(span.from, '1969-04-08')
})

test('a display name is city and nickname, and survives a missing city', () => {
	// Some 1920s rows carry a nickname and no city, and one carries a trailing
	// space in the city — "Rock Island " — which must not double up.
	assert.equal(displayName({ city: 'Chicago', teamName: 'Staleys' }), 'Chicago Staleys')
	assert.equal(displayName({ city: '', teamName: 'All-Buffalo' }), 'All-Buffalo')
	assert.equal(displayName({ city: 'Rock Island ', teamName: 'Independents' }), 'Rock Island Independents')
})

test('spans come back newest first, so a lookup with no era gets the present', () => {
	const idx = nflIndex([
		{ teamAbbrv: 'CHI', franchiseAbbrv: 'CHI', city: 'Decatur', teamName: 'Staleys', startSeason: '1920', endSeason: '1920' },
		{ teamAbbrv: 'CHI', franchiseAbbrv: 'CHI', city: 'Chicago', teamName: 'Bears', startSeason: '1922', endSeason: '2026' },
	])
	assert.equal(idx.get('CHI')[0].name, 'Chicago Bears')
})

// --- the resolvers, against the committed tables ---

test('football resolves by era now, which it could not before', () => {
	// This file used to say football could not do this. That was true of the
	// data available then, not of football.
	const nfl = resolver('nfl')
	assert.equal(nfl('CHI', { season: '1921' }).name, 'Chicago Staleys')
	assert.equal(nfl('CHI', { season: '2024' }).name, 'Chicago Bears')
	assert.equal(nfl('DET', { season: '1930' }).name, 'Portsmouth Spartans')
	assert.equal(nfl('DET', { season: '1935' }).name, 'Detroit Lions')
	// A 1995 Rams game was played in St. Louis, and now says so.
	assert.equal(nfl('LAR', { season: '1995' }).name, 'St. Louis Rams')
	assert.equal(nfl('LAR', { season: '2024' }).name, 'Los Angeles Rams')
	assert.equal(nfl('ARI', { season: '1925' }).name, 'Chicago Cardinals')
	assert.equal(nfl('ARI', { season: '1970' }).name, 'St. Louis Cardinals')
	assert.equal(nfl('WSH', { season: '2020' }).name, 'Washington Football Team')
})

test('the nflverse codes and the seed codes are one franchise each', () => {
	// The two football sources disagree: FiveThirtyEight writes LAC, LAR, OAK,
	// WSH where nflverse writes SD, STL, LA, LV, WAS, and one club's games
	// contain both because the eras come from different files.
	const nfl = resolver('nfl')
	for (const [a, b] of [['SD', 'LAC'], ['STL', 'LAR'], ['LA', 'LAR'], ['LV', 'OAK'], ['WAS', 'WSH']]) {
		assert.equal(nfl(a, { season: '2024' }).franchise, nfl(b, { season: '2024' }).franchise, `${a} and ${b}`)
	}
})

test('baseball honours dates, and says so', () => {
	const mlb = resolver('mlb')
	assert.equal(mlb('SE1', { date: '1969-06-01' }).name, 'Seattle Pilots')
	assert.equal(mlb('SE1', { date: '1969-06-01' }).isHistorical, true)
})

test('the same code in two sports is two different clubs', () => {
	// MIL is the Milwaukee Badgers in football and the Brewers in baseball.
	assert.equal(resolver('nfl')('MIL', { season: '1923' }).name, 'Milwaukee Badgers')
	assert.equal(resolver('mlb')('MIL', { date: '1982-10-12' }).name, 'Milwaukee Brewers')
})

test('an unknown code returns the code, not an empty label', () => {
	// Showing a code is honest; showing "" looks like a rendering bug and
	// throwing would take down a page over a label.
	for (const sport of ['nfl', 'mlb']) {
		const r = resolver(sport)('ZZZ')
		assert.equal(r.name, 'ZZZ', `${sport} blanked an unknown code`)
		assert.equal(r.known, false)
	}
})

test('the history table is whole', () => {
	const rows = loadHistory('nfl')
	assert.ok(rows.length > 200, `only ${rows.length} rows`)
	for (const r of rows) {
		assert.ok(Number(r.startSeason) > 1800, `${r.teamAbbrv} has no start season`)
		assert.ok(Number(r.endSeason) >= Number(r.startSeason), `${r.teamAbbrv} ends before it starts`)
	}
})

test('every club in the division tables has a name', () => {
	// The join the selector depends on. The first version of this test read the
	// name table and asserted those codes resolve, which is a tautology.
	for (const [sport, size] of [['nfl', 32], ['mlb', 30]]) {
		const resolve = resolver(sport)
		const codes = loadDivisions(sport).map((r) => r.code)
		assert.equal(codes.length, size, `${sport} division table has ${codes.length} clubs`)
		for (const code of codes) assert.ok(resolve(code).known, `${sport} ${code} has no name`)
	}
})

test('every opponent either club has ever played resolves to a name', () => {
	// Against the real indices rather than the tables agreeing with themselves.
	for (const [id, sport] of [['packers', 'nfl'], ['brewers', 'mlb']]) {
		const resolve = resolver(sport)
		const codes = [...new Set(loadIndex(id, 'games').entries.map((g) => g.Opponent).filter(Boolean))]
		const unnamed = codes.filter((c) => !resolve(c).known)
		assert.deepEqual(unnamed, [], `${id} has unnamed opponents: ${unnamed.join(' ')}`)
		assert.ok(codes.length > 30, `${id} only had ${codes.length} opponents — is the index loaded?`)
	}
})

test('a franchise resolves through the codes it used to play under', () => {
	// The database stores canonical franchises, not the code a game was recorded
	// under. Asking for ANA in 1969 finds only the Angels' own spans, which
	// start in 1997, and falls back to "Anaheim Angels" for a season they played
	// as the California Angels under the code CAL.
	//
	// A franchise's identity over time is the union of its codes' spans.
	const mlb = resolver('mlb')
	assert.equal(mlb('ANA', { date: '1969-06-01' }).name, 'California Angels')
	assert.equal(mlb('ANA', { date: '2024-06-01' }).name, 'Los Angeles Angels')
	// And the Brewers' franchise covers their season as the Pilots.
	assert.equal(mlb('MIL', { date: '1969-06-01' }).name, 'Seattle Pilots')
	assert.equal(mlb('MIL', { date: '2025-06-01' }).name, 'Milwaukee Brewers')

	const nfl = resolver('nfl')
	assert.equal(nfl('DHR', { season: '1921' }).name, 'Detroit Tigers')
	assert.equal(nfl('DHR', { season: '1925' }).name, 'Detroit Panthers')
})

test('a franchise index is the union of its codes', () => {
	const idx = mlbIndex([
		{ franchiseAbbrv: 'MIL', teamAbbrv: 'SE1', city: 'Seattle', teamName: 'Pilots', startDate: '4/8/1969', endDate: '10/2/1969' },
		{ franchiseAbbrv: 'MIL', teamAbbrv: 'MIL', city: 'Milwaukee', teamName: 'Brewers', startDate: '4/7/1970', endDate: '' },
	])
	assert.equal(idx.get('SE1').length, 1)
	assert.equal(byFranchise(idx).get('MIL').length, 2)
})

test('baseball colours are era-correct now, which they could not be before', () => {
	// mlb-colors.csv was a stopgap with one row per franchise and no eras, so a
	// 1969 Pilots page rendered in Brewers navy. The history table replaced it.
	const mlb = resolver('mlb')
	const fb = { base: '#2a2a2a', accent: '#ffffff' }
	assert.equal(colorsFor(mlb, 'MIL', { date: '1969-06-01' }, fb).base, '#0033A0')
	assert.equal(colorsFor(mlb, 'MIL', { date: '2025-06-01' }, fb).base, '#12284B')
})
