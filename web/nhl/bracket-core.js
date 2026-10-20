// The whole postseason bracket, for the season being played: every series in
// both leagues, from ESPN's daily scoreboards. Pure functions — no fetch/DOM —
// shared by the server (which boils a month of scoreboards down to the games,
// /api/bracket) and the home page (which draws them).
//
// ESPN has no bracket endpoint the site can use, and its scoreboard takes one
// day at a time, so the server reads the postseason a day at a time. Each
// game's note names its round and number ("ALCS - Game 5", "ALCS - Game 7 If
// Necessary"); a series is the games of one round between the same two teams.
//
// HOCKEY'S COPY, by way of basketball's (web/nba/bracket-core.js): the same
// shape, two conferences of four first-round series, two second-round series
// and a conference final each, then the Stanley Cup Final. ESPN's notes name
// the conference first ("East 1st Round - Game 4", "West 2nd Round - Game 5",
// "West Final - Game 4"), and every round is best of seven.

import { roundCodeOf, esc } from './records-core.js';

const WINS_NEEDED = { T: 1, F: 4, D: 4, L: 4, W: 4 };

const leagueOf = (round) => (/^\s*East/i.test(round) ? 'East' : /^\s*West/i.test(round) ? 'West' : '');

/** ESPN scoreboard events as the bracket's games: postseason only, without
 *  postponed or canceled ones (the makeup is its own event). */
