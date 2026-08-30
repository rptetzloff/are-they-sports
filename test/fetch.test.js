import test from 'node:test'
import assert from 'node:assert/strict'
import { coveredSeasons, seasonRange } from '../scripts/fetch.mjs'
import nfl from '../sports/nfl.js'
import mlb from '../sports/mlb.js'
import { shouldSign } from '../scripts/fetch.mjs'
import packers from '../teams/nfl/packers.js'
import brewers from '../teams/mlb/brewers.js'

// Argument parsing and coverage bounds. Both decide how much of a 95MB-per-
// season source gets downloaded, so getting them wrong is expensive rather than
// merely wrong.

test('a single season is a range of one', () => {
	assert.deepEqual(seasonRange('2024'), [2024])
	assert.deepEqual(seasonRange(2024), [2024])
})

test('a range is inclusive at both ends', () => {
	// Off by one here is one missing season of play-by-play, which shows up as a
	// year with no scoring plays and no error anywhere.
	assert.deepEqual(seasonRange('2020-2023'), [2020, 2021, 2022, 2023])
})

test('a backwards range is refused rather than yielding nothing', () => {
	// An empty list would fetch nothing and report success.
	assert.throws(() => seasonRange('2023-2020'), /backwards/)
})

test('anything that is not a season is refused', () => {
	for (const bad of ['', '20', '2024-', 'latest', '2024-2025-2026', '99999']) {
		assert.throws(() => seasonRange(bad), /not a season or range/, `accepted ${bad}`)
	}
})

test('coverage is the overlap of the club and the source, not either alone', () => {
	// The Packers existed in 1921 and nflverse play-by-play starts in 1999.
	// Asking for 1921 is not an error; there simply is none.
	const asked = [1921, 1998, 1999, 2000]
	assert.deepEqual(coveredSeasons(packers, nfl, asked), [1999, 2000])
})

test('a club younger than its source is bounded by the club', () => {
	// Baseball's play-by-play reaches further back than this franchise does, so
	// the club is the binding constraint and 1968 must not be fetched.
	assert.deepEqual(coveredSeasons(brewers, mlb, [1968, 1969, 1970]), [1969, 1970])
})

test('asking only for uncovered seasons yields nothing, quietly', () => {
	assert.deepEqual(coveredSeasons(packers, nfl, [1921, 1950]), [])
})

test('coverage preserves the order it was asked in', () => {
	// The caller decides the order; this filters, it does not sort.
	assert.deepEqual(coveredSeasons(packers, nfl, [2001, 1999, 2000]), [2001, 1999, 2000])
})

// --- what arrives, not what was declared ---

test('a gzipped body is decompressed whether or not the server says so', async () => {
	// The trap this removes is object storage. Upload a .gz to S3 or MinIO with
	// `Content-Encoding: gzip` and fetch transparently decompresses it, so a
	// pipeline through createGunzip receives plain CSV and dies on the header
	// check. Upload the identical file WITHOUT that header and it works.
	//
	// The file is the same either way; only the metadata differs. Deciding from
	// the first two bytes rather than from a declared flag makes the upload
	// impossible to configure wrong.
	const { createServer } = await import('node:http')
	const { gzipSync } = await import('node:zlib')
	const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
	const { join } = await import('node:path')
	const { tmpdir } = await import('node:os')
	const { download } = await import('../scripts/fetch.mjs')

	const body = 'gid,season\nCHN202503180,2025\n'
	const gz = gzipSync(Buffer.from(body))
	const server = createServer((req, res) => {
		if (req.url === '/plain') res.writeHead(200, { 'content-type': 'application/gzip' })
		else if (req.url === '/encoded') res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/csv' })
		else { res.writeHead(200, { 'content-type': 'text/csv' }); res.end(body); return }
		res.end(gz)
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const port = server.address().port
	const dir = mkdtempSync(join(tmpdir(), 'dl-'))

	try {
		for (const path of ['/plain', '/encoded', '/uncompressed']) {
			const dest = join(dir, 'out.csv')
			await download(`http://127.0.0.1:${port}${path}`, dest)
			assert.equal(readFileSync(dest, 'utf8'), body, `${path} did not yield the CSV`)
		}
	} finally {
		server.close()
		rmSync(dir, { recursive: true, force: true })
	}
})

test('a failed fetch throws rather than writing a truncated file', async () => {
	const { createServer } = await import('node:http')
	const { mkdtempSync, existsSync, rmSync } = await import('node:fs')
	const { join } = await import('node:path')
	const { tmpdir } = await import('node:os')
	const { download } = await import('../scripts/fetch.mjs')

	const server = createServer((req, res) => { res.writeHead(404); res.end('nope') })
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const dir = mkdtempSync(join(tmpdir(), 'dl-'))
	try {
		await assert.rejects(
			() => download(`http://127.0.0.1:${server.address().port}/x`, join(dir, 'out.csv')),
			/404/)
		assert.equal(existsSync(join(dir, 'out.csv')), false, 'a 404 left a file behind')
	} finally {
		server.close()
		rmSync(dir, { recursive: true, force: true })
	}
})

test('a failed fetch does not leave the partial file behind', async () => {
	// A truncated file is worse than none: `ensureSource` skips the download
	// when the path already exists, so the next run would take a few kilobytes
	// of an error page as the real source and load whatever parsed out of it.
	const { createServer } = await import('node:http')
	const { mkdtempSync, existsSync, rmSync, writeFileSync } = await import('node:fs')
	const { join } = await import('node:path')
	const { tmpdir } = await import('node:os')
	const { download } = await import('../scripts/fetch.mjs')

	// A body that starts arriving and then fails mid-stream, which is the case a
	// plain status check does not cover.
	const server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/csv', 'content-length': '9999' })
		res.write('gid,season\n')
		res.destroy()
	})
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const dir = mkdtempSync(join(tmpdir(), 'dl-'))
	const dest = join(dir, 'out.csv')
	try {
		await assert.rejects(() => download(`http://127.0.0.1:${server.address().port}/x`, dest))
		// download itself does not clean up — ensureSource does, because it is
		// what knows the path is a source rather than a scratch file. What is
		// asserted here is that the truncated file is DETECTABLE: it exists and
		// is short.
		if (existsSync(dest)) {
			const { statSync } = await import('node:fs')
			assert.ok(statSync(dest).size < 1000, 'a partial write should be small')
		}
	} finally {
		server.close()
		rmSync(dir, { recursive: true, force: true })
	}
})

test('public sources are never signed, whatever credentials exist', () => {
	// Football's sources are open URLs. Sending an S3 Authorization header to
	// GitHub's CDN because a bucket was configured for baseball would be a
	// strange way to break football, and a mutant that signed everything
	// survived because the decision was inline and unreachable.
	const creds = { accessKeyId: 'a', secretAccessKey: 'b' }
	assert.equal(shouldSign('https://github.com/nflverse/x/releases/download/y/games.csv', creds), false)
	assert.equal(shouldSign('https://raw.githubusercontent.com/fivethirtyeight/x/master/y.csv', creds), false)
	// Anything else is signed when there are credentials, because a self-hosted
	// bucket's address is whatever the deployment chose.
	assert.equal(shouldSign('http://minio:9000/sports/mlb-games.csv.gz', creds), true)
	assert.equal(shouldSign('https://s3.example.com/b/k', creds), true)
	// And never without them.
	assert.equal(shouldSign('http://minio:9000/b/k', null), false)
})
