// The home page's schedule as compact rows: one line a game — date,
// opponent, result or start time, TV — under month headings, with a chip a
// month to jump the list. Pure functions — no fetch/DOM — so the rows can be
// tested; main.js builds the row objects from ESPN's schedule or the games
// CSV and wires the chips.
//
// Ported from the Brewers repo's file of the same name, where the reason was
// 210 cards of ~110px in a 400px box. A football season is about 24 games,
// so the scrolling was never that bad here; what the rows buy is a schedule
// that fits beside the answer as a column on a desktop, which ~120px cards
// did not. Differences from that file: the preseason chip's word comes from
// site.js, a row may carry its all-time head-to-head link, and a played
// game's only link is ESPN's, because this site has no box score page or
// line-score pop-up yet.

import { SITE } from './site.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10" for a Date, in the viewer's own time zone. A Sunday night game
 *  at 7:20 PM Central is the 19th in UTC, and on the last of a month it
 *  would land in the next one. */
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthIndex = (key) => Number(key.slice(5, 7)) - 1;
export const monthName = (key) => `${MONTHS[monthIndex(key)]} ${key.slice(0, 4)}`;
export const monthShort = (key) => SHORT[monthIndex(key)];

/**
 * One game's row. `row` is
 *   { key, date: Date, opp, home, state, text, tv: [labels], h2h, links,
 *     clickable, title }
 * where state is 'win' | 'loss' | 'tie' | 'live' | 'next' | 'upcoming' |
 * 'postponed', and text the result ("W 6-2"), the score of a live game, or
 * the start time. `h2h` is { href, text, title } for the all-time record
 * against this opponent; `links` is { espn } for a game ESPN has a page for.
 */
export function scheduleRowHtml(row) {
	const d = row.date;
	const when = `<span class="sched-dow">${DOW[d.getDay()]}</span> ${SHORT[d.getMonth()]} ${d.getDate()}`;
	const tv = (row.tv || []).filter(Boolean);
	const h2h = row.h2h
		? ` <a class="sched-h2h" href="${esc(row.h2h.href)}" title="${esc(row.h2h.title)}">${esc(row.h2h.text)}</a>`
		: '';
	// A row that opens something is a button for the keyboard too.
	const attrs = [
		`class="sched-row sched-${esc(row.state)}${row.clickable ? ' sched-click' : ''}"`,
		`data-key="${esc(row.key)}"`,
		row.clickable ? 'role="button" tabindex="0"' : '',
		row.title ? `title="${esc(row.title)}"` : '',
	].filter(Boolean).join(' ');
	return `<div ${attrs}>`
		+ `<span class="sched-date">${when}</span>`
		+ `<span class="sched-opp">${row.home ? 'vs' : '@'} ${esc(row.opp)}${h2h}</span>`
		+ `<span class="sched-out">${row.state === 'live' ? '<span class="live-indicator-small"></span>' : ''}${esc(row.text)}</span>`
		+ `<span class="sched-tv">${esc(tv.join(' · '))}</span>`
		+ rowLinksHtml(row.links)
		+ '</div>';
}

/** A played or live game's links: its summary pop-up, its box score page,
 *  and ESPN's page for it. `links` is { summary: true, box: 'game/…',
 *  espn: 'https://…' }, any of them, as on the Brewers rows. */
function rowLinksHtml(links) {
	const out = [];
	if (links?.summary) out.push('<button type="button" class="sched-link" data-act="summary" title="Summary: score by quarter, leaders and scoring" aria-label="Summary"><i class="mdi mdi-text-box-outline" aria-hidden="true"></i><span class="sched-link-label">Summary</span></button>');
	if (links?.box) out.push(`<a class="sched-link" href="${esc(links.box)}" title="Box score" aria-label="Box score"><i class="mdi mdi-table" aria-hidden="true"></i><span class="sched-link-label">Box</span></a>`);
	if (links?.espn) out.push(`<a class="sched-link sched-link-espn" href="${esc(links.espn)}" target="_blank" rel="noopener noreferrer" title="This game on ESPN" aria-label="ESPN">ESPN</a>`);
	return out.length ? `<span class="sched-links">${out.join('')}</span>` : '';
}

