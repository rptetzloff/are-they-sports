import test from 'node:test'
import assert from 'node:assert/strict'
import nfl from '../sports/nfl.js'
import mlb from '../sports/mlb.js'
import packers from '../teams/packers.js'
import brewers from '../teams/brewers.js'

// The seam itself, rather than either side of it.
//
// Everything downstream reads the neutral row without learning which league it
// is looking at, and adding a club is meant to be a manifest and nothing else.
// Both of those are claims, and a claim that no test can fail is prose.

const SPORTS = [nfl, mlb]
const TEAMS = [packers, brewers]

const nflRow = nfl.gameRow({
	game_id: '2024_01_GB_PHI', season: '2024', game_type: 'REG', gameday: '2024-09-06',
	away_team: 'GB', away_score: '29', home_team: 'PHI', home_score: '34',
}, 'GB')

const mlbRow = mlb.gameRow({
	gid: 'MIL198210120', date: '19821012', season: '1982', gametype: 'regular',
	visteam: 'SLN', hometeam: 'MIL', vruns: '3', hruns: '5',
}, 'MIL')

test('both sports produce exactly the same row keys', () => {
	// Not "both contain what the core needs" — the same set. An extra key on one
	// side is a downstream reader that works for one sport and silently returns
	// undefined for the other, which is the shape of the bug that ran on the
	// football site for months.
	assert.deepEqual(Object.keys(nflRow).sort(), Object.keys(mlbRow).sort())
})

test('no row key names a club, a league, or a sport', () => {
	// The reason the shape is result / scoreFor / scoreAgainst. The two sites
	// converged on it the hard way after `g["Packers Win"]` and `g.packers_score`
	// made every function team-specific.
	for (const k of Object.keys(nflRow)) {
		for (const banned of ['packer', 'brewer', 'nfl', 'mlb', 'points', 'runs', 'yard']) {
			assert.ok(!k.toLowerCase().includes(banned), `row key ${k} names ${banned}`)
		}
	}
})

test('every adapter answers the same questions', () => {
	for (const s of SPORTS) {
		for (const fn of ['gameRow', 'isScoringPlay', 'scoringRow']) {
			assert.equal(typeof s[fn], 'function', `${s.id} is missing ${fn}`)
		}
		assert.equal(typeof s.gameKey, 'string')
		assert.ok(s.sources.schedules, `${s.id} declares no schedules source`)
		assert.ok(s.sources.playByPlay, `${s.id} declares no play-by-play source`)
	}
})

test('every manifest declares every noun the pages will read', () => {
	// The actual failure mode when a third club is added: one noun is forgotten,
	// nothing throws, and a sentence renders "undefined" in production. That has
	// already happened once on the football site.
	const NOUNS = ['team', 'fullName', 'scoreNoun', 'scoreForLabel', 'scoreAgainstLabel',
		'championship', 'leaderNoun', 'leaderPlural', 'meetingNoun', 'meetingPlural',
		'losslessSeasonNoun']
	for (const t of TEAMS) {
		for (const n of NOUNS) {
			assert.equal(typeof t.nouns[n], 'string', `${t.id} is missing nouns.${n}`)
			assert.ok(t.nouns[n].length, `${t.id} has an empty nouns.${n}`)
		}
	}
})

test('every manifest declares every rule, including the false ones', () => {
	// Booleans, checked by type rather than truthiness, because a missing rule
	// and a rule declared false are the same value to `if` and opposite facts.
	const RULES = ['streaksSpanSeasons', 'losslessSeasonIsPlausible']
	for (const t of TEAMS) {
		for (const r of RULES) {
			assert.equal(typeof t.rules[r], 'boolean', `${t.id} is missing rules.${r}`)
		}
		assert.equal(typeof t.rules.onThisDayWindowDays, 'number')
		assert.ok(t.rules.onThisDayWindowDays >= 0)
	}
})

test('the two sports genuinely disagree, and the disagreement is declared', () => {
	// This is the test the house rules ask for by name. Streaks end at the
	// season boundary in baseball and span it in football, where the longest —
	// 15 games — ran from December 2010 into December 2011. Merging the two
	// implementations without noticing would silently rewrite one record book,
	// and no other test in this repo would fail.
	assert.notEqual(packers.rules.streaksSpanSeasons, brewers.rules.streaksSpanSeasons)
	assert.notEqual(packers.rules.onThisDayWindowDays, brewers.rules.onThisDayWindowDays)
})

test('a plural is declared, never derived', () => {
	// "clash" plus "s" is "clashs". The site shipped a test asserting '2 clashs'
	// rather than fixing it, which is why this asserts the rule and not a string.
	for (const t of TEAMS) {
		if (t.nouns.meetingNoun.endsWith('sh') || t.nouns.meetingNoun.endsWith('s')) {
			assert.notEqual(t.nouns.meetingPlural, `${t.nouns.meetingNoun}s`,
				`${t.id} pluralises ${t.nouns.meetingNoun} by appending s`)
		}
	}
})

test('source ids are a list, because franchises move', () => {
	for (const t of TEAMS) {
		assert.ok(Array.isArray(t.sourceIds), `${t.id} sourceIds is not a list`)
		assert.ok(t.sourceIds.length > 0)
	}
	// The Brewers spent 1969 in Seattle as the Pilots. A single string would
	// drop that season, and it would look like the franchise began in 1970.
	assert.ok(brewers.sourceIds.length > 1)
	assert.ok(brewers.sourceIds.includes('SE1'))
})

test('a club can predate its own play-by-play source', () => {
	// The Packers start in 1921 and nflverse play-by-play starts in 1999. That
	// is not an error condition, it is the normal case for eight decades.
	assert.ok(packers.firstSeason < nfl.sources.playByPlay.firstSeason)
})

test('every manifest names a sport that exists', () => {
	const ids = new Set(SPORTS.map((s) => s.id))
	for (const t of TEAMS) assert.ok(ids.has(t.sport), `${t.id} names unknown sport ${t.sport}`)
})
