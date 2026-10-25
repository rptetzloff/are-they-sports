// A game's box score for /game/<ESPN event id>, boiled down from ESPN's
// game summary: who played where, the score by quarter, the scoring plays,
// the team stats side by side, each team's player tables, and the drives.
// The summary is about 600KB for a finished game; this is a few tens of KB,
// and the page polls it every 15 seconds during a game.
//
// The Brewers repo's espn-box-core.js does the same for baseball and shares
// nothing with this but the idea: innings, pitchers and fielding have no
// football counterpart, and football's player tables come from ESPN already
// labelled, so they pass through as labels and rows rather than being
// rebuilt field by field.
//
// Pure: no fetch, no DOM. ESPN covers the season being played, and every
// past season it has an event id for; the CSV has no ids, so a past
// season's games have no page yet.
//
// Copied from the football site's lib/espn-box.js at f53c92e. Two literals became options, and nothing else
// changed: the club (`team`, which was 'GB') and the clock the date is read
// on (`timeZone`, which was America/Chicago).

// The game's date where the club plays: ESPN gives UTC, and a night game is
// already tomorrow there. Sunday Night Football on the 18th is 00:20Z on the
// 19th.
function localDate(iso, timeZone) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
	const get = (t) => parts.find((p) => p.type === t)?.value;
	return `${get('year')}-${get('month')}-${get('day')}`;
}

// The categories in the order a football box score reads, and what to call
// them. ESPN sends the same ten, but its order is not this one in every
// summary, and its names are keys rather than headings.
const CATEGORIES = [
	['passing', 'Passing'],
	['rushing', 'Rushing'],
	['receiving', 'Receiving'],
	['fumbles', 'Fumbles'],
	['defensive', 'Defense'],
	['interceptions', 'Interceptions'],
	['kickReturns', 'Kick Returns'],
	['puntReturns', 'Punt Returns'],
	['kicking', 'Kicking'],
	['punting', 'Punting'],
];

// The team stats worth a row, in reading order. ESPN sends about 25,
// several of which say the same thing twice (yards per pass and net passing
// yards per pass); these are the ones a box score prints.
const TEAM_STATS = [
	'firstDowns', 'thirdDownEff', 'fourthDownEff', 'totalOffensivePlays', 'totalYards', 'yardsPerPlay',
	'netPassingYards', 'completionAttempts', 'yardsPerPass', 'sacksYardsLost',
	'rushingYards', 'rushingAttempts', 'yardsPerRushAttempt',
	'redZoneAttempts', 'totalPenaltiesYards', 'turnovers', 'fumblesLost', 'interceptions', 'possessionTime',
];

function team(c) {
	return {
		abbr: c.team?.abbreviation || '',
		name: c.team?.displayName || '',
		short: c.team?.shortDisplayName || c.team?.name || '',
		score: c.score ?? '',
		record: c.record?.[0]?.summary || '',
		quarters: (c.linescores || []).map((l) => l.displayValue ?? ''),
		winner: Boolean(c.winner),
		// For the field's end zones. Six hex digits or nothing: it lands in
		// an SVG attribute.
		color: /^[0-9a-f]{6}$/i.test(c.team?.color || '') ? c.team.color : '',
	};
}

// One play of a drive, for the field tracker (field-core.js). Spots are
// ESPN's yardLine: yards from the HOME team's goal line, whoever has the
// ball. "DAL 34" with Dallas visiting is 66; a kickoff from "GB 35" with
// Green Bay at home is 35. One coordinate for the whole field.
//
// A play where the ball changed hands mid-play has a third spot ESPN keeps
// only in its text: where the kick was fielded, the pass intercepted or the
// fumble recovered. ESPN's start is the line of scrimmage and its end where
// the return stopped, so drawn from start to end, "INTERCEPTED by
// E.Williams at GB 3. E.Williams to GB 20" showed as an arrow from the GB
// 17 to the GB 20 (18 October, 2nd quarter). This reads that spot.
//
// A reviewed play's text holds the call and then, after "REVERSED.", the
// play as it stands; the last description is the one that counts.
const SPOT = String.raw`(?:([A-Z]{2,3}) (\d{1,2})|(\d{1,2})|([A-Z]{2,3}) End Zone)`;
const VIA = [
	// The name runs to " at": names have periods (E.Williams, DAL-D.Lawrence),
	// so the stop is a comma or a parenthesis, never a period.
	new RegExp(String.raw`INTERCEPTED by [^,()]*? at ${SPOT}`, 'g'),
	new RegExp(String.raw`RECOVERED by [^,()]*? at ${SPOT}`, 'g'),
	new RegExp(String.raw`(?:kicks|punts) -?\d+ yards? (?:from [A-Z]{2,3} \d{1,2} )?to (?:the )?${SPOT}`, 'g'),
];

