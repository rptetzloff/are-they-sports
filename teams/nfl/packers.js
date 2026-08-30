/** Green Bay Packers.
 *
 *  A team manifest is data, never code, and carries only what is genuinely this
 *  club's: who they are in the source data, what they are called, their colours,
 *  and what they shout before the season starts.
 *
 *  Everything else — points, Super Bowl, coach, meeting, whether streaks span
 *  seasons — comes from `sports/nfl.js`, because those are facts about football
 *  rather than about Green Bay. Any of them can be overridden here when a club
 *  genuinely differs; see lib/manifest.js.
 *
 *  This file used to be sixty lines, of which about fifty said what every NFL
 *  club would say.
 */
export const team = {
	sport: 'nfl',
	id: 'packers',

	/** What the source data calls this club. A list because franchises move and
	 *  rename, and because the two football sources disagree — the Rams are LAR
	 *  in the FiveThirtyEight era and LA in the nflverse era. */
	sourceIds: ['GB'],

	/** The seasons this club has existed, used to bound fetching. The Packers
	 *  predate every play-by-play source by eighty years. */
	firstSeason: 1921,

	nouns: {
		team: 'Packers',
		fullName: 'Green Bay Packers',
	},


	copy: {
		/** The answer before the first regular-season game. Not YES, which is
		 *  hollow, and emphatically not NO, which is what it said about a team
		 *  that had not lost. */
		seasonNotStarted: 'GO PACK GO',
	},
};

export default team;
