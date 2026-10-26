// Franchise history page: one point per season, rendered from the shared
// chart builder (history-chart.js) over the shared season computation
// (records-core.js). Multiple metrics can be plotted at once, playoffs can be
// folded in, coach-era strips carry each coach's record, hover shows a
// season's numbers, and clicking a season opens its page.
//
// IN are-they-sports: the Packers site's page, made any club's, with the
// season-by-season table the baseball pages carry so every sport's history
// page reads the same (Ray, 2026-10-20). The coaches are the server's tally
// for the club (data/coaches.json, lib/web-routes.js) rather than a curated
// file only the Packers had; its paths are relative, against the <base> the
// server writes.
import { computeSeasonHistory, historyCopy, esc } from './records-core.js';
import { loadGames } from './games-client.js';
import { buildChartSvg, METRICS } from './history-chart.js';
import { shareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { sortItems, wireSortHeaders } from './sortable.js';
import { coachRows, slugifyCoach } from './coaches-core.js';
import { SITE } from './site.js';

const chartEl = document.getElementById('history-chart');
const tooltip = document.getElementById('history-tooltip');
const tableWrap = document.getElementById('history-table-wrap');

const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
const pageUrl = (path) => new URL(path, document.baseURI).href;

function seasonLabel(s) {
	return `${s.season} · ${s.record} · PF ${s.pf} · PA ${s.pa}${finishNotes(s).length ? ` · ${finishNotes(s).join(', ')}` : ''}`;
}

// Each season's final AP rank, where the programme had one (data/rankings.json,
// from data/reference/ncaaf-ap-final.csv); filled before anything is drawn.
let AP = {};

function finishNotes(s) {
	const notes = [];
	if (AP[s.season]) notes.push(`AP No. ${AP[s.season]}`);
	// The title game's winner, or the AP poll's No. 1 before there was one.
	if (s.championship || s.champion) notes.push('national champions');
	// The season's bowl, by name, and how it went.
	if (s.bowl) notes.push(`${s.bowl.won ? 'won' : s.bowl.tie ? 'tied' : 'lost'} the ${s.bowl.name}`);
	if (s.undefeated) notes.push(`${SITE.losslessSeasonNoun.toLowerCase()} season`);
	return notes;
}

function coachLabel(c) {
	const bits = [`${c.name}${c.interim ? ' (interim)' : ''} · ${c.tenure} · ${c.record} (${pct(c.winPct)})`];
	if (c.playoffRecord) bits.push(`playoffs ${c.playoffRecord}`);
	if (c.titles) bits.push(`${c.titles} title${c.titles === 1 ? '' : 's'}`);
	return bits.join(' · ');
}

// "Curly Lambeau" -> "Lambeau", "Hugh Devore & Scooter McLean" -> "Devore/McLean"
const bandLabel = (name) => name.split('&').map((p) => p.trim().split(' ').pop()).join('/');

function showTooltip(text) {
	tooltip.textContent = text;
	tooltip.hidden = false;
}

function placeTooltip(e) {
	const box = chartEl.getBoundingClientRect();
	tooltip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - tooltip.offsetWidth - 4)}px`;
	tooltip.style.top = `${e.clientY - box.top - 34}px`;
}

// One band a spell in charge, not one a person: Ray McLean's 1953 and 1958
// are two (data/coaches.json, lib/web-routes.js coachesJson).
function render(history, coaches, eras, metrics) {
	const bands = eras.map((e) => ({
		label: bandLabel(e.name), from: e.from, to: e.to, key: slugifyCoach(e.name),
	}));
	chartEl.innerHTML = buildChartSvg(history, {
		metrics, axes: true, eras: bands, hitAreas: true, emoji: true,
	});
	// The tooltip must live INSIDE the position:relative chart container or
	// its absolute coordinates resolve against the page, far from the cursor.
	// innerHTML above wipes the container, so re-append after every render.
	tooltip.hidden = true;
	chartEl.appendChild(tooltip);
	const bySeason = new Map(history.map((s) => [s.season, s]));
	const coachBySlug = new Map(coaches.map((c) => [c.slug, c]));

	chartEl.querySelectorAll('[data-season]').forEach((hit) => {
		const s = bySeason.get(parseInt(hit.dataset.season, 10));
		hit.addEventListener('mouseenter', () => showTooltip(seasonLabel(s)));
		hit.addEventListener('mousemove', placeTooltip);
		hit.addEventListener('mouseleave', () => { tooltip.hidden = true; });
		hit.addEventListener('click', () => { window.location.href = pageUrl(String(s.season)); });
	});
	chartEl.querySelectorAll('[data-era]').forEach((strip) => {
		const c = coachBySlug.get(strip.dataset.era);
		strip.addEventListener('mouseenter', () => showTooltip(coachLabel(c)));
		strip.addEventListener('mousemove', placeTooltip);
		strip.addEventListener('mouseleave', () => { tooltip.hidden = true; });
		strip.addEventListener('click', () => { window.location.href = pageUrl(SITE.leaderPlural); });
	});
}

// The season-by-season table, as the baseball pages have it: most recent
// first, every column sortable.
const tableSort = { key: 'season', dir: 'desc' };
function renderTable(history) {
	const ties = history.some((s) => s.ties);
	const rows = sortItems(history.map((s) => ({
		...s, diff: s.pf - s.pa,
		finish: finishNotes(s).join(', ') || '—',
		finishRank: s.championship ? 3 : s.champion ? 2 : s.undefeated ? 1 : 0,
	})), tableSort);
	const body = rows.map((s) => `<tr data-season="${s.season}">
			<td class="h2h-num"><a href="${s.season}">${s.season}</a></td>
			<td class="h2h-num">${esc(s.record)}</td>
			<td class="h2h-num">${pct(s.winPct)}</td>
			<td class="h2h-num">${s.wins}</td>
			<td class="h2h-num">${s.losses}</td>
			${ties ? `<td class="h2h-num">${s.ties || ''}</td>` : ''}
			<td class="h2h-num">${s.pf}</td>
			<td class="h2h-num">${s.pa}</td>
			<td class="h2h-num${s.diff > 0 ? ' pos' : s.diff < 0 ? ' neg' : ''}">${s.diff > 0 ? '+' : ''}${s.diff}</td>
			<td>${esc(s.finish)}</td>
		</tr>`).join('');
	tableWrap.innerHTML = `<table class="h2h-table season-table sortable-table">
		<thead><tr>
			<th class="h2h-num" data-sort="season" title="Season">Year</th>
			<th class="h2h-num" data-sort="winPct" title="Win-Loss-Tie">Record</th>
			<th class="h2h-num" data-sort="winPct" title="${esc(METRICS.winPct.label)}">Pct</th>
			<th class="h2h-num" data-sort="wins" title="Wins">W</th>
			<th class="h2h-num" data-sort="losses" title="Losses">L</th>
			${ties ? '<th class="h2h-num" data-sort="ties" title="Ties">T</th>' : ''}
			<th class="h2h-num" data-sort="pf" title="${esc(SITE.scoreForLabel)}">PF</th>
			<th class="h2h-num" data-sort="pa" title="${esc(SITE.scoreAgainstLabel)}">PA</th>
			<th class="h2h-num" data-sort="diff" title="Point differential (PF - PA)">Diff</th>
			<th data-sort="finishRank" title="How the season ended">Finish</th>
		</tr></thead>
		<tbody>${body}</tbody>
	</table>`;
	wireSortHeaders(tableWrap, tableSort, () => renderTable(history));
	tableWrap.querySelectorAll('tbody tr').forEach((tr) => {
		tr.addEventListener('click', (e) => {
			if (e.target.closest('a')) return;
			window.location.href = pageUrl(tr.dataset.season);
		});
	});
}

async function init() {
	try {
		// The season being played counts, from ESPN (games-client.js).
		const [{ games: rows }, coachesRes, ranks] = await Promise.all([
			loadGames(),
			fetch('data/coaches.json'),
			// Without it the page is the same, with no ranks.
			fetch('data/rankings.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
		]);
		AP = ranks ?? {};
		if (!coachesRes.ok) throw new Error('coaches fetch failed');
		const histories = {
			regular: computeSeasonHistory(rows),
			playoffs: computeSeasonHistory(rows, { playoffs: true }),
		};
		// The chart's eras are the coaches who held the job; stand-ins are on
		// the coaches page.
		const leaders = await coachesRes.json();
		const coaches = coachRows(leaders).filter((c) => !c.interim);
		const eras = leaders.eras ?? [];

		const titles = histories.regular.filter((s) => s.champion).length;
		const range = `${histories.regular[0].season}–${histories.regular[histories.regular.length - 1].season}`;
		document.getElementById('history-subtitle').textContent = [
			SITE.fullName, range, `${titles} championship${titles === 1 ? '' : 's'}`,
			coaches.length ? `${coaches.length} head ${SITE.leaderPlural}` : null,
		].filter(Boolean).join(' · ');

		// Metric selection and playoffs inclusion persist like other settings.
		let metrics;
		try { metrics = JSON.parse(localStorage.getItem('historyMetrics') || '[]'); } catch { metrics = []; }
		metrics = metrics.filter((m) => METRICS[m]);
		if (!metrics.length) metrics = ['winPct'];
		const playoffsBox = document.getElementById('history-playoffs');
		try { playoffsBox.checked = localStorage.getItem('historyPlayoffs') === 'true'; } catch { /* no storage */ }

		const chips = [...document.querySelectorAll('#history-metrics [data-metric]')];
		const apply = () => {
			for (const chip of chips) {
				const key = chip.dataset.metric;
				const on = metrics.includes(key);
				chip.classList.toggle('history-toggle-active', on);
				chip.setAttribute('aria-pressed', String(on));
				chip.style.color = on ? METRICS[key].color : '';
			}
			const history = histories[playoffsBox.checked ? 'playoffs' : 'regular'];
			render(history, coaches, eras, metrics);
			renderTable(history);
		};
		for (const chip of chips) {
			chip.addEventListener('click', () => {
				const key = chip.dataset.metric;
				metrics = metrics.includes(key) ? metrics.filter((m) => m !== key) : [...metrics, key];
				if (!metrics.length) metrics = [key]; // at least one metric stays on
				metrics.sort((a, b) => Object.keys(METRICS).indexOf(a) - Object.keys(METRICS).indexOf(b));
				try { localStorage.setItem('historyMetrics', JSON.stringify(metrics)); } catch { /* no storage */ }
				apply();
			});
		}
		playoffsBox.addEventListener('change', () => {
			try { localStorage.setItem('historyPlayoffs', String(playoffsBox.checked)); } catch { /* no storage */ }
			apply();
		});
		apply();

		// The page's share buttons live in the footer's Share menu.
		const share = document.getElementById('footer-share');
		share.innerHTML = shareButtonsHtml('footer-share-item', { labels: true });
		wireShareRow(share, historyCopy(histories.regular).desc, pageUrl('history'), { labels: true });
		wireShareDropdown();
	} catch (e) {
		chartEl.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
