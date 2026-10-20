// Head Coaches page: every head coach in the club's own order with their
// record. Columns sort on click.
//
// IN are-they-sports: the Packers site's page, made any club's. The rows are
// the server's tally (data/coaches.json, coaches-core.js coachRows) rather
// than a computation over a file only the Packers had, and there are no
// coach photos on record here, so the photo column and its lightbox are gone.
import { esc } from './records-core.js';
import { coachRows, coachesCopy } from './coaches-core.js';
import { shareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { sortItems, wireSortHeaders } from './sortable.js';
import { SITE } from './site.js';

const pct = (p) => (p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, ''));
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const pageUrl = (path) => new URL(path, document.baseURI).href;

function tableHtml(coaches) {
	const rows = coaches.map((c) => `
		<tr>
			<td class="h2h-num">${esc(c.numLabel)}</td>
			<td>${esc(c.name)}${c.interim ? '<span class="coach-interim" title="Interim">*</span>' : ''}</td>
			<td class="h2h-num"><a href="${c.firstSeason}">${esc(c.tenure)}</a></td>
			<td class="h2h-num">${esc(c.record)}</td>
			<td class="h2h-num">${pct(c.winPct)}</td>
			<td class="h2h-num">${c.playoffRecord ? esc(c.playoffRecord) : '—'}</td>
			<td class="h2h-num">${c.titles || '—'}</td>
		</tr>`).join('');
	return `<table class="h2h-table coaches-table">
		<thead><tr>
			<th class="h2h-num" data-sort="num" data-dir="asc">#</th>
			<th data-sort="name" data-dir="asc">${esc(cap(SITE.leaderNoun))}</th>
			<th class="h2h-num" data-sort="firstSeason" data-dir="asc">Tenure</th>
			<th class="h2h-num" data-sort="wins">Record</th>
			<th class="h2h-num" data-sort="winPct">Win %</th>
			<th class="h2h-num" data-sort="playoffWins">Playoffs</th>
			<th class="h2h-num" data-sort="titles">Titles</th>
		</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
}

async function init() {
	const wrap = document.getElementById('coaches-table-wrap');
	try {
		const res = await fetch('data/coaches.json');
		if (!res.ok) throw new Error('coaches fetch failed');
		const data = { coaches: coachRows(await res.json()) };
		// Nobody on record is a page that says so, not one that throws.
		if (!data.coaches.length) {
			wrap.innerHTML = `<p class="record-empty">No ${esc(SITE.leaderPlural)} are on record for the ${esc(SITE.team)} yet.</p>`;
			document.getElementById('coaches-subtitle').textContent = SITE.fullName;
			return;
		}

		document.getElementById('coaches-subtitle').textContent =
			`${SITE.fullName} · ${data.coaches.filter((c) => !c.interim).length} head ${SITE.leaderPlural} since ${data.coaches[0].firstSeason}`;

		// Interim exclusion persists like the site's other settings.
		const interimBox = document.getElementById('coaches-interim');
		try { interimBox.checked = localStorage.getItem('coachesShowInterim') !== 'false'; } catch { /* no storage */ }
		const sortState = { key: 'num', dir: 'asc' };
		const renderTable = () => {
			const items = interimBox.checked ? data.coaches : data.coaches.filter((c) => !c.interim);
			wrap.innerHTML = tableHtml(sortItems(items, sortState));
			wireSortHeaders(wrap, sortState, renderTable);
		};
		interimBox.addEventListener('change', () => {
			try { localStorage.setItem('coachesShowInterim', String(interimBox.checked)); } catch { /* no storage */ }
			renderTable();
		});
		renderTable();

		// The page's share buttons live in the footer's Share menu.
		const share = document.getElementById('footer-share');
		share.innerHTML = shareButtonsHtml('footer-share-item', { labels: true });
		wireShareRow(share, coachesCopy(data).desc, pageUrl(SITE.leaderPlural), { labels: true });
		wireShareDropdown();
	} catch (e) {
		wrap.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
