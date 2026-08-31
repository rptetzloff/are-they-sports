import test from 'node:test'
import assert from 'node:assert/strict'
import { lastLosslessSeason, seasons, seasonWinPct, seriesRecords, streakBanner } from '../lib/core.js'
import { clubSwitcher, formatDate, scheduleHtml, seasonNav, sparklineHtml } from '../lib/render.js'
import { seedRound } from '../sports/nfl.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')

// Games in a pattern, a week apart, so day arithmetic is predictable.
const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }
const run = (pattern, season = '1929') => pattern.split('').map((c, i) => ({
	result: RESULTS[c],
	date: new Date(Date.parse('1929-09-22') + i * 7 * 86_400_000).toISOString().slice(0, 10),
	season,
	regular_season: '1',
	playoff: '0',
	championship: '',
	Opponent: 'CHI',
	scoreFor: '10',
	scoreAgainst: '7',
	location: 'home',
}))

// --- the streak banner ---

test('a tie does not end an unbeaten run', () => {
	// 1929 went W W W W W W W W W W T W W. The ported loop broke on any non-win,
	// so the tie became "first loss" and the banner read "undefeated for 10
	// games before first loss" about a season with no losses in it — on the
	// exact season the site is named after. The football site still does this.
	const banner = streakBanner(run('WWWWWWWWWWTWW'), { isPastSeason: true, team: packers })
	assert.match(banner, /Finished the regular season undefeated/)
	assert.ok(!banner.includes('first loss'), banner)
})

test('an unbeaten season reports its real record, ties and all', () => {
	// Not `${n}-0`, which would relabel 12-0-1 as 13-0.
	assert.match(streakBanner(run('WWWWWWWWWWTWW'), { isPastSeason: true, team: packers }), /<strong>12-0-1<\/strong>/)
	assert.match(streakBanner(run('WWWW'), { isPastSeason: true, team: packers }), /<strong>4-0<\/strong>/)
})

test('a club that just lost is not on a 0-game win streak', () => {
	// Every fixture in this file ended in a win — WWLWW, WWWWW, LWWW — so the
	// trailing-run counter only ever counted wins. The Brewers' own page read
	// "Currently on a 0-game win streak" at 85-52.
	const b = streakBanner(run('WWLLL'), { isPastSeason: false, team: packers })
	assert.match(b, /<strong>3-game<\/strong> losing streak/)
	assert.doesNotMatch(b, /0-game/)
})

test('the run counts only the games since it started', () => {
	assert.match(streakBanner(run('WWLW'), { isPastSeason: false, team: packers }), /<strong>1-game<\/strong> win streak/)
	assert.match(streakBanner(run('WLLWWW'), { isPastSeason: false, team: packers }), /<strong>3-game<\/strong> win streak/)
})

test('a club coming off a tie is on neither streak', () => {
	// A tie is not a win and not a loss, and calling it a 0-game win streak is
	// the same conflation this file already fixed once, in the other direction.
	const b = streakBanner(run('WWLWT'), { isPastSeason: false, team: packers })
	assert.match(b, /coming off a <strong>tie<\/strong>/)
	assert.doesNotMatch(b, /streak/)
	assert.match(streakBanner(run('WWLTT'), { isPastSeason: false, team: packers }), /<strong>2-game<\/strong> run of ties/)
})

test('a live unbeaten run with a tie is not called a win streak', () => {
	// Undefeated and winning are different, which is the distinction the whole
	// site rests on.
	assert.match(streakBanner(run('WWTWW'), { isPastSeason: false, team: packers }), /unbeaten run/)
	assert.match(streakBanner(run('WWWWW'), { isPastSeason: false, team: packers }), /win streak/)
})

test('a loss still ends the run', () => {
	const banner = streakBanner(run('WWLWW'), { isPastSeason: true, team: packers })
	assert.match(banner, /Undefeated for <strong>2 games<\/strong>/)
	assert.match(banner, /before first loss/)
})

test('losing the opener says so, in both tenses', () => {
	assert.match(streakBanner(run('LWWW'), { isPastSeason: true, team: packers }), /Lost the opener/)
	assert.match(streakBanner(run('LWWW'), { isPastSeason: false, team: packers }), /Lost the opener/)
})

test('the day count is pluralised', () => {
	// It cannot read 1 in a sport that plays weekly, but the same function runs
	// on the baseball site, where it read "1 days" on a live page.
	const oneDay = [
		{ result: 'WIN', date: '2024-09-01' },
		{ result: 'LOSS', date: '2024-09-02' },
	]
	assert.match(streakBanner(oneDay, { isPastSeason: true, team: packers }), /\(1 day\)/)
})

