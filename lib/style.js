/** The stylesheet, ported from the baseball site.
 *
 *  Aligned to `AreTheBrewersOnTV/styles.css` rather than the football site's,
 *  because it is the newer and larger of the two — 3,459 lines against 1,711 —
 *  and its layout is the one the football site would be brought toward rather
 *  than the reverse.
 *
 *  Every colour is a custom property. The two sites carry **282 hardcoded hex
 *  literals between them and not one variable**, and a test asserts that no
 *  literal appears outside `:root`. The brand values come from the team
 *  manifest; the status colours are shared, because comparing the two sites
 *  showed they had independently arrived at the same ones.
 *
 *  This is a port, not a redesign. Values that look arbitrary — 3rem, 4rem, the
 *  0.3 shadow alpha, the 4px card border — are arbitrary in the original too and
 *  are copied rather than improved, so the cutover is invisible. Improving them
 *  is a separate change that should be visible as one.
 *
 *  Not yet ported: the sparkline, the on-this-day panel, the TV provider row,
 *  the share dropdown, box scores, standings.
 */

export const STYLE = `
* { box-sizing: border-box; }

body {
	font-family: Arial, Helvetica, sans-serif;
	margin: 0;
	padding: 2rem 1rem;
	background: var(--base);
	color: var(--text);
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
}

h1 {
	font-size: clamp(1.9rem, 6vw, 3rem);
	margin: 0 0 2rem;
	text-shadow: 2px 2px 4px var(--shadow);
	color: var(--accent);
}

/* White, not the brand colour. The verdict is the loudest thing on the page and
   both sites render it in plain white against the club's ground. */
.answer {
	font-size: clamp(2.6rem, 10vw, 4rem);
	font-weight: bold;
	margin: 2rem 0;
	padding: 1rem;
	border-radius: 10px;
	text-shadow: 2px 2px 4px var(--shadow);
	line-height: 1;
}

.record {
	font-size: clamp(1.1rem, 3.5vw, 1.5rem);
	margin: 1rem 0;
	opacity: .9;
	color: var(--accent);
	/* Bold, so the accent's smaller uses qualify as large text — which is the
	   bar lib/palette.js picks an accent against. */
	font-weight: 600;
}

.record .sub {
	display: block;
	font-size: .75em;
	opacity: .85;
}

/* The dotted underline the baseball site puts under the current record. */
.record-main {
	border-bottom: 1px dotted var(--accent);
	padding-bottom: .12em;
}

.site-nav .mdi, .panel-title .mdi { opacity: .85; }

.meta { margin: .35rem 0; opacity: .7; font-size: .9rem; }

/* Head-to-head tables. */
table.h2h { text-align: left; }
table.h2h a { color: var(--text); text-decoration: none; border-bottom: 1px dotted currentColor; }
table.h2h a:hover { color: var(--accent); }
table.h2h td, table.h2h th { padding: .35rem .6rem; }
table.h2h tr td:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }

/* The record book: one card per list. */
/* The all-time table sits outside the records grid and needs the same width
   rule for the same reason: the page body is a centred column flexbox, so a
   block carrying only a max-width is sized shrink-to-fit and renders as a
   narrow column in the middle of the page. That is the bug CLAUDE.md opens
   with, reproduced here within an hour of reading the rule, and again visible
   only in a screenshot.

   No backticks in this comment. This stylesheet is a JS template literal, and
   the first draft quoted a selector the way prose would, which ended the
   string and made the whole module a syntax error. */
.league-wide {
	width: 100%;
	max-width: 900px;
}
.league-table {
	width: 100%;
	border-collapse: collapse;
	text-align: left;
}
.league-table th {
	font-size: .7rem;
	letter-spacing: .08em;
	text-transform: uppercase;
	color: var(--muted);
	font-weight: 600;
	padding: .2rem .5rem .35rem 0;
	border-bottom: 1px solid var(--panel-edge);
}
.league-table td {
	padding: .3rem .5rem .3rem 0;
	border-bottom: 1px solid var(--panel-edge);
}
.league-table tr:last-child td { border-bottom: 0; }
.league-table td:nth-child(2),
.league-table td:nth-child(3) { font-variant-numeric: tabular-nums; }

/* One fixture per line. A grid rather than a table because the away side, the
   separator and the home side are three columns that must line up down the
   page, while the score and date trail off to the right and wrap on a phone. */
.fixtures { list-style: none; margin: 0; padding: 0; }
.fixture {
	display: grid;
	grid-template-columns: 1fr auto 1fr auto;
	align-items: baseline;
	gap: .4rem .6rem;
	padding: .35rem 0;
	border-bottom: 1px solid var(--panel-edge);
}
.fixture:last-child { border-bottom: 0; }
/* Clubs in scope link to their own pages. Left as bare anchors first, which
   rendered as default browser blue on a dark ground and was barely legible —
   the same shape as the head-to-head table's rule, and the reason that one
   exists. Visible only in a screenshot. */
.fixture a { color: var(--text); text-decoration: none; border-bottom: 1px dotted currentColor; }
.fixture a:hover { color: var(--accent); }
.fixture .away { text-align: right; }
.fixture .at { font-size: .75rem; color: var(--muted); }
.fixture .line { font-variant-numeric: tabular-nums; white-space: nowrap; }
.fixture .when { grid-column: 1 / -1; font-size: .75rem; }
@media (min-width: 620px) {
	.fixture { grid-template-columns: 1fr auto 1fr auto auto; }
	.fixture .when { grid-column: auto; text-align: right; }
}

.records {
	/* width, not just max-width — see .clubs below for why an auto-fit grid
	   inside a centred flex column collapses to one track without it. */
	width: 100%;
	max-width: 900px;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
	gap: .75rem;
	text-align: left;
}

.record-card {
	background: var(--panel);
	border: 1px solid var(--panel-edge);
	border-radius: 8px;
	padding: .8rem 1rem;
}

.record-card h2 {
	margin: 0 0 .5rem;
	font-size: .75rem;
	letter-spacing: .1em;
	text-transform: uppercase;
	color: var(--accent);
	font-weight: 700;
}

.record-card ol { margin: 0; padding-left: 1.2rem; font-size: .9rem; line-height: 1.6; }
.record-card b { color: var(--accent); font-variant-numeric: tabular-nums; }
.season-link { text-decoration: none; font-variant-numeric: tabular-nums; border-bottom: 1px dotted currentColor; }
.season-link.strong { color: var(--accent); font-weight: 700; }
.season-link.dim { color: inherit; opacity: .6; font-size: .85em; }
.season-link:hover { color: var(--accent); opacity: 1; }
.dim { opacity: .6; font-size: .85em; }

/* The history sparkline. */
.spark { width: 100%; max-width: 600px; height: 60px; margin: 1rem 0 .2rem; display: block; }
.spark-line { stroke: var(--accent); stroke-width: 1.4; }
.spark-base { stroke: var(--accent); opacity: .35; stroke-width: 1; }

/* A disclosure row: a caret and a label, above the panel it introduces. */
.disclosure {
	width: 100%;
	max-width: 900px;
	text-align: left;
	font-size: .7rem;
	letter-spacing: .12em;
	text-transform: uppercase;
	color: var(--accent);
	opacity: .65;
	margin: 1.2rem 0 .35rem;
}

.disclosure::before { content: "› "; }

.panel {
	width: 100%;
	max-width: 900px;
	background: var(--panel);
	border: 1px solid var(--panel-edge);
	border-radius: 8px;
	padding: .9rem 1rem;
	text-align: center;
}

.panel b, .panel strong { color: var(--accent); }

.panel-title {
	color: var(--accent);
	font-weight: bold;
	font-size: 1.05rem;
	margin: 0 0 .8rem;
}

/* The schedule box is outlined in the club's colour, unlike the quieter panels
   above it. */
.schedule-panel {
	border: 2px solid var(--accent);
	border-radius: 10px;
	padding: 1rem;
	width: 100%;
	max-width: 900px;
	margin-top: .5rem;
}

.games {
	display: flex;
	flex-direction: column;
	gap: .6rem;
	/* Tall seasons scroll inside the panel rather than the page. 162 baseball
	   games is not a page anyone scrolls past. */
	max-height: 32rem;
	overflow-y: auto;
	padding-right: .3rem;
}

.game-item {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	padding: .8rem;
	background: var(--card);
	border-radius: 8px;
	border-left: 4px solid transparent;
	text-align: center;
}

.game-item.win  { border-left-color: var(--win);  background: var(--card-win); }
.game-item.loss { border-left-color: var(--loss); background: var(--card-loss); }
.game-item.tie  { border-left-color: var(--muted); }
.game-item.next { border-left-color: var(--accent); background: var(--card-next); }

.game-opponent { font-weight: bold; font-size: 1.02rem; }
.game-meta { font-size: .8rem; opacity: .7; margin-top: .15rem; }
.game-date { font-size: .8rem; color: var(--accent); opacity: .85; margin-top: .1rem; }
.game-result { margin-top: .3rem; font-weight: bold; }
.game-result.win  { color: var(--win); }
.game-result.loss { color: var(--loss); }
.game-result.tie  { color: var(--muted); }
.game-result.none { color: var(--muted); font-weight: normal; }

/* Chevron season navigation. */
.season-nav {
	display: flex;
	gap: .4rem;
	align-items: center;
	justify-content: center;
	flex-wrap: wrap;
	margin: 1.2rem 0 .2rem;
}

.season-nav a {
	color: var(--accent);
	text-decoration: none;
	border: 1px solid var(--accent);
	border-radius: 6px;
	padding: .3rem .7rem;
	font-weight: bold;
	line-height: 1;
}

.season-nav a:hover { background: var(--accent); color: var(--base); }
.season-nav .current { color: var(--accent); font-weight: bold; padding: 0 .6rem; }

/* A quiet inline row, which is what the baseball site has — the football site
   still uses pills. */
.site-nav {
	display: flex;
	gap: 1.2rem;
	flex-wrap: wrap;
	justify-content: center;
	margin-top: 2.5rem;
	font-size: .85rem;
}

.site-nav a { color: var(--text); opacity: .75; text-decoration: none; }
.site-nav a:hover { opacity: 1; color: var(--accent); }
/* The page you are already on: named, not linked. Without a rule this rendered
   as unstyled body text beside the links, which reads as a broken link rather
   than as "you are here". */
.site-nav .here { color: var(--accent); font-weight: 700; }

/* At the top of a league page rather than the bottom, because it is how you get
   BETWEEN the scope's pages, not a footer. */
.league-nav { margin: .6rem 0 1.2rem; }

/* The club switcher. Neither site has one, because each serves a single club —
   but a deployment here can hold sixty-two, and a page with no way to reach the
   others pretends it is the only one. A details element, so it needs no
   JavaScript. */
.switcher {
	width: 100%;
	max-width: 900px;
	margin-top: 1.5rem;
	text-align: left;
	font-size: .9rem;
}

.switcher summary {
	cursor: pointer;
	color: var(--accent);
	padding: .5rem .8rem;
	border: 1px solid var(--panel-edge);
	border-radius: 6px;
	background: var(--panel);
	list-style: none;
}

.switcher summary::before { content: "▸ "; }
.switcher[open] summary::before { content: "▾ "; }
.switcher summary::-webkit-details-marker { display: none; }

.switch-sport {
	margin: .9rem 0 .25rem;
	font-size: .7rem;
	letter-spacing: .12em;
	text-transform: uppercase;
	opacity: .55;
	color: var(--accent);
}

.switch-list {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
	gap: .3rem;
	list-style: none;
	padding: 0;
	margin: .4rem 0 0;
}

.switch-list li { padding: .35rem .6rem; border-radius: 4px; }
.switch-list a { color: var(--text); text-decoration: none; display: block; }
.switch-list a:hover { color: var(--accent); }
.switch-list .here { color: var(--accent); font-weight: bold; }
.switch-list .unavailable { opacity: .35; }

.updated { font-size: .8rem; opacity: .55; margin-top: 1.2rem; }

/* The club selector at the root of a multi-club scope. */
.clubs {
	/* width, not just max-width: body is a column flexbox with
	   align-items:center, so an item carrying only a max-width is sized
	   shrink-to-fit, and an auto-fit track list resolves to exactly one
	   repetition against an indefinite inline size. That rendered the records
	   page as a single column at every viewport above 600px, on both sites, for
	   months. */
	width: 100%;
	max-width: 900px;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
	gap: .75rem;
	list-style: none;
	padding: 0;
	text-align: left;
}

.clubs li { background: var(--panel); border-radius: .5rem; }
.clubs a, .clubs span { display: block; padding: .75rem 1rem; color: var(--text); text-decoration: none; }
.clubs a:hover { background: var(--accent); color: var(--base); }
.clubs .unavailable { opacity: .45; }
.clubs .code { font-weight: 700; color: var(--accent); }
.clubs a:hover .code { color: var(--base); }
`.trim();

