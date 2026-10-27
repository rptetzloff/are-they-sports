// A league's page (league.html): a day's or a week's games from ESPN's
// scoreboard in the schedule column, one of them as a card in the slot where
// a club's page shows its own game, and the postseason bracket. The same file
// in every sport's front end; what differs arrives as window.CLUB, which the
// server writes for the league (lib/web-routes.js leagueConfig).
//
// The URL carries the period and the game (?p=d2026-10-20&g=401...), so a
// shared link opens on the game it was shared from.
import {
	calendarPeriods, currentPeriod, dayPeriod, footballBracketHtml, footballRounds, gameCardHtml, gameOf,
	gameRowsHtml, parsePeriodKey, periodQuery, pickGame, refreshMs,
} from './league-core.js';
import * as share from './share-core.js';
import { SITE } from './site.js';

const $ = (id) => document.getElementById(id);
const scoreboardUrl = (query) => `api/espn/apis/site/v2/sports/${SITE.espnLeague}/scoreboard${query ? `?${query}` : ''}`;
const weekly = SITE.period === 'week';

const state = { periods: [], period: null, games: [], selected: null, timer: null, bracketAt: 0 };

async function scoreboard(query) {
	const res = await fetch(scoreboardUrl(query));
	if (!res.ok) throw new Error(`scoreboard ${res.status}`);
	return res.json();
}

// The sport's own live detail for the card, where it has one: baseball's
// bases, outs and count. Football and basketball have none to add, and their
// front ends have no such file.
let situation = null;
const situationReady = import('./situation-core.js').then((m) => { situation = m; }).catch(() => {});

