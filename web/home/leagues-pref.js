// The visitor's leagues, in their browser: which are hidden, which are
// folded to their label in the scores strip, and their order. Read by the
// strip (scorebar.js) and the home page's sections (home.js); a change made
// in either is announced to the other with an 'ats-leagues' event, and to
// other tabs by the storage event.

const KEY = 'ats.leagues';

export function readLeagues() {
	try {
		const p = JSON.parse(localStorage.getItem(KEY) || '{}');
		return { order: Array.isArray(p.order) ? p.order : [], hidden: Array.isArray(p.hidden) ? p.hidden : [], folded: Array.isArray(p.folded) ? p.folded : [] };
	} catch { return { order: [], hidden: [], folded: [] }; }
}

export function writeLeagues(p) {
	try {
		if (!p.order.length && !p.hidden.length && !p.folded.length) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, JSON.stringify(p));
	} catch { /* no storage: the choice lasts this page */ }
	window.dispatchEvent(new CustomEvent('ats-leagues'));
}

/** `sports` in the visitor's order: theirs first, then any they have not
 *  placed (a league new to the site) in the order given. */
export function ordered(sports, p = readLeagues()) {
	const placed = p.order.filter((s) => sports.includes(s));
	return [...placed, ...sports.filter((s) => !placed.includes(s))];
}

export function onLeagues(fn) {
	window.addEventListener('ats-leagues', fn);
	window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) fn(); });
}
