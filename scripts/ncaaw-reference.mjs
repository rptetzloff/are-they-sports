#!/usr/bin/env node
/** Women's college basketball's clubs: every Division I programme, from ESPN's
 *  teams and conferences. Writes
 *
 *    data/reference/ncaaw-franchise-history.csv   one row a club
 *    data/reference/ncaaw-divisions.csv           code, conference
 *    data/reference/ncaaw-opponents.csv           every other team a club has played
 *    teams/ncaaw/<id>.js                          one manifest a club
 *
 *  Run again when Division I changes: node scripts/ncaaw-reference.mjs. ESPN's
 *  two lists are kept in data/sources/espn-ncaaw; a club's first season and the
 *  opponents' names come from the seasons a load keeps (data/sources/ncaaw).
 *
 *  A club's codes: ESPN's abbreviation (CONN) and ESPN's team id (41), which
 *  every game names it by. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkGround } from './college-colors.mjs';
import { csvRows, parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'espn-ncaaw');
const GAMES = join(ROOT, 'data', 'sources', 'ncaaw');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball';
mkdirSync(CACHE, { recursive: true });

const kept = async (name, url) => {
	const path = join(CACHE, name);
	if (!existsSync(path)) {
		const r = await fetch(url);
		if (!r.ok) throw new Error(`${r.status} ${url}`);
		writeFileSync(path, await r.text());
	}
	return JSON.parse(readFileSync(path, 'utf8'));
};
const teams = (await kept('teams.json', `${ESPN}/teams?groups=50&limit=500`)).sports[0].leagues[0].teams.map(({ team }) => team);
// The standings, for each club's conference: ESPN's /groups lists the teams of
// only some of them.
const standings = (await kept('standings.json', 'https://site.api.espn.com/apis/v2/sports/basketball/womens-college-basketball/standings')).children;
const groups = standings.map((c) => ({ id: String(c.id), name: c.name, teams: c.standings.entries.map((e) => e.team) }));
// The two lists disagree at the edges: Mercyhurst and Saint Francis are in the
// standings and not the teams list, West Florida (new this season) the other
// way. A club in either is a club, and ESPN's page for it fills in the rest.
const teamPage = async (id) => (await kept(`team-${id}.json`, `${ESPN}/teams/${id}`)).team;
for (const t of groups.flatMap((g) => g.teams)) {
	if (!teams.some((c) => String(c.id) === String(t.id))) teams.push(await teamPage(t.id));
}
for (const t of teams) {
	if (groups.some((g) => g.teams.some((c) => String(c.id) === String(t.id)))) continue;
	const home = groups.find((g) => g.id === String(t.groups?.id ?? ''));
	const group = (home ?? (await teamPage(t.id).then((page) => groups.find((g) => g.id === String(page.groups?.id)))));
	group?.teams.push(t);
}

// A conference by the name men's pages give it, where its schools are men's
// too: ESPN's own are "Atlantic 10 Conference" and "aeast", and one conference
// should not be two spellings across two sports.
const mens = new Map(parseCsv(readFileSync(join(REF, 'ncaam-franchise-history.csv'), 'utf8')).map((r) => [r.idAbbrv, r.conference]));
const conferenceOf = new Map();
for (const g of groups) {
	const tally = new Map();
	for (const t of g.teams) if (mens.get(String(t.id))) tally.set(mens.get(String(t.id)), (tally.get(mens.get(String(t.id))) ?? 0) + 1);
	const name = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.name.replace(/ Conference$/, '');
	for (const t of g.teams) conferenceOf.set(String(t.id), name);
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hex = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') && !/^(000000|ffffff)$/i.test(c) ? `#${c.toUpperCase()}` : '');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const clubs = teams.map((t) => ({
	espn: String(t.id), abbr: t.abbreviation, school: t.location, mascot: t.name ?? '',
	full: t.displayName, conference: conferenceOf.get(String(t.id)) ?? '',
	slug: slug(t.location), colors: darkGround(`${t.location} ${t.name ?? ''}`, [hex(t.color), hex(t.alternateColor)].filter(Boolean)),
})).sort((a, b) => a.full.localeCompare(b.full));
for (const key of ['abbr', 'slug', 'espn']) {
	const seen = new Map();
	for (const c of clubs) {
		if (seen.has(c[key])) throw new Error(`${key} ${c[key]} is ${seen.get(c[key]).full} and ${c.full}`);
		seen.set(c[key], c);
	}
}
const unplaced = clubs.filter((c) => !c.conference);
if (unplaced.length) throw new Error(`no conference: ${unplaced.map((c) => c.full).join(', ')}`);

// Each club's first season, and every other team's latest name.
const firstSeason = new Map();
const isClub = new Set(clubs.map((c) => c.espn));
const opponents = new Map();
const files = existsSync(GAMES) ? readdirSync(GAMES).filter((n) => /^wbb_schedule_\d{4}\.csv$/.test(n)).sort().map((f) => join(GAMES, f)) : [];
// And what those files lack (scripts/ncaaw-fill.mjs), read first so the files'
// names are the ones kept.
const added = join(REF, 'ncaaw-games-added.csv');
for (const f of existsSync(added) ? [added, ...files] : files) {
	for await (const g of csvRows(f)) {
		const { home_id: home, away_id: away } = g;
		if (!/^\d+$/.test(home) || !/^\d+$/.test(away)) continue;
		const year = Number(g.season);
		for (const id of [home, away]) if (!(firstSeason.get(id) <= year)) firstSeason.set(id, year);
		if (!isClub.has(home) && !isClub.has(away)) continue;
		if (!isClub.has(home) && g.home_location) opponents.set(home, g.home_location);
		if (!isClub.has(away) && g.away_location) opponents.set(away, g.away_location);
	}
}

writeFileSync(join(REF, 'ncaaw-franchise-history.csv'), [
	'# Every Division I women\'s basketball programme: codes, conference and colours,',
	'# from ESPN\'s teams and conferences (scripts/ncaaw-reference.mjs; do not edit).',
	'#',
	'# espnAbbrv is ESPN\'s abbreviation; idAbbrv ESPN\'s team id, as every game names a side.',
	'franchiseAbbrv,teamAbbrv,espnAbbrv,idAbbrv,league,conference,division,city,teamName,alternateName,startSeason,endSeason,locationCity,locationState,colorA,colorB,colorC,colorD,colorE',
	...clubs.map((c) => [c.abbr, c.abbr, c.abbr, c.espn, 'NCAAW', c.conference, '', c.school, c.mascot, '', firstSeason.get(c.espn) ?? 2001, '', '', '', c.colors[0] ?? '', c.colors[1] ?? '', '', '', '']
		.map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(REF, 'ncaaw-divisions.csv'), [
	'# Each Division I programme\'s conference today, from ESPN',
	'# (scripts/ncaaw-reference.mjs).',
	'#',
	'code,conference,division',
	...clubs.map((c) => [c.abbr, c.conference, ''].map(csv).join(',')),
].join('\n') + '\n');
if (opponents.size) {
	writeFileSync(join(REF, 'ncaaw-opponents.csv'), [
		'# Every team a Division I programme has played that is no Division I programme',
		'# today, by ESPN\'s id and the latest name a game gives it',
		'# (scripts/ncaaw-reference.mjs, from the seasons the load keeps; do not edit).',
		'id,name',
		...[...opponents].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => [id, name].map(csv).join(',')),
	].join('\n') + '\n');
}

const dir = join(ROOT, 'teams', 'ncaaw');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(join(dir, f));
for (const c of clubs) {
	writeFileSync(join(dir, `${c.slug}.js`), `/** ${c.full}. */
export const team = {
	sport: 'ncaaw',
	id: ${q(c.slug)},
	sourceIds: [${q(c.abbr)}],
	firstSeason: ${firstSeason.get(c.espn) ?? 2001},

	// School and mascot both: a dozen programmes are the Tigers.
	nouns: {
		team: ${q(c.full)},
		fullName: ${q(c.full)},
		// The school alone, where a table is narrow.
		school: ${q(c.school)},
	},

	/** ESPN's id for the programme, which its schedules are asked by. */
	site: { espnSlug: ${q(c.espn)} },
};

export default team;
`);
}
const by = {};
for (const c of clubs) by[c.conference] = (by[c.conference] ?? 0) + 1;
console.log(`${clubs.length} programmes, ${Object.keys(by).length} conferences (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}); ${opponents.size} opponents named; ${files.length} seasons read`);
