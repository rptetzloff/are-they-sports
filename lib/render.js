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
export function leagueNav(current = null) {
	const items = [
		['/', 'All clubs', 'view-grid', 'clubs'],
		['/records', 'League records', 'trophy', 'records'],
		['/schedule', 'Schedule', 'calendar-month', 'schedule'],
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
export function leagueRecordsPage({ league, heading, colors, clubs = [], mixedSports = false }) {
	const item = (text) => `<li>${text}</li>`;
	// Keyed by id, never by display name: the league lists carry the nickname
	// and this list carries the full name, so a name-keyed map silently matched
	// nothing and every club rendered unlinked.
	const base = new Map(clubs.map((c) => [c.teamId, c.url]));
	// The club's name, linked to its own records when this deployment can serve
	// them. A club with no page still gets named rather than dropped.
	const who = (entry) => {
		const url = base.get(entry.teamId);
		const label = escapeHtml(entry.club);
		return url ? `<a class="season-link strong" href="${escapeHtml(url)}/records">${label}</a>` : `<b>${label}</b>`;
	};

	const seasonList = (list) => list.map((r) => item(
		`${who(r)} <span class="dim">${escapeHtml(String(r.season))}</span> ${escapeHtml(r.record)}`));
	const startList = (list) => list.map((r) => item(
		`${who(r)} <b>${r.games}</b> <span class="dim">to start ${escapeHtml(String(r.season))}</span>`));
	const streakList = (list) => list.map((r) => item(
		`${who(r)} <b>${r.games}</b> <span class="dim">${escapeHtml(String(r.startSeason))}${r.startSeason === r.endSeason ? '' : `–${escapeHtml(String(r.endSeason))}`}</span>`));
	const gameList = (list) => list.map((g) => item(
		`${who(g)} <b>${g.pf}–${g.pa}</b> <span class="dim">${escapeHtml(String(g.season))}</span>`));
	const titleList = (list) => list.map((t) => item(
		`${who(t)} <b>${t.won}</b> <span class="dim">of ${t.appearances}${t.seasons.length ? ` — ${escapeHtml(t.seasons.join(', '))}` : ''}</span>`));

	// A table rather than a list: this is the one card where the columns line up
	// and reading down them is the point.
	const allTime = league.allTime.length
		? `<table class="league-table"><thead><tr><th>Club</th><th>Record</th><th>Pct</th><th>Seasons</th></tr></thead><tbody>${
			league.allTime.map((c) => `<tr><td>${who(c)}</td><td>${escapeHtml(c.record)}</td><td>${
				(c.winPct * 100).toFixed(1)}</td><td class="dim">${escapeHtml(String(c.from))}–${escapeHtml(String(c.to))}</td></tr>`).join('')
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
		['Biggest wins', gameList(league.lopsidedWins)],
		['Titles', titleList(league.titles)],
		['Ties', gameList(league.ties)],
	];

	const body = [
		`<h1>${escapeHtml(heading)} records</h1>`,
		`<p class="meta">${escapeHtml(String(league.seasonRange.first))}–${escapeHtml(String(league.seasonRange.last))} · ${
			league.clubs} club${league.clubs === 1 ? '' : 's'}</p>`,
	];
	// Said rather than hidden. A scope spanning both sports ranks football
	// seasons against baseball ones, which is not a meaningful comparison, and a
	// page that does it silently is worse than one that admits it.
	if (mixedSports) {
		body.push('<p class="dim">This scope covers more than one sport, so these lists compare clubs that never played each other.</p>');
	}
	body.push(`<section class="record-card league-wide"><h2>All-time</h2>${allTime}</section>`);
	body.push(`<div class="records">${cards.map(([h, items]) => `<section class="record-card">
<h2>${escapeHtml(h)}</h2>
${items.length ? `<ol>${items.join('')}</ol>` : '<p class="dim">None on record.</p>'}
</section>`).join(LF)}</div>`);
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
export function leagueSchedulePage({
	schedule, heading, colors, resolve, clubs = [], periodNoun = 'Week', base = '',
}) {
	const url = new Map(clubs.map((c) => [c.teamId, c.url]));
	const named = (code, id) => {
		const label = escapeHtml(resolve(code, { season: String(schedule.season) }).name);
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
	const row = (p) => (g) => {
		const when = [
			p.kind === 'week' ? formatDate(g.date) : '',
			g.round === 'regular' ? '' : g.round,
		].filter(Boolean).join(' · ');
		return `<li class="fixture">
<span class="side away">${named(g.away, g.awayId)}</span>
<span class="at">${g.neutral ? 'vs' : 'at'}</span>
<span class="side home">${named(g.home, g.homeId)}</span>
<span class="line">${score(g)}</span>
<span class="when dim">${escapeHtml(when)}</span>
</li>`;
	};

	const heads = schedule.periods.map((p) => `<section class="record-card league-wide">
<h2>${p.kind === 'week' ? `${escapeHtml(periodNoun)} ${p.week}` : escapeHtml(formatDate(p.date))}</h2>
<ul class="fixtures">${p.games.map(row(p)).join('')}</ul>
</section>`);

	// First, previous, next, last — the same shape as a club's season nav, so
	// moving through a league schedule works the way moving through a club's
	// does.
	const at = schedule.seasons.indexOf(schedule.season);
	const link = (yr, label, on) => (on && yr != null
		? `<a href="${escapeHtml(base)}/schedule/${yr}">${escapeHtml(label)}</a>`
		: `<span class="dim">${escapeHtml(label)}</span>`);
	const nav = `<nav class="season-nav">
${link(schedule.seasons[0], '«', at > 0)}
${link(schedule.seasons[at - 1], '‹', at > 0)}
<b>${escapeHtml(String(schedule.season ?? ''))}</b>
${link(schedule.seasons[at + 1], '›', at >= 0 && at < schedule.seasons.length - 1)}
${link(schedule.seasons.at(-1), '»', at >= 0 && at < schedule.seasons.length - 1)}
</nav>`;

	const body = [
		`<h1>${escapeHtml(heading)} ${escapeHtml(String(schedule.season ?? ''))}</h1>`,
		`<p class="meta">${schedule.games} game${schedule.games === 1 ? '' : 's'}</p>`,
	];
	// Said out loud, not hidden. The source for these seasons has no week
	// column, and grouping by date while labelling the groups "Week 3" would be
	// inventing the one thing this page is about.
	if (!schedule.weeksKnown && schedule.periods.some((p) => p.kind === 'date') && periodNoun === 'Week') {
		body.push('<p class="dim">No week numbers are recorded for this season, so games are grouped by date.</p>');
	}
	body.push(nav);
	body.push(heads.join(LF) || '<p class="dim">No games on record.</p>');
	body.push(nav);
	body.push(leagueNav('schedule'));

	return page({ title: `${heading} ${schedule.season ?? ''} schedule`, colors, body: body.join(LF) });
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
