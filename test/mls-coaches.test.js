// MLS's head coaches: the curated file (data/reference/mls-coaches.csv,
// seeded by scripts/wiki-coaches.mjs mls from lists that date each tenure).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/mls-coaches.csv'), 'utf8'))
const CLUBS = ['ATL', 'ATX', 'CHI', 'CIN', 'CLB', 'CLT', 'COL', 'DAL', 'DC', 'HOU', 'LA', 'LAFC', 'MIA', 'MIN', 'MTL', 'NE', 'NSH',
	'NYC', 'ORL', 'PHI', 'POR', 'RBNY', 'RSL', 'SD', 'SEA', 'SJ', 'SKC', 'STL', 'TOR', 'VAN']
const of = (name) => rows.filter((r) => r.name === name)

test('every row of the MLS file is a tenure the loader can write, one name an id', () => {
	assert.ok(rows.length > 250, `only ${rows.length} rows`)
	const seen = new Set()
	const names = new Map()
	for (const r of rows) {
		assert.ok(CLUBS.includes(r.franchiseAbbrv), `${r.name}: ${r.franchiseAbbrv} is no club`)
		assert.equal(r.basis, 'counted', `${r.name} is counted from the games`)
		const key = `${r.franchiseAbbrv}|${r.leaderId}|${r.firstSeason}`
		assert.ok(!seen.has(key), `twice: ${key}`)
		seen.add(key)
		names.set(r.leaderId, new Set([...(names.get(r.leaderId) ?? []), r.name]))
	}
	assert.deepEqual([...names].filter(([, s]) => s.size > 1).map(([id]) => id), [])
	// Every club has a coach, the drafts' codes mapped to this repo's.
	assert.deepEqual(CLUBS.filter((c) => !rows.some((r) => r.franchiseAbbrv === c)), [])
})

test('a stand-in inside a tenure does not end it', () => {
	// Brian Schmetzer took single games for Sigi Schmid in 2009 and 2015.
	const schmid = of('Sigi Schmid').find((r) => r.franchiseAbbrv === 'SEA')
	assert.equal(schmid.term, '2008–2016')
	assert.equal(schmid.lastSeason, '2016')
})

test('a stale "present" ends where the next coach begins', () => {
	// Toronto's list still had John Herdman to the present beside Robin Fraser.
	const herdman = of('John Herdman').find((r) => r.franchiseAbbrv === 'TOR')
	assert.equal(herdman.term, '2023–2025')
})