/** The yardLine (from the home goal line) where possession changed during
 *  a play, read from its text, or null when the text names none. */
export function changeOfPossessionSpot(text, homeAbbr, awayAbbr) {
	const toYardLine = (team, n, mid, endZone) => {
		if (mid != null) return Number(mid) === 50 ? 50 : null;
		if (endZone) return endZone === homeAbbr ? 0 : endZone === awayAbbr ? 100 : null;
		if (team === homeAbbr) return Number(n);
		if (team === awayAbbr) return 100 - Number(n);
		return null;
	};
	for (const re of VIA) {
		const all = [...String(text || '').matchAll(re)];
		const m = all.at(-1);
		if (m) return toYardLine(m[1], m[2], m[3], m[4]);
	}
	return null;
}

function drivePlay(p, sideOfTeamId, abbrs) {
	const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
	return {
		id: String(p.id || ''),
		quarter: p.period?.number ?? null,
		clock: p.clock?.displayValue || '',
		type: p.type?.abbreviation || '',
		typeText: p.type?.text || '',
		text: String(p.text || '').trim(),
		side: sideOfTeamId(p.start?.team?.id),
		from: num(p.start?.yardLine),
		to: num(p.end?.yardLine),
		// Where the ball changed hands on the way, when it did.
		via: changeOfPossessionSpot(p.text, abbrs.home, abbrs.away),
		yards: num(p.statYardage),
		down: p.start?.down ? (p.start.shortDownDistanceText || p.start.downDistanceText || '') : '',
		scoring: Boolean(p.scoringPlay),
		turnover: Boolean(p.isTurnover),
		penalty: Boolean(p.isPenalty),
	};
}

// ESPN lists the game's stoppages among a drive's plays: "Official Timeout
// at 11:13", the end of a quarter, the two-minute warning. They have spots
// and a down, and drawn as plays they read as a 1st & 10 for no gain.
const NOT_A_PLAY = /timeout|end (of )?(period|quarter|half|game|regulation)|two-minute warning|coin toss/i;
const isPlay = (p) => !NOT_A_PLAY.test(p.type?.text || '');

// The drive under way, or, between drives, the one that just ended: a
// live viewer wants to see how the last one finished until the next starts.
function liveDrive(summary, sideOfTeamId, abbrs) {
	const d = summary.drives?.current || summary.drives?.previous?.at(-1);
	const plays = (d?.plays || []).filter(isPlay);
	if (!plays.length) return null;
	return {
		current: Boolean(summary.drives?.current),
		side: sideOfTeamId(d.team?.id),
		summary: d.description || '',
		from: d.start?.text || '',
		result: summary.drives?.current ? '' : (d.displayResult || d.result || ''),
		plays: plays.map((p) => drivePlay(p, sideOfTeamId, abbrs)),
	};
}

// Where the ball is now: ESPN's situation when the summary has one (it
// often does not mid-game), else the last play's end spot.
//
// The scoreboard's situation is the fullest: it has each side's timeouts
// left, which the summary does not (its header has timeoutsUsed, and
// nothing says whether that resets at the half). The server passes it in
// when the game is on this week's scoreboard. Between plays ESPN often
// names nobody as having the ball (after a score it sent down -1 and no
// possession), so possession falls back to the summary header's flag and
// then to the team that ended the last play with it.
function liveSituation(summary, drive, sideOfTeamId, scoreboardSituation) {
	const sit = scoreboardSituation || summary.situation;
	const lastRaw = (summary.drives?.current?.plays || summary.drives?.previous?.at(-1)?.plays || []).filter(isPlay).at(-1);
	const end = lastRaw?.end || {};
	const headerBall = summary.header?.competitions?.[0]?.competitors?.find((c) => c.possession === true)?.team?.id;
	const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
	let out;
	if (sit && (sit.yardLine != null || sit.downDistanceText)) {
		const down = num(sit.down) > 0 ? num(sit.down) : 0;
		out = {
			yardLine: num(sit.yardLine),
			down,
			distance: down ? num(sit.distance) || 0 : 0,
			downDistance: down ? sit.downDistanceText || sit.shortDownDistanceText || '' : '',
			possession: sideOfTeamId(sit.possession) || sideOfTeamId(headerBall) || (drive ? sideOfTeamId(end.team?.id) : null),
			lastPlay: String(sit.lastPlay?.text || lastRaw?.text || '').trim(),
		};
	} else {
		if (!drive || !lastRaw) return null;
		out = {
			yardLine: num(end.yardLine),
			down: Number(end.down) || 0,
			distance: Number(end.distance) || 0,
			downDistance: end.downDistanceText || end.shortDownDistanceText || '',
			possession: sideOfTeamId(end.team?.id) || sideOfTeamId(headerBall),
			lastPlay: String(lastRaw.text || '').trim(),
		};
	}
	// Timeouts left this half, each side, when the scoreboard says.
	const away = num(sit?.awayTimeouts);
	const home = num(sit?.homeTimeouts);
	out.timeouts = away != null && home != null ? { away, home } : null;
	return out;
}

