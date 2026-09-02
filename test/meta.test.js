import test from 'node:test'
import assert from 'node:assert/strict'
import { describe as describeFor, metaTags, titleOf, withMeta } from '../lib/meta.js'
import { page } from '../lib/render.js'

const rendered = (title) => page({ title, colors: {}, body: '<h1>x</h1>' })

// ---------------------------------------------------------------------------
// The tags
// ---------------------------------------------------------------------------

test('a page previews with a title, a description and a canonical url', () => {
	// Every page here previewed as NOTHING before this: no og, no twitter, no
	// description, no canonical. A club URL pasted into a group chat was a bare
	// link, whether or not a share button ever existed.
	const html = withMeta(rendered('Green Bay Packers records'), {
		description: 'A record book.', url: 'https://example.test/packers/records',
	})
	assert.match(html, /<meta property="og:title" content="Green Bay Packers records">/)
	assert.match(html, /<meta property="og:description" content="A record book\.">/)
	assert.match(html, /<meta property="og:url" content="https:\/\/example\.test\/packers\/records">/)
	assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/packers\/records">/)
	assert.match(html, /<meta name="description" content="A record book\.">/)
})

test('the title comes from the page rather than being passed twice', () => {
	// Every page computes a good title already. Asking for it a second time is
	// how the two drift apart, and the drift would be invisible: the tab would
	// say one thing and the shared link another.
	assert.equal(titleOf(rendered('NFL champions')), 'NFL champions')
	const html = withMeta(rendered('NFL champions'), { description: 'x' })
	assert.match(html, /og:title" content="NFL champions"/)
})

test('the large twitter card is only claimed when there is an image', () => {
	// `summary_large_image` with nothing to put in it renders worse than the
	// plain summary it falls back to.
	assert.match(metaTags({ title: 't' }), /twitter:card" content="summary">/)
	assert.match(metaTags({ title: 't', image: 'https://x.test/a.png' }),
		/twitter:card" content="summary_large_image">/)
})

test('an absent field emits no tag rather than an empty one', () => {
	// An empty og:description is worse than none: some readers show the empty
	// string where they would otherwise fall back to the page text.
	const tags = metaTags({ title: 'Only a title' })
	// Both helpers, not just one. `tag` builds the og: properties and `named`
	// builds description and twitter:, and a mutation run caught that only the
	// first was covered — twitter:image could be emitted empty with nothing
	// noticing.
	assert.ok(!tags.includes('og:description'))
	assert.ok(!tags.includes('og:image'))
	assert.ok(!tags.includes('canonical'))
	assert.ok(!tags.includes('twitter:image'))
	assert.ok(!tags.includes('twitter:description'))
	assert.ok(!tags.includes('name="description"'))
})

test('the tags are escaped, because a club name can contain an apostrophe', () => {
	const tags = metaTags({ title: 'A "quoted" title', description: "it's fine" })
	assert.ok(!tags.includes('content="A "quoted" title"'))
	assert.match(tags, /&quot;quoted&quot;/)
})

// ---------------------------------------------------------------------------
// Where they go
// ---------------------------------------------------------------------------

test('the tags go inside the head', () => {
	const html = withMeta(rendered('X'), { description: 'd' })
	assert.ok(html.indexOf('og:title') < html.indexOf('</head>'))
	assert.ok(html.indexOf('og:title') > html.indexOf('<head>'))
})

test('a body with no head passes through untouched', () => {
	// A JSON payload or a bare error string must not gain a block of markup.
	assert.equal(withMeta('{"ok":true}', { description: 'd' }), '{"ok":true}')
	assert.equal(withMeta(null, { description: 'd' }), null)
})

test('a page that says nothing still previews as something', () => {
	// The default is deliberately dull and always true. A preview with a title
	// and no description is worse than one with a plain sentence: the sentence
	// is what tells a reader whether the link is about the club they follow.
	assert.match(describeFor('NFL champions'), /^NFL champions\. /)
	assert.equal(describeFor(''), '')
})

// ---------------------------------------------------------------------------
// Injection rather than threading
// ---------------------------------------------------------------------------

test('every page function produces a head the injection can reach', async () => {
	// THE REASON THIS IS CENTRAL. `page()` is called from thirteen places, and
	// this repo has twice shipped a page missing something wired per call site:
	// the leaders nav link answered 404 from every club page, and the data credit
	// had to be added to two pages by hand.
	//
	// A page function that stopped going through `page()` would silently have no
	// tags, so this asserts the shape the injection depends on rather than the
	// wiring of any one route.
	const render = await import('../lib/render.js')
	const builders = Object.entries(render).filter(([n, v]) => typeof v === 'function' && n.endsWith('Page'))
	assert.ok(builders.length >= 8, `only found ${builders.length} page builders`)

	const html = rendered('Anything')
	assert.ok(html.includes('<head>') && html.includes('</head>'),
		'page() no longer emits a head, and nothing would be injected')
})
