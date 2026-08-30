/** Loading the curated reference tables.
 *
 *  Split out of names.js so that codes.js and names.js can both read a history
 *  table without importing each other. They genuinely need each other's work —
 *  names resolves a code to a display name and must canonicalise the code
 *  first, while codes builds its table from the same rows — and a cycle between
 *  two modules that only call each other inside functions happens to work in
 *  ESM. "Happens to work" is not a reason; one small module both depend on is.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REFERENCE_DIR = join(ROOT, 'data', 'reference');

/** Load a sport's franchise history. Both sports have one. */
export function loadHistory(sportId, dir = REFERENCE_DIR) {
	return parseCsv(readFileSync(join(dir, `${sportId}-franchise-history.csv`), 'utf8'));
}
