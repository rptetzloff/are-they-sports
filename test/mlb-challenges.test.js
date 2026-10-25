import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gameChallenges, pitchChallenge, challengeText, challengesHtml, liveDetail, liveDetailHtml, pitchCall } from '../web/mlb/live-core.js'

// World Series Game 2, Rays at Brewers, Oct 24 2026: five ABS challenges
// and two manager challenges, cut down to those plays and their batters.
const ws2 = JSON.parse(readFileSync(new URL('./fixtures/ws2-challenges.json', import.meta.url)))
const named = ws2.header.competitions[0].competitors.map((c) => ({ abbr: c.team.abbreviation, homeAway: c.homeAway, name: c.team.displayName, short: c.team.shortDisplayName }))
const names = new Map(ws2.rosters.flatMap((t) => t.roster).map((e) => [String(e.athlete.id), { name: e.athlete.displayName, short: e.athlete.shortName }]))
const ch = gameChallenges(ws2.plays, named, names)

test('every challenge of the game, in order, with who made it and how it went', () => {
	assert.deepEqual(ch.list.map((c) => [c.kind, c.inning, c.team, c.won]), [
		['abs', 'Top 1st', 'MIL', true],
		['abs', 'Top 2nd', 'MIL', false],
		['manager', 'Top 6th', 'TB', false],
		['manager', 'Bot 8th', 'MIL', false],
		['abs', 'Bot 8th', 'TB', true],
		['abs', 'Top 9th', 'MIL', false],
		['abs', 'Top 9th', 'TB', false],
	])
})

test('the challenger is the side the call hurt: fielders for a ball, the batter\'s side for a strike', () => {
	const [first, second, , , , , last] = ch.list
	// "Strike Looking - Overturned" in the top of the 1st: called a ball, now
	// a strike, so Milwaukee, in the field, asked.
	assert.deepEqual([first.called, first.call, first.team], ['ball', 'strike', 'MIL'])
	// "Ball - Confirmed": the fielders asked, and lost.
	assert.deepEqual([second.called, second.call, second.team, second.won], ['ball', 'ball', 'MIL', false])
	// "Strike Looking - Confirmed" in the top of the 9th: the Rays' batter.
	assert.deepEqual([last.called, last.team, last.batter], ['strike', 'TB', 'V. Mesa Jr.'])
})

test('each team\'s tally: two ABS challenges a game, kept when one wins', () => {
	assert.deepEqual(ch.teams.map((t) => [t.team, t.absWon, t.absLost, t.absLeft, t.managerWon, t.managerLost]), [
		['MIL', 1, 2, 0, 0, 1],
		['TB', 1, 1, 1, 0, 1],
	])
})

test('in extra innings the count of what is left is not claimed', () => {
	const extra = ws2.plays.concat([{ ...ws2.plays[0], period: { type: 'Top', number: 10 } }])
	const t = gameChallenges(extra, named, names).teams
	assert.ok(t.every((x) => x.absLeft === null))
	assert.equal(t.find((x) => x.team === 'MIL').absWon, 2)
})

test('the pitch keeps the call after review, and the list marks it', () => {
	const pitch = (text, type) => ({ text, type: { text: type } })
	assert.equal(pitchChallenge(pitch('Pitch 2 : Strike 2 Looking', 'Strike Looking - Overturned')), 'overturned')
	assert.equal(pitchChallenge(pitch('Pitch 4 : Ball 3', 'Ball - Confirmed')), 'upheld')
	assert.equal(pitchChallenge(pitch('Pitch 1 : Ball 1', 'Ball')), null)
	assert.equal(pitchCall(pitch('Pitch 2 : Strike 2 Looking', 'Strike Looking - Overturned')), 'strike')
	assert.equal(pitchCall(pitch('Pitch 3 : Ball 2', 'Ball - Overturned')), 'ball')
})

test('manager challenges and umpire reviews in other wordings', () => {
	const play = (text) => ({ text, period: { type: 'Bottom', number: 7 }, summaryType: 'N' })
	const got = gameChallenges([
		play('Pratt grounded out to shortstop. Milwaukee Brewers challenged (force play): call on the field was overturned. Pratt safe at first.'),
		play('Ortiz homered to left. Umpire review: HR call on the field was overturned due to fan interference.'),
	], named, names).list
	assert.deepEqual(got.map((c) => [c.kind, c.team, c.won, c.overturned]), [['manager', 'MIL', true, undefined], ['umpire', '', null, true]])
	assert.equal(challengeText(got[1]), 'Umpire review: HR call on the field was overturned due to fan interference.')
})

test('the block: pips left, away first, and the latest three, newest first', () => {
	const html = challengesHtml(ch)
	assert.match(html, /aria-label="TB: 1 left, 1 won, 1 lost">.*aria-label="MIL: 0 left, 1 won, 2 lost"/)
	assert.equal((html.match(/class="chal-pip on"/g) || []).length, 1)
	const items = [...html.matchAll(/<div class="live-note chal-item[^"]*"><span class="live-inning">([^<]*)<\/span> ([^<]*)<\/div>/g)].map((m) => `${m[1]} ${m[2]}`)
	assert.deepEqual(items, [
		'Top 9th TB challenged a called strike on V. Mesa Jr.: upheld',
		'Top 9th MIL challenged a called ball on J. DeLuca: upheld',
		'Bot 8th TB challenged a called ball on B. Turang: overturned, now a strike',
	])
	assert.equal(challengesHtml(null), '')
})

test('the live card carries it, during the game only', () => {
	const live = structuredClone(ws2)
	live.header.competitions[0].status.type = { state: 'in', detail: 'Top 9th', shortDetail: 'Top 9th' }
	const d = liveDetail(live)
	assert.equal(d.challenges.list.length, 7)
	assert.match(liveDetailHtml(d), /class="live-challenges"/)
	assert.equal(liveDetailHtml(liveDetail(ws2)), '', 'a final game has no live card')
})
