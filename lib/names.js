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
 *  Both files name their columns the same way now — franchiseAbbrv joins eras,
 *  teamAbbrv names one, teamName is the nickname. Baseball's used to be
 *  different and misleading, with teamName holding the CODE.
 *
 *  The two sources still differ in what they key on: Retrosheet gives exact
 *  dates, the football history gives seasons. An NFL season crosses the new
 *  year — a January 2011 game belongs to the 2010 season — so deriving one from
 *  the other would be wrong. Callers pass both and each resolver takes what it
 *  needs.
 */

import { loadHistory, REFERENCE_DIR } from './reference.js';
import { codeTable } from './codes.js';
import { choosePalette } from './palette.js';


/** "Chicago" + "Staleys". Some early rows carry no city. */
export const displayName = (row) => `${row.city ?? ''} ${row.teamName ?? ''}`.replace(/\s+/g, ' ').trim();

// Re-exported: this was defined here, and every caller still imports it here.
export { loadHistory };

/** M/D/YYYY to ISO. The baseball table dates its spans where the football one
 *  numbers seasons, which is the same split Retrosheet and nflverse have. */
export function isoDate(american) {
	if (!american) return '';
	const m = String(american).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!m) return '';
	const [, mm, dd, yyyy] = m;
	return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
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
			// Up to five, because some clubs publish that many. Reading a fixed
			// three silently dropped whatever came after.
			colors: [r.colorA, r.colorB, r.colorC, r.colorD, r.colorE].filter(Boolean),
		});
	}
	// Newest first, so a lookup with no season gets the current identity.
	for (const spans of byCode.values()) spans.sort((a, b) => b.from - a.from);
	return byCode;
}

/** Index baseball's history: a code holds several identities, each a date span.
 *
 *  The columns differ from football's because the two tables were built from
 *  different upstreams — `teamName` here is the CODE and `team` is the nickname,
 *  which is the opposite of what either name suggests. Reading them the obvious
 *  way gives a franchise called "MIL" playing a club called "Brewers".
 */
export function mlbIndex(rows) {
	const byCode = new Map();
	for (const r of rows) {
		const name = `${r.city ?? ''} ${r.teamName ?? ''}`.replace(/\s+/g, ' ').trim();
		if (!r.teamAbbrv || !name) continue;
		if (!byCode.has(r.teamAbbrv)) byCode.set(r.teamAbbrv, []);
		byCode.get(r.teamAbbrv).push({
			name,
			franchise: r.franchiseAbbrv || r.teamAbbrv,
			from: isoDate(r.startDate),
			to: isoDate(r.endDate),
			league: r.league,
			colors: [r.colorA, r.colorB, r.colorC, r.colorD, r.colorE].filter(Boolean),
		});
	}
	// Newest first, so a lookup with no date gets the current identity.
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
/** Every span a FRANCHISE has held, across all the codes it has used.
 *
 *  Needed because the database stores canonical franchises, not the code a game
 *  was recorded under. Asking for ANA in 1969 otherwise finds only the Angels'
 *  own spans, which start in 1997, and falls back to "Anaheim Angels" for a
 *  season they played as the California Angels under the code CAL.
 *
 *  A franchise's identity over time is the union of its codes' spans, so that is
 *  what this builds.
 */
export function byFranchise(index) {
	const out = new Map();
	for (const spans of index.values()) {
		for (const s of spans) {
			if (!out.has(s.franchise)) out.set(s.franchise, []);
			out.get(s.franchise).push(s);
		}
	}
	return out;
}

export function resolver(sportId, dir = REFERENCE_DIR) {
	const rows = loadHistory(sportId, dir);
	// Canonicalise first, so a code from any provider resolves. The artifacts
	// record opponents by nflverse spelling — SD, WAS, STL, LA, LV — and when
	// those five stopped being rows of their own and became a column, every one
	// of them became an unnamed opponent on the Packers schedule. That is the
	// same lookup routing uses; doing it twice is what this replaced.
	const canonical = codeTable(sportId, rows).franchiseOf;

	if (sportId === 'nfl') {
		const idx = nflIndex(rows);
		const franchises = byFranchise(idx);
		return (code, when = {}) => {
			// Franchise first: what the database stores is a franchise, and its
			// union of spans is what covers a season played under an older code.
			const spans = franchises.get(canonical(code)) ?? idx.get(code);
			if (!spans) return { name: code, franchise: code, known: false, isHistorical: false };
			const season = typeof when === 'string' ? null : when.season;
			const ordered = [...spans].sort((a, b) => b.from - a.from);
			const span = spanForSeason(ordered, season);
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
	const franchises = byFranchise(idx);
	return (code, when = {}) => {
		const spans = franchises.get(canonical(code)) ?? idx.get(code);
		if (!spans) return { name: code, franchise: code, known: false, isHistorical: false };
		const date = typeof when === 'string' ? when : when.date;
		const ordered = [...spans].sort((a, b) => (a.from < b.from ? 1 : -1));
		const span = spanForDate(ordered, date);
		return {
			name: span.name,
			franchise: span.franchise,
			league: span.league,
			colors: span.colors,
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
export function colorsFor(resolve, code, when, fallback) {
	return choosePalette(resolve(code, when).colors ?? [], fallback);
}

/** An unknown code returns the code itself rather than throwing or blanking.
 *
 *  Showing "AKR" is honest; showing "" would look like a rendering bug and
 *  throwing would take down a page over a label.
 */
export function nameFor(resolve, code, when) {
	return resolve(code, when).name;
}
