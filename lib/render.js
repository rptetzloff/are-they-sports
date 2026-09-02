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
import { streakSentence } from './headtohead.js';
import { STYLE, paletteCss } from './style.js';
import { pct } from './records.js';
import { chartGeometry } from './history.js';
// `textWidth` only. `renderCard` and the resvg binding are NOT imported here:
// card.js pulls nothing heavier than node:fs and reads the font files lazily
// inside renderCard, so this costs a module load and no bytes.
import { textWidth } from './card.js';
import { gamesBack } from './standings.js';
import { column, sortHref, sortRows, sortState } from './sort.js';

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

/** What this club did on today's date, in other years.
 *
 *  Rows come from lib/onthisday.js, which decides WHICH games; this decides how
 *  they read. The window is a sport rule -- exact for baseball, three days
 *  either side for football -- so the heading says which it got rather than
 *  claiming an anniversary it does not have. A football game from three days off
 *  today is worth showing and is not "on this day", and a panel that called it
 *  that would be wrong 6 times out of 7.
 *
 *  An empty panel SAYS it is empty rather than disappearing. An absent panel and
 *  a panel with no matches look identical, and only one of them means this club
 *  has never played on this date.
 */
export function onThisDayPanel({ games, summary, today, team, base = '', resolve = null, windowDays = 0 }) {
	const name = (code, season) => (resolve
		? escapeHtml(resolve(code, { season: String(season) }).name)
		: escapeHtml(code));
	const yr = (season) => `<a class="season-link strong" href="${escapeHtml(base)}/${escapeHtml(String(season))}">${escapeHtml(String(season))}</a>`;

	if (!summary.count) {
		return `<section class="panel otd-empty"><p class="dim">`
			+ `The ${escapeHtml(team.nouns.team)} have never played on this date.</p></section>`;
	}

	const RESULT = { WIN: ['W', 'win'], LOSS: ['L', 'loss'], TIE: ['T', 'tie'] };
	const row = (g) => {
		const [letter, cls] = RESULT[g.result] ?? ['', ''];
		const score = g.scoreFor !== '' && g.scoreAgainst !== ''
			? `${escapeHtml(g.scoreFor)}–${escapeHtml(g.scoreAgainst)}` : '';
		// The date is shown for every row, not only the near ones. With a window
		// the reader cannot otherwise tell which game is actually today's
		// anniversary, and with no window it is the same date on every line and
		// costs nothing.
		return `<li class="otd-game">
<span class="otd-season">${yr(g.season)}</span>
<span class="otd-result ${cls}">${letter}</span>
<span class="otd-score">${score}</span>
<span class="otd-opp">${g.location === 'away' ? '@ ' : ''}${name(g.Opponent, g.season)}</span>
<span class="otd-date dim">${escapeHtml(formatDate(g.date))}</span>
</li>`;
	};

	const span = summary.first === summary.last
		? String(summary.first)
		: `${summary.first}–${summary.last}`;
	const tally = `${summary.wins}–${summary.losses}${summary.ties ? `–${summary.ties}` : ''}`;

	return `<section class="panel otd">
<p class="panel-title"><i class="mdi mdi-calendar-star"></i> ${
	escapeHtml(windowDays ? `Around this date, ${span}` : `On this date, ${span}`)}</p>
<p class="meta">${escapeHtml(`${summary.count} game${summary.count === 1 ? '' : 's'}, ${tally}`)}${
	windowDays ? ` <span class="dim">${escapeHtml(`within ${windowDays} days of ${formatDate(today)}`)}</span>` : ''}</p>
<ul class="otd-games">
${games.map(row).join(LF)}
</ul>
</section>`;
}

/** One stepper, for every nav that moves through an ordered list.
 *
 *  There were four of these, written at different times in two different
 *  grammars, and a schedule page carried three of them at once: seasons at the
 *  top, days in the middle, seasons again at the foot, two of the three using
 *  the identical glyphs on different axes. Nothing but the label between the
 *  arrows said which was which.
 *
 *  The glyphs are ONE family, all the same chevron at the same weight: a bar
 *  marks the ends, doubling means ten. The club page used to mix three
 *  different weights — U+22D8, U+00AB, U+2039 — where the first two are
 *  near-identical at that size and neither says it jumps ten.
 *
 *  Every row is named, so a page can carry two of these and neither is
 *  ambiguous. That name replaces the old "1998 Season" in the middle, which said
 *  the same thing in the one spot where it could not be scanned.
 *
 *  Ends are dimmed rather than dropped. The club page omitted them and the row
 *  changed width as you moved through it, which is the sort of thing that reads
 *  as a rendering fault.
 *
 *  @param items  every value that can be stepped to, in order.
 *  @param index  where we are; -1 for nowhere, which dims everything.
 *  @param href   `(item) => url`.
 *  @param format `(item) => the label for the middle`.
 *  @param label  what is being stepped: "Season", "Day", "Week".
 */
export function stepNav({ items, index, href, format = String, label = null, extra = '' }) {
	if (!items.length) return '';
	// The ten-jump earns its place on a hundred seasons and is clutter on
	// eighteen weeks. Twenty is the line; below it the row is four controls.
	const jump = items.length > 20;
	const at = (n) => items[Math.min(Math.max(n, 0), items.length - 1)];
	const back = index > 0;
	const fwd = index >= 0 && index < items.length - 1;
	const step = (item, glyph, on, title) => (on
		? `<a href="${escapeHtml(href(item))}" title="${escapeHtml(title)}">${escapeHtml(glyph)}</a>`
		: `<span class="step-off">${escapeHtml(glyph)}</span>`);
	const parts = [
		label ? `<span class="nav-label">${escapeHtml(label)}</span>` : '',
		step(items[0], '|‹', back, `First ${label ?? ''}`.trim()),
		jump ? step(at(index - 10), '‹‹', back, 'Back 10') : '',
		step(items[index - 1], '‹', back, 'Previous'),
		`<span class="current">${escapeHtml(format(items[index] ?? items[0]))}</span>`,
		step(items[index + 1], '›', fwd, 'Next'),
		jump ? step(at(index + 10), '››', fwd, 'Forward 10') : '',
		step(items.at(-1), '›|', fwd, `Last ${label ?? ''}`.trim()),
	];
	return `<nav class="season-nav">${parts.filter(Boolean).join('')}</nav>${extra}`;
}

/** Chevron navigation across the seasons a club actually has rows for, so a
 *  franchise that did not play in 1943 is not offered a link to it. */
