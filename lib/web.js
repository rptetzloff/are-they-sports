/** The adopted front end: the two sites' own pages, served for any club.
 *
 *  Decided 2026-10-19 by Ray: are-they-sports should LOOK exactly like
 *  arethebrewersontv.com and arethepackersundefeated.com, and the way to get
 *  exactly is to serve their front ends rather than re-implement them in
 *  lib/render.js. This reverses the no-client-script default recorded in
 *  CLAUDE.md for these pages; see "The front page is the sites' own" there.
 *
 *  ONE FRONT END PER SPORT, for now. web/mlb is the baseball site's front page
 *  and web/nfl the football site's, each copied from its repo's merged branch
 *  and changed only where a literal named the club. They have drifted from
 *  each other — 277 of their 684 and 456 CSS selectors are shared — and merging
 *  them is later, measured work rather than part of the copy, because a merge
 *  done in the same change makes "exactly like the site" impossible to check.
 *
 *  What this module owns is everything those pages asked their own servers
 *  for, answered from this repo's data instead:
 *
 *    the club       window.CLUB, written into the page shell (clubConfig)
 *    the colours    each stylesheet is its source club's palette, rewritten
 *                   into this club's (recolor)
 *    the history    the games CSV each page parses, from Postgres
 *                   (gameinfoCsv for baseball, nflGamesCsv for football)
 *    curated files  photos and TV listings, per club, from data/clubs/
 *
 *  ESPN pass-through lives in lib/espn.js and box scores in lib/espn-box.js.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUE_ABBR } from './teams.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = join(ROOT, 'web');
export const CLUB_DATA_DIR = join(ROOT, 'data', 'clubs');

/** This codebase. The footer's GitHub link pointed at each site's own repo;
 *  the page is served from here now, so that is where it points. */
export const REPO_URL = 'https://github.com/rptetzloff/are-they-sports';

/** ESPN's path for each sport, as its site API spells it. */
export const ESPN_LEAGUE = { mlb: 'baseball/mlb', nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl', wnba: 'basketball/wnba', mls: 'soccer/usa.1' };

/** Which front end a sport's page is built from, and so which file shapes its
 *  server answers in. Basketball's, hockey's and the WNBA's are the baseball
 *  site's, adapted (web/nba, web/nhl, web/wnba): a near-daily schedule,
 *  playoff series, a bracket. */
export const FAMILY = { mlb: 'mlb', nba: 'mlb', nhl: 'mlb', wnba: 'mlb', mls: 'mlb', nfl: 'nfl' };

/** Each league by name, for the disclaimer. */
const LEAGUE_NAME = { mlb: 'Major League Baseball', nfl: 'the National Football League', nba: 'the National Basketball Association', nhl: 'the National Hockey League', wnba: 'the Women\'s National Basketball Association', mls: 'Major League Soccer' };

/** ESPN's standings group for a club's league or conference: baseball's 7
 *  American and 8 National, basketball's 5 East and 6 West, hockey's 7 East
 *  and 8 West. */
const standingsGroup = (sport, current) => (sport === 'nba'
	? (current?.conference === 'Western' ? 6 : 5)
	: sport === 'nhl'
		? (current?.conference === 'Western' ? 8 : 7)
		: (current?.league === 'AL' ? 7 : 8));

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.csv': 'text/csv; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
};

export const hasFrontEnd = (sport) => existsSync(join(WEB_DIR, sport, 'index.html'));

/** A file under `base`, or null. Refuses anything that resolves outside it,
 *  so `/..%2f` and friends cannot read the repo. */
function fileUnder(base, rel) {
	const full = normalize(join(base, rel));
	if (!full.startsWith(base + sep)) return null;
	try {
		if (!statSync(full).isFile()) return null;
	} catch { return null; }
	return full;
}

/** One of a sport's front-end files by URL path — `/main.js`, `/lib/season-state.js`
 *  — or null. index.html is not an asset: it is the shell, and goes through
 *  `shell` so the club is written into it. */
