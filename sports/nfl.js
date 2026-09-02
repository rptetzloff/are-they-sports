/** The NFL adapter: where the data comes from, and how it becomes rows.
 *
 *  A sport adapter has exactly two jobs. It says where to fetch raw sources
 *  from, and it turns those sources into the neutral row shape the core reads.
 *  Everything downstream — records, streaks, box scores — is sport-agnostic and
 *  never learns which league it is looking at.
 *
 *  The row shape is the one both existing sites converged on the hard way:
 *  result / scoreFor / scoreAgainst rather than anything naming a team, so the
 *  same functions serve any club without a config threaded through them.
 */

/** Upstream sources.
 *
 *  `schedules` is one league-wide file covering every season, which is why the
 *  football site has never needed more than 80KB of committed data.
 *
 *  `playByPlay` is per season and enormous — 95MB uncompressed for 2024, 372
 *  columns, 49,492 plays. It is fetched to derive scoring plays and then
 *  discarded: one season of Packers scoring plays is 4.7KB compressed, a
 *  reduction of about 20,000 to 1. Storing the source would be storing an
 *  intermediate.
 */
export const sources = {
	schedules: {
		url: 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv',
		perSeason: false,
	},
	/** Results before nflverse begins.
	 *
	 *  nflverse schedules start in 1999. FiveThirtyEight's Elo project published
	 *  game-by-game results back to 1920 for all 123 franchises that have ever
	 *  played, and that file is still live on GitHub — their own
	 *  projects.fivethirtyeight.com endpoints now 404 behind an ABC News
	 *  redirect, so this repo is the surviving copy.
	 *
	 *  Cross-checked before trusting it: this file and the archived nfl_elo.csv
	 *  are two independently published datasets, and for the Packers they agree
	 *  on all 1,064 pre-1999 games with zero differences in date, opponent or
	 *  score. They also match, exactly, the data the football site has been
	 *  serving for years.
	 */
	seedResults: {
		url: 'https://raw.githubusercontent.com/fivethirtyeight/nfl-elo-game/master/data/nfl_games.csv',
		perSeason: false,
		/** Only used below this season; nflverse is authoritative from 1999 and
		 *  is refreshed weekly, where this file stopped in 2020. */
		useBefore: 1999,
	},

	/** ESPN's public scoreboard, for the season being played.
	 *
	 *  nflverse is authoritative and refreshes weekly, so an in-season result can
	 *  be days old — the same gap baseball had, at a smaller scale. This is the
	 *  same `live` shape the baseball adapter uses.
	 *
	 *  A day at a time, because the request date is the game's LOCAL date and the
	 *  event timestamp is UTC. A Sunday night game kicks off at 20:20 Eastern and
	 *  is stamped the following Monday; read off the event it would be filed a
	 *  day late and its id would not match nflverse's.
	 */
	live: {
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${yyyymmdd}&limit=200`,
		/** Every day a season could have a game on: September through February,
		 *  which crosses the new year. */
		daysOf(season) {
			const out = [];
			const add = (year, month) => {
				const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
				for (let d = 1; d <= days; d++) {
					out.push(`${year}${String(month).padStart(2, '0')}${String(d).padStart(2, '0')}`);
				}
			};
			for (let m = 9; m <= 12; m++) add(season, m);
			for (let m = 1; m <= 2; m++) add(season + 1, m);
			return out;
		},
		/** Three days around now, for the same reason baseball needs three: the
		 *  dates are local and the clock is UTC. */
		recentDays(now) {
			const day = (offset) => {
				const d = new Date(now);
				d.setUTCDate(d.getUTCDate() + offset);
				return d.toISOString().slice(0, 10).replace(/-/g, '');
			};
			return [day(-2), day(-1), day(0)];
		},
		/** Which season a date belongs to.
		 *
		 *  An NFL season crosses the new year: the 2024 season ends with a Super
		 *  Bowl in February 2025. January and February belong to the season
		 *  named for the PREVIOUS year, which is the whole reason this is
		 *  declared per sport rather than assumed to be the calendar year.
		 */
		seasonOf: (date) => (date.getUTCMonth() < 6 ? date.getUTCFullYear() - 1 : date.getUTCFullYear()),
		source: 'espn',
	},
	playByPlay: {
		// .csv.gz rather than .csv: 18.5MB against 95MB, and the build has to
		// decompress either way.
		url: (season) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`,
		perSeason: true,
		// nflverse play-by-play begins in 1999. Before that only schedules and
		// results exist, so a team's scoring index simply starts later rather
		// than the build failing.
		firstSeason: 1999,
	},
};

