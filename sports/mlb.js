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
	 *  A month at a time: `dates=YYYYMM` returns the whole month, so a season is
	 *  nine requests rather than two hundred.
	 */
	live: {
		url: (yyyymm) => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${yyyymm}&limit=1000`,
		// March to November covers spring openers through a Game 7.
		months: [3, 4, 5, 6, 7, 8, 9, 10, 11],
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
export function liveGameRow(event, { eraCodeOf, franchiseOf, knows, number = 0 }) {
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

	const date = String(event.date).slice(0, 10);
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

/** Group events into Retrosheet game numbers: 0 alone, 1 and 2 for a double. */
export function numberEvents(events) {
	const byDay = new Map();
	for (const e of events) {
		const comp = e?.competitions?.[0];
		const home = comp?.competitors?.find((c) => c.homeAway === 'home')?.team?.abbreviation;
		if (!home) continue;
		const key = `${home}|${String(e.date).slice(0, 10)}`;
		if (!byDay.has(key)) byDay.set(key, []);
		byDay.get(key).push(e);
	}
	const out = [];
	for (const group of byDay.values()) {
		const sorted = group.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		sorted.forEach((e, i) => out.push({ event: e, number: sorted.length > 1 ? i + 1 : 0 }));
	}
	return out;
}
