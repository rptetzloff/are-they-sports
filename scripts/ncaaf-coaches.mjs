#!/usr/bin/env node
/** College football's head coaches, from CollegeFootballData.com (Ray,
 *  2026-10-26), as data/reference/ncaaf-coaches.csv: a row a tenure, a coach's
 *  run of consecutive seasons at one of the clubs.
 *
 *  One call (/coaches, every season since the 1880s), kept in
 *  data/sources/cfbd/coaches-all.json. The record of a coach who had every game
 *  of his seasons is counted from the games the load keeps (data/sources/cfbd),
 *  regular season and postseason apart, as every other league's file is:
 *  basis `counted`. Where a season changed hands, CollegeFootballData's own
 *  split stands (basis `transcribed`); its counts include the postseason, which
 *  goes to the coach whose record is exactly the postseason's (the stand-in for
 *  a bowl) or else to the one who finished the season. A tenure that is part
 *  of one shared season and nothing more is an interim's. A title goes to the
 *  coach who finished its season (data/reference/ncaaf-champions.csv).
 *
 *    node scripts/ncaaf-coaches.mjs      (needs CFBD_API_KEY the first time)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';
import { cfbdGameRow } from '../sports/ncaaf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFBD = join(ROOT, 'data', 'sources', 'cfbd');
const REF = join(ROOT, 'data', 'reference');
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

// --- the coaches, one call, kept ---
const path = join(CFBD, 'coaches-all.json');
if (!existsSync(path)) {
	const key = process.env.CFBD_API_KEY;
	if (!key) throw new Error('CFBD_API_KEY is needed to fetch the coaches once');
	const r = await fetch('https://api.collegefootballdata.com/coaches?minYear=1869&maxYear=2100', { headers: { Authorization: `Bearer ${key}` } });
	if (!r.ok) throw new Error(`${r.status} coaches`);
	writeFileSync(path, await r.text());
}
const coaches = JSON.parse(readFileSync(path, 'utf8'));

// --- the clubs, by ESPN id ---
const clubOf = new Map(parseCsv(readFileSync(join(REF, 'ncaaf-franchise-history.csv'), 'utf8')).map((r) => [r.idAbbrv, r.franchiseAbbrv]));

// --- each club's games a season, as the load keeps them ---
const games = new Map(); // `${club}|${season}` -> [{ result, post }]
for (let season = 1869; season <= 2100; season++) {
	const p = join(CFBD, `games-${season}.json`);
	if (!existsSync(p)) { if (season > 2030) break; continue; }
	for (const g of JSON.parse(readFileSync(p, 'utf8'))) {
		const row = cfbdGameRow(g, { finished: true });
		if (!row || row.status !== 'final') continue;
		for (const [id, us, them] of [[row.home, row.homeScore, row.awayScore], [row.away, row.awayScore, row.homeScore]]) {
			const club = clubOf.get(id);
			if (!club) continue;
			const k = `${club}|${season}`;
			if (!games.has(k)) games.set(k, []);
			games.get(k).push({ result: us > them ? 'W' : us < them ? 'L' : 'T', post: row.round !== 'regular' });
		}
	}
}
const tally = (list) => ({
	w: list.filter((g) => !g.post && g.result === 'W').length, l: list.filter((g) => !g.post && g.result === 'L').length,
	t: list.filter((g) => !g.post && g.result === 'T').length,
	pw: list.filter((g) => g.post && g.result === 'W').length, pl: list.filter((g) => g.post && g.result === 'L').length,
});

// --- the champions, by club and season ---
const titles = new Map(); // `${club}|${season}`
for (const r of parseCsv(readFileSync(join(REF, 'ncaaf-champions.csv'), 'utf8'))) {
	const club = clubOf.get(r.champion);
	if (club) titles.set(`${club}|${r.season}`, true);
}

// --- every coach-season at a club ---
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
const seasons = []; // { coach, club, year, games, wins, losses, ties }
for (const c of coaches) {
	for (const s of c.seasons ?? []) {
		const club = clubOf.get(String(s.teamId));
		if (club) seasons.push({ coach: c, club, year: s.year, wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0, games: s.games ?? 0 });
	}
}
const sharing = new Map(); // `${club}|${year}` -> coach-seasons
for (const s of seasons) {
	const k = `${s.club}|${s.year}`;
	if (!sharing.has(k)) sharing.set(k, []);
	sharing.get(k).push(s);
}

/** One coach-season's record, regular season and postseason, and how it is known. */
function recordOf(s) {
	const k = `${s.club}|${s.year}`;
	const played = games.get(k) ?? [];
	const all = tally(played);
	const shared = sharing.get(k);
	// A season whose games are not on record (CollegeFootballData's thin
	// 1890s and 1900s: Alabama's of 1900 and 1901) has its coach's record as
	// CollegeFootballData states it, all of it the regular season's, rather
	// than a 0-0 nobody played.
	if (!played.length && s.games > 0) return { w: s.wins, l: s.losses, t: s.ties, pw: 0, pl: 0, basis: 'transcribed', finished: true, shared: shared.length > 1 };
	if (shared.length === 1) return { ...all, basis: 'counted', finished: true };
	// A shared season: who coached its postseason games.
	const post = { w: all.pw, l: all.pl };
	const exact = shared.filter((x) => x.games === post.w + post.l && x.wins === post.w && x.losses === post.l && post.w + post.l > 0);
	const finisher = exact[0] ?? [...shared].sort((a, b) => (Date.parse(b.coach.hireDate ?? '') || 0) - (Date.parse(a.coach.hireDate ?? '') || 0))[0];
	const mine = finisher === s;
	const pw = mine ? post.w : 0, pl = mine ? post.l : 0;
	return {
		w: Math.max(0, s.wins - pw), l: Math.max(0, s.losses - pl), t: s.ties, pw, pl,
		basis: 'transcribed', finished: mine, shared: true,
	};
}

