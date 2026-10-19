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

	/** What the front page said as literals on arethebrewersontv.com, and is
	 *  genuinely this club's (lib/web.js clubConfig). Whether the page asks
	 *  "On TV?" is not here: it follows from data/clubs/mlb/brewers/ having
	 *  channel listings, and the park's names over time are curated data in
	 *  data/clubs/mlb/brewers/park_names.json rather than manifest lines. */
	site: {
		emoji: '🍺',
		hashtag: '#ThisIsMyCrew',
		/** The clock the TV listings and simulcast dates are kept in. */
		timeZone: 'America/Chicago',
		providerExamples: 'Xfinity, Spectrum, TDS',
	},
};

export default team;
