import test from 'node:test'
import assert from 'node:assert/strict'
import { NEUTRAL, clubPage, escapeHtml, page, paletteCss, questionFor, selectorPage } from '../lib/render.js'
import { colorsFor, loadColors, resolver } from '../lib/names.js'
import { choosePalette, contrast } from '../lib/palette.js'
import { loadDivisions } from '../lib/scope.js'
import { recordText, seasonTally, verdictText } from '../lib/core.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')
const brewers = await loadTeam('brewers')

// Rendering, as strings. All of this is reachable from node --test, which is
// the entire reason it lives here rather than in a browser-side main.js.

const tally = (over = {}) => ({ wins: 13, losses: 3, ties: 0, postseason: null, championshipName: null, undefeated: false, ...over })

test('the dangerous characters are escaped', () => {
	assert.equal(escapeHtml('<script>alert(1)</script>'),
		'&lt;script&gt;alert(1)&lt;/script&gt;')
	assert.equal(escapeHtml(`"double" & 'single'`), '&quot;double&quot; &amp; &#39;single&#39;')
})

test('ampersands are escaped before anything else', () => {
	// The classic double-encoding bug runs the other way and yields &amp;lt;.
	assert.equal(escapeHtml('<'), '&lt;')
	assert.equal(escapeHtml('&lt;'), '&amp;lt;')
})

test('null and undefined render as nothing, not as the word', () => {
	assert.equal(escapeHtml(null), '')
	assert.equal(escapeHtml(undefined), '')
	// But zero is a real value and must survive.
	assert.equal(escapeHtml(0), '0')
})

test('club names from upstream data cannot inject markup', () => {
	// Opponent names come from reference tables and upstream feeds. They are not
	// ours to trust just because today's values happen to be tame.
	const out = selectorPage({
		scope: 'all',
		colors: NEUTRAL,
		heading: 'Every club',
		clubs: [{ code: '<img src=x onerror=alert(1)>', name: 'Bad "Club"', available: false }],
	})
	assert.ok(!out.includes('<img src=x'), 'raw markup reached the page')
	assert.ok(out.includes('&lt;img src=x'))
	assert.ok(out.includes('&quot;Club&quot;'))
})

test('a url is escaped inside the attribute it sits in', () => {
	const out = selectorPage({
		scope: 'all', colors: NEUTRAL, heading: 'x',
		clubs: [{ code: 'GB', name: 'Packers', available: true, url: '/a"onmouseover="alert(1)' }],
	})
	assert.ok(!out.includes('"onmouseover="'), 'attribute escaped out of its quotes')
})

test('the palette comes from data, never from a literal', () => {
	// The two sites carry 282 hardcoded hex literals between them and not one
	// custom property. This is the rule that stops that happening again.
	//
	// Football's colours now come from the franchise history table for the era
	// being rendered, so they are not in a manifest at all; baseball's are an
	// override, because Retrosheet publishes none.
	const css = paletteCss(colorsFor(resolver('nfl'), 'GB', '2024', NEUTRAL))
	assert.ok(css.includes('--base: #203731'), css)
	assert.ok(css.includes('--accent: #FFB612'), css)
	// Baseball's come from a separate curated table, because Retrosheet
	// publishes no colours.
	assert.ok(paletteCss(loadColors('mlb').get('MIL')).includes('--accent: #FFC52F'))
})

test('a club rendered in an older era gets the colours of that era', () => {
	// The reason to take colours from a dated table rather than a manifest.
	const nfl = resolver('nfl')
	assert.equal(colorsFor(nfl, 'GB', '1955', NEUTRAL).base, '#175E33')
	assert.equal(colorsFor(nfl, 'GB', '2024', NEUTRAL).base, '#203731')
	// And the Lions were the Portsmouth Spartans, in purple.
	assert.equal(colorsFor(nfl, 'DET', '1930', NEUTRAL).base, '#582C83')
})

test('a franchise with no colours on record falls back', () => {
	// Many 1920s clubs have none, so a fallback is required rather than
	// optional — and an unknown code has to reach it too.
	const nfl = resolver('nfl')
	assert.deepEqual(colorsFor(nfl, 'ZZZ', '1920', NEUTRAL), NEUTRAL)
	assert.equal(colorsFor(nfl, 'MUT', '1920', NEUTRAL).base, NEUTRAL.base)
})

test('the status colours are shared, not per club', () => {
	// Comparing the two sites showed they had independently arrived at the same
	// values, so a win is #4caf50 for everyone and it is not team vocabulary.
	for (const colors of [NEUTRAL, loadColors('mlb').get('MIL')]) {
		assert.ok(paletteCss(colors).includes('--win: #4caf50'))
		assert.ok(paletteCss(colors).includes('--loss: #f44336'))
	}
})

