// Shared sort logic for h2h-style tables. Column spec:
//   { key, label, title, num?, sortKey?, defaultDir?, nosort? }
//   sortKey: field name or (row) => comparable. Defaults to `key`.
//   defaultDir: 1 (asc) or -1 (desc) on first click. Default 1.
//   nosort: renders a plain <th> with no click handler.
// sort: { key, dir } — mutated in place by wireSortable.
const ARROW = { 1: ' \u25B2', [-1]: ' \u25BC' };

export function sortableHeadHtml(columns, sort) {
	return columns.map((c) => {
		const base = c.num ? ' class="h2h-num"' : '';
		const title = c.title ? ` title="${c.title}"` : '';
		if (c.nosort) return `<th${base}${title}>${c.label}</th>`;
		const active = c.key === sort.key;
		const arrow = active ? ARROW[sort.dir] : '';
		const aria = active ? ` aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : '';
		return `<th data-key="${c.key}"${base}${title}${aria}>${c.label}${arrow}</th>`;
	}).join('');
}

export function sortRows(rows, columns, sort) {
	const col = columns.find((c) => c.key === sort.key);
	const get = col?.sortKey ?? sort.key;
	const acc = typeof get === 'function' ? get : (r) => r[get];
	return rows.slice().sort((a, b) => {
		const av = acc(a), bv = acc(b);
		const cmp = typeof av === 'number' && typeof bv === 'number'
			? av - bv
			: String(av).localeCompare(String(bv));
		return cmp * sort.dir;
	});
}

export function wireSortable(table, columns, sort, onResort) {
	table.querySelectorAll('th[data-key]').forEach((th) => {
		th.addEventListener('click', () => {
			const k = th.dataset.key;
			if (sort.key === k) sort.dir = -sort.dir;
			else {
				const col = columns.find((c) => c.key === k);
				sort.key = k;
				sort.dir = col?.defaultDir ?? 1;
			}
			onResort();
		});
	});
}
