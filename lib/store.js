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
	pool ??= new pg.Pool({
		connectionString,
		// Small on purpose: this is a read-mostly site in front of a database
		// that may be shared with other deployments. A pool that can open fifty
		// connections will, and Postgres' default max_connections is 100.
		max: 5,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
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
	     WHEN g.home = $2 THEN 'home' ELSE 'away' END AS location
FROM game g
WHERE g.sport = $1 AND (g.home = $2 OR g.away = $2)
ORDER BY g.date, g.id`;

export async function gamesFor(sport, franchise, p = pool) {
	const { rows } = await p.query(GAMES, [sport, franchise]);
	return rows;
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

/** The canonical franchise for a source code, so a team manifest's sourceIds
 *  still resolve. A club listing MIL and SE1 maps to one franchise. */
export async function franchiseForCodes(sport, codes, p = pool) {
	if (!codes.length) return null;
	const { rows } = await p.query(
		'SELECT DISTINCT franchise FROM franchise_code WHERE sport = $1 AND code = ANY($2)',
		[sport, codes]);
	if (rows.length > 1) {
		// Two franchises for one club's codes means the load mapped them apart —
		// which is exactly what happened to SE1 and MIL, orphaning a season and
		// changing the club's all-time record by 163 games.
		throw new Error(`codes ${codes.join(',')} map to ${rows.length} franchises: ${rows.map((r) => r.franchise).join(', ')}`);
	}
	return rows[0]?.franchise ?? null;
}
