import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {
	listingsBody, saveProvider, deleteProvider, addProvider, addArea, deleteArea, saveNetwork, addNetwork, deleteNetwork, recentChanges,
} from '../lib/tv-listings.js'
import { tvLogoFor } from '../lib/web.js'

// The full listings on /admin/channels (Ray, 2026-10-21: "can the admin see
// the full channel listings?"): everything editable and deletable, and logged.

const TV = {
	providers: [
		{ id: 'amherst', displayName: 'Amherst <Comm>', alternateNames: ['Union Telephone'], websiteUrl: 'https://amherstcomm.net/', logoUrl: 'logos/AmherstComm.svg', displayLogo: true },
		{ id: 'directv', displayName: 'DirecTV', alternateNames: [] },
	],
	areas: [{ providerId: 'amherst', position: 0, name: 'Portage' }, { providerId: 'amherst', position: 1, name: 'Waushara' }],
	networks: [{ id: 1, key: 'FOX', club: null, displayName: 'FOX', kind: 'broadcast', aliases: [] }, { id: 3, key: 'Brewers.TV', club: 'mlb/brewers', displayName: 'Brewers.TV', kind: 'regional', aliases: [] }],
	channels: [
		{ providerId: 'amherst', networkId: 1, area: 0, channel: '11 (WZAW)' },
		{ providerId: 'amherst', networkId: 3, area: null, channel: '16' },
		{ providerId: 'directv', networkId: 1, area: null, channel: '7' },
	],
}