test('no colour literal appears outside the palette block', () => {
	// The check that would have caught the two sites. Everything after :root
	// must reference a variable.
	const out = clubPage({
		team: packers, season: '2026', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3',
		colors: NEUTRAL,
	})
	const afterPalette = out.slice(out.indexOf('}', out.indexOf(':root')))
	const literals = afterPalette.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
	assert.deepEqual(literals, [], `colour literals outside :root — ${literals.join(' ')}`)
})

test('the page is a whole document', () => {
	const out = page({ title: 'T', colors: NEUTRAL, body: '<p>x</p>' })
	assert.ok(out.startsWith('<!doctype html>'))
	assert.ok(out.includes('<meta name="viewport"'))
	assert.ok(out.includes('<title>T</title>'))
	assert.ok(out.trimEnd().endsWith('</html>'))
})

test('the title is escaped like anything else', () => {
	assert.ok(page({ title: '<b>x', colors: NEUTRAL, body: '' }).includes('<title>&lt;b&gt;x</title>'))
})

test('a club can state its question outright', () => {
	// Not derivable by substitution: the baseball site asks "Are the Brewers On
	// TV?", which no amount of vocabulary swapping reaches from "undefeated". So
	// it is manifest copy, with the football shape as the default.
	const tv = { ...brewers, copy: { ...brewers.copy, question: 'Are the Brewers On TV?' } }
	assert.equal(questionFor(tv), 'Are the Brewers On TV?')
})

test('the question is asked in the club\'s own words', () => {
	// "undefeated" is the manifest's losslessSeasonNoun, not a constant. In
	// football perfect means no losses and no ties, and 1929 went 12-0-1.
	// Title case, matching both sites' headings.
	assert.equal(questionFor(packers), 'Are the Packers Undefeated?')
	assert.equal(questionFor(brewers), 'Are the Brewers Undefeated?')
})

test('a club page shows the question, the answer and the record', () => {
	const out = clubPage({
		team: packers, season: '2026', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3', colors: NEUTRAL,
	})
	assert.ok(out.includes('Are the Packers Undefeated?'))
	assert.ok(out.includes('>NO<'))
	assert.ok(out.includes('2026 Record: 13-3'))
})

test('a season that has not started says so, rather than implying it', () => {
	// A verdict with no games behind it looks identical to one with a season
	// behind it. GO PACK GO over an unexplained 0-0 is the shape of the bug this
	// replaced.
	const out = clubPage({
		team: packers, season: '2026', tally: tally({ wins: 0, losses: 0 }),
		verdict: 'not-started', answer: verdictText('not-started', packers), recordLabel: '0-0', colors: NEUTRAL,
	})
	assert.ok(out.includes('GO PACK GO'))
	assert.ok(out.includes('2026 has not started.'))
})

test('a started season does not claim it has not started', () => {
	const out = clubPage({
		team: packers, season: '2025', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3', colors: NEUTRAL,
	})
	assert.ok(!out.includes('has not started'))
})

test('postseason and championship appear only when they exist', () => {
	const without = clubPage({
		team: brewers, season: '2025', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '97-65', colors: NEUTRAL,
	})
	assert.ok(!without.includes('Postseason'))

	const with_ = clubPage({
		team: brewers, season: '1982',
		tally: tally({ postseason: { w: 6, l: 6, t: 0 }, championshipName: 'World Series 1982' }),
		verdict: 'no', answer: 'NO', recordLabel: '95-67', colors: NEUTRAL,
	})
	assert.ok(with_.includes('Postseason: 6-6'))
	assert.ok(with_.includes('World Series 1982'))
})

test('the selector lists unavailable clubs rather than hiding them', () => {
	// A selector showing two clubs of a promised sixteen looks complete and is
	// wrong.
	const out = selectorPage({
		scope: 'division:nfl/nfc-north',
		colors: NEUTRAL,
		heading: 'NFC North',
		clubs: [
			{ code: 'GB', name: 'Green Bay Packers', available: true, url: '/packers' },
			{ code: 'CHI', name: null, available: false },
		],
	})
	assert.ok(out.includes('href="/packers"'))
	assert.ok(out.includes('CHI'))
	assert.ok(out.includes('not built'))
	assert.ok(out.includes('1 of 2 clubs built'))
})

test('an unavailable club is not a link', () => {
	const out = selectorPage({
		scope: 'all', colors: NEUTRAL, heading: 'x',
		clubs: [{ code: 'CHI', name: null, available: false }],
	})
	assert.ok(!out.includes('<a '), 'rendered a link to a club with no data')
})

