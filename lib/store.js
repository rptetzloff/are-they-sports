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

/** One pool for the process. Reads happen per request, so a connection per
 *  request would spend more time connecting than querying. */
let pool = null;

export function connect(connectionString = process.env.DATABASE_URL) {
	if (!connectionString) throw new Error('DATABASE_URL is required');
	if (pool) return pool;
	pool = new pg.Pool({
		connectionString,
		// Small on purpose: this is a read-mostly site in front of a database
		// that may be shared with other deployments. A pool that can open fifty
		// connections will, and Postgres' default max_connections is 100.
		max: 5,
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
		WHEN g.home_score = g.away_score THEN 'TIE'
		WHEN (g.home = $2) = (g.home_score > g.away_score) THEN 'WIN'
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
	g.week                                           AS week
FROM game g
WHERE g.sport = $1 AND (g.home = $2 OR g.away = $2)
ORDER BY g.date, g.id`;

export async function gamesFor(sport, franchise, p = pool) {
	const { rows } = await p.query(GAMES, [sport, franchise]);
	return rows;
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
