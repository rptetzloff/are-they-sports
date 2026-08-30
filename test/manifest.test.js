import test from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRED_NOUNS, REQUIRED_RULES, resolveTeam } from '../lib/manifest.js'
import { readFileSync } from 'node:fs'
import { loadTeams } from '../lib/teams.js'
import nfl from '../sports/nfl.js'
import mlb from '../sports/mlb.js'

// Resolving a club against its sport. The point is that a club manifest carries
// only what is genuinely its own — a dozen lines rather than sixty — and that
// the result is checked to be whole before anything renders it.

// Resolved once, at module scope. ESM allows top-level await; a test callback
// does not, and the first version of this file put one in each.
const TEAMS = await loadTeams()

const minimal = {
	sport: 'nfl', id: 'test', sourceIds: ['TST'], firstSeason: 1990,
	nouns: { team: 'Tests', fullName: 'Test Club' },
	copy: { seasonNotStarted: 'GO TESTS' },
}

test('a club inherits its sport\'s vocabulary', () => {
	const t = resolveTeam(minimal, nfl)
	assert.equal(t.nouns.scoreNoun, 'points')
	assert.equal(t.nouns.championship, 'Super Bowl')
	assert.equal(t.nouns.leaderNoun, 'coach')
	// And keeps its own.
	assert.equal(t.nouns.team, 'Tests')
})

test('a club inherits its sport\'s rules', () => {
	assert.equal(resolveTeam(minimal, nfl).rules.streaksSpanSeasons, true)
	assert.equal(resolveTeam({ ...minimal, sport: 'mlb' }, mlb).rules.streaksSpanSeasons, false)
})

test('a club can override any inherited value', () => {
	// The day someone builds the 1972 Dolphins, "undefeated" becomes "perfect"
	// for that one club and for no other. If overriding were impossible the
	// defaults would be a straitjacket rather than a default.
	const dolphins = resolveTeam({
		...minimal,
		nouns: { ...minimal.nouns, losslessSeasonNoun: 'perfect' },
		rules: { onThisDayWindowDays: 7 },
	}, nfl)
	assert.equal(dolphins.nouns.losslessSeasonNoun, 'perfect')
	assert.equal(dolphins.rules.onThisDayWindowDays, 7)
	// Overriding one rule does not drop the others.
	assert.equal(dolphins.rules.streaksSpanSeasons, true)
})

test('the two sports supply different vocabulary to the same club shape', () => {
	const football = resolveTeam(minimal, nfl)
	const baseball = resolveTeam({ ...minimal, sport: 'mlb' }, mlb)
	assert.equal(football.nouns.scoreForLabel, 'Points For')
	assert.equal(baseball.nouns.scoreForLabel, 'Runs Scored')
	// Not one phrase with a noun swapped — the verb changes too.
	assert.notEqual(baseball.nouns.scoreForLabel, football.nouns.scoreForLabel.replace('Points', 'Runs'))
})

test('a missing noun is caught at resolution, with the field named', () => {
	// The failure this prevents is the word "undefined" rendering into a
	// sentence, which throws nothing, fails no test, and is only ever caught by
	// somebody reading the page. That already happened once on the football
	// site.
	assert.throws(
		() => resolveTeam({ ...minimal, nouns: { team: 'Tests' } }, nfl),
		/missing nouns\.fullName/)
})

test('a sport with no defaults cannot hide a missing noun', () => {
	assert.throws(() => resolveTeam(minimal, { id: 'nfl' }), /missing nouns\./)
})

test('a missing rule is caught, and named', () => {
	// Harder to reach than it looks, and a mutant deleting this check survived
	// because of it: every fixture above gets all three rules from its sport,
	// and a sport with no defaults at all fails on nouns first and never reaches
	// the rule loop. So the sport here supplies a full vocabulary and no rules.
	const noRules = { id: 'nfl', defaults: { nouns: nfl.defaults.nouns } }
	assert.throws(() => resolveTeam(minimal, noRules), /missing rules\.streaksSpanSeasons/)
})

test('a club can supply a rule its sport forgot', () => {
	// The other half: the check is on the resolved value, not on the sport, so a
	// club that declares the rule itself is complete.
	const noRules = { id: 'nfl', defaults: { nouns: nfl.defaults.nouns } }
	const t = resolveTeam({
		...minimal,
		// Every required rule, so this fails when one is added rather than
		// passing because the club happened to declare the old three.
		rules: {
			streaksSpanSeasons: true, losslessSeasonIsPlausible: true,
			onThisDayWindowDays: 3, schedulePeriod: 'week',
		},
	}, noRules)
	assert.equal(t.rules.onThisDayWindowDays, 3)
})