/**
 * The box score for the game page from ESPN's summary body, or null when it
 * has no game in it.
 *
 * `scoreboard` is this game's entry on the week's scoreboard (its
 * competitions[0]), which the server passes during a game. Its clock,
 * scores and situation win over the summary's: the summary has no timeouts
 * left, and the two are fetched apart, so a card that mixed them showed
 * the summary's 4:43 in its strip under the scoreboard's 4:39 (18 October,
 * 1st quarter). One source for everything live on a card.
 *
 * `club` is the club's abbreviation, for `teamSide`. Not `team`: that is this
 * module's own builder of a side, and an option of that name shadowed it, so
 * every box score threw and every game answered "Game not found".
 */
export function espnBoxscore(summary, { scoreboard = null, club = null, timeZone = 'America/New_York' } = {}) {
	const comp = summary?.header?.competitions?.[0];
	const awayC = comp?.competitors?.find((c) => c.homeAway === 'away');
	const homeC = comp?.competitors?.find((c) => c.homeAway === 'home');
	if (!awayC || !homeC) return null;
	const status = scoreboard?.status?.type || comp.status?.type || {};
	const away = team(awayC);
	const home = team(homeC);
	for (const c of scoreboard?.competitors || []) {
		const t = String(c.team?.id) === String(awayC.team?.id) ? away : String(c.team?.id) === String(homeC.team?.id) ? home : null;
		if (t && c.score != null) t.score = String(c.score?.displayValue ?? c.score);
	}
	const scoreboardSituation = scoreboard?.situation || null;
	const side = (abbr) => (abbr === home.abbr ? 'home' : abbr === away.abbr ? 'away' : null);

	const statsBy = (abbr) => new Map(((summary.boxscore?.teams || []).find((t) => t.team?.abbreviation === abbr)?.statistics || [])
		.map((s) => [s.name, s]));
	const awayStats = statsBy(away.abbr);
	const homeStats = statsBy(home.abbr);
	const teamStats = TEAM_STATS
		.filter((name) => awayStats.has(name) || homeStats.has(name))
		.map((name) => ({
			label: (awayStats.get(name) || homeStats.get(name)).label,
			away: awayStats.get(name)?.displayValue ?? '',
			home: homeStats.get(name)?.displayValue ?? '',
		}));

	const players = { away: [], home: [] };
	for (const p of summary.boxscore?.players || []) {
		const s = side(p.team?.abbreviation);
		if (!s) continue;
		const byName = new Map((p.statistics || []).map((c) => [c.name, c]));
		for (const [key, title] of CATEGORIES) {
			const c = byName.get(key);
			if (!c?.athletes?.length) continue;
			players[s].push({
				key, title,
				labels: c.labels || [],
				rows: c.athletes.map((a) => ({ name: a.athlete?.displayName || '', jersey: a.athlete?.jersey || '', stats: a.stats || [] })),
				totals: c.totals?.length ? c.totals : null,
			});
		}
	}

	const scoring = (summary.scoringPlays || []).map((p) => ({
		quarter: p.period?.number ?? null,
		clock: p.clock?.displayValue || '',
		side: side(p.team?.abbreviation),
		type: p.type?.abbreviation || '',
		text: p.text || '',
		away: p.awayScore ?? '',
		home: p.homeScore ?? '',
	}));

	const drives = (summary.drives?.previous || []).map((d) => ({
		side: side(d.team?.abbreviation),
		quarter: d.start?.period?.number ?? null,
		start: d.start?.clock?.displayValue || '',
		from: d.start?.text || '',
		summary: d.description || '',
		result: d.displayResult || d.result || '',
		score: Boolean(d.isScore),
	}));

	const live = status.state === 'in';
	const idSide = new Map([[String(awayC.team?.id), 'away'], [String(homeC.team?.id), 'home']]);
	const sideOfTeamId = (id) => idSide.get(String(id)) || null;
	const drive = live ? liveDrive(summary, sideOfTeamId, { home: home.abbr, away: away.abbr }) : null;
	const info = summary.gameInfo || {};
	const addr = info.venue?.address || {};
	return {
		id: String(comp.id || ''),
		final: Boolean(status.completed),
		live,
		state: status.state || '',
		status: status.shortDetail || status.detail || '',
		kickoff: comp.date || '',
		date: localDate(comp.date, timeZone),
		season: summary.header?.season?.year ?? null,
		seasonType: summary.header?.season?.type ?? null,
		week: summary.header?.week ?? null,
		venue: info.venue?.fullName || '',
		city: [addr.city, addr.state].filter(Boolean).join(', '),
		attendance: Number(info.attendance) || null,
		broadcast: comp.broadcasts?.[0]?.media?.shortName || '',
		teamSide: side(club),
		away, home,
		scoring, teamStats, players, drives,
		coverage: coverageOf({ away, home, scoring, drives, final: Boolean(status.completed) }),
		situation: live ? liveSituation(summary, drive, sideOfTeamId, scoreboardSituation) : null,
		drive,
		gameDay: null,
	};
}

