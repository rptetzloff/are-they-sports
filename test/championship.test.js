import test from 'node:test'
import assert from 'node:assert/strict'
import { computeRecords } from '../lib/records.js'
import { computeLeague } from '../lib/league.js'
import { historyPoints } from '../lib/history.js'
import { finalCell, pluralTitle, titleHeading, titleNoun, recordCopy } from '../lib/render.js'
import { loadTeam } from '../lib/teams.js'

const packers = await loadTeam('packers')
const brewers = await loadTeam('brewers')

const RESULTS = { W: 'WIN', L: 'LOSS', T: 'TIE' }

/** Regular-season games. */
const season = (year, pattern) => pattern.split('').map((c, i) => ({
	result: RESULTS[c], date: `${year}-09-${String(i + 1).padStart(2, '0')}`,
	season: String(year), regular_season: '1', playoff: '0', championship: '',
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10', location: 'home',
}))

/** One final, won or lost, with the name the era actually used. */
const final = (year, result, title) => [{
	result: RESULTS[result], date: `${year}-12-31`, season: String(year),
	regular_season: '0', playoff: '1', championship: 'title',
	championshipTitle: title,
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10', location: 'home',
}]

// ---------------------------------------------------------------------------
// What the final WAS
// ---------------------------------------------------------------------------

test('a season carries its final, named as the era named it', () => {
	// The club noun is what it plays for NOW. Printing it over every title
	// season put "Super Bowl" on Green Bay's 1936, thirty years early.
	const r = computeRecords([
		...season(1936, 'WWW'), ...final(1936, 'W', 'NFL Championship'),
		...season(2010, 'WWW'), ...final(2010, 'W', 'Super Bowl'),
	])
	const by = new Map(r.everySeason.map((s) => [s.season, s.final]))
	assert.equal(by.get(1936).title, 'NFL Championship')
	assert.equal(by.get(2010).title, 'Super Bowl')
})

test('a season that reached the final and lost says so, rather than saying nothing', () => {
	// 1997 and a season the club missed the playoffs got the same blank cell.
	const r = computeRecords([...season(1997, 'WWW'), ...final(1997, 'L', 'Super Bowl')])
	const [s] = r.everySeason
	assert.equal(s.final.won, false)
	assert.equal(s.final.title, 'Super Bowl')
	// And it is NOT a title. The boolean the chart plots must not move.
	assert.equal(s.champion, false)
})

test('a season with no final has none, rather than an empty one', () => {
	assert.equal(computeRecords(season(1958, 'LLL')).everySeason[0].final, null)
})

test('the most significant name leads where a season had two finals', () => {
	// 1966: the Packers won the NFL Championship AND Super Bowl I, and both
	// games are in the data.
	const r = computeRecords([
		...season(1966, 'WWW'),
		...final(1966, 'W', 'NFL Championship'), ...final(1966, 'W', 'Super Bowl'),
	])
	assert.equal(r.everySeason[0].final.title, 'Super Bowl')
	assert.equal(r.everySeason[0].final.won, true)
})

test('a title is more championship-round wins than losses, not the last game', () => {
	// The series rule, which is right for a best-of-seven and for a one-game
	// final. "Did the last game go their way" is the same answer in football and
	// the wrong one in baseball.
	const wsWon = computeRecords([
		...season(1982, 'WWW'),
		...final(1982, 'W', 'World Series'), ...final(1982, 'W', 'World Series'),
		...final(1982, 'W', 'World Series'), ...final(1982, 'W', 'World Series'),
		...final(1982, 'L', 'World Series'), ...final(1982, 'L', 'World Series'),
		...final(1982, 'L', 'World Series'),
	])
	assert.equal(wsWon.everySeason[0].final.won, true)
})

test('a season is judged per ROUND, so a league title survives losing the Super Bowl', () => {
	// Eight clubs played two finals in a season between 1966 and 1969, and four
	// of them won their league championship and then lost the Super Bowl —
	// Kansas City 1966, Oakland 1967, Baltimore 1968, Minnesota 1969.
	//
	// Adding the season's championship games together makes those 1-1, which
	// counts as neither a title nor a final lost, and every one of those league
	// championships was missing from this repo: the Chiefs showed five against a
	// published six.
	//
	// The first draft of this test asserted the opposite — that the season was
	// not a title at all — because it was written to describe what the code did
	// rather than what is true. It is kept as the counter-example it turned into.
	const r = computeRecords([
		...season(1966, 'WWW'),
		...final(1966, 'W', 'AFL Championship'), ...final(1966, 'L', 'Super Bowl'),
	])
	const [s] = r.everySeason
	assert.equal(s.final.won, true)
	assert.equal(s.final.title, 'AFL Championship', 'the season is named by what it WON')
	assert.deepEqual(s.final.titles, ['Super Bowl', 'AFL Championship'], 'both rounds are on record')
	assert.equal(s.champion, true)
})

