// Minimal click-to-sort for tables rendered from an items array. Pages keep a
// { key, dir } state object, sort their items with sortItems() inside their
// render function, and call wireSortHeaders() after each render. Headers opt
// in with data-sort="<item property>"; data-dir sets the first-click
// direction (default desc — numbers usually want biggest-first).

export function sortItems(items, state) {
	if (!state.key) return items;
	const dir = state.dir === 'asc' ? 1 : -1;
	return [...items].sort((a, b) => {
		const av = a[state.key], bv = b[state.key];
		if (typeof av === 'string' || typeof bv === 'string') {
			return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
		}
		return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir;
	});
}

export function wireSortHeaders(container, state, rerender) {
	container.querySelectorAll('th[data-sort]').forEach((th) => {
		const key = th.dataset.sort;
		th.classList.add('sortable');
		if (state.key === key) th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
		th.addEventListener('click', () => {
			if (state.key === key) {
				state.dir = state.dir === 'asc' ? 'desc' : 'asc';
			} else {
				state.key = key;
				state.dir = th.dataset.dir || 'desc';
			}
			rerender();
		});
	});
}
