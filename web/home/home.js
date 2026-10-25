// The home page's games: every league's for the day (/api/today), a section a
// league with the live ones first, the visitor's pinned teams above them.
// Drawn by lib/home.js; this fills it, moves it by day, and refreshes it every
// half minute while a game is live, every five minutes otherwise.

const PINS = 'ats.pins';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sports = JSON.parse(document.getElementById('leagues').dataset.leagues);

// --- pins, in this browser only ---
const readPins = () => { try { return JSON.parse(localStorage.getItem(PINS) || '[]'); } catch { return []; } };
const writePins = (keys) => { try { localStorage.setItem(PINS, JSON.stringify(keys)); } catch { /* no storage */ } };
let pins = new Set(readPins());

// --- the day: the viewer's own, or ?date=YYYYMMDD ---
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
const asked = new URLSearchParams(location.search).get('date');
let day = /^\d{8}$/.test(asked ?? '') ? fromYmd(asked) : new Date();
day.setHours(12, 0, 0, 0);
const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
function dayLabel(d) {
	const diff = Math.round((d - today()) / 86400000);
	const name = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	return diff === 0 ? `Today · ${name}` : diff === -1 ? `Yesterday · ${name}` : diff === 1 ? `Tomorrow · ${name}` : name;
}

// --- one game ---
const ORDER = { in: 0, pre: 1, post: 2 };
const byInterest = (a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || String(a.start).localeCompare(String(b.start));
function when(g) {
	if (g.state === 'in') return esc(g.status || 'Live');
	if (g.state === 'post') return esc(g.status || 'Final');
	if (!g.timeValid) return 'TBD';
	return esc(new Date(g.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
}
function team(t, g) {
	const name = t.url ? `<a href="${esc(t.url)}">${esc(t.short || t.name)}</a>` : esc(t.short || t.name);
	const star = t.key && pins.has(t.key) ? '<span class="star" title="Pinned">★</span>' : '';
	const score = g.state === 'pre' ? '' : esc(t.score ?? '');
	const rec = g.state === 'pre' && t.record ? `<span class="rec">${esc(t.record)}</span>` : '';
	return `<span class="t${g.state === 'post' && t.winner ? ' won' : ''}">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '<span></span>'}
<span class="nm">${star}${name}${rec}</span><span class="sc">${score}</span></span>`;
}
// --- the viewer's TV provider, the same choice the club pages keep ---
let tv = { providers: [], networks: [], channels: [] };
const store = {
	get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
	set: (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* no storage */ } },
};
const provider = () => tv.providers.find((p) => p.id === store.get('tvProvider')) ?? null;
const areaOf = (p) => { const i = Number.parseInt(store.get(`tvServiceArea.${p.id}`), 10); return Number.isInteger(i) && i >= 0 && i < p.areas.length ? i : 0; };
// The viewer's TV market (their area's, set in the admin), for which CBS and
// FOX game its stations carry; null without one.
const market = () => { const p = provider(); return p ? (p.dmas?.[p.areas.length ? areaOf(p) : 0] ?? null) : null; };

/** A network's number on the viewer's provider, in their area: an area's own
 *  channel, else the one for every area. A club's own network counts only for
 *  that club's games: Brewers.TV is not the Cubs'. Null where not carried. */
function channelFor(name, g) {
	const p = provider();
	if (!p) return null;
	const lower = String(name).toLowerCase();
	const net = tv.networks.find((n) => n.names.includes(lower) && (!n.club || n.club === g.away.key || n.club === g.home.key));
	if (!net) return null;
	const area = p.areas.length ? areaOf(p) : null;
	const mine = tv.channels.filter((c) => c.provider === p.id && c.network === net.id);
	return (mine.find((c) => c.area === area) ?? mine.find((c) => c.area == null) ?? (p.areas.length <= 1 ? mine.find((c) => c.area === 0) : null))?.channel ?? null;
}
function networkName(name, g) {
	const lower = String(name).toLowerCase();
	return tv.networks.find((n) => n.names.includes(lower) && (!n.club || n.club === g.away.key || n.club === g.home.key))?.display ?? name;
}

function tvOf(g) {
	if (!g.tv.length) return '';
	// A regional CBS or FOX game (lib/today.js, from 506sports' maps): no number
	// where the viewer's station carries another game, and said so; 'regional'
	// where their market is not known or the maps are not posted.
	const cov = g.coverage;
	const regional = (name) => (cov?.regional && cov.network === String(name).toUpperCase() ? cov : null);
	const all = g.tv.map((name) => {
		const r = regional(name);
		if (r?.carried === false) return { name: networkName(name, g), ch: null, note: 'not here', title: r.other ? `Your station has ${r.other}` : '' };
		if (r && r.carried == null) return { name: networkName(name, g), ch: null, note: 'regional', title: 'Which markets get it: 506sports' };
		return { name: networkName(name, g), ch: channelFor(name, g) };
	});
	// A streaming game's over-the-air simulcast, where it is the viewer's market's.
	if (cov?.station) all.push({ name: networkName(cov.station.net, g), ch: channelFor(cov.station.net, g), note: cov.station.call });
	// The ones on the viewer's provider first, with their numbers.
	all.sort((a, b) => Number(Boolean(b.ch)) - Number(Boolean(a.ch)));
	const item = (n) => {
		const note = n.note ? ` <span class="more"${n.title ? ` title="${esc(n.title)}"` : ''}>(${esc(n.note)})</span>` : '';
		return n.ch ? `<span class="on">${esc(n.name)} <span class="ch">${esc(n.ch)}</span>${note}</span>` : `${esc(n.name)}${note}`;
	};
	const shown = all.slice(0, 3).map(item).join(' · ');
	return all.length > 3 ? `${shown} <span class="more" title="${esc(all.slice(3).map((n) => n.name).join(', '))}">+${all.length - 3}</span>` : shown;
}

function drawPicker() {
	const bar = document.getElementById('tvbar');
	if (!tv.providers.length) return;
	bar.hidden = false;
	const sel = document.getElementById('provider');
	const p = provider();
	sel.replaceChildren(sel.options[0], ...tv.providers.map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; return o; }));
	sel.value = p?.id ?? '';
	const wrap = document.getElementById('area-wrap'), area = document.getElementById('area');
	wrap.hidden = !p || p.areas.length < 2;
	if (p && p.areas.length > 1) {
		area.replaceChildren(...p.areas.map((name, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; return o; }));
		area.value = String(areaOf(p));
	}
}
// A new provider or area is a new market, so the day is read again for it.
document.getElementById('provider').addEventListener('change', (e) => { store.set('tvProvider', e.target.value); drawPicker(); draw(); load(); });
document.getElementById('area').addEventListener('change', (e) => { const p = provider(); if (p) store.set(`tvServiceArea.${p.id}`, e.target.value); draw(); load(); });
fetch('api/tv').then((r) => (r.ok ? r.json() : null)).then((t) => { if (t) { tv = t; drawPicker(); if (market()) load(); else if (leagues.length) draw(); } }).catch(() => {});
const row = (g, label = '') => `<li class="g s-${esc(g.state)}"><span class="when">${label}${when(g)}</span>
<span class="teams">${team(g.away, g)}${team(g.home, g)}</span><span class="tv">${tvOf(g)}</span></li>`;

