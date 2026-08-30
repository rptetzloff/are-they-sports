/** The record book for a whole league, rather than one club.
 *
 *  Built by running `computeRecords` per club and merging, not by writing a
 *  second implementation over pooled rows. The per-club rules are subtle and
 *  already settled — a tie ends a win streak, a season with a game left is
 *  excluded, streaks span seasons or not per sport — and a parallel version
 *  would drift from them the first time one changed. This is the same reason
 *  `streaksOf` serves both the win and loss lists.
 *
 *  The trap is double counting, and it is not uniform. Every game is in the
 *  data twice, once from each club's perspective, so:
 *
 *    - A blowout WIN for one club is a blowout LOSS for the other, so ranking
 *      each club's wins yields every game exactly once. Correct as-is.
 *    - A TIE is a tie for both clubs and appears twice. Deduplicated by game id.
 *    - A season and a streak belong to one club, so neither can double.
 *
 *  Merging top-N lists is only safe when each club's N is at least the league
 *  N, which is why `perClub` is raised rather than reusing the display count.
 */

import { computeRecords, rec } from './records.js';

/** How many each club contributes before the league list is cut.
 *
 *  A club cannot place more entries in a league top-10 than it has in its own
 *  top-10, so this must be >= the league `top`. It is not free — 32 clubs each
 *  sorting their whole history — but it is the difference between "the ten
 *  best seasons" and "the ten best seasons among each club's best three".
 */
const PER_CLUB = 25;

const byGames = (a, b) => b.games - a.games || a.startSeason - b.startSeason;

/** League-wide records from a list of `{ team, rows }`.
 *
 *  `team` is the resolved manifest, so every entry can name the club that owns
 *  it. Clubs with no rows are skipped rather than contributing empty lists —
 *  an unavailable club must not appear as a 0–0 season.
 */
