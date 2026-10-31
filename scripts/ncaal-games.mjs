#!/usr/bin/env node
/** Men's college lacrosse's games: ESPN's scoreboards, a day at a time from 2025.
 *  Writes data/reference/ncaal-games.csv, which the load reads, so a deployed load
 *  makes none of these calls; and ncaal-seeds.csv, each tournament game's seeds,
 *  from ESPN's tournament seedings.
 *
 *  Adds the seasons the files have not reached, 137 calls each, so a season's rows
 *  are never asked for twice. By hand, or with --all to start again from 2025:
 *  node scripts/ncaal-games.mjs. It writes nothing until the season's tournament is
 *  whole, and refuses one that is not seventeen games. Days are kept in
 *  data/sources/espn-ncaal/days.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';
import { eventFields, sources } from '../sports/ncaal.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'espn-ncaal');
const DAYS = join(CACHE, 'days');
const CORE = 'https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/mens-college-lacrosse';
mkdirSync(DAYS, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const now = new Date();
const playing = sources.live.seasonOf(now);
// The last season to write: this one once its final is well past.
const LAST = now >= Date.UTC(playing, 5, 15) ? playing : playing - 1;
// What the files hold, which a run keeps as it is and goes on from.
const GAMES_FILE = join(REF, 'ncaal-games.csv');
const SEEDS_FILE = join(REF, 'ncaal-seeds.csv');
const ALL = process.argv.includes('--all') || !existsSync(GAMES_FILE);
const keptLines = (path) => (ALL ? [] : readFileSync(path, 'utf8').trimEnd().split('\n').filter((l) => !l.startsWith('#')).slice(1));
const FIRST = ALL ? sources.history.from : Math.max(...parseCsv(readFileSync(GAMES_FILE, 'utf8')).map((r) => Number(r.season))) + 1;
if (FIRST > LAST) {
	console.log(`Nothing new: the files reach ${FIRST - 1}.`);
	process.exit(0);
}

const getJson = async (url) => {
	for (let tries = 0; ; tries++) {
		await wait(250);
		try {
			const res = await fetch(url.replace(/^http:/, 'https:'), { signal: AbortSignal.timeout(30_000) });
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return await res.text();
		} catch (e) {
			if (tries >= 3) throw e;
			await wait(5000);
		}
	}
};
const kept = async (path, url) => {
	if (!existsSync(path)) writeFileSync(path, await getJson(url));
	return JSON.parse(readFileSync(path, 'utf8'));
};

/** A season's seeds, by ESPN's team id: its "tournament" poll, whichever week holds it. */
async function seedsOf(season) {
	const list = await kept(join(CACHE, `rankings-${season}.json`), `${CORE}/seasons/${season}/rankings?limit=100`);
	for (const item of list.items ?? []) {
		const poll = await kept(join(CACHE, `poll-${season}-${/rankings\/(\d+)/.exec(item.$ref)?.[1] ?? 'x'}.json`), item.$ref);
		if (poll.type !== 'tournament') continue;
		// The poll lists its weeks, and only a week holds ranks.
		const week = await kept(join(CACHE, `seeds-${season}.json`), poll.rankings.at(-1).$ref);
		const seeds = new Map();
		for (const r of week.ranks ?? []) seeds.set(/teams\/(\d+)/.exec(r.team?.$ref ?? '')?.[1], r.current);
		return seeds;
	}
	return new Map();
}

const games = [];
const keptIds = new Set();
for (let season = FIRST; season <= LAST; season++) {
	const first = games.length;
	for (const d of sources.live.daysOf(season)) {
		const day = await kept(join(DAYS, `${d}.json`), sources.live.url(d));
		for (const event of day.events ?? []) {
			const g = eventFields(event, d);
			if (!g || !g.played || keptIds.has(g.id)) continue;
			keptIds.add(g.id);
			games.push(g);
		}
	}
	console.log(`${season}: ${games.length - first} games`);
}

const seeds = [];
for (let season = FIRST; season <= LAST; season++) {
	const bracket = games.filter((g) => g.season === season && g.stage);
	const unnamed = bracket.filter((g) => g.stage === 'NCAA');
	if (unnamed.length) throw new Error(`${season}: no round for ${unnamed.map((g) => g.id).join(', ')}`);
	if (bracket.length !== 17) throw new Error(`${season}: ${bracket.length} tournament games`);
	const seeded = await seedsOf(season);
	if (seeded.size !== 8) console.log(`  ${season}: ${seeded.size} seeds from ESPN`);
	for (const g of bracket) seeds.push([season, g.id, seeded.get(g.home) ?? '', seeded.get(g.away) ?? '', '']);
}

const COLUMNS = ['id', 'season', 'date', 'stage', 'ending', 'home', 'home_name', 'home_score', 'away', 'away_name', 'away_score', 'neutral', 'source', 'title'];
const rows = games.filter((g) => Number(g.homeScore) || Number(g.awayScore));
const lines = rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
	.map((g) => [g.id, g.season, g.date, g.stage, g.ending, g.home, g.homeName.trim(), g.homeScore, g.away, g.awayName.trim(), g.awayScore, g.neutral, 'ncaal-file', g.title].map(csv).join(','));
writeFileSync(GAMES_FILE, [
	'# Men\'s college lacrosse, every game from 2025: ESPN\'s scoreboards',
	'# (scripts/ncaal-games.mjs; do not edit). Scores are as ESPN gives them.',
	COLUMNS.join(','),
	...keptLines(GAMES_FILE),
	...lines,
].join('\n') + '\n');
writeFileSync(SEEDS_FILE, [
	'# Each NCAA tournament game\'s seeds, 1 to 8 and blank for the unseeded, from ESPN\'s',
	'# tournament seedings (scripts/ncaal-games.mjs; do not edit).',
	'season,game,home_seed,away_seed,region',
	...keptLines(SEEDS_FILE),
	...seeds.map((r) => r.map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} games, ${games.length - rows.length} with no score left out; ${seeds.length} tournament games`);
