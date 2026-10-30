/** Reading games from the database.
 *
 *  The perspective happens in SQL. The table holds one row per game with a home
 *  and an away side; a club's page wants result / scoreFor / scoreAgainst, and a
 *  CASE expression is the whole translation. That is the point of storing games
 *  once rather than twice — the two copies the artifacts kept, and the test that
 *  policed them, existed only because the perspective was baked in at build time.
 *
 *  The row shape returned here is deliberately the same one `sports/*.js`
 *  produce, so `lib/core.js` is untouched and does not learn where its rows came
 *  from.
 */

import pg from 'pg';
import { readTv, readSimulcasts } from './tv.js';

/** One pool for the process. Reads happen per request, so a connection per
 *  request would spend more time connecting than querying. */
let pool = null;

/** Connections this process may hold. */
export const POOL_MAX = 5;

export function connect(connectionString = process.env.DATABASE_URL) {
	if (!connectionString) throw new Error('DATABASE_URL is required');
	if (pool) return pool;
	pool = new pg.Pool({
		connectionString,
		// Small on purpose: this is a read-mostly site in front of a database
		// that may be shared with other deployments. A pool that can open fifty
		// connections will, and Postgres' default max_connections is 100.
		max: POOL_MAX,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
	});

	// Without this the process dies when the database does.
	//
	// pg.Pool emits 'error' from idle clients that drop — a database restart, a
	// failover, an idle timeout on a proxy — and an unhandled 'error' event is
	// a throw in Node, not a warning. Stopping Postgres under a running
	// container killed it outright: `node:events:505`, container exited, and it
	// would have restart-looped for as long as the database was away instead of
	// answering 503 and recovering when it came back.
	//
	// A dropped idle connection is not something the request path can act on, so
	// this logs and lets the pool replace the client. Query failures still
	// surface where they happen.
	pool.on('error', (err) => {
		console.error(`  database     idle client error: ${err.message}`);
	});

	return pool;
}

export async function close() {
	if (pool) { await pool.end(); pool = null; }
}

/** Whether the database is reachable and migrated.
 *
 *  Checked at boot and reported by /healthz. A server that cannot read its data
 *  should say so rather than answering every route with an error — the baseball
 *  site's worst incident was catching exactly this kind of failure, logging
 *  "rebuilding from CSV", and serving 200s with the content silently gone.
 */
