/** The NCAA tournament's bracket, one season's (Ray, 2026-10-27), drawn from
 *  the games: /ncaam/bracket/<season>, /ncaaw/bracket/<season>,
 *  /ncaah/bracket/<season>.
 *
 *  Nothing in the data says which game feeds which, so the bracket is walked
 *  back from the final: each side of a game came from the last game that side
 *  won before it. The final's two sides came from the national semifinals,
 *  theirs from the four regional finals, and each regional final is the top
 *  of a region. A side with no earlier win came in there: a first-round team,
 *  a bye in the early tournaments' uneven fields, or a First Four winner (the
 *  First Four is listed apart, as the NCAA draws it). Third-place games feed
 *  nothing.
 *
 *  Seeds (from 1979) and each game's city come from
 *  data/reference/ncaam-seeds.csv (scripts/ncaam-seeds.mjs). A region is
 *  named as its games' titles name it; 2003-2020's do not, and the region is
 *  called after the city its regional final was played in, as the NCAA then
 *  did ("Albuquerque regional"). Women's seeds and regions, from Wikipedia's
 *  brackets, are data/reference/ncaaw-seeds.csv (scripts/ncaaw-seeds.mjs), and
 *  hockey's, a region of four, data/reference/ncaah-seeds.csv (scripts/ncaah-games.mjs).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml as esc } from './html.js';
import { parseCsv } from './csv.js';
import { page, stepNav } from './render.js';
import { seasonName } from './seasons.js';

const REFERENCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reference');
const seedRows = new Map();
/** A season's seeds, and each game's city or region, by game id:
 *  Map(id -> { home, away, city, region }). A file is read once a process. */
export function tournamentSeeds(sport, season) {
	if (!seedRows.has(sport)) seedRows.set(sport, parseCsv(readFileSync(join(REFERENCE, `${sport}-seeds.csv`), 'utf8')));
	const num = (v) => (v ? Number(v) : null);
	return new Map(seedRows.get(sport).filter((r) => Number(r.season) === season)
		.map((r) => [r.game, { home: num(r.home_seed), away: num(r.away_seed), city: r.city || null, region: r.region || null }]));
}

const SIDE_STAGES = new Set(['THIRD', 'R3RD']);
const ROUNDS = ['R64', 'R32', 'S16', 'E8', 'F4', 'FINAL'];
const REGION = /\b(Far West|Midwest|Mideast|Southeast|Southwest|East|West|South)\b/i;
// A seed's line in a 16-team region, top to bottom: 1 meets 16, the winner
// 8 or 9, and so on, 2 at the bottom.
const LINE = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
const lineOf = (seed) => (seed ? LINE.indexOf(seed) : -1);

/** A season as the club pages name it (lib/seasons.js): "2024-2025" for the
 *  season whose tournament was in 2025. */
export const seasonLabel = (season) => seasonName('ncaam', season);

/** A game's region, from its title: "West" from "WEST REGIONAL" or "NCAA
 *  Men's Tourn., West - First Round"; a regional named for its city, as
 *  2004-2006's were, as the city's ("ATLANTA REGIONAL AT DALLAS" is the
 *  Atlanta regional). Null where the title says none. */
export function regionOf(title) {
	const word = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bDc\b/, 'DC');
	const city = /^([A-Z][A-Z .]+?) REGION(?:AL)?\b/.exec(title ?? '');
	if (city) return REGION.test(city[1]) && REGION.exec(city[1])[0].length === city[1].length ? word(city[1]) : `${word(city[1])} regional`;
	const m = REGION.exec(title ?? '');
	return m ? word(m[1]) : null;
}

const winnerOf = (g) => (g.homeScore == null || g.awayScore == null ? null
	: g.homeScore > g.awayScore ? g.home : g.awayScore > g.homeScore ? g.away : null);

/** `games`: the season's NCAA tournament games (the store's rows); `seeds`:
 *  Map(game id -> { home, away, city }); `finalId`: the championship game's id,
 *  where the championship table has one. Null with no final to start from. */
/** The NIT's games, and the WNIT's, stored as one stage, given the NCAA's for
 *  the parts the bracket needs: its final, from the title ("NIT-FINAL", "NIT
 *  CHAMPIONSHIP AT MADISON SQUARE GARDEN", "WNIT CHAMPIONSHIP"), else its last
 *  game; and its third-place games ("NIT-THIRD-PLACE", "NIT CONSOLATION"), which
 *  feed nothing. */
