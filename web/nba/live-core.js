// The live card's detail for a basketball game, boiled down from ESPN's game
// summary (half a megabyte or more) by the server's /api/live/:id, and drawn by
// the page under the game in progress.
//
// BASKETBALL'S counterpart of the baseball site's live-core.js, with the same
// exports so main.js needs no branch: liveDetail on the server, liveDetailHtml
// in the page, and the baseball-only helpers (probable starters, scoring plays)
// as empty answers. What a basketball game in progress is worth showing: the
// score by quarter, the clock, each side's leading scorer, the last play.
//
// Pure: no fetch, no DOM.

import { esc } from './records-core.js';

const periodName = (i) => (i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `OT${i - 3}`);

/** The detail the page draws, from an ESPN NBA summary, or null. */
export function liveDetail(summary) {
	const comp = summary?.header?.competitions?.[0];
	if (!comp) return null;
	const status = comp.status?.type ?? {};
	const leaderOf = (abbr) => {
		const team = (summary.leaders || []).find((t) => t.team?.abbreviation === abbr);
		const cat = (team?.leaders || []).find((c) => c.name === 'points');
		const best = cat?.leaders?.[0];
		return best ? { name: best.athlete?.shortName || best.athlete?.displayName || '', line: best.displayValue || '' } : null;
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
		teams,
		// Basketball has no situation in the baseball sense; the page's
		// situation helpers answer nothing for null.
		situation: null,
		lastPlay: last ? { text: last.text || '', clock: last.clock?.displayValue || '', period: last.period?.number ?? null } : null,
	};
}

/** The card's detail block: the quarters, the leaders, the last play. */
export function liveDetailHtml(d) {
	if (!d || d.state !== 'in') return '';
	const away = d.teams.find((t) => t.homeAway === 'away');
	const home = d.teams.find((t) => t.homeAway === 'home');
	if (!away || !home) return '';
	const n = Math.max(4, away.periods.length, home.periods.length);
	const head = Array.from({ length: n }, (_, i) => `<span class="live-inning">${periodName(i)}</span>`).join(' ');
	const row = (t) => `<div class="live-row"><span class="live-team">${esc(t.abbr)}</span> `
		+ Array.from({ length: n }, (_, i) => `<span class="live-stats">${esc(t.periods[i] ?? '')}</span>`).join(' ')
		+ (t.leader ? ` <span class="live-role">Leader</span> <strong>${esc(t.leader.name)}</strong> <span class="live-stats">${esc(t.leader.line)}</span>` : '')
		+ '</div>';
	const parts = [`<div class="live-matchup"><div class="live-row live-other">${head}</div>${row(away)}${row(home)}</div>`];
	if (d.lastPlay?.text) {
		const when = [d.lastPlay.period ? periodName(d.lastPlay.period - 1) : '', d.lastPlay.clock].filter(Boolean).join(' ');
		parts.push(`<div class="live-note">${when ? `${esc(when)} · ` : ''}${esc(d.lastPlay.text)}</div>`);
	}
	return parts.join('');
}

/** Baseball's probable starters; a basketball game has none. */
export const probableStarters = () => [];
export const probablesHtml = () => '';
/** Baseball's run-scoring plays; basketball's would be every basket. */
export const scoringPlays = () => [];
export const scoringPlaysHtml = () => '';
