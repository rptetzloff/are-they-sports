// The strip of scores along the top of the page (lib/scorebar.js): every
// league with games today, the NFL's whole week, from /api/today. The
// visitor's choice of leagues (leagues-pref.js) orders it, hides some, and
// folds some to their label, which is a button: tap it to fold or unfold.
// Within a league, this club's and the pinned teams' games come first, then
// live, then to come, then over. Scrolled sideways by hand; it moves only to
// refresh, every half minute while a game is live and every five minutes
// otherwise, and not while the tab is hidden.
import { readLeagues, writeLeagues, ordered, onLeagues } from './leagues-pref.js';

const bar = document.getElementById('scorebar');
if (bar) {
	const row = bar.querySelector('.sb-row');
	const pick = bar.querySelector('.sb-pick');
	const panel = bar.querySelector('.sb-panel');
	const all = JSON.parse(bar.dataset.leagues);
	const labelOf = Object.fromEntries(all.map((l) => [l.sport, l.label]));
	const club = bar.dataset.club ?? null;
	// From the root, which the server names: under a club, <base> is the club's.
	const api = bar.dataset.api;
	const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const pins = () => { try { return new Set(JSON.parse(localStorage.getItem('ats.pins') || '[]')); } catch { return new Set(); } };

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

	// The NFL's week reaches past today, so a game on another day says which.
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
		return `<span class="sb-t${won}${me}">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '<span></span>'}`
			+ `<span>${esc(t.abbr || t.short)}</span><b>${g.state === 'pre' ? '' : esc(t.score ?? '')}</b></span>`;
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

	let leagues = [];
	let lastDay = '';
	function draw() {
		const p = readLeagues();
		const mine = pins();
		if (club) mine.add(club);
		const first = (g) => (keysOf(g).some((k) => mine.has(k)) ? 0 : 1);
		const withGames = leagues.filter((l) => l.games.length);
		const shown = ordered(all.map((l) => l.sport), p).filter((s) => !p.hidden.includes(s))
			.map((s) => withGames.find((l) => l.sport === s)).filter(Boolean);
		const html = shown.map((l) => {
			const folded = p.folded.includes(l.sport);
			const live = l.games.filter((g) => g.state === 'in').length;
			const head = `<button type="button" class="sb-lg" data-sport="${esc(l.sport)}" aria-expanded="${!folded}" title="${folded ? 'Show' : 'Fold'} ${esc(l.label)}">`
				+ `${esc(l.label)}&nbsp;<span style="font-weight:400">${folded ? `${l.games.length}${live ? ` · ${live} live` : ''}&nbsp;▸` : '◂'}</span></button>`;
			if (folded) return head;
			return head + [...l.games].sort((a, b) => first(a) - first(b) || byInterest(a, b)).map((g) => chip(g, mine)).join('');
		}).join('');
		// Hidden only on a day with no games anywhere; with games but every one of
		// their leagues hidden, it stays, so the way to unhide them does too.
		bar.hidden = !withGames.length;
		const keep = ymd(new Date()) === lastDay ? row.scrollLeft : 0;
		row.innerHTML = html || '<span class="sb-none">Every league playing today is hidden. Choose them under Leagues.</span>';
		row.scrollLeft = keep;
		lastDay = ymd(new Date());
		drawPanel();
		steps();
	}

	let timer = null;
	async function load() {
		clearTimeout(timer);
		try {
			const r = await fetch(`${api}?date=${ymd(new Date())}&nfl=week`);
			if (r.ok) leagues = (await r.json()).leagues ?? [];
		} catch { /* keep what is shown */ }
		draw();
		const live = leagues.some((l) => l.games.some((g) => g.state === 'in'));
		timer = setTimeout(() => { if (document.hidden) timer = null; else load(); }, live ? 30_000 : 300_000);
	}
	document.addEventListener('visibilitychange', () => { if (!document.hidden && timer === null) load(); });

	// Folding a league from its label.
	row.addEventListener('click', (e) => {
		const b = e.target.closest('.sb-lg');
		if (!b) return;
		const p = readLeagues();
		const s = b.dataset.sport;
		p.folded = p.folded.includes(s) ? p.folded.filter((x) => x !== s) : [...p.folded, s];
		writeLeagues(p);
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
	const open = (on) => { panel.hidden = !on; pick.setAttribute('aria-expanded', String(on)); };
	pick.addEventListener('click', (e) => { e.stopPropagation(); open(panel.hidden); });
	document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) open(false); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); pick.focus(); } });
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
