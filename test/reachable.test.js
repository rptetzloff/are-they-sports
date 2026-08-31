import test from 'node:test'
import assert from 'node:assert/strict'
import { leagueNav, leagueRecordsPage, leagueSchedulePage, selectorPage, siteNav, sportTabs, standingsPage } from '../lib/render.js'
import { matchRoute, parseView, routeTable } from '../lib/routes.js'
import { parseScope } from '../lib/scope.js'
import mlb from '../sports/mlb.js'
import nfl from '../sports/nfl.js'

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

// --- one block per sport ---

test('a scope covering two sports renders them separately, each labelled', () => {
	// It used to rank football seasons against baseball ones in one list and
	// print a note admitting the lists compared clubs that never played each
	// other. The note was true and the page was still a pile.
	const html = leagueRecordsPage({
		league: { ...EMPTY_LEAGUE, clubs: 32, seasonRange: { first: 1920, last: 2025 } },
		label: 'NFL',
		more: [{ label: 'MLB', league: { ...EMPTY_LEAGUE, clubs: 30, seasonRange: { first: 1897, last: 2025 } } }],
		heading: 'Every club', colors: COLORS, clubs: [],
	})
	const labels = [...html.matchAll(/<h2 class="league-heading">([^<]*)<\/h2>/g)].map((m) => m[1])
	assert.deepEqual(labels, ['NFL', 'MLB'])
	// Two season ranges, one per block, rather than one spanning both sports.
	assert.ok(html.includes('1920–2025'))
	assert.ok(html.includes('1897–2025'))
})

test('a single-sport scope is not labelled at all', () => {
	// Nothing to tell it apart from, so a heading would be noise. This is also
	// what every existing deployment sees, and it must not change.
	const html = leagueRecordsPage({
		league: EMPTY_LEAGUE, label: 'NFL', heading: 'NFC North', colors: COLORS, clubs: [],
	})
	assert.equal(html.includes('league-heading'), false)
})

test('each sport keeps its own period rule on the schedule', () => {
	// Football groups by week and baseball by date. Merged, the page claimed
	// weeks were known because SOME games had them, and sorted 22 week-periods
	// against 209 date-periods.
	const wk = (n) => ({ key: `w${n}`, kind: 'week', week: n, date: null, games: [] })
	const dy = (d) => ({ key: `d${d}`, kind: 'date', week: null, date: d, games: [] })
	const html = leagueSchedulePage({
		// `period` is the one being shown. The page renders a single period now
		// rather than the whole season — baseball's 2026 was 184 of them and
		// 878KB of HTML — so a schedule with none selected renders no fixtures.
		schedule: { season: 2025, seasons: [2025], periods: [wk(1)], period: wk(1), index: 0, weeksKnown: true, games: 285 },
		label: 'NFL', periodNoun: 'Week',
		more: [{
			label: 'MLB', periodNoun: 'Games',
			schedule: { season: 2025, seasons: [2025], periods: [dy('2025-03-18')], period: dy('2025-03-18'), index: 0, weeksKnown: false, games: 2228 },
		}],
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [],
	})
	assert.deepEqual([...html.matchAll(/<h2 class="league-heading">([^<]*)<\/h2>/g)].map((m) => m[1]), ['NFL', 'MLB'])
	assert.ok(html.includes('<h2>Week 1</h2>'), 'football is not grouped by week')
	assert.ok(/<h2>[A-Z][a-z]{2}, Mar 18<\/h2>/.test(html), 'baseball is not grouped by date')
	// And the "no weeks recorded" note belongs to baseball, not to the page.
	assert.equal((html.match(/No week numbers are recorded/g) ?? []).length, 0,
		'the note fired for a sport that does not use weeks')
})

// --- per-sport league pages ---

test('sport tabs appear only when there is more than one sport', () => {
	// A single-sport deployment has nothing to switch between, and a tab bar
	// with one tab is furniture.
	assert.equal(sportTabs(['nfl'], null, 'records'), '')
	assert.equal(sportTabs([], null, 'records'), '')
	assert.notEqual(sportTabs(['nfl', 'mlb'], null, 'records'), '')
})

test('the tabs link each sport and mark the current one', () => {
	const tabs = sportTabs(['nfl', 'mlb'], 'nfl', 'records')
	assert.deepEqual(hrefs(tabs), ['/records', '/mlb/records'])
	// The one you are on is named, not linked to itself.
	assert.ok(tabs.includes('<span class="here">NFL</span>'))
	// And "All" is a real destination, because the stacked view still exists.
	assert.ok(tabs.includes('>All<'))
})

