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
import { gamesBack } from './standings.js';

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
			? `<li><a href="${escapeHtml(c.url + path)}">${label}</a></li>`
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
	];
	const icon = (name) => `<i class="mdi mdi-${escapeHtml(name)}"></i> `;
	return `<nav class="site-nav league-nav">${items.map(([href, label, ic, key]) => (key === current
		? `<span class="here">${icon(ic)}${escapeHtml(label)}</span>`
		: `<a href="${escapeHtml(href)}">${icon(ic)}${escapeHtml(label)}</a>`)).join('')}</nav>`;
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
export function titleHeading(appearances, team) {
	const titles = new Set(appearances.map((a) => a.title).filter(Boolean));
	if (titles.size === 1) return `${[...titles][0]} appearances`;
	if (titles.size === 0) return `${team.nouns.championship} appearances`;
	return 'Championship games';
}

/** Every opponent a club has played, most-played first. */
export function headToHeadPage({ team, colors, opponents, resolve, base, siteNavHtml = '', switcher = '' }) {
	const row = (o) => {
		const name = resolve(o.code, { season: String(o.last.season), date: o.last.date }).name;
		const above = o.wins > o.losses ? 'win' : o.wins < o.losses ? 'loss' : 'tie';
		return `<tr>
<td><a href="${escapeHtml(base)}/vs/${escapeHtml(o.slug)}">${escapeHtml(name)}</a></td>
<td>${o.games}</td>
<td class="res ${above}">${escapeHtml(o.record)}</td>
<td>${o.playoffRecord ? escapeHtml(o.playoffRecord) : '<span class="dim">—</span>'}</td>
</tr>`;
	};
	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)} head-to-head</h1>`,
		`<p class="meta">${opponents.length} opponents</p>`,
		`<section class="panel"><table class="schedule h2h">
<thead><tr><th>Opponent</th><th>${escapeHtml(team.nouns.meetingPlural[0].toUpperCase() + team.nouns.meetingPlural.slice(1))}</th><th>Record</th><th>Postseason</th></tr></thead>
<tbody>${LF}${opponents.map(row).join(LF)}${LF}</tbody></table></section>`,
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);
	return page({ title: `${team.nouns.fullName} head-to-head`, colors, body: body.join(LF) });
}

/** One opponent, in full. */
export function opponentPage({ team, colors, opponent, name, resolve, base, siteNavHtml = '', switcher = '' }) {
	const o = opponent;
	const game = (g) => `<tr>
<td><a href="${escapeHtml(base)}/${g.season}">${g.season}</a></td>
<td>${escapeHtml(formatDate(g.date))}</td>
<td class="res ${g.result === 'WIN' ? 'win' : g.result === 'LOSS' ? 'loss' : 'tie'}">${g.result[0]} ${g.pf}–${g.pa}</td>
<td>${g.playoff ? '<span class="dim">postseason</span>' : ''}</td>
</tr>`;
	// Newest first: the last meeting is the one anyone looks for.
	const meetings = [...o.meetings].reverse();
	const body = [
		`<h1>${escapeHtml(team.nouns.team)} vs ${escapeHtml(name)}</h1>`,
		`<p class="answer ${o.wins > o.losses ? 'undefeated' : 'no'}">${escapeHtml(o.record)}</p>`,
		`<p class="record"><span class="sub">${o.playoffRecord ? `Postseason ${escapeHtml(o.playoffRecord)} · ` : ''}${escapeHtml(streakSentence(o.streak))}</span>${o.games} ${escapeHtml(o.games === 1 ? team.nouns.meetingNoun : team.nouns.meetingPlural)} since ${o.first.season}</p>`,
		`<section class="panel"><table class="schedule h2h">