/** The palette. Brand values from the era being rendered; everything else
 *  shared.
 *
 *  `--panel` and `--card` are translucent black over the club's ground, which is
 *  how the baseball site gets a panel that works against navy and would also
 *  work against green — so they are not per-club values even though they look
 *  like they should be. That is also what let `--base-deep` go: it was declared
 *  once and referenced nowhere, because the translucent layers do the work a
 *  second darker shade was meant to.
 */
export function paletteCss(colors) {
	return [
		':root {',
		`\t--accent: ${colors.accent};`,
		`\t--base: ${colors.base};`,
		`\t--base-deep: ${colors.baseDeep};`,
		'\t--text: #ffffff;',
		'\t--muted: #b0b0b0;',
		'\t--win: #4caf50;',
		'\t--loss: #f44336;',
		'\t--shadow: rgba(0, 0, 0, .3);',
		'\t--panel: rgba(0, 0, 0, .2);',
		'\t--panel-edge: rgba(255, 255, 255, .12);',
		'\t--card: rgba(0, 0, 0, .2);',
		'\t--card-win: rgba(76, 175, 80, .1);',
		'\t--card-loss: rgba(244, 67, 54, .1);',
		'\t--card-next: rgba(255, 255, 255, .08);',
		'}',
	].join('\n');
}