/** The list: phase labels where the phase changes (Preseason, Regular
 *  Season, Playoffs), and each month's games in a group under its heading.
 *  The heading sticks to the top while its own group scrolls by; as siblings
 *  in one list, the headings stuck on top of one another instead. `rows`
 *  are scheduleRowHtml's objects plus `phase`, in date order. */
export function scheduleListHtml(rows, phaseLabels = {}) {
	let phase = null;
	let month = null;
	const out = [];
	const close = () => { if (month) out.push('</section>'); };
	for (const r of rows) {
		if (r.phase && r.phase !== phase) {
			close();
			phase = r.phase;
			out.push(`<div class="season-divider">${esc(phaseLabels[phase] || phase)}</div>`);
			month = null; // the first month of a phase is named under its label
		}
		const m = monthKey(r.date);
		if (m !== month) {
			close();
			month = m;
			// A group is a month within a phase: January's last regular-season
			// game and its Wild Card round are two groups, each with its own
			// chip target.
			out.push(`<section class="sched-group" data-group="${esc(groupKey(r.phase, m))}" data-phase="${esc(r.phase || '')}" data-month="${m}"><div class="sched-month">${esc(monthName(m))}</div>`);
		}
		out.push(scheduleRowHtml(r));
	}
	close();
	return out.join('');
}

/** The key of a group in the list: a month within a phase. */
export const groupKey = (phase, month) => `${phase || ''}|${month}`;

/**
 * The chips over the list, in season order: one for the preseason, one a
 * month for the regular season, and one for the playoffs, each phase's chips
 * in a group. Each chip names the group it jumps to (`data-group`) and the
 * groups it stands for (`data-covers`, space-separated), so the one standing
 * for the group at the top of the list can be marked as the list scrolls. A
 * season of a single group needs no chips.
 *
 * The CSV has no playoff rounds, so a past season's playoffs are one chip,
 * where the Brewers site has one a round.
 */
export function monthChipsHtml(rows, site = SITE) {
	const phaseChip = { pre: site.preseasonNoun, other: site.preseasonNoun, post: 'Playoffs' };
	// The groups in order, as scheduleListHtml lays them out.
	const groups = [];
	for (const r of rows) {
		const key = groupKey(r.phase, monthKey(r.date));
		if (groups[groups.length - 1]?.key !== key) groups.push({ key, phase: r.phase || '', month: monthKey(r.date) });
	}
	if (groups.length < 2) return '';
	const chips = [];
	for (const g of groups) {
		const last = chips[chips.length - 1];
		const named = g.phase !== 'regular' && phaseChip[g.phase];
		if (named && last?.phase === g.phase) {
			last.covers.push(g.key);
			continue;
		}
		const label = named ? phaseChip[g.phase] : monthShort(g.month);
		const title = named ? label : monthName(g.month);
		chips.push({ phase: g.phase, target: g.key, covers: [g.key], label, title });
	}
	// Each phase's chips sit in a group of their own, so a row too narrow for
	// them all breaks between phases rather than leaving a divider at the end
	// of a line.
	const out = [];
	chips.forEach((c, i) => {
		if (i === 0 || chips[i - 1].phase !== c.phase) {
			if (i > 0) out.push('</span>');
			out.push(`<span class="sched-chip-group" data-phase="${esc(c.phase)}">`);
		}
		out.push(`<button type="button" class="sched-chip" data-group="${esc(c.target)}" data-covers="${esc(c.covers.join(' '))}" aria-label="${esc(c.title)}">${esc(c.label)}</button>`);
	});
	out.push('</span>');
	return out.join('');
}
