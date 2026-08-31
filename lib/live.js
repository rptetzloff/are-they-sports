/** Keeping the season being played current, from inside the server.
 *
 *  The two live sites fetch ESPN **from the browser** on every page load, so
 *  they are never stale. This repo reads only from the database, which makes the
 *  database the source of record and keeps a third party out of the request
 *  path — and, until now, made the site exactly as fresh as the last time
 *  somebody ran the loader. That is a real regression against the sites this is
 *  meant to replace, not a trade worth defending.
 *
 *  So the server refreshes itself on a timer. The request path still never
 *  calls out: a page that fetched ESPN per request would be slow, would break
 *  when ESPN did, and would need client script this repo does not have. The
 *  timer writes to Postgres and the existing game cache picks the rows up on its
 *  own, because it is already keyed on `max(observed_at)`.
 *
 *  **One poller, however many containers.** A Postgres advisory lock decides
 *  which one refreshes. Without it every replica would fetch the same days on
 *  the same schedule and write the same rows — which is the objection CLAUDE.md
 *  raised against a file-per-container database, arriving from the other
 *  direction.
 */

import { codeTable } from './codes.js';
import { loadHistory } from './reference.js';

/** Namespaced so this cannot collide with another advisory lock in the same
 *  database. Arbitrary, fixed, and only meaningful against itself. */
const LOCK_CLASS = 0x5350; // "SP"

/** Fetch one season from a sport's live feed and upsert it.
 *
 *  Returns what happened rather than logging it, so the caller decides whether
 *  a refresh that found nothing is worth a line.
 */
export async function refreshLive(client, sportId, sport, { season = null, now = new Date() } = {}) {
	const cfg = sport?.sources?.live;
	if (!cfg) return { ran: false, reason: `${sportId} declares no live source` };

	const year = season ?? cfg.seasonOf(now);
	// Days, not months. A day's request returns that LOCAL day's games, which is
	// the date Retrosheet files them under; a month's request returns UTC
	// timestamps and files every night game a day late. And a refresh only needs
	// the days that can still change — two — rather than the whole season.
	const days = season ? cfg.daysOf(year) : cfg.recentDays(now);
	const codes = codeTable(sportId, loadHistory(sportId));
	const rows = [];
	const failed = [];

	for (const day of days) {
		try {
			const res = await fetch(cfg.url(day));
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			for (const { event, number } of sport.numberEvents((await res.json()).events ?? [])) {
				const row = sport.liveGameRow(event, {
					eraCodeOf: codes.eraCodeOf, franchiseOf: codes.franchiseOf, knows: codes.knows,
					codeIn: codes.codeIn,
					number, queryDate: day,
				});
				if (row) rows.push(row);
			}
		} catch (e) {
			// One day failing must not lose the others, and a feed being briefly
			// unreachable is not a reason to stop refreshing forever.
			failed.push(`${day}: ${e.message}`);
		}
	}
	if (!rows.length) return { ran: true, season: year, days: days.length, written: 0, failed };

	// One row per id. Consecutive days can return the same game — a fixture that
	// slipped, or a day queried twice — and Postgres refuses an upsert whose own
	// values repeat a key.
	const byId = new Map(rows.map((r) => [r.id, r]));
	const written = await writeGames(client, sportId, [...byId.values()]);
	return { ran: true, season: year, days: days.length, written, failed };
}

/** The same upsert the loader uses, with the same authority rule.
 *
 *  Duplicated deliberately rather than imported from `scripts/load.mjs`: that
 *  file is a command-line program that connects, migrates, repairs and commits,
 *  and importing it into the server to reuse one statement would drag all of it
 *  in. The statement is the contract; it is asserted against the loader's in the
 *  tests so the two cannot drift.
 */
