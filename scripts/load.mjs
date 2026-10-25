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

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { csvRows, parseCsv, splitCsvLine } from '../lib/csv.js';
import { codeTable } from '../lib/codes.js';
import { creditFillIns, nflLeaderResolver } from '../lib/leaders.js';
import { indexFor, loadHistory, resolver } from '../lib/names.js';
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
	const idx = indexFor(loadHistory(sportId, dir));
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
INSERT INTO game (sport, id, season, date, round, home, away, home_score, away_score, neutral, status, source, week, stage, ending, home_pens, away_pens)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
ON CONFLICT (sport, id) DO UPDATE SET
	season = EXCLUDED.season, date = EXCLUDED.date, round = EXCLUDED.round,
	home = EXCLUDED.home, away = EXCLUDED.away,
	home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
	neutral = EXCLUDED.neutral, status = EXCLUDED.status,
	-- COALESCE, so a source that has no week never erases one that does. The
	-- pre-1999 seed and nflverse overlap in 1999-2020, and the seed would
	-- otherwise null out a real week every time it ran after nflverse.
	week = COALESCE(EXCLUDED.week, game.week),
	stage = COALESCE(EXCLUDED.stage, game.stage),
	ending = COALESCE(EXCLUDED.ending, game.ending),
	home_pens = COALESCE(EXCLUDED.home_pens, game.home_pens),
	away_pens = COALESCE(EXCLUDED.away_pens, game.away_pens),
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
	// Rebuilt by the load, and NAMING THE COLUMNS rather than assuming them.
	//
	// This guard asks the catalogue which tables reference `franchise` rather
	// than trusting a list written from memory, which is what caught
	// `game_leader` and `leader_tenure` when they arrived. But the delete below
	// went on to assume every one of them calls the column `franchise`, and
	// `championship` does not — it has a champion and a runner-up. Adding it to
	// a bare list satisfied the guard and then failed on `column "franchise"
	// does not exist`, which is the guard checking the easier half of the
	// question.
	//
	// A table can point at a franchise through more than one column, so this is
	// a list per table rather than a name per table.
	const CLEAR = new Map([
		['franchise_code', ['franchise']],
		['franchise_name', ['franchise']],
		['division_membership', ['franchise']],
		['game_leader', ['franchise']],
		['leader_tenure', ['franchise']],
		['championship', ['champion', 'runner_up']],
	]);
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
		for (const [table, franchiseCols] of CLEAR) {
			const where = franchiseCols.map((c) => `${c} = $2`).join(' OR ');
			await client.query(`DELETE FROM ${table} WHERE sport = $1 AND (${where})`, [sportId, id]);
		}
		await client.query('DELETE FROM franchise WHERE sport = $1 AND id = $2', [sportId, id]);
		console.log(`  removed alias franchise ${id} -> ${canonical}`);
		repaired.push({ from: id, to: canonical });
	}
	return repaired;
}

/** Number a sport's playoff rounds, R1 to Rn, from how far each series was
 *  from the Final.
 *
 *  A series is a pair of clubs in one postseason: two legs, three games or
 *  one. Every series but the Final has a winner, who goes on to exactly one
 *  next series — the next one either club began after it ended — and a
 *  series is one round further from the Final than that one. The Final is the
 *  championship game's pair. Counting back is what puts a wild card a round
 *  before Round One however their dates fall, and a first-round winner and a
 *  seed with a bye in the same round; counting forward by dates split MLS's
 *  2023 Round One across two rounds.
 *
 *  A season whose Final is not played yet is numbered forward: a new round
 *  when a club already in the current one begins another. The season being
 *  played is the page's to name from ESPN, so this only has to be close.
 *
 *  Writes the stage of the playoff games `where` selects; returns how many. */
export function seriesRounds(games) {
	const series = new Map();
	for (const g of games) {
		const key = `${g.season}|${[g.home, g.away].sort().join('|')}`;
		const x = series.get(key) ?? { season: g.season, clubs: [g.home, g.away].sort(), first: g.date, last: g.date, final: false };
		if (g.date < x.first) x.first = g.date;
		if (g.date > x.last) x.last = g.date;
		if (g.round === 'championship') x.final = true;
		series.set(key, x);
	}
	const bySeason = new Map();
	for (const x of series.values()) bySeason.set(x.season, [...(bySeason.get(x.season) ?? []), x]);
	const out = new Map(); // series key -> round
	for (const list of bySeason.values()) {
		list.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
		const key = (x) => `${x.season}|${x.clubs.join('|')}`;
		if (list.some((x) => x.final)) {
			const distance = new Map();
			const of = (x) => {
				if (distance.has(x)) return distance.get(x);
				let d = 0;
				if (!x.final) {
					const next = list.find((y) => y !== x && y.first > x.last && y.clubs.some((c) => x.clubs.includes(c)));
					d = next ? of(next) + 1 : 0;
				}
				distance.set(x, d);
				return d;
			};
			const most = Math.max(...list.map(of));
			for (const x of list) out.set(key(x), most - of(x) + 1);
		} else {
			let round = 1, inRound = new Set();
			for (const x of list) {
				if (x.clubs.some((c) => inRound.has(c))) { round++; inRound = new Set(); }
				for (const c of x.clubs) inRound.add(c);
				out.set(key(x), round);
			}
		}
	}
	return out;
}

