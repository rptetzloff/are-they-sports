// Franchise history page: one point per season, rendered from the shared
// chart builder (history-chart.js) over the shared season computation
// (records-core.js). Multiple metrics can be plotted at once, playoffs can be
// folded in, leader-era strips carry each leader's record, hover shows a
// season's numbers, and clicking a season opens its page.
//
// IN are-they-sports: the Brewers site's page, made any club's. Its words come
// from SITE; its paths are relative, against the <base> the server writes
// (lib/web.js shell); and the leaders arrive as three files the server builds
// from game_leader (lib/web-routes.js). The ballpark milestones are gone: no
// park is on record here.
import { parseGameinfoCsv, computeSeasonHistory, historyCopy, esc, championships, ROUND_ORDER } from './records-core.js';
import { parseBiofile, parseTeamstatsMgr, parseManagersCsv, computeCoachesFromData, coachesFromJson } from './coaches-core.js';
import { buildChartSvg, METRICS, POSTSEASON, postseasonTier } from './history-chart.js';
import { labeledShareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { sortableHeadHtml, sortRows, wireSortable } from './sortable.js';
import { SITE } from './site.js';
import { espnPostseasonGames, currentPostseasonStatus } from './playoff-core.js';

const chartEl = document.getElementById('history-chart');
const tooltip = document.getElementById('history-tooltip');
const tableWrap = document.getElementById('history-table-wrap');

const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
/** A season as the sport writes it: 2026-2027 for one across New Year. */
const seasonName = (season) => (SITE.seasonLabel ? SITE.seasonLabel(season) : String(season));
/** The short forms of the score labels: "Runs Scored" is RS, "Goals For" GF. */
const initials = (label) => label.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
const FOR = initials(SITE.scoreForLabel);
const AGAINST = initials(SITE.scoreAgainstLabel);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const pageUrl = (path) => new URL(path, document.baseURI).href;

function seasonLabel(s) {
	const notes = [];
	if (s.championship) notes.push(`${SITE.championship} champions`);
	const tier = postseasonTier(s);
	if (s.status) notes.push(s.status);
	else if (tier && tier !== 'wsWin') notes.push(POSTSEASON[tier].label);
	return `${seasonName(s.season)} · ${s.record} · ${FOR} ${s.pf} · ${AGAINST} ${s.pa}${notes.length ? ` · ${notes.join(', ')}` : ''}`;
}

function coachLabel(c) {
	const bits = [`${c.name}${c.interim ? ' (interim)' : ''} · ${c.tenure} · ${c.record} (${pct(c.winPct)})`];
	if (c.playoffRecord) bits.push(`playoffs ${c.playoffRecord}`);
	if (c.titles) bits.push(`${c.titles} title${c.titles === 1 ? '' : 's'}`);
	return bits.join(' · ');
}

// "Dave Bristol" -> "Bristol", "Phil Garner" -> "Garner"
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

function render(history, coaches, metrics) {
	const eras = coaches.map((c) => ({
		label: bandLabel(c.name), from: c.fromDate, to: c.toDate, key: c.slug,
	}));
	chartEl.innerHTML = buildChartSvg(history, {
		metrics, axes: true, eras, hitAreas: true, emoji: true, milestones: [],
	});
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

const TABLE_COLUMNS = [
	{ key: 'season',   label: 'Year',   title: 'Season', num: true, defaultDir: -1 },
	{ key: 'record',   label: 'Record', title: 'Win-Loss-Tie', num: true, sortKey: (s) => s.winPct, defaultDir: -1 },
	{ key: 'winPct',   label: 'Pct',    title: METRICS.winPct.label, num: true, fmt: (v) => pct(v), defaultDir: -1 },
	{ key: 'wins',     label: 'W',      title: 'Wins', num: true, defaultDir: -1 },
	{ key: 'losses',   label: 'L',      title: 'Losses', num: true, defaultDir: -1 },
	{ key: 'ties',     label: 'T',      title: 'Ties', num: true, defaultDir: -1 },
	{ key: 'otl',      label: 'OTL',    title: 'Overtime and shootout losses', num: true, defaultDir: -1 },
	{ key: 'pf',       label: FOR,      title: SITE.scoreForLabel, num: true, defaultDir: -1 },
	{ key: 'pa',       label: AGAINST,  title: SITE.scoreAgainstLabel, num: true, defaultDir: -1 },
	{ key: 'diff',     label: 'Diff',   title: `${cap(SITE.scoreNoun.replace(/s$/, ''))} differential (${FOR} - ${AGAINST})`, num: true, sortKey: (s) => s.pf - s.pa, defaultDir: -1 },
	{ key: 'finish',   label: 'Finish', title: 'Postseason result', sortKey: (s) => s.champion && s.championship ? 10 : (ROUND_ORDER[s.postseason] || 0), defaultDir: -1 },
];

let tableSort = { key: 'season', dir: -1 }; // most recent first by default
let tableHistory = [];

function finishLabel(s) {
	if (s.status) return s.status;
	const tier = postseasonTier(s);
	if (!tier) return s.undefeated ? 'Undefeated' : '—';
	return POSTSEASON[tier].label;
}

function renderHistoryTable() {
	const rows = tableHistory.map((s) => ({ ...s, diff: s.pf - s.pa, finish: finishLabel(s) }));
	const sorted = sortRows(rows, TABLE_COLUMNS, tableSort);
	// A column with nothing in it is not drawn: most sports have no ties, and
	// only hockey and soccer have losses in overtime.
	const ties = rows.some((s) => s.ties);
	const otl = rows.some((s) => s.otl);
	const columns = TABLE_COLUMNS.filter((c) => (c.key !== 'ties' || ties) && (c.key !== 'otl' || otl));
	const head = sortableHeadHtml(columns, tableSort);
	const body = sorted.map((s) => {
		const finishTier = postseasonTier(s);
		const glyph = finishTier ? `<span class="legend-glyph" style="color:${POSTSEASON[finishTier].color}">${POSTSEASON[finishTier].glyph}</span> ` : '';
		return `<tr data-season="${s.season}">
			<td class="h2h-num"><a href="${s.season}">${esc(seasonName(s.season))}</a></td>
			<td class="h2h-num">${s.record}</td>
			<td class="h2h-num">${pct(s.winPct)}</td>
			<td class="h2h-num">${s.wins}</td>
			<td class="h2h-num">${s.losses}</td>
			${ties ? `<td class="h2h-num">${s.ties || ''}</td>` : ''}
			${otl ? `<td class="h2h-num">${s.otl || ''}</td>` : ''}
			<td class="h2h-num">${s.pf}</td>
			<td class="h2h-num">${s.pa}</td>
			<td class="h2h-num${s.diff > 0 ? ' pos' : s.diff < 0 ? ' neg' : ''}">${s.diff > 0 ? '+' : ''}${s.diff}</td>
			<td>${glyph}${esc(s.finish)}</td>
		</tr>`;
	}).join('');
	tableWrap.innerHTML = `<table class="h2h-table season-table sortable-table">
		<thead><tr>${head}</tr></thead>
		<tbody>${body}</tbody>
	</table>`;
	const table = tableWrap.querySelector('table');
	if (table) wireSortable(table, columns, tableSort, renderHistoryTable);
	tableWrap.querySelectorAll('tbody tr').forEach((tr) => {
		tr.addEventListener('click', (e) => {
			if (e.target.closest('a')) return;
			window.location.href = pageUrl(tr.dataset.season);
		});
	});
}

// The season being played has no finish yet, and the CSV only knows games
// that are final. ESPN's postseason schedule does: the current series becomes
// the season's status, and its round the chart marker. Only until the season
// is over; after that the games say how it ended.
async function markCurrentPostseason(histories, postRes) {
	try {
		if (!postRes?.ok) return;
		const data = await postRes.json();
		const year = data.requestedSeason?.year || data.season?.year;
		const now = new Date();
		if (!year || now.getFullYear() !== year || now.getMonth() >= 11) return;
		const status = currentPostseasonStatus(espnPostseasonGames(data.events));
		if (!status) return;
		for (const h of Object.values(histories)) {
			const s = h.find((x) => x.season === year);
			if (s) Object.assign(s, { postseason: status.code, status: status.text });
		}
	} catch {
		// No status is the old behaviour; the page still renders.
	}
}

/** The legend, from the sport's own rounds rather than baseball's. */
function legendHtml() {
	const items = Object.values(POSTSEASON).sort((a, b) => b.tier - a.tier).map((p) =>
		`<span class="history-legend-item"><span class="legend-glyph" style="color:${p.color}">${p.glyph}</span> ${esc(p.label)}</span>`);
	items.push('<span class="history-legend-item">Click any season to open it</span>');
	return items.join('\n');
}

async function init() {
	document.getElementById('history-legend').innerHTML = legendHtml();
	const chips = [...document.querySelectorAll('#history-metrics [data-metric]')];
	for (const chip of chips) chip.textContent = METRICS[chip.dataset.metric].label;
	try {
		const [gamesRes, namesRes, leadersRes, biofileRes, managersRes, curGamesRes, postRes] = await Promise.all([
			fetch('data/gameinfo.csv'),
			fetch('data/CurrentNames.csv'),
			fetch('data/leaders.csv'),
			fetch('data/biofile0.csv'),
			fetch('data/managers.csv'),
			fetch('api/current/gameinfo.csv').catch(() => null),
			fetch(`api/espn/apis/site/v2/sports/${SITE.espnLeague}/teams/${SITE.espnSlug}/schedule?seasontype=3`).catch(() => null),
		]);
		if (!gamesRes.ok || !namesRes.ok || !leadersRes.ok || !biofileRes.ok || !managersRes.ok) throw new Error('CSV fetch failed');
		// The season being played, appended so the chart and table include it.
		const curGames = curGamesRes?.ok ? (await curGamesRes.text()).trim() : '';
		const gameinfoText = (await gamesRes.text()).trimEnd() + (curGames ? '\n' + curGames : '');
		const rows = parseGameinfoCsv(gameinfoText, await namesRes.text());
		const gidToMgr = parseTeamstatsMgr(await leadersRes.text());
		const mgrNames = parseBiofile(await biofileRes.text());
		const histories = {
			regular: computeSeasonHistory(rows),
			playoffs: computeSeasonHistory(rows, { playoffs: true }),
		};
		await markCurrentPostseason(histories, postRes);
		const champions = histories.regular.filter((s) => s.champion).map((s) => s.season);
		const officialTenures = parseManagersCsv(await managersRes.text());
		const { coaches } = computeCoachesFromData(rows, gidToMgr, mgrNames, champions, officialTenures);
		// History timeline: official leaders only — interim stints are hidden.
		let officialCoaches = coaches.filter((c) => !c.interim);
		// No game names its coach (hockey's are stated tenures): the server's
		// tally, a band a spell in charge, and the count is of people.
		let leaderCount = officialCoaches.length;
		if (!coaches.length) {
			const res = await fetch('data/coaches.json').catch(() => null);
			if (res?.ok) {
				const fromJson = coachesFromJson(await res.json());
				officialCoaches = fromJson.eras;
				leaderCount = fromJson.coaches.filter((c) => !c.interim).length;
			}
		}

		// With the titles before the games begin (1939 to 1949), which the
		// server names (lib/store.js standingsTitles).
		const titles = histories.regular.filter((s) => s.champion).length
			+ (SITE.standingsTitles ?? []).filter((y) => !histories.regular.some((s) => s.season === y)).length;
		const first = histories.regular[0].season;
		const last = histories.regular[histories.regular.length - 1].season;
		// An en dash between years, words between seasons that have one of their own.
		const range = first === last ? seasonName(first) : `${seasonName(first)}${SITE.seasonLabel ? ' to ' : '–'}${seasonName(last)}`;
		document.getElementById('history-subtitle').textContent = [
			SITE.fullName, range, championships(titles),
			leaderCount ? `${leaderCount} ${SITE.leaderPlural}` : null,
		].filter(Boolean).join(' · ');

		let metrics;
		try { metrics = JSON.parse(localStorage.getItem('historyMetrics') || '[]'); } catch { metrics = []; }
		metrics = metrics.filter((m) => METRICS[m]);
		if (!metrics.length) metrics = ['winPct'];
		const playoffsBox = document.getElementById('history-playoffs');
		try { playoffsBox.checked = localStorage.getItem('historyPlayoffs') === 'true'; } catch { /* no storage */ }

		const apply = () => {
			for (const chip of chips) {
				const key = chip.dataset.metric;
				const on = metrics.includes(key);
				chip.classList.toggle('history-toggle-active', on);
				chip.setAttribute('aria-pressed', String(on));
				chip.style.color = on ? METRICS[key].color : '';
			}
			render(histories[playoffsBox.checked ? 'playoffs' : 'regular'], officialCoaches, metrics);
			tableHistory = histories[playoffsBox.checked ? 'playoffs' : 'regular'];
			renderHistoryTable();
		};
		for (const chip of chips) {
			chip.addEventListener('click', () => {
				const key = chip.dataset.metric;
				metrics = metrics.includes(key) ? metrics.filter((m) => m !== key) : [...metrics, key];
				if (!metrics.length) metrics = [key];
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

		const share = document.getElementById('history-share');
		share.innerHTML = labeledShareButtonsHtml('footer-share-item');
		wireShareRow(share, historyCopy(histories.regular).desc, pageUrl('history'));
		wireShareDropdown();
	} catch (e) {
		chartEl.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
