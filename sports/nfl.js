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

	playByPlay: {
		// .csv.gz rather than .csv: 18.5MB against 95MB, and the build has to
		// decompress either way.
		url: (season) => `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`,
		perSeason: true,
		gzipped: true,
		// nflverse play-by-play begins in 1999. Before that only schedules and
		// results exist, so a team's scoring index simply starts later rather
		// than the build failing.
		firstSeason: 1999,
	},
};

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
	};
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
	// `playoff` is empty for regular-season games and otherwise a round code.
	const isPlayoff = Boolean(r.playoff);

	return {
		date: r.date,
		season: r.season,
		regular_season: isPlayoff ? '0' : '1',
		playoff: isPlayoff ? '1' : '0',
		// 's' is the Super Bowl in this file's round codes.
		championship: r.playoff === 's' ? String(r.season) : '',
		Opponent: isHome ? away : home,
		result: f > a ? 'WIN' : f < a ? 'LOSS' : 'TIE',
		scoreFor,
		scoreAgainst,
		// `neutral` is a flag here rather than a venue, so a neutral-site game
		// is neither home nor away and says so.
		location: r.neutral === '1' ? 'neutral' : isHome ? 'home' : 'away',
		gid: `${r.date}-${home}-${away}`,
	};
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

export const sport = {
	id: 'nfl',
	name: 'football',
	sources,
	gameRow,
	seedGameRow,
	isScoringPlay,
	scoringRow,
	/** The column identifying a game across sources, so the builder can key an
	 *  index without knowing the sport. */
	gameKey: 'game_id',
};

export default sport;
