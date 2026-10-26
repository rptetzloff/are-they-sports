/** The full TV listings on /admin/channels (Ray, 2026-10-21: "can the admin
 *  see the full channel listings?"): every provider with its details, its
 *  service areas and a grid of each network's channel in each area; every
 *  network; and the change log (0019). Everything editable and deletable in
 *  place, read from and written to the tables the club pages read (0017).
 *
 *  The writes run in the caller's transaction (lib/tv-admin.js) and each
 *  records itself in tv_change with what it was before and after, because a
 *  delete cannot be taken back any other way.
 */
import { escapeHtml as esc } from './render.js';
import { DMA_POINTS, REFERENCE_MAP } from './coverage.js';

const KINDS = ['broadcast', 'cable', 'regional', 'streaming', 'radio'];
const clean = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const url = (v) => { const s = clean(v, 500); return s && !/^https?:\/\//i.test(s) ? undefined : s || null; };
// A logo may also be one the site keeps (data/tv-logos), named as the pages
// ask for it: logos/AmherstComm.svg.
// Relative, as every path a club page uses is: from the root, a site of many
// clubs answers it for nobody.
const logo = (v) => { const s = clean(v, 500); return /^\/?logos\/[A-Za-z0-9_.-]+$/.test(s) ? s.replace(/^\//, '') : url(s); };
const list = (v) => clean(v, 2000).split(',').map((x) => x.trim()).filter(Boolean);

export async function logChange(client, action, subject, before = null, after = null) {
	await client.query('INSERT INTO tv_change (action, subject, before, after) VALUES ($1, $2, $3, $4)', [action, subject, before, after]);
}

export async function recentChanges(client, limit = 50) {
	const { rows } = await client.query('SELECT * FROM tv_change ORDER BY at DESC, id DESC LIMIT $1', [limit]);
	return rows;
}

// --- writes ---------------------------------------------------------------------

/** A provider's details, its areas' names and its whole channel grid, from
 *  one form. Returns errors, or how many things changed. */
export async function saveProvider(client, id, f) {
	const { rows: [p] } = await client.query('SELECT * FROM tv_provider WHERE id = $1 FOR UPDATE', [id]);
	if (!p) return { errors: ['That provider is gone.'] };
	const next = {
		display_name: clean(f.display_name, 120), alternate_names: list(f.alternate_names),
		website_url: url(f.website_url), lineup_url: url(f.lineup_url), logo_url: logo(f.logo_url),
		logo_bg: clean(f.logo_bg, 40) || null, display_logo: f.display_logo === 'on',
	};
	const errors = [];
	if (!next.display_name) errors.push('A provider needs a name.');
	for (const k of ['website_url', 'lineup_url', 'logo_url']) if (next[k] === undefined) errors.push(k === 'logo_url' ? 'A logo is a link (http:// or https://) or one the site keeps: logos/Name.svg.' : `${k.replace('_url', '')} must start with http:// or https://.`);
	if (next.logo_bg && !/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(next.logo_bg)) errors.push('The logo background is a colour: #123456 or a name.');
	if (errors.length) return { errors };
	let changed = 0;
	const before = Object.fromEntries(Object.keys(next).map((k) => [k, p[k]]));
	if (JSON.stringify(before) !== JSON.stringify(next)) {
		await client.query(`UPDATE tv_provider SET display_name = $2, alternate_names = $3, website_url = $4, lineup_url = $5,
			logo_url = $6, logo_bg = $7, display_logo = $8, updated_at = now() WHERE id = $1`,
		[id, next.display_name, next.alternate_names, next.website_url, next.lineup_url, next.logo_url, next.logo_bg, next.display_logo]);
		await logChange(client, 'provider.edit', id, before, next);
		changed++;
	}
	const { rows: areas } = await client.query('SELECT position, name, dma, map_x, map_y FROM tv_area WHERE provider_id = $1 ORDER BY position', [id]);
	for (const a of areas) {
		// The area's TV market: its name (one of the calibrated, or any other,
		// for matching a streaming game's simulcasts) and, for one that is not
		// calibrated, where it was placed on the map. A point off the map is none.
		if (f[`dma_${a.position}`] !== undefined) {
			const dma = clean(f[`dma_${a.position}`], 60) || null;
			const at = (v, max) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n >= 4 && n <= max ? n : null; };
			let x = at(f[`mapx_${a.position}`], 1275), y = at(f[`mapy_${a.position}`], 715);
			if (x == null || y == null || !dma) x = y = null;
			const was = { dma: a.dma ?? null, map_x: a.map_x ?? null, map_y: a.map_y ?? null };
			const now = { dma, map_x: x, map_y: y };
			if (JSON.stringify(was) !== JSON.stringify(now)) {
				await client.query('UPDATE tv_area SET dma = $3, map_x = $4, map_y = $5 WHERE provider_id = $1 AND position = $2', [id, a.position, dma, x, y]);
				await logChange(client, 'area.market', `${id} · area ${a.position}`, was, now);
				changed++;
			}
		}
		const name = clean(f[`area_${a.position}`], 120);
		if (name && name !== a.name) {
			await client.query('UPDATE tv_area SET name = $3 WHERE provider_id = $1 AND position = $2', [id, a.position, name]);
			await logChange(client, 'area.rename', `${id} · area ${a.position}`, { name: a.name }, { name });
			changed++;
		}
	}
	// The grid: a cell per network and column (every area, or one). An emptied
	// cell clears the channel; a changed one sets it.
	const areaName = new Map(areas.map((a) => [a.position, a.name]));
	const { rows: had } = await client.query(
		'SELECT c.network_id AS "networkId", c.area, c.channel, n.key FROM tv_channel c JOIN tv_network n ON n.id = c.network_id WHERE c.provider_id = $1', [id]);
	const now = new Map(had.map((c) => [`${c.networkId}_${c.area ?? 'all'}`, c]));
	const { rows: nets } = await client.query('SELECT id, key FROM tv_network');
	const keyOf = new Map(nets.map((n) => [n.id, n.key]));
	for (const [field, raw] of Object.entries(f)) {
		const m = /^ch_(\d+)_(all|\d+)$/.exec(field);
		if (!m || !keyOf.has(Number(m[1]))) continue;
		const networkId = Number(m[1]);
		const area = m[2] === 'all' ? null : Number(m[2]);
		if (area != null && !areaName.has(area)) continue;
		const value = clean(raw, 60);
		const old = now.get(`${networkId}_${m[2]}`)?.channel ?? '';
		if (value === old) continue;
		const subject = `${id} · ${keyOf.get(networkId)} · ${area == null ? 'every area' : areaName.get(area)}`;
		if (!value) {
			await client.query('DELETE FROM tv_channel WHERE provider_id = $1 AND network_id = $2 AND area IS NOT DISTINCT FROM $3', [id, networkId, area]);
			await logChange(client, 'channel.clear', subject, { channel: old }, null);
		} else {
			await client.query(`INSERT INTO tv_channel (provider_id, network_id, area, channel) VALUES ($1, $2, $3, $4)
				ON CONFLICT (provider_id, network_id, (COALESCE(area, -1))) DO UPDATE SET channel = EXCLUDED.channel, updated_at = now()`,
			[id, networkId, area, value]);
			await logChange(client, 'channel.set', subject, old ? { channel: old } : null, { channel: value });
		}
		changed++;
	}
	return { changed };
}

/** A provider, its areas and its channels: the whole of it, logged. */
export async function deleteProvider(client, id) {
	const { rows: [p] } = await client.query('SELECT * FROM tv_provider WHERE id = $1', [id]);
	if (!p) return false;
	const { rows: areas } = await client.query('SELECT position, name FROM tv_area WHERE provider_id = $1 ORDER BY position', [id]);
	const { rows: channels } = await client.query(
		'SELECT n.key AS network, c.area, c.channel FROM tv_channel c JOIN tv_network n ON n.id = c.network_id WHERE c.provider_id = $1', [id]);
	await client.query('DELETE FROM tv_provider WHERE id = $1', [id]);
	await logChange(client, 'provider.delete', id, { ...p, areas, channels }, null);
	return true;
}

export async function addProvider(client, name) {
	const display = clean(name, 120);
	if (!display) return { errors: ['A provider needs a name.'] };
	const { rows } = await client.query('SELECT id FROM tv_provider');
	const taken = new Set(rows.map((r) => r.id));
	const base = display.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'provider';
	let id = base;
	for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
	await client.query('INSERT INTO tv_provider (id, display_name) VALUES ($1, $2)', [id, display]);
	await logChange(client, 'provider.add', id, null, { display_name: display });
	return { id };
}

export async function addArea(client, id, name) {
	const n = clean(name, 120);
	if (!n) return { errors: ['Name the area.'] };
	const { rows } = await client.query('SELECT position, name FROM tv_area WHERE provider_id = $1 ORDER BY position', [id]);
	if (rows.some((r) => r.name.toLowerCase() === n.toLowerCase())) return { errors: ['That area is already listed.'] };
	const position = rows.length ? rows.at(-1).position + 1 : 0;
	await client.query('INSERT INTO tv_area (provider_id, position, name) VALUES ($1, $2, $3)', [id, position, n]);
	await logChange(client, 'area.add', `${id} · ${n}`, null, { position, name: n });
	return { position };
}

/** An area and its channels; the areas after it close up, one row at a time
 *  so the key is never held twice. A browser that saved an area by its place
 *  in the list now has the next one, which the log says. */
export async function deleteArea(client, id, position) {
	const { rows: [a] } = await client.query('SELECT name FROM tv_area WHERE provider_id = $1 AND position = $2', [id, position]);
	if (!a) return false;
	const { rows: channels } = await client.query(
		'SELECT n.key AS network, c.channel FROM tv_channel c JOIN tv_network n ON n.id = c.network_id WHERE c.provider_id = $1 AND c.area = $2', [id, position]);
	await client.query('DELETE FROM tv_channel WHERE provider_id = $1 AND area = $2', [id, position]);
	await client.query('DELETE FROM tv_area WHERE provider_id = $1 AND position = $2', [id, position]);
	const { rows: after } = await client.query('SELECT position FROM tv_area WHERE provider_id = $1 AND position > $2 ORDER BY position', [id, position]);
	for (const r of after) {
		await client.query('UPDATE tv_area SET position = $3 WHERE provider_id = $1 AND position = $2', [id, r.position, r.position - 1]);
		await client.query('UPDATE tv_channel SET area = $3 WHERE provider_id = $1 AND area = $2', [id, r.position, r.position - 1]);
	}
	await logChange(client, 'area.delete', `${id} · ${a.name}`, { position, name: a.name, channels }, null);
	return true;
}

const networkFields = (f) => ({
	key: clean(f.key, 120), display_name: clean(f.display_name, 120) || clean(f.key, 120),
	aliases: list(f.aliases), kind: KINDS.includes(f.kind) ? f.kind : 'cable',
	description: clean(f.description, 300) || null, website_url: url(f.website_url),
	club: clean(f.club, 60) || null,
});
const networkErrors = (n) => [
	!n.key && 'A network needs the name ESPN gives it.',
	n.website_url === undefined && 'The website must start with http:// or https://.',
	n.club && !/^[a-z]+\/[a-z0-9-]+$/.test(n.club) && 'A club is written sport/club: mlb/brewers.',
].filter(Boolean);

export async function saveNetwork(client, id, f) {
	const { rows: [old] } = await client.query('SELECT key, display_name, aliases, kind, description, website_url, club FROM tv_network WHERE id = $1 FOR UPDATE', [id]);
	if (!old) return { errors: ['That network is gone.'] };
	const n = networkFields(f);
	const errors = networkErrors(n);
	if (errors.length) return { errors };
	if (JSON.stringify(old) === JSON.stringify(n)) return { changed: 0 };
	await client.query(`UPDATE tv_network SET key = $2, display_name = $3, aliases = $4, kind = $5, description = $6, website_url = $7, club = $8 WHERE id = $1`,
		[id, n.key, n.display_name, n.aliases, n.kind, n.description, n.website_url, n.club]);
	await logChange(client, 'network.edit', old.key, old, n);
	return { changed: 1 };
}

export async function addNetwork(client, f) {
	const n = networkFields(f);
	const errors = networkErrors(n);
	if (errors.length) return { errors };
	const { rows } = await client.query(`INSERT INTO tv_network (key, display_name, aliases, kind, description, website_url, club, position)
		VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(max(position), 0) + 1 FROM tv_network)) RETURNING id`,
	[n.key, n.display_name, n.aliases, n.kind, n.description, n.website_url, n.club]);
	await logChange(client, 'network.add', n.key, null, n);
	return { id: rows[0].id };
}

export async function deleteNetwork(client, id) {
	const { rows: [n] } = await client.query('SELECT * FROM tv_network WHERE id = $1', [id]);
	if (!n) return false;
	const { rows: channels } = await client.query('SELECT provider_id AS provider, area, channel FROM tv_channel WHERE network_id = $1', [id]);
	await client.query('DELETE FROM tv_network WHERE id = $1', [id]);
	await logChange(client, 'network.delete', n.key, { ...n, channels }, null);
	return true;
}

// --- the page -------------------------------------------------------------------

const CSS = `<style>
.tvl-nav { max-width: 72rem; margin: 0 auto 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.tvl-nav a { color: inherit; }
.tvl-search { flex: 1; min-width: 12rem; font: inherit; padding: .45rem .6rem; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.12); color: inherit; }
.tvl { max-width: 72rem; margin: 0 auto; text-align: left; display: grid; gap: .6rem; }
.tvl details { border: 1px solid rgba(127,127,127,.35); border-radius: 8px; padding: .5rem .8rem; }
.tvl summary { cursor: pointer; font-weight: 700; }
.tvl summary .dim { font-weight: 400; opacity: .7; }
.tvl form { display: grid; gap: .8rem; margin-top: .8rem; }
.tvl .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: .6rem; }
.tvl label { display: grid; gap: .2rem; font-size: .85rem; font-weight: 600; }
.tvl input, .tvl select { font: inherit; font-weight: 400; padding: .3rem .45rem; border-radius: 5px; border: 1px solid rgba(127,127,127,.45); background: rgba(127,127,127,.1); color: inherit; min-width: 0; }
.tvl option { background: var(--base); color: var(--text); }
.tvl .grid-wrap { overflow-x: auto; }
.tvl table { border-collapse: collapse; font-size: .85rem; }
.tvl th, .tvl td { padding: .2rem .35rem; border-bottom: 1px solid rgba(127,127,127,.2); text-align: left; white-space: nowrap; }
.tvl td input { width: 8.5rem; }
.tvl tr.empty td:first-child { opacity: .55; }
.tvl .buttons { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.tvl button { font: inherit; font-weight: 700; padding: .4rem .8rem; border-radius: 6px; border: 0; cursor: pointer; background: var(--accent); color: var(--base); }
.tvl button.quiet { background: transparent; color: inherit; border: 1px solid rgba(127,127,127,.6); font-weight: 400; }
.tvl button.danger { background: transparent; color: #ff8a80; border: 1px solid #ff8a80; font-weight: 400; }
.tvl .flash { padding: .5rem .8rem; border-radius: 6px; background: rgba(127,127,127,.18); }
.tvl .errors { padding: .5rem .8rem; border-radius: 6px; background: rgba(220,60,60,.2); }
.tvl-market{grid-column:1/-1;border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:.4rem .6rem;display:grid;gap:.35rem;align-self:start}
.tvl-market input[name^="dma_"]{max-width:22rem}
.tvl-market legend{font-size:.85rem}
.tvl-map{position:relative;max-width:640px;cursor:crosshair}
.tvl-map img{width:100%;display:block}
.tvl-pin{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#000;border:2px solid #fff;pointer-events:none}
</style>`;

// Networks and providers by name, A to Z, whatever the case: the order they
// were added in is nobody's way of finding one.
const byName = (a, b) => (a.displayName || a.key || '').localeCompare(b.displayName || b.key || '', 'en', { sensitivity: 'base' });

const confirmAttr = (what) => ` onclick="return confirm(${esc(JSON.stringify(`Delete ${what}? Its channels go with it.`))})"`;

function providerSection(tv, p, mapUrl = REFERENCE_MAP) {
	const areas = tv.areas.filter((a) => a.providerId === p.id).sort((a, b) => a.position - b.position);
	const cols = [{ key: 'all', label: areas.length > 1 ? 'Every area' : 'Channel' }, ...(areas.length > 1 ? areas.map((a) => ({ key: String(a.position), label: a.name })) : [])];
	const cell = new Map(tv.channels.filter((c) => c.providerId === p.id).map((c) => [`${c.networkId}_${c.area ?? 'all'}`, c.channel]));
	// A single area's channels are the provider's, as the lookup files read
	// them (lib/tv.js); in the grid they sit in the one column.
	if (areas.length === 1) for (const c of tv.channels) if (c.providerId === p.id && c.area === 0 && !cell.has(`${c.networkId}_all`)) cell.set(`${c.networkId}_all`, c.channel);
	const count = tv.channels.filter((c) => c.providerId === p.id).length;
	const rows = tv.networks.slice().sort(byName).map((n) => {
		const filled = cols.some((c) => cell.has(`${n.id}_${c.key}`));
		return `<tr${filled ? '' : ' class="empty"'}><td>${esc(n.displayName)}${n.club ? ` <span class="dim">(${esc(n.club)})</span>` : ''}</td>${cols.map((c) => {
			// One area: write to it, so the cell keeps the area it was set for.
			const name = areas.length === 1 && c.key === 'all' && !tv.channels.some((x) => x.providerId === p.id && x.networkId === n.id && x.area == null) && tv.channels.some((x) => x.providerId === p.id && x.networkId === n.id && x.area === 0)
				? `ch_${n.id}_0` : `ch_${n.id}_${c.key}`;
			return `<td><input name="${name}" value="${esc(cell.get(`${n.id}_${c.key}`) ?? '')}" aria-label="${esc(`${n.displayName}, ${c.label}`)}"></td>`;
		}).join('')}</tr>`;
	}).join('');
	const search = [p.displayName, p.id, ...(p.alternateNames ?? []), ...areas.map((a) => a.name)].join(' ').toLowerCase();
	return `<details class="tvl-provider" data-search="${esc(search)}" id="p-${esc(p.id)}">
<summary>${esc(p.displayName)} <span class="dim">· ${esc(p.id)} · ${areas.length} area${areas.length === 1 ? '' : 's'} · ${count} channel${count === 1 ? '' : 's'}</span></summary>
<form method="post" action="/admin/providers/${esc(p.id)}">
<div class="fields">
<label>Name <input name="display_name" required maxlength="120" value="${esc(p.displayName)}"></label>
<label>Other names <span class="dim">comma between</span><input name="alternate_names" value="${esc((p.alternateNames ?? []).join(', '))}"></label>
<label>Website <input name="website_url" value="${esc(p.websiteUrl ?? '')}"></label>
<label>Channel lineup <input name="lineup_url" value="${esc(p.lineupUrl ?? '')}"></label>
<label>Logo <input name="logo_url" value="${esc(p.logoUrl ?? '')}"></label>
<label>Logo background <input name="logo_bg" value="${esc(p.logoBg ?? '')}" placeholder="#ffffff"></label>
<label style="grid-auto-flow:column;justify-content:start;align-items:center;gap:.4rem"><input type="checkbox" name="display_logo"${p.displayLogo ? ' checked' : ''}> Show its logo</label>
</div>
<div class="fields">${areas.map((a) => `<label>Area ${a.position + 1} <input name="area_${a.position}" value="${esc(a.name)}"></label>
${marketField(a, mapUrl)}`).join('')}
<label>Add an area <input name="new_area" maxlength="120" placeholder="Name"></label></div>
<div class="grid-wrap"><table><thead><tr><th>Network</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<div class="buttons">
<button type="submit">Save ${esc(p.displayName)}</button>
<button type="submit" class="quiet" formaction="/admin/providers/${esc(p.id)}/areas/add">Add the area</button>
${areas.map((a) => `<button type="submit" class="danger" formaction="/admin/providers/${esc(p.id)}/areas/${a.position}/delete" formnovalidate${confirmAttr(`the area “${a.name}”`)}>Delete ${esc(a.name)}</button>`).join('')}
<button type="submit" class="danger" formaction="/admin/providers/${esc(p.id)}/delete" formnovalidate${confirmAttr(`${p.displayName}`)}>Delete provider</button>
</div>
</form>
</details>`;
}

function networkSection(tv) {
	const row = (n) => `<form method="post" action="/admin/networks/${n.id}" class="fields">
<label>Name ESPN gives it <input name="key" required value="${esc(n.key)}"></label>
<label>Shown as <input name="display_name" value="${esc(n.displayName)}"></label>
<label>Other names <input name="aliases" value="${esc((n.aliases ?? []).join(', '))}"></label>
<label>Kind <select name="kind">${KINDS.map((k) => `<option${k === n.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
<label>Description <input name="description" value="${esc(n.description ?? '')}"></label>
<label>Website <input name="website_url" value="${esc(n.websiteUrl ?? '')}"></label>
<label>One club's own <input name="club" value="${esc(n.club ?? '')}" placeholder="mlb/brewers"></label>
<div class="buttons"><button type="submit">Save</button><button type="submit" class="danger" formaction="/admin/networks/${n.id}/delete" formnovalidate${confirmAttr(`the network ${n.displayName}`)}>Delete</button></div>
</form>`;
	return `<details id="networks"><summary>Networks <span class="dim">· ${tv.networks.length}</span></summary>
${tv.networks.slice().sort(byName).map(row).join('<hr style="border:0;border-top:1px solid rgba(127,127,127,.25)">')}
<h3>Add a network</h3>
<form method="post" action="/admin/networks/add" class="fields">
<label>Name ESPN gives it <input name="key" required></label>
<label>Shown as <input name="display_name"></label>
<label>Kind <select name="kind">${KINDS.map((k) => `<option${k === 'cable' ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
<label>One club's own <input name="club" placeholder="mlb/brewers"></label>
<div class="buttons"><button type="submit">Add</button></div>
</form>
</details>`;
}

const changeRow = (c) => {
	const show = (v) => (v == null ? '' : esc(v.channel ?? v.name ?? v.display_name ?? JSON.stringify(v)).slice(0, 120));
	return `<tr><td>${esc(new Date(c.at).toLocaleString('en-US', { timeZone: 'America/Chicago' }))}</td><td>${esc(c.action)}</td><td>${esc(c.subject)}</td><td>${show(c.before)}</td><td>${show(c.after)}</td></tr>`;
};

/** The page's body; lib/tv-admin.js wraps it. */
/** An area's TV market, for regional NFL games: its name, from the seven
 *  calibrated or any other, and for any other its place on a posted 506sports
 *  map, set by a click (lib/coverage.js marketPoints). */
function marketField(a, mapUrl) {
	const placed = Number.isInteger(a.mapX) && Number.isInteger(a.mapY);
	const pos = (v, of) => `${((v / of) * 100).toFixed(2)}%`;
	return `<fieldset class="tvl-market"><legend>Area ${a.position + 1}'s TV market <span class="dim">for regional NFL games</span></legend>
<input name="dma_${a.position}" list="tvl-markets" value="${esc(a.dma ?? '')}" placeholder="Wausau, or any market's name" aria-label="Area ${a.position + 1}'s TV market">
<input type="hidden" name="mapx_${a.position}" value="${placed ? a.mapX : ''}"><input type="hidden" name="mapy_${a.position}" value="${placed ? a.mapY : ''}">
<details><summary data-tvl-placed>${placed ? `Placed on the map at ${a.mapX}, ${a.mapY}` : 'Place it on the map'}</summary>
<p class="dim">For a market other than the seven calibrated ones (${esc(Object.keys(DMA_POINTS).join(', '))}): click where the area is. Its name is matched to a streaming game's simulcast stations.</p>
<div class="tvl-map" data-tvl-map="${a.position}"><img src="${esc(mapUrl)}" alt="A 506sports coverage map" loading="lazy">
<span class="tvl-pin"${placed ? ` style="left:${pos(a.mapX, 1280)};top:${pos(a.mapY, 720)}"` : ' hidden'}></span></div>
<button type="button" data-tvl-clear>Clear the place</button>
</details></fieldset>`;
}

export function listingsBody(tv, { changes = [], flash = null, errors = [], mapUrl = REFERENCE_MAP } = {}) {
	const providers = tv.providers.slice().sort(byName);
	return `${CSS}
<nav class="tvl-nav"><a href="/admin">Submissions</a><strong>Full listings</strong>
<input class="tvl-search" type="search" placeholder="Find a provider, area or other name…" aria-label="Find a provider" data-tvl-search>
</nav>
<div class="tvl">
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
${errors.length ? `<div class="errors">${errors.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
${networkSection(tv)}
<h2>Providers (${providers.length})</h2>
${providers.map((p) => providerSection(tv, p, mapUrl)).join('\n')}
<datalist id="tvl-markets">${Object.keys(DMA_POINTS).map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
<form method="post" action="/admin/providers/add" class="fields"><label>Add a provider <input name="display_name" required maxlength="120" placeholder="Name"></label><div class="buttons"><button type="submit">Add</button></div></form>
<h2>Changes</h2>
${changes.length ? `<div class="grid-wrap"><table><thead><tr><th>When</th><th>What</th><th>To</th><th>Before</th><th>After</th></tr></thead><tbody>${changes.map(changeRow).join('')}</tbody></table></div>` : '<p>None yet.</p>'}
</div>
<script>
(() => {
	const box = document.querySelector('[data-tvl-search]');
	const all = [...document.querySelectorAll('.tvl-provider')];
	box?.addEventListener('input', () => {
		const q = box.value.trim().toLowerCase();
		for (const d of all) { const hit = !q || d.dataset.search.includes(q); d.hidden = !hit; if (q && hit) d.open = true; }
	});
	// Back where you were after a save: the provider in the address.
	const here = location.hash && document.querySelector(location.hash);
	if (here && here.tagName === 'DETAILS') { here.open = true; here.scrollIntoView(); }
		// Placing a market: a click on the map is its point in the map's own
		// 1280x720 pixels, however large the picture is drawn. No backticks in
		// here: this script is inside the template that draws the page.
		for (const box of document.querySelectorAll('[data-tvl-map]')) {
			const set = box.closest('fieldset');
			const img = box.querySelector('img'), pin = box.querySelector('.tvl-pin');
			const field = (k) => set.querySelector('[name="' + k + '_' + box.dataset.tvlMap + '"]');
			img.addEventListener('click', (e) => {
				const r = img.getBoundingClientRect();
				const x = Math.round(((e.clientX - r.left) / r.width) * 1280), y = Math.round(((e.clientY - r.top) / r.height) * 720);
				field('mapx').value = x; field('mapy').value = y;
				pin.hidden = false; pin.style.left = (x / 12.8).toFixed(2) + '%'; pin.style.top = (y / 7.2).toFixed(2) + '%';
				set.querySelector('[data-tvl-placed]').textContent = 'Placed on the map at ' + x + ', ' + y + ' (save to keep it)';
			});
			set.querySelector('[data-tvl-clear]').addEventListener('click', () => {
				field('mapx').value = ''; field('mapy').value = ''; pin.hidden = true;
				set.querySelector('[data-tvl-placed]').textContent = 'Place it on the map (save to clear)';
			});
		}
})();
</script>`;
}
