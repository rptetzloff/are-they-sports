import test from 'node:test'
import assert from 'node:assert/strict'
import {
	basePath, codeIndex, codesInScope, loadDivisions, needsSelector, parseScope, resolveScope, slug,
} from '../lib/scope.js'

// What one deployment shows. These run on literals; the tests that read the
// committed division tables are in divisions.test.js.

const div = (code, conference, division) => ({
	code, conference, division,
	conferenceSlug: slug(conference), divisionSlug: slug(`${conference} ${division}`),
})

const NFL = [
	div('GB', 'NFC', 'North'), div('CHI', 'NFC', 'North'),
	div('DET', 'NFC', 'North'), div('MIN', 'NFC', 'North'),
	div('DAL', 'NFC', 'East'), div('KC', 'AFC', 'West'),
]
const MLB = [
	div('MIL', 'NL', 'Central'), div('CHN', 'NL', 'Central'), div('NYA', 'AL', 'East'),
]
const BY_SPORT = { nfl: NFL, mlb: MLB }

const packers = { id: 'packers', sport: 'nfl', sourceIds: ['GB'] }
const brewers = { id: 'brewers', sport: 'mlb', sourceIds: ['MIL', 'SE1'] }
const TEAMS = [packers, brewers]

// --- parsing ---

test('each scope kind parses to its parts', () => {
	assert.deepEqual(parseScope('all'), { kind: 'all', sport: null, id: null })
	assert.deepEqual(parseScope('team:packers'), { kind: 'team', sport: null, id: 'packers' })
	assert.deepEqual(parseScope('sport:nfl'), { kind: 'sport', sport: 'nfl', id: null })
	assert.deepEqual(parseScope('conference:nfl/nfc'), { kind: 'conference', sport: 'nfl', id: 'nfc' })
	assert.deepEqual(parseScope('division:nfl/nfc-north'), { kind: 'division', sport: 'nfl', id: 'nfc-north' })
})

test('surrounding whitespace is not part of the scope', () => {
	// It arrives from an env var, and a trailing space in a Coolify field is
	// invisible in the UI.
	assert.deepEqual(parseScope('  team:packers  '), parseScope('team:packers'))
})

test('a bad scope throws instead of falling back', () => {
	// The important half. A misspelled scope that quietly became `all` or
	// `team:packers` would start the server, serve every route, and show the
	// wrong site — which is this project's recurring failure mode wearing a
	// different hat.
	for (const bad of ['', '   ', undefined, null, 'teams:packers', 'divison:nfl/nfc-north', 'everything']) {
		assert.throws(() => parseScope(bad), `accepted ${JSON.stringify(bad)}`)
	}
})

test('a scope missing its argument throws, and says what was expected', () => {
	assert.throws(() => parseScope('team:'), /needs an argument/)
	assert.throws(() => parseScope('sport:'), /needs an argument/)
	assert.throws(() => parseScope('division:nfl'), /needs sport\/id/)
	assert.throws(() => parseScope('conference:nfc'), /needs sport\/id/)
	assert.throws(() => parseScope('all:nfl'), /takes no argument/)
})

test('slugs are url-safe and stable', () => {
	assert.equal(slug('NFC'), 'nfc')
	assert.equal(slug('NFC North'), 'nfc-north')
	assert.equal(slug('AL West'), 'al-west')
})

// --- membership ---

test('a division scope is the clubs currently in that division', () => {
	const got = codesInScope(parseScope('division:nfl/nfc-north'), BY_SPORT)
	assert.deepEqual(got.map((c) => c.code).sort(), ['CHI', 'DET', 'GB', 'MIN'])
})

test('a conference scope spans its divisions', () => {
	const got = codesInScope(parseScope('conference:nfl/nfc'), BY_SPORT)
	assert.deepEqual(got.map((c) => c.code).sort(), ['CHI', 'DAL', 'DET', 'GB', 'MIN'])
})

test('a sport scope is every club in that sport and no others', () => {
	const got = codesInScope(parseScope('sport:nfl'), BY_SPORT)
	assert.equal(got.length, NFL.length)
	assert.ok(!got.some((c) => c.sport === 'mlb'))
})

test('all spans every sport', () => {
	const got = codesInScope(parseScope('all'), BY_SPORT)
	assert.equal(got.length, NFL.length + MLB.length)
	assert.deepEqual([...new Set(got.map((c) => c.sport))].sort(), ['mlb', 'nfl'])
})

test('an unknown division throws and lists the real ones', () => {
	// Rather than resolving to zero clubs and serving an empty site, which would
	// look like a data problem for as long as it took someone to notice.
	assert.throws(() => codesInScope(parseScope('division:nfl/nfc-northe'), BY_SPORT),
		/known: afc-west, nfc-east, nfc-north/)
	assert.throws(() => codesInScope(parseScope('sport:nhl'), BY_SPORT), /no division table/)
})

