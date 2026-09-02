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

/* The data credit. Quiet on purpose -- it is an obligation rather than
   content, and it should be findable without competing with the answer the page
   exists to give. The required notice is quieter still and wraps to its own
   block, because it is a sentence rather than a list. */
.credits { margin: 2.5rem 0 0; max-width: 900px; font-size: .8rem; }
.credit-list { margin: 0; color: var(--muted); }
.credits a { color: var(--muted); text-decoration: none; border-bottom: 1px dotted currentColor; }
.credits a:hover { color: var(--text); }
.notice {
	margin: .75rem 0 0;
	/* NOT muted, and not faded. Retrosheet's terms require their statement to
	   appear "prominently", so it takes the page's own text colour while the
	   courtesy credits above it stay quiet. Styling it like the rest was the
	   design overruling a licence term without anyone deciding to. */
	color: var(--text);
	line-height: 1.5;
}

.corrections { margin: .35rem 0 0; color: var(--muted); line-height: 1.5; }

/* A sortable header is a link, and has to look like one without becoming a
   second kind of link. It inherits the header's own muted colour and only
   brightens on hover and when it is the active column, so a table that has
   never been sorted reads exactly as it did before sorting existed.

   The arrow is in the flow rather than positioned, so a column cannot have its
   heading overlapped by it at a narrow width. */
.league-table th a.sort {
	color: inherit;
	text-decoration: none;
	display: inline-flex;
	align-items: center;
	gap: .25em;
	white-space: nowrap;
}
.league-table th a.sort:hover { color: var(--text); text-decoration: underline; }
.league-table th a.sort.sorted { color: var(--text); }
.sort-arrow { font-size: .8em; line-height: 1; }

/* The leaders table is mostly numbers, and which column they start in depends
   on whether a club column is shown — so every cell gets tabular figures and
   the name column is told to stop being one. Columns cannot be selected by
   meaning in CSS, and a nth-child list would be wrong for exactly the scope
   that adds the extra column. */
.leaders-table td { font-variant-numeric: tabular-nums; }
.leaders-table td:first-child { font-variant-numeric: normal; }
.leaders-table th:first-child { min-width: 11rem; }

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

/* One championship per chip, weighted by what it was. A Super Bowl is what
   anyone means by "titles", so it carries the accent; an older league title is
   present but quieter; a championship with no recorded name is quieter still
   rather than being dressed up as something it may not be. */
.title-row { display: block; }
.title-group { display: block; margin: .15rem 0 .35rem; }
.title-kind {
	display: block;
	font-size: .65rem;
	letter-spacing: .06em;
	text-transform: uppercase;
	color: var(--muted);
}
.title-kind.sb { color: var(--accent); font-weight: 700; }
.title-chips { display: flex; flex-wrap: wrap; gap: .25rem; margin: .2rem 0 .5rem; }
.title-chip {
	font-size: .75rem;
	font-variant-numeric: tabular-nums;
	padding: .05rem .3rem;
	border-radius: 4px;
	border: 1px solid transparent;
}
.title-chip.sb { color: var(--base); background: var(--accent); font-weight: 700; }
.title-chip.title { color: var(--accent); border-color: var(--accent); opacity: .85; }
.title-chip.plain { color: var(--text); border-color: var(--panel-edge); opacity: .7; }

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

.record-card h2 a { color: inherit; text-decoration: none; }
.record-card h2 a:hover { text-decoration: underline; }

/* The note is what the list MEASURES, so it sits under the heading and above
   the numbers rather than beside the heading: at the 260px track this grid can
   collapse to, a two-part heading wraps into something that reads as two
   headings. */
.record-note {
	margin: -.25rem 0 .5rem;
	font-size: .7rem;
	line-height: 1.4;
	color: var(--text);
	opacity: .55;
}

/* One card's permalink marks that card. An outline rather than a different
   background: the cards already sit on --panel, and a second panel colour that
   only ever appears on one card reads as a different KIND of card. */
.record-card-focus {
	border-color: var(--accent);
	box-shadow: 0 0 0 1px var(--accent);
}

.record-card ol { margin: 0; padding-left: 1.2rem; font-size: .9rem; line-height: 1.6; }
.record-card b { color: var(--accent); font-variant-numeric: tabular-nums; }
/* A color on the base rule, not only on the variants. Without one a bare
   .season-link falls through to the browser's default anchor blue, which on
   this ground is barely legible — the .strong and .dim variants happened to set
   a colour, so the gap only appeared when opponent names started using the
   plain class. Third time this exact bug, and every time it took a screenshot
   rather than a test. */
