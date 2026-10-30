#!/usr/bin/env node
/** Women's college basketball's champions before the games here begin: the
 *  NCAA tournament's, 1982 to 2000 (ESPN's records start with 2000-01), from
 *  Wikipedia's table of them (CC BY-SA). Writes data/reference/ncaaw-champions.csv;
 *  every later champion is derived from its final, which the load marks
 *  (scripts/load.mjs), and the table's later rows are written too, as `checks`,
 *  so the load can say where the games and the table disagree.
 *
 *  The AIAW's champions of 1972 to 1982 are not here: its tournament was not the
 *  NCAA's, and the schools' NCAA records do not count it.
 *
 *    node scripts/ncaaw-champions.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'wiki-ncaaw');
mkdirSync(CACHE, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

const path = join(CACHE, 'tournament.json');
if (!existsSync(path)) {
	const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent('NCAA Division I women\'s basketball tournament')}`;
	const r = await fetch(url, { headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	writeFileSync(path, await r.text());
}
const text = JSON.parse(readFileSync(path, 'utf8')).parse.wikitext['*'];
const table = text.slice(text.indexOf('==Women\'s NCAA Division I basketball champions=='), text.indexOf('==Team titles=='));

// Our clubs by school, and every other team by its name in the games.
const clubBy = new Map(parseCsv(readFileSync(join(REF, 'ncaaw-franchise-history.csv'), 'utf8')).map((r) => [r.city, r.franchiseAbbrv]));
const otherBy = existsSync(join(REF, 'ncaaw-opponents.csv'))
	? new Map(parseCsv(readFileSync(join(REF, 'ncaaw-opponents.csv'), 'utf8')).map((r) => [r.name, r.id])) : new Map();
// The schools by today's names, where the table's are not ESPN's.
const NOW = { 'Cheyney State': 'Cheyney' };
const codeOf = (school) => clubBy.get(NOW[school] ?? school) ?? otherBy.get(NOW[school] ?? school) ?? null;

const rows = [];
for (const row of table.split(/\n\|-/)) {
	const year = /\[\[(\d{4}) NCAA Division I women's basketball tournament\|/.exec(row)?.[1];
	if (!year) continue;
	// "[[1981–82 Louisiana Tech Lady Techsters basketball team|Louisiana Tech]]",
	// the winner in bold, first; the semifinalists after the score do not count.
	const cells = row.split(/\n\s*\|(?!\|)/).map((c) => c.trim());
	const name = (cell) => /\[\[[^\]|]*\|([^\]]+)\]\]/.exec(cell ?? '')?.[1]?.trim();
	const at = cells.findIndex((c) => /'''/.test(c));
	const champion = name(cells[at]);
	const runnerUp = name(cells[at + 2]);
	const score = /(\d+)[–-](\d+)/.exec(cells[at + 1] ?? '');
	if (!champion || !runnerUp || !score) continue;
	rows.push({ season: Number(year), champion: codeOf(champion), championName: champion, runnerUp: codeOf(runnerUp), runnerUpName: runnerUp, score: `${score[1]}–${score[2]}` });
}
const unplaced = rows.filter((r) => !r.champion);
if (unplaced.length) throw new Error(`no club for ${unplaced.map((r) => `${r.season} ${r.championName}`).join(', ')}`);

writeFileSync(join(REF, 'ncaaw-champions.csv'), [
	'# The NCAA tournament\'s champions, from Wikipedia\'s table of them (CC BY-SA).',
	'# Made by scripts/ncaaw-champions.mjs; do not edit. From 2001, when ESPN\'s games',
	'# begin, a champion comes from its final and these rows only check it.',
	'season,champion,championName,runnerUp,runnerUpName,score',
	...rows.map((r) => [r.season, r.champion, r.championName, r.runnerUp ?? '', r.runnerUpName, r.score].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} champions, ${rows[0]?.season}-${rows.at(-1)?.season}: ${rows.map((r) => `${r.season} ${r.championName}`).join(', ')}`);
