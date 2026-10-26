// The strip of scores along the top of the page (lib/scorebar.js): every
// league with games today, football's whole week, from /api/today.
//
// Two lists at its left choose what it shows (Ray, 2026-10-25): the league,
// or all of them, and within a league a filter: a conference or a division, or
// for college the Top 25. A league's page opens on its league, the home page
// on them all, and a choice is kept for that kind of page. The visitor's
// leagues (leagues-pref.js) order the list and can hide some, from its last
// entry. Within a league, this club's and the pinned teams' games come first,
// then live, then to come, then over. Scrolled sideways by hand; it moves only
// to refresh, every half minute while a game is live and every five minutes
// otherwise, and not while the tab is hidden.
import { readLeagues, writeLeagues, ordered, onLeagues } from './leagues-pref.js';

const bar = document.getElementById('scorebar');
if (bar) {
	const row = bar.querySelector('.sb-row');
	const leagueSel = bar.querySelector('.sb-league');
	const filterSel = bar.querySelector('.sb-filter');
	const filterWrap = filterSel.closest('.sb-pick');
	const panel = bar.querySelector('.sb-panel');
	const all = JSON.parse(bar.dataset.leagues);
	const labelOf = Object.fromEntries(all.map((l) => [l.sport, l.label]));
	const club = bar.dataset.club ?? null;
	const lead = bar.dataset.lead || null;
	// From the root, which the server names: under a club, <base> is the club's.
	const api = bar.dataset.api;
	const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const pins = () => { try { return new Set(JSON.parse(localStorage.getItem('ats.pins') || '[]')); } catch { return new Set(); } };

	// The choice, kept per kind of page: the home page's, the NBA's pages'.
	const KEY = `ats.strip.${lead || 'home'}`;
	const readPick = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
	const writePick = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* no storage: this page only */ } };
	let pick = readPick() ?? { league: lead ?? 'all', filter: '' };

	// Edge to edge, whatever the page's body pads itself with: the club pages
	// pad nothing, the server's pages 2rem 1rem. And at the top: body centres
	// its column, which on a page shorter than the window would bring the
	// strip down with it; an auto margin below takes the space instead.
	const pad = getComputedStyle(document.body);
	bar.style.margin = `-${pad.paddingTop} -${pad.paddingRight} auto -${pad.paddingLeft}`;
	bar.style.width = `calc(100% + ${pad.paddingLeft} + ${pad.paddingRight})`;
	// The space the page kept above its heading, kept below the strip instead.
	bar.style.paddingBottom = pad.paddingTop;

	const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	const keysOf = (g) => [g.away.key, g.home.key].filter(Boolean);
	const sameDay = (iso) => ymd(new Date(iso)) === ymd(new Date());
	const weekday = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });

	// Football's week reaches past today, so a game on another day says which.
	function status(g) {
		const other = g.start && !sameDay(g.start);
		if (g.state === 'in') return esc(g.status || 'Live');
		if (g.state === 'post') return esc(`${g.status || 'Final'}${other ? ` · ${weekday(g.start)}` : ''}`);
		if (!g.timeValid) return other ? `${weekday(g.start)} TBD` : 'TBD';
		const time = new Date(g.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
		return esc(other ? `${weekday(g.start)} ${time}` : time);
	}
	function side(t, g, mine) {
		const won = g.state === 'post' && t.winner ? ' won' : '';
		const me = t.key && mine.has(t.key) ? ' me' : '';
		const rank = t.rank ? `<small class="sb-rk">${t.rank}</small>` : '';
		return `<span class="sb-t${won}${me}"><span>${rank}${esc(t.abbr || t.short)}</span><b>${g.state === 'pre' ? '' : esc(t.score ?? '')}</b></span>`;
	}
	function chip(g, mine) {
		const own = keysOf(g).some((k) => mine.has(k));
		// To a page here: this side's if it is one of the visitor's, else the
		// home side's, else the away side's; nothing where neither has one.
		const to = [g.away, g.home].find((t) => t.url && t.key && mine.has(t.key))?.url ?? g.home.url ?? g.away.url;
		const label = `${g.away.name} ${g.state === 'pre' ? 'at' : g.away.score ?? ''} ${g.home.name} ${g.state === 'pre' ? '' : g.home.score ?? ''}, ${g.status}`;
		const tag = to ? 'a' : 'div';
		return `<${tag} class="sb-g s-${esc(g.state)}${own ? ' mine' : ''}"${to ? ` href="${esc(to)}"` : ''} aria-label="${esc(label)}">`
			+ `<span class="sb-st">${status(g)}</span>${side(g.away, g, mine)}${side(g.home, g, mine)}</${tag}>`;
	}
	// Live first; then to come, soonest first; then over, latest first.
	const ORDER = { in: 0, pre: 1, post: 2 };
	const byInterest = (a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3)
		|| (a.state === 'post' ? String(b.start).localeCompare(String(a.start)) : String(a.start).localeCompare(String(b.start)));

	/** A league's filters, for the games it has: college's Top 25, then each
	 *  conference, then each division, every one with games in it. A division
	 *  is named with its conference where that is short (AFC North, AL East)
	 *  and alone where not (Atlantic). College's conferences lose "Conference". */
	function filtersOf(l) {
		const sides = (g) => [g.away, g.home];
		const out = [];
		if (l.sport === 'ncaaf') out.push({ value: 'top25', label: 'Top 25', test: (g) => sides(g).some((t) => t.rank) });
		const confs = new Map(), divs = new Map();
		for (const g of l.games) {
			for (const t of sides(g)) {
				if (t.conference) confs.set(t.conference, t.conference.replace(/ Conference$/, ''));
				if (t.conference && t.division) divs.set(`${t.conference}|${t.division}`, t.conference.length <= 3 ? `${t.conference} ${t.division}` : t.division);
			}
		}
		for (const [conf, label] of [...confs].sort((a, b) => a[1].localeCompare(b[1]))) {
			out.push({ value: `c:${conf}`, label, test: (g) => sides(g).some((t) => t.conference === conf) });
		}
		for (const [key, label] of [...divs].sort((a, b) => a[1].localeCompare(b[1]))) {
			const [conf, div] = key.split('|');
			out.push({ value: `d:${key}`, label, test: (g) => sides(g).some((t) => t.conference === conf && t.division === div) });
		}
		// A filter that would show every game is no filter.
		return out.map((f) => ({ ...f, n: l.games.filter(f.test).length })).filter((f) => f.n > 0 && f.n < l.games.length);
	}

	let leagues = [];
	let lastDay = '';
	let current = 'all';
	function draw() {
		const p = readLeagues();
		const mine = pins();
		if (club) mine.add(club);
		const first = (g) => (keysOf(g).some((k) => mine.has(k)) ? 0 : 1);
		const live = (l) => l.games.filter((g) => g.state === 'in').length;
		const withGames = leagues.filter((l) => l.games.length);
		const shown = ordered(all.map((l) => l.sport), p).filter((s) => !p.hidden.includes(s))
			.map((s) => withGames.find((l) => l.sport === s)).filter(Boolean);

		// The league list: every shown league with games, and the way to choose
		// which are shown. A choice whose league has no games today shows all.
		current = pick.league === 'fav' || shown.some((l) => l.sport === pick.league) ? pick.league : 'all';
		const total = shown.reduce((n, l) => n + l.games.length, 0);
		const lives = shown.reduce((n, l) => n + live(l), 0);
		const count = (n, lv) => ` · ${n}${lv ? ` · ${lv} live` : ''}`;
		// The visitor's favourites (the pinned teams, ats.pins) across every
		// league: their games only, each league's under its name.
		const starred = pins();
		const favs = shown.map((l) => ({ ...l, games: l.games.filter((g) => keysOf(g).some((k) => starred.has(k))) })).filter((l) => l.games.length);
		const favN = favs.reduce((n, l) => n + l.games.length, 0);
		leagueSel.innerHTML = `<option value="all">All${count(total, lives)}</option>`
			+ `<option value="fav">★ Favorites${starred.size ? count(favN, favs.reduce((n, l) => n + live(l), 0)) : ''}</option>`
			+ shown.map((l) => `<option value="${esc(l.sport)}">${esc(l.label)}${count(l.games.length, live(l))}</option>`).join('')
			+ '<option disabled>──────────</option><option value="edit">Show, hide and order leagues…</option>';
		leagueSel.value = current;

		// Within a league, its filters.
		const league = current === 'all' || current === 'fav' ? null : shown.find((l) => l.sport === current);
		const filters = league ? filtersOf(league) : [];
		const filter = filters.find((f) => f.value === pick.filter) ?? null;
		filterWrap.hidden = !filters.length;
		filterSel.innerHTML = '<option value="">All games</option>'
			+ filters.map((f) => `<option value="${esc(f.value)}">${esc(f.label)} · ${f.n}</option>`).join('');
		filterSel.value = filter?.value ?? '';
		// The short names shown over the two lists.
		leagueSel.previousElementSibling.textContent = current === 'all' ? 'All' : current === 'fav' ? '★ Favorites' : labelOf[current];
		filterSel.previousElementSibling.textContent = filter?.label ?? 'All games';

		const html = (league ? [league] : current === 'fav' ? favs : shown).map((l) => {
			const games = l.games.filter((g) => !filter || filter.test(g)).sort((a, b) => first(a) - first(b) || byInterest(a, b));
			return (league ? '' : `<span class="sb-lg">${esc(l.label)}</span>`) + games.map((g) => chip(g, mine)).join('');
		}).join('');
		// Hidden only on a day with no games anywhere; with games but every one of
		// their leagues hidden, it stays, so the way to unhide them does too.
		bar.hidden = !withGames.length;
		const keep = ymd(new Date()) === lastDay ? row.scrollLeft : 0;
		const none = current !== 'fav' ? 'Every league playing today is hidden. Choose them from the list.'
			: starred.size ? 'None of your favorites play today.'
				: 'Star a team in the Team menu below to see its games here.';
		row.innerHTML = html || `<span class="sb-none">${none}</span>`;
		row.scrollLeft = keep;
		lastDay = ymd(new Date());
		drawPanel();
		steps();
	}

	let timer = null;
	async function load() {
		clearTimeout(timer);
		try {
			const r = await fetch(`${api}?date=${ymd(new Date())}&football=week`);
			if (r.ok) leagues = (await r.json()).leagues ?? [];
		} catch { /* keep what is shown */ }
		draw();
		const anyLive = leagues.some((l) => l.games.some((g) => g.state === 'in'));
		timer = setTimeout(() => { if (document.hidden) timer = null; else load(); }, anyLive ? 30_000 : 300_000);
	}
	document.addEventListener('visibilitychange', () => { if (!document.hidden && timer === null) load(); });

	// A new league, or a new filter, starts at the beginning.
	leagueSel.addEventListener('change', () => {
		if (leagueSel.value === 'edit') {
			// The list's last entry opens the choice of leagues and leaves the
			// strip on what it showed.
			leagueSel.value = current;
			setTimeout(() => open(true));
			return;
		}
		pick = { league: leagueSel.value, filter: '' };
		writePick(pick);
		lastDay = '';
		draw();
	});
	filterSel.addEventListener('change', () => {
		pick = { ...pick, filter: filterSel.value };
		writePick(pick);
		lastDay = '';
		draw();
	});

	// The choice of leagues: each shown or not, and moved up or down.
	function drawPanel() {
		const p = readLeagues();
		const order = ordered(all.map((l) => l.sport), p);
		panel.querySelector('ol').innerHTML = order.map((s, i) => `<li data-sport="${esc(s)}">`
			+ `<label><input type="checkbox"${p.hidden.includes(s) ? '' : ' checked'}> ${esc(labelOf[s])}</label>`
			+ `<button type="button" data-move="-1" aria-label="Move ${esc(labelOf[s])} up"${i === 0 ? ' disabled' : ''}>↑</button>`
			+ `<button type="button" data-move="1" aria-label="Move ${esc(labelOf[s])} down"${i === order.length - 1 ? ' disabled' : ''}>↓</button></li>`).join('');
	}
	panel.addEventListener('change', (e) => {
		const s = e.target.closest('li')?.dataset.sport;
		if (!s) return;
		const p = readLeagues();
		p.hidden = e.target.checked ? p.hidden.filter((x) => x !== s) : [...new Set([...p.hidden, s])];
		writeLeagues(p);
	});
	panel.addEventListener('click', (e) => {
		e.stopPropagation();
		const b = e.target.closest('button');
		if (!b) return;
		if (b.classList.contains('sb-reset')) return writeLeagues({ order: [], hidden: [], folded: [] });
		const s = b.closest('li')?.dataset.sport;
		const p = readLeagues();
		const order = ordered(all.map((l) => l.sport), p);
		const i = order.indexOf(s), j = i + Number(b.dataset.move);
		if (i < 0 || j < 0 || j >= order.length) return;
		[order[i], order[j]] = [order[j], order[i]];
		p.order = order;
		writeLeagues(p);
		// Keep the moved league's button under the finger.
		panel.querySelector(`li[data-sport="${CSS.escape(s)}"] [data-move="${b.dataset.move}"]`)?.focus();
	});
	const open = (on) => { panel.hidden = !on; if (on) panel.querySelector('input')?.focus(); };
	document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) open(false); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); leagueSel.focus(); } });
	onLeagues(draw);
	// Favourites starred in the footer's Team menu come first at once.
	window.addEventListener('ats-pins', draw);
	window.addEventListener('storage', (e) => { if (e.key === 'ats.pins') draw(); });

	// The arrows, where there is a mouse: a screenful at a time.
	const [back, on] = bar.querySelectorAll('.sb-step');
	function steps() {
		back.disabled = row.scrollLeft <= 0;
		on.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
	}
	for (const b of [back, on]) b.addEventListener('click', () => row.scrollBy({ left: Number(b.dataset.step) * row.clientWidth * 0.8, behavior: 'smooth' }));
	row.addEventListener('scroll', steps, { passive: true });
	window.addEventListener('resize', steps);

	load();
}
