/** Resolving a club against its sport.
 *
 *  A team manifest used to carry every noun and every rule, which made it about
 *  sixty lines of which roughly fifty said the same thing every other club in
 *  that league would say. "Points" is not a fact about the Packers; it is a fact
 *  about football, and so are Super Bowl, coach, meeting, and whether streaks
 *  span seasons.
 *
 *  So the sport carries defaults and the club overrides what is genuinely its
 *  own — its name, its colours, and the thing it shouts before the season
 *  starts. Adding a club is now about a dozen lines.
 *
 *  This is a narrowing of the rule in CLAUDE.md, not an abandonment of it: the
 *  team manifest is still data and still the only place a club is described.
 *  What changed is that the defaults live one level up instead of being copied
 *  into every file, which is the same reason the two sites were merged in the
 *  first place.
 *
 *  Overriding stays possible for every field, because the moment it is not,
 *  some club will need it. `losslessSeasonNoun` is the live example: it is a
 *  sport default today, and the day someone builds the 1972 Dolphins it becomes
 *  "perfect" for that one club.
 */

/** Every noun a page reads. A club missing one renders "undefined" in a
 *  sentence, which has already happened once on the football site. */
export const REQUIRED_NOUNS = [
	'team', 'fullName', 'scoreNoun', 'scoreForLabel', 'scoreAgainstLabel',
	'championship', 'leaderNoun', 'leaderPlural', 'meetingNoun', 'meetingPlural',
	'losslessSeasonNoun',
];

export const REQUIRED_RULES = ['streaksSpanSeasons', 'losslessSeasonIsPlausible', 'onThisDayWindowDays'];

/** Merge a club onto its sport's defaults and check the result is whole.
 *
 *  Validation happens here rather than at first use, because the failure it
 *  prevents is a missing noun reaching a page as the word "undefined" — and by
 *  then nothing throws, no test fails, and the only signal is somebody reading
 *  the sentence.
 */
export function resolveTeam(team, sport) {
	const defaults = sport.defaults ?? {};
	const resolved = {
		...team,
		sport: sport.id,
		nouns: { ...defaults.nouns, ...team.nouns },
		rules: { ...defaults.rules, ...team.rules },
		copy: { ...defaults.copy, ...team.copy },
	};

	const missing = [];
	for (const n of REQUIRED_NOUNS) {
		if (typeof resolved.nouns[n] !== 'string' || !resolved.nouns[n]) missing.push(`nouns.${n}`);
	}
	for (const r of REQUIRED_RULES) {
		if (resolved.rules[r] === undefined) missing.push(`rules.${r}`);
	}
	// Booleans checked by type, because a missing rule and a rule declared false
	// are the same value to `if` and opposite facts.
	for (const r of ['streaksSpanSeasons', 'losslessSeasonIsPlausible']) {
		if (r in resolved.rules && typeof resolved.rules[r] !== 'boolean') missing.push(`rules.${r} (not a boolean)`);
	}
	// The cheer is derived when a club has not declared one. "GO PACKERS" is
	// weaker than "GO PACK GO" and is not wrong, which is the right trade for
	// adding thirty clubs: a manifest that must invent a chant per club is a
	// manifest nobody writes, and a wrong chant is worse than a plain one.
	resolved.copy = {
		seasonNotStarted: `GO ${resolved.nouns.team.toUpperCase()}`,
		...resolved.copy,
	};
	if (!Array.isArray(resolved.sourceIds) || !resolved.sourceIds.length) missing.push('sourceIds');
	// Colours are NOT required. They come from the franchise history table for
	// the era being rendered, which covers every club including the defunct
	// ones; a manifest only carries them to override that.

	if (missing.length) {
		throw new Error(`team "${team.id}" is missing ${missing.join(', ')}`);
	}
	return resolved;
}
