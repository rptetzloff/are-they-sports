// Turn fetched sources into the committed artifacts a site serves.
//
//   node scripts/build.mjs packers
//
// Reads data/sources/ (gitignored), writes data/indices/<team>/ (committed).
// The whole point of the split: sources are enormous and reproducible,
// artifacts are tiny and are what actually ships. 95MB of league play-by-play
// becomes 4.7KB of one team's scoring plays.
//
// Streamed line by line throughout. Not an optimisation — reading a 95MB CSV
// into a string is 190MB of UTF-16 before parsing starts, and doing that for a
// range of seasons is how a build runs a machine out of memory.

import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'data', 'sources');
const INDEX_DIR = join(ROOT, 'data', 'indices');

/** The artifact format version. The server refuses a version it does not know
 *  and says so, rather than serving an index whose shape has moved. */
export const FORMAT = 1;

/** Split a CSV line, honouring quotes and doubled quotes inside them.
 *
 *  nflverse play descriptions contain commas in nearly every row, so a naive
 *  split on ',' silently misaligns every column after `desc` — and the result
 *  parses fine and is wrong, which is the worst kind of wrong.
 */
export function splitCsvLine(line) {
	const out = [];
	let cur = '', quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
			else quoted = !quoted;
		} else if (c === ',' && !quoted) { out.push(cur); cur = ''; }
		else cur += c;
	}
	out.push(cur);
	return out;
}

/** Stream a CSV as objects, one at a time. Never holds more than a row. */
export async function* csvRows(path) {
	const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
	let header = null;
	for await (const line of rl) {
		if (!line.trim()) continue;
		const v = splitCsvLine(line);
		if (!header) { header = v; continue; }
		const o = {};
		for (let i = 0; i < header.length; i++) o[header[i]] = v[i] ?? '';
		yield o;
	}
}

/** One JSON value per line: a header, then one entry per line.
 *
 *  Newline-delimited rather than one document, because reading an index back
 *  needs the whole thing as a string otherwise. The baseball site learned this
 *  by running out of heap on a 512MB box; a line at a time costs one entry. */
