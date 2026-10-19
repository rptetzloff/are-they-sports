// The playoff race and the postseason, for the season being played. Pure
// functions — no fetch/DOM — over ESPN's payloads, so both can be tested in
// October and in June alike.
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
					.filter((b) => (b.type?.shortName ?? 'TV') === 'TV')
					.flatMap((b) => b.names || (b.media?.shortName ? [b.media.shortName] : [])))],
			};
		});
}

/** The World Series' name ("World Series") once `team` has won it — four
 *  final wins in games whose note names the Series — else null. ESPN events,
 *  either the schedule's shape (score.value) or the scoreboard's (score). The
 *  home page and the server's share cards both ask; they had a copy each,
 *  and each was once fooled by a 1-0 lead (#57). */
export function worldSeriesTitle(events, team = TEAM) {
	let wins = 0;
	let name = null;
	for (const e of events || []) {
		const comp = e?.competitions?.[0];
		if (comp?.status?.type?.name !== 'STATUS_FINAL') continue;
		const note = (comp.notes || []).find((n) => /world series/i.test(n.headline || ''));
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
const NEXT = { T: 'the postseason', F: 'the Division Series', D: 'the LCS', L: 'the World Series', W: 'a World Series title' };
const leagueOf = (round) => (/^\s*A/i.test(round) ? 'AL' : /^\s*N/i.test(round) ? 'NL' : '');
const prize = (s) => {
	const lg = leagueOf(s.round);
	if (s.code === 'F' && lg) return `the ${lg}DS`;
	if (s.code === 'D' && lg) return `the ${lg}CS`;
	return NEXT[s.code] || 'the next round';
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The countdown under the scoreboard: how far from the next round, or how it
 *  ended. */
export function seriesCountdown(s) {
	if (s.state === 'won') return s.code === 'W' ? 'World Series champions!' : `Won the ${s.round} — on to ${prize(s)}`;
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

/** ESPN's league standings payload (`standings?group=8` for the NL) as flat
 *  rows: team, division, wins, losses, and ESPN's playoff seed. */
export function standingsRows(data) {
	const rows = [];
	for (const div of data?.children || []) {
		for (const e of div.standings?.entries || []) {
			const stat = (name) => e.stats?.find((s) => s.name === name)?.value;
			rows.push({
				abbr: e.team?.abbreviation,
				name: e.team?.shortDisplayName || e.team?.displayName,
				division: div.name,
				w: Number(stat('wins')) || 0,
				l: Number(stat('losses')) || 0,
				seed: Number(stat('playoffSeed')) || 99,
			});
		}
	}
	return rows;
}

/** Magic and elimination numbers for one team, from standings rows.
 *
 *  The standard formula: games in a season + 1, minus our wins, minus the
 *  rival's losses. It is computed here rather than read from ESPN because
 *  ESPN's own `magicNumberDivision` is only a magic number for a division
 *  leader — for everyone else it is games back plus one — and its wild-card
 *  figure is measured against a team its payload does not name.
 *
 *  Who is in a playoff position comes from ESPN's `playoffSeed` (1-6 in, 7+
 *  out), because seeding needs tiebreakers this does not attempt. Against
 *  the division, the rival that matters is the one with the fewest losses;
 *  for a playoff spot it is the best team currently out. A number at or
 *  below zero means clinched (magic) or eliminated (elimination).
 */
export function raceNumbers(rows, { team = TEAM, seasonGames = 162, spots = 6 } = {}) {
	const us = rows.find((r) => r.abbr === team);
	if (!us) return null;
	const target = seasonGames + 1;
	const divRivals = rows.filter((r) => r.division === us.division && r !== us);
	const leader = [...rows.filter((r) => r.division === us.division)].sort((a, b) => a.seed - b.seed)[0];
	const leadsDivision = leader === us;
	const inPosition = us.seed <= spots;
	const out = rows.filter((r) => r.seed > spots);
	const lastIn = rows.filter((r) => r.seed <= spots && r !== us).sort((a, b) => b.seed - a.seed)[0];
	const minL = (list) => Math.min(...list.map((r) => r.l));
	return {
		division: us.division,
		seed: us.seed,
		gamesLeft: seasonGames - us.w - us.l,
		leadsDivision,
		inPosition,
		divisionMagic: leadsDivision && divRivals.length ? target - us.w - minL(divRivals) : null,
		divisionElim: !leadsDivision ? target - leader.w - us.l : null,
		divisionBehind: !leadsDivision ? ((leader.w - us.w) + (us.l - leader.l)) / 2 : null,
		spotMagic: inPosition && out.length ? target - us.w - minL(out) : null,
		spotElim: !inPosition && lastIn ? target - lastIn.w - us.l : null,
		spotBehind: !inPosition && lastIn ? ((lastIn.w - us.w) + (us.l - lastIn.l)) / 2 : null,
	};
}

// When the race panel appears: the last stretch of the regular season, and
// only while there is something left to play for.
export const RACE_WINDOW_GAMES = 30;

const gb = (n) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`.replace(/^0½/, '½'));

/** The panel during the race, or null outside the window or once there is
 *  nothing left to chase. */
export function racePanelHtml(n) {
	if (!n || n.gamesLeft > RACE_WINDOW_GAMES || n.gamesLeft <= 0) return null;
	const divName = n.division.replace('National League ', 'NL ').replace('American League ', 'AL ');
	const lines = [];

	if (n.leadsDivision) {
		lines.push(n.divisionMagic <= 0
			? `Clinched the ${esc(divName)}`
			: `Magic number to win the ${esc(divName)}: <strong>${n.divisionMagic}</strong>`);
	} else if (n.divisionElim > 0) {
		lines.push(`${gb(n.divisionBehind)} back in the ${esc(divName)} · elimination number <strong>${n.divisionElim}</strong>`);
	}

	if (n.inPosition) {
		lines.push(n.spotMagic <= 0
			? 'Clinched a playoff spot'
			: `Magic number for a playoff spot: <strong>${n.spotMagic}</strong>`);
	} else if (n.spotElim > 0) {
		lines.push(`${gb(n.spotBehind)} out of the last wild card · elimination number <strong>${n.spotElim}</strong>`);
	}

	// Eliminated from both: the race is over, and the panel goes.
	if (!lines.length) return null;

	const tail = [n.inPosition ? `Currently the #${n.seed} seed` : null, `${plural(n.gamesLeft, 'game')} left`].filter(Boolean).join(' · ');
	return lines.map((l) => `<div class="po-line">${l}</div>`).join('') + `<div class="po-next">${tail}</div>`;
}

