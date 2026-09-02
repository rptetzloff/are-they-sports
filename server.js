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
import { filterGames, opponentDetail, computeHeadToHead } from './lib/headtohead.js';
import { computeRecords } from './lib/records.js';
import { computeLeague } from './lib/league.js';
import { computeSchedule, selectPeriod } from './lib/schedule.js';
import { computeStandings, divisionPeers, playedSeasons } from './lib/standings.js';
import { Lru, memo, mergeGames, versionOf } from './lib/derived.js';
import { historyPoints } from './lib/history.js';
import { codeTables, franchisesForClub, staleFranchises } from './lib/codes.js';
import { availability, championships, close, connect, franchisesWithGames, gamesFor, gamesSince, health, lastUpdated, lastUpdatedAll, leaderGames, leaderTenures, readSummary, withClient, writeSummary } from './lib/store.js';
import { lockKeyFor, nextDelay, refreshLive, withLock } from './lib/live.js';
import {
	daysToNextGame, lastLosslessSeason, latestSeason, recordText, seasons, seasonTally, seasonVerdict,
	seasonWinPct, seriesRecords, streakBanner, verdictText,
} from './lib/core.js';
import {
	ALL_TIME_COLUMNS, CHAMPION_COLUMNS, championsPage, historyColumns, standingsColumns,
	NEUTRAL, clubPage, clubSwitcher, noticePage, onThisDayPanel, questionFor, sharePanel, standingsModal, headToHeadPage, historyPage, leadersPage, leagueNav, leagueRecordsPage, leagueSchedulePage, sportTabs, missingSeasonPage, opponentPage, recordsPage, standingsPage,
	RECORD_SLUGS, recordCopy, h2hColumns,
	scheduleHtml, seasonNav, selectorPage, siteNav, sparklineHtml,
} from './lib/render.js';
import { colorsFor, currentFranchises, resolver } from './lib/names.js';
import { SPORTS, loadSports, loadTeams } from './lib/teams.js';
import { creditsFor } from './lib/credits.js';
import { describe, titleOf, withMeta } from './lib/meta.js';
import { cardSvg, fontsPresent, renderCard } from './lib/card.js';
import { shareLinks } from './lib/share.js';
import { onThisDay as onThisDayGames, summarise } from './lib/onthisday.js';
import { matchRoute, parseView, routeTable } from './lib/routes.js';
import { LEADERS_DEFAULT_SORT, leaderColumns, mergeLeaders, rankLeaders, tallyLeaders, tallyTenures } from './lib/leaders.js';
import { parseSort, sortRows } from './lib/sort.js';
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

/** Send a page, with its social metadata put in on the way out.
 *
 *  Injected here rather than threaded through the thirteen page functions,
 *  because a fourteenth page added later would silently have no tags -- and this
 *  repo has twice shipped a page missing something wired per call site: the
 *  leaders nav link answered 404 from every club page, and the data credit had
 *  to be added to two pages by hand.
 *
 *  The description defaults from the title the page already gave itself, so a
 *  route that says nothing still previews as something. A route that knows
 *  better passes its own.
 */
/** Send a PNG.
 *
 *  Cached hard, because a social card for a finished season never changes and
 *  every reader who sees a shared link fetches it. The season being played is
 *  the exception and gets a short cache, so a card does not go on claiming a
 *  record that has moved.
 */
const sendPng = (res, png, { immutable = false } = {}) => {
	res.writeHead(200, {
		'content-type': 'image/png',
		'content-length': png.length,
		'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
	});
	res.end(png);
};

