import test from 'node:test'
import assert from 'node:assert/strict'
import { credentialsFromEnv, signGet } from '../lib/sigv4.js'

// Signing a GET for S3-compatible storage. The real proof is a private MinIO
// bucket refusing the unsigned request and serving the signed one — asserting a
// signature written from memory would only prove that two copies of my memory
// agree. What is asserted here is the shape, the inputs it depends on, and the
// cases where getting it wrong produces a 403 that explains nothing.

const CREDS = { accessKeyId: 'AKID', secretAccessKey: 'SECRET', region: 'us-east-1' }
const AT = new Date('2026-08-30T20:45:12.000Z')
const URL_ = 'http://minio:9000/sports/mlb-games.csv.gz'

test('the authorization header has the shape S3 expects', () => {
	const h = signGet(URL_, CREDS, AT)
	assert.match(h.Authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20260830\/us-east-1\/s3\/aws4_request, /)
	assert.match(h.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date, /)
	assert.match(h.Authorization, /Signature=[0-9a-f]{64}$/)
})

test('the date headers are the compact form, with no punctuation', () => {
	const h = signGet(URL_, CREDS, AT)
	assert.equal(h['x-amz-date'], '20260830T204512Z')
})

test('the empty-body hash is sent, because a GET has no body', () => {
	// e3b0c442... is sha256 of the empty string. MinIO rejects a request whose
	// x-amz-content-sha256 disagrees with what was signed.
	const h = signGet(URL_, CREDS, AT)
	assert.equal(h['x-amz-content-sha256'],
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

test('the host header carries the port', () => {
	// A signature over "minio" for a request to "minio:9000" is refused, and
	// MinIO on a non-default port is the ordinary case here.
	assert.equal(signGet('http://minio:9000/b/k', CREDS, AT).host, 'minio:9000')
	assert.equal(signGet('https://s3.example.com/b/k', CREDS, AT).host, 's3.example.com')
})

test('every input changes the signature', () => {
	// A signer that ignores an input silently authorises the wrong request. Each
	// of these is varied alone.
	const base = signGet(URL_, CREDS, AT).Authorization
	const sig = (s) => s.match(/Signature=([0-9a-f]+)/)[1]
	assert.notEqual(sig(base), sig(signGet(URL_ + 'x', CREDS, AT).Authorization), 'the key is not signed')
	assert.notEqual(sig(base), sig(signGet('http://other:9000/sports/mlb-games.csv.gz', CREDS, AT).Authorization), 'the host is not signed')
	assert.notEqual(sig(base), sig(signGet(URL_, { ...CREDS, secretAccessKey: 'OTHER' }, AT).Authorization), 'the secret is not used')
	assert.notEqual(sig(base), sig(signGet(URL_, { ...CREDS, region: 'eu-west-1' }, AT).Authorization), 'the region is not signed')
	assert.notEqual(sig(base), sig(signGet(URL_, CREDS, new Date('2026-08-31T20:45:12Z')).Authorization), 'the date is not signed')
})

test('the same request at the same moment signs identically', () => {
	assert.equal(signGet(URL_, CREDS, AT).Authorization, signGet(URL_, CREDS, AT).Authorization)
})

test('a query string is signed, sorted and encoded', () => {
	// Sorted by name, so two orderings of the same query sign the same.
	const a = signGet('http://minio:9000/b/k?b=2&a=1', CREDS, AT).Authorization
	const b = signGet('http://minio:9000/b/k?a=1&b=2', CREDS, AT).Authorization
	assert.equal(a, b)
	// And a query genuinely changes it.
	assert.notEqual(a, signGet('http://minio:9000/b/k?a=2&b=2', CREDS, AT).Authorization)
})

test('a key with characters encodeURIComponent leaves alone still signs', () => {
	// !'()* are not escaped by encodeURIComponent and S3 expects them escaped.
	// The failure mode is a 403 that says nothing about why.
	const h = signGet("http://minio:9000/b/it's(a)key!.csv", CREDS, AT)
	assert.match(h.Authorization, /Signature=[0-9a-f]{64}$/)
})

test('a session token is signed when there is one, and absent when not', () => {
	const withToken = signGet(URL_, { ...CREDS, sessionToken: 'TOKEN' }, AT)
	assert.equal(withToken['x-amz-security-token'], 'TOKEN')
	assert.match(withToken.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token,/)
	assert.equal(signGet(URL_, CREDS, AT)['x-amz-security-token'], undefined)
})

test('signing without credentials is an error, not an unsigned request', () => {
	assert.throws(() => signGet(URL_, { accessKeyId: 'AKID' }, AT), /needs accessKeyId and secretAccessKey/)
})

// --- reading them from the environment ---

test('no credentials in the environment means no credentials', () => {
	// Null rather than throwing: an unauthenticated fetch is the normal case, and
	// football's public sources must not start demanding keys because a bucket
	// was configured for baseball.
	assert.equal(credentialsFromEnv({}), null)
	assert.equal(credentialsFromEnv({ S3_ACCESS_KEY_ID: 'only-one' }), null)
})

test('the region defaults, because MinIO does not care and S3 does', () => {
	const c = credentialsFromEnv({ S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' })
	assert.equal(c.region, 'us-east-1')
	assert.equal(credentialsFromEnv({ S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b', S3_REGION: 'eu-west-1' }).region, 'eu-west-1')
})

test('the region appears in the credential scope, not only in the key', () => {
	// A mutant that hardcoded us-east-1 in the scope survived: the signing key
	// also derives from the region, so the signature still CHANGED and a test
	// asserting only "it differs" was satisfied. Real S3 rejects a scope naming
	// the wrong region.
	assert.match(signGet(URL_, { ...CREDS, region: 'eu-west-1' }, AT).Authorization,
		/Credential=AKID\/20260830\/eu-west-1\/s3\/aws4_request/)
})

test('the timestamp is signed, not just the day', () => {
	// The signing key is derived per DAY, so two different days differ even if
	// the string-to-sign ignores the time entirely — which is how a mutant
	// replacing the timestamp with a constant survived. Two moments on the SAME
	// day isolate it.
	const morning = signGet(URL_, CREDS, new Date('2026-08-30T01:00:00Z')).Authorization
	const evening = signGet(URL_, CREDS, new Date('2026-08-30T23:00:00Z')).Authorization
	assert.notEqual(morning, evening, 'the time of day is not signed')
})

// --- against a real S3, when there is one ---
//
// Same three-layer shape as db.test.js. Everything above is arithmetic over
// known inputs; only a server that validates signatures can catch a signature
// that is internally consistent and wrong.
//
// A mutation run proved the need: desynchronising the timestamp inside the
// string-to-sign from the x-amz-date header survives every test above, because
// the header is also inside the canonical request, so the signature still
// changes. AWS and MinIO both reject it. Nothing local can tell.
//
//   docker run -d -p 9100:9000 -e MINIO_ROOT_USER=k -e MINIO_ROOT_PASSWORD=s… minio/minio server /data
//   S3_TEST_URL=http://127.0.0.1:9100/bucket/object S3_ACCESS_KEY_ID=k S3_SECRET_ACCESS_KEY=s… npm test

const S3_TEST_URL = process.env.S3_TEST_URL

test('a real bucket accepts the signature', {
	skip: !S3_TEST_URL && 'no S3_TEST_URL — signatures are NOT validated by this run',
}, async () => {
	const creds = credentialsFromEnv()
	assert.ok(creds, 'S3_TEST_URL is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not')

	// Unsigned first, so the object is proved private. Against a public object
	// the signed request below would pass for the wrong reason.
	const open = await fetch(S3_TEST_URL)
	await open.body?.cancel().catch(() => {})
	assert.equal(open.status, 403, 'the test object is public, so this proves nothing')

	const signed = await fetch(S3_TEST_URL, { headers: signGet(S3_TEST_URL, creds) })
	await signed.body?.cancel().catch(() => {})
	assert.equal(signed.status, 200, 'the bucket refused a signature this thinks is valid')
})
