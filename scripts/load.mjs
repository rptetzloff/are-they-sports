// Load sources into the database.
//
//   DATABASE_URL=postgres://... node scripts/load.mjs nfl
//
// This is the write side of the reversal recorded in db/schema.sql: the database
// is a source of record for what cannot be rebuilt, and everything this script
// loads *can* be. Historical games come from nflverse, FiveThirtyEight and
// Retrosheet, so running it again produces the same rows.
//
// The upsert is where that stays true. A row is only overwritten by a source of
// equal or higher authority, so re-running this after a live ESPN capture
// replaces the capture with the authoritative version, and running it twice in
// a row changes nothing. Authority is a column in `source`, not a branch here.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { csvRows, parseCsv } from '../lib/csv.js';
import { loadHistory, mlbIndex, nflIndex } from '../lib/names.js';
import { download } from './fetch.mjs';
import { isoDate } from '../sports/mlb.js';
import { seedRound } from '../sports/nfl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'data', 'sources');
const REFERENCE_DIR = join(ROOT, 'data', 'reference');

/** Every source code mapped to its canonical franchise, plus the names each
 *  franchise carried and when.
 *
 *  Both sports now come from a real history table — football's is
 *  data/reference/nfl-franchise-history.csv, the file that did not exist until
 *  it did — so the name-grouping heuristic this used to need is gone. It split
 *  a franchise on every rename, which is how SE1 and MIL became two clubs and
 *  the Brewers lost 163 games.
 */
export function franchiseMap(sportId, dir) {
	const idx = sportId === 'nfl'
		? nflIndex(loadHistory('nfl', dir))
		: mlbIndex(loadHistory('mlb', dir));
	const byCode = new Map();
	const names = new Map();
	for (const [code, spans] of idx) {
		byCode.set(code, spans[0].franchise);
		for (const s of spans) {
			// One row per franchise and name, widened to the whole span that
			// name was used. A club that took a name, dropped it and took it
			// back — Buffalo were Bisons, Rangers, then Bisons again — is one
			// row rather than two, which is a small lie about the gap and a
			// large simplification for a label.
			const key = `${s.franchise}|${s.name}`;
			const cur = names.get(key);
			if (!cur) names.set(key, { franchise: s.franchise, name: s.name, from: s.from, to: s.to });
			else {
				if (s.from < cur.from) cur.from = s.from;
				if (s.to > cur.to) cur.to = s.to;
			}
		}
	}
	return { byCode, names: [...names.values()] };
}

const SQL_UPSERT_GAME = `
INSERT INTO game (sport, id, season, date, round, home, away, home_score, away_score, neutral, status, source)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT (sport, id) DO UPDATE SET
	season = EXCLUDED.season, date = EXCLUDED.date, round = EXCLUDED.round,
	home = EXCLUDED.home, away = EXCLUDED.away,
	home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
	neutral = EXCLUDED.neutral, status = EXCLUDED.status,
	source = EXCLUDED.source, observed_at = now()
WHERE (SELECT authority FROM source WHERE id = EXCLUDED.source)
   >= (SELECT authority FROM source WHERE id = game.source)
   OR game.status <> 'final'`;

/** Make sure a source file is present, fetching it if the adapter knows where
 *  it lives.
 *
 *  This exists because the obvious place to run a load is inside the deployed
 *  container, and the container has no sources: `.dockerignore` excludes
 *  data/sources because play-by-play is 95MB a season. But a *game* load does
 *  not need play-by-play — it needs schedules and, for football, the pre-1999
 *  seed. Those are 2.1MB and 1.2MB. So the container can simply fetch them.
 *
 *  What it cannot do is invent a source nobody publishes. Retrosheet has no
 *  fetcher here, so MLB says exactly that instead of failing on an open().
 */
async function ensureSource(sportId, path, cfg, label) {
	if (existsSync(path)) return true;
	if (!cfg?.url || typeof cfg.url !== 'string') {
		console.error(`missing ${path}`);
		console.error(`  ${label} has no download URL in sports/${sportId}.js — it has to be put there by hand.`);
		return false;
	}
	mkdirSync(dirname(path), { recursive: true });
	console.log(`  fetching     ${label} ...`);
	const bytes = await download(cfg.url, path);
	console.log(`  fetched      ${label}  ${(bytes / 1048576).toFixed(1)} MB`);
	return true;
}