export function assetFor(sport, pathname) {
	const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
	if (!rel || rel === 'index.html') return null;
	const full = fileUnder(join(WEB_DIR, sport), rel);
	if (!full) return null;
	const type = TYPES[extname(full)];
	return type ? { path: full, type } : null;
}

/** One of a club's curated files — photos, TV listings, a provider's logo —
 *  by its path under data/clubs/<sport>/<club>/, or null. A club without the
 *  file gets a 404, which both pages already treat as "this club has none":
 *  the baseball site has no photos.csv and its gallery has never appeared. */
export function clubFileFor(sport, id, rel) {
	const full = fileUnder(join(CLUB_DATA_DIR, sport, id), rel);
	if (!full) return null;
	const type = TYPES[extname(full)];
	return type ? { path: full, type } : null;
}

/** Whether a club has channel listings, which is what asking "Are the X on
 *  TV?" needs. Derived from the files rather than declared in the manifest, so
 *  the two cannot disagree: a club with listings asks it, a club without asks
 *  whether they are undefeated. */
export const hasTvListings = (sport, id) =>
	Boolean(clubFileFor(sport, id, 'channel_lookup.csv') && clubFileFor(sport, id, 'provider_lookup.csv'));

/** A club's renamed parks, by Retrosheet park id, or none. */
export function parkNamesFor(sport, id) {
	const f = clubFileFor(sport, id, 'park_names.json');
	return f ? JSON.parse(readFileSync(f.path, 'utf8')) : {};
}

/** What the page is told about the club: window.CLUB, read by web/<sport>/site.js.
 *
 *  `site` is what the front page needs that the sites wrote as literals. Each
 *  field names the literal it replaced, so a value can be checked against the
 *  site it came from.
 */
export function clubConfig({ team, current, standingsTitles = [], currentFranchises = [], aliases = {} }) {
	const site = team.site ?? {};
	const tv = hasTvListings(team.sport, team.id);
	const abbr = current?.espnAbbr ?? team.sourceIds[0];
	return {
		team: team.nouns.team,
		fullName: team.nouns.fullName,
		teamIds: team.sourceIds,
		copy: { seasonNotStarted: team.copy.seasonNotStarted },
		site: {
			// 'Are the Brewers On TV?' / 'Are the Packers Undefeated?'
			title: tv ? `Are the ${team.nouns.team} On TV?` : `Are the ${team.nouns.team} Undefeated?`,
			tv,
			// '🍺' / '🧀' in the answer and the share text. Nothing for a club
			// that has not declared one: a wrong emoji is worse than none.
			emoji: site.emoji ?? '',
			// ' #ThisIsMyCrew' / ' #GoPackGo', with its space, so a club with
			// none gets a sentence that simply ends.
			tag: site.hashtag ? ` ${site.hashtag}` : '',
			// 'MIL' / 'GB' as ESPN spells them, and the lowercase form its
			// team URLs use ('teams/mil/schedule').
			espnAbbr: abbr,
			// ESPN's soccer schedules take its numeric team id instead, which an MLS
			// club's manifest gives (site.espnSlug: '187' for the Galaxy).
			espnSlug: site.espnSlug ?? abbr.toLowerCase(),
			espnLeague: ESPN_LEAGUE[team.sport],
			espnWeb: team.sport,
			// 1969 / 1921
			firstSeason: team.firstSeason,
			// Who the disclaimer says the site is not affiliated with.
			leagueName: LEAGUE_NAME[team.sport] ?? 'the league',
			// 'America/Chicago', which TV listings are kept in.
			timeZone: site.timeZone ?? 'America/New_York',
			// ESPN standings group for the race panel; see standingsGroup.
			leagueGroup: standingsGroup(team.sport, current),
			// 'Xfinity, Spectrum, TDS', the provider search placeholder.
			providerExamples: site.providerExamples ?? 'Xfinity, Spectrum, DIRECTV',
			// MIL06's two names; see the baseball site.js. Curated per club,
			// in data/clubs/<sport>/<club>/park_names.json.
			parkNames: parkNamesFor(team.sport, team.id),
			// [1929, 1930, 1931] for the Packers; see the football records-core.
			standingsTitles,
			// Whether a game has a page here. Not yet: both sites had one (/game/{id})
			// and this repo has none, so every link to one would be a 404. Off, the
			// pages leave those links out and keep the summary pop-up, which needs
			// only ESPN. On, they come back, when a game page is ported.
			gamePages: false,
			// The football h2h's "31 other active franchises", per club.
			currentFranchises,
			// Every franchise's old names to its latest; see franchiseAliases.
			franchiseAliases: aliases,
		},
	};
}

