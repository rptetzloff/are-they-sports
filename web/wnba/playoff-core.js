// The playoff race and the postseason, for the season being played. Pure
// functions — no fetch/DOM — over ESPN's payloads, so both can be tested in
// October and in June alike.
//
// THE WNBA'S COPY, by way of basketball's (web/nba/playoff-core.js). Same
// shape and the same internal round codes — F, D, L, W in order — with the
// WNBA's words: First Round, Semifinals, WNBA Finals. The race differs: a
// 44-game season and the best eight overall in, whatever the conference, so
// the seeds are the league's, not ESPN's per-conference ones.
//
// Two modes, one panel:
//   race       — the last stretch of the regular season: magic numbers.
//   postseason — once a playoff game is on the schedule: the series.

import { postseasonSeries, seriesText, esc } from './records-core.js';
import { SITE } from './site.js';

const TEAM = SITE.espnAbbr;

// ---------------------------------------------------------------- postseason

/** ESPN schedule events (seasontype=3) as the games postseasonSeries reads,
 *  in date order. The extra fields are what the panel needs for the next
 *  game: its number in the series, whether it is "If Necessary", when, where
 *  to watch, and the live status line. */
export function espnPostseasonGames(events, team = TEAM) {
	return [...(events || [])]
		.sort((a, b) => new Date(a.date) - new Date(b.date))
		.map((event) => {
			const comp = event.competitions?.[0];
			const note = comp?.notes?.[0]?.headline || 'Postseason';
			const [round, rest = ''] = note.split(' - ');
			const us = comp?.competitors?.find((c) => c.team?.abbreviation === team);
			const them = comp?.competitors?.find((c) => c.team?.abbreviation !== team)?.team;
			const status = comp?.status?.type || {};
			const final = status.name === 'STATUS_FINAL';
			return {
				round: round.trim(),
				opponent: them?.shortDisplayName || them?.displayName || 'TBD',
				opponentAbbr: them?.abbreviation || '',
				opponentNick: them?.shortDisplayName || them?.displayName || 'TBD',
				result: !final ? null : us?.winner ? 'WIN' : 'LOSS',
				game: (rest.match(/Game \d+/i) || [''])[0],
				ifNecessary: /if necessary/i.test(rest),
				date: new Date(event.date),
				state: status.state || 'pre',
				detail: status.detail || status.shortDetail || '',
				// The schedule lists radio too; the scoreboard's shape has `names`.
				networks: [...new Set((comp?.broadcasts || [])
					.filter((b) => (b.type?.shortName ?? 'TV').toUpperCase() === 'TV')
					.flatMap((b) => b.names || (b.media?.shortName ? [b.media.shortName] : [])))],
			};
		});
}

/** The Finals' name ("WNBA Finals") once `team` has won them — four final wins
 *  in games whose note names the Finals — else null. Called worldSeriesTitle
 *  still, because main.js imports it by that name from either sport's copy. ESPN events,
 *  either the schedule's shape (score.value) or the scoreboard's (score). The
 *  home page and the server's share cards both ask; they had a copy each,
 *  and each was once fooled by a 1-0 lead (#57). */
export function worldSeriesTitle(events, team = TEAM) {
	let wins = 0;
	let name = null;
	for (const e of events || []) {
		const comp = e?.competitions?.[0];
		if (comp?.status?.type?.name !== 'STATUS_FINAL') continue;
		const note = (comp.notes || []).find((n) => /\bwnba finals\b/i.test(n.headline || ''));
		if (!note) continue;
		let us = 0;
		let them = 0;
		for (const c of comp.competitors || []) {
			const s = parseInt(c.score?.value ?? c.score ?? 0, 10) || 0;
			if (c.team?.abbreviation === team) us = s;
			else them = s;
		}
		name = name || note.headline.split(' - ')[0].trim();
		if (us > them) wins++;
	}
	return wins >= 4 ? name : null;
}

/** The headline banner every page carries while the season being played is a
 *  title season: "2026 World Series Champions", linking to that season. From
 *  the server's season state (lib/seasons.js); '' for any other state. */
export function titleBannerHtml(state) {
	if (state?.kind !== 'champions' || !state.season) return '';
	const yr = esc(String(state.season));
	return `<a class="title-banner" href="${yr}"><span aria-hidden="true">🏆</span> ${yr} ${esc(SITE.championship)} Champions <span aria-hidden="true">🏆</span></a>`;
}