export async function health(p = pool) {
	try {
		const { rows } = await p.query(
			`SELECT (SELECT count(*)::int FROM game) AS games,
			        (SELECT count(*)::int FROM schema_migration) AS migrations`);
		return { ok: true, games: rows[0].games, migrations: rows[0].migrations };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

/** The club's games, newest source of truth, in the neutral row shape.
 *
 *  `franchise` is canonical — GB, MIL — and the query needs no knowledge of the
 *  aliases, because franchise_code resolved them at load time. That is the
 *  difference between a join and the fallback chain lib/names.js still uses for
 *  display.
 */
const GAMES = `
SELECT
	g.id                                             AS gid,
	g.date::text                                     AS date,
	g.season::text                                   AS season,
	CASE WHEN g.round = 'regular' THEN '1' ELSE '0' END AS regular_season,
	CASE WHEN g.round = 'regular' THEN '0' ELSE '1' END AS playoff,
	CASE WHEN g.round = 'championship' THEN g.season::text ELSE '' END AS championship,
	g.title                                          AS "championshipTitle",
	CASE WHEN g.home = $2 THEN g.away ELSE g.home END AS "Opponent",
	CASE
		WHEN g.status <> 'final' THEN ''
		-- The game's winner (0016): the higher score, else the higher
		-- shootout. Nobody is a draw.
		WHEN g.winner IS NULL THEN 'TIE'
		WHEN g.winner = $2 THEN 'WIN'
		ELSE 'LOSS'
	END                                              AS result,
	CASE WHEN g.status <> 'final' THEN ''
	     WHEN g.home = $2 THEN g.home_score::text ELSE g.away_score::text END AS "scoreFor",
	CASE WHEN g.status <> 'final' THEN ''
	     WHEN g.home = $2 THEN g.away_score::text ELSE g.home_score::text END AS "scoreAgainst",
	CASE WHEN g.neutral THEN 'neutral'
	     WHEN g.home = $2 THEN 'home' ELSE 'away' END AS location,
	-- NULL where the source has none: every pre-1999 football season and all of
	-- baseball. Kept null rather than defaulted, because a schedule grouped by
	-- week has to be able to say it does not know.
	g.week                                           AS week,
	-- REG, OT or SO (0014), which a hockey loss's point and a soccer
	-- shootout's turn on in the standings.
	g.ending                                         AS ending
FROM game g
WHERE g.sport = $1 AND (g.home = $2 OR g.away = $2)`;

const ORDER = ' ORDER BY g.date, g.id';

export async function gamesFor(sport, franchise, p = pool) {
	const { rows } = await p.query(GAMES + ORDER, [sport, franchise]);
	return rows;
}

/** A club's games as the database holds them: both sides, both scores, and
 *  the source's own word for the round.
 *
 *  The adopted front end (web/, lib/web.js) reads each site's own file shape —
 *  Retrosheet's gameinfo for baseball, the football site's games CSV — and
 *  those name the HOME and AWAY clubs rather than "us" and "them", carry the
 *  round as a word, and say which source wrote the row. None of that survives
 *  the club-perspective GAMES query above, so this one does not go through it.
 */
export async function rawGamesFor(sport, franchise, p = pool) {
	const { rows } = await p.query(`
		SELECT id, season, date::text AS date, round, stage, home, away,
		       home_score AS "homeScore", away_score AS "awayScore",
		       neutral, status, source, week, title, ending,
		       home_pens AS "homePens", away_pens AS "awayPens", winner
		  FROM game
		 WHERE sport = $1 AND (home = $2 OR away = $2)
		 ORDER BY date, id`, [sport, franchise]);
	return rows;
}

/** The NCAA tournament's rounds, as the loader names them (sports/ncaam.js
 *  roundOf): the First Four to the final, the third-place games, and NCAA for
 *  a game whose round is unknown. The NIT and the other invitationals are not. */
const NCAA_STAGES = ['FF', 'R64', 'R32', 'S16', 'R3RD', 'E8', 'THIRD', 'F4', 'FINAL', 'NCAA'];
// The NIT's games are one stage, their round in the title.
const STAGES = { ncaa: NCAA_STAGES, nit: ['NIT'] };

/** One season's games of a tournament (ncaa, nit), every side, for its
 *  bracket (lib/bracket.js). */
export async function tournamentGames(sport, season, tournament = 'ncaa', p = pool) {
	const { rows } = await p.query(`
		SELECT id, season, date::text AS date, stage, home, away, title, status,
		       home_score AS "homeScore", away_score AS "awayScore"
		  FROM game
		 WHERE sport = $1 AND season = $2 AND round <> 'regular' AND stage = ANY($3)
		 ORDER BY date, id`, [sport, season, STAGES[tournament]]);
	return rows;
}

/** The seasons with a game of the tournament. */
export async function tournamentSeasons(sport, tournament = 'ncaa', p = pool) {
	const { rows } = await p.query(`
		SELECT DISTINCT season FROM game
		 WHERE sport = $1 AND round <> 'regular' AND stage = ANY($2)
		 ORDER BY season`, [sport, STAGES[tournament]]);
	return rows.map((r) => Number(r.season));
}

/** How many playoff rounds each season had, read off its championship games'
 *  stage (R2 ... R4): what tells hockey's page which round was the Final. */
/** TV providers, areas, networks and channels (0017_tv.sql), for every club. */
export const tvTables = (p = pool) => readTv(p);

/** A club's simulcast days. */
export const simulcastsFor = (sport, club, p = pool) => readSimulcasts(p, sport, club);

export async function finalRounds(sport, p = pool) {
	const { rows } = await p.query(
		`SELECT season, max(substring(stage from 2)::int) AS rounds
		   FROM game
		  WHERE sport = $1 AND round = 'championship' AND stage ~ '^R[0-9]+$'
		  GROUP BY season`, [sport]);
	return new Map(rows.map((r) => [Number(r.season), Number(r.rounds)]));
}

/** Seasons a club won on the final standings, with no game to win.
 *
 *  The football site wrote these as a literal — 1929, 1930, 1931 — because it
 *  was one club. The championship table has them for every club, which is the
 *  only reason the front end can serve the Bears without a Bears literal. */
export async function standingsTitles(sport, franchise, p = pool) {
	const { rows } = await p.query(`
		SELECT season FROM championship
		 WHERE sport = $1 AND champion = $2
		   -- A title won before the games here begin had a game, but not one on
		   -- record: college basketball's 1939 to 1949 (scripts/ncaam-champions.mjs).
		   AND (method IN ('standings', 'poll') OR season < (SELECT min(season) FROM game WHERE sport = $1))
		 ORDER BY season`, [sport, franchise]);
	return rows.map((r) => r.season);
}

/** Every game a club's leaders were credited with, one row per game.
 *
 *  The result is computed HERE, in the same CASE the games query uses, rather
 *  than being recomputed by the caller from two scores. Two implementations of
 *  "did this club win" is how a repo ends up with a page that disagrees with
 *  itself, and this one already has the version that works.
 *
 *  Franchises come in as a list because the leaders page is scope-shaped: one
 *  club under a club scope, thirty-two under a league one. A leader who managed
 *  two clubs IN SCOPE is one person with both, which the tally handles and a
 *  per-club query could not.
 *
 *  Sport is a parameter and not an assumption. `game_leader` is keyed on
 *  (sport, game, franchise) precisely because MIL is a franchise in both
 *  leagues, and a query that took the franchise alone would hand the Brewers'
 *  managers to the Bucks the moment a third sport arrives.
 */
export async function leaderGames(sport, franchises, p = pool) {
	const { rows } = await p.query(`
		SELECT gl.leader, l.name, gl.franchise, g.season, g.round, g.title,
		       -- The game, which the baseball front end keys its leaders on
		       -- (lib/web-routes.js leadersCsv).
		       g.id AS "gameId",
		       -- Ordering WITHIN a season, which is what tells somebody who took
		       -- over in November from somebody who opened in September. The
		       -- season alone cannot say it. Text, as every date here is.
		       g.date::text AS date,
		       CASE
		         WHEN g.winner IS NULL THEN 'TIE'
		         WHEN g.winner = gl.franchise THEN 'WIN'
		         ELSE 'LOSS'
		       END AS result
		  FROM game_leader gl
		  JOIN game g   ON g.sport = gl.sport AND g.id = gl.game_id
		  JOIN leader l ON l.sport = gl.sport AND l.id = gl.leader
		 WHERE gl.sport = $1 AND gl.franchise = ANY($2) AND g.status = 'final'`,
	[sport, franchises]);
	return rows;
}

/** Stated tenures, for the era no per-game source covers.
 *
 *  NFL 1920-1998, and the whole of hockey (data/reference/nhl-coaches.csv).
 *  Empty is the normal answer for baseball and is not a failure: Retrosheet
 *  publishes managers back to 1871, so nothing about baseball needs stating.
 */
export async function leaderTenures(sport, franchises, p = pool) {
	const { rows } = await p.query(`
		SELECT t.leader, l.name, t.franchise,
		       t.first_season AS "firstSeason", t.last_season AS "lastSeason",
		       t.w, t.l, t.t, t.otl, t.playoff_w AS "playoffW", t.playoff_l AS "playoffL",
		       t.title_seasons AS "titleSeasons", t.interim, t.term
		  FROM leader_tenure t
		  JOIN leader l ON l.sport = t.sport AND l.id = t.leader
		 WHERE t.sport = $1 AND t.franchise = ANY($2)`,
	[sport, franchises]);
	return rows;
}

/** Who won each season, for a scope's clubs or for a whole sport.
 *
 *  `franchises` narrows to a club's own titles; omitted, it is every champion
 *  the sport has, which is what the league champions page shows.
 *
 *  The runner-up's name is resolved by the caller, not here: naming a club is
 *  per sport and dated, and a 1969 opponent is not called what it is called now.
 */
export async function championships(sport, franchises = null, p = pool) {
	const { rows } = await p.query(`
		SELECT c.season, c.league, c.champion, c.runner_up AS "runnerUp",
		       c.method, c.title, c.game_id AS "gameId", s.reproducible
		  FROM championship c
		  JOIN source s ON s.id = c.source
		 WHERE c.sport = $1
		   AND ($2::text[] IS NULL OR c.champion = ANY($2) OR c.runner_up = ANY($2))
		 ORDER BY c.season, c.league`,
	[sport, franchises]);
	return rows;
}

/** Only the rows observed since `since`, in the same shape.
 *
 *  A live refresh rewrites today's games every minute during a season, and each
 *  write sets observed_at, so a club playing today looks changed once a minute.
 *  Re-reading its whole history to pick that up is the waste: the Brewers are
 *  9,229 rows and the live feed touched one of them.
 *
 *  Strictly greater than, so a row observed at exactly the cached stamp is not
 *  fetched again — that row is already in hand, by definition of the stamp.
 */
export async function gamesSince(sport, franchise, since, p = pool) {
	const { rows } = await p.query(`${GAMES} AND g.observed_at > $3${ORDER}`, [sport, franchise, since]);
	return rows;
}

/** How many games a club has, by the same filter as gamesFor. What tells a
 *  merge it missed rows that LEFT the club: they are not in gamesSince, which
 *  only sees the club's rows. */
export async function gameCount(sport, franchise, p = pool) {
	const { rows } = await p.query(
		'SELECT count(*)::int AS n FROM game g WHERE g.sport = $1 AND (g.home = $2 OR g.away = $2)', [sport, franchise]);
	return rows[0].n;
}

/** Cached briefly, because it is asked on every request that would otherwise
 *  503 and the answer changes only when someone runs a load.
 *
 *  Thirty seconds, so `npm run load` against a running deployment starts being
 *  served without a restart. Measured at boot only, the previous behaviour meant
 *  loading data into a live container did nothing visible until it was
 *  redeployed — which is a poor way to find out the load worked.
 */
let availabilityCache = { at: 0, value: new Map() };
const AVAILABILITY_TTL_MS = 30_000;

export async function availability(now, p = pool) {
	if (now - availabilityCache.at < AVAILABILITY_TTL_MS) return availabilityCache.value;
	try {
		const value = await franchisesWithGames(p);
		availabilityCache = { at: now, value };
	} catch {
		// A failed refresh keeps the last known answer rather than emptying it.
		// The database being down is reported by /healthz; it should not also
		// make every club look unbuilt.
		availabilityCache.at = now;
	}
	return availabilityCache.value;
}

/** Which franchises have games, so a club can be reported available or not
 *  without loading its games first. */
export async function franchisesWithGames(p = pool) {
	const { rows } = await p.query(
		`SELECT sport, franchise, count(*)::int AS games FROM (
			SELECT sport, home AS franchise FROM game
			UNION ALL
			SELECT sport, away AS franchise FROM game
		 ) x GROUP BY sport, franchise`);
	return new Map(rows.map((r) => [`${r.sport}/${r.franchise}`, r.games]));
}

/** Borrow one connection for the length of a job.
 *
 *  A pooled query is not enough for an advisory lock: the lock belongs to the
 *  session that took it, and two queries from a pool are not guaranteed to be
 *  the same session. The live refresh takes a lock so that one container polls
 *  rather than all of them.
 */
/** Read a stored league summary, if it was computed from these inputs.
 *
 *  Returns null when there is no row or the row was computed from something
 *  else, which the caller treats identically: compute it and write it back. A
 *  summary is a cache with its inputs named, so a stale one is never served —
 *  it is simply not found.
 */
export async function readSummary({ scope, sport, view, season = 0, version }, p = pool) {
	const { rows } = await p.query(
		`SELECT payload FROM league_summary
		  WHERE scope = $1 AND sport = $2 AND view = $3 AND season = $4 AND version = $5`,
		[scope, sport, view, season, version]);
	return rows[0]?.payload ?? null;
}

/** Write one, replacing whatever was there for the same view.
 *
 *  ON CONFLICT rather than delete-then-insert: two containers computing the
 *  same summary at the same moment is expected and harmless, and the row they
 *  write is identical.
 */
export async function writeSummary({ scope, sport, view, season = 0, version, payload }, p = pool) {
	await p.query(
		`INSERT INTO league_summary (scope, sport, view, season, version, payload)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (scope, sport, view, season)
		 DO UPDATE SET version = EXCLUDED.version, payload = EXCLUDED.payload, computed_at = now()`,
		[scope, sport, view, season, version, JSON.stringify(payload)]);
}

export async function withClient(fn, p = pool) {
	if (!p) throw new Error('not connected');
	const client = await p.connect();
	try {
		return await fn(client);
	} finally {
		client.release();
	}
}

/** When this club's games were last written.
 *
 *  From observed_at rather than a clock, so "last updated" means the data
 *  changed rather than the page was rendered. A timestamp that moves on every
 *  request tells a visitor nothing.
 */
export async function lastUpdated(sport, franchise, p = pool) {
	const { rows } = await p.query(
		'SELECT max(observed_at) AS at FROM game WHERE sport = $1 AND (home = $2 OR away = $2)',
		[sport, franchise]);
	return rows[0]?.at ?? null;
}

/** Every franchise's last-observed stamp, in ONE query.
 *
 *  The per-franchise version above is fine for one club and is what the game
 *  cache called, once per club, every thirty seconds — measured at 429ms for the
 *  236 franchises that have games, on every league page whose check window had
 *  expired. That is a fixed cost paid before a single row is read, and it scales
 *  with the number of clubs rather than with what changed.
 *
 *  Returns `Map<"sport/franchise", Date>`. A franchise appears twice in the
 *  scan, as home and as away, so the two are folded to the later of them.
 */
export async function lastUpdatedAll(p = pool) {
	const { rows } = await p.query(`
		SELECT sport, franchise, max(at) AS at FROM (
			SELECT sport, home AS franchise, max(observed_at) AS at FROM game GROUP BY 1, 2
			UNION ALL
			SELECT sport, away AS franchise, max(observed_at) AS at FROM game GROUP BY 1, 2
		) s GROUP BY 1, 2`);
	return new Map(rows.map((r) => [`${r.sport}/${r.franchise}`, r.at]));
}
