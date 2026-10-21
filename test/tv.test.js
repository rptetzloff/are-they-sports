import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { channelLookupCsv, providerLookupCsv, simulcastsCsv, readTv } from '../lib/tv.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
globalThis.CLUB = { team: 'x', fullName: 'x', teamIds: [], copy: {}, site: {} }
const { parseTvLookup, providerChannel } = await import('../web/mlb/tv-core.js')

// TV providers and channels moved from the Brewers' spreadsheets into the
// database, shared by every club (Ray, 2026-10-21).

const TV = {
	providers: [
		{ id: 'amherst', displayName: 'Amherst Communications', alternateNames: ['Union Telephone Company', 'Tomorrow Valley, "TVC"'], websiteUrl: 'https://amherstcomm.net/', lineupUrl: '', logoUrl: '', logoBg: '', displayLogo: true },
		{ id: 'directv', displayName: 'DirecTV', alternateNames: [], websiteUrl: '', lineupUrl: '', logoUrl: '', logoBg: '', displayLogo: false },
	],
	areas: [
		{ providerId: 'amherst', position: 0, name: 'Portage' },
		{ providerId: 'amherst', position: 1, name: 'Waushara' },
		{ providerId: 'amherst', position: 2, name: 'Marquette' },
	],
	networks: [
		{ id: 1, key: 'FOX', club: null, aliases: [], displayName: 'FOX', kind: 'broadcast', description: 'Free over-the-air broadcast', websiteUrl: '' },
		{ id: 2, key: 'ESPN', club: null, aliases: ['ESPN HD'], displayName: 'ESPN', kind: 'cable', description: '', websiteUrl: '' },
		{ id: 3, key: 'Brewers.TV', club: 'mlb/brewers', aliases: [], displayName: 'Brewers.TV', kind: 'regional', description: '', websiteUrl: '' },
	],
	channels: [
		{ providerId: 'amherst', networkId: 1, area: 0, channel: '11 (WZAW)' },
		{ providerId: 'amherst', networkId: 1, area: 2, channel: '1 (WMSN)' },
		{ providerId: 'amherst', networkId: 2, area: null, channel: '33' },
		{ providerId: 'directv', networkId: 2, area: null, channel: '206' },
		{ providerId: 'amherst', networkId: 3, area: null, channel: '16' },
	],
}

test('a club\'s file lists everyone\'s networks and its own, not another club\'s', () => {
	const brewers = parseTvLookup(channelLookupCsv(TV, 'mlb/brewers'), providerLookupCsv(TV))
	const cubs = parseTvLookup(channelLookupCsv(TV, 'mlb/cubs'), providerLookupCsv(TV))
	assert.ok(brewers.channels['Brewers.TV'])
	assert.equal(cubs.channels['Brewers.TV'], undefined)
	assert.equal(providerChannel(cubs, 'directv', 'ESPN'), '206')
	assert.equal(providerChannel(cubs, 'directv', 'ESPN HD'), '206', 'an alias reaches its network')
})

test('an area without the channel is not carried there, and does not borrow a neighbour\'s', () => {
	const lookup = parseTvLookup(channelLookupCsv(TV, 'mlb/cubs'), providerLookupCsv(TV))
	assert.deepEqual(lookup.providers.amherst.service_areas, ['Portage', 'Waushara', 'Marquette'])
	assert.equal(providerChannel(lookup, 'amherst', 'FOX', 0), '11 (WZAW)')
	assert.equal(providerChannel(lookup, 'amherst', 'FOX', 1), null)
	assert.equal(providerChannel(lookup, 'amherst', 'FOX', 2), '1 (WMSN)')
	// One channel for every area is that channel in each.
	assert.equal(providerChannel(lookup, 'amherst', 'ESPN', 1), '33')
})

test('names with commas and quotes survive the file', () => {
	const lookup = parseTvLookup(channelLookupCsv(TV, 'mlb/cubs'), providerLookupCsv(TV))
	assert.equal(lookup.providers.amherst.alternate_name, 'Union Telephone Company,Tomorrow Valley, "TVC"')
	assert.equal(lookup.providers.amherst.displayLogo, true)
	assert.equal(lookup.providers.directv.displayLogo, false)
	assert.equal(simulcastsCsv([{ date: '2026-08-04', channels: 'Simulcast', note: 'vs Pittsburgh, at night' }]),
		'date,channels,note\n2026-08-04,Simulcast,"vs Pittsburgh, at night"\n')
})