/** A page with the banner as the first thing in its body. Found by indexOf,
 *  not a regex: CodeQL flagged /<body([^>]*)>/ as slow on a page full of
 *  "<body=" with no ">" (a regex scan from each one to the end). */
export function withTitleBanner(html, banner) {
	if (!banner) return html;
	const open = html.indexOf('<body');
	const close = open === -1 ? -1 : html.indexOf('>', open);
	if (close === -1) return html;
	return `${html.slice(0, close + 1)}\n${banner}${html.slice(close + 1)}`;
}

// What winning each round earns.
const NEXT = { T: 'the playoffs', F: 'the semifinals', D: 'the semifinals', L: 'the WNBA Finals', W: 'a WNBA title' };
const prize = (s) => NEXT[s.code] || 'the next round';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The countdown under the scoreboard: how far from the next round, or how it
 *  ended. */
export function seriesCountdown(s) {
	if (s.state === 'won') return s.code === 'W' ? 'WNBA champions!' : `Won the ${s.round} — on to ${prize(s)}`;
	if (s.state === 'lost') return `Season over — lost the ${s.round} to the ${s.opponent}, ${s.w}-${s.l}`;
	if (!s.need) return null;
	const left = s.need - s.w;
	return `${plural(left, 'win')} from ${prize(s)}`;
}

/** The next game of a series still being played: the live one, else the
 *  earliest not yet final. */
export const nextSeriesGame = (s) =>
	s.games.find((g) => g.state === 'in') || s.games.find((g) => g.result === null && g.state !== 'post') || null;

const pips = (n, of, cls) =>
	Array.from({ length: of }, (_, i) => `<span class="po-pip${i < n ? ` on ${cls}` : ''}"></span>`).join('');

const whenText = (d, now) => {
	const sameDay = d.toDateString() === now.toDateString();
	const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	if (sameDay) return `Today ${time}`;
	return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
};

const bestOf = (need) => (need === 1 ? 'One game' : need ? `Best of ${need * 2 - 1}` : '');

/** One series as a scoreboard: a row of pips per team, filled to its wins,
 *  as many as the wins the series needed. */
function boardHtml(s, team) {
	if (!s.need) return '';
	const them = s.games[0]?.opponentNick || s.opponent;
	return `<div class="po-board" role="img" aria-label="${esc(`${team} ${s.w}, ${them} ${s.l}, first to ${s.need}`)}">` +
		`<div class="po-row"><span class="po-team">${esc(team)}</span><span class="po-pips">${pips(s.w, s.need, 'us')}</span><span class="po-wins">${s.w}</span></div>` +
		`<div class="po-row"><span class="po-team">${esc(them)}</span><span class="po-pips">${pips(s.l, s.need, 'them')}</span><span class="po-wins">${s.l}</span></div>` +
		`</div>`;
}

const headHtml = (s, extra = '') =>
	`<div class="po-head"><span class="po-round">${esc(s.round)}</span> vs ${esc(s.opponent)}` +
	`${bestOf(s.need) ? ` <span class="po-best">${bestOf(s.need)}</span>` : ''}${extra}</div>`;

/** The postseason panel. `games` from espnPostseasonGames for the season
 *  being played, or a past season's games with `settled`. The latest series
 *  is on top with its countdown and next game; the ones before it follow,
 *  each with its own scoreboard. Returns null with no postseason games. */
export function postseasonPanelHtml(games, { now = new Date(), team = SITE.team, settled = false } = {}) {
	const series = postseasonSeries(games, { settled });
	if (!series.length) return null;
	const cur = series[series.length - 1];
	const earlier = series.slice(0, -1).reverse();

	let html = headHtml(cur) + boardHtml(cur, team);
	const countdown = seriesCountdown(cur);
	if (countdown) html += `<div class="po-countdown">${esc(countdown)}</div>`;

	if (cur.state !== 'won' && cur.state !== 'lost') {
		const next = nextSeriesGame(cur);
		if (next) {
			const label = [next.game, next.ifNecessary ? '(if necessary)' : ''].filter(Boolean).join(' ');
			const when = next.state === 'in' ? `<span class="live-indicator-small"></span>Live · ${esc(next.detail)}` : esc(whenText(next.date, now));
			const tv = next.networks?.length ? ` · ${esc(next.networks.join(', '))}` : '';
			html += `<div class="po-next">${label ? `${esc(label)} · ` : ''}${when}${tv}</div>`;
		}
	}

	for (const s of earlier) {
		html += `<div class="po-earlier">${headHtml(s, ` <span class="po-result po-${s.state}">${s.state} ${s.w}-${s.l}</span>`)}${boardHtml(s, team)}</div>`;
	}
	return html;
}