export function computeLeague(clubs, { top = 10, streaksSpanSeasons = true } = {}) {
	const per = [];
	for (const { team, rows } of clubs) {
		if (!rows?.length) continue;
		per.push({
			team,
			r: computeRecords(rows, { top: PER_CLUB, streaksSpanSeasons }),
		});
	}
	if (!per.length) return empty();

	// Every code any club in scope answers to, so an OPPONENT can be linked too.
	// A tie has two clubs in it and a blowout has a club on the receiving end;
	// naming only the one whose row survived deduplication tells half the story.
	const idByCode = new Map();
	for (const { team } of clubs) {
		for (const code of team?.sourceIds ?? []) idByCode.set(code, team.id);
	}
	const withOpponent = (e) => ({ ...e, opponentId: idByCode.get(e.opponent) ?? null });

	/** Tag every entry of one per-club list with the club it belongs to.
	 *
	 *  Both the display name and the id. Linking on the name alone was written
	 *  first and could never have worked: this uses the nickname, "Packers",
	 *  while the server's club list is keyed by full name, "Green Bay Packers",
	 *  so every lookup missed and every entry rendered unlinked with no error.
	 */
	const tagged = (pick) => per.flatMap(({ team, r }) =>
		pick(r).map((e) => ({ ...e, club: label(team), teamId: team.id, sport: team.sport })));

	const seasonsBy = (pick, cmp) => tagged(pick).sort(cmp).slice(0, top);

	// Ties are the one list where the same game appears under two clubs. The
	// game id is the only thing that identifies it across perspectives; date
	// plus opponent would collide on a doubleheader.
	const ties = [];
	const seenTie = new Set();
	for (const { team, r } of per) {
		for (const t of r.ties) {
			// Falls back to date plus the two SOURCE CODES, never the nickname —
			// `label` is "Bears" and `opponent` is "CHI", so sorting a mix of the
			// two would put the same game under two different keys.
			const key = t.gid ?? `${t.date}|${[team.sourceIds[0], t.opponent].sort().join('|')}`;
			if (seenTie.has(key)) continue;
			seenTie.add(key);
			ties.push(withOpponent({ ...t, club: label(team), teamId: team.id, sport: team.sport }));
		}
	}

	// One row per club: which championships it has won, most first.
	//
	// This used to read "10 of 13", which is accurate and unreadable — ten wins
	// from thirteen championship-game appearances. For the Packers both numbers
	// look like a title count, because they have thirteen championships AND
	// thirteen title-game appearances, which are different thirteens.
	//
	// So the titles themselves are the list, each carrying what it was, and the
	// finals lost are a separate count rather than a denominator.
	const titles = per
		.map(({ team, r }) => {
			const seasons = (won) => r.championshipAppearances
				.filter((a) => a.won === won)
				.map((a) => ({ season: a.season, title: a.title ?? null }))
				.sort((a, b) => b.season - a.season);
			const wins = seasons(true);
			return {
				club: label(team), teamId: team.id, sport: team.sport,
				wins,
				lost: seasons(false),
				won: wins.length,
				appearances: r.championshipAppearances.length,
				// Counted rather than derived at render time, so the ordering and
				// the display cannot disagree about what a Super Bowl is.
				superBowls: wins.filter((w) => w.title === 'Super Bowl').length,
			};
		})
		.filter((c) => c.appearances > 0)
		.sort((a, b) => b.won - a.won || b.superBowls - a.superBowls
			|| b.appearances - a.appearances || a.club.localeCompare(b.club));

	const allTime = per
		.map(({ team, r }) => {
			let w = 0, l = 0, t = 0;
			for (const s of r.everySeason) { w += s.wins; l += s.losses; t += s.ties; }
			const played = w + l + t;
			return {
				club: label(team), teamId: team.id, sport: team.sport, wins: w, losses: l, ties: t, record: rec(w, l, t),
				winPct: played ? (w + t / 2) / played : 0,
				seasons: r.everySeason.length,
				from: r.seasonRange.first, to: r.seasonRange.last,
			};
		})
		.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || a.club.localeCompare(b.club));

	return {
		clubs: per.length,
		seasonRange: {
			first: Math.min(...per.map((p) => p.r.seasonRange.first)),
			last: Math.max(...per.map((p) => p.r.seasonRange.last)),
		},
		allTime,
		titles,
		bestSeasons: seasonsBy((r) => r.bestSeasons,
			(a, b) => b.winPct - a.winPct || b.wins - a.wins || a.season - b.season),
		// More losses is worse, mirroring more wins being better. See records.js.
		worstSeasons: seasonsBy((r) => r.worstSeasons,
			(a, b) => a.winPct - b.winPct || b.losses - a.losses || a.season - b.season),
		losslessSeasons: seasonsBy((r) => r.losslessSeasons,
			(a, b) => b.wins - a.wins || a.season - b.season),
		bestStarts: seasonsBy((r) => r.bestStarts, (a, b) => b.games - a.games || a.season - b.season),
		worstStarts: seasonsBy((r) => r.worstStarts, (a, b) => b.games - a.games || a.season - b.season),
		winStreaks: tagged((r) => r.winStreaks).sort(byGames).slice(0, top),
		loseStreaks: tagged((r) => r.loseStreaks).sort(byGames).slice(0, top),
		// Ranked by margin, then the winner's score, then date — the same rule
		// the club page uses, so the two never disagree about which win was
		// bigger.
		lopsidedWins: tagged((r) => r.lopsidedWins)
			.sort((a, b) => (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || (a.date < b.date ? -1 : 1))
			.slice(0, top).map(withOpponent),
		// Newest first, and cut to `top`. The total is carried so the page can say
		// "10 of 47" rather than presenting a slice as the whole list — the one
		// card here ordered by recency rather than rank, where a reader has no
		// way to tell it was truncated.
		ties: ties.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, top),
		tiesTotal: ties.length,
	};
}

/** The club's short name, which is what a league table has room for. */
const label = (team) => team.nouns.team;

const empty = () => ({
	clubs: 0, seasonRange: { first: null, last: null },
	allTime: [], titles: [], bestSeasons: [], worstSeasons: [], losslessSeasons: [],
	bestStarts: [], worstStarts: [], winStreaks: [], loseStreaks: [], lopsidedWins: [], ties: [],
	tiesTotal: 0,
});
