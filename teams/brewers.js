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

	/** From the live stylesheet, where #ffc52f appears 111 times. Note it is NOT
	 *  the football site's #ffb612 — near enough to look like a rounding error
	 *  and different enough to be wrong. */
	colors: {
		accent: '#ffc52f',
		base: '#12284b',
		baseDeep: '#1a3558',
	},

	copy: {
		seasonNotStarted: 'GO BREW CREW',
	},
};

export default team;
