/** Where a page can be shared to, as plain links.
 *
 *  Every target here is a URL with query parameters, so the whole feature works
 *  with no script — the same way the standings modal is a CSS `:target` and the
 *  club switcher is a `<details>`. That is a decision this repo made when
 *  sortable tables were built, not a rule it has always had, and it holds here
 *  because sharing to a platform genuinely is a link.
 *
 *  What a script WOULD buy is copy-to-clipboard and the phone's native share
 *  sheet, neither of which can be a link. The URL is shown in a field a reader
 *  can select instead, which is worse and works.
 *
 *  The icon names are checked against the pinned stylesheet rather than
 *  remembered -- a name that does not exist renders as a blank box, which no
 *  test here can see and no error reports. Verified for @mdi/font 7.4.47, the
 *  version lib/render.js links:
 *
 *      node -e "fetch('https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css')
 *        .then(r=>r.text()).then(c=>console.log(/\.mdi-reddit(?=[:,{])/.test(c)))"
 *
 *  Not a test, deliberately: it needs the network, and a suite that fails when
 *  a CDN is slow is a suite people learn to ignore. Re-run it by hand when the
 *  pinned version changes or an icon is added.
 *
 *  ORDER MATTERS AND IS NOT ALPHABETICAL. The two sites are read on phones,
 *  where a text message is how a game gets shared with the person you are
 *  watching it with — so messaging comes before the platforms.
 */

/** Percent-encode for a query string, including the characters
 *  `encodeURIComponent` leaves alone that some readers mangle in a URL. */
const q = (s) => encodeURIComponent(String(s ?? ''))
	.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The targets, in the order they are shown.
 *
 *  Declared as data so adding one is a row rather than a branch, and so the
 *  test can walk them all rather than naming each — a target added later with a
 *  broken URL would otherwise be found by a reader rather than by the suite.
 */
export const TARGETS = [
	{
		id: 'sms',
		label: 'Message',
		icon: 'message-text',
		// `sms:?&body=` rather than `sms:?body=`: the stray ampersand is what
		// makes one link work on both iOS and Android, which otherwise disagree
		// about the separator after the empty recipient.
		href: ({ url, text }) => `sms:?&body=${q(`${text} ${url}`)}`,
	},
	{
		id: 'email',
		label: 'Email',
		icon: 'email-outline',
		href: ({ url, text, title }) => `mailto:?subject=${q(title)}&body=${q(`${text}\n\n${url}`)}`,
	},
	{
		id: 'bluesky',
		label: 'Bluesky',
		icon: 'butterfly-outline',
		href: ({ url, text }) => `https://bsky.app/intent/compose?text=${q(`${text} ${url}`)}`,
	},
	{
		id: 'x',
		label: 'X',
		icon: 'alpha-x-box-outline',
		href: ({ url, text }) => `https://twitter.com/intent/tweet?url=${q(url)}&text=${q(text)}`,
	},
	{
		id: 'facebook',
		label: 'Facebook',
		icon: 'facebook',
		href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`,
	},
	{
		id: 'reddit',
		label: 'Reddit',
		icon: 'reddit',
		href: ({ url, title }) => `https://www.reddit.com/submit?url=${q(url)}&title=${q(title)}`,
	},
];

/** Every share link for one page.
 *
 *  Returns [] without a URL rather than building links to nowhere. A share menu
 *  offering to post an empty address is worse than no menu.
 */
export function shareLinks({ url, title, text }) {
	if (!url) return [];
	const ctx = { url, title: title || '', text: text || title || '' };
	return TARGETS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, href: t.href(ctx) }));
}
