import test from 'node:test'
import assert from 'node:assert/strict'
import { codeTable, codeTables, franchisesForClub, staleFranchises } from '../lib/codes.js'
import { loadDivisions, parseScope, resolveScope } from '../lib/scope.js'
import { loadTeams } from '../lib/teams.js'

// Translating a source code to the franchise it names. Three sources spell the
// same clubs three ways, and nothing downstream should have to know that.

const NFL = codeTable('nfl')
const TEAMS = await loadTeams()

// --- the table ---

test('an nflverse alias resolves to the franchise it names', () => {
	// These three are the whole reason this file exists: `nfl-divisions.csv`
	// names them one way and the franchise history names them another.
	assert.equal(NFL.franchiseOf('LV'), 'OAK')
	assert.equal(NFL.franchiseOf('WAS'), 'WSH')
	assert.equal(NFL.franchiseOf('LA'), 'LAR')
	// And a relocation alias, which is the same problem a decade earlier.
	assert.equal(NFL.franchiseOf('STL'), 'LAR')
})

test('a canonical code resolves to itself', () => {
	assert.equal(NFL.franchiseOf('OAK'), 'OAK')
	assert.equal(NFL.franchiseOf('GB'), 'GB')
})

test('an unknown code resolves to itself rather than throwing', () => {
	// A gap reports, per CLAUDE.md; the club surfaces as unavailable and its own
	// route explains what is missing. Throwing here would take the site down for
	// one bad row in a division table.
	assert.equal(NFL.franchiseOf('ZZZ'), 'ZZZ')
	assert.equal(NFL.knows('ZZZ'), false)
})

test('a franchise lists every code it has used, canonical first', () => {
	const rams = NFL.codesOf('LAR')
	assert.equal(rams[0], 'LAR')
	assert.ok(rams.includes('LA'), `LA missing from ${rams.join(', ')}`)
	assert.ok(rams.includes('STL'), `STL missing from ${rams.join(', ')}`)
	// Asking by an alias gives the same answer as asking by the franchise.
	assert.deepEqual(NFL.codesOf('STL'), rams)
})


test('a sport with no history table degrades to identity', () => {
	// Adding nhl to a divisions file before its history arrives must not break
	// boot; it should behave exactly as this repo did before code tables existed.
	const t = codeTables(['nhl'], () => { throw new Error('no such file') })
	assert.equal(t.franchiseOf('nhl', 'BOS'), 'BOS')
	assert.equal(t.table('nhl'), null)
})

test('both sports build a real table, not an empty one', () => {
	// This is the test that was missing. The first version of codes.js read the
	// football columns only, so `mlb` skipped every row and produced an empty
	// table — and an empty table resolves every code to itself, which is exactly
	// what this repo did before, so nothing broke and nothing said so.
	const both = codeTables(['nfl', 'mlb'])
	// Floors, not counts, because the tables are curated data that grows. The
	// numbers differ by an order of magnitude between the sports — football
	// carries 119 franchises including the 1920s one-season clubs, baseball 30 —
	// so one threshold for both would have to be low enough to pass on an empty
	// football table.
	for (const [sport, codes, franchises] of [['nfl', 100, 100], ['mlb', 40, 25]]) {
		const t = both.table(sport)
		assert.ok(t, `${sport} has no table`)
		assert.ok(t.size > codes, `${sport} table has only ${t.size} codes`)
		assert.ok(t.franchises().length > franchises, `${sport} has only ${t.franchises().length} franchises`)
	}
	// Retrosheet's Seattle Pilots are the Brewers, and the 1901 Milwaukee
	// Brewers are today's Orioles — a franchise, not a name, is the identity.
	assert.equal(both.franchiseOf('mlb', 'SE1'), 'MIL')
	assert.equal(both.franchiseOf('mlb', 'MLA'), 'BAL')
})

test('codes do not leak between sports', () => {
	const both = codeTables(['nfl', 'mlb'])
	// SE1 is the Brewers in baseball and means nothing in football, where the
	// answer must be "I do not know this code" rather than a club.
	assert.equal(both.franchiseOf('mlb', 'SE1'), 'MIL')
	assert.equal(both.franchiseOf('nfl', 'SE1'), 'SE1')
	assert.equal(both.table('nfl').knows('SE1'), false)
	assert.equal(both.table('mlb').knows('GB'), false)
})

test('a history table with no recognisable code column is a configuration error', () => {
	// Config errors die and data gaps report. A file that exists and cannot be
	// read is the first kind: no build fixes it, and degrading to identity is
	// how the empty MLB table stayed invisible.
	assert.throws(
		() => codeTables(['nhl'], () => [{ club: 'Bruins', firstYear: '1924' }]),
		/no \*Abbrv code column/)
})

// --- what it fixes ---

test('a club whose manifest lists only its canonical code stays in its division', () => {
	// The regression this exists to prevent. `nfl-divisions.csv` says LV; the
	// Raiders' canonical code is OAK. Before code tables the two matched only
	// because teams/raiders.js listed both, so deleting the alias — a tidy-up
	// that looks harmless — removed the Raiders from the AFC West with no error
	// and no failing test.
	const canonicalOnly = TEAMS.map((t) => (t.id === 'raiders' ? { ...t, sourceIds: ['OAK'] } : t))
	const west = resolveScope(parseScope('division:nfl/afc-west'), {
		divisionsBySport: { nfl: loadDivisions('nfl') },
		teams: canonicalOnly,
		built: new Set(canonicalOnly.map((t) => t.id)),
	})
	const raiders = west.find((e) => e.teamId === 'raiders')
	assert.ok(raiders, `Raiders missing from ${west.map((e) => e.teamId).join(', ')}`)
	assert.equal(raiders.available, true)
})

