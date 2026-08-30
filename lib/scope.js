/** What one deployment shows.
 *
 *  A site is configured by a single scope, which resolves to a set of clubs:
 *
 *    team:packers          one club          arethepackersundefeated.com
 *    division:nfl/nfc-north  four clubs
 *    conference:nfl/nfc    sixteen clubs
 *    sport:nfl             a league
 *    all                   everything
 *
 *  Everything downstream reads the resolved list and never asks which kind of
 *  scope produced it. The selector question answers itself: a scope resolving to
 *  one club has no selector, and any other has one. That is the only branch.
 *
 *  **A division means today's clubs, each with its whole history.** NFC North is
 *  Chicago, Detroit, Green Bay and Minnesota, and it shows Green Bay back to
 *  1921 whether or not the division existed then. It does not mean "who was in
 *  the NFC North in 1985" — that would need realignment history, which nobody
 *  publishes and which this deliberately does not attempt. The consequence worth
 *  saying out loud: the NL Central includes the Brewers' 1969-1997 American
 *  League seasons, because those are the Brewers' history and the Brewers are
 *  in the NL Central now.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_DIR = join(ROOT, 'data', 'reference');

export const KINDS = ['team', 'division', 'conference', 'sport', 'all'];

/** A url-safe form of a conference or division name. */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Parse a scope string. Throws rather than falling back to a default.
 *
 *  A misspelled scope must not quietly become `all` or `team:packers`. The
 *  server would start, serve pages, and show the wrong thing — which is this
 *  project's recurring failure, a check that passes because it is not looking at
 *  what it claims to.
 */
export function parseScope(spec) {
	const s = String(spec ?? '').trim();
	if (!s) throw new Error('no scope given; expected one of ' + KINDS.join(', '));
	if (s === 'all') return { kind: 'all', sport: null, id: null };

	const [kind, rest] = s.split(':');
	if (!KINDS.includes(kind)) throw new Error(`unknown scope kind "${kind}"; expected ${KINDS.join(', ')}`);
	if (kind === 'all') throw new Error('scope "all" takes no argument');
	if (!rest) throw new Error(`scope "${kind}" needs an argument, e.g. ${kind}:nfl`);

	if (kind === 'team') return { kind, sport: null, id: rest };
	if (kind === 'sport') return { kind, sport: rest, id: null };

	// division and conference are qualified by sport, because "East" and "West"
	// exist in both leagues and "North" exists only in one.
	const [sport, id] = rest.split('/');
	if (!sport || !id) throw new Error(`scope "${kind}" needs sport/id, e.g. ${kind}:nfl/nfc-north`);
	return { kind, sport, id };
}

/** Current division membership, as committed reference data. */
export function loadDivisions(sportId, dir = REFERENCE_DIR) {
	const path = join(dir, `${sportId}-divisions.csv`);
	const rows = parseCsv(readFileSync(path, 'utf8'));
	if (!rows.length) throw new Error(`${path} has no rows`);
	return rows.map((r) => ({
		code: r.code,
		conference: r.conference,
		division: r.division,
		conferenceSlug: slug(r.conference),
		divisionSlug: slug(`${r.conference} ${r.division}`),
	}));
}

/** Which source codes a scope covers, before asking whether any of them have
 *  data. Separating those two is the point: a code being in scope and a code
 *  being buildable are different facts, and conflating them is how a site ends
 *  up quietly showing four teams where it promised sixteen. */
export function codesInScope(scope, divisionsBySport) {
	if (scope.kind === 'team') return null; // resolved by manifest, not membership

	const sports = scope.sport ? [scope.sport] : Object.keys(divisionsBySport);
	const out = [];
	for (const sportId of sports) {
		const rows = divisionsBySport[sportId];
		if (!rows) throw new Error(`no division table for sport "${sportId}"`);
		for (const r of rows) {
			if (scope.kind === 'division' && r.divisionSlug !== scope.id) continue;
			if (scope.kind === 'conference' && r.conferenceSlug !== scope.id) continue;
			out.push({ sport: sportId, ...r });
		}
	}
	if (!out.length) {
		const known = sports.flatMap((s) => (divisionsBySport[s] ?? []).map(
			(r) => (scope.kind === 'conference' ? r.conferenceSlug : r.divisionSlug)));
		throw new Error(
			`no ${scope.kind} "${scope.id}" in ${scope.sport ?? 'any sport'}; known: ${[...new Set(known)].sort().join(', ')}`);
	}
	return out;
}

