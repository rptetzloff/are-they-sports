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
 *  node scripts/ncaam-seeds.mjs.
 *
 *  Or --espn, which needs neither a key nor a load and is how
 *  .github/workflows/seeds.yml does it every spring: the last tournament alone,
 *  from ESPN's scoreboards, every other season's rows left as they are. ESPN's
 *  rank on a tournament game is the seed, and its ids are the loader's. It
 *  refuses a field that is not 67 games or a pairing that does not add to 17:
 *  both tournaments may go to 76 teams in 2027, which the bracket must be
 *  checked against first (lib/bracket.js). */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'sources', 'cbbd');
const OUT = join(ROOT, 'data', 'reference', 'ncaam-seeds.csv');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

/** The last tournament's games, from ESPN: a row each, the season's number
 *  being the year of its March. */
async function fromEspn() {
	const now = new Date();
	const season = now.getUTCFullYear() - (now.getUTCMonth() < 3 ? 1 : 0);
	const out = new Map();
	for (let d = new Date(Date.UTC(season, 2, 10)); d < new Date(Date.UTC(season, 3, 15)) && d < now; d = new Date(d.getTime() + 86_400_000)) {
		const day = d.toISOString().slice(0, 10).replace(/-/g, '');
		const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${day}&groups=100&limit=100`, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) throw new Error(`${res.status} from ESPN for ${day}`);
		for (const e of (await res.json()).events ?? []) {
			const c = e.competitions?.[0];
			if (!/NCAA Men's Basketball Championship/i.test(c?.notes?.[0]?.headline ?? '')) continue;
			const seed = (side) => c.competitors.find((x) => x.homeAway === side)?.curatedRank?.current;
			out.set(String(e.id), { round: c.notes[0].headline, row: [season, String(e.id), seed('home'), seed('away'), c.venue?.address?.city ?? ''] });
		}
	}
	const games = [...out.values()];
	if (games.length !== 67) throw new Error(`${season}: ${games.length} tournament games, not 67: late, or the field has changed`);
	const opening = games.filter((g) => /1st round/i.test(g.round));
	if (opening.length !== 32 || opening.some((g) => g.row[2] + g.row[3] !== 17)) throw new Error(`${season}: the first round is not sixteen pairs adding to 17`);
	if (games.some((g) => !(g.row[2] >= 1 && g.row[2] <= 16 && g.row[3] >= 1 && g.row[3] <= 16))) throw new Error(`${season}: a game with no seed`);
	return { season, rows: games.map((g) => g.row) };
}

if (process.argv.includes('--espn')) {
	const { season, rows } = await fromEspn();
	const [header, ...kept] = readFileSync(OUT, 'utf8').trimEnd().split('\n');
	const rest = kept.filter((l) => !l.startsWith(`${season},`));
	const lines = [...rest, ...rows.sort((a, b) => a[1].localeCompare(b[1])).map((r) => r.map(csv).join(','))]
		.sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)));
	writeFileSync(OUT, [header, ...lines].join('\n') + '\n');
	console.log(`${rows.length} games of ${season}`);
	process.exit(0);
}

if (!existsSync(CACHE)) throw new Error('data/sources/cbbd is empty: run npm run load ncaam first, or use --espn');
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
writeFileSync(OUT,
	['season,game,home_seed,away_seed,city', ...rows.map((r) => r.map(csv).join(','))].join('\n') + '\n');
console.log(`${rows.length} games, ${new Set(rows.map((r) => r[0])).size} tournaments`);
