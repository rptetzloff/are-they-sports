// The viewer's TV provider and a network's number on it, for the pages that
// list every league's or one league's games: the home page (home.js) and each
// league's page (web/<sport>/league.js). The same choice the club pages keep
// (tvProvider, tvServiceArea.<provider> in localStorage), so it is made once.
//
// The tables are /api/tv's (server.js): every provider and its areas, every
// network by all its names, every channel.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let tv = { providers: [], networks: [], channels: [] };
const store = {
	get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
	set: (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* no storage */ } },
};

/** The tables, from `base` + 'api/tv' (the site's root, relative to the
 *  page). False where there are none. */
export async function loadTv(base = '') {
	try {
		const r = await fetch(`${base}api/tv`);
		const t = r.ok ? await r.json() : null;
		if (t?.providers?.length) { tv = t; return true; }
	} catch { /* no numbers */ }
	return false;
}

export const provider = () => tv.providers.find((p) => p.id === store.get('tvProvider')) ?? null;
const areaOf = (p) => { const i = Number.parseInt(store.get(`tvServiceArea.${p.id}`), 10); return Number.isInteger(i) && i >= 0 && i < p.areas.length ? i : 0; };
/** The viewer's TV market (their area's, set in the admin), for which CBS and
 *  FOX game its stations carry; null without one. */
export const market = () => { const p = provider(); return p ? (p.dmas?.[p.areas.length ? areaOf(p) : 0] ?? null) : null; };

// A club's own network (Brewers.TV) is that club's only: `clubs` is the two
// sides' keys ('mlb/brewers').
const networkOf = (name, clubs) => {
	const lower = String(name).toLowerCase();
	return tv.networks.find((n) => n.names.includes(lower) && (!n.club || clubs.includes(n.club))) ?? null;
};

/** A network's number on the viewer's provider, in their area: an area's own
 *  channel, else the one for every area. Null where not carried. */
export function channelFor(name, clubs = []) {
	const p = provider();
	if (!p) return null;
	const net = networkOf(name, clubs);
	if (!net) return null;
	const area = p.areas.length ? areaOf(p) : null;
	const mine = tv.channels.filter((c) => c.provider === p.id && c.network === net.id);
	return (mine.find((c) => c.area === area) ?? mine.find((c) => c.area == null) ?? (p.areas.length <= 1 ? mine.find((c) => c.area === 0) : null))?.channel ?? null;
}
export const networkName = (name, clubs = []) => networkOf(name, clubs)?.display ?? name;

/** A game's TV as HTML: each network by its own name, its number on the
 *  viewer's provider as a pill, the carried ones first, three at most.
 *  `coverage` is the NFL's regional word for the game (lib/today.js). */
export function tvHtml(names, { clubs = [], coverage = null, max = 3 } = {}) {
	if (!names?.length) return '';
	// A regional CBS or FOX game: no number where the viewer's station carries
	// another game, and said so; 'regional' where their market is not known or
	// the maps are not posted.
	const cov = coverage;
	const regional = (name) => (cov?.regional && cov.network === String(name).toUpperCase() ? cov : null);
	const all = names.map((name) => {
		const r = regional(name);
		if (r?.carried === false) return { name: networkName(name, clubs), ch: null, note: 'not here', title: r.other ? `Your station has ${r.other}` : '' };
		if (r && r.carried == null) return { name: networkName(name, clubs), ch: null, note: 'regional', title: 'Which markets get it: 506sports' };
		return { name: networkName(name, clubs), ch: channelFor(name, clubs) };
	});
	// A streaming game's over-the-air simulcast, where it is the viewer's market's.
	if (cov?.station) all.push({ name: networkName(cov.station.net, clubs), ch: channelFor(cov.station.net, clubs), note: cov.station.call });
	all.sort((a, b) => Number(Boolean(b.ch)) - Number(Boolean(a.ch)));
	const item = (n) => {
		const note = n.note ? ` <span class="more"${n.title ? ` title="${esc(n.title)}"` : ''}>(${esc(n.note)})</span>` : '';
		return n.ch
			? `<span class="on">${esc(n.name)}<span class="ch-pill" title="Channel ${esc(n.ch)}">${esc(n.ch)}</span>${note}</span>`
			: `${esc(n.name)}${note}`;
	};
	const shown = all.slice(0, max).map(item).join(' · ');
	return all.length > max ? `${shown} <span class="more" title="${esc(all.slice(max).map((n) => n.name).join(', '))}">+${all.length - max}</span>` : shown;
}

