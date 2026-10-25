/** Every request the adopted front page makes, answered for one club.
 *
 *  The two sites' servers answered these from their own files: a committed
 *  gameinfo.csv, a committed packers_games.csv, ESPN fetched by their own
 *  modules. Each route below names the site route it replaces, and answers it
 *  from Postgres, the franchise history table or data/clubs/ instead.
 *
 *  Any scope. Every path the pages use is relative and the shell's <base>
 *  names the club's root, so the same routes answer `/data/games.csv` for a
 *  single-club deployment and `/nfl/packers/data/games.csv` under SCOPE=all.
 *  The caller strips the base (lib/routes.js matchRoute) and passes the rest.
 *
 *  Anything this does not recognise falls through to the server-rendered
 *  routes, which is how /records, /history and /vs keep working beside it.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createEspnCache, endpointsFor, espnTarget, browserMaxAge, leagueEndpoints } from './espn.js';
import { espnBoxscore } from './espn-box.js';
import { displayName } from './names.js';
import { leaderStints, markInterim, mergeLeaders, numberLeaders, tallyLeaders, tallyTenures } from './leaders.js';
import { limitationsHtml } from './limitations.js';
import { channelLookupCsv, providerLookupCsv, simulcastsCsv } from './tv.js';
import { LEAGUE_ABBR } from './teams.js';
import * as soccer from './espn-soccer.js';
import {
	FAMILY, WEB_DIR, assetFor, clubFileFor, tvLogoFor, clubConfig, leagueConfig, currentNamesCsv, franchiseAliases, gameinfoCsv, mlsGametype, nhlGametype, wnbaGametype,
	nflGameRow, nflGamesCsv, recolor, seasonRecordsCsv, shell,
} from './web.js';

/** The pages each sport's nav links to, as the sites name them, and the
 *  route here that answers each — or null where this repo has no such page
 *  yet. A link with no page is taken out of the nav rather than left to 404;
 *  each one comes back as its page is ported. */
const NAV = {
	mlb: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'managers.html': 'managers', ballparks: null, stats: null },
	nfl: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'coaches.html': 'coaches', stadiums: null, splits: null, stats: null },
	// Basketball's page is baseball's: its leaders page is coaches, and it has
	// no ballparks or stats pages here. Their coaches are stated tenures
	// (data/reference/<sport>-coaches.csv).
	nba: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'coaches.html': 'coaches', ballparks: null, stats: null },
	nhl: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'coaches.html': 'coaches', ballparks: null, stats: null },
	wnba: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'coaches.html': 'coaches', ballparks: null, stats: null },
	mls: { 'records.html': 'records', 'history.html': 'history', 'vs.html': 'vs', 'coaches.html': 'coaches', ballparks: null, stats: null },
};

/** The club pages ported from the baseball site (web/<sport>/history.html and
 *  the rest), by the route that serves each and the title it carries. The
 *  leaders page is named by the sport: /managers in baseball, /coaches
 *  elsewhere. Records and head-to-head take a card or an opponent after them,
 *  which the page reads from its own URL. */
const CLUB_PAGES = {
	history: { file: 'history.html', title: 'History' },
	records: { file: 'records.html', title: 'Records', slug: true },
	vs: { file: 'vs.html', title: 'Head-to-Head', slug: true },
};

/** Who led each game, in teamstats.csv's columns — the three the page reads
 *  (coaches-core.js parseTeamstatsMgr) — rather than in teamstats.csv itself:
 *  a teamstats row with its box score blank reads as a game with no hits, and
 *  the records page would count every one as a no-hitter. */
export function leadersCsv(rows, games, teamIds) {
	const byId = new Map(games.map((g) => [g.id, g]));
	const ids = new Set(teamIds);
	const lines = ['gid,team,mgr'];
	for (const r of rows) {
		const g = byId.get(r.gameId);
		if (!g) continue;
		lines.push(`${g.id},${ids.has(g.home) ? g.home : g.away},${r.leader}`);
	}
	return lines.join('\n') + '\n';
}

/** Each leader's official spells in charge, in the Brewers site's
 *  managers.csv (name = the leader's id, M/D/YYYY dates): every stint of
 *  somebody who ever held the job, which is lib/leaders.js's rule for who is
 *  not an interim. The rows arrive folded, so a stand-in's games are already
 *  the holder's (leaderStints). */
