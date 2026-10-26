/** The strip of scores along the top of every page of a site with more than
 *  one club (Ray, 2026-10-25): every league with games that day, the NFL's
 *  whole week, the page's own league first unless the visitor has chosen an
 *  order. The visitor can hide leagues and reorder them, in their browser
 *  (web/home/leagues-pref.js); the home page's sections follow the same
 *  choice. The games are drawn in the browser (web/home/scorebar.js) from
 *  /api/today, so they move while the page is open; this is only the place
 *  they go and which leagues there are.
 *
 *  Added by the server as each page goes out (server.js), first in <body>,
 *  so no page has to remember it. */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The leagues a page's strip offers, in their order before the visitor's
 *  own: the scope's, with the page's league first (`/nba/...` NBA). None on
 *  the admin and the channel forms. */
export function scorebarSports(pathname, sports) {
	if (/\/(?:tv|admin)(?:\/|$)/.test(pathname)) return [];
	const first = pathname.match(/^\/([a-z]+)(?:\/|$)/)?.[1];
	return first && sports.includes(first) ? [first, ...sports.filter((s) => s !== first)] : sports;
}

const CSS = `<style>
#scorebar { align-self: stretch; box-sizing: border-box; position: relative; z-index: 40; text-align: left;
	font-family: Arial, Helvetica, sans-serif; font-size: .78rem; line-height: 1.25; }
#scorebar .sb-bar { display: flex; position: relative;
	background: color-mix(in srgb, currentColor 7%, transparent); border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
#scorebar .sb-pick { flex: none; display: grid; place-items: center; gap: .1rem; width: 3.4rem; padding: .3rem 0; border: 0;
	border-right: 1px solid color-mix(in srgb, currentColor 14%, transparent); background: none; color: inherit; font: inherit; font-size: .62rem; cursor: pointer; opacity: .8; }
#scorebar .sb-pick:hover, #scorebar .sb-pick[aria-expanded=true] { opacity: 1; background: color-mix(in srgb, currentColor 9%, transparent); }
#scorebar .sb-pick span:first-child { font-size: 1rem; line-height: 1; }
#scorebar .sb-scroll { position: relative; flex: 1; min-width: 0; }
#scorebar .sb-row { display: flex; gap: 1px; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; overscroll-behavior-x: contain; }
#scorebar .sb-row::-webkit-scrollbar { display: none; }
#scorebar .sb-none { padding: .9rem .8rem; opacity: .7; }
#scorebar .sb-lg { flex: none; display: flex; align-items: center; padding: 0 .6rem; letter-spacing: .04em; opacity: .75; scroll-snap-align: start;
	background: none; border: 0; color: inherit; font: inherit; font-weight: 700; cursor: pointer; white-space: nowrap; }
#scorebar .sb-lg:hover { opacity: 1; background: color-mix(in srgb, currentColor 9%, transparent); }
#scorebar .sb-lg[aria-expanded=false] { opacity: .9; }
#scorebar .sb-lg:not(:first-child) { border-left: 2px solid color-mix(in srgb, currentColor 22%, transparent); }
#scorebar .sb-g { flex: none; display: grid; gap: .1rem; min-width: 6.6rem; padding: .35rem .6rem; color: inherit; text-decoration: none; scroll-snap-align: start;
	border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
#scorebar a.sb-g:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
#scorebar .sb-st { font-size: .68rem; opacity: .75; white-space: nowrap; }
#scorebar .s-in .sb-st { opacity: 1; color: #e5484d; font-weight: 700; }
#scorebar .s-in .sb-st::before { content: ''; display: inline-block; width: .4rem; height: .4rem; border-radius: 50%; background: currentColor; margin-right: .3rem; vertical-align: middle; }
#scorebar .sb-t { display: grid; grid-template-columns: 1rem auto 1fr; gap: .35rem; align-items: center; white-space: nowrap; }
#scorebar .sb-t img { width: 1rem; height: 1rem; object-fit: contain; }
#scorebar .sb-t b { text-align: right; font-variant-numeric: tabular-nums; }
#scorebar .s-post .sb-t:not(.won) { opacity: .6; }
#scorebar .mine .sb-t.me { font-weight: 700; }
#scorebar .sb-panel { position: absolute; left: 0; top: 100%; z-index: 60; min-width: 15rem; padding: .6rem .75rem; margin: 0;
	background: var(--bg, var(--base, #222)); color: inherit; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-top: 0;
	border-radius: 0 0 10px 0; box-shadow: 0 8px 20px rgb(0 0 0 / .35); }
#scorebar .sb-panel[hidden] { display: none; }
#scorebar .sb-panel h2 { font-size: .8rem; margin: 0 0 .4rem; letter-spacing: .04em; text-transform: uppercase; opacity: .75; }
#scorebar .sb-panel ol { list-style: none; margin: 0; padding: 0; }
#scorebar .sb-panel li { display: flex; align-items: center; gap: .3rem; padding: .15rem 0; }
#scorebar .sb-panel label { flex: 1; display: flex; align-items: center; gap: .45rem; font-size: .9rem; cursor: pointer; }
#scorebar .sb-panel input { width: 1rem; height: 1rem; margin: 0; }
#scorebar .sb-panel li button { width: 1.9rem; height: 1.9rem; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	background: none; color: inherit; font: inherit; cursor: pointer; }
#scorebar .sb-panel li button[disabled] { opacity: .3; cursor: default; }
#scorebar .sb-panel .sb-reset { margin-top: .5rem; background: none; border: 0; padding: 0; color: inherit; font: inherit; font-size: .8rem; text-decoration: underline; cursor: pointer; opacity: .8; }
#scorebar .sb-step { display: none; }
@media (hover: hover) and (pointer: fine) {
	#scorebar .sb-step { display: block; position: absolute; top: 0; bottom: 0; z-index: 1; width: 1.6rem; border: 0; padding: 0; cursor: pointer;
		font: inherit; font-size: 1.1rem; color: inherit; background: color-mix(in srgb, currentColor 10%, transparent); opacity: 0; transition: opacity .15s; }
	#scorebar .sb-scroll:hover .sb-step:not([disabled]) { opacity: .9; }
	#scorebar .sb-step[data-step="-1"] { left: 0; }
	#scorebar .sb-step[data-step="1"] { right: 0; }
}
</style>`;