export function nitGames(games) {
	const third = (g) => /THIRD|CONSOLATION/i.test(g.title ?? '');
	const isFinal = (g) => !third(g) && /CHAMPIONSHIP|(^|[-\s])FINAL\b/i.test(g.title ?? '') && !/SEMI|QUARTER/i.test(g.title ?? '');
	const played = games.filter((g) => !third(g));
	const final = played.find(isFinal) ?? played.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
	return games.map((g) => ({ ...g, stage: third(g) ? 'THIRD' : g === final ? 'FINAL' : 'NIT' }));
}

export function buildBracket(games, { seeds = new Map(), finalId = null, halves = false } = {}) {
	const ncaa = games.filter((g) => !SIDE_STAGES.has(g.stage));
	const final = ncaa.find((g) => g.id === finalId)
		?? ncaa.find((g) => g.stage === 'FINAL')
		?? null;
	if (!final) return null;
	const seedOf = new Map();
	for (const g of games) {
		const s = seeds.get(g.id);
		if (s?.home) seedOf.set(g.home, s.home);
		if (s?.away) seedOf.set(g.away, s.away);
	}
	const day = (g) => String(g.date instanceof Date ? g.date.toISOString() : g.date).slice(0, 10);
	// The last game a side won before this one, outside the First Four. Hockey's
	// regional rounds can share a date, a Friday's late game being Saturday's to
	// ESPN, and the round says which came first.
	const round = (x) => ROUNDS.indexOf(x.stage);
	const earlier = (x, g) => day(x) < day(g) || (day(x) === day(g) && round(x) >= 0 && round(x) < round(g));
	const before = (team, g) => ncaa
		.filter((x) => x !== g && x.stage !== 'FF' && earlier(x, g) && winnerOf(x) === team)
		.sort((a, b) => day(b).localeCompare(day(a)) || round(b) - round(a))[0] ?? null;
	const used = new Set();
	const node = (g) => {
		used.add(g.id);
		const won = winnerOf(g);
		const sides = [g.away, g.home].map((team) => {
			const prev = before(team, g);
			return { team, seed: seedOf.get(team) ?? null, score: team === g.home ? g.homeScore : g.awayScore, won: won === team, from: prev && !used.has(prev.id) ? node(prev) : null };
		});
		// The higher seed's line on top, as the NCAA draws it; the earlier
		// tournaments, unseeded, as the games were listed.
		const top = (s) => {
			const lines = [];
			const walk = (side) => { if (side.seed) lines.push(lineOf(side.seed)); side.from?.sides.forEach(walk); };
			walk(s);
			return lines.length ? Math.min(...lines) : 99;
		};
		if (top(sides[1]) < top(sides[0])) sides.reverse();
		return { game: g, sides };
	};
	const root = node(final);
	let semis = root.sides.map((s) => s.from).filter(Boolean);
	const cityOf = (g) => seeds.get(g.id)?.city || null;
	// The name most of a region's games give ("WEST REGIONAL" is the West);
	// else its regional final's city.
	const nameOf = (top, i) => {
		const named = new Map();
		const walk = (n) => {
			const r = seeds.get(n.game.id)?.region ?? regionOf(n.game.title);
			if (r) named.set(r, (named.get(r) ?? 0) + 1);
			n.sides.forEach((s) => s.from && walk(s.from));
		};
		walk(top);
		const best = [...named].sort((a, b) => b[1] - a[1])[0]?.[0];
		return best ?? (cityOf(top.game) ? `${cityOf(top.game)} regional` : `Region ${i + 1}`);
	};
	let regions = semis.flatMap((semi) => semi.sides.map((s) => s.from).filter(Boolean)).map((top, i) => ({ name: nameOf(top, i), top }));
	// Two regions, East and West, until 1956: what feeds the final is each
	// region's final, not a national semifinal.
	if (new Set(regions.map((r) => r.name)).size < regions.length) {
		regions = semis.map((top, i) => ({ name: nameOf(top, i), top }));
		semis = [];
	}
	// A bracket with no regions (the NIT): its two halves, each to its
	// semifinal.
	if (halves) {
		regions = semis.map((top, i) => ({ name: i ? 'Bottom half' : 'Top half', top }));
		semis = [];
	}
	return {
		final: root,
		semis,
		regions,
		firstFour: games.filter((g) => g.stage === 'FF').sort((a, b) => day(a).localeCompare(day(b))),
		third: games.filter((g) => SIDE_STAGES.has(g.stage)).sort((a, b) => day(a).localeCompare(day(b))),
		// Games the walk never reached: a side whose next game the record is
		// missing (the 1955 NIT has St. Francis's two wins and not its
		// semifinal). Listed, not dropped.
		unplaced: ncaa.filter((g) => g.stage !== 'FF' && !used.has(g.id)).sort((a, b) => day(a).localeCompare(day(b))),
		seedOf,
	};
}

