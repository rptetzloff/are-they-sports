#!/usr/bin/env node
/** Men's college hockey's clubs: every Division I programme, from ESPN. Writes
 *
 *    data/reference/ncaah-franchise-history.csv   one row a club
 *    data/reference/ncaah-divisions.csv           code, conference
 *    data/reference/ncaah-opponents.csv           every other team a club has played
 *    teams/ncaah/<id>.js                          one manifest a club
 *
 *  ESPN's team list has no division: it holds a hundred-odd programmes, Division
 *  III's too. So a club is whoever plays a Division I schedule, which the games
 *  show: 15 of them last season, or this season's first few for a new programme.
 *  The non-Division I sides of those games play one or two a season.
 *
 *  Run after scripts/ncaah-games.mjs, when Division I changes:
 *  node scripts/ncaah-reference.mjs. ESPN's lists are kept in data/sources/espn-ncaah.
 *
 *  A club's codes: ESPN's abbreviation (DU) and ESPN's team id (2172), which every
 *  game names it by. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';
import { sources } from '../sports/ncaah.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'reference');
const CACHE = join(ROOT, 'data', 'sources', 'espn-ncaah');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/mens-college-hockey';
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

const games = parseCsv(readFileSync(join(REF, 'ncaah-games.csv'), 'utf8'));
const lastSeason = Math.max(...games.map((g) => Number(g.season)));
const count = new Map();
for (const g of games.filter((x) => Number(x.season) === lastSeason)) for (const id of [g.home, g.away]) count.set(id, (count.get(id) ?? 0) + 1);
const ids = new Set([...count].filter(([, n]) => n >= 15).map(([id]) => id));

// This season's so far, for a programme new to Division I.
const now = new Date();
const playing = sources.live.seasonOf(now);
const current = new Map();
if (playing > lastSeason) {
	for (const day of sources.live.daysOf(playing).filter((d) => d <= now.toISOString().slice(0, 10).replace(/-/g, ''))) {
		for (const e of (await kept(`days/${day}.json`, sources.live.url(day))).events ?? []) {
			const c = e.competitions?.[0];
			if (!c?.status?.type?.completed) continue;
			for (const side of c.competitors) current.set(side.team.id, (current.get(side.team.id) ?? 0) + 1);
		}
	}
	for (const [id, n] of current) if (n >= 5) ids.add(id);
}

const teams = (await kept('teams.json', `${ESPN}/teams?limit=500`)).sports[0].leagues[0].teams.map(({ team }) => team);
const standings = (await kept('standings.json', 'https://site.api.espn.com/apis/v2/sports/hockey/mens-college-hockey/standings')).children;
const CONFERENCES = {
	'Central Collegiate Hockey Association': 'CCHA', 'East Coast Athletic Conference': 'ECAC', 'National Collegiate Hockey Conference': 'NCHC',
	'Big Ten Conference': 'Big Ten', 'Atlantic Hockey America': 'Atlantic Hockey',
};
const groups = standings.map((c) => ({ id: String(c.id), name: CONFERENCES[c.name] ?? c.name, teams: (c.standings?.entries ?? []).map((e) => String(e.team.id)) }));
const teamPage = async (id) => (await kept(`team-${id}.json`, `${ESPN}/teams/${id}`)).team;

const conferenceOf = async (id) => {
	const listed = groups.find((g) => g.teams.includes(id));
	if (listed) return listed.name;
	const page = await teamPage(id);
	return groups.find((g) => g.id === String(page.groups?.id))?.name ?? '';
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hex = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') && !/^(000000|ffffff)$/i.test(c) ? `#${c.toUpperCase()}` : '');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const clubs = [];
for (const id of ids) {
	const t = teams.find((x) => String(x.id) === id) ?? await teamPage(id);
	clubs.push({
		espn: id, abbr: t.abbreviation, school: t.location.trim(), mascot: t.name ?? '', full: t.displayName.trim(), conference: await conferenceOf(id),
		slug: slug(t.location), colors: [hex(t.color), hex(t.alternateColor)].filter(Boolean),
	});
}
clubs.sort((a, b) => a.full.localeCompare(b.full));
for (const key of ['abbr', 'slug', 'espn']) {
	const seen = new Map();
	for (const c of clubs) {
		if (seen.has(c[key])) throw new Error(`${key} ${c[key]} is ${seen.get(c[key]).full} and ${c.full}`);
		seen.set(c[key], c);
	}
}
const unplaced = clubs.filter((c) => !c.conference);
if (unplaced.length) throw new Error(`no conference: ${unplaced.map((c) => c.full).join(', ')}`);

// Each club's first season here, and every other team's latest name.
const firstSeason = new Map();
const isClub = new Set(clubs.map((c) => c.espn));
const opponents = new Map();
for (const g of games) {
	const year = Number(g.season);
	for (const id of [g.home, g.away]) if (!(firstSeason.get(id) <= year)) firstSeason.set(id, year);
	if (!isClub.has(g.home) && !isClub.has(g.away)) continue;
	if (!isClub.has(g.home)) opponents.set(g.home, g.home_name);
	if (!isClub.has(g.away)) opponents.set(g.away, g.away_name);
}
const first = (c) => firstSeason.get(c.espn) ?? playing;

writeFileSync(join(REF, 'ncaah-franchise-history.csv'), [
	'# Every Division I men\'s hockey programme: codes, conference and colours, from',
	'# ESPN\'s teams and conferences (scripts/ncaah-reference.mjs; do not edit).',
	'#',
	'# espnAbbrv is ESPN\'s abbreviation; idAbbrv ESPN\'s team id, as every game names a side.',
	'franchiseAbbrv,teamAbbrv,espnAbbrv,idAbbrv,league,conference,division,city,teamName,alternateName,startSeason,endSeason,locationCity,locationState,colorA,colorB,colorC,colorD,colorE',
	...clubs.map((c) => [c.abbr, c.abbr, c.abbr, c.espn, 'NCAAH', c.conference, '', c.school, c.mascot, '', first(c), '', '', '', c.colors[0] ?? '', c.colors[1] ?? '', '', '', '']
		.map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(REF, 'ncaah-divisions.csv'), [
	'# Each Division I programme\'s conference today, from ESPN',
	'# (scripts/ncaah-reference.mjs).',
	'#',
	'code,conference,division',
	...clubs.map((c) => [c.abbr, c.conference, ''].map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(REF, 'ncaah-opponents.csv'), [
	'# Every team a Division I programme has played that is no Division I programme',
	'# today, by ESPN\'s id and the latest name a game gives it',
	'# (scripts/ncaah-reference.mjs; do not edit).',
	'id,name',
	...[...opponents].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => [id, name].map(csv).join(',')),
].join('\n') + '\n');

const dir = join(ROOT, 'teams', 'ncaah');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(join(dir, f));
for (const c of clubs) {
	writeFileSync(join(dir, `${c.slug}.js`), `/** ${c.full}. */
export const team = {
	sport: 'ncaah',
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
console.log(`left out, with their games last season: ${[...count].filter(([id]) => !ids.has(id)).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`);
if (current.size) console.log(`this season so far, not clubs: ${[...current].filter(([id]) => !ids.has(id)).map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`);
