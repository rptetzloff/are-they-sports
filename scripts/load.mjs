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

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { csvRows, parseCsv } from '../lib/csv.js';
import { codeTable } from '../lib/codes.js';
import { loadHistory, mlbIndex, nflIndex, resolver } from '../lib/names.js';
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
	// Codes come from lib/codes.js, not from the index keys. The index is keyed
	// by teamAbbrv — our own per-era spelling — and a game arrives labelled with
	// whatever nflverse called that club, which for five franchises is a
	// different string. Those five used to be extra ROWS in the history table,
	// so the index happened to carry them; they are a column now.
	const codes = codeTable(sportId, loadHistory(sportId, dir));
	const byCode = new Map();
	const names = new Map();
	for (const c of codes.franchises()) for (const alias of codes.codesOf(c)) byCode.set(alias, c);
	for (const [, spans] of idx) {
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

/* A row may be replaced when the incoming source is at least as authoritative,
   OR when what is there is not final yet — and in that second case only if the
   incoming row FINISHES it, or already belongs to that source.

   The last clause was missing and cost nothing until football gained a live
   feed. nflverse publishes the whole schedule before a season starts, so 272
   games sat there as `scheduled` from an authoritative source; a live refresh
   then overwrote every one of them with an equally scheduled ESPN row, adding
   no information and turning 272 reproducible rows into non-reproducible ones.

   A live capture exists to finish a game before the authoritative source
   publishes the result. Finishing one is worth a write; restating that it has
   not started is not. */
const SQL_UPSERT_GAME = `
INSERT INTO game (sport, id, season, date, round, home, away, home_score, away_score, neutral, status, source, week)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
ON CONFLICT (sport, id) DO UPDATE SET
	season = EXCLUDED.season, date = EXCLUDED.date, round = EXCLUDED.round,
	home = EXCLUDED.home, away = EXCLUDED.away,
	home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
	neutral = EXCLUDED.neutral, status = EXCLUDED.status,
	-- COALESCE, so a source that has no week never erases one that does. The
	-- pre-1999 seed and nflverse overlap in 1999-2020, and the seed would
	-- otherwise null out a real week every time it ran after nflverse.
	week = COALESCE(EXCLUDED.week, game.week),
	source = EXCLUDED.source, observed_at = now()
WHERE (SELECT authority FROM source WHERE id = EXCLUDED.source)
   >= (SELECT authority FROM source WHERE id = game.source)
   OR (game.status <> 'final'
       AND (EXCLUDED.status = 'final' OR game.source = EXCLUDED.source))`;

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
	// An environment variable outranks a declared URL, and for some sources it
	// is the only option: Retrosheet publishes downloads rather than releases,
	// so a baseball deployment hosts its own copy and names it here rather than
	// hardcoding a private address into a public repository.
	const url = (cfg?.env && process.env[cfg.env]) || cfg?.url;
	if (!url || typeof url !== 'string') {
		console.error(`missing ${path}`);
		console.error(cfg?.env
			? `  ${label} has no URL. Set ${cfg.env}, or put the file at ${path} by hand.`
			: `  ${label} has no download URL in sports/${sportId}.js — it has to be put there by hand.`);
		return false;
	}
	mkdirSync(dirname(path), { recursive: true });
	console.log(`  fetching     ${label} ...`);
	try {
		const bytes = await download(url, path);
		console.log(`  fetched      ${label}  ${(bytes / 1048576).toFixed(1)} MB`);
	} catch (e) {
		// Naming the URL matters more than the stack. "TypeError: fetch failed"
		// is what an unreachable host produces, and on its own it does not say
		// which host, which source, or that a URL was involved at all.
		console.error(`could not fetch ${label}`);
		console.error(`  ${url}`);
		console.error(`  ${e.cause?.message ?? e.message}`);
		if (cfg?.env) {
			console.error(`  Set ${cfg.env} to something this machine can reach, or put the`);
			console.error(`  file at ${path} by hand.`);
		}
		// A half-written file would be taken as the real source on the next run.
		rmSync(path, { force: true });
		return false;
	}
	return true;
}