// The seed against the spreadsheets it replaced (test/fixtures/brewers-tv):
// every provider, area and channel number the Brewers' page read before, it
// reads now.
const DATABASE_URL = process.env.DATABASE_URL
test('the migration\'s seed is the Brewers\' spreadsheets', { skip: !DATABASE_URL && 'no DATABASE_URL — the seed is not compared' }, async () => {
	const pool = new pg.Pool({ connectionString: DATABASE_URL })
	let tv
	try { tv = await readTv(pool) } finally { await pool.end() }
	const before = parseTvLookup(read('test/fixtures/brewers-tv/channel_lookup.csv'), read('test/fixtures/brewers-tv/provider_lookup.csv'))
	const after = parseTvLookup(channelLookupCsv(tv, 'mlb/brewers'), providerLookupCsv(tv))
	assert.deepEqual(Object.keys(after.providers).sort(), Object.keys(before.providers).sort())
	let compared = 0
	for (const [pk, p] of Object.entries(before.providers)) {
		assert.deepEqual(after.providers[pk].service_areas, p.service_areas, pk)
		for (const net of Object.keys(before.channels)) {
			for (let a = 0; a < Math.max(1, p.service_areas.length); a++) {
				assert.equal(providerChannel(after, pk, net, a), providerChannel(before, pk, net, a), `${pk} ${net} area ${a}`)
				compared++
			}
		}
	}
	assert.ok(compared >= 600, `only ${compared} compared`)
})

test('a club without the TV tables yet still has its page', async () => {
	// Coolify deploys before the migration is run; the page must not wait on it.
	const { createFront } = await import('../lib/web-routes.js')
	const { loadSports, loadTeams } = await import('../lib/teams.js')
	const { loadHistory, resolver } = await import('../lib/names.js')
	const teams = await loadTeams()
	const adapters = await loadSports()
	const front = await createFront({
		team: teams.find((t) => t.sport === 'nhl' && t.id === 'wild'), franchise: 'MIN', adapter: adapters.nhl, namer: resolver('nhl'),
		history: loadHistory('nhl'), currentCodes: new Set(), palette: null, base: '/nhl/wild', clubs: [],
		store: {
			rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map(),
			tvTables: async () => { throw new Error('relation "tv_provider" does not exist') },
		},
		creditHtml: '', origin: () => 'http://x',
	})
	const url = new URL('http://x/data/provider_lookup.csv')
	let body = null
	const res = { writeHead() {}, end(b) { body = String(b) } }
	assert.equal(await front({ headers: {} }, res, url.pathname, url, () => {}), true)
	assert.match(body, /^provider,display_name/)
})

// --- football's picker (web/nfl/tv-ui.js) -------------------------------------

test('football\'s page has the picker\'s bar and dialogs, and its own methods win', async () => {
	const html = read('web/nfl/index.html')
	for (const id of ['schedule-provider-bar', 'watch-modal', 'watch-channels', 'provider-modal', 'provider-picker-container']) {
		assert.ok(html.includes(`id="${id}"`), `no #${id}`)
	}
	const { installTvUi } = await import('../web/nfl/tv-ui.js')
	class Page { refreshAnswerNote() { return 'mine' } }
	installTvUi(Page)
	const p = new Page()
	assert.equal(p.refreshAnswerNote(), 'mine', 'the module overwrote a method the page defines')
	for (const m of ['loadTv', 'openWatchModal', 'renderScheduleProviderBar', 'scheduleChannelNumber', 'getTvStatus', 'calendarRowEl']) {
		assert.equal(typeof p[m], 'function', `${m} was not installed`)
	}
})

test('football\'s club is served the same TV files', async () => {
	const { createFront } = await import('../lib/web-routes.js')
	const { loadSports, loadTeams } = await import('../lib/teams.js')
	const { loadHistory, resolver } = await import('../lib/names.js')
	const teams = await loadTeams()
	const adapters = await loadSports()
	const front = await createFront({
		team: teams.find((t) => t.sport === 'nfl' && t.id === 'packers'), franchise: 'GB', adapter: adapters.nfl, namer: resolver('nfl'),
		history: loadHistory('nfl'), currentCodes: new Set(), palette: null, base: '/nfl/packers', clubs: [],
		store: { rawGamesFor: async () => [], standingsTitles: async () => [], finalRounds: async () => new Map(), tvTables: async () => TV, simulcastsFor: async () => [] },
		creditHtml: '', origin: () => 'http://x',
	})
	const get = async (path) => {
		const url = new URL(`http://x${path}`)
		let body = null
		const res = { writeHead() {}, end(b) { body = String(b) } }
		const handled = await front({ headers: {} }, res, url.pathname, url, () => {})
		return { handled, body }
	}
	const ch = await get('/data/channel_lookup.csv')
	assert.equal(ch.handled, true)
	assert.ok(ch.body.includes('ESPN') && !ch.body.includes('Brewers.TV'), 'football got everyone\'s networks and not the Brewers\' own')
	assert.match((await get('/data/provider_lookup.csv')).body, /^provider,display_name/)
	assert.match((await get('/data/simulcasts.csv')).body, /^date,channels,note/)
})
