// Light mode on the pages the server draws (Ray, 2026-10-27: "there is no
// light/dark mode on the league/home page"), as the club pages have it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paletteCss, lightAccentRgb, contrastOnLight } from '../lib/style.js'
import { page, NEUTRAL, THEME_HEAD } from '../lib/render.js'
import { recolor } from '../lib/web.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the palette has a light theme, chosen or the device\'s, both the same', () => {
	const css = paletteCss(NEUTRAL)
	const chosen = /:root\[data-theme="light"\] \{\n([^}]*)\}/.exec(css)?.[1]
	const device = /@media \(prefers-color-scheme: light\) \{\n:root:not\(\[data-theme\]\) \{\n([^}]*)\}/.exec(css)?.[1]
	assert.ok(chosen && device)
	assert.equal(chosen, device)
	assert.match(chosen, /--text: var\(--light-text\);/)
	assert.match(css, /--light-text: #1b2430;/, 'the colour itself in the palette block')
})

test('an accent is darkened until it reads on the light page; white is the text\'s colour', () => {
	assert.equal(lightAccentRgb('#ffffff'), '27 36 48')
	for (const c of ['#FFC52F', '#FFB612', '#00843D', '#C8102E', '#7BAFD4']) {
		assert.ok(contrastOnLight(lightAccentRgb(c).split(' ').map(Number)) >= 4.5, c)
	}
	assert.equal(lightAccentRgb('#12284B'), '18 40 75', 'a dark accent as it is')
})

test('a club stylesheet\'s light accent text reads, white accent or not', () => {
	const css = readFileSync(join(ROOT, 'web/mlb/styles.css'), 'utf8')
	const light = (out) => /:root\[data-theme="light"\] \{[^}]*--accent-text: (#[0-9a-f]{6});/i.exec(out)[1]
	// The Brewers are their site as it was.
	assert.equal(light(recolor(css, 'mlb', { base: '#12284b', accent: '#ffc52f' })), '#8a5d00')
	// A white accent (the league pages') was a lavender, #8a97d0.
	const white = light(recolor(css, 'nhl', { base: '#2a2a2a', accent: '#ffffff' }))
	assert.notEqual(white.toLowerCase(), '#8a97d0')
	assert.ok(contrastOnLight([1, 3, 5].map((i) => parseInt(white.slice(i, i + 2), 16))) >= 4.5)
})

test('a page drawn here carries the switch, served from the root', () => {
	const html = page({ title: 't', colors: NEUTRAL, body: '' })
	assert.ok(html.includes(THEME_HEAD))
	assert.match(THEME_HEAD, /src="\/theme.js"/)
	assert.equal(readFileSync(join(ROOT, 'web/home/theme.js'), 'utf8'), readFileSync(join(ROOT, 'web/mlb/theme.js'), 'utf8'))
	assert.match(readFileSync(join(ROOT, 'server.js'), 'utf8'), /'\/tv-pick.js', '\/theme.js'\]/)
})
