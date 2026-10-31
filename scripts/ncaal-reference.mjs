#!/usr/bin/env node
/** Men's college lacrosse's clubs: every Division I programme, from ESPN. Writes
 *
 *    data/reference/ncaal-franchise-history.csv   one row a club
 *    data/reference/ncaal-divisions.csv           code, conference
 *    data/reference/ncaal-opponents.csv           every other team a club has played
 *    teams/ncaal/<id>.js                          one manifest a club
 *
 *  ESPN's team list and standings are empty for this league. So a club is whoever
 *  plays a Division I schedule, which the games show: 8 of them last season, where
 *  the sides from outside Division I play one or two. ESPN knows the conferences
 *  of 15 clubs, so a club's is Wikipedia's (List of NCAA Division I lacrosse
 *  programs, CC BY-SA), and a club missing from that table stops the script.
 *
 *  A club's colours are its school's in the basketball or football files, by name
 *  and mascot, ESPN's ids being per sport, and else ESPN's own here. Either way
 *  darkGround (scripts/college-colors.mjs) gives it a ground white text can be read
 *  on.
 *
 *  Run after scripts/ncaal-games.mjs, when Division I changes:
 *  node scripts/ncaal-reference.mjs. ESPN's answers are kept in data/sources/espn-ncaal,
 *  Wikipedia's in data/sources/wiki-ncaal.
 *
 *  A club's codes: ESPN's abbreviation (DUKE) and ESPN's team id (150), which every
 *  game names it by. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkGround } from './college-colors.mjs';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'espn-ncaal');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse';
const WIKI = join(ROOT, 'data', 'sources', 'wiki-ncaal', 'List_of_NCAA_Division_I_lacrosse_programs.json');
mkdirSync(CACHE, { recursive: true });

const kept = async (name, url) => {
	const path = join(CACHE, name);
	if (!existsSync(path)) {
		await new Promise((r) => setTimeout(r, 250));
		const r = await fetch(url);
		if (!r.ok) throw new Error(`${r.status} ${url}`);
		writeFileSync(path, await r.text());
	}
	return JSON.parse(readFileSync(path, 'utf8'));
};

const games = parseCsv(readFileSync(join(REF, 'ncaal-games.csv'), 'utf8'));
const lastSeason = Math.max(...games.map((g) => Number(g.season)));
const count = new Map();
for (const g of games.filter((x) => Number(x.season) === lastSeason)) for (const id of [g.home, g.away]) count.set(id, (count.get(id) ?? 0) + 1);
const ids = [...count].filter(([, n]) => n >= 8).map(([id]) => id);

const hex = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') && !/^(000000|ffffff)$/i.test(c) ? `#${c.toUpperCase()}` : '');

/** Each sport's schools by name and mascot, for their colours. */
const elsewhere = new Map();
for (const sport of ['ncaam', 'ncaaf']) {
	for (const r of parseCsv(readFileSync(join(REF, `${sport}-franchise-history.csv`), 'utf8'))) {
		const key = `${r.city} ${r.teamName}`;
		if (r.colorA && !elsewhere.has(key)) elsewhere.set(key, [r.colorA, r.colorB, r.colorC, r.colorD, r.colorE].filter(Boolean));
	}
}

