import test from 'node:test'
import assert from 'node:assert/strict'
import { Lru, memo, versionOf } from '../lib/derived.js'

// Memoising the league computations. The measurement that motivated it:
// /records under SCOPE=all is 62 clubs and 471,453 rows, the rows cost 0ms warm
// because they are already cached, and computeLeague over them cost 232ms on
// every request.
//
// The risk is not the memo, it is the invalidation. server.js records that
// caching for the life of the process hid a playoff-flag correction once and a
// franchise remapping once, and both times the site looked right and was quietly
// wrong. Most of these tests are about the cache letting go.

const club = (sport, franchise) => ({ sport, franchise })

test('a hit does not recompute', () => {
	const cache = new Lru(4)
	let calls = 0
	const compute = () => { calls++; return 'value' }
	assert.equal(memo(cache, 'k', 'v1', compute), 'value')
	assert.equal(memo(cache, 'k', 'v1', compute), 'value')
	assert.equal(calls, 1)
})

test('a moved version recomputes', () => {
	// The whole point. A load against a running deployment must be visible.
	const cache = new Lru(4)
	let calls = 0
	assert.equal(memo(cache, 'k', 'v1', () => `run ${++calls}`), 'run 1')
	assert.equal(memo(cache, 'k', 'v2', () => `run ${++calls}`), 'run 2')
	assert.equal(calls, 2)
})

test('a stale value is replaced, not kept alongside', () => {
	const cache = new Lru(4)
	memo(cache, 'k', 'v1', () => 'old')
	memo(cache, 'k', 'v2', () => 'new')
	assert.equal(cache.size, 1)
	assert.equal(memo(cache, 'k', 'v2', () => 'recomputed'), 'new')
})

test('different keys do not share a value', () => {
	const cache = new Lru(4)
	assert.equal(memo(cache, 'records/nfl', 'v', () => 'football'), 'football')
	assert.equal(memo(cache, 'records/mlb', 'v', () => 'baseball'), 'baseball')
	assert.equal(memo(cache, 'records/nfl', 'v', () => 'wrong'), 'football')
})

// --- the version ---

test('the version moves when any club moves', () => {
	// Not just the first. A league page is computed from every club in it, so one
	// club's rows changing invalidates the page.
	const clubs = [club('nfl', 'GB'), club('nfl', 'CHI'), club('nfl', 'MIN')]
	const at = new Map([['nfl/GB', 'A'], ['nfl/CHI', 'A'], ['nfl/MIN', 'A']])
	const stampOf = (c) => at.get(`${c.sport}/${c.franchise}`)
	const before = versionOf(clubs, stampOf)
	for (const key of at.keys()) {
		at.set(key, 'B')
		assert.notEqual(versionOf(clubs, stampOf), before, `${key} moving did not change the version`)
		at.set(key, 'A')
	}
	assert.equal(versionOf(clubs, stampOf), before)
})

test('two sports sharing a franchise code are two clubs', () => {
	// BAL is the Orioles and the Ravens; MIN the Twins and the Vikings. The game
	// cache was keyed on the bare code once and served the Ravens' rows to the
	// Orioles, which is the bug this repo has now hit six times. A version that
	// dropped the sport would call two different sets of clubs the same set.
	//
	// The stamps must be EQUAL for this to test anything. Giving the two clubs
	// different stamps made the versions differ for the wrong reason, and a
	// mutant dropping the sport survived.
	const stampOf = () => 'A'
	assert.notEqual(
		versionOf([club('mlb', 'BAL')], stampOf),
		versionOf([club('nfl', 'BAL')], stampOf),
	)
	// And a set holding both is not the same as a set holding one of them.
	assert.notEqual(
		versionOf([club('mlb', 'BAL'), club('nfl', 'BAL')], stampOf),
		versionOf([club('mlb', 'BAL'), club('mlb', 'BAL')], stampOf),
	)
})

test('a club never read is not a club read at an unknown time', () => {
	// null must not collapse into the same key as any real stamp, or the first
	// request — made before any rows are cached — poisons the entry for the ones
	// that follow.
	assert.notEqual(versionOf([club('nfl', 'GB')], () => null), versionOf([club('nfl', 'GB')], () => ''))
})

test('the same clubs in a different order are the same version', () => {
	// The scope resolves in a stable order today. Relying on that would be an
	// invariant nothing asserts, and the cost of not relying on it is a sort.
	const stampOf = () => 'A'
	const a = versionOf([club('nfl', 'GB'), club('nfl', 'CHI')], stampOf)
	const b = versionOf([club('nfl', 'CHI'), club('nfl', 'GB')], stampOf)
	assert.equal(a, b)
})

test('a club joining the set changes the version', () => {
	const stampOf = () => 'A'
	assert.notEqual(
		versionOf([club('nfl', 'GB')], stampOf),
		versionOf([club('nfl', 'GB'), club('nfl', 'CHI')], stampOf),
	)
})

// --- the bound ---

test('the cache evicts rather than growing', () => {
	// The key carries the season and there are a hundred and some per sport,
	// times three views. Unbounded here is a slow leak that only shows on a
	// long-lived deployment, which is the only kind this has.
	const cache = new Lru(3)
	for (const n of [1, 2, 3, 4, 5]) memo(cache, `k${n}`, 'v', () => n)
	assert.equal(cache.size, 3)
	assert.equal(cache.get('k1'), undefined)
	assert.equal(cache.get('k5').value, 5)
})

test('eviction is least-recently-USED, not least-recently-inserted', () => {
	// Insertion order alone evicts the entry being hit every request and keeps
	// the ones nobody asks for, which is the opposite of a cache.
	const cache = new Lru(3)
	for (const n of [1, 2, 3]) memo(cache, `k${n}`, 'v', () => n)
	memo(cache, 'k1', 'v', () => 'not recomputed')  // a hit, which refreshes k1
	memo(cache, 'k4', 'v', () => 4)                 // evicts something
	assert.equal(cache.get('k1')?.value, 1, 'the recently used entry was evicted')
	assert.equal(cache.get('k2'), undefined, 'the least recently used entry survived')
})

test('an Lru with no room is a bug, not a cache', () => {
	assert.throws(() => new Lru(0), /no room/)
	assert.throws(() => new Lru(-1), /no room/)
})
