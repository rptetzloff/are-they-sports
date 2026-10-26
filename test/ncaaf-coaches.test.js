// College football's head coaches, from CollegeFootballData (Ray, 2026-10-26),
// as data/reference/ncaaf-coaches.csv: checked against the record books.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'
import { navFor } from '../lib/web-routes.js'
import { BY_SPORT } from '../lib/limitations.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const rows = parseCsv(read('data/reference/ncaaf-coaches.csv'))
const tenure = (name, club) => rows.find((r) => r.name === name && r.franchiseAbbrv === club)
const total = (r) => [Number(r.w) + Number(r.playoffW), Number(r.l) + Number(r.playoffL)]

test('a tenure a coach\'s run at a club, its record the books\'', () => {
	assert.deepEqual(total(tenure('Nick Saban', 'ALA')), [206, 29])
	assert.equal(tenure('Nick Saban', 'ALA').titleSeasons, '2009 2011 2012 2015 2017 2020')
	assert.deepEqual(total(tenure('Nick Saban', 'LSU')), [48, 16])
	assert.equal(tenure('Nick Saban', 'LSU').titleSeasons, '2003')
	assert.deepEqual(total(tenure('Jim Tressel', 'OSU')), [106, 22])
	assert.deepEqual(total(tenure('Bret Bielema', 'WIS')), [68, 24])
	assert.deepEqual(total(tenure('Paul Chryst', 'WIS')), [67, 26])
	// Regular season and postseason apart, as every league's file keeps them.
	assert.deepEqual([tenure('Paul Chryst', 'WIS').w, tenure('Paul Chryst', 'WIS').playoffW], ['61', '6'])
})

test('a season that changed hands: the bowl to its stand-in, the stand-in an interim', () => {
	// Bielema left after the 2012 Big Ten title; Alvarez coached the Rose Bowl.
	const alvarez = rows.filter((r) => r.name === 'Barry Alvarez' && r.franchiseAbbrv === 'WIS')
	const rose = alvarez.find((r) => r.firstSeason === '2012')
	assert.deepEqual([rose.w, rose.l, rose.playoffW, rose.playoffL, rose.interim, rose.basis], ['0', '0', '0', '1', 'TRUE', 'transcribed'])
	// His own sixteen seasons are one tenure, counted from the games.
	const own = alvarez.find((r) => r.firstSeason === '1990')
	assert.deepEqual([own.lastSeason, own.interim, own.basis, own.term], ['2005', 'FALSE', 'counted', '1990–2005'])
	// Leonhard finished Chryst's 2022 and did not keep the job.
	assert.equal(tenure('Jim Leonhard', 'WIS').interim, 'TRUE')
})

test('every club has coaches; each tenure is one coach\'s, once', () => {
	const clubs = parseCsv(read('data/reference/ncaaf-franchise-history.csv')).map((r) => r.franchiseAbbrv)
	for (const c of clubs) assert.ok(rows.some((r) => r.franchiseAbbrv === c), `${c} has no coaches`)
	const keys = rows.map((r) => `${r.leaderId}|${r.franchiseAbbrv}|${r.firstSeason}`)
	assert.equal(new Set(keys).size, keys.length)
	for (const r of rows) assert.ok(Number(r.firstSeason) <= Number(r.lastSeason), `${r.name} ${r.franchiseAbbrv}`)
})

test('the coaches page is linked, and the limitations say how the records are made', () => {
	assert.match(navFor(read('web/ncaaf/index.html'), 'ncaaf'), /href="coaches"/)
	assert.ok(BY_SPORT.ncaaf.some((l) => /Head coaches come from CollegeFootballData/.test(l)))
	assert.ok(!BY_SPORT.ncaaf.some((l) => /no coaches page/.test(l)))
})