export function seasonNav(allSeasons, current, base) {
	return stepNav({
		items: allSeasons,
		index: allSeasons.indexOf(current),
		href: (s) => `${base}/${s}`,
		label: 'Season',
	});
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
export function clubSwitcher(clubs, currentTeamId, path = '') {
	// `path` may be a FUNCTION of the club, and that is not generality for its
	// own sake. Every route below a club's base is spelled the same for every
	// club except one: the leaders page is `/coaches` for football and
	// `/managers` for baseball. Appending one string to every club's base sent a
	// reader from `/nfl/packers/coaches` to `/mlb/brewers/coaches`, which does
	// not exist — the switcher promised to keep you on the page you were on and
	// delivered a 404 across the sport boundary, in both directions.
	const pathFor = (c) => (typeof path === 'function' ? path(c) : path);
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
		// Switching keeps you on the page you were on: from the Packers' records
		// to the Bears' records, not to their front page. Being sent home to
		// re-navigate is the thing a switcher exists to avoid.
		return c.available
			? `<li><a href="${escapeHtml(c.url + pathFor(c))}">${label}</a></li>`
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

/** Share this page, as a dropdown of plain links.
 *
 *  A `<details>`, like the club switcher, because every target is a URL and this
 *  repo renders interactivity with links and CSS rather than script. Sharing to a
 *  platform genuinely is a link, so nothing is lost by it.
 *
 *  What a script would buy is copy-to-clipboard and the phone's native share
 *  sheet, and neither can be a link. The URL is offered in a field a reader can
 *  select instead — worse than a copy button, and it works with scripts off.
 *
 *  `readonly` rather than `disabled`: a disabled input cannot be selected, which
 *  would leave the fallback unable to do the one thing it exists for.
 */
export function sharePanel({ links, url }) {
	if (!links?.length) return '';
	const item = (l) => `<li><a href="${escapeHtml(l.href)}" rel="noopener">`
		+ `<i class="mdi mdi-${escapeHtml(l.icon)}"></i> ${escapeHtml(l.label)}</a></li>`;
	return `<details class="switcher share">
<summary>Share</summary>
<ul class="share-targets">${LF}${links.map(item).join(LF)}${LF}</ul>
<label class="share-url">
<span class="dim">Link</span>
<input type="text" readonly value="${escapeHtml(url)}" aria-label="Link to this page">
</label>
</details>`;
}

/** The links along the bottom. A quiet inline row, which is what the baseball
 *  site has; the football site still uses pills.
 *
 *  The leaders page is `/coaches` or `/managers` depending on the sport, which
 *  is manifest vocabulary rather than a branch.
 */
/** Links to the pages that belong to the whole scope rather than one club.
 *
 *  These exist only where the scope holds more than one club, so the caller
 *  decides whether to render them at all. They were built without this and were
 *  therefore unreachable: /records and /schedule answered 200 and nothing on any
 *  page pointed at them, which no test catches — every route worked.
 *
 *  `current` dims the page you are already on rather than linking to it.
 */
/** Tabs across the sports a scope covers.
 *
 *  Only rendered when there is more than one — a single-sport deployment has
 *  nothing to switch between and gets nothing. "All" is a tab too, because the
 *  stacked view is still a legitimate thing to want and is what the unqualified
 *  URL shows.
 */
export function sportTabs(sports, current, view) {
	if (!sports || sports.length < 2) return '';
	const tab = (href, label, on) => (on
		? `<span class="here">${escapeHtml(label)}</span>`
		: `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
	return `<nav class="site-nav sport-tabs">${
		tab(`/${view}`, 'All', !current)
	}${sports.map((s) => tab(`/${s}/${view}`, s.toUpperCase(), s === current)).join('')}</nav>`;
}

export function leagueNav(current = null) {
	const items = [
		['/', 'All clubs', 'view-grid', 'clubs'],
		['/records', 'League records', 'trophy', 'records'],
		['/schedule', 'Schedule', 'calendar-month', 'schedule'],
		['/standings', 'Standings', 'table', 'standings'],
		['/champions', 'Champions', 'trophy-variant', 'champions'],
	];
	const icon = (name) => `<i class="mdi mdi-${escapeHtml(name)}"></i> `;
	return `<nav class="site-nav league-nav">${items.map(([href, label, ic, key]) => (key === current
		? `<span class="here">${icon(ic)}${escapeHtml(label)}</span>`
		: `<a href="${escapeHtml(href)}">${icon(ic)}${escapeHtml(label)}</a>`)).join('')}</nav>`;
}

/** Where the data came from, at the foot of the page.
 *
 *  Rendered from `credits` on the sports in scope, so a football-only
 *  deployment does not name Retrosheet and a baseball one does not name
 *  FiveThirtyEight. Crediting a source you do not use reads as carelessness at
 *  best, and a reader cannot tell it from a false claim.
 *
 *  A REQUIRED NOTICE IS PRINTED IN FULL, on its own, below the list. Retrosheet
 *  asks that their statement be reproduced; shortening it into a row of links
 *  would be crediting them without meeting the condition, which is the version
 *  of this that looks done and is not.
 */
export function creditLine(credits) {
	if (!credits?.length) return '';
	const link = (c) => (c.url
		? `<a href="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a>`
		: escapeHtml(c.name));
	// A licence is named AND linked, because naming one without a link is half
	// of what CC BY-SA asks for.
	const licence = (c) => (c.licence
		? ` <span class="dim">(<a href="${escapeHtml(c.licence.url)}">${escapeHtml(c.licence.name)}</a>)</span>`
		: '');
	const items = credits.map((c) => (c.note
		? `${link(c)}${licence(c)} <span class="dim">${escapeHtml(c.note)}</span>`
		: `${link(c)}${licence(c)}`));
	// The required statement, then anything the source asks to add. The notice
	// carries the page's own colour because Retrosheet's terms say "prominently";
	// `corrections` is not required and stays quiet, so the difference between an
	// obligation and a courtesy is visible rather than asserted.
	const notices = credits.filter((c) => c.notice || c.corrections || c.copyright)
		.map((c) => [
			c.notice ? `<p class="notice">${escapeHtml(c.notice)}</p>` : '',
			c.copyright ? `<p class="corrections">${escapeHtml(c.copyright)}</p>` : '',
			c.corrections ? `<p class="corrections">${escapeHtml(c.corrections)}</p>` : '',
		].filter(Boolean).join(LF));

	// CC BY asks that modification be indicated, and everything here IS modified:
	// games are reshaped into a neutral row, plays are dropped unless they scored,
	// records are recomputed. Said once for the whole footer rather than per
	// source, because it is true of every one of them and repeating it five times
	// would make it read as boilerplate rather than as a statement.
	const modified = credits.some((c) => c.licence)
		? '<p class="corrections">Data from these sources has been reshaped, combined and '
			+ 'recomputed; it is not presented as published.</p>'
		: '';
	return `<footer class="credits">
<p class="credit-list">Data from ${items.join(' · ')}.</p>
${[...notices, modified].filter(Boolean).join(LF)}
</footer>`;
}

export function siteNav(base, team, { league = false } = {}) {
	const leaders = team.nouns.leaderPlural;
	// Icon names are the sites' own choices: a trophy for records, crossed
	// swords for head-to-head, a chart for history, a whistle for the leaders.
	// The leaders page is `/coaches` or `/managers` by sport, and the noun comes
	// from the manifest rather than a branch here.
	//
	// It used to be in this list with no route behind it, linked from every club
	// page and answering 404 for as long as the nav existed — because
	// `reachable.test.js` asked whether every route is linked and never whether
	// every link is a route. It asks both now, which is why this line and the
	// route below it have to arrive together.
	//
	// The claim it was waiting on — that this "needs a curated coaches/managers
	// table nobody publishes" — turned out to be true for one era of one sport.
	// Retrosheet's game logs carry a manager for every baseball game back to
	// 1871, and nflverse's schedules have carried `home_coach` and `away_coach`
	// all along. Only NFL before 1999 needed curating.
	const items = [
		['', 'Home', 'home'],
		['/records', 'Records', 'trophy'],
		['/vs', 'Head-to-Head', 'sword-cross'],
		['/history', 'History', 'chart-line'],
		[`/${leaders}`, `${leaders[0].toUpperCase()}${leaders.slice(1)}`, 'whistle'],
	];
	// GitHub sits outside the club's own routes, so it is appended rather than
	// prefixed. The baseball site also carries Share and Disclaimer; Share needs
	// a dropdown and Disclaimer needs copy neither club has here yet.
	// Up to the whole scope, not just this club. Only where there is more than
	// one club, because under SCOPE=team:packers these routes do not exist.
	// The fourth field means "this route belongs to the scope, not the club", so
	// the club's base is not prefixed: /packers/records is the Packers' record
	// book and /records is the league's. Encoded as a flag rather than a marker
	// character in the href — the first draft used a NUL byte, which this repo
	// has already lost a session to and which its own source-hygiene test
	// forbids.
	if (league) {
		items.push(['/records', 'League records', 'trophy', true]);
		items.push(['/schedule', 'Schedule', 'calendar-month', true]);
		items.push(['/standings', 'Standings', 'table', true]);
		items.push(['/champions', 'Champions', 'trophy-variant', true]);
	}
	const external = [['https://github.com/rptetzloff/are-they-sports', 'GitHub', 'github']];
	const icon = (name) => `<i class="mdi mdi-${escapeHtml(name)}"></i> `;
	const links = items
		.map(([href, label, ic, scoped = false]) => {
			const to = scoped ? href : (`${base}${href}` || '/');
			return `<a href="${escapeHtml(to)}">${icon(ic)}${escapeHtml(label)}</a>`;
		})
		.concat(external.map(([href, label, ic]) => `<a href="${escapeHtml(href)}">${icon(ic)}${escapeHtml(label)}</a>`));
	return `<nav class="site-nav">${links.join('')}</nav>`;
}

/** What to call the list of title games.
 *
 *  The manifest's noun when every entry shares it — "World Series appearances"
 *  is right for baseball and always will be. Neutral when they do not, because
 *  the football list spans the NFL Championship and the Super Bowl and naming it
 *  after either misdescribes the rest.
 */
/** The all-time table on a league record book: one row per club.
 *
 *  A constant rather than a function, because these four columns do not depend
 *  on the rows the way the leaders table's optional ones do.
 */
export const ALL_TIME_COLUMNS = [
	column('club', 'Club', (c) => c.club ?? c.name ?? c.code),
	column('record', 'Record', (c) => c.wins, { numeric: true }),
	column('pct', 'Pct', (c) => c.winPct, { numeric: true }),
	// Sorted by the season a club STARTED, not by the "1897–2025" string. The
	// same reasoning as the leaders table's season range: there is no sensible
	// ordering of that text and the number behind it is what a reader means.
	column('from', 'Seasons', (c) => c.from, { numeric: true, defaultDir: 'asc' }),
];

/** A club's season-by-season table on the history page.
 *
 *  The two score columns are named by the sport — "Points For" and "Runs
 *  Scored" are not one phrase with a noun swapped — so this is a function of
 *  the manifest rather than a constant.
 */
/** What a season's final was, and how it went.
 *
 *  Three things were wrong with the boolean this replaced. It printed
 *  `nouns.championship` -- the club's MODERN word -- so Green Bay's 1936 read
 *  "Super Bowl", thirty years before there was one. It gave a season the club
 *  REACHED the final and lost the same blank cell as a season it missed the
 *  playoffs entirely, so 1997 and 1958 looked alike. And it could not say that
 *  1929 was decided on the standings, which is the whole reason
 *  `data/reference/nfl-champions.csv` exists.
 *
 *  The word comes from the DATA -- `championshipTitle` on the game, or the
 *  curated row -- and falls back to the manifest noun only when the data has no
 *  name to give, which is every baseball row: Retrosheet says a game was in the
 *  World Series without naming it.
 */
export function finalCell(p, team) {
	if (!p.final) {
		return p.lossless
			? `<span class="dim">${escapeHtml(team.nouns.losslessSeasonNoun)}</span>`
			: '';
	}
	const name = escapeHtml(p.final.title ?? team.nouns.championship);
	// "took" rather than "won" where there was no game to win. Printing it
	// identically to a final would claim the 1929 Packers beat somebody for it.
	if (p.final.won) {
		return `<span class="final-won">${p.final.method === 'standings' ? 'took ' : ''}${name}</span>`;
	}
	return `<span class="final-lost">lost ${name}</span>`;
}

export const historyColumns = (team) => [
	// Newest first, which is what this table already did with a `.reverse()`.
	// Left as it was: only the LEADERS default was asked to change, and moving
	// this one too would be an unrequested behaviour change hidden inside a
	// feature that is supposed to add a choice rather than take one away.
	column('season', 'Season', (r) => r.season, { numeric: true, defaultDir: 'desc' }),
	// NOT sortable, and deliberately. A history point carries `record` as the
	// string "12–0–1" and no win count, so there is nothing here to order by:
	// sorting the text would put 9–7 above 12–4. `Pct` is the next column and
	// orders the same rows the way a reader clicking "Record" would mean.
	{ key: null, label: 'Record' },
	column('pct', 'Pct', (r) => r.pct, { numeric: true }),
	column('pf', team.nouns.scoreForLabel, (r) => r.pf, { numeric: true }),
	column('pa', team.nouns.scoreAgainstLabel, (r) => r.pa, { numeric: true }),
	// The title marker. Nothing to order by that a reader would ask for -- and
	// headed now, because the cell says three different things (won it, lost it,
	// finished unbeaten) and an unlabelled column of those reads as a fourth.
	{ key: null, label: 'Final' },
];

/** A division's table on the standings page.
 *
 *  `gb` is games behind, which is already the order the table arrives in, so it
 *  is the fallback rather than a column anyone needs to click.
 */
export const standingsColumns = (ties) => [
	column('club', 'Club', (c) => c.club),
	column('w', 'W', (c) => c.w, { numeric: true }),
	column('l', 'L', (c) => c.l, { numeric: true }),
	...(ties ? [column('t', 'T', (c) => c.t, { numeric: true })] : []),
	column('pct', 'Pct', (c) => c.pct, { numeric: true }),
	column('gb', 'GB', (c) => c.gb, { numeric: true, defaultDir: 'asc' }),
];

/** A table header whose columns are links that sort it.
 *
 *  One implementation for every `.league-table`, because they already share
 *  markup and four copies of this would drift the way the two sites drifted.
 *  The logic is in lib/sort.js; this is only the markup.
 *
 *  A column with no `key` renders as plain text rather than a link — some
 *  columns have nothing to sort by, and a header that looks clickable and is
 *  not is worse than one that does not.
 *
 *  `aria-sort` is on the cell rather than the link. It is the CELL that is
 *  sorted, and a reader on a screen reader is told which column the table is
 *  ordered by without having to infer it from an arrow they cannot see.
 */
export function sortableHead(columns, { current = null, path = '', params = null } = {}) {
	const ARROW = { ascending: '▲', descending: '▼' };
	return `<tr>${columns.map((c) => {
		if (!c.key) return `<th>${escapeHtml(c.label ?? '')}</th>`;
		const state = sortState(c, current);
		const href = sortHref(path, params, c, current);
		return `<th${state ? ` aria-sort="${state}"` : ''}>`
			+ `<a class="sort${state ? ' sorted' : ''}" href="${escapeHtml(href)}">`
			+ `${escapeHtml(c.label)}`
			+ (state ? `<span class="sort-arrow" aria-hidden="true">${ARROW[state]}</span>` : '')
			+ '</a></th>';
	}).join('')}</tr>`;
}

/** What each record card is CALLED, and what it says it counts.
 *
 *  Copy only: no numbers, so it answers for a slug without a record book being
 *  computed first. That is what lets `/records/{slug}` describe itself in its
 *  own title and social preview, and what lets a test walk every slug a sport
 *  publishes and check there is copy for it.
 *
 *  Icons are the two sites' own, read out of their CARDS catalogue rather than
 *  chosen here. `appearances` is optional and only sharpens one heading: with
 *  the record book to hand, a club whose titles are all one competition gets
 *  "Super Bowl appearances" instead of the generic word.
 *
 *  The notes say what the list MEASURES, because several of these are guessable
 *  wrongly. "Best starts" is wins to open a season, not the best opening game;
 *  "biggest wins" includes playoffs where "best seasons" does not.
 */
export function recordCopy(team, appearances = []) {
	const lossless = team.nouns.losslessSeasonNoun;
	return {
		'best-seasons': { icon: 'star-outline', heading: 'Best seasons', note: 'Highest regular-season win percentage' },
		'worst-seasons': { icon: 'emoticon-sad-outline', heading: 'Worst seasons', note: 'Lowest regular-season win percentage' },
		'best-starts': { icon: 'rocket-launch-outline', heading: 'Best starts', note: 'Wins to open a season' },
		'worst-starts': { icon: 'trending-down', heading: 'Worst starts', note: 'Losses to open a season' },
		'lossless-seasons': {
			icon: 'shield-check-outline',
			heading: `${lossless[0].toUpperCase()}${lossless.slice(1)} seasons`,
			// Not "perfect": 1929 went 12-0-1, which is undefeated and is not
			// perfect. The noun is the sport's, for exactly that reason.
			note: `Regular seasons finished ${lossless}`,
		},
		'win-streaks': { icon: 'fire', heading: 'Win streaks', note: 'Consecutive wins' },
		'losing-streaks': { icon: 'snowflake', heading: 'Losing streaks', note: 'Consecutive losses' },
		'lopsided-wins': { icon: 'scoreboard-outline', heading: 'Biggest wins', note: 'Largest margins of victory' },
		'worst-losses': { icon: 'thumb-down-outline', heading: 'Worst losses', note: 'Largest margins of defeat' },
		'playoff-appearances': { icon: 'tournament', heading: 'Postseason', note: 'Seasons that reached the playoffs' },
		'championship-appearances': {
			icon: 'trophy',
			heading: titleHeading(appearances, team),
			// Same rule as the heading, and for the same reason: a club whose
			// list spans eras gets "the final" rather than a word that is wrong
			// for most of the rows under it. The heading said "Championship
			// games" while this said "reached the Super Bowl", over a list that
			// is mostly NFL Championships.
			note: `Seasons that reached ${titleNoun(appearances, team)}`,
		},
		'ties': { icon: 'equal', heading: 'Ties', note: 'Games that ended level' },
	};
}

/** Every slug there is copy and a list for, in the order they were written.
 *
 *  The fallback when a sport declares no selection, so a new sport renders the
 *  whole catalogue rather than an empty page. Written out rather than derived
 *  from `recordCopy`, which would need a fake club to call: a test asserts the
 *  three lists -- this, the copy and the entries -- name the same slugs, which
 *  is the check that a derivation would have made unfalsifiable.
 */
export const RECORD_SLUGS = [
	'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
	'lossless-seasons', 'win-streaks', 'losing-streaks', 'lopsided-wins',
	'worst-losses', 'playoff-appearances', 'championship-appearances', 'ties',
];

/** "the Super Bowl", "the World Series", or "the final" where the club has
 *  played for more than one thing.
 *
 *  Split from `titleHeading` rather than inlined because a heading is a noun
 *  phrase ("Super Bowl appearances") and a sentence needs an article, and
 *  gluing "the" onto the heading gives "the Championship games".
 */
/** "Super Bowls", "NFL Championships", "World Series".
 *
 *  Appending an "s" is the version this replaced, and it produced "World
 *  Seriess" the moment baseball titles started carrying their name -- the same
 *  shape as the "2 clashs" this repo already records, arriving in a second
 *  place. A name ending in "s" is already its own plural, which is true of
 *  every -s proper noun and not a special case for one league.
 *
 *  These are names from the DATA, not from the manifest, so a `championshipPlural`
 *  noun would not have reached them: `title` is whatever the load wrote, and the
 *  next league to arrive brings its own word without editing any file here.
 */
export const pluralTitle = (name, n) => (n === 1 || /s$/i.test(name) ? name : `${name}s`);

export function titleNoun(appearances, team) {
	const names = new Set(appearances.map((a) => a.title).filter(Boolean));
	if (names.size === 1) return `the ${[...names][0]}`;
	if (names.size === 0) return `the ${team.nouns.championship}`;
	return 'the final';
}

export function titleHeading(appearances, team) {
	const titles = new Set(appearances.map((a) => a.title).filter(Boolean));
	if (titles.size === 1) return `${[...titles][0]} appearances`;
	if (titles.size === 0) return `${team.nouns.championship} appearances`;
	return 'Championship games';
}

/** The filters, as a form.
 *
 *  A GET form and nothing else: the two sites wire three controls to an `input`
 *  and a `change` handler and re-render in the browser, which is not reachable
 *  from `node --test`. Here the filters are in the URL, so the filtered page is
 *  a link somebody can send, a bookmark that still works, and a thing a test can
 *  assert.
 *
 *  What it costs is an Apply button. A `<select>` cannot submit its own form
 *  without a script, so the reader clicks twice where the sites need one. That
 *  is the honest price and it is stated here rather than discovered.
 *
 *  The sort travels as hidden fields. Without them, applying a filter would
 *  silently throw away the column the reader had chosen -- and `sortHref`
 *  already carries the filters the other way, so the pair keeps both.
 */
export function h2hControls({ path, params, current = false, hasHistorical = false }) {
	const get = (k, fallback = '') => escapeHtml(params?.get?.(k) ?? fallback);
	const option = (name, value, label) => `<option value="${escapeHtml(value)}"${
		(params?.get?.(name) ?? 'all') === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
	const hidden = ['sort', 'dir']
		.filter((k) => params?.get?.(k))
		.map((k) => `<input type="hidden" name="${k}" value="${get(k)}">`).join('');
	return `<form class="filters" method="get" action="${escapeHtml(path)}">
${hidden}
<label class="field"><span>Filter</span>
<input type="search" name="q" value="${get('q')}" placeholder="Opponent name" autocomplete="off"></label>
<label class="field"><span>Venue</span>
<select name="venue">${option('venue', 'all', 'All venues')}${option('venue', 'home', 'Home')}${option('venue', 'away', 'Away')}</select></label>
<label class="field"><span>Games</span>
<select name="type">${option('type', 'all', 'All games')}${option('type', 'regular', 'Regular season')}${option('type', 'playoffs', 'Postseason')}</select></label>
${hasHistorical ? `<label class="field check"><input type="checkbox" name="current" value="1"${current ? ' checked' : ''}> <span>Current franchises only</span></label>` : ''}
<button type="submit">Apply</button>
${[...(params ?? [])].length ? `<a class="clear" href="${escapeHtml(path)}">Clear</a>` : ''}
</form>`;
}

/** The columns of the opponents table.
 *
 *  Record sorts by win percentage, not by the string: "10\u201310" and
 *  "2\u20131" are both alphabetical nonsense and nobody clicking Record means
 *  either. Postseason is deliberately keyless -- most rows have none, and a
 *  column that sorts almost everything into one tie is a header that looks
 *  clickable and does nothing.
 */
export const h2hColumns = (team) => [
	column('opponent', 'Opponent', (o) => o.name),
	column('games', team.nouns.meetingPlural[0].toUpperCase() + team.nouns.meetingPlural.slice(1),
		(o) => o.games, { numeric: true }),
	column('record', 'Record', (o) => o.winPct, { numeric: true }),
	// The number the Record column is sorted BY, printed. Both sites carry it
	// and the port dropped it, which left a table that reordered on a value
	// nowhere on the page. Same key, deliberately: clicking either heading means
	// the same thing, and giving them different orders would be worse.
	column('pct', 'Win %', (o) => o.winPct, { numeric: true }),
	{ key: null, label: 'Postseason' },
];

/** Every opponent a club has played, most-played first by default. */
export function headToHeadPage({
	team, colors, opponents, resolve, base, siteNavHtml = '', switcher = '',
	sort = null, path = '', params = null,
	/** How many opponents there are with no filter applied.
	 *
	 *  Passed in rather than counted here, because `opponents` is already the
	 *  filtered list -- and "23 opponents" over a filtered table, with nothing
	 *  saying so, is the failure this whole feature could most easily ship with.
	 */
	total = null,
	hasHistorical = false,
}) {
	// Resolved once, before sorting, because the sort is BY the name and calling
	// the resolver inside a comparator would run it O(n log n) times to get the
	// same answer.
	// Named as they are called NOW, not as they were called at the last meeting.
	// Asking the resolver with no date gives the franchise's current era, and
	// clamps to the final one for a franchise that folded -- so the Raiders are
	// the Las Vegas Raiders and the Rock Island Independents stay themselves.
	//
	// The obvious version, naming from the last meeting, is wrong twice over: it
	// listed "Oakland Raiders" among CURRENT franchises, and it made the name a
	// function of the filters, because under `?venue=home` the last meeting is a
	// different game and can fall in an earlier era.
	const named = opponents.map((o) => ({ ...o, name: resolve(o.code).name }));
	const columns = h2hColumns(team);
	const rows = sortRows(named, columns, sort, (o) => o.code);

	const row = (o) => {
		const above = o.wins > o.losses ? 'win' : o.wins < o.losses ? 'loss' : 'tie';
		return `<tr>
<td><a href="${escapeHtml(base)}/vs/${escapeHtml(o.slug)}">${escapeHtml(o.name)}</a></td>
<td>${o.games}</td>
<td class="res ${above}">${escapeHtml(o.record)}</td>
<td>${escapeHtml(pct(o.winPct, 3))}</td>
<td>${o.playoffRecord ? escapeHtml(o.playoffRecord) : '<span class="dim">\u2014</span>'}</td>
</tr>`;
	};

	// The count says both numbers whenever they differ. A filtered table that
	// reports only its own length reads as the club's whole history.
	const count = total !== null && total !== rows.length
		? `${rows.length} of ${total} opponents`
		: `${rows.length} opponents`;

	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)} head-to-head</h1>`,
		h2hControls({ path, params, current: params?.get?.('current') === '1', hasHistorical }),
		`<p class="meta">${escapeHtml(count)}</p>`,
		rows.length
			? `<section class="panel"><table class="schedule h2h">
<thead>${sortableHead(columns, { current: sort, path, params })}</thead>
<tbody>${LF}${rows.map(row).join(LF)}${LF}</tbody></table></section>`
			// Named, not blank. An empty table under a filter box is the one
			// state where a reader cannot tell a broken page from a narrow one.
			: '<section class="panel"><p class="dim">No opponents match those filters.</p></section>',
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">\u2190 Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);
	return page({ title: `${team.nouns.fullName} head-to-head`, colors, body: body.join(LF) });
}

/** One opponent, in full.
 *
 *  The breakdown is ported from the baseball site's `computeOpponentDetail` and
 *  `focusCardHtml`, which the football site does not have -- 206 lines of
 *  `h2h-core.js` there against 118 here, and this was most of the difference.
 *  Nothing in it is baseball, so both sports get it.
 *
 *  The site renders it as a focus CARD injected above a table, closable, pushed
 *  into history by a click handler. Here it is simply the page, because the
 *  page already exists at its own URL -- the card was the site's way of getting
 *  a shareable address out of a single-page app, and this repo has the address.
 */
export function opponentPage({
	team, colors, opponent, name, detail = null, resolve, base,
	siteNavHtml = '', switcher = '',
}) {
	const o = opponent;
	const game = (g) => `<tr>
<td><a href="${escapeHtml(base)}/${g.season}">${g.season}</a></td>
<td>${escapeHtml(formatDate(g.date))}</td>
<td class="res ${g.result === 'WIN' ? 'win' : g.result === 'LOSS' ? 'loss' : 'tie'}">${g.result[0]} ${g.pf}\u2013${g.pa}</td>
<td>${g.home ? '' : '<span class="dim">away</span>'}</td>
<td>${g.playoff ? '<span class="dim">postseason</span>' : ''}</td>
</tr>`;
	// Newest first: the last meeting is the one anyone looks for.
	const meetings = [...o.meetings].reverse();

	const pctOf = (n) => (n >= 1 ? '1.000' : n.toFixed(3).replace(/^0/, ''));
	// A split with no games says so instead of printing "0-0 (.000)", which
	// reads as a record rather than as an absence.
	const split = (label, t) => `<tr><th>${escapeHtml(label)}</th>`
		+ (t.games
			? `<td>${escapeHtml(t.record)}</td><td>${t.games}</td><td>${escapeHtml(pctOf(t.winPct))}</td>`
			: '<td class="dim" colspan="3">none</td>')
		+ '</tr>';

	const signed = (n) => (n > 0 ? `+${n}` : String(n));
	const stat = (label, value) => `<tr><th>${escapeHtml(label)}</th><td colspan="3">${value}</td></tr>`;

	const breakdown = [];
	if (detail) {
		// The three number columns are headed once and the heading is reused by
		// the era table below, because they are the same three numbers. A column
		// of bare percentages with nothing over it is the kind of thing a reader
		// has to decode from the values.
		const splitHead = `<thead><tr><th></th><th>Record</th><th>${
			escapeHtml(team.nouns.meetingPlural[0].toUpperCase() + team.nouns.meetingPlural.slice(1))
		}</th><th>Win %</th></tr></thead>`;
		breakdown.push(`<section class="record-card league-wide"><h2>Splits</h2>
<table class="schedule h2h">${splitHead}<tbody>
${split('Overall', detail.overall)}
${detail.recent.games === detail.overall.games ? '' : split(`Last ${detail.recent.games}`, detail.recent)}
${split('Home', detail.home)}
${split('Away', detail.away)}
${split('Regular season', detail.regular)}
${split('Postseason', detail.post)}
</tbody></table></section>`);

		const rows = [
			// One row for both directions, so the label is built rather than taken:
			// `scoreForLabel` is "Points For" and "Runs Scored", which do not share a
			// second half to append "/ against" to. `scoreNoun` does.
			stat(`${team.nouns.scoreNoun[0].toUpperCase()}${team.nouns.scoreNoun.slice(1)} for / against`,
				`${detail.pointsFor} <span class="dim">/</span> ${detail.pointsAgainst} `
				+ `<span class="dim">(${escapeHtml(signed(detail.differential))})</span>`),
			detail.longestWinStreak > 1 ? stat('Longest win streak', `${detail.longestWinStreak}`) : '',
			detail.longestLossStreak > 1 ? stat('Longest losing streak', `${detail.longestLossStreak}`) : '',
			detail.shutouts ? stat('Shutouts', `${detail.shutouts}`) : '',
			detail.shutoutLosses ? stat('Shutout losses', `${detail.shutoutLosses}`) : '',
			o.biggestWin ? stat('Biggest win', `${o.biggestWin.pf}\u2013${o.biggestWin.pa} `
				+ `<a class="season-link dim" href="${escapeHtml(base)}/${o.biggestWin.season}">${o.biggestWin.season}</a>`) : '',
			o.worstLoss ? stat('Worst loss', `${o.worstLoss.pf}\u2013${o.worstLoss.pa} `
				+ `<a class="season-link dim" href="${escapeHtml(base)}/${o.worstLoss.season}">${o.worstLoss.season}</a>`) : '',
		].filter(Boolean);
		breakdown.push(`<section class="record-card league-wide"><h2>Notes</h2>
<table class="schedule h2h"><tbody>${rows.join(LF)}</tbody></table></section>`);

		// Only when the franchise has been called more than one thing across
		// these meetings. `opponentDetail` returns an empty list otherwise, so a
		// single-era opponent gets no heading over a row repeating the total.
		if (detail.eras.length) {
			breakdown.push(`<section class="record-card league-wide"><h2>By era</h2>
<table class="schedule h2h">${splitHead}<tbody>
${detail.eras.map((e) => split(e.name, e)).join(LF)}
</tbody></table></section>`);
		}
	}

	const body = [
		`<h1>${escapeHtml(team.nouns.team)} vs ${escapeHtml(name)}</h1>`,
		`<p class="answer ${o.wins > o.losses ? 'undefeated' : 'no'}">${escapeHtml(o.record)}</p>`,
		`<p class="record"><span class="sub">${o.playoffRecord ? `Postseason ${escapeHtml(o.playoffRecord)} \u00b7 ` : ''}${escapeHtml(streakSentence(o.streak))}</span>${o.games} ${escapeHtml(o.games === 1 ? team.nouns.meetingNoun : team.nouns.meetingPlural)} since ${o.first.season}</p>`,
		...breakdown,
		`<section class="record-card league-wide"><h2>Every ${escapeHtml(team.nouns.meetingNoun)}</h2>
<table class="schedule h2h">
<thead><tr><th>Season</th><th>Date</th><th>Result</th><th></th><th></th></tr></thead>
<tbody>${LF}${meetings.map(game).join(LF)}${LF}</tbody></table></section>`,
		`<nav class="season-nav"><a href="${escapeHtml(base)}/vs">\u2190 All opponents</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);
	return page({ title: `${team.nouns.team} vs ${name}`, colors, body: body.join(LF) });
}

/** A season this club never played.
 *
 *  Reachable by switching clubs from a season page: the Vikings have no 1929,
 *  and sending someone to a bare 404 for asking a reasonable question is a poor
 *  answer. Says what the club's range is and offers both ends of it.
 */
/** A heading and a sentence, for the cases that are neither a club nor an error.
 *
 *  Written because the first attempt at the empty-database page reused
 *  missingSeasonPage, which dereferences `team.nouns.fullName` — so the page
 *  meant to stop a crash would have crashed in the same place, one line further
 *  in.
 */
export function noticePage({ heading, message, colors, nav = '' }) {
	return page({
		title: heading,
		colors,
		body: [
			`<h1>${escapeHtml(heading)}</h1>`,
			`<p class="record">${escapeHtml(message)}</p>`,
			nav,
		].filter(Boolean).join(LF),
	});
}

export function missingSeasonPage({ team, season, colors, base, first, last, switcher = '', siteNavHtml = '' }) {
	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)}</h1>`,
		`<p class="answer">${escapeHtml(String(season))}?</p>`,
		`<p class="record">The ${escapeHtml(team.nouns.team)} did not play that season.</p>`,
		first && last
			? `<nav class="season-nav"><a href="${escapeHtml(base)}/${escapeHtml(first)}">${escapeHtml(first)}</a><span class="current">to</span><a href="${escapeHtml(base)}/${escapeHtml(last)}">${escapeHtml(last)}</a></nav>`
			: '<p class="meta">No seasons on record.</p>',
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);
	return page({ title: `${team.nouns.fullName} ${season}`, colors, body: body.join(LF) });
}

/** The record book.
 *
 *  Twelve lists, each a card. The football site names them in site.js and this
 *  keeps the same set and the same order, so the two pages read alike.
 *
 *  A list with nothing in it is rendered saying so rather than omitted: a club
 *  with no ties and a club whose ties failed to load look identical if the card
 *  simply disappears.
 */
export function recordsPage({
	team, colors, records, resolve, base, siteNavHtml = '', switcher = '',
	slugs = null, focus = null,
}) {
	const name = (code, season) => escapeHtml(resolve(code, { season: String(season) }).name);
	const item = (text) => `<li>${text}</li>`;

	// Every season named here is a link to that season. A record book whose
	// entries cannot be looked at is a list of trivia; the whole reason to read
	// "1929 12–0–1" is to go and see it.
	const yr = (season, cls = '') => `<a class="season-link ${cls}" href="${escapeHtml(base)}/${escapeHtml(String(season))}">${escapeHtml(String(season))}</a>`;

	const seasonList = (list) => list.map((r) => item(
		`${yr(r.season, 'strong')} ${escapeHtml(r.record)}`));
	const startList = (list) => list.map((r) => item(
		`<b>${r.games}</b> to start ${yr(r.season, 'dim')}`));
	const streakList = (list) => list.map((r) => item(
		`<b>${r.games}</b> ${yr(r.startSeason, 'dim')}${r.startSeason === r.endSeason ? '' : `<span class="dim">–</span>${yr(r.endSeason, 'dim')}`}`));
	const gameList = (list) => list.map((g) => item(
		`<b>${g.pf}–${g.pa}</b> ${name(g.opponent, g.season)} ${yr(g.season, 'dim')}`));
	// A title taken on the final standings says so instead of saying "won".
	// There was no game and nobody to beat, and printing it identically to a
	// final would claim the 1929 Packers beat somebody for it.
	const titleList = (list) => list.map((a) => item(
		`${yr(a.season, 'strong')} ${a.method === 'standings' ? 'took' : a.won ? 'won' : 'lost'} `
		+ `<span class="dim">${escapeHtml(a.title ?? team.nouns.championship)}`
		+ `${a.method === 'standings' ? ' on the standings' : ''}</span>`));
	const playoffList = (list) => list.map((a) => item(
		`${yr(a.season, 'strong')} ${escapeHtml(a.record)}${a.championship ? ' <span class="dim">title game</span>' : ''}`));

	const copy = recordCopy(team, records.championshipAppearances);

	// What each card LISTS, against what each card SAYS, which is `recordCopy`
	// above. The split is the two sites' own: `records.js` there carries a CARDS
	// catalogue of copy and `site.js` carries `SITE.records`, the selection. Here
	// the selection moved one further out, into `sports/<id>.js`, so a sport
	// without a lossless season omits the slug rather than this file knowing
	// which sports have one.
	const ENTRIES = {
		'best-seasons': () => seasonList(records.bestSeasons),
		'worst-seasons': () => seasonList(records.worstSeasons),
		'best-starts': () => startList(records.bestStarts),
		'worst-starts': () => startList(records.worstStarts),
		'lossless-seasons': () => seasonList(records.losslessSeasons),
		'win-streaks': () => streakList(records.winStreaks),
		'losing-streaks': () => streakList(records.loseStreaks),
		'lopsided-wins': () => gameList(records.lopsidedWins),
		'worst-losses': () => gameList(records.lopsidedLosses),
		'playoff-appearances': () => playoffList(records.playoffAppearances.slice(0, 8)),
		'championship-appearances': () => titleList(records.championshipAppearances),
		'ties': () => gameList(records.ties.slice(0, 8)),
	};

	// A slug a sport publishes that nothing here can draw is a configuration
	// mistake and says so, rather than quietly rendering one card fewer. The
	// football site does the same, for the same reason.
	const cards = (slugs ?? RECORD_SLUGS).filter((slug) => {
		if (ENTRIES[slug]) return true;
		console.warn(`records: no card defined for ${slug}`);
		return false;
	}).map((slug) => ({ slug, ...copy[slug], items: ENTRIES[slug]() }));

	// A focused card is drawn FIRST, and that is a recorded deviation. The two
	// sites keep the order and call `scrollIntoView`, which needs a script; the
	// outcome a reader wants is the same either way -- open the permalink and the
	// record you asked for is the one in front of you. Reordering buys that
	// without one, at the cost of the sport's order holding on eleven pages
	// out of twelve.
	//
	// The rejected alternative was linking each heading to `#card-{slug}` so the
	// browser jumps. It works from this page and does nothing for the case that
	// matters, which is somebody opening a link somebody else shared: the
	// fragment is not in the URL they were given.
	//
	// Partitioned rather than sorted. `sort` with a "this one first" comparator
	// is not a consistent ordering -- it says nothing about two cards that are
	// both not the focus -- and an engine is entitled to do anything with that.
	const ordered = focus
		? [...cards.filter((c) => c.slug === focus), ...cards.filter((c) => c.slug !== focus)]
		: cards;

	// Each heading links to its own card. The permalink existed as a route long
	// before anything on the page pointed at it, which is the reachability
	// failure this repo already records from the leaders page: the test asked
	// whether every link was a route and not whether every route was linked.
	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)} records</h1>`,
		`<p class="meta">${escapeHtml(String(records.seasonRange.first))}–${escapeHtml(String(records.seasonRange.last))}</p>`,
		`<div class="records">${ordered.map((c) => `<section class="record-card${
			c.slug === focus ? ' record-card-focus' : ''}" id="card-${escapeHtml(c.slug)}">
<h2><i class="mdi mdi-${escapeHtml(c.icon)}"></i> <a href="${escapeHtml(base)}/records/${escapeHtml(c.slug)}">${escapeHtml(c.heading)}</a></h2>
<p class="record-note">${escapeHtml(c.note)}</p>
${c.items.length ? `<ol>${c.items.join('')}</ol>` : '<p class="dim">None on record.</p>'}
</section>`).join(LF)}</div>`,
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);

	// A permalink names ITS record, not the page it sits on. Twelve URLs sharing
	// one title was the visible half of the defect this replaced: each also
	// declared itself canonical, so twelve addresses claimed to be the canonical
	// copy of one page.
	const focused = focus ? cards.find((c) => c.slug === focus) : null;
	const title = focused
		? `${team.nouns.fullName} ${focused.heading.toLowerCase()}`
		: `${team.nouns.fullName} records`;

	return page({ title, colors, body: body.join(LF) });
}

/** The record book for every club in scope.
 *
 *  Same cards as a club's own, with the club named on every line — that is the
 *  only real difference, and it is why this reuses `computeRecords` per club
 *  rather than a second implementation. Plus two views that exist only here: an
 *  all-time table, and who has won what.
 *
 *  Each club links to its own record book, because "Bears 1934 13–0" is a thing
 *  you want to go and look at, exactly as the season links on a club page are.
 */
export function leagueRecordsPage({
	league, heading, colors, clubs = [], switcher = '', label = null, tabs = '',
	sort = null, path = '', params = null,
	/** Further leagues to render below the first, as `[{ label, league }]`.
	 *
	 *  A scope covering more than one sport used to merge them into one set of
	 *  rankings and print a note admitting the lists compared clubs that never
	 *  played each other. The note was true and the page was still wrong: a
	 *  football season ranked against a baseball season is not a comparison, it
	 *  is a pile. Each sport gets its own block. */
	more = [],
	// Falls back to showing the code. Every caller passes a real resolver; the
	// default exists so a page with games in it cannot throw on a missing
	// argument, which an empty-league test would never have caught.
	resolve = (code) => ({ name: code }),
}) {
	const item = (text) => `<li>${text}</li>`;
	// Keyed by sport AND id. The id alone is not unique across sports — there is
	// an NFL Giants and a baseball Giants, and the same for the Cardinals — so a
	// map keyed on it collapses each pair and links one of them to the other's
	// page. Keyed by display name before that, which matched nothing at all.
	const base = new Map(clubs.map((c) => [`${c.sport}/${c.teamId}`, c.url]));
	const urlFor = (e) => base.get(`${e.sport}/${e.teamId}`) ?? null;
	// The club's name, linked to its own records when this deployment can serve
	// them. A club with no page still gets named rather than dropped.
	const who = (entry) => {
		const url = urlFor(entry);
		const label = escapeHtml(entry.club);
		return url ? `<a class="season-link strong" href="${escapeHtml(url)}/records">${label}</a>` : `<b>${label}</b>`;
	};

	const seasonList = (list) => list.map((r) => item(
		`${who(r)} <span class="dim">${escapeHtml(String(r.season))}</span> ${escapeHtml(r.record)}`));
	const startList = (list) => list.map((r) => item(
		`${who(r)} <b>${r.games}</b> <span class="dim">to start ${escapeHtml(String(r.season))}</span>`));
	const streakList = (list) => list.map((r) => item(
		`${who(r)} <b>${r.games}</b> <span class="dim">${escapeHtml(String(r.startSeason))}${r.startSeason === r.endSeason ? '' : `–${escapeHtml(String(r.endSeason))}`}</span>`));
	// Both clubs. A tie has two of them and a blowout has one on the receiving
	// end, and naming only the club whose row survived deduplication tells half
	// the story — "Packers 40–40, 2025" leaves out who they tied. The opponent
	// links too when this deployment serves it.
	const opponentOf = (resolve) => (g) => {
		const label = escapeHtml(resolve(g.opponent, { season: String(g.season) }).name);
		const url = g.opponentId ? base.get(`${g.sport}/${g.opponentId}`) : null;
		return url ? `<a class="season-link" href="${escapeHtml(url)}/records">${label}</a>` : `<span class="dim">${label}</span>`;
	};
	const gameList = (resolve) => (list) => list.map((g) => item(
		`${who(g)} <b>${g.pf}–${g.pa}</b> ${opponentOf(resolve)(g)} <span class="dim">${escapeHtml(String(g.season))}</span>`));
	// Each championship listed and marked by what it was, rather than a bare
	// "10 of 13" — which is ten wins from thirteen finals, reads as a title
	// count, and for the Packers collides with their thirteen actual
	// championships. A Super Bowl is emphasised over an older league title
	// because that is the one anyone is counting.
	// Grouped by what the championship WAS, with the group named. Colour alone
	// cannot carry this: a league page renders on the neutral palette, where the
	// accent is plain white, so "Super Bowl" and "NFL Championship" differed only
	// by filled-versus-outlined and were near indistinguishable in a screenshot.
	// A label works in any palette.
	//
	// Super Bowls lead, because that is the number anyone is counting.
	const RANK = (name) => (name === 'Super Bowl' ? 0 : name ? 1 : 2);
	const titleList = (list) => list.map((t) => {
		const groups = new Map();
		for (const w of t.wins) {
			const name = w.title ?? 'Championship';
			if (!groups.has(name)) groups.set(name, []);
			groups.get(name).push(w.season);
		}
		const ordered = [...groups.entries()].sort((a, b) => RANK(a[0]) - RANK(b[0]) || a[0].localeCompare(b[0]));
		const rows = ordered.map(([name, seasons]) => `<span class="title-group">
<span class="title-kind ${RANK(name) === 0 ? 'sb' : 'other'}">${escapeHtml(pluralTitle(name, seasons.length))} <b>${seasons.length}</b></span>
<span class="title-chips">${seasons.map((y) => `<span class="title-chip ${RANK(name) === 0 ? 'sb' : 'title'}">${escapeHtml(String(y))}</span>`).join('')}</span>
</span>`);
		return item(`<span class="title-row">${who(t)} <b>${t.won}</b>`
			+ (t.lost.length ? ` <span class="dim">· ${t.lost.length} final${t.lost.length === 1 ? '' : 's'} lost</span>` : '')
			+ `</span>${rows.join('')}`);
	});

	// Everything above depends only on the club list and the resolver, so it is
	// built once. Everything below depends on ONE league and is built per sport.
	const blockFor = (league, label, resolve) => {
	const games = gameList(resolve);
	// A table rather than a list: this is the one card where the columns line up
	// and reading down them is the point.
	const allTime = league.allTime.length
		? `<table class="league-table"><thead>${sortableHead(ALL_TIME_COLUMNS, { current: sort, path, params })}</thead><tbody>${
			sortRows(league.allTime, ALL_TIME_COLUMNS, sort, (c) => c.club).map((c) => `<tr><td>${who(c)}</td><td>${escapeHtml(c.record)}</td><td>${escapeHtml(pct(c.winPct))}</td><td class="dim">${escapeHtml(String(c.from))}–${escapeHtml(String(c.to))}</td></tr>`).join('')
		}</tbody></table>`
		: '<p class="dim">No games on record.</p>';

	const cards = [
		['Best seasons', seasonList(league.bestSeasons)],
		['Worst seasons', seasonList(league.worstSeasons)],
		['Win streaks', streakList(league.winStreaks)],
		['Losing streaks', streakList(league.loseStreaks)],
		['Best starts', startList(league.bestStarts)],
		['Worst starts', startList(league.worstStarts)],
		['Unbeaten seasons', seasonList(league.losslessSeasons)],
		['Biggest wins', games(league.lopsidedWins)],
		['Championships', titleList(league.titles)],
		// Named for what it is. This is the one card ordered by recency rather
		// than by rank, so without saying so a reader has no way to tell the list
		// was cut — every other card is a top-N and looks like one.
		[league.tiesTotal > league.ties.length ? `Most recent ties` : 'Ties',
			games(league.ties),
			league.tiesTotal > league.ties.length
				? `<p class="dim">${league.ties.length} of ${league.tiesTotal}</p>` : ''],
	];
	// Said, not inferred. Every championship here comes from a game that was
	// played, so a title decided any other way is absent — the NFL awarded its
	// first nine by standings, with no championship game before 1933, which is
	// three of Green Bay's. Recording those needs a reference table, and
	// inventing them from memory is what put the wrong colours on two clubs.
	const titleNote = league.titles.length
		? '<p class="dim">Championships decided without a final — the NFL awarded its earliest by standings — are not in the game data and are not listed.</p>'
		: '';

	const out = [];
	// Labelled only when there is another block to tell it apart from.
	if (label) out.push(`<h2 class="league-heading">${escapeHtml(label)}</h2>`);
	out.push(`<p class="meta">${escapeHtml(String(league.seasonRange.first))}–${escapeHtml(String(league.seasonRange.last))} · ${
		league.clubs} club${league.clubs === 1 ? '' : 's'}</p>`);
	out.push(`<section class="record-card league-wide"><h2>All-time</h2>${allTime}</section>`);
	out.push(`<div class="records">${cards.map(([h, items, note = '']) => `<section class="record-card">
<h2>${escapeHtml(h)}</h2>
${items.length ? `<ol>${items.join('')}</ol>` : '<p class="dim">None on record.</p>'}
${h === 'Championships' ? titleNote : note}</section>`).join(LF)}</div>`);
	return out.join(LF);
	};

	const groups = [{ label, league, resolve }, ...more];
	const body = [
		`<h1>${escapeHtml(heading)} records</h1>`,
		// At the TOP. It was only at the foot of the page, which on an `all`
		// scope is below sixty-two clubs' worth of record lists — a link nobody
		// scrolls far enough to find is not a way back. It stays at the bottom
		// too, for anyone who did scroll.
		leagueNav('records'),
		tabs,
		// One block per sport. Only labelled when there is more than one, so a
		// single-sport scope reads exactly as it did.
		...groups.map((g) => blockFor(g.league, groups.length > 1 ? g.label : null, g.resolve ?? resolve)),
	];
	if (switcher) body.push(switcher);
	body.push(leagueNav('records'));

	return page({ title: `${heading} records`, colors, body: body.join(LF) });
}

/** A whole league's season, week by week.
 *
 *  A period is a week in football and a date in baseball, decided by
 *  `rules.schedulePeriod` rather than by a branch here. Seasons whose games
 *  carry no week — every pre-1999 football season, because the source has no
 *  such column — group by date and say so, rather than being given numbers that
 *  a measurement showed would be wrong for 17.7% of games.
 */
/** "Week 3", or "Sun, Aug 30". A period's own name, whichever kind it is. */
const periodTitle = (p, periodNoun) => (p.kind === 'week'
	? `${escapeHtml(periodNoun)} ${p.week}`
	: escapeHtml(formatDate(p.date)));

/** First, previous, next, last across the season's periods, plus the way out to
 *  the whole thing.
 *
 *  Sport-qualified through `base`, because a page covering two sports carries
 *  two of these navs and football's week 3 is not baseball's. Passing one base
 *  for the page would point both blocks at the same URL — the same shape as the
 *  one-namer-for-two-sports bug that put the Lansing Oldsmobiles on a baseball
 *  schedule.
 */
function periodNav(schedule, periodNoun, base = '') {
	const { periods = [], index = -1, season } = schedule;
	if (periods.length < 2) return '';
	// Named "Week" or "Day", never "Games" — this row steps through them one at a
	// time, and the noun has to say which one you are on.
	const unit = periodNoun === 'Week' ? 'Week' : 'Day';
	return stepNav({
		items: periods,
		index,
		label: unit,
		href: (p) => `${base}/schedule/${season}/${p.key}`,
		format: (p) => periodTitle(p, periodNoun),
		extra: `<p class="dim">${escapeHtml(`${unit} ${index + 1} of ${periods.length}`)} · <a class="season-link" href="${escapeHtml(base)}/schedule/${season}?all=1">show the whole season</a></p>`,
	});
}

export function leagueSchedulePage({
	schedule, heading, colors, resolve, clubs = [], periodNoun = 'Week', base = '', switcher = '',
	label = null, more = [], tabs = '', all = false,
}) {
	const url = new Map(clubs.map((c) => [c.teamId, c.url]));
	// Per block. A page covering two sports has two namers, and using one for
	// both resolved baseball codes against the football table — LAN became the
	// Lansing Oldsmobiles, CIN the Bengals, MIL the Milwaukee Badgers. Every one
	// of those is a real football club, so the page looked plausible.
	const named = (resolve, season) => (code, id) => {
		const label = escapeHtml(resolve(code, { season: String(season) }).name);
		const href = id ? url.get(id) : null;
		return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
	};

	const score = (g) => {
		if (!g.played) return '<span class="dim">—</span>';
		return `<b>${g.awayScore}</b><span class="dim">–</span><b>${g.homeScore}</b>`;
	};

	// The date is repeated per game inside a WEEK, where a week spans Thursday
	// to Monday and knowing which day matters. Inside a date group the heading
	// already says it, and repeating it on every line is noise.
	const row = (p, name) => (g) => {
		const when = [
			p.kind === 'week' ? formatDate(g.date) : '',
			g.round === 'regular' ? '' : g.round,
		].filter(Boolean).join(' · ');
		return `<li class="fixture">
<span class="side away">${name(g.away, g.awayId)}</span>
<span class="at">${g.neutral ? 'vs' : 'at'}</span>
<span class="side home">${name(g.home, g.homeId)}</span>
<span class="line">${score(g)}</span>
<span class="when dim">${escapeHtml(when)}</span>
</li>`;
	};

	// One block per sport, never interleaved. An `all` scope used to put 22 NFL
	// week-periods and 209 MLB date-periods in one list sorted against each
	// other, and claim `weeksKnown` because SOME of the games had weeks.
	const blockFor = (schedule, periodNoun, label, resolve, periodBase) => {
		const name = named(resolve, schedule.season);
		const out = [];
		if (label) out.push(`<h2 class="league-heading">${escapeHtml(label)}</h2>`);
		out.push(`<p class="meta">${schedule.games} game${schedule.games === 1 ? '' : 's'}</p>`);
		// Said out loud, not hidden. The source for these seasons has no week
		// column, and grouping by date while labelling the groups "Week 3" would
		// be inventing the one thing this page is about. Asked per sport now, so
		// baseball's answer cannot mask football's.
		if (!schedule.weeksKnown && schedule.periods.some((p) => p.kind === 'date') && periodNoun === 'Week') {
			out.push('<p class="dim">No week numbers are recorded for this season, so games are grouped by date.</p>');
		}
		// One period, not all of them. Baseball's 2026 season is 184 periods and
		// 2,431 games, and rendering the lot was 878KB of HTML in one response —
		// fast to build and slow to be a web page.
		const shown = all ? schedule.periods : [schedule.period].filter(Boolean);
		out.push(shown.map((p) => `<section class="record-card league-wide">
<h2>${periodTitle(p, periodNoun)}</h2>
<ul class="fixtures">${p.games.map(row(p, name)).join('')}</ul>
</section>`).join(LF) || '<p class="dim">No games on record.</p>');
		if (!all) out.push(periodNav(schedule, periodNoun, periodBase));
		return out.join(LF);
	};

	// First, previous, next, last — the same shape as a club's season nav, so
	// moving through a league schedule works the way moving through a club's
	// does.
	const nav = stepNav({
		items: schedule.seasons,
		index: schedule.seasons.indexOf(schedule.season),
		label: 'Season',
		href: (yr) => `${base}/schedule/${yr}`,
	});

	const groups = [{ label, schedule, periodNoun, resolve, base }, ...more];
	const body = [
		`<h1>${escapeHtml(heading)} ${escapeHtml(String(schedule.season ?? ''))}</h1>`,
		leagueNav('schedule'),
		tabs,
		nav,
		...groups.map((g) => blockFor(g.schedule, g.periodNoun, groups.length > 1 ? g.label : null,
			g.resolve ?? resolve, g.base ?? base)),
	];
	body.push(nav);
	if (switcher) body.push(switcher);
	body.push(leagueNav('schedule'));

	return page({ title: `${heading} ${schedule.season ?? ''} schedule`, colors, body: body.join(LF) });
}

/** Where every club finished, for one season.
 *
 *  One table per division, grouped by conference. Computed from games rather
 *  than fetched, so a season from 1962 works exactly as one being played does —
 *  the baseball site pulls ESPN's standings endpoint into a modal and can
 *  therefore only ever show today.
 */
export function standingsPage({
	standings, heading, colors, clubs = [], seasons = [], base = '', switcher = '',
	tabs = '', label = null, more = [], season = null,
	sort = null, path = '', params = null,
}) {
	const url = new Map(clubs.map((c) => [`${c.sport}/${c.teamId}`, c.url]));
	const who = (line) => {
		const href = url.get(`${line.sport}/${line.teamId}`);
		const name = escapeHtml(line.club);
		return href ? `<a class="season-link strong" href="${escapeHtml(href)}">${name}</a>` : `<b>${name}</b>`;
	};

	// Sorted WITHIN a division, never across them. A division table already
	// arrives in standing order, so this is for reading it another way — most
	// wins, best percentage — and merging the divisions into one list would
	// answer a question the page is not asking.
	const table = (group) => `<section class="record-card">
<h2>${escapeHtml([group.conference, group.division].filter(Boolean).join(' ') || 'Standings')}</h2>
<table class="league-table standings-table">
<thead>${sortableHead(standingsColumns(group.clubs.some((c) => c.t)), { current: sort, path, params })}</thead>
<tbody>${sortRows(group.clubs, standingsColumns(group.clubs.some((c) => c.t)), sort, (c) => c.club).map((c) => `<tr>
<td>${who(c)}</td><td>${c.w}</td><td>${c.l}</td>${group.clubs.some((x) => x.t) ? `<td>${c.t}</td>` : ''}
<td>${escapeHtml(pct(c.pct, 3))}</td><td class="dim">${escapeHtml(gamesBack(c.gb))}</td>
</tr>`).join('')}</tbody></table>
</section>`;

	// The label carries the season, because two sports do not share one. Asked
	// for /standings with no year, football's latest is the season now being
	// played and baseball's is a different number — a single heading over both
	// would name one of them and be wrong about the other, which is the
	// combined-records complaint arriving by a different route.
	const blockFor = (standings, label) => {
		const out = [];
		if (label) out.push(`<h2 class="league-heading">${escapeHtml(`${label} ${standings.season ?? ''}`.trim())}</h2>`);
		if (!standings.groups.length) {
			out.push('<p class="dim">No games on record for this season.</p>');
			return out.join(LF);
		}
		out.push(`<div class="records">${standings.groups.map(table).join(LF)}</div>`);
		return out.join(LF);
	};

	const groups = [{ label, standings }, ...more];

	// First, previous, next, last — the same shape as every other season nav
	// here, so moving through standings works the way moving through a schedule
	// does.
	// Two sports are not at the same season in August: football's latest played
	// is last winter's and baseball's is the one being played. So the page names
	// each block's season and the nav steps from the later of them — a single
	// heading over both would name one and be wrong about the other, and an
	// earlier draft left every arrow dim because it looked up a season that was
	// deliberately null.
	const seasonsShown = [...new Set(groups.map((g) => g.standings.season).filter((y) => y != null))]
		.sort((a, b) => a - b);
	const shown = season ?? (seasonsShown.length === 1 ? seasonsShown[0] : null);
	const at = seasons.indexOf(season ?? seasonsShown.at(-1));
	const nav = stepNav({
		items: seasons,
		index: at,
		label: 'Season',
		href: (yr) => `${base}/standings/${yr}`,
		// Two leagues at different seasons name both, which the stepper's own
		// formatter cannot know about — it is handed one item, and what belongs
		// in the middle here is "2025 / 2026".
		format: () => (shown != null ? String(shown) : seasonsShown.join(' / ') || '—'),
	});

	const body = [
		`<h1>${escapeHtml(`${heading} ${shown ?? ''}`.trim())}</h1>`,
		leagueNav('standings'),
		tabs,
		nav,
		...groups.map((g) => blockFor(g.standings, groups.length > 1 ? g.label : null)),
		nav,
		// Said rather than implied. Divisions here are today's, and a season
		// before they existed is being grouped by an arrangement it never had —
		// the 1962 National League had no divisions at all. It is the same
		// decision a division scope makes and it is documented there; presenting
		// it silently as how the season was organised would be the wrong kind of
		// tidy.
		'<p class="dim">Grouped by the divisions as they stand now. A season played under a different arrangement is shown under the current one.</p>',
	];
	if (switcher) body.push(switcher);
	body.push(leagueNav('standings'));

	return page({ title: `${heading} ${shown ?? ''} standings`.replace('  ', ' '), colors, body: body.filter(Boolean).join(LF) });
}

/** Who led a club, and what happened while they did.
 *
 *  `/coaches` or `/managers`, and the noun is `team.nouns.leaderPlural` rather
 *  than a branch. That is the seam doing its job: this function never learns
 *  which sport it is rendering, and the day a third one arrives it needs no
 *  edit.
 *
 *  Ranked by wins rather than percentage, which is what both live sites do and
 *  is a decision worth stating: a percentage table is topped by whoever went
 *  1-0 in one game as an interim, which is true and useless.
 *
 *  THE PROVENANCE COLUMN IS THE POINT. Football before 1999 is transcribed from
 *  Wikipedia and everything else is counted from games, so a row says which it
 *  is. Rendering them identically would make the page unable to say which of its
 *  numbers it can stand behind, and CLAUDE.md's rule is that the limit of a
 *  claim is stated in the same breath as the claim.
 */
export function leadersPage({
	team, colors, leaders, base, siteNavHtml = '', switcher = '',
	/** Limits of what this table can say, one sentence each.
	 *
	 *  A list rather than a string since the interim mark arrived: the table can
	 *  answer it for the era with per-game records and not for the one before,
	 *  which is a second limit and a different one from "the leaders start later
	 *  than the games do".
	 */
	notes = [],
	columns = null, sort = null, path = '', params = null,
}) {
	const noun = team.nouns.leaderPlural;
	// The columns come from lib/leaders.js, because the server sorts by them and
	// this draws them; two lists would be two definitions of one fact.
	//
	// The BODY reads them too, rather than deciding for itself which optional
	// columns exist. It used to recompute `anyTies`, `anyPost` and `anyTitles`
	// from the rows, which agreed with the header only because both happened to
	// look at the same array — and a header and a body that disagree about how
	// many cells a row has is a table that silently slides every column one to
	// the left.
	const cols = columns ?? [];
	const has = (key) => cols.some((c) => c.key === key);

	// NO CLUB COLUMN, and it was written before it was removed. The first draft
	// took a `multiClub` flag and a name resolver to label each row's club, on
	// the reasoning that a league scope covers many. It cannot: a leaders page is
	// reached through a CLUB's base, so it is one club under every scope, and the
	// flag was never passed true anywhere. Two pieces of unreachable defence read
	// as if they were protecting something, which is why this repo already
	// deleted a route tie-break it could not reach.
	//
	// A leader who led two clubs still shows both — `franchises` carries them and
	// the tally merges the person rather than splitting them — but only one of
	// those clubs is in scope, so there is nothing to disambiguate on the row.

	const span = (r) => (r.firstSeason === r.lastSeason
		? String(r.firstSeason)
		: `${r.firstSeason}–${r.lastSeason}`);

	// Said on the row, not in a footnote nobody reads. `stated` is the
	// transcribed era and `mixed` is a career that straddles it — Mike Shanahan
	// and Dan Reeves are both — and a career that is half counted is not a
	// counted career.
	const BASIS = {
		counted: ['', ''],
		stated: ['stated', 'Transcribed from Wikipedia; not counted from games'],
		mixed: ['part stated', 'Counted from 1999; transcribed before it'],
	};
	const basisCell = (r) => {
		const [label, title] = BASIS[r.basis] ?? BASIS.counted;
		return label ? `<span class="dim" title="${escapeHtml(title)}">${escapeHtml(label)}</span>` : '';
	};

	// An asterisk, which is what both sites use, with the word in the title so a
	// reader who cannot guess the mark can hover it and a screen reader says it.
	// The alternative was a separate column, which is a column of blanks for
	// every club: it is 2 of 17 for the Packers.
	const row = (r) => `<tr>
<td><b>${escapeHtml(r.name)}</b>${r.interim ? '<span class="interim" title="Interim">*</span>' : ''}</td>
<td class="dim">${escapeHtml(span(r))}</td>
<td>${r.w}</td><td>${r.l}</td>${has('t') ? `<td>${r.t}</td>` : ''}
<td>${escapeHtml(pct(r.winPct, 3))}</td>
${has('post') ? `<td class="dim">${r.playoffW || r.playoffL ? `${r.playoffW}–${r.playoffL}` : '—'}</td>` : ''}
${has('titles') ? `<td>${r.titles.length ? r.titles.map((t) => escapeHtml(String(t.season))).join(', ') : ''}</td>` : ''}
<td>${basisCell(r)}</td>
</tr>`;

	// "Titles", not the manifest's championship noun. That noun is what the club
	// plays for NOW, and this column spans everything it ever played for: heading
	// it `Super Bowl` put that label over Curly Lambeau's 1936, 1939 and 1944,
	// which were NFL Championships and predate the Super Bowl by thirty years.
	// Exactly the error `titleHeading` exists to stop on the records page, made
	// again here — and `titleHeading` cannot be reused, because it names a round
	// from the titles it is given and half of these have no name to give:
	// `leader_tenure.title_seasons` is a list of seasons, so a stated tenure knows
	// WHEN it won and not WHAT.
	//
	const head = sortableHead(cols, { current: sort, path, params });

	const body = [
		`<h1>${escapeHtml(`${team.nouns.fullName} ${noun}`)}</h1>`,
		leaders.length
			// The count EXCLUDES interims, and says so, which is how both sites
			// report it and how a club counts its own: Green Bay's fifteenth
			// head coach is Matt LaFleur whether or not two people stood in
			// along the way. Printing seventeen makes the page disagree with the
			// club, and printing fifteen with nothing to explain it makes the
			// page disagree with its own table.
			? `<p class="meta">${leaders.filter((r) => !r.interim).length} ${escapeHtml(noun)}${
				leaders.some((r) => r.interim)
					? ` <span class="dim">plus ${leaders.filter((r) => r.interim).length} interim</span>`
					: ''
			}, ${escapeHtml(span({
				firstSeason: Math.min(...leaders.map((r) => r.firstSeason)),
				lastSeason: Math.max(...leaders.map((r) => r.lastSeason)),
			}))}</p>`
			: '',
		// `league-wide` and not just `record-card`. The page body is a centred
		// column flexbox, so a block carrying only a max-width is sized
		// shrink-to-fit — this table rendered as a 550px column in a 1400px
		// viewport on its first screenshot, which is the bug CLAUDE.md opens
		// with, arriving for the third time in this repo and again visible only
		// in an image.
		`<section class="record-card league-wide">
<table class="league-table leaders-table">
<thead>${head}</thead>
<tbody>${leaders.map(row).join('')}</tbody></table>
</section>`,
		leaders.length ? '' : '<p class="dim">No one on record. The load found no leader rows for this club.</p>',
		// The gaps, named on the page rather than left for a reader to infer from
		// a table that starts in the wrong decade.
		...notes.filter(Boolean).map((n) => `<p class="dim">${escapeHtml(n)}</p>`),
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);

	return page({ title: `${team.nouns.fullName} ${noun}`, colors, body: body.filter(Boolean).join(LF) });
}

/** Every champion a league has had, season by season.
 *
 *  A page rather than a column, because the championship table had exactly one
 *  consumer — the Titles column on the leaders page — and a title that shows in
 *  one place and nowhere else is not intuitive, which is what the reader of the
 *  running site said. The club record book and the history chart read it now
 *  too; this is the league-wide view of the same rows.
 *
 *  `method` is a column, not decoration. A title taken on the final standings, a
 *  title taken in a one-off tie-breaking playoff, and a title taken in a
 *  scheduled final are three different things, and printing them identically
 *  claims the 1920 Akron Pros beat somebody.
 */
export const CHAMPION_COLUMNS = [
	column('season', 'Season', (r) => r.season, { numeric: true, defaultDir: 'desc' }),
	column('league', 'League', (r) => r.league),
	column('champion', 'Champion', (r) => r.championName),
	column('runnerUp', 'Runner-up', (r) => r.runnerUpName),
	column('method', 'Decided by', (r) => r.method),
];

export function championsPage({
	champions, heading, colors, clubs = [], switcher = '', tabs = '',
	sort = null, path = '', params = null,
}) {
	const url = new Map(clubs.filter((c) => c.url).map((c) => [`${c.sport}/${c.teamId}`, c.url]));
	const who = (code, name, sport) => {
		const href = [...url.entries()].find(([k]) => k.startsWith(`${sport}/`) && k.endsWith(`/${code}`))?.[1];
		return href ? `<a class="season-link strong" href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : `<b>${escapeHtml(name)}</b>`;
	};
	// How it was decided, in words a reader does not have to look up.
	const DECIDED = {
		standings: 'final standings',
		'playoff game': 'tie-break game',
		'championship game': 'championship game',
		'championship series': 'series',
	};

	const rows = sortRows(champions, CHAMPION_COLUMNS, sort ?? { key: 'season', dir: 'desc' },
		(r) => `${r.season}${r.league}`);

	const body = [
		`<h1>${escapeHtml(heading)}</h1>`,
		leagueNav('champions'),
		tabs,
		champions.length
			? `<p class="meta">${champions.length} titles, ${Math.min(...champions.map((c) => c.season))}–${Math.max(...champions.map((c) => c.season))}</p>`
			: '',
		champions.length
			? `<section class="record-card league-wide">
<table class="league-table champions-table">
<thead>${sortableHead(CHAMPION_COLUMNS, { current: sort, path, params })}</thead>
<tbody>${rows.map((r) => `<tr>
<td class="dim">${escapeHtml(String(r.season))}</td>
<td class="dim">${escapeHtml(r.league)}</td>
<td>${who(r.champion, r.championName, r.sport)}</td>
<td>${r.runnerUp ? who(r.runnerUp, r.runnerUpName, r.sport) : '<span class="dim">—</span>'}</td>
<td class="dim">${escapeHtml(DECIDED[r.method] ?? r.method)}</td>
</tr>`).join('')}</tbody></table>
</section>`
			: '<p class="dim">No champions on record. Run the load for this sport.</p>',
		// Said on the page. A season with no opponent is not a missing value.
		champions.some((c) => c.method === 'standings')
			? '<p class="dim">A title taken on the final standings has no runner-up, because no game was played for it.</p>'
			: '',
	];
	if (switcher) body.push(switcher);
	body.push(leagueNav('champions'));

	return page({ title: heading, colors, body: body.filter(Boolean).join(LF) });
}