test('no games is no banner, rather than an empty sentence', () => {
	assert.equal(streakBanner([], { isPastSeason: false, team: packers }), null)
})

// --- last lossless season ---

test('a season with ties and no losses counts', () => {
	const rows = [...run('WWTWW', '1929'), ...run('WWLWW', '1930')]
	assert.deepEqual(lastLosslessSeason(rows), { season: '1929', wins: 4, losses: 0, ties: 1 })
})

test('an unfinished season does not count, however well it is going', () => {
	// "Undefeated so far" is a different question, and the one the verdict
	// answers. This one is "when was the last one", and a season still being
	// played is not an answer to it.
	const rows = [...run('WWWW', '1929'), { ...run('WW', '2026')[0], result: '' }]
	rows.push(...run('WW', '2026'))
	assert.equal(lastLosslessSeason(rows).season, '1929')
})

test('the most recent one wins', () => {
	assert.equal(lastLosslessSeason([...run('WWWW', '1929'), ...run('WWW', '1962')]).season, '1962')
})

test('a club that never had one gets null, not a crash', () => {
	assert.equal(lastLosslessSeason(run('WWLWW', '1930')), null)
})

test('a season of nothing but ties is not lossless', () => {
	// No losses, but no wins either — the same guard the verdict uses to stop an
	// empty season claiming an undefeated one.
	assert.equal(lastLosslessSeason(run('TT', '1932')), null)
})

// --- schedule ---

test('a schedule shows date, opponent and result', () => {
	const html = scheduleHtml([{ ...run('W')[0], opponentName: 'Chicago Bears' }], { heading: '1929 Season Schedule' })
	assert.match(html, /Chicago Bears/)
	assert.match(html, /1929 Season Schedule/)
	assert.match(html, /W 10–7/)
	// A card per game, coloured by result, which is the baseball site's layout.
	assert.match(html, /class="game-item win"/)
})

test('a date renders as a weekday and a day, in UTC', () => {
	// Formatted by hand rather than with toLocaleDateString. A date with no time
	// is midnight UTC, and formatting that in a timezone behind UTC moves every
	// game a day earlier — a bug that appears only for people west of Greenwich
	// and never on the machine it was written on.
	assert.equal(formatDate('1929-09-22'), 'Sun, Sep 22')
	assert.equal(formatDate('2010-09-12'), 'Sun, Sep 12')
	assert.equal(formatDate('2011-01-01'), 'Sat, Jan 1')
})

test('an unparseable date renders as itself rather than Invalid Date', () => {
	assert.equal(formatDate('not a date'), 'not a date')
})

test('an unplayed game says scheduled rather than showing a blank score', () => {
	const row = { ...run('W')[0], result: '', scoreFor: '', scoreAgainst: '', opponentName: 'Chicago Bears' }
	const html = scheduleHtml([row], { heading: 'x' })
	assert.match(html, /scheduled/)
	assert.ok(!html.includes('–</td>'), 'rendered an empty score')
})

test('an away game is marked, a home game says vs', () => {
	const at = (location) => scheduleHtml([{ ...run('W')[0], location, opponentName: 'X' }], { heading: 'x' })
	assert.match(at('away'), /@ X/)
	assert.match(at('home'), /vs X/)
})

test('an opponent with no resolved name falls back to the code', () => {
	const html = scheduleHtml([{ ...run('W')[0], opponentName: null, Opponent: 'AKR' }], { heading: 'x' })
	assert.match(html, /AKR/)
})

test('an empty schedule renders nothing rather than an empty table', () => {
	assert.equal(scheduleHtml([], { heading: 'x' }), '')
})

// --- season navigation ---

const SEASONS = ['1921', '1929', '1930', '2010', '2026']

test('navigation offers first, previous, next and last', () => {
	const nav = seasonNav(SEASONS, '1930', '/packers')
	assert.match(nav, /href="\/packers\/1921"/)
	assert.match(nav, /href="\/packers\/1929"/)
	assert.match(nav, /href="\/packers\/2010"/)
	assert.match(nav, /href="\/packers\/2026"/)
})

// The ends are DIMMED IN PLACE now rather than dropped, so the row keeps its
// width as you move through the seasons — dropping them made it resize, which
// reads as a rendering fault rather than a boundary. These asserted the glyph
// was absent; what they meant is that nothing links backwards from the first
// season, which is the stronger claim and the one that survives the change.