test('every provider, its areas and every network\'s channel per area are on the page', () => {
	const html = listingsBody(TV)
	assert.equal((html.match(/class="tvl-provider"/g) ?? []).length, 2)
	assert.ok(html.includes('Amherst &lt;Comm&gt;') && !html.includes('Amherst <Comm>'))
	assert.match(html, /<th>Every area<\/th><th>Portage<\/th><th>Waushara<\/th>/)
	assert.match(html, /name="ch_1_0" value="11 \(WZAW\)"/)
	assert.match(html, /name="ch_3_all" value="16"/)
	assert.match(html, /name="ch_1_1" value=""/, 'an empty cell to fill')
	// A provider with no areas has one column.
	const directv = html.slice(html.indexOf('id="p-directv"'))
	assert.match(directv, /<th>Network<\/th><th>Channel<\/th><\/tr>/)
	assert.match(directv, /name="ch_1_all" value="7"/)
	// Each delete asks first.
	assert.match(html, /formaction="\/admin\/providers\/amherst\/delete" formnovalidate onclick="return confirm\(/)
	assert.match(html, /formaction="\/admin\/providers\/amherst\/areas\/1\/delete"/)
	assert.match(html, /formaction="\/admin\/networks\/1\/delete"/)
	assert.ok(html.includes('data-search="amherst &lt;comm&gt; amherst union telephone portage waushara"'), 'search misses a name')
})

test('a provider\'s logo is every club\'s', () => {
	assert.ok(tvLogoFor('logos/AmherstComm.svg'), 'the shared logo is not found')
	assert.equal(tvLogoFor('logos/../../server.js'), null)
})

// Against the database, inside a transaction rolled back after. These write
// no COMMIT of their own; the route's transaction is lib/tv-admin.js inTx.
const DATABASE_URL = process.env.DATABASE_URL
test('saving, adding and deleting change the tables and log each change', { skip: !DATABASE_URL && 'no DATABASE_URL — the writes are not covered' }, async () => {
	const c = new pg.Client({ connectionString: DATABASE_URL })
	await c.connect()
	const one = async (q, p) => (await c.query(q, p)).rows[0]
	try {
		await c.query('BEGIN')
		const fox = (await one("SELECT id FROM tv_network WHERE key = 'FOX' AND club IS NULL")).id
		const espn = (await one("SELECT id FROM tv_network WHERE key = 'ESPN' AND club IS NULL")).id
		const p = await one("SELECT * FROM tv_provider WHERE id = 'amherst'")
		const base = {
			display_name: p.display_name, alternate_names: [...p.alternate_names, 'Test Name'].join(', '), website_url: p.website_url ?? '', lineup_url: p.lineup_url ?? '',
			logo_url: '/logos/AmherstComm.svg', logo_bg: p.logo_bg ?? '', ...(p.display_logo ? { display_logo: 'on' } : {}),
			area_0: 'Portage, Marathon, or Adams County', area_1: 'Waushara or Waupaca County', area_2: 'Marquette County',
		}
		// The logo is kept relative, whichever way it was typed.
		let r = await saveProvider(c, 'amherst', { ...base, [`ch_${fox}_1`]: '2 (WLUK)', [`ch_${espn}_all`]: '' })
		assert.ok(!r.errors, JSON.stringify(r.errors))
		assert.equal((await one("SELECT logo_url FROM tv_provider WHERE id = 'amherst'")).logo_url, 'logos/AmherstComm.svg')
		assert.equal((await one('SELECT channel FROM tv_channel WHERE provider_id = $1 AND network_id = $2 AND area = 1', ['amherst', fox])).channel, '2 (WLUK)')
		assert.equal(await one('SELECT channel FROM tv_channel WHERE provider_id = $1 AND network_id = $2 AND area IS NULL', ['amherst', espn]), undefined, 'an emptied cell left its channel')
		// Saved again unchanged, nothing changes.
		assert.deepEqual(await saveProvider(c, 'amherst', { ...base, logo_url: 'logos/AmherstComm.svg', [`ch_${fox}_0`]: '11 (WZAW)', [`ch_${fox}_1`]: '2 (WLUK)', [`ch_${fox}_2`]: '1 (WMSN)' }), { changed: 0 })
		assert.ok((await saveProvider(c, 'amherst', { ...base, display_name: '' })).errors)
		assert.ok((await saveProvider(c, 'amherst', { ...base, website_url: 'javascript:alert(1)' })).errors)
		// Areas: added at the end; a deleted one takes its channels, and the
		// ones after it close up.
		assert.deepEqual(await addArea(c, 'amherst', 'Test Area'), { position: 3 })
		assert.ok((await addArea(c, 'amherst', 'test area')).errors, 'the same area twice')
		assert.equal(await deleteArea(c, 'amherst', 1), true)
		const areas = (await c.query("SELECT position, name FROM tv_area WHERE provider_id = 'amherst' ORDER BY position")).rows
		assert.deepEqual(areas.map((a) => `${a.position} ${a.name}`), ['0 Portage, Marathon, or Adams County', '1 Marquette County', '2 Test Area'])
		assert.equal((await one('SELECT channel FROM tv_channel WHERE provider_id = $1 AND network_id = $2 AND area = 1', ['amherst', fox])).channel, '1 (WMSN)', 'Marquette\'s channel moved with it')
		// Providers and networks.
		const added = await addProvider(c, 'Test Provider')
		assert.equal(added.id, 'test_provider')
		assert.equal(await deleteProvider(c, 'test_provider'), true)
		const net = await addNetwork(c, { key: 'Test Net', kind: 'regional' })
		assert.deepEqual(await saveNetwork(c, net.id, { key: 'Test Net', display_name: 'Test Network', kind: 'regional' }), { changed: 1 })
		assert.ok((await saveNetwork(c, net.id, { key: 'Test Net', club: 'not a club' })).errors)
		assert.equal(await deleteNetwork(c, net.id), true)
		const log = (await recentChanges(c, 50)).map((x) => x.action)
		for (const a of ['provider.edit', 'channel.set', 'channel.clear', 'area.add', 'area.delete', 'provider.add', 'provider.delete', 'network.add', 'network.edit', 'network.delete']) {
			assert.ok(log.includes(a), `${a} was not logged`)
		}
		// A deleted provider's log entry says what it had.
		const gone = await one("SELECT before FROM tv_change WHERE action = 'area.delete' ORDER BY id DESC LIMIT 1")
		assert.equal(gone.before.name, 'Waushara or Waupaca County')
		assert.ok(gone.before.channels.some((x) => x.channel === '2 (WLUK)'))
	} finally {
		await c.query('ROLLBACK').catch(() => {})
		await c.end()
	}
})
