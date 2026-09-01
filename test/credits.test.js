import test from 'node:test'
import assert from 'node:assert/strict'
import { REFERENCE_CREDITS, creditsFor, requiredNotices } from '../lib/credits.js'
import { creditLine, clubPage, selectorPage } from '../lib/render.js'
import { SPORTS, loadSports } from '../lib/teams.js'

const adapters = await loadSports()
const nfl = adapters.nfl
const mlb = adapters.mlb

// ---------------------------------------------------------------------------
// What a deployment owes
// ---------------------------------------------------------------------------

test('every sport declares who its data came from', () => {
	// A guard on the NEXT sport, not on these two. There are four more sports of
	// data sitting in data/sources/sportsdata, and an adapter added without
	// credits would serve pages that name nobody — silently, because nothing
	// else in the load or the render would notice.
	for (const id of SPORTS) {
		const sport = adapters[id]
		assert.ok(Array.isArray(sport.credits) && sport.credits.length,
			`${id} declares no credits`)
		for (const c of sport.credits) {
			assert.ok(c.name, `${id} has a credit with no name`)
			assert.match(c.url ?? 'https://x', /^https:\/\//, `${id}: ${c.name} has a non-https url`)
		}
	}
})

test('a deployment credits the sports in its scope and no others', () => {
	// Crediting a source you do not use reads as carelessness at best, and a
	// reader cannot tell it from a false claim. A football-only site naming
	// Retrosheet would be asserting a relationship it does not have.
	const names = (list) => creditsFor(list).map((c) => c.name)
	assert.ok(names([nfl]).includes('nflverse'))
	assert.ok(!names([nfl]).includes('Retrosheet'), 'a football-only site credits Retrosheet')
	assert.ok(names([mlb]).includes('Retrosheet'))
	assert.ok(!names([mlb]).includes('FiveThirtyEight'), 'a baseball-only site credits FiveThirtyEight')
	assert.ok(names([nfl, mlb]).includes('Retrosheet') && names([nfl, mlb]).includes('nflverse'))
})

test('a source both sports use is credited once', () => {
	// Both adapters read ESPN's public scoreboard for the season being played.
	// Naming it twice reads as a mistake rather than as thoroughness.
	const names = creditsFor([nfl, mlb]).map((c) => c.name)
	assert.equal(names.filter((n) => n === 'ESPN').length, 1)
})

test('the curated files are credited whatever the scope', () => {
	// The third tier is the easiest to forget: nothing fetches it and no adapter
	// declares it, so it is credited by every deployment rather than by a sport.
	for (const list of [[nfl], [mlb], [nfl, mlb], []]) {
		const names = creditsFor(list).map((c) => c.name)
		for (const r of REFERENCE_CREDITS) assert.ok(names.includes(r.name), `${r.name} missing`)
	}
})

// ---------------------------------------------------------------------------
// The notice, which is a condition rather than a courtesy
// ---------------------------------------------------------------------------

test('Retrosheet carries a notice and it is reproduced in full', () => {
	// THE REASON THIS IS NOT JUST A LIST OF NAMES. Retrosheet's terms ask that
	// their statement be reproduced; shortening it to fit a footer would be
	// crediting them without meeting the condition — the version of this that
	// looks done and is not.
	const [retrosheet] = requiredNotices(creditsFor([mlb]))
	assert.ok(retrosheet, 'no required notice found for a baseball deployment')
	assert.match(retrosheet.notice, /obtained free of charge/)
	assert.match(retrosheet.notice, /copyrighted by Retrosheet/)

	const html = creditLine(creditsFor([mlb]))
	// The whole sentence, not a prefix of it. An `includes` on the first clause
	// would pass on a truncated notice, which is exactly the failure.
	assert.ok(html.includes(retrosheet.notice), 'the notice is not reproduced verbatim')
})

test('a football-only deployment renders no notice, because it owes none', () => {
	assert.deepEqual(requiredNotices(creditsFor([nfl])), [])
	assert.ok(!creditLine(creditsFor([nfl])).includes('Retrosheet'))
})

// ---------------------------------------------------------------------------
// On the page
// ---------------------------------------------------------------------------

test('the credit renders as a footer with links', () => {
	const html = creditLine(creditsFor([nfl]))
	assert.match(html, /<footer class="credits">/)
	assert.match(html, /href="https:\/\/github\.com\/nflverse/)
	assert.ok(html.includes('Data from'))
})

test('nothing to credit renders nothing', () => {
	// An empty footer is a stray horizontal rule and a gap, not a credit.
	assert.equal(creditLine([]), '')
	assert.equal(creditLine(null), '')
})

const TEAM = {
	sport: 'nfl', id: 'packers',
	nouns: {
		team: 'Packers', fullName: 'Green Bay Packers', question: 'Are the Packers Undefeated?',
		leaderPlural: 'coaches', championship: 'Super Bowl', scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against', meeting: 'meeting', meetingPlural: 'meetings',
		losslessSeasonNoun: 'perfect', opponentPossessive: "opponent's",
	},
	colors: {}, copy: {}, rules: {},
}

test('the club front page carries the credit', () => {
	// Both live sites put it on the front page, and this repo has never rendered
	// one anywhere. Asserting it on the page rather than only on the helper:
	// a helper that works and is never called is the same as no credit.
	const html = clubPage({
		team: TEAM, season: '2011', tally: { wins: 15, losses: 1, ties: 0 },
		verdict: 'no', answer: 'NO', recordLabel: '2011 Record: 15-1', colors: {},
		credits: creditsFor([nfl]),
	})
	assert.match(html, /<footer class="credits">/)
	assert.ok(html.includes('nflverse'))
})

test('the selector page carries the credit', () => {
	// A multi-club deployment's root is the selector, so a credit only on the
	// club page would be missing from the page most readers land on first.
	const html = selectorPage({
		scope: 'all', heading: 'Every club', colors: {},
		clubs: [{ code: 'GB', name: 'Green Bay Packers', available: true, url: '/nfl/packers' }],
		credits: creditsFor([nfl, mlb]),
	})
	assert.match(html, /<footer class="credits">/)
	assert.ok(html.includes('Retrosheet'))
})

test('no colour literal sneaks in with the footer', () => {
	// The stylesheet rule this repo already enforces, checked here because the
	// credit added new selectors and a hex value in one of them would slip past
	// a test that only reads render.js.
	const html = creditLine(creditsFor([nfl, mlb]))
	assert.equal(html.match(/#[0-9a-f]{3,8}\b/gi), null)
})
