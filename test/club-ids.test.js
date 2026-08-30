import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadTeams } from '../lib/teams.js'
import { loadDivisions, parseScope, resolveScope } from '../lib/scope.js'
import { codeTables } from '../lib/codes.js'

// A club id is unique WITHIN a sport and not across them. The Cardinals are an
// NFL club and a baseball club; so are the Giants. The sports still to come add
// Rangers, Kings, Panthers and Jets.
//
// Every failure this file covers was silent: a club vanished, or served under
// another club's name, with no error and every route answering 200.

const TEAMS = await loadTeams()
const DIVISIONS = { nfl: loadDivisions('nfl'), mlb: loadDivisions('mlb') }

test('two sports genuinely share club ids', () => {
	// The premise. If this stops being true the tests below still pass while
	// proving nothing, so it is asserted rather than assumed.
	const counts = new Map()
	for (const t of TEAMS) counts.set(t.id, (counts.get(t.id) ?? 0) + 1)
	const shared = [...counts].filter(([, n]) => n > 1).map(([id]) => id).sort()
	assert.deepEqual(shared, ['cardinals', 'giants'])
})

test('every club is unique on sport and id together', () => {
	const keys = TEAMS.map((t) => `${t.sport}/${t.id}`)
	assert.equal(new Set(keys).size, keys.length)
})

test('an all scope resolves every club, not one per shared id', () => {
	// Measured before the fix: 62 clubs loaded and 60 resolved. The dedupe that
	// stops one club appearing twice was keyed on the id alone, so the second
	// Cardinals and the second Giants were dropped — no error, nothing to see
	// but a count nobody was checking.
	const all = resolveScope(parseScope('all'), { divisionsBySport: DIVISIONS, teams: TEAMS })
	assert.equal(all.length, TEAMS.length)
	assert.equal(all.filter((e) => e.teamId).length, TEAMS.length)
	assert.equal(new Set(all.map((e) => `${e.sport}/${e.teamId}`)).size, TEAMS.length)
})

test('both clubs behind a shared id are resolved, in the right sport', () => {
	const all = resolveScope(parseScope('all'), { divisionsBySport: DIVISIONS, teams: TEAMS })
	for (const id of ['cardinals', 'giants']) {
		const hits = all.filter((e) => e.teamId === id)
		assert.equal(hits.length, 2, `${id} resolved ${hits.length} times`)
		assert.deepEqual(hits.map((h) => h.sport).sort(), ['mlb', 'nfl'])
	}
})

test('a club with two codes still appears once', () => {
	// The dedupe has a real job and keeps it. The Brewers are MIL and SE1.
	const all = resolveScope(parseScope('all'), { divisionsBySport: DIVISIONS, teams: TEAMS })
	assert.equal(all.filter((e) => e.teamId === 'brewers').length, 1)
})

// --- naming one club as the whole scope ---

const asTeam = (spec) => resolveScope(parseScope(spec), { divisionsBySport: {}, teams: TEAMS, built: new Set() })

test('an unqualified club id still works when only one sport has it', () => {
	// Every existing deployment is configured this way and must not break.
	assert.equal(asTeam('team:packers')[0].teamId, 'packers')
	assert.equal(asTeam('team:packers')[0].sport, 'nfl')
	assert.equal(asTeam('team:brewers')[0].sport, 'mlb')
})

test('a shared id must say which sport', () => {
	// A configuration error, not a data gap: no build or load fixes it, and
	// guessing would serve an entire deployment as the wrong club while
	// answering every route correctly.
	assert.throws(() => asTeam('team:cardinals'), /ambiguous/)
	assert.throws(() => asTeam('team:cardinals'), /team:mlb\/cardinals/)
	assert.throws(() => asTeam('team:cardinals'), /team:nfl\/cardinals/)
})

test('a qualified club id picks the right one', () => {
	assert.equal(asTeam('team:mlb/cardinals')[0].sport, 'mlb')
	assert.equal(asTeam('team:nfl/cardinals')[0].sport, 'nfl')
	assert.notEqual(asTeam('team:mlb/cardinals')[0].code, asTeam('team:nfl/cardinals')[0].code)
})

