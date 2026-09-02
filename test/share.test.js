import test from 'node:test'
import assert from 'node:assert/strict'
import { TARGETS, shareLinks } from '../lib/share.js'
import { sharePanel } from '../lib/render.js'

const CTX = {
	url: 'https://example.test/nfl/packers',
	title: 'Are the Packers Undefeated?',
	text: 'NO. 2011 record 15-1.',
}

// ---------------------------------------------------------------------------
// The links
// ---------------------------------------------------------------------------

test('every target produces a usable link', () => {
	// Walked rather than named one by one, so a target added later is covered
	// the day it is added. A broken share URL is found by a reader clicking it,
	// never by anything else.
	const links = shareLinks(CTX)
	assert.equal(links.length, TARGETS.length)
	for (const l of links) {
		assert.ok(l.label, `${l.id} has no label`)
		assert.ok(l.icon, `${l.id} has no icon`)
		assert.match(l.href, /^(https:\/\/|mailto:|sms:)/, `${l.id} has a scheme nothing opens: ${l.href}`)
	}
})

test('the page URL is carried into every link, encoded', () => {
	// Unencoded, the slashes and colon end the query parameter and the receiving
	// site gets half an address — which looks like a working button and posts a
	// broken link.
	for (const l of shareLinks(CTX)) {
		assert.ok(l.href.includes(encodeURIComponent(CTX.url)) || l.href.includes(encodeURIComponent(`${CTX.text} ${CTX.url}`)),
			`${l.id} does not carry the encoded url: ${l.href}`)
		assert.ok(!l.href.includes('https://example.test/nfl/packers?'), `${l.id} carries a raw url`)
	}
})

test('a share link cannot be broken by an apostrophe or an ampersand', () => {
	// Club copy contains both. "Tom & Jerry" unencoded ends the parameter, and
	// the apostrophe is one of the characters encodeURIComponent leaves alone
	// that some readers mangle.
	const links = shareLinks({
		url: 'https://example.test/x', title: "Kansas City's & Co", text: "It's a (tie)!",
	})
	for (const l of links) {
		const query = l.href.split('?')[1] ?? l.href
		assert.ok(!query.includes(' '), `${l.id} has an unencoded space`)
		assert.ok(!/[()']/.test(query), `${l.id} left brackets or an apostrophe raw: ${l.href}`)
	}
})

test('no url means no links, rather than links to nowhere', () => {
	// A share menu offering to post an empty address is worse than no menu.
	assert.deepEqual(shareLinks({ url: '', title: 't', text: 'x' }), [])
	assert.deepEqual(shareLinks({}), [])
})

test('the message link works on both phones', () => {
	// `sms:?&body=` rather than `sms:?body=`. The stray ampersand after the empty
	// recipient is what makes one link work on iOS and Android, which otherwise
	// disagree about the separator.
	const sms = shareLinks(CTX).find((l) => l.id === 'sms')
	assert.match(sms.href, /^sms:\?&body=/)
})

test('messaging comes before the platforms', () => {
	// Not alphabetical, and not an accident: these sites are read on phones,
	// where a text is how a game gets shared with the person watching it too.
	assert.deepEqual(TARGETS.slice(0, 2).map((t) => t.id), ['sms', 'email'])
})

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('the panel is a details, so it needs no script', () => {
	// Same disclosure as the club switcher. Every target is a link, which is why
	// this feature costs no JavaScript at all.
	const html = sharePanel({ url: CTX.url, links: shareLinks(CTX) })
	assert.match(html, /<details class="switcher share">/)
	assert.ok(!html.includes('<script'))
	assert.ok(!html.includes('onclick'))
})

test('the link field can be selected, because there is no copy button', () => {
	// `readonly`, never `disabled`: a disabled input cannot be selected, which
	// would leave the fallback unable to do the one thing it exists for.
	const html = sharePanel({ url: CTX.url, links: shareLinks(CTX) })
	assert.match(html, /readonly/)
	assert.ok(!html.includes('disabled'))
	assert.ok(html.includes(CTX.url))
})

test('nothing to share renders nothing', () => {
	assert.equal(sharePanel({ url: '', links: [] }), '')
	assert.equal(sharePanel({ url: CTX.url, links: null }), '')
})

test('the panel escapes what it is given', () => {
	const html = sharePanel({
		url: 'https://example.test/?a=1&b=2',
		links: shareLinks({ url: 'https://example.test/x', title: '<b>hi</b>', text: 'x' }),
	})
	assert.ok(!html.includes('<b>hi</b>'))
	assert.match(html, /&amp;b=2/)
})

test('an href with two query parameters is escaped in the markup', () => {
	// The X and Reddit links join their parameters with `&`, which is an entity
	// start in HTML and has to be written `&amp;` in an attribute. A mutation
	// run caught this: the escape test only looked at the link FIELD, so
	// dropping `escapeHtml` from the href changed no result.
	const html = sharePanel({ url: CTX.url, links: shareLinks(CTX) })
	const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
	const multi = hrefs.filter((h) => h.includes('amp;') || h.includes('&'))
	assert.ok(multi.length, 'expected a link with more than one parameter')
	for (const h of multi) {
		assert.ok(!/&(?!amp;)/.test(h), `a bare ampersand survived into an href: ${h}`)
	}
})
