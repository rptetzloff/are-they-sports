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

/** The provider and area pickers: `sel` and `area` are <select>s, `areaWrap`
 *  the area's label (hidden for a provider of one area), `bar` the whole of
 *  it (hidden until there are providers). `onChange` runs after a choice. */
export function wirePicker({ bar, sel, area, areaWrap, onChange }) {
	const draw = () => {
		if (!tv.providers.length) return;
		bar.hidden = false;
		const p = provider();
		sel.replaceChildren(sel.options[0], ...tv.providers.map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; return o; }));
		sel.value = p?.id ?? '';
		areaWrap.hidden = !p || p.areas.length < 2;
		if (p && p.areas.length > 1) {
			area.replaceChildren(...p.areas.map((name, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; return o; }));
			area.value = String(areaOf(p));
		}
	};
	sel.addEventListener('change', (e) => { store.set('tvProvider', e.target.value); draw(); onChange(); });
	area.addEventListener('change', (e) => { const p = provider(); if (p) store.set(`tvServiceArea.${p.id}`, e.target.value); onChange(); });
	draw();
	return draw;
}
