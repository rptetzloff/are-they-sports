import test from 'node:test'
import assert from 'node:assert/strict'
import { leagueNav, leagueRecordsPage, leagueSchedulePage, selectorPage, siteNav } from '../lib/render.js'

// Can you actually get there? Every route in this repo is tested by asking for
// it directly, which is why /records and /schedule shipped answering 200 with
// nothing on any page pointing at them. A working route nobody can reach is not
// a feature, and no test noticed because every test knew the URL already.

const COLORS = { base: '#203731', accent: '#FFB612' }
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])

const EMPTY_LEAGUE = {
	clubs: 0, seasonRange: { first: null, last: null }, allTime: [], titles: [],
	bestSeasons: [], worstSeasons: [], losslessSeasons: [], bestStarts: [], worstStarts: [],
	winStreaks: [], loseStreaks: [], lopsidedWins: [], ties: [],
}
const EMPTY_SCHEDULE = { season: 2024, seasons: [2024], periods: [], weeksKnown: true, games: 0 }

test('the club selector links to both league pages', () => {
	// The root of a multi-club scope is where anyone lands.
	const html = selectorPage({
		scope: 'division:nfl/nfc-north', clubs: [], colors: COLORS,
		heading: 'NFC North', nav: leagueNav('clubs'),
	})
	assert.ok(hrefs(html).includes('/records'), 'no link to the league records')
	assert.ok(hrefs(html).includes('/schedule'), 'no link to the league schedule')
})

test('a selector with no nav has no dangling league links', () => {
	// The nav is passed in, so the caller decides. Without this the test above
	// would pass on a page that hardcoded the links whether they existed or not.
	const html = selectorPage({ scope: 'team:packers', clubs: [], colors: COLORS, heading: 'Packers' })
	assert.ok(!hrefs(html).includes('/records'))
})

test('each league page links to the other, and back to the clubs', () => {
	const records = hrefs(leagueRecordsPage({
		league: EMPTY_LEAGUE, heading: 'NFC North', colors: COLORS, clubs: [],
	}))
	assert.ok(records.includes('/schedule'), 'records does not link to the schedule')
	assert.ok(records.includes('/'), 'records does not link back to the clubs')

	const schedule = hrefs(leagueSchedulePage({
		schedule: EMPTY_SCHEDULE, heading: 'NFC North', colors: COLORS,
		resolve: (code) => ({ name: code }), clubs: [],
	}))
	assert.ok(schedule.includes('/records'), 'schedule does not link to the records')
	assert.ok(schedule.includes('/'), 'schedule does not link back to the clubs')
})

test('the page you are on is named rather than linked to itself', () => {
	assert.ok(leagueNav('records').includes('class="here"'))
	assert.ok(!hrefs(leagueNav('records')).includes('/records'))
	// And is a link from anywhere else.
	assert.ok(hrefs(leagueNav('schedule')).includes('/records'))
})

test('a club page in a multi-club scope can get back up to the league', () => {
	const team = { nouns: { leaderPlural: 'coaches' } }
	const multi = hrefs(siteNav('/packers', team, { league: true }))
	assert.ok(multi.includes('/records'), 'no way back to the league records')
	assert.ok(multi.includes('/schedule'), 'no way back to the league schedule')
	// And the club's OWN records are a different page, still present.
	assert.ok(multi.includes('/packers/records'))
})

test('a single-club deployment offers no league pages, because it has none', () => {
	// Under SCOPE=team:packers the root IS the Packers and these routes 404.
	// Linking to them would be worse than not having them.
	const team = { nouns: { leaderPlural: 'coaches' } }
	const solo = hrefs(siteNav('', team))
	assert.ok(!solo.includes('/schedule'), 'linked to a schedule that does not exist')
	assert.ok(solo.includes('/records'), 'the club\'s own records went missing')
})

test('a league page links each club by sport and id, not id alone', () => {
	// Two clubs share the id "giants". A url map keyed on the id collapses them,
	// so one links to the other's page — the third place this exact collision
	// has appeared.
	const league = {
		...EMPTY_LEAGUE,
		clubs: 2,
		seasonRange: { first: 1900, last: 2025 },
		allTime: [
			{ club: 'Giants', teamId: 'giants', sport: 'nfl', record: '1–0', winPct: 1, from: 1925, to: 2025 },
			{ club: 'Giants', teamId: 'giants', sport: 'mlb', record: '0–1', winPct: 0, from: 1883, to: 2025 },
		],
	}
	const html = leagueRecordsPage({
		league, heading: 'Every club', colors: COLORS,
		clubs: [
			{ teamId: 'giants', sport: 'nfl', name: 'New York Giants', url: '/nfl/giants' },
			{ teamId: 'giants', sport: 'mlb', name: 'San Francisco Giants', url: '/mlb/giants' },
		],
	})
	assert.ok(hrefs(html).includes('/nfl/giants/records'), 'the football Giants are not linked')
	assert.ok(hrefs(html).includes('/mlb/giants/records'), 'the baseball Giants are not linked')
})

test('a league page carries the nav above its content', () => {
	// It was only at the foot, which on an `all` scope is below sixty-two clubs'
	// worth of lists. A link nobody scrolls far enough to reach is not a way
	// back, which is how it was reported.
	const html = leagueRecordsPage({
		league: EMPTY_LEAGUE, heading: 'Every club', colors: COLORS, clubs: [],
	})
	const firstNav = html.indexOf('league-nav', html.indexOf('</style>'))
	const firstCard = html.indexOf('record-card', html.indexOf('</style>'))
	assert.ok(firstNav > 0 && firstNav < firstCard, 'the nav is not above the content')
})
