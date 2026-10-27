#!/usr/bin/env node
/** The NCAA tournament's seeds and sites, a game a row, for the bracket page
 *  (lib/bracket.js; Ray, 2026-10-27). Writes data/reference/ncaam-seeds.csv:
 *
 *    season, game, home_seed, away_seed, city
 *
 *  `game` is the game's id as the loader stores it (sports/ncaam.js
 *  cbbdGameRow); the seeds are blank before 1979, when there were none; the
 *  city is where it was played, which names a regional whose games do not say
 *  their region (2003-2020).
 *
 *  From the games CollegeBasketballData gave the last load, kept in
 *  data/sources/cbbd; no call of its own. Run again after a tournament's
 *  field is set (Selection Sunday) and a load has its games:
 *  node scripts/ncaam-seeds.mjs. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'sources', 'cbbd');
if (!existsSync(CACHE)) throw new Error('data/sources/cbbd is empty: run npm run load ncaam first');

const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const rows = [];
for (const f of readdirSync(CACHE).filter((n) => /^games-\d{4}\.json$/.test(n)).sort()) {
	for (const g of JSON.parse(readFileSync(join(CACHE, f), 'utf8'))) {
		if (g.tournament !== 'NCAA' || g.seasonType !== 'postseason' || g.status === 'cancelled' || g.status === 'postponed') continue;
		// The loader's id: ESPN's where the game has one, else the API's own.
		const id = /^\d+$/.test(String(g.sourceId ?? '')) ? String(g.sourceId) : `cbbd-${g.id}`;
		rows.push([g.season, id, g.homeSeed ?? '', g.awaySeed ?? '', g.city ?? '']);
	}
}
rows.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])));
writeFileSync(join(ROOT, 'data', 'reference', 'ncaam-seeds.csv'),
	['season,game,home_seed,away_seed,city', ...rows.map((r) => r.map(csv).join(','))].join('\n') + '\n');
console.log(`${rows.length} games, ${new Set(rows.map((r) => r[0])).size} tournaments`);
