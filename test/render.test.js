import test from 'node:test'
import assert from 'node:assert/strict'
import { NEUTRAL, clubPage, escapeHtml, page, paletteCss, questionFor, selectorPage } from '../lib/render.js'
import { recordText, seasonTally, verdictText } from '../lib/core.js'
import packers from '../teams/packers.js'
import brewers from '../teams/brewers.js'

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

test('the palette comes from the club, never from a literal', () => {
	// The two sites carry 282 hardcoded hex literals between them and not one
	// custom property. This is the rule that stops that happening again.
	const css = paletteCss(packers.colors)
	assert.ok(css.includes('--accent: #ffb612'))
	assert.ok(css.includes('--base: #203731'))
	assert.ok(paletteCss(brewers.colors).includes('--accent: #ffc52f'))
})

test('the status colours are shared, not per club', () => {
	// Comparing the two sites showed they had independently arrived at the same
	// values, so a win is #4caf50 for everyone and it is not team vocabulary.
	for (const team of [packers, brewers]) {
		assert.ok(paletteCss(team.colors).includes('--win: #4caf50'))
		assert.ok(paletteCss(team.colors).includes('--loss: #f44336'))
	}
})

test('no colour literal appears outside the palette block', () => {
	// The check that would have caught the two sites. Everything after :root
	// must reference a variable.
	const out = clubPage({
		team: packers, season: '2026', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3',
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

test('the question is asked in the club\'s own words', () => {
	// "undefeated" is the manifest's losslessSeasonNoun, not a constant. In
	// football perfect means no losses and no ties, and 1929 went 12-0-1.
	assert.equal(questionFor(packers), 'Are the Packers undefeated?')
	assert.equal(questionFor(brewers), 'Are the Brewers undefeated?')
})

test('a club page shows the question, the answer and the record', () => {
	const out = clubPage({
		team: packers, season: '2026', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3',
	})
	assert.ok(out.includes('Are the Packers undefeated?'))
	assert.ok(out.includes('>NO<'))
	assert.ok(out.includes('2026 record: <b>13-3</b>'))
})

test('a season that has not started says so, rather than implying it', () => {
	// A verdict with no games behind it looks identical to one with a season
	// behind it. GO PACK GO over an unexplained 0-0 is the shape of the bug this
	// replaced.
	const out = clubPage({
		team: packers, season: '2026', tally: tally({ wins: 0, losses: 0 }),
		verdict: 'not-started', answer: verdictText('not-started', packers), recordLabel: '0-0',
	})
	assert.ok(out.includes('GO PACK GO'))
	assert.ok(out.includes('2026 has not started.'))
})

test('a started season does not claim it has not started', () => {
	const out = clubPage({
		team: packers, season: '2025', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '13-3',
	})
	assert.ok(!out.includes('has not started'))
})

test('postseason and championship appear only when they exist', () => {
	const without = clubPage({
		team: brewers, season: '2025', tally: tally(), verdict: 'no', answer: 'NO', recordLabel: '97-65',
	})
	assert.ok(!without.includes('Postseason'))

	const with_ = clubPage({
		team: brewers, season: '1982',
		tally: tally({ postseason: { w: 6, l: 6, t: 0 }, championshipName: 'World Series 1982' }),
		verdict: 'no', answer: 'NO', recordLabel: '95-67',
	})
	assert.ok(with_.includes('Postseason 6-6'))
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
	assert.equal(questionFor(perfectionists), 'Are the Dolphins perfect?')
})
