#!/usr/bin/env node
/** Men's college hockey's games: ESPN's scoreboards, a day at a time from 2003-04,
 *  and Wikipedia's bracket of each NCAA tournament (CC BY-SA) for its rounds and
 *  the games ESPN lacks. Writes data/reference/ncaah-games.csv, which the load
 *  reads, so a deployed load makes none of these calls; and ncaah-seeds.csv, each
 *  tournament game's seeds and region.
 *
 *  Adds the seasons the files have not reached, a season's 208 calls each, so a
 *  season's rows are never asked for twice. Every spring by
 *  .github/workflows/seeds.yml, or by hand: node scripts/ncaah-games.mjs. It writes
 *  nothing until the tournament's bracket is whole, and refuses one that is not
 *  fifteen games. With --all it starts again from 2003-04, about 4,800 calls, kept
 *  in data/sources/espn-ncaah/days.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';
import { bracketGames, eventFields, sources } from '../sports/ncaah.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const DAYS = join(ROOT, 'data', 'sources', 'espn-ncaah', 'days');
const WIKI = join(ROOT, 'data', 'sources', 'wiki-ncaah');
mkdirSync(DAYS, { recursive: true });
mkdirSync(WIKI, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const now = new Date();
const playing = sources.live.seasonOf(now);
// The last season to write: this one once its final is well past.
const LAST = now >= Date.UTC(playing, 3, 15) ? playing : playing - 1;
// What the files hold, which a run keeps as it is and goes on from.
const GAMES_FILE = join(REF, 'ncaah-games.csv');
const SEEDS_FILE = join(REF, 'ncaah-seeds.csv');
const ALL = process.argv.includes('--all') || !existsSync(GAMES_FILE);
const keptLines = (path) => (ALL ? [] : readFileSync(path, 'utf8').trimEnd().split('\n').filter((l) => !l.startsWith('#')).slice(1));
const FIRST = ALL ? sources.history.from : Math.max(...parseCsv(readFileSync(GAMES_FILE, 'utf8')).map((r) => Number(r.season))) + 1;
if (FIRST > LAST) {
	console.log(`Nothing new: the files reach ${FIRST - 1}.`);
	process.exit(0);
}

async function day(yyyymmdd) {
	const path = join(DAYS, `${yyyymmdd}.json`);
	if (!existsSync(path)) {
		for (let tries = 0; ; tries++) {
			await wait(250);
			try {
				const res = await fetch(sources.live.url(yyyymmdd), { signal: AbortSignal.timeout(30_000) });
				if (!res.ok) throw new Error(`${res.status} ${yyyymmdd}`);
				writeFileSync(path, await res.text());
				break;
			} catch (e) {
				if (tries >= 3) throw e;
				await wait(5000);
			}
		}
	}
	return JSON.parse(readFileSync(path, 'utf8')).events ?? [];
}

async function wiki(season) {
	const title = `${season} NCAA Division I men's ice hockey tournament`;
	const path = join(WIKI, `${title.replace(/[^\w]/g, '_')}.json`);
	if (!existsSync(path)) {
		const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`,
			{ headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
		if (!r.ok) throw new Error(`${r.status} ${title}`);
		writeFileSync(path, await r.text());
		await wait(800);
	}
	return JSON.parse(readFileSync(path, 'utf8')).parse?.wikitext?.['*'] ?? '';
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** Wikipedia's name for a side, where it is not ESPN's. */
const ALIASES = {
	miami: 'miamioh', nebraskaomaha: 'omaha', massachusetts: 'umass', massachusettslowell: 'umasslowell',
	stcloud: 'stcloudstate', rpi: 'rensselaer', bostonu: 'bostonuniversity', connecticut: 'uconn', longisland: 'longislanduniversity',
};

const games = [];
const kept = new Set();
const nameId = new Map();
for (let season = FIRST; season <= LAST; season++) {
	const first = games.length;
	for (const d of sources.live.daysOf(season)) {
		for (const event of await day(d)) {
			const g = eventFields(event, d);
			// Four of last year's games sit on this year's weekend, under last
			// year's season and with last year's date in their ids.
			if (!g || !g.played || kept.has(g.id) || g.filedSeason < g.season) continue;
			// And one game is here twice, under two ids (RPI at Michigan Tech, 2005).
			const twice = `${g.date} ${g.home} ${g.away} ${g.homeScore} ${g.awayScore}`;
			if (kept.has(twice)) continue;
			kept.add(twice);
			kept.add(g.id);
			nameId.set(norm(g.homeName), g.home);
			nameId.set(norm(g.awayName), g.away);
			games.push({ ...g, stage: null });
		}
	}
	console.log(`${season}: ${games.length - first} games`);
}
const idOf = (name) => {
	const n = norm(name);
	return nameId.get(ALIASES[n] ?? n) ?? nameId.get(n);
};