<thead><tr><th>Season</th><th>Date</th><th>Result</th><th></th></tr></thead>
<tbody>${LF}${meetings.map(game).join(LF)}${LF}</tbody></table></section>`,
		`<nav class="season-nav"><a href="${escapeHtml(base)}/vs">← All opponents</a></nav>`,
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
export function recordsPage({ team, colors, records, resolve, base, siteNavHtml = '', switcher = '' }) {
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
	const titleList = (list) => list.map((a) => item(
		`${yr(a.season, 'strong')} ${a.won ? 'won' : 'lost'} <span class="dim">${escapeHtml(a.title ?? team.nouns.championship)}</span>`));
	const playoffList = (list) => list.map((a) => item(
		`${yr(a.season, 'strong')} ${escapeHtml(a.record)}${a.championship ? ' <span class="dim">title game</span>' : ''}`));

	const cards = [
		['Best seasons', seasonList(records.bestSeasons)],
		['Worst seasons', seasonList(records.worstSeasons)],
		['Best starts', startList(records.bestStarts)],
		[`${team.nouns.losslessSeasonNoun[0].toUpperCase()}${team.nouns.losslessSeasonNoun.slice(1)} seasons`, seasonList(records.losslessSeasons)],
		['Win streaks', streakList(records.winStreaks)],
		['Losing streaks', streakList(records.loseStreaks)],
		['Worst starts', startList(records.worstStarts)],
		['Biggest wins', gameList(records.lopsidedWins)],
		['Worst losses', gameList(records.lopsidedLosses)],
		['Postseason', playoffList(records.playoffAppearances.slice(0, 8))],
		// Named from the data when the data agrees. "Super Bowl appearances" over
		// a list that is mostly NFL Championships is wrong by thirty years — the
		// manifest noun is what the club plays for now, not what it played for.
		[titleHeading(records.championshipAppearances, team), titleList(records.championshipAppearances)],
		['Ties', gameList(records.ties.slice(0, 8))],
	];

	const body = [
		`<h1>${escapeHtml(team.nouns.fullName)} records</h1>`,
		`<p class="meta">${escapeHtml(String(records.seasonRange.first))}–${escapeHtml(String(records.seasonRange.last))}</p>`,
		`<div class="records">${cards.map(([heading, items]) => `<section class="record-card">
<h2>${escapeHtml(heading)}</h2>
${items.length ? `<ol>${items.join('')}</ol>` : '<p class="dim">None on record.</p>'}
</section>`).join(LF)}</div>`,
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);

	return page({ title: `${team.nouns.fullName} records`, colors, body: body.join(LF) });
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
<span class="title-kind ${RANK(name) === 0 ? 'sb' : 'other'}">${escapeHtml(name)}${seasons.length > 1 ? 's' : ''} <b>${seasons.length}</b></span>
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
		? `<table class="league-table"><thead><tr><th>Club</th><th>Record</th><th>Pct</th><th>Seasons</th></tr></thead><tbody>${
			league.allTime.map((c) => `<tr><td>${who(c)}</td><td>${escapeHtml(c.record)}</td><td>${escapeHtml(pct(c.winPct))}</td><td class="dim">${escapeHtml(String(c.from))}–${escapeHtml(String(c.to))}</td></tr>`).join('')
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
}) {
	const url = new Map(clubs.map((c) => [`${c.sport}/${c.teamId}`, c.url]));
	const who = (line) => {
		const href = url.get(`${line.sport}/${line.teamId}`);
		const name = escapeHtml(line.club);
		return href ? `<a class="season-link strong" href="${escapeHtml(href)}">${name}</a>` : `<b>${name}</b>`;
	};

	const table = (group) => `<section class="record-card">
<h2>${escapeHtml([group.conference, group.division].filter(Boolean).join(' ') || 'Standings')}</h2>
<table class="league-table standings-table">
<thead><tr><th>Club</th><th>W</th><th>L</th>${group.clubs.some((c) => c.t) ? '<th>T</th>' : ''}<th>Pct</th><th>GB</th></tr></thead>
<tbody>${group.clubs.map((c) => `<tr>
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
	team, colors, leaders, base, siteNavHtml = '', switcher = '', note = null,
}) {
	const noun = team.nouns.leaderPlural;
	const heading = `${noun[0].toUpperCase()}${noun.slice(1)}`;
	const anyTies = leaders.some((r) => r.t > 0);
	const anyPost = leaders.some((r) => r.playoffW || r.playoffL);
	const anyTitles = leaders.some((r) => r.titles.length);

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

	const row = (r) => `<tr>
<td><b>${escapeHtml(r.name)}</b></td>
<td class="dim">${escapeHtml(span(r))}</td>
<td>${r.w}</td><td>${r.l}</td>${anyTies ? `<td>${r.t}</td>` : ''}
<td>${escapeHtml(pct(r.winPct, 3))}</td>
${anyPost ? `<td class="dim">${r.playoffW || r.playoffL ? `${r.playoffW}–${r.playoffL}` : '—'}</td>` : ''}
${anyTitles ? `<td>${r.titles.length ? r.titles.map((t) => escapeHtml(String(t.season))).join(', ') : ''}</td>` : ''}
<td>${basisCell(r)}</td>
</tr>`;

	const head = [
		`<th>${escapeHtml(heading.replace(/e?s$/, ''))}</th>`,
		'<th>Seasons</th><th>W</th><th>L</th>',
		anyTies ? '<th>T</th>' : '',
		'<th>Pct</th>',
		anyPost ? '<th>Post</th>' : '',
		// "Titles", not the manifest's championship noun. That noun is what the
		// club plays for NOW, and this column spans everything it ever played
		// for: heading it `Super Bowl` put that label over Curly Lambeau's 1936,
		// 1939 and 1944, which were NFL Championships and predate the Super Bowl
		// by thirty years. Exactly the error `titleHeading` exists to stop on the
		// records page, made again here — and `titleHeading` cannot be reused,
		// because it names a round from the titles it is given and half of these
		// have no name to give: `leader_tenure.title_seasons` is a list of
		// seasons, so a stated tenure knows WHEN it won and not WHAT.
		anyTitles ? '<th>Titles</th>' : '',
		'<th></th>',
	].filter(Boolean).join('');

	const body = [
		`<h1>${escapeHtml(`${team.nouns.fullName} ${noun}`)}</h1>`,
		leaders.length
			? `<p class="meta">${leaders.length} ${escapeHtml(noun)}, ${escapeHtml(span({
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
<thead><tr>${head}</tr></thead>
<tbody>${leaders.map(row).join('')}</tbody></table>
</section>`,
		leaders.length ? '' : '<p class="dim">No one on record. The load found no leader rows for this club.</p>',
		// The gap, named on the page rather than left for a reader to infer from
		// a table that starts in the wrong decade.
		note ? `<p class="dim">${escapeHtml(note)}</p>` : '',
		`<nav class="season-nav"><a href="${escapeHtml(base || '/')}">← Back</a></nav>`,
	];
	if (switcher) body.push(switcher);
	if (siteNavHtml) body.push(siteNavHtml);

	return page({ title: `${team.nouns.fullName} ${noun}`, colors, body: body.filter(Boolean).join(LF) });
}