test('a series lost after winning games in it is not a title', () => {
	// The Brewers won three games of the 1982 World Series and lost it 4-3. The
	// chart marked 1982 as a title, with a tooltip reading "1982 — champions",
	// because the old rule was "won a championship-round GAME".
	const r = computeRecords([
		...season(1982, 'WWW'),
		...final(1982, 'W', null), ...final(1982, 'W', null), ...final(1982, 'W', null),
		...final(1982, 'L', null), ...final(1982, 'L', null), ...final(1982, 'L', null),
		...final(1982, 'L', null),
	])
	const [s] = r.everySeason
	assert.equal(s.final.won, false)
	assert.equal(s.champion, false)
})

test('a title decided on the standings says how it was decided', () => {
	// There was no game and nobody to beat, and printing it identically to a
	// final would claim the 1929 Packers beat somebody for it.
	const r = computeRecords(season(1929, 'WWW'), {
		titles: [{ season: 1929, title: 'NFL Championship', method: 'standings' }],
	})
	const [s] = r.everySeason
	assert.equal(s.final.method, 'standings')
	assert.equal(s.final.won, true)
	assert.equal(s.final.title, 'NFL Championship')
	assert.equal(s.champion, true)
})

/** A postseason game that is not the final. */
const playoff = (year, result) => [{
	result: RESULTS[result], date: `${year}-12-20`, season: String(year),
	regular_season: '0', playoff: '1', championship: '',
	Opponent: 'CHI', scoreFor: '20', scoreAgainst: '10', location: 'home',
}]

test('a title is the FINAL, not a winning postseason record', () => {
	// Every Super Bowl loser wins two or three playoff games to get there, so
	// judging the title on the postseason record calls all of them champions.
	// The Packers went 3-1 in the 1997 postseason and lost Super Bowl XXXII.
	const r = computeRecords([
		...season(1997, 'WWW'),
		...playoff(1997, 'W'), ...playoff(1997, 'W'), ...final(1997, 'L', 'Super Bowl'),
	])
	const [a] = r.playoffAppearances
	assert.equal(a.record, '2–1', 'the postseason record is winning')
	assert.equal(a.won, false, 'and the season is still not a title')
	assert.equal(a.championship, true, 'they did reach the final')
	assert.deepEqual(r.championshipAppearances.map((x) => [x.season, x.won]), [[1997, false]])
})

// ---------------------------------------------------------------------------
// The history table cell
// ---------------------------------------------------------------------------

const cellFor = (games, opts) => {
	const [p] = historyPoints(computeRecords(games, opts).everySeason)
	return finalCell(p, packers)
}

test('the history cell names the era, not the club today', () => {
	assert.match(cellFor([...season(1936, 'WWW'), ...final(1936, 'W', 'NFL Championship')]),
		/NFL Championship/)
	assert.ok(!cellFor([...season(1936, 'WWW'), ...final(1936, 'W', 'NFL Championship')]).includes('Super Bowl'))
})

test('the history cell distinguishes winning the final from losing it', () => {
	const won = cellFor([...season(2010, 'WWW'), ...final(2010, 'W', 'Super Bowl')])
	const lost = cellFor([...season(1997, 'WWW'), ...final(1997, 'L', 'Super Bowl')])
	assert.match(won, /final-won/)
	assert.match(lost, /final-lost/)
	assert.match(lost, /lost Super Bowl/)
	assert.notEqual(won, lost)
})

test('a standings title reads "took", not "won"', () => {
	assert.match(cellFor(season(1929, 'WWW'), {
		titles: [{ season: 1929, title: 'NFL Championship', method: 'standings' }],
	}), /took NFL Championship/)
})

test('where the data has no name for the round, the sport supplies one', () => {
	// All 707 baseball championship rows carry a null title: Retrosheet says a
	// game was in the World Series without naming it. The manifest noun is right
	// there and is not an era problem, because baseball has played for one thing.
	const [p] = historyPoints(computeRecords([
		...season(1982, 'WWW'), ...final(1982, 'L', null),
	]).everySeason)
	assert.match(finalCell(p, brewers), /lost World Series/)
})