/** Who this sport's data came from, said on the page.
 *
 *  Declared here rather than in the renderer because this file already says
 *  where the data comes from, and a second list elsewhere would drift from it.
 *  A deployment credits only the sports in its scope.
 *
 *  CORRECTED, and both halves were wrong. This said "nflverse asks to be cited
 *  and FiveThirtyEight's data is published under a Creative Commons licence" --
 *  written from memory, checked against nothing, and shipped in a comment
 *  explaining a footer whose job is to satisfy those licences. Reading them:
 *
 *    nflverse         CC BY 4.0. Requires attribution, a link to the licence,
 *                     and an indication that the material was modified.
 *    FiveThirtyEight  MIT, not Creative Commons at all. Requires the copyright
 *                     notice and permission notice be retained.
 *
 *  So one was the wrong family of licence and the other was vaguer than the
 *  terms it stood for. Both are named and linked now, and the modification
 *  notice CC BY asks for is rendered once for the whole footer -- everything
 *  here is reshaped, so it is true of every source rather than of one.
 */
export const credits = [
	{
		name: 'nflverse',
		url: 'https://github.com/nflverse/nflverse-data',
		note: 'schedules, results and play-by-play from 1999',
		licence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
	},
	{
		name: 'FiveThirtyEight',
		url: 'https://github.com/fivethirtyeight/nfl-elo-game',
		// Their own endpoints 404 behind an ABC News redirect, so the GitHub
		// copy is the surviving one. Credited by the name it was published
		// under; the copyright notice names who holds it now.
		note: 'game results from 1920 to 1998',
		licence: { name: 'MIT', url: 'https://github.com/fivethirtyeight/nfl-elo-game/blob/master/LICENSE' },
		copyright: 'Copyright (c) 2021 ABC News Internet Ventures.',
	},
	{
		name: 'ESPN',
		url: 'https://www.espn.com',
		note: 'scores for the season being played',
	},
];

/** Turn one league-wide schedules row into a neutral game row, from the point
 *  of view of `teamId`, or null if the team was not playing.
 *
 *  nflverse `games.csv` carries both clubs per row, so the same file serves all
 *  32 teams and the perspective is applied here rather than in the data.
 */
export function gameRow(r, teamId) {
	const home = r.home_team, away = r.away_team;
	if (home !== teamId && away !== teamId) return null;

	const isHome = home === teamId;
	const scoreFor = isHome ? r.home_score : r.away_score;
	const scoreAgainst = isHome ? r.away_score : r.home_score;

	// An unplayed game has empty scores. It is kept, with an empty result, so
	// the schedule can show fixtures — every compute function already filters on
	// result rather than assuming rows are complete.
	const played = scoreFor !== '' && scoreAgainst !== '';
	const f = parseInt(scoreFor, 10), a = parseInt(scoreAgainst, 10);

	return {
		date: r.gameday,
		season: r.season,
		// nflverse game_type: REG, plus WC/DIV/CON/SB for the postseason.
		regular_season: r.game_type === 'REG' ? '1' : '0',
		playoff: r.game_type === 'REG' ? '0' : '1',
		// The championship field holds the round's own name when it is the
		// final, and empty otherwise. seasonTally reads it as "more
		// championship-round wins than losses", which for a one-game final is
		// simply whether it was won.
		championship: r.game_type === 'SB' ? String(r.season) : '',
		Opponent: isHome ? away : home,
		result: !played ? '' : f > a ? 'WIN' : f < a ? 'LOSS' : 'TIE',
		scoreFor,
		scoreAgainst,
		location: isHome ? 'home' : 'away',
		gid: r.game_id,
		// The real week, never derived. Deriving it from dates was measured
		// against these very rows and is wrong for 17.7% of games (322 of 1,816
		// across four clubs), because a postponement shifts every week after it:
		// 2001 lost week 2 to 9/11 and replayed it at the end of the season, so
		// a 7-day bucket is off by one from that point on.
		week: r.week ? Number(r.week) : null,
	};
}

