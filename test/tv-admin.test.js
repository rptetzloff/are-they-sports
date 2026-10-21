import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import pg from 'pg'
import {
	readForm, rateLimiter, passwordMatches, sessionValue, hasSession, sameOrigin, readSubmission,
	providerIdFor, applyChannel, decideWithin, insertSubmission, submitPage, adminPage, createTvAdmin,
} from '../lib/tv-admin.js'

// Submitting channels, and approving them (Ray, 2026-10-21): anyone submits
// with no account; Ray approves behind ADMIN_PASSWORD.

const TV = {
	providers: [{ id: 'directv', displayName: 'DirecTV' }, { id: 'amherst', displayName: 'Amherst <Communications>' }],
	areas: [{ providerId: 'amherst', position: 0, name: 'Portage' }, { providerId: 'amherst', position: 1, name: 'Waushara' }],
	networks: [{ id: 1, key: 'FOX', club: null, displayName: 'FOX' }, { id: 3, key: 'Brewers.TV', club: 'mlb/brewers', displayName: 'Brewers.TV' }],
	channels: [{ providerId: 'directv', networkId: 1, area: null, channel: '11' }],
}
const req = (headers = {}) => ({ headers, socket: { remoteAddress: '10.0.0.1' } })

test('a session is signed with the password, expires, and dies with a new password', () => {
	const now = Date.parse('2026-10-21T12:00:00Z')
	const cookie = `ats_admin=${sessionValue('hunter2', now)}`
	assert.equal(hasSession(req({ cookie }), 'hunter2', now + 3600e3), true)
	assert.equal(hasSession(req({ cookie }), 'hunter2', now + 13 * 3600e3), false, 'outlived twelve hours')
	assert.equal(hasSession(req({ cookie }), 'changed', now), false, 'survived a new password')
	const [exp, sig] = sessionValue('hunter2', now).split('.')
	assert.equal(hasSession(req({ cookie: `ats_admin=${Number(exp) + 9e9}.${sig}` }), 'hunter2', now), false, 'a longer expiry kept its signature')
	assert.equal(hasSession(req({ cookie }), undefined, now), false, 'no password signs anyone in')
	assert.equal(passwordMatches('hunter2', 'hunter2'), true)
	assert.equal(passwordMatches('hunter3', 'hunter2'), false)
	assert.equal(passwordMatches('', ''), false)
})

test('an admin action must come from this host\'s own page', () => {
	assert.equal(sameOrigin(req({ host: 'dev.aretheyon.tv', origin: 'https://dev.aretheyon.tv' })), true)
	assert.equal(sameOrigin(req({ host: 'dev.aretheyon.tv', origin: 'https://evil.example' })), false)
	assert.equal(sameOrigin(req({ host: 'dev.aretheyon.tv', referer: 'https://dev.aretheyon.tv/admin' })), true)
	assert.equal(sameOrigin(req({ host: 'dev.aretheyon.tv' })), false, 'no origin at all')
})

test('a sender is limited, and forgiven as the window passes', () => {
	let t = 0
	const ok = rateLimiter({ max: 2, windowMs: 1000, now: () => t })
	assert.deepEqual([ok('a'), ok('a'), ok('a'), ok('b')], [true, true, false, true])
	t = 1001
	assert.equal(ok('a'), true)
})

test('a form is read, and a large one refused', async () => {
	assert.deepEqual(await readForm(Readable.from([Buffer.from('a=1&b=two+words')])), { a: '1', b: 'two words' })
	assert.equal(await readForm(Readable.from([Buffer.alloc(20, 'x')]), 10), null)
})

