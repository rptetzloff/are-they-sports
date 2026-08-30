/** Turning a request path into "which club, and what about them".
 *
 *  Pure, and separate from server.js on purpose: routing is the part with the
 *  edge cases, and a route table that can only be tested by starting a server
 *  and making requests is a route table that does not get tested.
 */

import { basePath } from './scope.js';

/** Build the route table once, from the resolved scope.
 *
 *  Every club gets a prefix, and the prefix is the only thing a scope changes.
 *  A single-club deployment has an empty prefix so its existing URLs survive;
 *  everything below the prefix is identical in all five scope kinds.
 */
export function routeTable(scope, resolved) {
	return resolved.map((entry) => ({ ...entry, base: basePath(scope, entry) }));
}

/** Strip a trailing slash, except from the root itself. So /packers/ and
 *  /packers are one page rather than two with one 404. */
export function normalisePath(pathname) {
	if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
	return pathname;
}

/** Which club a path belongs to, and what remains of the path after its prefix.
 *
 *  A base matches only on a segment boundary: `/packers` claims `/packers` and
 *  `/packers/2024`, and does not claim `/packersfan`. That single rule is doing
 *  all of the work here.
 *
 *  It replaced a longest-prefix tie-break written for the case of one club's id
 *  prefixing another's — `cards` and `cardinals`. That case cannot arise: with
 *  the boundary rule, `/cardinals/2024` never matches `/cards` in the first
 *  place, so there is nothing to break the tie between. A mutation run proved
 *  it by deleting the tie-break and changing no test result. Two pieces of
 *  unreachable defence read as if they were protecting something.
 *
 *  The empty base belongs to a single-club scope and matches whatever is left.
 */
export function matchRoute(pathname, table) {
	const path = normalisePath(pathname);
	const claims = (base) => base === '' || path === base || path.startsWith(`${base}/`);

	// A named base beats the empty one, which only a single-club scope has and
	// which would otherwise swallow every path.
	const entry = table.find((e) => e.base !== '' && claims(e.base))
		?? table.find((e) => e.base === '');
	if (!entry) return null;

	const rest = path.slice(entry.base.length) || '/';
	return { entry, rest };
}

/** What a club-relative path asks for.
 *
 *  Deliberately small. These are the four the two live sites actually have,
 *  minus the og:image routes, which need a renderer that does not exist here
 *  yet — naming them now would be inventing a seam before there is a case.
 */
export function parseView(rest) {
	if (rest === '/') return { view: 'summary' };
	const season = rest.match(/^\/(\d{4})$/);
	if (season) return { view: 'season', season: season[1] };
	const records = rest.match(/^\/records(?:\/([a-z0-9-]+))?$/);
	if (records) return { view: 'records', record: records[1] ?? null };
	// Bare /vs is the index; /vs/{slug} is one opponent.
	if (rest === '/vs') return { view: 'vs', opponent: null };
	const vs = rest.match(/^\/vs\/([a-z0-9-]+)$/);
	if (vs) return { view: 'vs', opponent: vs[1] };
	return null;
}
