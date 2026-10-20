// The playoff race and the postseason, for the season being played. Pure
// functions — no fetch/DOM — over ESPN's payloads, so both can be tested in
// October and in June alike.
//
// HOCKEY'S COPY, by way of basketball's (web/nba/playoff-core.js). Same shape
// and the same internal round codes — F, D, L, W in order — with the NHL's
// words: First Round, Second Round, Conference Final, Stanley Cup Final, East
// and West. The race differs in kind: it is counted in POINTS (two a win, one
// an overtime loss), over 82 games, and sixteen clubs get in — the top three
// of each division and the next two in each conference, the wild cards.
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

/** The Final's name ("Stanley Cup Final") once `team` has won it — four
 *  final wins in games whose note names it — else null. Called worldSeriesTitle
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
		const note = (comp.notes || []).find((n) => /\bstanley cup final\b/i.test(n.headline || ''));
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
const NEXT = { T: 'the playoffs', F: 'the second round', D: 'the conference final', L: 'the Stanley Cup Final', W: 'the Stanley Cup' };
// ESPN's notes name the conference first: "East 1st Round", "West Final".
const conferenceOf = (round) => (/^\s*East/i.test(round) ? 'East' : /^\s*West/i.test(round) ? 'West' : '');
const prize = (s) => {
	const conf = conferenceOf(s.round);
	if (s.code === 'F' && conf) return `the ${conf} 2nd Round`;
	if (s.code === 'D' && conf) return `the ${conf} Final`;
	return NEXT[s.code] || 'the next round';
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The countdown under the scoreboard: how far from the next round, or how it
 *  ended. */
