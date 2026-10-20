// Head-to-Head page: all-time record vs every opponent (h2h-core.js, shared
// with the server), with a filterable table and a shareable focus card per
// opponent at /vs/<slug>.
//
// IN are-they-sports: the Packers site's page, made any club's. Its words
// come from SITE, and its paths are relative, against the <base> the server
// writes (lib/web.js shell), so it works under a club's root as well as at /.
import { formatDate, esc } from './records-core.js';
import { loadGames } from './games-client.js';
import { computeHeadToHead, h2hCopy, streakSentence } from './h2h-core.js';
import { shareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { SITE } from './site.js';

const pageUrl = (path) => new URL(path, document.baseURI).href;
import { sortItems, wireSortHeaders } from './sortable.js';

// Standard sports-page winning percentage: ties count half. ".622" / "1.000".
const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));

const resultLetter = { WIN: 'W', LOSS: 'L', TIE: 'T' };
const meeting = (m) =>
	`${resultLetter[m.result]} ${m.pf}–${m.pa} · <a href="${m.season}">${esc(formatDate(m.date))}</a>`;

function focusCardHtml(o) {
	const stats = [
		`<span class="h2h-stat-label">Meetings</span><span>${o.games}${o.playoffGames ? ` (${o.playoffGames} playoff)` : ''}</span>`,
		`<span class="h2h-stat-label">First meeting</span><span>${meeting(o.first)}</span>`,
		`<span class="h2h-stat-label">Last meeting</span><span>${meeting(o.last)}</span>`,
		o.playoffRecord ? `<span class="h2h-stat-label">Playoffs</span><span>${esc(o.playoffRecord)}</span>` : null,
		o.biggestWin ? `<span class="h2h-stat-label">Biggest win</span><span>${o.biggestWin.pf}–${o.biggestWin.pa} · <a href="${o.biggestWin.season}">${o.biggestWin.season}</a></span>` : null,
	].filter(Boolean);
	return `<section class="record-card record-card-focus h2h-focus-card">
		<h2 class="record-card-title"><i class="mdi mdi-sword-cross"></i> vs ${esc(o.name)}</h2>
		<div class="h2h-record">${esc(o.record)}</div>
		<p class="record-note">${esc(streakSentence(o))}</p>
		<div class="h2h-stats">${stats.map((s) => `<div class="h2h-stat">${s}</div>`).join('')}</div>
		<div class="record-share">${shareButtonsHtml('share-btn record-share-btn')}</div>
	</section>`;
}

function tableHtml(opponents) {
	const rows = opponents.map((o) => `
		<tr>
			<td><a href="vs/${o.slug}">${esc(o.name)}</a></td>
			<td class="h2h-num">${esc(o.record)}</td>
			<td class="h2h-num">${o.games}</td>
			<td class="h2h-num">${pct(o.winPct)}</td>
		</tr>`).join('');
	return `<table class="h2h-table">
		<thead><tr>
			<th data-sort="name" data-dir="asc">Opponent</th>
			<th class="h2h-num" data-sort="wins">Record</th>
			<th class="h2h-num" data-sort="games">Games</th>
			<th class="h2h-num" data-sort="winPct">Win %</th>
		</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

// /vs/<slug> deep link (or ?vs=<slug> when served statically in dev).
function requestedSlug(data) {
	const m = window.location.pathname.match(/\/vs\/([a-z0-9-]+)\/?$/);
	const slug = m ? m[1] : new URLSearchParams(window.location.search).get('vs');
	return data.bySlug.has(slug) ? slug : null;
}

async function init() {
	const wrap = document.getElementById('h2h-table-wrap');
	try {
		// The season being played counts, from ESPN (games-client.js).
		const { games: rows } = await loadGames();
		// The focus card and share copy always use the full all-time data;
		// the venue/type filters recompute a fresh table from the raw rows.
		const allTime = computeHeadToHead(rows);
		document.getElementById('h2h-subtitle').textContent =
			`${SITE.fullName} · all-time vs ${allTime.opponents.length} opponents`;

		const controls = {
			q: document.getElementById('h2h-filter'),
			venue: document.getElementById('h2h-venue'),
			type: document.getElementById('h2h-type'),
			current: document.getElementById('h2h-current'),
		};
		const countEl = document.getElementById('h2h-count');

		// Filter settings persist across sessions (like the emoji toggle and
		// section states); the typed name query is transient.
		try {
			const stored = JSON.parse(localStorage.getItem('h2hFilters') || '{}');
			if ([...controls.venue.options].some((o) => o.value === stored.venue)) controls.venue.value = stored.venue;
			if ([...controls.type.options].some((o) => o.value === stored.type)) controls.type.value = stored.type;
			controls.current.checked = stored.current === true;
		} catch { /* corrupt storage — keep defaults */ }
		const saveFilters = () => {
			try {
				localStorage.setItem('h2hFilters', JSON.stringify({
					venue: controls.venue.value,
					type: controls.type.value,
					current: controls.current.checked,
				}));
			} catch { /* no storage */ }
		};

		const sortState = { key: 'games', dir: 'desc' };
		const renderTable = () => {
			const venue = controls.venue.value;
			const type = controls.type.value;
			const subset = venue === 'all' && type === 'all' ? rows : rows.filter((g) =>
				(venue === 'all' || g.location === venue)
				&& (type === 'all' || (type === 'regular' ? g.regular_season === '1' : g.regular_season !== '1')));
			const data = venue === 'all' && type === 'all' ? allTime : computeHeadToHead(subset);
			const q = controls.q.value.trim().toLowerCase();
			const opponents = sortItems(data.opponents.filter((o) =>
				(!controls.current.checked || o.current)
				&& (q === '' || o.name.toLowerCase().includes(q))), sortState);
			wrap.innerHTML = opponents.length
				? tableHtml(opponents)
				: '<p class="record-empty">No opponents match those filters.</p>';
			wireSortHeaders(wrap, sortState, renderTable);
			const filtered = venue !== 'all' || type !== 'all' || controls.current.checked || q !== '';
			countEl.textContent = filtered ? `${opponents.length} of ${allTime.opponents.length} opponents` : '';
		};
		controls.q.addEventListener('input', renderTable);
		for (const el of [controls.venue, controls.type, controls.current]) {
			el.addEventListener('change', () => { saveFilters(); renderTable(); });
		}
		renderTable();

		// The page's share buttons live in the footer's Share menu.
		const share = document.getElementById('footer-share');
		share.innerHTML = shareButtonsHtml('footer-share-item', { labels: true });
		wireShareRow(share, h2hCopy(null, allTime).desc, pageUrl('vs'), { labels: true });
		wireShareDropdown();

		const slug = requestedSlug(allTime);
		if (slug) {
			const o = allTime.bySlug.get(slug);
			document.title = h2hCopy(slug, allTime).title;
			const focus = document.getElementById('h2h-focus');
			focus.innerHTML = focusCardHtml(o);
			wireShareRow(
				focus.querySelector('.record-share'),
				h2hCopy(slug, allTime).desc,
				pageUrl(`vs/${slug}`),
			);
		}
	} catch (e) {
		wrap.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
