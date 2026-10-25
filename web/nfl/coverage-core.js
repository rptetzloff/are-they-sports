// Whether a viewer's TV market has a game, from that week's coverage
// (lib/coverage.js reads it from 506sports' maps and serves it as
// api/coverage). Shared with the server, which matches the same names.
// Pure functions only.

/** The two sides of "Cincinnati @ Baltimore" or "Baltimore vs Dallas (in Rio de Janeiro)". */
export const sidesOf = (matchup) => String(matchup).replace(/\s*\(.*\)\s*$/, '').split(/\s+(?:@|vs\.?)\s+/i).map((s) => s.trim());

/** Whether a 506sports name ("NY Jets", "LA Rams", "Green Bay") is this club,
 *  by its full name ("New York Jets"). */
export function nameMatches(side, fullName) {
	const s = String(side).trim().toLowerCase();
	const full = String(fullName).toLowerCase();
	const nick = full.split(' ').at(-1);
	const place = full.slice(0, full.length - nick.length).trim();
	const short = place.replace(/^new york$/, 'ny').replace(/^los angeles$/, 'la');
	return s === place || s === `${short} ${nick}` || s === `${place} ${nick}` || s === nick;
}

/** Whether a matchup is this ESPN event, by both clubs. */
export function matchupIs(matchup, event) {
	const names = (event?.competitions?.[0]?.competitors ?? []).map((c) => c.team?.displayName ?? '');
	const sides = sidesOf(matchup);
	return names.length === 2 && sides.length === 2 && sides.every((s) => names.some((n) => nameMatches(s, n)));
}

/** What the week's coverage says of this game for a market (`dma`, or null
 *  when the viewer has not said where they are):
 *
 *  - { regional, network, carried, other, map } for a regional CBS or FOX
 *    game: `carried` is true or false where the market is known (null where it
 *    is not), and `other` the game its station has instead;
 *  - { simulcast, stations } for a national game simulcast over the air in
 *    the home markets: `simulcast` is the market's station, or null;
 *  - null for a national game every station has, or a week with no maps.
 */
export function coverageOf(coverage, event, dma = null) {
	if (!coverage || !event) return null;
	for (const w of coverage.regional ?? []) {
		if (!(w.games ?? []).some((m) => matchupIs(m, event))) continue;
		// A window of one game is every station's (CBS's single late game).
		if (w.games.length < 2) return null;
		const mine = dma ? w.byDma?.[dma] : undefined;
		return {
			regional: true, network: w.network, map: w.map ?? coverage.url,
			carried: mine === undefined ? null : matchupIs(mine, event),
			other: mine && !matchupIs(mine, event) ? mine : null,
		};
	}
	const n = (coverage.national ?? []).find((g) => matchupIs(g.matchup, event));
	if (n?.simulcasts?.length) {
		const s = dma ? n.simulcasts.find((x) => x.market.toLowerCase() === dma.toLowerCase()) : null;
		return { simulcast: s ? `${s.call}/${s.net}` : null, station: s ?? null, stations: n.simulcasts, map: coverage.url };
	}
	return null;
}