export function renderNdjson(entries, meta = {}) {
	const rows = [JSON.stringify({ kind: 'map', size: entries.length, ...meta })];
	for (const e of entries) rows.push(JSON.stringify(e));
	return Buffer.from(`${rows.join('\n')}\n`);
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every game the team played, from the fetched sources.
 *
 *  Two sources, split by season rather than merged row by row. nflverse covers
 *  1999 onward and is refreshed weekly; FiveThirtyEight covers 1920 to 1998 and
 *  will never be refreshed again, because the organisation that published it no
 *  longer exists. The cutoff is declared by the adapter, not guessed here.
 *
 *  Split rather than upsert on purpose. Both sources describe 1999-2020, so a
 *  merge would need a rule for disagreements; taking whole eras from one source
 *  each means there is nothing to reconcile, and the overlap is available as a
 *  correctness check instead.
 */
export async function buildGames(sport, team, { schedulesPath, seedPath }) {
	const rows = [];
	const cutoff = sport.sources.seedResults?.useBefore ?? -Infinity;

	if (seedPath && existsSync(seedPath)) {
		for await (const r of csvRows(seedPath)) {
			if (!(parseInt(r.season, 10) < cutoff)) continue;
			for (const id of team.sourceIds) {
				const row = sport.seedGameRow(r, id);
				if (row) { rows.push(row); break; }
			}
		}
	}

	for await (const r of csvRows(schedulesPath)) {
		if (parseInt(r.season, 10) < cutoff) continue;
		for (const id of team.sourceIds) {
			const row = sport.gameRow(r, id);
			if (row) { rows.push(row); break; }
		}
	}

	rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return rows;
}

/** Scoring plays for the team's games, keyed by game id.
 *
 *  `gameIds` is the set built above, so a league-wide play-by-play file is
 *  filtered to one club without the adapter knowing how games were selected.
 */
export async function buildScoring(sport, gameIds, pbpPaths) {
	// The adapter answers one question about one row.
	//
	// This used to ask the adapter for a *predicate factory*, on the reasoning
	// that "Retrosheet has no scoring flag: a play scored if the running total
	// went up, which needs the previous row." That was wrong. Retrosheet has a
	// `runs` column and the test is `runs > 0`, as pure as football's — the
	// column names had been guessed rather than read, and the seam was reshaped
	// around a difference that does not exist. The factory is gone with it,
	// because an abstraction kept for a withdrawn premise is just a place for
	// the next reader to look for meaning that is not there.
	//
	// If a sport ever does need previous-row state, this is one line to change
	// and there will be a real case to shape it around.
	const isScoring = (r) => sport.isScoringPlay(r);

	const byGame = new Map();
	let scanned = 0, kept = 0;
	for (const p of pbpPaths) {
		for await (const r of csvRows(p)) {
			scanned++;
			const gid = r[sport.gameKey];
			if (!gameIds.has(gid)) continue;
			if (!isScoring(r)) continue;
			kept++;
			if (!byGame.has(gid)) byGame.set(gid, []);
			byGame.get(gid).push(sport.scoringRow(r));
		}
	}
	return { byGame, scanned, kept };
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
	const teamId = process.argv[2];
	if (!teamId) {
		console.error('usage: build.mjs <team>');
		return 2;
	}
	const team = (await import(`../teams/${teamId}.js`)).default;
	const sport = (await import(`../sports/${team.sport}.js`)).default;

	const schedules = join(SOURCE_DIR, sport.id, 'schedules.csv');
	if (!existsSync(schedules)) {
		console.error(`missing ${schedules} — run: npm run fetch ${teamId}`);
		return 1;
	}

	const seed = join(SOURCE_DIR, sport.id, 'seed-results.csv');
	const games = await buildGames(sport, team, { schedulesPath: schedules, seedPath: seed });
	const played = games.filter((g) => g.result).length;
	const seasons = games.map((g) => parseInt(g.season, 10)).filter(Number.isFinite);
	console.log(`  games        ${games.length} (${played} played, ${games.length - played} scheduled), seasons ${Math.min(...seasons)}-${Math.max(...seasons)}`);

	const pbpDir = join(SOURCE_DIR, sport.id, 'pbp');
	const pbpPaths = existsSync(pbpDir)
		? readdirSync(pbpDir).filter((f) => f.endsWith('.csv')).sort().map((f) => join(pbpDir, f))
		: [];
	const gameIds = new Set(games.map((g) => g.gid));
	const { byGame, scanned, kept } = await buildScoring(sport, gameIds, pbpPaths);
	if (pbpPaths.length) {
		console.log(`  play-by-play ${pbpPaths.length} season(s), ${scanned.toLocaleString()} league plays scanned`);
		console.log(`  scoring      ${kept.toLocaleString()} plays across ${byGame.size} games`);
	} else {
		console.log('  play-by-play none fetched — scoring index will be empty');
	}

	const dir = join(INDEX_DIR, teamId);
	mkdirSync(dir, { recursive: true });
	const digests = {};
	let raw = 0, packed = 0;
	const write = (name, buf) => {
		const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
		writeFileSync(join(dir, `${name}.ndjson.br`), br);
		digests[name] = sha256(buf);
		raw += buf.length; packed += br.length;
		console.log(`  ${name.padEnd(12)} ${kb(buf.length).padStart(9)} -> ${kb(br.length).padStart(8)}`);
	};

	write('games', renderNdjson(games));
	write('scoring', renderNdjson([...byGame].map(([gid, plays]) => [gid, plays])));

	writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({
		format: FORMAT,
		team: teamId,
		sport: sport.id,
		indices: ['games', 'scoring'],
		digests,
		// What produced this. Recorded so a staleness check can compare a
		// version rather than rebuilding gigabytes to compare digests.
		sources: {
			schedules: sport.sources.schedules.url,
			playByPlaySeasons: pbpPaths.map((p) => p.match(/(\d{4})\.csv$/)?.[1]).filter(Boolean),
		},
	}, null, '\t')}\n`);

	console.log(`  ---`);
	console.log(`  artifacts    ${kb(raw)} -> ${kb(packed)}  in data/indices/${teamId}/`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
