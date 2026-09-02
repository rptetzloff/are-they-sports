/** The leaders page: who led a club, and what happened while they did.
 *
 *  `/coaches` for football and `/managers` for baseball — one page, and the
 *  noun comes from `nouns.leaderPlural` in the sport's defaults rather than
 *  from a branch here. The seam holds: nothing below learns which league it is
 *  looking at.
 *
 *  This file is the sport-agnostic half. Source shapes belong to the adapters —
 *  `sports/mlb.js` reads Retrosheet's positional game logs, `sports/nfl.js`
 *  reads nflverse's coach columns — and both hand over the same neutral row.
 *
 *  TWO KINDS OF ROW ARRIVE HERE, and the difference is not cosmetic:
 *
 *    counted   Derived from games. Every number is recomputed from `game`, so
 *              it moves when a result is corrected and can never drift.
 *    stated    From data/reference/nfl-coaches.csv, for NFL 1920-1998, where no
 *              per-game source exists. The numbers are transcribed and cannot
 *              be rederived.
 *
 *  They are added, never reconciled — the eras do not overlap, and a test
 *  asserts that rather than a comment claiming it. A page that quietly blended
 *  a counted record with a stated one would be unable to say which of its
 *  numbers it could stand behind, and CLAUDE.md's rule is that the limit of a
 *  claim gets stated in the same breath as the claim.
 */

import { column } from './sort.js';

/** Regular season and postseason are separate records, because the sources
 *  disagree about whether they are one.
 *
 *  Retrosheet and nflverse count playoff games inside w/l; Wikipedia does not.
 *  Measured on the 175 NFL tenures the two describe in common: 161 reconcile
 *  once playoff results are pulled out of the derived side, and Bobby Cox is
 *  2213-1774 in Retrosheet against 2149-1709 on Wikipedia — the difference is
 *  exactly his postseason. Blending them would bake that disagreement in and
 *  make the two eras of the football table incomparable.
 */
const blank = () => ({
	w: 0, l: 0, t: 0,
	playoffW: 0, playoffL: 0,
	titles: [],
	// Championship-round results per season and club, resolved into titles at
	// the end. See `finish` — a World Series is best-of-seven and a single win
	// in it is not a title.
	champ: new Map(),
	seasons: new Set(),
	franchises: new Set(),
	games: 0,
	// Whether this person only ever held the job as a stand-in. Set by
	// `markInterim` on the counted side and read from the curated file on the
	// stated one, so a page cannot tell where the answer came from.
	interim: false,
});

/** Who only ever held the job as a stand-in.
 *
 *  Derived from the games, because the alternatives are worse.
 *
 *  The interim flag in `data/sources/sportsdata/coaches/nfl_coaches.csv` is
 *  `build_coach_tenures.py`'s heuristic -- "at most 60 games, followed by
 *  somebody else, in an adjacent season" -- and that describes a coach who was
 *  FIRED as accurately as one who stood in. Measured against the 1999-2025
 *  tenures, it flags 57 people and **24 of them were permanent head coaches**:
 *  Marty Schottenheimer, Art Shell, Lane Kiffin, Steve Wilks, Freddie Kitchens,
 *  Urban Meyer, Jerod Mayo and seventeen more. The Wikipedia scrape is no help
 *  either -- `nfl_coaches_wiki.csv` marks 1 of 627 -- and the curated
 *  `data/reference/nfl-coaches.csv` carries the column with FALSE on all 382
 *  rows, because it was created and never populated.
 *
 *  The rule is one condition: **they never took this club into a season.**
 *  Every game they are on record for came after somebody else had already
 *  opened that year.
 *
 *  It was written as two -- "began mid-season AND did not open the following
 *  season" -- and a mutation run showed the second half could not fail. Deleting
 *  it changed no result, because a stand-in who is given the job opens the next
 *  season and is caught by the first half on those rows. Jason Garrett took over
 *  Dallas in November 2010 and opened 2011; that is what clears him, and the
 *  extra clause was restating it. Six more read the same way: Doug Marrone, Mike
 *  Tice, Dave McGinnis, Leslie Frazier, Dick LeBeau, Tom Cable.
 *
 *  Measured against the 1999-2025 tenures it selects exactly 33 of the source
 *  file's 57, a strict subset, and every one of the 24 dropped is a permanent
 *  head coach.
 *
 *  **Say what it misses.** Aaron Kromer opened 2012 for New Orleans while Sean
 *  Payton served a season-long suspension, so he passes the opener test and is
 *  not marked. A season-long absence is the case `creditFillIns` handles
 *  elsewhere, and this does not. And somebody who stood in during the last
 *  season on record is marked, because there is no following season to clear
 *  them with -- which is what every source says about them at the time, and
 *  unmarks itself on the next load if they open the next one.
 *
 *  It needs per-game data, so it answers for 1999-onward football and for all
 *  of baseball, and cannot answer for football before 1999. That is the same
 *  three-way split the curated coaches file already documents, arriving again.
 *
 *  Per CLUB, not per person. Steve Wilks opened 2018 for Arizona and stood in
 *  for Carolina in 2022, and both are true; a page about one club should say
 *  the one that is true there. Merged across clubs the conservative answer
 *  wins -- somebody who ever held the job properly is not an interim.
 */
