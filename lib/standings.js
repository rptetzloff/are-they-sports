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
 *  @param points a sport's `standingsPoints(row)` when it ranks by points
 *               (hockey, soccer); without one, by winning percentage.
 */
export function computeStandings(clubs, { season, points = null, byConference = false } = {}) {
	const year = season == null ? null : parseInt(season, 10);
	const lines = [];
	// College football ranks a conference by its conference games
	// (`byConference`, sports/ncaaf.js rules): a game between two clubs of the
	// same conference, today's conference (lib/limitations.js). Independents
	// have no conference games.
	const confOf = byConference ? new Map(clubs.filter((c) => c?.franchise).map((c) => [c.franchise, c.conference])) : null;
	const independent = (conf) => !conf || /independent/i.test(conf);

	for (const entry of clubs) {
		if (!entry?.team) continue;
		// Regular season only. A club that went 13-3 and won three playoff games
		// did not finish 16-3, and no standings table has ever said so.
		const played = (entry.rows ?? []).filter((r) => r.regular_season === '1'
			&& (year == null || parseInt(r.season, 10) === year)
			&& (r.result === 'WIN' || r.result === 'LOSS' || r.result === 'TIE'));
		if (!played.length) continue;

		let w = 0, l = 0, t = 0, otl = 0, pts = 0, pf = 0, pa = 0;
		for (const g of played) {
			const p = points ? points(g) : 0;
			pts += p;
			if (g.result === 'WIN') w++;
			// A loss worth a point is hockey's overtime loss, its own column.
			else if (g.result === 'LOSS' && p > 0) otl++;
			else if (g.result === 'LOSS') l++;
			else t++;
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		let conf = null;
		if (confOf && !independent(entry.conference)) {
			const c = { w: 0, l: 0, t: 0 };
			for (const g of played) {
				if (confOf.get(g.Opponent) !== entry.conference) continue;
				if (g.result === 'WIN') c.w++;
				else if (g.result === 'LOSS') c.l++;
				else c.t++;
			}
			const n = c.w + c.l + c.t;
			conf = { ...c, record: rec(c.w, c.l, c.t), pct: n ? (c.w + c.t / 2) / n : 0, games: n };
		}
		// The run the club is on, newest game back: "W5", and +5 to sort by
		// (losses negative). College football's table shows it.
		const recent = [...played].sort((a, b) => String(b.date).localeCompare(String(a.date)));
		let run = 0;
		while (run < recent.length && recent[run].result === recent[0]?.result) run++;
		const streak = recent.length ? { text: `${recent[0].result[0]}${run}`, value: recent[0].result === 'WIN' ? run : recent[0].result === 'LOSS' ? -run : 0 } : null;
		lines.push({
			club: entry.team.nouns.team,
			// The school alone, where the club has one (college football).
			school: entry.team.nouns.school ?? null,
			streak,
			teamId: entry.team.id,
			sport: entry.team.sport,
			conference: entry.conference ?? null,
			division: entry.division ?? null,
			w, l, t, otl, pf, pa,
			games: played.length,
			conf,
			// Null where the sport ranks by percentage, so a table knows which.
			pts: points ? pts : null,
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
		// By points where the sport ranks by them — then fewer games played,
		// which is a better points percentage, then wins — and by percentage
		// everywhere else. Hockey and soccer ranked by percentage put a club with
		// more draws or overtime losses below one it finished above.
		// By conference record where the sport ranks by it, then overall.
		const byConf = (a, b) => (b.conf?.pct ?? -1) - (a.conf?.pct ?? -1) || (b.conf?.w ?? 0) - (a.conf?.w ?? 0)
			|| b.pct - a.pct || b.w - a.w || a.club.localeCompare(b.club);
		group.clubs.sort(byConference ? byConf : points
			? (a, b) => b.pts - a.pts || a.games - b.games || b.w - a.w || a.club.localeCompare(b.club)
			: (a, b) => b.pct - a.pct || b.w - a.w || a.club.localeCompare(b.club));
		const [leader] = group.clubs;
		for (const line of group.clubs) {
			// Games back in the conference, where it ranks by conference games.
			if (byConference) {
				line.gb = leader?.conf && line.conf ? ((leader.conf.w - line.conf.w) + (line.conf.l - leader.conf.l)) / 2 : null;
				continue;
			}
			// Games back: half the sum of the win gap and the loss gap. The
			// leader is 0 and everyone else is behind by definition, so this is
			// never negative — a club level on percentage but with fewer games
			// played can still be half a game back, which is the number people
			// actually want.
			line.gb = leader ? ((leader.w - line.w) + (line.l - leader.l)) / 2 : 0;
		}
	}

	// College's conferences A to Z, the independents last: its divisions table
	// is one programme a row, in no order of conferences.
	const ordered = [...groups.values()];
	if (byConference) ordered.sort((a, b) => Number(independent(a.conference)) - Number(independent(b.conference))
		|| String(a.conference ?? '').localeCompare(String(b.conference ?? '')));

	return {
		season: year,
		groups: ordered,
		clubs: lines.length,
	};
}

/** The clubs sharing a division with `code`, as entries standings can be built
 *  from — including the ones this deployment does not serve.
 *
 *  A single-club deployment is the point. `SCOPE=team:mlb/brewers` resolves one
 *  club, so the Cubs and the Cardinals are not in the scope's table at all —
 *  but their games are in the same database, and a standings table with one row
 *  in it is not a standings table. The scope decides which clubs get PAGES, not
 *  which games exist.
 *
 *  Division-mates outside the scope carry no manifest, so they get a name and no
 *  id. That is what makes them render as plain text where an in-scope club
 *  renders as a link: there is no page here to link to, and inventing one would
 *  be a 404 in a table.
 *
 *  Sport-qualified throughout, because "Central" is a division in both leagues
 *  and BAL is two clubs.
 *
 *  @param divisions  rows from `loadDivisions(sport)`.
 *  @param teamFor    `(code) => manifest | null` for clubs this deployment serves.
 *  @param nameFor    `(code) => string`, the resolver for THIS sport.
 */
export function divisionPeers(sport, code, divisions, { teamFor, nameFor }) {
	const mine = divisions.find((d) => d.code === code);
	if (!mine) return [];
	return divisions
		.filter((d) => d.conference === mine.conference && d.division === mine.division)
		.map((d) => {
			const team = teamFor(d.code);
			// The NAME comes from the resolver for every club in the table, even
			// the ones with a manifest. Two reasons: a club outside the scope has
			// no manifest and only a full name, so mixing the two sources gave a
			// table reading "Chicago Cubs, St. Louis Cardinals, Brewers"; and the
			// resolver is season-aware, so a 1965 table names the clubs as they
			// were called in 1965 rather than as they are called now.
			//
			// The MANIFEST is still what decides whether the row links anywhere,
			// which is why it is kept rather than discarded.
			const name = nameFor(d.code);
			return {
				code: d.code,
				conference: d.conference,
				division: d.division,
				team: { id: team?.id ?? null, sport, nouns: { team: name, fullName: name } },
			};
		});
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
