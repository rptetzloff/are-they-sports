/** What a link to this page looks like when somebody pastes it somewhere.
 *
 *  Every page here previewed as NOTHING: no `og:` tags, no `twitter:` tags, no
 *  description, no canonical. Paste a club URL into Slack or iMessage and you
 *  got a bare link. That is worth fixing before share buttons exist, because
 *  people share these URLs by copy-paste whether or not there is a button —
 *  the buttons make sharing easier, the tags make the result worth looking at.
 *
 *  INJECTED CENTRALLY RATHER THAN THREADED. `page()` is called from thirteen
 *  places and this repo has twice shipped a page missing something that was
 *  wired per call site: the leaders nav link answered 404 from every club page,
 *  and the data credit had to be added to two pages by hand. A fourteenth page
 *  added next month would silently have no tags.
 *
 *  So the tags go in where the response does, and every route gets them by
 *  construction. The cost is that the description is derived rather than
 *  written per page, which is why `describe` exists and why a caller CAN pass a
 *  better one — the club page knows the answer to its own question, and no
 *  derivation could.
 */

import { escapeHtml } from './html.js';

/** The og and twitter tags for one page.
 *
 *  `og:url` is absolute and comes from PUBLIC_ORIGIN where it is set. That
 *  matters more here than anywhere else in this repo: server.js already warns
 *  that without it any Host header becomes canonical, and a preview domain can
 *  publish itself as the real one — which for a canonical URL and a share card
 *  means a staging deploy telling every reader it IS the site.
 */
export function metaTags({ title, description, url, image, siteName = null, type = 'website' }) {
	const tag = (property, content) => (content
		? `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`
		: '');
	const named = (name, content) => (content
		? `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`
		: '');
	return [
		named('description', description),
		url ? `<link rel="canonical" href="${escapeHtml(url)}">` : '',
		tag('og:title', title),
		tag('og:description', description),
		tag('og:url', url),
		tag('og:type', type),
		tag('og:site_name', siteName),
		tag('og:image', image),
		// summary_large_image only when there IS an image. Declaring the large
		// card with nothing to put in it renders worse than the plain summary,
		// which is what the card falls back to.
		named('twitter:card', image ? 'summary_large_image' : 'summary'),
		named('twitter:title', title),
		named('twitter:description', description),
		named('twitter:image', image),
	].filter(Boolean).join('\n');
}

/** The title this page already gave itself.
 *
 *  Read back out of the rendered HTML rather than threaded in. Every page
 *  computes a good title — "Green Bay Packers records", "NFL champions" — and
 *  asking for it twice is how the two drift apart.
 *
 *  This parses HTML with a regular expression, which is usually a mistake and is
 *  safe here for one reason: the HTML is ours, produced by `page()` four lines
 *  after a `<title>` we escaped ourselves. It is not parsing the web.
 */
export const titleOf = (html) => {
	const m = /<title>([^<]*)<\/title>/i.exec(html);
	return m ? m[1] : '';
};

/** Put the tags in the head of an already-rendered page.
 *
 *  Before `</head>`, and returns the page untouched when there is no head to
 *  put them in — a JSON body or an error string must pass through rather than
 *  gain a stray block of markup.
 */
export function withMeta(html, meta) {
	if (typeof html !== 'string' || !html.includes('</head>')) return html;
	const tags = metaTags({ title: titleOf(html), ...meta });
	if (!tags) return html;
	return html.replace('</head>', `${tags}\n</head>`);
}

/** A description for a page that did not supply one.
 *
 *  Deliberately dull and always true. The alternative was leaving it out, and a
 *  preview with a title and no description is worse than one with a plain
 *  sentence: the sentence is what tells a reader in a group chat whether the
 *  link is about the club they follow.
 */
export const describe = (title) => (title
	? `${title}. Every game, season and record, from the first one on.`
	: '');
