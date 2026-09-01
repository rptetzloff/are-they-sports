// Build data/reference/nfl-coaches.csv, the curated football coaches table.
//
//   DATABASE_URL=postgres://... node scripts/coaches.mjs
//
// WHY THIS FILE EXISTS AT ALL, since the answer changed once already. CLAUDE.md
// said the leaders page "needs a curated coaches/managers table nobody
// publishes", and that was measured rather than assumed to be wrong:
//
//   * Baseball needs nothing. Retrosheet's game logs name both managers of
//     every game back to 1871 -- 96.5% of the final games this database holds.
//   * Football from 1999 needs nothing. nflverse's schedules.csv has carried
//     `home_coach` and `away_coach` all along, populated on 7,548 of 7,548 rows.
//   * Football BEFORE 1999 has no per-game source anywhere. The FiveThirtyEight
//     file this repo relies on for those seasons is date, season, neutral,
//     playoff, two clubs, two Elo ratings and two scores. No coach column.
//
// So the original claim survives for exactly one era of one sport, and this
// builds the table for it.
//
// THE OUTPUT IS CURATED, NOT DERIVED, and the distinction is the point. This
// script writes a first draft; the file it writes is then committed, and from
// that moment the file is the source of record and this script is how it was
// seeded. Re-running it against a corrected file would overwrite the
// corrections, so it refuses to overwrite without --force and says so.
//
// Three passes, in increasing order of confidence:
//
//   1. TRANSCRIBED. 322 of 362 pre-1999 tenures have a W/L on Wikipedia. Taken
//      as given, and marked as such -- these are the numbers this repo cannot
//      check.
//   2. COUNTED. 40 tenures have no W/L, because three clubs' Wikipedia tables
//      (Bears, Patriots, Jets) did not parse. But the database holds every game
//      those clubs played, so a tenure whose seasons no other tenure claims can
//      have its record counted instead of transcribed. 25 of the 40 resolve
//      this way and are strictly better than the rows that did parse.
//   3. UNRESOLVED. 15 do not. Eight span a season shared with another tenure
//      and seven are nothing but shared seasons -- the 1942-45 Bears co-coaches
//      and a handful of mid-season changes. Their counts stay blank, the page
//      shows the coach with no record, and the gap is named rather than filled
//      with a plausible number.
//
// THE STRADDLERS are the subtle case. 21 tenures start before 1999 and end
// after it, and their Wikipedia W/L covers the whole thing -- Mike Shanahan at
// Denver is 138-86 across 1995-2008. Loading that whole number alongside the
// 1999+ record counted from games would credit him twice for a decade. So the
// counted part is subtracted, leaving the pre-1999 remainder, and
// `statedLastSeason` records where the transcribed half stops.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { parseCsv } from '../lib/csv.js';
import { slugFor } from '../lib/leaders.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'reference', 'nfl-coaches.csv');
const WIKI = join(ROOT, 'data', 'sources', 'sportsdata', 'coaches', 'nfl_coaches_wiki.csv');

/** nflverse begins here, and everything from here is counted rather than
 *  stated. One constant, because it is the same boundary in three places. */
const COUNTED_FROM = 1999;

const num = (v) => {
	const n = Number(v);
	return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};

/** Names Wikipedia and nflverse spell differently, or that need a person rather
 *  than a string.
 *
 *  Only the Moras today, and they are the reason `leader` has an id column at
 *  all. Wikipedia distinguishes `Jim E. Mora` at New Orleans from `Jim L. Mora`
 *  at Atlanta and Seattle, and files the father's Indianapolis years under the
 *  bare `Jim Mora`. nflverse writes `Jim Mora` for all of it. Without this, the
 *  father's 1998-2001 Colts and the son's 2004-2009 land on one id and the page
 *  serves one coach with an eleven-year career and three clubs.
 */
const IDENTITY = {
	// wiki spelling -> the id it really is
	'Jim Mora': 'mora-jim-e',
	'Jim E. Mora': 'mora-jim-e',
	'Jim L. Mora': 'mora-jim-l',
};

/** What nflverse calls a coach, where it differs from the curated name. */
const NFLVERSE_NAME = {
	'mora-jim-e': 'Jim Mora',
	'mora-jim-l': 'Jim Mora',
};

/** The one name to show, where the sources use more than one.
 *
 *  Wikipedia files the father's Saints years under `Jim E. Mora` and his Colts
 *  years under the bare `Jim Mora`, so without this he is one id — correctly —
 *  displayed under whichever spelling was written last. The id fixed the
 *  identity; this fixes the label.
 */
const DISPLAY_NAME = {
	'mora-jim-e': 'Jim E. Mora',
	'mora-jim-l': 'Jim L. Mora',
};

const idFor = (name) => IDENTITY[name] ?? slugFor(name);

