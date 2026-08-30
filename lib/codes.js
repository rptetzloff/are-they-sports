/** One canonical answer to "which club is this code?".
 *
 *  Every source names clubs its own way and none of them agree. nflverse calls
 *  the Raiders LV, WAS the Commanders and LA the Rams; the franchise history
 *  calls the same three OAK, WSH and LAR; Retrosheet has SE1 for the club that
 *  is now MIL. A code is not an identity — a franchise is — and the translation
 *  between them belongs in one place.
 *
 *  It was in three. `resolver()` in names.js did it for display, `codeIndex()`
 *  in scope.js reversed the manifests to do it for routing, and the generator
 *  that wrote the 28 new manifests did it a third way. Three implementations of
 *  one fact is the drift CLAUDE.md keeps describing, and the routing one was
 *  wrong in a way nothing could see: `nfl-divisions.csv` names three clubs by
 *  their nflverse alias, and those three matched their own division only
 *  because `teams/raiders.js`, `teams/commanders.js` and `teams/rams.js`
 *  happened to list both codes. Delete `'LV'` from the Raiders' `sourceIds` —
 *  a tidy-up that looks harmless, since OAK is the canonical one — and the
 *  Raiders leave the AFC West. No error, no failing test; the division just
 *  serves fifteen clubs.
 *
 *  So: canonical franchise codes come from `franchiseAbbrv`, every `teamAbbrv`
 *  is an alias for one, and an unknown code resolves to itself. Resolving to
 *  itself rather than throwing is deliberate — a code this table has never seen
 *  is a data gap, and CLAUDE.md's rule is that gaps report rather than crash.
 *  The club will surface as unavailable with its own 503, which names what is
 *  missing; a throw here would take the whole site down for one bad row.
 */

import { loadHistory } from './reference.js';

/** Every column whose name ends in `Abbrv` is a code for the era on that row.
 *
 *  `franchiseAbbrv` joins a club's eras together, `teamAbbrv` names one era,
 *  and any further `<provider>Abbrv` is what some other source calls the same
 *  era — `nflverseAbbrv` is WAS where ours is WSH. So adding a provider is a
 *  column, and nothing here changes.
 *
 *  It was five extra ROWS before, each duplicating a club's name, city and
 *  colours so a second code would resolve. That is why the Rams' palette was
 *  written twice and could drift, and why an era row and its alias row could
 *  disagree about which years they covered. A row is an era; a column is a
 *  spelling.
 *
 *  This also removed a shape-sniffing step. The baseball file used to name its
 *  columns differently and misleadingly — `teamName` was a CODE (SE1, MLA) and
 *  `team` was the nickname — so a first version of this file, written against
 *  the football columns alone, built an EMPTY MLB table: every row skipped, no
 *  error. An empty table resolves every code to itself, which is exactly what
 *  this repo did before code tables existed, so nothing broke and nothing said
 *  so. Renaming baseball's columns to football's is what made one rule work for
 *  both.
 */
const FRANCHISE = 'franchiseAbbrv';
const isCode = (key) => key.endsWith('Abbrv') && key !== FRANCHISE;

/** A sport's code table: any spelling in, canonical franchises out. */
export function codeTable(sportId, rows = loadHistory(sportId)) {
	const header = Object.keys(rows[0] ?? {});
	if (!header.some(isCode)) {
		// A reference file that cannot be read is a configuration error, not a
		// data gap: no amount of running a build fixes it, so it dies at boot
		// naming the columns it found rather than serving a silently empty table.
		throw new Error(
			`${sportId} franchise history has no *Abbrv code column; found ${header.join(', ') || '(no rows)'}`);
	}
	const codeCols = header.filter(isCode);
	const canonical = new Map(); // any code -> franchise
	const aliases = new Map(); // franchise -> every code it has used

	for (const r of rows) {
		// The franchise column is blank on rows that are their own franchise,
		// which is most of them. Falling back to the era code is what makes a
		// one-era club resolve at all.
		const franchise = r[FRANCHISE] || r.teamAbbrv;
		if (!franchise) continue;
		if (!aliases.has(franchise)) aliases.set(franchise, new Set());
		// A franchise code is a code, so it resolves to itself even when no row
		// carries it as an era code.
		if (!canonical.has(franchise)) canonical.set(franchise, franchise);

		for (const key of codeCols) {
			const code = r[key];
			// Blank means "this provider spells it the way we do", which is the
			// common case and must not become an entry for the empty string.
			if (!code) continue;
			canonical.set(code, franchise);
			aliases.get(franchise).add(code);
		}
	}

	return {
		/** The canonical franchise for a code, or the code itself if unknown. */
		franchiseOf: (code) => canonical.get(code) ?? code,
		/** Every code a franchise has ever used, canonical first. */
		codesOf: (franchise) => {
			const fr = canonical.get(franchise) ?? franchise;
			const set = aliases.get(fr);
			if (!set) return [franchise];
			return [fr, ...[...set].filter((c) => c !== fr).sort()];
		},
		/** Every canonical franchise this sport knows. */
		franchises: () => [...aliases.keys()].sort(),
		knows: (code) => canonical.has(code),
		size: canonical.size,
	};
}

/** Code tables for many sports, built once and shared.
 *
 *  A sport with no history table yields an identity translator rather than
 *  throwing, so adding `nhl` to a divisions file before its history arrives
 *  degrades to today's behaviour instead of breaking boot.
 */
export function codeTables(sportIds, load = loadHistory) {
	const tables = new Map();
	for (const id of sportIds) {
		let rows;
		try {
			rows = load(id);
		} catch {
			// A missing history table is a data gap — the sport degrades to
			// identity, which is what this repo did before code tables existed.
			tables.set(id, null);
			continue;
		}
		// A table that exists and cannot be read is a configuration error and is
		// NOT caught. Swallowing it here is what let the empty MLB table through:
		// every failure looked like "this sport has no history yet".
		tables.set(id, codeTable(id, rows));
	}
	/** `(sport, code) -> canonical franchise`, the shape callers actually want. */
	const franchiseOf = (sport, code) => tables.get(sport)?.franchiseOf(code) ?? code;
	return { franchiseOf, table: (sport) => tables.get(sport) ?? null, sports: () => [...tables.keys()] };
}
