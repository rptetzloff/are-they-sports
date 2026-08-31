/** The dev server.
 *
 *  Serves HTML, with `?format=json` on every route for the data behind it. It
 *  served JSON only for one commit, on purpose — inventing markup while routing
 *  was still moving would have baked a layout into a routing change. The scope
 *  model is settled now, so there are pages.
 *
 *  Rendering happens here, on the server. The football site does it in `main.js`
 *  in the browser, which fetches its own CSV, and the result is that none of its
 *  rendering is reachable from `node --test` — 118 tests passed there while
 *  every past season showed a 0-0 record. Everything in lib/render.js takes data
 *  and returns a string.
 *
 *  Configuration is two environment variables:
 *
 *    SCOPE          required. team:packers, division:nfl/nfc-north,
 *                   conference:nfl/nfc, sport:nfl, all
 *    PUBLIC_ORIGIN  optional. Pins the origin used in absolute links. Without
 *                   it any Host header becomes canonical, which on the two live
 *                   sites meant a preview domain could publish itself as the
 *                   real one.
 *
 *  It fails loudly and exits rather than starting degraded. That is a direct
 *  lesson: the baseball site once found its indices unreadable, caught the
 *  error, logged "rebuilding from CSV", and served every route 200 with the box
 *  scores silently gone. A server that cannot do its job should not be healthy.
 */

import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeHeadToHead } from './lib/headtohead.js';
import { computeRecords } from './lib/records.js';
import { computeLeague } from './lib/league.js';
import { computeSchedule, selectPeriod } from './lib/schedule.js';
import { computeStandings, divisionPeers, playedSeasons } from './lib/standings.js';
import { Lru, memo, versionOf } from './lib/derived.js';
import { historyPoints } from './lib/history.js';
import { codeTables, franchisesForClub, staleFranchises } from './lib/codes.js';
import { availability, close, connect, franchisesWithGames, gamesFor, health, lastUpdated, readSummary, withClient, writeSummary } from './lib/store.js';
import { lockKeyFor, nextDelay, refreshLive, withLock } from './lib/live.js';
import {
	daysToNextGame, lastLosslessSeason, latestSeason, recordText, seasons, seasonTally, seasonVerdict,
	seasonWinPct, seriesRecords, streakBanner, verdictText,
} from './lib/core.js';
import {
	NEUTRAL, clubPage, clubSwitcher, standingsModal, headToHeadPage, historyPage, leagueNav, leagueRecordsPage, leagueSchedulePage, sportTabs, missingSeasonPage, opponentPage, recordsPage, standingsPage,
	scheduleHtml, seasonNav, selectorPage, siteNav, sparklineHtml,
} from './lib/render.js';
import { colorsFor, resolver } from './lib/names.js';
import { SPORTS, loadSports, loadTeams } from './lib/teams.js';
import { matchRoute, parseView, routeTable } from './lib/routes.js';
import { loadDivisions, needsSelector, parseScope, resolveScope } from './lib/scope.js';

const PORT = Number(process.env.PORT ?? 3000);

/** Which build this is.
 *
 *  Reported by /healthz so "is my code deployed?" is one request rather than a
 *  guess. That question has now cost real time three times: a merge that left a
 *  commit behind on a work branch, and two rollouts where the old and new
 *  containers both served for about twenty seconds and the same hostname
 *  returned two different answers.
 *
 *  SOURCE_COMMIT is what Coolify sets; BUILD_SHA is the Dockerfile's own build
 *  arg, for a plain `docker build`. When neither is set it says so rather than
 *  inventing a value — an unknown build is a fact worth showing, and a
 *  fabricated one is worse than none.
 */
const BUILD = process.env.BUILD_SHA || process.env.SOURCE_COMMIT || 'unknown';

function die(reason) {
	console.error(`FATAL: ${reason}`);
	process.exit(1);
}

export function originOf(req, env = process.env) {
	if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/+$/, '');
	const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
	const host = req.headers['x-forwarded-host'] || req.headers.host;
	return `${proto}://${host}`;
}

const json = (res, code, body) => {
	const buf = Buffer.from(`${JSON.stringify(body, null, '\t')}\n`);
	res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
	res.end(buf);
};

const html = (res, code, body) => {
	const buf = Buffer.from(body);
	res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length });
	res.end(buf);
};

/** Whether this request wants the data rather than the page.
 *
 *  `?format=json` is kept because it is what makes a deployment debuggable from
 *  a terminal — every check in this repo's commit messages was a curl against
 *  these routes, and losing that to add markup would be a bad trade.
 */
const wantsJson = (url) => url.searchParams.get('format') === 'json';

/** A club's games, filtered to a season when asked.
 *
 *  Cached per franchise, and invalidated when the data actually changes rather
 *  than on a timer. `max(observed_at)` is one cheap indexed query; it is checked
 *  at most every thirty seconds, and the rows are only re-read when that stamp
 *  has moved.
 *
 *  The first version cached for the life of the process, which meant a load
 *  against a running deployment was invisible until it was redeployed. That is
 *  not a theoretical cost: it hid a playoff-flag correction once and a franchise
 *  remapping once, and both times the site looked right and was quietly wrong —
 *  which is the failure this project keeps finding, arriving through a cache.
 */
const gameCache = new Map();
const CACHE_CHECK_MS = 30_000;

async function games(entry, season) {
	// Keyed by SPORT and franchise. Franchise codes collide across sports and
	// the same-city pairs are the worst of it: the Orioles and the Ravens are
	// both BAL, the Twins and the Vikings both MIN, the Marlins and the Dolphins
	// both MIA, the Pirates and the Steelers both PIT, the Mariners and the
	// Seahawks both SEA. Keyed on the code alone, whichever club was requested
	// first filled the cache and the other was served its rows — so the MLB
	// record book showed the Orioles at 276-208-1 since 1996, which is the
	// Ravens.
	//
	// `codeIndex` is keyed this way for exactly this reason, with a comment
	// naming MIN. The cache was not, and only showed it once baseball loaded.
	const key = `${entry.sport}/${entry.franchise}`;
	const hit = gameCache.get(key);
	const now = Date.now();

	let rows = hit?.rows;
	if (!hit || now - hit.checkedAt >= CACHE_CHECK_MS) {
		const stamp = (await lastUpdated(entry.sport, entry.franchise))?.toISOString() ?? null;
		if (!hit || hit.stamp !== stamp) {
			rows = await gamesFor(entry.sport, entry.franchise);
			gameCache.set(key, { rows, stamp, checkedAt: now });
		} else {
			hit.checkedAt = now;
		}
	}

	return season ? rows.filter((g) => g.season === season) : rows;
}

