#!/usr/bin/env node
/** Men's college basketball's champions before the games here begin: the
 *  NCAA tournament's, 1939 to 1949 (CollegeBasketballData starts with 1949-50),
 *  from Wikipedia's list of champions (CC BY-SA). Writes
 *  data/reference/ncaam-champions.csv; every later champion is derived from its
 *  final, which the load marks (scripts/load.mjs).
 *
 *    node scripts/ncaam-champions.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'wiki-ncaam');
mkdirSync(CACHE, { recursive: true });
const FIRST_GAMES = 1950;
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

const path = join(CACHE, 'champions.json');
if (!existsSync(path)) {
	const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent('List of NCAA Division I men\'s basketball champions')}`;
	const r = await fetch(url, { headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	writeFileSync(path, await r.text());
}
const text = JSON.parse(readFileSync(path, 'utf8')).parse.wikitext['*'];

// Our clubs by school, and every other team by its name in the games.
const clubBy = new Map(parseCsv(readFileSync(join(REF, 'ncaam-franchise-history.csv'), 'utf8')).map((r) => [r.city, r.franchiseAbbrv]));
const otherBy = existsSync(join(REF, 'ncaam-opponents.csv'))
	? new Map(parseCsv(readFileSync(join(REF, 'ncaam-opponents.csv'), 'utf8')).map((r) => [r.name, r.id])) : new Map();
// The schools by today's names.
const NOW = { 'Oklahoma A&M': 'Oklahoma State', NYU: 'New York University', CCNY: 'City College of New York' };
const codeOf = (school) => clubBy.get(NOW[school] ?? school) ?? otherBy.get(NOW[school] ?? school) ?? null;

const rows = [];
for (const row of text.split(/\n\|-/)) {
	const year = /\[\[(\d{4}) NCAA basketball tournament\|/.exec(row)?.[1];
	if (!year || Number(year) >= FIRST_GAMES) continue;
	// "1938–39 Oregon Webfoots men's basketball team", and some without "men's".
	const teams = [...row.matchAll(/\[\[[^\]|]*basketball team\|([^\]]+)\]\]/g)].map((m) => m[1].trim());
	const score = /\|(\d+)[–-](\d+)\]\]/.exec(row);
	if (teams.length < 2 || !score) continue;
	const [champion, runnerUp] = teams;
	rows.push({ season: Number(year), champion: codeOf(champion), championName: champion, runnerUp: codeOf(runnerUp), runnerUpName: runnerUp, score: `${score[1]}–${score[2]}` });
}
const unplaced = rows.filter((r) => !r.champion);
if (unplaced.length) throw new Error(`no club for ${unplaced.map((r) => `${r.season} ${r.championName}`).join(', ')}`);

writeFileSync(join(REF, 'ncaam-champions.csv'), [
	'# The NCAA tournament\'s champions before CollegeBasketballData\'s games begin',
	'# (1939-1949), from Wikipedia\'s list of champions (CC BY-SA). Made by',
	'# scripts/ncaam-champions.mjs; do not edit. Later champions come from their finals.',
	'season,champion,championName,runnerUp,runnerUpName,score',
	...rows.map((r) => [r.season, r.champion, r.championName, r.runnerUp ?? '', r.runnerUpName, r.score].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} champions, ${rows[0]?.season}-${rows.at(-1)?.season}: ${rows.map((r) => `${r.season} ${r.championName}`).join(', ')}`);
