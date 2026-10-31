// The live card's detail for a hockey game, boiled down from ESPN's game
// summary by the server's /api/live/:id, and drawn by the page under the game
// in progress.
//
// HOCKEY'S counterpart of the baseball site's live-core.js, by way of
// basketball's, with the same exports so main.js needs no branch: liveDetail on
// the server, liveDetailHtml in the page, and the baseball-only helpers
// (probable starters, scoring plays) as empty answers. What a hockey game in
// progress is worth showing: the score by period, the clock, each side's
// leading scorer in points, the last play.
//
// Pure: no fetch, no DOM.

import { esc } from './records-core.js';

/** A column's name: three periods, then overtime; a regular-season game's
 *  fifth column is the shootout, a playoff game's the second overtime. */
export const periodName = (i, { regular = true } = {}) =>
	(i < 3 ? `P${i + 1}` : i === 3 ? 'OT' : i === 4 && regular ? 'SO' : `${i - 2}OT`);

/** The detail the page draws, from an ESPN NHL summary, or null. */
export function liveDetail(summary) {
	const comp = summary?.header?.competitions?.[0];
	if (!comp) return null;
	const status = comp.status?.type ?? {};
	const leaderOf = (abbr) => {
		const team = (summary.leaders || []).find((t) => t.team?.abbreviation === abbr);
		const cat = (team?.leaders || []).find((c) => c.name === 'points');
		const best = cat?.leaders?.[0];
		return best ? { name: best.athlete?.shortName || best.athlete?.displayName || '', line: best.displayValue ? `${best.displayValue} PTS` : '' } : null;
	};
	const teams = (comp.competitors || []).map((c) => ({
		id: String(c.team?.id ?? c.id ?? ''),
		abbr: c.team?.abbreviation ?? '',
		homeAway: c.homeAway,
		score: c.score === undefined || c.score === '' ? null : Number(c.score),
		periods: (c.linescores || []).map((l) => String(l.displayValue ?? l.value ?? '')),
		leader: leaderOf(c.team?.abbreviation),
	}));
	const plays = summary.plays || [];
	const last = plays[plays.length - 1];
	return {
		id: String(summary.header?.id ?? ''),
		state: status.state ?? 'pre',
		detail: status.detail || status.shortDetail || '',
		// ESPN's season type: 2 the regular season, 3 the playoffs.
		regular: (summary.header?.season?.type ?? 2) !== 3,
		teams,
		// Hockey has no situation in the baseball sense; the page's situation
		// helpers answer nothing for null.
		situation: null,
		lastPlay: last ? { text: last.text || '', clock: last.clock?.displayValue || '', period: last.period?.displayValue || '' } : null,
	};
}

/** The card's detail block: the periods, the leaders, the last play. */
export function liveDetailHtml(d) {
	if (!d || d.state !== 'in') return '';
	const away = d.teams.find((t) => t.homeAway === 'away');
	const home = d.teams.find((t) => t.homeAway === 'home');
	if (!away || !home) return '';
	const n = Math.max(3, away.periods.length, home.periods.length);
	const head = Array.from({ length: n }, (_, i) => `<span class="live-inning">${periodName(i, { regular: d.regular })}</span>`).join(' ');
	const row = (t) => `<div class="live-row"><span class="live-team">${esc(t.abbr)}</span> `
		+ Array.from({ length: n }, (_, i) => `<span class="live-stats">${esc(t.periods[i] ?? '')}</span>`).join(' ')
		+ (t.leader ? ` <span class="live-role">Leader</span> <strong>${esc(t.leader.name)}</strong> <span class="live-stats">${esc(t.leader.line)}</span>` : '')
		+ '</div>';
	const parts = [`<div class="live-matchup"><div class="live-row live-other">${head}</div>${row(away)}${row(home)}</div>`];
	if (d.lastPlay?.text) {
		const when = [d.lastPlay.period, d.lastPlay.clock].filter(Boolean).join(' ');
		parts.push(`<div class="live-note">${when ? `${esc(when)} · ` : ''}${esc(d.lastPlay.text)}</div>`);
	}
	return parts.join('');
}

/** Baseball's probable starters; a hockey game's would be its goalies, which
 *  the schedule does not name. */
export const probableStarters = () => [];
export const probablesHtml = () => '';
/** Baseball's run-scoring plays. */
export const scoringPlays = () => [];
export const scoringPlaysHtml = () => '';
