/** Submitting a channel, and approving it (Ray, 2026-10-21).
 *
 *  /tv/submit    anyone, no account: a provider, an area, a network and a
 *                channel number, each one on file or a new one by name. Kept
 *                as a submission (0018); nothing a page shows changes.
 *  /admin        Ray, behind ADMIN_PASSWORD (Coolify's environment): every
 *                pending submission beside what is on file, each editable,
 *                approved or rejected; and a form that sets a channel at once.
 *
 *  Spam: a field a person never sees (a bot fills it, and the submission is
 *  thanked and dropped), and a limit per sender. Anything that gets through
 *  costs a click to reject, because nothing is applied unreviewed.
 *
 *  The admin session is a signed cookie, not a table: an expiry and its HMAC,
 *  keyed from the password, so changing the password signs everyone out.
 *  Admin actions are POSTs from this site's own pages: the cookie is
 *  SameSite=Strict and the Origin must be this host's.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { page, escapeHtml as esc, NEUTRAL } from './render.js';

const KINDS = ['broadcast', 'cable', 'regional', 'streaming', 'radio'];
const MAX_BODY = 16 * 1024;
const SESSION_HOURS = 12;

// --- requests -----------------------------------------------------------------

/** A form POST's fields, or null past MAX_BODY. */
export async function readForm(req, limit = MAX_BODY) {
	let size = 0;
	const chunks = [];
	for await (const c of req) {
		size += c.length;
		if (size > limit) return null;
		chunks.push(c);
	}
	return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/** Who sent it, as the edge says: Cloudflare's header, else the proxy's, else
 *  the socket. */
export const senderOf = (req) => String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '')
	.split(',')[0].trim();

/** At most `max` in `windowMs` per key; forgets keys as their windows pass. */
export function rateLimiter({ max, windowMs, now = () => Date.now() }) {
	const hits = new Map();
	return (key) => {
		const t = now();
		const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs);
		if (recent.length >= max) { hits.set(key, recent); return false; }
		recent.push(t);
		hits.set(key, recent);
		if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((h) => t - h < windowMs)) hits.delete(k);
		return true;
	};
}

// --- the admin session ----------------------------------------------------------

const keyOf = (password) => createHash('sha256').update(`ats-admin:${password}`).digest();
const sign = (key, text) => createHmac('sha256', key).update(text).digest('base64url');

/** Whether a password is the admin's, in constant time. */
export function passwordMatches(given, password) {
	if (!password || typeof given !== 'string') return false;
	return timingSafeEqual(keyOf(given), keyOf(password));
}

/** A session cookie's value, good for SESSION_HOURS. */
export function sessionValue(password, now = Date.now()) {
	const exp = String(now + SESSION_HOURS * 3600e3);
	return `${exp}.${sign(keyOf(password), exp)}`;
}

