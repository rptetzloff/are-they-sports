/** The MLB adapter, over Retrosheet.
 *
 *  The second sport, which is the one that tests whether the seam is real. An
 *  adapter abstraction validated by a single implementation is not validated at
 *  all — it has simply been shaped around the one case it was written for.
 *
 *  Where this differs from the NFL adapter is instructive, because the shape
 *  held and only the details moved:
 *
 *    two source ids     the Brewers were the Seattle Pilots for 1969, so a club
 *                       is a list of codes rather than one. The NFL adapter has
 *                       the same list; it just happens to have one entry.
 *    date format        Retrosheet writes 19821012, not 1982-10-12.
 *    round vocabulary   gametype is a word — regular, divisionseries, lcs,
 *                       worldseries, wildcard, playoff — not a two-letter code.
 *    no seed source     Retrosheet covers the franchise's whole existence, so
 *                       there is no pre-coverage era to fill. The builder
 *                       already treats seedResults as optional.
 *
 *  What did NOT differ, despite a first draft claiming it did: detecting a
 *  scoring play. Both sports answer it from one column of one row.
 *
 *  What did not move: the row shape. result / scoreFor / scoreAgainst, a
 *  championship field the tally reads as "more championship-round wins than
 *  losses", and no mention anywhere of which club is being served.
 */

/** Upstream sources.
 *
 *  Retrosheet publishes per-season event files that have to be assembled;
 *  fetching and assembling them is not yet implemented, so `dir` points at an
 *  already-assembled copy. That is a real gap and is named rather than hidden:
 *  until there is a fetcher, an MLB build needs a directory someone else built.
 *
 *  The play-by-play file is 388MB and reduces to 0.84MB of scoring plays, which
 *  is the same story as football at a different scale — and the reason none of
 *  it is committed.
 */
