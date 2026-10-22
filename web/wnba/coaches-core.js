import { SITE } from './site.js';

/** Title case for a manifest noun used at the start of a heading. The
 *  manifest stores lowercase because most uses are mid-sentence. */
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// Shared (browser + node) head-manager records, computed by assigning every
// game to a managing tenure by date. Official tenures come from
// data/managers.csv (name, start_year, end_year); any game managed by someone
// not listed, or outside their official year range, is interim. Pure
// functions only.
import { rec, splitCsvLine, BREWERS_IDS, championships } from './records-core.js';

// Parses data/managers.csv → [{ mgrId, startDate, endDate }] in file order.
// Dates are M/D/YYYY and normalized to ISO YYYY-MM-DD for exact comparison.
// end_date empty means "present" (treated as 9999-12-31). A mgrId may appear
// more than once (multiple stints, e.g. kuenh101 in 1975 and 1982-83).
function toIsoDate(raw) {
	const [m, d, y] = raw.split('/').map((n) => parseInt(n, 10));
	if (!y) return null;
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function parseManagersCsv(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const nameIdx = headers.indexOf('name');
	const sdIdx = headers.indexOf('start_date');
	const edIdx = headers.indexOf('end_date');
	return lines.slice(1).filter((l) => l.trim()).map((l) => {
		const v = splitCsvLine(l);
		const startDate = toIsoDate((v[sdIdx] || '').trim());
		const edRaw = (v[edIdx] || '').trim();
		const endDate = edRaw ? toIsoDate(edRaw) : '9999-12-31';
		if (!startDate) return null;
		return { mgrId: v[nameIdx]?.trim(), startDate, endDate };
	}).filter(Boolean);
}

export const slugifyCoach = (name) =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function parseCoachesCsv(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	return lines.slice(1).map((l) => {
		const v = splitCsvLine(l); const o = {};
		headers.forEach((h, i) => { o[h] = v[i] ?? ''; });
		return o;
	});
}

const RESULTS = new Set(['WIN', 'LOSS', 'TIE']);

// games: parsed brewers_games.csv rows. tenures: parsed brewers_coaches.csv
// rows ({coach, from, to}; empty to = present). Returns { coaches, bySlug },
// coaches in tenure order. A championship counts for the manager who managed
// that champion season's final game.
export function computeCoaches(rows, tenures, championSeasons) {
	const games = rows
		.filter((g) => RESULTS.has(g['result']))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	const spans = tenures.map((t) => ({
		name: t.coach, from: t.from, to: t.to || '9999-12-31',
		interim: t.interim === '1',
		image: t.image || null, imagePage: t.image_page || null,
	}));
	const coachOf = (date) => spans.find((s) => date >= s.from && date <= s.to)?.name ?? null;

	const byCoach = new Map(spans.map((s) => [s.name, []]));
	for (const g of games) {
		const name = coachOf(g.date);
		if (name) byCoach.get(name).push(g);
	}

	// Champion season -> manager of that season's final game.
	const titleCount = new Map();
	const bySeason = new Map();
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (!bySeason.has(yr) || g.date > bySeason.get(yr).date) bySeason.set(yr, g);
	}
	for (const yr of championSeasons) {
		const finale = bySeason.get(yr);
		const name = finale && coachOf(finale.date);
		if (name) titleCount.set(name, (titleCount.get(name) || 0) + 1);
	}

	const coaches = spans
		.filter((s) => byCoach.get(s.name).length > 0)
		.map((s) => {
			const list = byCoach.get(s.name);
			const reg = { WIN: 0, LOSS: 0, TIE: 0 };
			const playoff = { WIN: 0, LOSS: 0, TIE: 0 };
			let pf = 0, pa = 0;
			for (const g of list) {
				(g.regular_season === '1' ? reg : playoff)[g['result']]++;
				pf += parseInt(g.scoreFor, 10) || 0;
				pa += parseInt(g.scoreAgainst, 10) || 0;
			}
			const regGames = reg.WIN + reg.LOSS + reg.TIE;
			const playoffGames = playoff.WIN + playoff.LOSS + playoff.TIE;
			const firstSeason = parseInt(list[0].season, 10);
			const lastSeason = parseInt(list[list.length - 1].season, 10);
			return {
				name: s.name, slug: slugifyCoach(s.name),
				interim: s.interim,
				image: s.image, imagePage: s.imagePage,
				firstSeason, lastSeason,
				tenure: firstSeason === lastSeason ? String(firstSeason) : `${firstSeason}–${lastSeason}`,
				games: list.length,
				wins: reg.WIN, losses: reg.LOSS, ties: reg.TIE,
				record: rec(reg.WIN, reg.LOSS, reg.TIE),
				winPct: regGames ? (reg.WIN + reg.TIE / 2) / regGames : 0,
				playoffGames,
				playoffRecord: playoffGames ? rec(playoff.WIN, playoff.LOSS, playoff.TIE) : null,
				pf, pa,
				titles: titleCount.get(s.name) || 0,
			};
		});

	return { coaches, bySlug: new Map(coaches.map((c) => [c.slug, c])) };
}