test('a submission names what is on file by id and what is new by name', () => {
	const ok = readSubmission({ provider: 'directv', network: '1', channel: ' 11  (WLUK) ', area: 'Green Bay' }, TV)
	assert.deepEqual([ok.value.providerId, ok.value.networkId, ok.value.channel, ok.value.areaName], ['directv', 1, '11 (WLUK)', 'Green Bay'])
	const fresh = readSubmission({ provider: 'new', provider_name: 'Test Cable', network: 'new', network_name: 'FanDuel Sports North', network_kind: 'regional', channel: '42' }, TV)
	assert.deepEqual([fresh.value.providerName, fresh.value.networkName, fresh.value.networkKind], ['Test Cable', 'FanDuel Sports North', 'regional'])
	assert.equal(readSubmission({ provider: 'new', provider_name: 'X', network: 'new', network_name: 'Y', network_kind: 'bogus', channel: '1' }, TV).value.networkKind, 'cable')
	for (const [f, why] of [
		[{ provider: 'nope', network: '1', channel: '1' }, 'provider'],
		[{ provider: 'directv', network: '99', channel: '1' }, 'network'],
		[{ provider: 'directv', network: '1', channel: ' ' }, 'channel'],
		[{ provider: 'new', network: '1', channel: '1' }, 'provider'],
		[{ provider: 'directv', network: '1', channel: '1', provider_url: 'javascript:alert(1)' }, 'link'],
	]) assert.ok(readSubmission(f, TV).errors?.length, why)
})

test('a new provider\'s id is its name, made safe and unique', () => {
	assert.equal(providerIdFor('Coon Valley Farmer\'s Telephone Co.', new Set()), 'coon_valley_farmer_s_telephone_co')
	assert.equal(providerIdFor('DirecTV', new Set(['directv'])), 'directv_2')
	assert.equal(providerIdFor('!!!', new Set()), 'provider')
})