/** Map every source code a club has ever used to that club's id.
 *
 *  Reversed from the manifests rather than stored, because sourceIds is already
 *  the list a club's identity is defined by — MIL and SE1 are both the Brewers.
 */
export function codeIndex(teams) {
	const byCode = new Map();
	for (const t of teams) {
		for (const code of t.sourceIds) {
			// Keyed by sport AND code. Codes collide across leagues: MIN is the
			// Vikings and the Twins, DET is the Lions and the Tigers, and MIL is
			// the Milwaukee Badgers in football and the Brewers in baseball.
			//
			// Keying on the code alone made an `all` scope list 60 clubs instead
			// of 62 — the Twins and Tigers resolved to NFL clubs already seen and
			// were deduplicated away. The dedupe is what hid it; without it they
			// would have been served as the Vikings and the Lions, under
			// baseball URLs, with football data.
			const key = `${t.sport}/${code}`;
			const prior = byCode.get(key);
			// Two clubs claiming one code within a sport is a data error that
			// would otherwise resolve to whichever manifest loaded last.
			if (prior && prior !== t.id) throw new Error(`source code ${code} claimed by both ${prior} and ${t.id}`);
			byCode.set(key, t.id);
		}
	}
	return byCode;
}

/** The clubs a scope covers, each marked with whether this checkout can serve
 *  it.
 *
 *  `available` means a manifest exists AND its artifacts are built. Anything
 *  else is reported, never dropped — the whole reason this returns entries with
 *  `available: false` instead of filtering them out is so a boot log and a
 *  health endpoint can say "sixteen in scope, two built" rather than a site
 *  silently presenting two as the whole league.
 */
export function resolveScope(scope, { divisionsBySport, teams, built = new Set() }) {
	if (scope.kind === 'team') {
		const team = teams.find((t) => t.id === scope.id);
		if (!team) {
			throw new Error(`no manifest for team "${scope.id}"; have ${teams.map((t) => t.id).sort().join(', ')}`);
		}
		return [{ sport: team.sport, code: team.sourceIds[0], teamId: team.id, available: built.has(team.id) }];
	}

	const byCode = codeIndex(teams);
	const seen = new Set();
	const out = [];
	for (const c of codesInScope(scope, divisionsBySport)) {
		const teamId = byCode.get(`${c.sport}/${c.code}`) ?? null;
		// A club with two codes must not appear twice. Only one of the Brewers'
		// codes is current, but the guard is cheap and the alternative is a
		// duplicate in a selector.
		if (teamId && seen.has(teamId)) continue;
		if (teamId) seen.add(teamId);
		out.push({
			sport: c.sport,
			code: c.code,
			conference: c.conference,
			division: c.division,
			teamId,
			available: Boolean(teamId) && built.has(teamId),
		});
	}
	return out;
}

/** Where a club's pages live under this scope.
 *
 *  A single-club scope keeps the root, because these URLs already exist in the
 *  world: arethepackersundefeated.com/records/longest-streak must not become
 *  /nfl/packers/records/longest-streak on the cutover. The scope decides the
 *  prefix; every route below it is identical in all cases.
 */
export function basePath(scope, entry) {
	if (scope.kind === 'team') return '';
	// A club in scope with no manifest still needs a path, or the route it was
	// promised in the selector 404s and the honest 503 explaining what is
	// missing is unreachable. The first draft interpolated a null teamId and
	// produced `/nfl/null` for every unbuilt club — thirty of the sixty-two in
	// an `all` scope, all of them silently.
	const club = entry.teamId ?? slug(entry.code);
	if (scope.kind === 'all') return `/${entry.sport}/${club}`;
	return `/${club}`;
}

/** Whether this scope needs a club selector. One club, no selector. */
export const needsSelector = (resolved) => resolved.length > 1;
