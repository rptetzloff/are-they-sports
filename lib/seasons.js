/** A season's name, as a club page's calendar names it (Ray, 2026-10-27:
 *  "fix it everywhere"). A season played across two years is named for both
 *  ("2026-2027": basketball and hockey, whose seasons are numbered by the year
 *  they end); every other by its one year. Each sport's front end says the
 *  same in its site.js seasonLabel, and test/seasons.test.js holds the two
 *  equal. The paths keep the number: /nba/standings/2027. */

/** The sports whose seasons span two years. */
export const SPLIT_SEASONS = new Set(['nba', 'nhl', 'ncaam', 'ncaaw', 'ncaah']);

/** The sports with an NCAA tournament drawn as a bracket (lib/bracket.js). */
export const BRACKETED = new Set(['ncaam', 'ncaaw', 'ncaah']);
/** Those of them with an invitational of their own. */
export const HAS_NIT = new Set(['ncaam', 'ncaaw']);

export const seasonName = (sport, season) => (season == null || season === '' ? ''
	: SPLIT_SEASONS.has(sport) ? `${Number(season) - 1}-${season}` : String(season));

/** A run of seasons, as the club pages' coaches and history name one:
 *  "1967–2026" for basketball's 1967-1968 to 2025-2026, the first season's
 *  first year to the last's last; "2001–2005" for baseball's. One season is
 *  its name. */
export const seasonSpan = (sport, first, last) => (first === last ? seasonName(sport, first)
	: `${SPLIT_SEASONS.has(sport) ? Number(first) - 1 : first}–${last}`);

/** `seasonName` for one sport, or the plain number where the page holds
 *  several (the All tab), which have no one way to name a season. */
export const seasonNamer = (sport) => (sport ? (season) => seasonName(sport, season) : (season) => (season == null ? '' : String(season)));
