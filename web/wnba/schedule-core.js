// The home page's schedule as compact rows: one line a game — date,
// opponent, result or start time, TV — under month headings, with a chip a
// month to jump the list. The season used to be a card a game, ~110px each,
// 210 of them in a 400px box: about 23,000px of scrolling in a small window.
// Pure functions — no fetch/DOM — so the rows can be tested; main.js builds
// the row objects from ESPN's schedule or Retrosheet's games and wires the
// clicks.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-10" for a Date, in the viewer's own time zone (a 9 PM game on the
 *  last of the month is that month, not the next one in UTC). */
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthIndex = (key) => Number(key.slice(5, 7)) - 1;
export const monthName = (key) => `${MONTHS[monthIndex(key)]} ${key.slice(0, 4)}`;
export const monthShort = (key) => SHORT[monthIndex(key)];

/**
 * One game's row. `row` is
 *   { key, date: Date, opp, home, state, text, tv: [labels], clickable, title }
 * where state is 'win' | 'loss' | 'tie' | 'live' | 'next' | 'upcoming' |
 * 'postponed', and text the result ("W 6-2"), the score of a live game, or
 * the start time. `key` becomes data-key (and the id, for Retrosheet's g-<gid>
 * anchors when given as `anchor`). A played game may carry `links`
 * (summary, box score, ESPN; see rowLinksHtml).
 */
export function scheduleRowHtml(row) {
	const d = row.date;
	const when = `<span class="sched-dow">${DOW[d.getDay()]}</span> ${SHORT[d.getMonth()]} ${d.getDate()}`;
	const tv = (row.tv || []).filter(Boolean);
	const attrs = [
		`class="sched-row sched-${esc(row.state)}${row.clickable ? ' sched-click' : ''}"`,
		`data-key="${esc(row.key)}"`,
		row.anchor ? `id="${esc(row.anchor)}"` : '',
		row.clickable ? 'role="button" tabindex="0"' : '',
		row.title ? `title="${esc(row.title)}"` : '',
	].filter(Boolean).join(' ');
	return `<div ${attrs}>`
		+ `<span class="sched-date">${when}</span>`
		+ `<span class="sched-opp">${row.home ? 'vs' : '@'} ${esc(row.opp)}</span>`
		+ `<span class="sched-out">${row.state === 'live' ? '<span class="live-indicator-small"></span>' : ''}${esc(row.text)}</span>`
		+ `<span class="sched-tv">${esc(tv.join(' · '))}</span>`
		+ rowLinksHtml(row.links)
		+ '</div>';
}

/** A played game's links: its summary (the line score pop-up), its box
 *  score page, and ESPN's page for it when the game came from ESPN. `links`
 *  is { summary: true, box: 'game/…', espn: 'https://…' }, any of them. */
function rowLinksHtml(links) {
	if (!links) return '';
	const out = [];
	if (links.summary) out.push('<button type="button" class="sched-link" data-act="summary" title="Summary: line score and scoring plays" aria-label="Summary"><i class="mdi mdi-text-box-outline" aria-hidden="true"></i><span class="sched-link-label">Summary</span></button>');
	if (links.box) out.push(`<a class="sched-link" href="${esc(links.box)}" title="Box score" aria-label="Box score"><i class="mdi mdi-table" aria-hidden="true"></i><span class="sched-link-label">Box</span></a>`);
	if (links.espn) out.push(`<a class="sched-link sched-link-espn" href="${esc(links.espn)}" target="_blank" rel="noopener noreferrer" title="This game on ESPN" aria-label="ESPN">ESPN</a>`);
	return out.length ? `<span class="sched-links">${out.join('')}</span>` : '';
}

/** The list: phase labels where the phase changes (Preseason, Regular
 *  Season, Playoffs...), and each month's games in a group under its
 *  heading. The heading sticks to the top while its own group scrolls by;
 *  as siblings in one list, the headings stuck on top of one another
 *  instead ("September" showing through "October"). `rows` are
 *  scheduleRowHtml's objects plus `phase`, in date order. */
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
			// A group is a month within a phase: March's spring games and its
			// opening week are two groups, each with its own chip target.
			out.push(`<section class="sched-group" data-group="${esc(groupKey(r.phase, m))}" data-phase="${esc(r.phase || '')}" data-month="${m}"><div class="sched-month">${esc(monthName(m))}</div>`);
		}
		out.push(scheduleRowHtml(r));
	}
	close();
	return out.join('');
}

/** The key of a group in the list: a month within a phase. */
export const groupKey = (phase, month) => `${phase || ''}|${month}`;

// Each phase's chip label. The regular season gets a chip a month instead.
// The WNBA's: the preseason, and the rounds by their short names.
const PHASE_CHIP = { pre: 'Preseason', other: 'Preseason', post: 'Playoffs', wc: 'R1', ds: 'R2', lcs: 'Semis', ws: 'Finals' };

/**
 * The chips over the list, in season order: one for the preseason, one a
 * month for the regular season, and one for the postseason — or, for a past
 * season, one a postseason round — each phase's chips in a group. Each
 * chip names the group it jumps to (`data-group`) and the groups it stands
 * for (`data-covers`, space-separated), so the one standing for the group at
 * the top of the list can be marked as the list scrolls. A season of a
 * single group needs no chips.
 */
export function monthChipsHtml(rows) {
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
		if (g.phase !== 'regular' && PHASE_CHIP[g.phase] && last?.phase === g.phase) {
			last.covers.push(g.key);
			continue;
		}
		const label = g.phase === 'regular' || !PHASE_CHIP[g.phase] ? monthShort(g.month) : PHASE_CHIP[g.phase];
		const title = g.phase === 'regular' || !PHASE_CHIP[g.phase] ? monthName(g.month) : label;
		chips.push({ phase: g.phase, target: g.key, covers: [g.key], label, title });
	}
	// Each phase's chips sit in a group of their own, so a row too narrow for
	// them all breaks between phases — never leaving a divider at the end of
	// a line, which separators between the chips did.
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
