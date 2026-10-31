#!/usr/bin/env node
/** Men's college hockey's champions before the games here begin: the NCAA
 *  tournament's, 1948 to 2003, from Wikipedia's table of them (CC BY-SA). Writes
 *  data/reference/ncaah-champions.csv; every later champion is derived from its
 *  final, which the load marks (scripts/load.mjs), and the table's later rows are
 *  written too, as `checks`, so the load can say where the games and the table
 *  disagree.
 *
 *    node scripts/ncaah-champions.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'wiki-ncaah');
mkdirSync(CACHE, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

const path = join(CACHE, 'NCAA_Division_I_men_s_ice_hockey_tournament.json');
if (!existsSync(path)) {
	const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent('NCAA Division I men\'s ice hockey tournament')}`;
	const r = await fetch(url, { headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	writeFileSync(path, await r.text());
}
const text = JSON.parse(readFileSync(path, 'utf8')).parse.wikitext['*'];
const table = text.slice(text.indexOf('==Results=='), text.indexOf('==Points in a championship game=='));

// Our clubs by school, and every other team by its name in the games.
const clubBy = new Map(parseCsv(readFileSync(join(REF, 'ncaah-franchise-history.csv'), 'utf8')).map((r) => [r.city, r.franchiseAbbrv]));
const otherBy = new Map(parseCsv(readFileSync(join(REF, 'ncaah-opponents.csv'), 'utf8')).map((r) => [r.name, r.id]));
// The schools by today's names, where the table's are not ESPN's.
const NOW = { Massachusetts: 'UMass', 'Minnesota Duluth': 'Minnesota Duluth', 'Massachusetts Lowell': 'UMass Lowell', RPI: 'Rensselaer', Miami: 'Miami (OH)' };
const codeOf = (school) => {
	const name = school.replace(/[–-]/g, ' ');
	return clubBy.get(NOW[name] ?? name) ?? otherBy.get(NOW[name] ?? name) ?? null;
};

const rows = [];
for (const row of table.split(/\n\|-/)) {
	const year = /^\s*\|\s*\[\[(\d{4}) NCAA[^\]|]*\|/i.exec(row)?.[1];
	if (!year) continue;
	const cells = row.split('||').map((c) => c.trim());
	// "[[Michigan Wolverines men's ice hockey|Michigan]] (2)": a school's Nth title.
	const name = (cell) => /\[\[[^\]|]*\|([^\]]+)\]\]/.exec(cell ?? '')?.[1]?.replace(/\s*\(\d+\)\s*$/, '').trim();
	const champion = name(cells[1]);
	const runnerUp = name(cells[3]);
	const score = /(\d+)[–-](\d+)/.exec(cells[5] ?? '');
	if (!champion || !runnerUp || !score) continue;
	rows.push({ season: Number(year), champion: codeOf(champion), championName: champion, runnerUp: codeOf(runnerUp), runnerUpName: runnerUp, score: `${score[1]}–${score[2]}` });
}
const unplaced = rows.filter((r) => !r.champion);
if (unplaced.length) throw new Error(`no club for ${unplaced.map((r) => `${r.season} ${r.championName}`).join(', ')}`);

writeFileSync(join(REF, 'ncaah-champions.csv'), [
	'# The NCAA tournament\'s champions, from Wikipedia\'s table of them (CC BY-SA).',
	'# Made by scripts/ncaah-champions.mjs; do not edit. From 2004, when the games here',
	'# begin, a champion comes from its final and these rows only check it.',
	'season,champion,championName,runnerUp,runnerUpName,score',
	...rows.map((r) => [r.season, r.champion, r.championName, r.runnerUp ?? '', r.runnerUpName, r.score].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} champions, ${rows[0]?.season}-${rows.at(-1)?.season}; no club for ${rows.filter((r) => !r.runnerUp).map((r) => `${r.season} ${r.runnerUpName}`).join(', ') || 'no runner-up'}`);
console.log(rows.map((r) => `${r.season} ${r.championName}`).join(', '));
