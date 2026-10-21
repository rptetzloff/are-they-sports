/** What the data does not cover, said once, per sport (Ray, 2026-10-20: "we
 *  should probably have a limitations page that explains any limitations to
 *  the data that exist").
 *
 *  Every line here is a gap the code already names where it meets it — the
 *  adapters' headers (sports/<sport>.js), the schedule's missing weeks
 *  (lib/schedule.js), the leaders' curated era (lib/leaders.js), the pages
 *  that leave a card out rather than show it wrong (web/<sport>/records.js).
 *  This collects them for a reader. A gap closed in the code is a line to take
 *  out here, and a new one a line to add: the two are the same fact.
 *
 *  Plain strings, no markup; the page escapes them.
 */

/** True of every sport here. */
export const COMMON = [
	'The season being played is shown from ESPN\'s public scoreboard, which can briefly differ from the league\'s own record of a game.',
	'No box scores or player statistics are loaded. Records that need them — no-hitters, cycles, earned run averages, a player\'s game — are left out rather than shown empty, and there are no player pages.',
	'Each league\'s day-by-day and week-by-week scores come from ESPN\'s scoreboard, which reaches back years rather than to each league\'s first season. "Every season, from the record" under that list has the whole history.',
];

/** Each sport's own. */
export const BY_SPORT = {
	nfl: [
		'Games from 1920 to 1998 come from FiveThirtyEight\'s game results, which have no week numbers. Those seasons\' schedules are grouped by date instead, and say so.',
		'The same results mark a playoff game as a playoff game and name no round, so a championship before 1970 comes from Wikipedia\'s list of NFL champions rather than from the games.',
		'Head coaches before 1999 come from a list of tenures by season, not by game. A coach changed in mid-season appears as two coaches in that season, and no coach before 1999 is marked as an interim: the Packers count 16 head coaches here where the club counts 15, because Hugh Devore\'s 1953 stand-in is counted as a regular.',
		'From 1999, schedules, results and coaches come from nflverse, game by game.',
	],
	mlb: [
		'Games and managers come from Retrosheet. A season being played has no managers credited until Retrosheet publishes it, so a manager\'s record stops at the last published season.',
		'Records drawn from box scores — no-hitters, perfect games, cycles, triple plays, team and pitcher earned run averages, home runs and errors in a game — are not shown, because no box scores are loaded.',
		'Ballparks are not on record: the history chart has no ballpark changes, and there is no ballparks page.',
	],
	nba: [
		'Games from 1947 to 2001 come from FiveThirtyEight\'s results, which mark a playoff game and name no round. Each season\'s Finals are found from the games after loading; the earlier rounds are not named.',
		'ABA games are not counted. The NBA\'s record books count the Pacers, Nuggets, Spurs and Nets from 1977, and so does this.',
		'From 2002 games come from sportsdataverse (ESPN\'s records). 2002 and 2003 name no playoff round either.',
		'The names of the fifteen defunct BAA and NBA clubs come from Wikipedia.',
		'No head coaches are on record yet, so there is no coaches page.',
	],
	nhl: [
		'Every game since 1917-18 comes from the NHL\'s own stats. Standings rank by points: two for a win, one for a tie, and from 1999-2000 one for a loss in overtime or a shootout.',
		'No head coaches are on record yet, so there is no coaches page.',
	],
	wnba: [
		'Games from 1997 to 2025 come from the WNBA\'s own stats; from 2026, from sportsdataverse (ESPN\'s records).',
		'No head coaches are on record yet, so there is no coaches page.',
	],
	mls: [
		'Every game since 1996 comes from MLS\'s own stats: the regular season and the Cup playoffs. Leagues Cup, MLS NEXT Pro and other competitions in the same seasons are not counted.',
		'A shootout winner is credited with the win, as MLS\'s 1996-1999 standings counted it; those wins are worth one point, not three.',
		'MLS\'s stats do not have the playoff shootouts of 2000 to 2012. The eight that decided a game or a series come from Wikipedia.',
		'No head coaches are on record yet, so there is no coaches page.',
	],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page's body for one sport: its own gaps, then the ones every sport has. */
export function limitationsHtml(sport, leagueName = sport.toUpperCase()) {
	const list = (items) => `<ul class="limitations-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
	return [
		`<h2 class="history-section-title">${esc(leagueName)}</h2>`,
		list(BY_SPORT[sport] ?? []),
		'<h2 class="history-section-title">Every sport</h2>',
		list(COMMON),
	].join('\n');
}
