// The NCAA tournament's bracket (Ray, 2026-10-27): walked back from the
// final, seeded from 1979, its regions named from the games' titles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBracket, regionCells, regionOf, bracketPage, ncaamSeeds, nitGames } from '../lib/bracket.js'
import { siteFooterHtml } from '../lib/render.js'
import { parseCsv } from '../lib/csv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// Eight teams, two regions of two rounds each: A1 beats A8 and A4 beats A5 on
// the 1st, A1 beats A4 on the 3rd; the same in B; A1 beats B2 in the final.
// A third-place game and a First Four game feed nothing.
const g = (id, date, stage, home, away, homeScore, awayScore, title = '') => ({ id, date, stage, home, away, homeScore, awayScore, title })
const games = [
	g('1', '2025-03-01', 'R64', 'A8', 'A1', 50, 60, 'EAST REGIONAL'),
	g('2', '2025-03-01', 'R64', 'A4', 'A5', 70, 65, 'EAST REGIONAL'),
	g('3', '2025-03-01', 'R64', 'B2', 'B7', 80, 60, 'ATLANTA REGIONAL AT DALLAS'),
	g('4', '2025-03-01', 'R64', 'B3', 'B6', 60, 61, 'ATLANTA REGIONAL AT DALLAS'),
	g('5', '2025-03-03', 'E8', 'A4', 'A1', 70, 72, 'EAST REGIONAL'),
	g('6', '2025-03-03', 'E8', 'B6', 'B2', 55, 75, ''),
	g('7', '2025-03-05', 'FINAL', 'B2', 'A1', 68, 70, 'CHAMPIONSHIP'),
	g('8', '2025-03-05', 'THIRD', 'A4', 'B6', 1, 0),
	g('9', '2025-02-28', 'FF', 'X', 'A8', 50, 51),
]
const seeds = new Map([['1', { home: 8, away: 1, city: 'Albany' }], ['2', { home: 4, away: 5 }], ['6', { home: 6, away: 2, city: 'Dallas' }]])

test('the bracket is walked back from the final, each side from the last game it won', () => {
	const b = buildBracket(games, { seeds, finalId: '7' })
	assert.deepEqual(b.final.sides.map((s) => [s.team, s.won]), [['A1', true], ['B2', false]])
	// Two regions feeding the final directly: no national semifinals.
	assert.deepEqual(b.semis, [])
	assert.deepEqual(b.regions.map((r) => r.top.game.id), ['5', '6'])
	const east = b.regions[0].top
	assert.deepEqual(east.sides.map((s) => s.from.game.id), ['1', '2'], 'the 1 seed\'s line on top')
	assert.equal(east.sides[0].from.sides[0].team, 'A1')
	assert.equal(east.sides[0].from.sides[0].from, null, 'a First Four win feeds no bracket game')
	assert.deepEqual(b.firstFour.map((x) => x.id), ['9'])
	assert.deepEqual(b.third.map((x) => x.id), ['8'])
	assert.equal(b.seedOf.get('A1'), 1)
	assert.equal(buildBracket(games.filter((x) => x.stage !== 'FINAL')), null, 'no final, no bracket')
})

test('a region is named as its games\' titles name it', () => {
	const b = buildBracket(games, { seeds, finalId: '7' })
	assert.deepEqual(b.regions.map((r) => r.name), ['East', 'Atlanta regional'])
	assert.equal(regionOf("NCAA Men's Tourn., Far West - First Round"), 'Far West')
	assert.equal(regionOf("Men's Basketball Championship - South Region - First Four"), 'South')
	assert.equal(regionOf('EAST RUTHERFORD REGION'), 'East Rutherford regional', 'not the East')
	assert.equal(regionOf('WASHINGTON DC REGIONAL AT SAN DIEGO'), 'Washington DC regional')
	assert.equal(regionOf('FINAL FOUR'), null)
})

test('a region\'s games sit level with the two they follow', () => {
	const b = buildBracket(games, { seeds, finalId: '7' })
	const { cols, rows, cells } = regionCells(b.regions[0].top)
	assert.equal(cols, 2)
	assert.equal(rows, 4)
	assert.deepEqual(cells.map((c) => [c.node.game.id, c.col, c.row, c.span]), [['1', 1, 1, 2], ['2', 1, 3, 2], ['5', 2, 1, 4]])
})

