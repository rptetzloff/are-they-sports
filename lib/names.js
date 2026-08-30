/** Franchise codes to display names, by era, for both sports.
 *
 *  This used to say football could not do it. That was true of the data
 *  available then, not of football: `data/reference/nfl-franchise-history.csv`
 *  is the file that did not exist — franchise, source code, league, city, name,
 *  colours and the seasons each applied. 264 rows, 119 franchises, 128 codes.
 *
 *  So both sports now resolve the same way and the asymmetry is gone. A 1921
 *  Bears game says "Chicago Staleys", a 1930 Lions game says "Portsmouth
 *  Spartans", and a 1995 Rams game says "St. Louis Rams" — which the football
 *  site has never done and this repo could not do an hour ago.
 *
 *  The two sources still differ in what they key on: Retrosheet gives exact
 *  dates, the football history gives seasons. An NFL season crosses the new
 *  year — a January 2011 game belongs to the 2010 season — so deriving one from
 *  the other would be wrong. Callers pass both and each resolver takes what it
 *  needs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_DIR = join(ROOT, 'data', 'reference');

/** "Chicago" + "Staleys". Some early rows carry no city. */
export const displayName = (row) => `${row.city ?? ''} ${row.teamName ?? ''}`.replace(/\s+/g, ' ').trim();

/** Load a sport's history table. */
export function loadHistory(sportId, dir = REFERENCE_DIR) {
	const file = sportId === 'nfl' ? 'nfl-franchise-history.csv' : 'mlb-names.csv';
	return parseCsv(readFileSync(join(dir, file), 'utf8'));
}

/** Index football's history: a code holds several identities, each a season
 *  span, and each belongs to a canonical franchise. */
export function nflIndex(rows) {
	const byCode = new Map();
	for (const r of rows) {
		const name = displayName(r);
		if (!r.teamAbbrv || !name) continue;
		if (!byCode.has(r.teamAbbrv)) byCode.set(r.teamAbbrv, []);
		byCode.get(r.teamAbbrv).push({
			name,
			franchise: r.franchiseAbbrv || r.teamAbbrv,
			from: Number(r.startSeason),
			to: Number(r.endSeason),
			league: r.league,
			colors: [r.colorA, r.colorB, r.colorC].filter(Boolean),
		});
	}
	// Newest first, so a lookup with no season gets the current identity.
	for (const spans of byCode.values()) spans.sort((a, b) => b.from - a.from);
	return byCode;
}

/** Index baseball's table: a code holds several names, each with a date span. */
export function mlbIndex(rows) {
	const byCode = new Map();
	for (const r of rows) {
		if (!r.code || !r.name) continue;
		if (!byCode.has(r.code)) byCode.set(r.code, []);
		byCode.get(r.code).push({ name: r.name, franchise: r.current || r.code, from: r.from, to: r.to });
	}
	for (const spans of byCode.values()) spans.sort((a, b) => (a.from < b.from ? 1 : -1));
	return byCode;
}

/** Which span covers a season. Football's bounds are inclusive years. */
export function spanForSeason(spans, season) {
	if (!season) return spans[0] ?? null;
	const y = Number(season);
	for (const s of spans) if (y >= s.from && y <= s.to) return s;
	// Outside every span. The nearest identity beats an empty label, and the
	// caller is told it was not era-resolved.
	return y > spans[0].to ? spans[0] : spans[spans.length - 1];
}

/** Which span covers a date. An empty `to` means the name is current. */
export function spanForDate(spans, date) {
	if (!date) return spans[0] ?? null;
	for (const s of spans) {
		if (date < s.from) continue;
		if (s.to === '' || date <= s.to) return s;
	}
	return spans[spans.length - 1] ?? null;
}

/** Build a resolver for one sport.
 *
 *  Returns `{ name, franchise, known, isHistorical }`. `isHistorical` says the
 *  answer was chosen by era rather than defaulted to the current identity —
 *  which both sports can now claim, where football could not before.
 */
export function resolver(sportId, dir = REFERENCE_DIR) {
	const rows = loadHistory(sportId, dir);

	if (sportId === 'nfl') {
		const idx = nflIndex(rows);
		return (code, when = {}) => {
			const spans = idx.get(code);
			if (!spans) return { name: code, franchise: code, known: false, isHistorical: false };
			const season = typeof when === 'string' ? null : when.season;
			const span = spanForSeason(spans, season);
			const inSpan = season && Number(season) >= span.from && Number(season) <= span.to;
			return {
				name: span.name,
				franchise: span.franchise,
				league: span.league,
				colors: span.colors,
				known: true,
				isHistorical: Boolean(inSpan) && spans.length > 1,
			};
		};
	}

	const idx = mlbIndex(rows);
	return (code, when = {}) => {
		const spans = idx.get(code);
		if (!spans) return { name: code, franchise: code, known: false, isHistorical: false };
		const date = typeof when === 'string' ? when : when.date;
		const span = spanForDate(spans, date);
		return {
			name: span.name,
			franchise: span.franchise,
			known: true,
			isHistorical: Boolean(date) && (span.to !== '' || spans.length > 1),
		};
	};
}

/** A club's colours for a given season, from the history table.
 *
 *  colorA is the ground and colorB the accent — checked against the four clubs
 *  whose palettes were hand-written here first, where three matched exactly. The
 *  fourth was the Lions, and the file was right: they are blue and silver, not
 *  blue on black.
 *
 *  Per era, so a 1950s Packers page renders in the green they used then rather
 *  than the one they use now. That is the whole reason to take colours from a
 *  dated table instead of a manifest.
 *
 *  Many 1920s franchises have no colours at all, so a fallback is required
 *  rather than optional.
 */
export function colorsFor(resolve, code, season, fallback) {
	const span = resolve(code, { season });
	const [a, b] = span.colors ?? [];
	if (!a) return fallback;
	return { base: a, accent: b && b !== a ? b : fallback.accent };
}

/** Baseball's colours, which are curated rather than published.
 *
 *  Retrosheet gives names and eras and no colours at all, so this is a separate
 *  hand-written table with one row per franchise and no season spans — which
 *  means a 1969 Pilots page renders in Brewers navy. Football does better only
 *  because its history table arrived with colours in it.
 *
 *  Keyed on the canonical franchise, so SE1 resolves through MIL.
 */
export function loadColors(sportId, dir = REFERENCE_DIR) {
	if (sportId !== 'mlb') return new Map();
	const rows = parseCsv(readFileSync(join(dir, 'mlb-colors.csv'), 'utf8'));
	return new Map(rows.filter((r) => r.code && r.base).map((r) => [r.code, { base: r.base, accent: r.accent }]));
}

/** An unknown code returns the code itself rather than throwing or blanking.
 *
 *  Showing "AKR" is honest; showing "" would look like a rendering bug and
 *  throwing would take down a page over a label.
 */
export function nameFor(resolve, code, when) {
	return resolve(code, when).name;
}
