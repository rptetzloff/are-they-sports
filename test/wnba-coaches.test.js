// The WNBA's head coaches: the curated file (data/reference/wnba-coaches.csv,
// seeded by scripts/wiki-coaches.mjs wnba from each club's season table).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/wnba-coaches.csv'), 'utf8'))
const CLUBS = ['ATL', 'CHI', 'CON', 'DAL', 'GSV', 'IND', 'LAS', 'LVA', 'MIN', 'NYL', 'PHX', 'POR', 'SEA', 'TOR', 'WAS']
const of = (name) => rows.filter((r) => r.name === name)

test('every row of the WNBA file is a tenure the loader can write', () => {
	assert.ok(rows.length > 120, `only ${rows.length} rows`)
	const seen = new Set()
	for (const r of rows) {
		assert.ok(CLUBS.includes(r.franchiseAbbrv), `${r.name}: ${r.franchiseAbbrv} is no club`)
		assert.ok(Number(r.firstSeason) >= 1997 && Number(r.lastSeason) >= Number(r.firstSeason), `${r.name} ${r.firstSeason}-${r.lastSeason}`)
		// Every abbreviation in a shared season's cell is spelled out.
		assert.ok(!/^[A-Z]\.\s/.test(r.name), `${r.name} is still initials`)
		const key = `${r.franchiseAbbrv}|${r.leaderId}|${r.firstSeason}`
		assert.ok(!seen.has(key), `twice: ${key}`)
		seen.add(key)
	}
})

test('a season two coaches shared gives each the record the table states', () => {
	// Utah 1998: Denise Taylor 6-13, then Frank Layden 2-9. Taylor's 1997 was
	// whole (7-21), so hers is one tenure of 13-34.
	const taylor = of('Denise Taylor')
	assert.deepEqual(taylor.map((r) => [r.firstSeason, r.lastSeason, `${r.w}-${r.l}`]), [['1997', '1998', '13-34']])
	const layden = of('Frank Layden')
	assert.deepEqual(layden.map((r) => [r.firstSeason, r.lastSeason]), [['1998', '1999']])
	assert.equal(`${layden[0].w}-${layden[0].l}`, '4-11')
})

test('titles go to whoever finished the season', () => {
	const titles = (name) => of(name).flatMap((r) => (r.titleSeasons ? r.titleSeasons.split(' ') : [])).sort()
	assert.deepEqual(titles('Cheryl Reeve'), ['2011', '2013', '2015', '2017'])
	assert.deepEqual(titles('Becky Hammon'), ['2022', '2023', '2025'])
	assert.deepEqual(titles('Bill Laimbeer'), ['2003', '2006', '2008'])
})