/** A club's whole history: the chart, then every season under it. */
export function historyPage({
	team, colors, points, base, siteNavHtml = '', switcher = '', updatedAt = null,
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

	const chart = geo.points.length < 2 ? '' : `<svg class="history-chart" viewBox="0 0 ${geo.width} ${geo.height}" role="img"
 aria-label="${escapeHtml(`Win percentage by season, ${geo.points[0].season} to ${geo.points.at(-1).season}`)}">
<line x1="${geo.pad}" y1="${geo.mid.toFixed(1)}" x2="${geo.width - geo.pad}" y2="${geo.mid.toFixed(1)}" class="spark-base" stroke-dasharray="2 3"/>
<polyline points="${line}" class="spark-line" fill="none"/>
${marks}</svg>`;

	// Newest first. A history read from the top is a history of the club now.
	const rows = [...points].reverse().map((p) => `<tr>
<td>${yr(p.season)}</td>
<td>${escapeHtml(p.record)}</td>
<td>${escapeHtml(pct(p.pct))}</td>
<td>${p.pf}</td>
<td>${p.pa}</td>
<td class="dim">${p.champion ? escapeHtml(team.nouns.championship) : (p.lossless ? escapeHtml(team.nouns.losslessSeasonNoun) : '')}</td>
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
<thead><tr><th>Season</th><th>Record</th><th>Pct</th><th>${escapeHtml(team.nouns.scoreForLabel)}</th><th>${escapeHtml(team.nouns.scoreAgainstLabel)}</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></section>` : '',
		// REVERSED. This used to read "Coach eras are not shown: this deployment
		// has no <leaders> data", which was true when it was written and is now
		// a false statement rendered on every history page — the data arrived
		// with the leaders page and nothing here announced that it had.
		//
		// The football site draws coach-era bands across this chart and this one
		// still does not, but that is now a drawing that has not been done rather
		// than a source that does not exist. So the line points at the page where
		// the data does show, instead of apologising for not having it.
		`<p class="dim">Coach eras are not drawn on this chart. <a href="${escapeHtml(`${base}/${team.nouns.leaderPlural}`)}">Every ${escapeHtml(team.nouns.leaderPlural.replace(/e?s$/, ''))}</a> is listed separately.</p>`,
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
	switcher = '', updatedAt = null, spark = '', standings = '',
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
	if (standings) parts.push(standings);

	return page({ title: questionFor(team), colors, body: parts.join(LF) });
}

/** The selector, for any scope holding more than one club.
 *
 *  Unavailable clubs are listed, not hidden. A selector showing two clubs of a
 *  promised sixteen looks complete and is wrong.
 */
export function selectorPage({ scope, clubs, colors, heading, nav = '' }) {
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
		].filter(Boolean).join(LF),
	});
}