test('a division name is qualified by conference', () => {
	// "East" exists in both conferences and both leagues, so the slug carries
	// the conference. An unqualified "east" must not match anything.
	assert.throws(() => codesInScope(parseScope('division:nfl/east'), BY_SPORT), /known:/)
	assert.equal(codesInScope(parseScope('division:nfl/nfc-east'), BY_SPORT).length, 1)
})

// --- resolution ---

test('every source code a club used maps back to the club', () => {
	const idx = codeIndex(TEAMS)
	assert.equal(idx.get('nfl/GB'), 'packers')
	assert.equal(idx.get('mlb/MIL'), 'brewers')
	// The Seattle Pilots season.
	assert.equal(idx.get('mlb/SE1'), 'brewers')
	assert.equal(idx.get('nfl/CHI'), undefined)
})

test('a code means different clubs in different sports', () => {
	// MIN is the Vikings and the Twins; DET is the Lions and the Tigers; MIL is
	// the Milwaukee Badgers in football and the Brewers in baseball. A code-only
	// index made an `all` scope list 60 clubs rather than 62, because the two
	// baseball clubs resolved to football teams already seen and were
	// deduplicated away — and without the dedupe they would have been served as
	// the wrong club entirely.
	const twins = { id: 'twins', sport: 'mlb', sourceIds: ['MIN'] }
	const vikings = { id: 'vikings', sport: 'nfl', sourceIds: ['MIN'] }
	const idx = codeIndex([twins, vikings])
	assert.equal(idx.get('mlb/MIN'), 'twins')
	assert.equal(idx.get('nfl/MIN'), 'vikings')
})

test('a scope spanning both sports keeps every club', () => {
	// The end-to-end form of the same bug, which is how it was noticed: the
	// selector said 60.
	const both = {
		nfl: [div('MIN', 'NFC', 'North')],
		mlb: [div('MIN', 'AL', 'Central')],
	}
	const teams = [{ id: 'vikings', sport: 'nfl', sourceIds: ['MIN'] }, { id: 'twins', sport: 'mlb', sourceIds: ['MIN'] }]
	const got = resolveScope(parseScope('all'), { divisionsBySport: both, teams, built: new Set() })
	assert.equal(got.length, 2)
	assert.deepEqual(got.map((e) => e.teamId).sort(), ['twins', 'vikings'])
})

test('two clubs claiming one code is an error, not a race', () => {
	// Otherwise it resolves to whichever manifest happened to load last.
	assert.throws(() => codeIndex([packers, { id: 'other', sport: 'nfl', sourceIds: ['GB'] }]),
		/claimed by both/)
})

test('a club in scope with no manifest is reported, not dropped', () => {
	// The whole reason resolution returns unavailable entries. A site promising
	// a division and quietly showing the one club it had built would look
	// complete and be wrong.
	const got = resolveScope(parseScope('division:nfl/nfc-north'),
		{ divisionsBySport: BY_SPORT, teams: TEAMS, built: new Set(['packers']) })
	assert.equal(got.length, 4)
	assert.equal(got.filter((e) => e.available).length, 1)
	const gb = got.find((e) => e.code === 'GB')
	assert.equal(gb.teamId, 'packers')
	assert.equal(gb.available, true)
	const chi = got.find((e) => e.code === 'CHI')
	assert.equal(chi.teamId, null)
	assert.equal(chi.available, false)
})

test('a manifest without built artifacts is in scope and unavailable', () => {
	// Two different gaps: no manifest at all, and a manifest whose build has not
	// been run. Both are unavailable and only one is fixed by writing a file.
	const got = resolveScope(parseScope('division:nfl/nfc-north'),
		{ divisionsBySport: BY_SPORT, teams: TEAMS, built: new Set() })
	const gb = got.find((e) => e.code === 'GB')
	assert.equal(gb.teamId, 'packers')
	assert.equal(gb.available, false)
})

test('a team scope resolves through the manifest, not the division table', () => {
	// So a club can be served before anyone has written a division row for it.
	const got = resolveScope(parseScope('team:packers'),
		{ divisionsBySport: BY_SPORT, teams: TEAMS, built: new Set(['packers']) })
	assert.deepEqual(got, [{ sport: 'nfl', code: 'GB', teamId: 'packers', available: true }])
})

test('a team scope naming an unknown club throws and lists what exists', () => {
	assert.throws(() => resolveScope(parseScope('team:vikings'),
		{ divisionsBySport: BY_SPORT, teams: TEAMS, built: new Set() }),
	/no manifest for team "vikings"; have brewers, packers/)
})