export const sources = {
	schedules: {
		// Retrosheet's gameinfo is one row per game with both clubs, so like
		// nflverse schedules it serves every team from one file.
		//
		// 226,221 rows covering 1897-2025 and 178 side codes. There is no
		// fetcher: Retrosheet publishes downloads rather than a stable release
		// URL, so this file is supplied rather than pulled, and a container has
		// no way to obtain it. That is why `npm run load mlb` runs where the file
		// is and points DATABASE_URL at the server, rather than running IN the
		// server the way football does.
		//
		// 2,566 of those rows are all-star and exhibition games and are skipped
		// at load: they are not one club playing another, and the all-star rows
		// name sides that are not clubs — NLS and ALS for the two league squads,
		// ASE and ASW for East and West. 223,655 games remain.
		//
		// The coverage is wider than the thirty current clubs: 117 franchises
		// end up in the database, 87 of which the franchise history does not
		// name, across 8,517 games. Nineteenth-century clubs, the Federal
		// League, and the Negro Leagues — which MLB recognised as major leagues
		// in 2020 and Retrosheet includes as regular-season games. None of them
		// appear in any scope, because scopes come from the divisions table.
		file: 'gameinfo.csv',
		perSeason: false,
		/** Where to fetch it from, named rather than written here.
		 *
		 *  There is no public URL to hardcode: Retrosheet publishes downloads
		 *  rather than releases, so this file is hosted by whoever runs the
		 *  deployment. Naming the variable instead of the URL keeps a private
		 *  host out of a public repository, and means a container can load
		 *  baseball unaided the way it already loads football.
		 *
		 *  Serve the eight columns this reads — gid, season, date, gametype,
		 *  hometeam, visteam, hruns, vruns — gzipped. That is 1.6MB against the
		 *  full file's 43MB, and the other thirty-five columns are umpires,
		 *  weather and attendance that nothing here looks at.
		 */
		env: 'MLB_SCHEDULES_URL',
	},
	/** Retrosheet's game logs, which are where the managers are.
	 *
	 *  `gameinfo.csv` has 43 columns and not one of them names a manager, so the
	 *  leaders page looked like it needed the curated tier — CLAUDE.md says as
	 *  much, that it "needs a curated coaches/managers table nobody publishes".
	 *  For baseball that is simply false, and had been for as long as the page
	 *  404'd: the game logs carry a manager ID and name for BOTH sides of every
	 *  game, at fields 78-81, back to 1871.
	 *
	 *  One file per season — `gl1871.txt` through `gl2025.txt` — plus `glws.txt`,
	 *  `gllc.txt` and `glwc.txt` for the World Series, league championships and
	 *  wild cards, which is why the glob is `gl*.txt` and not a year range. Drop
	 *  the three postseason files and every October game loses its manager.
	 *
	 *  Headerless and positional, and the fields are mixed quoted and bare
	 *  — `"18710504","0","Thu","CL1","NA",1,"FW1"` — so a split on `","` returns
	 *  one field, finds nothing, and reports a confident zero. That is exactly
	 *  what the first probe of this data did.
	 *
	 *  Measured against the loaded database: 217,906 of 225,713 final games get
	 *  a manager, 96.5%. The rest is 2026, which Retrosheet has not published
	 *  yet, and the Negro Leagues, which it publishes as .EBR event files under
	 *  `alldata/ngl_b` rather than as game logs. Neither is a parsing bug and
	 *  neither is closed by a wider glob.
	 */
	gameLogs: {
		glob: 'gl*.txt',
		perSeason: false,
		/** Supplied, not fetched, for the same reason `schedules` is: Retrosheet
		 *  publishes downloads rather than stable release URLs. A deployment
		 *  that cannot supply these gets no leaders page and says so, rather
		 *  than getting an empty one. */
		env: 'MLB_GAMELOGS_DIR',
	},
	/** ESPN's public scoreboard, for the season currently being played.
	 *
	 *  Retrosheet is authoritative and, by its own note in the source table,
	 *  published annually — the file supplied on 2026-08-30 ends at the 2025
	 *  World Series. So on any day during a season, the authoritative source has
	 *  nothing for it, and a club page answers about a season that finished last
	 *  November as though it were current.
	 *
	 *  That is what `espn` is for. It is already declared in the schema at
	 *  authority 10 and `reproducible = false`, with the note "superseded the
	 *  moment an authoritative source publishes" — the row is replaced by
	 *  Retrosheet's the next time the annual file is loaded, and the count of
	 *  non-reproducible rows returns to zero on its own.
	 *
	 *  A DAY at a time, not a month, and that is a correctness decision rather
	 *  than a cost one.
	 *
	 *  `dates=YYYYMM` returns a month in one request, which is cheaper — and the
	 *  event timestamps are UTC while Retrosheet records the LOCAL date. A 7:05pm
	 *  game in Texas is `2025-03-29T00:05Z`, so reading the date off the event
	 *  filed it a day late, collided it with the next day's game, and the pair
	 *  became a fake doubleheader numbered 1 and 2. Only 76% of a season's ids
	 *  matched what Retrosheet had published for the same games.
	 *
	 *  `dates=YYYYMMDD` returns the games of that LOCAL day — the Texas game
	 *  comes back from `dates=20250328` — so the date is the one asked for and
	 *  the ids line up. It also makes a live refresh two requests rather than
	 *  nine, because only today and yesterday can still change.
	 */
	live: {
		url: (yyyymmdd) => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${yyyymmdd}&limit=1000`,
		/** Every day a season could have a game on. March through November
		 *  covers openers through a Game 7. */
		daysOf(season) {
			const out = [];
			for (let m = 3; m <= 11; m++) {
				const days = new Date(Date.UTC(season, m, 0)).getUTCDate();
				for (let d = 1; d <= days; d++) {
					out.push(`${season}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);
				}
			}
			return out;
		},
		/** What a frequent refresh needs: three days around now.
		 *
		 *  Three rather than two, because these dates are LOCAL and the clock
		 *  here is UTC. North American local dates lag UTC by up to eight hours,
		 *  so during a US evening the UTC date has already rolled over and a
		 *  two-day window of UTC-1 and UTC-0 covers local today and tomorrow
		 *  while missing local yesterday — which is exactly when last night's
		 *  late game finishes and a suspended one is completed.
		 *
		 *  Measured: a refresh at 2026-08-31T00:xxZ fetched the 30th and the
		 *  31st, and the 29th's late games were never revisited.
		 */
		recentDays(now) {
			const day = (offset) => {
				const d = new Date(now);
				d.setUTCDate(d.getUTCDate() + offset);
				return d.toISOString().slice(0, 10).replace(/-/g, '');
			};
			return [day(-2), day(-1), day(0)];
		},
		source: 'espn',
		/** Which season a date belongs to. Baseball's is the calendar year; an
		 *  NFL season crosses the new year and would not be, which is why this
		 *  is declared per sport rather than assumed. */
		seasonOf: (date) => date.getUTCFullYear(),
	},
	playByPlay: {
		file: 'plays.lfs.csv',
		perSeason: false,
		// Retrosheet's play-by-play coverage is complete for the era this
		// franchise has existed, so unlike football there is no first season
		// before which scoring plays simply do not exist.
		firstSeason: 1969,
	},
};