export function seriesCountdown(s) {
	if (s.state === 'won') return s.code === 'W' ? 'Stanley Cup champions!' : `Won the ${s.round} — on to ${prize(s)}`;
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

/** ESPN's conference standings payload (`standings?group=7` for the East) as
 *  flat rows: team, division, the record and points. A conference group comes
 *  back with its two divisions as children. */
export function standingsRows(data) {
	const rows = [];
	const groups = data?.children?.length ? data.children : [{ name: data?.name ?? '', standings: data?.standings }];
	for (const div of groups) {
		for (const e of div.standings?.entries || []) {
			const stat = (name) => e.stats?.find((s) => s.name === name)?.value;
			const w = Number(stat('wins')) || 0;
			const l = Number(stat('losses')) || 0;
			const otl = Number(stat('otLosses')) || 0;
			rows.push({
				id: String(e.team?.id ?? ''),
				abbr: e.team?.abbreviation,
				name: e.team?.shortDisplayName || e.team?.displayName,
				division: div.name,
				w, l, otl,
				gp: Number(stat('gamesPlayed')) || w + l + otl,
				pts: Number(stat('points')) || 2 * w + otl,
				rw: Number(stat('regWins')) || 0,
				seed: Number(stat('playoffSeed')) || 99,
			});
		}
	}
	return rows;
}

/** Who is in, as the NHL decides it: the top three of each division, then the
 *  two best of the rest of the conference, the wild cards. Ranked by points,
 *  then by fewer games played (points percentage), then by regulation wins,
 *  then by ESPN's own seed, which knows the tiebreakers this does not.
 *
 *  Returns the conference's rows ranked, each with `spot`: 'div' (a top-three
 *  place), 'wc' (a wild card) or null (out). */
export function playoffPicture(rows, { perDivision = 3, wildCards = 2 } = {}) {
	const rank = (a, b) => b.pts - a.pts || a.gp - b.gp || b.rw - a.rw || a.seed - b.seed;
	const ranked = [...rows].sort(rank);
	const spot = new Map();
	for (const div of new Set(ranked.map((r) => r.division))) {
		for (const r of ranked.filter((x) => x.division === div).slice(0, perDivision)) spot.set(r, 'div');
	}
	for (const r of ranked.filter((x) => !spot.has(x)).slice(0, wildCards)) spot.set(r, 'wc');
	return ranked.map((r) => ({ ...r, spot: spot.get(r) ?? null }));
}

/** Magic and elimination numbers for one team, in points.
 *
 *  A club can reach at most its points plus two for every game left. The
 *  magic number for a playoff place is the points that, gained by us or
 *  denied to the best club outside, put us out of its reach: its most
 *  possible points, plus one, less ours. The elimination number is the same
 *  sum from the other side, against the last club in. At or below zero is
 *  clinched (magic) or eliminated (elimination).
 *
 *  Tiebreakers are not attempted, so "plus one" asks for strictly more points
 *  than the rival can reach, which is never early and is sometimes a point
 *  late. */
export function raceNumbers(rows, { team = TEAM, seasonGames = 82 } = {}) {
	const picture = playoffPicture(rows);
	const us = picture.find((r) => r.abbr === team);
	if (!us) return null;
	const left = (r) => Math.max(0, seasonGames - r.gp);
	const most = (r) => r.pts + 2 * left(r);
	const inPosition = us.spot !== null;
	const out = picture.filter((r) => r.spot === null);
	// The club a chaser has to pass: the last wild card. Not the lowest club in,
	// which can be a division's third with fewer points than clubs left out.
	const lastIn = picture.filter((r) => r.spot === 'wc' && r !== us).at(-1);
	const division = picture.filter((r) => r.division === us.division);
	const leader = division[0];
	const leadsDivision = leader === us;
	const divRival = division.find((r) => r !== us);
	return {
		division: us.division,
		spot: us.spot,
		points: us.pts,
		gamesLeft: left(us),
		leadsDivision,
		inPosition,
		divisionMagic: leadsDivision && divRival ? most(divRival) + 1 - us.pts : null,
		divisionBehind: !leadsDivision ? leader.pts - us.pts : null,
		spotMagic: inPosition && out.length ? Math.max(...out.map(most)) + 1 - us.pts : null,
		spotElim: !inPosition && lastIn ? most(us) + 1 - lastIn.pts : null,
		spotBehind: !inPosition && lastIn ? lastIn.pts - us.pts : null,
	};
}

// When the race panel appears: the last stretch of the regular season, and
// only while there is something left to play for.
export const RACE_WINDOW_GAMES = 30;

/** The panel during the race, or null outside the window or once there is
 *  nothing left to chase. */
export function racePanelHtml(n) {
	if (!n || n.gamesLeft > RACE_WINDOW_GAMES || n.gamesLeft <= 0) return null;
	const lines = [];
	const divName = esc(String(n.division || '').replace(/ Division$/, ''));

	if (n.leadsDivision && n.divisionMagic !== null) {
		lines.push(n.divisionMagic <= 0
			? `Clinched the ${divName}`
			: `Magic number to win the ${divName}: <strong>${n.divisionMagic}</strong>`);
	} else if (n.divisionBehind !== null && n.divisionBehind > 0) {
		lines.push(`${plural(n.divisionBehind, 'point')} behind the ${divName} leader`);
	}
	if (n.inPosition) {
		lines.push(n.spotMagic <= 0
			? 'Clinched a playoff spot'
			: `Magic number for a playoff spot: <strong>${n.spotMagic}</strong>`);
	} else if (n.spotElim > 0) {
		lines.push(`${plural(n.spotBehind, 'point')} out of the last wild card · elimination number <strong>${n.spotElim}</strong>`);
	}

	// Eliminated, and nothing else to say: the race is over, and the panel goes.
	if (!n.inPosition && !(n.spotElim > 0)) return null;
	if (!lines.length) return null;

	const where = n.spot === 'div' ? `Top three in the ${divName}` : n.spot === 'wc' ? 'In a wild card spot' : null;
	const tail = [where, plural(n.points, 'point'), `${plural(n.gamesLeft, 'game')} left`].filter(Boolean).join(' · ');
	return lines.map((l) => `<div class="po-line">${l}</div>`).join('') + `<div class="po-next">${tail}</div>`;
}

