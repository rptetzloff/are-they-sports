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


	/** An override, because Retrosheet publishes no colours.
	 *
	 *  Football clubs no longer carry these: data/reference/nfl-franchise-history.csv
	 *  gives every franchise's colours per era, so a 1950s Packers page renders
	 *  in the green they used then. Baseball has no equivalent, so this stays
	 *  hand-written until it does — which is the whole point of a manifest being
	 *  allowed to override rather than only to declare.
	 *
	 *  From the live stylesheet, where #ffc52f appears 111 times. Note it is NOT
	 *  the football site's #ffb612 — near enough to look like a rounding error
	 *  and different enough to be wrong.
	 */
	colors: {
		accent: '#ffc52f',
		base: '#12284b',
	},

	copy: {
		seasonNotStarted: 'GO BREW CREW',
	},
};

export default team;