// Meta copy for the /managers page, shared by server OG meta and client share.
export function coachesCopy(data) {
	const { coaches } = data;
	const wins = [...coaches].sort((a, b) => b.wins - a.wins)[0];
	const titles = coaches.reduce((s, c) => s + c.titles, 0);
	return {
		title: `${SITE.team} ${cap(SITE.leaderPlural)}, ${coaches[0].firstSeason}–present`,
		desc: `Every ${SITE.fullName} ${SITE.leaderNoun} and their record — ${coaches.length} of them, ${championships(titles)}. Most wins: ${wins.name} (${wins.record}).`,
	};
}

// Parses biofile0.csv (biographical register). Returns Map<id, displayName>.
export function parseBiofile(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const idIdx = headers.indexOf('id');
	const lastIdx = headers.indexOf('lastname');
	const useIdx = headers.indexOf('usename');
	const fullIdx = headers.indexOf('fullname');
	const result = new Map();
	for (const line of lines.slice(1)) {
		const v = splitCsvLine(line);
		const id = v[idIdx]?.trim();
		if (!id) continue;
		const last = v[lastIdx]?.trim() || '';
		const use = v[useIdx]?.trim() || '';
		const full = v[fullIdx]?.trim() || '';
		result.set(id, use ? `${use} ${last}` : (full || last));
	}
	return result;
}

// Parses teamstats.csv, returning Map<gid, mgrId> for Brewers games only.
export function parseTeamstatsMgr(raw) {
	const lines = raw.trim().split('\n');
	const headers = splitCsvLine(lines[0]);
	const gidIdx = headers.indexOf('gid');
	const teamIdx = headers.indexOf('team');
	const mgrIdx = headers.indexOf('mgr');
	const result = new Map();
	for (const line of lines.slice(1)) {
		const v = splitCsvLine(line);
		const team = v[teamIdx]?.trim();
		if (!BREWERS_IDS.has(team)) continue;
		const gid = v[gidIdx]?.trim();
		const mgr = v[mgrIdx]?.trim();
		if (gid && mgr) result.set(gid, mgr);
	}
	return result;
}

const INTERIM_THRESHOLD = 10;

