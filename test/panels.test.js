import test from 'node:test'
import assert from 'node:assert/strict'
import { lastLosslessSeason, seasons, streakBanner } from '../lib/core.js'
import { scheduleHtml, seasonNav } from '../lib/render.js'
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
	assert.match(streakBanner(run('WWWWWWWWWWTWW'), { isPastSeason: true, team: packers }), /12-0-1/)
	assert.match(streakBanner(run('WWWW'), { isPastSeason: true, team: packers }), /4-0$/)
})

test('a live unbeaten run with a tie is not called a win streak', () => {
	// Undefeated and winning are different, which is the distinction the whole
	// site rests on.
	assert.match(streakBanner(run('WWTWW'), { isPastSeason: false, team: packers }), /unbeaten run/)
	assert.match(streakBanner(run('WWWWW'), { isPastSeason: false, team: packers }), /win streak/)
})

test('a loss still ends the run', () => {
	const banner = streakBanner(run('WWLWW'), { isPastSeason: true, team: packers })
	assert.match(banner, /Undefeated for 2 games/)
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
	const html = scheduleHtml([{ ...run('W')[0], opponentName: 'Chicago Bears' }], { heading: '1929 schedule' })
	assert.match(html, /Chicago Bears/)
	assert.match(html, /1929 schedule/)
	assert.match(html, />W</)
})

test('an unplayed game says scheduled rather than showing a blank score', () => {
	const row = { ...run('W')[0], result: '', scoreFor: '', scoreAgainst: '', opponentName: 'Chicago Bears' }
	const html = scheduleHtml([row], { heading: 'x' })
	assert.match(html, /scheduled/)
	assert.ok(!html.includes('–</td>'), 'rendered an empty score')
})

test('venue is marked for away and neutral, and blank for home', () => {
	const at = (location) => scheduleHtml([{ ...run('W')[0], location, opponentName: 'X' }], { heading: 'x' })
	assert.match(at('away'), /class="at">@</)
	assert.match(at('neutral'), /class="at">v</)
	assert.match(at('home'), /class="at"><\/span>/)
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

test('the first season offers no previous', () => {
	const nav = seasonNav(SEASONS, '1921', '/packers')
	assert.ok(!nav.includes('‹'), nav)
	assert.match(nav, /2026/)
})

test('the last season offers no next', () => {
	const nav = seasonNav(SEASONS, '2026', '/packers')
	assert.ok(!nav.includes('›'), nav)
	assert.match(nav, /1921/)
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