if (!existsSync(WIKI)) {
	mkdirSync(dirname(WIKI), { recursive: true });
	const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent('List of NCAA Division I lacrosse programs')}`,
		{ headers: { 'User-Agent': 'are-they-sports (https://github.com/rptetzloff/are-they-sports)' } });
	if (!r.ok) throw new Error(`${r.status} List of NCAA Division I lacrosse programs`);
	writeFileSync(WIKI, await r.text());
}
const wikitext = JSON.parse(readFileSync(WIKI, 'utf8')).parse.wikitext['*'];
const men = wikitext.slice(wikitext.indexOf('==Men=='), wikitext.indexOf('===Future men'));
/** ESPN's long names, to the ones the conference pages use. */
const SHORT = {
	'Atlantic Coast Conference': 'ACC', 'Big Ten Conference': 'Big Ten', 'Big East Conference': 'Big East', 'Ivy League': 'Ivy League', 'Patriot League': 'Patriot League',
	'Coastal Athletic Association': 'CAA', 'Northeast Conference': 'NEC', 'Metro Conference': 'MAAC',
	'America East Conference': 'America East', 'Atlantic Sun Conference': 'ASUN', 'Atlantic 10 Conference': 'Atlantic 10',
};
const listed = [];
for (const row of men.split(/\n\|-/)) {
	const cells = row.split('\n').filter((l) => l.startsWith('|'));
	if (cells.length < 6) continue;
	// The fifth cell, or the fourth where a conference spans its two columns.
	const cell = /^\|\s*(?:colspan=2\s*\|\s*)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/m;
	const line = cells.find((l) => /colspan=2/.test(l)) ?? cells[4];
	const name = cell.exec(line)?.[1] ?? (/independent/i.test(line) ? 'Independent' : null);
	listed.push({ school: cells[0], team: /\[\[([^\]|]+) men's lacrosse\|/.exec(row)?.[1], conference: SHORT[name] ?? name });
}
/** ESPN's men's side here is the Minutewomen, misspelt. */
const RENAME = { 'Massachusetts MInutewomen': { school: 'Massachusetts', mascot: 'Minutemen', full: 'Massachusetts Minutemen' } };
/** Where Wikipedia's table has a programme under another name, or under its school
 *  alone, having no article for the team. */
const LISTED_AS = {
	'Canisius Griffins': 'Canisius', 'Cleveland State Vikings': 'Cleveland State', 'Iona Gaels': 'Iona', 'Le Moyne Dolphins': 'Le Moyne',
	'Long Island University Sharks': 'Long Island University', 'Loyola Maryland Greyhounds': 'Loyola University Maryland', 'Massachusetts Minutemen': 'UMass',
	'Merrimack Warriors': 'Merrimack', 'Pennsylvania Quakers': 'University of Pennsylvania', 'Queens University Royals': 'Queens University', 'UAlbany Great Danes': 'University at Albany',
};
const conferenceOf = (full) => (listed.find((r) => r.team === full) ?? listed.find((r) => LISTED_AS[full] && r.school.includes(LISTED_AS[full])))?.conference ?? '';

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const clubs = [];
for (const id of ids) {
	const { team: t } = await kept(`schedule-${id}.json`, `${ESPN}/teams/${id}/schedule?season=${lastSeason}`);
	const { school, mascot, full } = RENAME[t.displayName.trim()] ?? { school: t.location.trim(), mascot: t.name ?? '', full: t.displayName.trim() };
	const own = [hex(t.color), hex(t.alternateColor)].filter(Boolean);
	clubs.push({
		espn: id, abbr: t.abbreviation, school, mascot, full, conference: conferenceOf(full),
		slug: slug(school), colors: darkGround(full, elsewhere.get(full) ?? own),
	});
}
clubs.sort((a, b) => a.full.localeCompare(b.full));
const unplaced = clubs.filter((c) => !c.conference);
if (unplaced.length) throw new Error(`no conference: ${unplaced.map((c) => c.full).join(', ')}`);
for (const key of ['abbr', 'slug', 'espn']) {
	const seen = new Map();
	for (const c of clubs) {
		if (seen.has(c[key])) throw new Error(`${key} ${c[key]} is ${seen.get(c[key]).full} and ${c.full}`);
		seen.set(c[key], c);
	}
}

// Each club's first season here, and every other team's latest name.
const firstSeason = new Map();
const isClub = new Set(clubs.map((c) => c.espn));
const opponents = new Map();
for (const g of games) {
	const year = Number(g.season);
	for (const id of [g.home, g.away]) if (!(firstSeason.get(id) <= year)) firstSeason.set(id, year);
	if (!isClub.has(g.home)) opponents.set(g.home, g.home_name);
	if (!isClub.has(g.away)) opponents.set(g.away, g.away_name);
}
const first = (c) => firstSeason.get(c.espn);

writeFileSync(join(REF, 'ncaal-franchise-history.csv'), [
	'# Every Division I men\'s lacrosse programme: codes, conference and colours, from',
	'# ESPN and the other college files (scripts/ncaal-reference.mjs; do not edit).',
	'#',
	'# espnAbbrv is ESPN\'s abbreviation; idAbbrv ESPN\'s team id, as every game names a side.',
	'franchiseAbbrv,teamAbbrv,espnAbbrv,idAbbrv,league,conference,division,city,teamName,alternateName,startSeason,endSeason,locationCity,locationState,colorA,colorB,colorC,colorD,colorE',
	...clubs.map((c) => [c.abbr, c.abbr, c.abbr, c.espn, 'NCAAL', c.conference, '', c.school, c.mascot, '', first(c), '', '', '', ...Array.from({ length: 5 }, (_, i) => c.colors[i] ?? '')]
		.map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(REF, 'ncaal-divisions.csv'), [
	'# Each Division I programme\'s conference today, from ESPN',
	'# (scripts/ncaal-reference.mjs).',
	'#',
	'code,conference,division',
	...clubs.map((c) => [c.abbr, c.conference, ''].map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(REF, 'ncaal-opponents.csv'), [
	'# Every team a Division I programme has played that is no Division I programme',
	'# today, by ESPN\'s id and the latest name a game gives it',
	'# (scripts/ncaal-reference.mjs; do not edit).',
	'id,name',
	...[...opponents].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => [id, name].map(csv).join(',')),
].join('\n') + '\n');

const dir = join(ROOT, 'teams', 'ncaal');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(join(dir, f));
for (const c of clubs) {
	writeFileSync(join(dir, `${c.slug}.js`), `/** ${c.full}. */
export const team = {
	sport: 'ncaal',
	id: ${q(c.slug)},
	sourceIds: [${q(c.abbr)}],
	firstSeason: ${first(c)},

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
console.log(`${clubs.length} programmes, ${Object.keys(by).length} conferences (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}); ${opponents.size} opponents named`);
console.log(`left out, with their games last season: ${[...count].filter(([id]) => !ids.includes(id)).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`);
console.log(`colours from ESPN alone: ${clubs.filter((c) => !elsewhere.has(c.full)).map((c) => c.full).join(', ') || 'none'}`);
