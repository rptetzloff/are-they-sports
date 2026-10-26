/** The strip of the day's scores along the top of every page of a site with
 *  more than one club (Ray, 2026-10-25): a club's or a league's page shows
 *  its league's games, the home page every league's. The games are drawn in
 *  the browser (web/home/scorebar.js) from /api/today, so they move while the
 *  page is open; this is only the place they go and which leagues they are.
 *
 *  Added by the server as each page goes out (server.js), first in <body>,
 *  so no page has to remember it. */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Which leagues a page's strip shows, from its path: `/nba/...` NBA's,
 *  `/` every league's in the scope, anything else (the admin, the channel
 *  forms) none. */
export function scorebarSports(pathname, sports) {
	if (pathname === '/') return sports;
	if (/\/(?:tv|admin)(?:\/|$)/.test(pathname)) return [];
	const first = pathname.match(/^\/([a-z]+)(?:\/|$)/)?.[1];
	return first && sports.includes(first) ? [first] : [];
}

const CSS = `<style>
#scorebar { align-self: stretch; box-sizing: border-box; position: relative; z-index: 40; text-align: left;
	font-family: Arial, Helvetica, sans-serif; font-size: .78rem; line-height: 1.25;
}
#scorebar[hidden] { display: none; }
#scorebar .sb-row { background: color-mix(in srgb, currentColor 7%, transparent); border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	display: flex; gap: 1px; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; overscroll-behavior-x: contain; }
#scorebar .sb-row::-webkit-scrollbar { display: none; }
#scorebar .sb-lg { flex: none; display: flex; align-items: center; padding: 0 .6rem; font-weight: 700; letter-spacing: .04em; opacity: .75; scroll-snap-align: start; }
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
#scorebar .sb-step { display: none; }
@media (hover: hover) and (pointer: fine) {
	#scorebar .sb-step { display: block; position: absolute; top: 0; bottom: var(--sb-gap, 0px); width: 1.6rem; border: 0; padding: 0; cursor: pointer;
		font: inherit; font-size: 1.1rem; color: inherit; background: color-mix(in srgb, currentColor 10%, transparent); opacity: 0; transition: opacity .15s; }
	#scorebar:hover .sb-step:not([disabled]) { opacity: .9; }
	#scorebar .sb-step[data-step="-1"] { left: 0; }
	#scorebar .sb-step[data-step="1"] { right: 0; }
}
</style>`;

/** The strip's place, for leagues `sports`, on a page that is club `club`'s
 *  ("nba/bucks", whose games come first) or none's. Empty for no leagues. */
export function scorebarHtml({ sports, club = null }) {
	if (!sports?.length) return '';
	return `${CSS}<div id="scorebar" role="region" aria-label="Today's scores" data-api="/api/today" data-sports="${esc(sports.join(','))}"${club ? ` data-club="${esc(club)}"` : ''} hidden>`
		+ '<button type="button" class="sb-step" data-step="-1" aria-label="Earlier games">‹</button>'
		+ '<div class="sb-row"></div>'
		+ '<button type="button" class="sb-step" data-step="1" aria-label="Later games">›</button>'
		+ '</div><script type="module" src="/scorebar.js"></script>';
}

/** `html` with the strip first in its body. */
export function withScorebar(html, opts) {
	const bar = scorebarHtml(opts);
	return bar ? html.replace(/<body\b[^>]*>/, (tag) => `${tag}\n${bar}`) : html;
}