async function main() {
	const sportId = process.argv[2] ?? 'nfl';
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is required');
		return 2;
	}
	const client = new pg.Client({ connectionString: url });
	await client.connect();

	const divisions = parseCsv(readFileSync(join(REFERENCE_DIR, `${sportId}-divisions.csv`), 'utf8'));
	const { byCode, names } = franchiseMap(sportId);

	await client.query('BEGIN');
	await client.query('INSERT INTO sport VALUES ($1,$2) ON CONFLICT DO NOTHING',
		[sportId, sportId === 'nfl' ? 'football' : 'baseball']);

	/** Register a code, inventing a franchise for it if it is unknown. */
	const known = new Set();
	const franchiseFor = async (code) => {
		if (!code) return null;
		const franchise = byCode.get(code) ?? code;
		if (!known.has(franchise)) {
			known.add(franchise);
			await client.query('INSERT INTO franchise VALUES ($1,$2) ON CONFLICT DO NOTHING', [sportId, franchise]);
			for (const n of names.filter((x) => x.franchise === franchise)) {
				await client.query(
					'INSERT INTO franchise_name (sport, franchise, name, source) VALUES ($1,$2,$3,$4)',
					[sportId, franchise, n.name, 'manual']);
			}
		}
		await client.query(
			'INSERT INTO franchise_code (sport, code, franchise) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
			[sportId, code, franchise]);
		return franchise;
	};

	let loaded = 0, skipped = 0;
	const put = async (row) => {
		const home = await franchiseFor(row.home);
		const away = await franchiseFor(row.away);
		// A game a club played against itself is a data error, and the schema
		// rejects it — but a code collapsing two franchises into one would
		// produce exactly that, so it is counted rather than allowed to abort a
		// whole load.
		if (!home || !away || home === away) { skipped++; return; }
		const r = await client.query(SQL_UPSERT_GAME,
			[sportId, row.id, row.season, row.date, row.round, home, away,
				row.homeScore, row.awayScore, row.neutral, row.status, row.source]);
		loaded += r.rowCount;
	};

	if (sportId === 'nfl') {
		const seedPath = join(SOURCE_DIR, 'nfl', 'seed-results.csv');
		const schedPath = join(SOURCE_DIR, 'nfl', 'schedules.csv');
		const sport = (await import('../sports/nfl.js')).default;
		if (!await ensureSource('nfl', seedPath, sport.sources.seedResults, 'seed-results.csv')
			|| !await ensureSource('nfl', schedPath, sport.sources.schedules, 'schedules.csv')) {
			await client.query('ROLLBACK');
			await client.end();
			return 1;
		}
		for await (const r of csvRows(seedPath)) {
			if (+r.season >= 1999) continue;
			if (r.score1 === '' || r.score2 === '') continue;
			await put({
				id: `${r.date}-${r.team1}-${r.team2}`, season: +r.season, date: r.date,
				// Shared with the adapter, so the reading of this column lives in one
				// place. See seedRound in sports/nfl.js for why it is not `r.playoff ?`.
				round: seedRound(r),
				home: r.team1, away: r.team2, homeScore: +r.score1, awayScore: +r.score2,
				neutral: r.neutral === '1', status: 'final', source: 'fivethirtyeight',
			});
		}
		for await (const r of csvRows(schedPath)) {
			const played = r.home_score !== '' && r.away_score !== '';
			await put({
				id: r.game_id, season: +r.season, date: r.gameday,
				round: r.game_type === 'SB' ? 'championship' : r.game_type === 'REG' ? 'regular' : 'playoff',
				home: r.home_team, away: r.away_team,
				homeScore: played ? +r.home_score : null, awayScore: played ? +r.away_score : null,
				neutral: false, status: played ? 'final' : 'scheduled', source: 'nflverse',
			});
		}
	}

	if (sportId === 'mlb') {
		const schedPath = join(SOURCE_DIR, 'mlb', 'schedules.csv');
		const sport = (await import('../sports/mlb.js')).default;
		if (!await ensureSource('mlb', schedPath, sport.sources.schedules, 'Retrosheet gameinfo')) {
			await client.query('ROLLBACK');
			await client.end();
			return 1;
		}
		// Retrosheet's gameinfo is one row per game with both clubs, and unlike
		// football there is no second era to splice in — coverage runs the whole
		// length of every franchise.
		for await (const r of csvRows(schedPath)) {
			const played = r.vruns !== '' && r.hruns !== '';
			// gametype is a word here rather than a two-letter code, and only the
			// World Series is the championship round: an LCS game must not set it
			// or a pennant becomes a title.
			const round = r.gametype === 'worldseries' ? 'championship'
				: r.gametype === 'regular' ? 'regular' : 'playoff';
			await put({
				id: r.gid, season: +r.season, date: isoDate(r.date), round,
				home: r.hometeam, away: r.visteam,
				homeScore: played ? +r.hruns : null, awayScore: played ? +r.vruns : null,
				neutral: false, status: played ? 'final' : 'scheduled', source: 'retrosheet',
			});
		}
	}

	for (const d of divisions) {
		const f = byCode.get(d.code) ?? d.code;
		await client.query(
			`INSERT INTO division_membership VALUES ($1,$2,$3,$4)
			 ON CONFLICT (sport, franchise) DO UPDATE SET conference = EXCLUDED.conference, division = EXCLUDED.division`,
			[sportId, f, d.conference, d.division]);
	}

	await client.query('COMMIT');
	console.log(`  loaded       ${loaded} games (${skipped} skipped)`);
	const { rows } = await client.query(
		`SELECT s.id, s.reproducible, count(*)::int n FROM game g JOIN source s ON g.source = s.id
		 WHERE g.sport = $1 GROUP BY s.id, s.reproducible ORDER BY n DESC`, [sportId]);
	for (const r of rows) console.log(`  ${r.id.padEnd(16)} ${String(r.n).padStart(6)}  ${r.reproducible ? 'reproducible' : 'MUST BE BACKED UP'}`);
	await client.end();
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
