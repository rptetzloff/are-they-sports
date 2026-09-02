import test from 'node:test'
import assert from 'node:assert/strict'
import { RECORD_SLUGS, recordCopy, recordsPage } from '../lib/render.js'
import { computeRecords } from '../lib/records.js'
import { resolveTeam } from '../lib/manifest.js'
import { loadTeam } from '../lib/teams.js'
import nfl from '../sports/nfl.js'
import mlb from '../sports/mlb.js'

const packers = await loadTeam('packers')

// A record book with something in most lists, so a card that fails to render
// cannot hide behind "None on record."
const games = [
	...'WWWWWWWWWWWWT'.split('').map((c, i) => ({
		result: c === 'W' ? 'WIN' : 'TIE', date: `1929-09-${String(i + 1).padStart(2, '0')}`,
		season: '1929', regular_season: '1', playoff: '0', championship: '',
		Opponent: 'CHI', scoreFor: '40', scoreAgainst: '0', location: 'home',
	})),
	...'LLLL'.split('').map(() => 0).map((_, i) => ({
		result: 'LOSS', date: `1958-09-${String(i + 1).padStart(2, '0')}`,
		season: '1958', regular_season: '1', playoff: '0', championship: '',
		Opponent: 'CHI', scoreFor: '0', scoreAgainst: '38', location: 'away',
	})),
]
const records = computeRecords(games, { streaksSpanSeasons: true, titles: [] })

const render = (over = {}) => recordsPage({
	team: packers, colors: { base: '#000', accent: '#fff', text: '#fff' },
	records, resolve: (code) => ({ name: code }), base: '/nfl/packers', ...over,
})

const sections = (html) => [...html.matchAll(/id="card-([a-z-]+)"/g)].map((m) => m[1])

// ---------------------------------------------------------------------------
// The three lists agree
// ---------------------------------------------------------------------------

test('there is copy for every slug, and no copy for a slug nothing draws', () => {
	// Written out rather than derived from each other, because a derivation
	// cannot disagree and so proves nothing. That is what makes the two lists
	// worth keeping separate: adding a card means touching both, and forgetting
	// one fails here rather than rendering a heading over an empty list.
	assert.deepEqual(Object.keys(recordCopy(packers)), RECORD_SLUGS)
})

test('a page given no selection draws every slug there is', () => {
	assert.deepEqual(sections(render()), RECORD_SLUGS)
})

test('every slug a sport publishes has copy and a list', () => {
	// Walked from the adapters, so a sport that adds a card is covered the day
	// it adds it. The selection lives in `sports/<id>.js` and the catalogue in
	// `lib/render.js`; nothing checks they agree except this.
	for (const sport of [nfl, mlb]) {
		for (const slug of sport.defaults.records) {
			assert.ok(RECORD_SLUGS.includes(slug), `${sport.id} publishes ${slug}, which nothing draws`)
		}
	}
})

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

test('a sport draws its own cards, in its own order', () => {
	// Not a count: baseball has eleven of the twelve, and the missing one is
	// `lossless-seasons`. Which card is absent is the claim worth asserting;
	// how many there are is not.
	assert.deepEqual(sections(render({ slugs: mlb.defaults.records })), mlb.defaults.records)
	assert.ok(!mlb.defaults.records.includes('lossless-seasons'))
	assert.deepEqual(nfl.defaults.records, RECORD_SLUGS)
})

test('a slug nothing can draw is dropped and said out loud', () => {
	// The alternative is throwing, which takes the whole record book down over a
	// typo in a selection, or silence, which renders one card fewer and reads as
	// a club with no ties.
	const said = []
	const warn = console.warn
	console.warn = (m) => said.push(m)
	try {
		assert.deepEqual(sections(render({ slugs: ['ties', 'best-innings'] })), ['ties'])
	} finally { console.warn = warn }
	assert.match(said.join(' '), /best-innings/)
})

// ---------------------------------------------------------------------------
// The permalink
// ---------------------------------------------------------------------------

test('every card is anchored and linked, so the route is reachable', () => {
	// The route parsed `/records/{slug}` from the first day and nothing on the
	// page ever pointed at it. Same reachability hole the leaders page had: the
	// suite asked whether every link was a route, never whether every route was
	// linked.
	const html = render()
	for (const slug of RECORD_SLUGS) {
		assert.ok(html.includes(`id="card-${slug}"`), `${slug} has no anchor`)
		assert.ok(html.includes(`href="/nfl/packers/records/${slug}"`), `${slug} is not linked`)
	}
})