/** A club's whole history: the chart, then every season under it. */
export function historyPage({
	team, colors, points, base, siteNavHtml = '', switcher = '', updatedAt = null,
	/** Coach eras as bands, from `coachEras`. Empty is the normal answer for a
	 *  club with no leaders loaded, and draws nothing. */
	eras = [],
	sort = null, path = '', params = null,
}) {
	const geo = chartGeometry(points);
	const yr = (season) => `<a class="season-link" href="${escapeHtml(base)}/${escapeHtml(String(season))}">${escapeHtml(String(season))}</a>`;

	const line = geo.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
	// A title gets a marker on the line. Unbeaten seasons do not: 1929 and 1934
	// sit at the top of the chart already, and a second glyph there says nothing
	// the position has not.
	const marks = geo.points.filter((p) => p.champion).map((p) =>
		`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="history-title"><title>${
			escapeHtml(`${p.season} — champions, ${p.record}`)}</title></circle>`).join('');

	// Coach eras, behind the line.
	//
	// Two things a reader gets from this that the table cannot give them: which
	// stretch of the chart belongs to whom, and how long each man lasted, read
	// as width. Both sites draw it and this one did not.
	//
	// Alternating opacity rather than a palette. Sixteen coaches need sixteen
	// distinguishable colours and there are not sixteen that work on one club's
	// ground; alternation says "this is a different man from the one beside
	// him", which is the whole job.
	//
	// The label is a `<title>`, which is a NATIVE tooltip and needs no script.
	// The sites both wire a mousemove handler and a positioned div to say the
	// same thing.
	// Matches `.era-label` in the stylesheet. Declared here because the fit test
	// below needs the number and CSS cannot be asked for it.
	const ERA_LABEL_SIZE = 11;
	const step = geo.points.length > 1 ? (geo.width - geo.pad * 2) / (geo.points.length - 1) : 0;
	const bandX = (i) => geo.pad + i * step;
	const bands = eras.map((e, i) => {
		const bx = bandX(e.fromIndex);
		const bw = bandX(e.toIndex) - bx;
		// A label is drawn only where its OWN text fits inside its OWN band, with
		// a gutter. A fixed pixel threshold does not work: at 34px both "Gregg"
		// and "Infante" cleared it in adjacent four-season bands and rendered
		// touching, so the chart read "Gregg Infante" as one man. Two names run
		// together is worse than one name missing -- the band is still there and
		// still says who it is on hover.
		//
		// `textWidth` is the social card's estimate, measured against Liberation
		// Sans rather than guessed, and wrong in the safe direction: it
		// overestimates, so it drops a label that would just have fitted instead
		// of drawing one that just does not.
		const label = bw >= textWidth(e.label, ERA_LABEL_SIZE) + 10
			? `<text x="${(bx + bw / 2).toFixed(1)}" y="${(geo.pad - 6).toFixed(1)}" class="era-label" text-anchor="middle">${escapeHtml(e.label)}</text>`
			: '';
		return `<g class="era${i % 2 ? ' alt' : ''}"><rect x="${bx.toFixed(1)}" y="${geo.pad.toFixed(1)}" width="${bw.toFixed(1)}" height="${(geo.height - geo.pad * 2).toFixed(1)}"><title>${
			escapeHtml(`${e.name}, ${e.from === e.to ? e.from : `${e.from}\u2013${e.to}`}`)}</title></rect>${label}</g>`;
	}).join('');

	const chart = geo.points.length < 2 ? '' : `<svg class="history-chart" viewBox="0 0 ${geo.width} ${geo.height}" role="img"
 aria-label="${escapeHtml(`Win percentage by season, ${geo.points[0].season} to ${geo.points.at(-1).season}`)}">
${bands}<line x1="${geo.pad}" y1="${geo.mid.toFixed(1)}" x2="${geo.width - geo.pad}" y2="${geo.mid.toFixed(1)}" class="spark-base" stroke-dasharray="2 3"/>
<polyline points="${line}" class="spark-line" fill="none"/>
${marks}</svg>`;

	// Newest first. A history read from the top is a history of the club now.
	const rows = sortRows(points, historyColumns(team), sort ?? { key: 'season', dir: 'desc' }, (p) => p.season).map((p) => `<tr>
<td>${yr(p.season)}</td>
<td>${escapeHtml(p.record)}</td>
<td>${escapeHtml(pct(p.pct))}</td>
<td>${p.pf}</td>
<td>${p.pa}</td>
<td>${finalCell(p, team)}</td>
</tr>`).join(LF);

	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)} history</h1>`,
		points.length
			? `<p class="meta">${escapeHtml(String(points[0].season))}–${escapeHtml(String(points.at(-1).season))} · ${points.length} season${points.length === 1 ? '' : 's'}</p>`
			: '<p class="meta">No seasons on record.</p>',
		chart,
		// The chart plots one line. Said plainly rather than implied by a legend
		// with a single entry.
		points.length ? '<p class="dim">Win percentage by season. The dashed line is .500; a marker is a title.</p>' : '',
		points.length ? `<section class="record-card league-wide"><h2>Every season</h2>
