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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { csvRows, parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'data', 'sources');
const REFERENCE_DIR = join(ROOT, 'data', 'reference');

/** Every franchise code seen in the sources, mapped to a canonical franchise.
 *
 *  The canonical id is the code the *current* club uses, which is what the
 *  divisions table lists. Everything else is an alias: SD and LAC are the same
 *  franchise, and so are MIL and SE1.
 */
export function franchiseMap(nameRows, divisionRows) {
	const current = new Set(divisionRows.map((r) => r.code));
	const byName = new Map();
	// Group by display name, which is what ties an alias to its franchise —
	// "Los Angeles Rams" appears under LA, LAR and STL.
	for (const r of nameRows) {
		if (!r.name) continue;
		if (!byName.has(r.name)) byName.set(r.name, []);
		byName.get(r.name).push(r.code);
	}
	const canonical = new Map();
	for (const [name, codes] of byName) {
		// The current code wins as canonical; failing that, the first listed.
		const pick = codes.find((c) => current.has(c)) ?? codes[0];
		for (const c of codes) canonical.set(c, { franchise: pick, name });
	}
	// A code with no name is still a franchise — 62 football codes are defunct
	// clubs nobody has traced. They get themselves as canonical rather than
	// being dropped, because a game that references them still has to load.
	return canonical;
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

async function main() {
	const sportId = process.argv[2] ?? 'nfl';
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is required');
		return 2;
	}
	const client = new pg.Client({ connectionString: url });
	await client.connect();

	const names = parseCsv(readFileSync(join(REFERENCE_DIR, `${sportId}-names.csv`), 'utf8'));
	const divisions = parseCsv(readFileSync(join(REFERENCE_DIR, `${sportId}-divisions.csv`), 'utf8'));
	const canonical = franchiseMap(names, divisions);

	await client.query('BEGIN');
	await client.query('INSERT INTO sport VALUES ($1,$2) ON CONFLICT DO NOTHING',
		[sportId, sportId === 'nfl' ? 'football' : 'baseball']);

	/** Register a code, inventing a franchise for it if it is unknown. */
	const known = new Set();
	const franchiseFor = async (code) => {
		if (!code) return null;
		const entry = canonical.get(code) ?? { franchise: code, name: null };
		if (!known.has(entry.franchise)) {
			known.add(entry.franchise);
			await client.query('INSERT INTO franchise VALUES ($1,$2) ON CONFLICT DO NOTHING', [sportId, entry.franchise]);
			if (entry.name) {
				await client.query(
					`INSERT INTO franchise_name (sport, franchise, name, source) VALUES ($1,$2,$3,$4)`,
					[sportId, entry.franchise, entry.name, 'manual']);
			}
		}
		await client.query(
			'INSERT INTO franchise_code (sport, code, franchise) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
			[sportId, code, entry.franchise]);
		return entry.franchise;
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
		for await (const r of csvRows(join(SOURCE_DIR, 'nfl', 'seed-results.csv'))) {
			if (+r.season >= 1999) continue;
			if (r.score1 === '' || r.score2 === '') continue;
			await put({
				id: `${r.date}-${r.team1}-${r.team2}`, season: +r.season, date: r.date,
				round: r.playoff === 's' ? 'championship' : r.playoff ? 'playoff' : 'regular',
				home: r.team1, away: r.team2, homeScore: +r.score1, awayScore: +r.score2,
				neutral: r.neutral === '1', status: 'final', source: 'fivethirtyeight',
			});
		}
		for await (const r of csvRows(join(SOURCE_DIR, 'nfl', 'schedules.csv'))) {
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

	for (const d of divisions) {
		const f = canonical.get(d.code)?.franchise ?? d.code;
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