/** Repair rows stored under a code that has since become an alias.
 *
 *  Without this, "re-run the load" does not fix a database loaded against an
 *  older reference table: new games land under OAK while the old ones stay
 *  under LV, and the club serves half its history with no error at all. The
 *  five nflverse codes moved from rows to a column in the history table, so any
 *  database loaded before that has exactly this problem.
 *
 *  Safe to run every time: on an already-correct database it matches nothing.
 *  Exported because the first two attempts at this failed on the server and
 *  passed every local check, both times because nothing here was ever executed
 *  against a database.
 */
export async function repairAliasFranchises(client, sportId, codes) {
	// Which tables point at `franchise`, asked of the catalogue rather than
	// remembered. The first version listed game, franchise_code and
	// franchise_name from memory and missed division_membership, so the delete
	// hit a foreign key and rolled the whole load back. Naming them by hand is
	// how the NEXT table gets missed; an unhandled one now stops the load and
	// says which it is.
	const REMAP = { game: ['home', 'away'] }; // rewritten to point at the canonical id
	const CLEAR = new Set(['franchise_code', 'franchise_name', 'division_membership']); // rebuilt by the load
	const { rows: referencing } = await client.query(
		`SELECT DISTINCT c.conrelid::regclass::text AS table_name
		   FROM pg_constraint c
		  WHERE c.contype = 'f' AND c.confrelid = 'franchise'::regclass`);
	const unhandled = referencing.map((r) => r.table_name).filter((t) => !REMAP[t] && !CLEAR.has(t));
	if (unhandled.length) {
		throw new Error(`franchise is referenced by ${unhandled.join(', ')}, which this repair does not handle`);
	}

	const { rows: dbFranchises } = await client.query(
		'SELECT id FROM franchise WHERE sport = $1', [sportId]);
	const repaired = [];
	for (const { id } of dbFranchises) {
		const canonical = codes.franchiseOf(id);
		if (canonical === id) continue;
		// The canonical franchise must exist before anything can point at it.
		await client.query(
			'INSERT INTO franchise (sport, id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
			[sportId, canonical]);
		for (const [table, cols] of Object.entries(REMAP)) {
			for (const col of cols) {
				const { rowCount } = await client.query(
					`UPDATE ${table} SET ${col} = $1 WHERE sport = $2 AND ${col} = $3`,
					[canonical, sportId, id]);
				if (rowCount) console.log(`  remapped ${rowCount} ${table}.${col} ${id} -> ${canonical}`);
			}
		}
		// Deleted rather than remapped: every one of these is derived data that the
		// load rewrites from the reference table, and remapping would collide with
		// the canonical franchise's own row on the primary key.
		for (const table of CLEAR) {
			await client.query(`DELETE FROM ${table} WHERE sport = $1 AND franchise = $2`, [sportId, id]);
		}
		await client.query('DELETE FROM franchise WHERE sport = $1 AND id = $2', [sportId, id]);
		console.log(`  removed alias franchise ${id} -> ${canonical}`);
		repaired.push({ from: id, to: canonical });
	}
	return repaired;
}

/** Fetch the season being played now from a live feed, and upsert it.
 *
 *  Separate from the main load so it can run often: it touches nine URLs rather
 *  than a 45MB file, and the authoritative source has nothing for the current
 *  season anyway — Retrosheet publishes annually, so on any day between March
 *  and the World Series the club pages would otherwise answer about last year.
 *
 *  Every row is written as the live source, which is authority 10 and not
 *  reproducible. The upsert rule lets it through because the rows do not exist
 *  yet, and replaces it with the authoritative row the next time the annual file
 *  is loaded — the count of non-reproducible rows returns to zero on its own,
 *  which is the property that whole design rests on.
 */
async function loadLive(client, sportId, cfg, season, put) {
	const codes = codeTable(sportId, loadHistory(sportId));
	const sport = (await import(`../sports/${sportId}.js`));
	let seen = 0;
	// A day at a time: the request date IS the game's local date, which is what
	// Retrosheet files it under. Reading the date off the event gives UTC and
	// files every night game a day late.
	for (const day of cfg.daysOf(season)) {
		let events;
		try {
			const res = await fetch(cfg.url(day));
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			events = (await res.json()).events ?? [];
		} catch (e) {
			// One day failing is not a reason to lose the others, and a live feed
			// being briefly unavailable is not a configuration error.
			console.error(`  live         ${day}: ${e.message}`);
			continue;
		}
		for (const { event, number } of sport.numberEvents(events)) {
			const row = sport.liveGameRow(event, {
				eraCodeOf: codes.eraCodeOf, franchiseOf: codes.franchiseOf, knows: codes.knows,
					codeIn: codes.codeIn,
				number, queryDate: day,
			});
			if (!row) continue;
			seen++;
			await put(row);
		}
	}
	return seen;
}