/** What the game cache last recorded for a club, or null if it has none.
 *
 *  This is the version the derived cache keys on. Reading it rather than
 *  querying again is the point: `games()` has just run for every club on the
 *  page, so the stamps are already correct and already paid for.
 */
const stampOf = (entry) => gameCache.get(`${entry.sport}/${entry.franchise}`)?.stamp ?? null;

/** Memoised league computations. Sixty-four is a few seasons of each view for
 *  each sport in scope, which is what anyone clicking through a season nav
 *  touches; the whole point of the bound is that a hundred-season nav cannot
 *  grow it without limit. */
const derivedCache = new Lru(64);

/** The same memo, one layer out: Postgres, shared by every process.
 *
 *  The in-process cache above is per container and dies with it, so the first
 *  request after every deploy recomputed everything, and a second replica
 *  recomputed it again. A played season does not change — the record book for
 *  1962 is the same answer on every request, in every container, forever — so
 *  it is written down.
 *
 *  Three layers, cheapest first: the process memo (microseconds), the stored
 *  summary (2-5ms), the computation (232-400ms over 471,453 rows). The stored
 *  row carries the version it was computed from, so a stale one is not served,
 *  it is not FOUND — and the computation that replaces it writes itself back.
 *
 *  A write failure is logged and swallowed. The page has already been computed
 *  at that point and is correct; a database that will not accept a cache row is
 *  a reason to be slow, not a reason to fail.
 */
async function summarised(key, { scope, sport, view, season = 0 }, version, compute) {
	const hit = derivedCache.get(key);
	if (hit && hit.version === version) return hit.value;

	const stored = await readSummary({ scope, sport, view, season, version }).catch((e) => {
		console.error(`  summary      read ${sport}/${view}: ${e.message}`);
		return null;
	});
	if (stored) {
		derivedCache.set(key, { version, value: stored });
		return stored;
	}

	const value = await compute();
	derivedCache.set(key, { version, value });
	// Awaited, not fired and forgotten. The request that computes this has
	// already paid seconds for it, so the milliseconds to write it down are not
	// the cost worth saving — and an un-awaited write is lost when the process
	// stops, which is exactly what happened while measuring this: a container
	// killed just after serving a page left nothing behind, and the next one
	// recomputed from scratch. A deploy is a process stopping just after serving
	// pages.
	await writeSummary({ scope, sport, view, season, version, payload: value })
		.catch((e) => console.error(`  summary      write ${sport}/${view}: ${e.message}`));
	return value;
}

/** What the stored summaries are keyed on, beyond the clubs' own row stamps.
 *
 *  A change to HOW records are computed moves no stamp at all. Without the build
 *  in the key, a deploy that fixed a records bug would go on serving the bug out
 *  of the table, which is the exact failure this repo has already had twice
 *  through a cache. Locally BUILD is "unknown" and never changes, so the process
 *  start stands in for it — a restart is the local equivalent of a deploy.
 */
const CODE_VERSION = BUILD === 'unknown' ? `dev-${process.hrtime.bigint()}` : BUILD;

/** The version a summary is stored against: what the clubs' rows were, and what
 *  computed them.
 *
 *  Read from the DATABASE, not from the game cache. That distinction is the
 *  whole point: `stampOf` answers from rows already loaded, so asking it first
 *  meant loading 471,453 rows before discovering the answer was already stored.
 *  Measured: a fresh process still took 1,517ms to serve a summary it did not
 *  need to compute, because it read every game to work out whether it needed to.
 *
 *  Asking Postgres instead costs one round trip per club and lets a hit skip the
 *  rows entirely.
 */
async function summaryVersion(entries) {
	const parts = await Promise.all(entries.map(async (e) => {
		const at = await lastUpdated(e.sport, e.franchise);
		return `${e.sport}/${e.franchise}@${at ? at.toISOString() : '-'}`;
	}));
	return `${CODE_VERSION}|${parts.sort().join(',')}`;
}

/** Today, as the games themselves are dated.
 *
 *  LOCAL, not UTC. Game dates in this database are the local day the game was
 *  played — that distinction cost a 76% id match against Retrosheet before it
 *  was found — and `toISOString()` here would put every evening game on
 *  tomorrow's schedule for the five hours after midnight UTC.
 */
function todayLocal(now = new Date()) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function summary(entry, origin, base) {
	const all = await games(entry);
	const played = all.filter((g) => g.result);
	const seasons = [...new Set(all.map((g) => g.season))].sort();
	return {
		team: entry.teamId,
		sport: entry.sport,
		code: entry.code,
		conference: entry.conference ?? null,
		division: entry.division ?? null,
		games: { total: all.length, played: played.length, scheduled: all.length - played.length },
		seasons: { first: seasons[0], last: seasons.at(-1), count: seasons.length },
		record: {
			wins: played.filter((g) => g.result === 'WIN').length,
			losses: played.filter((g) => g.result === 'LOSS').length,
			ties: played.filter((g) => g.result === 'TIE').length,
		},
		links: { self: `${origin}${base || '/'}`, latestSeason: `${origin}${base}/${seasons.at(-1)}` },
	};
}

/** What the selector calls itself. Built from the scope rather than stored, so
 *  a new division needs no copy written for it. */
function scopeHeading(scope, table) {
	if (scope.kind === 'all') return 'Every club';
	if (scope.kind === 'sport') return `Every ${scope.sport.toUpperCase()} club`;
	const first = table[0];
	if (scope.kind === 'conference') return `${first.conference}`;
	return `${first.conference} ${first.division}`;
}