// --- the picker: the club pages' own (web/<sport>/main.js) ------------------
// A bar saying the provider, its logo as a banner where it has one, and a
// Change button that opens a dialog: a search of every provider by its names,
// then its service areas. The same markup and classes as the club pages', so
// their styles.css draws it; the home page carries its own copy (lib/home.js).

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// A provider's logo, with its colour block behind it; null without one, or
// with its display switched off. A logo that fails to load goes.
function logoEl(p, large = false) {
	if (!p?.logo || !p.displayLogo) return null;
	const wrap = el('span', 'provider-logo' + (large ? ' provider-logo-large' : ''));
	if (p.logoBg) wrap.style.background = p.logoBg;
	const img = el('img');
	img.src = p.logo;
	img.alt = `${p.name} logo`;
	img.loading = 'lazy';
	img.addEventListener('error', () => wrap.remove());
	wrap.appendChild(img);
	return wrap;
}

// Providers matching a query, starts-with before contains, by name or alias
// ("charter" finds Spectrum, saying so); every one for an empty query.
function matches(q) {
	if (!q) return tv.providers.map((p) => ({ p, via: null }));
	const scored = [];
	for (const p of tv.providers) {
		let best = null;
		for (const n of [p.name, ...(p.aliases ?? [])]) {
			const ln = n.toLowerCase();
			const rank = ln.startsWith(q) ? 0 : ln.includes(q) ? 1 : -1;
			if (rank < 0) continue;
			const via = n === p.name ? null : n;
			if (!best || rank < best.rank || (rank === best.rank && !via && best.via)) best = { rank, via };
		}
		if (best) scored.push({ p, ...best });
	}
	return scored.sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name));
}
const byExactName = (q) => tv.providers.find((p) => [p.name, ...(p.aliases ?? [])].some((n) => n.toLowerCase() === q)) ?? null;

/** The provider bar in `bar` (hidden until there are providers) and its
 *  dialog. `onChange` runs after each choice; `submit` is the "not listed"
 *  page, `examples` the search's examples. Returns the bar's redraw. */
export function mountPicker({ bar, onChange, submit = 'tv/submit', examples = 'Xfinity, Spectrum, DIRECTV' }) {
	const modal = el('div', 'gallery-modal');
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-label', 'Change TV provider');
	modal.hidden = true;
	modal.innerHTML = `<div class="provider-backdrop"></div><div class="provider-dialog">
<div class="gallery-header"><h2 class="gallery-title">TV Provider</h2><button type="button" class="gallery-close" aria-label="Close"><i class="mdi mdi-close"></i></button></div>
<p class="watch-game-info">Choose your TV provider to see channel numbers.</p>
<div class="watch-channels"></div>
<p class="watch-disclaimer"><a href="${esc(submit)}">Provider not listed? Add it.</a></p></div>`;
	document.body.appendChild(modal);
	const close = () => { modal.hidden = true; };
	modal.querySelector('.provider-backdrop').addEventListener('click', close);
	modal.querySelector('.gallery-close').addEventListener('click', close);
	document.addEventListener('keydown', (e) => { if (!modal.hidden && e.key === 'Escape') close(); });

	const draw = () => {
		bar.hidden = !tv.providers.length;
		if (bar.hidden) return;
		bar.classList.add('schedule-provider-bar');
		const p = provider();
		const display = el('div', 'schedule-provider-display');
		const label = el('span', 'schedule-provider-label', 'TV provider');
		const change = el('button', 'schedule-provider-change');
		change.type = 'button';
		change.innerHTML = p ? '<i class="mdi mdi-pencil"></i> Change' : '<i class="mdi mdi-magnify"></i> Choose';
		change.addEventListener('click', open);
		const logo = logoEl(p, true);
		if (logo) {
			// Sponsor-style billing: the logo the bar's width, the name under it.
			display.classList.add('schedule-provider-display-banner');
			const head = el('div', 'schedule-provider-header');
			head.append(label, change);
			const slot = el('div', 'schedule-provider-slot');
			if (p.website) {
				const a = el('a', 'schedule-provider-logo-link');
				a.href = p.website; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = p.name;
				a.appendChild(logo);
				slot.appendChild(a);
			} else slot.appendChild(logo);
			slot.appendChild(el('span', 'schedule-provider-caption', p.name));
			display.append(head, slot);
		} else {
			const name = el('span', 'schedule-provider-name' + (p ? '' : ' schedule-provider-none'), p ? p.name : 'Not selected');
			display.append(label, name, change);
		}
		bar.replaceChildren(display);
	};
	const changed = () => { draw(); onChange(); };

	function open() {
		const box = modal.querySelector('.watch-channels');
		box.replaceChildren(searchEl({ examples, onPick: (p, source) => {
			changed();
			// A provider of one area, or an area, finishes the dialog.
			if (source === 'area' || (source === 'row' && !(p?.areas.length > 1))) close();
		}, onClear: changed }));
		modal.hidden = false;
		const input = box.querySelector('input');
		input.focus();
		input.select();
	}

	draw();
	return draw;
}

