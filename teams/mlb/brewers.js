/** Milwaukee Brewers. Vocabulary and rules come from sports/mlb.js. */
export const team = {
	sport: 'mlb',
	id: 'brewers',

	/** Two codes, because the franchise spent 1969 in Seattle as the Pilots.
	 *  This is why sourceIds is a list on every team rather than a string. */
	sourceIds: ['MIL', 'SE1'],
	firstSeason: 1969,

	nouns: {
		team: 'Brewers',
		fullName: 'Milwaukee Brewers',
	},


	copy: {
		seasonNotStarted: 'GO BREW CREW',
	},
};

export default team;