const backLinks = (nav) => [...nav.matchAll(/<a href="([^"]*)"[^>]*>(?:\|‹|‹‹|‹)<\/a>/g)].map((m) => m[1])
const fwdLinks = (nav) => [...nav.matchAll(/<a href="([^"]*)"[^>]*>(?:›\||››|›)<\/a>/g)].map((m) => m[1])

test('the first season offers no previous', () => {
	const nav = seasonNav(SEASONS, '1921', '/packers')
	assert.deepEqual(backLinks(nav), [], nav)
	assert.ok(fwdLinks(nav).length > 0, 'no way forward from the first season')
	assert.match(nav, /2026/)
})

test('the last season offers no next', () => {
	const nav = seasonNav(SEASONS, '2026', '/packers')
	assert.deepEqual(fwdLinks(nav), [], nav)
	assert.ok(backLinks(nav).length > 0, 'no way back from the last season')
	assert.match(nav, /1921/)
})

test('the ends stay on the page, disabled', () => {
	// The row must not change width at the boundaries.
	const first = seasonNav(SEASONS, '1921', '/packers')
	const middle = seasonNav(SEASONS, SEASONS[3], '/packers')
	const controls = (nav) => (nav.match(/<a |<span class="step-off"/g) ?? []).length
	assert.equal(controls(first), controls(middle), 'the nav has a different number of controls at the ends')
})

test('every chevron is the same character, doubled or barred', () => {
	// The club page mixed U+22D8, U+00AB and U+2039. The first is a MATHEMATICAL
	// symbol drawn to different proportions, so it never matched the other two at
	// any size — which is what made the row look like three unrelated buttons.
	const nav = seasonNav(SEASONS, SEASONS[3], '/packers')
	for (const bad of ['⋘', '⋙', '«', '»']) {
		assert.equal(nav.includes(bad), false, `${bad} is not from the chevron family`)
	}
	assert.ok(nav.includes('|‹') && nav.includes('›|'), 'the ends are not barred')
})

test('the ten-jump appears only where it saves clicks', () => {
	// It earns its place on a hundred seasons and is clutter on eighteen weeks.
	const many = Array.from({ length: 100 }, (_, i) => String(1921 + i))
	assert.ok(seasonNav(many, '1960', '/packers').includes('‹‹'), 'no ten-jump across a century')
	const few = ['2021', '2022', '2023', '2024']
	assert.equal(seasonNav(few, '2022', '/packers').includes('‹‹'), false, 'a ten-jump across four seasons')
})

test('navigation only links seasons the club actually has', () => {
	// A franchise that did not play in 1943 must not be offered a link to it.
	const nav = seasonNav(['1942', '1944'], '1942', '/packers')
	assert.ok(!nav.includes('1943'), nav)
})

test('a single-season club gets navigation with no links', () => {
	const nav = seasonNav(['2026'], '2026', '')
	assert.ok(!nav.includes('<a '), nav)
	assert.match(nav, /2026/)
})

test('seasons come back sorted and deduplicated', () => {
	assert.deepEqual(seasons([{ season: '2010' }, { season: '1929' }, { season: '2010' }]), ['1929', '2010'])
	assert.deepEqual(seasons([]), [])
})

test('navigation with no seasons at all renders nothing', () => {
	// A club in scope whose games have not loaded yet. Without the guard this
	// produced a bar containing only the current season, which is a link to
	// nowhere dressed as navigation.
	assert.equal(seasonNav([], '2026', '/packers'), '')
})

test('the loader and the adapter read the playoff column the same way', () => {
	// They had separate copies of this decision, and the same wrong reading
	// ended up in both — only one of which had a test.
	assert.equal(seedRound({ playoff: '0' }), 'regular')
	assert.equal(seedRound({ playoff: '1' }), 'playoff')
	// The trap: '0' is truthy, so a plain `r.playoff ?` marks every game a
	// playoff game. That is exactly what shipped, for all 16,810 pre-1999 rows.
	assert.equal(seedRound({ playoff: '' }), 'regular')
})

// --- all-time head-to-head ---

test('a series record counts only completed games', () => {
	// An unplayed fixture has no result. Counting it as anything — and a naive
	// `result !== 'WIN'` would count it as a loss — puts a game that has not
	// happened into an all-time record.
	const rows = [
		{ Opponent: 'CHI', result: 'WIN' },
		{ Opponent: 'CHI', result: 'LOSS' },
		{ Opponent: 'CHI', result: '' },
	]
	assert.equal(seriesRecords(rows).get('CHI'), '1–1')
})

test('ties appear in a series record only when there are some', () => {
	assert.equal(seriesRecords([{ Opponent: 'CHI', result: 'TIE' }]).get('CHI'), '0–0–1')
	assert.equal(seriesRecords([{ Opponent: 'CHI', result: 'WIN' }]).get('CHI'), '1–0')
})