/** Both coaches of one nflverse schedules row, in the neutral leader shape.
 *
 *  `home_coach` and `away_coach` are columns 42 and 43 of the file
 *  scripts/fetch.mjs has been pulling all along, populated on 7,548 of 7,548
 *  rows with no blanks — so football's modern era needed no curation and no new
 *  source, only for someone to read the header.
 *
 *  THE NAME IS NOT THE IDENTITY. nflverse writes `Jim Mora` for Indianapolis in
 *  1999 and for Atlanta in 2004, and those are a father and a son. Keyed on the
 *  string, the leaders page serves one coach with three clubs and an eleven-year
 *  career, and nothing errors. So this emits the name and the resolver in
 *  lib/leaders.js turns (name, franchise, season) into an id using
 *  data/reference/nfl-coaches.csv — which is the file that does for football
 *  what Retrosheet's manager ids do for baseball for free.
 *
 *  The row is emitted for scheduled games too. nflverse names the 2026 Giants'
 *  head coach on sixteen games nobody has played, which is how a club page can
 *  say who is in charge now; the record counts final games only, and that filter
 *  belongs where the counting happens rather than here.
 */
export function leaderRows(r) {
	const out = [];
	for (const [code, name] of [[r.away_team, r.away_coach], [r.home_team, r.home_coach]]) {
		const leaderName = name?.trim();
		if (!leaderName) continue;
		out.push({ gameId: r.game_id, code, leaderName, season: Number(r.season) });
	}
	return out;
}

/** A FiveThirtyEight row, from `teamId`'s point of view, or null.
 *
 *  A different shape from nflverse: team1 is the home side, `playoff` carries
 *  the round rather than a game type, and there is no game id — so one is
 *  synthesised from the date and the two clubs, which is unique because a pair
 *  cannot meet twice on one day.
 */
export function seedGameRow(r, teamId) {
	const home = r.team1, away = r.team2;
	if (home !== teamId && away !== teamId) return null;
	// Both scores, not just one. The earlier guard read `!r.score1 && r.score1
	// !== '0'`, which looks careful and does two wrong things: the second clause
	// is unreachable, because '0' is a truthy string, and the first never looked
	// at score2 at all. A row with score1 and no score2 therefore produced
	// scoreAgainst NaN, and since every comparison against NaN is false the
	// result ternary fell through to its last branch — a 34-to-nothing game came
	// out as a TIE. Found by a mutation run: replacing the guard with plain
	// `!r.score1` changed nothing, which is what an unreachable clause looks
	// like from the outside.
	if (r.score1 === '' || r.score2 === '' || r.score1 == null || r.score2 == null) return null;

	const isHome = home === teamId;
	const scoreFor = isHome ? r.score1 : r.score2;
	const scoreAgainst = isHome ? r.score2 : r.score1;
	const f = parseInt(scoreFor, 10), a = parseInt(scoreAgainst, 10);
	// `playoff` is "0" or "1" in this file. It is NOT empty-or-a-round-code,
	// which is what this line assumed for months: Boolean('0') is true, so every
	// pre-1999 game was marked a playoff game — all 1,064 of the Packers'.
	// `playoff === '1'` gives 32, which is what the live site's data says.
	const isPlayoff = r.playoff === '1';

	return {
		date: r.date,
		season: r.season,
		regular_season: isPlayoff ? '0' : '1',
		playoff: isPlayoff ? '1' : '0',
		// Never set from this source. The file has a 0/1 playoff flag and no round
		// detail at all, so 's' — which this line looked for — appears nowhere in
		// it. Marking a championship needs either era-correct naming for the
		// pre-Super-Bowl titles or a curated table; see scripts/load.mjs.
		championship: '',
		Opponent: isHome ? away : home,
		result: f > a ? 'WIN' : f < a ? 'LOSS' : 'TIE',
		scoreFor,
		scoreAgainst,
		// `neutral` is a flag here rather than a venue, so a neutral-site game
		// is neither home nor away and says so.
		location: r.neutral === '1' ? 'neutral' : isHome ? 'home' : 'away',
		gid: `${r.date}-${home}-${away}`,
		// Null, not zero and not a guess. This source has no week column, so
		// every pre-1999 season genuinely has no week numbers and the schedule
		// page says so rather than inventing them.
		week: null,
	};
}

