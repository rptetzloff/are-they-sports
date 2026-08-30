import test from 'node:test'
import assert from 'node:assert/strict'
import { computeLeague } from '../lib/league.js'

// The record book for a whole league. What is different from one club's is not
// the ranking — that is reused deliberately — but that every game is in the
// data twice, once per club, and the three kinds of entry double differently.

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

/** A club, and a season of games from a pattern. */
const club = (id, team) => ({ id, sport: 'nfl', sourceIds: [id], nouns: { team, fullName: team } })

const season = (year, pattern, over = {}) => pattern.split('').map((c, i) => ({
	result: RESULTS[c] ?? '',
	date: `${year}-09-${String(i + 1).padStart(2, '0')}`,
	season: String(year),
	regular_season: '1',
	playoff: '0',
	championship: '',
	championshipTitle: null,
	Opponent: 'XXX',
	scoreFor: '20',
	scoreAgainst: '10',
	location: 'home',
	gid: `${year}-${i}`,
	...over,
}))

test('a league with no games is empty rather than broken', () => {
	const l = computeLeague([{ team: club('GB', 'Packers'), rows: [] }])
	assert.equal(l.clubs, 0)
	assert.deepEqual(l.bestSeasons, [])
	assert.deepEqual(l.allTime, [])
})

test('a club with no rows does not appear as an 0-0 season', () => {
	// An unavailable club must not rank last in the league at .000. It is absent,
	// which is a different statement.
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: season(2011, 'WWWL') },
		{ team: club('CHI', 'Bears'), rows: [] },
	])
	assert.equal(l.clubs, 1)
	assert.deepEqual(l.allTime.map((c) => c.club), ['Packers'])
})

// --- what is different from one club ---

test('every entry names the club that owns it', () => {
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: season(2011, 'WWWW') },
		{ team: club('CHI', 'Bears'), rows: season(2011, 'LLLL') },
	])
	assert.equal(l.bestSeasons[0].club, 'Packers')
	assert.equal(l.worstSeasons[0].club, 'Bears')
})

test('seasons from different clubs are ranked against each other', () => {
	// The whole point. Ranking each club separately and concatenating would put
	// every Packers season above every Bears season.
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: [...season(2010, 'WWLL'), ...season(2011, 'WWWW')] },
		{ team: club('CHI', 'Bears'), rows: [...season(2010, 'WWWL'), ...season(2011, 'LLLL')] },
	])
	assert.deepEqual(
		l.bestSeasons.map((s) => `${s.club} ${s.season}`),
		['Packers 2011', 'Bears 2010', 'Packers 2010', 'Bears 2011'])
})

test('a tie is one game, not two, however many clubs played it', () => {
	// The failure this guards: a tie is a TIE from both sides, so pooling the
	// clubs lists it twice. A blowout is a win for one and a loss for the other
	// and does not double, which is why only this list is deduplicated.
	const shared = { gid: 'g1', date: '1929-11-10', season: '1929' }
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: season(1929, 'T', { ...shared, Opponent: 'CHI' }) },
		{ team: club('CHI', 'Bears'), rows: season(1929, 'T', { ...shared, Opponent: 'GB' }) },
	])
	assert.equal(l.ties.length, 1, `the same tie was listed ${l.ties.length} times`)
})

test('two ties between the same clubs on one day are both listed', () => {
	// A doubleheader, which baseball plays. Both games are GB v CHI on one date,
	// so date-plus-codes gives them the SAME key and only the game id tells them
	// apart. Written first with two different opponents, where the fallback key
	// already separated them and deleting the gid changed nothing.
	const both = (mine, theirs) => [
		...season(1929, 'T', { gid: `${mine}1`, date: '1929-11-10', Opponent: theirs }),
		...season(1929, 'T', { gid: `${mine}2`, date: '1929-11-10', Opponent: theirs }),
	]
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: both('gb', 'CHI') },
		{ team: club('CHI', 'Bears'), rows: both('chi', 'GB') },
	])
	assert.equal(l.ties.length, 4, 'distinct games were collapsed')
})

test('a blowout is counted once, from the winner', () => {
	// Each club's WINS are ranked, so a game enters the list from one side only.
	// Ranking wins and losses together would list every blowout twice.
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: season(1962, 'W', { gid: 'g', scoreFor: '49', scoreAgainst: '0' }) },
		{ team: club('CHI', 'Bears'), rows: season(1962, 'L', { gid: 'g', scoreFor: '0', scoreAgainst: '49' }) },
	])
	assert.equal(l.lopsidedWins.length, 1)
	assert.equal(l.lopsidedWins[0].club, 'Packers')
})

