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

/** WCAG AA for large text. See choosePalette for why this is not 4.5. */
export const LEGIBLE = 3;

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
 *  3:1 is the bar, which is WCAG AA for LARGE text — and large is what the
 *  accent carries: a heading at 30 to 48px, a verdict at 42 to 64px, and bold
 *  labels below that.
 *
 *  It was 4.5 first, which is the bar for body text, and that rejected the
 *  Bears' own orange at 3.46:1 in favour of white. White is more readable and is
 *  not the Bears; a rule that discards a club's identity for a margin it does
 *  not need is the wrong rule. Their own site puts that orange on that navy.
 *
 *  Where nothing clears 3:1 the accent falls back rather than rendering
 *  illegibly — the Angels publish three dark colours whose best pair is 1.9:1,
 *  and a heading nobody can read is not a club's identity either.
 */
export function choosePalette(colors, fallback) {
	const list = colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c ?? ''));
	if (!list.length) return fallback;
	if (list.length === 1) return { base: list[0], accent: fallback.accent };

	const base = list.reduce((a, b) => (luminance(a) <= luminance(b) ? a : b));
	const rest = list.filter((c) => c !== base);
	const readable = rest.find((c) => contrast(base, c) >= LEGIBLE);
	return { base, accent: readable ?? fallback.accent };
}