const sendHtml = (res, code, body, meta = {}) => {
	const withTags = withMeta(body, { description: describe(titleOf(body)), ...meta });
	const buf = Buffer.from(withTags);
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
		const stamp = (await stampFor(entry.sport, entry.franchise))?.toISOString() ?? null;
		if (!hit) {
			rows = await gamesFor(entry.sport, entry.franchise);
			gameCache.set(key, { rows, stamp, checkedAt: now });
		} else if (stamp && hit.stamp && stamp > hit.stamp) {
			// Only what moved. A live refresh rewrites today's games every minute
			// during a season and each write sets observed_at, so a club playing
			// today looks changed once a minute — and re-reading its whole history
			// to pick that up is the waste this exists to avoid. The Brewers are
			// 9,229 rows and the feed touched one of them.
			rows = mergeGames(hit.rows, await gamesSince(entry.sport, entry.franchise, hit.stamp));
			gameCache.set(key, { rows, stamp, checkedAt: now });
		} else if (hit.stamp !== stamp) {
			// The stamp moved and did not move FORWARD, which means rows left:
			// max(observed_at) can only fall if the row holding it was deleted.
			// Nothing about a deletion can be inferred from the rows that remain,
			// so this reloads outright rather than merging.
			rows = await gamesFor(entry.sport, entry.franchise);
			gameCache.set(key, { rows, stamp, checkedAt: now });
		} else {
			hit.checkedAt = now;
		}
	}

	return season ? rows.filter((g) => g.season === season) : rows;
}

/** Fill the game cache before anyone asks for it.
 *
 *  Reading every club in scope is 489,184 rows and about two seconds, and the
 *  first visitor after a deploy paid all of it. That cost does not go away by
 *  being fast — a record book IS every game ever played — but it does not have
 *  to be paid by a person waiting for a page.
 *
 *  Runs after listen(), so the server is answering /healthz throughout and a
 *  deployment is not held open by it. Failures are logged and dropped: a warm
 *  that does not finish leaves the cache exactly as it was, and the request path
 *  fills it on demand the way it always did.
 *
 *  Concurrency of 8, not 62. Measured: sequential is 1,475ms and unbounded
 *  parallel is 1,056ms, which is a 29% saving for sixty-two simultaneous
 *  connections against a pool that also has to serve requests. Eight gets most of
 *  it and leaves the pool room to answer the pages this is meant to speed up.
 */
