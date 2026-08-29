/** Green Bay Packers.
 *
 *  A team manifest is data, never code. It carries three kinds of thing:
 *
 *    identity   which sport, which club, what the source data calls them
 *    words      the vocabulary the pages use, because substitution is not
 *               translation — "clash" plus "s" is "clashs", and "Points For"
 *               and "Runs Scored" are not one phrase with a different noun
 *    rules      where two sports genuinely disagree about what counts
 *
 *  Anything that has to branch in code rather than resolve from here is a sign
 *  the seam is in the wrong place.
 */
export const team = {
	sport: 'nfl',
	id: 'packers',

	/** What the source data calls this club. A list because franchises move and
	 *  rename — the Brewers need MIL and SE1 for the Seattle Pilots season. */
	sourceIds: ['GB'],

	/** The seasons this club has existed, used to bound fetching. The Packers
	 *  predate every play-by-play source by eighty years, so results go back to
	 *  1921 and scoring plays begin whenever the source does. */
	firstSeason: 1921,

	nouns: {
		team: 'Packers',
		fullName: 'Green Bay Packers',
		scoreNoun: 'points',
		scoreForLabel: 'Points For',
		scoreAgainstLabel: 'Points Against',
		championship: 'Super Bowl',
		leaderNoun: 'coach',
		leaderPlural: 'coaches',
		meetingNoun: 'meeting',
		meetingPlural: 'meetings',
		/** In football, *perfect* means no losses and no ties — 1972 Miami and
		 *  nobody else. 1929 went 12-0-1: undefeated, not perfect. The site is
		 *  named for the distinction. */
		losslessSeasonNoun: 'undefeated',
	},

	rules: {
		/** Streaks run across season boundaries here. The longest, 15 games, ran
		 *  from December 2010 into December 2011, and ending it at the boundary
		 *  would erase the record the list exists to show. Baseball does the
		 *  opposite, on purpose. */
		streaksSpanSeasons: true,
		/** A season with no losses is a plausible thing to look for in a
		 *  17-game sport. */
		losslessSeasonIsPlausible: true,
		/** How far either side of today "on this day" looks. Three days, because
		 *  a sport playing seventeen games a year has empty calendar dates by
		 *  the hundred and an exact match would hide the panel most days. */
		onThisDayWindowDays: 3,
	},

	/** Brand colours, as values rather than literals in a stylesheet.
	 *
	 *  The two sites carry 282 hardcoded hex literals between them and not one
	 *  custom property, and comparing their palettes showed the status colours
	 *  were already identical — a win is #4caf50 on both. Only the brand values
	 *  differ, which makes a palette team vocabulary and puts it here.
	 *
	 *  Taken from the live stylesheet: #ffb612 appears 64 times in it.
	 */
	colors: {
		accent: '#ffb612',
		base: '#203731',
		baseDeep: '#1a2e28',
	},

	copy: {
		/** The answer before the first regular-season game. Not YES, which is
		 *  hollow, and emphatically not NO, which is what it said about a team
		 *  that had not lost. */
		seasonNotStarted: 'GO PACK GO',
	},
};

export default team;