async function main() {
	const force = process.argv.includes('--force');
	if (existsSync(OUT) && !force) {
		console.error(`${OUT} already exists.`);
		console.error('That file is CURATED: it may carry corrections this script cannot reproduce,');
		console.error('and regenerating would silently discard them. Pass --force if that is what');
		console.error('you want, having read the diff first.');
		return 2;
	}
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is required: the counted passes read pre-1999 games from it');
		return 2;
	}
	const client = new pg.Client({ connectionString: url });
	await client.connect();

	const wiki = parseCsv(readFileSync(WIKI, 'utf8'));
	const pre = [];
	for (const r of wiki) {
		const first = num(r.first_year);
		const last = num(r.last_year);
		// A blank last_year is a sitting coach, which is by definition not the
		// era this file covers. A blank first_year is unusable.
		if (first === null || last === null) continue;
		if (last < COUNTED_FROM || first < COUNTED_FROM) pre.push({ r, first, last });
	}

	// Which tenures claim each (club, season). A season claimed by exactly one
	// tenure can have its games counted; a shared one cannot, because nothing in
	// this data says who coached which game of it.
	const claims = new Map();
	pre.forEach((t, i) => {
		for (let s = t.first; s <= Math.min(t.last, COUNTED_FROM - 1); s++) {
			const key = `${t.r.franchiseName}|${s}`;
			if (!claims.has(key)) claims.set(key, []);
			claims.get(key).push(i);
		}
	});
	const soleOwner = (club, season) => {
		const c = claims.get(`${club}|${season}`);
		return c && c.length === 1 ? c[0] : null;
	};

	// Every pre-1999 game, by club and season. One query rather than one per
	// tenure: 362 round-trips to answer a question 18,506 rows already contain.
	const { rows: tally } = await client.query(`
		SELECT s.fr AS franchise, g.season,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'W') AS w,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'L') AS l,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'T') AS t,
		       count(*) FILTER (WHERE g.round <> 'regular' AND res.r = 'W') AS pw,
		       count(*) FILTER (WHERE g.round <> 'regular' AND res.r = 'L') AS pl,
		       -- More championship-round wins than losses is a title, which is
		       -- the same rule db/migrations/0001 uses to mark the round. Right
		       -- for a one-game Super Bowl and right for a best-of-seven, so
		       -- both sports get it from one expression.
		       count(*) FILTER (WHERE g.round = 'championship' AND res.r = 'W') AS cw,
		       count(*) FILTER (WHERE g.round = 'championship' AND res.r = 'L') AS cl
		  FROM game g
		  CROSS JOIN LATERAL (VALUES (g.home), (g.away)) AS s(fr)
		  CROSS JOIN LATERAL (SELECT CASE
		      WHEN g.home_score = g.away_score THEN 'T'
		      WHEN (g.home = s.fr) = (g.home_score > g.away_score) THEN 'W'
		      ELSE 'L' END) AS res(r)
		 WHERE g.sport = 'nfl' AND g.status = 'final' AND g.season < $1
		 GROUP BY s.fr, g.season`, [COUNTED_FROM]);
	const bySeason = new Map(tally.map((r) => [`${r.franchise}|${r.season}`,
		{ w: +r.w, l: +r.l, t: +r.t, pw: +r.pw, pl: +r.pl }]));

	// Titles come from the `championship` table, not from counting championship
	// games, and that is the whole reason this pass changed.
	//
	// Counting games cannot see the twelve seasons decided on the final
	// standings: there was no championship game before 1933, so Curly Lambeau's
	// 1929, 1930 and 1931 were invisible and he showed three titles where he won
	// six. The table has a row for them and no game to point at.
	//
	// THE TOP TITLE OF A SEASON, not every title awarded in it.
	//
	// A club can hold two for one season and the two are not equal. Green Bay
	// won the 1966 NFL Championship and then Super Bowl I: one championship
	// season, two rows, and counting rows gives Lombardi seven where he won
	// five. Worse, Kansas City won the 1966 AFL Championship and then LOST
	// Super Bowl I, and Baltimore won the 1968 NFL Championship and then lost
	// Super Bowl III — so counting league titles credited Hank Stram and Don
	// Shula with championships their clubs are not given and did not win.
	//
	// So: where a season has a Super Bowl, only its winner is champion of that
	// season. Where it does not, every league champion is — 1946 through 1949
	// had an NFL and an AAFC champion and no game between them, and 1960 through
	// 1965 an NFL and an AFL champion, and in those years both are true.
	const { rows: titles } = await client.query(
		'SELECT season, champion, title FROM championship WHERE sport = $1', ['nfl']);
	const bySeasonTitles = new Map();
	for (const t of titles) {
		if (!bySeasonTitles.has(t.season)) bySeasonTitles.set(t.season, []);
		bySeasonTitles.get(t.season).push(t);
	}
	const wonIn = new Set();
	for (const [season, list] of bySeasonTitles) {
		const superBowl = list.filter((t) => t.title === 'Super Bowl');
		for (const t of (superBowl.length ? superBowl : list)) wonIn.add(`${t.champion}|${season}`);
	}

	// What the games say a straddler did FROM 1999, so it can be subtracted from
	// the Wikipedia total that covers both eras.
	//
	// BY SEASON, not by career. Keyed on (name, club) alone this over-subtracts
	// for anyone who had two separate stints at one club: Jon Gruden's Raiders
	// row covers 1998-2001, and taking away every Raiders game he ever coached
	// removes 2018-2021 as well and leaves him at -14--23. A negative record is
	// at least loud; the same mistake at a club where the stints were closer
	// together would just have produced a smaller wrong number.
	const { rows: modern } = await client.query(`
		SELECT l.name, gl.franchise, g.season,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'W') AS w,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'L') AS l,
		       count(*) FILTER (WHERE g.round = 'regular' AND res.r = 'T') AS t
		  FROM game_leader gl
		  JOIN game g   ON g.sport = gl.sport AND g.id = gl.game_id
		  JOIN leader l ON l.sport = gl.sport AND l.id = gl.leader
		  CROSS JOIN LATERAL (SELECT CASE
		      WHEN g.home_score = g.away_score THEN 'T'
		      WHEN (g.home = gl.franchise) = (g.home_score > g.away_score) THEN 'W'
		      ELSE 'L' END) AS res(r)
		 WHERE gl.sport = 'nfl' AND g.status = 'final'
		 GROUP BY l.name, gl.franchise, g.season`);
	const countedModern = new Map();
	for (const r of modern) {
		countedModern.set(`${r.name}|${r.franchise}|${r.season}`, { w: +r.w, l: +r.l, t: +r.t });
	}
	/** What one coach did at one club over a season range, counted from games. */
	const countedOver = (name, club, from, to) => {
		const sum = { w: 0, l: 0, t: 0, any: false };
		for (let s = from; s <= to; s++) {
			const g = countedModern.get(`${name}|${club}|${s}`);
			if (!g) continue;
			sum.w += g.w; sum.l += g.l; sum.t += g.t; sum.any = true;
		}
		return sum;
	};

	const out = [];
	const notes = { transcribed: 0, counted: 0, unresolved: [], straddled: 0, negative: [] };

	for (let i = 0; i < pre.length; i++) {
		const { r, first, last } = pre[i];
		const club = r.franchiseName;
		const name = r.coach.trim();
		const id = idFor(name);
		// A row whose name yields no id is not a coach.
		//
		// Two kinds arrive. One has a replacement character where a name should
		// be, from an encoding the scraper could not read. The other is an em
		// dash, which is what Wikipedia puts in the Browns' table for 1996-1998
		// -- the club did not exist, having moved to Baltimore, so there was
		// nobody to coach it.
		//
		// Testing the id rather than the characters is what catches both. The
		// first version tested for the replacement character alone, and the dash
		// went through as a coach named U+2014 with an empty leaderId and a
		// 0-0 record.
		if (!id) {
			notes.unresolved.push(`${club} (no name: ${JSON.stringify(name)}) ${first}-${last}`);
			continue;
		}
		const statedLast = Math.min(last, COUNTED_FROM - 1);

		let w = num(r.w), l = num(r.l), t = num(r.t) ?? 0;
		let pw = null, pl = null;
		let basis = 'transcribed';
		// Counted from games in both branches below, never transcribed: the
		// championship games are all in `game`, and the only thing the curated
		// file supplies is which coach was in charge for them.
		const titleSeasons = [];

		if (w !== null && last >= COUNTED_FROM) {
			// A straddler: Wikipedia's total covers both eras, so take out what
			// the games already count from 1999.
			const got = countedOver(NFLVERSE_NAME[id] ?? name, club, COUNTED_FROM, last);
			if (got.any) {
				w -= got.w; l -= got.l; t = Math.max(0, t - got.t);
				notes.straddled++;
				// A negative remainder means the two sources disagree about the
				// modern era by more than the pre-1999 record contains, which is
				// a contradiction rather than a number to write down.
				if (w < 0 || l < 0) {
					notes.negative.push(`${club} ${name} -> ${w}-${l}`);
					w = null; l = null; basis = 'unresolved';
				}
			}
		}

		if (w === null) {
			// Nothing transcribed. Count it from games, but only over seasons no
			// other tenure at this club claims.
			const seasons = [];
			for (let s = first; s <= statedLast; s++) if (soleOwner(club, s) === i) seasons.push(s);
			const whole = statedLast - first + 1;
			if (seasons.length === whole && whole > 0) {
				const sum = { w: 0, l: 0, t: 0, pw: 0, pl: 0 };
				for (const s of seasons) {
					const g = bySeason.get(`${club}|${s}`);
					if (!g) continue;
					sum.w += g.w; sum.l += g.l; sum.t += g.t; sum.pw += g.pw; sum.pl += g.pl;
					if (wonIn.has(`${club}|${s}`)) titleSeasons.push(s);
				}
				w = sum.w; l = sum.l; t = sum.t; pw = sum.pw; pl = sum.pl;
				basis = 'counted';
				notes.counted++;
			} else {
				basis = 'unresolved';
				notes.unresolved.push(`${club} ${name} ${first}-${last} (${seasons.length}/${whole} seasons unshared)`);
			}
		} else if (basis === 'transcribed') {
			notes.transcribed++;
			// Wikipedia's table has no postseason columns, so the playoff record
			// is counted from games over unshared seasons even where the regular
			// season was transcribed. A postseason belongs to whoever finished
			// the season, and a shared season is left out rather than guessed.
			let sw = 0, sl = 0, any = false;
			for (let s = first; s <= statedLast; s++) {
				if (soleOwner(club, s) !== i) continue;
				const g = bySeason.get(`${club}|${s}`);
				if (!g) continue;
				sw += g.pw; sl += g.pl; any = true;
				if (wonIn.has(`${club}|${s}`)) titleSeasons.push(s);
			}
			if (any) { pw = sw; pl = sl; }
		}

		out.push({
			leaderId: id,
			name: DISPLAY_NAME[id] ?? name,
			nflverseName: NFLVERSE_NAME[id] ?? '',
			franchiseAbbrv: club,
			firstSeason: first,
			lastSeason: last,
			statedLastSeason: statedLast,
			w: w ?? '', l: l ?? '', t: w === null ? '' : t,
			playoffW: pw ?? '', playoffL: pl ?? '',
			titleSeasons: titleSeasons.join(' '),
			interim: String(r.interim).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
			basis,
			source: r.source ?? '',
		});
	}

	out.sort((a, b) => a.franchiseAbbrv.localeCompare(b.franchiseAbbrv)
		|| a.firstSeason - b.firstSeason
		|| a.name.localeCompare(b.name));

	const cols = ['leaderId', 'name', 'nflverseName', 'franchiseAbbrv', 'firstSeason', 'lastSeason',
		'statedLastSeason', 'w', 'l', 't', 'playoffW', 'playoffL', 'titleSeasons', 'interim', 'basis', 'source'];
	const quote = (v) => {
		const s = String(v ?? '');
		return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const header = [
		'# NFL head coaches before 1999, where no per-game source exists.',
		'#',
		'# CURATED AND COMMITTED. Seeded by scripts/coaches.mjs; corrections belong',
		'# here, in this file, and the script refuses to overwrite it without --force.',
		'#',
		'# basis says how much to trust a row:',
		'#   transcribed  W/L from Wikipedia. This repo cannot check it.',
		'#   counted      W/L counted from games over seasons no other tenure claims.',
		'#                Strictly better than transcribed, and used where Wikipedia',
		'#                gave nothing.',
		'#   unresolved   Neither. Co-head coaches, or a mid-season change this data',
		'#                cannot split. The record is blank ON PURPOSE and the page',
		'#                shows the coach with no numbers rather than a wrong total.',
		'#',
		'# statedLastSeason is where the transcribed record stops. It differs from',
		'# lastSeason only for coaches whose tenure crosses 1999, whose modern half is',
		'# counted from games and has been subtracted out.',
		'#',
		'# leaderId is the identity, and it is not derivable from the name: nflverse',
		'# writes "Jim Mora" for both the father and the son.',
		'#',
	].join('\n');
	writeFileSync(OUT, `${header}\n${cols.join(',')}\n${
		out.map((r) => cols.map((c) => quote(r[c])).join(',')).join('\n')}\n`, 'utf8');

	console.log(`  wrote        ${OUT}`);
	console.log(`  rows         ${out.length}`);
	console.log(`  transcribed  ${notes.transcribed}`);
	console.log(`  counted      ${notes.counted}  (from games, over unshared seasons)`);
	console.log(`  straddlers   ${notes.straddled}  (modern half subtracted out)`);
	console.log(`  UNRESOLVED   ${notes.unresolved.length}  — blank on purpose:`);
	for (const u of notes.unresolved) console.log(`               ${u}`);
	if (notes.negative.length) {
		console.log(`  CONTRADICTORY ${notes.negative.length} straddlers went negative after subtraction:`);
		for (const n of notes.negative) console.log(`               ${n}`);
	}
	await client.end();
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