async function main() {
	const sportId = process.argv[2] ?? 'nfl';
	// `--live` fetches only the season being played, from the live feed. Without
	// it the run is the full authoritative load and never touches the feed, so a
	// scheduled live refresh and an annual reload are the same script at very
	// different costs.
	const liveOnly = process.argv.includes('--live');
	const seasonArg = process.argv.slice(3).find((a) => /^[0-9]{4}$/.test(a));
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is required');
		return 2;
	}
	const client = new pg.Client({ connectionString: url });
	try {
		await client.connect();
	} catch (e) {
		// A misconfigured DATABASE_URL is the most likely way this is run wrong,
		// and it used to answer with an uncaught ECONNREFUSED stack that never
		// said what had been dialled. The host and port are echoed; the password
		// is not, which is why this reads them off the parsed URL rather than
		// printing the string.
		let where = 'the configured database';
		try { const u = new URL(url); where = `${u.hostname}:${u.port || 5432}${u.pathname}`; } catch { /* unparseable */ }
		console.error(`cannot reach ${where}`);
		console.error(`  ${e.message}`);
		console.error('  Check DATABASE_URL. This runs where the database is reachable from,');
		console.error('  which for a server-only database is not a laptop.');
		return 2;
	}

	const divisions = parseCsv(readFileSync(join(REFERENCE_DIR, `${sportId}-divisions.csv`), 'utf8'));
	const { byCode, names } = franchiseMap(sportId);

	await client.query('BEGIN');
	await client.query('INSERT INTO sport VALUES ($1,$2) ON CONFLICT DO NOTHING',
		[sportId, sportId === 'nfl' ? 'football' : 'baseball']);

	await repairAliasFranchises(client, sportId, codeTable(sportId, loadHistory(sportId)));

	/** Register a code, inventing a franchise for it if it is unknown. */
	const known = new Set();
	const codesSeen = new Set();
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
		// Once per CODE, not once per call. A code maps to one franchise for the
		// whole run, so every write after the first is identical to it — and this
		// is called twice per game, for the home and away side.
		//
		// Football hid the cost: 18,506 games meant 37,000 redundant round-trips,
		// which is slow and survivable. Baseball is 223,653 games and 447,000 of
		// them, all rewriting the same 134 rows, and the load was still in this
		// loop after three minutes.
		if (!codesSeen.has(code)) {
			codesSeen.add(code);
			// Upsert, not DO NOTHING. The primary key used to include
			// `franchise`, so "LV is LV" and "LV is OAK" were two rows rather
			// than a contradiction, nothing ever conflicted, and a wrong mapping
			// could not be corrected by re-running this. See db/migrations/0003.
			await client.query(
				`INSERT INTO franchise_code (sport, code, franchise) VALUES ($1,$2,$3)
				 ON CONFLICT (sport, code) DO UPDATE SET franchise = EXCLUDED.franchise`,
				[sportId, code, franchise]);
		}
		return franchise;
	};

	let loaded = 0, skipped = 0;
	// Batched, because one awaited INSERT per game is a round-trip per game.
	//
	// Football never made that hurt: 18,506 games is slow-but-fine. Baseball is
	// 223,653, and the load did not finish inside two minutes. The cost is
	// latency, not Postgres — the same rows go in at a fraction of the time when
	// several hundred travel together.
	//
	// 500 at a time: 13 columns means 6,500 parameters, well inside Postgres's
	// 65,535 limit, and small enough that a failure names a manageable slice.
	const BATCH = 500;
	let pending = [];

	const flush = async () => {
		if (!pending.length) return;
		// One row per id. Postgres refuses an ON CONFLICT DO UPDATE whose own
		// VALUES contain the same key twice — "cannot affect row a second time" —
		// and a live feed produces exactly that: ESPN's monthly window spills a
		// day, so `dates=202607` returns through August 1st and `dates=202608`
		// starts there. The boundary games arrive in both requests.
		//
		// Last wins, which is the later fetch and so the fresher score.
		const byId = new Map(pending.map((row) => [`${sportId}/${row.id}`, row]));
		const batch = [...byId.values()];
		const params = [];
		const tuples = batch.map((row) => {
			const at = params.length;
			params.push(sportId, row.id, row.season, row.date, row.round, row.home, row.away,
				row.homeScore, row.awayScore, row.neutral, row.status, row.source,
				// Undefined and null both mean "this source has no week", and the
				// upsert coalesces so a source without one never erases one.
				row.week ?? null);
			return `(${Array.from({ length: 13 }, (_, i) => `$${at + i + 1}`).join(',')})`;
		});
		pending = [];
		const r = await client.query(SQL_UPSERT_GAME.replace('VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
			`VALUES ${tuples.join(',')}`), params);
		loaded += r.rowCount;
	};

	const put = async (row) => {
		const home = await franchiseFor(row.home);
		const away = await franchiseFor(row.away);
		// A game a club played against itself is a data error, and the schema
		// rejects it — but a code collapsing two franchises into one would
		// produce exactly that, so it is counted rather than allowed to abort a
		// whole load.
		if (!home || !away || home === away) { skipped++; return; }
		pending.push({ ...row, home, away });
		if (pending.length >= BATCH) await flush();
	};

	// A live refresh ends here: it reuses `put` and the batch, and touches
	// neither the authoritative files nor the repair and championship passes
	// below, which are about history rather than today.
	if (liveOnly) {
		const sport = (await import(`../sports/${sportId}.js`)).default;
		const cfg = sport.sources.live;
		if (!cfg) {
			console.error(`${sportId} declares no live source`);
			await client.query('ROLLBACK');
			await client.end();
			return 2;
		}
		// The clock is read HERE and nowhere else, because "which season is being
		// played" is the one question that genuinely depends on today.
		const season = seasonArg ? Number(seasonArg) : cfg.seasonOf(new Date());
		const seen = await loadLive(client, sportId, cfg, season, put);
		await flush();
		await client.query('COMMIT');
		console.log(`  live         ${season}: ${seen} games seen, ${loaded} written, ${skipped} skipped`);
		await client.end();
		return 0;
	}

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
				// The only source in the repo that has one.
				week: r.week ? +r.week : null,
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
		let skippedType = 0;
		for await (const r of csvRows(schedPath)) {
			// All-star and exhibition games are not this club playing that club.
			// They were invisible while the only source here was one club's
			// slice, which contains neither; the league-wide file has 2,403
			// exhibitions and 163 all-star games, and the round mapping below
			// would have filed every one of them as a PLAYOFF game — inflating
			// the postseason record of all thirty clubs.
			//
			// All-star games also name sides that are not clubs at all: NLS and
			// ALS are the two league squads, ASE and ASW the East and West.
			//
			// NOT CUW. An earlier version of this comment listed it alongside
			// them, from seeing it in a sample of exhibition rows. CUW is the
			// Cuban Stars (West), a real club, and its 1924 game against the
			// Chicago American Giants is typed `regular` — Retrosheet covers the
			// Negro Leagues, which MLB recognised as major leagues in 2020.
			if (r.gametype === 'allstar' || r.gametype === 'exhibition') { skippedType++; continue; }

			const played = r.vruns !== '' && r.hruns !== '';
			// gametype is a word here rather than a two-letter code, and only the
			// World Series is the championship round: an LCS game must not set it
			// or a pennant becomes a title.
			//
			// `championship` is NOT the title despite the name — it is the 1900
			// Chronicle-Telegraph Cup and its like, played before the World
			// Series existed. Treating it as a title would award nineteenth
			// century pennants alongside modern ones.
			const round = r.gametype === 'worldseries' ? 'championship'
				: r.gametype === 'regular' ? 'regular' : 'playoff';
			await put({
				id: r.gid, season: +r.season, date: isoDate(r.date), round,
				home: r.hometeam, away: r.visteam,
				homeScore: played ? +r.hruns : null, awayScore: played ? +r.vruns : null,
				neutral: false, status: played ? 'final' : 'scheduled', source: 'retrosheet',
			});
		}
		if (skippedType) console.log(`  skipped      ${skippedType} all-star and exhibition games`);
	}

	// Championship games, marked after the fact.
	//
	// Neither football source says which playoff game was the title. nflverse
	// has a game_type of SB from 1999; the FiveThirtyEight file has a 0/1
	// playoff flag and nothing else. But the last playoff game of a league in a
	// season is that league's championship, and that is derivable.
	//
	// Per LEAGUE, not per season, and the difference is not academic: in 1960
	// and 1963 the AFL title game was played after the NFL one, so taking the
	// last game of the season alone would mark the AFL championship and miss the
	// NFL one — including the Bears' 1963 title.
	//
	// A season's final game between clubs of DIFFERENT leagues is the Super
	// Bowl, which is what 1966 through 1969 looked like: an NFL championship, an
	// AFL championship, and then the two winners meeting.

	// Drain the batch FIRST. Everything below reads the games back out of the
	// database, and a buffered row is not there yet — the championship pass
	// would have searched a table missing its last few hundred games, which for
	// football is the most recent seasons and therefore the most recent finals.
	await flush();

	if (sportId === 'nfl') {
		const resolve = resolver('nfl');

		// Reset first, so this is idempotent and so the search sees every
		// postseason game.
		//
		// Without the reset it saw only round='playoff' — and nflverse already
		// marks Super Bowls as championships from 1999, so the real final was
		// invisible and the CONFERENCE championship got promoted in its place.
		// The Packers' 2020 page claimed a title game they lost in January.
		await client.query(
			`UPDATE game SET round = 'playoff', title = NULL WHERE sport = 'nfl' AND round = 'championship'`);

		const { rows: playoffs } = await client.query(
			`SELECT id, season, date, home, away FROM game
			 WHERE sport = 'nfl' AND round = 'playoff' ORDER BY season, date, id`);

		const leagueOf = (franchise, season) => resolve(franchise, { season: String(season) }).league ?? '';
		const finals = new Map();
		for (const g of playoffs) {
			const h = leagueOf(g.home, g.season);
			const a = leagueOf(g.away, g.season);
			// An inter-league final is the Super Bowl and is keyed on its own, so
			// it never displaces either league's championship.
			const key = h === a ? `${g.season}|${h}` : `${g.season}|inter`;
			finals.set(key, g);
		}

		let marked = 0;
		for (const [key, g] of finals) {
			// The name, decided here because here is where the leagues are
			// known. An inter-league final is the Super Bowl; so is every final
			// from 1970, when the leagues merged and there was only one left.
			// Otherwise it is that league's own championship.
			const league = key.split('|')[1];
			const title = league === 'inter' || Number(g.season) >= 1970
				? 'Super Bowl'
				: league === 'American Football League' ? 'AFL Championship'
					: league === 'National Football League' ? 'NFL Championship'
						: null;
			const r = await client.query(
				`UPDATE game SET round = 'championship', title = $2 WHERE sport = 'nfl' AND id = $1`,
				[g.id, title]);
			marked += r.rowCount;
		}
		console.log(`  championships ${marked} title games identified`);
	}

	for (const d of divisions) {
		const f = byCode.get(d.code) ?? d.code;
		await client.query(
			`INSERT INTO division_membership VALUES ($1,$2,$3,$4)
			 ON CONFLICT (sport, franchise) DO UPDATE SET conference = EXCLUDED.conference, division = EXCLUDED.division`,
			[sportId, f, d.conference, d.division]);
	}

	// A no-op when the drain above already ran, and kept deliberately: anything
	// added between here and there that does NOT read games back would otherwise
	// leave the last partial batch unwritten.
	await flush();
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
	// `process.exitCode`, not `process.exit()`. Exiting immediately tears down
	// handles that are still closing, and on Windows a failed fetch then trips
	// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" in libuv and the
	// process returns 127 — so a clean, readable error still ended in a crash
	// dump and the wrong exit code. Reproduced in four lines: download a 403,
	// then call process.exit.
	//
	// Setting the code lets the loop drain and exit on its own. Every path here
	// ends its database client, so there is nothing to keep it alive.
	process.exitCode = await main();
}
