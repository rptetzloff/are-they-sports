import { SITE } from './site.js';

// Shared (browser + node) computation of Packers records/superlatives from
// data/packers_games.csv. Pure functions only — no fs/fetch/DOM.

export function splitCsvLine(line) {
	const out = []; let cur = ''; let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
		else if (ch === ',' && !q) { out.push(cur); cur = ''; }
		else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

export function parseGamesCsv(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	return lines.slice(1).map((l) => {
		const v = splitCsvLine(l); const o = {};
		headers.forEach((h, i) => { o[h] = v[i] ?? ''; });
		return o;
	});
}

/** Parse the games CSV into the shape every compute function reads.
 *
 *  parseGamesCsv above stays generic — it is a header-to-object mapper and is
 *  also used for photos.csv and packers_season_records.csv, so normalising
 *  inside it would rename fields on files that have nothing to do with games.
 *
 *  This is the seam the Brewers repo gets for free, because Retrosheet's raw
 *  columns are nothing like the ones its code wants and its parser has to build
 *  the row anyway. Here the CSV very nearly is the internal shape, which is why
 *  the team name ended up in the field names: the file has a column literally
 *  called "Packers Win".
 *
 *  Mapping it here means every function above reads `result` and `scoreFor`,
 *  and the data file is free to be regenerated with different headers — which
 *  it will need to be, since the shared core wants rows carrying team ids
 *  rather than rows already flattened to one club's point of view.
 */
export function parseGames(raw) {
	return parseGamesCsv(raw).map((r) => ({
		date: r.date,
		season: r.season,
		regular_season: r.regular_season,
		playoff: r.playoff,
		// The three fields whose CSV names carried the club's own name. In
		// are-they-sports the server writes them neutrally (`result`,
		// `team_score`), because one file shape serves every club.
		championship: r.superbowl,
		Opponent: r.Opponent,
		result: r.result,
		scoreFor: r.team_score,
		scoreAgainst: r.opponent_score,
		location: r.location,
		// ESPN's id for the game's box score page, and the game-day details
		// nflverse records; all empty before 1999.
		espnId: r.espn_id || '',
		stadium: r.stadium || '',
		roof: r.roof || '',
		surface: r.surface || '',
		temp: r.temp || '',
		wind: r.wind || '',
		referee: r.referee || '',
		// When, overtime, division, the line and the quarterbacks (the Splits
		// page; lib/nflverse-games.js says what each holds). Empty before 1999.
		weekday: r.weekday || '',
		kickoff: r.gametime || '',
		overtime: r.overtime || '',
		division: r.div_game || '',
		spread: r.spread || '',
		qbId: r.qb_id || '',
		qb: r.qb || '',
		oppQbId: r.opponent_qb_id || '',
		oppQb: r.opponent_qb || '',
		stadiumId: r.stadium_id || '',
	}));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> 'Oct 23, 1966' without Date() timezone pitfalls.
/**
 * The season being played: an NFL season is named for the year it starts,
 * and its January and February games belong to the year before. Shared by
 * the page and the server, which both read a past season from the games CSV
 * and the season being played from ESPN. The CSV holds the season being
 * played too once its games are in, and reading it from there showed it as
 * finished: no games to come, no live game, a "finished 3-2" title.
 */
export function seasonBeingPlayed(now = new Date()) {
	return now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
}

/**
 * Every game, with the season being played counted from ESPN: `current` (its
 * rows, parsed like the CSV's, from /api/current/games.csv) replaces the
 * CSV's rows for `season`. The CSV holds some of that season too, once
 * regenerated, and appending would count those games twice. With no
 * `current` (ESPN unreachable) the CSV's rows stand, as far as they go.
 */
export function poolCurrentSeason(games, current, season) {
	if (!current) return games;
	const s = String(season);
	return [...games.filter((g) => String(g.season) !== s), ...current];
}

export function formatDate(iso) {
	const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
	return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// 'YYYY-MM-DD' -> local-time Date. new Date('YYYY-MM-DD') parses as UTC
// midnight, which any timezone west of UTC displays as the PREVIOUS day
// (Sunday games labelled Saturday).
export function localDate(iso) {
	const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
	return new Date(y, m - 1, d);
}

export const rec = (w, l, t) => (t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`);

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

// A season labelled Y runs into Jan/Feb of Y+1; by March 1 of Y+1 it is over.
// Guards "perfect season" claims against the mid-season CSV updates the weekly
// data workflow commits (an unbeaten October team hasn't finished anything).
const seasonSettled = (yr, now) =>
	now.getFullYear() > yr + 1 || (now.getFullYear() === yr + 1 && now.getMonth() >= 2);

// rows: parsed CSV rows. Returns { seasonRange, bestStarts, perfectSeasons,
// winStreaks, worstStarts, lopsidedWins } — each list sorted best-first,
// trimmed to `top`. Streaks/starts/perfect seasons are regular season only;
// ties end win streaks (record-book convention). Lopsided wins include
// playoffs, flagged.
export function computeSuperlatives(rows, { top = 5, now = new Date() } = {}) {
	const games = rows
		.filter((r) => RESULTS.has(r.result))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const regular = games.filter((r) => r.regular_season === '1');

	const seasons = new Map(); // year -> chronological regular-season games
	for (const g of regular) {
		const yr = parseInt(g.season, 10);
		if (!seasons.has(yr)) seasons.set(yr, []);
		seasons.get(yr).push(g);
	}
	const years = [...seasons.keys()].sort((a, b) => a - b);
	const seasonRange = { first: years[0], last: years[years.length - 1] };

	// Leading run of `result` games to open each season.
	const seasonStarts = (result) => {
		const out = [];
		for (const yr of years) {
			let n = 0;
			for (const g of seasons.get(yr)) {
				if (g.result === result) n++;
				else break;
			}
			if (n > 0) out.push({ season: yr, games: n });
		}
		return out.sort((a, b) => b.games - a.games || a.season - b.season).slice(0, top);
	};
	const bestStarts = seasonStarts('WIN');
	const worstStarts = seasonStarts('LOSS');

	// One row per season, built from the same pass that finds the unbeaten ones.
	// Regular season only, matching every other list here.
	const perfectSeasons = [];
	const seasonRows = [];
	for (const yr of years) {
		let w = 0, l = 0, t = 0;
		for (const g of seasons.get(yr)) {
			if (g.result === 'WIN') w++;
			else if (g.result === 'LOSS') l++;
			else t++;
		}
		if (l === 0 && w > 0 && seasonSettled(yr, now)) perfectSeasons.push({ season: yr, wins: w, record: rec(w, l, t) });
		const played = w + l + t;
		seasonRows.push({
			season: yr, wins: w, losses: l, ties: t, record: rec(w, l, t),
			// Ties count half, as everywhere else.
			winPct: played ? (w + t / 2) / played : 0,
		});
	}
	perfectSeasons.sort((a, b) => b.wins - a.wins || a.season - b.season);

	// Best and worst seasons by win percentage.
	//
	// Settled seasons only: a team sitting at 3-0 in September would otherwise
	// top the list at 1.000, which is the same guard perfectSeasons uses and for
	// the same reason. The tiebreakers match the Brewers repo's so the two lists
	// order identically when they merge — win percentage, then the count that
	// makes the season more extreme, then the earlier year.
	const completed = seasonRows.filter((r) => seasonSettled(r.season, now) && (r.wins + r.losses + r.ties) > 0);
	const bestSeasons = completed.slice()
		.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || a.season - b.season).slice(0, top);
	const worstSeasons = completed.slice()
		.sort((a, b) => a.winPct - b.winPct || a.losses - b.losses || a.season - b.season).slice(0, top);

	// Regular-season streaks of a given result, allowed to span seasons; anything
	// else ends one. A tie ends a win streak, by record-book convention.
	//
	// Parameterised rather than written twice, which is what the losing-streaks
	// card needed — and what a shared core will need anyway, since the Brewers
	// repo has had both lists all along and computes them from one function.
	//
	// Streaks run across season boundaries here, and deliberately do not in
	// baseball. Seventeen games make the cross-season run the record worth
	// quoting; across 162 the within-season one is what anyone means. The value
	// is declared in site.js as streaksSpanSeasons and this is the behaviour it
	// describes.
	const streaksOf = (result) => {
		const streaks = [];
		let run = null;
		const endRun = () => { if (run) { streaks.push(run); run = null; } };
		for (const g of regular) {
			if (g.result === result) {
				if (!run) run = { games: 0, start: null, end: null };
				run.games++;
				if (!run.start) run.start = g;
				run.end = g;
			} else {
				endRun();
			}
		}
		endRun();
		return streaks;
	};
	const winStreaks = streaksOf('WIN');
	const loseStreaks = streaksOf('LOSS');
	const streakEntry = (s) => ({
		games: s.games,
		startDate: s.start.date, endDate: s.end.date,
		startSeason: parseInt(s.start.season, 10), endSeason: parseInt(s.end.season, 10),
	});
	const rankStreaks = (list) => list
		.sort((a, b) => b.games - a.games || (a.start.date < b.start.date ? -1 : 1))
		.slice(0, top)
		.map(streakEntry);
	const topStreaks = rankStreaks(winStreaks);
	const topLoseStreaks = rankStreaks(loseStreaks);

	const gameInfo = (g) => {
		const pf = parseInt(g.scoreFor, 10) || 0;
		const pa = parseInt(g.scoreAgainst, 10) || 0;
		return {
			date: g.date, season: parseInt(g.season, 10), opponent: g.Opponent,
			pf, pa,
			playoff: g.regular_season !== '1',
			championship: !!(g.championship && g.championship.trim()),
		};
	};

	// Biggest margins, either direction; sort by margin, then winner's score, then date.
	const lopsided = (result) => games
		.filter((g) => g.result === result)
		.map(gameInfo)
		.sort((a, b) => Math.abs(b.pf - b.pa) - Math.abs(a.pf - a.pa)
			|| Math.max(b.pf, b.pa) - Math.max(a.pf, a.pa)
			|| (a.date < b.date ? -1 : 1))
		.slice(0, top);

	// Every tie ever, not a top-N list; newest first.
	const ties = games.filter((g) => g.result === 'TIE').map(gameInfo).reverse();

	// Postseason seasons, newest first.
	//
	// Simpler than the Brewers version, and the difference is the sport rather
	// than the code. Baseball's postseason is a ladder of best-of series, so
	// that repo groups games into series and labels each round. Football's is
	// single elimination: one game per round, and the record is just how far
	// they got. So an appearance here lists its games rather than its series.
	const postseason = games.filter((g) => g.regular_season !== '1');
	const bySeasonPost = new Map();
	for (const g of postseason) {
		const yr = parseInt(g.season, 10);
		if (!bySeasonPost.has(yr)) bySeasonPost.set(yr, []);
		bySeasonPost.get(yr).push(g);
	}
	const playoffAppearances = [...bySeasonPost.entries()]
		.map(([season, list]) => {
			const w = list.filter((g) => g.result === 'WIN').length;
			const l = list.filter((g) => g.result === 'LOSS').length;
			const last = list[list.length - 1];
			return {
				season,
				games: list.length,
				record: `${w}–${l}`,
				// Whether the run ended in a win is what makes it a title, and it
				// is the same rule computeSeasonHistory uses for `champion`.
				won: last.result === 'WIN',
				championship: list.some((g) => g.championship && g.championship.trim()),
			};
		})
		.sort((a, b) => b.season - a.season);

	// Seasons that reached the championship game, won or lost.
	const championshipAppearances = playoffAppearances
		.filter((a) => a.championship)
		.map((a) => ({ season: a.season, won: a.won, record: a.record }));

	return {
		seasonRange, bestStarts, perfectSeasons, winStreaks: topStreaks, worstStarts,
		lopsidedWins: lopsided('WIN'), lopsidedLosses: lopsided('LOSS'), ties,
		loseStreaks: topLoseStreaks, bestSeasons, worstSeasons,
		playoffAppearances, championshipAppearances,
	};
}

export const streakSpan = (s) =>
	s.startSeason === s.endSeason ? String(s.startSeason) : `${s.startSeason}–${s.endSeason}`;

// The 1929-31 titles were awarded on standings — no championship game to win.
// Every later title (NFL Championships and Super Bowls) is "won the season's
// final playoff game".
//
// In are-they-sports the seasons come from the championship table, which has
// every club's standings titles (method = 'standings'), not only Green Bay's.
const STANDINGS_TITLES = new Set(SITE.standingsTitles ?? []);

// One entry per season, chronological: record, win% (ties count half), and
// points for/against, plus championship/undefeated flags for chart markers.
// `playoffs: true` folds postseason games into the record/points; the
// champion and undefeated flags always use their own rules regardless.
export function computeSeasonHistory(rows, { now = new Date(), playoffs = false } = {}) {
	const games = rows
		.filter((r) => ['WIN', 'LOSS', 'TIE'].includes(r.result))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const bySeason = new Map();
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (!bySeason.has(yr)) bySeason.set(yr, []);
		bySeason.get(yr).push(g);
	}
	return [...bySeason.keys()].sort((a, b) => a - b).map((yr) => {
		let w = 0, l = 0, t = 0, pf = 0, pa = 0, regLosses = 0, regWins = 0;
		let lastPlayoff = null;
		let championship = false;
		for (const g of bySeason.get(yr)) {
			const isReg = g.regular_season === '1';
			if (!isReg) {
				lastPlayoff = g;
				if (g.championship && g.championship.trim() && g.result === 'WIN') championship = true;
			}
			if (isReg) {
				if (g.result === 'WIN') regWins++;
				else if (g.result === 'LOSS') regLosses++;
			}
			if (!isReg && !playoffs) continue;
			if (g.result === 'WIN') w++;
			else if (g.result === 'LOSS') l++;
			else t++;
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		const gamesPlayed = w + l + t;
		return {
			season: yr,
			wins: w, losses: l, ties: t,
			record: rec(w, l, t),
			winPct: gamesPlayed ? (w + t / 2) / gamesPlayed : 0,
			pf, pa,
			champion: STANDINGS_TITLES.has(yr) || (lastPlayoff !== null && lastPlayoff.result === 'WIN'),
			championship,
			undefeated: regLosses === 0 && regWins > 0 && seasonSettled(yr, now),
		};
	});
}

/** The numbers a single season's page shows: the regular-season record, the
 *  postseason record beside it, and the championship's name if it was won.
 *
 *  `rows` is one season's games as parseGames produces them.
 *
 *  Lifted out of main.js, where it sat inline in processCsvSeasonData and
 *  tallied and rendered in one pass. That is exactly where every past season
 *  came to render 0-0: the tally read column names the parser had stopped
 *  producing, each yielded undefined rather than throwing, and no test could
 *  reach it because main.js fetches its own CSV in a browser.
 *
 *  The championship test is "more championship-round wins than losses", which
 *  reads oddly for a sport whose final is a single game and is deliberate. The
 *  baseball repo needs it, because a World Series is a best-of-seven and winning
 *  one game in it is not winning it. Applied to a Super Bowl the same test gives
 *  the obvious answer — a win is 1 > 0, a defeat is 0 > 1 — so the series rule is
 *  the general one and the single-game rule a special case of it. Writing it
 *  this way is what lets both sites run this function unchanged; the two bodies
 *  now differ only in these comments.
 *
 *  Deliberately not folded into computeSeasonHistory, which looks like it
 *  already does this and does not. That one exposes no postseason record, only
 *  a boolean for the championship rather than its name, and a different notion
 *  of undefeated — see below.
 */
export function seasonTally(rows, site = SITE) {
	let wins = 0, losses = 0, ties = 0;
	let postWins = 0, postLosses = 0, postTies = 0;
	let titleWins = 0, titleLosses = 0, titleName = null;

	for (const g of rows) {
		if (g.regular_season === '1') {
			if (g.result === 'WIN') wins++;
			else if (g.result === 'LOSS') losses++;
			else if (g.result === 'TIE') ties++;
		} else if (g.playoff === '1') {
			if (g.result === 'WIN') postWins++;
			else if (g.result === 'LOSS') postLosses++;
			else if (g.result === 'TIE') postTies++;
		}
		if (g.championship && g.championship.trim() !== '') {
			titleName = `${site.championship} ${g.championship.toUpperCase()}`;
			if (g.result === 'WIN') titleWins++;
			else if (g.result === 'LOSS') titleLosses++;
		}
	}

	return {
		wins, losses, ties,
		// A postseason of ties alone does not count as one. Preserved from the
		// inline version rather than tidied: the only rows that could produce it
		// are unplayed or malformed, and showing "0-0-1" for them would be worse
		// than showing nothing.
		postseason: (postWins > 0 || postLosses > 0)
			? { w: postWins, l: postLosses, t: postTies }
			: null,
		championshipName: titleWins > titleLosses ? titleName : null,
		// Undefeated *so far*, which is not computeSeasonHistory's `undefeated`.
		// That one also requires the season to have finished, because the records
		// page lists completed undefeated seasons. This one answers the question
		// the site is named after, and a team can be answering yes to it in
		// October. Merging the two would either announce a finished perfect
		// season in week three, or refuse to call a team undefeated while it is.
		undefeated: losses === 0 && wins > 0,
	};
}

/** Games played within `windowDays` of a given month and day, in any season.
 *
 *  `bySeason` is the season-keyed map main.js already builds. `month` is
 *  0-based, matching Date#getMonth, because the caller gets it from a Date.
 *
 *  The proximity test is `month * 31 + day`, which is not a date calculation and
 *  is kept because changing it would change which games the page offers. Two
 *  consequences worth knowing rather than discovering: it does not wrap around
 *  the end of the year, so on 1 January nothing from late December is a
 *  candidate; and because every month is treated as 31 days long, the window
 *  narrows slightly across the boundary of a short month.
 */
export function onThisDayCandidates(bySeason, month, day, { windowDays = 3 } = {}) {
	const target = month * 31 + day;
	const out = [];
	for (const [yr, games] of Object.entries(bySeason)) {
		for (const g of games) {
			if (!g.date) continue;
			const d = localDate(g.date);
			if (isNaN(d)) continue;
			if (Math.abs((d.getMonth() * 31 + d.getDate()) - target) <= windowDays) {
				out.push({ game: g, season: parseInt(yr, 10), date: d });
			}
		}
	}
	return out;
}

/** Narrow the candidates to seasons that have photographs, unless that would
 *  leave nothing. A picture beats a scoreline, but an empty panel beats both. */
export function onThisDayPool(candidates, photosBySeason) {
	const withPhotos = candidates.filter((c) => photosBySeason[c.season]);
	return withPhotos.length > 0 ? withPhotos : candidates;
}

/** The display values for one candidate: everything the panel shows that is not
 *  markup. Extracted from _renderOnThisDay, which derived these inline and then
 *  built 20 lines of HTML around them.
 *
 *  The championship label is a game *type*, so unlike seasonTally's
 *  championshipName it is set for a final that was lost as well as won.
 */
export function onThisDayView({ game, season, date }, site = SITE) {
	const result = game.result;
	const scoreFor = game.scoreFor;
	const scoreAgainst = game.scoreAgainst;
	const isChampionship = Boolean(game.championship && game.championship !== '');
	const isPlayoff = game.playoff === '1' || game.playoff === 'true';
	return {
		season,
		opponent: game.Opponent || game.opponent || 'Unknown',
		resultClass: result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'tie',
		resultLabel: result === 'WIN' ? 'W' : result === 'LOSS' ? 'L' : 'T',
		// Both scores must be present. They arrive as strings, so '0' is truthy
		// and a shutout still shows its score; an unplayed game shows none.
		scoreText: scoreFor && scoreAgainst ? `${scoreFor}–${scoreAgainst}` : '',
		gameTypeLabel: isChampionship ? site.championship : isPlayoff ? 'Playoff' : 'Regular Season',
		dateStr: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
	};
}

/** The streak banner's sentence, or null when there is nothing to say.
 *
 *  `completedGames` is [{ result, date }] for one season's regular-season games
 *  that have been played. Returns HTML because the six variants differ in where
 *  the emphasis falls, and splitting them into data plus a template made both
 *  halves harder to read than the sentences are.
 *
 *  Extracted from main.js unchanged, including the behaviour described next,
 *  which is worth a decision rather than a silent fix.
 *
 *  **A tie ends the opening run, and the sentence then calls it a loss.** The
 *  loop counts WIN and stops on anything else, so 1929 — 12-0-1, the season this
 *  site's front page exists to celebrate — reports "undefeated for 10 games
 *  before first loss", when what happened in game 11 was a tie. The records page
 *  agrees on the number and disagrees on the word: it lists 1929 as an
 *  undefeated season, because site.js says a lossless season is `undefeated`
 *  rather than `perfect` precisely so that ties do not disqualify it.
 *
 *  Both readings are defensible for the *streak* — a run of wins is broken by a
 *  draw under most record-book conventions — but "before first loss" is not
 *  defensible as a description of a tie. Changing it is a copy decision, so it
 *  is left alone here and pinned by a test.
 */
export function streakBannerHtml(completedGames, { isPastSeason = false, site = SITE } = {}) {
	if (completedGames.length === 0) return null;
	const sorted = [...completedGames].sort((a, b) => a.date - b.date);

	// Both branches computed these identically; the duplication went with them.
	let openingStreak = 0;
	let firstLoss = null;
	for (const g of sorted) {
		if (g.result === 'WIN') openingStreak++;
		else { firstLoss = g; break; }
	}

	const plural = (n, noun) => (n === 1 ? `1 ${noun}` : `${n} ${noun}s`);
	const daysToLoss = () =>
		Math.round((firstLoss.date - sorted[0].date) / (1000 * 60 * 60 * 24));

	if (isPastSeason) {
		if (!firstLoss) return `Finished the regular season undefeated &mdash; <strong>${openingStreak}-0</strong>`;
		if (openingStreak === 0) return `Lost the opener &mdash; undefeated for <strong>0 games</strong> to start the season`;
		// The day count is pluralised like the one below. It cannot read 1 in a
		// sport that plays weekly, so this changes nothing here — but the same
		// function runs on the baseball site, where it read "1 days" on a live
		// page until this line was shared rather than merely copied.
		return `Undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}) to start the season before first loss`;
	}

	let winStreak = 0;
	for (let i = sorted.length - 1; i >= 0; i--) {
		if (sorted[i].result === 'WIN') winStreak++;
		else break;
	}

	if (!firstLoss) return `Undefeated to start the season &mdash; <strong>${openingStreak}</strong>-game win streak`;
	if (openingStreak === 0) return `Lost the opener. Currently on a <strong>${winStreak}-game</strong> win streak.`;
	return `The ${site.team} started the season undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}). Currently on a <strong>${winStreak}-game</strong> win streak.`;
}

// Meta copy for the /history page, shared by server OG meta and client share.
//
// `site` is the vocabulary this deployment uses — see site.js. It is a
// parameter with a default rather than a bare import so that the same function
// can serve another sport, and so a test can hand it a different one without
// touching the module it is testing. Every call site that does not care about
// vocabulary carries on unchanged.
export function historyCopy(history, site = SITE) {
	const first = history[0].season, last = history[history.length - 1].season;
	const titles = history.filter((s) => s.champion).length;
	const winning = history.filter((s) => s.winPct > 0.5).length;
	return {
		title: `${site.team} Season-by-Season History, ${first}–${last}`,
		desc: `Every ${site.fullName} season since ${first} in one chart: ${titles} championships and ${winning} winning seasons across ${history.length} years.`,
	};
}

// Per-card copy shared by server OG meta and client share messages.
// slug 'overview' covers the /records landing URL.
export function recordsCopy(slug, data, site = SITE) {
	const range = `${data.seasonRange.first}–${data.seasonRange.last}`;
	switch (slug) {
		case 'best-starts': {
			const b = data.bestStarts[0];
			return {
				title: `Best ${site.team} Season Starts — ${b.games}–0 in ${b.season}`,
				desc: `The best start in ${site.fullName} history: ${b.games}–0 to open the ${b.season} season. Top ${data.bestStarts.length} starts, ${range}.`,
			};
		}
		case 'perfect-seasons': {
			const p = data.perfectSeasons[0];
			return {
				title: p
					? `${site.losslessSeasonNoun} ${site.team} Seasons — ${p.record} in ${p.season}`
					: `${site.losslessSeasonNoun} ${site.team} Seasons`,
				desc: p
					? `Seasons the ${site.fullName} finished without a loss: ${data.perfectSeasons.map((x) => `${x.record} in ${x.season}`).join(', ')}.`
					: site.copy.noLosslessSeason,
			};
		}
		case 'win-streaks': {
			const s = data.winStreaks[0];
			return {
				title: `Longest ${site.team} Win Streaks — ${s.games} straight (${streakSpan(s)})`,
				desc: `The longest regular-season win streak in ${site.fullName} history: ${s.games} straight, ${formatDate(s.startDate)} to ${formatDate(s.endDate)}.`,
			};
		}
		case 'worst-starts': {
			const w = data.worstStarts[0];
			return {
				title: `Worst ${site.team} Season Starts — 0–${w.games} in ${w.season}`,
				desc: `The worst start in ${site.fullName} history: 0–${w.games} to open the ${w.season} season. ${site.copy.worstStartAside}`,
			};
		}
		case 'lopsided-wins': {
			const g = data.lopsidedWins[0];
			return {
				title: `Most Lopsided ${site.team} Wins — ${g.pf}–${g.pa} over the ${g.opponent}`,
				desc: `The biggest blowout in ${site.fullName} history: ${g.pf}–${g.pa} over the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		case 'worst-losses': {
			const g = data.lopsidedLosses[0];
			return {
				title: `Worst ${site.team} Losses — ${g.pf}–${g.pa} to the ${g.opponent}`,
				desc: `The most lopsided loss in ${site.fullName} history: ${g.pa}–${g.pf} to the ${g.opponent} on ${formatDate(g.date)}. ${site.copy.worstLossAside}`,
			};
		}
		case 'best-seasons': {
			const b = data.bestSeasons[0];
			return {
				title: `Best ${site.team} Seasons — ${b.record} in ${b.season}`,
				desc: `The best regular season in ${site.fullName} history: ${b.record} in ${b.season}. Top ${data.bestSeasons.length} seasons, ${range}.`,
			};
		}
		case 'worst-seasons': {
			const w = data.worstSeasons[0];
			return {
				title: `Worst ${site.team} Seasons — ${w.record} in ${w.season}`,
				desc: `The worst regular season in ${site.fullName} history: ${w.record} in ${w.season}. ${site.copy.worstStartAside}`,
			};
		}
		case 'losing-streaks': {
			const s = data.loseStreaks[0];
			if (!s) return { title: `Longest ${site.team} Losing Streaks`, desc: site.copy.noLosingStreak };
			return {
				title: `Longest ${site.team} Losing Streaks — ${s.games} straight (${streakSpan(s)})`,
				desc: `The longest regular-season losing streak in ${site.fullName} history: ${s.games} straight, ${formatDate(s.startDate)} to ${formatDate(s.endDate)}. ${site.copy.worstLossAside}`,
			};
		}
		case 'playoff-appearances': {
			const p = data.playoffAppearances;
			if (!p.length) return { title: `${site.team} Playoff Appearances`, desc: site.copy.noPlayoffs };
			return {
				title: `${site.team} Playoff Appearances — ${p.length} all-time`,
				desc: `The ${site.fullName} have reached the playoffs ${p.length} times, most recently in ${p[0].season} (${p[0].record}).`,
			};
		}
		case 'championship-appearances': {
			const c = data.championshipAppearances;
			if (!c.length) return { title: `${site.team} ${site.championship} Appearances`, desc: site.copy.noChampionship };
			const won = c.filter((x) => x.won).length;
			return {
				title: `${site.team} ${site.championship} Appearances — ${c.length}, ${won} won`,
				desc: `The ${site.fullName} have played in ${c.length} ${site.championship}s and won ${won}, most recently ${c[0].season}.`,
			};
		}
		case 'ties': {
			const t = data.ties[0];
			if (!t) return { title: `${site.team} Ties`, desc: site.copy.noTies };
			return {
				title: `${site.team} Ties — ${data.ties.length} all-time`,
				desc: `The ${site.team} have played ${data.ties.length} ties. Most recent: ${t.pf}–${t.pa} vs the ${t.opponent} on ${formatDate(t.date)}.`,
			};
		}
		default:
			return {
				title: `${site.team} Records & Superlatives`,
				desc: `Best starts, ${site.losslessSeasonNoun.toLowerCase()} seasons, longest win streaks, worst starts, lopsided wins, worst losses, and every tie — ${site.fullName}, ${range}.`,
			};
	}
}

// The record cards this site publishes, read out of the manifest rather than
// listed again here.
//
// It was a literal until site.js gained the same list, and two lists that must
// agree are one list read twice — the copy that drifts is the one nobody is
// looking at. site.js is the source because it is where a sport says what
// records it has, and adding a card is then a one-line change in one file.
//
// Kept as an export so the four call sites in lib/records.js and records.js
// did not have to change.
export const RECORD_SLUGS = SITE.records;