test('a club with two codes appears once', () => {
	const twice = { mlb: [div('MIL', 'NL', 'Central'), div('SE1', 'NL', 'Central')] }
	const got = resolveScope({ kind: 'sport', sport: 'mlb', id: null },
		{ divisionsBySport: twice, teams: TEAMS, built: new Set(['brewers']) })
	assert.equal(got.filter((e) => e.teamId === 'brewers').length, 1)
})

// --- routing ---

test('a single-club scope keeps the root', () => {
	// These URLs exist in the world. arethepackersundefeated.com/records/x must
	// not become /nfl/packers/records/x on the cutover, or every link and every
	// og:image breaks at once.
	const scope = parseScope('team:packers')
	assert.equal(basePath(scope, { sport: 'nfl', teamId: 'packers' }), '')
})

test('a multi-club scope within one sport puts the club first', () => {
	for (const spec of ['division:nfl/nfc-north', 'conference:nfl/nfc', 'sport:nfl']) {
		assert.equal(basePath(parseScope(spec), { sport: 'nfl', teamId: 'packers' }), '/packers')
	}
})

test('an all scope qualifies the club with its sport', () => {
	// Because ids only have to be unique within a sport, and two leagues will
	// eventually both have a Cardinals.
	assert.equal(basePath(parseScope('all'), { sport: 'nfl', teamId: 'packers' }), '/nfl/packers')
	assert.equal(basePath(parseScope('all'), { sport: 'mlb', teamId: 'brewers' }), '/mlb/brewers')
})

test('the selector appears exactly when there is more than one club', () => {
	assert.equal(needsSelector([{ teamId: 'packers' }]), false)
	assert.equal(needsSelector([{ teamId: 'packers' }, { teamId: 'brewers' }]), true)
})

// --- the committed tables ---

test('the real division tables load and are internally whole', () => {
	// Not a snapshot: counts and relations. The tables are hand-curated and will
	// change on realignment, and a test asserting today's 32 names would fail
	// for the wrong reason.
	for (const [sportId, size, perDivision] of [['nfl', 32, 4], ['mlb', 30, 5]]) {
		const rows = loadDivisions(sportId)
		assert.equal(rows.length, size, `${sportId} has ${rows.length} clubs`)
		assert.equal(new Set(rows.map((r) => r.code)).size, size, `${sportId} has a duplicate code`)
		const byDivision = new Map()
		for (const r of rows) byDivision.set(r.divisionSlug, (byDivision.get(r.divisionSlug) ?? 0) + 1)
		for (const [d, n] of byDivision) assert.equal(n, perDivision, `${sportId} ${d} has ${n} clubs`)
		assert.equal(new Set(rows.map((r) => r.conferenceSlug)).size, 2)
	}
})

test('the clubs that do have manifests are in the tables under their own codes', () => {
	// The join the whole scope model depends on. If a manifest's first sourceId
	// stopped matching the reference table, a division scope would list the club
	// as unavailable and nothing else would complain.
	const nfl = loadDivisions('nfl')
	const mlb = loadDivisions('mlb')
	assert.ok(nfl.some((r) => r.code === 'GB'), 'GB missing from the NFL table')
	assert.ok(mlb.some((r) => r.code === 'MIL'), 'MIL missing from the MLB table')
})

test('the Brewers are in the National League table despite their American League years', () => {
	// Stated as a test because it is the one thing about this model most likely
	// to be "fixed" by someone who thinks it is a bug. A division is today's
	// clubs with all of their history, and 1969-1997 came along with them.
	const mlb = loadDivisions('mlb')
	assert.equal(mlb.find((r) => r.code === 'MIL').conference, 'NL')
})

test('a club with no manifest still gets a path', () => {
	// Otherwise the selector lists it, the path it implies 404s, and the 503
	// that would have explained what is missing is unreachable. The first draft
	// interpolated a null teamId: thirty of the sixty-two clubs in an `all`
	// scope were served at /nfl/null and /mlb/null, all sharing one route.
	const chi = { sport: 'nfl', code: 'CHI', teamId: null }
	assert.equal(basePath(parseScope('division:nfl/nfc-north'), chi), '/chi')
	assert.equal(basePath(parseScope('all'), chi), '/nfl/chi')
})

test('no two clubs in a scope share a base path', () => {
	// The general form. Two clubs on one path means one of them is unreachable,
	// and which one depends on iteration order.
	const scope = parseScope('all')
	const resolved = resolveScope(scope, { divisionsBySport: BY_SPORT, teams: TEAMS, built: new Set() })
	const bases = resolved.map((e) => basePath(scope, e))
	assert.equal(new Set(bases).size, bases.length, `duplicate base paths: ${bases.join(' ')}`)
})