function main() {
	const scope = (() => {
		try { return parseScope(process.env.SCOPE); } catch (e) { return die(e.message); }
	})();
	// The scope, verbatim, as part of every stored summary's key. `/records` is
	// four clubs under division:nfl/nfc-north and thirty-two under sport:nfl —
	// different answers to the same question, and two deployments sharing a
	// database would otherwise serve each other's record books. Normalised only
	// for case and surrounding space, so "all" and " ALL " are one key rather
	// than two copies of the same answer.
	const scopeKey = String(process.env.SCOPE ?? '').trim().toLowerCase();

	const divisionsBySport = {};
	for (const s of SPORTS) {
		try { divisionsBySport[s] = loadDivisions(s); } catch (e) { return die(`division table for ${s}: ${e.message}`); }
	}

	if (!process.env.DATABASE_URL) {
		return die('DATABASE_URL is required; games are read from the database at request time');
	}
	connect();

	return loadTeams().then(async (teams) => {
		// Availability now means "this franchise has games in the database",
		// not "someone ran a build". A club with a manifest and no rows is in
		// scope and unavailable, exactly as before — the source of the fact
		// changed, not the reporting of it.
		const dbHealth = await health();
		if (!dbHealth.ok) {
			// Not fatal. A database that is down is a data gap, not a
			// configuration error, and the distinction is the one drawn when the
			// first version of this file exited on an empty scope: exiting turns
			// a readable failure into a crash loop with the reason one restart
			// back in the logs.
			console.error(`  UNHEALTHY    database unreachable: ${dbHealth.error}`);
		}
		const withGames = dbHealth.ok ? await franchisesWithGames() : new Map();

		let resolved;
		try {
			resolved = resolveScope(scope, { divisionsBySport, teams, built: new Set() });
		} catch (e) {
			return die(e.message);
		}

		// Resolve each club's canonical franchise from the CHECKOUT, not from the
		// database.
		//
		// This used to ask `franchise_code`, a copy of the reference table that
		// the loader writes. Two sources for one fact, loaded at different times,
		// and they disagreed the moment the Raiders got a manifest: the server's
		// copy still mapped LV to LV, so the boot check saw one club claiming two
		// franchises and called die(). One club's stale row took down all
		// thirty-two, and no amount of redeploying fixed it, because the wrong
		// data was in the database rather than the image.
		//
		// The reference table ships with the code, so it cannot be out of step
		// with the manifests that were written against it.
		const codes = codeTables(Object.keys(divisionsBySport));
		// By SPORT and id. A club id is unique only within a sport, and matching
		// on the id alone finds whichever manifest loaded first — `teams/mlb`
		// sorts before `teams/nfl`, so an entry for the NFL Giants resolved to
		// the baseball Giants, took SFN as its franchise, and went unavailable
		// because nothing named nfl/SFN has games.
		//
		// Measured: an `all` scope reported 30 of 62 available with nfl/NYG and
		// nfl/ARI missing — the two ids both sports use. The map below is keyed
		// on sport and id for exactly this reason; this lookup was written
		// before it and was not changed with it.
		const club = (sport, id) => teams.find((t) => t.sport === sport && t.id === id);
		for (const e of resolved) {
			const team = club(e.sport, e.teamId);
			if (!team) continue;
			const distinct = franchisesForClub(team, codes.franchiseOf);
			if (distinct.length > 1) {
				// Still fatal, but now it means the reference table itself
				// disagrees about a club, which no build or load can fix.
				return die(`${team.id}: codes ${team.sourceIds.join(',')} are ${distinct.length} franchises: ${distinct.join(', ')}`);
			}
			e.franchise = distinct[0] ?? null;
			e.available = Boolean(e.franchise) && (withGames.get(`${e.sport}/${e.franchise}`) ?? 0) > 0;
		}

		// Games sitting under a franchise the reference table now calls an alias.
		// That means the database was loaded against an older reference table, and
		// the club would serve half its history — the Raiders' 2020-on seasons
		// under LV while OAK holds everything before.
		//
		// Reported, not fatal: re-running the load fixes it, which by this repo's
		// rule makes it a data gap. It is named at boot, counted by /healthz, and
		// the affected clubs answer 503 rather than a page that is quietly missing
		// six seasons.
		const stale = staleFranchises([...withGames.keys()], codes.franchiseOf);
		if (stale.length) {
			console.error(`STALE: ${stale.length} database franchises are aliases in the reference table: `
				+ `${stale.map((x) => `${x.sport}/${x.franchise} -> ${x.canonical}`).join(', ')}`
				+ '. Re-run: node scripts/load.mjs');
			const affected = new Set(stale.map((x) => x.canonical));
			for (const e of resolved) {
				if (e.franchise && affected.has(e.franchise)) {
					e.available = false;
					e.stale = true;
				}
			}
		}

		// Keyed by sport AND id. A club id is unique only within a sport — the
		// Cardinals and the Giants are each two different clubs — and a global
		// map returned whichever manifest loaded last, so half of one pair would
		// have rendered with the other's name, nouns and rules.
		const teamsById = new Map(teams.map((t) => [`${t.sport}/${t.id}`, t]));
		const clubFor = (e) => (e?.teamId ? teamsById.get(`${e.sport}/${e.teamId}`) : undefined);
		// One resolver per sport, loaded once. A club in scope with no manifest
		// still has a name — that is the whole point, since 60 of the 62 clubs an
		// `all` scope covers are unbuilt and would otherwise be bare codes.
		const namers = Object.fromEntries(SPORTS.map((s) => [s, resolver(s)]));

		/** The division table behind a club's record, for one season.
		 *
		 *  Built from the DATABASE, not from the scope. Under
		 *  `SCOPE=team:mlb/brewers` the Cubs and the Cardinals are not in the
		 *  table at all, and a standings modal with one row in it is not a
		 *  standings table — the scope decides which clubs get pages, not which
		 *  games exist.
		 *
		 *  Returns null rather than an empty table when the club has no division
		 *  on record or did not play that season, so the record stays plain text
		 *  instead of linking to an empty box.
		 */
		async function divisionStandings(entry, season) {
			const divisions = divisionsBySport[entry.sport];
			if (!divisions) return null;
			const resolve = namers[entry.sport];
			const peers = divisionPeers(entry.sport, entry.code, divisions, {
				teamFor: (code) => clubFor(table.find((e) => e.sport === entry.sport && e.code === code)),
				nameFor: (code) => resolve(code, { season: String(season) }).name,
			});
			if (peers.length < 2) return null;
			const withRows = [];
			for (const peer of peers) {
				// Each peer's own franchise, resolved from the checkout the same
				// way the scope's clubs are. A division-mate is a sport and a
				// code; taking the code alone would fetch the Ravens' rows for
				// the Orioles.
				const franchise = codes.franchiseOf(entry.sport, peer.code);
				withRows.push({ ...peer, franchise, rows: await games({ sport: entry.sport, franchise }) });
			}
			const version = versionOf(withRows, stampOf);
			const standings = memo(derivedCache, `division/${entry.sport}/${entry.code}/${season}`, version,
				() => computeStandings(withRows, { season: Number(season) }));
			if (!standings.groups.length) return null;
			// Mark the club whose page this is, and link the ones this deployment
			// actually serves. A club with no manifest has no page here, and a
			// link to one would be a 404 inside a table.
			for (const line of standings.groups[0].clubs) {
				line.here = line.teamId === entry.teamId && line.sport === entry.sport;
				const served = line.teamId ? table.find((e) => e.sport === line.sport && e.teamId === line.teamId) : null;
				line.url = served?.available ? (served.base || '/') : null;
			}
			return standings;
		}
		const table = routeTable(scope, resolved);
		let available = table.filter((e) => e.available);

		// Say what is missing every time, at boot. A scope of sixteen clubs
		// serving two is a legitimate state of this repo today and an illegitimate
		// one in production, and the difference is whether anybody was told.
		console.log(`  build        ${BUILD}`);
		console.log(`  scope        ${process.env.SCOPE}`);
		console.log(`  clubs        ${available.length} of ${table.length} available`);
		for (const e of table.filter((e) => !e.available)) {
			console.log(`  missing      ${e.sport}/${e.code} — ${e.teamId ? 'manifest, but no games in the database' : 'no manifest'}`);
		}
		// Not fatal, deliberately, and this is a reversal: the first version
		// exited here. A configuration error and a data gap are different
		// problems — a misspelled scope cannot be fixed by running a build, and
		// a club that has not been built yet is the normal state of this repo.
		// Exiting made the /healthz 503 branch unreachable and turned a
		// readable "these clubs are missing" into a crash loop, where the reason
		// is one restart back in the logs.
		//
		// So: config errors die above, data gaps serve and report unhealthy.
		if (!available.length) {
			console.error('  UNHEALTHY    no club in scope has games in the database; run: npm run load <sport>');
		}
		// Health means "my dependencies are up", not "my data is complete".
		//
		// This is a fix, and the bug it fixes was mine. Health used to require at
		// least one available club, which sounds reasonable and is not: an
		// orchestrator gates a deployment on the health check, so a container
		// reporting unhealthy is a failed deploy that gets rolled back. With an
		// empty database that means the app can never be deployed — and the app
		// is not how the database gets filled, so there is no way out of it. A
		// real deployment failed exactly this way, and the container never left
		// `starting` before going `unhealthy`.
		//
		// So an unreachable database is unhealthy, because nothing can be served
		// without it. A reachable database with no rows yet is healthy and says
		// so loudly at boot and in /healthz — the same distinction between a
		// configuration error and a data gap that the rest of this file draws.
		//
		// STRICT_SCOPE=1 restores the strict reading for a deployment that means
		// to promise its whole scope, where a partial answer is worse than none.
		const strict = process.env.STRICT_SCOPE === '1';
		const healthy = () => dbHealth.ok && (!strict || available.length === table.length);

		/** Bring every entry's franchise and availability up to date.
		 *
		 *  Called once per request, and cheap: the availability map is cached for
		 *  thirty seconds, and a franchise is resolved only while it is still
		 *  null — which is only before the first successful load.
		 *
		 *  This used to happen for the one club being requested, which fixed the
		 *  club route and nothing else. After a load, /nfl/packers rendered
		 *  correctly while /healthz said "0 of 62 available" and the selector
		 *  showed every club as not built. The pages worked and everything that
		 *  described them was wrong, which is worse than either alone.
		 */
		// Keep the season being played current, from inside the server.
		//
		// The two live sites fetch ESPN from the browser on every page load, so
		// they are never stale; this repo reads only from the database and was
		// therefore exactly as fresh as the last time somebody ran the loader.
		// That is a regression against the sites this replaces.
		//
		// The request path still never calls out. This writes to Postgres on a
		// timer and the game cache picks the rows up on its own, because it is
		// already keyed on max(observed_at).
		//
		// LIVE_REFRESH_MS=0 turns it off, which is what a deployment wants if it
		// runs the loader on a schedule of its own.
		const liveEvery = Number(process.env.LIVE_REFRESH_MS ?? 60_000);
		const adapters = await loadSports();
		const liveSports = [...new Set(resolved.map((e) => e.sport))]
			.filter((id) => adapters[id]?.sources?.live);
		if (liveEvery > 0 && liveSports.length && dbHealth.ok) {
			const tick = async () => {
				for (const id of liveSports) {
					try {
						await withClient((client) => withLock(client, lockKeyFor(id), async () => {
							const r = await refreshLive(client, id, adapters[id]);
							if (r.written) console.log(`  live         ${id} ${r.season}: ${r.written} rows`);
							for (const f of r.failed ?? []) console.error(`  live         ${id} ${f}`);
							return r;
						}));
					} catch (e) {
						// A refresh that fails must not take the server with it.
						// The pages keep serving whatever the database holds.
						console.error(`  live         ${id} refresh failed: ${e.message}`);
					}
				}
			};
			// Self-scheduling rather than a fixed interval, because how often this
			// is worth doing depends on whether anything is being played. A
			// season is six months of the year and a game day a few hours of it;
			// polling every two minutes in February is nine requests to learn
			// nothing. `liveEvery` is the LIVE rate — the others are derived.
			let timer = null;
			const schedule = (ms, why) => {
				timer = setTimeout(loop, ms);
				// Never hold the process open: a container should stop when told
				// to, not wait out the interval.
				timer.unref();
				return why;
			};
			const loop = async () => {
				await tick();
				try {
					const next = await withClient((client) => nextDelay(client, liveSports[0], { live: liveEvery }));
					schedule(next.ms, next.why);
				} catch {
					schedule(liveEvery, 'could not read the schedule');
				}
			};
			console.log(`  live         refreshing ${liveSports.join(', ')}, ${Math.round(liveEvery / 1000)}s while games are on`);
			loop();
		}

		let refreshedAt = 0;
		async function refresh(now) {
			if (now - refreshedAt < 30_000) return;
			refreshedAt = now;
			const live = await availability(now);
			for (const e of table) {
				// `e.franchise` comes from the checkout now and is already set for
				// every club with a manifest, so there is nothing to resolve late.
				// It used to be read from the database here, which meant a club
				// booted against an empty database stayed unresolved forever.
				// A club whose games are split across an alias stays unavailable until
			// the load is re-run. Without this the boot-time marking lasted until
			// the first request and was then silently undone here — measured: the
			// log said STALE and /raiders answered 200 with half a history.
			if (e.stale) { e.available = false; continue; }
			if (e.franchise) e.available = (live.get(`${e.sport}/${e.franchise}`) ?? 0) > 0;
			}
			available = table.filter((e) => e.available);
		}

		const server = createServer(async (req, res) => {
			// Before anything reads `available`, including /healthz and the
			// selector.
			if (dbHealth.ok) await refresh(Date.now());
			const url = new URL(req.url, 'http://placeholder');
			const origin = originOf(req);

			if (url.pathname === '/healthz') {
				// Queried live, every time. It used to report the value captured
				// at boot, which meant a database that died afterwards was
				// invisible: the container stayed healthy while every request
				// failed. A health check reporting a cached success is the exact
				// failure this project keeps finding — a check that passes
				// because it is not looking at anything.
				const now = await health();
				const ok = now.ok && (!strict || available.length === table.length);
				return json(res, ok ? 200 : 503, {
					ok,
					build: BUILD,
					database: now.ok ? { games: now.games, migrations: now.migrations } : { error: now.error },
					strict,
					scope: process.env.SCOPE,
					inScope: table.length,
					// Availability is still measured at boot. A club gaining rows
					// while the process runs will not show until a restart, which
					// is the same staleness the per-franchise game cache has and
					// wants the same fix.
					available: available.length,
					missing: table.filter((e) => !e.available).map((e) => `${e.sport}/${e.code}`),
				});
			}

			// The selector. Only exists when the scope holds more than one club;
			// a single-club scope serves that club at the root instead.
			const clubList = () => table.map((e) => ({
				teamId: e.teamId, sport: e.sport, code: e.code,
				name: clubFor(e)?.nouns.fullName ?? namers[e.sport](e.code).name,
				available: e.available,
				url: e.available ? `${origin}${e.base}` : null,
			}));

			if (url.pathname === '/' && needsSelector(table)) {
				const clubs = table.map((e) => ({
					team: e.teamId, sport: e.sport, code: e.code,
					// The manifest's own name when there is one, because a club
					// that has been given a manifest has been given a preferred
					// name; the reference table otherwise.
					name: clubFor(e)?.nouns.fullName ?? namers[e.sport](e.code).name,
					conference: e.conference ?? null, division: e.division ?? null,
					available: e.available,
					url: e.available ? `${origin}${e.base}` : null,
				}));
				if (wantsJson(url)) return json(res, 200, { scope: process.env.SCOPE, clubs });
				return html(res, 200, selectorPage({
					scope: process.env.SCOPE,
					clubs,
					colors: NEUTRAL,
					heading: scopeHeading(scope, table),
					// The root is where anyone lands, and the league pages were
					// reachable only by typing their paths.
					nav: leagueNav('clubs'),
				}));
			}

			// League routes, optionally qualified by sport.
			//
			//   /records            /schedule            /schedule/2025
			//   /nfl/records        /nfl/schedule        /nfl/schedule/2025
			//
			// The qualified form exists because an `all` scope covers two sports
			// and stacking both on one page made it long and unbookmarkable. The
			// unqualified form still works and shows the first sport, with tabs.
			//
			// A sport prefix is only recognised when the scope actually holds
			// that sport, so `/nfl/records` under SCOPE=sport:mlb is a 404 rather
			// than an empty page — and it cannot shadow a club, because a club's
			// path under a multi-sport scope is /{sport}/{club} and no club is
			// called "records" or "schedule".
			const inScopeSports = [...new Set(table.map((e) => e.sport))];
			const leagueRoute = (() => {
				// The fourth segment is the schedule's period — `w3`, `d2026-08-29`,
				// the period's own key. Only the schedule takes one; /records/2011
				// and /standings/2011 are whole seasons by definition.
				const m = url.pathname.match(/^(?:\/([a-z0-9]+))?\/(records|schedule|standings)(?:\/(\d{4})(?:\/([wd][\w-]+))?)?$/);
				if (!m) return null;
				const [, sport, view, season, period] = m;
				if (period && view !== 'schedule') return null;
				if (sport && !inScopeSports.includes(sport)) return null;
				if (view === 'records' && season) return null;
				return { sport: sport ?? null, view, season: season ?? null, period: period ?? null };
			})();

			// Where every club finished, for one season. Computed from games rather
			// than fetched: the baseball site pulls ESPN's standings endpoint into
			// a modal and can only ever show the season being played.
			if (leagueRoute?.view === 'standings' && needsSelector(table)) {
				const withGames = table.filter((e) => e.available && e.teamId);
				const wanted = leagueRoute.sport
					? [leagueRoute.sport]
					: [...new Set(withGames.map((e) => e.sport))];
				// Lazy, as on /records: nothing reads a game row unless a summary
				// is missing.
				let loaded = null;
				const clubRows = async () => (loaded ??= await Promise.all(
					withGames.map(async (e) => ({ ...e, team: clubFor(e), rows: await games(e) }))));
				const version = await summaryVersion(withGames);
				const bySport = await Promise.all(wanted.map(async (sport) => {
					const inSport = () => clubRows().then((all) => all.filter((c) => c.team?.sport === sport));
					// Stored too, and not only memoised. Picking the default season
					// needs to know which seasons were played, and computing THAT
					// reads every row — so a stored standings table would still have
					// been paid for with a full read before it could be looked up.
					const years = await summarised(`seasons/${sport}`,
						{ scope: scopeKey, sport, view: 'seasons' }, version,
						async () => playedSeasons(await inSport()));
					const season = leagueRoute.season ? Number(leagueRoute.season) : years.at(-1);
					return {
						label: sport.toUpperCase(),
						seasons: years,
						// Keyed by season, because they go stale on different
						// schedules: 2011 never moves again and the season being
						// played moves every time a game ends.
						standings: await summarised(`standings/${sport}/${season}`,
							{ scope: scopeKey, sport, view: 'standings', season: season ?? 0 }, version,
							async () => computeStandings(await inSport(), { season })),
					};
				}));
				const [firstSport, ...otherSports] = bySport;
				if (wantsJson(url)) {
					return json(res, 200, bySport.length > 1
						? Object.fromEntries(bySport.map((g) => [g.label.toLowerCase(), g.standings]))
						: firstSport.standings);
				}
				return html(res, 200, standingsPage({
					standings: firstSport.standings,
					// Every season either sport played, so the nav still steps
					// through years the other one has and this one does not.
					seasons: otherSports.length
						? [...new Set(bySport.flatMap((g) => g.seasons))].sort((a, b) => a - b)
						: firstSport.seasons,
					season: leagueRoute.season ? Number(leagueRoute.season) : null,
					label: firstSport.label,
					more: otherSports,
					heading: scopeHeading(scope, table),
					colors: NEUTRAL,
					clubs: clubList(),
					base: leagueRoute.sport ? `/${leagueRoute.sport}` : '',
					tabs: sportTabs(inScopeSports, leagueRoute.sport, 'standings'),
					switcher: clubSwitcher(clubList(), null, ''),
				}));
			}

			// A whole league's season, week by week. Same rule as /records: only
			// where the scope holds more than one club, since under
			// SCOPE=team:packers the root is already that club's schedule.
			const sched = leagueRoute?.view === 'schedule' ? leagueRoute.season : undefined;
			if (sched !== undefined && needsSelector(table)) {
				const withGames = table.filter((e) => e.available && e.teamId);
				// LAZY. Loading every club's games is 471,453 rows and about a
				// second and a half, and it was happening before anything asked
				// whether the answer was already stored — so a stored summary saved
				// the 400ms computation and none of the read that preceded it.
				// Nothing here touches a game row unless a summary is missing.
				let loaded = null;
				const clubRows = async () => (loaded ??= await Promise.all(
					withGames.map(async (e) => ({ team: clubFor(e), rows: await games(e) }))));
				// One schedule per sport, each grouped by its own unit. Football
				// plays a round a week and baseball plays most days, and a mixed
				// scope used to take the first club's rule for everything — so an
				// `all` scope put 22 NFL week-periods and 209 MLB date-periods in
				// one list, sorted against each other.
				const wanted = leagueRoute.sport ? [leagueRoute.sport] : [...new Set(withGames.map((e) => e.sport))];
				const version = await summaryVersion(withGames);
				// Today, for choosing which period to open on. Read once for the
				// page so two sports cannot land on different days.
				const today = todayLocal();
				const showAll = url.searchParams.get('all') === '1';
				const bySport = wanted.map((sport) => {
					const inSport = clubs.filter((c) => c.team?.sport === sport);
					const period = inSport[0]?.team?.rules.schedulePeriod ?? 'week';
					// The season is memoised whole and the period picked from it.
					// Keying the memo on the period instead would hold one entry
					// per day of a baseball season — 184 of them — to save a
					// findIndex.
					const schedule = memo(derivedCache, `schedule/${sport}/${sched ?? 'latest'}`, version,
						() => computeSchedule(inSport, { season: sched, period }));
					// A period is named for ONE sport, so it only selects on that
					// sport's block. On the combined page football opens on its own
					// current week and baseball on its own current day.
					const wantKey = leagueRoute.sport === sport ? leagueRoute.period : null;
					const picked = selectPeriod(schedule.periods, { key: wantKey, today });
					return {
						label: sport.toUpperCase(),
						periodNoun: period === 'week' ? 'Week' : 'Games',
						// This sport's namer. Taking one for the whole page
						// resolved baseball codes against the football table.
						resolve: namers[sport],
						// Each block's period nav points at its own sport, never at
						// the combined URL, where week 3 would mean two things.
						base: leagueRoute.sport ? `/${leagueRoute.sport}` : `/${sport}`,
						unknownPeriod: Boolean(picked.unknown),
						schedule: { ...schedule, period: picked.period, index: picked.index },
					};
				});
				// A URL naming a period the season does not have is a broken link
				// or a changed season. Serving week 1 under it would be the kind of
				// plausible wrong answer this repo keeps finding.
				const missing = bySport.find((g) => g.unknownPeriod);
				if (missing) {
					// Listing what there IS beats a bare 404, the same as an
					// unknown head-to-head opponent does.
					return json(res, 404, {
						error: 'no such period',
						period: leagueRoute.period,
						season: missing.schedule.season,
						periods: missing.schedule.periods.map((p) => p.key),
					});
				}
				const [firstSport, ...otherSports] = bySport;
				const schedule = firstSport.schedule;
				if (wantsJson(url)) {
					// Keyed by sport in JSON too, rather than one merged list that
					// a reader would have to unpick.
					return json(res, 200, bySport.length > 1
						? Object.fromEntries(bySport.map((g) => [g.label.toLowerCase(), g.schedule]))
						: schedule);
				}
				return html(res, 200, leagueSchedulePage({
					schedule,
					heading: scopeHeading(scope, table),
					colors: NEUTRAL,
					resolve: firstSport.resolve,
					clubs: clubList(),
					periodNoun: firstSport.periodNoun,
					label: firstSport.label,
					more: otherSports,
					tabs: sportTabs(inScopeSports, leagueRoute.sport, 'schedule'),
					// The season nav builds its links from this. Left empty, a
					// sport-qualified page linked back to the unqualified one and
					// silently dropped the sport on every season change.
					base: leagueRoute.sport ? '/' + leagueRoute.sport : '',
					all: showAll,
					switcher: clubSwitcher(clubList(), null, ''),
				}));
			}

			// League-wide records, at the scope root. Only where the scope holds
			// more than one club: under SCOPE=team:packers the root IS the
			// Packers and /records is already their record book, so a league
			// view there would be the same page under a second name.
			if (leagueRoute?.view === 'records' && needsSelector(table)) {
				const withGames = table.filter((e) => e.available && e.teamId);
				// LAZY. Loading every club's games is 471,453 rows and about a
				// second and a half, and it was happening before anything asked
				// whether the answer was already stored — so a stored summary saved
				// the 400ms computation and none of the read that preceded it.
				// Nothing here touches a game row unless a summary is missing.
				let loaded = null;
				const clubRows = async () => (loaded ??= await Promise.all(
					withGames.map(async (e) => ({ team: clubFor(e), rows: await games(e) }))));
				// One league per sport, never merged. A scope spanning both used
				// to rank football seasons against baseball ones and print a note
				// admitting the lists compared clubs that never played each
				// other — the note was true and the page was still a pile.
				//
				// It also fixes a rule that had to be fudged: streaks span
				// seasons in football and not in baseball, and a merged league
				// had to pick one. Per sport, each uses its own.
				// Named sport, or every sport in scope. Naming one is what makes
				// /nfl/records a page rather than a section of a longer one.
				const sports = leagueRoute.sport
					? [leagueRoute.sport]
					: [...new Set(withGames.map((e) => e.sport))];
				const version = await summaryVersion(withGames);
				const leagues = await Promise.all(sports.map(async (sport) => {
					const inSport = () => clubRows().then((all) => all.filter((c) => c.team?.sport === sport));
					return {
						// The scope's own word for the sport, uppercased: NFL, MLB,
						// and NBA or MLS when those arrive. The adapter's `name` is
						// "football" and "baseball", which reads oddly as a heading
						// over a table of clubs.
						label: sport.toUpperCase(),
						resolve: namers[sport],
						// Memoised on the clubs' own row stamps. 232ms of the
						// 235ms this route cost warm was this call, recomputed
						// per request over rows that had not changed.
						league: await summarised(`records/${sport}`,
							{ scope: scopeKey, sport, view: 'records' }, version,
							async () => {
								const set = await inSport();
								return computeLeague(set, {
									top: 10,
									// Each sport's own rule now, rather than one
									// picked for a merged league: streaks span
									// seasons in football and stop at the boundary
									// in baseball.
									streaksSpanSeasons: set[0]?.team?.rules.streaksSpanSeasons ?? true,
								});
							}),
					};
				}));
				const [first, ...rest] = leagues;
				const league = first.league;
				// The first league needs its label too. Passing only the REST of
				// them left the primary block headed "League" while the second
				// said "MLB" — the label was computed and then dropped.
				const label = first.label;
				if (wantsJson(url)) return json(res, 200, league);
				return html(res, 200, leagueRecordsPage({
					league,
					resolve: first.resolve,
					heading: scopeHeading(scope, table),
					colors: NEUTRAL,
					clubs: clubList(),
					more: rest,
					label,
					tabs: sportTabs(inScopeSports, leagueRoute.sport, 'records'),
					// The first BLOCK's namer, not the first club's. Under a
					// mixed scope those differ, and every block carries its own.
					resolve: first.resolve,
					// The same control a club page carries, so a league page is
					// not a dead end for anyone wanting one club.
					switcher: clubSwitcher(clubList(), null, ''),
				}));
			}

			const match = matchRoute(url.pathname, table);
			if (!match) return json(res, 404, { error: 'no such path', path: url.pathname });

			const { entry, rest } = match;
			if (!entry.available) {
				return json(res, 503, {
					error: 'club is in scope but has no games in the database',
					team: entry.teamId, code: entry.code,
					fix: entry.teamId ? `npm run load ${entry.sport}` : `write teams/<id>.js for ${entry.code}`,
				});
			}

			const view = parseView(rest);
			if (!view) return json(res, 404, { error: 'no such view', path: url.pathname });

			// What the switcher appends to another club's base, so switching
			// keeps you on the page you were on. A season is included: comparing
			// the same year across clubs is exactly what someone switching from a
			// season page wants, and a club that did not exist then gets a page
			// that says so rather than a bare 404.
			const here = rest === '/' ? '' : rest;

			/** Everything a club page shows, for one season.
			 *
			 *  Shared by the front page (the latest season) and /{season}, so the
			 *  two cannot drift into showing different things about the same
			 *  club — which is how the football site ended up with a front page
			 *  and a season page that disagreed.
			 */
			const renderSeason = async (season) => {
				const team = clubFor(entry);
				const all = await games(entry);
				const allSeasons = seasons(all);
				const rows = all.filter((g) => g.season === season);
				if (!rows.length) return null;

				const played = rows.filter((g) => g.result);
				const isPastSeason = rows.every((g) => g.result !== '');
				const tally = seasonTally(rows, team);
				const verdict = seasonVerdict({
					...tally,
					isPastSeason,
					// Four states, not three: the deep offseason reads differently
					// from the week before the opener, and the data already knows
					// when the next game is.
					daysToNextGame: daysToNextGame(all, new Date()),
				});

				// Opponent names are resolved here because resolution is per
				// sport and dated: a 1969 Brewers opponent is not called what it
				// is called now, and the renderer should not know that.
				const resolve = namers[entry.sport];
				// All-time head-to-head, from the club's own rows. The baseball
				// site puts this under every opponent on the schedule.
				const series = seriesRecords(all);
				const withNames = rows.map((g) => ({
					...g,
					// Season and date both: football's history is keyed on seasons
					// and baseball's on dates, and an NFL season crosses the new
					// year, so neither can be derived from the other.
					opponentName: resolve(g.Opponent, { season: g.season, date: g.date }).name,
					seriesRecord: series.get(g.Opponent) ?? null,
				}));

				const allPlayed = all.filter((g) => g.result);
				return clubPage({
					team,
					season,
					tally,
					verdict,
					answer: verdictText(verdict, team),
					recordLabel: recordText(tally),
					// The division table behind the record. Absent for a club with
					// no division on record or a season it did not play, which is
					// what keeps the record from linking to an empty box.
					standings: standingsModal({
						standings: await divisionStandings(entry, season),
						season,
						// The same caveat the standings page carries: divisions
						// here are today's, so a 1962 table is grouped by an
						// arrangement that season never had.
						caveat: true,
					}),
					// The club's colours for the season being rendered, so a
					// 1950s page uses the green they used then. A manifest may
					// override; most no longer need to.
					// Both sports key differently — football on the season,
					// baseball on the date — so both are passed and each
					// resolver takes what it needs.
					colors: team.colors ?? colorsFor(resolve, entry.code, { season, date: rows[0]?.date }, NEUTRAL),
					banner: streakBanner(played.filter((g) => g.regular_season === '1'), { isPastSeason, team }),
					schedule: scheduleHtml(withNames, { heading: `${season} Season Schedule` }),
					nav: seasonNav(allSeasons, season, entry.base),
					siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
					spark: sparklineHtml(seasonWinPct(all)),
					switcher: clubSwitcher(clubList(), entry.teamId, here),
					updatedAt: (await lastUpdated(entry.sport, entry.franchise))?.toISOString().slice(0, 10) ?? null,
					lastLossless: lastLosslessSeason(all),
					allTime: {
						record: recordText({
							wins: allPlayed.filter((g) => g.result === 'WIN').length,
							losses: allPlayed.filter((g) => g.result === 'LOSS').length,
							ties: allPlayed.filter((g) => g.result === 'TIE').length,
						}),
						played: allPlayed.length,
						first: allSeasons[0],
						last: allSeasons.at(-1),
					},
				});
			};

			try {
				if (view.view === 'summary') {
					if (wantsJson(url)) return json(res, 200, await summary(entry, origin, entry.base));
					const latest = latestSeason(await games(entry));
					return html(res, 200, await renderSeason(latest.season));
				}
				if (view.view === 'season') {
					if (wantsJson(url)) {
						const rows = await games(entry, view.season);
						if (!rows.length) return json(res, 404, { error: 'no such season', season: view.season });
						return json(res, 200, { team: entry.teamId, season: view.season, games: rows });
					}
					const body = await renderSeason(view.season);
					if (body) return html(res, 200, body);
					// Reachable by switching clubs from a season page — the
					// Vikings have no 1929 — so it explains itself and offers the
					// seasons this club does have.
					const team = clubFor(entry);
					const all = seasons(await games(entry));
					return html(res, 404, missingSeasonPage({
						team,
						season: view.season,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: all.at(-1) }, NEUTRAL),
						base: entry.base,
						first: all[0],
						last: all.at(-1),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
					}));
				}
				if (view.view === 'history') {
					const team = clubFor(entry);
					const all = await games(entry);
					const records = computeRecords(all, { streaksSpanSeasons: team.rules.streaksSpanSeasons });
					const points = historyPoints(records.everySeason);
					if (wantsJson(url)) return json(res, 200, { seasons: points });
					const latest = latestSeason(all);
					return html(res, 200, historyPage({
						team,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL),
						points,
						base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
						updatedAt: await lastUpdated(entry.sport, entry.franchise),
					}));
				}
				if (view.view === 'records') {
					const team = clubFor(entry);
					const all = await games(entry);
					const records = computeRecords(all, {
						// Declared per sport: football's longest streak is 15
						// games across the 2010 and 2011 seasons, and ending runs
						// at the boundary would erase it. Baseball says the
						// opposite, on purpose.
						streaksSpanSeasons: team.rules.streaksSpanSeasons,
					});
					if (wantsJson(url)) return json(res, 200, records);
					const latest = latestSeason(all);
					return html(res, 200, recordsPage({
						team,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL),
						records,
						resolve: namers[entry.sport],
						base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
					}));
				}
				if (view.view === 'vs') {
					const team = clubFor(entry);
					const all = await games(entry);
					const h2h = computeHeadToHead(all);
					const resolve = namers[entry.sport];
					const colors = team.colors
						?? colorsFor(resolve, entry.code, { season: seasons(all).at(-1), date: all.at(-1)?.date }, NEUTRAL);
					const common = {
						team, colors, resolve, base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
					};

					if (!view.opponent) {
						if (wantsJson(url)) return json(res, 200, h2h.opponents);
						return html(res, 200, headToHeadPage({ ...common, opponents: h2h.opponents }));
					}

					const opponent = h2h.bySlug.get(view.opponent);
					if (!opponent) {
						return json(res, 404, {
							error: 'no such opponent',
							opponent: view.opponent,
							// A club they never played is a fair question with a
							// short answer, and listing the ones they did beats a
							// bare 404.
							played: h2h.opponents.map((o) => o.slug),
						});
					}
					if (wantsJson(url)) return json(res, 200, opponent);
					return html(res, 200, opponentPage({
						...common,
						opponent,
						name: resolve(opponent.code, { season: String(opponent.last.season), date: opponent.last.date }).name,
					}));
				}
				// history still needs porting. Saying so beats an empty 200 that
				// looks like a club with nothing to show.
				return json(res, 501, { error: `${view.view} is not ported yet` });
			} catch (e) {
				console.error(e);
				return json(res, 500, { error: e.message });
			}
		});

		server.listen(PORT, () => console.log(`  listening    http://127.0.0.1:${PORT}`));
		return server;
	});
}

// pathToFileURL, not string surgery on the path. An earlier guard in this repo
// compared a Windows path against a file:// URL by hand, matched nothing, and
// silently ran no main at all — the script "succeeded" by doing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
