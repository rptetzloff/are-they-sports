/** Where every club in a division finished, for a season.
 *
 *  The baseball site fetches ESPN's standings endpoint into a modal, which means
 *  it can only ever show the season being played. Computed from the games
 *  already in the database, this works for 1962 as well as today, and needs no
 *  request at all.
 *
 *  **Grouped by today's divisions, including for seasons that predate them.**
 *  That is the same decision the scope makes and is documented there: a division
 *  means today's clubs, each with its whole history. The 1962 National League
 *  had no divisions at all, so a 1962 table under "NL Central" is a grouping
 *  this repo imposes rather than one the season had. The page says so; silently
 *  presenting it as how the season was organised would be the wrong kind of
 *  tidy.
 *
 *  Realignment history would fix it and nobody publishes it, which is the same
 *  reason `nfl-divisions.csv` is a snapshot.
 */

import { rec } from './records.js';

/** Standings for one season, grouped conference then division.
 *
 *  @param clubs `[{ team, rows, conference, division }]` — the resolved scope
 *               entries, which already carry the division membership.
 */
export function computeStandings(clubs, { season } = {}) {
	const year = season == null ? null : parseInt(season, 10);
	const lines = [];

	for (const entry of clubs) {
		if (!entry?.team) continue;
		// Regular season only. A club that went 13-3 and won three playoff games
		// did not finish 16-3, and no standings table has ever said so.
		const played = (entry.rows ?? []).filter((r) => r.regular_season === '1'
			&& (year == null || parseInt(r.season, 10) === year)
			&& (r.result === 'WIN' || r.result === 'LOSS' || r.result === 'TIE'));
		if (!played.length) continue;

		let w = 0, l = 0, t = 0, pf = 0, pa = 0;
		for (const g of played) {
			if (g.result === 'WIN') w++;
			else if (g.result === 'LOSS') l++;
			else t++;
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		lines.push({
			club: entry.team.nouns.team,
			teamId: entry.team.id,
			sport: entry.team.sport,
			conference: entry.conference ?? null,
			division: entry.division ?? null,
			w, l, t, pf, pa,
			record: rec(w, l, t),
			// Ties count half, as everywhere else in this repo.
			pct: (w + l + t) ? (w + t / 2) / (w + l + t) : 0,
		});
	}

	// Grouped conference then division, each in the order the divisions table
	// lists them rather than alphabetically — AFC East before AFC North is how
	// anyone reads a standings page.
	const groups = new Map();
	for (const line of lines) {
		const key = `${line.conference ?? ''}|${line.division ?? ''}`;
		if (!groups.has(key)) {
			groups.set(key, { conference: line.conference, division: line.division, clubs: [] });
		}
		groups.get(key).clubs.push(line);
	}

	for (const group of groups.values()) {
		group.clubs.sort((a, b) => b.pct - a.pct || b.w - a.w || a.club.localeCompare(b.club));
		const [leader] = group.clubs;
		for (const line of group.clubs) {
			// Games back: half the sum of the win gap and the loss gap. The
			// leader is 0 and everyone else is behind by definition, so this is
			// never negative — a club level on percentage but with fewer games
			// played can still be half a game back, which is the number people
			// actually want.
			line.gb = leader ? ((leader.w - line.w) + (line.l - leader.l)) / 2 : 0;
		}
	}

	return {
		season: year,
		groups: [...groups.values()],
		clubs: lines.length,
	};
}

/** The seasons a club in this set actually played, oldest first.
 *
 *  Not the seasons with ROWS. Next season's fixtures are published months before
 *  a snap is taken — 272 unplayed 2026 games were in the database in August —
 *  and taking the last of those defaults the page to a season with nothing in
 *  it, which rendered as "no games on record" under a heading naming the season
 *  every visitor would think was current.
 */
export function playedSeasons(clubs) {
	const years = new Set();
	for (const entry of clubs ?? []) {
		for (const r of entry?.rows ?? []) {
			if (r.regular_season !== '1') continue;
			if (r.result !== 'WIN' && r.result !== 'LOSS' && r.result !== 'TIE') continue;
			const y = parseInt(r.season, 10);
			if (Number.isFinite(y)) years.add(y);
		}
	}
	return [...years].sort((a, b) => a - b);
}

/** "3.5", or "—" for the club at the top. */
export const gamesBack = (gb) => (gb <= 0 ? '—' : String(Number(gb.toFixed(1))));