export const SQL_UPSERT_LIVE = `
INSERT INTO game (sport, id, season, date, round, home, away, home_score, away_score, neutral, status, source, week)
VALUES %VALUES%
ON CONFLICT (sport, id) DO UPDATE SET
	season = EXCLUDED.season, date = EXCLUDED.date, round = EXCLUDED.round,
	home = EXCLUDED.home, away = EXCLUDED.away,
	home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
	neutral = EXCLUDED.neutral, status = EXCLUDED.status,
	week = COALESCE(EXCLUDED.week, game.week),
	source = EXCLUDED.source, observed_at = now()
WHERE (SELECT authority FROM source WHERE id = EXCLUDED.source)
   >= (SELECT authority FROM source WHERE id = game.source)
   OR (game.status <> 'final'
       AND (EXCLUDED.status = 'final' OR game.source = EXCLUDED.source))`;

async function writeGames(client, sportId, rows) {
	// Franchises first. A live feed only names current clubs and they all exist
	// already, but a club that somehow does not would fail the foreign key and
	// lose the whole batch.
	const clubs = [...new Set(rows.flatMap((r) => [r.home, r.away]))];
	for (const id of clubs) {
		await client.query('INSERT INTO franchise (sport, id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sportId, id]);
	}

	let written = 0;
	for (let i = 0; i < rows.length; i += 500) {
		const batch = rows.slice(i, i + 500);
		const params = [];
		const tuples = batch.map((row) => {
			const at = params.length;
			params.push(sportId, row.id, row.season, row.date, row.round, row.home, row.away,
				row.homeScore, row.awayScore, row.neutral, row.status, row.source, row.week ?? null);
			return `(${Array.from({ length: 13 }, (_, k) => `$${at + k + 1}`).join(',')})`;
		});
		const res = await client.query(SQL_UPSERT_LIVE.replace('%VALUES%', tuples.join(',')), params);
		written += res.rowCount;
	}
	return written;
}

/** How long to wait before refreshing again, from what the database says.
 *
 *  Polling every two minutes around the clock is mostly pointless: a baseball
 *  season is six months of the year and a game day is a few hours of it. The
 *  question "is anything happening" is already answerable — a game dated today
 *  or yesterday that is not final is one still to be played or being played now.
 *
 *  Yesterday counts because a game starting at 7pm local finishes after midnight
 *  UTC, and because a suspended game is finished the next day.
 *
 *  Returns milliseconds. The three cases are: something is live or about to be,
 *  the day's games are done but the sport is in season, and nothing at all.
 */
export async function nextDelay(client, sportId, { live = 60_000, between = 30 * 60_000, idle = 6 * 3600_000 } = {}) {
	const { rows } = await client.query(
		`SELECT count(*) FILTER (WHERE status <> 'final')::int AS pending,
		        count(*)::int AS recent
		   FROM game
		  WHERE sport = $1 AND date BETWEEN current_date - 1 AND current_date + 1`,
		[sportId]);
	const { pending = 0, recent = 0 } = rows[0] ?? {};
	if (pending > 0) return { ms: live, why: `${pending} unfinished` };
	if (recent > 0) return { ms: between, why: 'in season, nothing pending' };
	return { ms: idle, why: 'no games near today' };
}

/** Run `fn` only if no other process holds the lock.
 *
 *  `pg_try_advisory_lock` returns immediately rather than queuing, which is what
 *  a timer wants: a refresh that is already running elsewhere should be skipped,
 *  not stacked up behind itself.
 */
export async function withLock(client, key, fn) {
	const { rows } = await client.query('SELECT pg_try_advisory_lock($1, $2) AS got', [LOCK_CLASS, key]);
	if (!rows[0]?.got) return { skipped: true };
	try {
		return await fn();
	} finally {
		await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_CLASS, key]);
	}
}

/** A stable small integer for a sport, so two sports do not share a lock. */
export const lockKeyFor = (sportId) => {
	let h = 0;
	for (const ch of sportId) h = (h * 31 + ch.charCodeAt(0)) | 0;
	return h;
};
