// Hockey's head coaches: the curated file (data/reference/nhl-coaches.csv,
// seeded by scripts/wiki-coaches.mjs), the tally of stated tenures with
// overtime losses, and the pages' reading of data/coaches.json.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.js'
import { tallyTenures, mergeLeaders, numberLeaders } from '../lib/leaders.js'
import { coachesJson } from '../lib/web-routes.js'

const { coachesFromJson, recOtl } = await import('../web/nhl/coaches-core.js')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/nhl-coaches.csv'), 'utf8'))
const CLUBS = ['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
	'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH']

test('every row of the hockey file is a tenure the loader can write', () => {
	assert.ok(rows.length > 600, `only ${rows.length} rows`)
	for (const r of rows) {
		assert.ok(r.leaderId && r.name, `a row has no id or name: ${JSON.stringify(r)}`)
		assert.ok(CLUBS.includes(r.franchiseAbbrv), `${r.name}: ${r.franchiseAbbrv} is no club`)
		assert.ok(Number(r.firstSeason) >= 1918 && Number(r.lastSeason) >= Number(r.firstSeason), `${r.name} ${r.firstSeason}-${r.lastSeason}`)
		for (const k of ['w', 'l', 't', 'otl', 'playoffW', 'playoffL']) assert.ok(Number(r[k]) >= 0, `${r.name} ${k} ${r[k]}`)
		assert.ok(['counted', 'transcribed'].includes(r.basis), `${r.name} basis ${r.basis}`)
	}
})

test('no two hockey tenures share leader_tenure\'s key', () => {
	// (franchise, leader, first season): a duplicate drops a coach at load.
	const seen = new Set()
	for (const r of rows) {
		const key = `${r.franchiseAbbrv}|${r.leaderId}|${r.firstSeason}`
		assert.ok(!seen.has(key), `twice: ${key}`)
		seen.add(key)
	}
})

test('Scotty Bowman comes to the NHL\'s 1,244 wins and nine Cups', () => {
	// The anchor for the split terms (Buffalo, Detroit's Dave Lewis) and the
	// by-hand rest of 1981-82: each was once a dozen wins or a Cup out.
	const his = rows.filter((r) => r.leaderId === 'bowman-scotty')
	assert.equal(his.reduce((s, r) => s + Number(r.w), 0), 1244)
	assert.deepEqual(his.flatMap((r) => (r.titleSeasons ? r.titleSeasons.split(' ') : [])).map(Number).sort(),
		[1973, 1976, 1977, 1978, 1979, 1992, 1997, 1998, 2002])
})

test('a stated tenure carries its overtime losses into the tally', () => {
	const [r] = tallyTenures([
		{ leader: 'trotz-barry', name: 'Barry Trotz', franchise: 'NSH', firstSeason: 1999, lastSeason: 2014, w: 557, l: 479, t: 60, otl: 100, playoffW: 19, playoffL: 31 },
		{ leader: 'trotz-barry', name: 'Barry Trotz', franchise: 'WSH', firstSeason: 2015, lastSeason: 2018, w: 205, l: 89, t: 0, otl: 34, playoffW: 36, playoffL: 24, titleSeasons: ['2018'] },
	])
	assert.equal(r.otl, 134)
	assert.equal(r.games, 557 + 479 + 60 + 100 + 19 + 31 + 205 + 89 + 34 + 36 + 24)
	// An overtime loss is a game not won.
	assert.equal(r.winPct, (762 + 30) / (762 + 568 + 60 + 134))
	const [merged] = mergeLeaders([], [r])
	assert.equal(merged.otl, 134)
})

test('a coach who stood in once and held the job is no interim', () => {
	const tally = tallyTenures([
		{ leader: 'clancy-king', name: 'King Clancy', franchise: 'TOR', firstSeason: 1954, lastSeason: 1956, w: 67, l: 73, t: 30, interim: false },
		{ leader: 'clancy-king', name: 'King Clancy', franchise: 'TOR', firstSeason: 1966, lastSeason: 1966, w: 7, l: 1, t: 2, interim: true },
		{ leader: 'horachek-peter', name: 'Peter Horachek', franchise: 'TOR', firstSeason: 2015, lastSeason: 2015, w: 9, l: 28, t: 0, otl: 5, interim: true },
	])
	const by = new Map(numberLeaders(tally).map((r) => [r.leader, r]))
	assert.equal(by.get('clancy-king').interim, false)
	assert.equal(by.get('horachek-peter').interim, true)
	assert.equal(by.get('horachek-peter').label, '1.1')
})