test('the page: champion, rounds, seeds and each side linked', () => {
	const b = buildBracket(games, { seeds, finalId: '7' })
	const html = bracketPage({ season: 2025, seasons: [2024, 2025], bracket: b, heading: '2025 NCAA Tournament', colors: { base: '#222', accent: '#fff' },
		team: (code) => ({ name: code, href: code === 'A1' ? '/ncaam/a1/2025' : null }) })
	assert.match(html, /A1 beat B2 70–68 for the title/)
	assert.match(html, /<span class="sd">1<\/span><span class="nm"><a href="\/ncaam\/a1\/2025">A1<\/a>/)
	// Whole paths, which work from /ncaam/bracket as from /ncaam/bracket/2025.
	// Each season named as the club pages name it, 2023-2024; its path the
	// year its tournament was played, as theirs.
	assert.match(html, /href="\/ncaam\/bracket\/2024">‹ 2023-2024</)
	assert.match(html, /<option value="\/ncaam\/bracket\/2024">2023-2024</)
	assert.match(read('web/ncaam/site.js'), /seasonLabel: \(season\) => `\$\{Number\(season\) - 1\}-\$\{season\}`/, 'the club pages\' own')
	assert.match(read('server.js'), /const heading = `\$\{seasonLabel\(season\)\} /)
	assert.match(html, /<h2>First Four<\/h2>/)
	// A game with ESPN's id opens its summary; the rest are plain boxes.
	assert.doesNotMatch(html, /data-game=/, 'no summary address, no pop-up')
	const withSum = bracketPage({ season: 2025, seasons: [2025], bracket: b, heading: 'h', colors: { base: '#222', accent: '#fff' },
		team: (code) => ({ name: code, href: null }), summaryUrl: '/ncaam/api/espn/summary?event=' })
	assert.equal(withSum.match(/data-game="/g).length, games.filter((x) => x.homeScore != null).length)
	assert.match(withSum, /data-game="7" tabindex="0" role="button" aria-label="Summary: A1 vs B2"/)
	assert.match(withSum, /<dialog id="br-sum"/)
	assert.match(withSum, /"\/ncaam\/api\/espn\/summary\?event="/)
	assert.match(bracketPage({ season: 2020, seasons: [2019, 2021], bracket: null, heading: 'h', colors: { base: '#222', accent: '#fff' }, team: () => ({}) }),
		/the 2020 tournaments were cancelled/)
})

test('the NIT: its final and third-place game from the titles, drawn in two halves', () => {
	const nit = [
		g('n1', '2025-03-01', 'NIT', 'A', 'B', 70, 60, 'NIT - 1st Round'),
		g('n2', '2025-03-01', 'NIT', 'C', 'D', 70, 60, 'NIT - 1st Round'),
		g('n3', '2025-03-01', 'NIT', 'E', 'F', 70, 60, 'NIT-FIRST-ROUND'),
		g('n4', '2025-03-01', 'NIT', 'G', 'H', 70, 60, 'NIT-FIRST-ROUND'),
		g('n5', '2025-03-03', 'NIT', 'A', 'C', 70, 60, 'NIT - Semifinal'),
		g('n6', '2025-03-03', 'NIT', 'E', 'G', 70, 60, 'NIT-SEMIFINAL'),
		g('n7', '2025-03-05', 'NIT', 'C', 'G', 70, 60, 'NIT CONSOLATION'),
		g('n8', '2025-03-05', 'NIT', 'A', 'E', 75, 70, 'NIT CHAMPIONSHIP AT MADISON SQUARE GARDEN'),
		// St. Francis (PA)'s win in 1955, whose next game the record lacks.
		g('n9', '2025-03-01', 'NIT', 'X', 'Y', 70, 60, 'NIT-FIRST-ROUND'),
	]
	const staged = nitGames(nit)
	assert.deepEqual(staged.filter((x) => x.stage !== 'NIT').map((x) => [x.id, x.stage]), [['n7', 'THIRD'], ['n8', 'FINAL']])
	const b = buildBracket(staged, { halves: true })
	assert.deepEqual(b.regions.map((r) => [r.name, r.top.game.id]), [['Top half', 'n6'], ['Bottom half', 'n5']], 'the visitors\' half on top, as the final lists them')
	assert.deepEqual(b.semis, [])
	assert.deepEqual(b.third.map((x) => x.id), ['n7'])
	assert.deepEqual(b.unplaced.map((x) => x.id), ['n9'], 'listed, not dropped')
	const html = bracketPage({ season: 2025, seasons: [2025], bracket: b, heading: '2025 NIT', colors: { base: '#222', accent: '#fff' },
		team: (code) => ({ name: code, href: null }), finalTitle: 'Championship', base: '/ncaam/nit', tabs: '<nav class="br-tabs">t</nav>' })
	assert.match(html, /<h2>Championship<\/h2>\s*<div class="br-row">/)
	assert.doesNotMatch(html, /br-label">Championship/, 'said once')
	assert.match(html, /<h2>Other games<\/h2>/)
	assert.match(html, /<nav class="br-tabs">t<\/nav>/)
	// "NIT-SEMIFINAL" is no final; with no title saying so, the last game is.
	assert.equal(nitGames(nit.map((x) => ({ ...x, title: x.id === 'n8' ? 'NIT' : x.title }))).find((x) => x.stage === 'FINAL').id, 'n8')
})

test('seeds from 1979, by the loader\'s game ids, and the footer links the bracket', () => {
	const rows = parseCsv(readFileSync(join(ROOT, 'data/reference/ncaam-seeds.csv'), 'utf8'))
	assert.ok(!rows.some((r) => Number(r.season) < 1979 && r.home_seed), 'no seeds before 1979')
	const s2025 = ncaamSeeds(2025)
	assert.equal(s2025.size, 67)
	assert.ok([...s2025.values()].every((s) => s.home >= 1 && s.home <= 16 && s.away >= 1 && s.away <= 16))
	assert.match(siteFooterHtml({ sport: 'ncaam' }), /href="\/ncaam\/bracket"/)
	assert.doesNotMatch(siteFooterHtml({ sport: 'ncaaf' }), /bracket/)
})
