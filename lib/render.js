/** HTML, as pure functions returning strings.
 *
 *  Rendered on the server, deliberately. On the football site this work happens
 *  in `main.js` in the browser, which fetches its own CSV — so none of it is
 *  reachable from `node --test`, and 118 passing tests coexisted with every past
 *  season rendering a 0-0 record. Everything here takes data and returns a
 *  string, and every one of these functions is called by a test.
 *
 *  No colour literals. The two sites carry 282 hex literals between them and not
 *  one custom property; the palette arrives from the team manifest and is
 *  written into `:root` once.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Built from its code point. Writing a newline escape into this file through a
// shell heredoc has now collapsed to a literal newline four separate times,
// producing either a syntax error or — worse — a silently different string.
const LF = String.fromCharCode(10);

/** For a selector spanning clubs that do not share a palette.
 *
 *  A scope of sixteen clubs has no single brand colour, and borrowing the first
 *  available club's would dress the whole league in Green Bay's green purely
 *  because it is the one that happens to be built. Neutral is the honest
 *  answer until there is a design decision to make it otherwise.
 */
export const NEUTRAL = { accent: '#ffffff', base: '#2a2a2a', baseDeep: '#1a1a1a' };

/** Escape text for HTML. Opponent names and club names come from upstream data
 *  and reference tables, so they are not ours to trust. */
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** The palette, as custom properties.
 *
 *  Status colours are shared and live here rather than in a manifest, because
 *  comparing the two sites showed they had independently arrived at the same
 *  values — a win is #4caf50 on both. Only the brand values differ, and those
 *  come from the club.
 */
export function paletteCss(colors) {
	return [
		':root {',
		`\t--accent: ${colors.accent};`,
		`\t--base: ${colors.base};`,
		`\t--base-deep: ${colors.baseDeep};`,
		'\t--win: #4caf50;',
		'\t--loss: #f44336;',
		'\t--text: #ffffff;',
		'}',
	].join('\n');
}

const STYLE = `
* { box-sizing: border-box; }
body {
	margin: 0;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1.5rem;
	padding: 2rem 1rem;
	background: var(--base-deep);
	color: var(--text);
	font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	text-align: center;
}
h1 { margin: 0; font-size: clamp(1.1rem, 4vw, 1.6rem); font-weight: 500; opacity: .85; }
.verdict { margin: 0; font-size: clamp(3.5rem, 22vw, 11rem); line-height: .9; font-weight: 800; color: var(--accent); }
.record { margin: 0; font-size: clamp(1rem, 3.5vw, 1.4rem); }
.record b { color: var(--accent); font-variant-numeric: tabular-nums; }
.meta { margin: 0; opacity: .7; font-size: .9rem; }
/* width, not just max-width: body is a column flexbox with align-items:center,
   so an item carrying only a max-width is sized shrink-to-fit and an auto-fit
   track list resolves to exactly one repetition against an indefinite inline
   size. That bug rendered the records page as a single column at every viewport
   above 600px, on both sites, for months. */
.clubs {
	width: 100%;
	max-width: 900px;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
	gap: .75rem;
	list-style: none;
	padding: 0;
	text-align: left;
}
.clubs li { background: var(--base); border-radius: .5rem; }
.clubs a, .clubs span { display: block; padding: .75rem 1rem; color: var(--text); text-decoration: none; }
.clubs a:hover { background: var(--accent); color: var(--base-deep); }
.clubs .unavailable { opacity: .45; }
.clubs .code { font-weight: 700; color: var(--accent); }
.clubs a:hover .code { color: var(--base-deep); }

.banner { margin: 0; font-size: clamp(.95rem, 2.6vw, 1.15rem); opacity: .9; max-width: 46rem; }
.panel { width: 100%; max-width: 900px; box-sizing: border-box; }
.panel h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; opacity: .55; margin: 0 0 .5rem; font-weight: 600; }
table.schedule { width: 100%; border-collapse: collapse; font-size: .95rem; text-align: left; }
table.schedule th { font-weight: 600; opacity: .55; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; padding: .3rem .5rem; }
table.schedule td { padding: .4rem .5rem; border-top: 1px solid rgba(255,255,255,.08); }
table.schedule tr td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.res { font-weight: 700; }
.res.w { color: var(--win); }
.res.l { color: var(--loss); }
.res.t { opacity: .6; }
.at { opacity: .5; display: inline-block; width: 1.1em; }
.nav { display: flex; gap: .5rem; align-items: center; justify-content: center; flex-wrap: wrap; font-size: .9rem; }
.nav a { color: var(--accent); text-decoration: none; padding: .3rem .6rem; border-radius: .3rem; background: var(--base); }
.nav a:hover { background: var(--accent); color: var(--base-deep); }
.nav .here { padding: .3rem .6rem; opacity: .6; }
`.trim();

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

/** The question a club's front page asks. */
export const questionFor = (team) =>
	`Are the ${team.nouns.team} ${team.nouns.losslessSeasonNoun}?`;

/** One season's games.
 *
 *  Opponent codes are resolved to names by the caller, because resolution is
 *  per sport and dated — a 1969 Brewers opponent is not called what it is called
 *  now — and this function should not know that.
 */
