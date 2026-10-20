import { SITE } from './site.js';

// Shared (browser + node) computation of Brewers records/superlatives from
// Retrosheet data (gameinfo.csv + CurrentNames.csv). Pure functions only — no fs/fetch/DOM.

export function splitCsvLine(line) {
	const out = []; let cur = ''; let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
		else if (ch === ',' && !q) { out.push(cur); cur = ''; }
		else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

export function parseGamesCsv(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	return lines.slice(1).map((l) => {
		const v = splitCsvLine(l); const o = {};
		headers.forEach((h, i) => { o[h] = v[i] ?? ''; });
		return o;
	});
}

// CurrentNames.csv columns: franchiseName,teamName,league,division,city,team,alternate,startDate,endDate,...
// teamName = period-specific abbreviation used as the primary lookup key.
// franchiseName is the stable organization code (ANA, OAK, WAS, etc.) — the
// correct grouping key for all-time head-to-head, since one franchise spans
// multiple cities and teamName codes over time (e.g. OAK covers Philadelphia,
// Kansas City, Oakland, and Sacramento Athletics).
//
// Returns { teamNames, teamToFranchise, franchiseEras }:
//   teamNames: teamName/alternate/franchiseName -> display name ("City Nick")
//     (first occurrence wins; used for the Brewers' own name and as a fallback)
//   teamToFranchise: teamName/alternate -> franchiseName
//   franchiseEras: franchiseName -> [{start, end, display}] sorted by start,
//     where start/end are YYYYMMDD ints (end=0 means open-ended). Used to
//     resolve the era-correct name for a given game date, so e.g. a 2008 Rays
//     game shows "Tampa Bay Rays" (not "Devil Rays") and a 2025 Athletics
//     game shows "Sacramento Athletics" (not "Oakland Athletics").
export function parseCurrentNamesCsv(raw) {
	const teamNames = {};
	// Franchise/alternate codes mapped into the team-name namespace. Kept
	// separate during the loop so a real teamName row always wins the key:
	// e.g. the SE1 Pilots row (franchise MIL) precedes the MIL rows and must
	// not claim teamNames['MIL'] as "Seattle Pilots".
	const aliasNames = {};
	const teamToFranchise = {};
	const franchiseEras = {};
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const franIdx = headers.indexOf('franchiseName');
	const keyIdx = headers.indexOf('teamName');
	const cityIdx = headers.indexOf('city');
	const nickIdx = headers.indexOf('team');
	const altIdx = headers.indexOf('alternate');
	const startIdx = headers.indexOf('startDate');
	const endIdx = headers.indexOf('endDate');
	const toYyyymmdd = (s) => {
		if (!s) return 0;
		const m = s.match(/^(\d+)\/(\d+)\/(\d+)$/);
		return m ? parseInt(m[3]) * 10000 + parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
	};
	for (const line of lines.slice(1)) {
		const p = splitCsvLine(line);
		const id = p[keyIdx]?.trim();
		const city = p[cityIdx]?.trim();
		const nick = p[nickIdx]?.trim();
		if (id && city && nick) {
			const display = `${city} ${nick}`;
			if (!teamNames[id]) teamNames[id] = display;
			const fran = franIdx >= 0 ? p[franIdx]?.trim() : '';
			if (fran) {
				if (fran !== id && !aliasNames[fran]) aliasNames[fran] = display;
				const era = { start: toYyyymmdd(p[startIdx]?.trim()), end: toYyyymmdd(p[endIdx]?.trim()), display, nick };
				if (!franchiseEras[fran]) franchiseEras[fran] = [];
				franchiseEras[fran].push(era);
			}
			if (fran) teamToFranchise[id] = fran;
			const alt = altIdx >= 0 ? p[altIdx]?.trim() : '';
			if (alt) {
				if (alt !== id && !aliasNames[alt]) aliasNames[alt] = display;
				if (fran) teamToFranchise[alt] = fran;
			}
		}
	}
	for (const k of Object.keys(aliasNames)) if (!teamNames[k]) teamNames[k] = aliasNames[k];
	for (const k of Object.keys(franchiseEras)) franchiseEras[k].sort((a, b) => a.start - b.start);
	return { teamNames, teamToFranchise, franchiseEras };
}

// Resolve the era-correct display name for a franchise at a given game date
// (YYYYMMDD int). Returns null if no era matches.
export function nameForFranchiseAt(eras, franchise, yyyymmdd) {
	return eraAt(eras, franchise, yyyymmdd)?.display ?? null;
}

// The nickname alone ("Angels", "Red Sox"), for places with room for one word.
export function nickForFranchiseAt(eras, franchise, yyyymmdd) {
	return eraAt(eras, franchise, yyyymmdd)?.nick ?? null;
}

function eraAt(eras, franchise, yyyymmdd) {
	const list = eras[franchise];
	if (!list) return null;
	for (let i = list.length - 1; i >= 0; i--) {
		const e = list[i];
		if (yyyymmdd >= e.start && (e.end === 0 || yyyymmdd <= e.end)) return e;
	}
	return null;
}

// Brewers Retrosheet team IDs across all seasons.
// SE1 = Seattle Pilots (1969); MIL = Milwaukee Brewers (1970–present).
/** The team codes this deployment is about, read out of the manifest rather
 *  than listed again here.
 *
 *  Renaming this to TEAM_IDS would be the honest thing and is deliberately not
 *  done yet: it is imported by name in five files, and this change is already
 *  large enough that a byte-for-byte check of the output is what makes it safe
 *  to review. The name is the last Brewers-specific thing in this module.
 *
 *  What matters is that the value now comes from site.js, so pointing this code
 *  at another franchise is a manifest edit rather than a source edit. */
export const BREWERS_IDS = new Set(SITE.teamIds);

// Playoff round depth ordering: higher = deeper in the postseason.
export const ROUND_ORDER = { F: 1, D: 2, L: 3, W: 4 };

// What each gametype code is called on the page. The records page's series
// list and the season page's series line both read this one table.
//
// THE WNBA'S COPY. The codes stay baseball's — F, D, L, W in order — so
// everything that orders or counts rounds is shared. The WNBA has played two
// rounds (1997, 1998), three and four; the server names the last two from the
// Final back (Semifinals, Finals) and the rest from the front (lib/web.js
// wnbaGametype), so a three-round season has no Second Round.
export const ROUND_LABEL = { T: 'Tiebreaker', F: 'First Round', D: 'Second Round', L: 'Semifinals', W: 'WNBA Finals' };

// Parse ballparks.csv into a park-id → {id, city, park, first, last} map.
// `first`/`last` are 'YYYYMMDD' integers; `last` may be empty for active parks.
export function parseBallparksCsv(raw) {
	const lines = raw.split('\n');
	const header = splitCsvLine(lines[0]);
	const idI = header.indexOf('ID');
	const cityI = header.indexOf('City');
	const parkI = header.indexOf('Park Name');
	const firstI = header.indexOf('First');
	const lastI = header.indexOf('Last');
	const parks = [];
	for (const line of lines.slice(1)) {
		if (!line.trim()) continue;
		const v = splitCsvLine(line);
		const id = v[idI]?.trim();
		if (!id) continue;
		parks.push({
			id,
			city: (v[cityI] || '').trim(),
			park: (v[parkI] || '').trim(),
			first: (v[firstI] || '').trim(),
			last: (v[lastI] || '').trim(),
		});
	}
	return parks;
}

// Franchise milestones for the history chart: team identity / home-ballpark
// transitions as vertical milestone lines. Returns [{date, label, type}] sorted
// ascending. Parses the RAW gameinfo CSV (not the Brewers-facing parsed rows)
// because it needs hometeam/visteam/site columns that parseGameinfoCsv drops.
// `brewersParks` maps site IDs → park name for the Brewers' home parks.
// `teamName` was a literal ({ SE1: 'Seattle Pilots', MIL: 'Milwaukee Brewers' });
// in are-they-sports the caller passes the club's era names. Not yet called
// here: it serves the history page, which is still server-rendered.
export function computeFranchiseMilestones(rawGameinfo, brewersParks, teamName = {}) {
	const lines = rawGameinfo.split('\n');
	const header = splitCsvLine(lines[0]);
	const dateI = header.indexOf('date');
	const visI = header.indexOf('visteam');
	const homeI = header.indexOf('hometeam');
	const siteI = header.indexOf('site');
	if (dateI < 0 || homeI < 0 || siteI < 0) return [];
	const toIso = (yyyymmdd) => {
		const s = String(yyyymmdd);
		return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
	};
	// Collect Brewers home games: {date, site, teamId} sorted ascending.
	const homeGames = [];
	for (const line of lines.slice(1)) {
		if (!line.trim()) continue;
		const v = splitCsvLine(line);
		const home = v[homeI];
		if (!BREWERS_IDS.has(home)) continue;
		homeGames.push({ date: toIso(v[dateI]), site: v[siteI], teamId: home });
	}
	homeGames.sort((a, b) => (a.date < b.date ? -1 : 1));
	if (!homeGames.length) return [];
	// Park name lookup. ballparks.csv omits Sick's Stadium (SEA01), the
	// Pilots' 1969 home, so we fill it in directly.
	const parkName = new Map(brewersParks.map((p) => [p.id, p.park]));
	parkName.set('SEA01', "Sick's Stadium");
	// Team identity transitions: first home game under each team id.
	const seenTeam = new Set();
	const seenPark = new Set();
	const out = [];
	for (const g of homeGames) {
		if (!seenTeam.has(g.teamId)) {
			seenTeam.add(g.teamId);
			out.push({ date: g.date, label: teamName[g.teamId] || g.teamId, type: 'team' });
		}
		if (!seenPark.has(g.site)) {
			seenPark.add(g.site);
			const name = parkName.get(g.site);
			if (name) out.push({ date: g.date, label: name, type: 'park' });
		}
	}
	// Team and park transitions on the same date (1970: Pilots→Brewers +
	// Sick's→County) stay as separate entries — the chart renders them in
	// distinct icon tracks so they never overlap.
	return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Retrosheet teamName codes that may not appear in CurrentNames.csv or whose
// franchiseName lookup could resolve to the wrong era. Covers all opponents
// the Brewers have faced since 1969 (AL 1969–1997, NL 1998+, interleague).
const RETROSHEET_TEAM_NAMES = {
	// NL teams
	CHN: 'Chicago Cubs', NYN: 'New York Mets', SFN: 'San Francisco Giants',
	SDN: 'San Diego Padres', SLN: 'St. Louis Cardinals', LAN: 'Los Angeles Dodgers',
	MON: 'Montreal Expos', FLO: 'Florida Marlins', MIA: 'Miami Marlins',
	WAS: 'Washington Nationals',
	ARI: 'Arizona Diamondbacks', COL: 'Colorado Rockies',
	ATL: 'Atlanta Braves', HOU: 'Houston Astros', PHI: 'Philadelphia Phillies',
	PIT: 'Pittsburgh Pirates', CIN: 'Cincinnati Reds',
	// AL teams
	NYA: 'New York Yankees', CHA: 'Chicago White Sox', KCA: 'Kansas City Royals',
	BOS: 'Boston Red Sox', BAL: 'Baltimore Orioles', CLE: 'Cleveland Guardians',
	DET: 'Detroit Tigers', MIN: 'Minnesota Twins', OAK: 'Oakland Athletics',
	SEA: 'Seattle Mariners', TEX: 'Texas Rangers', TOR: 'Toronto Blue Jays',
	TBA: 'Tampa Bay Rays', TBD: 'Tampa Bay Devil Rays',
	LAA: 'Los Angeles Angels',
	// Historical / franchise-era codes
	ANA: 'Anaheim Angels', CAL: 'California Angels',
	SE1: 'Seattle Pilots',
	WS1: 'Washington Senators', WS2: 'Washington Senators',
	KC1: 'Kansas City Athletics',
	PHA: 'Philadelphia Athletics', ATH: 'Oakland Athletics',
	MLN: 'Milwaukee Braves',
	BSN: 'Boston Braves', BRO: 'Brooklyn Dodgers', NY1: 'New York Giants',
	SLA: 'St. Louis Browns', BLA: 'Baltimore Orioles',
	CLE1: 'Cleveland Spiders',
};

// Maps any gametype string to a canonical single-letter code:
//   R = regular season, T = tiebreaker (game 163), F = wild card,
//   D = division series, L = league championship, W = world series
function normalizeGametype(gt) {
	if (!gt) return '';
	const u = gt.toUpperCase().replace(/[\s_-]/g, '');
	if (u === 'R' || u === 'RS' || u === '0' || u === 'REGULAR') return 'R';
	if (u === 'W' || u === 'WS' || u === 'WORLDSERIES') return 'W';
	if (u === 'L' || u === 'LCS' || u === 'ALCS' || u === 'NLCS' || u === 'C') return 'L';
	if (u === 'D' || u === 'DS' || u === 'DIVISIONSERIES' || u === 'DIVISION') return 'D';
	if (u === 'F' || u === 'WILDCARD' || u === 'WILDCARDGAME') return 'F';
	if (u === 'PLAYOFF' || u === 'PLAYOFFS' || u === 'P') return 'T';
	// A postseason game whose round could not be read (lib/espn-current's
	// fallback). It must stay postseason now that T counts as regular
	// season; division series is the round it is filed under.
	if (u === 'POSTSEASON') return 'D';
	// ESPN's NBA round words, which the server passes through as the games'
	// stage (0011): first round, conference semifinals, conference finals,
	// the Finals.
	if (u === 'RD16') return 'F';
	if (u === 'QTR') return 'D';
	if (u === 'SEMI') return 'L';
	if (u === 'FINAL') return 'W';
	return '';
}

// Convert gameinfo.csv rows + CurrentNames.csv into the internal game-row format
// used throughout records-core, h2h-core, etc.
// teamstatsRaw is optional: its gametype column is used ONLY when it identifies
// a known playoff type (D/L/W/F/C), so that regular season games (however
// teamstats encodes them) always default to 'R'.
export function parseGameinfoCsv(gamesRaw, namesRaw, teamstatsRaw = null) {
	const { teamNames, teamToFranchise, franchiseEras } = parseCurrentNamesCsv(namesRaw);

	// Build gid→gametype from teamstats, but only retain known playoff codes.
	// teamstats uses full-word values: 'regular' for regular season, and words
	// like 'division', 'lcs', 'worldseries', 'wildcard' for postseason games.
	// Those are Retrosheet's words for the round and are deliberately untouched
	// by the key rename: the column this code writes is `championship`, the value
	// it reads is still whatever the CSV says.
	// We treat anything that is NOT a regular-season indicator as a playoff game.
	const tsPlayoff = new Set(); // gids confirmed as playoff by teamstats
	const tsWorldSeries = new Set();
	if (teamstatsRaw) {
		const tsLines = teamstatsRaw.trim().split('\n');
		const tsH = splitCsvLine(tsLines[0]);
		const gidI = tsH.indexOf('gid'), gtI = tsH.indexOf('gametype');
		if (gidI >= 0 && gtI >= 0) {
			for (const line of tsLines.slice(1)) {
				const v = splitCsvLine(line);
				const gid = v[gidI]?.trim();
				const gt = (v[gtI]?.trim() || '').toUpperCase();
				if (!gid) continue;
				// Regular-season identifiers (letter 'R', word 'REGULAR', numeric '0')
				const norm = normalizeGametype(gt);
				if (!norm || norm === 'R') continue;
				tsPlayoff.add(gid);
				if (norm === 'W') tsWorldSeries.add(gid);
			}
		}
	}
	const rows = parseGamesCsv(gamesRaw);

	return rows
		.filter((r) => BREWERS_IDS.has(r.hometeam) || BREWERS_IDS.has(r.visteam))
		.map((r) => {
			const isHome = BREWERS_IDS.has(r.hometeam);
			const opponentId = isHome ? r.visteam : r.hometeam;
			// Franchise code for all-time grouping (e.g. OAK covers Philadelphia,
			// Kansas City, Oakland, and Sacramento Athletics). Falls back to the
			// opponentId itself for codes absent from CurrentNames (defunct
			// franchises like WS1/WS2/CLE1), so each such franchise still groups
			// as one opponent under its historical name.
			const franchise = teamToFranchise[opponentId] || opponentId;

			const vr = r.vruns !== '' ? parseInt(r.vruns, 10) : NaN;
			const hr = r.hruns !== '' ? parseInt(r.hruns, 10) : NaN;
			const brewersScore = isHome ? hr : vr;
			const opponentScore = isHome ? vr : hr;

			let result = '';
			if (r.wteam && BREWERS_IDS.has(r.wteam)) result = 'WIN';
			else if (r.lteam && BREWERS_IDS.has(r.lteam)) result = 'LOSS';
			else if (!isNaN(vr) && !isNaN(hr) && vr === hr) result = 'TIE';

			// Convert YYYYMMDD → YYYY-MM-DD
			const rawDate = r.date || '';
			const isoDate = /^\d{8}$/.test(rawDate)
				? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
				: rawDate;

			// Resolve the era-correct name for this game date so each row carries
			// the name in use at the time (e.g. "Tampa Bay Devil Rays" pre-2008,
			// "Tampa Bay Rays" from 2008). Falls back to the flat team-name map
			// then to the Retrosheet hardcoded names.
			const gameDateInt = parseInt(rawDate, 10) || 0;
			const opponentName =
				nameForFranchiseAt(franchiseEras, franchise, gameDateInt) ||
				teamNames[opponentId] ||
				RETROSHEET_TEAM_NAMES[opponentId] ||
				opponentId;

			// Normalize gametype to single-letter codes used throughout.
			// teamstats uses full words: regular, wildcard, divisionseries, lcs, championship, playoff.
			// gameinfo.csv may use R/D/L/W/F or be empty.
			const rawGt = (r.gametype || '').toUpperCase().trim();
			const normGt = normalizeGametype(rawGt);
			const gt = normGt || (tsPlayoff.has(r.gid) ? (tsWorldSeries.has(r.gid) ? 'W' : 'D') : 'R');
			// A tiebreaker is regular season, as MLB counts it: Game 163 in 2018
			// made that season 96-67, not 95-67 and a one-game "series" in the
			// playoffs. Retrosheet tags it 'playoff'; it keeps its T so it can
			// still be told apart, but counts with the regular season everywhere
			// — standings, streaks, history, records and stats.
			const regularSeason = gt === 'R' || gt === 'T' ? '1' : '0';
			const playoff = regularSeason === '1' ? '0' : '1';
			const championship = gt === 'W' ? r.season : '';

			return {
				gid: r.gid || '',
				date: isoDate,
				season: r.season,
				regular_season: regularSeason,
				playoff,
				championship,
				gametype: gt,
				Opponent: opponentName,
				OpponentNick: nickForFranchiseAt(franchiseEras, franchise, gameDateInt) || opponentName.split(' ').pop(),
				franchise,
				'result': result,
				scoreFor: isNaN(brewersScore) ? '' : String(brewersScore),
				scoreAgainst: isNaN(opponentScore) ? '' : String(opponentScore),
				location: isHome ? 'home' : 'away',
				wp: r.wp || '',
				lp: r.lp || '',
				save: r.save || '',
			};
		});
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> 'Oct 23, 1966' without Date() timezone pitfalls.
export function formatDate(iso) {
	const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
	return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export const rec = (w, l, t) => (t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`);

/** "1 championship", "2 championships": the counts on the history and
 *  managers pages and their cards, which read "1 championships" after a
 *  first title. */
export const championships = (n) => `${n} championship${n === 1 ? '' : 's'}`;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

// A season labelled Y runs from April through October; by December 1 it is over.
const seasonSettled = (yr, now) =>
	now.getFullYear() > yr || (now.getFullYear() === yr && now.getMonth() >= 11);

// rows: parsed CSV rows. Returns { seasonRange, bestStarts, perfectSeasons,
// winStreaks, worstStarts, lopsidedWins } — each list sorted best-first,
// trimmed to `top`. Streaks/starts/perfect seasons are regular season only;
// ties end win streaks (record-book convention). Lopsided wins include
// playoffs, flagged.
export function computeSuperlatives(rows, { top = 5, now = new Date() } = {}) {
	const games = rows
		.filter((r) => RESULTS.has(r['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const regular = games.filter((r) => r.regular_season === '1');

	const seasons = new Map(); // year -> chronological regular-season games
	for (const g of regular) {
		const yr = parseInt(g.season, 10);
		if (!seasons.has(yr)) seasons.set(yr, []);
		seasons.get(yr).push(g);
	}
	const years = [...seasons.keys()].sort((a, b) => a - b);
	const seasonRange = { first: years[0], last: years[years.length - 1] };

	// Leading run of `result` games to open each season.
	const seasonStarts = (result) => {
		const out = [];
		for (const yr of years) {
			let n = 0, first = null;
			for (const g of seasons.get(yr)) {
				if (g['result'] === result) { if (!first) first = g; n++; }
				else break;
			}
			if (n > 0) out.push({ season: yr, games: n, firstGid: first?.gid || '' });
		}
		return out.sort((a, b) => b.games - a.games || a.season - b.season).slice(0, top);
	};
	const bestStarts = seasonStarts('WIN');
	const worstStarts = seasonStarts('LOSS');

	const perfectSeasons = [];
	for (const yr of years) {
		let w = 0, l = 0, t = 0;
		for (const g of seasons.get(yr)) {
			if (g['result'] === 'WIN') w++;
			else if (g['result'] === 'LOSS') l++;
			else t++;
		}
		if (l === 0 && w > 0 && seasonSettled(yr, now)) perfectSeasons.push({ season: yr, wins: w, record: rec(w, l, t) });
	}
	perfectSeasons.sort((a, b) => b.wins - a.wins || a.season - b.season);

	// Postseason series results. Each series is grouped by (season, gametype,
	// opponent); gametype codes: F=Wild Card, D=Division Series, L=LCS, W=World Series.
	const ROUND_ORDER = { T: 0, F: 1, D: 2, L: 3, W: 4 };
	const seriesMap = new Map(); // key -> { season, round, opponent, wins, losses, firstGid, firstDate }
	for (const g of games) {
		if (g.regular_season === '1') continue;
		const yr = parseInt(g.season, 10);
		const gt = g.gametype || 'D';
		const key = `${yr}|${gt}|${g.Opponent}`;
		let s = seriesMap.get(key);
		if (!s) {
			s = { season: yr, round: gt, opponent: g.Opponent, wins: 0, losses: 0, firstGid: g.gid || '', firstDate: g.date || '' };
			seriesMap.set(key, s);
		}
		// Keep the chronologically earliest game as the series anchor.
		if (g.date && (!s.firstDate || g.date < s.firstDate)) {
			s.firstGid = g.gid || s.firstGid;
			s.firstDate = g.date;
		}
		if (g['result'] === 'WIN') s.wins++;
		else if (g['result'] === 'LOSS') s.losses++;
	}
	// Won or lost once a side has the wins its round needs, or once the season
	// is over (formats changed: the 1982 ALCS was best of five). Before that a
	// series is still being played. "More wins than losses" called the 2026
	// NLCS won at 2-0, the day the current season first reached this page.
	const seriesResult = (s) => {
		const need = WINS_NEEDED[s.round];
		const settled = seasonSettled(s.season, now);
		if ((need && s.wins >= need) || (settled && s.wins > s.losses)) return 'Won';
		if ((need && s.losses >= need) || (settled && s.losses > s.wins)) return 'Lost';
		return s.wins > s.losses ? 'Leads' : s.wins < s.losses ? 'Trails' : 'Tied';
	};
	const allSeries = [...seriesMap.values()].map((s) => ({
		...s,
		roundLabel: ROUND_LABEL[s.round] || 'Playoffs',
		result: seriesResult(s),
		record: `${s.wins}–${s.losses}`,
	}));
	// Group series by season: playoff appearances list every series; WS
	// appearances list only the World Series series (one per season at most).
	const seriesBySeason = new Map();
	for (const s of allSeries) {
		if (!seriesBySeason.has(s.season)) seriesBySeason.set(s.season, []);
		seriesBySeason.get(s.season).push(s);
	}
	const playoffAppearances = [...seriesBySeason.entries()]
		.map(([season, series]) => ({
			season,
			series: series.sort((a, b) => (ROUND_ORDER[a.round] ?? 9) - (ROUND_ORDER[b.round] ?? 9)),
		}))
		.sort((a, b) => b.season - a.season);
	const championshipAppearances = allSeries
		.filter((s) => s.round === 'W')
		.sort((a, b) => b.season - a.season);

	// Regular-season streaks of one result, contained within a single season;
	// any other result (including a tie) ends one.
	const streakEntry = (s) => ({
		games: s.games,
		startDate: s.start.date, endDate: s.end.date,
		startSeason: parseInt(s.start.season, 10), endSeason: parseInt(s.end.season, 10),
		startGid: s.start.gid || '', endGid: s.end.gid || '',
	});
	const streaksOf = (result) => {
		const streaks = [];
		let run = null;
		let runSeason = null;
		const endRun = () => { if (run) { streaks.push(run); run = null; runSeason = null; } };
		for (const g of regular) {
			const gSeason = parseInt(g.season, 10);
			if (runSeason !== null && gSeason !== runSeason) endRun();
			if (g['result'] === result) {
				if (!run) run = { games: 0, start: null, end: null };
				runSeason = gSeason;
				run.games++;
				if (!run.start) run.start = g;
				run.end = g;
			} else {
				endRun();
			}
		}
		endRun();
		return streaks
			.sort((a, b) => b.games - a.games || (a.start.date < b.start.date ? -1 : 1))
			.slice(0, top)
			.map(streakEntry);
	};
	const topStreaks = streaksOf('WIN');
	const loseStreaks = streaksOf('LOSS');

	const gameInfo = (g) => {
		const pf = parseInt(g.scoreFor, 10) || 0;
		const pa = parseInt(g.scoreAgainst, 10) || 0;
		return {
			gid: g.gid || '',
			date: g.date, season: parseInt(g.season, 10), opponent: g.Opponent,
			pf, pa,
			playoff: g.regular_season !== '1',
			championship: !!(g.championship && g.championship.trim()),
		};
	};

	// Biggest margins, either direction; sort by margin, then winner's score, then date.
	const lopsided = (result) => games
		.filter((g) => g['result'] === result)
		.map(gameInfo)
		.sort((a, b) => Math.abs(b.pf - b.pa) - Math.abs(a.pf - a.pa)
			|| Math.max(b.pf, b.pa) - Math.max(a.pf, a.pa)
			|| (a.date < b.date ? -1 : 1))
		.slice(0, top);

	// Every tie ever, not a top-N list; newest first.
	const ties = games.filter((g) => g['result'] === 'TIE').map(gameInfo).reverse();

	return {
		seasonRange, bestStarts, perfectSeasons, winStreaks: topStreaks, loseStreaks, worstStarts,
		lopsidedWins: lopsided('WIN'), lopsidedLosses: lopsided('LOSS'), ties,
		playoffAppearances, championshipAppearances,
	};
}

export const streakSpan = (s) =>
	s.startSeason === s.endSeason ? String(s.startSeason) : `${s.startSeason}–${s.endSeason}`;

// One entry per season, chronological: record, win% (ties count half), and
// runs for/against, plus championship/undefeated flags for chart markers.
// `playoffs: true` folds postseason games into the record/runs; the
// champion and undefeated flags always use their own rules regardless.
export function computeSeasonHistory(rows, { now = new Date(), playoffs = false } = {}) {
	const games = rows
		.filter((r) => ['WIN', 'LOSS', 'TIE'].includes(r['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const bySeason = new Map();
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (!bySeason.has(yr)) bySeason.set(yr, []);
		bySeason.get(yr).push(g);
	}
	return [...bySeason.keys()].sort((a, b) => a - b).map((yr) => {
		let w = 0, l = 0, t = 0, pf = 0, pa = 0, regLosses = 0, regWins = 0;
		let lastPlayoff = null;
		let wsWins = 0, wsLosses = 0;
		let deepestRound = null, deepestOrder = 0;
		for (const g of bySeason.get(yr)) {
			const isReg = g.regular_season === '1';
			if (!isReg) {
				lastPlayoff = g;
				const order = ROUND_ORDER[g.gametype] || 0;
				if (order > deepestOrder) { deepestOrder = order; deepestRound = g.gametype; }
				if (g.championship && g.championship.trim()) {
					if (g['result'] === 'WIN') wsWins++;
					else if (g['result'] === 'LOSS') wsLosses++;
				}
			}
			if (isReg) {
				if (g['result'] === 'WIN') regWins++;
				else if (g['result'] === 'LOSS') regLosses++;
			}
			if (!isReg && !playoffs) continue;
			if (g['result'] === 'WIN') w++;
			else if (g['result'] === 'LOSS') l++;
			else t++;
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		// A title needs the Series to be over: four wins, or a season that has
		// finished. "More wins than losses" alone crowned the 2026 team on the
		// history page after the NLDS — its last playoff game was a win, which
		// is what `champion` used to need — and credited Pat Murphy with a
		// title on the managers page. It would have done the same after a 1-0
		// lead in a World Series.
		const settled = seasonSettled(yr, now);
		const championship = wsWins >= 4 || (settled && wsWins > wsLosses);
		const gamesPlayed = w + l + t;
		return {
			season: yr,
			wins: w, losses: l, ties: t,
			record: rec(w, l, t),
			winPct: gamesPlayed ? (w + t / 2) / gamesPlayed : 0,
			pf, pa,
			champion: championship || (settled && lastPlayoff !== null && lastPlayoff.gametype !== 'W' && lastPlayoff['result'] === 'WIN'),
			championship,
			postseason: deepestRound,
			undefeated: regLosses === 0 && regWins > 0 && seasonSettled(yr, now),
		};
	});
}

// Per-season best/worst records and team-pitching milestones (no-hitters,
// perfect games) from teamstats.csv. `rows` are the parsed gameinfo rows
// (for opponent/score/date cross-reference). Best/worst seasons use only
// settled regular-season records.
export function computeTeamstatsRecords(rows, teamstatsRaw, { top = 5, now = new Date() } = {}) {
	const lines = teamstatsRaw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const idx = (name) => headers.indexOf(name);
	const gidI = idx('gid'), teamI = idx('team');
	const hitI = idx('p_h'), ipoutsI = idx('p_ipouts'), wI = idx('p_w'), hbpI = idx('p_hbp'), bfpI = idx('p_bfp');
	const tpI = idx('d_tp'), teamHrI = idx('b_hr'), teamErrI = idx('d_e'), erI = idx('p_er');
	const pitch = new Map();
	for (const line of lines.slice(1)) {
		const v = splitCsvLine(line);
		const team = v[teamI]?.trim();
		if (!BREWERS_IDS.has(team)) continue;
		const gid = v[gidI]?.trim();
		if (!gid) continue;
		pitch.set(gid, {
			h: parseInt(v[hitI], 10) || 0,
			ipouts: parseInt(v[ipoutsI], 10) || 0,
			w: parseInt(v[wI], 10) || 0,
			hbp: parseInt(v[hbpI], 10) || 0,
			bfp: parseInt(v[bfpI], 10) || 0,
			tp: tpI >= 0 ? parseInt(v[tpI], 10) || 0 : 0,
			teamHr: teamHrI >= 0 ? parseInt(v[teamHrI], 10) || 0 : 0,
			teamErr: teamErrI >= 0 ? parseInt(v[teamErrI], 10) || 0 : 0,
			er: erI >= 0 ? parseInt(v[erI], 10) || 0 : 0,
		});
	}

	const seasons = computeSeasonHistory(rows, { now, playoffs: false });
	// A regular season is complete once it is: when its postseason has
	// started, or it has 162 games, or it is December. This waited for
	// December alone, so the 2026 team's 103-59 — the best record in franchise
	// history, final since game 162 — sat out of Best Seasons all October. A
	// non-playoff team a rainout short of 162 still waits for December.
	const regularDone = (s) => seasonSettled(s.season, now) || !!s.postseason || s.wins + s.losses + s.ties >= 44;
	const completed = seasons.filter((s) => regularDone(s) && (s.wins + s.losses + s.ties) > 0);
	const byBest = (a, b) => b.winPct - a.winPct || b.wins - a.wins || a.season - b.season;
	const byWorst = (a, b) => a.winPct - b.winPct || a.losses - b.losses || a.season - b.season;
	const bestSeasons = completed.slice().sort(byBest).slice(0, top);
	const worstSeasons = completed.slice().sort(byWorst).slice(0, top);

	const games = rows
		.filter((r) => RESULTS.has(r['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const noHitters = [];
	const perfectGames = [];
	const triplePlays = [];
	const hrGames = [];
	const errGames = [];
	for (const g of games) {
		const p = pitch.get(g.gid);
		if (!p) continue;
		const entry = () => ({
			gid: g.gid, date: g.date, season: parseInt(g.season, 10), opponent: g.Opponent,
			pf: parseInt(g.scoreFor, 10) || 0, pa: parseInt(g.scoreAgainst, 10) || 0,
			playoff: g.regular_season !== '1', championship: !!(g.championship && g.championship.trim()),
		});
		if (p.tp > 0) triplePlays.push({ ...entry(), count: p.tp });
		if (p.teamHr > 0) hrGames.push({ ...entry(), hr: p.teamHr });
		if (p.teamErr > 0) errGames.push({ ...entry(), e: p.teamErr });
		if (p.ipouts < 27 || p.h !== 0) continue;
		const perfect = p.w === 0 && p.hbp === 0 && p.bfp === p.ipouts;
		noHitters.push({ ...entry(), perfect });
		if (perfect) perfectGames.push({ ...entry(), perfect });
	}
	noHitters.reverse();
	perfectGames.reverse();
	triplePlays.reverse();
	// Team single-game HR high-water marks: everything tied with the 5th-best
	// count stays in (ties shouldn't be cut arbitrarily).
	hrGames.sort((a, b) => b.hr - a.hr || (a.date < b.date ? -1 : 1));
	const hrCutoff = hrGames[top - 1]?.hr ?? 0;
	const mostTeamHrGames = hrGames.filter((g) => g.hr >= hrCutoff && g.hr > 0);
	// Team single-game error highs, ties with the 5th-best included.
	errGames.sort((a, b) => b.e - a.e || (a.date < b.date ? -1 : 1));
	const errCutoff = errGames[top - 1]?.e ?? 0;
	const mostTeamErrorGames = errGames.filter((g) => g.e >= errCutoff && g.e > 0);
	// Team ERA by completed regular season: 27 x earned runs / outs recorded,
	// summed over the season's games. Same completeness rule as Best Seasons;
	// a season with no teamstats (the one being played) has no outs and drops.
	const eraBySeason = new Map();
	for (const g of games) {
		if (g.regular_season !== '1') continue;
		const p = pitch.get(g.gid);
		if (!p) continue;
		const yr = parseInt(g.season, 10);
		const s = eraBySeason.get(yr) || { er: 0, ipouts: 0 };
		s.er += p.er;
		s.ipouts += p.ipouts;
		eraBySeason.set(yr, s);
	}
	const teamEra = completed
		.filter((s) => eraBySeason.get(s.season)?.ipouts > 0)
		.map((s) => {
			const { er, ipouts } = eraBySeason.get(s.season);
			return { season: s.season, record: s.record, era: (27 * er) / ipouts, er, ip: inningsPitched(ipouts) };
		});
	const bestTeamEra = teamEra.slice().sort((a, b) => a.era - b.era || a.season - b.season).slice(0, top);
	const worstTeamEra = teamEra.slice().sort((a, b) => b.era - a.era || a.season - b.season).slice(0, top);

	// The seasons these box score records actually cover: the ones with
	// teamstats. The season being played has game results but no box scores
	// until Retrosheet publishes it, so its cards must not claim it.
	let boxFirst = Infinity, boxLast = -Infinity;
	for (const g of games) {
		if (!pitch.has(g.gid)) continue;
		const yr = parseInt(g.season, 10);
		if (yr < boxFirst) boxFirst = yr;
		if (yr > boxLast) boxLast = yr;
	}
	const boxSeasonRange = boxLast >= boxFirst ? { first: boxFirst, last: boxLast } : null;
	return { bestSeasons, worstSeasons, bestTeamEra, worstTeamEra, noHitters, perfectGames, triplePlays, mostTeamHrGames, mostTeamErrorGames, boxSeasonRange };
}

/** Innings pitched as baseball writes it: 212 outs and a third is "212.1". */
export const inningsPitched = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

/** ERA to three places on the records: two is the box score convention, but
 *  it ties seasons that are not tied (1988 and 1972 both read 3.45). */
export const formatEra = (era) => era.toFixed(3);

/** Best and worst single-season ERAs by a Brewers pitcher.
 *
 *  `pitching` is the box score pitching index (gid -> one line per pitcher),
 *  `rowByGid` the parsed game rows, used to keep regular-season games and
 *  read the season. A pitcher qualifies with one inning per team game, MLB's
 *  rule for the ERA title, so the list is starters and the occasional
 *  workhorse reliever, not a September call-up with two clean innings.
 *  A pitcher traded mid-season counts only his Brewers innings, and against
 *  the Brewers' game count. */
export function computePitcherEra(pitching, rowByGid, playerNames, { top = 5, teamIds = BREWERS_IDS } = {}) {
	const teamGames = new Map();
	for (const r of rowByGid.values()) {
		if (r.regular_season !== '1' || !RESULTS.has(r.result)) continue;
		const yr = parseInt(r.season, 10);
		teamGames.set(yr, (teamGames.get(yr) || 0) + 1);
	}
	const seasons = new Map(); // "season|id" -> totals
	for (const [gid, lines] of pitching) {
		const g = rowByGid.get(gid);
		if (!g || g.regular_season !== '1') continue;
		const season = parseInt(g.season, 10);
		for (const p of lines) {
			if (!teamIds.has(p.team)) continue;
			const key = `${season}|${p.id}`;
			const s = seasons.get(key) || { season, playerId: p.id, er: 0, ipouts: 0, gs: 0, g: 0 };
			s.er += p.er;
			s.ipouts += p.ipouts;
			s.g += 1;
			if (p.gs) s.gs += 1;
			seasons.set(key, s);
		}
	}
	const qualified = [...seasons.values()]
		.filter((s) => s.ipouts > 0 && s.ipouts >= 3 * (teamGames.get(s.season) || Infinity))
		.map((s) => ({
			...s,
			player: playerNames.get(s.playerId) || s.playerId,
			era: (27 * s.er) / s.ipouts,
			ip: inningsPitched(s.ipouts),
		}));
	return {
		bestPitcherEra: qualified.slice().sort((a, b) => a.era - b.era || b.ipouts - a.ipouts).slice(0, top),
		worstPitcherEra: qualified.slice().sort((a, b) => b.era - a.era || b.ipouts - a.ipouts).slice(0, top),
	};
}

/** The numbers a single season's page shows: the regular-season record, the
 *  postseason record beside it, and the championship's name if it was won.
 *
 *  `rows` is one season's games as parseGameinfoCsv produces them.
 *
 *  Lifted out of main.js, where it sat inline in processCsvSeasonData and
 *  tallied and rendered in one pass. The football repo's copy of this function
 *  was extracted first and the two are deliberately convergent, because a shared
 *  core is the point of the exercise.
 *
 *  The one place they read differently is the championship, and the difference
 *  turned out not to need a flag. A World Series is a best-of-seven, so winning
 *  a single game in it is not winning it — the test is more championship-round
 *  wins than losses. Applied to a Super Bowl, which is one game, that same test
 *  gives exactly the football answer: a win is 1 > 0, a defeat is 0 > 1. The
 *  series rule is the general one and the single-game rule is a special case of
 *  it, so both sites can run this line unchanged.
 *
 *  Deliberately not folded into computeSeasonHistory, which looks like it
 *  already does this and does not: it exposes no postseason record, only a
 *  boolean for the championship rather than its name, and a different notion of
 *  undefeated — see below.
 */
export function seasonTally(rows, site = SITE) {
	let wins = 0, losses = 0, ties = 0;
	let postWins = 0, postLosses = 0, postTies = 0;
	let titleWins = 0, titleLosses = 0, titleName = null;

	for (const g of rows) {
		if (g.regular_season === '1') {
			if (g.result === 'WIN') wins++;
			else if (g.result === 'LOSS') losses++;
			else if (g.result === 'TIE') ties++;
		} else if (g.playoff === '1') {
			if (g.result === 'WIN') postWins++;
			else if (g.result === 'LOSS') postLosses++;
			else if (g.result === 'TIE') postTies++;
		}
		if (g.championship && g.championship.trim() !== '') {
			titleName = `${site.championship} ${g.championship.toUpperCase()}`;
			if (g.result === 'WIN') titleWins++;
			else if (g.result === 'LOSS') titleLosses++;
		}
	}

	return {
		wins, losses, ties,
		// A postseason of ties alone does not count as one. Preserved from the
		// inline version rather than tidied: the only rows that could produce it
		// are unplayed or malformed.
		postseason: (postWins > 0 || postLosses > 0)
			? { w: postWins, l: postLosses, t: postTies }
			: null,
		championshipName: titleWins > titleLosses ? titleName : null,
		// Undefeated *so far*, which is not computeSeasonHistory's `undefeated`.
		// That one also requires the season to have finished, because the records
		// page lists completed lossless seasons. This one answers what the front
		// page asks, which a team can be answering yes to in April.
		//
		// It is reachable here in a way it is not in football: a baseball team
		// opens 1-0 roughly half the time. It has never survived to the end of a
		// season and, per site.js, never will.
		undefeated: losses === 0 && wins > 0,
	};
}

/** 'YYYY-MM-DD' -> local-time Date. new Date('YYYY-MM-DD') parses as UTC
 *  midnight, which any timezone west of UTC displays as the PREVIOUS day.
 *
 *  main.js had this as `parseLocalDate`, built by string concatenation rather
 *  than from components; it now imports this one under that name, so there is
 *  one implementation instead of two that have to agree. The football repo has
 *  had the component form in its core all along, and this is a copy of it, so
 *  the two are now the same function under the same name.
 */
export function localDate(iso) {
	const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
	return new Date(y, m - 1, d);
}

/** Games played within `windowDays` of a given month and day, in any season.
 *
 *  `bySeason` is the season-keyed map main.js already builds. `month` is
 *  0-based, matching Date#getMonth, because the caller gets it from a Date.
 *
 *  The window comes from the manifest: zero here, three on the football site.
 *  Across 50-odd seasons of near-daily baseball there is almost always a game on
 *  the exact date; a sport playing seventeen games a year has empty calendar
 *  dates by the hundred. Same code path, one number.
 *
 *  The proximity test is `month * 31 + day`, which is not a date calculation. At
 *  a window of zero it is exact and the arithmetic does not matter. It does
 *  matter on the football site, where the window does not wrap around the end of
 *  the year — see the test there.
 */
export function onThisDayCandidates(bySeason, month, day, { windowDays = SITE.onThisDayWindowDays } = {}) {
	const target = month * 31 + day;
	const out = [];
	for (const [yr, games] of Object.entries(bySeason)) {
		for (const g of games) {
			if (!g.date) continue;
			const d = localDate(g.date);
			if (isNaN(d)) continue;
			if (Math.abs((d.getMonth() * 31 + d.getDate()) - target) <= windowDays) {
				out.push({ game: g, season: parseInt(yr, 10), date: d });
			}
		}
	}
	return out;
}

/** How interesting a game is, for choosing which one the panel shows.
 *
 *  Baseball-only, and the reason this site picks by weight where the football
 *  one picks uniformly: with a game on almost every calendar date, fifty-odd
 *  candidates arrive and most of them are a routine 4-2 in July. The scores
 *  below are not derived from anything — they are a judgement about what is
 *  worth reading, and they were previously buried in main.js where nothing could
 *  check them.
 *
 *  `lineScores` is the gid-keyed map from teamstats; absent for older games, so
 *  every clause that reads it is optional. `teamIds` decides which side of the
 *  line score is ours.
 */
export function otdInterest({ game: g }, lineScores = null, teamIds = BREWERS_IDS) {
	let score = 0;
	const bs = parseInt(g.scoreFor, 10), os = parseInt(g.scoreAgainst, 10);
	if (Number.isFinite(bs) && Number.isFinite(os)) {
		const diff = Math.abs(bs - os), total = bs + os;
		if (diff >= 10) score += 6; else if (diff >= 7) score += 4; else if (diff >= 5) score += 2;
		if (total >= 20) score += 3; else if (total >= 15) score += 2;
		if (g.result === 'WIN') { score += 1; if (os === 0) score += 1; }
	}
	if (g.championship && g.championship.trim()) score += 8;
	else if (g.playoff === '1') score += 5;

	const ls = g.gid ? lineScores?.get(g.gid) : null;
	if (ls?.visitor && ls?.home) {
		const inns = Math.max(
			ls.visitor.inns.filter((x) => x !== '').length,
			ls.home.inns.filter((x) => x !== '').length);
		if (inns >= 13) score += 5; else if (inns >= 10) score += 3;
		const mine = teamIds.has(ls.home.team) ? ls.home : ls.visitor;
		const opp = mine === ls.home ? ls.visitor : ls.home;
		if (mine.hr >= 4) score += 5; else if (mine.hr >= 3) score += 3;
		if (mine.hr + opp.hr >= 6) score += 2;
		// A no-hitter outscores everything else on the list combined, which is
		// the intent: it is the rarest thing in the file.
		if (opp.h === 0 && inns >= 9) score += 12;
		else if (opp.h === 0 || mine.h === 0) score += 6;
	}
	return score;
}

/** Weighted random choice from scored candidates, optionally excluding one (the
 *  refresh button, which must not hand back the game already on screen).
 *
 *  `random` is injectable so this is testable at all; it was `Math.random()`
 *  inline, which meant the weighting could never be checked. Weight is
 *  `1 + interest * 2`, so a dull game is never impossible, only unlikely.
 */
export function otdPick(pool, exclude = null, random = Math.random) {
	const items = exclude ? pool.filter((c) => c !== exclude) : pool;
	if (!items.length) return null;
	const weights = items.map((c) => 1 + (c.interest || 0) * 2);
	let r = random() * weights.reduce((a, b) => a + b, 0);
	for (let i = 0; i < items.length; i++) {
		r -= weights[i];
		if (r <= 0) return items[i];
	}
	return items[items.length - 1];
}

/** Win-loss(-tie) joined with ASCII hyphens, as the streak banner writes them.
 *
 *  Deliberately not `rec` above, which joins with en dashes. The two look nearly
 *  identical in a diff and are different bytes on the page, so folding them
 *  together would change the rendered text while every test still passed.
 */
export const hyphenRecord = (games) => {
	let w = 0, l = 0, t = 0;
	for (const g of games) {
		if (g.result === 'WIN') w++;
		else if (g.result === 'LOSS') l++;
		else t++;
	}
	return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
};

/** The streak banner's sentence, or null when there is nothing to say.
 *
 *  Character-for-character the same function as the football repo's, which is
 *  the point: these six sentences were duplicated across two files and are now
 *  duplicated across two files that can be diffed to zero. The recent-form
 *  additions below are this site's alone and stay separate for that reason.
 *
 *  **A tie ends the opening run, and the sentence then calls it a loss.** The
 *  loop counts WIN and stops on anything else. Baseball ties are rare enough
 *  that this has less bite here than on the football site, where 1929 went
 *  12-0-1 and the front page describes its eleventh game as a defeat. Left
 *  alone in both repos, pinned by a test in both, and listed in ROADMAP.md as a
 *  copy decision rather than a refactor.
 */
export function streakBannerHtml(completedGames, { isPastSeason = false, site = SITE } = {}) {
	if (completedGames.length === 0) return null;
	const sorted = [...completedGames].sort((a, b) => a.date - b.date);

	let openingStreak = 0;
	let firstLoss = null;
	for (const g of sorted) {
		if (g.result === 'WIN') openingStreak++;
		else { firstLoss = g; break; }
	}

	const plural = (n, noun) => (n === 1 ? `1 ${noun}` : `${n} ${noun}s`);
	const daysToLoss = () =>
		Math.round((firstLoss.date - sorted[0].date) / (1000 * 60 * 60 * 24));

	if (isPastSeason) {
		if (!firstLoss) return `Finished the regular season undefeated &mdash; <strong>${openingStreak}-0</strong>`;
		if (openingStreak === 0) return `Lost the opener &mdash; undefeated for <strong>0 games</strong> to start the season`;
		return `Undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}) to start the season before first loss`;
	}

	let winStreak = 0;
	for (let i = sorted.length - 1; i >= 0; i--) {
		if (sorted[i].result === 'WIN') winStreak++;
		else break;
	}

	if (!firstLoss) return `Undefeated to start the season &mdash; <strong>${openingStreak}</strong>-game win streak`;
	if (openingStreak === 0) return `Lost the opener. Currently on a <strong>${winStreak}-game</strong> win streak.`;
	return `The ${site.team} started the season undefeated for <strong>${plural(openingStreak, 'game')}</strong> (${plural(daysToLoss(), 'day')}). Currently on a <strong>${winStreak}-game</strong> win streak.`;
}

/** The "recent form" line under the banner: last ten and the calendar month.
 *
 *  Baseball's alone, and it is the reason this method was 105 lines here against
 *  62 on the football site. It only makes sense in a sport that plays most days:
 *  "last 10" across a seventeen-game season is most of the season, and a
 *  calendar month is two or three games.
 *
 *  `now` is a parameter so the month line can be tested at all; it was
 *  new Date() inline.
 */
export function recentFormParts(sorted, now = new Date()) {
	const parts = [];
	if (sorted.length >= 10) parts.push(`Last 10: <strong>${hyphenRecord(sorted.slice(-10))}</strong>`);
	const monthGames = sorted.filter(
		(g) => g.date.getMonth() === now.getMonth() && g.date.getFullYear() === now.getFullYear());
	if (monthGames.length) {
		parts.push(`${now.toLocaleDateString('en-US', { month: 'long' })}: <strong>${hyphenRecord(monthGames)}</strong>`);
	}
	return parts;
}

// Wins needed to take a series, by round, as the round is named now: ESPN's
// game note ("NLDS - Game 4") for the season being played, ROUND_LABEL for the
// rest. Wild card best of three, division series best of five, LCS and World
// Series best of seven, and a tiebreaker is one game.
//
// That is the current format, and the Retrosheet years are not all current:
// the 1982 ALCS was best of five, and 3-2 in a round needing four reads
// "lead 3-2". Past seasons pass `settled` for that reason — every series in
// them is over, so the result is whoever won more.
//
// World Series is tested before "championship", which it would otherwise
// match as an LCS.
// ESPN's WNBA notes: "First Round - Game 1", "WNBA Semifinals - Game 1",
// "WNBA Finals - Game 1"; and ROUND_LABEL's names, which past seasons' series
// arrive as. Lengths are today's: the first round best of three, the
// semifinals of five, the Finals of seven (since 2025). Earlier formats are
// covered by `settled`, as above.
const ROUND_PATTERNS = [
	[/\bwnba finals\b/i, 'W'],
	[/\b1st round\b|first round/i, 'F'],
	[/\b2nd round\b|second round/i, 'D'],
	[/semifinals/i, 'L'],
];
const WINS_NEEDED = { T: 1, F: 2, D: 1, L: 3, W: 4 };

/** The gametype code (T/F/D/L/W) for a round's name, or null. */
export const roundCodeOf = (name) => ROUND_PATTERNS.find(([re]) => re.test(name || ''))?.[1] ?? null;

/** Every playoff series in a season, in the order they were played, with how
 *  each stands.
 *
 *  `games` is every postseason game, played or not, as `{ round, opponent,
 *  result }` with `result` 'WIN'/'LOSS' once final and null before (a game in
 *  progress is null too — the series is 0-0 until it ends). Scheduled games
 *  are what make a series that has not started show at all. Any other fields
 *  ride along in `games`, so a caller can find the next game of a series.
 *
 *  A series is over when either side reaches the wins its round needs. A round
 *  this table does not recognise is never called over: it reads "lead 3-1"
 *  rather than guessing a length and declaring a winner.
 */
export function postseasonSeries(games, { settled = false } = {}) {
	const series = new Map();
	for (const g of games) {
		const key = `${g.round}|${g.opponent}`;
		if (!series.has(key)) {
			const code = roundCodeOf(g.round);
			series.set(key, { round: g.round, opponent: g.opponent, code, need: WINS_NEEDED[code] ?? null, w: 0, l: 0, games: [] });
		}
		const s = series.get(key);
		s.games.push(g);
		if (g.result === 'WIN') s.w++;
		else if (g.result === 'LOSS') s.l++;
	}
	return [...series.values()].map((s) => {
		const { w, l } = s;
		// A finished series was as long as its winner's wins: the 1982 ALCS
		// went to three, not today's four.
		const need = settled && w !== l ? Math.max(w, l) : s.need;
		const state =
			(need && w >= need) || (settled && w > l) ? 'won' :
			(need && l >= need) || (settled && l > w) ? 'lost' :
			w > l ? 'lead' : w < l ? 'trail' : 'tied';
		return { ...s, need, state };
	});
}

/** One line per series: "NLDS vs Padres: won 3-1 · NLCS vs Dodgers: tied 0-0". */
export const seriesLine = (s) => `${esc(s.round)} vs ${esc(s.opponent)}: <strong>${s.state} ${s.w}-${s.l}</strong>`;

/** The same, as plain text, for places that set text rather than HTML. Built
 *  directly, not by stripping tags off seriesLine: CodeQL flagged that, since a
 *  regex strip is not a sanitizer. */
export const seriesText = (s) => `${s.round} vs ${s.opponent}: ${s.state} ${s.w}-${s.l}`;

export const postseasonSeriesParts = (games, opts) => postseasonSeries(games, opts).map(seriesLine);

/** The most recent `n` decided meetings with one franchise, oldest first.
 *
 *  The opponent still has to be resolved from the live ESPN payload, which is
 *  main.js's problem; this is the part that only needs rows.
 */
export function lastMeetings(rows, franchise, n = 10) {
	return rows
		.filter((r) => r.franchise === franchise && RESULTS.has(r.result))
		.sort((a, b) => (a.date < b.date ? -1 : 1))
		.slice(-n);
}

// Meta copy for the /history page, shared by server OG meta and client share.
export function historyCopy(history, site = SITE) {
	const first = history[0].season, last = history[history.length - 1].season;
	const titles = history.filter((s) => s.champion).length;
	const winning = history.filter((s) => s.winPct > 0.5).length;
	return {
		title: `${site.team} Season-by-Season History, ${first}–${last}`,
		desc: `Every ${site.fullName} season since ${first} in one chart: ${championships(titles)} and ${winning} winning seasons across ${history.length} years.`,
	};
}

// Per-card copy shared by server OG meta and client share messages.
// slug 'overview' covers the /records landing URL.
export function recordsCopy(slug, data, site = SITE) {
	const range = `${data.seasonRange.first}–${data.seasonRange.last}`;
	switch (slug) {
		case 'best-starts': {
			const b = data.bestStarts[0];
			return {
				title: `Best ${site.team} Season Starts — ${b.games}–0 in ${b.season}`,
				desc: `The best start in ${site.fullName} history: ${b.games}–0 to open the ${b.season} season. Top ${data.bestStarts.length} starts, ${range}.`,
			};
		}
		case 'world-series-appearances': {
			const w = data.championshipAppearances;
			return {
				title: w.length ? `${site.team} World Series — ${w.map((x) => `${x.season} (${x.result} ${x.record} vs ${x.opponent})`).join(', ')}` : `${site.team} World Series Appearances`,
				desc: w.length
					? `World Series results by the ${site.fullName}: ${w.map((x) => `${x.season}: ${x.result} ${x.record} vs the ${x.opponent}`).join('; ')}.`
					: site.copy.noWorldSeries,
			};
		}
		case 'playoff-appearances': {
			const p = data.playoffAppearances;
			const summary = p.map((x) => `${x.season} (${x.series.map((s) => `${s.result} ${s.roundLabel}`).join(', ')})`).join('; ');
			return {
				title: p.length ? `${site.team} Playoff Appearances — ${p.map((x) => x.season).join(', ')}` : `${site.team} Playoff Appearances`,
				desc: p.length
					? `Postseason series results by the ${site.fullName}: ${summary}.`
					: site.copy.noPlayoffs,
			};
		}
		case 'win-streaks': {
			const s = data.winStreaks[0];
			return {
				title: `Longest ${site.team} Win Streaks — ${s.games} straight (${streakSpan(s)})`,
				desc: `The longest regular-season win streak in ${site.fullName} history: ${s.games} straight, ${formatDate(s.startDate)} to ${formatDate(s.endDate)}.`,
			};
		}
		case 'losing-streaks': {
			const s = data.loseStreaks[0];
			if (!s) return { title: `Longest ${site.team} Losing Streaks`, desc: site.copy.noLosingStreak };
			return {
				title: `Longest ${site.team} Losing Streaks — ${s.games} straight (${streakSpan(s)})`,
				desc: `The longest regular-season losing streak in ${site.fullName} history: ${s.games} straight, ${formatDate(s.startDate)} to ${formatDate(s.endDate)}. ${site.copy.worstLossAside}`,
			};
		}
		case 'player-error-game': {
			const h = data.playerErrorGames || [];
			if (!h.length) return { title: 'Most Errors in a Game by a Brewer', desc: 'Player single-game error records.' };
			const g = h[0];
			return {
				title: `Most Errors in a Game by a Brewer — ${g.e}`,
				desc: `${g.player} was charged ${g.e} errors vs the ${g.opponent} on ${formatDate(g.date)}. It happens.`,
			};
		}
		case 'team-error-game': {
			const h = data.mostTeamErrorGames || [];
			if (!h.length) return { title: `Most ${site.team} Errors in a Game`, desc: 'Team single-game error records.' };
			const g = h[0];
			return {
				title: `Most ${site.team} Errors in a Game — ${g.e}`,
				desc: `The ${site.team} committed ${g.e} errors vs the ${g.opponent} on ${formatDate(g.date)}. A day to forget.`,
			};
		}
		case 'worst-starts': {
			const w = data.worstStarts[0];
			return {
				title: `Worst ${site.team} Season Starts — 0–${w.games} in ${w.season}`,
				desc: `The worst start in ${site.fullName} history: 0–${w.games} to open the ${w.season} season. ${site.copy.worstStartAside}`,
			};
		}
		case 'lopsided-wins': {
			const g = data.lopsidedWins[0];
			return {
				title: `Most Lopsided ${site.team} Wins — ${g.pf}–${g.pa} over the ${g.opponent}`,
				desc: `The biggest blowout in ${site.fullName} history: ${g.pf}–${g.pa} over the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		case 'worst-losses': {
			const g = data.lopsidedLosses[0];
			return {
				title: `Worst ${site.team} Losses — ${g.pf}–${g.pa} to the ${g.opponent}`,
				desc: `The most lopsided loss in ${site.fullName} history: ${g.pa}–${g.pf} to the ${g.opponent} on ${formatDate(g.date)}. ${site.copy.worstLossAside}`,
			};
		}
		case 'ties': {
			const t = data.ties[0];
			if (!t) return { title: `${site.team} Ties`, desc: site.copy.noTies };
			return {
				title: `${site.team} Ties — ${data.ties.length} all-time`,
				desc: `The ${site.team} have played ${data.ties.length} ties. Most recent: ${t.pf}–${t.pa} vs the ${t.opponent} on ${formatDate(t.date)}.`,
			};
		}
		case 'best-seasons': {
			const s = data.bestSeasons[0];
			return {
				title: `Best ${site.team} Seasons — ${s.record} in ${s.season}`,
				desc: `The best ${site.fullName} season: ${s.record} in ${s.season}. Top ${data.bestSeasons.length} seasons by winning percentage.`,
			};
		}
		case 'worst-seasons': {
			const s = data.worstSeasons[0];
			return {
				title: `Worst ${site.team} Seasons — ${s.record} in ${s.season}`,
				desc: `The worst ${site.fullName} season: ${s.record} in ${s.season}. ${site.copy.worstStartAside}`,
			};
		}
		case 'best-team-era':
		case 'worst-team-era': {
			const best = slug === 'best-team-era';
			const s = (best ? data.bestTeamEra : data.worstTeamEra)?.[0];
			const which = best ? 'Best' : 'Worst';
			if (!s) return { title: `${which} ${site.team} Team ERAs`, desc: `The ${which.toLowerCase()} single-season team ERAs in ${site.fullName} history.` };
			return {
				title: `${which} ${site.team} Team ERAs — ${formatEra(s.era)} in ${s.season}`,
				desc: `The ${which.toLowerCase()} ${site.fullName} team ERA: ${formatEra(s.era)} in ${s.season}, a ${s.record} season. Completed regular seasons.`,
			};
		}
		case 'best-pitcher-era':
		case 'worst-pitcher-era': {
			const best = slug === 'best-pitcher-era';
			const s = (best ? data.bestPitcherEra : data.worstPitcherEra)?.[0];
			const which = best ? 'Best' : 'Worst';
			if (!s) return { title: `${which} ${site.team} Pitcher ERAs`, desc: `The ${which.toLowerCase()} single-season ERAs by a ${site.team} pitcher, qualified at one inning per team game.` };
			return {
				title: `${which} ${site.team} Pitcher ERAs — ${s.player}, ${formatEra(s.era)} in ${s.season}`,
				desc: `The ${which.toLowerCase()} single-season ERA by a qualified ${site.team} pitcher: ${s.player}, ${formatEra(s.era)} over ${s.ip} innings in ${s.season}.`,
			};
		}
		case 'no-hitters': {
			const n = data.noHitters;
			if (!n.length) return { title: `${site.team} No-Hitters`, desc: site.copy.noNoHitter };
			const g = n[0];
			const who = g.pitchers?.length
				? (g.pitchers.length > 1 ? `, a combined no-hitter by ${g.pitchers.join(' and ')}` : ` by ${g.pitchers[0]}`)
				: '';
			return {
				title: `${site.team} No-Hitters — ${n.length} all-time`,
				desc: `The ${site.team} have thrown ${n.length} no-hitter${n.length === 1 ? '' : 's'}, individual and combined. Most recent: ${g.pf}–${g.pa} vs the ${g.opponent} on ${formatDate(g.date)}${who}.`,
			};
		}
		case 'perfect-games': {
			const n = data.perfectGames;
			if (!n.length) return { title: `${site.team} Perfect Games`, desc: site.copy.noPerfectGame };
			const g = n[0];
			return {
				title: `${site.team} Perfect Games — ${n.length} all-time`,
				desc: `The ${site.team} have thrown ${n.length} perfect game${n.length === 1 ? '' : 's'}. Most recent: ${g.pf}–${g.pa} vs the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		case 'triple-plays': {
			const t = data.triplePlays || [];
			if (!t.length) return { title: `${site.team} Triple Plays`, desc: site.copy.noTriplePlay };
			const g = t[0];
			return {
				title: `${site.team} Triple Plays — ${t.length} all-time`,
				desc: `The ${site.team} have turned ${t.length} triple play${t.length === 1 ? '' : 's'}. Most recent: vs the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		case 'most-hr-game': {
			const h = data.mostTeamHrGames || [];
			if (!h.length) return { title: `Most ${site.team} Home Runs in a Game`, desc: 'Team single-game home run records.' };
			const g = h[0];
			return {
				title: `Most ${site.team} Home Runs in a Game — ${g.hr}`,
				desc: `The most home runs the ${site.team} have hit in one game: ${g.hr}, vs the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		case 'player-hr-game': {
			const h = data.playerHrGames || [];
			if (!h.length) return { title: 'Most Home Runs in a Game by a Brewer', desc: 'Player single-game home run records.' };
			const g = h[0];
			return {
				title: `Most Home Runs in a Game by a Brewer — ${g.hr}`,
				desc: `${g.player} hit ${g.hr} home runs vs the ${g.opponent} on ${formatDate(g.date)} — the most by a Brewer in one game. ${h.length} such games all-time.`,
			};
		}
		case 'player-rbi-game': {
			const h = data.playerRbiGames || [];
			if (!h.length) return { title: 'Most RBIs in a Game by a Brewer', desc: 'Player single-game RBI records.' };
			const g = h[0];
			return {
				title: `Most RBIs in a Game by a Brewer — ${g.rbi}`,
				desc: `${g.player} drove in ${g.rbi} runs vs the ${g.opponent} on ${formatDate(g.date)} — the most by a Brewer in one game.`,
			};
		}
		case 'cycles': {
			const c = data.cycles || [];
			if (!c.length) return { title: `${site.team} Cycles`, desc: `Every cycle hit in ${site.fullName} history.` };
			const g = c[0];
			return {
				title: `${site.team} Cycles — ${c.length} all-time`,
				desc: `${c.length} player${c.length === 1 ? ' has' : 's have'} hit for the cycle for the ${site.team}. Most recent: ${g.player} vs the ${g.opponent} on ${formatDate(g.date)}.`,
			};
		}
		default:
			return {
				title: `${site.team} Records & Superlatives`,
				desc: `Best starts, longest win streaks, worst starts, lopsided wins, worst losses, no-hitters, triple plays, cycles, World Series and playoff appearances, and every tie — ${site.fullName}, ${range}.`,
			};
	}
}

// Parse teamstats.csv and return a Map of gid → { visitor, home } where each side has:
//   team, inns (array of run strings per inning, '' for not played), r, h, e
export function parseTeamstatsLineScores(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const gidI = headers.indexOf('gid');
	const teamI = headers.indexOf('team');
	const vhI = headers.indexOf('vishome');
	const runI = headers.indexOf('b_r');
	const hitI = headers.indexOf('b_h');
	const errI = headers.indexOf('d_e');
	const lobI = headers.indexOf('lob');
	const dpI = headers.indexOf('d_dp');
	const tpI = headers.indexOf('d_tp');
	const hrI = headers.indexOf('b_hr');
	const innIdxs = [];
	for (let i = 1; i <= 28; i++) {
		innIdxs.push(headers.indexOf(`inn${i}`));
	}
	const map = new Map();
	for (const line of lines.slice(1)) {
		const v = splitCsvLine(line);
		const gid = v[gidI]?.trim();
		if (!gid) continue;
		if (!map.has(gid)) map.set(gid, {});
		const entry = map.get(gid);
		const vh = v[vhI]?.trim();
		const side = {
			team: v[teamI]?.trim() || '',
			inns: innIdxs.map(idx => (idx >= 0 ? v[idx]?.trim() ?? '' : '')),
			r: parseInt(v[runI], 10) || 0,
			h: parseInt(v[hitI], 10) || 0,
			e: parseInt(v[errI], 10) || 0,
			lob: lobI >= 0 ? parseInt(v[lobI], 10) || 0 : 0,
			dp: dpI >= 0 ? parseInt(v[dpI], 10) || 0 : 0,
			tp: tpI >= 0 ? parseInt(v[tpI], 10) || 0 : 0,
			hr: hrI >= 0 ? parseInt(v[hrI], 10) || 0 : 0,
		};
		if (vh === 'v') entry.visitor = side;
		else if (vh === 'h') entry.home = side;
	}
	return map;
}

// The record cards this site publishes, read out of the manifest rather than
// listed again here. Two lists that must agree are one list read twice, and
// the copy that drifts is the one nobody is looking at. Kept as an export so
// existing call sites did not change.
export const RECORD_SLUGS = SITE.records;

// Records drawn from box scores, which stop at the last season Retrosheet has
// published; the rest come from game results and include the season being
// played. The page and the share cards both read this to say so.
export const BOX_SCORE_RECORDS = new Set(['best-team-era', 'worst-team-era', 'best-pitcher-era', 'worst-pitcher-era',
	'no-hitters', 'perfect-games', 'triple-plays', 'most-hr-game',
	'team-error-game', 'player-hr-game', 'player-rbi-game', 'player-error-game', 'cycles']);
