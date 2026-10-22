// Leaders page: every manager or coach in tenure order with their record,
// derived from gameinfo.csv + leaders.csv + biofile0.csv.
//
// IN are-they-sports: the Brewers site's managers page, made any club's and
// any sport's (SITE.leaderNoun). Who led each game arrives as leaders.csv —
// teamstats' gid, team and mgr columns, built from game_leader — and the
// official tenures as managers.csv, from the same rows (lib/web-routes.js).
// No photos are on record here, so the photo column is gone. Where no game
// names its coach (hockey's come as stated tenures), the rows are the
// server's tally instead, data/coaches.json.
import { parseGameinfoCsv, computeSeasonHistory, esc } from './records-core.js';
import { parseBiofile, parseTeamstatsMgr, parseManagersCsv, computeCoachesFromData, coachesFromJson, coachesCopy } from './coaches-core.js';
import { labeledShareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { sortableHeadHtml, sortRows, wireSortable } from './sortable.js';
import { SITE } from './site.js';

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const seasonName = (season) => (SITE.seasonLabel ? SITE.seasonLabel(season) : String(season));
const pageUrl = (path) => new URL(path, document.baseURI).href;

const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));

const MANAGER_COLUMNS = [
	{ key: 'name',    label: cap(SITE.leaderNoun) },
	{ key: 'firstSeason', label: 'Tenure', title: 'Tenure', num: true, sortKey: (c) => c.firstSeason, defaultDir: -1 },
	{ key: 'record',  label: 'Record',  title: 'Win-Loss-Tie', num: true, sortKey: (c) => c.winPct, defaultDir: -1 },
	{ key: 'winPct',  label: 'Win %',   title: 'Winning percentage', num: true, defaultDir: -1 },
	{ key: 'playoffRecord', label: 'Playoffs', title: 'Playoff record', num: true, sortKey: (c) => c.playoffGames, defaultDir: -1 },
	{ key: 'titles',  label: 'Titles',  title: 'Championships', num: true, defaultDir: -1 },
];
let managerSort = { key: 'firstSeason', dir: -1 };
let managerData = []; // currently displayed coaches

function rowHtml(c) {
	return `<tr>
		<td>${esc(c.name)}${c.interim ? '<span class="coach-interim" title="Interim">*</span>' : ''}</td>
		<td class="h2h-num"><a href="${c.firstSeason}">${esc(c.tenure)}</a></td>
		<td class="h2h-num">${esc(c.record)}</td>
		<td class="h2h-num">${pct(c.winPct)}</td>
		<td class="h2h-num">${c.playoffRecord ? esc(c.playoffRecord) : '—'}</td>
		<td class="h2h-num">${c.titles || '—'}</td>
	</tr>`;
}

function tableHtml(coaches) {
	const rows = sortRows(coaches, MANAGER_COLUMNS, managerSort).map(rowHtml).join('');
	return `<table class="h2h-table coaches-table sortable-table">
		<thead><tr>${sortableHeadHtml(MANAGER_COLUMNS, managerSort)}</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

async function init() {
	const wrap = document.getElementById('coaches-table-wrap');
	try {
		const [gamesRes, namesRes, leadersRes, biofileRes, managersRes, curGamesRes] = await Promise.all([
			fetch('data/gameinfo.csv'),
			fetch('data/CurrentNames.csv'),
			fetch('data/leaders.csv'),
			fetch('data/biofile0.csv'),
			fetch('data/managers.csv'),
			fetch('api/current/gameinfo.csv').catch(() => null),
		]);
		if (!gamesRes.ok || !namesRes.ok || !leadersRes.ok || !biofileRes.ok || !managersRes.ok) throw new Error('CSV fetch failed');
		// The season being played, appended so tenures include it.
		const curGames = curGamesRes?.ok ? (await curGamesRes.text()).trim() : '';
		const gamesText = (await gamesRes.text()).trimEnd() + (curGames ? '\n' + curGames : '');
		const rows = parseGameinfoCsv(gamesText, await namesRes.text());
		const gidToMgr = parseTeamstatsMgr(await leadersRes.text());
		const mgrNames = parseBiofile(await biofileRes.text());
		const officialTenures = parseManagersCsv(await managersRes.text());
		const champions = computeSeasonHistory(rows).filter((s) => s.champion).map((s) => s.season);
		let data = computeCoachesFromData(rows, gidToMgr, mgrNames, champions, officialTenures);
		if (!data.coaches.length) {
			const res = await fetch('data/coaches.json');
			if (res.ok) data = coachesFromJson(await res.json());
			// Tenures by season, not by date: say so where the games' version
			// says its stints are dated.
			const note = document.querySelector('.history-legend-item');
			if (note) note.textContent = '* interim · records are regular season, through last season; a coach changed in mid-season shares that season';
		}
		// Hockey's fourth column, said in the heading's title when it is there.
		if (data.coaches.some((c) => c.otl)) MANAGER_COLUMNS[2].title = 'Win-Loss-Tie-Overtime loss';

		// Nobody on record is a page that says so, not one that throws.
		if (!data.coaches.length) {
			wrap.innerHTML = `<p class="record-empty">No ${esc(SITE.leaderPlural)} are on record for the ${esc(SITE.team)} yet.</p>`;
			document.getElementById('coaches-subtitle').textContent = SITE.fullName;
			return;
		}
		const interimBox = document.getElementById('coaches-interim');
		try { interimBox.checked = localStorage.getItem('coachesShowInterim') !== 'false'; } catch { /* no storage */ }
		const subtitle = document.getElementById('coaches-subtitle');
		const renderTable = () => {
			managerData = interimBox.checked ? data.coaches : data.coaches.filter((c) => !c.interim);
			wrap.innerHTML = tableHtml(managerData);
			const table = wrap.querySelector('table');
			if (table) wireSortable(table, MANAGER_COLUMNS, managerSort, renderTable);
			const interimCount = data.coaches.length - managerData.length;
			subtitle.textContent = `${SITE.fullName} · ${managerData.length} ${SITE.leaderPlural} since ${seasonName(data.coaches[0].firstSeason)}` +
				(interimCount ? ` · ${interimCount} interim` : '');
		};
		interimBox.addEventListener('change', () => {
			try { localStorage.setItem('coachesShowInterim', String(interimBox.checked)); } catch { /* no storage */ }
			renderTable();
		});
		renderTable();

		const share = document.getElementById('managers-share');
		share.innerHTML = labeledShareButtonsHtml('footer-share-item');
		wireShareRow(share, coachesCopy(data).desc, pageUrl(SITE.leaderPlural));
		wireShareDropdown();
	} catch (e) {
		wrap.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
