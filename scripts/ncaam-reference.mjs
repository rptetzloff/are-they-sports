#!/usr/bin/env node
/** Men's college basketball's clubs: every Division I programme
 *  (Ray, 2026-10-26: "full team listings"), from CollegeBasketballData.com's
 *  teams list. Writes
 *
 *    data/reference/ncaam-franchise-history.csv   one row a club
 *    data/reference/ncaam-divisions.csv           code, conference
 *    data/reference/ncaam-opponents.csv           every other team a club has played
 *    teams/ncaam/<id>.js                          one manifest a club
 *
 *  Run again when Division I changes: node scripts/ncaam-reference.mjs.
 *  The teams list is one call (CBBD_API_KEY, or CFBD_API_KEY: the two sites
 *  share one), kept in data/sources/cbbd.
 *
 *  A club's codes: its abbreviation (WIS); ESPN's team id (275), which ESPN's
 *  live scoreboard names it by; and CollegeBasketballData's own id, prefixed
 *  with a c (c355), which its games name it by. The prefix is because the two
 *  numberings overlap: CollegeBasketballData's 355 is Wisconsin and ESPN's is
 *  somebody else. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data', 'sources', 'cbbd');
mkdirSync(CACHE, { recursive: true });
const season = Number(process.argv[2]) || 2026;
const path = join(CACHE, `teams-${season}.json`);
if (!existsSync(path)) {
	const key = process.env.CBBD_API_KEY ?? process.env.CFBD_API_KEY;
	if (!key) throw new Error('CBBD_API_KEY (or CFBD_API_KEY) is needed to fetch the teams list once');
	const r = await fetch(`https://api.collegebasketballdata.com/teams?season=${season}`, { headers: { Authorization: `Bearer ${key}` } });
	if (!r.ok) throw new Error(`${r.status} teams`);
	writeFileSync(path, await r.text());
}
const teams = JSON.parse(readFileSync(path, 'utf8'));

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hex = (c) => (/^[0-9a-f]{6}$/i.test(c ?? '') && !/^(000000|ffffff)$/i.test(c) ? `#${c.toUpperCase()}` : '');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const clubs = teams.map((t) => ({
	cbbd: `c${t.id}`, espn: String(t.sourceId), abbr: t.abbreviation, school: t.school, mascot: t.mascot ?? '',
	full: t.displayName ?? `${t.school} ${t.mascot ?? ''}`.trim(), conference: t.conference ?? '',
	slug: slug(t.school), colors: [hex(t.primaryColor), hex(t.secondaryColor)].filter(Boolean),
})).sort((a, b) => a.full.localeCompare(b.full));
for (const key of ['abbr', 'slug', 'espn']) {
	const seen = new Map();
	for (const c of clubs) {
		if (seen.has(c[key])) throw new Error(`${key} ${c[key]} is ${seen.get(c[key]).full} and ${c.full}`);
		seen.set(c[key], c);
	}
}

// Each club's first season, and every other team's latest name, from the
// seasons the load keeps (data/sources/cbbd/games-<season>.json).
const firstSeason = new Map();
const isClub = new Set(clubs.map((c) => c.cbbd));
const opponents = new Map();
for (const f of readdirSync(CACHE).filter((n) => /^games-\d{4}\.json$/.test(n)).sort()) {
	const year = Number(f.slice(6, 10));
	for (const g of JSON.parse(readFileSync(join(CACHE, f), 'utf8'))) {
		const home = `c${g.homeTeamId}`, away = `c${g.awayTeamId}`;
		for (const id of [home, away]) if (!firstSeason.has(id)) firstSeason.set(id, year);
		if (!isClub.has(home) && !isClub.has(away)) continue;
		if (!isClub.has(home) && g.homeTeam) opponents.set(home, g.homeTeam);
		if (!isClub.has(away) && g.awayTeam) opponents.set(away, g.awayTeam);
	}
}

const ref = join(ROOT, 'data', 'reference');
writeFileSync(join(ref, 'ncaam-franchise-history.csv'), [
	'# Every Division I men\'s basketball programme: codes, conference and colours,',
	`# from CollegeBasketballData.com's ${season} teams list (scripts/ncaam-reference.mjs; do not edit).`,
	'#',
	'# espnAbbrv is the abbreviation; idAbbrv ESPN\'s team id, as ESPN\'s scoreboard',
	'# names a side; cbbdAbbrv CollegeBasketballData\'s id with a c, as its games do.',
	'franchiseAbbrv,teamAbbrv,espnAbbrv,idAbbrv,cbbdAbbrv,league,conference,division,city,teamName,alternateName,startSeason,endSeason,locationCity,locationState,colorA,colorB,colorC,colorD,colorE',
	...clubs.map((c) => [c.abbr, c.abbr, c.abbr, c.espn, c.cbbd, 'NCAAM', c.conference, '', c.school, c.mascot, '', firstSeason.get(c.cbbd) ?? 1950, '', '', '', c.colors[0] ?? '', c.colors[1] ?? '', '', '', '']
		.map(csv).join(',')),
].join('\n') + '\n');
writeFileSync(join(ref, 'ncaam-divisions.csv'), [
	`# Each Division I programme's conference in ${season}, from CollegeBasketballData.com`,
	'# (scripts/ncaam-reference.mjs).',
	'#',
	'code,conference,division',
	...clubs.map((c) => [c.abbr, c.conference, ''].map(csv).join(',')),
].join('\n') + '\n');
if (opponents.size) {
	writeFileSync(join(ref, 'ncaam-opponents.csv'), [
		'# Every team a Division I programme has played that is no Division I programme',
		'# today, by CollegeBasketballData\'s id (with a c) and the latest name it gives it',
		'# (scripts/ncaam-reference.mjs, from the seasons the load keeps; do not edit).',
		'id,name',
		...[...opponents].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => [id, name].map(csv).join(',')),
	].join('\n') + '\n');
}

const dir = join(ROOT, 'teams', 'ncaam');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) rmSync(join(dir, f));
for (const c of clubs) {
	writeFileSync(join(dir, `${c.slug}.js`), `/** ${c.full}. */
export const team = {
	sport: 'ncaam',
	id: ${q(c.slug)},
	sourceIds: [${q(c.abbr)}],
	firstSeason: ${firstSeason.get(c.cbbd) ?? 1950},

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
console.log(`${clubs.length} programmes, ${Object.keys(by).length} conferences; ${opponents.size} opponents named`);
