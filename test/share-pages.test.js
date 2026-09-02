import test from 'node:test'
import assert from 'node:assert/strict'
import {
	headToHeadPage, historyPage, leadersPage, opponentPage, recordsPage,
} from '../lib/render.js'
import { computeRecords } from '../lib/records.js'
import { computeHeadToHead } from '../lib/headtohead.js'
import { historyPoints } from '../lib/history.js'
import { leaderColumns } from '../lib/leaders.js'
import { shareLinks } from '../lib/share.js'
import { sharePanel } from '../lib/render.js'
import { loadTeam } from '../lib/teams.js'

// Share exists on every page that has something to share.
//
// It was built once and wired into exactly one place, and the parity audit
// carried "share on the page — gap" four separate times for four pages using
// one mechanism. This asserts the wiring rather than the mechanism, which
// test/share.test.js already covers.

const packers = await loadTeam('packers')
const COLORS = { base: '#000', accent: '#fff', text: '#fff' }

const games = 'WWLT'.split('').map((c, i) => ({
	result: { W: 'WIN', L: 'LOSS', T: 'TIE' }[c],
	date: `${2000 + i}-09-01`, season: String(2000 + i),
	regular_season: '1', playoff: '0', championship: '',
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10', location: 'home',
}))
const records = computeRecords(games, { streaksSpanSeasons: true, titles: [] })
const h2h = computeHeadToHead(games)
const points = historyPoints(records.everySeason)
const resolve = (code) => ({ name: code })
const common = { team: packers, colors: COLORS, resolve, base: '/nfl/packers' }

const PANEL = sharePanel({
	url: 'https://example.test/p',
	links: shareLinks({ url: 'https://example.test/p', title: 't', text: 'x' }),
})

/** Every page that takes a share row, and how to build it. */
const PAGES = [
	['records', (share) => recordsPage({ ...common, records, share })],
	['head-to-head', (share) => headToHeadPage({ ...common, opponents: h2h.opponents, path: '/nfl/packers/vs', share })],
	['one opponent', (share) => opponentPage({ ...common, opponent: h2h.opponents[0], name: 'Chicago Bears', share })],
	['history', (share) => historyPage({ ...common, points, share })],
	['leaders', (share) => leadersPage({
		...common, columns: leaderColumns({ leaderNoun: 'Coach' }),
		leaders: [{ leader: 'a', name: 'A', num: 1, label: '1', firstSeason: 2000, lastSeason: 2003, w: 2, l: 1, t: 1, winPct: 0.625, playoffW: 0, playoffL: 0, titles: [], basis: 'counted', interim: false }],
		share,
	})],
]

test('every page that takes a share row renders it', () => {
	const missing = PAGES.filter(([, render]) => !render(PANEL).includes('class="switcher share"'))
	assert.deepEqual(missing.map(([name]) => name), [])
})

test('no share row renders nothing, on every one of them', () => {
	// The club page is the model: a page with nothing to say does not draw an
	// empty disclosure that opens on six links to the same address.
	const stray = PAGES.filter(([, render]) => render('').includes('switcher share'))
	assert.deepEqual(stray.map(([name]) => name), [])
})

test('the share row sits below the club switcher, not among the content', () => {
	// Where the club page puts it, and for its reason: both are things a reader
	// does WITH the page rather than things the page says.
	for (const [name, render] of PAGES) {
		const html = render(PANEL)
		const share = html.indexOf('class="switcher share"')
		assert.ok(share > html.lastIndexOf('</table>'), `${name}: share is above the content`)
	}
})

test('a page still renders with no share argument at all', () => {
	// Every one of these had no such parameter until now, and a caller that has
	// not been updated must not throw.
	for (const [name, render] of PAGES) {
		assert.ok(render(undefined).includes('<html'), `${name} did not render`)
	}
})
