// Head-to-Head page: all-time record vs every opponent (h2h-core.js, shared
// with the server), with a filterable table and a shareable focus card per
// opponent at /vs/<slug>.
//
// IN are-they-sports: the Brewers site's page, made any club's. Its words come
// from SITE, and its paths are relative, against the <base> the server writes
// (lib/web.js shell), so /vs/<slug> works under a club's root as well as at /.
import { parseGameinfoCsv, formatDate, esc, rec } from './records-core.js';
import { computeHeadToHead, computeOpponentDetail, h2hCopy, streakSentence } from './h2h-core.js';
import { shareButtonsHtml, labeledShareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { sortableHeadHtml, sortRows, wireSortable } from './sortable.js';
import { SITE } from './site.js';

const seasonName = (season) => (SITE.seasonLabel ? SITE.seasonLabel(season) : String(season));
const pageUrl = (path) => new URL(path, document.baseURI).href;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
const rd = (n) => (n > 0 ? `+${n}` : `${n}`);

const resultLetter = { WIN: 'W', LOSS: 'L', TIE: 'T' };
const meeting = (m) =>
	`${resultLetter[m.result]} ${m.pf}–${m.pa} · <a href="${m.season}">${esc(formatDate(m.date))}</a>`;

const H2H_COLUMNS = [
	{ key: 'name',   label: 'Opponent' },
	{ key: 'record', label: 'Record', title: 'Win-Loss-Tie', num: true, sortKey: (o) => o.winPct, defaultDir: -1 },
	{ key: 'games',  label: 'Games', title: 'Games played', num: true, defaultDir: -1 },
	{ key: 'winPct', label: 'Win %', title: 'Winning percentage', num: true, defaultDir: -1 },
];
let h2hSort = { key: 'winPct', dir: -1 };

function splitRow(label, s) {
	return `<div class="h2h-breakdown-stat">
		<span class="h2h-stat-label">${esc(label)}</span>
		<span class="h2h-breakdown-val">${esc(s.record)} <span class="h2h-breakdown-meta">(${s.games}g · ${pct(s.winPct)})</span></span>
	</div>`;
}

function focusCardHtml(o, detail) {
	const stats = [
		`<span class="h2h-stat-label">Meetings</span><span>${o.games}${o.playoffGames ? ` (${o.playoffGames} playoff)` : ''}</span>`,
		`<span class="h2h-stat-label">First meeting</span><span>${meeting(o.first)}</span>`,
		`<span class="h2h-stat-label">Last meeting</span><span>${meeting(o.last)}</span>`,
		o.playoffRecord ? `<span class="h2h-stat-label">Playoffs</span><span>${esc(o.playoffRecord)}</span>` : null,
		o.biggestWin ? `<span class="h2h-stat-label">Biggest win</span><span>${o.biggestWin.pf}–${o.biggestWin.pa} · <a href="${o.biggestWin.season}">${esc(seasonName(o.biggestWin.season))}</a></span>` : null,
	].filter(Boolean);

	const d = detail;
	let breakdown = '';
	if (d) {
		const eraRows = d.eras.map((e) => `
			<tr>
				<td>${esc(e.name)}</td>
				<td class="h2h-num">${esc(e.record)}</td>
				<td class="h2h-num">${e.games}</td>
				<td class="h2h-num">${pct(e.winPct)}</td>
			</tr>`).join('');
		const eraTable = d.eras.length > 1 ? `
			<div class="h2h-breakdown-section">
				<h3 class="h2h-breakdown-heading"><i class="mdi mdi-history"></i> By era</h3>
				<table class="h2h-breakdown-table"><tbody>${eraRows}</tbody></table>
			</div>` : '';

		const extra = [
			d.bestWinStreak ? `<span class="h2h-stat-label">Longest win streak</span><span>${d.bestWinStreak} games</span>` : null,
			d.worstLossStreak ? `<span class="h2h-stat-label">Longest losing streak</span><span>${d.worstLossStreak} games</span>` : null,
			`<span class="h2h-stat-label">${cap(SITE.scoreNoun)} for / against</span><span>${d.runsFor} / ${d.runsAgainst} <span class="h2h-breakdown-meta">(${rd(d.runDiff)})</span></span>`,
			d.shutouts ? `<span class="h2h-stat-label">Shutouts</span><span>${d.shutouts}</span>` : null,
			d.shutoutLosses ? `<span class="h2h-stat-label">Shutout losses</span><span>${d.shutoutLosses}</span>` : null,
			d.biggestWin ? `<span class="h2h-stat-label">Biggest win</span><span>${d.biggestWin.pf}–${d.biggestWin.pa} · <a href="${d.biggestWin.season}">${esc(seasonName(d.biggestWin.season))}</a></span>` : null,
			d.worstLoss ? `<span class="h2h-stat-label">Worst loss</span><span>${d.worstLoss.pf}–${d.worstLoss.pa} · <a href="${d.worstLoss.season}">${esc(seasonName(d.worstLoss.season))}</a></span>` : null,
		].filter(Boolean);

		breakdown = `
			<div class="h2h-breakdown">
				<div class="h2h-breakdown-grid">
					${splitRow('Overall', d.overall)}
					${splitRow(`Last ${d.lastTen.games}`, d.lastTen)}
					${splitRow('Home', d.home)}
					${splitRow('Away', d.away)}
					${splitRow('Regular season', d.regular)}
					${d.post.games ? splitRow('Postseason', d.post) : ''}
				</div>
				<div class="h2h-stats h2h-breakdown-extra">${extra.map((s) => `<div class="h2h-stat">${s}</div>`).join('')}</div>
				${eraTable}
			</div>`;
	}

	return `<section class="record-card record-card-focus h2h-focus-card">
		<button type="button" class="h2h-focus-close" aria-label="Close opponent breakdown" title="Close">
			<i class="mdi mdi-close"></i>
		</button>
		<h2 class="record-card-title"><i class="mdi mdi-sword-cross"></i> vs ${esc(o.name)}</h2>
		<div class="h2h-record">${esc(o.record)}</div>
		<p class="record-note">${esc(streakSentence(o))}</p>
		<div class="h2h-stats">${stats.map((s) => `<div class="h2h-stat">${s}</div>`).join('')}</div>
		${breakdown}
		<div class="record-share">${shareButtonsHtml('share-btn record-share-btn')}</div>
	</section>`;
}

function tableHtml(opponents) {
	const sorted = sortRows(opponents, H2H_COLUMNS, h2hSort);
	const rows = sorted.map((o) => `
		<tr class="h2h-row" data-slug="${esc(o.slug)}" tabindex="0" role="button" aria-label="Show breakdown vs ${esc(o.name)}">
			<td><span class="h2h-row-name">${esc(o.name)}</span></td>
			<td class="h2h-num">${esc(o.record)}</td>
			<td class="h2h-num">${o.games}</td>
			<td class="h2h-num">${pct(o.winPct)}</td>
		</tr>`).join('');
	return `<table class="h2h-table sortable-table">
		<thead><tr>${sortableHeadHtml(H2H_COLUMNS, h2hSort)}</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

function requestedSlug(data) {
	const m = window.location.pathname.match(/\/vs\/([a-z0-9-]+)\/?$/);
	const slug = m ? m[1] : new URLSearchParams(window.location.search).get('vs');
	return data.bySlug.has(slug) ? slug : null;
}

async function init() {
	const wrap = document.getElementById('h2h-table-wrap');
	try {
		const [gamesRes, namesRes, curGamesRes] = await Promise.all([
			fetch('data/gameinfo.csv'),
			fetch('data/CurrentNames.csv'),
			fetch('api/current/gameinfo.csv').catch(() => null),
		]);
		if (!gamesRes.ok || !namesRes.ok) throw new Error(`CSV fetch failed: ${gamesRes.status}`);
		// The season being played, appended so the all-time numbers include it.
		const curGames = curGamesRes?.ok ? (await curGamesRes.text()).trim() : '';
		const gamesText = (await gamesRes.text()).trimEnd() + (curGames ? '\n' + curGames : '');
		const rows = parseGameinfoCsv(gamesText, await namesRes.text());
		const allTime = computeHeadToHead(rows);
		// Group rows by franchise code for on-demand detail computation.
		const rowsByFranchise = new Map();
		for (const g of rows) {
			const key = g.franchise || g.Opponent;
			if (!rowsByFranchise.has(key)) rowsByFranchise.set(key, []);
			rowsByFranchise.get(key).push(g);
		}
		document.getElementById('h2h-subtitle').textContent =
			`${SITE.fullName} · all-time vs ${allTime.opponents.length} opponents`;

		const controls = {
			q: document.getElementById('h2h-filter'),
			venue: document.getElementById('h2h-venue'),
			type: document.getElementById('h2h-type'),
		};
		const countEl = document.getElementById('h2h-count');

		try {
			const stored = JSON.parse(localStorage.getItem('h2hFilters') || '{}');
			if ([...controls.venue.options].some((o) => o.value === stored.venue)) controls.venue.value = stored.venue;
			if ([...controls.type.options].some((o) => o.value === stored.type)) controls.type.value = stored.type;
		} catch { /* corrupt storage — keep defaults */ }
		const saveFilters = () => {
			try {
				localStorage.setItem('h2hFilters', JSON.stringify({
					venue: controls.venue.value,
					type: controls.type.value,
				}));
			} catch { /* no storage */ }
		};

		const renderTable = () => {
			const venue = controls.venue.value;
			const type = controls.type.value;
			const subset = venue === 'all' && type === 'all' ? rows : rows.filter((g) =>
				(venue === 'all' || g.location === venue)
				&& (type === 'all' || (type === 'regular' ? g.regular_season === '1' : g.regular_season !== '1')));
			const data = venue === 'all' && type === 'all' ? allTime : computeHeadToHead(subset);
			const q = controls.q.value.trim().toLowerCase();
			const opponents = data.opponents.filter((o) =>
				(q === '' || o.name.toLowerCase().includes(q)));
			if (opponents.length) {
				wrap.innerHTML = tableHtml(opponents);
				const table = wrap.querySelector('table');
				if (table) wireSortable(table, H2H_COLUMNS, h2hSort, renderTable);
			} else {
				wrap.innerHTML = '<p class="record-empty">No opponents match those filters.</p>';
			}
			const filtered = venue !== 'all' || type !== 'all' || q !== '';
			countEl.textContent = filtered ? `${opponents.length} of ${allTime.opponents.length} opponents` : '';
		};
		controls.q.addEventListener('input', renderTable);
		for (const el of [controls.venue, controls.type]) {
			el.addEventListener('change', () => { saveFilters(); renderTable(); });
		}
		renderTable();

		const footerShare = document.getElementById('h2h-share');
		footerShare.innerHTML = labeledShareButtonsHtml('footer-share-item');
		wireShareRow(footerShare, h2hCopy(null, allTime).desc, pageUrl('vs'));
		wireShareDropdown();

		const focus = document.getElementById('h2h-focus');
		const pageTitle = document.title;
		const clearFocus = ({ pushHistory = false } = {}) => {
			focus.innerHTML = '';
			document.title = pageTitle;
			if (pushHistory) history.pushState({ slug: null }, '', pageUrl('vs'));
		};
		const showFocus = (slug, { pushHistory = false, scrollTo = false } = {}) => {
			const o = allTime.bySlug.get(slug);
			if (!o) return;
			const detail = computeOpponentDetail(rowsByFranchise.get(o.franchise) || []);
			document.title = h2hCopy(slug, allTime).title;
			focus.innerHTML = focusCardHtml(o, detail);
			wireShareRow(
				focus.querySelector('.record-share'),
				h2hCopy(slug, allTime).desc,
				pageUrl(`vs/${slug}`),
			);
			focus.querySelector('.h2h-focus-close')?.addEventListener('click', () => clearFocus({ pushHistory: true }));
			if (pushHistory) history.pushState({ slug }, '', pageUrl(`vs/${slug}`));
			if (scrollTo) focus.scrollIntoView({ behavior: 'smooth', block: 'start' });
		};

		// Clicking a table row renders the breakdown card in place at the
		// top of the page and updates the URL, so it's shareable and
		// back-button friendly.
		const onRowActivate = (e) => {
			const tr = e.target.closest('tr.h2h-row');
			if (!tr) return;
			showFocus(tr.dataset.slug, { pushHistory: true, scrollTo: true });
		};
		wrap.addEventListener('click', onRowActivate);
		wrap.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			if (e.target.matches('tr.h2h-row')) { e.preventDefault(); onRowActivate(e); }
		});
		window.addEventListener('popstate', () => {
			const slug = requestedSlug(allTime);
			if (slug) showFocus(slug);
			else clearFocus();
		});

		const slug = requestedSlug(allTime);
		if (slug) showFocus(slug);
	} catch (e) {
		wrap.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