.season-link { color: var(--text); text-decoration: none; font-variant-numeric: tabular-nums; border-bottom: 1px dotted currentColor; }
.season-link.strong { color: var(--accent); font-weight: 700; }
.season-link.dim { color: inherit; opacity: .6; font-size: .85em; }
.season-link:hover { color: var(--accent); opacity: 1; }
.dim { opacity: .6; font-size: .85em; }
/* And a base rule under all of them, because the comment above was written
   after the THIRD time and did not stop the fourth: the "show the whole season"
   link on the schedule went in with no class and rendered dark blue on dark
   grey. Every fix so far has been to one more class, which is a list that has to
   be remembered; a default cannot be forgotten. Anything with its own colour
   still wins on specificity, so this changes nothing that already worked. */
a { color: var(--text); }

/* The standings modal, opened by the record. The :target pseudo-class and
   nothing else — this repo ships no client script, and adding a bundle to open a
   box would be a bad trade. Hidden by default and last in the document, so a
   browser that never applies this rule shows the table at the foot of the page
   instead of over it.

   NO BACKTICKS ANYWHERE IN THIS FILE. The stylesheet is one template literal, so
   a backtick in a comment ends it and everything after becomes JavaScript. This
   comment quoted the pseudo-class in backticks and did exactly that, while
   being written; CLAUDE.md records the two previous times. That is why the prose
   above spells the name out instead of quoting it, and why a test now asserts
   this file contains no backtick outside its own template markers. */
.record-link { text-decoration: none; border-bottom: 1px dotted currentColor; cursor: pointer; }
.modal { display: none; }
.modal:target {
	display: flex;
	position: fixed;
	inset: 0;
	z-index: 10;
	align-items: center;
	justify-content: center;
	padding: 1rem;
}
/* Covers the page, sits UNDER the card, and is a link so that clicking away
   closes. A div here would need script to do the same. */