/**
 * Which of a finished game's sections ESPN has whole. Its older games are
 * patchy, game by game rather than season by season: 1999 has no quarters,
 * scoring or drives, 2000 quarters only, and from 2001 most games are whole
 * but some are not (the 2003 opener, 30-25, has 2 scoring plays and 4
 * drives). Drawn as they are, a partial list reads as the whole game.
 *
 * The scoring plays are whole when the last one's running score is the
 * final score. The drives have no such check; a game has well over ten, so
 * fewer is taken as partial. A game being played is taken as it comes.
 */
export function coverageOf({ away, home, scoring, drives, final }) {
	if (!final) return { quarters: true, scoring: true, drives: true };
	const last = scoring.at(-1);
	const scoringWhole = Boolean(last) && String(last.away) === String(away.score) && String(last.home) === String(home.score);
	// A shutout of both sides has no scoring plays to have.
	const scoreless = String(away.score) === '0' && String(home.score) === '0';
	return {
		quarters: away.quarters.length > 0 && home.quarters.length > 0,
		scoring: scoringWhole || (scoreless && scoring.length === 0),
		drives: drives.length >= 10,
	};
}

/**
 * A finished game's box score with the sections ESPN's record lacks filled
 * from nflverse's play-by-play (lib/game-details.js; `details` is that
 * game's entry in data/packers_game_details.json, or nothing). ESPN's own
 * section is kept wherever it is whole, since its text reads better ("Jordan
 * Love 42 Yd pass to Christian Watson (Trey Smack Kick)"); `filled` names the
 * ones that came from play-by-play, for the page to say so.
 */
export function withDetails(box, details) {
	if (!box?.final || !box.coverage || !details) return box;
	const out = { ...box, coverage: { ...box.coverage }, filled: [] };
	for (const part of ['quarters', 'scoring', 'drives']) {
		if (out.coverage[part]) continue;
		if (part === 'quarters') {
			out.away = { ...out.away, quarters: details.quarters.away };
			out.home = { ...out.home, quarters: details.quarters.home };
		} else {
			out[part] = details[part];
		}
		out.coverage[part] = true;
		out.filled.push(part);
	}
	return out;
}

/** A past game's box score with what the games CSV knows of the day: the
 *  date where it was played (ESPN's old games carry a midnight-Eastern
 *  placeholder for a kickoff time, which is the day before in Central),
 *  the stadium, roof, surface, weather and referee. `row` is a parseGames
 *  row, or nothing.
 *
 *  And the final score, which the CSV has for every game and ESPN does not:
 *  its record of Green Bay at Jacksonville, 3 December 2001 (28-21), says
 *  0-0, against which its empty scoring list looked whole. The sections'
 *  coverage is checked again against the CSV's score. */
export function withGameDay(box, row) {
	if (!box || !row) return box;
	let { away, home, coverage } = box;
	const them = box.teamSide === 'home' ? 'away' : 'home';
	const score = { [box.teamSide]: row.scoreFor, [them]: row.scoreAgainst };
	if (box.final && box.teamSide && score.away !== '' && score.home !== '' && score.away != null && score.home != null
		&& (String(away.score) !== String(score.away) || String(home.score) !== String(score.home))) {
		const [a, h] = [Number(score.away), Number(score.home)];
		away = { ...away, score: String(score.away), winner: a > h };
		home = { ...home, score: String(score.home), winner: h > a };
		coverage = coverageOf({ away, home, scoring: box.scoring, drives: box.drives, final: true });
	}
	return {
		...box,
		away,
		home,
		coverage,
		date: box.final && row.date ? row.date : box.date,
		venue: box.venue || row.stadium || '',
		gameDay: {
			stadium: row.stadium || '',
			roof: row.roof || '',
			surface: row.surface || '',
			temp: row.temp || '',
			wind: row.wind || '',
			referee: row.referee || '',
		},
	};
}
