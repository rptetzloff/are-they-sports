// The live game's field: where the ball is, the line to gain, and every play
// of the drive under way drawn as an arrow from its start spot to its end,
// with the drive's plays listed beneath, newest first. Football's version
// of the Brewers live card's diamond with the last ball in play on it.
//
// Pure: it draws from the box score lib/espn-box.js builds (box.drive and
// box.situation) and touches no DOM. Spots are ESPN's yardLine, yards from
// the HOME team's goal line, so the home end zone is on the left and the
// field reads the same way all game whoever has the ball.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The drawing's units are yards: a 10-yard end zone each side of 100 yards.
const W = 120;
const H = 40;
const x = (yardLine) => 10 + Math.max(0, Math.min(100, yardLine));
// At most this many plays get an arrow; a long drive keeps its latest.
export const MAX_ARROWS = 10;

/** The line to gain, as a yardLine, or null on a goal-to-go down or when
 *  there is no down to gain (a kickoff, an extra point). The offense moves
 *  away from its own goal: up the yardLine for the home team, down it for
 *  the visitors. */
export function lineToGain(situation) {
	const s = situation;
	if (!s || s.yardLine == null || !s.down || !s.distance || !s.possession) return null;
	if (/goal/i.test(s.downDistance || '')) return null;
	const at = s.possession === 'home' ? s.yardLine + s.distance : s.yardLine - s.distance;
	return at > 0 && at < 100 ? at : null;
}

/** How a play is drawn: 'score', 'turnover', 'penalty', 'loss' or 'gain'. */
export function playKind(p) {
	if (p.scoring) return 'score';
	if (p.turnover) return 'turnover';
	if (p.penalty) return 'penalty';
	return (p.yards ?? 0) < 0 ? 'loss' : 'gain';
}

/** The field as an SVG: end zones in each team's colour with its
 *  abbreviation, yard lines and numbers, the line of scrimmage and the line
 *  to gain, and the drive's plays as arrows, oldest at the top. */
export function fieldSvg(box) {
	const { away, home } = box;
	const sit = box.situation;
	const plays = (box.drive?.plays || []).filter((p) => p.from != null && p.to != null).slice(-MAX_ARROWS);
	const out = [];
	const zone = (x0, t) => `<rect x="${x0}" y="0" width="10" height="${H}" class="field-zone"${t.color ? ` style="fill:#${t.color}"` : ''}/>`
		+ `<text x="${x0 + 5}" y="${H / 2}" class="field-zone-label" transform="rotate(-90 ${x0 + 5} ${H / 2})">${esc(t.abbr)}</text>`;
	out.push(`<rect x="10" y="0" width="100" height="${H}" class="field-grass"/>`);
	out.push(zone(0, home), zone(110, away));
	for (let yl = 5; yl < 100; yl += 5) {
		out.push(`<line x1="${x(yl)}" y1="0" x2="${x(yl)}" y2="${H}" class="${yl % 10 ? 'field-line-5' : 'field-line-10'}"/>`);
	}
	for (let yl = 10; yl < 100; yl += 10) {
		const n = yl <= 50 ? yl : 100 - yl;
		out.push(`<text x="${x(yl)}" y="4.2" class="field-number">${n}</text><text x="${x(yl)}" y="${H - 1.6}" class="field-number">${n}</text>`);
	}
	const togain = lineToGain(sit);
	if (togain != null) out.push(`<line x1="${x(togain)}" y1="0" x2="${x(togain)}" y2="${H}" class="field-togain"/>`);
	if (sit?.yardLine != null) out.push(`<line x1="${x(sit.yardLine)}" y1="0" x2="${x(sit.yardLine)}" y2="${H}" class="field-scrimmage"/>`);
	// The plays, one row each between the numbers, oldest at the top.
	const top = 6.5;
	const step = plays.length > 1 ? Math.min(3.2, (H - 13) / (plays.length - 1)) : 0;
	// An arrowhead at x2 pointing the way from x1, or nothing if they match.
	const arrow = (x1, x2, y, kind) => {
		const dir = Math.sign(x2 - x1);
		if (!dir) return '';
		return `<line x1="${x1}" y1="${y}" x2="${x2 - dir * 1.2}" y2="${y}"/>`
			+ `<polygon points="${x2},${y} ${x2 - dir * 1.4},${(Number(y) - 0.9).toFixed(2)} ${x2 - dir * 1.4},${(Number(y) + 0.9).toFixed(2)}" class="field-play-${kind}"/>`;
	};
	plays.forEach((p, i) => {
		const y = (top + i * step).toFixed(2);
		const kind = playKind(p);
		let path;
		if (p.via != null) {
			// The ball changed hands on the way: the kick or the pass as a
			// dashed line to where it was fielded or picked off, a mark there,
			// and the return as an arrow from it. A fair catch or a downed
			// ball has no return, so its arrowhead is on the dashed line.
			const [x1, xv, x2] = [x(p.from), x(p.via), x(p.to)];
			const air = Math.sign(xv - x1);
			const ret = xv !== x2;
			// A kick goes downfield and the return comes back over the same
			// yards, so on one row the return hid the kick: the kick sits a
			// little above the row and the return a little below.
			const split = air && ret;
			const ya = split ? (Number(y) - 0.55).toFixed(2) : y;
			const yr = split ? (Number(y) + 0.55).toFixed(2) : y;
			path = (air ? `<line x1="${x1}" y1="${ya}" x2="${ret ? xv : xv - air * 1.2}" y2="${ya}" class="field-play-air"/>` : '')
				+ (!ret && air ? `<polygon points="${xv},${y} ${xv - air * 1.4},${(Number(y) - 0.9).toFixed(2)} ${xv - air * 1.4},${(Number(y) + 0.9).toFixed(2)}" class="field-play-${kind}"/>` : '')
				+ `<rect x="${(xv - 0.6).toFixed(2)}" y="${(Number(y) - 0.6).toFixed(2)}" width="1.2" height="1.2" class="field-play-via"/>`
				+ (ret ? arrow(xv, x2, yr, kind) : '')
				+ `<circle cx="${x1}" cy="${ya}" r="0.7"/>`;
		} else {
			// An arrowhead pointing the way the ball went; a play that went
			// nowhere (an incompletion) is a dot.
			path = arrow(x(p.from), x(p.to), y, kind) + `<circle cx="${x(p.from)}" cy="${y}" r="0.7"/>`;
		}
		out.push(`<g class="field-play field-play-${kind}"><title>${esc(p.text)}</title>${path}</g>`);
	});
	if (sit?.yardLine != null) out.push(`<circle cx="${x(sit.yardLine)}" cy="${H - 4.5}" r="1.3" class="field-ball"/>`);
	const label = sit
		? `Field: ${sit.possession ? `${box[sit.possession].short} ball, ` : ''}${sit.downDistance || ''}`
		: 'Field';
	return `<svg class="field-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out.join('')}</svg>`;
}

