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
		file: 'gameinfo.csv',
		perSeason: false,
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
	};
}

/** Retrosheet play rows carry a running score; a play that scored is one where
 *  the total changed. The file has no equivalent of nflverse's sp flag, so the
 *  builder is handed a stateful predicate rather than a pure one — see
 *  scoringFilter below. */
export function scoringFilter() {
	const lastByGame = new Map();
	return (r) => {
		const gid = r.gid;
		const total = parseInt(r.vruns_after ?? r.vruns ?? 0, 10)
			+ parseInt(r.hruns_after ?? r.hruns ?? 0, 10);
		const prev = lastByGame.get(gid);
		lastByGame.set(gid, total);
		return prev !== undefined && Number.isFinite(total) && total > prev;
	};
}

export function scoringRow(r) {
	return {
		gid: r.gid,
		period: r.inning,
		half: r.top_bot,
		desc: r.event ?? r.pbp ?? '',
		batter: r.batter,
		pitcher: r.pitcher,
	};
}

export const sport = {
	id: 'mlb',
	name: 'baseball',
	sources,
	gameRow,
	isScoringPlay: null, // stateful; see scoringFilter
	scoringFilter,
	scoringRow,
	gameKey: 'gid',
};

export default sport;