// A club's page here, by the name ESPN gives it, from the team menu the
// server put in the footer.
let clubLinks = null;
function clubHref(name) {
	if (!clubLinks) {
		clubLinks = new Map([...document.querySelectorAll('.footer-club-menu a[href]')]
			.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
	}
	return clubLinks.get(name) ?? null;
}

// --- the viewer's TV ----------------------------------------------------------
// The home page's provider choice and channel numbers (tv-pick.js, at the
// site's root), which the club pages keep too: each network's number on the
// viewer's provider as a pill. None where the site has no such tables.
let tv = null;
// A club's key ('mlb/brewers'), from its page's link: a club's own network,
// Brewers.TV, is that club's games' only.
const keyOf = (name) => { const m = /([a-z0-9]+)\/([a-z0-9-]+)\/?$/i.exec(clubHref(name) ?? ''); return m ? `${m[1]}/${m[2]}` : null; };
// The NFL's regional CBS and FOX games, by game: which one the viewer's market
// gets (the home page's /api/today, from 506sports' maps).
let coverage = new Map();
const tvOf = (g) => tv.tvHtml(g.tv, { clubs: [keyOf(g.away.name), keyOf(g.home.name)].filter(Boolean), coverage: coverage.get(g.id) ?? null });
const ymdOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
async function readCoverage() {
	coverage = new Map();
	const dma = tv?.market();
	const first = state.games.map((g) => g.date).filter(Boolean).sort()[0];
	if (SITE.espnLeague !== 'football/nfl' || !dma || !first) return;
	try {
		const r = await fetch(`../api/today?date=${ymdOf(first)}&sports=nfl&football=week&dma=${encodeURIComponent(dma)}`);
		const games = r.ok ? (await r.json()).leagues?.[0]?.games ?? [] : [];
		coverage = new Map(games.filter((g) => g.coverage).map((g) => [g.id, g.coverage]));
	} catch { /* named without saying whether the market has it */ }
}
const tvReady = import('../tv-pick.js').then(async (m) => {
	if (!(await m.loadTv('../'))) return;
	tv = m;
	m.wirePicker({ bar: $('tvbar'), sel: $('provider'), area: $('area'), areaWrap: $('area-wrap'),
		onChange: () => { drawList(); drawCard(); readCoverage().then(() => { drawList(); drawCard(); }); } });
}).catch(() => {});

// --- drawing --------------------------------------------------------------

function drawList() {
	const p = state.period;
	$('season-label').textContent = p ? (weekly ? `${p.label}${p.season ? ` · ${p.season}` : ''}` : p.label) : '';
	$('schedule-title').innerHTML = `<i class="mdi mdi-calendar-month"></i> ${weekly ? 'This week’s games' : 'The day’s games'}`;
	$('schedule-grid').innerHTML = gameRowsHtml(state.games, { selected: state.selected, weekly, tvHtml: tv ? tvOf : null });
	const i = state.periods.findIndex((x) => x.key === p?.key);
	$('league-prev').disabled = !p;
	$('league-next').disabled = !p;
	$('league-today').hidden = i < 0 ? false : state.periods[i]?.key === state.todayKey;
	const live = state.games.filter((g) => g.state === 'in').length;
	const done = state.games.filter((g) => g.final).length;
	$('record').textContent = state.games.length
		? [`${state.games.length} game${state.games.length === 1 ? '' : 's'}`, live && `${live} live`, done && `${done} final`].filter(Boolean).join(' · ')
		: 'No games';
}

function drawCard() {
	const slot = $('schedule-featured');
	const g = state.games.find((x) => x.id === state.selected);
	if (!g) { slot.hidden = true; slot.innerHTML = ''; return; }
	const extra = g.state === 'in' && situation && g.situation ? situation.situationHtml(situation.liveSituation(g.situation)) : '';
	slot.innerHTML = gameCardHtml(g, { clubHref, extraHtml: extra, tvHtml: tv ? tvOf : null });
	slot.hidden = false;
}

function writeUrl() {
	const q = new URLSearchParams();
	if (state.period) q.set('p', state.period.key);
	if (state.selected) q.set('g', state.selected);
	history.replaceState(null, '', `${location.pathname}?${q}`);
}

function select(id, { scroll = false } = {}) {
	state.selected = id;
	drawList();
	drawCard();
	writeUrl();
	// On a phone the card is above the list, out of sight of the row tapped.
	if (scroll && window.matchMedia('(max-width: 1099px)').matches) $('schedule-featured').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- loading --------------------------------------------------------------

/** Load a period (null: whatever ESPN calls today), keeping the selected game
 *  if it is in it. */
async function load(period, { keep = null } = {}) {
	clearTimeout(state.timer);
	const data = await scoreboard(period ? periodQuery(period) : '');
	const periods = calendarPeriods(data);
	if (periods.length) state.periods = periods;
	state.period = currentPeriod(data, state.periods) ?? (period && state.periods.find((p) => p.key === period.key)) ?? period;
	if (!period) state.todayKey = state.period?.key ?? null;
	state.games = (data.events ?? []).map(gameOf).filter((g) => g.id);
	state.selected = state.games.some((g) => g.id === keep) ? keep : pickGame(state.games)?.id ?? null;
	await situationReady;
	await tvReady;
	await readCoverage();
	drawList();
	drawCard();
	writeUrl();
	const wait = refreshMs(state.games);
	if (wait) state.timer = setTimeout(() => load(state.period, { keep: state.selected }).catch(console.error), wait);
	loadBracket().catch(console.error);
}

/** The next or previous period. Past either end of the season's calendar,
 *  the day (or week) beyond it, whose own calendar is the neighbouring
 *  season's. */
async function step(dir) {
	const i = state.periods.findIndex((p) => p.key === state.period?.key);
	const next = state.periods[i + dir];
	if (i >= 0 && next) return load(next);
	const p = state.period;
	if (!p) return;
	if (p.day) {
		// Into the off season: ask for the day beyond, then settle on the
		// nearest game day the answer's calendar has.
		const beyond = new Date(Date.parse(`${p.day}T12:00:00Z`) + dir * 86_400_000).toISOString().slice(0, 10);
		const data = await scoreboard(`dates=${beyond.replace(/-/g, '')}`);
		const days = calendarPeriods(data);
		const land = dir < 0 ? days.filter((d) => d.day < p.day).at(-1) : days.find((d) => d.day > p.day);
		if (land) return load(land);
		return;
	}
	// Football: the season before ends on its Super Bowl, the one after
	// opens on its preseason.
	return load(dir < 0
		? { key: `w${p.season - 1}-3-5`, season: p.season - 1, type: 3, week: 5 }
		: { key: `w${p.season + 1}-1-1`, season: p.season + 1, type: 1, week: 1 });
}

// --- the bracket ------------------------------------------------------------

async function loadBracket() {
	// Once a minute at most: every period change and refresh lands here.
	if (Date.now() - state.bracketAt < 60_000) return;
	state.bracketAt = Date.now();
	let html = null;
	if (weekly) {
		// The season being looked at, once its postseason has a game.
		const post = state.periods.filter((p) => p.type === 3);
		if (post.length && Date.parse(post[0].start) <= Date.now()) {
			const weeks = await Promise.all(post.map(async (p) => ({ label: p.label, key: p.key, events: (await scoreboard(periodQuery(p)).catch(() => ({}))).events })));
			html = footballBracketHtml(footballRounds(weeks), { selected: state.selected });
		}
	} else {
		const res = await fetch('api/bracket').catch(() => null);
		if (res?.ok) {
			const { games } = await res.json();
			const bracket = await import('./bracket-core.js');
			html = games?.length ? bracket.bracketHtml(bracket.bracketSeries(games), null) : null;
		}
	}
	$('playoff-panel').innerHTML = html ?? '';
	$('playoff-details').hidden = !html;
}

// --- wiring -----------------------------------------------------------------

function wire() {
	const grid = $('schedule-grid');
	grid.addEventListener('click', (e) => {
		const row = e.target.closest('.league-row');
		if (row) select(row.dataset.key, { scroll: true });
	});
	grid.addEventListener('keydown', (e) => {
		const row = e.target.closest('.league-row');
		if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(row.dataset.key, { scroll: true }); }
	});
	// A football bracket game opens in the card, from its own week.
	$('playoff-panel').addEventListener('click', (e) => {
		const g = e.target.closest('.lb-g');
		if (!g) return;
		const id = g.dataset.key;
		if (state.games.some((x) => x.id === id)) return select(id, { scroll: true });
		const week = parsePeriodKey(g.closest('.lb-round')?.dataset.period);
		if (week) load(week, { keep: id }).catch(console.error);
	});
	$('league-prev').addEventListener('click', () => step(-1).catch(console.error));
	$('league-next').addEventListener('click', () => step(1).catch(console.error));
	$('league-today').addEventListener('click', () => load(null).catch(console.error));

	const menu = $('footer-share');
	if (menu) {
		const label = `${SITE.fullName} scores and schedule`;
		menu.innerHTML = share.labeledShareButtonsHtml
			? share.labeledShareButtonsHtml('footer-share-item')
			: share.shareButtonsHtml('footer-share-item', { labels: true });
		share.wireShareRow(menu, label, location.href.split('?')[0], { labels: true });
		share.wireShareDropdown();
	}
}

async function init() {
	wire();
	const q = new URLSearchParams(location.search);
	const period = parsePeriodKey(q.get('p'));
	try {
		await load(period, { keep: q.get('g') });
		// A shared day ESPN no longer lists still opens on that day.
		if (period?.day && !state.period) state.period = dayPeriod(period.day);
	} catch (e) {
		console.error(e);
		$('schedule-grid').innerHTML = '<div class="loading">Could not load the scoreboard. Try again later.</div>';
	}
}

init();