/** Which round a FiveThirtyEight row belongs to.
 *
 *  Exported because scripts/load.mjs had its own copy of this decision, which is
 *  how the same wrong reading of the `playoff` column ended up in two places —
 *  and only one of them had a test.
 *
 *  The column holds "0" or "1" and nothing else: 16,220 and 590 rows. It is not
 *  empty-or-a-round-code, so there is no championship to read here at all.
 */
export function seedRound(r) {
	return r.playoff === '1' ? 'playoff' : 'regular';
}

/** Whether a play-by-play row is one the site would ever display.
 *
 *  nflverse marks scoring plays with sp=1. That single column is what takes
 *  49,492 league plays down to 238 for one team in one season.
 */
export function isScoringPlay(r) {
	return r.sp === '1';
}

/** The fields a scoring play keeps. Everything else of the 372 columns is
 *  dropped here, which is where the reduction actually happens — compression
 *  only pays back the JSON verbosity afterwards. */
export function scoringRow(r) {
	return {
		gid: r.game_id,
		period: r.qtr,
		clock: r.time,
		desc: r.desc,
		scoreHome: r.total_home_score,
		scoreAway: r.total_away_score,
		team: r.posteam,
	};
}

/** What every club in this league says, so a club manifest does not repeat it.
 *
 *  These are facts about football, not about any club: every NFL team scores
 *  points, plays for the Super Bowl, is led by a coach, and has streaks that
 *  span seasons. A club overrides any of them when it genuinely differs.
 */
export const defaults = {
	nouns: {
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'Super Bowl',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		/** In football, *perfect* means no losses and no ties — 1972 Miami and
		 *  nobody else. 1929 Green Bay went 12-0-1: undefeated, not perfect.
		 *  A club that wants "perfect" overrides this; the Dolphins are the one
		 *  club for which it would be right. */
		losslessSeasonNoun: 'undefeated',
	},
	/** Which record cards this sport publishes, and in what order.
	 *
	 *  The catalogue of what CAN be drawn is in lib/render.js; this is the
	 *  selection, which is the same split the football site makes between its
	 *  CARDS list and `SITE.records`. A sport omits a slug rather than the
	 *  renderer knowing which sports have lossless seasons.
	 *
	 *  Twelve, matching arethepackersundefeated.com exactly. */
	records: [
		'best-seasons', 'worst-seasons', 'best-starts', 'worst-starts',
		'lossless-seasons', 'win-streaks', 'losing-streaks',
		'lopsided-wins', 'worst-losses', 'playoff-appearances',
		'championship-appearances', 'ties',
	],

	rules: {
		/** Streaks run across season boundaries here. The longest Green Bay
		 *  streak, 15 games, ran from December 2010 into December 2011, and
		 *  ending it at the boundary would erase the record the list exists to
		 *  show. Baseball does the opposite, on purpose. */
		streaksSpanSeasons: true,
		/** How long a stint can be and still be somebody covering an absence.
		 *
		 *  Five games, and it is inert: nflverse names the head coach of record
		 *  for every game and never the assistant who stood in for one. Measured
		 *  rather than assumed — of 246 runs of consecutive games under one
		 *  coach, none is bracketed by a coach who managed more of that season.
		 *
		 *  Five because it is baseball's 45 as a share of a season, 28%, and not
		 *  because anything here was tuned: there is nothing to tune against. A
		 *  number carried over from baseball unscaled would be most of a football
		 *  season and would be waiting to swallow a real interim the day a source
		 *  starts recording stand-ins.
		 *
		 *  Declared even though it folds nothing, because the rule belongs to the
		 *  sport and a constant that exists for one league only is how these
		 *  repos became two codebases. */
		fillInMaxGames: 5,
		/** A season with no losses is a plausible thing to look for in a
		 *  17-game sport. */
		losslessSeasonIsPlausible: true,
		/** How far either side of today "on this day" looks. Three days, because
		 *  a sport playing seventeen games a year has empty calendar dates by
		 *  the hundred and an exact match would hide the panel most days. */
		onThisDayWindowDays: 3,
		/** How a whole-league schedule is grouped. Football plays one round a
		 *  week and everyone means "week 4" when they say it; baseball plays
		 *  most days and a week is not a unit anyone uses.
		 *
		 *  Declared rather than branched on, because "if sport is football" in a
		 *  renderer is exactly the seam this repo keeps moving out of code. A
		 *  sport whose source has no week still declares `week` — the schedule
		 *  falls back to dates per season and says the weeks are unknown, which
		 *  is what pre-1999 football does.
		 */
		schedulePeriod: 'week',
	},
};

