/** Loading clubs, resolved against their sports.
 *
 *  One place, so the server and the tests see the same clubs. They saw
 *  different ones briefly: the server resolved manifests against sport defaults
 *  while the tests still read the raw files, so a test asserting "every manifest
 *  declares every noun" was asserting it of a shape nothing uses.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTeam } from './manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SPORTS = ['nfl', 'mlb'];

export async function loadSports(root = ROOT) {
	const out = {};
	for (const id of SPORTS) out[id] = (await import(pathToFileURL(join(root, 'sports', `${id}.js`)).href)).default;
	return out;
}

/** Every club, resolved and validated.
 *
 *  Resolution throws on a club missing a required noun or rule, which is
 *  deliberate and happens at boot with the field named — rather than the word
 *  "undefined" appearing in a sentence, which is what the football site shipped
 *  and which nothing detects.
 */
export async function loadTeams(root = ROOT) {
	const sports = await loadSports(root);
	const dir = join(root, 'teams');
	const out = [];
	// One directory per sport, because a club id is only unique WITHIN a sport.
	// The Cardinals are an NFL club and a baseball club, so are the Giants, and
	// the sports still to come add Rangers, Kings, Panthers and Jets. A flat
	// directory silently lost the second of each pair: the file already existed,
	// so the club was skipped and nothing said so.
	//
	// Files at the top level are still read, so a checkout mid-move works.
	const seen = new Map();
	for (const f of files(dir)) {
		const team = (await import(pathToFileURL(f).href)).default;
		const sport = sports[team.sport];
		if (!sport) throw new Error(`team "${team.id}" names unknown sport "${team.sport}"`);
		// Unique per sport, checked rather than assumed. Two clubs sharing an id
		// within one sport would resolve to whichever loaded last.
		const key = `${team.sport}/${team.id}`;
		if (seen.has(key)) throw new Error(`two manifests claim ${key}: ${seen.get(key)} and ${f}`);
		seen.set(key, f);
		out.push(resolveTeam(team, sport));
	}
	return out;
}

/** Manifest paths, one level of sport directories deep. */
function files(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			for (const f of readdirSync(full).filter((n) => n.endsWith('.js')).sort()) out.push(join(full, f));
		} else if (entry.name.endsWith('.js')) {
			out.push(full);
		}
	}
	return out;
}

/** One club by id, resolved. For tests and for anything holding an id. */
export async function loadTeam(id, root = ROOT) {
	const team = (await loadTeams(root)).find((t) => t.id === id);
	if (!team) throw new Error(`no team "${id}"`);
	return team;
}
