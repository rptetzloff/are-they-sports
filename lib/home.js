/** The home page of a site with more than one club: every league's games for
 *  the day, a section a league with the live ones first, the visitor's own
 *  teams above them, and every club to find below.
 *
 *  The page is drawn here and filled in the browser (web/home/home.js) from
 *  /api/today (lib/today.js), so it changes day and refreshes while games are
 *  live without a reload. Pinned teams are the visitor's own, kept in their
 *  browser. */
import { page, escapeHtml as esc, NEUTRAL } from './render.js';

const CSS = `<style>
body { justify-content: flex-start; }
.home { width: 100%; max-width: 980px; text-align: left; }
.home-head { text-align: center; margin-bottom: .5rem; }
.home-head h1 { margin: 0 0 .25rem; }
.home-head p { margin: 0; color: var(--muted); }
.datebar { display: flex; align-items: center; justify-content: center; gap: 1rem; margin: 1.25rem 0 1rem; }
.datebar h2 { margin: 0; font-size: 1.15rem; min-width: 14rem; text-align: center; }
.datebar button { font: inherit; font-size: 1.3rem; line-height: 1; padding: .3rem .8rem; border-radius: 8px;
	border: 1px solid var(--panel-edge); background: var(--panel); color: var(--text); cursor: pointer; }
.datebar .live-count { color: var(--loss); font-weight: 700; font-size: .85rem; }
.tvbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .5rem 1rem; margin: -.25rem 0 1rem; font-size: .9rem; }
.tvbar label { display: flex; align-items: center; gap: .4rem; color: var(--muted); }
.tvbar select { font: inherit; max-width: 18rem; padding: .3rem .5rem; border-radius: 8px; border: 1px solid var(--panel-edge); background: var(--base); color: var(--text); color-scheme: dark; }
.tvbar a { color: var(--muted); }
/* A channel number: a small pill after the network's name, as the club and
   league pages show it (web/<sport>/styles.css .ch-pill). */
.ch-pill { display: inline-block; font-size: .78em; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.3;
	color: var(--text); border: 1px solid var(--panel-edge); background: var(--base); border-radius: 999px;
	padding: 0 .5em; margin-left: .35em; vertical-align: .08em; white-space: nowrap; }
.g .tv .on { color: var(--text); }
.lg { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 12px; padding: .75rem 1rem; margin: 0 0 1rem; }
.lg h2 { margin: 0 0 .4rem; font-size: 1.05rem; display: flex; align-items: baseline; gap: .6rem; }
.lg h2 a { color: var(--accent); text-decoration: none; }
.lg h2 a:hover { text-decoration: underline; }
.lg h2 .count { color: var(--muted); font-weight: 400; font-size: .85rem; }
.lg.none { padding: .5rem 1rem; }
.lg.none h2 { margin: 0; }
.lg.none .day-games { display: none; }
.lg.mine { border-color: var(--accent); }
.day-games { list-style: none; margin: 0; padding: 0; }
.g { display: grid; grid-template-columns: 6.5rem minmax(0, 19rem) minmax(0, 1fr); gap: .2rem 1.2rem; align-items: center;
	padding: .45rem 0; border-top: 1px solid var(--panel-edge); }
.g:first-child { border-top: 0; }
.g .when { font-size: .85rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.g.s-in .when { color: var(--loss); font-weight: 700; }
.g.s-in .when::before { content: ''; display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: var(--loss); margin-right: .35rem; vertical-align: middle; }
.g .teams { display: grid; gap: .15rem; min-width: 0; }
.g .t { display: grid; grid-template-columns: 1fr auto; gap: .45rem; align-items: center; min-width: 0; }
.g .t .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.g .t a { color: var(--text); text-decoration: none; border-bottom: 1px dotted currentColor; }
.g .t a:hover { color: var(--accent); }
.g .t .sc { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 1.6rem; text-align: right; }
.g.s-post .t:not(.won) { opacity: .65; }
.g .t .rec { color: var(--muted); font-size: .75rem; margin-left: .3rem; }
.g .t .star { color: var(--accent); margin-right: .15rem; }
.g .tv { font-size: .8rem; color: var(--muted); text-align: right; overflow-wrap: anywhere; }
.g .tv .more { opacity: .8; }
.mine .empty { margin: .2rem 0 0; color: var(--muted); font-size: .9rem; }
.mine .rest { margin: .4rem 0 0; font-size: .9rem; color: var(--muted); }
.mine .rest a { color: var(--text); }
.find { margin-top: 1.75rem; }
.find h2 { font-size: 1.05rem; margin: 0 0 .5rem; }
.find input[type=search] { width: 100%; max-width: 22rem; font: inherit; padding: .45rem .7rem; border-radius: 8px;
	border: 1px solid var(--panel-edge); background: var(--panel); color: var(--text); margin-bottom: .6rem; }
.find details { border-top: 1px solid var(--panel-edge); padding: .4rem 0; }
.find summary { cursor: pointer; font-weight: 700; }
.find summary a { color: var(--accent); font-weight: 400; font-size: .85rem; margin-left: .5rem; }
.find ul { list-style: none; padding: 0; margin: .5rem 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .25rem .75rem; }
.find li { display: flex; align-items: center; gap: .35rem; }
.find li a { color: var(--text); text-decoration: none; }
.find li a:hover { color: var(--accent); }
.find li .off { color: var(--muted); }
.pin { font: inherit; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0 .15rem; font-size: 1rem; line-height: 1; }
.pin[aria-pressed=true] { color: var(--accent); }
.home .note { color: var(--muted); font-size: .85rem; }
@media (max-width: 640px) {
	.g { grid-template-columns: 4.6rem 1fr; }
	.g .tv { grid-column: 2; text-align: left; }
	.datebar h2 { min-width: 0; font-size: 1rem; }
}
</style>`;

