/** Franchise codes to display names.
 *
 *  The two sports answer this differently, and the difference is a fact about
 *  the available data rather than a design choice:
 *
 *    baseball  Retrosheet publishes real eras, so `nameFor('mlb', 'SE1')` is
 *              "Seattle Pilots" and a 1969 Brewers game is labelled correctly.
 *              Dates matter and are honoured.
 *    football  no equivalent source exists, so a code resolves to the current
 *              franchise name whatever the date. A 1995 Rams game says "Los
 *              Angeles Rams" even though it was played in St. Louis. That is
 *              wrong as history and is what the football site has always done.
 *
 *  Rather than paper over that, `nameFor` returns the name and `isHistorical`
 *  says whether it was resolved with date information. A caller that cares can
 *  tell the difference; nothing yet does, but the alternative is a function that
 *  silently means two things.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_DIR = join(ROOT, 'data', 'reference');

/** Load a sport's name table. */
export function loadNames(sportId, dir = REFERENCE_DIR) {
	return parseCsv(readFileSync(join(dir, `${sportId}-names.csv`), 'utf8'));
}

/** Index football's flat table: one name per code, no dates. */
export function nflIndex(rows) {
	const byCode = new Map();
	for (const r of rows) {
		if (!r.code || !r.name) continue;
		// `current` rows win over `alias` rows, so a code that is both — none
		// today, but LA and LAR are one bad edit away — resolves to the club
		// rather than to whichever line came last.
		if (byCode.has(r.code) && r.kind !== 'current') continue;
		byCode.set(r.code, r.name);
	}
	return byCode;
}

/** Index baseball's table: a code can hold several names, each with a span. */
export function mlbIndex(rows) {
	const byCode = new Map();
	for (const r of rows) {
		if (!r.code || !r.name) continue;
		if (!byCode.has(r.code)) byCode.set(r.code, []);
		byCode.get(r.code).push({ name: r.name, from: r.from, to: r.to });
	}
	// Newest first, so a lookup with no date gets the current name.
	for (const spans of byCode.values()) spans.sort((a, b) => (a.from < b.from ? 1 : -1));
	return byCode;
}

/** Names inferred from a corpus that labels its own opponents.
 *
 *  These are candidates, not history. The file's own header says at length that
 *  its dates are the first and last game on which a label was applied, which is
 *  a fact about the corpus rather than about the franchise — so only the name is
 *  taken here and the dates are ignored entirely. Where one code carries two
 *  names (LAC appears as both Chargers cities), the curated table above is what
 *  settles it, and these rows never override it.
 */
export function derivedIndex(dir = REFERENCE_DIR) {
	const byCode = new Map();
	for (const r of parseCsv(readFileSync(join(dir, 'nfl-franchises.csv'), 'utf8'))) {
		if (!r.code || !r.name || byCode.has(r.code)) continue;
		byCode.set(r.code, r.name);
	}
	return byCode;
}

/** Which span covers a date. An empty `to` means the name is current.
 *
 *  Exported because it is the whole judgement of the baseball path, and it
 *  needs a test that does not read a file.
 */
export function spanFor(spans, date) {
	if (!date) return spans[0] ?? null;
	for (const s of spans) {
		if (date < s.from) continue;
		if (s.to === '' || date <= s.to) return s;
	}
	// A date before the franchise existed. The oldest span is a better answer
	// than nothing, and it is flagged as not date-resolved.
	return spans[spans.length - 1] ?? null;
}

/** Build a resolver for one sport. Loaded once; these tables are small. */
export function resolver(sportId, dir = REFERENCE_DIR) {
	const rows = loadNames(sportId, dir);
	if (sportId === 'mlb') {
		const idx = mlbIndex(rows);
		return (code, date) => {
			const spans = idx.get(code);
			if (!spans) return { name: code, known: false, isHistorical: false };
			const span = spanFor(spans, date);
			return {
				name: span.name,
				known: true,
				// True only when a date actually selected the span. Without a
				// date this is the current name, which is a different claim.
				isHistorical: Boolean(date) && (span.to !== '' || spans.length > 1),
			};
		};
	}
	const idx = nflIndex(rows);
	// Second tier: names derived from a site that already labels its opponents.
	// Curated rows win, because they were checked by a person and these were
	// inferred — but the derived table is what covers the 1920s clubs, and
	// without it two thirds of the Packers' own opponents resolve to a bare
	// code. See scripts/franchises.mjs for what "derived" is worth.
	const derived = derivedIndex(dir);

	// The date is accepted and ignored, deliberately and visibly, so callers can
	// pass one uniformly and football does not pretend to honour it.
	return (code) => {
		const curated = idx.get(code);
		if (curated) return { name: curated, known: true, isHistorical: false, source: 'curated' };
		const guess = derived.get(code);
		if (guess) return { name: guess, known: true, isHistorical: false, source: 'derived' };
		return { name: code, known: false, isHistorical: false, source: 'none' };
	};
}

/** An unknown code returns the code itself rather than throwing or blanking.
 *
 *  62 football codes have no name today, all of them clubs nobody built has
 *  played. Showing "AKR" is honest; showing "" would look like a rendering bug
 *  and throwing would take down a page over a label.
 */
export function nameFor(resolve, code, date) {
	return resolve(code, date).name;
}
