import test from 'node:test'
import assert from 'node:assert/strict'
import { coveredSeasons, seasonRange } from '../scripts/fetch.mjs'
import nfl from '../sports/nfl.js'
import mlb from '../sports/mlb.js'
import packers from '../teams/packers.js'
import brewers from '../teams/brewers.js'

// Argument parsing and coverage bounds. Both decide how much of a 95MB-per-
// season source gets downloaded, so getting them wrong is expensive rather than
// merely wrong.

test('a single season is a range of one', () => {
	assert.deepEqual(seasonRange('2024'), [2024])
	assert.deepEqual(seasonRange(2024), [2024])
})

test('a range is inclusive at both ends', () => {
	// Off by one here is one missing season of play-by-play, which shows up as a
	// year with no scoring plays and no error anywhere.
	assert.deepEqual(seasonRange('2020-2023'), [2020, 2021, 2022, 2023])
})

test('a backwards range is refused rather than yielding nothing', () => {
	// An empty list would fetch nothing and report success.
	assert.throws(() => seasonRange('2023-2020'), /backwards/)
})

test('anything that is not a season is refused', () => {
	for (const bad of ['', '20', '2024-', 'latest', '2024-2025-2026', '99999']) {
		assert.throws(() => seasonRange(bad), /not a season or range/, `accepted ${bad}`)
	}
})

test('coverage is the overlap of the club and the source, not either alone', () => {
	// The Packers existed in 1921 and nflverse play-by-play starts in 1999.
	// Asking for 1921 is not an error; there simply is none.
	const asked = [1921, 1998, 1999, 2000]
	assert.deepEqual(coveredSeasons(packers, nfl, asked), [1999, 2000])
})

test('a club younger than its source is bounded by the club', () => {
	// Baseball's play-by-play reaches further back than this franchise does, so
	// the club is the binding constraint and 1968 must not be fetched.
	assert.deepEqual(coveredSeasons(brewers, mlb, [1968, 1969, 1970]), [1969, 1970])
})

test('asking only for uncovered seasons yields nothing, quietly', () => {
	assert.deepEqual(coveredSeasons(packers, nfl, [1921, 1950]), [])
})

test('coverage preserves the order it was asked in', () => {
	// The caller decides the order; this filters, it does not sort.
	assert.deepEqual(coveredSeasons(packers, nfl, [2001, 1999, 2000]), [2001, 1999, 2000])
})