/** A tree of games as grid cells, each with `rows` rows per side that came in
 *  below it, so a game sits level with the two it follows. `depth` counts from
 *  the top game; `fork` is where the line joining its feeders starts and ends,
 *  as percents of its cell. `heads(n)` rows are left clear above a game, for a
 *  region's name; `stops(n)` cuts the tree above that game. */
function treeCells(top, { depth: first = 0, row: start = 1, rows: unit = 1, heads = () => 0, stops = () => false } = {}) {
	const cells = [];
	const place = (n, depth, at) => {
		const row = at + heads(n);
		const fed = [];
		let r = row;
		for (const s of n.sides) {
			if (s.from && !stops(s.from)) {
				r += place(s.from, depth + 1, r);
				const c = cells.at(-1);
				fed.push(c.row + c.span / 2);
			} else r += unit;
		}
		const span = r - row;
		const pct = (v) => Number((((v - row) / span) * 100).toFixed(2));
		const ends = [...fed, row + span / 2];
		cells.push({ node: n, depth, row, span, fork: fed.length ? [pct(Math.min(...ends)), pct(Math.max(...ends))] : null });
		return r - at;
	};
	return { rows: place(top, first, start), cells };
}

/** A region as grid cells: each game a column, its round, from the left. */
export function regionCells(top, options = {}) {
	const { rows, cells } = treeCells(top, options);
	const first = options.depth ?? 0;
	const cols = 1 + Math.max(...cells.map((c) => c.depth)) - first;
	return { cols, rows, cells: cells.map((c) => ({ ...c, col: cols - (c.depth - first) })) };
}

/** The whole tournament on one grid: the final in the middle column, what fed
 *  each of its sides running in to it from that side, and a row of two half
 *  rows for each side that came in, so two sides of different sizes can both
 *  centre on the final. The first rows are the rounds' names. */
const HEAD_ROWS = 4;
const MIN_ROWS = 24;
export function bracketCells(bracket) {
	const names = new Map(bracket.regions.map((r) => [r.top, r.name]));
	const halves = bracket.final.sides.map((s) => (s.from ? treeCells(s.from, { depth: 1, rows: 2, heads: (n) => (names.has(n) ? 2 : 0) }) : { rows: 0, cells: [] }));
	// Tall enough, in a small field, for the champion above the final and third
	// place below it.
	const rows = Math.max(MIN_ROWS, ...halves.map((h) => h.rows));
	const reach = Math.max(1, ...halves.flatMap((h) => h.cells.map((c) => c.depth)));
	const middle = reach + 1;
	const cells = [];
	const labels = [];
	halves.forEach((h, i) => {
		const shift = (rows - h.rows) / 2 + HEAD_ROWS;
		const colOf = (depth) => (i ? middle + depth : middle - depth);
		const outer = colOf(Math.max(...h.cells.map((c) => c.depth)));
		for (const c of h.cells) {
			cells.push({ ...c, row: c.row + shift, col: colOf(c.depth), flip: i === 1 });
			if (names.has(c.node)) labels.push({ name: names.get(c.node), row: c.row + shift - 2, side: i, col: outer });
		}
	});
	return { cols: reach * 2 + 1, rows, middle, cells, labels };
}