<table class="league-table history-table">
<thead>${sortableHead(historyColumns(team), { current: sort, path, params })}</thead>
<tbody>${rows}</tbody></table></section>` : '',
		// REVERSED. This used to read "Coach eras are not shown: this deployment
		// has no <leaders> data", which was true when it was written and is now
		// a false statement rendered on every history page — the data arrived
		// with the leaders page and nothing here announced that it had.
		//
		// Reversed: this said "coach eras are not drawn on this chart", which
		// stopped being true when they were. The link stays, because a band is a
		// name and a width and the table is the record.
		eras.length
			? `<p class="dim">Bands are ${escapeHtml(team.nouns.leaderPlural)}; hover one for the name and years. <a href="${escapeHtml(`${base}/${team.nouns.leaderPlural}`)}">Every ${escapeHtml(team.nouns.leaderPlural.replace(/e?s$/, ''))}</a> is listed separately.</p>`
			: `<p class="dim">No ${escapeHtml(team.nouns.leaderPlural)} are on record for this club, so the chart has no bands. <a href="${escapeHtml(`${base}/${team.nouns.leaderPlural}`)}">The ${escapeHtml(team.nouns.leaderPlural)} page</a> says why.</p>`,
	];
	if (updatedAt) body.push(`<p class="meta">Updated ${escapeHtml(formatDate(updatedAt))}</p>`);
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);

	return page({ title: `${team.nouns.fullName} history`, colors, body: body.filter(Boolean).join(LF) });
}

/** The division table behind the record, as a modal.
 *
 *  No JavaScript, because this repo ships none and adding a bundle to open a box
 *  would be a bad trade. `:target` is a real modal — an overlay, a card, a close
 *  that dismisses it — driven entirely by the URL fragment, and it degrades to a
 *  jump link where the CSS does not load.
 *
 *  The baseball site does this by fetching ESPN's standings endpoint when the
 *  modal opens, which is why it can only ever show the season being played. This
 *  is computed from games already in the database, so the modal on a 1982 page
 *  shows 1982.
 */
export function standingsModal({ standings, id = 'standings', season, caveat = false }) {
	const group = standings?.groups?.[0];
	if (!group) return '';
	const ties = group.clubs.some((c) => c.t);
	const row = (c) => `<tr${c.here ? ' class="here"' : ''}>