/** The current series as plain text for the history page, e.g. "NLCS vs
 *  Dodgers: tied 0-0", and its round code for the chart marker. */
export function currentPostseasonStatus(games) {
	const series = postseasonSeries(games);
	if (!series.length) return null;
	const cur = series[series.length - 1];
	return { code: cur.code, text: seriesText(cur) };
}

// ---------------------------------------------------------------------- race

/** ESPN's WNBA standings payload as flat rows: team, conference, wins, losses.
 *  The conferences come back as children, each with its own standings. */
export function standingsRows(data) {
	const rows = [];
	const groups = data?.children?.length ? data.children : [{ name: data?.name ?? '', standings: data?.standings }];
	for (const conf of groups) {
		for (const e of conf.standings?.entries || []) {
			const stat = (name) => e.stats?.find((s) => s.name === name)?.value;
			rows.push({
				id: String(e.team?.id ?? ''),
				abbr: e.team?.abbreviation,
				name: e.team?.shortDisplayName || e.team?.displayName,
				division: conf.name,
				w: Number(stat('wins')) || 0,
				l: Number(stat('losses')) || 0,
				espnSeed: Number(stat('playoffSeed')) || 99,
			});
		}
	}
	return rows;
}

/** The league's seeds: every club ranked by winning percentage, whatever its
 *  conference, as the WNBA's playoffs take the best eight. ESPN's own seed is
 *  per conference and breaks ties within one; it is used here only for that. */
export function leagueSeeds(rows) {
	const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : 0);
	return [...rows]
		.sort((a, b) => pct(b) - pct(a) || b.w - a.w || a.espnSeed - b.espnSeed)
		.map((r, i) => ({ ...r, seed: i + 1 }));
}

/** Magic and elimination numbers for one team, from standings rows.
 *
 *  The standard formula: games in a season + 1, minus our wins, minus the
 *  rival's losses. Who is in comes from the league's seeds (leagueSeeds): the
 *  best eight. For a playoff spot the rival is the best club out; for a club
 *  out, the last club in. A number at or below zero means clinched (magic) or
 *  eliminated (elimination).
 */
export function raceNumbers(rows, { team = TEAM, seasonGames = 44, spots = 8 } = {}) {
	const seeded = leagueSeeds(rows);
	const us = seeded.find((r) => r.abbr === team);
	if (!us) return null;
	const target = seasonGames + 1;
	const inPosition = us.seed <= spots;
	const out = seeded.filter((r) => r.seed > spots);
	const lastIn = seeded.filter((r) => r.seed <= spots && r !== us).at(-1);
	const minL = (list) => Math.min(...list.map((r) => r.l));
	return {
		seed: us.seed,
		gamesLeft: seasonGames - us.w - us.l,
		inPosition,
		spotMagic: inPosition && out.length ? target - us.w - minL(out) : null,
		spotElim: !inPosition && lastIn ? target - lastIn.w - us.l : null,
		spotBehind: !inPosition && lastIn ? ((lastIn.w - us.w) + (us.l - lastIn.l)) / 2 : null,
	};
}

// When the race panel appears: the last stretch of the regular season, and
// only while there is something left to play for.
export const RACE_WINDOW_GAMES = 15;

const gb = (n) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`.replace(/^0½/, '½'));

/** The panel during the race, or null outside the window or once there is
 *  nothing left to chase. */
export function racePanelHtml(n) {
	if (!n || n.gamesLeft > RACE_WINDOW_GAMES || n.gamesLeft <= 0) return null;
	const lines = [];
	if (n.inPosition) {
		lines.push(n.spotMagic <= 0
			? 'Clinched a playoff spot'
			: `Magic number for a playoff spot: <strong>${n.spotMagic}</strong>`);
	} else if (n.spotElim > 0) {
		lines.push(`${gb(n.spotBehind)} out of the eighth seed · elimination number <strong>${n.spotElim}</strong>`);
	}
	if (!lines.length) return null;
	const tail = [n.inPosition ? `Currently the #${n.seed} seed` : null, `${plural(n.gamesLeft, 'game')} left`].filter(Boolean).join(' · ');
	return lines.map((l) => `<div class="po-line">${l}</div>`).join('') + `<div class="po-next">${tail}</div>`;
}