const CSS = `<style>
body { justify-content: flex-start; }
.br-tabs { text-align: center; margin: -1.25rem 0 .75rem; }
.br-tabs a { color: var(--text); }
.br-champ { text-align: center; margin: .9rem 0 1rem; font-size: 1.05rem; }
.br-region, .br-ff { text-align: left; }
.br-region h2, .br-ff h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
.br-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.br-grid { --gap: 1.2rem; display: grid; grid-auto-rows: 1.55rem; column-gap: var(--gap); min-width: max-content; }
.br-cell { position: relative; display: flex; align-items: center; }
.br-round { align-self: start; color: var(--muted); font-size: .72rem; line-height: 1.2; text-align: center; white-space: nowrap; }
.br-round b { display: block; color: var(--text); text-transform: uppercase; letter-spacing: .04em; }
/* The lines between rounds: a game's stub out to the middle of the gap, and its
   feeders' fork, joined there. */
.br-cell.out::after, .br-fork::before, .br-fork::after { content: ''; position: absolute; border: 0 solid var(--muted); pointer-events: none; }
.br-cell.out::after, .br-fork::after { top: 50%; width: calc(var(--gap) / 2); border-top-width: 1px; }
.br-cell.out::after { left: 100%; }
.br-fork { position: absolute; inset: 0; pointer-events: none; }
.br-fork::before { top: var(--a); bottom: calc(100% - var(--b)); left: calc(var(--gap) / -2); border-left-width: 1px; }
.br-fork::after { left: calc(var(--gap) / -2); }
.br-cell.flip.out::after { left: auto; right: 100%; }
.br-cell.flip .br-fork::before { left: auto; right: calc(var(--gap) / -2); }
.br-cell.flip .br-fork::after { left: auto; right: calc(var(--gap) / -2); }
.br-game { width: 11rem; border: 1px solid var(--panel-edge); border-radius: 6px; background: var(--panel); font-size: .82rem; }
.br-side { display: grid; grid-template-columns: 1.4rem 1fr auto; gap: .3rem; padding: .12rem .4rem; align-items: center; }
.br-side + .br-side { border-top: 1px solid var(--panel-edge); }
.br-side .sd { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
.br-side .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-side .nm a { color: inherit; text-decoration: none; }
.br-side .nm a:hover { text-decoration: underline; }
.br-side .sc { font-variant-numeric: tabular-nums; }
.br-side.lost { color: var(--muted); }
.br-side.won { font-weight: 700; }
.br-ff .br-row { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
.br-ff .br-label { font-size: .75rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: .3rem 0 .2rem; }
.br-list { display: flex; flex-wrap: wrap; gap: .6rem; }
/* A game with a summary: the box opens it. */
.br-game[data-game] { cursor: pointer; }
.br-game[data-game]:hover, .br-game[data-game]:focus-visible { border-color: var(--accent); outline: none; }
.br-sum { width: min(32rem, calc(100vw - 2rem)); max-height: 85vh; padding: 1rem 1.1rem; border: 1px solid var(--panel-edge); border-radius: 12px;
	background: var(--base, #2a2a2a); color: var(--text); text-align: left; }
.br-sum::backdrop { background: rgba(0, 0, 0, .7); }
.br-sum-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
.br-sum-head h2 { margin: 0; font-size: 1.1rem; }
.br-sum-close { background: none; border: 0; color: var(--muted); font-size: 1.4rem; cursor: pointer; line-height: 1; }
.br-sum table { width: 100%; border-collapse: collapse; margin: .5rem 0; font-variant-numeric: tabular-nums; font-size: .9rem; }
.br-sum th, .br-sum td { padding: .2rem .35rem; text-align: right; border-bottom: 1px solid var(--panel-edge); }
.br-sum th:first-child, .br-sum td:first-child { text-align: left; }
.br-sum th { color: var(--muted); font-weight: 400; }
.br-sum tr.won td { font-weight: 700; }
.br-sum a { color: var(--accent); }
.br-sum-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .4rem 1rem; }
.br-sum-leaders { list-style: none; margin: 0; padding: 0; font-size: .88rem; }
.br-sum-leaders li { padding: .1rem 0; }
.br-sum-leaders span { color: var(--muted); }
/* A phone shows a region's first two rounds; the rest are a swipe away. */
.br-swipe { display: none; margin: -.3rem 0 .4rem; font-size: .75rem; color: var(--muted); }
@media (max-width: 760px) { .br-swipe { display: block; } }
/* The whole bracket, on a screen wide enough to read it: every length in em, so
   one font size fits its columns to the window. */
.br-wide { display: none; }
.br-narrow { display: flex; flex-direction: column; align-items: center; width: 100%; }
.br-tree { --gap: 1.2em; display: grid; justify-content: center; column-gap: var(--gap); grid-template-columns: repeat(var(--cols), 9em); grid-auto-rows: .7em;
	font-size: min(1.25rem, calc((100vw - 3rem) / (var(--cols) * 10.2 - 1.2))); text-align: left; }
.br-tree .br-game { width: 100%; font-size: .76em; }
.br-tree .br-side { grid-template-columns: 1.5em 1fr auto; gap: .25em; padding: .08em .3em; }
.br-tree .br-round { font-size: .7em; }
.br-name { align-self: center; font-size: .9em; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
.br-name.flip { text-align: right; }
.br-final { position: relative; width: 100%; }
.br-final > .br-game { border-color: var(--text); }
.br-final::before, .br-final::after { content: ''; position: absolute; top: 50%; width: calc(var(--gap) / 2); border-top: 1px solid var(--muted); }
.br-final::before { right: 100%; }
.br-final::after { left: 100%; }
.br-above, .br-below { position: absolute; left: 0; right: 0; }
.br-above { bottom: calc(100% + .6em); text-align: center; font-size: 1.15em; font-weight: 700; line-height: 1.15; }
.br-above span { display: block; margin-bottom: .2em; color: var(--muted); font-size: .6em; font-weight: 400; letter-spacing: .05em; text-transform: uppercase; }
.br-below { top: calc(100% + .9em); }
.br-below .br-label { margin: 0 0 .2em; color: var(--muted); font-size: .7em; letter-spacing: .05em; text-align: center; text-transform: uppercase; }
@media (min-width: 1360px) {
	.br-wide { display: block; width: calc(100vw - 2rem); margin: 1.25rem 0; }
	.br-narrow, .br-champ { display: none; }
}
</style>`;

