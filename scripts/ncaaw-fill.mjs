#!/usr/bin/env node
/** The games sportsdataverse's files lack, from ESPN's scoreboards. Its 2001-02
 *  file has about one game in six fewer than the seasons either side (December
 *  2001: 691 games, December 2002: 1,053), UConn's 37 of 39 among them, and its
 *  2000-01 file lacks a Sweet 16 game, which cost that bracket a quarter of a
 *  region. ESPN still has them. Writes data/reference/ncaaw-games-added.csv, in the
 *  files' own columns, which the load reads after them: a deployed load makes
 *  none of these calls.
 *
 *  One call a day: about 165 for 2001-02, 20 for 2001's postseason. Run once;
 *  run again only if a season here turns out short.
 *
 *    node scripts/ncaaw-fill.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvRows } from '../lib/csv.js';
import { sources } from '../sports/ncaaw.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = join(ROOT, 'data', 'sources', 'ncaaw');
const CACHE = join(ROOT, 'data', 'sources', 'espn-ncaaw', 'days');
mkdirSync(CACHE, { recursive: true });
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const COLUMNS = ['id', 'season', 'season_type', 'game_date', 'status_type_name', 'status_type_completed', 'neutral_site', 'tournament_id', 'notes_headline',
	'home_id', 'home_location', 'home_score', 'away_id', 'away_location', 'away_score'];

const WANT = [
	[2002, sources.live.daysOf(2002)],
	[2001, sources.live.daysOf(2001).filter((d) => d >= '20010314')],
];

const out = [];
for (const [season, days] of WANT) {
	const have = new Set();
	for await (const r of csvRows(join(GAMES, `wbb_schedule_${season}.csv`))) have.add(r.id);
	let calls = 0;
	const before = out.length;
	for (const day of days) {
		const path = join(CACHE, `${day}.json`);
		if (!existsSync(path)) {
			await new Promise((r) => setTimeout(r, 250));
			const res = await fetch(sources.live.url(day));
			if (!res.ok) throw new Error(`${res.status} ${day}`);
			writeFileSync(path, await res.text());
			calls++;
		}
		for (const e of JSON.parse(readFileSync(path, 'utf8')).events ?? []) {
			const comp = e.competitions?.[0];
			// ESPN keeps its cancelled fixtures too, and those are no games.
			if (!comp?.status?.type?.completed || have.has(String(e.id))) continue;
			have.add(String(e.id));
			const side = (w) => comp.competitors.find((c) => c.homeAway === w);
			const { home, away } = { home: side('home'), away: side('away') };
			out.push({
				id: e.id, season: e.season?.year ?? season, season_type: e.season?.type ?? 2,
				game_date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
				status_type_name: comp.status?.type?.name, status_type_completed: comp.status?.type?.completed,
				neutral_site: Boolean(comp.neutralSite), tournament_id: comp.tournamentId ?? '',
				notes_headline: (comp.notes ?? []).map((n) => n.headline).join(' '),
				home_id: home.team.id, home_location: home.team.location, home_score: home.score,
				away_id: away.team.id, away_location: away.team.location, away_score: away.score,
			});
		}
	}
	console.log(`${season}: ${out.length - before} games added in ${calls} calls`);
}
writeFileSync(join(ROOT, 'data', 'reference', 'ncaaw-games-added.csv'), [
	'# Games sportsdataverse\'s schedule files lack, from ESPN\'s scoreboards, in those',
	'# files\' columns (scripts/ncaaw-fill.mjs; do not edit).',
	COLUMNS.join(','),
	...out.sort((a, b) => a.game_date.localeCompare(b.game_date) || String(a.id).localeCompare(String(b.id)))
		.map((r) => COLUMNS.map((c) => csv(r[c])).join(',')),
].join('\n') + '\n');