export const sport = {
	id: 'nfl',
	name: 'football',
	sources,
	credits,
	defaults,
	gameRow,
	seedGameRow,
	liveGameRow,
	liveWeek,
	numberEvents,
	isScoringPlay,
	scoringRow,
	seedRound,
	leaderRows,
	/** The column identifying a game across sources, so the builder can key an
	 *  index without knowing the sport. */
	gameKey: 'game_id',
};

export default sport;

/** nflverse's week number for an ESPN event, or null if it is not a game.
 *
 *  The regular season lines up: ESPN's week 1 is nflverse's week 1. The
 *  postseason does not. ESPN restarts at 1 for the wild card round, and
 *  nflverse continues from 18 — but skips the Pro Bowl, which ESPN counts.
 *
 *      ESPN type 3 week 1  wild card      nflverse 19
 *      ESPN type 3 week 2  divisional     nflverse 20
 *      ESPN type 3 week 3  conference     nflverse 21
 *      ESPN type 3 week 4  Pro Bowl       not a game
 *      ESPN type 3 week 5  Super Bowl     nflverse 22
 *
 *  Verified against both: the 2024 Super Bowl is `2024_22_KC_PHI` and ESPN has
 *  it as type 3 week 5, and the divisional round is nflverse 20 and ESPN week 2.
 */
export function liveWeek(event) {
	const type = event?.season?.type ?? 2;
	const week = event?.week?.number;
	if (!Number.isFinite(week)) return null;
	if (type < 2) return null;            // preseason is not the season
	if (type === 2) return week;
	if (week <= 3) return 18 + week;      // wild card, divisional, conference
	if (week === 4) return null;          // the Pro Bowl is not two clubs anyway
	return 22;                            // the final
}

/** One ESPN scoreboard event as a game row, or null.
 *
 *  The id is nflverse's — `2024_22_KC_PHI`, season, week, away, home — because
 *  games are keyed on (sport, id) and an ESPN id would make the same game a
 *  second row the moment nflverse published the week. That needs each club's
 *  NFLVERSE code rather than its franchise code: the Rams are LAR here and LA
 *  there, Washington is WSH here and WAS there.
 */
export function liveGameRow(event, { franchiseOf, knows, codeIn, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;

	const week = liveWeek(event);
	if (week == null) return null;

	// Postponed games are not fixtures on this date; they are replayed, and the
	// authoritative source has no record of them on the original day.
	if (comp.status?.type?.name === 'STATUS_POSTPONED') return null;

	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!home?.team?.abbreviation || !away?.team?.abbreviation) return null;
	// Both sides must be clubs. The Pro Bowl arrives as AFC against NFC.
	if (knows && (!knows(home.team.abbreviation) || !knows(away.team.abbreviation))) return null;

	const date = queryDate
		? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}`
		: String(event.date).slice(0, 10);
	const played = comp.status?.type?.completed === true;
	const nfl = (abbr) => codeIn(abbr, 'nflverse');

	return {
		id: `${event.season.year}_${String(week).padStart(2, '0')}_${nfl(away.team.abbreviation)}_${nfl(home.team.abbreviation)}`,
		season: Number(event.season.year),
		date,
		// Never `championship` from here. Which game was the final is decided by
		// the load's championship pass, which knows the leagues and their eras;
		// a live feed guessing it would promote a conference title the way the
		// first version of that pass did.
		round: (event.season?.type ?? 2) > 2 ? 'playoff' : 'regular',
		home: franchiseOf(home.team.abbreviation),
		away: franchiseOf(away.team.abbreviation),
		homeScore: played ? Number(home.score) : null,
		awayScore: played ? Number(away.score) : null,
		neutral: Boolean(comp.neutralSite),
		status: played ? 'final' : 'scheduled',
		source: 'espn',
		week,
	};
}

/** Football has no doubleheaders, so every game is its own.
 *
 *  Present because the live refresh calls it for every sport. The number it
 *  yields is unused here — an nflverse id carries no game number — and saying so
 *  is better than the refresh needing to know which sports have one.
 */
export function numberEvents(events) {
	return (events ?? []).filter((e) => e?.competitions?.[0]).map((event) => ({ event, number: 0 }));
}