/** Retrosheet dates are YYYYMMDD integers. Everything downstream compares and
 *  sorts dates as strings, so they become ISO here rather than at each use. */
export function isoDate(yyyymmdd) {
	const s = String(yyyymmdd);
	return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

/** Retrosheet gametype words, mapped to the two questions the core asks: was
 *  this the regular season, and was it the championship round. */
const REGULAR = 'regular';
const CHAMPIONSHIP_ROUND = 'worldseries';

export function gameRow(r, teamId) {
	const home = r.hometeam, away = r.visteam;
	if (home !== teamId && away !== teamId) return null;

	const isHome = home === teamId;
	const scoreFor = isHome ? r.hruns : r.vruns;
	const scoreAgainst = isHome ? r.vruns : r.hruns;
	const played = scoreFor !== '' && scoreAgainst !== '';
	const f = parseInt(scoreFor, 10), a = parseInt(scoreAgainst, 10);
	const isRegular = r.gametype === REGULAR;

	return {
		date: isoDate(r.date),
		season: r.season,
		regular_season: isRegular ? '1' : '0',
		playoff: isRegular ? '0' : '1',
		// A World Series is a best-of-seven, so this field marks the round and
		// the tally decides the title by wins against losses within it. That
		// same rule gives the right answer for a one-game final, which is why
		// football can share it.
		championship: r.gametype === CHAMPIONSHIP_ROUND ? String(r.season) : '',
		Opponent: isHome ? away : home,
		result: !played ? '' : f > a ? 'WIN' : f < a ? 'LOSS' : 'TIE',
		scoreFor,
		scoreAgainst,
		location: isHome ? 'home' : 'away',
		gid: r.gid,
		// Baseball has no weeks. The key exists so both sports produce the
		// same row shape, which is the seam everything downstream reads.
		week: null,
	};
}

/** A play scored if its `runs` column is non-zero.
 *
 *  This is pure, exactly like football's. An earlier version of this file
 *  claimed baseball needed stateful detection — comparing a running score
 *  against the previous row — and built a whole seam argument on it. That was
 *  invented from guessed column names: the file has `score_v` and `score_h`,
 *  not the `vruns_after` I assumed, and more to the point it has `runs`, which
 *  the baseball site's own collector has been reading all along.
 *
 *  The lesson is the cheaper one: the working implementation was three
 *  directories away and would have answered this in a minute.
 *
 *  64,051 of 728,867 plays score — 8.8%, which is the first real cut before
 *  anything is dropped or compressed.
 */
export function isScoringPlay(r) {
	return parseInt(r.runs, 10) > 0;
}

/** The fields a scoring play keeps, of the 100-odd columns Retrosheet carries. */
export function scoringRow(r) {
	return {
		gid: r.gid,
		// Baseball has no weeks. The key exists so both sports produce the
		// same row shape, which is the seam everything downstream reads.
		week: null,
		inning: r.inning,
		// top_bot is '0' for the top of the inning.
		top: r.top_bot === '0',
		team: r.batteam,
		batter: r.batter?.trim() || '',
		pitcher: r.pitcher?.trim() || '',
		runs: parseInt(r.runs, 10),
		// The score before the play, so a reader can render "MIL 4, SLN 0"
		// after it without recomputing.
		preV: parseInt(r.score_v, 10),
		preH: parseInt(r.score_h, 10),
	};
}

/** Retrosheet game log fields, 0-based, of the 161 on a row.
 *
 *  Retrosheet documents them 1-based, so every number here is its number minus
 *  one.
 *
 *  REVERSED. The first version of this had the managers at 77-80, and the load
 *  ran clean: 1,488 people, 427,433 attributions, 94.7% of final games covered.
 *  Every number was plausible and every one of them was about UMPIRES. Fields
 *  77-88 are six umpire slots — home plate, first, second, third, left, right —
 *  and the managers sit after them at 89-92.
 *
 *  What made it convincing is worth keeping: the row it was checked against was
 *  the first game of 1871, which had one umpire and five empty slots, so
 *  `"boakj901","John Boake","","(none)"` five times over pushed the managers
 *  down to exactly 77-80. Charlie Pabor and Bill Lennon really did manage that
 *  game. The offsets were confirmed against a single row from the one era where
 *  the wrong answer and the right one coincide.
 *
 *  A 2010 row says Joe West and Angel Hernandez, who are umpires, where it
 *  should say Joe Girardi and Terry Francona. Checked now against 1871, 2010 and
 *  2024 — all 161 fields wide, managers at 89-92 in each.
 */
const GL = {
	date: 0,
	number: 1,      // 0 for a single game, 1 and 2 for a doubleheader
	visTeam: 3,
	homeTeam: 6,
	visManagerId: 89,
	visManager: 90,
	homeManagerId: 91,
	homeManager: 92,
};

/** The id `gameinfo.csv` gives this game, rebuilt from a game log row.
 *
 *  Retrosheet's gid is home team + date + game number — `FW1187105040`,
 *  `BSN189704190` — so it is derivable rather than needing a join on date and
 *  club. That is what makes doubleheaders exact: the two halves are separate
 *  keys, and 34,185 dates carry two games. Only 8 of those have a different
 *  manager for each half, but a scheme that has to guess would be guessing on
 *  all of them.
 */
export function gameLogId(fields) {
	return `${fields[GL.homeTeam]}${fields[GL.date]}${fields[GL.number]}`;
}

/** Both managers of one game log row, in the neutral leader shape.
 *
 *  Returns [] for a row that names no manager. 148 of 235,607 rows carry a
 *  blank id paired with the literal string `(none)` — Retrosheet's placeholder
 *  for a game whose manager it does not know, not a person called None. Loading
 *  them would create a leader who managed 148 games for 40 clubs across a
 *  century, which is the same shape of silent, plausible wrong answer as every
 *  bug in CLAUDE.md.
 *
 *  The ID is Retrosheet's and is the identity; the name is a label. Across all
 *  1,490 (id, name) pairs in the logs, exactly one id has two spellings, and it
 *  is the empty placeholder above. Football has no equivalent and has to assign
 *  its own — see data/reference/nfl-coaches.csv.
 */
export function leaderRows(fields) {
	if (fields.length <= GL.homeManager) return [];
	const gameId = gameLogId(fields);
	const out = [];
	for (const [codeAt, idAt, nameAt] of [
		[GL.visTeam, GL.visManagerId, GL.visManager],
		[GL.homeTeam, GL.homeManagerId, GL.homeManager],
	]) {
		const leaderId = fields[idAt]?.trim();
		const leaderName = fields[nameAt]?.trim();
		if (!leaderId || !leaderName || leaderName === '(none)') continue;
		out.push({ gameId, code: fields[codeAt], leaderId, leaderName });
	}
	return out;
}

/** What every club in this league says. Facts about baseball, not about any
 *  club; a club overrides any of them when it genuinely differs. */
export const defaults = {
	nouns: {
		scoreNoun: 'runs',
		/** Not "Points For" with a noun swapped — the verb changes too. */
		scoreForLabel: 'Runs Scored',
		scoreAgainstLabel: 'Runs Allowed',
		championship: 'World Series',
		leaderNoun: 'manager',
		leaderPlural: 'managers',
		meetingNoun: 'clash',
		/** Not meetingNoun + 's'. That gives "clashs". */
		meetingPlural: 'clashes',
		losslessSeasonNoun: 'undefeated',
	},
	rules: {
		/** Streaks end at the season boundary here and span them in football.
		 *  Across 162 games the within-season run is the record anyone quotes;
		 *  across 17 the cross-season one is. */
		streaksSpanSeasons: false,
		/** How long a stint can be and still be somebody covering an absence.
		 *
		 *  Retrosheet names the manager who RAN each game, so an ejection or an
		 *  illness puts the bench coach in the record: Bobby Cox reads 2493-1998
		 *  where the published figure is 2504-2001, and the difference is Bobby
		 *  Dews and Pat Corrales standing in.
		 *
		 *  45 games, and it is a backstop: what folds a stint is being bracketed
		 *  by one person who managed MORE of that season. The number only decides
		 *  how long an absence can get before it counts as a tenure.
		 *
		 *  Swept against twelve managers' published career records rather than
		 *  chosen. Total drift across all twelve, in games:
		 *
		 *      15 -> 648      36 -> 435      50 -> 385
		 *      30 -> 535      40 -> 435      45 -> 350   <-
		 *
		 *  It was 15, to match `build_coach_tenures.py`, and 15 is too small:
		 *  Don Zimmer managed the first 36 games of 1999 while Joe Torre was
		 *  treated for cancer, and without them Torre is 21 wins short.
		 *
		 *  Above 45 it gets worse again, and Casey Stengel is why. Bob Coleman
		 *  managed 46 games of the 1943 Braves after Stengel was hit by a taxi,
		 *  and every published record credits Coleman with them. At 50 Stengel
		 *  gains 20 wins he is not usually given. So the line sits between a
		 *  36-game absence and a 46-game one, which is narrower than it looks
		 *  and is the reason to record the sweep rather than the number.
		 *
		 *  What remains at 45 is not this rule: Connie Mack is short by his
		 *  1894-96 Pittsburgh seasons, which begin before `gameinfo.csv` does. */
		fillInMaxGames: 45,
		/** Of every MLB season above .700, two have happened since 1955. */
		losslessSeasonIsPlausible: false,
		/** Exact date. Across fifty-odd seasons of near-daily baseball there is
		 *  almost always a game on today's date; football needs three days
		 *  either side or the panel is empty most of the year. */
		onThisDayWindowDays: 0,
		/** Baseball plays most days, so a schedule is a list of dates. Nobody
		 *  says "week 12" about a baseball season.
		 */
		schedulePeriod: 'date',
	},
};

export const sport = {
	id: 'mlb',
	name: 'baseball',
	sources,
	defaults,
	gameRow,
	isScoringPlay,
	scoringRow,
	leaderRows,
	gameLogId,
	// The live feed's mappers belong here too. `loadSports` hands the server
	// each adapter's DEFAULT export, and these were only named exports — the
	// command-line loader imported the whole module namespace, so nothing showed
	// until the server tried to call them. Declared below and hoisted.
	liveGameRow,
	numberEvents,
	gameKey: 'gid',
};

export default sport;

/** One ESPN scoreboard event as a game row, or null.
 *
 *  The id is synthesised in RETROSHEET's shape — era code, date, game number —
 *  rather than using ESPN's own. Games are keyed on (sport, id), so an ESPN id
 *  would make the same game a second row the moment Retrosheet published the
 *  season, and the club would have played everything twice.
 *
 *  The game number is the hard part and is derived rather than read: Retrosheet
 *  writes 0 for a single game and 1 and 2 for a doubleheader, and ESPN says
 *  nothing about which is which. Events sharing a home club and a date are
 *  ordered by start time and numbered; a lone game is 0.
 */
export function liveGameRow(event, { eraCodeOf, franchiseOf, knows, number = 0, queryDate = null }) {
	const comp = event?.competitions?.[0];
	if (!comp) return null;
	// Spring training is not the season. ESPN's scoreboard carries it as
	// `season.type === 1`, and March 2026 is 321 preseason events against 76
	// regular-season ones — loaded as real games it gave the Brewers 26 games in
	// March and 161 for the year by the end of August, when they had played 137.
	//
	// The same call the authoritative load already makes: Retrosheet's
	// `exhibition` and `allstar` rows are skipped for the same reason, and this
	// feed's All-Star game arrives as NL versus AL, which are not clubs.
	if ((event.season?.type ?? 2) < 2) return null;

	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	if (!home?.team?.abbreviation || !away?.team?.abbreviation) return null;

	// Both sides must be clubs this repo knows. A live scoreboard carries things
	// that are not: the All-Star game arrives as AL against NL, and postseason
	// fixtures appear as TBD against TBD months before the matchups are set.
	//
	// Rejecting them here rather than downstream matters, because the loader
	// registers a franchise for a code BEFORE deciding whether to keep the game —
	// so AL, NL and TBD were all created as clubs, and the All-Star game was
	// stored as a real one.
	//
	// The historical load makes the same call from the other direction: it skips
	// Retrosheet's `allstar` and `exhibition` rows.
	if (knows && (!knows(home.team.abbreviation) || !knows(away.team.abbreviation))) return null;

	// The date comes from the REQUEST, not the event. Event timestamps are UTC
	// and Retrosheet records the local date; a night game is stamped the
	// following day and would be filed under it.
	const date = queryDate
		? `${queryDate.slice(0, 4)}-${queryDate.slice(4, 6)}-${queryDate.slice(6, 8)}`
		: String(event.date).slice(0, 10);
	// A postponed game is not a fixture on this date. It is replayed later,
	// usually as half of a doubleheader — Boston's April 5th 2025 game against
	// St. Louis became the second game of April 6th — and Retrosheet has no
	// record of it on the original day at all. Stored as `scheduled` it became a
	// row nothing would ever supersede, sitting on the schedule as a game that
	// was never played.
	if (comp.status?.type?.name === 'STATUS_POSTPONED') return null;

	// `completed`, not `state === 'post'`. A POSTPONED game is also state `post`
	// and is not completed, and it carries a 0-0 score — so reading the state
	// stored thirteen postponements in three months as nil-nil finals and gave
	// the Brewers 140 games by August 30 when they had played 137.
	//
	// `in` is a game being played and `pre` one that has not started; both carry
	// a score too, and neither is a result.
	const played = comp.status?.type?.completed === true;
	const eraHome = eraCodeOf(home.team.abbreviation);

	return {
		id: `${eraHome}${date.replace(/-/g, '')}${number}`,
		season: Number(String(event.season?.year ?? date.slice(0, 4))),
		date,
		// ESPN's season type: 1 preseason, 2 regular, 3 postseason. Anything
		// beyond the regular season is a playoff game; which ROUND it was, and
		// whether it was the World Series, is left to the authoritative source
		// rather than guessed from a live feed.
		round: (event.season?.type ?? 2) > 2 ? 'playoff' : 'regular',
		home: franchiseOf(home.team.abbreviation),
		away: franchiseOf(away.team.abbreviation),
		homeScore: played ? Number(home.score) : null,
		awayScore: played ? Number(away.score) : null,
		neutral: Boolean(comp.neutralSite),
		status: played ? 'final' : 'scheduled',
		source: 'espn',
		week: null,
	};
}

/** Group events into Retrosheet game numbers: 0 alone, 1 and 2 for a double.
 *
 *  Grouped by home club ALONE, because this is given one day's events and every
 *  one of them belongs to that day. Grouping by the event's own date instead
 *  splits a doubleheader whenever the second game runs past midnight UTC — a
 *  Colorado double on April 20th 2025 had games at 20:10Z and 01:10Z, landed in
 *  two groups, and both came out numbered 0 with the same id.
 */
export function numberEvents(events) {
	const byDay = new Map();
	for (const e of events) {
		const comp = e?.competitions?.[0];
		const home = comp?.competitors?.find((c) => c.homeAway === 'home')?.team?.abbreviation;
		if (!home) continue;
		if (!byDay.has(home)) byDay.set(home, []);
		byDay.get(home).push(e);
	}
	const out = [];
	for (const group of byDay.values()) {
		const sorted = group.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		sorted.forEach((e, i) => out.push({ event: e, number: sorted.length > 1 ? i + 1 : 0 }));
	}
	return out;
}
