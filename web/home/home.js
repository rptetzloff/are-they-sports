// The home page's games: every league's for the day (/api/today), a section a
// league with the live ones first, the visitor's pinned teams above them.
// Drawn by lib/home.js; this fills it, moves it by day, and refreshes it every
// half minute while a game is live, every five minutes otherwise.

import { readLeagues, ordered, onLeagues } from './leagues-pref.js';
import { loadTv, market, tvHtml, wirePicker } from './tv-pick.js';

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
	return `<span class="t${g.state === 'post' && t.winner ? ' won' : ''}"><span class="nm">${star}${name}${rec}</span><span class="sc">${score}</span></span>`;
}
// --- the viewer's TV provider, the same choice the club pages and the league
// pages keep (tv-pick.js) ---
const tvOf = (g) => tvHtml(g.tv, { clubs: [g.away.key, g.home.key].filter(Boolean), coverage: g.coverage });
// A new provider or area is a new market, so the day is read again for it.
loadTv().then((ok) => {
	if (!ok) return;
	wirePicker({ bar: document.getElementById('tvbar'), sel: document.getElementById('provider'), area: document.getElementById('area'),
		areaWrap: document.getElementById('area-wrap'), onChange: () => { draw(); load(); } });
	if (market()) load(); else if (leagues.length) draw();
});
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
	// The visitor's leagues (leagues-pref.js, chosen in the scores strip): the
	// hidden ones gone, and in their order where they have set one. Otherwise
	// the leagues with games first, live before not, then the rest, each in the
	// scope's order.
	const box = document.getElementById('leagues');
	const p = readLeagues();
	for (const el of box.children) el.hidden = p.hidden.includes(el.dataset.sport);
	const theirs = ordered(sports, p);
	const rank = (s) => { const l = leagues.find((x) => x.sport === s); return l?.games.length ? (l.games.some((g) => g.state === 'in') ? 0 : 1) : 2; };
	const by = p.order.length ? (a, b) => theirs.indexOf(a) - theirs.indexOf(b) : (a, b) => rank(a) - rank(b) || sports.indexOf(a) - sports.indexOf(b);
	[...box.children].sort((a, b) => by(a.dataset.sport, b.dataset.sport)).forEach((el) => box.appendChild(el));
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

onLeagues(draw);
// A team starred in the footer's Team menu (lib/web.js) is pinned here too.
window.addEventListener('ats-pins', () => { pins = new Set(readPins()); syncPins(); draw(); });
window.addEventListener('storage', (e) => { if (e.key === PINS) { pins = new Set(readPins()); syncPins(); draw(); } });
syncPins();
load();
