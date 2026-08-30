/** HTML, as pure functions returning strings.
 *
 *  Rendered on the server, deliberately. On the two sites this work happens in
 *  `main.js` in the browser, which fetches its own CSV — so none of it is
 *  reachable from `node --test`, and 118 passing tests coexisted with every past
 *  season rendering a 0-0 record. Everything here takes data and returns a
 *  string, and every function is called by a test.
 *
 *  The layout is ported from the baseball site, which is the newer and larger of
 *  the two and the one the football site would be brought toward. See
 *  lib/style.js.
 */

import { STYLE, paletteCss } from './style.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Built from its code point. Writing a newline escape into this file through a
// shell heredoc has collapsed to a literal newline four separate times,
// producing either a syntax error or — worse — a silently different string.
const LF = String.fromCharCode(10);

/** For a selector spanning clubs that do not share a palette. */
export const NEUTRAL = { accent: '#ffffff', base: '#2a2a2a', baseDeep: '#1a1a1a' };

/** Escape text for HTML. Opponent names come from upstream data and reference
 *  tables, so they are not ours to trust. */
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export { paletteCss };

/** The page shell. */
export function page({ title, colors, body }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${paletteCss(colors)}

${STYLE}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun, Sep 12" from an ISO date.
 *
 *  Built by hand rather than with toLocaleDateString, and read in UTC. A date
 *  with no time is midnight UTC, and formatting that in a timezone behind UTC
 *  moves every game a day earlier — a bug that only appears for people west of
 *  Greenwich and never on the machine it was written on.
 */
export function formatDate(iso) {
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return iso;
	return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The question the page asks.
 *
 *  Manifest copy first, because it is not derivable: the baseball site asks
 *  "Are the Brewers On TV?", which no amount of vocabulary substitution reaches
 *  from "undefeated". The default covers the football shape.
 *
 *  Title case, matching both sites' headings.
 */
export function questionFor(team) {
	if (team.copy?.question) return team.copy.question;
	const noun = team.nouns.losslessSeasonNoun;
	return `Are the ${team.nouns.team} ${noun.charAt(0).toUpperCase()}${noun.slice(1)}?`;
}

const resultClass = (r) => (r === 'WIN' ? 'win' : r === 'LOSS' ? 'loss' : r === 'TIE' ? 'tie' : 'none');

/** One season's games, as cards.
 *
 *  Opponent names are resolved by the caller, because resolution is per sport
 *  and dated — a 1969 Brewers opponent is not called what it is called now — and
 *  this function should not know that.
 */
export function scheduleHtml(rows, { heading }) {
	if (!rows.length) return '';
	const card = (g) => {
		const cls = resultClass(g.result);
		const at = g.location === 'away' ? '@ ' : 'vs ';
		const result = g.result
			? `${g.result[0]} ${escapeHtml(`${g.scoreFor}–${g.scoreAgainst}`)}`
			: 'scheduled';
		const series = g.seriesRecord ? `<div class="game-meta">All-time: ${escapeHtml(g.seriesRecord)}</div>` : '';
		return `<div class="game-item ${g.result ? cls : 'next'}">
<div class="game-opponent">${escapeHtml(at)}${escapeHtml(g.opponentName ?? g.Opponent)}</div>
${series}<div class="game-date">${escapeHtml(formatDate(g.date))}</div>
<div class="game-result ${cls}">${result}</div>
</div>`;
	};
	return `<section class="schedule-panel">
<p class="panel-title">${escapeHtml(heading)}</p>
<div class="games">
${rows.map(card).join(LF)}
</div>
</section>`;
}

/** Chevron navigation across the seasons a club actually has rows for, so a
 *  franchise that did not play in 1943 is not offered a link to it. */
export function seasonNav(allSeasons, current, base) {
	if (!allSeasons.length) return '';
	const i = allSeasons.indexOf(current);
	const link = (s, label) => `<a href="${escapeHtml(base)}/${escapeHtml(s)}" title="${escapeHtml(s)}">${label}</a>`;
	const parts = [];
	if (i > 0) parts.push(link(allSeasons[0], '⋘'), link(allSeasons[i - 1], '‹'));
	parts.push(`<span class="current">${escapeHtml(current)} Season</span>`);
	if (i >= 0 && i < allSeasons.length - 1) parts.push(link(allSeasons[i + 1], '›'), link(allSeasons.at(-1), '⋙'));
	return `<nav class="season-nav">${parts.join('')}</nav>`;
}

/** The links along the bottom. A quiet inline row, which is what the baseball
 *  site has; the football site still uses pills.
 *
 *  The leaders page is `/coaches` or `/managers` depending on the sport, which
 *  is manifest vocabulary rather than a branch.
 */
export function siteNav(base, team) {
	const leaders = team.nouns.leaderPlural;
	const items = [
		['', 'Home'],
		['/records', 'Records'],
		['/vs', 'Head-to-Head'],
		['/history', 'History'],
		[`/${leaders}`, leaders.charAt(0).toUpperCase() + leaders.slice(1)],
	];
	return `<nav class="site-nav">${items
		.map(([href, label]) => `<a href="${escapeHtml(`${base}${href}` || '/')}">${escapeHtml(label)}</a>`)
		.join('')}</nav>`;
}

/** A club's page for one season. */
export function clubPage({
	team, season, tally, verdict, answer, recordLabel,
	banner = null, schedule = '', nav = '', siteNavHtml = '', lastLossless = null, allTime = null,
}) {
	const parts = [
		`<h1>${escapeHtml(questionFor(team))}</h1>`,
		`<p class="answer ${escapeHtml(verdict)}">${escapeHtml(answer)}</p>`,
	];

	const sub = [];
	if (tally.postseason) sub.push(`Postseason: ${tally.postseason.w}-${tally.postseason.l}`);
	if (tally.championshipName) sub.push(tally.championshipName);
	const subHtml = sub.length ? `<span class="sub">${escapeHtml(sub.join(' · '))}</span>` : '';
	parts.push(`<p class="record">${subHtml}${escapeHtml(season)} Record: ${escapeHtml(recordLabel)}</p>`);

	// Said out loud rather than implied by an absence, because a verdict with no
	// games behind it looks identical to one with a season behind it.
	if (verdict === 'offseason') parts.push('<p class="meta">The season hasn&#39;t started yet!</p>');
	else if (verdict === 'not-started') parts.push(`<p class="meta">${escapeHtml(season)} has not started.</p>`);

	if (banner) {
		parts.push('<p class="disclosure">Streak</p>');
		parts.push(`<section class="panel">${escapeHtml(banner)}</section>`);
	}
	if (nav) parts.push(nav);
	if (schedule) parts.push(schedule);

	if (lastLossless) {
		const ties = lastLossless.ties ? `-${lastLossless.ties}` : '';
		parts.push(`<p class="meta">The ${escapeHtml(team.nouns.team)} were last ${escapeHtml(team.nouns.losslessSeasonNoun)} in <b>${escapeHtml(lastLossless.season)}</b> (${lastLossless.wins}-${lastLossless.losses}${ties}).</p>`);
	} else {
		// "Never" is a legitimate answer and reads better than an absent panel,
		// which looks like something failed to load.
		parts.push(`<p class="meta">No ${escapeHtml(team.nouns.losslessSeasonNoun)} season on record.</p>`);
	}
	if (allTime) {
		parts.push(`<p class="meta">All time: <b>${escapeHtml(allTime.record)}</b> over ${allTime.played} games, ${escapeHtml(allTime.first)}–${escapeHtml(allTime.last)}</p>`);
	}
	if (siteNavHtml) parts.push(siteNavHtml);

	return page({ title: questionFor(team), colors: team.colors, body: parts.join(LF) });
}

/** The selector, for any scope holding more than one club.
 *
 *  Unavailable clubs are listed, not hidden. A selector showing two clubs of a
 *  promised sixteen looks complete and is wrong.
 */
export function selectorPage({ scope, clubs, colors, heading }) {
	const items = clubs.map((c) => {
		const label = `<span class="code">${escapeHtml(c.code)}</span> ${escapeHtml(c.name ?? '')}`.trim();
		return c.available
			? `<li><a href="${escapeHtml(c.url)}">${label}</a></li>`
			: `<li><span class="unavailable">${label} — not built</span></li>`;
	});
	const built = clubs.filter((c) => c.available).length;
	return page({
		title: heading,
		colors,
		body: [
			`<h1>${escapeHtml(heading)}</h1>`,
			`<ul class="clubs">${LF}${items.join(LF)}${LF}</ul>`,
			`<p class="meta">${built} of ${clubs.length} clubs built · <code>${escapeHtml(scope)}</code></p>`,
		].join(LF),
	});
}
