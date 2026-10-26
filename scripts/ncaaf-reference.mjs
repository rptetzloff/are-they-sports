#!/usr/bin/env node
/** College football's clubs, from ESPN: every FBS programme in a season's
 *  standings, with its conference, ESPN's id, abbreviation, colours and name.
 *  Writes
 *
 *    data/reference/ncaaf-franchise-history.csv   one row a club
 *    data/reference/ncaaf-divisions.csv           code, conference
 *    teams/ncaaf/<id>.js                          one manifest a club
 *
 *  Run again when the FBS changes (a programme moving up, a conference
 *  realigning): node scripts/ncaaf-reference.mjs [season]. The files are
 *  committed; nothing at runtime asks ESPN for them.
 *
 *  A club's codes are ESPN's abbreviation (WIS) and ESPN's team id (275),
 *  which CollegeFootballData shares: its games name every side by that id, back
 *  to the 1800s, so the id is what joins a game to a club. Every other team a
 *  club has played (FCS, lower divisions, programmes long gone) has no row
 *  here; the load gives each one a franchise of its own, named from the games
 *  (scripts/load.mjs). */
import { writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const season = Number(process.argv[2]) || new Date().getFullYear();
const get = async (url) => {
	const r = await fetch(url);
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return r.json();
};

// The FBS (ESPN's group 80), conference by conference; a conference with
// divisions nests them.
const standings = await get(`https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&season=${season}`);
const confOf = new Map();
const walk = (node, conf) => {
	for (const e of node.standings?.entries ?? []) confOf.set(String(e.team.id), conf);
	for (const c of node.children ?? []) walk(c, conf ?? c.name);
};
for (const c of standings.children ?? []) walk(c, c.name);

// Every team's details: the standings carry only names.
const list = await get('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000');
const teams = new Map(list.sports[0].leagues[0].teams.map(({ team: t }) => [String(t.id), t]));

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hex = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') && !/^(000000|ffffff)$/i.test(c) ? `#${c.toUpperCase()}` : '');
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const clubs = [...confOf].map(([id, conference]) => {
	const t = teams.get(id);
	if (!t) throw new Error(`ESPN lists team ${id} in the standings and not in its teams`);
	return {
		id, conference,
		abbr: t.abbreviation,
		school: t.location,
		mascot: t.name,
		full: t.displayName,
		slug: slug(t.location),
		colors: [hex(t.color), hex(t.alternateColor)].filter(Boolean),
	};
}).sort((a, b) => a.full.localeCompare(b.full));

// A code and a page are one club's each: say so here rather than let a later
// club quietly win.
for (const key of ['abbr', 'slug']) {
	const seen = new Map();
	for (const c of clubs) {
		if (seen.has(c[key])) throw new Error(`${key} ${c[key]} is ${seen.get(c[key]).full} and ${c.full}`);
		seen.set(c[key], c);
	}
}

// Each programme's first season, from CollegeFootballData's games where the
// load has fetched them (data/sources/cfbd); 1869 for any it has not.
const firstSeason = new Map();
const cache = join(ROOT, 'data', 'sources', 'cfbd');
if (existsSync(cache)) {
	for (const f of readdirSync(cache).filter((n) => /^games-\d{4}\.json$/.test(n)).sort()) {
		const year = Number(f.slice(6, 10));
		for (const g of JSON.parse(readFileSync(join(cache, f), 'utf8'))) {
			for (const id of [g.homeId, g.awayId]) if (id != null && !firstSeason.has(String(id))) firstSeason.set(String(id), year);
		}
	}
}

const ref = join(ROOT, 'data', 'reference');
writeFileSync(join(ref, 'ncaaf-franchise-history.csv'), [
	'# Every FBS programme: codes, conference and colours, from ESPN\'s',
	`# ${season} standings and team list (scripts/ncaaf-reference.mjs; do not edit by hand).`,
	'#',
	'# espnAbbrv is ESPN\'s abbreviation; idAbbrv is ESPN\'s team id, which',
	'# CollegeFootballData also uses and by which every game names its sides.',
	'# One row a club: a programme\'s history is one era here, because its',
	'# conference changes nearly every year and each game carries its own.',
	'franchiseAbbrv,teamAbbrv,espnAbbrv,idAbbrv,league,conference,division,city,teamName,alternateName,startSeason,endSeason,locationCity,locationState,colorA,colorB,colorC,colorD,colorE',
	...clubs.map((c) => [c.abbr, c.abbr, c.abbr, c.id, 'NCAAF', c.conference, '', c.school, c.mascot, '', firstSeason.get(c.id) ?? 1869, '', '', '', c.colors[0] ?? '', c.colors[1] ?? '', '', '', '']
		.map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(ref, 'ncaaf-divisions.csv'), [
	`# Each FBS programme's conference in ${season}, from ESPN's standings`,
	'# (scripts/ncaaf-reference.mjs).',
	'#',
	'code,conference,division',
	...clubs.map((c) => [c.abbr, c.conference, ''].map(csv).join(',')),
].join('\n') + '\n');

const dir = join(ROOT, 'teams', 'ncaaf');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(join(dir, f));
for (const c of clubs) {
	writeFileSync(join(dir, `${c.slug}.js`), `/** ${c.full}. */
export const team = {
	sport: 'ncaaf',
	id: ${q(c.slug)},
	sourceIds: [${q(c.abbr)}],
	firstSeason: ${firstSeason.get(c.id) ?? 1869},

	// School and mascot both: five FBS programmes are the Tigers.
	nouns: {
		team: ${q(c.full)},
		fullName: ${q(c.full)},
	},

	/** ESPN's id for the programme, which its schedules are asked by. */
	site: { espnSlug: ${q(c.id)} },
};

export default team;
`);
}
const by = {};
for (const c of clubs) by[c.conference] = (by[c.conference] ?? 0) + 1;
console.log(`${clubs.length} FBS programmes, ${season}:`, by);
