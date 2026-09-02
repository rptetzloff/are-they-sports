import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AVERAGE_ADVANCE, CARD, FONTS, cardSvg, fitFontSize, fontsPresent, renderCard } from '../lib/card.js'
import { parseView } from '../lib/routes.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COLORS = { base: '#203731', accent: '#FFB612', text: '#ffffff' }

// ---------------------------------------------------------------------------
// The SVG, which is where the interesting failures are
// ---------------------------------------------------------------------------

test('the card is the size every social reader crops to', () => {
	// 1200x630 is the ratio Open Graph and Twitter both use. Anything else gets
	// cut somewhere unpredictable, and the thing cut is usually the answer.
	assert.deepEqual([CARD.width, CARD.height], [1200, 630])
	const svg = cardSvg({ question: 'q', answer: 'A', record: 'r', colors: COLORS })
	assert.match(svg, /width="1200" height="630"/)
	assert.match(svg, /viewBox="0 0 1200 630"/)
})

test('the card wears the club colours rather than a house style', () => {
	const svg = cardSvg({ question: 'q', answer: 'A', record: 'r', colors: COLORS })
	assert.ok(svg.includes('#203731'), 'the club ground is missing')
	assert.ok(svg.includes('#FFB612'), 'the club accent is missing')
})

test('a long club name is shrunk to fit rather than run off the edge', () => {
	// "Are the Jacksonville Jaguars Undefeated?" is a third longer than "Are the
	// Jets Undefeated?", and one font size cannot serve both. Overflow is the
	// silent version: nobody views a card at full size to notice.
	const short = cardSvg({ question: 'Are the Jets Undefeated?', answer: 'NO', record: 'r', colors: COLORS })
	const long = cardSvg({
		question: 'Are the Jacksonville Jaguars Undefeated?', answer: 'NO', record: 'r', colors: COLORS,
	})
	const sizeOf = (svg) => Number(/font-size="(\d+)"/.exec(svg)[1])
	assert.ok(sizeOf(long) < sizeOf(short), 'the long question was not shrunk')
})

test('text is never shrunk into illegibility', () => {
	// A floor, because a card nobody can read is no better than one that
	// overflows — and an absurd input should produce a bad card, not a blank one.
	assert.equal(fitFontSize('x'.repeat(400), 1040, 64, 32), 32)
	assert.equal(fitFontSize('', 1040, 64, 32), 64)
})

test('the width estimate keeps the longest real club name on the card', () => {
	// The estimate is an average advance rather than real metrics, which is the
	// whole reason `opentype.js` is not a second dependency here. It only has to
	// be right about the long names, and this is the longest one carried.
	const q = 'Are the Jacksonville Jaguars Undefeated?'
	const size = fitFontSize(q, CARD.width - 160, 64, 32)
	assert.ok(q.length * size * AVERAGE_ADVANCE <= CARD.width - 160,
		'the longest question overflows at its fitted size')
})

test('a card escapes what it is given', () => {
	// A club name with an ampersand would otherwise produce invalid SVG, and
	// resvg answers invalid SVG with an error rather than a picture.
	const svg = cardSvg({ question: 'Tom & Jerry <b>', answer: 'NO', record: 'r', colors: COLORS })
	assert.ok(!svg.includes('<b>'))
	assert.match(svg, /&amp;/)
})

test('an absent line is omitted rather than drawn empty', () => {
	const svg = cardSvg({ question: 'q', answer: 'A', record: 'r', colors: COLORS })
	assert.equal((svg.match(/<text/g) ?? []).length, 3)
	const withAll = cardSvg({ question: 'q', answer: 'A', record: 'r', sub: 's', footer: 'f', colors: COLORS })
	assert.equal((withAll.match(/<text/g) ?? []).length, 5)
})

// ---------------------------------------------------------------------------
// Fonts, and the failure that does not announce itself
// ---------------------------------------------------------------------------

test('the fonts this repo renders with are actually committed', () => {
	// A missing font file does not throw. It produces a card with no words on it.
	assert.ok(fontsPresent(), 'the card fonts are missing from data/fonts')
	for (const f of FONTS) assert.ok(readFileSync(f).length > 100_000, `${f} looks truncated`)
})

test('the committed fonts are intact TrueType files', () => {
	// A font mangled by line-ending conversion does not throw. It renders a card
	// with no words on it, which is the same failure as having no font at all
	// and is why `.gitattributes` now says `*.ttf binary` rather than trusting
	// git's own binary detection.
	//
	// 0x00010000 is the TrueType version tag; OpenType writes "OTTO".
	for (const f of FONTS) {
		const head = readFileSync(f).subarray(0, 4)
		const truetype = head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0
		const opentype = head.toString('latin1') === 'OTTO'
		assert.ok(truetype || opentype, `${f} is not a font any more`)
	}
})

test('the font licence ships with the fonts', () => {
	// SIL OFL 1.1 requires the copyright notice be redistributed with the files.
	// Committing a font and not its licence is the quiet way to fail that.
	const licence = readFileSync(join(ROOT, 'data/fonts/LICENSE'), 'utf8')
	assert.match(licence, /SIL Open Font License/)
	assert.match(licence, /Reserved Font Name Liberation/)
})

test('a card with no font is BLANK, which is why fonts are passed explicitly', async () => {
	// THE FINDING THIS WHOLE DESIGN IS SHAPED AROUND. Measured on node:24-slim:
	// system font discovery finds nothing, `loadSystemFonts: true` renders the
	// background with the text dropped, and resvg reports success either way.
	//
	// So this asserts the difference rather than that "a PNG came back" — the
	// assertion a naive test would make, and the one that passes on a blank card.
	const svg = cardSvg({
		question: 'Are the Packers Undefeated?', answer: 'NO', record: '2011 Record: 15-1', colors: COLORS,
	})
	const withFonts = await renderCard(svg)
	const without = await renderCard(svg, { fonts: [] })
	assert.ok(withFonts.length > without.length * 2,
		`text did not render: ${withFonts.length} bytes with fonts, ${without.length} without`)
})

test('a rendered card is a PNG of the right size', async () => {
	const png = await renderCard(cardSvg({ question: 'q', answer: 'A', record: 'r', colors: COLORS }))
	// PNG magic, then the IHDR width and height as big-endian 32-bit ints.
	assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
	assert.equal(png.readUInt32BE(16), CARD.width)
	assert.equal(png.readUInt32BE(20), CARD.height)
})

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

test('a card route exists for each page worth sharing', () => {
	for (const slug of ['default', '2011', 'records', 'history', 'vs', 'coaches']) {
		assert.deepEqual(parseView(`/og/${slug}.png`, { leaderPlural: 'coaches' }),
			{ view: 'card', card: slug }, `${slug} has no card route`)
	}
})

test('an invented card slug is a 404, not a card captioned undefined', () => {
	assert.equal(parseView('/og/nonsense.png', { leaderPlural: 'coaches' }), null)
	assert.equal(parseView('/og/default.jpg', { leaderPlural: 'coaches' }), null)
	// And the other sport's noun, for the same reason the pages themselves
	// refuse it.
	assert.equal(parseView('/og/managers.png', { leaderPlural: 'coaches' }), null)
	assert.equal(parseView('/og/coaches.png', { leaderPlural: 'managers' }), null)
})
