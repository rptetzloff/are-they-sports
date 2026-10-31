#!/usr/bin/env node
/** Men's college lacrosse's champions before the games here begin: the NCAA
 *  tournament's, 1971 to 2024, from Wikipedia's table of them (CC BY-SA). Writes
 *  data/reference/ncaal-champions.csv; every later champion is derived from its
 *  final, which the load marks (scripts/load.mjs), and the table's later rows are
 *  written too, as checks, so the load can say where the games and the table
 *  disagree.
 *
 *    node scripts/ncaal-champions.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'wiki-ncaal');
mkdirSync(CACHE, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

const TITLE = 'NCAA Division I men\'s lacrosse tournament';
const path = join(CACHE, `${TITLE.replace(/[^\w]/g, '_')}.json`);
if (!existsSync(path)) {
	const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(TITLE)}`,
		{ headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	if (!r.ok) throw new Error(`${r.status} ${TITLE}`);
	writeFileSync(path, await r.text());
}
const text = JSON.parse(readFileSync(path, 'utf8')).parse.wikitext['*'];

// Our clubs by the name of the school in the table.
const clubBy = new Map(parseCsv(readFileSync(join(REF, 'ncaal-franchise-history.csv'), 'utf8')).map((r) => [r.city, r.franchiseAbbrv]));
const NOW = { Penn: 'Pennsylvania', Loyola: 'Loyola Maryland', 'Loyola (MD)': 'Loyola Maryland' };
const codeOf = (school) => clubBy.get(NOW[school] ?? school) ?? null;

const rows = [];
for (const row of text.slice(text.indexOf('{|')).split(/\n\|-/)) {
	const year = /^\s*\|\s*(\d{4})\b/.exec(row)?.[1];
	if (!year) continue;
	// A side is the school with its record after it: the host's link has none.
	const sides = [...row.matchAll(/\[\[[^\]|]*\|([^\]]+)\]\]\s*\(\d+[–-]\d+\)/g)].map((m) => m[1].trim());
	const score = /^\|(?:[^|\n]*\|)?\s*'*(\d+)[–-](\d+)/m.exec(row);
	if (sides.length !== 2 || !score) continue;
	const [champion, runnerUp] = sides;
	rows.push({ season: Number(year), champion: codeOf(champion), championName: champion, runnerUp: codeOf(runnerUp), runnerUpName: runnerUp, score: `${score[1]}–${score[2]}` });
}
const unplaced = rows.filter((r) => !r.champion);
if (unplaced.length) throw new Error(`no club for ${unplaced.map((r) => `${r.season} ${r.championName}`).join(', ')}`);

writeFileSync(join(REF, 'ncaal-champions.csv'), [
	'# The NCAA tournament\'s champions, from Wikipedia\'s table of them (CC BY-SA).',
	'# Made by scripts/ncaal-champions.mjs; do not edit. From 2025, when the games here',
	'# begin, a champion comes from its final and these rows only check it.',
	'season,champion,championName,runnerUp,runnerUpName,score',
	...rows.map((r) => [r.season, r.champion, r.championName, r.runnerUp ?? '', r.runnerUpName, r.score].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} champions, ${rows[0]?.season}-${rows.at(-1)?.season}; no club for ${rows.filter((r) => !r.runnerUp).map((r) => `${r.season} ${r.runnerUpName}`).join(', ') || 'none'}`);
console.log(rows.map((r) => `${r.season} ${r.championName} ${r.score} ${r.runnerUpName}`).join(', '));