test('a focused permalink marks exactly one card', () => {
	const html = render({ focus: 'win-streaks' })
	const focused = [...html.matchAll(/record-card record-card-focus" id="card-([a-z-]+)"/g)].map((m) => m[1])
	assert.deepEqual(focused, ['win-streaks'])
})

test('a focused permalink draws its card first', () => {
	// A recorded deviation from the two sites, which keep the order and call
	// scrollIntoView. Same outcome without a script, and the price is that the
	// sport's order holds on every page except this one.
	assert.equal(sections(render({ focus: 'ties' }))[0], 'ties')
	assert.deepEqual(sections(render({ focus: 'ties' })).slice(1),
		RECORD_SLUGS.filter((s) => s !== 'ties'))
	assert.deepEqual(sections(render()), RECORD_SLUGS)
})

test('a focused permalink is titled after its record, not after the page', () => {
	// The defect this replaced: twelve URLs rendered one page under one title,
	// and since the social-meta work each also declared itself canonical. The
	// title is what `lib/meta.js` reads back out for og:title, so this is the
	// share preview too.
	assert.match(render({ focus: 'win-streaks' }), /<title>Green Bay Packers win streaks<\/title>/)
	assert.match(render(), /<title>Green Bay Packers records<\/title>/)
})

test('an unfocused page marks nothing', () => {
	// Against the MARKUP, not against the page. The stylesheet is inlined, so
	// the class name appears in every rendering whether a card wears it or not
	// -- which is how the first version of this test passed on any input.
	assert.ok(!/record-card record-card-focus/.test(render()))
})

// ---------------------------------------------------------------------------
// The copy itself
// ---------------------------------------------------------------------------

test('every card says what its list measures', () => {
	// A heading alone reads as a guess: "best starts" is wins to open a season
	// and not the best opening game, and a reader has no way to tell which.
	const copy = recordCopy(packers)
	for (const slug of RECORD_SLUGS) {
		assert.ok(copy[slug].note, `${slug} has no note`)
		assert.ok(copy[slug].icon, `${slug} has no icon`)
		assert.ok(copy[slug].heading, `${slug} has no heading`)
	}
	assert.equal([...render().matchAll(/class="record-note"/g)].length, RECORD_SLUGS.length)
})

test('the lossless card takes its word from the sport, not from this file', () => {
	// 1929 went 12-0-1: undefeated, and not perfect. A club that says the other
	// word is the only way to prove the word was not hardcoded.
	const dolphins = { ...packers, nouns: { ...packers.nouns, losslessSeasonNoun: 'perfect' } }
	assert.equal(recordCopy(dolphins)['lossless-seasons'].heading, 'Perfect seasons')
	assert.match(recordCopy(dolphins)['lossless-seasons'].note, /perfect/)
	assert.equal(recordCopy(packers)['lossless-seasons'].heading, 'Undefeated seasons')
})

test('the titles card is named from the data when the data agrees', () => {
	// "Super Bowl appearances" over a list that is mostly NFL Championships is
	// wrong by thirty years, so the heading only narrows when every title in the
	// list is the same one.
	const copy = (titles) => recordCopy(packers, titles)['championship-appearances'].heading
	assert.equal(copy([{ title: 'Super Bowl' }, { title: 'Super Bowl' }]), 'Super Bowl appearances')
	assert.equal(copy([{ title: 'Super Bowl' }, { title: 'NFL Championship' }]), 'Championship games')
	assert.equal(copy([]), `${packers.nouns.championship} appearances`)
})

// ---------------------------------------------------------------------------
// The selection resolves through the manifest
// ---------------------------------------------------------------------------

const sport = { id: 'x', defaults: { ...nfl.defaults } }
const club = { id: 'c', sourceIds: ['s'], nouns: { team: 'C', fullName: 'C' } }

test('a club with nothing declared gets the sport selection', () => {
	assert.deepEqual(resolveTeam(club, sport).records, nfl.defaults.records)
})

test('a club selection REPLACES the sport one rather than adding to it', () => {
	// Spreading two arrays would append. A club wanting eleven of the sport's
	// twelve would silently get twenty-three, in an order nobody chose.
	assert.deepEqual(resolveTeam({ ...club, records: ['ties'] }, sport).records, ['ties'])
})

test('a sport with no selection at all resolves to null, meaning everything', () => {
	const bare = { id: 'x', defaults: { ...nfl.defaults, records: undefined } }
	assert.equal(resolveTeam(club, bare).records, null)
})

test('a selection that is not a list of slugs throws, naming the field', () => {
	// The failure it prevents is a record book rendering zero cards, which reads
	// as a club with no history rather than as a typo.
	assert.throws(() => resolveTeam({ ...club, records: [] }, sport), /records/)
	assert.throws(() => resolveTeam({ ...club, records: 'ties' }, sport), /records/)
	assert.throws(() => resolveTeam({ ...club, records: [''] }, sport), /records/)
})