export function markInterim(rows) {
	const byClub = new Map();
	for (const r of rows) {
		if (!r.date) continue;
		if (!byClub.has(r.franchise)) byClub.set(r.franchise, []);
		byClub.get(r.franchise).push(r);
	}

	const everRegular = new Set();
	const everStoodIn = new Set();
	for (const [, games] of byClub) {
		const inOrder = [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		// Who was in charge for each season's first game. Taken from the leader
		// rows themselves rather than from the schedule, which is exact for
		// football -- nflverse names a coach on all 7,548 rows -- and can be one
		// game late in baseball, where 3.5% of games name nobody.
		const opener = new Map();
		for (const g of inOrder) {
			const yr = Number(g.season);
			if (!opener.has(yr)) opener.set(yr, g.leader);
		}
		for (const g of inOrder) {
			const yr = Number(g.season);
			(opener.get(yr) === g.leader ? everRegular : everStoodIn).add(g.leader);
		}
	}
	// Only where they NEVER held it. A person who stood in once and was given
	// the job later is not an interim; that is Jason Garrett, and the whole
	// reason the second condition exists.
	return new Set([...everStoodIn].filter((id) => !everRegular.has(id)));
}

/** Tally per-game leader rows into one record per leader.
 *
 *  A row is `{ leader, name, franchise, season, round, result, title }` — the
 *  shape a join of `game_leader` against `game` produces, and the shape a test
 *  can write by hand without a database.
 *
 *  Only decided games count. A scheduled row still names a leader on purpose —
 *  nflverse knows who coaches the 2026 Giants before a snap is played, which is
 *  how a club page says who is in charge — but crediting an unplayed game would
 *  hand a coach sixteen wins he has not had the chance to lose.
 */
export function tallyLeaders(rows, interim = markInterim(rows)) {
	const by = new Map();
	for (const r of rows) {
		if (r.result !== 'WIN' && r.result !== 'LOSS' && r.result !== 'TIE') continue;
		let v = by.get(r.leader);
		if (!v) {
			v = blank(); v.leader = r.leader; v.name = r.name;
			v.interim = interim.has(r.leader);
			by.set(r.leader, v);
		}
		// The name travels with the row rather than being looked up, so a leader
		// whose spelling changed between eras still lands in one bucket: the id
		// is the identity and the name is a label. Last one wins, which for MLB
		// is Retrosheet's current spelling.
		if (r.name) v.name = r.name;
		v.games++;
		v.seasons.add(r.season);
		v.franchises.add(r.franchise);
		const post = r.round === 'playoff' || r.round === 'championship';
		if (post) {
			if (r.result === 'WIN') v.playoffW++;
			else if (r.result === 'LOSS') v.playoffL++;
			// A tied playoff game is not a thing either sport produces, and
			// silently dropping one would be worse than counting it nowhere.
			// It lands in neither column and the games count still sees it.
		} else if (r.result === 'WIN') v.w++;
		else if (r.result === 'LOSS') v.l++;
		else v.t++;
		// A championship is won by winning the ROUND, not a game in it. Football
		// makes those the same thing and baseball does not: the database holds
		// 707 MLB championship games and 60 Super Bowls, because a World Series
		// is best-of-seven. Counting a win here would have credited a manager
		// with a title for losing a series 4-3.
		//
		// So the round is tallied per season and club and decided in `finish`,
		// which is the same "more wins than losses within the round" rule
		// db/migrations/0001 gives for marking the round in the first place.
		if (r.round === 'championship') {
			const key = `${r.season}|${r.franchise}`;
			let c = v.champ.get(key);
			if (!c) { c = { season: r.season, w: 0, l: 0, title: null }; v.champ.set(key, c); }
			if (r.result === 'WIN') c.w++; else if (r.result === 'LOSS') c.l++;
			// NULL for every baseball row — Retrosheet's gametype says a game was
			// in the World Series and does not name it, and the football loader
			// fills this in only because it derives the name itself.
			if (r.title) c.title = r.title;
		}
	}
	return [...by.values()].map(finish);
}

/** Stated tenures, in the same shape counted ones come out in.
 *
 *  One row per (leader, franchise, stint) in the curated file, folded to one
 *  record per leader — a coach who led two clubs is one person with two
 *  franchises, exactly as the counted side treats them.
 */
export function tallyTenures(tenures) {
	const by = new Map();
	for (const t of tenures) {
		let v = by.get(t.leader);
		if (!v) { v = blank(); v.leader = t.leader; v.name = t.name; by.set(t.leader, v); }
		if (t.name) v.name = t.name;
		// Any interim tenure marks the person, because a stated row IS a stint
		// and somebody who only ever stood in has no other kind. The column is
		// FALSE on all 382 curated rows today, so this waits for data rather
		// than doing anything -- and it is wired now so that the day those rows
		// are filled the page changes without another commit.
		if (t.interim) v.interim = true;
		v.w += t.w; v.l += t.l; v.t += t.t ?? 0;
		v.playoffW += t.playoffW ?? 0; v.playoffL += t.playoffL ?? 0;
		// Counted from games, not stated — the championship games are all in
		// `game` and only the coach was missing. Without this the page reported
		// that Vince Lombardi won nothing, directly above his 9-1 postseason.
		for (const s of t.titleSeasons ?? []) v.titles.push({ season: Number(s), title: null });
		v.franchises.add(t.franchise);
		for (let s = t.firstSeason; s <= t.lastSeason; s++) v.seasons.add(s);
		// Games is a count of rows on the counted side and a sum of results
		// here, and those are the same number only when no game is missing.
		// Stated rows have no games to be missing, so this is exact for them.
		v.games += t.w + t.l + (t.t ?? 0) + (t.playoffW ?? 0) + (t.playoffL ?? 0);
	}
	return [...by.values()].map(finish);
}

/** Add the two, keeping each leader whole.
 *
 *  A coach whose career straddles 1999 — Mike Shanahan, Dan Reeves, Bill
 *  Belichick — has stated seasons and counted ones, and is one row on the page
 *  with `mixed` provenance. Reporting them as two coaches would be the same
 *  defect as the `codeIndex` bug: one person, split by which file happened to
 *  describe them.
 */
export function mergeLeaders(counted, stated) {
	const by = new Map();
	for (const [list, kind] of [[counted, 'counted'], [stated, 'stated']]) {
		for (const r of list) {
			const cur = by.get(r.leader);
			// `champ` is emptied, not carried. These records are already
			// finished, so their titles are resolved and sitting in `titles`;
			// leaving the round tallies in place would make `finish` derive them
			// a second time and hand every champion twice the rings.
			if (!cur) {
				by.set(r.leader, {
					...r, champ: new Map(),
					seasons: new Set(r.seasons), franchises: new Set(r.franchises), basis: kind,
				});
				continue;
			}
			cur.w += r.w; cur.l += r.l; cur.t += r.t;
			cur.playoffW += r.playoffW; cur.playoffL += r.playoffL;
			cur.games += r.games;
			cur.titles = [...cur.titles, ...r.titles];
			for (const s of r.seasons) cur.seasons.add(s);
			for (const f of r.franchises) cur.franchises.add(f);
			cur.basis = cur.basis === kind ? kind : 'mixed';
			// AND, not OR. A coach whose career straddles 1999 is one row, and
			// the conservative answer is the right one: Dan Reeves standing in
			// for three games in one era does not make his twenty-three seasons
			// an interim spell.
			cur.interim = cur.interim && r.interim;
			if (r.name) cur.name = r.name;
		}
	}
	return [...by.values()].map(finish);
}

/** The derived fields, computed in one place so both tallies agree on them. */
function finish(v) {
	const seasons = [...v.seasons].sort((a, b) => a - b);
	const decided = v.w + v.l;
	// A title is more championship-round wins than losses. `titles` may already
	// hold entries when this is called from mergeLeaders, which is merging two
	// already-finished records rather than raw rows.
	const fromRound = [...(v.champ?.values() ?? [])]
		.filter((c) => c.w > c.l)
		.map((c) => ({ season: c.season, title: c.title }));
	const titles = [...v.titles, ...fromRound]
		.sort((a, b) => a.season - b.season);
	return {
		...v,
		titles,
		seasons,
		franchises: [...v.franchises].sort(),
		firstSeason: seasons[0] ?? null,
		lastSeason: seasons[seasons.length - 1] ?? null,
		// A tie is half a win, which is how both sports have always computed it
		// and how the records page already does. Dividing by decided games
		// instead would rank a 12-0-1 season above a 13-0 one.
		winPct: decided + v.t === 0 ? 0 : (v.w + v.t / 2) / (v.w + v.l + v.t),
		basis: v.basis ?? 'counted',
	};
}

/** The sortable columns of the leaders table.
 *
 *  Declared here rather than in the renderer because the server sorts and the
 *  renderer draws, and both have to agree on what a column key means. A second
 *  list in render.js would be two definitions of one fact.
 *
 *  Which columns exist depends on the rows: a club with no ties, no postseason
 *  and no titles should not be given three empty columns to sort by.
 */
export function leaderColumns({ ties = false, post = false, titles = false, leaderNoun = 'Leader' } = {}) {
	return [
		column('name', leaderNoun, (r) => r.name),
		// Sorted by the season they ARRIVED, not by the printed range. The cell
		// reads "1978–2010" and there is no sensible ordering of a string like
		// that; the number behind it is what a reader means by chronological.
		column('seasons', 'Seasons', (r) => r.firstSeason, { numeric: true, defaultDir: 'asc' }),
		column('w', 'W', (r) => r.w, { numeric: true }),
		column('l', 'L', (r) => r.l, { numeric: true }),
		...(ties ? [column('t', 'T', (r) => r.t, { numeric: true })] : []),
		column('pct', 'Pct', (r) => r.winPct, { numeric: true }),
		...(post ? [column('post', 'Post', (r) => r.playoffW, { numeric: true })] : []),
		...(titles ? [column('titles', 'Titles', (r) => r.titles.length, { numeric: true })] : []),
		// Provenance. No key: there is nothing a reader wants this ordered by,
		// and a header that looks clickable and is not is worse than plain text.
		{ key: null, label: '' },
	];
}

/** What the leaders page shows when nobody has asked for an order.
 *
 *  Chronological, earliest first, so the table reads as the club's history from
 *  the top. It was most wins first, which is what both live sites do on their
 *  leaders boards — and is the wrong default here, because this page is a list
 *  of everyone who held the job rather than a ranking. Wins are still one click
 *  away, and now so is every other column.
 */
export const LEADERS_DEFAULT_SORT = 'seasons';

/** The page's order: most wins first.
 *
 *  Wins rather than percentage, and that is a decision worth stating. A
 *  percentage table is topped by whoever went 1-0 in a single game as an
 *  interim, which is true and useless. Both live sites rank their leaders
 *  boards by wins and show the percentage alongside, and this matches them.
 *
 *  Ties break on percentage, then on games, then on the id — the last so the
 *  order is total and a page does not reshuffle between requests over two
 *  leaders who match on everything a reader can see.
 */
export function rankLeaders(leaders) {
	return [...leaders].sort((a, b) =>
		b.w - a.w
		|| b.winPct - a.winPct
		|| b.games - a.games
		|| String(a.leader).localeCompare(String(b.leader)));
}

/** Who HELD the job, as opposed to who happened to run the game.
 *
 *  Retrosheet records the manager of record for each game, which means it
 *  records the bench coach who took over when the manager was ejected, ill or
 *  suspended. That is the truth about the game and the wrong answer for a
 *  leaders page: Bobby Cox came out 2493-1998 against a published 2504-2001,
 *  because Bobby Dews and Pat Corrales covered three games here and seven there.
 *
 *  THE RULE IS ENCLOSURE WITHIN A SEASON, not a game count. A leader's games
 *  fold into somebody else only when that somebody managed a game before their
 *  first and after their last IN THE SAME SEASON, and managed more of it than
 *  they did. That is what covering an absence looks like; a handover does not
 *  have the original manager on the far side of it.
 *
 *      Cox ... Dews (3) ... Cox        Dews was covering. Fold.
 *      Cox ... Gonzalez (162) ...      Cox left. Gonzalez held the job.
 *      Cox ... an interim (25) ... Snitker  A firing. The interim keeps his row.
 *
 *  REVERSED, and the first version is worth keeping because it was plausible
 *  and wrong in a way that got worse as the threshold rose. It compared
 *  ADJACENT RUNS of consecutive games: a run bracketed by two runs of the same
 *  other leader was a fill-in. That is true of a fill-in and also true of the
 *  real manager, because a season reads Torre(50) Mattingly(1) Torre(84)
 *  Mattingly(1) Torre(27) — so Torre's own 84-game run is "bracketed by
 *  Mattingly", and a threshold of 90 would have credited most of the 2007
 *  Yankees to their bench coach. Every long entry in that list was the manager,
 *  not the stand-in.
 *
 *  Comparing SEASON SPANS instead fixes it, because the encloser must have more
 *  games than the person being folded. Torre encloses Mattingly and outnumbers
 *  him; Mattingly can never enclose Torre.
 *
 *  Measured with the corrected rule: this is what closes the gap against
 *  published records. Bobby Cox lands on 2504-2001 exactly, and Joe Torre picks
 *  up the 36 games Don Zimmer managed during his 1999 cancer treatment — an
 *  absence far longer than any ejection, and precisely the case the old
 *  fifteen-game threshold could not reach.
 *
 *  `maxGames` is a sport rule from the adapter and is now a backstop rather
 *  than the mechanism. Football folds nothing either way: of 246 runs of
 *  consecutive games under one coach, nflverse never records a stand-in.
 *
 *  Rows must carry `season` and arrive ordered by date within a club. Returns a
 *  Map from `${franchise}|${gameId}` to the leader who should be credited.
 */
export function creditFillIns(rows, maxGames) {
	// How much of each season each leader managed, which is what tells a
	// stand-in from the manager. Counted per club and season, because "more
	// games" only means anything inside one season: a stand-in with a career of
	// forty games still out-totals a manager's single season across twenty years.
	const seasonTotal = new Map();
	for (const r of rows) {
		const key = `${r.franchise}|${r.season}|${r.leader}`;
		seasonTotal.set(key, (seasonTotal.get(key) ?? 0) + 1);
	}
	const totalFor = (r, leader) => seasonTotal.get(`${r.franchise}|${r.season}|${leader}`) ?? 0;

	const byClub = new Map();
	for (const r of rows) {
		if (!byClub.has(r.franchise)) byClub.set(r.franchise, []);
		byClub.get(r.franchise).push(r);
	}

	const credited = new Map();
	for (const [franchise, games] of byClub) {
		// Runs of consecutive games under one leader, across the club's whole
		// timeline rather than within a season. Season boundaries have to be
		// crossed here: Don Zimmer managed the FIRST 36 games of 1999 while Joe
		// Torre was treated for cancer, so within 1999 nothing encloses him and
		// only 1998 shows that Torre was there before.
		const runs = [];
		for (const g of games) {
			const last = runs[runs.length - 1];
			if (last && last.leader === g.leader) last.games.push(g);
			else runs.push({ leader: g.leader, games: [g] });
		}

		for (let i = 0; i < runs.length; i++) {
			const run = runs[i];
			const before = runs[i - 1];
			// Both sides the same person, and that person managed MORE of this
			// season than everyone folded into them did.
			//
			// The second half is what makes this safe, and without it a bigger
			// threshold makes things worse rather than better. A manager's own
			// season is chopped into runs by every ejection, so Phil Garner's
			// 2006 Astros reads Cooper(1) Garner(37) Cooper(1) — adjacency alone
			// calls Garner the stand-in and hands his season to his bench coach.
			// Comparing season totals puts it the right way round.
			// A WINDOW of runs, not a single one, because an absence can be
			// covered by more than one person. Ted Turner managed one game of the
			// 1977 Braves and Vern Benson the next before Dave Bristol came back,
			// so neither has the same leader on both sides and a run-at-a-time
			// rule leaves both on the page with a one-game career.
			let j = i;
			while (j < runs.length && before && runs[j].leader !== before.leader) j++;
			const window = runs.slice(i, j);
			const games = window.reduce((n, r) => n + r.games.length, 0);

			const isFillIn = before && runs[j] && window.length > 0
				&& games <= maxGames
				&& window.every((r) => totalFor(r.games[0], before.leader) > totalFor(r.games[0], r.leader));

			if (isFillIn) {
				for (const r of window) {
					for (const g of r.games) credited.set(`${franchise}|${g.gameId}`, before.leader);
				}
				i = j - 1;
				continue;
			}
			for (const g of run.games) credited.set(`${franchise}|${g.gameId}`, run.leader);
		}
	}
	return credited;
}

/** An id for a football coach, derived from the name.
 *
 *  Baseball does not need this: Retrosheet publishes a manager id and it is the
 *  identity. Football has no such column anywhere, so one is assigned, and the
 *  rule is deterministic so that the same person gets the same id from the
 *  curated file and from a game row without the two being kept in step by hand.
 *
 *  `Jim Mora` becomes `mora-jim`, surname first, because that is the part that
 *  stays put. Diacritics fold, punctuation goes, and a suffix stays attached —
 *  `Jim L. Mora` is `mora-jim-l`, which is the whole reason the middle initial
 *  is kept rather than stripped as noise.
 */
export function slugFor(name) {
	const cleaned = String(name)
		// Combining marks, written as escapes rather than as the characters
		// themselves: the literal range is invisible in a diff and in a grep,
		// which is how a NUL byte hid inside a template literal in
		// scripts/franchises.mjs for as long as it did.
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/[.'’]/g, '')
		.trim()
		.split(/\s+/);
	if (cleaned.length === 0 || cleaned[0] === '') return '';
	const last = cleaned[cleaned.length - 1];
	const rest = cleaned.slice(0, -1);
	return [last, ...rest].join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Resolve nflverse's coach NAME to a person.
 *
 *  A name is not a person, and this exists because of one measured case:
 *  nflverse writes `Jim Mora` for Indianapolis in 1999 and for Atlanta in 2004,
 *  and those are a father and a son. Nothing in the games gives it away — the
 *  two never coach in the same season and never share a club — so no heuristic
 *  finds it and only the curated table knows.
 *
 *  So the table is consulted FIRST and `slugFor` is the fallback. That ordering
 *  is the design: curation is needed only where a name is ambiguous or where a
 *  career straddles 1999 and the two halves must land on one id, and everywhere
 *  else the derived slug is already right. Requiring a row per coach would mean
 *  177 modern names transcribed by hand to say what the games already say,
 *  which is the kind of second copy CLAUDE.md keeps warning about.
 *
 *  Matching narrows by franchise and then by season, because the name alone is
 *  what is ambiguous. Where the table holds one person under a name, the club
 *  and season are not consulted at all.
 *
 *  THE LIMIT OF THIS: an ambiguous name the curated file does not mention
 *  resolves to a single slug and merges two people, silently. That is the Mora
 *  bug surviving under a different name, and no code here can detect it — which
 *  is why test/leaders.test.js carries a detector that flags any id whose
 *  seasons split into distant, club-disjoint runs, for a human to look at. A
 *  flag is not a fix; it is the difference between a gap that is known and one
 *  that is not.
 */
export function nflLeaderResolver(rows) {
	const byName = new Map();
	for (const r of rows) {
		// `nflverseName` is the file's "a column is a spelling" column: blank
		// means nflverse spells it the way we do, which is the common case and
		// must not become an entry for the empty string.
		for (const spelling of new Set([r.name, r.nflverseName].filter(Boolean))) {
			if (!byName.has(spelling)) byName.set(spelling, []);
			byName.get(spelling).push(r);
		}
	}
	return (name, franchise, season) => {
		const candidates = byName.get(name) ?? [];
		const ids = new Set(candidates.map((c) => c.leaderId));
		if (ids.size === 1) return candidates[0].leaderId;
		if (ids.size === 0) return slugFor(name);
		const atClub = candidates.filter((c) => c.franchiseAbbrv === franchise);
		const inSpan = atClub.filter((c) => season >= c.firstSeason && season <= c.lastSeason);
		const pick = inSpan.length ? inSpan : atClub;
		const picked = new Set(pick.map((c) => c.leaderId));
		// Two people of one name at one club in one season is a contradiction in
		// reference data that no build and no reload fixes, so this refuses
		// rather than picking the first and looking right.
		if (picked.size !== 1) return null;
		return pick[0].leaderId;
	};
}