test('each opponent is counted separately', () => {
	const r = seriesRecords([
		{ Opponent: 'CHI', result: 'WIN' },
		{ Opponent: 'MIN', result: 'LOSS' },
	])
	assert.equal(r.get('CHI'), '1–0')
	assert.equal(r.get('MIN'), '0–1')
	assert.equal(r.get('DET'), undefined)
})

test('a schedule card carries the all-time series when it has one', () => {
	const withSeries = scheduleHtml([{ ...run('W')[0], opponentName: 'Chicago Bears', seriesRecord: '109–98–6' }], { heading: 'x' })
	assert.match(withSeries, /All-time: 109–98–6/)
	// And omits the line entirely rather than rendering an empty one.
	assert.ok(!scheduleHtml([run('W')[0]], { heading: 'x' }).includes('All-time'))
})

// --- season navigation, six buttons ---

const MANY = Array.from({ length: 100 }, (_, i) => String(1921 + i))

test('navigation jumps ten seasons as well as one', () => {
	// Six buttons, matching the baseball site: first, back ten, back one,
	// forward one, forward ten, last. Ten is a lot of clicks to save across a
	// hundred seasons.
	const nav = seasonNav(MANY, '1971', '/packers')
	assert.match(nav, /"\/packers\/1921"/)   // first
	assert.match(nav, /"\/packers\/1961"/)   // back ten
	assert.match(nav, /"\/packers\/1970"/)   // back one
	assert.match(nav, /"\/packers\/1972"/)   // forward one
	assert.match(nav, /"\/packers\/1981"/)   // forward ten
	assert.match(nav, /"\/packers\/2020"/)   // last
})

test('a ten-season jump clamps rather than falling off the end', () => {
	// Five seasons in, back ten is the first season.
	//
	// Asserting `!includes('undefined')` cannot catch this and the first version
	// of this test did exactly that: escapeHtml renders undefined as an empty
	// string, so falling off the end produces href="/packers/" — a link to
	// nothing that contains the word nowhere. The assertion has to be on the
	// href that should be there, and on there being no empty one.
	const nav = seasonNav(MANY, '1925', '/packers')
	assert.match(nav, /href="\/packers\/1921"/)
	assert.ok(!nav.includes('href="/packers/"'), nav)

	const late = seasonNav(MANY, '2018', '/packers')
	assert.match(late, /href="\/packers\/2020"/)
	assert.ok(!late.includes('href="/packers/"'), late)
})

// --- the club switcher ---

const CLUBS = [
	{ teamId: 'packers', sport: 'nfl', code: 'GB', name: 'Green Bay Packers', available: true, url: '/nfl/packers' },
	{ teamId: 'bears', sport: 'nfl', code: 'CHI', name: 'Chicago Bears', available: true, url: '/nfl/bears' },
	{ teamId: null, sport: 'nfl', code: 'MIN', name: 'Minnesota Vikings', available: false, url: null },
	{ teamId: 'brewers', sport: 'mlb', code: 'MIL', name: 'Milwaukee Brewers', available: true, url: '/mlb/brewers' },
]

test('the switcher links every other club', () => {
	const html = clubSwitcher(CLUBS, 'packers')
	assert.match(html, /href="\/nfl\/bears"/)
	assert.match(html, /href="\/mlb\/brewers"/)
})

test('the current club is marked, not linked to itself', () => {
	const html = clubSwitcher(CLUBS, 'packers')
	assert.match(html, /<li class="here">Green Bay Packers<\/li>/)
	assert.ok(!html.includes('href="/nfl/packers"'), html)
})

test('clubs with no data are listed and not linked', () => {
	// The same reason the selector lists them: hiding them makes a partial
	// deployment look whole.
	const html = clubSwitcher(CLUBS, 'packers')
	assert.match(html, /class="unavailable">Minnesota Vikings/)
})