async function numberSeriesRounds(client, sportId, where) {
	const { rows } = await client.query(`
		SELECT season, home, away, date::text AS date, round FROM game
		 WHERE sport = $1 AND round <> 'regular' AND ${where}`, [sportId]);
	let staged = 0;
	for (const [key, round] of seriesRounds(rows)) {
		const [season, a, b] = key.split('|');
		const r = await client.query(
			`UPDATE game SET stage = $5 WHERE sport = $1 AND season = $2 AND round <> 'regular' AND ${where}
			    AND ((home = $3 AND away = $4) OR (home = $4 AND away = $3))`,
			[sportId, Number(season), a, b, `R${round}`]);
		staged += r.rowCount;
	}
	return staged;
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

/** Who won each league, each season.
 *
 *  FOOTBALL ONLY, and that is a scope rather than an oversight. This table
 *  exists because twelve NFL seasons were decided on the final standings and one
 *  by a tie-breaking playoff, so there is no game whose winner is the champion
 *  and no derivation can find one. Baseball has no such gap: every World Series
 *  since 1903 was played, so its champions fall out of `game` already and
 *  storing them here would be a second copy of a fact nothing is missing.
 *
 *  Two kinds of row, and the provenance column says which:
 *
 *    curated   1920-1969, from data/reference/nfl-champions.csv.
 *    derived   1970-, from the championship games the load just marked.
 *
 *  The overlap between them is the whole reason to keep the curated rows that
 *  COULD be derived. The load marks a champion by finding the last playoff game
 *  of a league in a season, and until this file existed that rule had never been
 *  checked against anything. It is checked on every load now, and a disagreement
 *  is reported rather than resolved: the curated file and the games are two
 *  independent sources, and when they differ the answer is that somebody has to
 *  look, not that one of them silently wins.
 */
async function loadChampionships(client, sportId, byCode) {
	// Rewritten every load, so a corrected row in a reference file takes effect by
	// re-running rather than by hand-editing a table.
	await client.query('DELETE FROM championship WHERE sport = $1', [sportId]);

	// Baseball has no curated file and needs none: every World Series was played,
	// so its champions derive from the games. It is still written here rather than
	// left out, because `/champions` reads this table and a sport missing from it
	// is a blank page — the "looks complete, isn't" failure, arriving as an empty
	// table under an MLB scope.
	if (sportId !== 'nfl') {
		// Written as plain CTEs rather than a clever aggregate. The first version
		// used `array_agg` over a lateral join and inserted ONE row for 121
		// seasons of baseball — the kind of wrong that looks like a working query
		// and reports a rowCount to prove it.
		const { rowCount } = await client.query(`
			WITH tally AS (
				SELECT g.season, c.fr AS club,
				       -- A DRAW IS NOT A WIN, and saying so takes the extra
				       -- clause. No backticks in this comment: it lives inside a
				       -- JS template literal, and quoting the expression the way
				       -- prose would ended the string and made the module a
				       -- syntax error -- the hazard lib/style.js already records.
				       --
				       -- The comparison home=club against home_score>away_score
				       -- is false=false for the away side of a tied game, which
				       -- is TRUE, so a draw counted as an away win. The 1912 World
				       -- Series ran to eight games because game two was called
				       -- 6-6 for darkness; Boston won it 4-3 and this made it
				       -- 4-4, so the season came out with no champion at all.
				       --
				       -- The game's winner (0016) settles it now: the higher score,
				       -- else the higher shootout, else nobody.
				       count(*) FILTER (WHERE g.winner = c.fr) AS wins
				  FROM game g
				  CROSS JOIN LATERAL (VALUES (g.home), (g.away)) AS c(fr)
				 WHERE g.sport = $1 AND g.round = 'championship' AND g.status = 'final'
				 GROUP BY g.season, c.fr),
			ranked AS (
				SELECT season, club, wins,
				       row_number() OVER (PARTITION BY season ORDER BY wins DESC, club) AS rn
				  FROM tally),
			clincher AS (
				-- The last game of the round by DATE, not by id: a Retrosheet id
				-- begins with the home club, so ordering by it sorts alphabetically
				-- and picks whichever club happens to be last in the alphabet.
				SELECT DISTINCT ON (season) season, id, source, title
				  FROM game
				 WHERE sport = $1 AND round = 'championship' AND status = 'final'
				 ORDER BY season, date DESC, id DESC)
			INSERT INTO championship (sport, season, league, champion, runner_up, method, title, game_id, source)
			SELECT $1, w.season, upper($1), w.club, l.club, 'championship series', COALESCE(c.title, $2), c.id, c.source
			  FROM ranked w
			  JOIN ranked l ON l.season = w.season AND l.rn = 2
			  JOIN clincher c ON c.season = w.season
			 -- A round nobody won more of than anyone else is not a title. It does
			 -- not happen in the data and inserting a coin-flip champion if it ever
			 -- did would be worse than the row being absent.
			 WHERE w.rn = 1 AND w.wins > l.wins`,
		[sportId, sportId === 'mlb' ? 'World Series' : 'Championship']);
		console.log(`  champions    ${rowCount} derived from games`);
		return;
	}

	const path = join(REFERENCE_DIR, 'nfl-champions.csv');
	if (!existsSync(path)) {
		console.log('  champions    SKIPPED, no data/reference/nfl-champions.csv');
		console.log('               seasons decided on standings will have no champion');
		return;
	}

	const { rows: haveF } = await client.query(
		'SELECT id FROM franchise WHERE sport = $1', [sportId]);
	const known = new Set(haveF.map((r) => r.id));

	// Every championship game already in the database, by season, with its winner.
	const { rows: finals } = await client.query(`
		SELECT id, season, title, home, away, home_score, away_score, source
		  FROM game
		 WHERE sport = $1 AND round = 'championship' AND status = 'final'
		 ORDER BY season, date`, [sportId]);
	const winnerOf = (g) => (g.home_score > g.away_score ? g.home : g.away);
	const bySeason = new Map();
	for (const g of finals) {
		if (!bySeason.has(g.season)) bySeason.set(g.season, []);
		bySeason.get(g.season).push(g);
	}

	/** What a league called its title in a season. Derived rather than stored:
	 *  it is a function of the league and the year, and a column in the CSV could
	 *  disagree with the one the game already carries. */
	const titleFor = (league, season) => (season >= 1970 ? 'Super Bowl' : `${league} Championship`);

	const rows = parseCsv(readFileSync(path, 'utf8'));
	let wrote = 0, unknownClub = [], linked = 0, agreed = 0;
	const disagreed = [];

	for (const r of rows) {
		const season = Number(r.season);
		const champion = byCode.get(r.champion) ?? r.champion;
		const runnerUp = r.runnerUp ? (byCode.get(r.runnerUp) ?? r.runnerUp) : null;
		// A code that names no franchise this database holds cannot be stored --
		// the foreign key would take the whole load down for one row -- so it is
		// counted and named instead.
		if (!known.has(champion) || (runnerUp && !known.has(runnerUp))) {
			unknownClub.push(`${season} ${r.league} ${r.champion}${runnerUp ? `/${r.runnerUp}` : ''}`);
			continue;
		}

		// The game that decided it, matched on the champion rather than on the
		// season alone: 1946 through 1949 and 1960 through 1969 have two finals in
		// the same season, one per league.
		let played = (bySeason.get(season) ?? []).find((g) => winnerOf(g) === champion);

		// 1932 is why there is a fallback. The Bears and the Spartans finished
		// level and played an extra game indoors at Chicago Stadium to break it —
		// the game that led to the championship-game format existing at all. It
		// is in the data as `1932-12-18-CHI-DET`, Bears 9 Spartans 0, and its
		// round is `regular`, because at the time it COUNTED IN THE STANDINGS.
		//
		// Its round is not rewritten. The game was what it was, and marking it a
		// championship to make a join work would be editing history to suit the
		// schema. It is linked instead, on the pair of clubs the curated file
		// names, which is why `method` records that this one was a playoff game
		// rather than a scheduled final.
		if (!played && runnerUp && r.method !== 'standings') {
			const { rows: extra } = await client.query(`
				SELECT id FROM game
				 WHERE sport = $1 AND season = $2 AND status = 'final'
				   AND ((home = $3 AND away = $4) OR (home = $4 AND away = $3))
				   AND ((home = $3 AND home_score > away_score) OR (away = $3 AND away_score > home_score))
				 ORDER BY date DESC LIMIT 1`, [sportId, season, champion, runnerUp]);
			if (extra[0]) played = { id: extra[0].id };
		}

		if (r.method !== 'standings') {
			if (played) { linked++; agreed++; } else {
				disagreed.push(`${season} ${r.league}: ${r.championName} (${champion}) won no game against ${r.runnerUpName || 'anyone'} on record`);
			}
		}

		await client.query(
			`INSERT INTO championship (sport, season, league, champion, runner_up, method, title, game_id, source)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'wikipedia')`,
			[sportId, season, r.league, champion, runnerUp, r.method,
				titleFor(r.league, season), r.method === 'standings' ? null : played?.id ?? null]);
		wrote++;
	}

	// A championship game the curated file does not cover. Keyed by season AND
	// league, not by season alone.
	//
	// Season alone loses Super Bowls I through IV. The 1966 to 1969 seasons each
	// have a curated NFL champion and a curated AFL champion, and THEN the two
	// winners met — so skipping any season the file mentions dropped the four
	// games the whole era is remembered for. Green Bay's 1966 read "NFL
	// Championship" with no Super Bowl beside it.
	const curated = new Set(rows.map((r) => `${r.season}|${r.league}`));

	/** Which league awarded a title, from the name the load already gave it.
	 *
	 *  The pre-merger Super Bowl was the AFL-NFL World Championship Game and
	 *  belonged to neither league, which is exactly why it needs a key of its
	 *  own rather than displacing one of them. */
	const leagueOfGame = (g) => {
		if (g.title === 'Super Bowl') return g.season < 1970 ? 'AFL-NFL' : 'NFL';
		if (g.title === 'AFL Championship') return 'AFL';
		return 'NFL';
	};

	let derived = 0;
	for (const g of finals) {
		const league = leagueOfGame(g);
		if (curated.has(`${g.season}|${league}`)) continue;
		const champion = winnerOf(g);
		const runnerUp = champion === g.home ? g.away : g.home;
		if (!known.has(champion) || !known.has(runnerUp)) continue;
		const { rowCount } = await client.query(
			`INSERT INTO championship (sport, season, league, champion, runner_up, method, title, game_id, source)
			 VALUES ($1,$2,$3,$4,$5,'championship game',$6,$7,$8)
			 ON CONFLICT (sport, season, league) DO NOTHING`,
			[sportId, g.season, league, champion, runnerUp,
				g.title ?? titleFor(league, g.season), g.id, g.source]);
		derived += rowCount;
	}

	// The AAFC finals carry no title, because the load names NFL, AFL and Super
	// Bowl games from the leagues it can see and has never known what the AAFC
	// called its own. The curated file does.
	const { rowCount: named } = await client.query(`
		UPDATE game g SET title = c.title
		  FROM championship c
		 WHERE c.sport = g.sport AND c.game_id = g.id AND g.title IS DISTINCT FROM c.title`);

	console.log(`  champions    ${wrote} curated, ${derived} derived from games`);
	if (linked) console.log(`  agreed       ${agreed} curated champions match the game the load marked`);
	if (named) console.log(`  named        ${named} championship games took their title from the table`);
	if (unknownClub.length) {
		console.log(`  unknown club ${unknownClub.length} rows name a franchise with no games:`);
		for (const u of unknownClub.slice(0, 8)) console.log(`               ${u}`);
	}
	if (disagreed.length) {
		// Reported, never resolved. Two independent sources disagreeing is a thing
		// for a person to look at; picking one here would hide it.
		console.log(`  DISAGREEMENT ${disagreed.length} curated champions the games do not confirm:`);
		for (const d of disagreed) console.log(`               ${d}`);
	}
}

/** A directory holding Retrosheet game logs, fetching them first if needed.
 *
 *  Returns null when there are none to be had, because a missing optional
 *  source is a gap the load reports rather than a reason to fail: every other
 *  MLB page depends on this load succeeding and none of them needs a manager.
 *
 *  THE URL FORM IS NOT A CONVENIENCE. A container cannot reach a local
 *  directory, and on a deployment whose database is not reachable from outside,
 *  a load run from the machine that HAS the files cannot reach the database.
 *  Neither side can do the job alone, which is a deadlock rather than an
 *  inconvenience -- so the logs have to be fetchable to be usable at all.
 *
 *  Either variable may hold either thing. `MLB_GAMELOGS_DIR` pointed at a URL
 *  is what a person naturally tries first, and it used to fail `existsSync` and
 *  report "no game logs at http://..." -- technically true, unhelpful, and
 *  indistinguishable from the variable being unset. A value that parses as
 *  http(s) is a base URL wherever it was written.
 */
async function gameLogDir(client, sportId, sport) {
	const cfg = sport.sources.gameLogs;
	const isUrl = (v) => Boolean(v) && /^https?:\/\//i.test(v);
	const configured = process.env[cfg.urlEnv] ?? process.env[cfg.env];
	const base = isUrl(configured) ? configured.replace(/\/+$/, '') : null;

	if (!base) {
		const local = configured ?? join(SOURCE_DIR, 'sportsdata', 'mlb', 'alldata', 'gamelogs');
		return existsSync(local) ? local : null;
	}

	// Only the seasons this database actually holds. Retrosheet publishes logs
	// from 1871 and `gameinfo.csv` starts in 1897, so asking for the whole range
	// would be 26 requests for games that cannot be attributed to anything -- and
	// the season being played has no log published yet, which is a 404 meaning
	// "not yet" rather than "misconfigured".
	const { rows } = await client.query(
		'SELECT min(season)::int lo, max(season)::int hi FROM game WHERE sport = $1', [sportId]);
	const { lo, hi } = rows[0] ?? {};
	if (lo == null) return null;

	const names = sport.gameLogNames(lo, hi);

	const dest = join(SOURCE_DIR, 'mlb', 'gamelogs');
	mkdirSync(dest, { recursive: true });

	let fetched = 0, cached = 0, missing = 0;
	let firstError = null;
	for (const name of names) {
		const path = join(dest, name);
		// Already here from a previous run. Deleting data/sources costs a
		// download and never correctness, which is the rule fetch.mjs states.
		if (existsSync(path)) { cached++; continue; }
		try {
			await download(`${base}/${name}`, path);
			fetched++;
		} catch (e) {
			// A 404 is ordinary: not every season in the database has a log, and
			// the current one never does until Retrosheet publishes. Anything else
			// is worth naming once -- a bad host, or a 403 from an unsigned request
			// against a private bucket, would otherwise read as 160 seasons that
			// happen not to exist.
			missing++;
			if (!firstError) firstError = `${name}: ${e.message}`;
			rmSync(path, { force: true });
		}
	}
	console.log(`  game logs    ${fetched} fetched, ${cached} already present, ${missing} unavailable`);
	if (missing && !fetched && !cached) {
		console.log(`  FETCH FAILED every request failed. First: ${firstError}`);
		console.log('               If the bucket is private, set S3_ACCESS_KEY_ID and');
		console.log('               S3_SECRET_ACCESS_KEY -- an unsigned GET returns 403.');
		return null;
	}
	if (firstError) console.log(`  note         first unavailable was ${firstError}`);
	return dest;
}

/** Load who led each side of each game, and the tenures no source counts.
 *
 *  Runs AFTER games are flushed, and that ordering is load-bearing rather than
 *  tidy: `game_leader` has a foreign key onto `game`, so a buffered row is not
 *  there yet and every insert would fail. The championship pass above learned
 *  the same lesson the same way.
 *
 *  Every leader row is keyed to a game id that came out of the same source file
 *  the game did — nflverse's `game_id`, Retrosheet's home+date+number — so this
 *  is a lookup and never a join on date and club. Doubleheaders are the reason:
 *  34,185 baseball dates carry two games, and matching on the date alone has to
 *  guess for all of them.
 *
 *  Games the database does not have are counted and reported, never inserted
 *  silently and never allowed to abort the load. For baseball that count is
 *  real and expected — the Negro Leagues are in `gameinfo.csv` but published as
 *  .EBR event files rather than game logs, so about 8,220 games have no manager
 *  row and no page is wrong because none of those clubs is in any scope.
 */
async function loadLeaders(client, sportId, sport, { byCode }) {
	if (!sport.leaderRows) {
		// No game names its coach in this sport's sources; the curated table
		// (data/reference/<sport>-coaches.csv) is the whole of it.
		const { rows } = await client.query('SELECT id FROM franchise WHERE sport = $1', [sportId]);
		if (loadCoachesFile(sportId).length) return loadTenures(client, sportId, new Set(rows.map((r) => r.id)));
		console.log(`  leaders      none: sports/${sportId}.js has no leaders source yet`);
		return;
	}
	const { rows: existing } = await client.query('SELECT id FROM game WHERE sport = $1', [sportId]);
	const haveGame = new Set(existing.map((r) => r.id));

	const leaders = new Map();   // id -> name
	const attributions = [];     // { gameId, franchise, leaderId }
	let noGame = 0, noFranchise = 0, unresolved = new Map();

	if (sportId === 'nfl') {
		// The curated table is consulted for identity only. It exists because
		// nflverse's `Jim Mora` is two people; see lib/leaders.js.
		const reference = loadNflCoaches();
		const resolve = nflLeaderResolver(reference);
		for await (const r of csvRows(join(SOURCE_DIR, 'nfl', 'schedules.csv'))) {
			for (const row of sport.leaderRows(r)) {
				const franchise = byCode.get(row.code) ?? row.code;
				const id = resolve(row.leaderName, franchise, row.season);
				if (!id) { unresolved.set(row.leaderName, (unresolved.get(row.leaderName) ?? 0) + 1); continue; }
				leaders.set(id, row.leaderName);
				if (!haveGame.has(row.gameId)) { noGame++; continue; }
				attributions.push({ gameId: row.gameId, franchise, leaderId: id });
			}
		}
	} else {
		const cfg = sport.sources.gameLogs;
		const dir = await gameLogDir(client, sportId, sport);
		if (!dir) {
			// A gap, not a configuration error: the rest of the load is valid and
			// the leaders page reports itself unavailable. Exiting here would
			// make a missing optional source fatal to every other page.
			console.log(`  leaders      SKIPPED, no game logs`);
			console.log(`               set ${cfg.env} to a directory, or ${cfg.urlEnv} to a base URL`);
			return;
		}
		const files = readdirSync(dir).filter((f) => /^gl.*\.txt$/i.test(f)).sort();
		for (const f of files) {
			for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
				if (!line.trim()) continue;
				for (const row of sport.leaderRows(splitCsvLine(line.trim()))) {
					const franchise = byCode.get(row.code) ?? row.code;
					if (!franchise) { noFranchise++; continue; }
					leaders.set(row.leaderId, row.leaderName);
					if (!haveGame.has(row.gameId)) { noGame++; continue; }
					attributions.push({ gameId: row.gameId, franchise, leaderId: row.leaderId });
				}
			}
		}
		console.log(`  game logs    ${files.length} files`);
	}

	// Who HELD the job, which is not who ran every game. A source that names the
	// manager of record names the bench coach who took over on an ejection, and
	// crediting him takes those games off the man whose tenure it was. See
	// db/migrations/0008 and lib/leaders.js.
	//
	// Ordered by club and then date, because the fold reads runs of consecutive
	// games and an unordered pass would find runs that never happened. The
	// attributions are already in file order, which for baseball is one game log
	// per season and for football is the schedule — neither is club-major, so
	// this sorts rather than assuming.
	const whenOf = new Map(
		(await client.query('SELECT id, date, season FROM game WHERE sport = $1', [sportId]))
			.rows.map((r) => [r.id, r]));
	const ordered = [...attributions]
		.map((a) => {
			const g = whenOf.get(a.gameId);
			return { ...a, leader: a.leaderId, date: g?.date, season: g?.season };
		})
		.sort((x, y) => (x.franchise < y.franchise ? -1 : x.franchise > y.franchise ? 1
			: (x.date - y.date) || (x.gameId < y.gameId ? -1 : 1)));
	const held = creditFillIns(ordered, sport.defaults.rules.fillInMaxGames);

	let foldedGames = 0;
	const standIns = new Set();
	for (const a of attributions) {
		const credit = held.get(`${a.franchise}|${a.gameId}`);
		if (credit && credit !== a.leaderId) {
			a.ran = a.leaderId;
			a.leaderId = credit;
			foldedGames++;
			standIns.add(a.ran);
		}
	}

	const sourceId = sportId === 'nfl' ? 'nflverse' : 'retrosheet';
	for (const [id, name] of leaders) {
		await client.query(
			`INSERT INTO leader (sport, id, name, source) VALUES ($1,$2,$3,$4)
			 ON CONFLICT (sport, id) DO UPDATE SET name = EXCLUDED.name`,
			[sportId, id, name, sourceId]);
	}

	// A franchise the games never produced has no row to point at, and the
	// foreign key would take the whole load down for one of them. Registering
	// them here would invent clubs from a coaching table, which is backwards.
	const { rows: haveFranchise } = await client.query(
		'SELECT id FROM franchise WHERE sport = $1', [sportId]);
	const known = new Set(haveFranchise.map((r) => r.id));

	let wrote = 0, orphanFranchise = 0;
	const BATCH = 500;
	for (let i = 0; i < attributions.length; i += BATCH) {
		const slice = attributions.slice(i, i + BATCH).filter((a) => {
			if (known.has(a.franchise)) return true;
			orphanFranchise++;
			return false;
		});
		if (!slice.length) continue;
		// One row per (game, franchise). A club appears once per game, but the
		// three postseason log files overlap the season files for a handful of
		// games, so the same attribution can arrive twice in one batch — which
		// Postgres refuses inside a single ON CONFLICT DO UPDATE.
		const byKey = new Map(slice.map((a) => [`${a.gameId}/${a.franchise}`, a]));
		const batch = [...byKey.values()];
		const params = [];
		const tuples = batch.map((a) => {
			const at = params.length;
			params.push(sportId, a.gameId, a.franchise, a.leaderId, a.ran ?? null, sourceId);
			return `($${at + 1},$${at + 2},$${at + 3},$${at + 4},$${at + 5},$${at + 6})`;
		});
		const r = await client.query(
			`INSERT INTO game_leader (sport, game_id, franchise, leader, ran, source)
			 VALUES ${tuples.join(',')}
			 ON CONFLICT (sport, game_id, franchise)
			 DO UPDATE SET leader = EXCLUDED.leader, ran = EXCLUDED.ran, source = EXCLUDED.source`,
			params);
		wrote += r.rowCount;
	}

	console.log(`  leaders      ${leaders.size} people, ${wrote} game attributions`);
	// Reported, because it is the difference between this page and a published
	// coaching record and somebody will check one against the other.
	if (foldedGames) {
		console.log(`  stand-ins    ${foldedGames} games credited to the leader of record,`
			+ ` covered by ${standIns.size} people (ejections, illness, suspensions)`);
	} else {
		console.log('  stand-ins    none — this source names the leader of record for every game');
	}
	if (noGame) console.log(`  unmatched    ${noGame} source rows name a game this database does not have`);
	if (orphanFranchise) console.log(`  unknown club ${orphanFranchise} attributions name a franchise with no games`);
	if (noFranchise) console.log(`  no franchise ${noFranchise} rows carry a code that resolves to nothing`);
	if (unresolved.size) {
		// Reported by name and count, because the fix is a row in the curated
		// file and the person writing it needs to know who.
		console.log(`  UNRESOLVED   ${unresolved.size} coach names the curated table contradicts:`);
		for (const [n, c] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
			console.log(`               ${n} (${c} rows)`);
		}
	}

	if (sportId === 'nfl') await loadNflTenures(client, known);

	// People nothing points at any more.
	//
	// `game_leader` is rewritten by every load and `leader` was not, so the
	// identity table only ever grew. That is not hypothetical tidiness: reading
	// Retrosheet's manager fields at the wrong offsets once put 1,488 UMPIRES in
	// here, and correcting the offsets left every one of them behind. They were
	// invisible — the leaders page joins through `game_leader`, so an unreferenced
	// person renders nowhere — which is exactly why they would have stayed.
	//
	// Deleting them is what makes this table reproducible: drop the database,
	// reload, and get the same rows. A table that only accumulates cannot make
	// that claim, and CLAUDE.md's whole provenance argument rests on it.
	const { rowCount: orphans } = await client.query(
		`DELETE FROM leader l
		  WHERE l.sport = $1
		    AND NOT EXISTS (SELECT 1 FROM game_leader gl
		                     WHERE gl.sport = l.sport AND (gl.leader = l.id OR gl.ran = l.id))
		    AND NOT EXISTS (SELECT 1 FROM leader_tenure t
		                     WHERE t.sport = l.sport AND t.leader = l.id)`, [sportId]);

	if (orphans) console.log(`  pruned       ${orphans} people no game or tenure refers to`);
}