/** Whether a request carries an unexpired session signed with this password. */
export function hasSession(req, password, now = Date.now()) {
	if (!password) return false;
	const m = /(?:^|;\s*)ats_admin=([0-9]+)\.([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '');
	if (!m || Number(m[1]) < now) return false;
	const want = Buffer.from(sign(keyOf(password), m[1]));
	const got = Buffer.from(m[2]);
	return want.length === got.length && timingSafeEqual(want, got);
}

/** Whether a POST came from a page of this host. */
export function sameOrigin(req) {
	const host = req.headers['x-forwarded-host'] ?? req.headers.host;
	const from = req.headers.origin ?? req.headers.referer;
	if (!host || !from) return false;
	try { return new URL(from).host === host; } catch { return false; }
}

// --- submissions ----------------------------------------------------------------

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A submission from the form's fields: `{ value }` or `{ errors }`. The
 *  provider and network are an id on file, or `new` and a name. */
export function readSubmission(f, tv) {
	const errors = [];
	const v = {
		providerId: null, providerName: null, providerUrl: clean(f.provider_url, 300) || null,
		areaName: clean(f.area, 120) || null,
		networkId: null, networkName: null, networkKind: KINDS.includes(f.network_kind) ? f.network_kind : null,
		channel: clean(f.channel, 60), note: clean(f.note, 1000) || null, contact: clean(f.contact, 200) || null,
	};
	if (f.provider && f.provider !== 'new') {
		if (tv.providers.some((p) => p.id === f.provider)) v.providerId = f.provider;
		else errors.push('That provider is not on file.');
	} else if (clean(f.provider_name, 120)) v.providerName = clean(f.provider_name, 120);
	else errors.push('Name the provider.');
	if (f.network && f.network !== 'new') {
		const id = Number(f.network);
		if (tv.networks.some((n) => n.id === id)) v.networkId = id;
		else errors.push('That network is not on file.');
	} else if (clean(f.network_name, 120)) {
		v.networkName = clean(f.network_name, 120);
		v.networkKind ??= 'cable';
	} else errors.push('Name the network.');
	if (!v.channel) errors.push('Give the channel number, as your guide shows it.');
	if (v.providerUrl && !/^https?:\/\//i.test(v.providerUrl)) errors.push('A provider link starts with http:// or https://.');
	return errors.length ? { errors } : { value: v };
}

/** Keep a submission. */
export async function insertSubmission(client, v, sourceHash) {
	const { rows } = await client.query(`
		INSERT INTO tv_submission (provider_id, provider_name, provider_url, area_name, network_id, network_name, network_kind, channel, note, contact, source_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
	[v.providerId, v.providerName, v.providerUrl, v.areaName, v.networkId, v.networkName, v.networkKind, v.channel, v.note, v.contact, sourceHash]);
	return rows[0].id;
}

/** A provider id from a name: lower case, underscores, unique. */
export function providerIdFor(name, taken) {
	const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'provider';
	let id = base;
	for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
	return id;
}

/** Set one channel, creating the provider, area or network it names if new.
 *  Within the caller's transaction. Returns what it set. */
export async function applyChannel(client, v) {
	let providerId = v.providerId;
	if (!providerId) {
		const { rows } = await client.query('SELECT id, lower(display_name) AS name FROM tv_provider');
		const same = rows.find((r) => r.name === v.providerName.toLowerCase());
		providerId = same?.id ?? providerIdFor(v.providerName, new Set(rows.map((r) => r.id)));
		if (!same) {
			await client.query('INSERT INTO tv_provider (id, display_name, website_url) VALUES ($1, $2, $3)', [providerId, v.providerName, v.providerUrl]);
		}
	}
	let area = null;
	if (v.areaName) {
		const { rows } = await client.query('SELECT position, name FROM tv_area WHERE provider_id = $1 ORDER BY position', [providerId]);
		const same = rows.find((r) => r.name.toLowerCase() === v.areaName.toLowerCase());
		if (same) area = same.position;
		else {
			area = rows.length ? rows.at(-1).position + 1 : 0;
			await client.query('INSERT INTO tv_area (provider_id, position, name) VALUES ($1, $2, $3)', [providerId, area, v.areaName]);
		}
	}
	let networkId = v.networkId;
	if (!networkId) {
		const { rows } = await client.query(
			`SELECT id FROM tv_network WHERE club IS NULL AND (lower(key) = lower($1) OR lower(display_name) = lower($1) OR lower($1) = ANY (SELECT lower(a) FROM unnest(aliases) a))`,
			[v.networkName]);
		networkId = rows[0]?.id;
		if (!networkId) {
			const ins = await client.query(
				`INSERT INTO tv_network (key, display_name, kind, position)
				 VALUES ($1, $1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM tv_network)) RETURNING id`,
				[v.networkName, v.networkKind ?? 'cable']);
			networkId = ins.rows[0].id;
		}
	}
	await client.query(`
		INSERT INTO tv_channel (provider_id, network_id, area, channel) VALUES ($1, $2, $3, $4)
		ON CONFLICT (provider_id, network_id, (COALESCE(area, -1)))
		DO UPDATE SET channel = EXCLUDED.channel, updated_at = now()`,
	[providerId, networkId, area, v.channel]);
	await client.query('UPDATE tv_provider SET updated_at = now() WHERE id = $1', [providerId]);
	return { providerId, area, networkId, channel: v.channel };
}

/** Approve a submission as edited, or reject it, within the caller's
 *  transaction. Null when it was already decided. */
export async function decideWithin(client, id, { action, edited = null, note = null }) {
	const { rows } = await client.query("SELECT id FROM tv_submission WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]);
	if (!rows.length) return null;
	const applied = action === 'approve' ? await applyChannel(client, edited) : null;
	await client.query(
		'UPDATE tv_submission SET status = $2, reviewed_at = now(), review_note = $3, applied = $4 WHERE id = $1',
		[id, action === 'approve' ? 'approved' : 'rejected', note, applied]);
	return { action, applied };
}

/** The same, as its own transaction: what the admin page does. Kept apart
 *  from decideWithin because a COMMIT inside a caller's transaction commits
 *  the caller's too. */
export async function decide(client, id, choice) {
	await client.query('BEGIN');
	try {
		const done = await decideWithin(client, id, choice);
		await client.query(done ? 'COMMIT' : 'ROLLBACK');
		return done;
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	}
}

export async function listSubmissions(client) {
	const q = (where, limit) => client.query(`
		SELECT s.*, p.display_name AS provider_display, n.display_name AS network_display
		  FROM tv_submission s
		  LEFT JOIN tv_provider p ON p.id = s.provider_id
		  LEFT JOIN tv_network n ON n.id = s.network_id
		 WHERE ${where} ORDER BY s.created_at ${limit ? 'DESC' : 'ASC'} ${limit ? `LIMIT ${limit}` : ''}`);
	const [pending, recent] = await Promise.all([q("s.status = 'pending'"), q("s.status <> 'pending'", 25)]);
	return { pending: pending.rows, recent: recent.rows };
}

// --- pages ----------------------------------------------------------------------

const FORM_CSS = `<style>
.tv-form { max-width: 40rem; margin: 0 auto; display: grid; gap: .9rem; text-align: left; }
.tv-form label { display: grid; gap: .3rem; font-weight: 600; }
.tv-form .hint { font-weight: 400; font-size: .85rem; opacity: .75; }
.tv-form input, .tv-form select, .tv-form textarea { font: inherit; padding: .45rem .6rem; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.12); color: inherit; }
.tv-form button { font: inherit; font-weight: 700; padding: .55rem 1rem; border-radius: 6px; border: 0; cursor: pointer; background: var(--accent, #fff); color: var(--base, #222); }
.tv-form .row { display: grid; grid-template-columns: 1fr 1fr; gap: .9rem; }
.tv-errors { max-width: 40rem; margin: 0 auto 1rem; padding: .6rem 1rem; border-radius: 6px; background: rgba(220,60,60,.18); text-align: left; }
.tv-form [hidden] { display: none !important; }
.tv-trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.tv-cards { display: grid; gap: 1rem; max-width: 60rem; margin: 0 auto; text-align: left; }
.tv-card { padding: 1rem; border-radius: 8px; border: 1px solid rgba(127,127,127,.35); }
.tv-card .now { font-size: .85rem; opacity: .8; }
.tv-card .actions { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.tv-card .reject { background: transparent; color: inherit; border: 1px solid rgba(127,127,127,.6); }
.tv-recent { max-width: 60rem; margin: 1rem auto; font-size: .9rem; border-collapse: collapse; width: 100%; }
.tv-recent td, .tv-recent th { padding: .3rem .5rem; border-bottom: 1px solid rgba(127,127,127,.25); text-align: left; }
@media (max-width: 560px) { .tv-form .row { grid-template-columns: 1fr; } }
</style>`;

const wrap = (title, body) => page({ title, colors: NEUTRAL, body: `${FORM_CSS}<main class="container" style="padding:1.5rem 1rem 3rem">
<h1>${esc(title)}</h1>
${body}
</main>` });

const providerOptions = (tv, selected) => tv.providers.slice().sort((a, b) => a.displayName.localeCompare(b.displayName))
	.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.displayName)}</option>`).join('');
const networkOptions = (tv, selected) => tv.networks.filter((n) => n.club == null).slice().sort((a, b) => a.displayName.localeCompare(b.displayName))
	.map((n) => `<option value="${n.id}"${n.id === selected ? ' selected' : ''}>${esc(n.displayName)}</option>`).join('');
const kindOptions = (selected) => KINDS.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${k}</option>`).join('');

/** Each provider's areas, for the form's script. `<` escaped so the JSON
 *  cannot close its script tag. */
const areasJson = (tv) => JSON.stringify(Object.fromEntries(tv.providers.map((p) => [p.id,
	tv.areas.filter((a) => a.providerId === p.id).sort((a, b) => a.position - b.position).map((a) => a.name)]))).replace(/</g, '\\u003c');

/** The fields shared by the public form and the admin's own. */
function channelFields(tv, v = {}, key = 'new') {
	return `<div class="row">
<label>Your TV provider
<select name="provider" data-provider>${'<option value="">Choose…</option>'}${providerOptions(tv, v.provider)}<option value="new"${v.provider === 'new' ? ' selected' : ''}>Not listed — add it</option></select></label>
<label data-new-provider hidden>Provider's name
<input name="provider_name" maxlength="120" value="${esc(v.provider_name ?? '')}"></label>
</div>
<label data-new-provider hidden>Provider's website or channel lineup <span class="hint">optional</span>
<input name="provider_url" maxlength="300" placeholder="https://" value="${esc(v.provider_url ?? '')}"></label>
<label>Area <span class="hint">where your provider's lineup differs by area; leave empty if it is the same everywhere</span>
<input name="area" list="tv-areas-${key}" maxlength="120" value="${esc(v.area ?? '')}"><datalist id="tv-areas-${key}" data-areas></datalist></label>
<div class="row">
<label>Network
<select name="network" data-network><option value="">Choose…</option>${networkOptions(tv, Number(v.network))}<option value="new"${v.network === 'new' ? ' selected' : ''}>Not listed — add it</option></select></label>
<label data-new-network hidden>Network's name <span class="hint">as the schedule shows it</span>
<input name="network_name" maxlength="120" value="${esc(v.network_name ?? '')}"></label>
</div>
<label data-new-network hidden>What kind of network
<select name="network_kind">${kindOptions(v.network_kind ?? 'cable')}</select></label>
<label>Channel <span class="hint">as your guide shows it: 206, 652 / 1652, 11 (WZAW)</span>
<input name="channel" required maxlength="60" value="${esc(v.channel ?? '')}"></label>`;
}

/** Shows the "new" fields when "Not listed" is chosen, fills the area list
 *  from the provider's areas, and starts on the provider this browser chose
 *  on a club page (localStorage tvProvider, the same origin). */
const formScript = (tv) => `<script>
(() => {
	const areas = ${areasJson(tv)};
	for (const form of document.querySelectorAll('.tv-form')) {
		const prov = form.querySelector('[data-provider]'), net = form.querySelector('[data-network]');
		const list = form.querySelector('[data-areas]');
		if (prov && !prov.value) { try { const saved = localStorage.getItem('tvProvider'); if (saved && areas[saved]) prov.value = saved; } catch {} }
		const sync = () => {
			form.querySelectorAll('[data-new-provider]').forEach((el) => { el.hidden = prov.value !== 'new'; });
			form.querySelectorAll('[data-new-network]').forEach((el) => { el.hidden = net.value !== 'new'; });
			if (list) list.innerHTML = (areas[prov.value] || []).map((a) => '<option value="' + a.replace(/"/g, '&quot;') + '">').join('');
		};
		prov?.addEventListener('change', sync); net?.addEventListener('change', sync); sync();
	}
})();
</script>`;

export function submitPage(tv, { values = {}, errors = [] } = {}) {
	return wrap('Suggest a channel', `<p style="max-width:40rem;margin:0 auto 1rem">Missing a channel, or one that is wrong for your provider? Tell us what your guide says. It shows on the site once it has been checked.</p>
${errors.length ? `<div class="tv-errors">${errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
<form class="tv-form" method="post" action="/tv/submit">
${channelFields(tv, values)}
<label>Anything else <span class="hint">optional</span>
<textarea name="note" rows="3" maxlength="1000">${esc(values.note ?? '')}</textarea></label>
<label>Your email <span class="hint">optional, only if we may ask you about it</span>
<input name="contact" type="email" maxlength="200" value="${esc(values.contact ?? '')}"></label>
<div class="tv-trap" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
<button type="submit">Send</button>
</form>
${formScript(tv)}`);
}

export const thanksPage = () => wrap('Thank you', '<p>We will check it, and it will show on the site once it has been.</p><p><a href="/">Back to the site</a></p>');

export const loginPage = ({ error = null, configured = true } = {}) => wrap('Admin', configured
	? `${error ? `<div class="tv-errors">${esc(error)}</div>` : ''}<form class="tv-form" method="post" action="/admin/login">
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button></form>`
	: '<p>No admin password is set. Set <code>ADMIN_PASSWORD</code> in the deployment\'s environment and restart it.</p>');

/** What is on file for a submission's provider, network and area. */
function onFile(tv, s) {
	if (!s.provider_id || !s.network_id) return 'new to the table';
	const area = s.area_name ? tv.areas.find((a) => a.providerId === s.provider_id && a.name.toLowerCase() === s.area_name.toLowerCase()) : null;
	const rows = tv.channels.filter((c) => c.providerId === s.provider_id && c.networkId === s.network_id);
	const exact = rows.find((c) => c.area === (area ? area.position : null));
	if (exact) return `on file: ${exact.channel}`;
	return rows.length ? `on file for other areas: ${rows.map((c) => c.channel).join(', ')}` : 'not on file';
}

export function adminPage(tv, { pending, recent }, { flash = null } = {}) {
	const card = (s) => `<form class="tv-form tv-card" method="post" action="/admin/submissions/${s.id}">
<div class="now">#${s.id} · ${esc(new Date(s.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }))} · ${esc(onFile(tv, s))}${s.contact ? ` · from ${esc(s.contact)}` : ''}</div>
${s.note ? `<div>“${esc(s.note)}”</div>` : ''}
${channelFields(tv, {
		provider: s.provider_id ?? 'new', provider_name: s.provider_name, provider_url: s.provider_url,
		area: s.area_name, network: s.network_id ? String(s.network_id) : 'new', network_name: s.network_name,
		network_kind: s.network_kind, channel: s.channel,
	}, String(s.id))}
<label>Note to keep with the decision <span class="hint">optional</span><input name="review_note" maxlength="300"></label>
<div class="actions"><button name="action" value="approve">Approve</button><button name="action" value="reject" class="reject">Reject</button></div>
</form>`;
	const recentRows = recent.map((s) => `<tr><td>#${s.id}</td><td>${esc(s.status)}</td><td>${esc(s.provider_display ?? s.provider_name ?? '')}${s.area_name ? ` · ${esc(s.area_name)}` : ''}</td><td>${esc(s.network_display ?? s.network_name ?? '')}</td><td>${esc(s.channel)}</td><td>${esc(s.review_note ?? '')}</td></tr>`).join('');
	return wrap('Channel submissions', `${flash ? `<p><strong>${esc(flash)}</strong></p>` : ''}
<form method="post" action="/admin/logout" style="text-align:right;max-width:60rem;margin:0 auto"><button style="font:inherit;background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer">Sign out</button></form>
<h2>Waiting (${pending.length})</h2>
<div class="tv-cards">${pending.length ? pending.map(card).join('') : '<p>Nothing waiting.</p>'}</div>
<h2>Set a channel yourself</h2>
<form class="tv-form tv-card" method="post" action="/admin/add" style="max-width:60rem">
${channelFields(tv)}
<div class="actions"><button type="submit">Set it</button></div>
</form>
${recent.length ? `<h2>Decided</h2><table class="tv-recent"><tr><th></th><th></th><th>Provider</th><th>Network</th><th>Channel</th><th>Note</th></tr>${recentRows}</table>` : ''}
${formScript(tv)}`);
}

// --- routes ---------------------------------------------------------------------

/**
 * The routes, for server.js. Returns a handler answering /tv/submit and
 * /admin..., or false for anything else.
 *
 * @param pool      the database
 * @param readTv    () => the TV tables, fresh (lib/tv.js readTv)
 * @param password  ADMIN_PASSWORD; unset, /admin says so and signs nobody in
 * @param secure    whether cookies are marked Secure (an https origin)
 */
export function createTvAdmin({ pool, readTv, password = process.env.ADMIN_PASSWORD, secure = true, now = () => Date.now() }) {
	const submitLimit = rateLimiter({ max: 10, windowMs: 3600e3, now });
	const loginLimit = rateLimiter({ max: 5, windowMs: 15 * 60e3, now });
	const salt = createHash('sha256').update(`ats-sender:${password ?? ''}`).digest('hex');
	const hashOf = (ip) => createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
	const htmlOut = (res, code, body, headers = {}) => {
		const buf = Buffer.from(body);
		res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers });
		res.end(buf);
	};
	const redirect = (res, to, headers = {}) => { res.writeHead(303, { location: to, 'cache-control': 'no-store', ...headers }); res.end(); };
	const cookie = (value, maxAge) => `ats_admin=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
	const withClient = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };

	return async function tvAdmin(req, res, url) {
		const p = url.pathname;
		if (p !== '/tv/submit' && p !== '/admin' && !p.startsWith('/admin/')) return false;

		if (p === '/tv/submit') {
			if (req.method === 'GET') {
				const values = { provider: url.searchParams.get('provider') ?? '', network: url.searchParams.get('network') ?? '' };
				return htmlOut(res, 200, submitPage(await readTv(), { values })), true;
			}
			if (req.method !== 'POST') return htmlOut(res, 405, 'Method not allowed', { allow: 'GET, POST' }), true;
			const f = await readForm(req);
			if (!f) return htmlOut(res, 413, 'Too large'), true;
			// A field nobody sees, filled: a bot. Thanked, so it learns nothing.
			if (f.website) return htmlOut(res, 200, thanksPage()), true;
			const ip = senderOf(req);
			if (!submitLimit(ip)) return htmlOut(res, 429, wrap('Slow down', '<p>That is a lot of channels from one place in an hour. Try again later.</p>'), { 'retry-after': '3600' }), true;
			const tv = await readTv();
			const got = readSubmission(f, tv);
			if (got.errors) return htmlOut(res, 400, submitPage(tv, { values: f, errors: got.errors })), true;
			await withClient((c) => insertSubmission(c, got.value, hashOf(ip)));
			return htmlOut(res, 200, thanksPage()), true;
		}

		// --- admin ---
		if (p === '/admin/login' && req.method === 'POST') {
			if (!password) return htmlOut(res, 503, loginPage({ configured: false })), true;
			if (!sameOrigin(req)) return htmlOut(res, 403, 'Forbidden'), true;
			if (!loginLimit(senderOf(req))) return htmlOut(res, 429, loginPage({ error: 'Too many tries. Wait fifteen minutes.' })), true;
			const f = await readForm(req);
			if (!f || !passwordMatches(f.password, password)) return htmlOut(res, 401, loginPage({ error: 'That is not the password.' })), true;
			return redirect(res, '/admin', { 'set-cookie': cookie(sessionValue(password, now()), SESSION_HOURS * 3600) }), true;
		}
		if (p === '/admin/logout' && req.method === 'POST') {
			return redirect(res, '/admin', { 'set-cookie': cookie('', 0) }), true;
		}
		if (!hasSession(req, password, now())) {
			return htmlOut(res, password ? 200 : 503, loginPage({ configured: Boolean(password) })), true;
		}
		if (p === '/admin' && req.method === 'GET') {
			const flash = { approved: 'Approved.', rejected: 'Rejected.', set: 'Set.', gone: 'That one was already decided.' }[url.searchParams.get('done')] ?? null;
			const [tv, lists] = await Promise.all([readTv(), withClient(listSubmissions)]);
			return htmlOut(res, 200, adminPage(tv, lists, { flash })), true;
		}
		if (req.method !== 'POST') return htmlOut(res, 405, 'Method not allowed', { allow: 'POST' }), true;
		if (!sameOrigin(req)) return htmlOut(res, 403, 'Forbidden'), true;
		const f = await readForm(req);
		if (!f) return htmlOut(res, 413, 'Too large'), true;
		const tv = await readTv();

		if (p === '/admin/add') {
			const got = readSubmission(f, tv);
			if (got.errors) return htmlOut(res, 400, wrap('Not set', `<div class="tv-errors">${got.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div><p><a href="/admin">Back</a></p>`)), true;
			await withClient(async (c) => {
				await c.query('BEGIN');
				try { await applyChannel(c, got.value); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; }
			});
			return redirect(res, '/admin?done=set'), true;
		}
		const m = /^\/admin\/submissions\/(\d+)$/.exec(p);
		if (m && (f.action === 'approve' || f.action === 'reject')) {
			let edited = null;
			if (f.action === 'approve') {
				const got = readSubmission(f, tv);
				if (got.errors) return htmlOut(res, 400, wrap('Not approved', `<div class="tv-errors">${got.errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div><p><a href="/admin">Back</a></p>`)), true;
				edited = got.value;
			}
			const done = await withClient((c) => decide(c, Number(m[1]), { action: f.action, edited, note: clean(f.review_note, 300) || null }));
			return redirect(res, `/admin?done=${done ? (f.action === 'approve' ? 'approved' : 'rejected') : 'gone'}`), true;
		}
		return htmlOut(res, 404, 'Not found'), true;
	};
}