// --- the page ---
let leagues = [];
function draw() {
	document.getElementById('day').textContent = dayLabel(day);
	let live = 0;
	for (const l of leagues) {
		const sec = document.querySelector(`.lg[data-sport="${l.sport}"]`);
		if (!sec) continue;
		const games = l.games.slice().sort(byInterest);
		const n = games.filter((g) => g.state === 'in').length;
		live += n;
		sec.classList.toggle('none', !games.length);
		sec.querySelector('.count').textContent = l.error ? 'scores unavailable just now'
			: !games.length ? 'no games' : `${games.length} game${games.length === 1 ? '' : 's'}${n ? ` · ${n} live` : ''}`;
		sec.querySelector('.day-games').innerHTML = games.map((g) => row(g)).join('');
	}
	// The leagues with games first, then the rest, each in the scope's order.
	const box = document.getElementById('leagues');
	const rank = (s) => { const l = leagues.find((x) => x.sport === s); return l?.games.length ? (l.games.some((g) => g.state === 'in') ? 0 : 1) : 2; };
	[...box.children].sort((a, b) => rank(a.dataset.sport) - rank(b.dataset.sport) || sports.indexOf(a.dataset.sport) - sports.indexOf(b.dataset.sport))
		.forEach((el) => box.appendChild(el));
	drawMine();
	return live;
}
function drawMine() {
	const sec = document.getElementById('mine');
	sec.hidden = pins.size === 0;
	if (!pins.size) return;
	const all = leagues.flatMap((l) => l.games.map((g) => ({ ...g, league: l.label })));
	const mine = all.filter((g) => pins.has(g.away.key) || pins.has(g.home.key)).sort(byInterest);
	sec.querySelector('.day-games').innerHTML = mine.map((g) => row(g, `<span title="${esc(g.league)}">${esc(g.league)} · </span>`)).join('');
	const playing = new Set(mine.flatMap((g) => [g.away.key, g.home.key]));
	const idle = [...document.querySelectorAll('.find .pin')].filter((b) => pins.has(b.dataset.pin) && !playing.has(b.dataset.pin));
	const rest = sec.querySelector('.rest');
	rest.hidden = !idle.length;
	rest.innerHTML = idle.length ? `No game ${Math.round((day - today()) / 86400000) === 0 ? 'today' : 'this day'}: ${idle.map((b) => (b.dataset.url ? `<a href="${esc(b.dataset.url)}">${esc(b.dataset.name)}</a>` : esc(b.dataset.name))).join(', ')}` : '';
	sec.querySelector('.empty').hidden = true;
}