test('the tabs follow the view they are on', () => {
	assert.deepEqual(hrefs(sportTabs(['nfl', 'mlb'], 'mlb', 'schedule')), ['/schedule', '/nfl/schedule'])
})

test('the unqualified page marks All as current', () => {
	const tabs = sportTabs(['nfl', 'mlb'], null, 'records')
	assert.ok(tabs.includes('<span class="here">All</span>'))
	assert.deepEqual(hrefs(tabs), ['/nfl/records', '/mlb/records'])
})

test('a sport-qualified schedule keeps its prefix on every season link', () => {
	// The season nav builds links from `base`. Left empty, a sport-qualified
	// page linked back to the unqualified one and dropped the sport on every
	// season change — measured: /nfl/schedule/2024 offered /schedule/2023.
	const html = leagueSchedulePage({
		schedule: { season: 2024, seasons: [2023, 2024, 2025], periods: [], weeksKnown: true, games: 0 },
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [], base: '/nfl',
	})
	const seasons = hrefs(html).filter((h) => /schedule\/\d{4}$/.test(h))
	assert.ok(seasons.length > 0, 'no season links at all')
	for (const h of seasons) assert.ok(h.startsWith('/nfl/'), `${h} lost the sport`)
})

test('each block resolves names with its own sport', () => {
	// The bug: a page covering two sports took ONE namer, from the first club in
	// scope, which under `all` is a football club. Baseball codes were then
	// resolved against the football table — LAN became the Lansing Oldsmobiles,
	// CIN the Bengals, MIL the Milwaukee Badgers, MIN the Vikings. Every one of
	// those is a real football club, so the page looked plausible and was
	// entirely wrong.
	const football = (code) => ({ name: code === 'CIN' ? 'Cincinnati Bengals' : code })
	const baseball = (code) => ({ name: code === 'CIN' ? 'Cincinnati Reds' : code })
	const period = { key: 'd1', kind: 'date', week: null, date: '2025-04-01', games: [{
		gid: 'g', date: '2025-04-01', week: null, round: 'regular',
		home: 'CIN', away: 'CHN', homeId: null, awayId: null,
		homeScore: 3, awayScore: 1, neutral: false, played: true,
	}] }
	const html = leagueSchedulePage({
		schedule: { season: 2025, seasons: [2025], periods: [], weeksKnown: true, games: 0 },
		label: 'NFL', periodNoun: 'Week', resolve: football,
		more: [{
			label: 'MLB', periodNoun: 'Games', resolve: baseball,
			schedule: { season: 2025, seasons: [2025], periods: [period], period, index: 0, weeksKnown: false, games: 1 },
		}],
		heading: 'Every club', colors: COLORS, clubs: [],
	})
	assert.ok(html.includes('Cincinnati Reds'), 'the baseball block used the football namer')
	assert.equal(html.includes('Cincinnati Bengals'), false, 'a football name reached the baseball block')
})

test('a records block names opponents with its own sport too', () => {
	// Same failure on the other page: ties and biggest wins name the opponent.
	const football = (code) => ({ name: code === 'MIL' ? 'Milwaukee Badgers' : code })
	const baseball = (code) => ({ name: code === 'MIL' ? 'Milwaukee Brewers' : code })
	const win = { club: 'Cubs', teamId: 'cubs', sport: 'mlb', opponent: 'MIL', opponentId: null, pf: 9, pa: 1, season: 1998 }
	const html = leagueRecordsPage({
		league: EMPTY_LEAGUE, label: 'NFL', resolve: football,
		more: [{ label: 'MLB', resolve: baseball, league: { ...EMPTY_LEAGUE, clubs: 1, seasonRange: { first: 1876, last: 2025 }, lopsidedWins: [win] } }],
		heading: 'Every club', colors: COLORS, clubs: [],
	})
	assert.ok(html.includes('Milwaukee Brewers'), 'the baseball block used the football namer')
	assert.equal(html.includes('Milwaukee Badgers'), false)
})

// --- standings, where two sports are not at the same season ---

