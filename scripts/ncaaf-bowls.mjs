#!/usr/bin/env node
/** Every bowl an FBS programme has played, named (Ray, 2026-10-26: "bowl games
 *  should be noted in history... and schedules"). Writes
 *  data/reference/ncaaf-bowls.csv: CollegeFootballData's game id, the season,
 *  and the bowl's name.
 *
 *  Three sources, by era, because none names them all:
 *
 *    2013-   CollegeFootballData's own notes on the game ("Rose Bowl Game
 *            Presented by Prudential"), the sponsor dropped.
 *    2002-2012  ESPN's postseason scoreboard, which notes every bowl from the
 *            2002 season; its ids are CollegeFootballData's.
 *    1902-2001  Wikipedia: each season's bowl games page ("1975-76 NCAA football
 *            bowl games") or season page ("1950 college football season"), and
 *            the Rose Bowl's own list for the years before either. A row is a
 *            bowl where it links the game's article ("[[1951 Sugar Bowl|...]]")
 *            and gives two scores; it is matched to the season's postseason
 *            game with the same two scores, the teams' names breaking a tie.
 *            CC BY-SA, credited (lib/credits.js).
 *
 *  Run after the load has kept the seasons (data/sources/cfbd): node
 *  scripts/ncaaf-bowls.mjs. Pages fetched are kept in data/sources/wiki-bowls
 *  and data/sources/espn-bowls; the file is committed and the load reads it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bowlName, bowlRows } from '../lib/bowls.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFBD = join(ROOT, 'data', 'sources', 'cfbd');
const WIKI = join(ROOT, 'data', 'sources', 'wiki-bowls');
const ESPN = join(ROOT, 'data', 'sources', 'espn-bowls');
mkdirSync(WIKI, { recursive: true });
mkdirSync(ESPN, { recursive: true });
const UA = { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

// --- the seasons' postseason games, as the load keeps them ---
const seasonsKept = (first, last) => {
	const out = new Map();
	for (let y = first; y <= last; y++) {
		const path = join(CFBD, `games-${y}.json`);
		if (existsSync(path)) out.set(y, JSON.parse(readFileSync(path, 'utf8')).filter((g) => g.seasonType === 'postseason' && g.completed));
	}
	return out;
};
const clubs = new Set(readFileSync(join(ROOT, 'data', 'reference', 'ncaaf-franchise-history.csv'), 'utf8')
	.split('\n').filter((l) => /^[A-Z]/.test(l) && !l.startsWith('franchiseAbbrv')).map((l) => l.split(',')[3]));
const played = (g) => clubs.has(String(g.homeId)) || clubs.has(String(g.awayId));
const last = 2025;
const postseason = seasonsKept(1869, last);
const named = new Map(); // game id -> { season, bowl, source }

// --- 2013-: CollegeFootballData's notes ---
for (const [season, games] of postseason) {
	if (season < 2013) continue;
	for (const g of games) if (played(g) && g.notes) named.set(String(g.id), { season, bowl: bowlName(g.notes), source: 'cfbd' });
}

// --- 2002-: ESPN's postseason scoreboard, a season at a time ---
// A day at a time from December 1 to January 20: ESPN refuses a range of
// dates, and a year is the calendar year's first 300 games.
async function espnPost(season) {
	const path = join(ESPN, `post-${season}.json`);
	if (!existsSync(path)) {
		const events = [];
		for (const d = new Date(Date.UTC(season, 11, 1)); d <= new Date(Date.UTC(season + 1, 0, 20)); d.setUTCDate(d.getUTCDate() + 1)) {
			const day = d.toISOString().slice(0, 10).replace(/-/g, '');
			const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${day}&groups=80&limit=300`;
			const r = await fetch(url);
			if (!r.ok) throw new Error(`${r.status} ${url}`);
			events.push(...((await r.json()).events ?? []));
			await sleep(150);
		}
		writeFileSync(path, JSON.stringify({ events }));
	}
	return JSON.parse(readFileSync(path, 'utf8')).events ?? [];
}
// And every later season's bowls CollegeFootballData left without a note.
for (let season = 2002; season <= last; season++) {
	const ids = new Set((postseason.get(season) ?? []).filter(played).map((g) => String(g.id)).filter((id) => !named.has(id)));
	if (!ids.size) continue;
	for (const e of await espnPost(season)) {
		const note = (e.competitions?.[0]?.notes ?? []).map((n) => n.headline).find(Boolean);
		if (note && ids.has(String(e.id))) named.set(String(e.id), { season, bowl: bowlName(note), source: 'espn' });
	}
}

// --- 1902-2001: Wikipedia ---
async function wikitext(title) {
	const path = join(WIKI, `${title.replace(/[^\w.-]+/g, '_')}.txt`);
	if (existsSync(path)) return readFileSync(path, 'utf8');
	const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`;
	const r = await fetch(url, { headers: UA });
	const j = await r.json();
	const text = j.parse?.wikitext?.['*'] ?? '';
	writeFileSync(path, text);
	await sleep(300);
	return text;
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const sameTeam = (wiki, cfbd) => { const a = norm(wiki), b = norm(cfbd); return a && b && (a.includes(b) || b.includes(a) || a.slice(0, 5) === b.slice(0, 5)); };

const pagesFor = (y) => [
	`${y}–${String((y + 1) % 100).padStart(2, '0')} NCAA football bowl games`,
	`${y} college football season`,
	`${y} NCAA University Division football season`,
	`${y} NCAA Division I football season`,
	`${y} NCAA Division I-A football season`,
];
const rose = bowlRows(await wikitext('Rose Bowl Game'));
let wikiMatched = 0, wikiRows = 0;
for (let season = 1890; season <= 2001; season++) {
	const games = (postseason.get(season) ?? []).filter(played);
	if (!games.length) continue;
	const rows = [];
	for (const t of pagesFor(season)) rows.push(...bowlRows(await wikitext(t)));
	// The Rose Bowl's own list, for seasons no page covers: a season's game is
	// played on the next New Year's Day, and the link names that year.
	rows.push(...rose.filter((r) => r.year === season + 1));
	const seen = new Set();
	for (const r of rows) {
		const key = `${r.bowl}|${[...r.scores].sort().join('-')}`;
		if (seen.has(key)) continue;
		seen.add(key);
		wikiRows++;
		const pair = [...r.scores].sort((a, b) => a - b).join('-');
		const candidates = games.filter((g) => !named.has(String(g.id)) && [g.homePoints, g.awayPoints].sort((a, b) => a - b).join('-') === pair);
		const pick = candidates.length === 1 ? candidates[0]
			: candidates.find((g) => r.teams.some((t) => sameTeam(t, g.homeTeam)) && r.teams.some((t) => sameTeam(t, g.awayTeam)));
		if (!pick) continue;
		named.set(String(pick.id), { season, bowl: r.bowl.replace(/\s*\((?:January|December)[^)]*\)$/, ''), source: 'wikipedia' });
		wikiMatched++;
	}
}

// --- the file, and how much of each era it names ---
const rows = [...named].map(([id, r]) => ({ id, ...r })).sort((a, b) => a.season - b.season || a.bowl.localeCompare(b.bowl));
writeFileSync(join(ROOT, 'data', 'reference', 'ncaaf-bowls.csv'), [
	'# Every postseason game an FBS programme played that has a bowl\'s name: from',
	'# CollegeFootballData\'s notes (2013 on), ESPN\'s postseason scoreboard',
	'# (2002-2012) and Wikipedia\'s season pages (CC BY-SA; 1902-2001). Made by',
	'# scripts/ncaaf-bowls.mjs; do not edit by hand. id is CollegeFootballData\'s.',
	'id,season,bowl,source',
	...rows.map((r) => [r.id, r.season, r.bowl, r.source].map(csv).join(',')),
].join('\n') + '\n');
const byDecade = {};
for (const [season, games] of postseason) {
	const d = `${Math.floor(season / 10) * 10}s`;
	const g = games.filter(played);
	if (!g.length) continue;
	byDecade[d] ??= [0, 0];
	byDecade[d][0] += g.filter((x) => named.has(String(x.id))).length;
	byDecade[d][1] += g.length;
}
console.log(`${rows.length} bowls named; Wikipedia ${wikiMatched} of ${wikiRows} rows matched`);
console.log(Object.entries(byDecade).map(([d, [n, t]]) => `${d} ${n}/${t}`).join('  '));
