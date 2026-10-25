// Turn a draft of head-coach tenures, scraped from Wikipedia's "List of <club>
// head coaches" pages (data/sources/sportsdata/coaches/<sport>_coaches_wiki.csv,
// built by that folder's wiki_coaches.py), into the curated table the load
// reads: data/reference/<sport>-coaches.csv, the shape nfl-coaches.csv has.
//
//   node scripts/wiki-coaches.mjs nhl [--write]
//
// Without --write it only reports. The draft is raw: each page's table has its
// own column names, and its row is kept as JSON. This reads the term, the
// regular-season record and the playoff record out of whichever columns a page
// has, and nothing else — the Atlanta Hawks' Red Auerbach came out of the
// draft as 1949-1996 because a year was read from his achievements.
//
// THE OUTPUT IS CURATED, as nfl-coaches.csv is: once written it is committed
// and corrected by hand, and this script is how it was seeded. It will not
// overwrite an existing file without --force.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../lib/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sport = process.argv[2];
const write = process.argv.includes('--write');
const force = process.argv.includes('--force');
if (!['nhl', 'nba', 'wnba', 'mls'].includes(sport)) {
	console.error('usage: node scripts/wiki-coaches.mjs nhl|nba|wnba|mls [--write [--force]]');
	process.exit(2);
}
// Hockey's and basketball's seasons are named for the year they end; a term
// written 1993-1997 is the seasons 1993-94 to 1996-97. The WNBA's and MLS's are
// the calendar year.
const ENDS_IN_NEXT_YEAR = sport === 'nhl' || sport === 'nba';
// The season being played, for "present".
const CURRENT = ENDS_IN_NEXT_YEAR ? 2027 : 2026;
// Under way as the lists were read and loaded (hockey's and basketball's
// 2026-27); summer leagues' 2026 is as good as finished.
const PLAYING = ENDS_IN_NEXT_YEAR ? CURRENT : null;

const DRAFT = join(ROOT, 'data', 'sources', 'sportsdata', 'coaches', `${sport}_coaches_wiki.csv`);
const outAt = process.argv.indexOf('--out');
const OUT = outAt > 0 ? process.argv[outAt + 1] : join(ROOT, 'data', 'reference', `${sport}-coaches.csv`);

/** A row's raw table cells, by a simplified name: lower case, the page's
 *  own team name and footnote marks taken off, the doubled header joined once. */
function cellsOf(raw, team) {
	let obj;
	try { obj = JSON.parse(raw.replace(/\bNaN\b/g, 'null')); } catch { return null; }
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v == null) continue;
		let key = k.replace(/\[[a-zA-Z0-9]+\]/g, '').replace(/Unnamed: \d+_level_\d+/g, '').toLowerCase();
		if (team) key = key.split(team.toLowerCase()).join('');
		const words = key.split(/\s+/).filter(Boolean);
		// "term term" and "# #": the two header rows said the same thing.
		const half = words.length % 2 === 0 && words.slice(0, words.length / 2).join(' ') === words.slice(words.length / 2).join(' ');
		key = (half ? words.slice(0, words.length / 2) : words).join(' ');
		out[key] = String(v).trim();
	}
	return out;
}

const num = (v) => {
	const s = String(v ?? '').replace(/[,\s]/g, '').replace(/[–—-]$/, '');
	return /^\d+$/.test(s) ? Number(s) : null;
};
const pick = (cells, tests) => {
	for (const t of tests) {
		const k = Object.keys(cells).find((x) => t(x));
		if (k !== undefined) return cells[k];
	}
	return null;
};
const has = (...ws) => (k) => ws.every((w) => (w instanceof RegExp ? w.test(k) : k.split(' ').includes(w)));

/** The record and term out of one row's cells. */
function readRow(cells) {
	const term = pick(cells, [has(/^term/), has(/^dates?$/), has(/^tenure/), has(/^seasons?$/), has(/^years?$/)]);
	const reg = (w) => pick(cells, [has('regular', 'season', w), has(w, 'regular', 'season'), (k) => k === w]);
	// Pittsburgh's page heads them PG, PW and PL.
	const po = (w) => pick(cells, [has('playoffs', w), has(w, 'playoffs'), has('postseason', w), (k) => k === `p${w}`]);
	const tieOt = pick(cells, [has('regular', 'season', 't/ot'), (k) => k === 't/ot']);
	return {
		term,
		gc: num(reg('gc') ?? reg('g') ?? reg('gp') ?? reg('games')),
		w: num(reg('w')), l: num(reg('l')),
		// Ties, and overtime losses; a page that counts them in one column
		// ("T/OT", "T/OTL") has them in ties here, since they cannot be split.
		t: num(reg('t')) ?? num(tieOt ?? pick(cells, [has('regular', 'season', /(^| )t\/ot?l?$/)])),
		otl: num(reg('otl') ?? reg('ot') ?? reg('ol')),
		playoffW: num(po('w')) ?? 0, playoffL: num(po('l')) ?? 0,
	};
}