test('a season with no final and no unbeaten record has an empty cell', () => {
	assert.equal(cellFor(season(1958, 'LLL')), '')
})

test('an unbeaten season still says so where there was no final', () => {
	assert.match(cellFor(season(1929, 'WWW')), /undefeated/)
})

// ---------------------------------------------------------------------------
// The record card's note
// ---------------------------------------------------------------------------

test('the card note does not name a round most of its rows are not', () => {
	// The heading already said "Championship games" for a club whose list spans
	// eras, while the note underneath said "reached the Super Bowl".
	const mixed = [{ title: 'Super Bowl' }, { title: 'NFL Championship' }]
	assert.equal(titleHeading(mixed, packers), 'Championship games')
	assert.equal(titleNoun(mixed, packers), 'the final')
	assert.match(recordCopy(packers, mixed)['championship-appearances'].note, /reached the final/)
})

test('a club that has only ever played for one thing is named', () => {
	assert.equal(titleNoun([{ title: 'Super Bowl' }], packers), 'the Super Bowl')
	// No titles at all falls back to the manifest, which is the only word there
	// is when the data has none.
	assert.equal(titleNoun([], brewers), 'the World Series')
})

// ---------------------------------------------------------------------------
// Plurals
// ---------------------------------------------------------------------------

test('a name already ending in s is its own plural', () => {
	// "World Seriess" shipped the moment baseball titles started carrying their
	// name — the same shape as the "2 clashs" this repo already records.
	assert.equal(pluralTitle('World Series', 27), 'World Series')
	assert.equal(pluralTitle('Super Bowl', 4), 'Super Bowls')
	assert.equal(pluralTitle('NFL Championship', 9), 'NFL Championships')
	assert.equal(pluralTitle('Super Bowl', 1), 'Super Bowl')
})

// ---------------------------------------------------------------------------
// The league-wide card
// ---------------------------------------------------------------------------

const club = (id, sourceIds) => ({ ...packers, id, sourceIds })

test('the league card counts titles the games cannot show', () => {
	// The fourth consumer of the championship table, and the one nobody
	// enumerated: /champions, a club's /records, its /history and the leaders
	// page were all wired to it and this was not. It read "Packers 10" against
	// thirteen and "Bears 7" against nine.
	const clubs = [{
		team: club('packers', ['GB']), franchise: 'GB',
		rows: [...season(1929, 'WWW'), ...season(2010, 'WWW'), ...final(2010, 'W', 'Super Bowl')],
	}]
	assert.equal(computeLeague(clubs).titles[0].won, 1)
	const withTable = computeLeague(clubs, {
		championships: new Map([['GB', [{ season: 1929, title: 'NFL Championship', method: 'standings' }]]]),
	})
	assert.equal(withTable.titles[0].won, 2)
	assert.deepEqual(withTable.titles[0].wins.map((w) => w.title),
		['Super Bowl', 'NFL Championship'])
})

test('the championship table is keyed by franchise, never by club id', () => {
	// A club id is not unique across sports, and the table records a winner as a
	// franchise. Keyed on the id, a football club would collect a baseball
	// club's titles.
	const clubs = [{
		team: club('packers', ['GB']), franchise: 'GB',
		rows: season(1929, 'WWW'),
	}]
	const wrongKey = computeLeague(clubs, {
		championships: new Map([['packers', [{ season: 1929, title: 'NFL Championship' }]]]),
	})
	assert.deepEqual(wrongKey.titles, [], 'a title arrived under the club id')
})

test('passing no championship table leaves the card exactly as it was', () => {
	// Every test written before this relies on it, and so does any caller that
	// has not been updated.
	const clubs = [{
		team: club('packers', ['GB']), franchise: 'GB',
		rows: [...season(2010, 'WWW'), ...final(2010, 'W', 'Super Bowl')],
	}]
	assert.deepEqual(computeLeague(clubs).titles, computeLeague(clubs, { championships: new Map() }).titles)
})

test('the league card names a title the sport has no word for in the data', () => {
	// Baseball's rows carry a null title, so this card grouped 27 Yankees
	// championships under the literal "Championships".
	const clubs = [{
		team: { ...brewers, id: 'brewers', sourceIds: ['MIL'] }, franchise: 'MIL',
		rows: [...season(1982, 'WWW'), ...final(1982, 'W', null)],
	}]
	assert.deepEqual(computeLeague(clubs).titles[0].wins.map((w) => w.title), ['World Series'])
})