/** The strip's place. `leagues` is `[{ sport, label }]` in the page's order;
 *  `club` the page's club ("nba/bucks", whose games come first) or none.
 *  Empty for no leagues. */
export function scorebarHtml({ leagues, club = null }) {
	if (!leagues?.length) return '';
	return `${CSS}<div id="scorebar" role="region" aria-label="Scores" data-api="/api/today"`
		+ ` data-leagues="${esc(JSON.stringify(leagues))}"${club ? ` data-club="${esc(club)}"` : ''} hidden>`
		+ '<div class="sb-bar">'
		+ '<button type="button" class="sb-pick" aria-expanded="false" aria-controls="sb-panel" title="Choose and order the leagues shown">'
		+ '<span aria-hidden="true">⚙</span><span>Leagues</span></button>'
		+ '<div class="sb-scroll">'
		+ '<button type="button" class="sb-step" data-step="-1" aria-label="Earlier games">‹</button>'
		+ '<div class="sb-row"></div>'
		+ '<button type="button" class="sb-step" data-step="1" aria-label="Later games">›</button>'
		+ '</div></div>'
		+ '<div class="sb-panel" id="sb-panel" hidden><h2>Leagues shown</h2><ol></ol>'
		+ '<button type="button" class="sb-reset">Show every league, in the usual order</button></div>'
		+ '</div><script type="module" src="/scorebar.js"></script>';
}

/** `html` with the strip first in its body. */
export function withScorebar(html, opts) {
	const bar = scorebarHtml(opts);
	return bar ? html.replace(/<body\b[^>]*>/, (tag) => `${tag}\n${bar}`) : html;
}
