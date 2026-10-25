// What this site calls things.
//
// Everything here is a value rather than a rule. The compute functions in
// records-core.js and h2h-core.js work out what happened; this decides how it
// is said. Splitting them is what lets the same computation serve a baseball
// site and a football one — the Packers repo has a file of this shape and a
// different set of answers, and the diff between the two is the whole list of
// what a shared core has to be told rather than assume.
//
// Pure data, no imports. It has to be readable from the browser, from the
// server and from a test without dragging anything with it.
//
// Three kinds of thing live here, and they are different:
//
//   nouns    what to call the team, the sport's units, its championship
//   rules    where two sports genuinely disagree about what counts
//   copy     lines a template gets wrong, kept as words rather than derived
//
// The third is the largest section here, and larger than the football site's,
// which is itself the point. Baseball has more records that have never
// happened, and "The Brewers have never thrown a no-hitter" is a sentence no
// template would produce and no other sport would want.
//
// IN are-they-sports: one club's values became the club's. This file serves
// every baseball club, so who the club is arrives as `window.CLUB`, which the
// server writes into the page from the club's manifest before any module runs
// (lib/web.js). Everything that is a fact about BASEBALL stays here exactly as
// the Brewers site has it, so the page reads the same words it always did.
//
// On the server there is no window, and nothing the server imports through
// this file reads a club field; the fallbacks below only keep that import from
// throwing. A page missing CLUB is a server bug, and the line below says so in
// the console, because the page will be reading "Team" where a name should be.
const CLUB = globalThis.CLUB ?? { team: 'Team', fullName: 'Team', teamIds: [], copy: {}, site: {} };
if (typeof window !== 'undefined' && !globalThis.CLUB) console.error('site.js: window.CLUB is missing; the server did not describe the club');
const T = CLUB.team;