const ROUND_NAMES = { R64: 'First Round', R32: 'Second Round', S16: 'Sweet 16', E8: 'Elite Eight', FINAL: 'Championship' };
// The games a round named for its size must have to be called that.
const FULL_ROUND = { S16: 8, E8: 4 };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A round's dates: "Mar 19-20", "Mar 31-Apr 1", "Apr 6". */
function roundDates(nodes) {
	const days = nodes.map((n) => String(n.game.date instanceof Date ? n.game.date.toISOString() : n.game.date).slice(0, 10)).sort();
	const [first, last] = [days[0], days.at(-1)].map((d) => [MONTH[Number(d.slice(5, 7)) - 1], Number(d.slice(8, 10))]);
	if (days[0] === days.at(-1)) return `${first[0]} ${first[1]}`;
	return `${first[0]} ${first[1]}–${first[0] === last[0] ? '' : `${last[0]} `}${last[1]}`;
}


/** The page. `bracket` from buildBracket (null: no tournament that season);
 *  `team(code)` -> { name, href } for a side; `seasons` every season with a
 *  bracket, for the picker. */
export function bracketPage({ season, seasons, bracket, team, heading, footer = '', colors, note = '', summaryUrl = null, base = '/ncaam/bracket', tabs = '', finalTitle = 'Final Four', roundNames = {}, espnLeague = 'mens-college-basketball' }) {
	const side = (s) => {
		const t = team(s.team);
		const name = t.href ? `<a href="${esc(t.href)}">${esc(t.name)}</a>` : esc(t.name);
		const cls = s.won ? 'won' : s.score != null ? 'lost' : '';
		return `<div class="br-side ${cls}"><span class="sd">${s.seed ?? ''}</span><span class="nm" title="${esc(t.name)}">${name}</span><span class="sc">${s.score ?? ''}</span></div>`;
	};
	// A game ESPN has (its id is ESPN's, from 2003) opens its summary: the
	// whole box but the teams' names, which go to their pages.
	const opens = (g, sides) => (summaryUrl && /^\d+$/.test(g.id) && g.homeScore != null
		? ` data-game="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(`Summary: ${sides.map((s) => team(s.team).name).join(' vs ')}`)}"` : '');
	const gameBox = (n) => `<div class="br-game"${opens(n.game, n.sides)}>${n.sides.map(side).join('')}</div>`;
	// A game outside the tree (First Four, third place): its two sides as
	// they were listed.
	const looseBox = (g) => {
		const won = g.homeScore != null && g.awayScore != null ? (g.homeScore > g.awayScore ? g.home : g.away) : null;
		const mk = (code, score) => ({ team: code, seed: bracket.seedOf.get(code) ?? null, score, won: won === code });
		const sides = [mk(g.away, g.awayScore), mk(g.home, g.homeScore)];
		return `<div class="br-game"${opens(g, sides)}>${sides.map(side).join('')}</div>`;
	};
	// A column's heading: its round, by the stage its games were stored under,
	// else by how far it is from the final: the NIT's are all one stage, and a
	// field of eight has no Sweet 16, though its first round is stored as one.
	const roundName = (depth, stage, games) => {
		if (stage === 'F4') return finalTitle;
		if (roundNames[stage]) return roundNames[stage];
		const fits = !FULL_ROUND[stage] || FULL_ROUND[stage] === games;
		return (fits && ROUND_NAMES[stage]) || ['Championship', 'Semifinals', 'Quarterfinals'][depth] || `Round of ${2 ** (depth + 1)}`;
	};
	// A column can be half its round, or a quarter: the round's size is the tournament's.
	const roundSizes = bracket ? Map.groupBy(treeCells(bracket.final).cells, (c) => c.depth) : new Map();
	const roundHeads = (cells, rows = 2) => [...Map.groupBy(cells, (c) => c.col)].map(([col, list]) => `<div class="br-round" style="grid-column:${col};grid-row:1 / span ${rows}"><b>${esc(roundName(list[0].depth, list[0].node.game.stage, roundSizes.get(list[0].depth).length))}</b>${esc(roundDates(list.map((c) => c.node)))}</div>`).join('');
	const cell = (c, out) => `<div class="br-cell${out ? ' out' : ''}${c.flip ? ' flip' : ''}" style="grid-column:${c.col};grid-row:${c.row} / span ${c.span}">${
		c.fork ? `<span class="br-fork" style="--a:${c.fork[0]}%;--b:${c.fork[1]}%"></span>` : ''}${gameBox(c.node)}</div>`;
	const regionTree = ({ cols, cells }) => `<div class="br-scroll"><div class="br-grid" style="grid-template-columns: repeat(${cols}, 11rem)">${roundHeads(cells)}${
		cells.map((c) => cell(c, c !== cells.at(-1))).join('')}</div></div>`;
	const region = (r) => {
		const tree = regionCells(r.top, { depth: bracket.semis.length ? 2 : 1, row: 3 });
		return `<section class="record-card league-wide br-region"><h2>${esc(r.name)}</h2>${tree.cols > 2 ? '<p class="br-swipe">Swipe for the later rounds →</p>' : ''}${regionTree(tree)}</section>`;
	};
	// The national semifinals and the final, for the regions above them.
	const finalTree = () => regionCells(bracket.final, { row: 3, stops: (n) => !bracket.semis.includes(n) });
	const wholeBracket = (champ) => {
		const { cols, rows, middle, cells, labels } = bracketCells(bracket);
		const third = bracket.third.filter((g) => g.stage === 'THIRD');
		const f = bracket.final;
		return `<div class="br-wide"><div class="br-tree" style="--cols:${cols}" role="group" aria-label="${esc(heading)}">${roundHeads([...cells, { col: middle, depth: 0, node: f }], 3)}${
			labels.map((l) => `<div class="br-name${l.side ? ' flip' : ''}" style="grid-column:${l.side ? `${l.col - 2} / span 3` : `${l.col} / span 3`};grid-row:${l.row} / span 2">${esc(l.name)}</div>`).join('')}${
			cells.map((c) => cell(c, true)).join('')}
<div class="br-cell" style="grid-column:${middle};grid-row:5 / span ${rows}"><div class="br-final">${
			champ ? `<div class="br-above"><span>Champion</span>${esc(team(champ.team).name)}</div>` : ''}${gameBox(f)}${
			third.length ? `<div class="br-below"><p class="br-label">Third place</p>${third.map(looseBox).join('')}</div>` : ''}</div></div></div></div>`;
	};
	// The season stepper every other league page has (render.js stepNav), with
	// whole paths: /ncaam/bracket has no season in it to be relative to.
	const nav = stepNav({ items: seasons, index: seasons.indexOf(season), href: (y) => `${base}/${y}`, format: seasonLabel, label: 'Season' });
	let body;
	if (!bracket) {
		body = `<p class="dim" style="text-align:center">No bracket for ${seasonLabel(season)}${season === 2020 ? ': the 2020 tournaments were cancelled' : ''}.</p>`;
	} else {
		const f = bracket.final;
		const champ = f.sides.find((s) => s.won);
		const other = f.sides.find((s) => !s.won);
		body = [
			champ ? `<p class="br-champ">${esc(team(champ.team).name)} beat ${esc(team(other.team).name)} ${champ.score}–${other.score} for the title</p>` : '',
			wholeBracket(champ),
			`<div class="br-narrow">${bracket.regions.map(region).join('\n')}
<section class="record-card league-wide br-ff"><h2>${esc(finalTitle)}</h2>${bracket.semis.length ? regionTree(finalTree()) : `<div class="br-row">${gameBox(f)}</div>`}
${bracket.third.some((g) => g.stage === 'THIRD') ? `<p class="br-label">Third place</p><div class="br-list">${bracket.third.filter((g) => g.stage === 'THIRD').map(looseBox).join('')}</div>` : ''}</section></div>`,
			bracket.firstFour.length ? `<section class="record-card league-wide br-ff"><h2>First Four</h2><div class="br-list">${bracket.firstFour.map(looseBox).join('')}</div></section>` : '',
			bracket.third.some((g) => g.stage === 'R3RD') ? `<section class="record-card league-wide br-ff"><h2>Regional third place</h2><div class="br-list">${bracket.third.filter((g) => g.stage === 'R3RD').map(looseBox).join('')}</div></section>` : '',
			bracket.unplaced.length ? `<section class="record-card league-wide br-ff"><h2>Other games</h2><p class="br-label">The record is missing the game that would place these in the bracket.</p><div class="br-list">${bracket.unplaced.map(looseBox).join('')}</div></section>` : '',
		].join('\n');
	}
	return page({
		title: heading,
		colors,
		body: [CSS, `<h1>${esc(heading)}</h1>`, tabs, nav, body, note ? `<p class="dim">${note}</p>` : '',
			bracket && summaryUrl ? summaryScript(summaryUrl, espnLeague) : '', footer].filter(Boolean).join('\n'),
	});
}