test('the pages read coaches.json: a row a person, a band a spell', () => {
	const tenures = [
		{ leader: 'johnston-eddie', name: 'Eddie Johnston', franchise: 'PIT', firstSeason: 1981, lastSeason: 1983, w: 79, l: 126, t: 35, otl: 0, playoffW: 4, playoffL: 6 },
		{ leader: 'johnston-eddie', name: 'Eddie Johnston', franchise: 'PIT', firstSeason: 1994, lastSeason: 1997, w: 153, l: 98, t: 25, otl: 0, playoffW: 18, playoffL: 18 },
		{ leader: 'sullivan-mike', name: 'Mike Sullivan', franchise: 'PIT', firstSeason: 2016, lastSeason: 2025, w: 409, l: 255, t: 0, otl: 87, playoffW: 44, playoffL: 37, titleSeasons: ['2016', '2017'] },
	]
	const { coaches, eras } = coachesFromJson(JSON.parse(JSON.stringify(coachesJson([], tenures))))
	assert.equal(coaches.length, 2)
	const sully = coaches.find((c) => c.name === 'Mike Sullivan')
	assert.equal(sully.record, '409–255–0–87')
	assert.equal(sully.titles, 2)
	assert.equal(sully.tenure, '2015–2025')
	// Johnston's two spells are two bands with their own seasons and slugs.
	const ej = eras.filter((e) => e.name === 'Eddie Johnston')
	assert.deepEqual(ej.map((e) => [e.tenure, e.slug, e.fromDate, e.toDate]),
		[['1980–1983', 'eddie-johnston', 1980.5, 1983.5], ['1993–1997', 'eddie-johnston-2', 1993.5, 1997.5]])
	assert.equal(ej[0].record, '232–224–60')
	// His row names both spells, not a run over everyone between.
	assert.equal(coaches.find((c) => c.name === 'Eddie Johnston').tenure, '1980–1983, 1993–1997')
})

test('a season two coaches shared is split between their bands, not drawn twice', () => {
	const tenures = [
		{ leader: 'johnston-mike', name: 'Mike Johnston', franchise: 'PIT', firstSeason: 2015, lastSeason: 2016, w: 58, l: 37, t: 0, otl: 15 },
		{ leader: 'sullivan-mike', name: 'Mike Sullivan', franchise: 'PIT', firstSeason: 2016, lastSeason: 2025, w: 409, l: 255, t: 0, otl: 87 },
		// A one-season spell shared at both ends keeps a band.
		{ leader: 'hughes-rex', name: 'Rex Hughes', franchise: 'PIT', firstSeason: 2016, lastSeason: 2016, w: 1, l: 0, t: 0, otl: 0 },
	]
	const { eras } = coachesFromJson(JSON.parse(JSON.stringify(coachesJson([], tenures))))
	const band = (name) => { const e = eras.find((x) => x.name === name); return [e.fromDate, e.toDate] }
	assert.deepEqual(band('Mike Johnston'), [2014.5, 2016])
	assert.deepEqual(band('Mike Sullivan'), [2016, 2025.5])
	assert.deepEqual(band('Rex Hughes'), [2015.75, 2016.25])
})

test('a record shows overtime losses only where there are some', () => {
	assert.equal(recOtl(10, 5, 0, 0), '10–5')
	assert.equal(recOtl(10, 5, 2, 0), '10–5–2')
	assert.equal(recOtl(10, 5, 0, 3), '10–5–0–3')
})

test('the tenure column is the lists\' own terms, and a new hire has no record yet', () => {
	// Doc Rivers was hired in January 2024: his seasons run from 2023-24, his
	// term from 2024. Taylor Jenkins was hired for the season being played.
	const tenures = [
		{ leader: 'griffin-adrian', name: 'Adrian Griffin', franchise: 'MIL', firstSeason: 2024, lastSeason: 2024, w: 30, l: 13, t: 0, otl: 0, term: '2023–2024' },
		{ leader: 'rivers-doc', name: 'Doc Rivers', franchise: 'MIL', firstSeason: 2024, lastSeason: 2026, w: 97, l: 103, t: 0, otl: 0, term: '2024–2026' },
		{ leader: 'prunty-joe', name: 'Joe Prunty', franchise: 'MIL', firstSeason: 2018, lastSeason: 2018, w: 21, l: 16, t: 0, otl: 0, term: '2018' },
		{ leader: 'prunty-joe', name: 'Joe Prunty', franchise: 'MIL', firstSeason: 2024, lastSeason: 2024, w: 2, l: 1, t: 0, otl: 0, term: '2024' },
		{ leader: 'jenkins-taylor', name: 'Taylor Jenkins', franchise: 'MIL', firstSeason: 2027, lastSeason: 2027, w: 0, l: 0, t: 0, otl: 0, term: '2026–present' },
	]
	const { coaches, eras } = coachesFromJson(JSON.parse(JSON.stringify(coachesJson([], tenures))))
	const by = new Map(coaches.map((c) => [c.name, c]))
	assert.equal(by.get('Doc Rivers').tenure, '2024–2026')
	assert.equal(by.get('Joe Prunty').tenure, '2018, 2024')
	assert.equal(by.get('Taylor Jenkins').tenure, '2026–present')
	assert.equal(by.get('Taylor Jenkins').record, '—')
	assert.equal(eras.find((e) => e.name === 'Doc Rivers').tenure, '2024–2026')
})