/** The curated football coaches table, or [] when it does not exist yet.
 *
 *  Missing is a gap and not a crash: without it every coach still resolves by
 *  `slugFor`, the modern era loads exactly as it would have, and the only thing
 *  lost is the pre-1999 half of the page and the Mora disambiguation. Both are
 *  reported by the load rather than assumed.
 */
function loadNflCoaches() { return loadCoachesFile('nfl'); }

/** A sport's curated coaches table (data/reference/<sport>-coaches.csv), or []
 *  when it has none. Football's is nfl-coaches.csv; hockey's and the rest come
 *  from Wikipedia's lists by scripts/wiki-coaches.mjs. */
function loadCoachesFile(sportId) {
	const path = join(REFERENCE_DIR, `${sportId}-coaches.csv`);
	if (!existsSync(path)) return [];
	return parseCsv(readFileSync(path, 'utf8')).map((r) => ({
		leaderId: r.leaderId,
		name: r.name,
		nflverseName: r.nflverseName,
		franchiseAbbrv: r.franchiseAbbrv,
		// The whole tenure, which is what identity resolution matches on: the
		// two Moras are told apart by club and season, and a span truncated at
		// 1998 could not place a `Jim Mora` row from 2001.
		firstSeason: Number(r.firstSeason),
		lastSeason: Number(r.lastSeason),
		// Where the stated counts stop, which is 1998 for a tenure that crosses
		// into the counted era. Loading `lastSeason` here instead would make a
		// stated tenure overlap the games it was subtracted from.
		statedLastSeason: Number(r.statedLastSeason || r.lastSeason),
		w: Number(r.w || 0), l: Number(r.l || 0), t: Number(r.t || 0), otl: Number(r.otl || 0),
		playoffW: Number(r.playoffW || 0), playoffL: Number(r.playoffL || 0),
		// A space-separated season list, counted from games rather than stated.
		// Empty is the common case and must not become an array holding one NaN.
		titleSeasons: String(r.titleSeasons ?? '').trim()
			? String(r.titleSeasons).trim().split(/\s+/).map(Number)
			: [],
		interim: String(r.interim).toUpperCase() === 'TRUE',
		basis: r.basis ?? '',
		// As the list writes it ("2024–2026"); football's file has none (0021).
		term: r.term ?? '',
		// Blank counts mean the record is not known — a co-head-coach year, or a
		// mid-season change this data cannot split. Those must never become a
		// stated tenure of nought and nought, which renders as a real 0-0.
		stated: r.w !== '' && r.w !== undefined,
	}));
}

