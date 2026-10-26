// The strip of the day's scores along the top of the page (lib/scorebar.js):
// this page's leagues' games from /api/today, this club's and the visitor's
// pinned teams' first, then live, then to come, then over. Scrolled sideways
// by hand; it moves only to refresh, every half minute while a game is live
// and every five minutes otherwise, and not while the tab is hidden.

const bar = document.getElementById('scorebar');
if (bar) {
	const row = bar.querySelector('.sb-row');
	const sports = bar.dataset.sports.split(',');
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
	bar.style.setProperty('--sb-gap', pad.paddingTop);

	const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	const ORDER = { in: 0, pre: 1, post: 2 };
	const keysOf = (g) => [g.away.key, g.home.key].filter(Boolean);

	function status(g) {
		if (g.state === 'in') return esc(g.status || 'Live');
		if (g.state === 'post') return esc(g.status || 'Final');
		if (!g.timeValid) return 'TBD';
		return esc(new Date(g.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
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

	let timer = null;
	let lastDay = '';
	async function load() {
		clearTimeout(timer);
		const day = ymd(new Date());
		let leagues = [];
		try {
			const r = await fetch(`${api}?date=${day}&sports=${encodeURIComponent(sports.join(','))}`);
			if (r.ok) leagues = (await r.json()).leagues ?? [];
		} catch { /* keep what is shown */ return schedule(false); }
		const mine = pins();
		if (club) mine.add(club);
		const first = (g) => (keysOf(g).some((k) => mine.has(k)) ? 0 : 1);
		const many = leagues.filter((l) => l.games.length).length > 1;
		const html = leagues.filter((l) => l.games.length).map((l) => {
			const games = [...l.games].sort((a, b) => first(a) - first(b) || (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3)
				|| String(a.start).localeCompare(String(b.start)));
			return (many ? `<span class="sb-lg">${esc(l.label)}</span>` : '') + games.map((g) => chip(g, mine)).join('');
		}).join('');
		bar.hidden = !html;
		// A new day starts at the beginning; a refresh keeps the reader's place.
		const keep = day === lastDay ? row.scrollLeft : 0;
		row.innerHTML = html;
		row.scrollLeft = keep;
		lastDay = day;
		steps();
		schedule(leagues.some((l) => l.games.some((g) => g.state === 'in')));
	}
	function schedule(live) {
		timer = setTimeout(() => { if (document.hidden) timer = null; else load(); }, live ? 30_000 : 300_000);
	}
	document.addEventListener('visibilitychange', () => { if (!document.hidden && timer === null) load(); });

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