/** `window.CLUB = …` as a script tag. `<` is escaped so no name or copy line
 *  can close the tag early. */
export function clubScript(config) {
	const json = JSON.stringify(config).replace(/</g, '\\u003c');
	return `<script>window.CLUB = ${json};</script>`;
}

/** The team menu's headings, the league's (lib/teams.js LEAGUE_ABBR), and icons. */
const SPORT_ICON = { mlb: 'mdi-baseball', nfl: 'mdi-football', nba: 'mdi-basketball', nhl: 'mdi-hockey-puck', wnba: 'mdi-basketball', mls: 'mdi-soccer' };
const SPORT_LABEL = Object.fromEntries(Object.entries(SPORT_ICON).map(([s, icon]) => [s, [LEAGUE_ABBR[s], icon]]));

/** The footer's team changer, for a deployment with more than one club.
 *
 *  Built from the Share menu's own markup and classes — wrap, trigger, menu,
 *  items — so it takes the footer's look in every club's colours without a
 *  colour of its own.
 *
 *  Each sport is a <details>: on a desktop the menu is wide and every sport is
 *  open, its clubs in as many columns as fit; on a phone it is one column and
 *  only this club's sport is open, the others a tap away (Ray, 2026-10-19:
 *  "multi-columnar" on desktop, "nested" on mobile). 92 clubs in one column
 *  was a list nobody would scroll.
 *
 *  `clubs` is [{ sport, teamId, name, href }]; the current club is marked
 *  rather than left out, so the list reads the same from every page, and its
 *  sport comes first. The toggle behaves as share-core.js wireShareDropdown
 *  does, inline because the shell is the only thing every sport's page shares.
 */