// Computes manager records directly from game rows (which include gid),
// a gid→mgrId map from teamstats.csv, and an id→name map from biofile0.csv.
// Mid-season changes are handled exactly because each game has its own gid.
//
// officialTenures (optional): parsed managers.csv rows [{ mgrId, startDate,
// endDate }]. When provided, a manager is interim unless they appear in this
// list — managers.csv is the authoritative source for "official" status, not
// a game-count heuristic. Games still count toward whoever managed them, but
// only official tenures show on the history timeline.
export function computeCoachesFromData(rows, gidToMgr, mgrNames, championSeasons, officialTenures = null) {
	const officialIds = officialTenures ? new Set(officialTenures.map((t) => t.mgrId)) : null;
	const games = rows
		.filter((g) => RESULTS.has(g['result']) && g.gid && gidToMgr.has(g.gid))
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	// Build per-manager tenure list from managers.csv so a manager with
	// multiple stints (e.g. Kuenn 1975 + 1982-83) produces separate rows.
	const tenuresByMgr = new Map();
	if (officialTenures) {
		for (const t of officialTenures) {
			if (!tenuresByMgr.has(t.mgrId)) tenuresByMgr.set(t.mgrId, []);
			tenuresByMgr.get(t.mgrId).push(t);
		}
	}

	// Which managers started at least one season (first game of each year).
	const seasonStarters = new Set();
	const seenSeason = new Set();
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (!seenSeason.has(yr)) {
			seenSeason.add(yr);
			seasonStarters.add(gidToMgr.get(g.gid));
		}
	}

	// Assign each game to a stint keyed by (mgrId, tenureIdx). For official
	// managers with multiple tenures, tenureIdx separates stints; for everyone
	// else it's 0. Stints are ordered by first-game date (games are sorted).
	const stintOrder = [];
	const gamesByStint = new Map();
	for (const g of games) {
		const mgrId = gidToMgr.get(g.gid);
		const yr = parseInt(g.season, 10);
		let tenureIdx = 0;
		const tenures = tenuresByMgr.get(mgrId);
		if (tenures) {
			// Official manager: only keep games within a managers.csv tenure.
			// Fill-in games outside the tenure (e.g. Murphy 2021 before his
			// 2024 appointment) are skipped so they don't extend the era band.
			tenureIdx = tenures.findIndex((t) => g.date >= t.startDate && g.date <= t.endDate);
			if (tenureIdx === -1) continue;
		}
		const key = `${mgrId}:${tenureIdx}`;
		if (!gamesByStint.has(key)) {
			gamesByStint.set(key, []);
			stintOrder.push({ mgrId, tenureIdx, key });
		}
		gamesByStint.get(key).push(g);
	}

	// Champion season → stint key of that season's final game.
	const titleCount = new Map();
	const lastGameBySeason = new Map();
	for (const g of games) {
		const yr = parseInt(g.season, 10);
		if (!lastGameBySeason.has(yr) || g.date > lastGameBySeason.get(yr).date)
			lastGameBySeason.set(yr, g);
	}
	for (const yr of championSeasons) {
		const finale = lastGameBySeason.get(yr);
		if (!finale) continue;
		const mgrId = gidToMgr.get(finale.gid);
		if (!mgrId) continue;
		const tenures = tenuresByMgr.get(mgrId);
		let tenureIdx = 0;
		if (tenures) {
			tenureIdx = tenures.findIndex((t) => finale.date >= t.startDate && finale.date <= t.endDate);
			if (tenureIdx === -1) tenureIdx = 0;
		}
		const key = `${mgrId}:${tenureIdx}`;
		titleCount.set(key, (titleCount.get(key) || 0) + 1);
	}

	// Track slug duplicates so multi-stint managers get unique slugs.
	const slugCounts = new Map();
	const coaches = stintOrder.map(({ mgrId, tenureIdx, key }) => {
		const list = gamesByStint.get(key);
		const name = mgrNames.get(mgrId) || mgrId;
		const isInterim = officialIds !== null ? !officialIds.has(mgrId) : (list.length < INTERIM_THRESHOLD && !seasonStarters.has(mgrId));
		const reg = { WIN: 0, LOSS: 0, TIE: 0 };
		const playoff = { WIN: 0, LOSS: 0, TIE: 0 };
		let pf = 0, pa = 0;
		for (const g of list) {
			(g.regular_season === '1' ? reg : playoff)[g['result']]++;
			pf += parseInt(g.scoreFor, 10) || 0;
			pa += parseInt(g.scoreAgainst, 10) || 0;
		}
		const regGames = reg.WIN + reg.LOSS + reg.TIE;
		const playoffGames = playoff.WIN + playoff.LOSS + playoff.TIE;
		const firstSeason = parseInt(list[0].season, 10);
		const lastSeason = parseInt(list[list.length - 1].season, 10);
		const tenures = tenuresByMgr.get(mgrId);
		const tenure = tenures ? tenures[tenureIdx] : null;
		// Exact tenure bounds (ISO YYYY-MM-DD) — used for the history-chart era
		// bands so stints don't overlap into neighboring seasons. Falls back to
		// first/last game date for interim managers (no managers.csv row).
		const fromDate = tenure ? tenure.startDate : list[0].date;
		const toDate = tenure ? tenure.endDate : list[list.length - 1].date;
		// Unique slug for multi-stint managers: append stint number.
		const baseSlug = slugifyCoach(name);
		const slugNum = (slugCounts.get(baseSlug) || 0) + 1;
		slugCounts.set(baseSlug, slugNum);
		const slug = slugNum > 1 ? `${baseSlug}-${slugNum}` : baseSlug;
		return {
			name, slug,
			interim: isInterim,
			image: null, imagePage: null,
			firstSeason, lastSeason,
			fromDate, toDate,
			tenure: firstSeason === lastSeason ? String(firstSeason) : `${firstSeason}–${lastSeason}`,
			games: list.length,
			wins: reg.WIN, losses: reg.LOSS, ties: reg.TIE,
			record: rec(reg.WIN, reg.LOSS, reg.TIE),
			winPct: regGames ? (reg.WIN + reg.TIE / 2) / regGames : 0,
			playoffGames,
			playoffRecord: playoffGames ? rec(playoff.WIN, playoff.LOSS, playoff.TIE) : null,
			pf, pa,
			titles: titleCount.get(key) || 0,
		};
	});

	return { coaches, bySlug: new Map(coaches.map((c) => [c.slug, c])) };
}

