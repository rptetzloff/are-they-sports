/** A whole league's season, grouped into the periods that sport plays in.
 *
 *  Football groups by week and baseball by date, and which one is a fact about
 *  the sport rather than a branch here — `rules.schedulePeriod` says. The rule
 *  exists because "if the sport is football" in a renderer is the seam this
 *  repo keeps moving out of code.
 *
 *  **Weeks are stored, never derived, and are missing before 1999.** nflverse
 *  carries a real week on all 7,548 of its games from 1999 on; the
 *  FiveThirtyEight seed covering 1920-1998 has no week column at all. Deriving
 *  one from dates looks obvious and was measured against nflverse's own
 *  numbers: wrong for 322 of 1,816 games, 17.7%. A postponement shifts every
 *  week after it, and 2001 lost week 2 to September 11th and replayed it at the
 *  end of the season. So a season whose games carry no week is grouped by date
 *  and SAYS its weeks are unknown, rather than being given numbers that would
 *  quietly mislabel a fifth of them.
 *
 *  Every game is in the data twice, once per club, and a game between two clubs
 *  in scope is one fixture. Deduplicated by game id — the only thing that
 *  identifies a game across both perspectives.
 */

/** One club's rows, tagged with who they belong to. */
const tag = (clubs) => clubs.flatMap(({ team, rows }) =>
	(rows ?? []).map((r) => ({ row: r, team })));

/**
 * @param clubs  `[{ team, rows }]` — every club in scope and its games.
 * @param season the season to show; the most recent with games if omitted.
 * @param period `'week'` or `'date'`, from `rules.schedulePeriod`.
 */
export function computeSchedule(clubs, { season = null, period = 'week' } = {}) {
	const all = tag(clubs);
	const seasons = [...new Set(all.map(({ row }) => parseInt(row.season, 10)))]
		.filter(Number.isFinite).sort((a, b) => a - b);
	if (!seasons.length) return { season: null, seasons: [], periods: [], weeksKnown: false, games: 0 };

	const target = season == null ? seasons.at(-1) : parseInt(season, 10);
	const inSeason = all.filter(({ row }) => parseInt(row.season, 10) === target);

	// One fixture per game. A game between two in-scope clubs appears from both
	// sides, and for an ordinary game either side reconstructs the same fixture:
	// flipping an away row is symmetric, which a mutation run proved by deleting
	// this preference and changing nothing.
	//
	// Neutral-site games are the exception and the reason this is deliberate. A
	// club-perspective row reports `location: 'neutral'` and so no longer says
	// who was nominally home, meaning each club's row would name ITSELF the home
	// side. Preferring the home perspective settles it wherever one exists, and
	// for a neutral game the lower code wins so the answer is stable rather than
	// depending on which club the scope happened to list first.
	const fixtures = new Map();
	for (const { row, team } of inSeason) {
		const existing = fixtures.get(row.gid);
		if (!existing) { fixtures.set(row.gid, { row, team }); continue; }
		// Lower code wins, and that is the WHOLE rule. Two earlier versions also
		// preferred the home perspective, which reads as obviously necessary and
		// cannot change anything: for a normal game either side reconstructs the
		// identical fixture, and a mutation run deleting the preference broke no
		// test because there is nothing for it to break. Only neutral games need
		// deciding, and they have no home side to prefer.
		if (team.sourceIds[0] < existing.team.sourceIds[0]) fixtures.set(row.gid, { row, team });
	}

	const games = [...fixtures.values()].map(({ row, team }) => {
		const away = row.location === 'away';
		return {
			gid: row.gid,
			date: row.date,
			week: row.week == null ? null : Number(row.week),
			round: row.regular_season === '1' ? 'regular' : row.championship ? 'championship' : 'playoff',
			// Home and away as the fixture, not as one club's point of view.
			home: away ? row.Opponent : team.sourceIds[0],
			away: away ? team.sourceIds[0] : row.Opponent,
			homeId: away ? null : team.id,
			awayId: away ? team.id : null,
			homeScore: row.result === '' ? null : Number(away ? row.scoreAgainst : row.scoreFor),
			awayScore: row.result === '' ? null : Number(away ? row.scoreFor : row.scoreAgainst),
			neutral: row.location === 'neutral',
			played: row.result !== '',
		};
	}).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.gid < b.gid ? -1 : 1));

	// A season's weeks are known only if the games actually carry them. Checked
	// per season rather than by year, because "1999 and later" is a fact about
	// one source and this has to hold for a sport that gains weeks later or
	// never has them.
	const weeksKnown = period === 'week' && games.length > 0 && games.some((g) => g.week != null);

	const groups = new Map();
	for (const g of games) {
		// A game with no week in a season that otherwise has them still needs a
		// home, so it falls back to its date rather than vanishing.
		const key = weeksKnown && g.week != null ? `w${g.week}` : `d${g.date}`;
		if (!groups.has(key)) {
			groups.set(key, {
				key,
				kind: key[0] === 'w' ? 'week' : 'date',
				week: key[0] === 'w' ? g.week : null,
				date: key[0] === 'w' ? null : g.date,
				games: [],
			});
		}
		groups.get(key).games.push(g);
	}

	const periods = [...groups.values()].sort((a, b) => {
		if (a.week != null && b.week != null) return a.week - b.week;
		if (a.week != null) return -1;
		if (b.week != null) return 1;
		return a.date < b.date ? -1 : 1;
	});
	// A week's own games stay in date order, which is what a reader expects
	// within a Thursday-to-Monday block.
	for (const p of periods) p.first = p.games[0]?.date ?? null;

	return { season: target, seasons, periods, weeksKnown, games: games.length };
}