test('a club whose manifest lists only an alias resolves too', () => {
	// The mirror of the test above, and the one a mutation run said was missing:
	// canonicalising only the division side survived deleting the manifest side
	// entirely. Both directions matter, because somebody writing a new manifest
	// from nflverse data would naturally write LV and never think about OAK.
	const aliasOnly = TEAMS.map((t) => (t.id === 'raiders' ? { ...t, sourceIds: ['LV'] } : t))
	const west = resolveScope(parseScope('division:nfl/afc-west'), {
		divisionsBySport: { nfl: loadDivisions('nfl') },
		teams: aliasOnly,
		built: new Set(aliasOnly.map((t) => t.id)),
	})
	assert.ok(west.find((e) => e.teamId === 'raiders'),
		`Raiders missing from ${west.map((e) => e.teamId).join(', ')}`)
})

test('all three alias clubs resolve, not just the one that was checked', () => {
	// Checking only the Raiders is how the other two would have been missed.
	const divisionsBySport = { nfl: loadDivisions('nfl') }
	const built = new Set(TEAMS.map((t) => t.id))
	for (const [id, canonical, scope] of [
		['raiders', 'OAK', 'division:nfl/afc-west'],
		['commanders', 'WSH', 'division:nfl/nfc-east'],
		['rams', 'LAR', 'division:nfl/nfc-west'],
	]) {
		const teams = TEAMS.map((t) => (t.id === id ? { ...t, sourceIds: [canonical] } : t))
		const got = resolveScope(parseScope(scope), { divisionsBySport, teams, built })
		assert.ok(got.find((e) => e.teamId === id), `${id} missing from ${scope}`)
	}
})

// --- the deploy that rolled back ---

test('a club listing a code and its alias is one franchise, not two', () => {
	// The exact boot failure: "raiders: codes OAK,LV map to 2 franchises: LV,
	// OAK". The server asked the DATABASE, whose copy of the reference table was
	// written by an older load and still mapped LV to LV. One club's stale row
	// called die() and took all thirty-two down, and redeploying could not fix
	// it because the wrong data was in the database, not the image.
	const raiders = TEAMS.find((t) => t.id === 'raiders')
	assert.deepEqual(franchisesForClub(raiders, codeTables(['nfl']).franchiseOf), ['OAK'])
})

test('every committed club resolves to exactly one franchise', () => {
	// Checking only the Raiders is how the next one gets missed.
	const franchiseOf = codeTables(['nfl', 'mlb']).franchiseOf
	const broken = TEAMS
		.map((t) => [t.id, franchisesForClub(t, franchiseOf)])
		.filter(([, fs]) => fs.length !== 1)
	assert.deepEqual(broken, [])
})

test('a club whose codes really are two franchises is still caught', () => {
	// The check had a real job and keeps it. What changed is which source
	// answers, and that this now means the reference table contradicts itself
	// rather than the database being out of date.
	const franchiseOf = codeTables(['nfl']).franchiseOf
	const wrong = { id: 'x', sport: 'nfl', sourceIds: ['GB', 'CHI'] }
	assert.deepEqual(franchisesForClub(wrong, franchiseOf).sort(), ['CHI', 'GB'])
})

test('games under a code that has become an alias are reported stale', () => {
	// A database loaded before LV became an alias stores the Raiders' 2020-on
	// seasons under LV and everything earlier under OAK. Serving that club would
	// quietly drop six seasons.
	const franchiseOf = codeTables(['nfl']).franchiseOf
	const got = staleFranchises(['nfl/GB', 'nfl/OAK', 'nfl/LV', 'nfl/WAS'], franchiseOf)
	assert.deepEqual(got, [
		{ sport: 'nfl', franchise: 'LV', canonical: 'OAK' },
		{ sport: 'nfl', franchise: 'WAS', canonical: 'WSH' },
	])
})

test('a database that agrees with the reference table is not stale', () => {
	// Without this the function could return everything and still pass above.
	const franchiseOf = codeTables(['nfl', 'mlb']).franchiseOf
	assert.deepEqual(staleFranchises(['nfl/GB', 'nfl/OAK', 'mlb/MIL'], franchiseOf), [])
})

test('an unknown franchise is not called stale', () => {
	// An unknown code resolves to itself, so it must not look like an alias.
	// Otherwise a sport with no history table would report every club stale and
	// mark the whole deployment unavailable.
	const franchiseOf = codeTables(['nhl'], () => { throw new Error('none') }).franchiseOf
	assert.deepEqual(staleFranchises(['nhl/BOS', 'nhl/MTL'], franchiseOf), [])
})

test('an entire league resolves to one club per division row', () => {
	// The count is the check: 32 rows in, 32 clubs out, none dropped and none
	// deduplicated away. A club matched by no manifest would still appear here
	// with a null teamId, so this asserts identification rather than presence.
	const league = resolveScope(parseScope('sport:nfl'), {
		divisionsBySport: { nfl: loadDivisions('nfl') },
		teams: TEAMS,
	})
	assert.equal(league.length, 32)
	const unidentified = league.filter((e) => !e.teamId)
	assert.deepEqual(unidentified, [], `no manifest matched: ${unidentified.map((e) => e.code).join(', ')}`)
})
