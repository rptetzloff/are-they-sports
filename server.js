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
import { availability, close, connect, franchiseForCodes, franchisesWithGames, gamesFor, health, lastUpdated } from './lib/store.js';
import {
	daysToNextGame, lastLosslessSeason, latestSeason, recordText, seasons, seasonTally, seasonVerdict,
	seasonWinPct, seriesRecords, streakBanner, verdictText,
} from './lib/core.js';
import {
	NEUTRAL, clubPage, clubSwitcher, scheduleHtml, seasonNav, selectorPage, siteNav, sparklineHtml,
} from './lib/render.js';
import { resolver } from './lib/names.js';
import { SPORTS, loadTeams } from './lib/teams.js';
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
 *  Cached per franchise for the life of the process. A club's history changes
 *  when a game finishes, not between requests, and re-querying 9,067 rows on
 *  every page load would be work done for nothing. The cost is that a finished
 *  game is not visible until the next deploy — which is a real limitation and
 *  the reason a TTL or an invalidation hook is the next thing this needs.
 */
const gameCache = new Map();

async function games(entry, season) {
	if (!gameCache.has(entry.franchise)) {
		gameCache.set(entry.franchise, await gamesFor(entry.sport, entry.franchise));
	}
	const rows = gameCache.get(entry.franchise);
	return season ? rows.filter((g) => g.season === season) : rows;
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

		// Resolve each club's canonical franchise, so a manifest listing MIL and
		// SE1 asks the database one question rather than two.
		for (const e of resolved) {
			const team = teams.find((t) => t.id === e.teamId);
			if (!team) continue;
			try {
				e.franchise = dbHealth.ok ? await franchiseForCodes(team.sport, team.sourceIds) : null;
			} catch (err) {
				// Two franchises for one club's codes is a load-time error that
				// would silently halve a club's history. It is worth stopping for.
				return die(`${team.id}: ${err.message}`);
			}
			e.available = Boolean(e.franchise) && (withGames.get(`${e.sport}/${e.franchise}`) ?? 0) > 0;
		}

		const teamsById = new Map(teams.map((t) => [t.id, t]));
		// One resolver per sport, loaded once. A club in scope with no manifest
		// still has a name — that is the whole point, since 60 of the 62 clubs an
		// `all` scope covers are unbuilt and would otherwise be bare codes.
		const namers = Object.fromEntries(SPORTS.map((s) => [s, resolver(s)]));
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
		let refreshedAt = 0;
		async function refresh(now) {
			if (now - refreshedAt < 30_000) return;
			refreshedAt = now;
			const live = await availability(now);
			for (const e of table) {
				if (!e.franchise && e.teamId) {
					const team = teamsById.get(e.teamId);
					// Booting against an empty database leaves this null, because
					// there are no franchise_code rows to resolve against yet.
					if (team) {
						try { e.franchise = await franchiseForCodes(team.sport, team.sourceIds); } catch { /* reported at boot */ }
					}
				}
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
				name: teamsById.get(e.teamId)?.nouns.fullName ?? namers[e.sport](e.code).name,
				available: e.available,
				url: e.available ? `${origin}${e.base}` : null,
			}));

			if (url.pathname === '/' && needsSelector(table)) {
				const clubs = table.map((e) => ({
					team: e.teamId, sport: e.sport, code: e.code,
					// The manifest's own name when there is one, because a club
					// that has been given a manifest has been given a preferred
					// name; the reference table otherwise.
					name: teamsById.get(e.teamId)?.nouns.fullName ?? namers[e.sport](e.code).name,
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

			/** Everything a club page shows, for one season.
			 *
			 *  Shared by the front page (the latest season) and /{season}, so the
			 *  two cannot drift into showing different things about the same
			 *  club — which is how the football site ended up with a front page
			 *  and a season page that disagreed.
			 */
			const renderSeason = async (season) => {
				const team = teamsById.get(entry.teamId);
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
					banner: streakBanner(played.filter((g) => g.regular_season === '1'), { isPastSeason, team }),
					schedule: scheduleHtml(withNames, { heading: `${season} Season Schedule` }),
					nav: seasonNav(allSeasons, season, entry.base),
					siteNavHtml: siteNav(entry.base, team),
					spark: sparklineHtml(seasonWinPct(all)),
					switcher: clubSwitcher(clubList(), entry.teamId),
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
					if (!body) return json(res, 404, { error: 'no such season', season: view.season });
					return html(res, 200, body);
				}
				// records and vs need the shared core, which has not been ported.
				// Saying so beats an empty 200 that looks like a club with no
				// records.
				return json(res, 501, { error: `${view.view} needs the record core, which is not ported yet` });
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
