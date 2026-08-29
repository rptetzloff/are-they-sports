// Build a franchise reference table: code, candidate display name, and the
// dates the corpus applied that label. Read the warning below before treating
// those dates as franchise eras — they are not.
//
//   node scripts/franchises.mjs nfl > data/reference/nfl-franchises.csv
//
// This is the NFL's missing CurrentNames.csv. Retrosheet publishes one for
// baseball — franchise code, name, start date, end date — and nothing
// equivalent exists for football. nflverse's teams.csv covers 2002 onward and
// 35 codes; the results data reaches back to 1920 and uses 123.
//
// What this can and cannot do:
//
//   derived   a candidate name for a code, taken from a site that already
//             names its opponents. The name is usually right; the dates are
//             only what that source happened to label, not an era.
//   inherited names from nflverse for the modern era.
//   missing   1920s clubs nobody in the corpus played. Emitted with an empty
//             name so the gap is visible in the file rather than implied by an
//             absence, and filled in by hand as franchises are traced.
//
// **The dates are NOT franchise eras, and must not be read as any.** They are
// the first and last game on which the corpus applied that label — which is a
// fact about the corpus, not about history. The football site names historical
// games with modern franchise names, so this generator produces rows like
//
//     ARI,Arizona Cardinals,1921-11-20,...    (they were the Chicago Cardinals)
//     IND,Indianapolis Colts,1953-10-18,...   (they were the Baltimore Colts)
//     TEN,Tennessee Titans,1972-11-19,...     (they were the Houston Oilers)
//
// all of which are wrong as history and right as a record of what the source
// said. The columns are named firstSeen/lastSeen for that reason.
//
// So this file is a starting list, not a franchise history. Turning it into one
// means tracing each franchise — who they were, where they moved, when — which
// is the job Retrosheet already did for baseball and nobody has done for
// football. That work is manual and is the point of the `source` column: rows
// marked `derived` are candidates awaiting that tracing, rows marked `traced`
// have had it.
//
// One thing the corpus does get right by accident: LAC and LAR each appear
// under two names, because some rows were labelled historically and others
// were not. That inconsistency is why the table is keyed by code AND date —
// a single name per code would relabel every St. Louis Rams game as Los
// Angeles — but it is not evidence the ranges are correct.

import { csvRows as rows } from '../lib/csv.js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'data', 'sources');

/** Collapse observations into one row per (code, name), bounded by the first
 *  and last date that pairing was seen.
 *
 *  Exported because this is the whole judgement of the file and deserves a test
 *  that does not need 1.2MB of CSV to run.
 */
export function collapse(observations) {
	const byPair = new Map();
	for (const { code, name, date } of observations) {
		if (!code || !name) continue;
		const key = `${code} ${name}`;
		const cur = byPair.get(key);
		if (!cur) byPair.set(key, { code, name, first: date, last: date });
		else {
			if (date < cur.first) cur.first = date;
			if (date > cur.last) cur.last = date;
		}
	}
	return [...byPair.values()].sort((a, b) =>
		a.code.localeCompare(b.code) || a.first.localeCompare(b.first));
}

/** Every franchise code the results data uses, so a gap is listed rather than
 *  silently absent. */
export function unnamedCodes(allCodes, named) {
	const have = new Set(named.map((r) => r.code));
	return allCodes.filter((c) => !have.has(c)).sort();
}

async function main() {
	const sportId = process.argv[2] || 'nfl';
	const seed = join(SOURCE_DIR, sportId, 'seed-results.csv');

	// Observations come from any site that already names its opponents. Today
	// that is the football site's committed CSV, which names every opponent the
	// Packers ever played; each team added extends the coverage, because a club
	// the Packers never met probably played the Bears.
	const namedGames = join(ROOT, '..', 'AreThePackersUndefeated', 'data', 'packers_games.csv');

	const nameByDate = new Map();
	for await (const r of rows(namedGames)) {
		if (r['Packers Win']) nameByDate.set(r.date, r.Opponent);
	}

	const observations = [];
	const allCodes = new Set();
	for await (const r of rows(seed)) {
		allCodes.add(r.team1); allCodes.add(r.team2);
		if (!r.score1) continue;
		if (r.team1 !== 'GB' && r.team2 !== 'GB') continue;
		const code = r.team1 === 'GB' ? r.team2 : r.team1;
		const name = nameByDate.get(r.date);
		if (name) observations.push({ code, name, date: r.date });
	}

	const named = collapse(observations);
	const missing = unnamedCodes([...allCodes].filter(Boolean), named);

	const esc = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
	const out = ['code,name,firstSeen,lastSeen,source'];
	for (const r of named) out.push([r.code, esc(r.name), r.first, r.last, 'derived'].join(','));
	// Gaps are rows, not omissions. A reader can see what is unresolved and a
	// lookup can say "code only" rather than guessing.
	for (const c of missing) out.push([c, '', '', '', 'unresolved'].join(','));

	process.stdout.write(`${out.join('\n')}\n`);
	process.stderr.write(`  ${named.length} named rows, ${missing.length} unresolved codes\n`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