// --- tenures: a coach's run of consecutive seasons at one club ---
const byCoachClub = new Map();
for (const s of seasons) {
	const k = `${s.coach.id}|${s.club}`;
	if (!byCoachClub.has(k)) byCoachClub.set(k, []);
	byCoachClub.get(k).push(s);
}
const ids = new Map(); // CollegeFootballData's coach id -> our leader id
const taken = new Set();
const leaderId = (c) => {
	if (ids.has(c.id)) return ids.get(c.id);
	let id = slug(`${c.lastName}-${c.firstName}`) || `coach-${c.id}`;
	for (let n = 2; taken.has(id); n++) id = `${slug(`${c.lastName}-${c.firstName}`)}-${n}`;
	taken.add(id);
	ids.set(c.id, id);
	return id;
};
const rows = [];
for (const list of byCoachClub.values()) {
	list.sort((a, b) => a.year - b.year);
	let run = [];
	const flush = () => {
		if (!run.length) return;
		const c = run[0].coach;
		const recs = run.map(recordOf);
		const sum = (f) => recs.reduce((n, r) => n + r[f], 0);
		// A stand-in for a bowl that was never played (2021 lost several to the
		// pandemic) coached no game, and is no coach of the club's.
		if (!['w', 'l', 't', 'pw', 'pl'].some((f) => sum(f)) && run.every((s) => !s.games)) { run = []; return; }
		const first = run[0].year, lastYear = run.at(-1).year;
		rows.push({
			leaderId: leaderId(c), name: `${c.firstName} ${c.lastName}`.trim(), franchiseAbbrv: run[0].club,
			firstSeason: first, lastSeason: lastYear,
			w: sum('w'), l: sum('l'), t: sum('t'), playoffW: sum('pw'), playoffL: sum('pl'),
			titleSeasons: run.filter((s, i) => recs[i].finished && titles.has(`${s.club}|${s.year}`)).map((s) => s.year).join(' '),
			// Part of one shared season and nothing more: a stand-in.
			interim: run.length === 1 && recs[0].shared ? 'TRUE' : 'FALSE',
			basis: recs.some((r) => r.basis === 'transcribed') ? 'transcribed' : 'counted',
			term: first === lastYear ? String(first) : `${first}–${lastYear}`,
		});
		run = [];
	};
	for (const s of list) {
		if (run.length && s.year !== run.at(-1).year + 1) flush();
		run.push(s);
	}
	flush();
}
rows.sort((a, b) => a.franchiseAbbrv.localeCompare(b.franchiseAbbrv) || a.firstSeason - b.firstSeason || a.name.localeCompare(b.name));

writeFileSync(join(REF, 'ncaaf-coaches.csv'), [
	'# College football head coaches, a row a tenure at one of the FBS programmes,',
	'# from CollegeFootballData.com. Made by scripts/ncaaf-coaches.mjs; do not edit',
	'# by hand. w, l and t are the regular season, playoffW and playoffL the',
	'# postseason. basis: counted, from the games, for a coach who had every game of',
	'# his seasons; transcribed, CollegeFootballData\'s own split, where a season',
	'# changed hands. A tenure that is part of one shared season is an interim\'s.',
	'leaderId,name,nflverseName,franchiseAbbrv,firstSeason,lastSeason,statedLastSeason,w,l,t,otl,playoffW,playoffL,titleSeasons,interim,basis,source,term',
	...rows.map((r) => [r.leaderId, r.name, '', r.franchiseAbbrv, r.firstSeason, r.lastSeason, r.lastSeason,
		r.w, r.l, r.t, 0, r.playoffW, r.playoffL, r.titleSeasons, r.interim, r.basis, 'CollegeFootballData.com', r.term].map(csv).join(',')),
].join('\n') + '\n');
console.log(`${rows.length} tenures, ${new Set(rows.map((r) => r.leaderId)).size} coaches, ${new Set(rows.map((r) => r.franchiseAbbrv)).size} clubs; `
	+ `${rows.filter((r) => r.basis === 'transcribed').length} with a shared season, ${rows.filter((r) => r.interim === 'TRUE').length} interim`);
