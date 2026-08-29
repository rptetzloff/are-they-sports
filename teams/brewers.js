/** Milwaukee Brewers. */
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
		scoreNoun: 'runs',
		scoreForLabel: 'Runs Scored',
		scoreAgainstLabel: 'Runs Allowed',
		championship: 'World Series',
		leaderNoun: 'manager',
		leaderPlural: 'managers',
		meetingNoun: 'clash',
		/** Not meetingNoun + 's'. That gives "clashs". */
		meetingPlural: 'clashes',
		losslessSeasonNoun: 'undefeated',
	},

	rules: {
		/** Streaks end at the season boundary here and span them in football.
		 *  Across 162 games the within-season run is the record anyone quotes;
		 *  across 17 the cross-season one is. */
		streaksSpanSeasons: false,
		/** Of every MLB season above .700, two have happened since 1955. */
		losslessSeasonIsPlausible: false,
		/** Exact date. Across fifty-odd seasons of near-daily baseball there is
		 *  almost always a game on today's date; football needs three days
		 *  either side or the panel is empty most of the year. */
		onThisDayWindowDays: 0,
	},

	/** Taken from the live stylesheet, where #ffc52f appears 111 times. Note it
	 *  is NOT the football site's #ffb612 — near enough to look like a rounding
	 *  error and different enough to be wrong. */
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
