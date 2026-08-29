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
	for (const f of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
		const team = (await import(pathToFileURL(join(dir, f)).href)).default;
		const sport = sports[team.sport];
		if (!sport) throw new Error(`team "${team.id}" names unknown sport "${team.sport}"`);
		out.push(resolveTeam(team, sport));
	}
	return out;
}

/** One club by id, resolved. For tests and for anything holding an id. */
export async function loadTeam(id, root = ROOT) {
	const team = (await loadTeams(root)).find((t) => t.id === id);
	if (!team) throw new Error(`no team "${id}"`);
	return team;
}