// The dialog's search: the input, every matching provider as a row, and the
// chosen one's service areas as rows too.
function searchEl({ examples, onPick, onClear }) {
	const wrap = el('div', 'watch-provider-picker');
	const lbl = el('label', 'watch-provider-label', 'Your TV provider');
	lbl.htmlFor = 'tvpick-input';
	const inputWrap = el('div', 'watch-provider-input-wrap');
	const input = el('input', 'watch-provider-input');
	Object.assign(input, { type: 'text', id: 'tvpick-input', placeholder: `Search providers (e.g. ${examples})…`, autocomplete: 'off', spellcheck: false });
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-controls', 'tvpick-list');
	input.value = provider()?.name ?? '';
	const clear = el('button', 'watch-provider-clear');
	clear.type = 'button';
	clear.setAttribute('aria-label', 'Clear provider');
	clear.innerHTML = '<i class="mdi mdi-close"></i>';
	clear.hidden = !input.value;
	inputWrap.append(input, clear);
	const sugg = el('div', 'watch-provider-suggestions watch-provider-suggestions-inline');
	sugg.id = 'tvpick-list';
	sugg.setAttribute('role', 'listbox');
	const hint = el('div', 'watch-provider-hint');
	hint.hidden = true;
	const areaWrap = el('div', 'watch-service-area-picker');
	areaWrap.hidden = true;
	const areaList = el('div', 'watch-area-options');
	areaList.setAttribute('role', 'listbox');
	areaWrap.append(el('div', 'watch-service-area-label', 'Service area'), areaList);
	wrap.append(lbl, inputWrap, sugg, hint, areaWrap);

	const drawAreas = (p) => {
		areaList.replaceChildren();
		areaWrap.hidden = !(p?.areas.length > 1);
		if (areaWrap.hidden) return;
		const saved = areaOf(p);
		p.areas.forEach((name, i) => {
			const row = el('button', 'watch-provider-suggestion watch-area-option' + (i === saved ? ' active' : ''));
			row.type = 'button';
			row.setAttribute('role', 'option');
			row.setAttribute('aria-selected', String(i === saved));
			row.appendChild(el('span', 'watch-provider-suggestion-name', name));
			row.addEventListener('click', () => {
				store.set(`tvServiceArea.${p.id}`, String(i));
				drawAreas(p);
				onPick(p, 'area');
			});
			areaList.appendChild(row);
		});
	};
	const pick = (p, source, { rewrite = true } = {}) => {
		store.set('tvProvider', p?.id ?? '');
		if (p && rewrite) input.value = p.name;
		clear.hidden = !input.value;
		hint.hidden = true;
		drawAreas(p);
		if (p) onPick(p, source); else onClear();
	};

	let active = -1;
	let shown = [];
	const drawSugg = () => {
		let q = input.value.trim().toLowerCase();
		// The current choice's own name lists everything, not just itself.
		if (q && q === provider()?.name.toLowerCase()) q = '';
		shown = matches(q);
		sugg.replaceChildren();
		sugg.hidden = !shown.length;
		shown.forEach(({ p, via }, i) => {
			const row = el('button', 'watch-provider-suggestion' + (i === active ? ' active' : ''));
			row.type = 'button';
			row.setAttribute('role', 'option');
			const logo = logoEl(p);
			if (logo) row.appendChild(logo);
			row.appendChild(el('span', 'watch-provider-suggestion-name', p.name));
			if (via) row.appendChild(el('span', 'watch-provider-suggestion-via', via));
			row.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(p, 'row'); });
			sugg.appendChild(row);
		});
	};
	input.addEventListener('keydown', (e) => {
		const rows = sugg.querySelectorAll('.watch-provider-suggestion');
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			active = e.key === 'ArrowDown' ? Math.min(active + 1, rows.length - 1) : Math.max(active - 1, 0);
			rows.forEach((r, i) => r.classList.toggle('active', i === active));
			rows[active]?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && shown[active]) {
			e.preventDefault();
			pick(shown[active].p, 'row');
		}
	});
	input.addEventListener('input', () => {
		active = -1;
		clear.hidden = !input.value;
		const v = input.value.trim().toLowerCase();
		const exact = v ? byExactName(v) : null;
		if (!v) pick(null, 'clear', { rewrite: false });
		// The whole name typed: chosen, without rewriting it mid-word.
		else if (exact) pick(exact, 'typed', { rewrite: false });
		else hint.hidden = true;
		drawSugg();
	});
	clear.addEventListener('click', () => { input.value = ''; pick(null, 'clear'); drawSugg(); input.focus(); });
	drawSugg();
	drawAreas(provider());
	return wrap;
}
