// Regional NFL coverage from 506sports' weekly maps (lib/coverage.js,
// web/nfl/coverage-core.js). The page is a real one (2026 week 3); the maps
// are made here, a PNG of two colours, so the reading is tested without
// committing 506sports' images.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { parseWeekPage, swatchAt, swatchColors, weekCoverage, DMA_POINTS } from '../lib/coverage.js'
import { decodePng } from '../lib/png.js'
import { coverageOf, matchupIs, nameMatches } from '../web/nfl/coverage-core.js'

const page = readFileSync(new URL('./fixtures/506/2026-wk3.html', import.meta.url), 'utf8')

// A PNG, RGB, from a function of (x, y) to [r, g, b].
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (kind, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]) }
function png(width, height, color) {
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
	const raw = Buffer.alloc(height * (width * 3 + 1))
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(color(x, y), y * (width * 3 + 1) + 1 + x * 3)
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

test('a week\'s page: national games and their simulcasts, regional windows and their legends', () => {
	const { national, regional } = parseWeekPage(page)
	const tnf = national.find((n) => n.matchup === 'Atlanta @ Green Bay')
	assert.equal(tnf.network, 'Prime Video')
	// The Packers' Thursday game over the air in their home markets -- not Wausau.
	assert.deepEqual(tnf.simulcasts.map((s) => s.market), ['Atlanta', 'Green Bay', 'Milwaukee'])
	assert.deepEqual(tnf.simulcasts[1], { call: 'WGBA', net: 'NBC', market: 'Green Bay' })
	assert.deepEqual(regional.map((r) => `${r.network} ${r.window}`), ['CBS EARLY', 'CBS LATE', 'FOX SINGLE'])
	// A matchup with markup of its own, a game abroad.
	assert.deepEqual(regional[1].games.map((g) => g.matchup), ['Baltimore vs Dallas (in Rio de Janeiro)', 'Las Vegas @ New Orleans'])
})

test('a market\'s game is the swatch at its point, by majority, hatching and all', () => {
	const map = decodePng(png(40, 40, (x, y) => (x < 20 ? ((x + y) % 6 < 2 ? [205, 116, 116] : [255, 129, 129]) : [131, 172, 255])))
	const hatched = decodePng(png(10, 10, (x, y) => ((x + y) % 6 < 2 ? [205, 116, 116] : [255, 129, 129])))
	const plain = decodePng(png(10, 10, () => [131, 172, 255]))
	const swatches = [[1, swatchColors(hatched)], [2, swatchColors(plain)]]
	assert.equal(swatchAt(map, [8, 20], swatches), 1)
	assert.equal(swatchAt(map, [32, 20], swatches), 2)
	// A colour no swatch has: no answer, not a guess.
	const grey = decodePng(png(40, 40, () => [128, 128, 128]))
	assert.equal(swatchAt(grey, [20, 20], swatches), null)
})

test('a week\'s coverage reads each market off the map', async () => {
	// Week 3's FOX SINGLE map, made: the west of Wausau in swatch 1's colour,
	// the rest in swatch 2's.
	const files = {
		'nfl.php?yr=2026&wk=3': Buffer.from(page),
		'nfl/swatches/1.png': png(10, 10, () => [158, 229, 158]),
		'nfl/swatches/2.png': png(10, 10, () => [255, 255, 130]),
	}
	const fetchBuffer = async (url) => {
		const path = url.replace('https://506sports.com/', '')
		if (files[path]) return files[path]
		if (path.startsWith('2026/')) return png(1280, 720, (x) => (x < DMA_POINTS.Wausau[0] - 20 ? [158, 229, 158] : [255, 255, 130]))
		return null
	}
	const c = await weekCoverage(2026, 3, { fetchBuffer })
	const fox = c.regional.find((r) => r.network === 'FOX')
	const bySwatch = (n) => parseWeekPage(page).regional[2].games.find((g) => g.swatch === n).matchup
	assert.equal(fox.byDma.Minneapolis, bySwatch(1))
	assert.equal(fox.byDma.Wausau, bySwatch(2))
	assert.equal(fox.byDma['Green Bay'], bySwatch(2))
})

const event = (away, home, network = 'CBS') => ({
	competitions: [{ competitors: [{ team: { displayName: away } }, { team: { displayName: home } }], broadcasts: [{ media: { shortName: network } }] }],
})

test('506sports\' names are clubs', () => {
	assert.ok(nameMatches('NY Jets', 'New York Jets'))
	assert.ok(nameMatches('LA Rams', 'Los Angeles Rams'))
	assert.ok(nameMatches('Green Bay', 'Green Bay Packers'))
	assert.ok(!nameMatches('NY Giants', 'New York Jets'))
	assert.ok(matchupIs('Indianapolis @ Minnesota', event('Indianapolis Colts', 'Minnesota Vikings')))
	assert.ok(matchupIs('Pittsburgh vs New Orleans (in Paris)', event('Pittsburgh Steelers', 'New Orleans Saints')))
})

test('a regional game is carried, not carried, or depends on a market not given', () => {
	const coverage = {
		url: 'https://506sports.com/nfl.php?yr=2026&wk=7',
		regional: [{ network: 'CBS', window: 'SINGLE', map: 'm.png', games: ['Indianapolis @ Minnesota', 'Cincinnati @ Baltimore'],
			byDma: { Wausau: 'Indianapolis @ Minnesota', 'Green Bay': 'Cincinnati @ Baltimore' } },
		{ network: 'CBS', window: 'LATE', games: ['Denver @ Arizona'], byDma: {} }],
		national: [{ matchup: 'Atlanta @ Green Bay', network: 'Prime Video', simulcasts: [{ call: 'WGBA', net: 'NBC', market: 'Green Bay' }] }],
	}
	const colts = event('Indianapolis Colts', 'Minnesota Vikings')
	assert.deepEqual(coverageOf(coverage, colts, 'Wausau'), { regional: true, network: 'CBS', map: 'm.png', carried: true, other: null })
	assert.equal(coverageOf(coverage, colts, 'Green Bay').carried, false)
	assert.equal(coverageOf(coverage, colts, 'Green Bay').other, 'Cincinnati @ Baltimore')
	assert.equal(coverageOf(coverage, colts, null).carried, null)
	// A window of one game is every station's.
	assert.equal(coverageOf(coverage, event('Denver Broncos', 'Arizona Cardinals'), 'Wausau'), null)
	// A streaming game simulcast in the home markets: Green Bay's, not Wausau's.
	const tnf = event('Atlanta Falcons', 'Green Bay Packers', 'Prime Video')
	assert.equal(coverageOf(coverage, tnf, 'Green Bay').simulcast, 'WGBA/NBC')
	assert.equal(coverageOf(coverage, tnf, 'Wausau').simulcast, null)
})
