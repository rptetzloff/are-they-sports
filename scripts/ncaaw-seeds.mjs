#!/usr/bin/env node
/** The women's tournament's seeds and regions, for the bracket page
 *  (lib/bracket.js). Writes data/reference/ncaaw-seeds.csv:
 *
 *    season, game, home_seed, away_seed, region
 *
 *  a row for each First Four and first-round game, `game` being ESPN's id.
 *
 *  ESPN's files have seeds only from 2024 and CollegeBasketballData has no
 *  women's, so these are Wikipedia's, from each tournament's bracket, and the
 *  regions with them: ESPN's titles name a region in five ways and, from 2017,
 *  mostly not at all. A bracket's first round is its games' scores and each
 *  side's seed. A game is found by its two schools among the season's first-round
 *  games, then by its scores where a school's name is not ESPN's. Not scores
 *  first: 2008's page gives Vanderbilt and Montana the score of another game, so
 *  scores alone took that game. Where the page's score is not ESPN's the games
 *  keep ESPN's, and those are listed.
 *
 *  Nothing is written unless every season holds: 32 first-round games, four
 *  regions, each seed 1 to 16 once in a region and each pairing adding to 17.
 *  From 2024 the seeds are checked against ESPN's own as well.
 *
 *  Pages are kept in data/sources/wiki-ncaaw; the games come from the files the
 *  last load kept. Run again after a tournament: node scripts/ncaaw-seeds.mjs. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvRows } from '../lib/csv.js';
import adapter, { walkRounds } from '../sports/ncaaw.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'sources', 'wiki-ncaaw');
const FILES = join(ROOT, 'data', 'sources', 'ncaaw');
mkdirSync(CACHE, { recursive: true });

const FIRST = 2001;
const LAST = adapter.sources.live.seasonOf(new Date());
const AGENT = 'are-they-sports/1.0 (https://github.com/rptetzloff/are-they-sports)';

/** A tournament's page, as wikitext. */
async function pageOf(season) {
	const path = join(CACHE, `${season}.txt`);
	if (existsSync(path)) return readFileSync(path, 'utf8');
	const title = `${season} NCAA Division I women's basketball tournament`.replace(/ /g, '_');
	const res = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=${encodeURIComponent(title)}`,
		{ headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`${res.status} for ${title}`);
	const text = (await res.json()).parse?.wikitext;
	if (!text) throw new Error(`no page ${title}`);
	writeFileSync(path, text);
	await new Promise((r) => setTimeout(r, 1000));
	return text;
}

/** A cell's text: no bold, links to their shown name, no references. */
const clean = (v) => v
	.replace(/<ref[^>]*>.*?<\/ref>|<ref[^>]*\/>|<!--.*?-->/gs, '')
	.replace(/\{\{cbb link\b[^}]*?\|title=([^|}]*)[^}]*\}\}/gi, '$1')
	.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
	.replace(/<[^>]+>|'''?/g, '')
	.trim();

/** A heading's region: "Mideast", "Albany regional", "Greenville regional 1".
 *  Compass points as they are, as men's; a city's is a regional. */
function regionName(heading) {
	const m = /^(.+?)(?:\s+#(\d))?\s+region(?:al)?\s*(\d)?\b/i.exec(clean(heading));
	if (!m) return null;
	const number = m[2] ?? m[3];
	return /^(Mideast|Midwest|East|West)$/i.test(m[1]) ? m[1] : `${m[1]} regional${number ? ` ${number}` : ''}`;
}

/** A 16-team bracket's seeds, top to bottom, which the template fills in itself
 *  and the pages of 2002 to about 2010 leave to it. */
const LINE = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

/** The first-round games of a bracket template's text: [{ seed, name, score }, ...]
 *  in twos. */
function firstRound(block, size = 2) {
	const cells = new Map();
	for (const m of block.matchAll(/\|\s*RD1-(seed|team|score)0?(\d+)\s*=\s*((?:\[\[.*?\]\]|\{\{.*?\}\}|[^|\n])*)/g)) {
		const [, what, n, value] = m;
		const cell = cells.get(+n) ?? {};
		cell[what] = clean(value);
		cells.set(+n, cell);
	}
	const games = [];
	for (const [n, a] of [...cells].sort((x, y) => x[0] - y[0])) {
		if (n % 2 === 0) continue;
		const b = cells.get(n + 1);
		if (!b) continue;
		const side = (c, at) => ({ seed: parseInt(c.seed, 10) || (size === 16 ? LINE[at - 1] : NaN), name: c.team, score: parseInt(c.score, 10) });
		games.push([side(a, n), side(b, n + 1)]);
	}
	return games;
}

/** Every bracket on a page: { region, size, games }, the region the heading
 *  above it names. */
function bracketsOf(text) {
	const out = [];
	const marks = [...text.matchAll(/^(={2,4})\s*(.*?)\s*\1\s*$|\{\{\s*(\d+)TeamBracket/gm)];
	let region = null;
	marks.forEach((m, i) => {
		// Only a section's heading: a region's own have "Regional Final summary".
		if (m[2] !== undefined) { if (m[1].length <= 3) region = regionName(m[2]); return; }
		const end = marks[i + 1]?.index ?? text.length;
		out.push({ region, size: Number(m[3]), games: firstRound(text.slice(m.index, end), Number(m[3])) });
	});
	return out;
}

/** The season's First Four and first-round games, with ESPN's seeds where it has
 *  them. */
async function gamesOf(season) {
	const games = [];
	const add = async (path, only) => {
		for await (const r of csvRows(path)) {
			if (only && Number(r.season) !== only) continue;
			const row = adapter.espnGameRow(r, { finished: true });
			if (!row || row.round === 'regular' || row.homeScore == null) continue;
			games.push({ ...row, homeName: r.home_location, awayName: r.away_location, homeRank: Number(r.home_current_rank), awayRank: Number(r.away_current_rank) });
		}
	};
	await add(join(FILES, `wbb_schedule_${season}.csv`));
	await add(join(ROOT, 'data', 'reference', 'ncaaw-games-added.csv'), season);
	const { stages } = walkRounds(games);
	return games.map((g) => ({ ...g, stage: stages.get(g.id) ?? g.stage })).filter((g) => g.stage === 'R64' || g.stage === 'FF');
}

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z ]/g, '');
const named = (g, a) => [g.homeName, g.awayName].some((n) => words(n).split(' ')[0] === words(a.name).split(' ')[0]);
const notes = [];

const rows = [];
const problems = [];
let espnChecked = 0;
for (let season = FIRST; season <= LAST; season++) {
	if (season === 2020) continue; // cancelled
	if (!existsSync(join(FILES, `wbb_schedule_${season}.csv`))) continue;
	const games = await gamesOf(season);
	if (!games.length) continue; // not played yet
	const brackets = bracketsOf(await pageOf(season));
	const left = new Set(games);
	const bad = (msg) => problems.push(`${season}: ${msg}`);
	const place = (pair, region) => {
		const [a, b] = pair;
		const fits = [...left].filter((g) => (g.homeScore === a.score && g.awayScore === b.score) || (g.homeScore === b.score && g.awayScore === a.score));
		const both = [...left].filter((x) => named(x, a) && named(x, b));
		const g = both.length === 1 ? both : fits.length ? fits : [...left].filter((x) => named(x, a) || named(x, b));
		if (g.length !== 1) return bad(`${a.seed} ${a.name} ${a.score}, ${b.seed} ${b.name} ${b.score}: ${g.length} games fit`);
		if (!fits.includes(g[0])) notes.push(`${season}: ${a.name} ${a.score}, ${b.name} ${b.score} on the page; ${g[0].homeName} ${g[0].homeScore}, ${g[0].awayName} ${g[0].awayScore} at ESPN`);
		left.delete(g[0]);
		const first = (s) => words(s).split(' ')[0];
		const homeIsA = g[0].homeScore === a.score && g[0].awayScore === b.score ? true
			: g[0].homeScore === b.score && g[0].awayScore === a.score ? false
				: first(g[0].homeName) === first(a.name) || first(g[0].awayName) === first(b.name);
		const [home, away] = homeIsA ? [a, b] : [b, a];
		rows.push([season, g[0].id, home.seed, away.seed, region ?? '']);
		if (season >= 2024 && g[0].stage === 'R64') {
			espnChecked++;
			if (g[0].homeRank !== home.seed || g[0].awayRank !== away.seed) bad(`ESPN seeds ${g[0].homeRank}/${g[0].awayRank}, Wikipedia ${home.seed}/${away.seed}: ${home.name}, ${away.name}`);
		}
	};
	const regions = brackets.filter((b) => b.size === 16);
	if (regions.length !== 4 || new Set(regions.map((r) => r.region)).size !== 4 || regions.some((r) => !r.region)) bad(`regions ${JSON.stringify(regions.map((r) => r.region))}`);
	for (const { region, games: pairs } of regions) {
		const seeds = pairs.flatMap(([a, b]) => [a.seed, b.seed]).sort((x, y) => x - y);
		if (seeds.join() !== Array.from({ length: 16 }, (_, i) => i + 1).join()) bad(`${region} seeds ${seeds}`);
		if (pairs.some(([a, b]) => a.seed + b.seed !== 17)) bad(`${region} pairings`);
		for (const pair of pairs) place(pair, region);
	}
	for (const { games: pairs } of brackets.filter((b) => b.size === 2)) for (const pair of pairs) if (pair[0].score) place(pair, null);
	if (left.size) bad(`not found on the page: ${[...left].map((g) => `${g.stage} ${g.homeName} ${g.homeScore}-${g.awayScore} ${g.awayName}`).join('; ')}`);
}

if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(join(ROOT, 'data', 'reference', 'ncaaw-seeds.csv'),
	['season,game,home_seed,away_seed,region', ...rows.map((r) => r.map(csv).join(','))].join('\n') + '\n');
if (notes.length) console.log(notes.join('\n'));
console.log(`${rows.length} games, ${new Set(rows.map((r) => r[0])).size} tournaments; ${espnChecked} checked against ESPN's seeds`);
