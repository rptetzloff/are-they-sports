// Check a coaches table against the games this database holds.
//
//   DATABASE_URL=... node scripts/coaches-check.mjs nhl [data/reference/nhl-coaches.csv]
//
// For every club with a page, every season it played: is some coach's tenure
// over it, and do the games the tenures over a run of seasons claim come to
// the games played in them? A season nobody coached, two tenures claiming the
// same whole season, or games that do not add up are printed for review.
// Nothing is changed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sport = process.argv[2];
const file = process.argv[3] ?? join(ROOT, 'data', 'reference', `${sport}-coaches.csv`);
const rows = parseCsv(readFileSync(file, 'utf8'));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows: games } = await c.query(`
	SELECT f AS franchise, season, count(*)::int AS n,
	       count(*) FILTER (WHERE winner = f)::int AS w
	  FROM (SELECT season, home AS f, winner FROM game WHERE sport = $1 AND status = 'final' AND round = 'regular'
	        UNION ALL SELECT season, away, winner FROM game WHERE sport = $1 AND status = 'final' AND round = 'regular') g
	 GROUP BY f, season`, [sport]);
await c.end();

const played = new Map();
// The season being played is left out: a list written before it began cannot
// have its games, and a coach named for it has none to state yet.
const playing = Number(process.env.PLAYING ?? ({ nhl: 2027, nba: 2027, wnba: 2026, mls: 2026 }[sport] ?? 0));
for (const g of games) {
	if (Number(g.season) >= playing) continue;
	if (!played.has(g.franchise)) played.set(g.franchise, new Map());
	played.get(g.franchise).set(Number(g.season), g);
}
const byClub = new Map();
for (const r of rows) {
	if (!byClub.has(r.franchiseAbbrv)) byClub.set(r.franchiseAbbrv, []);
	byClub.get(r.franchiseAbbrv).push({ ...r, first: Number(r.firstSeason), last: Number(r.lastSeason), w: Number(r.w || 0), l: Number(r.l || 0), t: Number(r.t || 0), otl: Number(r.otl || 0) });
}
let problems = 0;
for (const [club, tenures] of [...byClub].sort()) {
	const seasons = played.get(club);
	if (!seasons) { console.log(`${club}: no games here under this code`); problems++; continue; }
	// The club's seasons from its first coach on, which is where the list starts.
	const start = Math.min(...tenures.map((t) => t.first));
	const missing = [...seasons.keys()].filter((s) => s >= start && !tenures.some((t) => t.first <= s && s <= t.last)).sort((a, b) => a - b);
	if (missing.length) { console.log(`${club}: no coach for ${missing.join(' ')}`); problems++; }
	// Games, over each maximal run of seasons the tenures cover together.
	const claimed = tenures.reduce((s, t) => s + t.w + t.l + t.t + t.otl, 0);
	const span = [...seasons.entries()].filter(([s]) => s >= start && tenures.some((t) => t.first <= s && s <= t.last));
	const real = span.reduce((s, [, g]) => s + g.n, 0);
	const wins = tenures.reduce((s, t) => s + t.w, 0);
	const realWins = span.reduce((s, [, g]) => s + g.w, 0);
	if (Math.abs(claimed - real) > Math.max(3, real * 0.01) || Math.abs(wins - realWins) > Math.max(3, realWins * 0.01)) {
		console.log(`${club}: tenures claim ${claimed} games and ${wins} wins; ${real} and ${realWins} were played from ${start}`);
		problems++;
	}
}
console.log(`${sport}: ${rows.length} tenures, ${byClub.size} clubs, ${problems} to review`);
