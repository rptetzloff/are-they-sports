/** Reading the committed artifacts back.
 *
 *  The write side is `scripts/build.mjs`; this is the only reader. NDJSON with a
 *  header line, brotli-compressed — see renderNdjson for why one JSON value per
 *  line rather than one document.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX_DIR = join(ROOT, 'data', 'indices');

/** Which clubs this checkout can actually serve.
 *
 *  A directory is not enough — an interrupted build leaves one behind with no
 *  manifest, and the baseball site's worst production incident was a server
 *  that found its indices missing, caught the error, logged "rebuilding from
 *  CSV", and served every route with the box scores silently gone.
 */
export function builtTeams(dir = INDEX_DIR) {
	if (!existsSync(dir)) return new Set();
	return new Set(readdirSync(dir).filter((d) => existsSync(join(dir, d, 'manifest.json'))));
}

export function readManifest(teamId, dir = INDEX_DIR) {
	return JSON.parse(readFileSync(join(dir, teamId, 'manifest.json'), 'utf8'));
}

/** Parse an NDJSON body into its header and entries.
 *
 *  Exported separately from the file reading so it can be tested on a literal.
 */
export function parseNdjson(text) {
	const lines = text.split('\n').filter((l) => l !== '');
	if (!lines.length) throw new Error('empty index');
	const head = JSON.parse(lines[0]);
	const entries = lines.slice(1).map((l) => JSON.parse(l));
	// The header carries the count precisely so a truncated file is detectable.
	// A short read otherwise becomes an index that is quietly incomplete, which
	// is indistinguishable from a club that played fewer games.
	if (head.size !== entries.length) {
		throw new Error(`index declares ${head.size} entries and carries ${entries.length}`);
	}
	return { head, entries };
}

/** Load one index for one club.
 *
 *  Read on demand rather than at boot, and cached per club. Boot-time loading
 *  is what put the baseball server past a 512MB cap: its indices wanted about
 *  600MB resident, having measured 174MB in isolation where nothing else was on
 *  the heap. A scope of one club is nothing; `all` is sixty-two, and the shape
 *  of that number is why this is lazy.
 */
const cache = new Map();

export function loadIndex(teamId, name, dir = INDEX_DIR) {
	const key = `${teamId}/${name}`;
	if (cache.has(key)) return cache.get(key);
	const path = join(dir, teamId, `${name}.ndjson.br`);
	if (!existsSync(path)) throw new Error(`no ${name} index for ${teamId} at ${path}`);
	const { head, entries } = parseNdjson(brotliDecompressSync(readFileSync(path)).toString('utf8'));
	const value = { head, entries };
	cache.set(key, value);
	return value;
}

/** Drop cached indices. For tests, and for a future rebuild-in-place. */
export const clearCache = () => cache.clear();
