/** Every league's games on one day, for the home page: ESPN's scoreboards,
 *  read through the shared cache (lib/espn.js), each game reduced to what the
 *  page draws -- its state, its clubs with their scores and their pages here,
 *  and where it is on TV.
 *
 *  One request from the page for every league, not six to ESPN, and the
 *  server knows which club page each team links to. */
import { ESPN_LEAGUE } from './web.js';
import { LEAGUE_ABBR } from './teams.js';
import { coverageOf } from '../web/nfl/coverage-core.js';

/** One competitor, as the page draws it. `club` is its page here, by its full
 *  name in this sport ("Los Angeles Lakers"), or null for a club with none. */
function side(c, sport, clubs) {
	const t = c?.team ?? {};
	// By full name, else by short name within the sport: ESPN's LAFC is our
	// Los Angeles Football Club, whose short name is LAFC.
	const club = clubs.get(`${sport}|${String(t.displayName ?? '').toLowerCase()}`)
		?? clubs.get(`${sport}|short:${String(t.shortDisplayName ?? t.name ?? '').toLowerCase()}`) ?? null;
	return {
		name: t.displayName ?? '', short: t.shortDisplayName ?? t.name ?? t.abbreviation ?? '',
		abbr: t.abbreviation ?? '', logo: t.logo ?? null,
		score: c?.score ?? null, record: c?.records?.[0]?.summary ?? null,
		winner: Boolean(c?.winner),
		url: club?.url ?? null, key: club?.key ?? null,
	};
}

/** One game. Times stay ISO for the page to show in the viewer's own zone. */
export function gameOf(e, sport, clubs) {
	const comp = e?.competitions?.[0] ?? {};
	const st = comp.status?.type ?? e?.status?.type ?? {};
	const away = comp.competitors?.find((c) => c.homeAway === 'away');
	const home = comp.competitors?.find((c) => c.homeAway === 'home');
	// Every network named, once, in ESPN's order: national and both sides'.
	const tv = [...new Set((comp.broadcasts ?? []).flatMap((b) => b.names ?? (b.media?.shortName ? [b.media.shortName] : [])))];
	return {
		id: String(e.id), sport, start: e.date ?? comp.date ?? null,
		state: st.state ?? 'pre', status: st.shortDetail ?? st.detail ?? '',
		away: side(away, sport, clubs), home: side(home, sport, clubs), tv,
		// A game with no time set yet ("TBD") says so rather than midnight.
		timeValid: comp.timeValid !== false && e.timeValid !== false,
	};
}

/** The day's games for each league, in the order given: `[{ sport, label,
 *  games }]`. `espn` is the shared cache; `clubs` maps "sport|full name" to
 *  `{ url, key }`. A league whose scoreboard cannot be read has no games and
 *  says so (`error`), rather than taking the page down. */
export async function todayGames({ sports, date, espn, clubs = new Map(), dma = null, coverage = null, footballWeek = false }) {
	return Promise.all(sports.map(async (sport) => {
		const league = ESPN_LEAGUE[sport];
		const label = LEAGUE_ABBR[sport] ?? sport.toUpperCase();
		if (!league) return { sport, label, games: [] };
		// `footballWeek`: football's week being played (the NFL's Thursday to
		// Monday, college's Tuesday to Saturday), which is ESPN's scoreboard asked
		// for no day. College's asks for the whole FBS (group 80): without it, a
		// week is only the ranked teams' games.
		const week = footballWeek && (sport === 'nfl' || sport === 'ncaaf');
		const query = [week ? '' : `dates=${date}`, sport === 'ncaaf' ? 'groups=80&limit=300' : ''].filter(Boolean).join('&');
		const got = await espn(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard${query ? `?${query}` : ''}`);
		if (!got || got.status !== 200) return { sport, label, games: [], error: true };
		let events = [];
		try { events = JSON.parse(got.body).events ?? []; } catch { return { sport, label, games: [], error: true }; }
		const games = events.map((e) => gameOf(e, sport, clubs));
		// A regional CBS or FOX game, for the viewer's market: whether its station
		// has this one (web/nfl/coverage-core.js), from that week's maps. The
		// regular season only; the maps cover no playoff game.
		if (sport === 'nfl' && dma && coverage) {
			const weeks = new Map();
			for (const [i, e] of events.entries()) {
				const season = e.season?.year, week = e.week?.number;
				if (!season || !week || e.season?.type !== 2) continue;
				const key = `${season}|${week}`;
				if (!weeks.has(key)) weeks.set(key, await coverage(season, week).catch(() => null));
				const c = coverageOf(weeks.get(key), e, dma);
				if (c) games[i].coverage = c;
			}
		}
		return { sport, label, games };
	}));
}
