/** The social card: what a shared link looks like when it has a picture.
 *
 *  Split in two on purpose. `cardSvg` builds an SVG string and is pure — no
 *  native module, no filesystem, testable by reading the markup. `renderCard`
 *  rasterises it, and is the only thing in this repo that touches
 *  `@resvg/resvg-js`.
 *
 *  That split is not tidiness. The interesting failures here are about layout
 *  and text, and a test that can only assert "a PNG came back" cannot see any of
 *  them — least of all the one below.
 *
 *  FONTS ARE PASSED EXPLICITLY, ALWAYS. System font discovery does not work on
 *  the deployment image and does not say so. Measured on node:24-slim, the same
 *  SVG rendered three ways:
 *
 *      no fonts, loadSystemFonts: true          492 bytes
 *      fonts-dejavu-core installed, same        492 bytes
 *      explicit fontFiles                     3,968 bytes
 *
 *  492 bytes is the background with the text DROPPED — a valid PNG, no error,
 *  no warning. A renderer written against `loadSystemFonts` ships blank cards
 *  and passes any test that checks only that bytes came back. See
 *  data/fonts/README.md.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './html.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The card size every social reader crops to. 1200x630 is the ratio Open Graph
 *  and Twitter both use; anything else gets cut somewhere unpredictable. */
export const CARD = { width: 1200, height: 630 };

export const FONTS = [
	join(ROOT, 'data', 'fonts', 'LiberationSans-Regular.ttf'),
	join(ROOT, 'data', 'fonts', 'LiberationSans-Bold.ttf'),
];

/** Roughly how wide a string is, in units of font size.
 *
 *  An average advance width, not a real measurement: proper text metrics need
 *  the font parsed, which is what `opentype.js` does on the football site and is
 *  a second dependency. This exists to answer one question — "will this overflow
 *  the card" — and for that a conservative estimate is enough, because the
 *  answer only has to be right about the long names.
 *
 *  0.52 is measured against Liberation Sans rather than guessed: the widest
 *  club name this repo carries is "Jacksonville Jaguars" at 20 characters, and
 *  the estimate has to keep that on the card at the size below.
 *
 *  Wrong in the safe direction. Overestimating shrinks text that would have fit;
 *  underestimating runs it off the edge, where nobody sees it because the card
 *  is a picture nobody views at full size.
 */
export const AVERAGE_ADVANCE = 0.52;
export const textWidth = (text, fontSize) => String(text).length * fontSize * AVERAGE_ADVANCE;

/** The largest size at which this text still fits, never larger than `max`. */
export function fitFontSize(text, maxWidth, max, min = 24) {
	if (!text) return max;
	const ideal = maxWidth / (String(text).length * AVERAGE_ADVANCE);
	return Math.max(min, Math.min(max, Math.floor(ideal)));
}

/** The card for a club page: the question, the answer, the record.
 *
 *  The same three things the page leads with, because a card that says something
 *  else is a second version of the page that can disagree with it.
 *
 *  Colours come from the club's own palette, which is already resolved for every
 *  page — so a card is the club's colours rather than a house style, exactly as
 *  the page is.
 */
export function cardSvg({ question, answer, record, sub = null, colors, footer = null }) {
	const { width: W, height: H } = CARD;
	const base = colors?.base ?? '#101418';
	const accent = colors?.accent ?? '#ffffff';
	const text = colors?.text ?? '#ffffff';

	// Sized to fit rather than assumed to. "Are the Jaguars Undefeated?" is a
	// third longer than "Are the Jets Undefeated?", and a fixed size that suits
	// one runs the other off the edge.
	const qSize = fitFontSize(question, W - 160, 64, 32);
	const aSize = fitFontSize(answer, W - 160, 200, 72);
	const rSize = fitFontSize(record, W - 160, 44, 24);

	const line = (content, y, size, fill, weight = 'bold') => (content
		? `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Liberation Sans" `
			+ `font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(String(content))}</text>`
		: '');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${base}"/>
${line(question, 150, qSize, accent)}
${line(answer, 360, aSize, text)}
${line(record, 460, rSize, accent, 'normal')}
${line(sub, 520, 30, text, 'normal')}
${line(footer, H - 48, 26, accent, 'normal')}
</svg>`;
}

/** Turn an SVG into a PNG.
 *
 *  The one place `@resvg/resvg-js` is used, and it is imported lazily so that
 *  every test which does not render an image runs without loading a native
 *  module — and so a deployment whose card routes are never hit does not pay for
 *  it at boot.
 */
export async function renderCard(svg, { fonts = FONTS } = {}) {
	const { Resvg } = await import('@resvg/resvg-js');
	return new Resvg(svg, {
		// Never `loadSystemFonts: true`. See the header: it finds nothing on the
		// deployment image and reports success.
		font: { loadSystemFonts: false, fontFiles: fonts, defaultFontFamily: 'Liberation Sans' },
		fitTo: { mode: 'width', value: CARD.width },
	}).render().asPng();
}

/** Whether the fonts this renderer needs are actually present.
 *
 *  Checked rather than assumed, because the failure it guards is silent: a
 *  missing font file does not throw, it produces a card with no words on it.
 *  The server reports this at boot the way it reports an unreachable database —
 *  a card route that cannot draw text should say so, not serve a blank picture.
 */
export const fontsPresent = (fonts = FONTS) => fonts.every((f) => {
	try { return readFileSync(f).length > 0; } catch { return false; }
});