const standingsFor = (season, clubs) => ({
	season,
	clubs: clubs.length,
	groups: [{ conference: 'NFC', division: 'North', clubs: clubs.map((c) => ({
		...c, t: 0, pf: 0, pa: 0, sport: 'nfl', teamId: c.club.toLowerCase(),
	})) }],
})
const LINE = { club: 'Packers', w: 13, l: 3, record: '13–3', pct: 0.8125, gb: 0 }

test('a combined standings page names the season on each league, not once on top', () => {
	// In August football's latest played season is last winter's and baseball's
	// is the one being played. One heading over both names one of them and is
	// wrong about the other — which is the objection to combined records,
	// arriving by a different route.
	const html = standingsPage({
		standings: standingsFor(2025, [LINE]), label: 'NFL', seasons: [2024, 2025, 2026],
		more: [{ label: 'MLB', standings: standingsFor(2026, [LINE]) }],
		heading: 'Every club', colors: COLORS, clubs: [],
	})
	assert.ok(html.includes('NFL 2025'), 'football block does not name its season')
	assert.ok(html.includes('MLB 2026'), 'baseball block does not name its season')
	assert.ok(!/<h1>Every club 20\d\d<\/h1>/.test(html), 'the heading names one season for two')
})

test('the nav still steps when the two leagues disagree', () => {
	// An earlier draft looked up a deliberately-null season, found -1, and
	// rendered all four arrows dim: a nav that cannot navigate.
	const html = standingsPage({
		standings: standingsFor(2025, [LINE]), label: 'NFL', seasons: [2024, 2025, 2026],
		more: [{ label: 'MLB', standings: standingsFor(2026, [LINE]) }],
		heading: 'Every club', colors: COLORS, clubs: [],
	})
	assert.ok(hrefs(html).includes('/standings/2025'), 'no way back to the previous season')
	assert.ok(html.includes('2025 / 2026'), 'the nav does not say which seasons are shown')
})

test('one league on its own names its season once', () => {
	const html = standingsPage({
		standings: standingsFor(2025, [LINE]), label: 'NFL', seasons: [2024, 2025],
		heading: 'Every NFL club', colors: COLORS, clubs: [],
	})
	assert.ok(html.includes('<h1>Every NFL club 2025</h1>'))
	assert.ok(!html.includes('NFL 2025<'), 'a lone league repeats its own label')
})

test('the standings page links back to the clubs and the other league pages', () => {
	const links = hrefs(standingsPage({
		standings: standingsFor(2025, [LINE]), seasons: [2025],
		heading: 'Every club', colors: COLORS, clubs: [],
	}))
	assert.ok(links.includes('/'), 'no way back to the clubs')
	assert.ok(links.includes('/records'), 'no link to the league records')
	assert.ok(links.includes('/schedule'), 'no link to the league schedule')
})

// --- the other direction: is every link a route? ---

// The tests above ask whether every route is linked. Nothing asked the reverse,
// and `/managers` was in every club page's site nav, answering 404, for as long
// as the nav existed. The leaders page needs a curated coaches/managers table
// nobody publishes; the link went in ahead of the page.

const LEAGUE_ROUTES = new Set(['/records', '/schedule', '/standings'])

const teamFor = (sport) => ({
	id: sport === 'mlb' ? 'brewers' : 'packers',
	sport,
	nouns: { ...(sport === 'mlb' ? mlb : nfl).defaults.nouns, team: 'Club', fullName: 'The Club' },
})

const resolves = (href, sport) => {
	if (href === '' || href.startsWith('http')) return true
	if (LEAGUE_ROUTES.has(href)) return true
	const id = sport === 'mlb' ? 'brewers' : 'packers'
	const table = routeTable(parseScope(`team:${sport}/${id}`), [{ sport, teamId: id, code: 'X', available: true }])
	const m = matchRoute(href, table)
	return Boolean(m && parseView(m.rest))
}

for (const sport of ['nfl', 'mlb']) {
	test(`every link in the ${sport} club nav is a route that renders`, () => {
		for (const league of [false, true]) {
			const html = siteNav('', teamFor(sport), { league })
			for (const href of hrefs(html)) {
				assert.ok(resolves(href, sport), `${href} is linked and does not resolve (league: ${league})`)
			}
		}
	})
}

test('the nav test can fail — an unbuilt page is caught', () => {
	// Guards the guard. `resolves` returning true for everything would make the
	// two tests above pass on the nav that shipped the 404.
	assert.equal(resolves('/managers', 'mlb'), false)
	assert.equal(resolves('/coaches', 'nfl'), false)
	assert.equal(resolves('/records', 'nfl'), true)
})