/** A tenure in the site's own season names: a season that spans two years
 *  (SITE.seasonLabel) is "1999-2000" alone and "1967–1969" in a run, from
 *  the year the first began to the year the last ended. */
const tenureOf = (first, last) => {
	if (!SITE.seasonLabel) return first === last ? String(first) : `${first}–${last}`;
	return first === last ? SITE.seasonLabel(first) : `${first - 1}–${last}`;
};

/** A record with overtime losses, hockey's fourth column, when there are any. */
export const recOtl = (w, l, t, otl) => (otl > 0 ? `${w}–${l}–${t}–${otl}` : rec(w, l, t));

/** The server's tally (data/coaches.json, lib/web-routes.js coachesJson), for
 *  a sport whose games do not say who coached them: hockey's coaches come as
 *  stated tenures (data/reference/nhl-coaches.csv), so leaders.csv is empty
 *  and computeCoachesFromData finds nobody. `coaches` is one row a person, in
 *  the shape computeCoachesFromData gives; `eras` one a spell in charge, for
 *  the history chart's bands, carrying its person's record for the tooltip. */
export function coachesFromJson({ coaches = [], eras = [] } = {}) {
	const rows = coaches.map((l) => {
		const otl = l.otl ?? 0;
		const games = l.w + l.l + l.t + otl;
		const playoffGames = (l.playoffW ?? 0) + (l.playoffL ?? 0);
		return {
			name: l.name, slug: slugifyCoach(l.name), leader: l.leader,
			interim: Boolean(l.interim),
			image: null, imagePage: null,
			firstSeason: l.firstSeason, lastSeason: l.lastSeason,
			tenure: tenureOf(l.firstSeason, l.lastSeason),
			games,
			wins: l.w, losses: l.l, ties: l.t, otl,
			record: recOtl(l.w, l.l, l.t, otl),
			winPct: games ? (l.w + l.t / 2) / games : 0,
			playoffGames,
			playoffRecord: playoffGames ? rec(l.playoffW ?? 0, l.playoffL ?? 0, 0) : null,
			titles: (l.titles ?? []).length,
		};
	});
	const byLeader = new Map(rows.map((r) => [r.leader, r]));
	const seen = new Map();
	const spells = eras.map((e) => {
		const person = byLeader.get(e.leader) ?? { name: e.name, record: '', winPct: 0, titles: 0, playoffRecord: null };
		const base = slugifyCoach(e.name);
		const n = (seen.get(base) || 0) + 1;
		seen.set(base, n);
		// Seasons, not dates: the chart takes either, and a stated tenure has
		// only its seasons. Half a season either side, so a one-season spell is
		// a band and not a line.
		return { ...person, slug: n > 1 ? `${base}-${n}` : base, fromDate: e.from - 0.5, toDate: e.to + 0.5,
			tenure: tenureOf(e.from, e.to) };
	});
	return { coaches: rows, eras: spells };
}
