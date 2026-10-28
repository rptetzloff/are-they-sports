/** The NCAA tournament's bracket, one season's (Ray, 2026-10-27), drawn from
 *  the games: /ncaam/bracket/<season>.
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
 *  did ("Albuquerque regional").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml as esc } from './html.js';
import { parseCsv } from './csv.js';
import { page } from './render.js';

const SEEDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reference', 'ncaam-seeds.csv');
let seedRows = null;
/** A season's seeds and cities, by game id: Map(id -> { home, away, city }).
 *  The file is read once a process. */
export function ncaamSeeds(season) {
	seedRows ??= parseCsv(readFileSync(SEEDS, 'utf8'));
	const num = (v) => (v ? Number(v) : null);
	return new Map(seedRows.filter((r) => Number(r.season) === season)
		.map((r) => [r.game, { home: num(r.home_seed), away: num(r.away_seed), city: r.city || null }]));
}

const SIDE_STAGES = new Set(['THIRD', 'R3RD']);
const REGION = /\b(Far West|Midwest|Mideast|Southeast|Southwest|East|West|South)\b/i;
// A seed's line in a 16-team region, top to bottom: 1 meets 16, the winner
// 8 or 9, and so on, 2 at the bottom.
const LINE = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
const lineOf = (seed) => (seed ? LINE.indexOf(seed) : -1);

/** A season as the club pages name it (web/ncaam/site.js seasonLabel):
 *  "2024-2025" for the season whose tournament was in 2025. */
export const seasonLabel = (season) => `${Number(season) - 1}-${season}`;

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
/** The NIT's games, stored as one stage, given the NCAA's for the parts the
 *  bracket needs: its final, from the title ("NIT-FINAL", "NIT CHAMPIONSHIP
 *  AT MADISON SQUARE GARDEN"), else its last game; and its third-place games
 *  ("NIT-THIRD-PLACE", "NIT CONSOLATION"), which feed nothing. */
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
	// The last game a side won before this one, outside the First Four.
	const before = (team, g) => ncaa
		.filter((x) => x !== g && x.stage !== 'FF' && day(x) < day(g) && winnerOf(x) === team)
		.sort((a, b) => day(b).localeCompare(day(a)))[0] ?? null;
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
			const r = regionOf(n.game.title);
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

/** A region as grid cells: each game a column (its round, from the left) and
 *  rows (as many as the sides that came in below it), so a game sits level
 *  with the two it follows. */
export function regionCells(top) {
	const depthOf = (n) => 1 + Math.max(0, ...n.sides.map((s) => (s.from ? depthOf(s.from) : 0)));
	const cols = depthOf(top);
	const cells = [];
	const place = (n, depth, row) => {
		let r = row;
		for (const s of n.sides) r += s.from ? place(s.from, depth + 1, r) : 1;
		cells.push({ node: n, col: cols - depth, row, span: r - row });
		return r - row;
	};
	const rows = place(top, 0, 1);
	return { cols, rows, cells };
}

const CSS = `<style>
.br-tabs { text-align: center; margin: -1.25rem 0 .75rem; }
.br-tabs a { color: var(--text); }
.br-nav { display: flex; align-items: center; justify-content: center; gap: .6rem; margin: .25rem 0 1rem; flex-wrap: wrap; }
.br-nav a, .br-nav select { color: var(--text); font: inherit; }
.br-nav select { padding: .25rem .4rem; border-radius: 6px; border: 1px solid var(--panel-edge); background: var(--panel); }
/* The list is drawn in the platform's colours, light grey under this page's
   white text in a light-mode browser: its own, as the filters' (lib/style.js). */
.br-nav select option { color: var(--text); background: var(--base-deep, var(--base)); }
.br-champ { text-align: center; margin: 0 0 1rem; font-size: 1.05rem; }
.br-region, .br-ff { text-align: left; }
.br-region h2, .br-ff h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
.br-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.br-grid { display: grid; grid-auto-rows: 1.55rem; column-gap: .9rem; min-width: max-content; }
.br-cell { display: flex; align-items: center; }
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
</style>`;

/** The page. `bracket` from buildBracket (null: no tournament that season);
 *  `team(code)` -> { name, href } for a side; `seasons` every season with a
 *  bracket, for the picker. */
