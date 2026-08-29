import test from 'node:test'
import assert from 'node:assert/strict'
import { matchRoute, normalisePath, parseView, routeTable } from '../lib/routes.js'
import { parseScope } from '../lib/scope.js'

// Routing, without starting a server. A route table that can only be tested by
// making requests is a route table that does not get tested.

const entry = (sport, teamId, code) => ({ sport, teamId, code, available: true })

const TEAM = routeTable(parseScope('team:packers'), [entry('nfl', 'packers', 'GB')])
const DIVISION = routeTable(parseScope('division:nfl/nfc-north'), [
	entry('nfl', 'packers', 'GB'), entry('nfl', null, 'CHI'),
])
const ALL = routeTable(parseScope('all'), [
	entry('nfl', 'packers', 'GB'), entry('mlb', 'brewers', 'MIL'),
])

test('a trailing slash is not a different page', () => {
	assert.equal(normalisePath('/packers/'), '/packers')
	assert.equal(normalisePath('/packers'), '/packers')
	// The root is the exception; it is all slash.
	assert.equal(normalisePath('/'), '/')
})

test('a single-club scope serves every path from the one club', () => {
	for (const p of ['/', '/2024', '/records/longest-streak', '/vs/bears']) {
		const m = matchRoute(p, TEAM)
		assert.ok(m, `no match for ${p}`)
		assert.equal(m.entry.teamId, 'packers')
		assert.equal(m.rest, p)
	}
})

test('a multi-club scope routes by prefix and strips it', () => {
	const m = matchRoute('/packers/2024', DIVISION)
	assert.equal(m.entry.teamId, 'packers')
	assert.equal(m.rest, '/2024')
})

test('a club root resolves to that club with nothing left over', () => {
	assert.equal(matchRoute('/packers', DIVISION).rest, '/')
	assert.equal(matchRoute('/packers/', DIVISION).rest, '/')
})

test('a path belonging to no club is no match, not a fallback', () => {
	// Rather than resolving to the first club and serving Green Bay's data under
	// a Chicago URL.
	assert.equal(matchRoute('/vikings/2024', DIVISION), null)
	assert.equal(matchRoute('/', DIVISION), null)
})

test('an unbuilt club still routes, so it can explain itself', () => {
	const m = matchRoute('/chi', DIVISION)
	assert.ok(m, 'no route for a club with no manifest')
	assert.equal(m.entry.code, 'CHI')
	assert.equal(m.entry.teamId, null)
})

test('an all scope qualifies by sport', () => {
	assert.equal(matchRoute('/nfl/packers/2024', ALL).entry.teamId, 'packers')
	assert.equal(matchRoute('/mlb/brewers', ALL).entry.teamId, 'brewers')
	// The unqualified path is not a shortcut to it.
	assert.equal(matchRoute('/packers', ALL), null)
})

test('a club whose id prefixes another does not steal its routes', () => {
	// `cards` and `cardinals`. The segment boundary settles this on its own —
	// /cardinals/2024 does not start with /cards/ — which is why the
	// longest-prefix tie-break this test was originally written for turned out
	// to be unreachable and was removed.
	const table = routeTable(parseScope('sport:mlb'), [
		entry('mlb', 'cards', 'SLN'), entry('mlb', 'cardinals', 'ARI'),
	])
	assert.equal(matchRoute('/cardinals/2024', table).entry.teamId, 'cardinals')
	assert.equal(matchRoute('/cards/2024', table).entry.teamId, 'cards')
	// And in the other registration order, since `find` takes the first match.
	const reversed = routeTable(parseScope('sport:mlb'), [
		entry('mlb', 'cardinals', 'ARI'), entry('mlb', 'cards', 'SLN'),
	])
	assert.equal(matchRoute('/cards/2024', reversed).entry.teamId, 'cards')
})

test('a named club beats a single-club scope root', () => {
	// The empty base matches everything, so it has to lose to any real prefix or
	// it would answer for the whole table.
	const mixed = [{ base: '', teamId: 'packers' }, { base: '/brewers', teamId: 'brewers' }]
	assert.equal(matchRoute('/brewers/1982', mixed).entry.teamId, 'brewers')
	assert.equal(matchRoute('/1982', mixed).entry.teamId, 'packers')
})

test('a club prefix only matches on a segment boundary', () => {
	// /packersfan is not a Packers URL.
	assert.equal(matchRoute('/packersfan', DIVISION), null)
})

test('the four views parse, and nothing else does', () => {
	assert.deepEqual(parseView('/'), { view: 'summary' })
	assert.deepEqual(parseView('/2024'), { view: 'season', season: '2024' })
	assert.deepEqual(parseView('/records'), { view: 'records', record: null })
	assert.deepEqual(parseView('/records/longest-streak'), { view: 'records', record: 'longest-streak' })
	assert.deepEqual(parseView('/vs/bears'), { view: 'vs', opponent: 'bears' })
	for (const bad of ['/24', '/20244', '/records/Longest', '/vs/', '/vs/a/b', '/nonsense']) {
		assert.equal(parseView(bad), null, `accepted ${bad}`)
	}
})

test('a season is four digits, not any number', () => {
	// The route sits next to /records and /vs, and a loose number pattern would
	// swallow paths that were meant for something else.
	assert.equal(parseView('/1921').season, '1921')
	assert.equal(parseView('/192'), null)
	assert.equal(parseView('/19211'), null)
})
