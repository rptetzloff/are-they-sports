// Football's box score, reduced from ESPN's summary (lib/espn-box.js). It
// feeds the live card's field and the game page, and for every game it once
// threw: an option named `team` shadowed the module's own builder of a side.
import test from 'node:test'
import assert from 'node:assert/strict'
import { espnBoxscore } from '../lib/espn-box.js'

const side = (homeAway, id, abbr, score) => ({
	homeAway, score, winner: false, linescores: [{ displayValue: score }],
	team: { id, abbreviation: abbr, displayName: `${abbr} club`, shortDisplayName: abbr, color: '123456' },
})
const summary = (state) => ({
	header: {
		id: '401873017',
		competitions: [{
			date: '2026-10-25T17:00Z',
			status: { type: { state, detail: state === 'in' ? '2:00 - 4th' : 'Final', completed: state === 'post' } },
			competitors: [side('away', '25', 'SF', '20'), side('home', '1', 'ATL', '26')],
		}],
	},
})

test('a box score reduces, live or final, and says which side is the club', () => {
	for (const state of ['in', 'post']) {
		const box = espnBoxscore(summary(state), { club: 'ATL' })
		assert.ok(box, state)
		assert.equal(box.home.abbr, 'ATL')
		assert.equal(box.away.score, '20')
		assert.equal(box.teamSide, 'home')
	}
})

test('the scoreboard\'s live score wins over the summary\'s', () => {
	const scoreboard = { status: { type: { state: 'in', detail: '1:30 - 4th' } }, competitors: [{ team: { id: '25' }, score: '27' }] }
	const box = espnBoxscore(summary('in'), { scoreboard, club: 'SF' })
	assert.equal(box.away.score, '27')
	assert.equal(box.teamSide, 'away')
})