export function bracketPage({ season, seasons, bracket, team, heading, footer = '', colors, note = '', summaryUrl = null, base = '/ncaam/bracket', tabs = '', finalTitle = 'Final Four' }) {
	const side = (s) => {
		const t = team(s.team);
		const name = t.href ? `<a href="${esc(t.href)}">${esc(t.name)}</a>` : esc(t.name);
		const cls = s.won ? 'won' : s.score != null ? 'lost' : '';
		return `<div class="br-side ${cls}"><span class="sd">${s.seed ?? ''}</span><span class="nm">${name}</span><span class="sc">${s.score ?? ''}</span></div>`;
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
	const region = (r) => {
		const { cols, cells } = regionCells(r.top);
		return `<section class="record-card league-wide br-region"><h2>${esc(r.name)}</h2>${cols > 2 ? '<p class="br-swipe">Swipe for the later rounds →</p>' : ''}<div class="br-scroll"><div class="br-grid" style="grid-template-columns: repeat(${cols}, 11rem)">${
			cells.map((c) => `<div class="br-cell" style="grid-column:${c.col};grid-row:${c.row} / span ${c.span}">${gameBox(c.node)}</div>`).join('')}</div></div></section>`;
	};
	const idx = seasons.indexOf(season);
	// Whole paths: /ncaam/bracket has no season in it to be relative to.
	const yearHref = (y) => `${esc(base)}/${esc(String(y))}`;
	const nav = `<nav class="br-nav" aria-label="Season">${idx > 0 ? `<a href="${yearHref(seasons[idx - 1])}">‹ ${seasonLabel(seasons[idx - 1])}</a>` : ''}
<select aria-label="Season" onchange="location.href=this.value">${seasons.slice().reverse().map((y) => `<option value="${yearHref(y)}"${y === season ? ' selected' : ''}>${seasonLabel(y)}</option>`).join('')}</select>
${idx >= 0 && idx < seasons.length - 1 ? `<a href="${yearHref(seasons[idx + 1])}">${seasonLabel(seasons[idx + 1])} ›</a>` : ''}</nav>`;
	let body;
	if (!bracket) {
		body = `<p class="dim" style="text-align:center">No bracket for ${seasonLabel(season)}${season === 2020 ? ': the 2020 tournaments were cancelled' : ''}.</p>`;
	} else {
		const f = bracket.final;
		const champ = f.sides.find((s) => s.won);
		const other = f.sides.find((s) => !s.won);
		body = [
			champ ? `<p class="br-champ">${esc(team(champ.team).name)} beat ${esc(team(other.team).name)} ${champ.score}–${other.score} for the title</p>` : '',
			`<section class="record-card league-wide br-ff"><h2>${esc(finalTitle)}</h2>
${bracket.semis.length ? `<p class="br-label">National semifinals</p><div class="br-row">${bracket.semis.map(gameBox).join('')}</div>` : ''}
${bracket.semis.length ? '<p class="br-label">Championship</p>' : ''}<div class="br-row">${gameBox(f)}</div>
${bracket.third.length ? `<p class="br-label">Third place</p><div class="br-list">${bracket.third.filter((g) => g.stage === 'THIRD').map(looseBox).join('')}</div>` : ''}</section>`,
			...bracket.regions.map(region),
			bracket.firstFour.length ? `<section class="record-card league-wide br-ff"><h2>First Four</h2><div class="br-list">${bracket.firstFour.map(looseBox).join('')}</div></section>` : '',
			bracket.third.some((g) => g.stage === 'R3RD') ? `<section class="record-card league-wide br-ff"><h2>Regional third place</h2><div class="br-list">${bracket.third.filter((g) => g.stage === 'R3RD').map(looseBox).join('')}</div></section>` : '',
			bracket.unplaced.length ? `<section class="record-card league-wide br-ff"><h2>Other games</h2><p class="br-label">The record is missing the game that would place these in the bracket.</p><div class="br-list">${bracket.unplaced.map(looseBox).join('')}</div></section>` : '',
		].join('\n');
	}
	return page({
		title: heading,
		colors,
		body: [CSS, `<h1>${esc(heading)}</h1>`, tabs, nav, body, note ? `<p class="dim">${note}</p>` : '',
			bracket && summaryUrl ? summaryScript(summaryUrl) : '', footer].filter(Boolean).join('\n'),
	});
}

/** A game's summary, in a dialog over the bracket: the score by half, the
 *  two sides' numbers and leaders, from ESPN's summary (`url` + the game's
 *  id, through the site's ESPN cache), and ESPN's own page for the rest. */
function summaryScript(url) {
	return `<dialog id="br-sum" class="br-sum" aria-labelledby="br-sum-title"><div class="br-sum-head"><h2 id="br-sum-title">Game summary</h2>
<button type="button" class="br-sum-close" aria-label="Close"><i class="mdi mdi-close"></i></button></div><div id="br-sum-body"></div></dialog>
<script>(() => {
	const dlg = document.getElementById('br-sum');
	const body = document.getElementById('br-sum-body');
	const title = document.getElementById('br-sum-title');
	const URL_ = ${JSON.stringify(url)};
	const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	let opener = null;
	const STATS = [['FG', 'fieldGoalsMade-fieldGoalsAttempted'], ['3PT', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], ['FT', 'freeThrowsMade-freeThrowsAttempted'],
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
		const head = Array.from({ length: periods }, (_, i) => (i < 2 ? (i ? '2nd' : '1st') : (i === 2 ? 'OT' : (i - 1) + 'OT')));
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
			+ '<p><a href="https://www.espn.com/mens-college-basketball/game/_/gameId/' + encodeURIComponent(id) + '" target="_blank" rel="noopener noreferrer">Box score and play-by-play on ESPN</a></p>';
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
