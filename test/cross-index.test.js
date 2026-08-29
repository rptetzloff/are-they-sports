import test from 'node:test'
import assert from 'node:assert/strict'
import { builtTeams, loadIndex } from '../lib/indices.js'
import { loadTeams } from '../lib/teams.js'

// One game, two indices. Every meeting between two built clubs appears in both
// of their indices, and each is the other seen from the far side.
//
// This is the strongest check in the repo that does not need a sibling checkout.
// The two indices are built separately, by separate runs, each applying the
// team's own perspective to the same league-wide rows — so a perspective bug
// (scoreFor and scoreAgainst crossed, home and away swapped, a result inverted)
// shows up here as a mismatch and nowhere else. Comparing a club against itself
// cannot find it.

const teams = await loadTeams()
const built = builtTeams()
const available = teams.filter((t) => built.has(t.id))

/** Every pair of built clubs in the same sport. */
const pairs = available.flatMap((a, i) =>
	available.slice(i + 1).filter((b) => b.sport === a.sport).map((b) => [a, b]))

test('there is at least one pair of built clubs to compare', () => {
	// Otherwise every assertion below passes over an empty list, which is the
	// failure mode this repo keeps finding: a check that passes because it is
	// not looking at anything.
	assert.ok(pairs.length > 0, `only ${available.length} clubs built — nothing to cross-check`)
})

for (const [a, b] of pairs) {
	test(`${a.id} and ${b.id} agree on every meeting`, () => {
		const aCodes = new Set(a.sourceIds)
		const bCodes = new Set(b.sourceIds)
		const aGames = loadIndex(a.id, 'games').entries.filter((g) => g.result && bCodes.has(g.Opponent))
		const bGames = loadIndex(b.id, 'games').entries.filter((g) => g.result && aCodes.has(g.Opponent))

		assert.equal(aGames.length, bGames.length,
			`${a.id} has ${aGames.length} meetings, ${b.id} has ${bGames.length}`)
		if (!aGames.length) return

		const byDate = new Map(bGames.map((g) => [g.date, g]))
		for (const g of aGames) {
			const other = byDate.get(g.date)
			assert.ok(other, `${a.id} has ${g.date} vs ${g.Opponent}; ${b.id} does not`)
			// The scores invert.
			assert.equal(g.scoreFor, other.scoreAgainst, `${g.date}: scores do not mirror`)
			assert.equal(g.scoreAgainst, other.scoreFor, `${g.date}: scores do not mirror`)
			// So does the result.
			const inverse = { WIN: 'LOSS', LOSS: 'WIN', TIE: 'TIE' }
			assert.equal(other.result, inverse[g.result], `${g.date}: results do not mirror`)
			// And the venue, unless it was neutral for both.
			if (g.location === 'neutral') assert.equal(other.location, 'neutral', `${g.date}: one side neutral`)
			else assert.equal(other.location, g.location === 'home' ? 'away' : 'home', `${g.date}: both sides claim ${g.location}`)
		}
	})
}

test('every built club has games, and they are ordered by date', () => {
	for (const t of available) {
		const rows = loadIndex(t.id, 'games').entries
		assert.ok(rows.length > 100, `${t.id} has only ${rows.length} games`)
		for (let i = 1; i < rows.length; i++) {
			assert.ok(rows[i - 1].date <= rows[i].date, `${t.id} is out of order at ${rows[i].date}`)
		}
	}
})

test('no club has a game against itself', () => {
	for (const t of available) {
		const own = new Set(t.sourceIds)
		const self = loadIndex(t.id, 'games').entries.filter((g) => own.has(g.Opponent))
		assert.deepEqual(self, [], `${t.id} plays itself`)
	}
})