export function scheduleHtml(rows, { heading }) {
	if (!rows.length) return '';
	const cell = (g) => {
		const cls = g.result === 'WIN' ? 'w' : g.result === 'LOSS' ? 'l' : 't';
		// No guard on empty scores: a row with no result renders "scheduled" and
		// never reaches the score. A mutation run proved the guard could be
		// deleted without changing anything, which is what dead defence looks
		// like from the outside.
		const mark = g.result
			? `<span class="res ${cls}">${g.result[0]}</span> ${escapeHtml(`${g.scoreFor}–${g.scoreAgainst}`)}`
			: 'scheduled';
		// "@" for away, a blank of the same width for home, so the opponent
		// column stays aligned. A neutral game is neither and says so.
		const at = g.location === 'away' ? '@' : g.location === 'neutral' ? 'v' : '';
		return `<tr>
<td>${escapeHtml(g.date)}</td>
<td><span class="at">${at}</span>${escapeHtml(g.opponentName ?? g.Opponent)}</td>
<td>${mark}</td>
</tr>`;
	};
	return `<section class="panel">
<h2>${escapeHtml(heading)}</h2>
<table class="schedule">
<thead><tr><th>Date</th><th>Opponent</th><th>Result</th></tr></thead>
<tbody>
${rows.map(cell).join(LF)}
</tbody>
</table>
</section>`;
}

/** First / previous / next across a club's seasons.
 *
 *  Built from the seasons a club actually has rows for, not from a range, so a
 *  franchise that did not play in 1943 does not get a link to it.
 */
export function seasonNav(allSeasons, current, base) {
	if (!allSeasons.length) return '';
	const i = allSeasons.indexOf(current);
	const link = (s, label) => `<a href="${escapeHtml(base)}/${escapeHtml(s)}">${escapeHtml(label)}</a>`;
	const parts = [];
	if (i > 0) parts.push(link(allSeasons[0], `« ${allSeasons[0]}`));
	if (i > 0) parts.push(link(allSeasons[i - 1], `‹ ${allSeasons[i - 1]}`));
	parts.push(`<span class="here">${escapeHtml(current)}</span>`);
	if (i >= 0 && i < allSeasons.length - 1) parts.push(link(allSeasons[i + 1], `${allSeasons[i + 1]} ›`));
	if (i >= 0 && i < allSeasons.length - 1) parts.push(link(allSeasons.at(-1), `${allSeasons.at(-1)} »`));
	return `<nav class="nav">${parts.join('')}</nav>`;
}

/** A club's front page: the question, the answer, the record. */
export function clubPage({
	team, season, tally, verdict, answer, recordLabel,
	banner = null, schedule = '', nav = '', lastLossless = null, allTime = null,
}) {
	const parts = [
		`<h1>${escapeHtml(questionFor(team))}</h1>`,
		`<p class="verdict">${escapeHtml(answer)}</p>`,
		`<p class="record">${escapeHtml(season)} record: <b>${escapeHtml(recordLabel)}</b></p>`,
	];
	if (tally.postseason) {
		parts.push(`<p class="meta">Postseason ${tally.postseason.w}-${tally.postseason.l}</p>`);
	}
	if (tally.championshipName) {
		parts.push(`<p class="meta">${escapeHtml(tally.championshipName)}</p>`);
	}
	// Said out loud rather than implied by an absence, because a verdict with no
	// games behind it looks identical to one with a season behind it.
	if (verdict === 'not-started') {
		parts.push(`<p class="meta">${escapeHtml(season)} has not started.</p>`);
	}
	if (banner) parts.push(`<p class="banner">${escapeHtml(banner)}</p>`);
	if (nav) parts.push(nav);
	if (schedule) parts.push(schedule);
	if (lastLossless) {
		// The question the site is named after, answered for the last time it
		// was true.
		const ties = lastLossless.ties ? `-${lastLossless.ties}` : '';
		parts.push(`<p class="meta">Last ${escapeHtml(team.nouns.losslessSeasonNoun)} season: <b>${escapeHtml(lastLossless.season)}</b> (${lastLossless.wins}-${lastLossless.losses}${ties})</p>`);
	} else {
		// "Never" is a legitimate answer and reads better than an absent panel,
		// which looks like something failed to load.
		parts.push(`<p class="meta">No ${escapeHtml(team.nouns.losslessSeasonNoun)} season on record.</p>`);
	}
	if (allTime) {
		parts.push(`<p class="meta">All time: <b>${escapeHtml(allTime.record)}</b> over ${allTime.played} games, ${escapeHtml(allTime.first)}–${escapeHtml(allTime.last)}</p>`);
	}
	return page({
		title: questionFor(team),
		colors: team.colors,
		body: parts.join(LF),
	});
}

/** The selector, for any scope holding more than one club.
 *
 *  Unavailable clubs are listed, not hidden. A selector showing two clubs of a
 *  promised sixteen looks complete and is wrong; showing fourteen greyed out
 *  says what this deployment actually has.
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
			`<ul class="clubs">\n${items.join('\n')}\n</ul>`,
			`<p class="meta">${built} of ${clubs.length} clubs built · <code>${escapeHtml(scope)}</code></p>`,
		].join('\n'),
	});
}
