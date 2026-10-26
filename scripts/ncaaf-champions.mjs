#!/usr/bin/env node
/** College football's national champions, as Ray chose them (2026-10-25): the
 *  winner of the game that decided it where there was one, the AP poll's final
 *  No. 1 before that. Writes data/reference/ncaaf-champions.csv.
 *
 *    2014-   the College Football Playoff's final
 *    1998-2013  the BCS's title game
 *    1936-1997  the AP poll's final No. 1 (its first poll was 1936's)
 *
 *  The games come from CollegeFootballData's seasons as the load keeps them
 *  (data/sources/cfbd/games-<year>.json; run `npm run load ncaaf` first), the
 *  polls from its rankings, one call a season, kept beside them. Needs
 *  CFBD_API_KEY for any poll not yet kept.
 *
 *    node scripts/ncaaf-champions.mjs
 *
 *  Run again after a title game; the file is committed and the load reads it. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleOf } from '../sports/ncaaf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'sources', 'cfbd');
const key = process.env.CFBD_API_KEY;
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

async function cached(name, url) {
	const path = join(CACHE, name);
	if (!existsSync(path)) {
		if (!key) throw new Error(`CFBD_API_KEY is needed to fetch ${name}`);
		// Spaced, and a 429 waited out, as the load does.
		let r;
		for (let attempt = 0; attempt < 6; attempt++) {
			await new Promise((ok) => setTimeout(ok, 1200));
			r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
			if (r.status !== 429) break;
			await new Promise((ok) => setTimeout(ok, (Number(r.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000));
		}
		if (!r.ok) throw new Error(`${r.status} ${url}`);
		writeFileSync(path, await r.text());
	}
	return JSON.parse(readFileSync(path, 'utf8'));
}

const rows = [];
const last = Math.max(...(await import('node:fs')).readdirSync(CACHE)
	.map((f) => /^games-(\d{4})\.json$/.exec(f)?.[1]).filter(Boolean).map(Number));

// The AP's final poll, 1936-1997: its postseason poll, else its last of the
// regular season.
for (let season = 1936; season <= 1997; season++) {
	let polls = await cached(`rankings-${season}-postseason.json`, `https://api.collegefootballdata.com/rankings?year=${season}&seasonType=postseason`);
	let ap = polls.flatMap((w) => w.polls).find((p) => p.poll === 'AP Top 25');
	if (!ap) {
		polls = await cached(`rankings-${season}-regular.json`, `https://api.collegefootballdata.com/rankings?year=${season}&seasonType=regular`);
		ap = polls.sort((a, b) => b.week - a.week).flatMap((w) => w.polls).find((p) => p.poll === 'AP Top 25');
	}
	const first = ap?.ranks.find((r) => r.rank === 1);
	if (!first) { console.error(`${season}: no AP No. 1`); continue; }
	rows.push({ season, champion: first.teamId, championName: first.school, method: 'poll', title: 'AP national title', notes: 'AP poll, final No. 1' });
}

// The title games, 1998 on: the game titleOf names, from the season's games.
for (let season = 1998; season <= last; season++) {
	const path = join(CACHE, `games-${season}.json`);
	if (!existsSync(path)) { console.error(`${season}: no games kept; run the load first`); continue; }
	const games = JSON.parse(readFileSync(path, 'utf8'))
		.filter((g) => g.seasonType === 'postseason' && g.completed && titleOf(season, g.notes, g.homeId, g.awayId));
	if (!games.length) continue; // the season being played: decided in January
	if (games.length > 1) throw new Error(`${season}: ${games.length} games read as the title game`);
	const g = games[0];
	const homeWon = g.homePoints > g.awayPoints;
	rows.push({
		season,
		champion: homeWon ? g.homeId : g.awayId, championName: homeWon ? g.homeTeam : g.awayTeam,
		runnerUp: homeWon ? g.awayId : g.homeId, runnerUpName: homeWon ? g.awayTeam : g.homeTeam,
		method: 'championship game', title: titleOf(season, g.notes, g.homeId, g.awayId), gameId: g.id,
		notes: `${g.awayTeam} ${g.awayPoints}, ${g.homeTeam} ${g.homePoints}${g.notes ? `; ${g.notes}` : ''}`,
	});
}

writeFileSync(join(ROOT, 'data', 'reference', 'ncaaf-champions.csv'), [
	'# College football\'s national champions: the College Football Playoff\'s final',
	'# from 2014, the BCS\'s title game 1998-2013, the AP poll\'s final No. 1 1936-1997.',
	'# Teams are ESPN\'s ids, as the games name them. Made by',
	'# scripts/ncaaf-champions.mjs from CollegeFootballData.com; do not edit by hand.',
	'season,champion,championName,runnerUp,runnerUpName,method,title,gameId,notes',
	...rows.map((r) => [r.season, r.champion, r.championName, r.runnerUp, r.runnerUpName, r.method, r.title, r.gameId, r.notes].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} champions, ${rows[0]?.season}-${rows.at(-1)?.season}`);