const signed = (n) => (n == null ? '' : n > 0 ? `+${n}` : String(n));

// A kick's yardage is ESPN's 0 (its distance is in the text, "punts 37
// yards"), so a kick shows none rather than a misleading 0.
// A turnover's statYardage is the RETURN, the other side's yards: the
// interception at the GB 3 run back to the 20 read "+17" on the Cowboys'
// drive. It shows what happened instead.
const KICK = /punt|kickoff|field goal|extra point/i;
const yardsOf = (p) => {
	if (p.turnover) return /intercept/i.test(p.typeText + p.text) ? 'INT' : /fumble/i.test(p.typeText + p.text) ? 'FUM' : 'TO';
	return p.down && !KICK.test(p.typeText) ? signed(p.yards) : '';
};

/** The drive's plays, newest first, each with its down and distance before
 *  the snap, the clock, what happened and the yards. */
export function driveLogHtml(box) {
	const d = box.drive;
	if (!d?.plays.length) return '';
	const team = d.side ? box[d.side] : null;
	const head = [team && `${esc(team.short)} drive`, d.summary && esc(d.summary), d.from && `from ${esc(d.from)}`, d.result && `<strong>${esc(d.result)}</strong>`]
		.filter(Boolean).join(' · ');
	const rows = [...d.plays].reverse().map((p) => `<li class="drive-play drive-play-${playKind(p)}">`
		+ `<span class="drive-play-when">${esc(p.down || p.typeText)}<span class="drive-play-clock">Q${esc(p.quarter ?? '')} ${esc(p.clock)}</span></span>`
		+ `<span class="drive-play-text">${esc(p.text)}</span>`
		+ `<span class="drive-play-yds">${esc(yardsOf(p))}</span>`
		+ '</li>').join('');
	return `<div class="drive-log"><div class="drive-log-head">${head}</div><ol class="drive-plays">${rows}</ol></div>`;
}

/**
 * The strip over the field: each side's abbreviation, score and timeouts
 * left, and a football by the side with the ball. Home on the left, as the
 * field's end zones are, so the strip and the field read the same way.
 * Timeouts show only when the scoreboard gave them; three dots a side,
 * filled for each one left.
 */
export function scorebugHtml(box) {
	const sit = box.situation;
	const side = (s) => {
		const t = box[s];
		const left = sit?.timeouts?.[s];
		const dots = left == null ? ''
			: `<span class="bug-timeouts" title="${left} timeout${left === 1 ? '' : 's'} left" aria-label="${left} timeout${left === 1 ? '' : 's'} left">`
				+ [0, 1, 2].map((i) => `<span class="bug-to${i < left ? ' bug-to-left' : ''}"></span>`).join('') + '</span>';
		const ball = sit?.possession === s ? '<i class="mdi mdi-football bug-ball" aria-label="has the ball"></i>' : '';
		return `<div class="bug-team bug-${s}${box.teamSide === s ? ' bug-ours' : ''}${sit?.possession === s ? ' bug-has-ball' : ''}">`
			+ `<span class="bug-abbr">${esc(t.abbr)}</span>${ball}<span class="bug-score">${esc(t.score)}</span>${dots}</div>`;
	};
	return `<div class="field-bug">${side('home')}<div class="bug-status">${esc(box.status || '')}</div>${side('away')}</div>`;
}

/** The tracker: the strip with score, timeouts and ball, the situation
 *  line, the field, and the drive's plays. Empty when the game has no drive
 *  to show. */
export function fieldTrackerHtml(box) {
	if (!box.drive && !box.situation) return '';
	const sit = box.situation;
	const ball = sit?.possession ? `<strong>${esc(box[sit.possession].short)} ball</strong>` : '';
	const line = [ball, sit?.downDistance && esc(sit.downDistance)].filter(Boolean).join(' · ');
	return `<div class="field-tracker">`
		+ scorebugHtml(box)
		+ (line ? `<div class="field-sit">${line}</div>` : '')
		+ fieldSvg(box)
		+ driveLogHtml(box)
		+ '</div>';
}
