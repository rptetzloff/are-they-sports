// Download raw sources into data/sources/, which is gitignored.
//
// Nothing here is ever committed. One nflverse play-by-play season is 95MB
// uncompressed and a Retrosheet slice is 388MB; both reduce to kilobytes once
// the parts a page displays are extracted, so keeping them would be storing an
// intermediate. The reduction is measured, not assumed: 95MB of 2024 league
// play-by-play becomes 4.7KB of Packers scoring plays, about 20,000 to 1.
//
//   node scripts/fetch.mjs packers                 schedules only
//   node scripts/fetch.mjs packers --pbp 2024      one play-by-play season
//   node scripts/fetch.mjs packers --pbp 1999-2025 a range
//
// Files already present are left alone. Deleting data/sources/ costs a
// download, never correctness — the committed artifacts are what the site
// serves.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = join(ROOT, 'data', 'sources');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Fetch one URL to a path, decompressing on the way if it is gzipped.
 *
 *  Streamed rather than buffered: a 95MB CSV read into a string before writing
 *  is 190MB of UTF-16 for no reason, and the same mistake once cost the
 *  baseball site a 600MB heap against a 512MB box.
 */
export async function download(url, dest, { gunzip = false } = {}) {
	mkdirSync(dirname(dest), { recursive: true });
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
	const out = createWriteStream(dest);
	const body = Readable.fromWeb(res.body);
	await (gunzip ? pipeline(body, createGunzip(), out) : pipeline(body, out));
	return statSync(dest).size;
}

/** Parse "2024" or "1999-2025" into a list of seasons. */
export function seasonRange(spec) {
	const m = String(spec).match(/^(\d{4})(?:-(\d{4}))?$/);
	if (!m) throw new Error(`not a season or range: ${spec}`);
	const from = parseInt(m[1], 10);
	const to = m[2] ? parseInt(m[2], 10) : from;
	if (to < from) throw new Error(`range runs backwards: ${spec}`);
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Which seasons a team can actually have play-by-play for: the overlap of the
 *  club's existence and the source's coverage. Asking for 1921 play-by-play is
 *  not an error, there simply is none. */
export function coveredSeasons(team, sport, requested) {
	const first = Math.max(team.firstSeason, sport.sources.playByPlay.firstSeason);
	return requested.filter((s) => s >= first);
}

async function main() {
	const [teamId, ...rest] = process.argv.slice(2);
	if (!teamId) {
		console.error('usage: fetch.mjs <team> [--pbp <season|range>]');
		process.exit(2);
	}
	const team = (await import(`../teams/${teamId}.js`)).default;
	const sport = (await import(`../sports/${team.sport}.js`)).default;

	const sched = join(SOURCE_DIR, sport.id, 'schedules.csv');
	if (existsSync(sched)) {
		console.log(`  have    schedules.csv  ${mb(statSync(sched).size)}`);
	} else {
		console.log('  fetch   schedules.csv ...');
		console.log(`  done    schedules.csv  ${mb(await download(sport.sources.schedules.url, sched))}`);
	}

	const seedCfg = sport.sources.seedResults;
	if (seedCfg) {
		const seed = join(SOURCE_DIR, sport.id, 'seed-results.csv');
		if (existsSync(seed)) {
			console.log(`  have    seed-results.csv  ${mb(statSync(seed).size)}`);
		} else {
			console.log('  fetch   seed-results.csv ...');
			console.log(`  done    seed-results.csv  ${mb(await download(seedCfg.url, seed))}`);
		}
	}

	const i = rest.indexOf('--pbp');
	if (i === -1) return 0;

	const asked = seasonRange(rest[i + 1]);
	const seasons = coveredSeasons(team, sport, asked);
	const skipped = asked.length - seasons.length;
	if (skipped) {
		console.log(`  note    ${skipped} season(s) before ${sport.sources.playByPlay.firstSeason} have no play-by-play upstream`);
	}
	for (const season of seasons) {
		const dest = join(SOURCE_DIR, sport.id, 'pbp', `${season}.csv`);
		if (existsSync(dest)) {
			console.log(`  have    pbp ${season}  ${mb(statSync(dest).size)}`);
			continue;
		}
		process.stdout.write(`  fetch   pbp ${season} ...`);
		const size = await download(sport.sources.playByPlay.url(season), dest, {
			gunzip: sport.sources.playByPlay.gzipped,
		});
		console.log(`\r  done    pbp ${season}  ${mb(size)}          `);
	}
	return 0;
}

// Only when run directly, so the exports stay importable by tests without
// fetching anything.
//
// pathToFileURL rather than string surgery: on Windows argv[1] is a drive path
// and import.meta.url is file:///C:/... with three slashes, so the obvious
// comparison never matches and the script silently does nothing at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
