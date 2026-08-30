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

import { escapeHtml } from './html.js';
import { STYLE, paletteCss } from './style.js';

// Built from its code point. Writing a newline escape into this file through a
// shell heredoc has collapsed to a literal newline four separate times,
// producing either a syntax error or — worse — a silently different string.
const LF = String.fromCharCode(10);

/** For a selector spanning clubs that do not share a palette. */
export const NEUTRAL = { accent: '#ffffff', base: '#2a2a2a' };

/** Re-exported: opponent names come from upstream data and reference tables, so
 *  they are not ours to trust. */
export { escapeHtml };

export { paletteCss };

/** The page shell. */
export function page({ title, colors, body }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<!-- Material Design Icons, the same version and CDN both sites use. An external
     request, which everything else here avoids — but the icons are load-bearing
     visually and self-hosting the font is a separate change. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css">
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

/** A club's whole history as one line: win percentage per season.
 *
 *  Inline SVG, so it needs no script and no request. Both sites render this with
 *  a charting library in the browser; the shape is simple enough that a
 *  polyline and a baseline reproduce it, and doing it here means it is testable
 *  and appears without JavaScript.
 *
 *  The dotted baseline is .500, which is what makes the line readable — above it
 *  is a winning season and below it is not, and without it the line is just a
 *  wiggle.
 */
export function sparklineHtml(points, { width = 600, height = 60 } = {}) {
	if (points.length < 2) return '';
	const pad = 3;
	const w = width - pad * 2;
	const h = height - pad * 2;
	const x = (i) => pad + (i / (points.length - 1)) * w;
	// Percentage runs 0 at the bottom to 1 at the top, so y is inverted.
	const y = (p) => pad + (1 - p) * h;
	const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
	const mid = y(0.5).toFixed(1);
	const first = points[0].season;
	const last = points.at(-1).season;
	return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img"
 aria-label="Win percentage by season, ${escapeHtml(first)} to ${escapeHtml(last)}">
<line x1="${pad}" y1="${mid}" x2="${width - pad}" y2="${mid}" class="spark-base" stroke-dasharray="2 3"/>
<polyline points="${line}" class="spark-line" fill="none"/>
</svg>`;
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
<p class="panel-title"><i class="mdi mdi-calendar-month"></i> ${escapeHtml(heading)}</p>
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
	// Six, matching the baseball site: first, back ten, back one, forward one,
	// forward ten, last. Ten is a lot of clicks to save across a hundred
	// seasons, which is the point.
	const at = (n) => allSeasons[Math.min(Math.max(n, 0), allSeasons.length - 1)];
	const parts = [];
	if (i > 0) parts.push(link(allSeasons[0], '⋘'), link(at(i - 10), '«'), link(allSeasons[i - 1], '‹'));
	parts.push(`<span class="current">${escapeHtml(current)} Season</span>`);
	if (i >= 0 && i < allSeasons.length - 1) {
		parts.push(link(allSeasons[i + 1], '›'), link(at(i + 10), '»'), link(allSeasons.at(-1), '⋙'));
	}
	return `<nav class="season-nav">${parts.join('')}</nav>`;
}

/** Switch club, and sport.
 *
 *  Neither site has this, because each serves one club — but the scope model
 *  means a deployment can hold sixty-two, and a page with no way to reach the
 *  others is a page that pretends it is the only one.
 *
 *  A `details` element, so it works with no JavaScript. Grouped by sport when
 *  the scope spans more than one, because a flat list of sixty-two is not a
 *  chooser. Clubs with no data are listed and not linked, for the same reason
 *  the selector lists them: hiding them makes a partial deployment look whole.
 */
export function clubSwitcher(clubs, currentTeamId) {
	const others = clubs.filter((c) => c.teamId !== currentTeamId);
	if (!others.length) return '';

	const bySport = new Map();
	for (const c of clubs) {
		if (!bySport.has(c.sport)) bySport.set(c.sport, []);
		bySport.get(c.sport).push(c);
	}
	const multiSport = bySport.size > 1;

	const item = (c) => {
		const label = escapeHtml(c.name ?? c.code);
		if (c.teamId === currentTeamId) return `<li class="here">${label}</li>`;
		return c.available
			? `<li><a href="${escapeHtml(c.url)}">${label}</a></li>`
			: `<li class="unavailable">${label}</li>`;
	};

	const groups = [...bySport.entries()].map(([sport, list]) => {
		const heading = multiSport ? `<p class="switch-sport">${escapeHtml(sport.toUpperCase())}</p>` : '';
		return `${heading}<ul class="switch-list">${list.map(item).join('')}</ul>`;
	});

	const current = clubs.find((c) => c.teamId === currentTeamId);
	return `<details class="switcher">
<summary>${escapeHtml(current?.name ?? 'Choose a club')} — switch club</summary>
${groups.join(LF)}
</details>`;
}

/** The links along the bottom. A quiet inline row, which is what the baseball
 *  site has; the football site still uses pills.
 *
 *  The leaders page is `/coaches` or `/managers` depending on the sport, which
 *  is manifest vocabulary rather than a branch.
 */
export function siteNav(base, team) {
	const leaders = team.nouns.leaderPlural;
	// Icon names are the sites' own choices: a trophy for records, crossed
	// swords for head-to-head, a chart for history, a whistle for the leaders.
	const items = [
		['', 'Home', 'home'],
		['/records', 'Records', 'trophy'],
		['/vs', 'Head-to-Head', 'sword-cross'],
		['/history', 'History', 'chart-line'],
		[`/${leaders}`, leaders.charAt(0).toUpperCase() + leaders.slice(1), 'whistle'],
	];
	// GitHub sits outside the club's own routes, so it is appended rather than
	// prefixed. The baseball site also carries Share and Disclaimer; Share needs
	// a dropdown and Disclaimer needs copy neither club has here yet.
	const external = [['https://github.com/rptetzloff/are-they-sports', 'GitHub', 'github']];
	const icon = (name) => `<i class="mdi mdi-${escapeHtml(name)}"></i> `;
	const links = items
		.map(([href, label, ic]) => `<a href="${escapeHtml(`${base}${href}` || '/')}">${icon(ic)}${escapeHtml(label)}</a>`)
		.concat(external.map(([href, label, ic]) => `<a href="${escapeHtml(href)}">${icon(ic)}${escapeHtml(label)}</a>`));
	return `<nav class="site-nav">${links.join('')}</nav>`;
}

/** A club's page for one season. */
export function clubPage({
	team, season, tally, verdict, answer, recordLabel, colors,
	banner = null, schedule = '', nav = '', siteNavHtml = '', lastLossless = null, allTime = null,
	switcher = '', updatedAt = null, spark = '',
}) {
	const parts = [
		`<h1>${escapeHtml(questionFor(team))}</h1>`,
		`<p class="answer ${escapeHtml(verdict)}">${escapeHtml(answer)}</p>`,
	];

	const sub = [];
	if (tally.postseason) sub.push(`Postseason: ${tally.postseason.w}-${tally.postseason.l}`);
	if (tally.championshipName) sub.push(tally.championshipName);
	const subHtml = sub.length ? `<span class="sub">${escapeHtml(sub.join(' · '))}</span>` : '';
	parts.push(`<p class="record">${subHtml}<span class="record-main">${escapeHtml(season)} Record: ${escapeHtml(recordLabel)}</span></p>`);

	// Said out loud rather than implied by an absence, because a verdict with no
	// games behind it looks identical to one with a season behind it.
	if (verdict === 'offseason') parts.push('<p class="meta">The season hasn&#39;t started yet!</p>');
	else if (verdict === 'not-started') parts.push(`<p class="meta">${escapeHtml(season)} has not started.</p>`);

	if (spark) parts.push(spark);
	if (banner) {
		parts.push('<p class="disclosure">Streak</p>');
		// Not escaped: the banner is HTML by design, bolding its numbers the way
		// both sites do. It escapes the club name itself; everything else it
		// interpolates is a number this code computed.
		parts.push(`<section class="panel">${banner}</section>`);
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
	if (updatedAt) parts.push(`<p class="meta updated">Last updated: ${escapeHtml(updatedAt)}</p>`);
	if (switcher) parts.push(switcher);
	if (siteNavHtml) parts.push(siteNavHtml);

	return page({ title: questionFor(team), colors, body: parts.join(LF) });
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
