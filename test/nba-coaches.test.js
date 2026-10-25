// Basketball's head coaches: the curated file (data/reference/nba-coaches.csv,
// seeded by scripts/wiki-coaches.mjs nba). The tally and the pages are
// hockey's (test/nhl-coaches.test.js); what is basketball's own is the ABA.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/nba-coaches.csv'), 'utf8'))
const CLUBS = ['ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM',
	'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS']
const career = (name) => {
	const his = rows.filter((r) => r.name === name)
	return `${his.reduce((s, r) => s + Number(r.w || 0), 0)}-${his.reduce((s, r) => s + Number(r.l || 0), 0)}`
}

test('every row of the basketball file is a tenure the loader can write', () => {
	assert.ok(rows.length > 600, `only ${rows.length} rows`)
	for (const r of rows) {
		assert.ok(r.leaderId && r.name, `a row has no id or name: ${JSON.stringify(r)}`)
		assert.ok(CLUBS.includes(r.franchiseAbbrv), `${r.name}: ${r.franchiseAbbrv} is no club`)
		assert.ok(Number(r.firstSeason) >= 1947 && Number(r.lastSeason) >= Number(r.firstSeason), `${r.name} ${r.firstSeason}-${r.lastSeason}`)
		assert.ok(['counted', 'transcribed'].includes(r.basis), `${r.name} basis ${r.basis}`)
	}
})

test('no two basketball tenures share leader_tenure\'s key, and one id is one name', () => {
	const seen = new Set()
	const names = new Map()
	for (const r of rows) {
		const key = `${r.franchiseAbbrv}|${r.leaderId}|${r.firstSeason}`
		assert.ok(!seen.has(key), `twice: ${key}`)
		seen.add(key)
		names.set(r.leaderId, new Set([...(names.get(r.leaderId) ?? []), r.name]))
	}
	assert.deepEqual([...names].filter(([, s]) => s.size > 1).map(([id, s]) => `${id}: ${[...s].join(' / ')}`), [])
})

test('no coach of the four ABA clubs is on record before 1976-77', () => {
	for (const r of rows.filter((x) => ['DEN', 'IND', 'SAS', 'BKN'].includes(x.franchiseAbbrv))) {
		assert.ok(Number(r.firstSeason) >= 1977, `${r.franchiseAbbrv} ${r.name} ${r.firstSeason}`)
	}
})

test('careers come to the NBA\'s own totals', () => {
	// Larry Brown's Denver tenure was ABA and NBA as one record (by hand, the
	// NBA's 53 games of 1978-79); the rest are anchors for the fit.
	assert.equal(career('Larry Brown'), '1098-904')
	assert.equal(career('Gregg Popovich'), '1390-824')
	assert.equal(career('Phil Jackson'), '1155-485')
	assert.equal(career('Lenny Wilkens'), '1332-1155')
	assert.equal(rows.filter((r) => r.name === 'Phil Jackson').flatMap((r) => (r.titleSeasons ? r.titleSeasons.split(' ') : [])).length, 11)
})