export function managersCsv(rows) {
	const interim = markInterim(rows);
	const md = (iso) => { const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
	const lines = ['name,start_date,end_date'];
	for (const s of leaderStints(rows)) {
		if (!interim.has(s.leader)) lines.push(`${s.leader},${md(s.firstDate)},${md(s.lastDate)}`);
	}
	return lines.join('\n') + '\n';
}

/** Every head coach, tallied and numbered as the server's leaders page does
 *  it (lib/leaders.js): games per coach where there are per-game records, the
 *  stated tenures before them. Football's pages read this rather than the
 *  curated file only the Packers site had. In tenure order.
 *
 *  `eras` is the same people as spells in charge, for the history chart's
 *  bands: a person is one row in `coaches`, and Ray McLean's one row runs
 *  1953-1958 straight over Lisle Blackbourn. Spells of games where there are
 *  per-game records (leaderStints), each stated tenure before them, and only
 *  for whoever held the job, as the chart draws them. */
export function coachesJson(gameRows, tenures) {
	// Each person's terms as the lists write them ("2024–2026"), in order, for
	// the tenure column; a tenure without one (football's) leaves it to seasons.
	const termsOf = new Map();
	for (const t of [...tenures].sort((a, b) => Number(a.firstSeason) - Number(b.firstSeason))) {
		if (!t.term) continue;
		termsOf.set(t.leader, [...(termsOf.get(t.leader) ?? []), t.term]);
	}
	const coaches = numberLeaders(mergeLeaders(tallyLeaders(gameRows), tallyTenures(tenures)))
		.map((r) => ({ ...r, seasons: undefined, champ: undefined, terms: termsOf.get(r.leader) }))
		.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
	const interim = markInterim(gameRows);
	const eras = [
		...tenures.filter((t) => !t.interim)
			.map((t) => ({ leader: t.leader, name: t.name, from: Number(t.firstSeason), to: Number(t.lastSeason), term: t.term || undefined })),
		...leaderStints(gameRows).filter((s) => !interim.has(s.leader))
			.map((s) => ({ leader: s.leader, name: s.name, from: s.from, to: s.to })),
	].sort((a, b) => a.from - b.from || a.to - b.to);
	return { coaches, eras };
}

/** Leaders' names in biofile0.csv's columns, which the page reads by header:
 *  a full name, with the usual name and last name left empty. */
export function biofileCsv(rows) {
	const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
	const names = new Map(rows.map((r) => [r.leader, r.name]));
	return ['id,lastname,usename,fullname', ...[...names].map(([id, name]) => `${id},,,${quote(name ?? id)}`)].join('\n') + '\n';
}

/** Remove nav links to pages that do not exist here, and point the rest at
 *  the routes that do. */
export function navFor(html, sport) {
	let out = html;
	for (const [from, to] of Object.entries(NAV[sport] ?? {})) {
		const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (to === null) {
			out = out.replace(new RegExp(`\\s*<a href="${esc}" class="footer-nav-link"[\\s\\S]*?</a>`), '');
		} else {
			out = out.split(`href="${from}"`).join(`href="${to}"`);
		}
	}
	return out;
}

/** Retrosheet's headers for the two files this repo has no rows for. The page
 *  parses them by header; an empty file with the right one is a page with no
 *  line scores and no player names, which is what those features show for a
 *  game neither site had data on. */
const TEAMSTATS_HEADER = 'gid,team,inn1,inn2,inn3,inn4,inn5,inn6,inn7,inn8,inn9,inn10,inn11,inn12,inn13,inn14,inn15,inn16,inn17,inn18,inn19,inn20,inn21,inn22,inn23,inn24,inn25,inn26,inn27,inn28,lob,mgr,stattype,b_pa,b_ab,b_r,b_h,b_d,b_t,b_hr,b_rbi,b_sh,b_sf,b_hbp,b_w,b_iw,b_k,b_sb,b_cs,b_gdp,b_xi,b_roe,p_ipouts,p_noout,p_bfp,p_h,p_d,p_t,p_hr,p_r,p_er,p_w,p_iw,p_k,p_hbp,p_wp,p_bk,p_sh,p_sf,p_sb,p_cs,p_pb,d_po,d_a,d_e,d_dp,d_tp,d_pb,d_wp,d_sb,d_cs,start_l1,start_l2,start_l3,start_l4,start_l5,start_l6,start_l7,start_l8,start_l9,start_f1,start_f2,start_f3,start_f4,start_f5,start_f6,start_f7,start_f8,start_f9,start_f10,date\n';
const BIOFILE_HEADER = 'id,lastname,usename,fullname,birthdate,birthcity,birthstate,birthcountry,deathdate,deathcity,deathstate,deathcountry,cemetery,cem_city,cem_state,cem_ctry,cem_note,birthname,altname,debut_p,last_p,debut_c,last_c,debut_m,last_m,debut_u,last_u,bats,throws,height,weight,HOF\n';

const etagOf = (buf) => `"${createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;

/** Send text with an ETag, answering 304 when the browser has it. `no-cache`
 *  means "revalidate", not "do not store": the sites served their modules
 *  with content-hashed URLs and a year's cache, and revalidating every load
 *  is the simpler half of that, bought with a round trip. */
function send(req, res, body, type, { cache = 'no-cache', status = 200, headers = {} } = {}) {
	const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
	const etag = etagOf(buf);
	if (status === 200 && (req.headers['if-none-match'] ?? '').replace(/^W\//, '') === etag) {
		res.writeHead(304, { etag, 'cache-control': cache });
		return res.end();
	}
	res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': cache, etag, ...headers });
	return res.end(buf);
}

const jsonOut = (req, res, value, opts) => send(req, res, JSON.stringify(value), 'application/json; charset=utf-8', opts);

/** Build the front page for one club, or null when its sport has no front end.
 *
 *  `ctx` is what server.js already holds: the resolved manifest, the sport's
 *  adapter, its name resolver and history rows, the store functions and the
 *  credit line. Passing them in keeps this module free of the server's
 *  globals, and testable with fakes. The page itself goes out through
 *  `sendPage`, per request, because only the request knows its origin.
 */
let espnShared = null;
/** The process's one ESPN cache (lib/espn.js), made on first use. */
export const sharedEspn = () => (espnShared ??= createEspnCache());

export async function createFront(ctx) {
	const { team, franchise, adapter, namer, history, currentCodes, palette, store, creditHtml } = ctx;
	const sport = team.sport;
	const now = ctx.now ?? (() => new Date());

	// The club as ESPN and the history table know it today.
	const currentRow = history.filter((r) => r.franchiseAbbrv === franchise).at(-1) ?? {};
	const current = { espnAbbr: currentRow.espnAbbrv || currentRow.teamAbbrv || franchise, league: currentRow.league, conference: currentRow.conference };
	// Baseball's front end serves basketball and hockey too (web/nba, web/nhl); the file shapes
	// below follow the front end, not the sport.
	const family = FAMILY[sport];
	const others = [...currentCodes].filter((c) => c !== franchise)
		.map((c) => namer(c, { season: now().getFullYear(), date: now().toISOString().slice(0, 10) }).name)
		.sort();
	// TV providers and channels, every club's (0017_tv.sql, lib/tv.js), re-read
	// at most once a minute: an approved channel shows within one. A store
	// without them (a test's fake) has none.
	let tvCache = { at: 0, value: null };
	const tvTables = async () => {
		if (!store.tvTables) return { providers: [], areas: [], networks: [], channels: [] };
		if (!tvCache.value || Date.now() - tvCache.at > 60_000) {
			// A deploy runs before its migration does: without the tables a club
			// has no providers yet, rather than no page.
			const value = await store.tvTables().catch((e) => {
				console.error(`  tv tables    ${e.message}`);
				return tvCache.value ?? { providers: [], areas: [], networks: [], channels: [] };
			});
			tvCache = { at: Date.now(), value };
		}
		return tvCache.value;
	};
	const clubCfg = clubConfig({
		team, current,
		standingsTitles: await store.standingsTitles(sport, franchise),
		currentFranchises: others,
		aliases: sport === 'nfl' ? franchiseAliases(history, displayName) : {},
		tv: (await tvTables()).providers.length > 0,
	});
	// A league's page is built on one of its clubs, whose config, ESPN cache
	// and bracket it shares, and is said of the league (ctx.league).
	const league = Boolean(ctx.league);
	const config = league ? leagueConfig(clubCfg, sport, team.rules?.schedulePeriod === 'week' ? 'week' : 'day') : clubCfg;

	// Nothing here reads SITE: one server serves many clubs, and SITE is the
	// browser's one. Club facts the server needs are passed as arguments.
	// Each sport's own copies: basketball's live card and bracket are not
	// baseball's (web/nba/live-core.js, bracket-core.js).
	const live = family === 'mlb' ? await import(`../web/${sport}/live-core.js`) : null;
	const bracket = family === 'mlb' ? await import(`../web/${sport}/bracket-core.js`) : null;
	// Every sport's page has the TV picker now; football's tv-core.js is the
	// baseball one's (web/nfl/tv-ui.js).
	const tv = (family === 'mlb' || sport === 'nfl') ? await import(`../web/${sport}/tv-core.js`) : null;
	// Every club with channels to name has a calendar of its games and where to
	// watch them; the baseball family's pages offer it beside the provider.
	const calendar = tv ? await import('./calendar.js') : null;

	// One ESPN cache for every club and league page in the process: the same
	// scoreboard asked for by 32 football clubs is fetched and held once.
	const espn = ctx.espn ?? sharedEspn();
	const endpoints = league
		? leagueEndpoints({ league: config.site.espnLeague })
		: endpointsFor({ league: config.site.espnLeague, slug: config.site.espnSlug, standings: family === 'mlb' });
	const target = (path, search = '') => espnTarget(endpoints, path, search);
	const site = `apis/site/v2/sports/${config.site.espnLeague}`;

	// The page's own files, read once. They change only with a deploy.
	const page = league
		? readFileSync(join(WEB_DIR, sport, 'league.html'), 'utf8')
		: navFor(readFileSync(join(WEB_DIR, sport, 'index.html'), 'utf8'), sport);
	const assets = new Map();
	const asset = (pathname) => {
		if (!assets.has(pathname)) {
			const a = assetFor(sport, pathname);
			let body = a ? readFileSync(a.path) : null;
			// The stylesheet and the history chart carry the source club's
			// colours; everything else is served as it is.
			if (a && (pathname === '/styles.css' || pathname === '/history-chart.js')) {
				body = Buffer.from(recolor(body.toString('utf8'), sport, palette));
			}
			assets.set(pathname, a ? { body, type: a.type } : null);
		}
		return assets.get(pathname);
	};

	// The club's games, re-read at most once a minute. The live refresh writes
	// every minute during a game; a page load is not a reason to read 9,000
	// rows more often than the data can change.
	let games = { at: 0, rows: [] };
	const allGames = async () => {
		if (Date.now() - games.at > 60_000) games = { at: Date.now(), rows: await store.rawGamesFor(sport, franchise) };
		return games.rows;
	};
	// Who led them, on the same clock. A store without leaders (a test's fake)
	// has none, which the pages show as nobody on record.
	let leaders = { at: 0, rows: [] };
	const leaderRows = async () => {
		if (store.leaderGames && Date.now() - leaders.at > 60_000) leaders = { at: Date.now(), rows: await store.leaderGames(sport, [franchise]) };
		return leaders.rows;
	};
	// The season being played is the browser's to fetch from ESPN, as it was
	// on both sites; the history file stops before it. Which season that is,
	// is the sport's rule (January football belongs to the previous year).
	const playing = () => adapter.sources.live.seasonOf(now());
	const nameOf = (code, season) => namer(code, { season, date: `${season}-07-01` }).name;

	const calendarEvents = (() => {
		let cached = { at: 0, events: [] };
		return async () => {
			if (Date.now() - cached.at > 10 * 60 * 1000) {
				// MLS's schedule is built from three of ESPN's lists (mlsSchedule), as
				// its page reads it; ESPN's plain team schedule has only results.
				const types = sport === 'mls'
					? await Promise.all([1, 2, 3].map(async (t) => ({ status: 200, body: JSON.stringify(t === 1 ? { events: [] } : await mlsSchedule(t, playing())) })))
					: await Promise.all([1, 2, 3].map((t) => espn(target(`${site}/teams/${config.site.espnSlug}/schedule`, `seasontype=${t}`))));
				const events = [];
				types.forEach((got, i) => {
					if (got?.status !== 200) return;
					try {
						for (const e of JSON.parse(got.body).events ?? []) events.push({ ...e, _t: ['pre', 'regular', 'post'][i] });
					} catch { /* that type has nothing */ }
				});
				if (events.length || !cached.events.length) cached = { at: Date.now(), events };
			}
			return cached.events;
		};
	})();

	// Hockey's and the WNBA's rounds are named by where they fall against the
	// Final (nhlGametype, wnbaGametype), so the page needs each season's number
	// of rounds; the season being played has none until its Final. Re-read every
	// ten minutes, which is how soon a new Final can matter.
	const gametypeOf = (() => {
		const namer = { nhl: (stage, rounds) => nhlGametype(stage, rounds ?? 4), wnba: wnbaGametype, mls: mlsGametype }[sport];
		if (!namer || !store.finalRounds) return async () => null;
		let cached = { at: 0, rounds: new Map() };
		return async () => {
			if (Date.now() - cached.at > 10 * 60 * 1000) cached = { at: Date.now(), rounds: await store.finalRounds(sport) };
			const { rounds } = cached;
			// A season being played has no Final yet: hockey's will have four rounds;
			// the WNBA's and MLS's are ESPN's to name on the page.
			return (g) => namer(g.stage, rounds.get(Number(g.season)));
		};
	})();

	// `p` is the path within this club — `/2024`, `/data/games.csv` — with the
	// club's base already taken off by the caller (lib/routes.js matchRoute).
	return async function front(req, res, p, url, sendPage) {

		// What the data does not cover, for a club and for a league alike: the
		// sport's list (lib/limitations.js) under the footer of the page it was
		// opened from, which the Disclaimer links to (lib/web.js shell).
		if (p === '/limitations' || p === '/limitations.html') {
			const footer = (page.match(/ {4}<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0] ?? '').replace(/ aria-current="page"/g, '');
			const html = readFileSync(join(WEB_DIR, sport, 'limitations.html'), 'utf8')
				.replace('<!-- limitations -->', limitationsHtml(sport, LEAGUE_ABBR[sport]))
				.replace('    <!-- footer -->', footer);
			return sendPage(res, shell(html, {
				config, creditHtml, base: ctx.base ?? '', page: 'Data Limitations',
				clubs: ctx.clubs ?? [], current: { sport, teamId: league ? null : team.id },
			}), { card: league ? null : 'default' }), true;
		}

		// A league's page answers for its page, its files, ESPN and the bracket,
		// and nothing that is a club's: /nfl/standings and the rest stay the
		// server's, and a club's data files are not the league's.
		if (league) {
			if (p === '/' || p === '/index.html') {
				return sendPage(res, shell(page, {
					config, creditHtml, base: ctx.base ?? '',
					clubs: ctx.clubs ?? [], current: { sport, teamId: null },
				}), { card: null }), true;
			}
			const allowed = p.startsWith('/api/espn/') || p === '/api/bracket' || /^\/api\/live\/\d{1,12}$/.test(p)
				|| /^\/[a-z0-9-]+\.(?:js|css)$/.test(p) || p.startsWith('/fonts/') || p.startsWith('/logos/');
			if (!allowed) return false;
		}

		// The page itself: /, and /{season}, which the page reads from its own URL.
		if (p === '/' || p === '/index.html' || /^\/\d{4}\/?$/.test(p)) {
			return sendPage(res, shell(page, {
				config, creditHtml, base: ctx.base ?? '',
				clubs: ctx.clubs ?? [], current: { sport, teamId: team.id },
			})), true;
		}

		// The club pages, where the server-rendered ones were. `?format=json`
		// still reaches those, which is what a terminal check of the data uses.
		const clubPage = (family === 'mlb' || family === 'nfl') && !url.searchParams.has('format')
			&& p.match(/^\/([a-z]+)(?:\.html)?(?:\/([a-z0-9-]+))?\/?$/);
		if (clubPage) {
			const [, name, slug] = clubPage;
			const leaders = name === team.nouns.leaderPlural || name === 'leaders';
			const def = leaders ? { file: 'leaders.html', title: team.nouns.leaderPlural.replace(/^./, (c) => c.toUpperCase()) } : CLUB_PAGES[name];
			if (def && (!slug || def.slug)) {
				const html = navFor(readFileSync(join(WEB_DIR, sport, def.file), 'utf8'), sport);
				return sendPage(res, shell(html, {
					config, creditHtml, base: ctx.base ?? '', page: def.title,
					clubs: ctx.clubs ?? [], current: { sport, teamId: team.id },
				}), { card: leaders ? team.nouns.leaderPlural : name }), true;
			}
		}

		const a = asset(p);
		if (a) return send(req, res, a.body, a.type), true;

		// --- MLS's schedule, from three ESPN requests (lib/espn-soccer.js) ---
		if (sport === 'mls' && p === `/api/espn/${site}/teams/${config.site.espnSlug}/schedule`) {
			const q = new URLSearchParams(url.search);
			const type = Number(q.get('seasontype') ?? 2);
			const season = Number(q.get('season')) || playing();
			return jsonOut(req, res, await mlsSchedule(type, season), { cache: 'public, max-age=60' }), true;
		}

		// --- history, from Postgres ---
		if (family === 'mlb' && p === '/data/gameinfo.csv') {
			const before = (await allGames()).filter((g) => g.season < playing());
			return send(req, res, gameinfoCsv(before, { gametypeOf: await gametypeOf() }), 'text/csv; charset=utf-8'), true;
		}
		if (family === 'mlb' && p === '/api/current/gameinfo.csv') {
			// Data lines only, as the site's was: the page prepends the header.
			const finals = (await allGames()).filter((g) => g.season === playing() && g.status === 'final');
			return send(req, res, gameinfoCsv(finals, { header: false, gametypeOf: await gametypeOf() }), 'text/csv; charset=utf-8', { cache: 'public, max-age=300' }), true;
		}
		if (family === 'mlb' && p === '/data/CurrentNames.csv') {
			// A league whose season is the calendar year names its eras by it: the
			// season of a mid-November date is that year's for the WNBA and MLS, the
			// next for basketball and hockey.
			const calendarYear = adapter.sources.live.seasonOf(new Date(Date.UTC(2026, 10, 15))) === 2026;
			return send(req, res, currentNamesCsv(history, { calendarYear }), 'text/csv; charset=utf-8'), true;
		}
		if (family === 'mlb' && p === '/data/teamstats.csv') return send(req, res, TEAMSTATS_HEADER, 'text/csv; charset=utf-8'), true;
		// Who led each game, their spells in charge and their names: the three
		// files the leaders page and the history chart's eras read, from
		// game_leader. The front page reads biofile0.csv for players, and gets
		// the leaders in it, which it has no use for and does not mind.
		if (p === '/data/coaches.json') {
			const tenures = store.leaderTenures ? await store.leaderTenures(sport, [franchise]) : [];
			return jsonOut(req, res, coachesJson(await leaderRows(), tenures)), true;
		}
		if (family === 'mlb' && (p === '/data/leaders.csv' || p === '/data/managers.csv' || p === '/data/biofile0.csv')) {
			const rows = await leaderRows();
			const body = p === '/data/leaders.csv' ? leadersCsv(rows, await allGames(), config.teamIds)
				: p === '/data/managers.csv' ? managersCsv(rows)
				: rows.length ? biofileCsv(rows) : BIOFILE_HEADER;
			return send(req, res, body, 'text/csv; charset=utf-8'), true;
		}

		if (sport === 'nfl' && (p === '/data/games.csv' || p === '/data/season_records.csv' || p === '/api/current/games.csv')) {
			const rows = (await allGames()).map((g) => nflGameRow(g, franchise, nameOf));
			if (p === '/data/season_records.csv') return send(req, res, seasonRecordsCsv(rows), 'text/csv; charset=utf-8'), true;
			const season = playing();
			if (p === '/data/games.csv') {
				return send(req, res, nflGamesCsv(rows.filter((r) => r.season < season)), 'text/csv; charset=utf-8'), true;
			}
			// The season being played, finished games only, and the header the
			// page will not use it without (games-client.js).
			return send(req, res, nflGamesCsv(rows.filter((r) => r.season === season && r.result)), 'text/csv; charset=utf-8',
				{ cache: 'public, max-age=60', headers: { 'x-season': String(season), 'access-control-expose-headers': 'X-Season' } }), true;
		}

		// --- TV providers and channels, from the database, in the files' shape ---
		if (tv && (p === '/data/channel_lookup.csv' || p === '/data/provider_lookup.csv' || p === '/data/simulcasts.csv')) {
			const body = p === '/data/channel_lookup.csv' ? channelLookupCsv(await tvTables(), `${sport}/${team.id}`)
				: p === '/data/provider_lookup.csv' ? providerLookupCsv(await tvTables())
				: simulcastsCsv(store.simulcastsFor ? await store.simulcastsFor(sport, team.id) : []);
			return send(req, res, body, 'text/csv; charset=utf-8', { cache: 'public, max-age=60' }), true;
		}

		// --- curated, per club ---
		const curated = p.match(/^\/(?:data\/)?((?:logos\/)?[A-Za-z0-9_.-]+\.(?:csv|svg|png))$/);
		if (curated && (p.startsWith('/data/') || p.startsWith('/logos/'))) {
			const f = clubFileFor(sport, team.id, curated[1]) ?? (p.startsWith('/logos/') ? tvLogoFor(curated[1]) : null);
			if (f) return send(req, res, readFileSync(f.path), f.type), true;
			return send(req, res, 'Not found\n', 'text/plain; charset=utf-8', { status: 404, cache: 'no-store' }), true;
		}

		// --- ESPN ---
		if (p.startsWith('/api/espn/')) {
			const t = target(p.slice('/api/espn/'.length), url.search.slice(1));
			if (!t) return send(req, res, 'Not found\n', 'text/plain; charset=utf-8', { status: 404, cache: 'no-store' }), true;
			const got = await espn(t);
			if (!got) return send(req, res, JSON.stringify({ error: 'ESPN unreachable' }), 'application/json', { status: 502, cache: 'no-store' }), true;
			res.writeHead(got.status, {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': `public, max-age=${browserMaxAge(got.cacheState, got.ttl)}`,
				'x-proxy-cache': got.cacheState,
			});
			return res.end(got.body), true;
		}

		// Players born on this date. Neither sport's player data is loaded here
		// yet, and an empty list is what both pages already render for a date
		// with nobody on it — so this says "nobody" rather than 404ing.
		if (/^\/api\/born\/(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p)) {
			return jsonOut(req, res, [], { cache: 'public, max-age=3600' }), true;
		}

		// --- baseball's live card and bracket (the site's serveLiveApi, serveBracketApi) ---
		const liveId = p.match(/^\/api\/live\/(\d{1,12})$/);
		if (live && liveId) {
			const got = await espn(target(`${site}/summary`, `event=${liveId[1]}`));
			if (!got || got.status !== 200) {
				return send(req, res, JSON.stringify({ error: 'No live data for that game' }), 'application/json', { status: got ? got.status : 502, cache: 'no-store' }), true;
			}
			let detail = null;
			try { detail = live.liveDetail(JSON.parse(got.body)); } catch { /* unparseable: no detail */ }
			return send(req, res, JSON.stringify(detail), 'application/json; charset=utf-8', { cache: 'public, max-age=5' }), true;
		}
		if (bracket && p === '/api/bracket') return jsonOut(req, res, await bracketJson()), true;

		// --- football's box score (the site's serveBoxscoreApi) ---
		const boxId = p.match(/^\/api\/boxscore\/(\d{6,12})$/);
		if (sport === 'nfl' && boxId) {
			const box = await footballBox(espn, target, site, boxId[1], config);
			if (!box) return send(req, res, JSON.stringify({ error: 'Game not found' }), 'application/json', { status: 404, cache: 'no-store' }), true;
			return send(req, res, JSON.stringify(box), 'application/json; charset=utf-8', { cache: `public, max-age=${box.final ? 3600 : box.live ? 5 : 60}` }), true;
		}

		// --- the season as a calendar, for a club with TV listings ---
		const cal = p.match(/^\/calendar(?:\/([a-z0-9_-]+))?\.ics$/);
		// Asked of the tables on each request, not when the page was built: a
		// migration run after the deploy must not wait for a restart.
		if (calendar && cal && (await tvTables()).providers.length) {
			const tables = await tvTables();
			const lookup = tv.parseTvLookup(channelLookupCsv(tables, `${sport}/${team.id}`), providerLookupCsv(tables));
			const simulcasts = tv.parseSimulcasts(simulcastsCsv(store.simulcastsFor ? await store.simulcastsFor(sport, team.id) : []));
			const provider = cal[1] ?? null;
			if (provider && !lookup.providers[provider]) return send(req, res, 'Not found\n', 'text/plain; charset=utf-8', { status: 404, cache: 'no-store' }), true;
			const areas = provider ? lookup.providers[provider].service_areas.length : 0;
			const areaParam = url.searchParams.get('area') ?? '';
			const area = /^\d+$/.test(areaParam) && Number(areaParam) < areas ? Number(areaParam) : 0;
			const events = await calendarEvents();
			if (!events.length) return send(req, res, 'Schedule unavailable; try again shortly.\n', 'text/plain; charset=utf-8', { status: 503, cache: 'no-store', headers: { 'retry-after': '600' } }), true;
			const ics = calendar.buildCalendar(events, lookup, simulcasts, {
				provider, area, origin: ctx.origin(req),
				club: { abbr: config.site.espnAbbr, team: config.team, timeZone: config.site.timeZone },
			});
			return send(req, res, ics, 'text/calendar; charset=utf-8', {
				cache: 'public, max-age=600',
				headers: { 'content-disposition': `inline; filename="${team.id}${provider ? `-${provider}` : ''}.ics"` },
			}), true;
		}

		return false;
	};

	// MLS's postseason, from the scoreboard: ESPN lists it nowhere else. Days
	// from October to mid-December, the season's playoff weeks, up to three days
	// ahead; cached as the bracket is.
	async function mlsPlayoffs(year) {
		const DAY = 24 * 60 * 60 * 1000;
		const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
		const days = [];
		for (let t = Date.UTC(year, 9, 1); t <= Math.min(Date.UTC(year, 11, 15), Date.now() + 3 * DAY); t += DAY) days.push(ymd(t));
		const events = [];
		for (let i = 0; i < days.length; i += 8) {
			const got = await Promise.all(days.slice(i, i + 8).map((d) => espn(`https://site.api.espn.com/${site}/scoreboard?dates=${d}`)));
			for (const g of got) {
				if (g?.status !== 200) continue;
				try { events.push(...(JSON.parse(g.body).events || [])); } catch { /* skip the day */ }
			}
		}
		return soccer.playoffEvents(events);
	}

	async function mlsSchedule(type, season) {
		const base = `https://site.api.espn.com/${site}/teams/${config.site.espnSlug}/schedule`;
		const list = async (url) => {
			const got = await espn(url);
			try { return got?.status === 200 ? JSON.parse(got.body).events ?? [] : []; } catch { return []; }
		};
		if (type === 2) {
			const [results, fixtures] = await Promise.all([list(`${base}?season=${season}`), list(`${base}?season=${season}&fixture=true`)]);
			return soccer.soccerSchedule({ type, season, results, fixtures });
		}
		if (type === 3) return soccer.soccerSchedule({ type, season, playoffs: await mlsPlayoffs(season), teamId: config.site.espnSlug });
		return soccer.soccerSchedule({ type, season });
	}

	async function bracketJson() {
		const [espnSport, espnLeague] = config.site.espnLeague.split('/');
		const CORE = `https://sports.core.api.espn.com/v2/sports/${espnSport}/leagues/${espnLeague}`;
		const DAY = 24 * 60 * 60 * 1000;
		const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
		if (bracketJson.cache && Date.now() - bracketJson.cache.at < 30_000) return bracketJson.cache.value;
		// The season being played, as the sport counts it: basketball's ends in
		// the year after it starts.
		const year = adapter.sources.live.seasonOf(now());
		if (sport === 'mls') {
			const value = { season: year, games: bracket.bracketGames(await mlsPlayoffs(year)) };
			bracketJson.cache = { at: Date.now(), value };
			return value;
		}
		const type = await espn(`${CORE}/seasons/${year}/types/3`);
		let span = null;
		try { span = type?.status === 200 ? JSON.parse(type.body) : null; } catch { /* below */ }
		const start = Date.parse(span?.startDate || '');
		const end = Math.min(Date.parse(span?.endDate || ''), Date.now() + 3 * DAY);
		const days = [];
		for (let t = start; t <= end && days.length < 60; t += DAY) days.push(ymd(t));
		const events = [];
		for (let i = 0; i < days.length; i += 8) {
			const got = await Promise.all(days.slice(i, i + 8).map((d) => espn(`https://site.api.espn.com/${site}/scoreboard?dates=${d}`)));
			for (const g of got) {
				if (g?.status !== 200) continue;
				try { events.push(...(JSON.parse(g.body).events || [])); } catch { /* skip the day */ }
			}
		}
		const value = { season: year, games: bracket.bracketGames(events) };
		bracketJson.cache = { at: Date.now(), value };
		return value;
	}
}

/** The football site's espnBox, less the two files only it had: its games CSV
 *  (stadium, roof, referee for withGameDay) and its play-by-play fill-ins for
 *  old box scores (withDetails). Both are named gaps. */
async function footballBox(espn, target, site, eventId, config) {
	const got = await espn(target(`${site}/summary`, `event=${eventId}`));
	if (!got || got.status !== 200) return null;
	let summary;
	try { summary = JSON.parse(got.body); } catch { return null; }
	const isLive = summary?.header?.competitions?.[0]?.status?.type?.state === 'in';
	let scoreboard = null;
	if (isLive) {
		const sb = await espn(target(`${site}/scoreboard`));
		if (sb?.status === 200) {
			try { scoreboard = JSON.parse(sb.body).events?.find((e) => String(e.id) === String(eventId))?.competitions?.[0] || null; } catch { /* not on it */ }
		}
	}
	try {
		return espnBoxscore(summary, { scoreboard, club: config.site.espnAbbr, timeZone: config.site.timeZone });
	} catch (e) {
		// Said, not swallowed: a reducer that threw on every game answered
		// "Game not found" for each of them, and nothing anywhere said why.
		console.error(`box score ${eventId}: ${e.message}`);
		return null;
	}
}