/** The seasons a term spans, as this repo numbers them, or null. */
export function seasonsOf(term) {
	// "1926–27" and "1927–47": a second year in two digits is in the first's
	// century, or the next one's when it would come before it.
	const s = String(term ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ')
		.replace(/\b(1[89]|20)(\d\d)\s*[–—-]\s*(\d\d)\b(?!\d)/g, (m, c, y, z) => {
			const a = Number(c + y);
			let b = Number(c + z);
			if (b < a) b += 100;
			return `${a}–${b}`;
		})
		// "1980–1981 to 1988–1989", Edmonton's way: one run of seasons.
		.replace(/\b((?:1[89]|20)\d\d)\s*[–—-]\s*(?:1[89]|20)\d\d\s+to\s+(?:1[89]|20)\d\d\s*[–—-]\s*((?:1[89]|20)\d\d)\b/g, '$1–$2');
	// A term of several ranges ("1998–1999, 2002–2004": a co-coaching year,
	// then the job) keeps its last, which the record belongs to; the earlier
	// ones are reported for review. A range is a year to a year, or a year.
	// However they are separated — "1998–99 2002–05" has only a space.
	const ranges = [...s.matchAll(/\b(?:1[89]|20)\d\d(?:\s*[–—-]\s*(?:(?:1[89]|20)\d\d|present|current))?/gi)].map((m) => m[0]);
	if (ranges.length > 1 && !/(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(s)) {
		// Ranges that meet are one run: "1952–1953 (as player-coach) 1953–1954"
		// is Andrew Levane's two seasons, not two tenures.
		const spans = [];
		for (const sp of ranges.map((x) => seasonsOf(x)).filter(Boolean)) {
			const prev = spans.at(-1);
			if (prev && sp.first <= prev.last + 1) {
				Object.assign(prev, { last: Math.max(prev.last, sp.last), single: false,
					term: termOf(prev.term.split('–')[0], sp.term.split('–').at(-1)) });
			} else spans.push({ ...sp });
		}
		if (spans.length === 1) return spans[0];
		return spans.length ? { ...spans.at(-1), spans } : null;
	}
	const years = [...s.matchAll(/\b(1[89]\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
	const present = /present|current/i.test(s);
	if (!years.length) return null;
	// Whole dates ("December 1, 2002 – December 4, 2002") say which season
	// each end is in: from September on, the one ending the next year.
	const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
	const dates = [...s.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[^,–—-]*?(1[89]\d\d|20\d\d)/gi)]
		.map((m) => ({ month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, year: Number(m[2]) }));
	const seasonOfDate = (d) => (ENDS_IN_NEXT_YEAR && d.month >= 9 ? d.year + 1 : d.year);
	if (dates.length) {
		const first = seasonOfDate(dates[0]);
		const last = present ? CURRENT : seasonOfDate(dates.at(-1));
		// Hired in the summer for the season after: the first is the next one.
		const firstSeason = ENDS_IN_NEXT_YEAR && dates[0].month >= 5 && dates[0].month < 9 ? dates[0].year + 1 : first;
		return { first: firstSeason, last: Math.max(last, firstSeason),
			term: termOf(dates[0].year, present ? 'present' : dates.at(-1).year) };
	}
	const a = years[0];
	const b = present ? (ENDS_IN_NEXT_YEAR ? CURRENT - 1 : CURRENT) : years.at(-1);
	// The list's own years, which is how anyone else writes the tenure: Doc
	// Rivers was hired in January 2024, and the season he joined began in 2023.
	const written = termOf(a, present ? 'present' : years.at(-1));
	if (!ENDS_IN_NEXT_YEAR) return { first: a, last: b, term: written };
	// One year alone, or the same year twice, is a season inside it; which one,
	// the neighbouring tenures say (below).
	if ((years.length === 1 || a === b) && !present) return { first: a, last: a, single: true, term: written };
	return { first: a + 1, last: present ? CURRENT : b, term: written };
}

/** A term as written: "2024–2026", "1999", "2026–present". */
function termOf(from, to) {
	return String(from) === String(to) ? String(from) : `${from}–${to}`;
}

const slugFor = (name) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
	.replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').reverse().join('-');

const draft = parseCsv(readFileSync(DRAFT, 'utf8'));
const out = [];
const review = [];

// The WNBA's draft is each club's season-by-season table, not a list of its
// coaches: a row a season, its coach, and its record, with a mid-season change
// written out with each coach's share -- "D. Taylor (6–13) F. Layden (2–9)".
// Tenures are the runs of seasons one coach finished or started, and a season
// two coaches shared gives each the record the table states. A record is
// exact as written, so nothing is fitted; a run alone in its seasons is still
// counted from the games below, and the playoffs go to whoever finished.
const SEASON_TABLE = sport === 'wnba';
// Abbreviated names no row of the draft spells out in full: the stand-ins and
// short spells that only ever appear in a shared season's cell.
const ALIASES = {
	'S. Mc.-Serio': 'Suzie McConnell-Serio', 'T. McWilliams-Franklin': 'Taj McWilliams-Franklin',
	'R. Mahorn': 'Rick Mahorn', 'T. Edwards': 'Teresa Edwards', 'L. Sharp': 'Linda Sharp',
	'J. Rousseau': 'Julie Rousseau', 'K. Thompson': 'Karleen Thompson', 'H. Bibby': 'Henry Bibby',
	'P. Toler': 'Penny Toler', 'D. Taylor': 'Denise Taylor', 'F. Layden': 'Frank Layden', 'S. Dailey': 'Shell Dailey',
	'H. VanDerveer': 'Heidi VanDerveer', 'C. Jenkins': 'Carolyn Jenkins', 'J. Lewis': 'Jim Lewis',
	'C. Parson': 'Cathy Parson', 'N. Darsch': 'Nancy Darsch', 'D. Walker': 'Darrell Walker', 'J. Kenlaw': 'Jessie Kenlaw',
	'O. Woolridge': 'Orlando Woolridge', 'G. Williams': 'Greg Williams', 'N. Richardson': 'Nolan Richardson',
	'C. Cooper': 'Cynthia Cooper', 'D. Brown': 'Dee Brown', 'J. Gillom': 'Jennifer Gillom', 'C. Ross': 'Carol Ross',
	'J. Bryant': 'Joe Bryant', 'M. Cooper': 'Michael Cooper', 'B. Agler': 'Brian Agler', 'P. Coyle': 'Pat Coyle',
	'A. Donovan': 'Anne Donovan', 'R. Adubato': 'Richie Adubato', 'T. Rollins': 'Tree Rollins', 'B. Laimbeer': 'Bill Laimbeer',
	'M. Meadors': 'Marynell Meadors', 'F. Williams': 'Fred Williams', 'C. Harvey': 'Candi Harvey',
};
// The draft ends with 2025. Each club's coach for 2026, from ESPN's season
// coaches (sports.core.api.espn.com .../wnba/seasons/2026/teams/{id}/coaches),
// read 2026-10-26. ESPN names none for Los Angeles, so the Sparks' 2026 has no
// coach here; one change within the season would not show either.
const WNBA_2026 = {
	ATL: 'Karl Smesko', CHI: 'Tyler Marsh', CON: 'Rachid Meziane', DAL: 'Jose Fernandez', GSV: 'Natalie Nakase',
	IND: 'Stephanie White', LVA: 'Becky Hammon', MIN: 'Cheryl Reeve', NYL: 'Chris DeMarco', PHX: 'Nate Tibbetts',
	POR: 'Alex Sarama', SEA: 'Sonia Raman', TOR: 'Sandy Brondello', WAS: 'Sydney Johnson',
};
if (SEASON_TABLE) {
	const seasons = [];
	for (const r of draft) {
		if (!/^\d{4}$/.test(r.first_year)) { review.push(`unparsed      ${r.franchiseName} · ${r.coach}`); continue; }
		const cells = JSON.parse(r.raw.replace(/\bNaN\b/g, 'null'));
		const val = (re) => { const k = Object.keys(cells).find((x) => re.test(x)); return k === undefined ? null : cells[k]; };
		const w = num(val(/^Regular season W( |$)/)), l = num(val(/^Regular season L( |$)/));
		const parts = [...r.coach.matchAll(/([^()]+?)\s*\((\d+)\s*[–-]\s*(\d+)\)/g)]
			.map((m) => ({ name: m[1].trim(), w: Number(m[2]), l: Number(m[3]) }));
		seasons.push({ club: r.franchiseName, season: Number(r.first_year), source: r.source,
			coaches: parts.length ? parts : [{ name: r.coach.trim(), w, l }] });
	}
	for (const [club, name] of Object.entries(WNBA_2026)) {
		if (!seasons.some((x) => x.club === club && x.season === 2026)) {
			seasons.push({ club, season: 2026, source: 'ESPN (2026 season coaches)', coaches: [{ name, w: null, l: null }] });
		}
	}
	// "M. Meadors" is whoever of that initial and surname the draft spells out.
	const full = [...new Set(seasons.flatMap((x) => x.coaches.map((c) => c.name)))].filter((n) => !/^[A-Z]\.\s?/.test(n));
	const resolve = (n) => {
		if (ALIASES[n]) return ALIASES[n];
		const m = n.match(/^([A-Z])\.\s*(.+)$/);
		if (!m) return n;
		const hits = full.filter((x) => x.startsWith(m[1]) && x.endsWith(` ${m[2]}`));
		if (hits.length === 1) return hits[0];
		review.push(`initials      ${n} (${hits.length} matches)`);
		return n;
	};
	seasons.sort((a, b) => a.club.localeCompare(b.club) || a.season - b.season);
	for (const x of seasons) {
		x.coaches.forEach((c, i) => {
			const name = resolve(c.name.replace(/[*†‡§^#!]+$/u, '').replace(/\s+/g, ' ').trim());
			const prev = out.at(-1);
			// The same coach on from the season before -- the one who finished it,
			// starting this one -- is the same tenure.
			const cont = prev && prev.franchiseAbbrv === x.club && prev.name === name && prev.lastSeason === x.season - 1 && i === 0 && prev.finishedLast;
			const t = cont ? prev : {
				group: null, leaderId: slugFor(name), name, nflverseName: '', franchiseAbbrv: x.club,
				firstSeason: x.season, lastSeason: x.season, statedLastSeason: x.season, term: '',
				w: 0, l: 0, t: 0, otl: 0, playoffW: 0, playoffL: 0, titleSeasons: '', interim: 'FALSE',
				basis: 'transcribed', source: x.source, gc: null, single: false, year: x.season, fixed: true, finishes: [],
			};
			if (!cont) out.push(t);
			t.lastSeason = x.season; t.statedLastSeason = x.season;
			t.w += c.w ?? 0; t.l += c.l ?? 0;
			const finisher = i === x.coaches.length - 1;
			if (finisher) t.finishes.push(x.season);
			t.finishedLast = finisher;
			t.term = t.firstSeason === t.lastSeason ? String(t.firstSeason) : `${t.firstSeason}–${t.lastSeason}`;
		});
	}
}
// MLS's lists date each tenure to the day ("July 23, 2019 – October 6, 2024"),
// and every game since 1996 is here, so a tenure's record is its games
// between its dates and its seasons are where those games fall: exact, with
// nothing to fit or share. A term of several spells ("... (interim) ... – ...")
// is a tenure each. A row the list does not date takes the per-game draft's
// dates (mls_coaches.csv, 2013 on) where it has the coach.
const DATED = sport === 'mls';
if (DATED) {
	const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
	const iso = (m, d, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	// Each end of a spell: a whole date, "present" (null), or a year alone --
	// Dave Dir's "1996–2000", Lothar Osiander's "1996 – June 10, 1997" -- which
	// is marked, so the club's other tenures can say where in it the spell
	// began or ended (below). A year alone stands for the whole of it for now.
	const datesIn = (text) => [...String(text ?? '').replace(/\[[^\]]*\]/g, '')
		.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b|\b(present|current)\b|\b((?:19|20)\d\d)\b/gi)]
		.map((m, i) => (m[4] ? null
			: m[5] ? Object.assign(new String(i % 2 ? `${m[5]}-12-31` : `${m[5]}-01-01`), { yearOnly: true })
			: iso(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2], m[3])));
	// The drafts' codes for six clubs are not this repo's franchise ids.
	const CODE = { LAG: 'LA', NYRB: 'RBNY', DCU: 'DC', FCD: 'DAL', NER: 'NE', SJE: 'SJ' };
	const club = (code) => CODE[code] ?? code;
	// The per-game draft, less its games with no coach named (Minnesota's and
	// Nashville's lately, a row a game).
	const perGame = parseCsv(readFileSync(join(ROOT, 'data', 'sources', 'sportsdata', 'coaches', 'mls_coaches.csv'), 'utf8'))
		.filter((x) => x.coach.trim()).map((x) => ({ ...x, franchiseName: club(x.franchiseName) }));
	// Its last date for a club is the last game it saw, not the end of the job:
	// the club's latest coach runs on to the present.
	for (const code of new Set(perGame.map((x) => x.franchiseName))) {
		const last = perGame.filter((x) => x.franchiseName === code).sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
		last.end_date = null;
	}
	for (const x of draft) x.franchiseName = club(x.franchiseName);
	// Clubs whose list the draft could not read -- it took Real Salt Lake's
	// captains and Minnesota's and Vancouver's stadiums for coaches -- come from
	// the per-game draft instead, from 2013.
	const FROM_PER_GAME = new Set(['RSL', 'MIN', 'VAN']);
	// Minnesota's from March 2024 are Wikipedia's, below.
	for (const x of perGame.filter((p) => FROM_PER_GAME.has(p.franchiseName) && p.franchiseName !== 'VAN'
		&& !(p.franchiseName === 'MIN' && p.start_date >= '2024-03-11'))) {
		draft.push({ franchiseName: x.franchiseName, coach: x.coach, interim: 'False', source: 'MLS per-game coaches (sportsdata)',
			raw: '{}', start_date: '', end_date: '', perGame: [x.start_date, x.end_date] });
	}
	// And what neither draft has, read from Wikipedia directly (2026-10-26):
	// Real Salt Lake before 2013 (Jason Kreis's article: he took over from John
	// Ellinger on May 3, 2007), Vancouver's whole head-coach table, and
	// Minnesota after the per-game draft stops naming a coach in March 2024
	// (Cameron Knowles's article: named head coach on 12 January 2026, Eric
	// Ramsay having left for West Bromwich Albion).
	const WIKI = 'Wikipedia, read 2026-10-26';
	for (const [code, coach, since, until, interim] of [
		['RSL', 'John Ellinger', '2005-01-01', '2007-05-02'],
		['RSL', 'Jason Kreis', '2007-05-03', '2012-12-31'],
		['VAN', 'Teitur Thordarson', '2010-09-01', '2011-05-30'],
		['VAN', 'Tom Soehn', '2011-05-30', '2011-10-25', true],
		['VAN', 'Martin Rennie', '2011-10-26', '2013-10-29'],
		['VAN', 'Carl Robinson', '2013-12-16', '2018-09-25'],
		['VAN', 'Craig Dalrymple', '2018-09-25', '2018-11-07', true],
		['VAN', 'Marc Dos Santos', '2018-11-07', '2021-08-27'],
		['VAN', 'Vanni Sartini', '2021-08-27', '2024-11-26'],
		['VAN', 'Jesper Sørensen', '2025-01-14', null],
		['MIN', 'Eric Ramsay', '2024-03-11', '2026-01-11'],
		['MIN', 'Cameron Knowles', '2026-01-12', null],
	]) {
		draft.push({ franchiseName: code, coach, interim: interim ? 'True' : 'False', source: WIKI,
			raw: '{}', start_date: '', end_date: '', perGame: [since, until] });
	}
	for (const r of draft) {
		if (FROM_PER_GAME.has(r.franchiseName) && !r.perGame) continue;
		const name = r.coach.replace(/\s*\((?:interim|co-coach)[^)]*\)/ig, '').replace(/[*†‡§^#!]+$/u, '').replace(/\s+/g, ' ').trim();
		let cells = {};
		try { cells = JSON.parse(r.raw.replace(/\bNaN\b/g, 'null')); } catch { /* the dates below may still be there */ }
		// The dates in the order they were written, a spell a pair; "present"
		// closes the last as null.
		const text = Object.entries(cells).filter(([k]) => /tenure|term|years|dates|start|end|from|^to$/i.test(k)).map(([, v]) => v).join(' – ');
		let dates = r.perGame ?? datesIn(text);
		if (!dates.length && r.start_date) {
			const md = (v) => { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? iso(m[1], m[2], m[3]) : null; };
			dates = [md(r.start_date), r.end_date ? md(r.end_date) : null];
		}
		if (!dates.length || !dates[0]) {
			const pg = perGame.filter((x) => x.franchiseName === r.franchiseName && x.coach === name);
			dates = pg.flatMap((x) => [x.start_date, x.end_date]);
		}
		if (!dates.length || !dates[0]) { review.push(`no dates      ${r.franchiseName} · ${name}`); continue; }
		if (dates.length % 2) dates.push(null);
		const interim = r.interim === 'True' || /interim/i.test(`${r.coach} ${text}`);
		for (let i = 0; i < dates.length; i += 2) {
			const [since, until] = [dates[i], dates[i + 1]];
			const first = Number(since.slice(0, 4)), last = until ? Number(until.slice(0, 4)) : CURRENT;
			out.push({
				group: null, leaderId: slugFor(name), name, nflverseName: '', franchiseAbbrv: r.franchiseName,
				firstSeason: first, lastSeason: last, statedLastSeason: last,
				term: termOf(first, until ? last : 'present'),
				w: 0, l: 0, t: 0, otl: 0, playoffW: 0, playoffL: 0, titleSeasons: '', interim: interim ? 'TRUE' : 'FALSE',
				basis: 'transcribed', source: r.source, gc: null, single: false, year: first, fixed: true,
				since: String(since), until: until == null ? null : String(until),
				sinceYearOnly: Boolean(since.yearOnly), untilYearOnly: Boolean(until?.yearOnly), dated: true,
			});
		}
	}
	// Within a club, in order, no two tenures hold one day. A spell whose start
	// is a year alone begins the day after the one before it ended; one that
	// runs into the next -- Toronto's list still has John Herdman to the
	// present beside Robin Fraser from 2025 -- ends the day before it starts,
	// and its term says so.
	const dayAfter = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
	const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
	for (const code of new Set(out.map((t) => t.franchiseAbbrv))) {
		const list = out.filter((t) => t.franchiseAbbrv === code).sort((a, b) => a.since.localeCompare(b.since));
		for (let i = 1; i < list.length; i++) {
			const prev = list[i - 1], t = list[i];
			if (t.sinceYearOnly && prev.until && prev.until >= t.since) t.since = dayAfter(prev.until);
		}
		list.sort((a, b) => a.since.localeCompare(b.since));
		for (let i = 0; i < list.length - 1; i++) {
			const t = list[i];
			for (const n of list.slice(i + 1)) {
				if (n === t || n.since <= t.since) continue;
				if (t.until != null && n.since > t.until) break;
				// Wholly inside: a stand-in for a game or two while the coach was
				// away (Brian Schmetzer for Sigi Schmid, three times). The coach's
				// tenure runs on, less the stand-in's days.
				if (n.until != null && (t.until == null || n.until < t.until)) {
					// The same coach inside his own spell, as two drafts both
					// have him, is one spell.
					if (n.name === t.name) n.drop = true;
					else (t.exclude ??= []).push([n.since, n.until]);
					continue;
				}
				// The same day at both ends is a change after that day's match:
				// Teitur Thordarson's last was the 1-1 on May 30, 2011.
				if (t.until === n.since) { n.since = dayAfter(n.since); break; }
				const wasOpen = t.until == null;
				t.until = dayBefore(n.since);
				if (wasOpen || !t.untilYearOnly) t.term = termOf(t.term.split('–')[0], t.until.slice(0, 4));
				if (wasOpen) review.push(`trimmed       ${code} · ${t.name} to ${t.until}, the day before ${n.name}`);
				break;
			}
		}
	}
}
for (const r of SEASON_TABLE || DATED ? [] : draft) {
	if (r.parse_ok !== 'True') { review.push(`unparsed      ${r.franchiseName} · ${r.coach}`); continue; }
	const cells = cellsOf(r.raw, null);
	if (!cells) { review.push(`bad raw       ${r.franchiseName} · ${r.coach}`); continue; }
	const row = readRow(cells);
	const span = seasonsOf(row.term);
	if (!span) { review.push(`no term       ${r.franchiseName} · ${r.coach} · ${JSON.stringify(row.term)}`); continue; }
	const interim = r.interim === 'True' || /interim/i.test(r.coach);
	// Initials closed up, "K. C. Jones" as "K.C. Jones", so one person is one
	// spelling across clubs' lists.
	const name = r.coach.replace(/\s*\((?:interim|co-coach)[^)]*\)/ig, '').replace(/[*†‡§^#!]+$/u, '').replace(/\s+/g, ' ').trim()
		.replace(/\b([A-Z])\.\s+(?=[A-Z]\.)/g, '$1.');
	if (row.w == null || row.l == null) review.push(`no record     ${r.franchiseName} · ${name} · ${row.term}`);
	if (span.spans) review.push(`ranges        ${r.franchiseName} · ${name} · ${row.term} (a tenure each, the record shared by games)`);
	if (span.single) review.push(`one year      ${r.franchiseName} · ${name} · ${row.term} (taken as the season ending ${span.first})`);
	// A term of several ranges is a tenure each, sharing the record (shared
	// out by games below); `group` keeps them together until then.
	// Hired for the season being played: no record yet, which is 0-0 through
	// last season rather than a record the list forgot. Taylor Jenkins is the
	// Bucks' coach, and leaving him out made Doc Rivers look like the current one.
	const newHire = (row.w == null || row.l == null) && PLAYING != null && span.first >= PLAYING;
	for (const sp of span.spans ?? [span]) out.push({
		group: span.spans ? `${r.franchiseName}|${name}|${row.term}` : null,
		leaderId: slugFor(name), name, nflverseName: '', franchiseAbbrv: r.franchiseName,
		firstSeason: sp.first, lastSeason: sp.last, statedLastSeason: sp.last, term: sp.term ?? '',
		w: newHire ? 0 : row.w ?? '', l: newHire ? 0 : row.l ?? '', t: row.t ?? 0, otl: row.otl ?? 0,
		playoffW: row.playoffW, playoffL: row.playoffL, titleSeasons: '', interim: interim ? 'TRUE' : 'FALSE',
		basis: 'transcribed', source: r.source, gc: row.gc, single: Boolean(sp.single), year: sp.first,
	});
}

// What a list has wrong or leaves out, put right by hand and kept here so a
// rerun keeps it. Seasons are fixed (the fit does not move them); a record
// left out is counted from the games, from `since` and to `until` (dates)
// where a change shared a season; `replaces` drops the list's own tenure of
// the coach at that club in those seasons. Each was found by coaches-check.mjs.
const BY_HAND = {
	nhl: [
		// Buffalo's list has Jimmy Roberts for 45 games of 1981-82 and nobody for
		// the other 35, Bowman's: the season's 39-26-15 less Roberts' 21-16-8, out
		// in four. Not dated: no split of the games' order gives both records.
		{ name: 'Scotty Bowman', club: 'BUF', first: 1982, last: 1982, w: 18, l: 10, t: 7, otl: 0, playoffW: 1, playoffL: 3,
			term: '1981–1982', note: 'List of Buffalo Sabres head coaches (by hand: the rest of 1981-82, which the list leaves out)' },
		// Montreal's list stops St. Louis's record two seasons ago; he took over
		// from Dominique Ducharme after 45 games of 2021-22.
		{ name: 'Martin St. Louis', club: 'MTL', first: 2022, last: CURRENT, since: '2022-02-09', replaces: true,
			term: '2022–present', note: 'List of Montreal Canadiens head coaches (by hand: the list\'s record was two seasons old)' },
		// Anaheim's list gives Carlyle's third stint 164 games; it was 220, to
		// Bob Murray's 26 of 2018-19 (the list's 14-11-1, which the games agree with).
		{ name: 'Randy Carlyle', club: 'ANA', first: 2017, last: 2019, until: '2019-02-10', replaces: true,
			term: '2016–2019', note: 'List of Anaheim Ducks head coaches (by hand: the list\'s record was 56 games short)' },
		// Utah's list names its general manager, Bill Armstrong.
		{ name: 'André Tourigny', club: 'UTA', first: 2025, last: CURRENT,
			term: '2024–present', note: 'Utah Mammoth (by hand: the list read the general manager)' },
	],
	nba: [
		// Denver's list has Brown's ABA and NBA years as one record; the NBA's
		// part ends after 53 games of 1978-79 (28-25), to Donnie Walsh.
		{ name: 'Larry Brown', club: 'DEN', first: 1977, last: 1979, until: '1979-01-31', replaces: true,
			term: '1976–1979', note: 'List of Denver Nuggets head coaches (by hand: the NBA years of an ABA and NBA tenure)' },
	],
}[sport] ?? [];
for (const h of BY_HAND.filter((x) => x.replaces)) {
	for (let i = out.length - 1; i >= 0; i--) if (out[i].franchiseAbbrv === h.club && out[i].name === h.name
		&& out[i].firstSeason <= h.last && out[i].lastSeason >= h.first) out.splice(i, 1);
}
for (const h of BY_HAND) {
	out.push({
		group: null, leaderId: slugFor(h.name), name: h.name, nflverseName: '', franchiseAbbrv: h.club,
		firstSeason: h.first, lastSeason: h.last, statedLastSeason: h.last, term: h.term ?? '',
		w: h.w ?? 0, l: h.l ?? 0, t: h.t ?? 0, otl: h.otl ?? 0, playoffW: h.playoffW ?? 0, playoffL: h.playoffL ?? 0,
		titleSeasons: '', interim: 'FALSE', basis: 'transcribed', source: h.note,
		gc: h.w == null ? null : h.w + h.l + h.t + h.otl, single: false, year: h.first, fixed: true,
		since: h.since ?? null, until: h.until ?? null,
	});
}

// A lone year is a season inside it: the one ending that year (a change in
// January to April) or the next (October to December). A stand-in shares a
// season with the coach before or after, so the neighbour decides: the
// season the coach before ended in, else the one the coach after began in,
// else the one ending that year.
const singles = new Map();
for (let i = 0; i < out.length; i++) {
	const t = out[i];
	// Only a term that named one year; "1997-1998" is one season and says which.
	if (!ENDS_IN_NEXT_YEAR || !t.single) continue;
	const raw = draft.find((d) => d.franchiseName === t.franchiseAbbrv && d.coach.includes(t.name));
	if (!raw) continue;
	const prev = out.slice(0, i).reverse().find((x) => x.franchiseAbbrv === t.franchiseAbbrv);
	const next = out.slice(i + 1).find((x) => x.franchiseAbbrv === t.franchiseAbbrv);
	const y = t.firstSeason;
	const options = [y, y + 1];
	const pickSeason = options.find((s) => prev && prev.lastSeason === s)
		?? options.find((s) => next && next.firstSeason === s)
		?? y;
	if (pickSeason !== y) singles.set(t, pickSeason);
}
// (Without a database the neighbour decides; with one, the games do, below.)
if (!process.env.DATABASE_URL) for (const [t, s] of singles) { t.firstSeason = s; t.lastSeason = s; t.statedLastSeason = s; }

// --- against the games -----------------------------------------------------------
// With a database, two passes the list cannot make alone.
//
// 1. A term in years cannot say a coach left in December: Bob Hartley's
//    "1998-2002" ran into the 2002-03 season. Where a tenure claims more games
//    than its seasons hold, it reaches into the season it shares with the
//    neighbour (the next coach's first, or the last one's last).
// 2. A coach who had every game of his seasons — no one else's tenure touches
//    them — has his record counted from the games, exactly, and to the season
//    being played; the list's numbers stop where the page was last edited
//    (Jared Bednar's 700 games are through 2024-25). Overtime and shootout
//    losses are their own column, as the NHL counts them from 1999-2000. A
//    season shared by a mid-season change keeps the list's split, which only
//    it knows. basis says which: counted, or transcribed.
if (process.env.DATABASE_URL) {
	const { default: pg } = await import('pg');
	const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await c.connect();
	const { rows } = await c.query(`
		SELECT f AS franchise, season::int AS season, count(*)::int AS n,
		       count(*) FILTER (WHERE winner = f)::int AS w,
		       count(*) FILTER (WHERE winner IS NULL)::int AS t,
		       count(*) FILTER (WHERE winner IS NOT NULL AND winner <> f AND ending IN ('OT', 'SO') AND season >= 2000 AND $1 = 'nhl')::int AS otl
		  FROM (SELECT season, home AS f, winner, ending FROM game WHERE sport = $1 AND status = 'final' AND round = 'regular'
		        UNION ALL SELECT season, away, winner, ending FROM game WHERE sport = $1 AND status = 'final' AND round = 'regular') g
		 GROUP BY f, season`, [sport]);
	const po = await c.query(`
		SELECT f AS franchise, season::int AS season,
		       count(*) FILTER (WHERE winner = f)::int AS w, count(*) FILTER (WHERE winner IS NOT NULL AND winner <> f)::int AS l
		  FROM (SELECT season, home AS f, winner FROM game WHERE sport = $1 AND status = 'final' AND round <> 'regular'
		        UNION ALL SELECT season, away, winner FROM game WHERE sport = $1 AND status = 'final' AND round <> 'regular') g
		 GROUP BY f, season`, [sport]);
	// A by-hand tenure dated within its seasons, counted from those games.
	for (const t of out.filter((x) => x.since || x.until)) {
		const span = [sport, t.franchiseAbbrv, t.firstSeason, t.lastSeason, t.since ?? '0001-01-01', t.until ?? '9999-12-31'];
		span.push(PLAYING);
		// Less any stand-in's days inside it.
		const gaps = (t.exclude ?? []).map(([a, b]) => { span.push(a, b); return ` AND NOT (date BETWEEN $${span.length - 1} AND $${span.length})`; }).join('');
		const where = `sport = $1 AND status = 'final' AND (home = $2 OR away = $2) AND season BETWEEN $3 AND $4 AND date BETWEEN $5 AND $6
			AND season IS DISTINCT FROM $7${gaps}`;
		const { rows: [g] } = await c.query(`
			SELECT count(*) FILTER (WHERE round = 'regular')::int AS n,
			       count(*) FILTER (WHERE round = 'regular' AND winner = $2)::int AS w,
			       count(*) FILTER (WHERE round = 'regular' AND winner IS NULL)::int AS t,
			       count(*) FILTER (WHERE round = 'regular' AND winner <> $2 AND ending IN ('OT', 'SO') AND season >= 2000 AND $1 = 'nhl')::int AS otl,
			       count(*) FILTER (WHERE round <> 'regular' AND winner = $2)::int AS pw,
			       count(*) FILTER (WHERE round <> 'regular' AND winner <> $2)::int AS pl
			  FROM game WHERE ${where}`, span);
		Object.assign(t, { w: g.w, l: g.n - g.w - g.t - g.otl, t: g.t, otl: g.otl, playoffW: g.pw, playoffL: g.pl, basis: 'counted' });
		// A dated list's tenure takes its seasons from its games: a coach hired
		// in December starts with the next season. One with no games (hired and
		// gone before a match) is no tenure here.
		if (t.dated) {
			const { rows: [span2] } = await c.query(`SELECT min(season)::int a, max(season)::int b FROM game WHERE ${where}`, span);
			if (span2.a == null) { t.drop = true; continue; }
			Object.assign(t, { firstSeason: span2.a, lastSeason: span2.b, statedLastSeason: span2.b });
		}
	}
	for (let i = out.length - 1; i >= 0; i--) if (out[i].drop) out.splice(i, 1);
	await c.end();
	// The season being played is in no list's record, so in no count either:
	// a record is through the last season finished. Who has games in it still
	// says who is playing (below).
	const playing = new Set(rows.filter((r) => r.season === PLAYING).map((r) => r.franchise));
	const at = new Map(rows.filter((r) => r.season !== PLAYING).map((r) => [`${r.franchise}|${r.season}`, r]));
	const poAt = new Map(po.rows.filter((r) => r.season !== PLAYING).map((r) => [`${r.franchise}|${r.season}`, r]));
	const held = (t) => {
		let n = 0;
		for (let s = t.firstSeason; s <= t.lastSeason; s++) n += at.get(`${t.franchiseAbbrv}|${s}`)?.n ?? 0;
		return n;
	};
	const claimed = (t) => Number(t.w || 0) + Number(t.l || 0) + Number(t.t || 0) + Number(t.otl || 0);
	const clubOf = (t) => out.filter((x) => x.franchiseAbbrv === t.franchiseAbbrv);
	// The placement the games agree with. Tenures that share a season form a
	// run; a run's coaches' games should come to the games its seasons hold.
	// Each tenure may move: a lone year to the season ending that year or the
	// next, a term in years one season further at either end (a coach who left
	// in December, or arrived in one). Moves are kept while they bring the
	// club's runs closer to their games, until none does.
	// A record stated once for several ranges, shared out by the games each
	// range's seasons hold; a range that had all of its seasons is then counted
	// exactly below, and the rest share what it leaves.
	const groups = new Map();
	for (const t of out) if (t.group) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
	const SHARED = ['w', 'l', 't', 'otl', 'playoffW', 'playoffL'];
	const shareOut = (members, whole) => {
		const weights = members.map((t) => Math.max(1, held(t)));
		const total = weights.reduce((a, b) => a + b, 0);
		for (const k of SHARED) {
			let given = 0;
			members.forEach((t, i) => {
				const share = i === members.length - 1 ? whole[k] - given : Math.round(whole[k] * weights[i] / total);
				t[k] = Math.max(0, share);
				given += share;
			});
		}
	};
	const statedOf = new Map();
	for (const members of groups.values()) statedOf.set(members, Object.fromEntries(SHARED.map((k) => [k, Number(members[0][k] || 0)])));
	for (const [members, whole] of statedOf) if (members[0].w !== '') shareOut(members, whole);

	// How badly a placement fits, season by season: share each tenure's games
	// out among its own seasons so that every season's games are coached, and
	// count what cannot be shared — games a tenure claims that its seasons
	// cannot hold, and games of a season nobody's tenure can cover. Tenures
	// are runs of seasons, so filling each season, in order, from the tenures
	// that end soonest shares out as much as can be (it is the earliest-deadline
	// rule). A total over a run, which this replaced, let an over-full season
	// and an under-full one cancel.
	const misfit = (mates) => {
		const club = mates[0].franchiseAbbrv;
		const from = Math.min(...mates.map((t) => t.firstSeason));
		const to = Math.max(...mates.map((t) => t.lastSeason));
		const left = new Map(mates.map((t) => [t, claimed(t)]));
		let unclaimed = 0;
		for (let s = from; s <= to; s++) {
			let need = at.get(`${club}|${s}`)?.n ?? 0;
			const open = mates.filter((t) => t.firstSeason <= s && s <= t.lastSeason && left.get(t) > 0)
				.sort((a, b) => a.lastSeason - b.lastSeason);
			for (const t of open) {
				if (!need) break;
				const give = Math.min(need, left.get(t));
				left.set(t, left.get(t) - give);
				need -= give;
			}
			unclaimed += need;
		}
		let overclaimed = 0;
		for (const v of left.values()) overclaimed += v;
		return unclaimed + overclaimed;
	};
	let stretched = 0, counted = 0;
	for (const club of new Set(out.map((t) => t.franchiseAbbrv))) {
		const mates = out.filter((t) => t.franchiseAbbrv === club && t.w !== '');
		const start = new Map(mates.map((t) => [t, [t.firstSeason, t.lastSeason]]));
		// A written term moved off its years costs a little, so a lone year
		// (either placement is as written) moves before a term is stretched:
		// Bernie Geoffrion's "1979" is 1979-80, not Scotty Bowman running on.
		const cost = () => misfit(mates) + 0.5 * mates.filter((t) => {
			if (t.single) return false;
			const [f, l] = start.get(t);
			return f !== t.firstSeason || l !== t.lastSeason;
		}).length;
		let best = cost();
		for (let round = 0; round < 60; round++) {
			// The best single move of the round, of every tenure's, not the
			// first that helps: the first was often a stretch a lone year's move
			// would have made unnecessary.
			const optionsOf = (t) => {
				const [f, l] = start.get(t);
				return t.single ? [[t.year, t.year], [t.year + 1, t.year + 1]]
					: [[f, l], [f, l + 1], [f - 1, l], [f - 1, l + 1]];
			};
			const tryMove = (moves) => {
				const was = moves.map(([t]) => [t.firstSeason, t.lastSeason]);
				for (const [t, [a, b]] of moves) [t.firstSeason, t.lastSeason] = [a, b];
				const now = cost();
				moves.forEach(([t], i) => { [t.firstSeason, t.lastSeason] = was[i]; });
				return now;
			};
			let pick = null;
			for (const t of mates) {
				if (t.fixed) continue;
				for (const [a, b] of optionsOf(t)) {
					if (a === t.firstSeason && b === t.lastSeason) continue;
					const now = tryMove([[t, [a, b]]]);
					if (now < best && (!pick || now < pick.now)) pick = { moves: [[t, [a, b]]], now };
				}
			}
			// None helps alone: two coaches in a row, moved together. Carolina's
			// Laviolette and Maurice each ran a season past their written years,
			// and either moved without the other only overlaps the next.
			if (!pick) {
				for (const t of mates) {
					if (t.fixed) continue;
					for (const u of mates) {
						if (u === t || u.fixed || u.firstSeason - t.lastSeason < 0 || u.firstSeason - t.lastSeason > 1) continue;
						for (const at of optionsOf(t)) for (const au of optionsOf(u)) {
							if (at[0] === t.firstSeason && at[1] === t.lastSeason) continue;
							if (au[0] === u.firstSeason && au[1] === u.lastSeason) continue;
							const now = tryMove([[t, at], [u, au]]);
							if (now < best && (!pick || now < pick.now)) pick = { moves: [[t, at], [u, au]], now };
						}
					}
				}
			}
			if (!pick) break;
			for (const [t, [a, b]] of pick.moves) [t.firstSeason, t.lastSeason] = [a, b];
			best = pick.now;
		}
		for (const t of mates) {
			t.statedLastSeason = t.lastSeason;
			const [f, l] = start.get(t);
			if (f !== t.firstSeason || l !== t.lastSeason) stretched++;
		}
	}
	// The list was read before the season being played began (August 2026), so
	// a club's last coach, listed through last season with nobody after him, is
	// still its coach: his tenure runs on into this one.
	if (ENDS_IN_NEXT_YEAR) {
		for (const club of new Set(out.map((t) => t.franchiseAbbrv))) {
			const last = out.filter((t) => t.franchiseAbbrv === club).sort((a, b) => b.lastSeason - a.lastSeason)[0];
			if (last?.lastSeason === CURRENT - 1 && playing.has(club)) { last.lastSeason = CURRENT; last.statedLastSeason = CURRENT; }
		}
	}
	for (const t of out) {
		const mates = clubOf(t).filter((x) => x !== t);
		let alone = true;
		for (let s = t.firstSeason; s <= t.lastSeason && alone; s++) {
			if (mates.some((x) => x.firstSeason <= s && s <= x.lastSeason)) alone = false;
		}
		// A dated tenure is already its own games, to the day.
		if (!alone || t.dated) continue;
		let w = 0, l = 0, tie = 0, otl = 0, pw = 0, pl = 0, n = 0;
		for (let s = t.firstSeason; s <= t.lastSeason; s++) {
			const g = at.get(`${t.franchiseAbbrv}|${s}`);
			if (g) { n += g.n; w += g.w; tie += g.t; otl += g.otl; l += g.n - g.w - g.t - g.otl; }
			const p = poAt.get(`${t.franchiseAbbrv}|${s}`);
			if (p) { pw += p.w; pl += p.l; }
		}
		if (!n) continue;
		Object.assign(t, { w, l, t: tie, otl, playoffW: pw, playoffL: pl, basis: 'counted' });
		counted++;
	}
	// A season-table tenure that shares a season keeps the table's regular
	// season and takes the playoffs of the seasons it finished.
	for (const t of out.filter((x) => x.finishes && x.basis !== 'counted')) {
		t.playoffW = 0; t.playoffL = 0;
		for (const yr of t.finishes) {
			const p = poAt.get(`${t.franchiseAbbrv}|${yr}`);
			if (p) { t.playoffW += p.w; t.playoffL += p.l; }
		}
	}
	// A shared record: the ranges counted from the games take what they had,
	// and the rest of the stated whole is the others'. Eddie Johnston's Pittsburgh
	// 1980-83 is counted, so 1993-97 is his 232 wins less those, not a share.
	for (const [members, whole] of statedOf) {
		const counts = members.filter((t) => t.basis === 'counted');
		const rest = members.filter((t) => t.basis !== 'counted');
		if (!counts.length || !rest.length || rest[0].w === '') continue;
		shareOut(rest, Object.fromEntries(SHARED.map((k) => [k, whole[k] - counts.reduce((a, t) => a + Number(t[k] || 0), 0)])));
	}
	console.log(`against the games: ${stretched} terms stretched into a shared season, ${counted} records counted from the games`);

	// The four ABA clubs' lists run back into the ABA, whose games this repo
	// does not count (lib/limitations.js): a tenure wholly ABA goes, and one
	// that crosses into 1976-77 starts there. A crossing tenure's record was
	// counted from the games, which are the NBA's alone; a transcribed one
	// would carry ABA games, and is reported.
	const ABA = sport === 'nba' ? { clubs: new Set(['BKN', 'DEN', 'IND', 'SAS']), from: 1977 } : null;
	if (ABA) {
		let dropped = 0;
		for (let i = out.length - 1; i >= 0; i--) {
			const t = out[i];
			if (!ABA.clubs.has(t.franchiseAbbrv) || t.firstSeason >= ABA.from) continue;
			if (t.lastSeason < ABA.from) { out.splice(i, 1); dropped++; continue; }
			t.firstSeason = ABA.from;
			// The term starts with the NBA, too: Bobby Leonard's 1968-1980 is
			// 1976-1980 here.
			if (t.term) t.term = termOf(ABA.from - 1, t.term.split('–').at(-1));
			if (t.basis !== 'counted') review.push(`aba record    ${t.franchiseAbbrv} · ${t.name} · transcribed across 1976-77, so it holds ABA games`);
		}
		console.log(`the ABA: ${dropped} tenures wholly before 1976-77 dropped`);
	}

	// Championships, from the games' champions: the coach who finished the
	// season, which in a season shared by a change is the later of them, in
	// the list's own order.
	const c2 = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await c2.connect();
	const { rows: champs } = await c2.query('SELECT season::int AS season, champion FROM championship WHERE sport = $1', [sport]);
	await c2.end();
	let titles = 0;
	for (const ch of champs) {
		const covering = out.filter((t) => t.franchiseAbbrv === ch.champion && t.firstSeason <= ch.season && ch.season <= t.lastSeason);
		const finisher = covering.at(-1);
		if (!finisher) continue;
		finisher.titleSeasons = [finisher.titleSeasons, ch.season].filter(Boolean).join(' ');
		titles++;
	}
	console.log(`championships: ${titles} credited`);
}

console.log(`${sport}: ${draft.length} draft rows, ${out.length} tenures read, ${review.length} to review`);
for (const line of review) console.log(`  ${line}`);

// One spelling a person: the first the drafts gave ("Wílmer Cabrera" and
// "Wilmer Cabrera" are one id). And one tenure a club, coach and first season,
// which is leader_tenure's key: Brian Schmetzer stood in for Seattle twice in
// 2015, a game each, and two rows would lose one at load.
const nameOf = new Map();
for (const t of out) if (!nameOf.has(t.leaderId)) nameOf.set(t.leaderId, t.name);
for (const t of out) t.name = nameOf.get(t.leaderId);
for (let i = out.length - 1; i >= 0; i--) {
	const t = out[i];
	const j = out.findIndex((x, k) => k < i && x.franchiseAbbrv === t.franchiseAbbrv && x.leaderId === t.leaderId && x.firstSeason === t.firstSeason);
	if (j < 0) continue;
	const keep = out[j];
	for (const k of ['w', 'l', 't', 'otl', 'playoffW', 'playoffL']) keep[k] = Number(keep[k] || 0) + Number(t[k] || 0);
	keep.lastSeason = Math.max(keep.lastSeason, t.lastSeason);
	keep.statedLastSeason = keep.lastSeason;
	keep.titleSeasons = [...new Set(`${keep.titleSeasons} ${t.titleSeasons}`.trim().split(/\s+/).filter(Boolean))].join(' ');
	out.splice(i, 1);
}

if (write) {
	if (existsSync(OUT) && !force && outAt < 0) {
		console.error(`${OUT} exists and is curated; --force to overwrite it`);
		process.exit(1);
	}
	const head = ['leaderId', 'name', 'nflverseName', 'franchiseAbbrv', 'firstSeason', 'lastSeason', 'statedLastSeason',
		'w', 'l', 't', 'otl', 'playoffW', 'playoffL', 'titleSeasons', 'interim', 'basis', 'source', 'term'];
	const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
	const text = [
		`# ${sport.toUpperCase()} head coaches, from Wikipedia's lists of each club's head coaches (CC BY-SA 4.0).`,
		'#',
		'# CURATED AND COMMITTED. Seeded by scripts/wiki-coaches.mjs from the draft in',
		'# data/sources/sportsdata/coaches; corrections belong here, not in the draft.',
		`# Seasons are numbered as this repo numbers them${ENDS_IN_NEXT_YEAR ? ' (the year a season ends)' : ''}.`,
		'# w, l, t and otl are the regular season, playoffW and playoffL the playoffs.',
		'# basis says where the record is from: counted, from this database\'s games,',
		'# for a coach who had every game of his seasons; transcribed, the list\'s own,',
		'# where a mid-season change shares a season and only the list knows the split.',
		'# Each tenure\'s seasons were placed where its games fit the games played',
		'# (scripts/coaches-check.mjs reports any that do not). titleSeasons are the',
		'# club\'s championships, credited to the coach who finished the season.',
		head.join(','),
		...out.map((r) => head.map((h) => cell(r[h])).join(',')),
	].join('\n') + '\n';
	writeFileSync(OUT, text);
	console.log(`wrote ${OUT}`);
}

// For the check that follows.
writeFileSync(join(ROOT, 'data', 'sources', 'sportsdata', 'coaches', `${sport}_coaches_read.json`), JSON.stringify(out));
