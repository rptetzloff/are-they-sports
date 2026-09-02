/** What this club did on today's date, in other years.
 *
 *  A front-page panel both live sites carry. It needs nothing but games, which
 *  is why it is the cheap item on the parity list: no new source, no migration,
 *  no fetch.
 *
 *  THE WINDOW IS A SPORT RULE, already declared. `rules.onThisDayWindowDays` is
 *  0 for baseball and 3 for football, and the difference is not a preference. A
 *  club playing 162 games has a game on almost every calendar date, so an exact
 *  match is a full panel; a club playing 17 has empty dates by the hundred, and
 *  an exact match shows nothing for most of the year. The number was chosen when
 *  the rule was declared and this is the first thing to read it.
 *
 *  DATES ARE COMPARED AS STRINGS, IN UTC, and that is deliberate rather than
 *  lazy. A game's date is a plain `YYYY-MM-DD` with no time; parsing it into a
 *  Date makes it midnight UTC, and formatting THAT anywhere west of Greenwich
 *  moves every game a day earlier. lib/render.js carries the same warning about
 *  the same trap, learned on the same data.
 */

/** Month and day from an ISO date, without constructing a Date. */
const monthDay = (iso) => String(iso).slice(5, 10);

/** Every `MM-DD` within `windowDays` either side of one, across a year boundary.
 *
 *  Built from a UTC Date and read back as a string, so the arithmetic happens in
 *  a calendar rather than in a timezone. February 29 is included when the
 *  reference year has one and simply never matches in other years, which is the
 *  right answer for a panel about anniversaries.
 */
export function windowAround(today, windowDays = 0) {
	const base = new Date(`${today}T00:00:00Z`);
	if (Number.isNaN(base.getTime())) return [];
	const out = [];
	for (let d = -windowDays; d <= windowDays; d++) {
		const at = new Date(base);
		at.setUTCDate(at.getUTCDate() + d);
		out.push(at.toISOString().slice(5, 10));
	}
	return [...new Set(out)];
}

/** Games this club played on today's date in earlier years, newest first.
 *
 *  `today` is an ISO date the caller supplies rather than a clock this function
 *  reads. A function that calls `new Date()` cannot be tested on December 31
 *  without waiting for December 31, and every date bug in this repo has been
 *  about a boundary.
 *
 *  The CURRENT season is excluded. "On this day" is about other years, and a
 *  game played an hour ago is already the answer to the question at the top of
 *  the page — repeating it under a heading about history reads as a mistake.
 */
export function onThisDay(rows, { today, windowDays = 0, currentSeason = null } = {}) {
	if (!today) return [];
	const wanted = new Set(windowAround(today, windowDays));
	if (!wanted.size) return [];

	return rows
		.filter((g) => g.date && g.result && wanted.has(monthDay(g.date)))
		.filter((g) => currentSeason == null || String(g.season) !== String(currentSeason))
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** One line's worth of what happened, for a caller that renders it.
 *
 *  Kept out of the renderer because it is a decision about meaning rather than
 *  markup: which of two clubs the score belongs to, and whether the date shown
 *  is the anniversary or an approximation of it.
 */
export const anniversaryOf = (game, today) => (monthDay(game.date) === monthDay(today) ? 'exact' : 'near');

/** The years a panel covers, for a heading that says what it is showing.
 *
 *  A panel headed "On this day" over three games from 1968, 1994 and 2011 is
 *  less useful than one that says so, and a panel with nothing in it should say
 *  that rather than disappear — an absent panel and a panel with no matches look
 *  identical, and only one of them means "this club has never played today".
 */
export function summarise(games) {
	// No early return for an empty list. One was written -- and deleted, because
	// a mutation run removed it and changed no test result: the guard below on
	// `seasons.length` already yields null for the year range, and every count
	// is a length that is already zero. Two pieces of unreachable defence read
	// as if they were protecting something, which is why this repo has now
	// deleted three of them.
	//
	// The thing actually worth guarding is `Math.min` of an empty list, which is
	// Infinity, and would render a heading reading "Infinity--Infinity".
	const seasons = games.map((g) => Number(g.season)).filter(Number.isFinite);
	return {
		count: games.length,
		first: seasons.length ? Math.min(...seasons) : null,
		last: seasons.length ? Math.max(...seasons) : null,
		wins: games.filter((g) => g.result === 'WIN').length,
		losses: games.filter((g) => g.result === 'LOSS').length,
		ties: games.filter((g) => g.result === 'TIE').length,
	};
}