export function bracketGames(events) {
	const out = [];
	for (const event of events || []) {
		if (event?.season?.type !== 3) continue;
		const comp = event.competitions?.[0];
		const status = comp?.status?.type || {};
		if (/POSTPONED|CANCELED|SUSPENDED/.test(status.name || '')) continue;
		const note = comp?.notes?.[0]?.headline || '';
		const [round = '', rest = ''] = note.split(' - ');
		const code = roundCodeOf(round);
		const teams = (comp?.competitors || []).map((c) => ({
			id: String(c.id),
			abbr: c.team?.abbreviation || '',
			name: c.team?.shortDisplayName || c.team?.displayName || '',
			home: c.homeAway === 'home',
			score: c.score == null || c.score === '' ? null : Number(c.score),
			winner: c.winner === true,
		}));
		if (!code || teams.length !== 2 || teams.some((t) => !t.abbr)) continue;
		out.push({
			id: String(event.id),
			round: round.trim(),
			code,
			league: code === 'W' ? '' : leagueOf(round),
			n: Number((rest.match(/Game (\d+)/i) || [])[1]) || null,
			ifNecessary: /if necessary/i.test(rest),
			date: event.date,
			state: status.state || 'pre',
			final: status.completed === true,
			detail: status.shortDetail || status.detail || '',
			teams,
		});
	}
	return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** The games as series, oldest round first. Each lists its two teams — the
 *  one at home in the first game first, which is the higher seed — with the
 *  wins each has from finished games, and whether it is over. */
export function bracketSeries(games) {
	const byKey = new Map();
	for (const g of games) {
		const key = `${g.code}|${g.league}|${g.teams.map((t) => t.id).sort().join('-')}`;
		if (!byKey.has(key)) {
			const ordered = [...g.teams].sort((a, b) => b.home - a.home);
			byKey.set(key, {
				code: g.code,
				league: g.league,
				round: g.round,
				need: WINS_NEEDED[g.code],
				teams: ordered.map(({ id, abbr, name }) => ({ id, abbr, name, wins: 0 })),
				games: [],
			});
		}
		const s = byKey.get(key);
		s.games.push(g);
		if (g.final) {
			const won = g.teams.find((t) => t.winner);
			const t = won && s.teams.find((x) => x.id === won.id);
			if (t) t.wins++;
		}
	}
	return [...byKey.values()].map((s) => {
		const champ = s.teams.find((t) => t.wins >= s.need);
		const live = s.games.find((g) => g.state === 'in') || null;
		// The next game is the first not played; one "if necessary" is only
		// next if the series is still undecided, which `champ` settles.
		const next = champ ? null : live || s.games.find((g) => !g.final && g.state === 'pre') || null;
		return { ...s, winner: champ?.id ?? null, live, next };
	});
}

/** The series placed in a bracket: per league, rows of a wild-card series and
 *  the division series its winner went to (a bye team's side has no wild
 *  card), then the league's LCS; and the World Series between the leagues.
 *  Missing pieces are null: before the division series, a wild card's row has
 *  no division series yet; before the LCS, the league has none. */
export function bracketLayout(series) {
	// Per conference: the first round in pairs, each pair beside the semifinal
	// its two winners met in. Pairs are read from who advanced, not from seeds,
	// so a first round still being played lists its series in schedule order
	// and pairs them as they finish.
	const conference = (lg) => {
		const of = (code) => series.filter((s) => s.code === code && s.league === lg);
		const r1 = of('F');
		const semis = of('D');
		const pairs = semis.map((sf) => ({
			feeders: r1.filter((r) => r.winner && sf.teams.some((t) => t.id === r.winner)),
			semi: sf,
		}));
		const placed = new Set(pairs.flatMap((pr) => pr.feeders));
		const rest = r1.filter((r) => !placed.has(r));
		while (rest.length) pairs.push({ feeders: rest.splice(0, 2), semi: null });
		return { pairs, cf: of('L')[0] || null };
	};
	return { East: conference('East'), West: conference('West'), ws: series.find((s) => s.code === 'W') || null };
}

const teamOf = (s, id) => s?.teams.find((t) => t.id === id) || null;
const leader = (s) => {
	const [a, b] = s.teams;
	return a.wins === b.wins ? null : a.wins > b.wins ? a : b;
};

/** "Rays lead 3-2", "Series tied 2-2", "Guardians won 4-2". */
export function seriesStatus(s) {
	const [a, b] = s.teams;
	const hi = Math.max(a.wins, b.wins);
	const lo = Math.min(a.wins, b.wins);
	if (s.winner) return `${teamOf(s, s.winner).name} won ${hi}-${lo}`;
	const lead = leader(s);
	if (!lead) return a.wins === 0 && !s.games.some((g) => g.final) ? 'Series starts' : `Series tied ${hi}-${lo}`;
	// Every nickname is plural, Red Sox and White Sox included.
	return `${lead.name} lead ${hi}-${lo}`;
}

const gameLabel = (g) => [g.n ? `Game ${g.n}` : '', g.ifNecessary ? '(if necessary)' : ''].filter(Boolean).join(' ');

const whenText = (iso, now) => {
	const d = new Date(iso);
	const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	if (d.toDateString() === now.toDateString()) return `Today ${time}`;
	return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
};

/** A live game's score, away first: "TB 3, CLE 1 · Bot 7th". */
const liveScore = (g) => {
	const [away, home] = [...g.teams].sort((a, b) => a.home - b.home);
	return `${away.abbr} ${away.score ?? 0}, ${home.abbr} ${home.score ?? 0} · ${g.detail}`;
};

/** The series whose winner `team` meets next: the other conference's final
 *  while `team` is in its own or has won it and waits for the Stanley Cup
 *  Final; the other second-round series of its conference while it plays one. Null otherwise — in
 *  the first round (the pairing is the bracket's, which ESPN does not say),
 *  out, or in the Finals already. */
export function nextOpponentSeries(series, team) {
	const ours = series.filter((s) => s.teams.some((t) => t.abbr === team));
	const cur = ours[ours.length - 1];
	if (!cur || cur.code === 'W' || series.some((s) => s.code === 'W' && s.teams.some((t) => t.abbr === team))) return null;
	const us = cur.teams.find((t) => t.abbr === team);
	if (cur.winner && cur.winner !== us.id) return null;
	if (cur.code === 'L') return series.find((s) => s.code === 'L' && s.league && s.league !== cur.league) || null;
	if (cur.code === 'D' && !cur.winner) return series.find((s) => s.code === 'D' && s.league === cur.league && s !== cur) || null;
	return null;
}

/** The line on the home page that follows the series deciding who the team
 *  plays next: its standing, then its live game's score or when the next one
 *  is. */
export function opponentTrackerHtml(series, team, { now = new Date() } = {}) {
	const s = nextOpponentSeries(series, team);
	if (!s) return null;
	const ours = series.filter((x) => x.teams.some((t) => t.abbr === team));
	const cur = ours[ours.length - 1];
	// Both sides decided: the next series is set, and the team's own panel
	// already names the opponent ("World Series vs Rays").
	if (s.winner && cur.winner) return null;
	const nextRound = cur.code === 'L' ? 'Stanley Cup Final' : `${cur.league} Final`;
	const title = s.winner ? `${nextRound} opponent` : `${nextRound} opponent: winner of the ${s.round}`;
	const rows = s.teams.map((t) =>
		`<div class="po-row${s.winner && s.winner !== t.id ? ' po-out' : ''}"><span class="po-team">${esc(t.name)}</span>` +
		`<span class="po-pips">${Array.from({ length: s.need }, (_, i) => `<span class="po-pip${i < t.wins ? ' on other' : ''}"></span>`).join('')}</span>` +
		`<span class="po-wins">${t.wins}</span></div>`).join('');
	let next = '';
	const g = s.live || s.next;
	// The live game links to ESPN's page for it, as the schedule's rows do.
	if (s.live) {
		next = `${esc(gameLabel(g))} · <span class="live-indicator-small"></span>Live · ${esc(liveScore(g))}` +
			` · <a class="po-espn" href="https://www.espn.com/nhl/game/_/gameId/${encodeURIComponent(g.id)}" target="_blank" rel="noopener">ESPN</a>`;
	}
	else if (g) next = `${esc(gameLabel(g))} · ${esc(whenText(g.date, now))}`;
	return `<div class="po-tracker">` +
		`<div class="po-tracker-head">${esc(title)}</div>` +
		`<div class="po-board" role="img" aria-label="${esc(`${s.round}: ${seriesStatus(s)}`)}">${rows}</div>` +
		`<div class="po-tracker-status">${esc(seriesStatus(s))}</div>` +
		(next ? `<div class="po-next">${next}</div>` : '') +
		`</div>`;
}

/** One series in the bracket: its two teams and wins, the winner marked, the
 *  team's own side in gold, and a live game's score under it. */
function cellHtml(s, team, { placeholder = '' } = {}) {
	if (!s) return placeholder ? `<div class="bk-s bk-tbd">${esc(placeholder)}</div>` : '';
	const rows = s.teams.map((t) => {
		const cls = ['bk-t', s.winner === t.id ? 'bk-won' : s.winner ? 'bk-lost' : '', t.abbr === team ? 'bk-us' : ''].filter(Boolean).join(' ');
		return `<div class="${cls}" title="${esc(t.name)}"><span class="bk-abbr">${esc(t.abbr)}</span><span class="bk-w">${t.wins}</span></div>`;
	}).join('');
	const live = s.live ? `<div class="bk-live"><span class="live-indicator-small"></span>${esc(s.live.detail)}</div>` : '';
	return `<div class="bk-s${s.live ? ' bk-on' : ''}" aria-label="${esc(`${s.round}: ${seriesStatus(s)}`)}">${rows}${live}</div>`;
}

/** The bracket: each conference's first round, semifinals and final in
 *  columns, the Stanley Cup Final between them. Null before any postseason game. */
export function bracketHtml(series, team) {
	if (!series.length) return null;
	const lay = bracketLayout(series);
	const conferenceHtml = (lg) => {
		const { pairs, cf } = lay[lg];
		if (!pairs.length && !cf) return '';
		let row = 2;
		const cells = pairs.map((pr) => {
			const top = row;
			row += 2;
			return [0, 1].map((i) =>
				`<div class="bk-cell" style="grid-row:${top + i};grid-column:1">${cellHtml(pr.feeders[i], team, { placeholder: pr.feeders.length ? 'TBD' : '' })}</div>`).join('')
				+ `<div class="bk-cell" style="grid-row:${top} / span 2;grid-column:2">${cellHtml(pr.semi, team, { placeholder: 'TBD' })}</div>`;
		}).join('');
		const n = Math.max(row - 2, 1);
		const cfCell = `<div class="bk-cell bk-final" style="grid-row:2 / span ${n};grid-column:3">${cellHtml(cf, team, { placeholder: 'TBD' })}</div>`;
		const heads = ['R1', 'R2', 'Final'].map((h, i) => `<div class="bk-col" style="grid-column:${i + 1}">${lg} ${h}</div>`).join('');
		return `<section class="bk-league" aria-label="${lg}">${heads}${cells}${cfCell}</section>`;
	};
	// Until the Final is on the schedule, its two sides are the conference
	// champions so far.
	let ws;
	if (lay.ws) ws = cellHtml(lay.ws, team);
	else {
		const side = (cf) => {
			const t = cf?.winner ? teamOf(cf, cf.winner) : null;
			return `<div class="bk-t${t?.abbr === team ? ' bk-us' : ''}"${t ? ` title="${esc(t.name)}"` : ''}><span class="bk-abbr">${esc(t?.abbr || 'TBD')}</span></div>`;
		};
		ws = `<div class="bk-s">${side(lay.East.cf)}${side(lay.West.cf)}</div>`;
	}
	return `<div class="bk">${conferenceHtml('East')}<section class="bk-ws" aria-label="Stanley Cup Final"><div class="bk-col">Stanley Cup Final</div>${ws}</section>${conferenceHtml('West')}</div>`;
}

/** How long until the bracket is worth fetching again: a minute while a game
 *  is on, five while one is past its start but not begun, else until the
 *  next one starts (a minute early), at most an hour. */
export function bracketRefreshMs(series, now = Date.now()) {
	const MIN = 60 * 1000;
	const HOUR = 60 * MIN;
	if (series.some((s) => s.live)) return MIN;
	const starts = series.map((s) => s.next && Date.parse(s.next.date)).filter(Boolean);
	// Past its start and not begun: a delay. Look again soon.
	if (starts.some((t) => t <= now)) return 5 * MIN;
	if (!starts.length) return HOUR;
	return Math.min(HOUR, Math.max(MIN, Math.min(...starts) - now - MIN));
}