test('a club under a multi-club scope can reach the standings', () => {
	// /records and /schedule were both in this list and /standings was not, so
	// the page added last week was reachable from the selector and from the other
	// league pages, and not from any club page.
	const links = hrefs(siteNav('', teamFor('nfl'), { league: true }))
	for (const r of LEAGUE_ROUTES) assert.ok(links.includes(r), `no link to ${r}`)
})

// --- one period per page ---

const wkP = (n, dates = ['2026-09-13']) => ({
	key: `w${n}`, kind: 'week', week: n, date: null,
	games: dates.map((d) => ({
		gid: `g${n}`, date: d, week: n, round: 'regular',
		home: 'GB', away: 'CHI', homeId: null, awayId: null,
		homeScore: 20, awayScore: 10, neutral: false, played: true,
	})),
})

const sched = (periods, index = 0, season = 2026) => ({
	season, seasons: [season], periods, period: periods[index], index,
	weeksKnown: true, games: periods.reduce((n, p) => n + p.games.length, 0),
})

test('the page renders one period, not the whole season', () => {
	// The measurement: /mlb/schedule was 184 periods, 2,431 games and 878KB of
	// HTML in one response. Every fixture in this file had a single period, so
	// rendering all of them and rendering the selected one looked identical and
	// a mutant restoring the old behaviour survived.
	const html = leagueSchedulePage({
		schedule: sched([wkP(1), wkP(2), wkP(3)], 1),
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [], base: '/nfl',
	})
	assert.ok(html.includes('<h2>Week 2</h2>'), 'the selected period is not shown')
	assert.equal(html.includes('<h2>Week 1</h2>'), false, 'a period that was not selected was rendered')
	assert.equal(html.includes('<h2>Week 3</h2>'), false, 'a period that was not selected was rendered')
})

test('the whole season is still available on request', () => {
	// Sometimes it is genuinely what is wanted. It is just no longer what
	// everybody pays for.
	const html = leagueSchedulePage({
		schedule: sched([wkP(1), wkP(2), wkP(3)], 1), all: true,
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [], base: '/nfl',
	})
	for (const n of [1, 2, 3]) assert.ok(html.includes(`<h2>Week ${n}</h2>`), `week ${n} missing from the full season`)
})

test('the period nav keeps its sport, like every other link here', () => {
	// A bare /schedule/2026/w3 under a two-sport scope means football's week 3
	// and baseball's, which are different pages. This is the same failure as the
	// season nav dropping its prefix, and as one namer serving two sports.
	const html = leagueSchedulePage({
		schedule: sched([wkP(1), wkP(2), wkP(3)], 1),
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [], base: '/nfl',
	})
	const periodLinks = hrefs(html).filter((h) => /\/schedule\/\d{4}\/[wd]/.test(h))
	assert.ok(periodLinks.length >= 2, 'no period links at all')
	for (const h of periodLinks) assert.ok(h.startsWith('/nfl/'), `${h} lost the sport`)
	// And the way out to the whole season keeps it too.
	const full = hrefs(html).filter((h) => h.includes('all=1'))
	assert.ok(full.length > 0, 'no link to the whole season')
	for (const h of full) assert.ok(h.startsWith('/nfl/'), `${h} lost the sport`)
})

test('two sports each get their own period nav, pointing at their own sport', () => {
	// The combined page carries two of these. One base for the page would point
	// both at the same URL.
	const html = leagueSchedulePage({
		schedule: sched([wkP(1), wkP(2)], 0), label: 'NFL', base: '/nfl',
		more: [{ label: 'MLB', periodNoun: 'Games', base: '/mlb', schedule: sched([wkP(8), wkP(9)], 0) }],
		heading: 'Every club', colors: COLORS, resolve: (c) => ({ name: c }), clubs: [],
	})
	const links = hrefs(html).filter((h) => /\/schedule\/\d{4}\/[wd]/.test(h))
	assert.ok(links.some((h) => h.startsWith('/nfl/')), 'no football period links')
	assert.ok(links.some((h) => h.startsWith('/mlb/')), 'no baseball period links')
	for (const h of links) assert.ok(h.startsWith('/nfl/') || h.startsWith('/mlb/'), `${h} is not sport-qualified`)
})