<td>${c.url ? `<a class="season-link" href="${escapeHtml(c.url)}">${escapeHtml(c.club)}</a>` : escapeHtml(c.club)}</td>
<td>${c.w}</td><td>${c.l}</td>${ties ? `<td>${c.t}</td>` : ''}
<td>${escapeHtml(pct(c.pct, 3))}</td><td class="dim">${escapeHtml(gamesBack(c.gb))}</td>
</tr>`;
	return `<div class="modal" id="${escapeHtml(id)}">
<a class="modal-dismiss" href="#" aria-label="Close"></a>
<div class="modal-card" role="dialog" aria-label="Standings">
<a class="modal-close" href="#" aria-label="Close">&times;</a>
<h2>${escapeHtml([group.conference, group.division].filter(Boolean).join(' '))} ${escapeHtml(String(season ?? ''))}</h2>
<table class="league-table standings-table">
<thead><tr><th>Club</th><th>W</th><th>L</th>${ties ? '<th>T</th>' : ''}<th>Pct</th><th>GB</th></tr></thead>
<tbody>${group.clubs.map(row).join('')}</tbody></table>
${caveat ? '<p class="dim">Grouped by the divisions as they stand now.</p>' : ''}
</div>
</div>`;
}

/** A club's page for one season. */
export function clubPage({
	team, season, tally, verdict, answer, recordLabel, colors,
	banner = null, schedule = '', nav = '', siteNavHtml = '', lastLossless = null, allTime = null,
	switcher = '', updatedAt = null, spark = '', standings = '', credits = [],
	onThisDay = '', share = '',
}) {
	const parts = [
		`<h1>${escapeHtml(questionFor(team))}</h1>`,
		`<p class="answer ${escapeHtml(verdict)}">${escapeHtml(answer)}</p>`,
	];

	const sub = [];
	if (tally.postseason) sub.push(`Postseason: ${tally.postseason.w}-${tally.postseason.l}`);
	if (tally.championshipName) sub.push(tally.championshipName);
	const subHtml = sub.length ? `<span class="sub">${escapeHtml(sub.join(' · '))}</span>` : '';
	// The record opens the division table when there is one to open. A link only
	// where the modal exists: a club with no division on record, or a season it
	// did not play, would otherwise offer a box with nothing in it.
	const recordMain = `${escapeHtml(season)} Record: ${escapeHtml(recordLabel)}`;
	parts.push(`<p class="record">${subHtml}${standings
		? `<a class="record-main record-link" href="#standings" title="Division standings">${recordMain}</a>`
		: `<span class="record-main">${recordMain}</span>`}</p>`);

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
	// After the schedule, because the season being played is what the page is
	// for and history is context underneath it.
	if (onThisDay) {
		parts.push('<p class="disclosure">On this day</p>');
		parts.push(onThisDay);
	}

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
	// Last in the document and hidden until targeted, so a browser with no CSS
	// shows the table at the foot of the page rather than over the top of it.
	// Beside the switcher, because both are things a reader does WITH the page
	// rather than things the page says.
	if (share) parts.push(share);

	if (standings) parts.push(standings);
	// Last of all, below even the standings table: an obligation rather than
	// content, and it belongs where a footer belongs.
	parts.push(creditLine(credits));

	return page({ title: questionFor(team), colors, body: parts.filter(Boolean).join(LF) });
}

/** The selector, for any scope holding more than one club.
 *
 *  Unavailable clubs are listed, not hidden. A selector showing two clubs of a
 *  promised sixteen looks complete and is wrong.
 */
export function selectorPage({ scope, clubs, colors, heading, nav = '', credits = [] }) {
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
			nav,
			`<ul class="clubs">${LF}${items.join(LF)}${LF}</ul>`,
			`<p class="meta">${built} of ${clubs.length} clubs built · <code>${escapeHtml(scope)}</code></p>`,
			creditLine(credits),
		].filter(Boolean).join(LF),
	});
}