test('blowouts rank by margin, and a bigger score is not a bigger win', () => {
	// One game cannot test a ranking, which is how a mutant deleting the margin
	// comparison survived. 56-3 is a bigger win than 62-14 and has the smaller
	// winning score, so score-first and margin-first disagree here.
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: season(1966, 'W', { gid: 'a', scoreFor: '56', scoreAgainst: '3' }) },
		{ team: club('CHI', 'Bears'), rows: season(1966, 'W', { gid: 'b', scoreFor: '62', scoreAgainst: '14' }) },
	])
	assert.deepEqual(l.lopsidedWins.map((g) => g.club), ['Packers', 'Bears'])
})

// --- league-only views ---

test('the all-time table sums every season, not the ranked ones', () => {
	// Summing bestSeasons would give a league where everyone is above .500. The
	// club here has more seasons than any top-N would keep.
	const rows = []
	for (let y = 1990; y < 2020; y++) rows.push(...season(y, y % 2 ? 'WWLL' : 'WLLL'))
	const l = computeLeague([{ team: club('GB', 'Packers'), rows }])
	const p = l.allTime[0]
	assert.equal(p.seasons, 30)
	assert.equal(p.wins + p.losses + p.ties, 120)
	assert.equal(p.wins, 45)
})

test('ties count half in the all-time table, as everywhere else', () => {
	const l = computeLeague([{ team: club('GB', 'Packers'), rows: season(1929, 'WT') }])
	assert.equal(l.allTime[0].winPct, 0.75)
	assert.equal(l.allTime[0].record, '1–0–1')
})

test('the title table counts wins, and clubs with none are absent', () => {
	const champ = (year, result) => season(year, result, {
		regular_season: '0', playoff: '1', championship: String(year), championshipTitle: 'Super Bowl',
		gid: `c${year}${result}`,
	})
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: [...champ(1966, 'W'), ...champ(1967, 'W'), ...champ(1997, 'L')] },
		{ team: club('CHI', 'Bears'), rows: champ(1985, 'W') },
		{ team: club('DET', 'Lions'), rows: season(1957, 'WWWW') },
	])
	assert.deepEqual(l.titles.map((t) => `${t.club} ${t.won}/${t.appearances}`),
		['Packers 2/3', 'Bears 1/1'])
	assert.deepEqual(l.titles[0].seasons, [1966, 1967])
})

test('a club can place more than one entry in a league list', () => {
	// Merging each club's top five and cutting to ten would be wrong if a club
	// could only contribute one. The per-club depth exists for this.
	const rows = []
	for (let y = 2000; y < 2012; y++) rows.push(...season(y, 'WWWW'))
	const l = computeLeague([{ team: club('GB', 'Packers'), rows }], { top: 10 })
	assert.equal(l.bestSeasons.length, 10, 'the league list was cut to one club\'s share')
})

test('the streak rule is the sport\'s, and reaches the league lists', () => {
	const rows = [...season(2010, 'LWWWW'), ...season(2011, 'WWWWL')]
	const clubs = [{ team: club('GB', 'Packers'), rows }]
	assert.equal(computeLeague(clubs, { streaksSpanSeasons: true }).winStreaks[0].games, 8)
	assert.equal(computeLeague(clubs, { streaksSpanSeasons: false }).winStreaks[0].games, 4)
})

test('the season range spans the league, not one club', () => {
	// The oldest club is listed SECOND on purpose. With it first, taking the
	// first club's range gives the right answer by accident, which is what let a
	// mutant doing exactly that survive.
	const l = computeLeague([
		{ team: club('HOU', 'Texans'), rows: season(2002, 'W') },
		{ team: club('GB', 'Packers'), rows: season(1921, 'W') },
	])
	assert.deepEqual(l.seasonRange, { first: 1921, last: 2002 })
})

test('every entry carries the club id, not just its name', () => {
	// The renderer looks up a club's URL by id. Keying on the display name was
	// written first and could never have worked — the league lists carry the
	// nickname "Packers" while the server's club list carries "Green Bay
	// Packers" — so every lookup missed and every entry rendered unlinked, with
	// no error and nothing failing.
	const l = computeLeague([
		{ team: club('GB', 'Packers'), rows: [...season(2011, 'WWWW'), ...season(2012, 'LLLL')] },
	])
	for (const [name, list] of Object.entries(l)) {
		if (!Array.isArray(list) || !list.length) continue
		for (const e of list) {
			assert.equal(e.teamId, 'GB', `${name} entry has no club id: ${JSON.stringify(e)}`)
			assert.equal(e.club, 'Packers')
		}
	}
})
