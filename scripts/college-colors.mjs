/**
 * A dark colour for every college club. A page's ground is the darkest colour a
 * club has (lib/palette.js) and its text is white, so a club with only gold, as
 * the basketball and football teams lists have Iowa, is white on gold, and a
 * club with no colours is grey. Those clubs take their colours from Wikipedia's
 * Module:College color/data, cited there school by school; the rest keep theirs.
 *
 * The three reference scripts call darkGround as they write their files, and
 *     node scripts/college-colors.mjs
 * applies it to the files as they stand, which needs no API key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';
import { contrast, luminance } from '../lib/palette.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = join(ROOT, 'data', 'sources', 'wiki-ncaah', 'college-color-data.lua');

if (!existsSync(WIKI)) {
	mkdirSync(dirname(WIKI), { recursive: true });
	const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent('Module:College color/data')}`,
		{ headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	if (!r.ok) throw new Error(`${r.status} Module:College color/data`);
	writeFileSync(WIKI, (await r.json()).parse.wikitext['*']);
}
const lua = readFileSync(WIKI, 'utf8');
const wikiColors = new Map();
const wikiAlias = new Map();
for (const m of lua.matchAll(/\["([^"]+)"\]\s*=\s*\{\s*"([0-9A-Fa-f]{6})"\s*,\s*"([0-9A-Fa-f]{6})"(?:\s*,\s*"([0-9A-Fa-f]{6})")?(?:\s*,\s*"([0-9A-Fa-f]{6})")?/g)) wikiColors.set(m[1], m.slice(2).filter(Boolean));
for (const m of lua.matchAll(/\["([^"]+)"\]\s*=\s*"([^"]+)"/g)) wikiAlias.set(m[1], m[2]);

/** The teams lists' name for a programme, where Wikipedia's is another. */
const WIKI_NAME = {
	'App State Mountaineers': 'Appalachian State Mountaineers',
	'Grambling Tigers': 'Grambling State Tigers', 'Grambling Lady Tigers': 'Grambling State Tigers',
	'Long Island University Sharks': 'LIU Sharks', 'Loyola Maryland Greyhounds': 'Loyola Greyhounds',
	'St. Thomas-Minnesota Tommies': 'St. Thomas (Minnesota) Tommies', 'St. Thomas Tommies': 'St. Thomas (Minnesota) Tommies',
};
/** Tennessee has only orange and white, on Wikipedia too, and orange cannot be
 *  read on the men's list's grey: the site's own charcoal keeps it on all three
 *  pages. */
const CHARCOAL = ['#FF8200', '#2A2A2A'];
const NOT_ON_WIKIPEDIA = { 'Tennessee Volunteers': CHARCOAL, 'Tennessee Lady Volunteers': CHARCOAL };

/** Wikipedia's colours for a programme, its white left out. */
function wikiColor(name) {
	let key = WIKI_NAME[name] ?? name;
	while (wikiAlias.has(key)) key = wikiAlias.get(key);
	return (wikiColors.get(key) ?? []).filter((c) => !/^ffffff$/i.test(c)).map((c) => `#${c.toUpperCase()}`);
}

/** White text and the page's red and green need this much from the ground. */
const GROUND = 3.5;
const dark = (c) => contrast(c, '#FFFFFF') >= GROUND;

/** The grey the teams lists give for a club's white: it would take the accent
 *  from the colour that is the club's. */
const paleGrey = (c) => {
	const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
	return contrast(c, '#FFFFFF') < 1.5 && Math.max(r, g, b) - Math.min(r, g, b) < 24;
};

/** A club's colours with a dark one among them, the club's own first.
 *
 *  The page takes the darkest, so nothing may be darker than the ground meant.
 *  That is the first dark colour in the list: a third colour on Wikipedia is
 *  often only trim, and Stonehill is purple with black behind its letters, not
 *  black. */
export function darkGround(name, colors) {
	if (NOT_ON_WIKIPEDIA[name]) return NOT_ON_WIKIPEDIA[name];
	if (colors.some(dark)) return colors;
	const all = [...new Set([...colors, ...wikiColor(name)])].filter((c) => !paleGrey(c));
	const ground = all.find(dark);
	if (!ground) throw new Error(`no dark colour for ${name}: ${all.join(' ') || 'none'}`);
	return all.filter((c) => luminance(c) >= luminance(ground)).slice(0, 5);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const COLOURS = /(,[^,]*){5}$/;
	for (const sport of ['ncaam', 'ncaaw', 'ncaaf']) {
		const file = join(ROOT, 'data', 'reference', `${sport}-franchise-history.csv`);
		const text = readFileSync(file, 'utf8');
		const rows = parseCsv(text);
		const header = text.split('\n').findIndex((l) => l.startsWith('franchiseAbbrv,'));
		let changed = 0;
		const lines = text.split('\n').map((line, i) => {
			const r = rows[i - header - 1];
			if (i <= header || !r) return line;
			const had = [r.colorA, r.colorB, r.colorC, r.colorD, r.colorE].filter(Boolean);
			const colors = darkGround(`${r.city} ${r.teamName}`, had);
			if (colors.join() === had.join()) return line;
			changed++;
			return line.replace(COLOURS, `,${Array.from({ length: 5 }, (_, n) => colors[n] ?? '').join(',')}`);
		});
		writeFileSync(file, lines.join('\n'));
		console.log(`${sport}: ${changed} of ${rows.length} clubs`);
	}
}
