/** ESPN's MLS, in the shape the baseball-family front page reads.
 *
 *  ESPN serves soccer differently from the other sports, and the page asks of
 *  it what it asks of all of them: a club's schedule by season type (1, 2, 3)
 *  and the postseason's games with a note naming each one's round. For MLS:
 *
 *    - a club's schedule is its RESULTS; the games still to come are a second
 *      request (`fixture=true`), with their broadcasts;
 *    - the season types are not 1, 2 and 3 but ids like 13846, and asking for
 *      type 2 or 3 returns nothing, so the season type is set here;
 *    - a playoff game is in no club's schedule at all, only on the scoreboard,
 *      and its round is in the season's slug ("western-conference-playoffs---
 *      round-one", "mls-cup"); its note says who won the series, not what the
 *      round was.
 *
 *  So the server asks for those and answers the page's question with them:
 *  regular season events typed 2, playoff events typed 3 and given the notes
 *  the other sports' carry ("East Round One - Game 2"). Pure: no fetch.
 */

/** A playoff round's name, and the conference, from ESPN's season slug; null
 *  for anything not a playoff game. Wild Card, Round One, Conference
 *  Semifinal, Conference Final, MLS Cup: the names MLS has used since 2023,
 *  the only seasons the page reads from ESPN. */
export function playoffRoundOf(slug) {
	const s = String(slug ?? '');
	if (/mls-cup/.test(s)) return { round: 'MLS Cup', conference: '' };
	if (!/playoffs/.test(s)) return null;
	const conference = /^eastern/.test(s) ? 'East' : /^western/.test(s) ? 'West' : '';
	const round = /wild-card/.test(s) ? 'Wild Card'
		: /round-one|first-round/.test(s) ? 'Round One'
			: /semifinal/.test(s) ? 'Conference Semifinal'
				: /final/.test(s) ? 'Conference Final' : null;
	return round ? { round, conference } : null;
}

/** An event with its status in the words the page reads. ESPN's soccer says
 *  STATUS_FULL_TIME, STATUS_FINAL_PEN, STATUS_FIRST_HALF, STATUS_HALFTIME
 *  where every other sport says STATUS_FINAL or STATUS_IN_PROGRESS, and the
 *  page looks for those; read as they come, every finished game was
 *  unfinished and the record was 0-0-0. ESPN's short detail stays ("FT",
 *  "FT-Pens", "45'+2'"), and so does a postponement's own status. */
export function withPageStatus(event) {
	const comp = event?.competitions?.[0];
	const type = comp?.status?.type;
	if (!type) return event;
	const name = type.completed ? 'STATUS_FINAL'
		: type.state === 'in' ? (type.name === 'STATUS_HALFTIME' ? 'STATUS_HALFTIME' : 'STATUS_IN_PROGRESS')
			: type.state === 'pre' ? 'STATUS_SCHEDULED' : type.name;
	return { ...event, competitions: [{ ...comp, status: { ...comp.status, type: { ...type, name } } }, ...(event.competitions.slice(1))] };
}

const scoreOf = (c) => {
	const v = c?.score?.value ?? c?.score?.displayValue ?? c?.score;
	return v === undefined || v === null || v === '' ? null : Number(v);
};

/** Who won a finished game: the higher score, else the higher shootout, as
 *  the database decides it (db/migrations/0016). Null for a draw or a game
 *  not finished. */
export function winnerOf(event) {
	const comp = event?.competitions?.[0];
	if (!comp?.status?.type?.completed) return null;
	const [a, b] = comp.competitors ?? [];
	if (!a || !b) return null;
	const [sa, sb] = [scoreOf(a), scoreOf(b)];
	if (sa !== sb) return sa > sb ? a : b;
	if (a.shootoutScore != null && b.shootoutScore != null && Number(a.shootoutScore) !== Number(b.shootoutScore)) {
		return Number(a.shootoutScore) > Number(b.shootoutScore) ? a : b;
	}
	return null;
}

/** The postseason's games from scoreboard events, oldest first, each typed 3
 *  with a note naming its round and its number in its series, and each side's
 *  `winner` set by the rule above (ESPN's own flag is not set on a shootout's
 *  winner). */
export function playoffEvents(events) {
	const seen = new Set();
	const games = [];
	for (const e of events ?? []) {
		const r = playoffRoundOf(e?.season?.slug);
		if (!r || seen.has(String(e.id))) continue;
		seen.add(String(e.id));
		games.push({ e, r });
	}
	games.sort((x, y) => Date.parse(x.e.date) - Date.parse(y.e.date));
	const count = new Map();
	return games.map(({ e, r }) => {
		const comp = e.competitions[0];
		const pair = (comp.competitors ?? []).map((c) => String(c.team?.id ?? c.id)).sort().join('|');
		const n = (count.get(pair) ?? 0) + 1;
		count.set(pair, n);
		const won = winnerOf(e);
		const head = [r.conference, r.round].filter(Boolean).join(' ');
		return withPageStatus({
			...e,
			season: { ...e.season, type: 3 },
			competitions: [{
				...comp,
				notes: [{ headline: r.round === 'Round One' ? `${head} - Game ${n}` : head }],
				competitors: (comp.competitors ?? []).map((c) => ({ ...c, winner: won ? c === won : false })),
			}],
		});
	});
}

/** A club's schedule for one season type, as the other sports' come: results
 *  and fixtures for the regular season (2), its playoff games (3), nothing
 *  for the preseason (1), which ESPN does not list for MLS. `teamId` is
 *  ESPN's id for the club. */
export function soccerSchedule({ type, season, results = [], fixtures = [], playoffs = [], teamId }) {
	let events = [];
	if (Number(type) === 2) {
		const byId = new Map();
		for (const e of [...results, ...fixtures]) {
			if (playoffRoundOf(e?.season?.slug)) continue;
			byId.set(String(e.id), withPageStatus({ ...e, season: { ...e.season, type: 2 } }));
		}
		events = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
	} else if (Number(type) === 3) {
		events = playoffs.filter((e) => (e.competitions?.[0]?.competitors ?? []).some((c) => String(c.team?.id ?? c.id) === String(teamId)));
	}
	const name = { 1: 'Preseason', 2: 'Regular Season', 3: 'Postseason' }[Number(type)] ?? '';
	return { events, season: { year: Number(season), type: Number(type), name }, requestedSeason: { year: Number(season), type: Number(type), name } };
}
