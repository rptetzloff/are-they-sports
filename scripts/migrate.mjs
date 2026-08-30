// Apply pending database migrations.
//
//   DATABASE_URL=postgres://... node scripts/migrate.mjs
//   DATABASE_URL=postgres://... node scripts/migrate.mjs --dry-run
//
// Migrations are numbered .sql files in db/migrations, applied in filename
// order, each in its own transaction. What has been applied is recorded in the
// database, so running this twice does nothing the second time — which is the
// only property that makes it safe to point at a server.
//
// It also stores a checksum of every applied file and refuses to run if one has
// changed since. That is the failure this exists to prevent: editing an applied
// migration means the file and the database disagree, every fresh environment
// gets the edited version, every existing one keeps the old, and nothing
// anywhere reports a problem. An applied migration is history; change it with a
// new file.
//
// Connection strings support sslmode, which a managed or remote Postgres will
// need — `?sslmode=require`, or `?sslmode=no-verify` for a self-signed
// certificate. A database on the same internal network needs neither.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATION_DIR = join(ROOT, 'db', 'migrations');

const LEDGER = `
CREATE TABLE IF NOT EXISTS schema_migration (
	id         TEXT PRIMARY KEY,
	checksum   TEXT NOT NULL,
	applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export const checksum = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Migration files, in the order they must be applied.
 *
 *  Sorted by filename, which is why they are numbered rather than named after
 *  the day they were written. Ten migrations in and lexical order stops
 *  matching chronological order unless the numbers are padded.
 */
export function migrationFiles(dir = MIGRATION_DIR) {
	return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

/** Which migrations still need applying, and which have changed since they were.
 *
 *  Pure, so the interesting decision is testable without a database.
 */
export function plan(files, applied) {
	const byId = new Map(applied.map((a) => [a.id, a.checksum]));
	const pending = [];
	const changed = [];
	for (const { id, sum } of files) {
		if (!byId.has(id)) pending.push(id);
		else if (byId.get(id) !== sum) changed.push(id);
	}
	// An applied migration missing from disk is not an error — a checkout can
	// legitimately be older than the database — but it is worth reporting,
	// because the usual cause is a file deleted rather than superseded.
	const missing = applied.map((a) => a.id).filter((id) => !files.some((f) => f.id === id));
	return { pending, changed, missing };
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('DATABASE_URL is required');
		return 2;
	}
	const dryRun = process.argv.includes('--dry-run');

	const files = migrationFiles().map((f) => {
		const sql = readFileSync(join(MIGRATION_DIR, f), 'utf8');
		return { id: f, sql, sum: checksum(sql) };
	});
	if (!files.length) {
		console.error(`no migrations in ${MIGRATION_DIR}`);
		return 1;
	}

	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query(LEDGER);
		const { rows: applied } = await client.query('SELECT id, checksum FROM schema_migration ORDER BY id');
		const { pending, changed, missing } = plan(files, applied);

		for (const id of missing) console.warn(`  warning      ${id} is applied but not in this checkout`);

		if (changed.length) {
			// Refuse rather than reapply. Reapplying would either fail on
			// existing objects or silently diverge from every other environment.
			console.error(`FATAL: these migrations changed after being applied: ${changed.join(', ')}`);
			console.error('       An applied migration is history. Add a new one instead.');
			return 1;
		}

		if (!pending.length) {
			console.log(`  up to date   ${applied.length} migration(s) applied`);
			return 0;
		}
		if (dryRun) {
			for (const id of pending) console.log(`  would apply  ${id}`);
			return 0;
		}

		for (const id of pending) {
			const file = files.find((f) => f.id === id);
			// Each migration in its own transaction, so a failure halfway
			// through a run leaves the earlier ones applied and recorded rather
			// than rolling back work that succeeded.
			await client.query('BEGIN');
			try {
				await client.query(file.sql);
				await client.query('INSERT INTO schema_migration (id, checksum) VALUES ($1,$2)', [id, file.sum]);
				await client.query('COMMIT');
				console.log(`  applied      ${id}`);
			} catch (e) {
				await client.query('ROLLBACK');
				console.error(`FATAL: ${id} failed and was rolled back: ${e.message}`);
				return 1;
			}
		}
		return 0;
	} finally {
		await client.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
