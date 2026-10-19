// Every game, for a page: the games CSV plus the season being played from
// ESPN (/api/current/games.csv, built by lib/current-season.js), pooled as the
// server pools them (poolCurrentSeason in records-core.js). Without the
// second, because ESPN or the network failed, the page counts the file
// alone, which lags the season by however long since it was last updated.
import { parseGames, poolCurrentSeason } from './records-core.js';

/** { games, fileGames }: `games` with the season being played counted,
 *  `fileGames` the CSV's rows as they are. */
export async function loadGames() {
	const [fileRes, curRes] = await Promise.all([
		fetch('/data/games.csv'),
		fetch('/api/current/games.csv').catch(() => null),
	]);
	if (!fileRes.ok) throw new Error(`games CSV: HTTP ${fileRes.status}`);
	const fileGames = parseGames(await fileRes.text());
	if (!curRes?.ok) return { games: fileGames, fileGames };
	try {
		const season = Number(curRes.headers.get('X-Season'));
		const current = parseGames(await curRes.text());
		if (!season) return { games: fileGames, fileGames };
		return { games: poolCurrentSeason(fileGames, current, season), fileGames };
	} catch {
		return { games: fileGames, fileGames };
	}
}