export const SITE = {
	// --- identity ---

	/** Short name, used mid-sentence and in titles. */
	team: CLUB.team,
	/** Full name, used the first time in a description so a search result reads
	 *  as a whole thought rather than a fragment. */
	fullName: CLUB.fullName,

	// --- the sport's vocabulary ---

	/** What a score is made of. This is the field the football site sets to
	 *  'points', and it is why "runs for / runs against" cannot be a fixed
	 *  string anywhere below. */
	scoreNoun: 'runs',
	/** The chart's two metric labels, spelled out rather than derived.
	 *
	 *  Deriving them from scoreNoun was the first attempt and it is wrong:
	 *  this sport says "Runs Scored / Runs Allowed" and football says "Points
	 *  For / Points Against" — different verbs, not just different nouns. The
	 *  same lesson as meetingPlural. */
	scoreForLabel: 'Runs Scored',
	scoreAgainstLabel: 'Runs Allowed',
	/** The trophy. */
	championship: 'World Series',
	/** What the person in charge is called — and the whole reason this site has
	 *  managers.html where the other has coaches.html. Same concept, same
	 *  computation, different noun. */
	leaderNoun: 'manager',
	leaderPlural: 'managers',
	/** What a season finished without a loss would be called.
	 *
	 *  Present for shape rather than for use: this site computes perfectSeasons
	 *  and publishes no card for it, because across 162 games the answer is
	 *  always the same and always empty. The football site does publish one —
	 *  1929 Green Bay went 12–0–1 — and calls it Undefeated, since "perfect"
	 *  there means no losses and no ties. */
	losslessSeasonNoun: 'Undefeated',
	/** What a single game against an opponent is called, and its plural.
	 *
	 *  The plural is spelled out rather than derived, because English does not
	 *  add 's' reliably and a sport saying "clashes" would get "clashs" from
	 *  the obvious implementation. */
	meetingNoun: 'meeting',
	meetingPlural: 'meetings',

	/** Which team this deployment is about, as the codes its data uses.
	 *
	 *  Two, because the franchise has been two teams: the 1969 Seattle Pilots
	 *  (SE1) became the Brewers (MIL) in 1970. A row under either is a row about
	 *  this club, and dropping SE1 loses the first season entirely.
	 *
	 *  This is the field that makes the code servable for another franchise: the
	 *  parser selects rows by these ids out of data that describes a whole
	 *  league, so a different team is a different value here rather than a
	 *  different parser. */
	teamIds: CLUB.teamIds,

	/** Home park names over time, by Retrosheet park id, for parks that were
	 *  renamed. ballparks.csv carries one name per park — "Miller Park" for
	 *  MIL06 to this day — so a 2023 game would have been at a park that no
	 *  longer had that name. A game takes the name in use on its date; the
	 *  last entry is the current name. Curated: no upstream publishes it. */
	parkNames: CLUB.site.parkNames ?? {},

	// --- rules, not words ---

	/** Whether a win streak may continue across a season boundary.
	 *
	 *  False here and true for football, and both are right. Across 162 games
	 *  the within-season run is the record anyone quotes; seventeen games make
	 *  the cross-season one the record worth having, and the Packers' longest
	 *  ran from December 2010 into December 2011.
	 *
	 *  This is the one place the two sites' compute functions genuinely
	 *  disagree today — the streak loop here ends a run when the season
	 *  changes, and theirs does not. Naming it turns "never merge these two
	 *  implementations" into one implementation told which sport it serves.
	 *  Until that merge happens this value documents the difference rather
	 *  than driving it. */
	streaksSpanSeasons: false,

	/** Whether a season with no losses is a plausible thing to look for.
	 *  False across 162 games, which is why there is no card for it. */
	perfectSeasonIsPlausible: false,

	/** How far either side of today's calendar date "on this day" will look.
	 *
	 *  Zero here: across 50-odd seasons of near-daily baseball there is almost
	 *  always a game on the exact date, so widening it would only dilute the
	 *  panel. The football site uses 3, because a sport playing seventeen games
	 *  a year has empty calendar dates by the hundred and an exact match would
	 *  leave the panel hidden most of the time.
	 *
	 *  Same function, same code path, one number — which is the shape every
	 *  difference between these two sites should end up in. */
	onThisDayWindowDays: 0,

	// --- which records this sport has ---

	/** The record cards this site publishes, in display order.
	 *
	 *  Twenty against the football site's seven, and the extra thirteen are the
	 *  argument for this field existing. No-hitters, perfect games, cycles and
	 *  triple plays have no football counterpart at all; a shared core computes
	 *  what it is asked for, and this is the asking. Asking for a no-hitter is
	 *  how "The Packers have never thrown a no-hitter" gets published. */
	records: [
		'best-seasons',
		'worst-seasons',
		'best-team-era',
		'worst-team-era',
		'best-pitcher-era',
		'worst-pitcher-era',
		'best-starts',
		'worst-starts',
		'win-streaks',
		'losing-streaks',
		'lopsided-wins',
		'worst-losses',
		'no-hitters',
		'perfect-games',
		'most-hr-game',
		'player-hr-game',
		'player-rbi-game',
		'cycles',
		'playoff-appearances',
		'best-playoff-runs',
		'world-series-appearances',
		'player-error-game',
		'team-error-game',
		'triple-plays',
		'ties',
	],

	// --- copy a template would get wrong ---

	/** Lines that carry voice or a sport-specific fact, kept as sentences.
	 *
	 *  Most of these are "has never happened yet" fallbacks, and there are more
	 *  of them here than on the football site because baseball has more records
	 *  a team can go a franchise's lifetime without setting. Each is written to
	 *  be read rather than assembled. */
	copy: {
		/** Both true as of 2025, and both the kind of sentence that has to read
		 *  as a fact rather than as an empty list. */
		noWorldSeries: `The ${T} have not yet reached a World Series.`,
		noPlayoffs: `The ${T} have not yet reached the playoffs.`,
		/** Tone. The "Sure." is doing the work. */
		noLosingStreak: `The ${T} have never lost consecutive games. Sure.`,
		noTies: `The ${T} have never tied a game.`,
		noNoHitter: `The ${T} have never thrown a no-hitter.`,
		noPerfectGame: `The ${T} have never thrown a perfect game.`,
		noTriplePlay: `The ${T} have never turned a triple play.`,
		/** Tone, shared word-for-word with the football site — which is a hint
		 *  that it may belong in a default rather than in both manifests. Left
		 *  duplicated for now: two instances is where a pattern becomes
		 *  visible, not where it should be abstracted. */
		worstLossAside: "We don't talk about it.",
		worstStartAside: 'It happens to the best of us.',
		...CLUB.copy,
	},

	// --- the front page, from the club's manifest (lib/web.js clubConfig) ---
	...CLUB.site,
}

/** The default export every module reaches for. Kept as a named constant too
 *  so a test can build a different one and pass it in. */
export default SITE