export function clubMenuHtml(clubs, current) {
	if (!clubs || clubs.length < 2) return '';
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
	const sports = [...new Set(clubs.map((c) => c.sport))]
		.sort((a, b) => (a === current.sport ? -1 : b === current.sport ? 1 : a.localeCompare(b)));
	const itemsOf = (sport, icon) => clubs.filter((c) => c.sport === sport).sort((a, b) => a.name.localeCompare(b.name))
		.map((c) => {
			const here = c.sport === current.sport && c.teamId === current.teamId;
			return `<a class="footer-share-item" role="menuitem" href="${esc(c.href)}"${here ? ' aria-current="page" style="font-weight:700;color:var(--accent-text)"' : ''}><i class="mdi ${icon}"></i> ${esc(c.name)}</a>`;
		}).join('');
	// One sport needs no headings to choose between.
	const groups = sports.length === 1
		? `<div class="footer-club-items">${itemsOf(sports[0], (SPORT_LABEL[sports[0]] ?? [])[1] ?? 'mdi-trophy-outline')}</div>`
		: sports.map((sport) => {
			const [label, icon] = SPORT_LABEL[sport] ?? [sport.toUpperCase(), 'mdi-trophy-outline'];
			return `<details class="footer-club-group" data-sport="${esc(sport)}"${sport === current.sport ? ' data-current open' : ''}>`
				+ `<summary class="footer-share-item footer-club-sport"><i class="mdi ${icon}"></i> ${esc(label)}</summary>`
				+ `<div class="footer-club-items">${itemsOf(sport, icon)}</div></details>`;
		}).join('');
	return `<div class="footer-share-wrap footer-club-wrap">
                <button id="footer-club-trigger" class="footer-nav-link footer-share-trigger" type="button" aria-haspopup="true" aria-expanded="false">
                    <i class="mdi mdi-swap-horizontal"></i><span class="footer-nav-label">Team</span> <i class="mdi mdi-chevron-down footer-share-caret"></i>
                </button>
                <div class="footer-share footer-club-menu" role="menu" hidden>${groups}</div>
            </div>
            <style>
                /* Layout only; every colour is the Share menu's. */
                .footer-club-menu { width: min(46rem, calc(100vw - 2rem)); max-height: 70vh; overflow-y: auto; }
                .footer-club-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.1rem; }
                .footer-club-sport { list-style: none; cursor: pointer; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
                .footer-club-sport::-webkit-details-marker { display: none; }
                /* On a phone the Share menu centres on its button, and this button sits
                   right of centre, so the list ran off the screen. It spans the screen
                   instead, just above the footer. */
                @media (max-width: 700px) {
                    .footer-club-items { grid-template-columns: 1fr; }
                    .footer-club-menu { position: fixed; left: 1rem; right: 1rem; bottom: 4.5rem; width: auto; transform: none; }
                }
            </style>
            <script>(() => {
                const t = document.getElementById('footer-club-trigger'), m = t.nextElementSibling;
                const wide = window.matchMedia('(min-width: 701px)');
                const open = (on) => {
                    m.hidden = !on;
                    t.setAttribute('aria-expanded', String(on));
                    // Every sport open on a desktop; only this club's on a phone.
                    if (on) for (const d of m.querySelectorAll('.footer-club-group')) d.open = wide.matches || d.hasAttribute('data-current');
                };
                t.addEventListener('click', (e) => { e.stopPropagation(); open(m.hidden); if (!m.hidden) m.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' }); });
                document.addEventListener('click', (e) => { if (!m.hidden && !m.contains(e.target)) open(false); });
                document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) { open(false); t.focus(); } });
            })();</script>
            `;
}

/** The page shell: the sport's index.html with the club written in.
 *
 *  Everything rewritten here was a literal in the site's file. The sites'
 *  servers already stripped and re-injected the title and the meta block
 *  (loadShell in both), so that much is the same move they made. */