test('an unknown club names what is available, qualified', () => {
	assert.throws(() => asTeam('team:nope'), /no manifest/)
	assert.throws(() => asTeam('team:nope'), /mlb\/brewers/)
})

test('a qualified id in the wrong sport is unknown, not a near miss', () => {
	assert.throws(() => asTeam('team:mlb/packers'), /no manifest/)
})

// --- two manifests claiming the same club ---

test('two manifests claiming one sport and id is an error, not last-wins', () => {
	// Without this the second file silently replaced the first, which is the
	// same failure as the flat directory in reverse: there, a name collision
	// meant a club was never written at all; here it means one club quietly
	// becomes another. A mutation run said nothing covered it.
	const { mkdtempSync, mkdirSync, writeFileSync, cpSync } = fs
	const root = mkdtempSync(join(tmpdir(), 'teams-'))
	// The real sports/ directory, because loadTeams resolves every club against
	// its sport and a fixture with no sports would fail for the wrong reason.
	cpSync(new URL('../sports', import.meta.url), join(root, 'sports'), { recursive: true })
	mkdirSync(join(root, 'teams', 'nfl'), { recursive: true })
	const manifest = (name) => `export const team = {
	sport: 'nfl', id: 'packers', sourceIds: ['GB'], firstSeason: 1921,
	nouns: { team: 'Packers', fullName: '${name}' },
};
export default team;
`
	writeFileSync(join(root, 'teams', 'nfl', 'packers.js'), manifest('Green Bay Packers'))
	writeFileSync(join(root, 'teams', 'nfl', 'packers-copy.js'), manifest('Someone Else'))
	return assert.rejects(() => loadTeams(root), /two manifests claim nfl\/packers/)
})

test('the same id in two sports is fine, in the same fixture shape', () => {
	// The other half. Without it the guard could reject every duplicate id
	// regardless of sport and this file would still pass.
	const { mkdtempSync, mkdirSync, writeFileSync, cpSync } = fs
	const root = mkdtempSync(join(tmpdir(), 'teams-'))
	cpSync(new URL('../sports', import.meta.url), join(root, 'sports'), { recursive: true })
	for (const [sport, code] of [['nfl', 'ARI'], ['mlb', 'SLN']]) {
		mkdirSync(join(root, 'teams', sport), { recursive: true })
		writeFileSync(join(root, 'teams', sport, 'cardinals.js'), `export const team = {
	sport: '${sport}', id: 'cardinals', sourceIds: ['${code}'], firstSeason: 1920,
	nouns: { team: 'Cardinals', fullName: 'Cardinals' },
};
export default team;
`)
	}
	return loadTeams(root).then((teams) => {
		assert.equal(teams.length, 2)
		assert.deepEqual(teams.map((t) => t.sport).sort(), ['mlb', 'nfl'])
	})
})

// --- which code speaks for the club ---

test('every manifest lists its canonical code first', () => {
	// `sourceIds[0]` is taken as "this club's code" when a league schedule builds
	// a fixture, and the database stores canonical franchises — so a manifest
	// leading with a defunct code renders games under it. The Cubs led with CH1,
	// the 1876 White Stockings, and a 2025 game against the Dodgers displayed as
	// LAN at CH1 while the database correctly held LAN at CHN.
	//
	// Football never showed this: its history table happens to list the
	// franchise row first, so all 32 were already canonical. Fourteen of the
	// thirty baseball clubs were not.
	const codes = codeTables(['nfl', 'mlb'])
	const wrong = TEAMS
		.filter((t) => codes.franchiseOf(t.sport, t.sourceIds[0]) !== t.sourceIds[0])
		.map((t) => `${t.sport}/${t.id} leads with ${t.sourceIds[0]}`)
	assert.deepEqual(wrong, [])
})

test('a club that has moved still lists its older codes', () => {
	// The other half: leading with the canonical code must not mean dropping the
	// rest, or a club loses the seasons it played under another name.
	const byId = new Map(TEAMS.map((t) => [`${t.sport}/${t.id}`, t]))
	assert.deepEqual(byId.get('mlb/brewers').sourceIds.sort(), ['MIL', 'SE1'])
	assert.ok(byId.get('mlb/cubs').sourceIds.includes('CH1'))
	assert.ok(byId.get('nfl/raiders').sourceIds.includes('LV'))
})