test('an empty string is missing, not present', () => {
	assert.throws(
		() => resolveTeam({ ...minimal, nouns: { ...minimal.nouns, fullName: '' } }, nfl),
		/missing nouns\.fullName/)
})

test('a rule declared false is present, not missing', () => {
	// The trap: a missing rule and a rule declared false are the same value to
	// `if` and opposite facts, so this is checked by type.
	const t = resolveTeam({ ...minimal, rules: { streaksSpanSeasons: false } }, nfl)
	assert.equal(t.rules.streaksSpanSeasons, false)
})

test('a rule of the wrong type is rejected', () => {
	assert.throws(
		() => resolveTeam({ ...minimal, rules: { streaksSpanSeasons: 'yes' } }, nfl),
		/not a boolean/)
})

test('the club-only fields are required, because no sport can supply them', () => {
	// `copy.seasonNotStarted` was on this list and is not any more. It is the one
	// club field a sport can supply a usable value for, by naming the club, and
	// requiring it meant every one of thirty-two manifests had to carry an
	// invented chant. A club with no declared cheer now gets "GO PACKERS"; the
	// ones with a real one still say it.
	for (const [field, broken] of [
		['sourceIds', { sourceIds: [] }],
	]) {
		assert.throws(() => resolveTeam({ ...minimal, ...broken }, nfl),
			new RegExp(field.replace('.', '\\.')), `${field} was not required`)
	}
})

test('a club with no cheer is given one, and a club with one keeps it', () => {
	// `minimal` declares "GO TESTS" and is nicknamed "Tests", so the declared and
	// derived cheers are the same string and resolving it proves nothing about
	// which branch ran. Written that way first, two of three mutants survived —
	// including deleting the derivation outright. The fixture needs a club whose
	// derived cheer is distinctive, and no `copy` at all.
	const undeclared = { ...minimal, nouns: { team: 'Jets', fullName: 'New York Jets' } }
	delete undeclared.copy
	assert.equal(resolveTeam(undeclared, nfl).copy.seasonNotStarted, 'GO JETS')

	assert.equal(
		resolveTeam({ ...undeclared, copy: { seasonNotStarted: 'BEAR DOWN' } }, nfl)
			.copy.seasonNotStarted,
		'BEAR DOWN')
})

test('the required lists are not empty', () => {
	// A guard against the validation quietly checking nothing, which would make
	// every test above pass for the wrong reason.
	assert.ok(REQUIRED_NOUNS.length >= 10)
	assert.ok(REQUIRED_RULES.length >= 4)
})

// --- the real clubs ---

test('every committed club resolves', () => {
	// loadTeams throws on any club that does not, so reaching here is the
	// assertion; the count guards against it silently loading nothing.
	assert.ok(TEAMS.length >= 5, `only ${TEAMS.length} clubs loaded`)
})

test('every committed club ends up with every noun and rule', () => {
	for (const t of TEAMS) {
		for (const n of REQUIRED_NOUNS) assert.ok(t.nouns[n], `${t.id} lost nouns.${n}`)
		for (const r of REQUIRED_RULES) assert.notEqual(t.rules[r], undefined, `${t.id} lost rules.${r}`)
	}
})

test('a club manifest stays small', () => {
	// The whole point of the change. If a club file grows back past a couple of
	// dozen lines, something sport-level has been copied into it again.
	for (const id of ['bears', 'lions', 'vikings']) {
		const lines = readFileSync(new URL(`../teams/${id}.js`, import.meta.url), 'utf8').split('\n').length
		assert.ok(lines < 30, `teams/${id}.js is ${lines} lines`)
	}
})

test('clubs in one sport agree on everything their sport supplies', () => {
	// The invariant that says the defaults are actually doing the work. Two NFL
	// clubs must not disagree about what a championship is called unless one of
	// them deliberately overrode it.
	const football = TEAMS.filter((t) => t.sport === 'nfl')
	assert.ok(football.length >= 4, `only ${football.length} football clubs`)
	for (const field of ['scoreNoun', 'championship', 'leaderNoun', 'meetingPlural']) {
		const values = new Set(football.map((t) => t.nouns[field]))
		assert.equal(values.size, 1, `football clubs disagree on ${field}: ${[...values].join(', ')}`)
	}
})