test('the grid carries a width, not only a max-width', () => {
	// The single-column bug, asserted rather than remembered. body is a column
	// flexbox with align-items:center, so an item with only a max-width is sized
	// shrink-to-fit, and an auto-fit track list resolves to one repetition
	// against an indefinite inline size. It rendered as one column at every
	// viewport above 600px, on both sites, for months.
	const out = selectorPage({ scope: 'all', colors: NEUTRAL, heading: 'x', clubs: [] })
	const grid = out.slice(out.indexOf('.clubs {'), out.indexOf('}', out.indexOf('.clubs {')))
	assert.ok(grid.includes('width: 100%'), '.clubs has no definite width')
	assert.ok(grid.includes('auto-fit'))
})

test('the lossless-season noun comes from the manifest, not the code', () => {
	// Both clubs say "undefeated" today, so asserting against either proves
	// nothing about where the word came from — a mutation that hardcoded it
	// survived for exactly that reason. A club that says something else is the
	// only way to tell.
	const perfectionists = { ...packers, nouns: { ...packers.nouns, team: 'Dolphins', losslessSeasonNoun: 'perfect' } }
	assert.equal(questionFor(perfectionists), 'Are the Dolphins Perfect?')
})

test('every baseball club has colours, and the Brewers are navy and gold', () => {
	// Curated from knowledge rather than published, unlike football's — which
	// arrived as data with colours already in it. The file says so, and marks
	// which single row was checked against anything.
	const m = loadColors('mlb')
	assert.equal(m.size, 30)
	assert.deepEqual(m.get('MIL'), { base: '#12284B', accent: '#FFC52F' })
	for (const [code, c] of m) {
		assert.match(c.base, /^#[0-9a-fA-F]{6}$/, `${code} base`)
		assert.match(c.accent, /^#[0-9a-fA-F]{6}$/, `${code} accent`)
		assert.notEqual(c.base.toLowerCase(), c.accent.toLowerCase(), `${code} has one colour twice`)
	}
})

test('football colours do not come from that table', () => {
	// It is baseball-only on purpose: football's ride along with its franchise
	// history and are era-correct, which this cannot be.
	assert.equal(loadColors('nfl').size, 0)
})

test('the page ground is the darkest colour a club publishes', () => {
	// The page is dark, so the ground has to be. The Cardinals lead with red and
	// red as a full-page ground is unreadable.
	assert.equal(choosePalette(['#C41E3A', '#0C2340', '#FEDB00'], NEUTRAL).base, '#0C2340')
	assert.equal(choosePalette(['#12284B', '#FFC52F'], NEUTRAL).base, '#12284B')
})

test('the accent is the first legible colour, not the most legible', () => {
	// Maximum contrast gave the Brewers white over their own gold — more
	// readable and less theirs. Clubs list colours in order of identity, so the
	// first that clears the bar is both.
	assert.equal(choosePalette(['#12284B', '#FFC52F', '#FFFFFF'], NEUTRAL).accent, '#FFC52F')
	assert.equal(choosePalette(['#203731', '#FFB612', '#FFFFFF'], NEUTRAL).accent, '#FFB612')
})

test('an illegible palette falls back rather than rendering unreadably', () => {
	// The Angels publish three dark colours whose best pair is 1.9:1. A heading
	// nobody can read is not a club's identity either.
	const p = choosePalette(['#003263', '#BA0021', '#862633'], NEUTRAL)
	assert.equal(p.accent, NEUTRAL.accent)
	assert.ok(contrast(p.base, p.accent) > 4.5)
})

test('every club in both sports gets a legible pair', () => {
	// The assertion that matters, over the real tables rather than examples.
	const nfl = resolver('nfl')
	for (const [code, p] of loadColors('mlb')) {
		assert.ok(contrast(p.base, p.accent) >= 3, `mlb ${code} is ${contrast(p.base, p.accent).toFixed(2)}:1`)
	}
	for (const code of loadDivisions('nfl').map((r) => r.code)) {
		const p = colorsFor(nfl, code, '2024', NEUTRAL)
		assert.ok(contrast(p.base, p.accent) >= 3, `nfl ${code} is ${contrast(p.base, p.accent).toFixed(2)}:1`)
	}
})

test('a club publishing four or five colours does not lose the extras', () => {
	// Reading a fixed three silently dropped whatever came after.
	const five = choosePalette(['#000010', '#000020', '#000030', '#000040', '#EEEEEE'], NEUTRAL)
	assert.equal(five.accent, '#EEEEEE')
})

test('no colours at all is the fallback, and one colour keeps its ground', () => {
	assert.deepEqual(choosePalette([], NEUTRAL), NEUTRAL)
	assert.deepEqual(choosePalette(['#800000'], NEUTRAL), { base: '#800000', accent: NEUTRAL.accent })
	// A malformed value is not a colour.
	assert.deepEqual(choosePalette(['nope', ''], NEUTRAL), NEUTRAL)
})
