/** Choosing a club's two page colours from its published palette.
 *
 *  Clubs publish two to five colours in no particular role. A page needs a dark
 *  ground and one bright colour that is legible on it, and those are not simply
 *  "primary" and "secondary": the Cardinals lead with red, and red as a
 *  full-page ground is unreadable.
 */

/** Relative luminance, per WCAG. */
export function luminance(hex) {
	const n = parseInt(hex.slice(1), 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a, b) {
	const l1 = Math.max(luminance(a), luminance(b));
	const l2 = Math.min(luminance(a), luminance(b));
	return (l1 + 0.05) / (l2 + 0.05);
}

/** The page's ground and accent, from however many colours a club publishes.
 *
 *  The ground is the darkest, because the page is dark.
 *
 *  The accent is the FIRST remaining colour that is legible on it, not the most
 *  legible. That distinction matters: picking maximum contrast gave the Brewers
 *  white over their own gold, which is more readable and less theirs. Clubs list
 *  their colours in order of identity, so the first that clears the bar is both
 *  legible and recognisably the club's.
 *
 *  4.5:1 is WCAG AA for body text, and the accent carries the heading, the
 *  record and the navigation. Where nothing clears it, the most legible colour
 *  wins — a club whose whole palette is dark blues gets the least bad option
 *  rather than an unreadable one.
 */
export function choosePalette(colors, fallback) {
	const list = colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c ?? ''));
	if (!list.length) return fallback;
	if (list.length === 1) return { base: list[0], accent: fallback.accent };

	const base = list.reduce((a, b) => (luminance(a) <= luminance(b) ? a : b));
	const rest = list.filter((c) => c !== base);
	const readable = rest.find((c) => contrast(base, c) >= 4.5);
	if (readable) return { base, accent: readable };

	// Nothing clears the bar. Take the most legible of what is left, unless even
	// that is illegible — the Angels publish three dark colours, whose best pair
	// is 1.9:1, and a heading nobody can read is not a club's identity either.
	const best = rest.reduce((a, b) => (contrast(base, a) >= contrast(base, b) ? a : b));
	return { base, accent: contrast(base, best) >= 3 ? best : fallback.accent };
}
