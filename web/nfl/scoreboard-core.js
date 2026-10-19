// The scoreboard's word on a game, laid over the team schedule's.
//
// ESPN's team schedule lags its scoreboard at kickoff. On 18 October 2026
// at 7:22 PM Central the scoreboard and the game summary both had Dallas at
// Green Bay in progress (15:00 1st, coin toss done) while the schedule
// still said STATUS_SCHEDULED, and the home page, which decided "live" from
// the schedule alone, showed no live game. The scoreboard is the live
// source, so for every game it carries, its status, scores and situation
// win. The schedule stays the list of games: the scoreboard covers one
// week.
//
// Pure: no fetch, no DOM.

/** `events` from the team schedule, with the scoreboard's version of any
 *  game it also has. Returns new objects; the inputs are not changed. */
export function withScoreboard(events, scoreboard) {
	const live = new Map((scoreboard?.events || []).map((e) => [String(e.id), e]));
	if (!live.size) return events;
	return events.map((event) => {
		const sb = live.get(String(event.id));
		const sc = sb?.competitions?.[0];
		const comp = event.competitions?.[0];
		if (!sc || !comp) return event;
		const scoreOf = new Map((sc.competitors || []).map((c) => [String(c.team?.id), c.score]));
		return {
			...event,
			competitions: [{
				...comp,
				status: sc.status || comp.status,
				situation: sc.situation ?? comp.situation,
				// The schedule's score is { value, displayValue }; the
				// scoreboard's is a string. The page reads either.
				competitors: (comp.competitors || []).map((c) => {
					const s = scoreOf.get(String(c.team?.id));
					return s == null ? c : { ...c, score: { value: Number(s), displayValue: String(s) } };
				}),
			}, ...(event.competitions.slice(1))],
		};
	});
}