/** Stated tenures for the era with no per-game source.
 *
 *  NFL 1920-1998 only. These are added to the counted rows and never reconciled
 *  with them, which is safe exactly because the eras do not overlap — and that
 *  is asserted in test/leaders.test.js rather than trusted here.
 */
async function loadNflTenures(client, knownFranchises) { return loadTenures(client, 'nfl', knownFranchises); }

/** Stated tenures from a sport's curated table: football's before 1999, and
 *  the whole of hockey's and basketball's (0020 adds overtime losses). */
async function loadTenures(client, sportId, knownFranchises) {
	const rows = loadCoachesFile(sportId).filter((r) => r.stated);
	if (!rows.length) {
		console.log(`  tenures      none — data/reference/${sportId}-coaches.csv is missing or has no counts`);
		if (sportId === 'nfl') console.log('               football before 1999 will be absent from the leaders page');
		return;
	}
	// The file is the whole of a sport's stated tenures, so it replaces them:
	// upserting alone left a tenure whose first season a correction moved
	// standing beside its replacement (Alex Delvecchio's two Detroit terms,
	// once joined, were three rows).
	await client.query(`DELETE FROM leader_tenure WHERE sport = $1 AND source = 'wikipedia'`, [sportId]);
	let wrote = 0, skippedClub = 0;
	for (const r of rows) {
		if (!knownFranchises.has(r.franchiseAbbrv)) { skippedClub++; continue; }
		await client.query(
			`INSERT INTO leader (sport, id, name, source) VALUES ($1,$2,$3,'wikipedia')
			 ON CONFLICT (sport, id) DO NOTHING`, [sportId, r.leaderId, r.name]);
		const res = await client.query(
			`INSERT INTO leader_tenure
			   (sport, franchise, leader, first_season, last_season, w, l, t, otl, playoff_w, playoff_l, title_seasons, interim, term, source)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'wikipedia')
			 ON CONFLICT (sport, franchise, leader, first_season) DO UPDATE SET
			   last_season = EXCLUDED.last_season, w = EXCLUDED.w, l = EXCLUDED.l, t = EXCLUDED.t, otl = EXCLUDED.otl,
			   playoff_w = EXCLUDED.playoff_w, playoff_l = EXCLUDED.playoff_l,
			   title_seasons = EXCLUDED.title_seasons, interim = EXCLUDED.interim, term = EXCLUDED.term`,
			[sportId, r.franchiseAbbrv, r.leaderId, r.firstSeason, r.statedLastSeason,
				r.w, r.l, r.t, r.otl, r.playoffW, r.playoffL, r.titleSeasons, r.interim, r.term]);
		wrote += res.rowCount;
	}
	console.log(`  tenures      ${wrote} stated tenures${sportId === 'nfl' ? ' (NFL before 1999)' : ''}`);
	if (skippedClub) console.log(`  unknown club ${skippedClub} tenures name a franchise with no games`);
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
	const adapter = (await import(`../sports/${sportId}.js`)).default;
	await client.query('INSERT INTO sport VALUES ($1,$2) ON CONFLICT DO NOTHING',
		[sportId, adapter.name]);

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
	// 500 at a time: 15 columns means 7,500 parameters, well inside Postgres's
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
				row.week ?? null, row.stage ?? null, row.ending ?? null, row.homePens ?? null, row.awayPens ?? null);
			return `(${Array.from({ length: 17 }, (_, i) => `$${at + i + 1}`).join(',')})`;
		});
		pending = [];
		const r = await client.query(SQL_UPSERT_GAME.replace('VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
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
				// WC, DIV, CON, SB as nflverse writes them; see 0011_game_stage.sql.
				stage: r.game_type && r.game_type !== 'REG' ? r.game_type : null,
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
				stage: r.gametype === 'regular' ? null : r.gametype,
			});
		}
		if (skippedType) console.log(`  skipped      ${skippedType} all-star and exhibition games`);
	}

	if (sportId === 'nba') {
		// FiveThirtyEight for 1947-2001, then sportsdataverse a season at a time;
		// see sports/nba.js for the split and for what does not count.
		//
		// Both sides must be clubs the franchise table knows. ESPN types the
		// All-Star weekend's other games and its international exhibitions as
		// regular season — EAST, WEST, USA, WORLD, a touring club — and the first
		// load created all seven as franchises and put one or two extra games in
		// every season from 2014. The live refresh already refuses them the same
		// way (lib/live.js `knows`).
		const codes = codeTable('nba', loadHistory('nba'));
		const notClubs = new Map();
		const putClub = async (row) => {
			for (const c of [row.home, row.away]) {
				if (!codes.knows(c)) { notClubs.set(c, (notClubs.get(c) ?? 0) + 1); return; }
			}
			await put(row);
		};
		const histPath = join(SOURCE_DIR, 'nba', 'nbaallelo.csv');
		if (!await ensureSource('nba', histPath, adapter.sources.history, 'FiveThirtyEight nbaallelo')) {
			await client.query('ROLLBACK');
			await client.end();
			return 1;
		}
		for await (const r of csvRows(histPath)) {
			if (Number(r.year_id) >= adapter.sources.history.useBefore) continue;
			const row = adapter.eloGameRow(r);
			if (row) await putClub(row);
		}
		// Through the season being played. Its file may not be published yet in
		// October, and that one gap is expected: the live refresh carries it.
		const last = adapter.sources.live.seasonOf(new Date());
		for (let season = adapter.sources.schedules.from; season <= last; season++) {
			const path = join(SOURCE_DIR, 'nba', `nba_schedule_${season}.csv`);
			const ok = await ensureSource('nba', path, { url: adapter.sources.schedules.url(season) }, `sportsdataverse NBA ${season}`);
			if (!ok) {
				if (season === last) { console.log(`  not yet      sportsdataverse NBA ${season}; the live refresh carries it`); continue; }
				await client.query('ROLLBACK');
				await client.end();
				return 1;
			}
			for await (const r of csvRows(path)) {
				const row = adapter.espnGameRow(r);
				if (row) await putClub(row);
			}
		}
		if (notClubs.size) {
			const list = [...notClubs].map(([c, n]) => `${c} ${n}`).join(', ');
			console.log(`  not clubs    ${[...notClubs.values()].reduce((a, b) => a + b, 0)} games skipped: ${list}`);
		}
	}

	if (sportId === 'wnba') {
		// The WNBA's own 1997-2025, committed, then sportsdataverse a season at a
		// time; see sports/wnba.js. Both sides must be clubs the franchise table
		// knows, as for the NBA: ESPN files its All-Star sides (EAST, WEST, TEAM
		// CLARK ...) as regular-season games.
		const codes = codeTable('wnba', loadHistory('wnba'));
		const notClubs = new Map();
		const putClub = async (row) => {
			for (const c of [row.home, row.away]) {
				if (!codes.knows(c)) { notClubs.set(c, (notClubs.get(c) ?? 0) + 1); return; }
			}
			await put(row);
		};
		for await (const r of csvRows(join(REFERENCE_DIR, adapter.sources.history.reference))) {
			if (Number(r.season) >= adapter.sources.history.useBefore) continue;
			const row = adapter.statsGameRow(r);
			if (row) await putClub(row);
		}
		const last = adapter.sources.live.seasonOf(new Date());
		for (let season = adapter.sources.schedules.from; season <= last; season++) {
			const path = join(SOURCE_DIR, 'wnba', `wnba_schedule_${season}.csv`);
			const ok = await ensureSource('wnba', path, { url: adapter.sources.schedules.url(season) }, `sportsdataverse WNBA ${season}`);
			let n = 0;
			if (ok) {
				for await (const r of csvRows(path)) {
					const row = adapter.espnGameRow(r);
					if (row) { n++; await putClub(row); }
				}
			}
			// A season's file can be missing, or published part-way through, while
			// ESPN's scoreboard has every game so far. A season of fewer than a
			// hundred games from the file (the shortest season, 1997's, had 115) is
			// read from the scoreboard, day by day, under the same ESPN ids. In May,
			// before a season's file has much in it, that is the normal case.
			if (n < 100) {
				const seen = await loadLive(client, 'wnba', adapter.sources.live, season, putClub);
				console.log(`  scoreboard   WNBA ${season}: ${n} games in the file, ${seen} from ESPN`);
			}
		}
		if (notClubs.size) {
			const list = [...notClubs].map(([c, n]) => `${c} ${n}`).join(', ');
			console.log(`  not clubs    ${[...notClubs.values()].reduce((a, b) => a + b, 0)} games skipped: ${list}`);
		}
	}

	if (sportId === 'mls') {
		// MLS's own record, one file per season, fetched a page at a time and
		// kept; see sports/mls.js. Clubs are MLS's team ids, which the franchise
		// table carries as mlsAbbrv.
		const codes = codeTable('mls', loadHistory('mls'));
		// The 2000-2012 playoff shootouts MLS's data lacks, by its match id.
		const shootouts = new Map(parseCsv(readFileSync(join(REFERENCE_DIR, adapter.sources.shootouts.reference), 'utf8'))
			.map((r) => [r.match_id, r]));
		let applied = 0, unplayed = 0;
		const playing = adapter.sources.live.seasonOf(new Date());
		for (let season = adapter.sources.schedules.from; season <= playing; season++) {
			const path = join(SOURCE_DIR, 'mls', `mls-${season}.json`);
			if (!existsSync(path)) {
				console.log(`  fetching     MLS ${season} ...`);
				try {
					const matches = await adapter.sources.schedules.fetch(season);
					mkdirSync(dirname(path), { recursive: true });
					writeFileSync(path, JSON.stringify(matches));
					console.log(`  fetched      MLS ${season}  ${matches.length} matches`);
				} catch (e) {
					console.error(`could not fetch MLS ${season}`);
					console.error(`  ${e.message}`);
					await client.query('ROLLBACK');
					await client.end();
					return 1;
				}
			}
			for (const m of JSON.parse(readFileSync(path, 'utf8'))) {
				const row = adapter.gameRow(m, { franchiseOf: codes.franchiseOf, knows: codes.knows });
				if (!row) continue;
				// A finished season's unplayed games were never played: 2001's
				// last weekend after September 11, 2020's lost to the pandemic.
				if (row.status !== 'final' && season < playing) { unplayed++; continue; }
				const so = shootouts.get(row.id);
				if (so) {
					row.homePens = Number(so.home_pens);
					row.awayPens = Number(so.away_pens);
					if (row.homeScore === row.awayScore) row.ending = 'SO';
					applied++;
				}
				await put(row);
			}
		}
		if (applied !== shootouts.size) console.error(`  shootouts    ${applied} of ${shootouts.size} in ${adapter.sources.shootouts.reference} found a game`);
		else console.log(`  shootouts    ${applied} from ${adapter.sources.shootouts.reference}`);
		if (unplayed) console.log(`  unplayed     ${unplayed} games of finished seasons, never played, left out`);
	}

	if (sportId === 'nhl') {
		// The league's own record, one stats-API file per season; see
		// sports/nhl.js. Team ids become the NHL's codes from its team list, and
		// the western clubs of the 1918-1926 Cup Finals from WESTERN_CLUBS.
		const teamsPath = join(SOURCE_DIR, 'nhl', 'nhl-teams.json');
		if (!await ensureSource('nhl', teamsPath, adapter.sources.teams, 'NHL team list')) {
			await client.query('ROLLBACK');
			await client.end();
			return 1;
		}
		const { WESTERN_CLUBS } = await import('../sports/nhl.js');
		const codeById = new Map(JSON.parse(readFileSync(teamsPath, 'utf8')).data.map((t) => [t.id, t.triCode]));
		for (const [id, code] of Object.entries(WESTERN_CLUBS)) codeById.set(Number(id), code);
		const codes = codeTable('nhl', loadHistory('nhl'));
		const codeOf = (id) => {
			const code = codeById.get(id);
			return code && codes.knows(code) ? code : null;
		};
		let notClubs = 0;
		const last = adapter.sources.live.seasonOf(new Date());
		for (let season = adapter.sources.schedules.from; season <= last; season++) {
			const path = join(SOURCE_DIR, 'nhl', `stats-games-${season}.json`);
			if (!await ensureSource('nhl', path, { url: adapter.sources.schedules.url(season) }, `NHL ${season}`)) {
				await client.query('ROLLBACK');
				await client.end();
				return 1;
			}
			for (const g of JSON.parse(readFileSync(path, 'utf8')).data ?? []) {
				if ((g.gameType === 2 || g.gameType === 3) && (!codeOf(g.homeTeamId) || !codeOf(g.visitingTeamId))) { notClubs++; continue; }
				const row = adapter.gameRow(g, codeOf);
				if (row) await put(row);
			}
		}
		if (notClubs) console.log(`  not clubs    ${notClubs} games with a side the franchise table does not know`);
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

	if (sportId === 'wnba') {
		await flush();
		// The league's ids name the round from 2002 (sports/wnba.js roundOf), and
		// each season's last is its Finals. 1997-2001 name none and fall to the
		// last-series pass below, as the NBA's early seasons do.
		const r = await client.query(`
			UPDATE game g SET round = 'championship'
			  FROM (SELECT season, max(substring(stage from 2)::int) AS last FROM game
			         WHERE sport = 'wnba' AND round = 'playoff' AND stage ~ '^R[0-9]+$' GROUP BY season) f
			 WHERE g.sport = 'wnba' AND g.season = f.season AND g.stage = 'R' || f.last
			   AND g.season NOT IN (SELECT season FROM game WHERE sport = 'wnba' AND round = 'championship')`);
		console.log(`  finals       ${r.rowCount} WNBA Finals games named by the league's ids`);
	}

	if (sportId === 'nba' || sportId === 'wnba') {
		await flush();
		// ESPN names the Finals from 2004 (measured: 2002 and 2003 carry no round);
		// FiveThirtyEight names no round at all.
		// So a season with playoff games and no championship round gets one: the
		// two clubs in its last playoff game, and every playoff game between them
		// that season. A Finals pair has never met earlier in the same playoffs —
		// they come from opposite halves of the bracket — which is what makes
		// "every meeting" the same as "the series".
		const { rows: seasons } = await client.query(`
			SELECT DISTINCT ON (season) season, home, away FROM game
			 WHERE sport = $1 AND round = 'playoff'
			   AND season NOT IN (SELECT season FROM game WHERE sport = $1 AND round = 'championship')
			 ORDER BY season, date DESC, id DESC`, [sportId]);
		let finals = 0;
		for (const f of seasons) {
			const r = await client.query(
				`UPDATE game SET round = 'championship'
				  WHERE sport = $4 AND season = $1 AND round = 'playoff'
				    AND ((home = $2 AND away = $3) OR (home = $3 AND away = $2))`,
				[f.season, f.home, f.away, sportId]);
			finals += r.rowCount;
		}
		// Named as each era named it, ESPN's seasons included; the WNBA's have
		// always been the WNBA Finals.
		await client.query(sportId === 'nba'
			? `UPDATE game SET title = CASE WHEN season <= 1949 THEN 'BAA Finals' ELSE 'NBA Finals' END
			  WHERE sport = 'nba' AND round = 'championship'`
			: `UPDATE game SET title = 'WNBA Finals' WHERE sport = 'wnba' AND round = 'championship'`);
		console.log(`  finals       ${finals} games across ${seasons.length} seasons derived as the last series`);
	}

	if (sportId === 'wnba') {
		// 1997-2001's ids name no round, so the page could not say which a game
		// was in; see numberSeriesRounds.
		const staged = await numberSeriesRounds(client, 'wnba', "stage IS NULL AND source = 'wnba'");
		console.log(`  rounds       ${staged} playoff games of 1997-2001 numbered back from their Finals`);
	}

	if (sportId === 'mls') {
		await flush();
		// MLS Cup is MLS's Final; 2013-2015 name no round at all ("MATCHWEEK 1",
		// "singleMatch"), and MLS Cup is always a season's last playoff game.
		const r = await client.query(`
			UPDATE game g SET round = 'championship'
			  FROM (SELECT DISTINCT ON (season) id, season FROM game
			         WHERE sport = 'mls' AND round = 'playoff' AND status = 'final'
			           AND season NOT IN (SELECT season FROM game WHERE sport = 'mls' AND round = 'championship')
			         ORDER BY season, date DESC, id DESC) last
			 WHERE g.sport = 'mls' AND g.id = last.id`);
		await client.query(`UPDATE game SET title = 'MLS Cup' WHERE sport = 'mls' AND round = 'championship'`);
		console.log(`  finals       ${r.rowCount} MLS Cups found as their season's last playoff game`);

		// After the Finals are known, because the rounds are counted back from
		// them. MLS has named its rounds a dozen ways since 1996 ("Quarterfinals",
		// "Quarter-Finals", "conferenceFinal", "MATCHWEEK 1" in 2013-2015), and
		// some seasons had a wild card or a knockout round before the first, so
		// every season's are numbered, R1 to R5, and the page names them from
		// MLS Cup back (lib/web.js mlsGametype). The source's word is in its
		// season's file.
		const staged = await numberSeriesRounds(client, 'mls', 'TRUE');
		console.log(`  rounds       ${staged} playoff games numbered back from MLS Cup`);
	}

	if (sportId === 'nhl') {
		await flush();
		// Reset, so a rerun finds the same rounds; then each season's last round
		// is the Stanley Cup Final. The round comes from the game id, R1 to R4.
		await client.query(`UPDATE game SET round = 'playoff', title = NULL WHERE sport = 'nhl' AND round = 'championship'`);
		const r = await client.query(`
			UPDATE game g SET round = 'championship', title = 'Stanley Cup Final'
			  FROM (SELECT season, max(substring(stage from 2)::int) AS last FROM game
			         WHERE sport = 'nhl' AND round = 'playoff' AND stage LIKE 'R%' GROUP BY season) f
			 WHERE g.sport = 'nhl' AND g.season = f.season AND g.stage = 'R' || f.last`);
		console.log(`  finals       ${r.rowCount} Stanley Cup Final games`);
	}

	// After the flush above, because game_leader points at game.
	await loadLeaders(client, sportId, (await import(`../sports/${sportId}.js`)).default, { byCode });

	// After the championship pass above, because it reads the games that pass
	// marks and links each curated row to one.
	await loadChampionships(client, sportId, byCode);

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