test('the pages escape what was submitted, and offer only everyone\'s networks', () => {
	const form = submitPage(TV, { values: { channel: '<script>' }, errors: ['<b>bad</b>'] })
	assert.ok(!form.includes('<script>"') && form.includes('&lt;script&gt;') && form.includes('&lt;b&gt;bad'))
	assert.ok(form.includes('Amherst &lt;Communications&gt;'))
	assert.ok(!form.includes('Brewers.TV'), 'a club\'s own network offered to everyone')
	assert.ok(form.includes('name="website"') && form.includes('class="tv-trap"'), 'no spam trap')
	assert.ok(!/"Amherst <Comm/.test(form.split('<script>').at(-1)), 'the areas\' JSON can close its script')
	const admin = adminPage(TV, { pending: [{ id: 7, created_at: '2026-10-21T17:00:00Z', provider_id: 'directv', network_id: 1, channel: '11 (WLUK)', note: '<i>hi</i>', area_name: null }], recent: [] })
	assert.ok(admin.includes('on file: 11'))
	assert.ok(admin.includes('&lt;i&gt;hi&lt;/i&gt;'))
	assert.ok(admin.includes('action="/admin/submissions/7"'))
})

test('/admin answers only with a session, and says so when no password is set', async () => {
	const handlerFor = (password) => createTvAdmin({ pool: null, readTv: async () => TV, password, secure: false })
	const call = async (h, path, { method = 'GET', headers = {} } = {}) => {
		let status = null, body = ''
		const res = { headersSent: false, writeHead(s) { status = s }, end(b) { body = String(b ?? '') } }
		const handled = await h({ method, headers, socket: {}, [Symbol.asyncIterator]: async function* () {} }, res, new URL(`http://x${path}`))
		return { handled, status, body }
	}
	const h = handlerFor('pw')
	const anon = await call(h, '/admin')
	assert.equal(anon.status, 200)
	assert.ok(anon.body.includes('type="password"') && !anon.body.includes('Waiting'))
	assert.equal((await call(h, '/admin/submissions/1', { method: 'POST', headers: { host: 'x', origin: 'http://x' } })).body.includes('type="password"'), true, 'an action without a session')
	assert.equal((await call(handlerFor(undefined), '/admin')).status, 503)
	assert.equal((await call(h, '/nfl/packers/')).handled, false)
	assert.equal((await call(h, '/tv/submit')).status, 200)
})

// Applying, against the database, inside a transaction rolled back after.
const DATABASE_URL = process.env.DATABASE_URL
test('approving sets the channel and creates what is new; rejecting changes nothing', { skip: !DATABASE_URL && 'no DATABASE_URL — applying is not covered' }, async () => {
	const c = new pg.Client({ connectionString: DATABASE_URL })
	await c.connect()
	try {
		// decideWithin, not decide: decide's own COMMIT would commit this
		// transaction, and the test's rows with it.
		await c.query('BEGIN')
		const fox = (await c.query("SELECT id FROM tv_network WHERE key = 'FOX' AND club IS NULL")).rows[0].id
		const got = await applyChannel(c, { providerId: 'directv', networkId: fox, areaName: 'Test Area', channel: '11 (TEST)' })
		assert.equal(got.area, 0, 'a provider\'s first area is position 0')
		const again = await applyChannel(c, { providerId: 'directv', networkId: fox, areaName: 'test area', channel: '12 (TEST)' })
		assert.equal(again.area, 0, 'the same area, by name in any case')
		const rows = (await c.query("SELECT channel FROM tv_channel WHERE provider_id = 'directv' AND network_id = $1 AND area = 0", [fox])).rows
		assert.deepEqual(rows.map((r) => r.channel), ['12 (TEST)'], 'set twice is one channel, the latest')
		const made = await applyChannel(c, { providerName: 'Test Cable Co', networkName: 'Test Sports North', networkKind: 'regional', channel: '42' })
		assert.equal(made.providerId, 'test_cable_co')
		assert.equal((await c.query('SELECT kind FROM tv_network WHERE id = $1', [made.networkId])).rows[0].kind, 'regional')
		const reused = await applyChannel(c, { providerName: 'test cable co', networkName: 'fox', channel: '7' })
		assert.equal(reused.providerId, 'test_cable_co', 'a provider named again is the same provider')
		assert.equal(reused.networkId, fox, 'a network named again is the same network')
		const id = await insertSubmission(c, { providerId: 'directv', networkId: fox, channel: '99', areaName: null }, 'h')
		const before = (await c.query('SELECT count(*)::int AS n FROM tv_channel')).rows[0].n
		assert.deepEqual(await decideWithin(c, id, { action: 'reject', note: 'no' }), { action: 'reject', applied: null })
		assert.equal((await c.query('SELECT count(*)::int AS n FROM tv_channel')).rows[0].n, before)
		assert.equal(await decideWithin(c, id, { action: 'approve', edited: { providerId: 'directv', networkId: fox, channel: '99' } }), null, 'decided twice')
	} finally {
		await c.query('ROLLBACK').catch(() => {})
		await c.end()
	}
})

// Ray, 2026-10-21: the form's colours were bad, its menu unreadable, and "they
// need to be able to list a service area within the provider".

test('a service area is one on file, a new one by name, or none', () => {
	const base = { provider: 'amherst', network: '1', channel: '7' }
	assert.equal(readSubmission({ ...base, area: 'Waushara' }, TV).value.areaName, 'Waushara')
	assert.equal(readSubmission({ ...base, area: '' }, TV).value.areaName, null, 'the same in every area')
	assert.equal(readSubmission({ ...base, area: '__new', area_new: ' Marquette  County ' }, TV).value.areaName, 'Marquette County')
	assert.ok(readSubmission({ ...base, area: '__new', area_new: '' }, TV).errors?.includes('Name the service area.'))
	const form = submitPage(TV)
	assert.match(form, /<select name="area" data-areas/)
	assert.match(form, /name="area_new"/)
	assert.ok(form.includes('"amherst":["Portage","Waushara"]'), 'the provider\'s areas are not given to the form')
})

test('the form wears the club\'s colours and posts back to the club', () => {
	const form = submitPage(TV, { colors: { base: '#203731', accent: '#ffb612' }, action: '/nfl/packers/tv/submit' })
	assert.match(form, /--base: #203731/)
	assert.match(form, /action="\/nfl\/packers\/tv\/submit"/)
	assert.ok(form.includes('color-scheme: dark') && form.includes('.tv-form option { background: var(--base)'), 'the menu opens light under white text')
	assert.ok(submitPage(TV).includes('action="/tv/submit"'))
})

test('a club\'s address answers with its colours and its page to go back to', async () => {
	const h = createTvAdmin({ pool: null, readTv: async () => TV, password: 'pw', secure: false })
	let status = null, body = ''
	const res = { headersSent: false, writeHead(s) { status = s }, end(b) { body = String(b ?? '') } }
	const handled = await h({ method: 'GET', headers: {}, socket: {} }, res, new URL('http://x/nfl/packers/tv/submit'),
		{ colors: { base: '#203731', accent: '#ffb612' }, home: '/nfl/packers/' })
	assert.equal(handled, true)
	assert.equal(status, 200)
	assert.match(body, /--accent: #ffb612/)
	assert.match(body, /action="\/nfl\/packers\/tv\/submit"/)
})
