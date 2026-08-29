/** Detroit Lions. */
export const team = {
	sport: 'nfl',
	id: 'lions',
	/** DET throughout, checked rather than assumed. The franchise began as the
	 *  Portsmouth Spartans in 1930, and a first draft of this file listed POR
	 *  alongside DET on that basis — the seed data has no POR at all and codes
	 *  DET from 1930, so the extra id would have matched nothing. */
	sourceIds: ['DET'],
	firstSeason: 1930,
	nouns: { team: 'Lions', fullName: 'Detroit Lions' },
	colors: { accent: '#0076b6', base: '#1a1a1a', baseDeep: '#0d0d0d' },
	copy: { seasonNotStarted: 'ONE PRIDE' },
};

export default team;
