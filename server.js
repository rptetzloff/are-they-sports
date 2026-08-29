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
import { builtTeams, loadIndex, readManifest } from './lib/indices.js';
import { latestSeason, recordText, seasonTally, seasonVerdict, verdictText } from './lib/core.js';
import { NEUTRAL, clubPage, selectorPage } from './lib/render.js';
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

/** A club's games, filtered to a season when asked. */
function games(teamId, season) {
	const { entries } = loadIndex(teamId, 'games');
	return season ? entries.filter((g) => g.season === season) : entries;
}

function summary(entry, origin, base) {
	const all = games(entry.teamId);
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
		sources: readManifest(entry.teamId).sources,
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

	return loadTeams().then((teams) => {
		const built = builtTeams();
		let resolved;
		try {
			resolved = resolveScope(scope, { divisionsBySport, teams, built });
		} catch (e) {
			return die(e.message);
		}

		const teamsById = new Map(teams.map((t) => [t.id, t]));
		// One resolver per sport, loaded once. A club in scope with no manifest
		// still has a name — that is the whole point, since 60 of the 62 clubs an
		// `all` scope covers are unbuilt and would otherwise be bare codes.
		const namers = Object.fromEntries(SPORTS.map((s) => [s, resolver(s)]));
		const table = routeTable(scope, resolved);
		const available = table.filter((e) => e.available);

		// Say what is missing every time, at boot. A scope of sixteen clubs
		// serving two is a legitimate state of this repo today and an illegitimate
		// one in production, and the difference is whether anybody was told.
		console.log(`  build        ${BUILD}`);
		console.log(`  scope        ${process.env.SCOPE}`);
		console.log(`  clubs        ${available.length} of ${table.length} available`);
		for (const e of table.filter((e) => !e.available)) {
			console.log(`  missing      ${e.sport}/${e.code} — ${e.teamId ? 'manifest but no build' : 'no manifest'}`);
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
			console.error('  UNHEALTHY    no club in scope has built artifacts; run: npm run build <team>');
		}
		// Partial availability is healthy by default, because building clubs one
		// at a time is how this repo works today. A deployment that means to
		// promise the whole scope sets STRICT_SCOPE=1 and any gap is unhealthy.
		const strict = process.env.STRICT_SCOPE === '1';
		const healthy = () => (strict ? available.length === table.length : available.length > 0);

		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://placeholder');
			const origin = originOf(req);

			if (url.pathname === '/healthz') {
				// Reports the gap whether or not it counts against health, so the
				// number is visible before anyone has decided it matters.
				return json(res, healthy() ? 200 : 503, {
					ok: healthy(),
					build: BUILD,
					strict,
					scope: process.env.SCOPE,
					inScope: table.length,
					available: available.length,
					missing: table.filter((e) => !e.available).map((e) => `${e.sport}/${e.code}`),
				});
			}

			// The selector. Only exists when the scope holds more than one club;
			// a single-club scope serves that club at the root instead.
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
					error: 'club is in scope but has no built artifacts',
					team: entry.teamId, code: entry.code,
					fix: entry.teamId ? `npm run build ${entry.teamId}` : `write teams/<id>.js for ${entry.code}`,
				});
			}

			const view = parseView(rest);
			if (!view) return json(res, 404, { error: 'no such view', path: url.pathname });

			try {
				if (view.view === 'summary') {
					if (wantsJson(url)) return json(res, 200, summary(entry, origin, entry.base));
					const team = teamsById.get(entry.teamId);
					const latest = latestSeason(games(entry.teamId));
					const tally = seasonTally(latest.rows, team);
					const verdict = seasonVerdict({ ...tally, isPastSeason: latest.isPastSeason });
					return html(res, 200, clubPage({
						team,
						season: latest.season,
						tally,
						verdict,
						answer: verdictText(verdict, team),
						recordLabel: recordText(tally),
					}));
				}
				if (view.view === 'season') {
					const rows = games(entry.teamId, view.season);
					if (!rows.length) return json(res, 404, { error: 'no such season', season: view.season });
					return json(res, 200, { team: entry.teamId, season: view.season, games: rows });
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