async function warmGames(entries) {
	const started = Date.now();
	const queue = [...entries];
	let done = 0;
	const worker = async () => {
		for (let e = queue.pop(); e; e = queue.pop()) {
			try { await games(e); done++; } catch (err) {
				console.error(`  warm         ${e.sport}/${e.franchise}: ${err.message}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(8, entries.length) }, worker));
	const rows = [...gameCache.values()].reduce((n, v) => n + v.rows.length, 0);
	console.log(`  warm         ${done} clubs, ${rows.toLocaleString()} rows in ${Date.now() - started}ms`);
}

/** Every franchise's stamp from one query, refreshed no more often than the
 *  cache checks.
 *
 *  This was one query per club, which is a cost that scales with the number of
 *  clubs rather than with what changed: 429ms for the 236 franchises that have
 *  games, paid on any league page whose check window had expired, before a
 *  single row was read. One query is 73ms.
 */
let stamps = { at: 0, byKey: new Map(), inFlight: null };
async function stampFor(sport, franchise) {
	const now = Date.now();
	if (now - stamps.at >= CACHE_CHECK_MS) {
		// Shared, so sixty clubs on one page do not each start their own scan. A
		// page resolves its clubs in a loop and every one of them would otherwise
		// see the window expired and issue the same query.
		if (!stamps.inFlight) {
			stamps.inFlight = lastUpdatedAll()
				.then((byKey) => { stamps = { at: Date.now(), byKey, inFlight: null }; })
				.catch((e) => { stamps.inFlight = null; throw e; });
		}
		await stamps.inFlight;
	}
	return stamps.byKey.get(`${sport}/${franchise}`) ?? null;
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

/** A league page with no clubs behind it, which is a database nobody has loaded.
 *
 *  Every league handler read `leagues[0].league` and crashed the PROCESS on a
 *  freshly migrated deployment — the request died, and so did every request
 *  after it. That has been true for as long as these routes have existed and
 *  nothing noticed, because no test had ever asked the server for a route; the
 *  renderers were all tested directly, and one of them even has an EMPTY_LEAGUE
 *  fixture proving it handles this case.
 *
 *  503, not an empty page. A scope resolving sixty-two clubs and finding games
 *  for none of them is the same data gap a club page reports, and this repo's
 *  rule is to report the gap rather than render something that looks complete
 *  and is empty. The message names the command that fixes it.
 */
const noClubsLoaded = (res, url, view) => (wantsJson(url)
	? json(res, 503, { error: 'no games loaded', view, run: 'npm run load <sport>' })
	: sendHtml(res, 503, noticePage({
		heading: 'No games loaded',
		message: 'No club in scope has any games in the database yet. Run npm run load <sport> to load them.',
		colors: NEUTRAL,
	})));

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
		// stampFor, not lastUpdated: one query for every franchise, shared and
		// refreshed no more often than the cache checks. Per club it was 62 round
		// trips on every league page — which showed up as a 50-100ms floor under
		// a page whose whole point is that it reads one row.
		const at = await stampFor(e.sport, e.franchise);
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
		// The franchises still playing, per sport, built once for the same reason
		// the resolvers are: it reads and indexes the whole history file, and the
		// head-to-head page would otherwise do that on every request.
		const currents = Object.fromEntries(SPORTS.map((s) => [s, currentFranchises(s)]));
		const currentOf = (sport) => currents[sport] ?? new Set();

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
			// Every page below sends through this, so every page gets a canonical
			// URL and og:url without asking. Absolute, and from PUBLIC_ORIGIN
			// where it is set: server.js already warns that without it any Host
			// header becomes canonical, which for a share card means a staging
			// deploy telling every reader that it IS the site.
			const html = (res2, code, body, meta = {}) =>
				sendHtml(res2, code, body, { url: `${origin}${url.pathname}`, ...meta });

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
			// The credits this deployment owes, from the sports in its scope. A
			// football-only site must not name Retrosheet: crediting a source you
			// do not use reads as carelessness, and a reader cannot tell it from
			// a false claim.
			const scopeCredits = creditsFor(
				[...new Set(table.map((e) => e.sport))].map((id) => adapters[id]).filter(Boolean));

			const clubList = () => table.map((e) => ({
				teamId: e.teamId, sport: e.sport, code: e.code,
				name: clubFor(e)?.nouns.fullName ?? namers[e.sport](e.code).name,
				available: e.available,
				url: e.available ? `${origin}${e.base}` : null,
				// What this club calls its leaders page. The switcher needs it
				// because that route, alone, is named by the sport.
				leaderPlural: clubFor(e)?.nouns.leaderPlural ?? null,
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
					credits: scopeCredits,
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
				const m = url.pathname.match(/^(?:\/([a-z0-9]+))?\/(records|schedule|standings|champions)(?:\/(\d{4})(?:\/([wd][\w-]+))?)?$/);
				if (!m) return null;
				const [, sport, view, season, period] = m;
				if (period && view !== 'schedule') return null;
				if (sport && !inScopeSports.includes(sport)) return null;
				// Neither of these is about one season: a record book and a list
				// of champions are both the whole history by definition.
				if ((view === 'records' || view === 'champions') && season) return null;
				return { sport: sport ?? null, view, season: season ?? null, period: period ?? null };
			})();

			// Every champion the league has had. The only page that reads the
			// championship table directly — the club record book and the history
			// chart read it through computeRecords.
			if (leagueRoute?.view === 'champions' && needsSelector(table)) {
				const withGames = table.filter((e2) => e2.available && e2.teamId);
				if (!withGames.length) return noClubsLoaded(res, url, 'champions');
				const wanted = leagueRoute.sport
					? [leagueRoute.sport]
					: [...new Set(withGames.map((e2) => e2.sport))];
				const all = [];
				for (const sport of wanted) {
					const resolve = namers[sport];
					// Names are resolved per sport AND per season, because a 1969
					// champion is not called what that franchise is called now.
					for (const c of await championships(sport)) {
						all.push({
							...c, sport,
							championName: resolve(c.champion, { season: String(c.season) }).name,
							runnerUpName: c.runnerUp
								? resolve(c.runnerUp, { season: String(c.season) }).name : null,
						});
					}
				}
				if (wantsJson(url)) return json(res, 200, { champions: all });
				return html(res, 200, championsPage({
					champions: all,
					heading: wanted.length === 1 ? `${wanted[0].toUpperCase()} champions` : 'Champions',
					colors: NEUTRAL,
					clubs: clubList(),
					tabs: sportTabs(inScopeSports, leagueRoute.sport, 'champions'),
					sort: parseSort(url.searchParams, CHAMPION_COLUMNS, null),
					path: url.pathname,
					params: url.searchParams,
				}));
			}

			// Where every club finished, for one season. Computed from games rather
			// than fetched: the baseball site pulls ESPN's standings endpoint into
			// a modal and can only ever show the season being played.
			if (leagueRoute?.view === 'standings' && needsSelector(table)) {
				const withGames = table.filter((e) => e.available && e.teamId);
				if (!withGames.length) return noClubsLoaded(res, url, 'standings');
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
					// Sorting is a query parameter, read here and drawn there.
					sort: parseSort(url.searchParams, standingsColumns(true), null),
					path: url.pathname,
					params: url.searchParams,
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
				if (!withGames.length) return noClubsLoaded(res, url, 'schedule');
				// LAZY. Loading every club's games is 471,453 rows and about a
				// second and a half, and it was happening before anything asked
				// whether the answer was already stored — so a stored summary saved
				// the 400ms computation and none of the read that preceded it.
				// Nothing here touches a game row unless a summary is missing.
				let loaded = null;
				const clubRows = async () => (loaded ??= await Promise.all(
					// The franchise travels with the club, because the
					// championship table records a winner as a franchise and the
					// club id alone is not unique across sports.
					withGames.map(async (e) => ({ team: clubFor(e), franchise: e.franchise, rows: await games(e) }))));
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
				const bySport = await Promise.all(wanted.map(async (sport) => {
					const inSport = () => clubRows().then((all) => all.filter((c) => c.team?.sport === sport));
					// The sport's own unit comes from a MANIFEST, not from rows, so
					// asking for it must not drag the whole season into memory. Any
					// club of that sport answers it, and the scope's table has them
					// without a query.
					const period = clubFor(withGames.find((e) => e.sport === sport))?.rules.schedulePeriod ?? 'week';
					// The season is stored whole and the period picked from it.
					// Keying on the period instead would hold one row per day of a
					// baseball season — 184 of them — to save a findIndex.
					const schedule = await summarised(`schedule/${sport}/${sched ?? 'latest'}`,
						{ scope: scopeKey, sport, view: 'schedule', season: sched ?? 0 }, version,
						async () => computeSchedule(await inSport(), { season: sched, period }));
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
				}));
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
				if (!withGames.length) return noClubsLoaded(res, url, 'records');
				// LAZY. Loading every club's games is 471,453 rows and about a
				// second and a half, and it was happening before anything asked
				// whether the answer was already stored — so a stored summary saved
				// the 400ms computation and none of the read that preceded it.
				// Nothing here touches a game row unless a summary is missing.
				let loaded = null;
				const clubRows = async () => (loaded ??= await Promise.all(
					// The franchise travels with the club, because the
					// championship table records a winner as a franchise and the
					// club id alone is not unique across sports.
					withGames.map(async (e) => ({ team: clubFor(e), franchise: e.franchise, rows: await games(e) }))));
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
								// The championship table, grouped by franchise.
								// Without it this card counts only titles decided
								// by a GAME, which for football means every season
								// before 1933 is missing: it read "Packers 10"
								// against thirteen, and "Bears 7" against nine,
								// with the finals lost beside them counted across
								// every era. Twelve NFL seasons were decided on the
								// final standings and one by a tie-breaking
								// playoff; `data/reference/nfl-champions.csv` is
								// where they live.
								const byFranchise = new Map();
								for (const t of await championships(sport)) {
									if (!byFranchise.has(t.champion)) byFranchise.set(t.champion, []);
									byFranchise.get(t.champion).push(t);
								}
								return computeLeague(set, {
									championships: byFranchise,
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
					// Sorting is a query parameter, read here and drawn there.
					sort: parseSort(url.searchParams, ALL_TIME_COLUMNS, null),
					path: url.pathname,
					params: url.searchParams,
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

			// The leaders route is named by the sport — `/coaches` or
			// `/managers` — so the club has to be resolved before the path can be
			// parsed. Every other view has a fixed name and does not care.
			const view = parseView(rest, { leaderPlural: clubFor(entry)?.nouns?.leaderPlural });
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
				// What this club did on today's date in other years. Needs only
				// games, and the window is the sport's own rule: exact for
				// baseball, three days either side for football, because a
				// seventeen-game season has empty calendar dates by the hundred.
				//
				// The clock is read HERE and passed in, so the compute function
				// can be tested on a year boundary without waiting for December.
				// UTC, because a game's date is a plain YYYY-MM-DD and reading it
				// in a timezone behind Greenwich moves every game a day earlier.
				const todayIso = new Date().toISOString().slice(0, 10);
				const otdGames = onThisDayGames(all, {
					today: todayIso,
					windowDays: team.rules.onThisDayWindowDays ?? 0,
					currentSeason: season,
				});
				const otd = onThisDayPanel({
					games: otdGames,
					summary: summarise(otdGames),
					today: todayIso,
					team,
					base: entry.base,
					resolve: namers[entry.sport],
					windowDays: team.rules.onThisDayWindowDays ?? 0,
				});

				// The one page that can describe itself better than a derivation
				// can: it knows the question and the answer. "Are the Packers
				// Undefeated? NO. 2011 Record: 15-1" is what a reader in a group
				// chat needs to see, and no title-derived sentence produces it.
				const answerText = verdictText(verdict, team);
				const record = recordText(tally);
				const shareDescription =
					`${answerText}. ${season} record ${record}.`
					+ (tally.postseason ? ` Postseason ${tally.postseason.w}-${tally.postseason.l}.` : '');

				// Sharing this page shares what it says: the question is the title
				// and the answer is the text, which is the same pair the og tags
				// and the card carry. Three places, one source, so a shared link
				// cannot say something the page does not.
				const pageUrl = `${origin}${entry.base}`;
				const share = sharePanel({
					url: pageUrl,
					links: shareLinks({
						url: pageUrl,
						title: questionFor(team),
						text: shareDescription,
					}),
				});

				return { description: shareDescription, body: clubPage({
					credits: scopeCredits,
					onThisDay: otd,
					share,
					team,
					season,
					tally,
					verdict,
					answer: verdictText(verdict, team),
					recordLabel: record,
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
				}) };
			};

			try {
				if (view.view === 'summary') {
					if (wantsJson(url)) return json(res, 200, await summary(entry, origin, entry.base));
					const latest = latestSeason(await games(entry));
					const page = await renderSeason(latest.season);
					return html(res, 200, page.body, {
						description: page.description,
						// The card for THIS page, so a shared link shows the answer
						// it is about rather than a house image.
						image: `${origin}${entry.base}/og/default.png`,
					});
				}
				if (view.view === 'season') {
					if (wantsJson(url)) {
						const rows = await games(entry, view.season);
						if (!rows.length) return json(res, 404, { error: 'no such season', season: view.season });
						return json(res, 200, { team: entry.teamId, season: view.season, games: rows });
					}
					const page = await renderSeason(view.season);
					if (page) {
						return html(res, 200, page.body, {
							description: page.description,
							image: `${origin}${entry.base}/og/${view.season}.png`,
						});
					}
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
					// The club's own titles, including the ones no game can show.
					// Without them the history chart marks three Packers
					// championships where there are six.
					const clubTitles = await championships(entry.sport, [entry.franchise]);
					const records = computeRecords(all, {
						streaksSpanSeasons: team.rules.streaksSpanSeasons,
						titles: clubTitles.filter((t) => t.champion === entry.franchise),
					});
					const points = historyPoints(records.everySeason);
					if (wantsJson(url)) return json(res, 200, { seasons: points });
					const latest = latestSeason(all);
					return html(res, 200, historyPage({
					// Sorting is a query parameter, read here and drawn there.
					sort: parseSort(url.searchParams, historyColumns(clubFor(entry)), null),
					path: url.pathname,
					params: url.searchParams,
						team,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL),
						points,
						base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
						updatedAt: await lastUpdated(entry.sport, entry.franchise),
					}));
				}
				if (view.view === 'card') {
					// A card says what its page says. The words come from the same
					// values the page renders, so the two cannot drift into
					// describing different things.
					const team = clubFor(entry);
					const all = await games(entry);
					const latest = latestSeason(all);
					const colors = team.colors
						?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL);

					const season = view.card === 'default'
						? latest?.season
						: (/^\d{4}$/.test(view.card) ? view.card : null);

					let question = questionFor(team);
					let answer = '';
					let record = '';
					let sub = null;

					if (season) {
						const rows = all.filter((g) => g.season === season);
						// A season this club never played has no card. Better a 404
						// than a picture of an empty record.
						if (!rows.length) return json(res, 404, { error: 'no such season', season });
						const tally = seasonTally(rows, team);
						const verdict = seasonVerdict({
							...tally,
							isPastSeason: rows.every((g) => g.result !== ''),
							daysToNextGame: daysToNextGame(all, new Date()),
						});
						answer = verdictText(verdict, team);
						record = `${season} Record: ${recordText(tally)}`;
						if (tally.postseason) sub = `Postseason ${tally.postseason.w}-${tally.postseason.l}`;
					} else {
						// The fixed pages. The card names the page rather than
						// answering the club's question, because "NO" over a record
						// book is an answer to something nobody asked.
						const LABEL = {
							records: 'Records', history: 'History', vs: 'Head-to-Head',
							[team.nouns.leaderPlural]: team.nouns.leaderPlural.replace(/^./, (c) => c.toUpperCase()),
						};
						question = team.nouns.fullName;
						answer = LABEL[view.card] ?? view.card;
						record = `${seasons(all)[0]}–${seasons(all).at(-1)}`;
					}

					const svg = cardSvg({
						question, answer, record, sub, colors,
						footer: new URL(origin).host,
					});
					// A finished season never changes; the one being played does.
					const settled = season && season !== latest?.season;
					return sendPng(res, await renderCard(svg), { immutable: Boolean(settled) });
				}
				if (view.view === 'leaders') {
					const team = clubFor(entry);
					const all = await games(entry);
					// One club, so the franchise list is one long — and it still
					// goes in as a list, because the same query serves a league
					// scope where a leader who led two clubs is one person.
					const [gameRows, tenures] = await Promise.all([
						leaderGames(entry.sport, [entry.franchise]),
						leaderTenures(entry.sport, [entry.franchise]),
					]);
					const merged = mergeLeaders(tallyLeaders(gameRows), tallyTenures(tenures));
					// Which optional columns exist depends on the rows: a club with no
					// ties, no postseason and no titles should not be handed three empty
					// columns to sort by. The renderer reads the same list for its body
					// cells, so the header and the rows cannot disagree.
					const columns = leaderColumns({
						ties: merged.some((r) => r.t > 0),
						post: merged.some((r) => r.playoffW || r.playoffL),
						titles: merged.some((r) => r.titles.length),
						leaderNoun: team.nouns.leaderPlural.replace(/e?s$/, '')
							.replace(/^./, (c) => c.toUpperCase()),
					});
					const sort = parseSort(url.searchParams, columns, LEADERS_DEFAULT_SORT);
					// Chronological by default, earliest first, because this page is a
					// list of everyone who held the job rather than a ranking. It was
					// most wins first. `rankLeaders` still exists and still means that,
					// and is now one click away rather than the only order there is.
					//
					// Tie-broken on the leader id so the order is total: two rows equal
					// on the sorted column would otherwise fall back to whatever order
					// the query returned, and reshuffle between requests.
					const ranked = sortRows(merged, columns, sort, (r) => r.leader);
					if (wantsJson(url)) {
						return json(res, 200, {
							sort,
							leaders: ranked.map((r) => ({ ...r, seasons: undefined, champ: undefined })),
						});
					}
					const latest = latestSeason(all);
					// The gap, said on the page. A club whose games start well
					// before its leaders do is not showing its whole history, and
					// a table that quietly begins in 1999 looks complete.
					const firstGame = seasons(all)[0];
					const firstLeader = ranked.length ? Math.min(...ranked.map((r) => r.firstSeason)) : null;
					const note = firstLeader != null && firstGame != null && firstLeader > firstGame
						? `Games are on record from ${firstGame}, but ${team.nouns.leaderPlural} only from ${firstLeader}.`
						: null;
					return html(res, 200, leadersPage({
						team,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL),
						leaders: ranked,
						base: entry.base,
						note,
						columns,
						sort,
						path: url.pathname,
						params: url.searchParams,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						// Per club, not one path for all of them: switching from
						// the Packers' coaches to the Brewers must land on
						// `/managers`, which is what that club calls the same
						// page. A club whose manifest is missing goes to its
						// front page rather than to a route that does not exist.
						switcher: clubSwitcher(clubList(), entry.teamId,
							(c) => (c.leaderPlural ? `/${c.leaderPlural}` : '')),
					}));
				}
				if (view.view === 'records') {
					const team = clubFor(entry);
					const all = await games(entry);
					const won = await championships(entry.sport, [entry.franchise]);
					const records = computeRecords(all, {
						// Declared per sport: football's longest streak is 15
						// games across the 2010 and 2011 seasons, and ending runs
						// at the boundary would erase it. Baseball says the
						// opposite, on purpose.
						streaksSpanSeasons: team.rules.streaksSpanSeasons,
						titles: won.filter((t) => t.champion === entry.franchise),
					});
					if (wantsJson(url)) return json(res, 200, records);
					const latest = latestSeason(all);
					// `/records/{slug}` is one card's permalink, and the slug has to
					// be CHECKED here rather than passed through. The route pattern
					// accepts any lowercase word, so an unchecked slug renders the
					// full record book under a title naming a record the club does
					// not publish -- a soft 404 that returns 200 and gets indexed.
					const slugs = team.records ?? RECORD_SLUGS;
					if (view.record && !slugs.includes(view.record)) {
						return json(res, 404, {
							error: 'no such record',
							record: view.record,
							// Same shape as an unknown opponent below: the answer to
							// "which are there" is short, and printing it beats a bare
							// 404 for a URL somebody has plainly hand-edited.
							records: slugs,
						});
					}
					const focused = view.record ? recordCopy(team, records.championshipAppearances)[view.record] : null;
					return html(res, 200, recordsPage({
						team,
						colors: team.colors ?? colorsFor(namers[entry.sport], entry.code, { season: latest?.season, date: all.at(-1)?.date }, NEUTRAL),
						records,
						resolve: namers[entry.sport],
						base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
						slugs,
						focus: view.record,
					}), focused
						// The card's own note, so a shared permalink previews as the
						// record it points at. Without this every one of the twelve
						// shared the page's derived sentence, which is the same
						// defect as the shared title wearing different clothes.
						? { description: `${team.nouns.fullName}: ${focused.note.toLowerCase()}.` }
						: {});
				}
				if (view.view === 'vs') {
					const team = clubFor(entry);
					const all = await games(entry);
					const resolve = namers[entry.sport];
					// Current franchises, from the reference table rather than a
					// list. Cached per sport at boot with the resolvers, because
					// this reads and indexes the whole history file.
					const active = currentOf(entry.sport);
					const isCurrent = (code) => active.has(resolve(code).franchise ?? code);
					// The UNFILTERED set, always. Two things need it: the "23 of
					// 61" count, and the opponent lookup — a filtered page must
					// still resolve /vs/{slug} for an opponent the filter hides,
					// or the link a reader just followed 404s because they had a
					// venue selected.
					const h2h = computeHeadToHead(all, { isCurrent });
					const colors = team.colors
						?? colorsFor(resolve, entry.code, { season: seasons(all).at(-1), date: all.at(-1)?.date }, NEUTRAL);
					const common = {
						team, colors, resolve, base: entry.base,
						siteNavHtml: siteNav(entry.base, team, { league: needsSelector(table) }),
						switcher: clubSwitcher(clubList(), entry.teamId, here),
					};

					if (!view.opponent) {
						const venue = url.searchParams.get('venue') ?? 'all';
						const type = url.searchParams.get('type') ?? 'all';
						const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
						const onlyCurrent = url.searchParams.get('current') === '1';
						// Venue and type filter the GAMES and are recomputed,
						// because a home-only record cannot be recovered from an
						// all-venues one. Name and current-only filter the
						// OPPONENTS, so they leave the numbers alone.
						const filtered = venue === 'all' && type === 'all'
							? h2h
							: computeHeadToHead(filterGames(all, { venue, type }), { isCurrent });
						const opponents = filtered.opponents.filter((o) => {
							if (onlyCurrent && !o.current) return false;
							if (!q) return true;
							// The name the table shows, which is the current-era one.
							// Filtering on the last-meeting name would hide a row
							// whose visible text matches what was typed.
							return resolve(o.code).name.toLowerCase().includes(q);
						});
						if (wantsJson(url)) return json(res, 200, opponents);
						return html(res, 200, headToHeadPage({
							...common,
							opponents,
							total: h2h.opponents.length,
							// The control is drawn only where it can narrow
							// something. Every baseball franchise on record is
							// current, so offering the filter there would be a
							// checkbox that never changes the table — which is
							// why the baseball site does not have one either.
							hasHistorical: h2h.opponents.some((o) => o.current === false),
							sort: parseSort(url.searchParams, h2hColumns(team), null),
							path: url.pathname,
							params: url.searchParams,
						}));
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
						detail: opponentDetail(opponent.meetings, {
							// The opponent's name AT THE TIME of each meeting, which
							// is what turns one franchise into "Boston Braves,
							// Milwaukee Braves, Atlanta Braves" instead of three
							// identical rows.
							eraOf: (g) => resolve(opponent.code, { season: String(g.season), date: g.date }).name,
						}),
						name: resolve(opponent.code).name,
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

		server.listen(PORT, () => {
			console.log(`  listening    http://127.0.0.1:${PORT}`);
			warmGames(table.filter((e) => e.available && e.franchise));
		});
		return server;
	});
}

// pathToFileURL, not string surgery on the path. An earlier guard in this repo
// compared a Windows path against a file:// URL by hand, matched nothing, and
// silently ran no main at all — the script "succeeded" by doing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