.modal-dismiss { position: absolute; inset: 0; background: var(--scrim); }
.modal-card {
	position: relative;
	/* OPAQUE. --card and --panel are translucent black over the club's ground,
	   which is right for a panel sitting on the page and wrong for one floating
	   over it: the first version let the schedule and the streak banner read
	   straight through the table. The scrim dims what is behind, so a card at
	   full --base reads as raised. */
	background: var(--base);
	box-shadow: 0 12px 40px var(--shadow);
	border: 1px solid var(--panel-edge);
	border-radius: 10px;
	padding: 1.4rem 1.2rem 1rem;
	max-width: 32rem;
	width: 100%;
	/* A division is five clubs, but the viewport is the constraint on a phone in
	   landscape, so the card scrolls rather than overflowing the screen. */
	max-height: 90vh;
	overflow-y: auto;
}
.modal-close {
	position: absolute;
	top: .4rem;
	right: .7rem;
	font-size: 1.4rem;
	line-height: 1;
	text-decoration: none;
	opacity: .7;
}
.modal-close:hover { opacity: 1; }
.modal-card h2 { margin: 0 0 .8rem; font-size: 1rem; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
/* The club whose page this is. Without it the table is five rows of equals and
   the reader has to find themselves in it. */
.standings-table tr.here { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.standings-table tr.here td { font-weight: 700; }

/* The history sparkline. */
.spark { width: 100%; max-width: 600px; height: 60px; margin: 1rem 0 .2rem; display: block; }
.spark-line { stroke: var(--accent); stroke-width: 1.4; }
.spark-base { stroke: var(--accent); opacity: .35; stroke-width: 1; }

/* On this day. A grid rather than a table because the five parts must line up
   down the page while the opponent takes whatever width is left -- the same
   reasoning as .fixture, and the reason neither is a table. */
.otd-games { list-style: none; margin: .4rem 0 0; padding: 0; }
.otd-game {
	display: grid;
	grid-template-columns: auto auto auto 1fr auto;
	align-items: baseline;
	gap: .5rem;
	padding: .3rem 0;
	border-bottom: 1px solid var(--panel-edge);
	text-align: left;
	font-size: .9rem;
}
.otd-game:last-child { border-bottom: 0; }
.otd-result { font-weight: 700; }
.otd-result.win { color: var(--win); }
.otd-result.loss { color: var(--loss); }
.otd-score, .otd-season { font-variant-numeric: tabular-nums; }
.otd-date { font-size: .8rem; white-space: nowrap; }
.otd-empty { text-align: center; }

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

/* Every stepper is one chevron family: the same glyph at the same weight, a bar
   for the ends, doubled for ten. The club page used to mix three different
   characters — U+22D8, U+00AB, U+2039 — and the first of those is a MATHEMATICAL
   symbol drawn to different proportions, so it never matched the other two at
   any size. Tabular width keeps the row from shifting as the glyph count
   changes between them. */
.season-nav a, .season-nav .step-off {
	font-variant-numeric: tabular-nums;
	min-width: 2.4rem;
	text-align: center;
}
/* An end that cannot be stepped to is dimmed in place rather than dropped. The
   club page dropped them, so the row changed width as you moved through the
   seasons, which reads as a rendering fault rather than a boundary. */
.season-nav .step-off {
	border: 1px solid var(--panel-edge);
	border-radius: 6px;
	padding: .3rem .7rem;
	font-weight: bold;
	line-height: 1;
	opacity: .35;
}
/* Which axis this row steps. A schedule page carries two of these — seasons and
   days — and without the name the only difference between them is the value in
   the middle. */
.nav-label {
	font-size: .65rem;
	letter-spacing: .1em;
	text-transform: uppercase;
	color: var(--muted);
	margin-right: .2rem;
}

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
/* Sports across the top of a league page. Tighter than the site nav and closer
   to the content it switches, because it changes what you are looking at rather
   than where you are. */
.sport-tabs { margin: 0 0 1rem; gap: .8rem; font-size: .8rem; }

/* The history chart. Same line and baseline as the sparkline, four times the
   height, because this one is the page rather than a glance. */
.history-chart { width: 100%; max-width: 1000px; height: auto; display: block; margin: 1rem 0 .3rem; }
.history-title { fill: var(--accent); stroke: var(--base); stroke-width: 1.5; }
.history-table td:nth-child(n+3) { font-variant-numeric: tabular-nums; }

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

/* Share. Reuses the switcher's disclosure so the two read as the same kind of
   control, and lays its targets out as a wrapping row rather than a list -- six
   short labels down the page is a lot of vertical space for something a reader
   opens, uses once and closes. */
.share-targets {
	list-style: none;
	margin: .4rem 0 0;
	padding: 0;
	display: flex;
	flex-wrap: wrap;
	gap: .4rem .9rem;
	justify-content: center;
}
.share-targets a { color: var(--text); text-decoration: none; border-bottom: 1px dotted currentColor; }
.share-targets a:hover { color: var(--accent); }
.share-url { display: flex; align-items: center; gap: .5rem; margin: .7rem 0 .2rem; font-size: .8rem; }
/* The fallback for the copy button this has no script to provide. It has to be
   selectable, so it is readonly rather than disabled. */
.share-url input {
	flex: 1;
	min-width: 0;
	font: inherit;
	font-size: .8rem;
	padding: .25rem .4rem;
	color: var(--text);
	background: var(--base-deep);
	border: 1px solid var(--panel-edge);
	border-radius: 4px;
}

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
		// Only when there is one. Most clubs have no deep variant, and this line
		// was emitting the literal text "--base-deep: undefined;" — an invalid
		// declaration, so nothing broke and nothing said so, which is the exact
		// shape of the "undefined rendering into a page" failure CLAUDE.md is
		// about. Anything reading it falls back to --base instead.
		...(colors.baseDeep ? [`\t--base-deep: ${colors.baseDeep};`] : []),
		'\t--text: #ffffff;',
		'\t--muted: #b0b0b0;',
		'\t--win: #4caf50;',
		'\t--loss: #f44336;',
		'\t--shadow: rgba(0, 0, 0, .3);',
		// The modal's scrim. Declared here rather than written into the rule,
		// because colour belongs in a custom property — the two sites carry 282
		// hex literals between them and not one variable, and that is the rule
		// this repo starts from.
		'\t--scrim: rgba(0, 0, 0, .6);',
		'\t--panel: rgba(0, 0, 0, .2);',
		'\t--panel-edge: rgba(255, 255, 255, .12);',
		'\t--card: rgba(0, 0, 0, .2);',
		'\t--card-win: rgba(76, 175, 80, .1);',
		'\t--card-loss: rgba(244, 67, 54, .1);',
		'\t--card-next: rgba(255, 255, 255, .08);',
		'}',
	].join('\n');
}