/** A game's summary, in a dialog over the bracket: the score by half, the
 *  two sides' numbers and leaders, from ESPN's summary (`url` + the game's
 *  id, through the site's ESPN cache), and ESPN's own page for the rest, under
 *  `league`. */
function summaryScript(url, league) {
	return `<dialog id="br-sum" class="br-sum" aria-labelledby="br-sum-title"><div class="br-sum-head"><h2 id="br-sum-title">Game summary</h2>
<button type="button" class="br-sum-close" aria-label="Close"><i class="mdi mdi-close"></i></button></div><div id="br-sum-body"></div></dialog>
<script>(() => {
	const dlg = document.getElementById('br-sum');
	const body = document.getElementById('br-sum-body');
	const title = document.getElementById('br-sum-title');
	const URL_ = ${JSON.stringify(url)};
	const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	let opener = null;
	const HOCKEY = ${JSON.stringify(league === 'mens-college-hockey')};
	const STATS = HOCKEY ?[['Shots', 'shotsTotal'], ['Power-play goals', 'powerPlayGoals'], ['Power plays', 'powerPlayOpportunities'], ['Penalty minutes', 'penaltyMinutes']] : [['FG', 'fieldGoalsMade-fieldGoalsAttempted'], ['3PT', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], ['FT', 'freeThrowsMade-freeThrowsAttempted'],
		['Rebounds', 'totalRebounds'], ['Assists', 'assists'], ['Turnovers', 'totalTurnovers'], ['Steals', 'steals'], ['Blocks', 'blocks']];
	const draw = (j, id) => {
		const comp = j.header?.competitions?.[0];
		const sides = ['away', 'home'].map((h) => comp?.competitors?.find((c) => c.homeAway === h)).filter(Boolean);
		if (sides.length !== 2) { body.innerHTML = '<p class="dim">ESPN has no summary of this game.</p>'; return; }
		const name = (c) => c.team?.location || c.team?.displayName || '';
		title.textContent = sides.map((c) => name(c) + ' ' + (c.score ?? '')).join(', ');
		const when = comp.date ? new Date(comp.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
		const v = j.gameInfo?.venue;
		const where = v ? [v.fullName, v.address?.city].filter(Boolean).join(', ') : '';
		const periods = Math.max(...sides.map((c) => (c.linescores ?? []).length));
		const regulation = HOCKEY ? 3 : 2;
		const head = Array.from({ length: periods }, (_, i) => (i < regulation ? ['1st', '2nd', '3rd'][i] : (i === regulation ? 'OT' : (i - regulation + 1) + 'OT')));
		const lines = '<table class="br-sum-lines"><thead><tr><th></th>' + head.map((h) => '<th>' + h + '</th>').join('') + '<th>T</th></tr></thead><tbody>'
			+ sides.map((c) => '<tr class="' + (c.winner ? 'won' : '') + '"><td>' + esc(name(c)) + '</td>'
				+ head.map((_, i) => '<td>' + esc(c.linescores?.[i]?.displayValue ?? '') + '</td>').join('') + '<td><b>' + esc(c.score ?? '') + '</b></td></tr>').join('') + '</tbody></table>';
		const teams = j.boxscore?.teams ?? [];
		const statOf = (c, key) => teams.find((t) => t.team?.id === c.team?.id)?.statistics?.find((s) => s.name === key)?.displayValue ?? '';
		const stats = teams.length ? '<table class="br-sum-stats"><thead><tr><th></th>' + sides.map((c) => '<th>' + esc(c.team?.abbreviation ?? '') + '</th>').join('') + '</tr></thead><tbody>'
			+ STATS.filter(([, k]) => sides.some((c) => statOf(c, k))).map(([label, k]) => '<tr><td>' + label + '</td>' + sides.map((c) => '<td>' + esc(statOf(c, k)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '';
		// In the score's order, the visitors first.
		const leaders = sides.map((c) => (j.leaders ?? []).find((t) => t.team?.id === c.team?.id)).filter(Boolean).map((t) => {
			const rows = (t.leaders ?? []).map((cat) => { const l = cat.leaders?.[0]; return l ? '<li><span>' + esc(cat.displayName || cat.name) + '</span> ' + esc(l.athlete?.displayName ?? '') + ' <b>' + esc(l.displayValue ?? '') + '</b></li>' : ''; }).join('');
			return rows ? '<div><p class="br-label">' + esc(t.team?.location || t.team?.displayName || '') + '</p><ul class="br-sum-leaders">' + rows + '</ul></div>' : '';
		}).join('');
		body.innerHTML = '<p class="dim">' + esc([comp.status?.type?.detail, when, where].filter(Boolean).join(' · ')) + '</p>' + lines + stats
			+ (leaders ? '<div class="br-sum-two">' + leaders + '</div>' : '')
			+ '<p><a href="https://www.espn.com/${league}/game/_/gameId/' + encodeURIComponent(id) + '" target="_blank" rel="noopener noreferrer">Box score and play-by-play on ESPN</a></p>';
	};
	const open = (box) => {
		opener = box;
		const id = box.dataset.game;
		title.textContent = box.getAttribute('aria-label').replace(/^Summary: /, '');
		body.innerHTML = '<p class="dim">Loading…</p>';
		dlg.showModal();
		fetch(URL_ + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((j) => draw(j, id))
			.catch(() => { body.innerHTML = '<p class="dim">The summary could not be loaded just now.</p>'; });
	};
	document.addEventListener('click', (e) => {
		if (e.target.closest('a')) return;
		const box = e.target.closest('.br-game[data-game]');
		if (box) open(box);
	});
	document.addEventListener('keydown', (e) => {
		const box = e.target.closest?.('.br-game[data-game]');
		if (box && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(box); }
	});
	dlg.querySelector('.br-sum-close').addEventListener('click', () => dlg.close());
	dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
	dlg.addEventListener('close', () => opener?.focus());
})();</script>`;
}
