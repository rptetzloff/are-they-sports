/** CSV reading, in one place.
 *
 *  This was two copies — one in `scripts/build.mjs`, one in
 *  `scripts/franchises.mjs` — which was fine while they were the only readers
 *  and stopped being fine at the third. They had already drifted: the build's
 *  copy named its flag `quoted` and the generator's named it `q`, which is
 *  harmless, and neither skipped comments, which is not.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Split one CSV line, honouring quotes.
 *
 *  Quotes matter more than they look. nflverse play descriptions carry commas
 *  in nearly every row — "A.Rodgers pass short right to D.Adams to GB 42 for 8
 *  yards (J.Smith, T.Jones)" — and a naive split misaligns every column after
 *  `desc`, producing rows that parse cleanly and are wrong.
 */
export function splitCsvLine(line) {
	const out = [];
	let cur = '', quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
			else quoted = !quoted;
		} else if (c === ',' && !quoted) { out.push(cur); cur = ''; }
		else cur += c;
	}
	out.push(cur);
	return out;
}

/** Whether a line carries no data: blank, or a `#` comment.
 *
 *  Comments exist for the curated tier. A generated file can keep its warnings
 *  in the generator, because regenerating is how it changes; a hand-edited file
 *  cannot, because the warning has to be in front of the person editing it.
 *  `data/reference/*-divisions.csv` says at length that it is a snapshot and
 *  not a history, and that text belongs in the file.
 *
 *  The limit of this: a data row whose first field legitimately starts with `#`
 *  would be dropped. No source here has one, and a comment convention that only
 *  applies to leading lines would be a worse trade — it would silently accept a
 *  `#` mid-file as data.
 */
export function isSkippable(line) {
	const t = line.trim();
	return t === '' || t.startsWith('#');
}

/** Parse whole CSV text into row objects. For reference data, which is small
 *  and read once at boot. Sources use the streaming reader below instead. */
export function parseCsv(text) {
	const lines = text.split('\n').filter((l) => !isSkippable(l));
	if (!lines.length) return [];
	const header = splitCsvLine(lines[0].replace(/\r$/, ''));
	return lines.slice(1).map((line) => {
		const v = splitCsvLine(line.replace(/\r$/, ''));
		const o = {};
		for (let i = 0; i < header.length; i++) o[header[i]] = v[i] ?? '';
		return o;
	});
}

/** Stream a CSV as objects, one at a time. Never holds more than a row.
 *
 *  The sources are 95MB and 388MB, so this is not a preference. */
export async function* csvRows(path) {
	const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
	let header = null;
	for await (const line of rl) {
		if (isSkippable(line)) continue;
		const v = splitCsvLine(line);
		if (!header) { header = v; continue; }
		const o = {};
		for (let i = 0; i < header.length; i++) o[header[i]] = v[i] ?? '';
		yield o;
	}
}