const pair = (a, b) => [a, b].sort().join('-');
const seeds = [];
let added = 0, differs = 0;
// Every name, for the bracket's sides: the file's for the clubs a new season may
// not mention by the bracket's spelling.
for (const r of ALL ? [] : parseCsv(readFileSync(GAMES_FILE, 'utf8'))) {
	nameId.set(norm(r.home_name), r.home);
	nameId.set(norm(r.away_name), r.away);
}
for (let season = FIRST; season <= LAST; season++) {
	if (season === 2020) continue; // cancelled
	const bracket = bracketGames(await wiki(season));
	// Fifteen, but 2021's thirteen: Michigan and Notre Dame withdrew, unplayed.
	if (bracket.length !== (season === 2021 ? 13 : 15)) throw new Error(`${season}: ${bracket.length} games in the bracket`);
	const inSeason = games.filter((g) => g.season === season).sort((a, b) => a.date.localeCompare(b.date));
	const last = inSeason.at(-1).date;
	// Every tournament game is in the last three weeks.
	const from = new Date(new Date(last).getTime() - 21 * 86_400_000).toISOString().slice(0, 10);
	for (const b of bracket) {
		const a = idOf(b.team1), c = idOf(b.team2);
		if (!a || !c) throw new Error(`${season}: no team for ${b.team1} or ${b.team2}`);
		const lower = Math.min(b.score1, b.score2), upper = Math.max(b.score1, b.score2);
		const same = inSeason.filter((g) => g.date >= from && !g.stage && pair(g.home, g.away) === pair(a, c)).reverse();
		// Two sides can meet twice in those weeks, in a conference final and then
		// here; the tournament's is the later, which is the score to prefer.
		const hit = same.find((g) => Math.min(g.homeScore, g.awayScore) === lower && Math.max(g.homeScore, g.awayScore) === upper) ?? same[0];
		let game = hit;
		if (hit) {
			if (Math.min(hit.homeScore, hit.awayScore) !== lower || Math.max(hit.homeScore, hit.awayScore) !== upper) {
				differs++;
				console.log(`  ${season} ${b.team1} ${b.team2}: Wikipedia ${upper}-${lower}, ESPN ${hit.awayScore}-${hit.homeScore}; ESPN's kept`);
			}
			hit.stage = b.stage;
			hit.neutral = true;
			hit.title = null;
		} else {
			game = {
				id: `wp${season}${String(++added).padStart(3, '0')}`, season, date: null, stage: b.stage, ending: b.ot ? 'OT' : 'REG',
				home: a, homeName: b.team1, homeScore: b.score1, away: c, awayName: b.team2, awayScore: b.score2, neutral: true, played: true, source: 'wikipedia', title: null,
			};
			games.push(game);
			inSeason.push(game);
			console.log(`  ${season} ${b.stage} ${b.team1} ${b.score1}-${b.score2} ${b.team2}: ESPN lacks it`);
		}
		seeds.push([season, game.id, game.home === a ? b.seed1 : b.seed2, game.home === a ? b.seed2 : b.seed1, b.region ?? '']);
	}
	// A game added above is dated the day before its sides' next one, which is
	// how a regional runs.
	for (const g of games.filter((x) => x.season === season && !x.date)) {
		const next = games.filter((x) => x.season === season && x.stage && x.date && x !== g && [g.home, g.away].some((t) => [x.home, x.away].includes(t))).map((x) => x.date).sort()[0];
		if (!next) throw new Error(`${season}: nothing dates ${g.homeName} and ${g.awayName}`);
		g.date = new Date(new Date(next).getTime() - 86_400_000).toISOString().slice(0, 10);
	}
	const reached = games.filter((g) => g.season === season && g.stage).length;
	if (reached !== bracket.length) throw new Error(`${season}: ${reached} of ${bracket.length} bracket games placed`);
}

const COLUMNS = ['id', 'season', 'date', 'stage', 'ending', 'home', 'home_name', 'home_score', 'away', 'away_name', 'away_score', 'neutral', 'source', 'title'];
const rows = games.filter((g) => Number(g.homeScore) || Number(g.awayScore));
const lines = (rows2) => rows2.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
	.map((g) => [g.id, g.season, g.date, g.stage, g.ending, g.home, g.homeName.trim(), g.homeScore, g.away, g.awayName.trim(), g.awayScore, g.neutral, g.source === 'wikipedia' ? 'wikipedia' : 'ncaah-file', g.title].map(csv).join(','));
writeFileSync(GAMES_FILE, [
	'# Men\'s college hockey, every game from 2003-04: ESPN\'s scoreboards, with each',
	'# tournament\'s rounds and the games ESPN lacks from Wikipedia\'s bracket',
	'# (scripts/ncaah-games.mjs; do not edit). Scores are as ESPN gives them.',
	COLUMNS.join(','),
	...keptLines(GAMES_FILE),
	...lines(rows),
].join('\n') + '\n');
writeFileSync(SEEDS_FILE, [
	'# Each NCAA tournament game\'s seeds (1 to 4, in its region) and region, from',
	'# Wikipedia\'s bracket (scripts/ncaah-games.mjs; do not edit).',
	'season,game,home_seed,away_seed,region',
	...keptLines(SEEDS_FILE),
	...seeds.map((r) => r.map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} games, ${games.length - rows.length} blank 0-0s left out; ${seeds.length} tournament games, ${added} added from Wikipedia, ${differs} where the scores differ`);