test('a scope spanning two sports groups by sport', () => {
	const html = clubSwitcher(CLUBS, 'packers')
	assert.match(html, /switch-sport">NFL/)
	assert.match(html, /switch-sport">MLB/)
})

test('a single-sport scope has no sport headings', () => {
	// A heading over the only group is noise.
	const html = clubSwitcher(CLUBS.filter((c) => c.sport === 'nfl'), 'packers')
	assert.ok(!html.includes('switch-sport'), html)
})

test('a scope with one club has no switcher at all', () => {
	// There is nothing to switch to, and an empty chooser is worse than none.
	assert.equal(clubSwitcher([CLUBS[0]], 'packers'), '')
	assert.equal(clubSwitcher([], 'packers'), '')
})

test('the switcher works without JavaScript', () => {
	// A details element, because everything else on this page is server
	// rendered and a chooser that needs a script would be the only thing that
	// does not work with it disabled.
	assert.match(clubSwitcher(CLUBS, 'packers'), /^<details/)
	assert.match(clubSwitcher(CLUBS, 'packers'), /<summary>/)
})

test('the banner bolds its numbers, which is what both sites do', () => {
	// Emphasis was lost in the port and the sentence rendered as flat text. It
	// is HTML on purpose, so clubPage does not escape it — which means the club
	// name it interpolates has to be escaped here.
	const banner = streakBanner(run('WWLWW'), { isPastSeason: false, team: packers })
	assert.match(banner, /<strong>/)
})

test('a club name in the banner is escaped', () => {
	// The one interpolated value that is not a number this code computed.
	const hostile = { ...packers, nouns: { ...packers.nouns, team: '<img src=x>' } }
	const banner = streakBanner(run('WWLWW'), { isPastSeason: false, team: hostile })
	assert.ok(!banner.includes('<img'), banner)
	assert.match(banner, /&lt;img/)
})

// --- the history sparkline ---

test('win percentage counts a tie as a half', () => {
	// Which is how every league that has ties computes it. 12-0-1 is .962 —
	// not 1.000, and not .923.
	const rows = [...run('WWWWWWWWWWTWW', '1929')]
	const [y] = seasonWinPct(rows)
	assert.equal(y.season, '1929')
	assert.equal(y.pct.toFixed(3), '0.962')
})

test('the postseason is excluded from the line', () => {
	// Otherwise a club moves by whether it reached the playoffs rather than by
	// how it played: 13-3 with a playoff loss would show worse than 13-3 with
	// no playoffs at all.
	const rows = [
		...run('WWWW', '2011'),
		{ ...run('L', '2011')[0], regular_season: '0', playoff: '1' },
	]
	assert.equal(seasonWinPct(rows)[0].pct, 1)
})

test('seasons come back oldest first', () => {
	const pts = seasonWinPct([...run('WW', '2011'), ...run('LL', '1929')])
	assert.deepEqual(pts.map((p) => p.season), ['1929', '2011'])
})

test('an unplayed season contributes nothing', () => {
	const rows = [{ ...run('W', '2026')[0], result: '' }]
	assert.deepEqual(seasonWinPct(rows), [])
})

test('the sparkline is inline svg, with a baseline', () => {
	// No script and no request: both sites draw this with a charting library in
	// the browser, and a polyline reproduces it.
	const svg = sparklineHtml([{ season: '1921', pct: 0.5 }, { season: '1929', pct: 1 }])
	assert.match(svg, /^<svg/)
	assert.match(svg, /<polyline/)
	// The .500 line is what makes it readable — above is a winning season.
	assert.match(svg, /spark-base/)
	assert.match(svg, /aria-label="Win percentage by season, 1921 to 1929"/)
})

test('a higher percentage is drawn higher', () => {
	// y is inverted in SVG, so getting this backwards draws every good season
	// at the bottom and still looks like a chart.
	const svg = sparklineHtml([{ season: 'a', pct: 0 }, { season: 'b', pct: 1 }])
	const [, points] = svg.match(/points="([^"]+)"/)
	const [first, second] = points.split(' ').map((p) => Number(p.split(',')[1]))
	assert.ok(second < first, `pct 1 drew at y=${second}, pct 0 at y=${first}`)
})

test('one season is not a line', () => {
	// A polyline through a single point draws nothing and reserves space for it.
	assert.equal(sparklineHtml([{ season: '2026', pct: 1 }]), '')
	assert.equal(sparklineHtml([]), '')
})

test('the switcher keeps you on the page you were on', () => {
	// From the Packers' records to the Bears' records, not to their front page.
	// Being sent home to re-navigate is the thing a switcher exists to avoid.
	const html = clubSwitcher(CLUBS, 'packers', '/records')
	assert.match(html, /href="\/nfl\/bears\/records"/)
	assert.match(html, /href="\/mlb\/brewers\/records"/)
})

test('a season carries across too, because comparing one is the point', () => {
	assert.match(clubSwitcher(CLUBS, 'packers', '/2011'), /href="\/nfl\/bears\/2011"/)
})

test('no path is still the club front page', () => {
	const html = clubSwitcher(CLUBS, 'packers')
	assert.match(html, /href="\/nfl\/bears"/)
	assert.ok(!html.includes('/nfl/bears/'), html)
})