/** The page. `leagues`: `[{ sport, label, href }]` in the scope's order;
 *  `clubs`: `[{ sport, key, name, url, available }]`. */
export function homePage({ heading = 'Are They On TV?', leagues, clubs, footer = '', credits = '', colors = NEUTRAL }) {
	const byLeague = leagues.map((l) => {
		const mine = clubs.filter((c) => c.sport === l.sport);
		const item = (c) => `<li data-find="${esc(`${c.name} ${l.label}`.toLowerCase())}">${c.available
			? `<a href="${esc(c.url)}">${esc(c.name)}</a>` : `<span class="off">${esc(c.name)}</span>`}
<button type="button" class="pin" data-pin="${esc(c.key)}" data-name="${esc(c.name)}" data-url="${esc(c.url ?? '')}" aria-pressed="false" aria-label="Pin ${esc(c.name)}" title="Pin to the top">☆</button></li>`;
		return `<details data-league="${esc(l.sport)}"><summary>${esc(l.label)} <span class="note">${mine.length} clubs</span>${l.href ? `<a href="${esc(l.href)}">scores, standings, records</a>` : ''}</summary>
<ul>${mine.map(item).join('')}</ul></details>`;
	}).join('\n');
	const sections = leagues.map((l) => `<section class="lg" data-sport="${esc(l.sport)}" aria-live="polite">
<h2>${l.href ? `<a href="${esc(l.href)}">${esc(l.label)}</a>` : esc(l.label)} <span class="count">…</span></h2>
<ol class="day-games"></ol></section>`).join('\n');
	return page({
		title: heading,
		colors,
		body: `${CSS}<div class="home">
<header class="home-head"><h1>${esc(heading)}</h1><p>Every league's games, and where they are on TV</p></header>
<nav class="datebar" aria-label="Day">
<button type="button" data-step="-1" aria-label="The day before">‹</button>
<h2 id="day">Today</h2>
<button type="button" data-step="1" aria-label="The day after">›</button>
</nav>
<div class="tvbar" id="tvbar" hidden>
<label>Your TV <select id="provider" aria-label="Your TV provider"><option value="">Choose a provider for channel numbers…</option></select></label>
<label id="area-wrap" hidden>Area <select id="area" aria-label="Your service area"></select></label>
<a href="tv/submit" class="note">Missing a channel?</a>
</div>
<section class="lg mine" id="mine" hidden><h2>★ My teams</h2><ol class="day-games"></ol><p class="empty" hidden></p><p class="rest" hidden></p></section>
<div id="leagues" data-leagues="${esc(JSON.stringify(leagues.map((l) => l.sport)))}">
${sections}
</div>
<section class="find"><h2>Find your team</h2>
<input type="search" id="find" placeholder="A team or a city" aria-label="Find a team">
${byLeague}
<p class="note">☆ pins a team to the top of this page, in this browser.</p>
</section>
<noscript><p class="note">The day's games need JavaScript; every club's page is linked above.</p></noscript>
</div>
${credits}
${footer}
<script type="module" src="/home.js"></script>`,
	});
}