export function shell(html, { config, head = '', creditHtml = '', base = '', clubs = [], current = null }) {
	const title = config.site.title;
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	let out = html
		// The title and every preview tag; `head` carries this deployment's.
		.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
		.replace(/^\s*<meta (?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\r?\n/gm, '')
		// The question, in the heading. The baseball site wraps it in a link.
		.replace(/(<h1 id="site-title"[^>]*>(?:<a [^>]*>)?)[^<]*/, `$1${esc(title)}`)
		.replace(/href="https:\/\/github\.com\/rptetzloff\/AreThe[A-Za-z]+"/g, `href="${REPO_URL}"`);
	// The credit is this repo's, because the data is: the sites credited their
	// own sources, and the baseball one still carried a postal address that
	// Retrosheet's current terms no longer give (CLAUDE.md, "ASK").
	//
	// It is shown in the Disclaimer modal, not the page's main column (Ray,
	// 2026-10-19). The page's own block goes, and the credit travels as a
	// template, which renders nothing until license-modal.js reads it.
	out = out.replace(/\s*<div id="data-credit" class="data-credit"[^>]*>[\s\S]*?<\/div>/, '');
	if (creditHtml) out = out.replace('</body>', `    <template id="data-credit">${creditHtml}</template>\n</body>`);
	// The team changer, beside Share, when there is more than one club to change to.
	const menu = current ? clubMenuHtml(clubs, current) : '';
	if (menu) out = out.replace('<div class="footer-share-wrap">', `${menu}<div class="footer-share-wrap">`);
	// Every path the page uses is relative, and this says relative to what: the
	// club's own root, `/` alone or `/nfl/packers/` in a multi-club scope. First
	// in <head>, because a URL resolved before it would resolve against the
	// page's own address instead — /2024/ on a season page, which both sites
	// recorded as a bug when their paths were relative without one.
	out = out.replace(/<head>/, `<head>\n    <base href="${esc(base)}/">`);
	// The club, before any module script reads it.
	return out.replace('</head>', `    ${clubScript(config)}\n${head}</head>`);
}

// --- colour ---------------------------------------------------------------

/** Each stylesheet's source club and the colours that are its brand, by role.
 *
 *  Listed rather than detected. Detecting "near the base colour" was the first
 *  idea and is wrong in both directions: championship gold (#ffd700) sits close
 *  to the Brewers' accent and is not theirs, and the football end zone uses the
 *  Packers' raised green and is. So each colour here was read in its rule and
 *  assigned by hand, and anything not listed — win green, loss red, trophy
 *  gold, chart series — is never touched.
 *
 *  `dark` colours move with the base by their offset from it, `accent` ones
 *  with the accent, and `tint` ones (the light theme's near-white grounds) keep
 *  their distance from white in proportion to the base's.
 */
export const TEMPLATES = {
	mlb: {
		base: '#12284b', accent: '#ffc52f',
		dark: ['#12284b', '#1a3558', '#1a3a6b', '#1a3660', '#16305a', '#16294a', '#0d1d38'],
		accentFamily: ['#ffc52f', '#ffd45e', '#e0a820', '#8a5d00'],
		tint: ['#f3f5f9', '#eef2f8', '#e9eef6'],
		// `--x-rgb: r g b` forms of the same colours.
		rgb: { '18 40 75': 'dark', '255 197 47': 'accent', '214 158 0': 'accent', '138 93 0': 'accent' },
	},
	// Basketball's stylesheet is the baseball site's, unchanged, so its brand
	// colours are the Brewers' — mapped onto each NBA club's palette.
	get nba() { return TEMPLATES.mlb; },
	get nhl() { return TEMPLATES.mlb; },
	get wnba() { return TEMPLATES.mlb; },
	get mls() { return TEMPLATES.mlb; },
	nfl: {
		base: '#203731', accent: '#ffb612',
		dark: ['#203731', '#152a1e', '#1a2e28'],
		accentFamily: ['#ffb612', '#ffd050', '#8a5d00'],
		tint: ['#f4f6f2', '#e8eee9'],
		rgb: { '32 55 49': 'dark', '255 182 18': 'accent', '138 93 0': 'accent' },
	},
};

const toRgb = (hex) => {
	const h = hex.replace('#', '');
	const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Where one template colour goes for a club whose base and accent are given. */
export function mapColour(hex, role, template, palette) {
	const c = toRgb(hex);
	if (role === 'tint') {
		const sb = toRgb(template.base), tb = toRgb(palette.base);
		return toHex(c.map((v, i) => 255 - (255 - v) * ((255 - tb[i]) / Math.max(1, 255 - sb[i]))));
	}
	const from = toRgb(role === 'accent' ? template.accent : template.base);
	const to = toRgb(role === 'accent' ? palette.accent : palette.base);
	return toHex(c.map((v, i) => to[i] + (v - from[i])));
}

/** A template's text with its brand colours moved to `palette`.
 *
 *  The identity for the source club, by construction: every offset is zero.
 *  That is what keeps the Brewers and the Packers byte-identical to their
 *  sites, and test/web.test.js holds it. */
export function recolor(text, sport, palette) {
	const t = TEMPLATES[sport];
	if (!t || !palette) return text;
	const same = palette.base.toLowerCase() === t.base && palette.accent.toLowerCase() === t.accent;
	if (same) return text;
	const role = new Map([
		...t.dark.map((h) => [h, 'dark']),
		...t.accentFamily.map((h) => [h, 'accent']),
		...t.tint.map((h) => [h, 'tint']),
	]);
	let out = text.replace(/#[0-9a-fA-F]{6}\b/g, (m) => {
		const r = role.get(m.toLowerCase());
		return r ? mapColour(m, r, t, palette) : m;
	});
	for (const [triplet, r] of Object.entries(t.rgb)) {
		const hex = toHex(triplet.split(' ').map(Number));
		const mapped = toRgb(mapColour(hex, r, t, palette)).join(' ');
		out = out.split(`: ${triplet};`).join(`: ${mapped};`);
	}
	return out;
}

// --- history --------------------------------------------------------------

const csvCell = (v) => {
	const s = v === null || v === undefined ? '' : String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cols, row) => cols.map((c) => csvCell(row[c])).join(',');

/** Retrosheet's gameinfo header, as the baseball site's data/gameinfo.csv
 *  carries it. The page reads columns by name, so the order is cosmetic, but
 *  it is kept so the file reads like the one it replaces. */
export const GAMEINFO_HEADER = ['gid', 'visteam', 'hometeam', 'site', 'date', 'number', 'starttime',
	'daynight', 'innings', 'tiebreaker', 'usedh', 'htbf', 'timeofgame', 'attendance', 'fieldcond',
	'precip', 'sky', 'temp', 'winddir', 'windspeed', 'oscorer', 'forfeit', 'suspend', 'umphome',
	'ump1b', 'ump2b', 'ump3b', 'umplf', 'umprf', 'wp', 'lp', 'save', 'gametype', 'vruns', 'hruns',
	'wteam', 'lteam', 'line', 'batteries', 'lineups', 'box', 'pbp', 'season',
	// Not Retrosheet's: how the game ended, REG, OT or SO (0014), which is what
	// makes a hockey loss an overtime loss. Empty for the other sports.
	'ending',
	// A shootout's totals (0016), soccer's alone: "1-1 (4-2 pens)".
	'vpens', 'hpens'];

/** One stored baseball game as a gameinfo row.
 *
 *  Filled: everything the front page reads to place and score a game. Empty:
 *  the park, the umpires, the pitchers of record and the rest, which the load
 *  never kept. That is the same set the baseball site's own live capture left
 *  empty (its lib/espn-current.js), so the page already copes with it.
 *
 *  Clubs are FRANCHISE codes (MIL for a 1969 Pilots game), not Retrosheet's
 *  era codes (SE1). The page resolves names by franchise and date through
 *  CurrentNames.csv, and every franchise code here is one of its
 *  `franchiseName` values — checked: 30 of 30 since 1969. */
const ROUND_GAMETYPE = { regular: 'regular', playoff: 'postseason', championship: 'worldseries' };

export function gameinfoRow(g, { gametypeOf = null } = {}) {
	const final = g.status === 'final';
	// The stored winner (0016) when the row has one, which a shootout decides;
	// the scores otherwise.
	const homeWon = final && (g.winner !== undefined ? g.winner === g.home : g.homeScore > g.awayScore);
	const awayWon = final && (g.winner !== undefined ? g.winner === g.away : g.awayScore > g.homeScore);
	return {
		gid: g.id,
		visteam: g.away,
		hometeam: g.home,
		date: g.date.replace(/-/g, ''),
		// The last character of a Retrosheet id is its game number.
		// A Retrosheet id ends in its game number. Other sources' ids (ESPN's
		// NBA event ids) end in any digit, and a club plays once a day.
		number: /^[A-Z]{3}\d{9}$/.test(g.id) ? g.id.slice(-1) : '0',
		// The source's word when the load kept it. A row loaded before 0011 has
		// none, and must still not read as the regular season: `postseason` is
		// the word the baseball page files under the postseason without naming
		// a round, so the record stays right and only the label is general.
		gametype: gametypeOf?.(g) ?? g.stage ?? ROUND_GAMETYPE[g.round] ?? 'regular',
		vruns: final ? g.awayScore : '',
		hruns: final ? g.homeScore : '',
		wteam: homeWon ? g.home : awayWon ? g.away : '',
		lteam: homeWon ? g.away : awayWon ? g.home : '',
		season: g.season,
		ending: final ? (g.ending ?? '') : '',
		vpens: final ? (g.awayPens ?? '') : '',
		hpens: final ? (g.homePens ?? '') : '',
	};
}

/** A hockey playoff game's round as the page's code, counted from the Final
 *  back: the NHL numbers its rounds from the first (R1 ... R4), and a season of
 *  two or three rounds (1918-1974) would otherwise call its Final a second-
 *  round series. `rounds` is the season's count; four, today's, when the
 *  season's Final has not been played. Null for anything but a round. */
export function nhlGametype(stage, rounds = 4) {
	const r = Number(/^R(\d+)$/.exec(stage ?? '')?.[1]);
	if (!r || r > rounds) return null;
	return ['W', 'L', 'D', 'F'][rounds - r] ?? 'F';
}

/** A WNBA playoff game's round as the page's code. The league has played two
 *  rounds (1997, 1998), three and four, so the last two are named from the
 *  Final back — Semifinals, Finals — and any before them from the front: First
 *  Round, then Second Round. `rounds` is the season's count. Null for anything
 *  but a round. */
export function wnbaGametype(stage, rounds) {
	const r = Number(/^R(\d+)$/.exec(stage ?? '')?.[1]);
	if (!r || !rounds || r > rounds) return null;
	if (r === rounds) return 'W';
	if (r === rounds - 1) return 'L';
	return r === 1 ? 'F' : 'D';
}

/** An MLS playoff game's round as the page's code, counted back from MLS Cup:
 *  W MLS Cup, L a conference final, D a conference semifinal, F Round One
 *  (or the first round of a four-round season), X a wild card. MLS has played
 *  three rounds (1996-2010), four and five; `rounds` is the season's count,
 *  from the load's numbering (scripts/load.mjs numberSeriesRounds). */
export function mlsGametype(stage, rounds) {
	const r = Number(/^R(\d+)$/.exec(stage ?? '')?.[1]);
	if (!r || !rounds || r > rounds) return null;
	return ['W', 'L', 'D', 'F', 'X'][rounds - r] ?? 'X';
}

export const gameinfoCsv = (games, { header = true, gametypeOf = null } = {}) => {
	const lines = games.map((g) => csvLine(GAMEINFO_HEADER, gameinfoRow(g, { gametypeOf })));
	return (header ? [GAMEINFO_HEADER.join(','), ...lines] : lines).join('\n') + '\n';
};

/** Retrosheet's CurrentNames.csv, from the franchise history table it was
 *  built from — the same rows, minus the colour and ESPN columns this repo
 *  added. */
export function currentNamesCsv(rows, { calendarYear = false } = {}) {
	const header = ['franchiseName', 'teamName', 'league', 'division', 'city', 'team', 'alternate',
		'startDate', 'endDate', 'locationCity', 'locationState'];
	// A table counted in seasons becomes dates, which is what the page's name
	// lookup compares game dates against. Basketball's and hockey's seasons run
	// across New Year: one ending in 2027 is October 2026 to the next September.
	// The WNBA's and MLS's are the calendar year — counted as basketball's, the
	// MetroStars' 2005 playoff games, in October and November, were the Red
	// Bulls', and Detroit's 2009 WNBA playoffs were Tulsa's.
	const from = (r) => r.startDate ?? (!r.startSeason ? '' : calendarYear ? `1/1/${r.startSeason}` : `10/1/${Number(r.startSeason) - 1}`);
	const to = (r) => r.endDate ?? (!r.endSeason ? '' : calendarYear ? `12/31/${r.endSeason}` : `9/30/${r.endSeason}`);
	const lines = rows.map((r) => [r.franchiseAbbrv, r.teamAbbrv, r.league, r.division, r.city, r.teamName,
		r.alternateName, from(r), to(r), r.locationCity, r.locationState].map(csvCell).join(','));
	return [header.join(','), ...lines].join('\n') + '\n';
}

/** The football site's games CSV header, with its three club-named columns
 *  renamed (`Packers Win`, `packers_score` became `result`, `team_score`). */
export const NFL_GAMES_HEADER = ['date', 'season', 'regular_season', 'playoff', 'superbowl', 'Opponent',
	'result', 'team_score', 'opponent_score', 'location', 'espn_id', 'stadium', 'roof', 'surface',
	'temp', 'wind', 'referee', 'weekday', 'gametime', 'overtime', 'div_game', 'spread', 'qb_id', 'qb',
	'opponent_qb_id', 'opponent_qb', 'stadium_id'];

const ROMAN = [[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const roman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');

/** One stored football game from one club's side, as the football site's row.
 *
 *  `superbowl` is the lowercase numeral the site writes, and only on Super
 *  Bowl rows: the 1966 season's final was Super Bowl I, so the numeral is the
 *  season less 1965. NFL Championship games before it carry none, as on the
 *  site. `nameOf` gives the opponent's name in that season. */
export function nflGameRow(g, franchise, nameOf) {
	const home = g.home === franchise;
	const final = g.status === 'final';
	const us = home ? g.homeScore : g.awayScore;
	const them = home ? g.awayScore : g.homeScore;
	const isSuperBowl = g.stage === 'SB' || (g.round === 'championship' && g.title === 'Super Bowl');
	return {
		date: g.date,
		season: g.season,
		regular_season: g.round === 'regular' ? '1' : '0',
		playoff: g.round === 'regular' ? '0' : '1',
		superbowl: isSuperBowl ? roman(g.season - 1965) : '',
		Opponent: nameOf(home ? g.away : g.home, g.season),
		result: !final ? '' : us > them ? 'WIN' : us < them ? 'LOSS' : 'TIE',
		team_score: final ? us : '',
		opponent_score: final ? them : '',
		location: g.neutral ? 'NEUTRAL' : home ? 'HOME' : 'AWAY',
	};
}

export const nflGamesCsv = (rows) =>
	[NFL_GAMES_HEADER.join(','), ...rows.map((r) => csvLine(NFL_GAMES_HEADER, r))].join('\n') + '\n';

/** The football site's season_records CSV, from the same rows, as its
 *  update-data.js builds it: regular season and postseason, W-L-T each. */
export function seasonRecordsCsv(rows) {
	const by = new Map();
	for (const r of rows) {
		if (!r.result) continue;
		const s = by.get(r.season) ?? { season: r.season, reg_w: 0, reg_l: 0, reg_t: 0, post_w: 0, post_l: 0, post_t: 0 };
		const k = `${r.regular_season === '1' ? 'reg' : 'post'}_${r.result === 'WIN' ? 'w' : r.result === 'LOSS' ? 'l' : 't'}`;
		s[k]++;
		by.set(r.season, s);
	}
	const cols = ['season', 'reg_w', 'reg_l', 'reg_t', 'post_w', 'post_l', 'post_t'];
	return [cols.join(','), ...[...by.values()].sort((a, b) => a.season - b.season).map((s) => csvLine(cols, s))].join('\n') + '\n';
}

/** Every name a football franchise has carried, mapped to its latest one, for
 *  the football page's head-to-head fold (web/nfl/h2h-core.js).
 *
 *  The football site folded three relocations by hand and got away with it
 *  because its pre-1999 rows were already named by franchise, FiveThirtyEight
 *  style: a 1950 game was against the "Arizona Cardinals". The names here are
 *  era-correct throughout, so the fold has to be complete, and the history
 *  table is the one place that knows every era of every franchise.
 *
 *  A name two franchises both carried — the New York Yankees were two
 *  different clubs — is left out, because folding it would merge them. */
export function franchiseAliases(rows, displayName) {
	const latest = new Map();
	const start = (r) => Number(r.startSeason ?? 0) || Date.parse(r.startDate ?? '') || 0;
	for (const r of rows) {
		const seen = latest.get(r.franchiseAbbrv);
		if (!seen || start(r) >= start(seen)) latest.set(r.franchiseAbbrv, r);
	}
	const target = new Map();
	const ambiguous = new Set();
	for (const r of rows) {
		const name = displayName(r);
		const to = displayName(latest.get(r.franchiseAbbrv));
		if (target.has(name) && target.get(name) !== to) ambiguous.add(name);
		target.set(name, to);
	}
	const out = {};
	for (const [name, to] of target) if (name !== to && !ambiguous.has(name)) out[name] = to;
	return out;
}

export const readText = (path) => readFileSync(path, 'utf8');