let timer = null;
async function load() {
	clearTimeout(timer);
	let live = 0;
	try {
		// Relative: the page is the root, and the front end names no path from it.
		const m = market();
		const r = await fetch(`api/today?date=${ymd(day)}${m ? `&dma=${encodeURIComponent(m)}` : ''}`, { cache: 'no-cache' });
		if (r.ok) { leagues = (await r.json()).leagues ?? []; live = draw(); }
	} catch { /* the last day drawn stays */ }
	// Refreshed only while it is today, the faster while anything is live.
	if (ymd(day) === ymd(today())) timer = setTimeout(load, live ? 30_000 : 300_000);
}

// --- the controls ---
for (const b of document.querySelectorAll('.datebar [data-step]')) {
	b.addEventListener('click', () => {
		day = new Date(day.getTime() + Number(b.dataset.step) * 86400000);
		const url = new URL(location.href);
		if (ymd(day) === ymd(today())) url.searchParams.delete('date'); else url.searchParams.set('date', ymd(day));
		history.replaceState(null, '', url);
		for (const s of document.querySelectorAll('.lg[data-sport] .count')) s.textContent = '…';
		load();
	});
}
function syncPins() {
	for (const b of document.querySelectorAll('.find .pin')) {
		const on = pins.has(b.dataset.pin);
		b.setAttribute('aria-pressed', String(on));
		b.textContent = on ? '★' : '☆';
	}
}
document.querySelector('.find').addEventListener('click', (e) => {
	const b = e.target.closest('.pin');
	if (!b) return;
	if (pins.has(b.dataset.pin)) pins.delete(b.dataset.pin); else pins.add(b.dataset.pin);
	writePins([...pins]);
	syncPins();
	draw();
});
document.getElementById('find').addEventListener('input', (e) => {
	const q = e.target.value.trim().toLowerCase();
	for (const d of document.querySelectorAll('.find details')) {
		let hits = 0;
		for (const li of d.querySelectorAll('li')) { const hit = !q || li.dataset.find.includes(q); li.hidden = !hit; if (hit) hits++; }
		d.hidden = q && !hits;
		if (q) d.open = hits > 0;
	}
});

syncPins();
load();
