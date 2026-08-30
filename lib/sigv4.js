/** Signing a GET for S3-compatible storage, by hand.
 *
 *  The alternative is `@aws-sdk/client-s3`. Measured rather than guessed, since
 *  the first draft of this comment said "about fifty packages" and that was a
 *  number I made up: it is **26 packages and 15MB**, which is real but not the
 *  horror I asserted.
 *
 *  It is still not taken, for a reason that is not size. The SDK returns an
 *  object through its own client, so the URL has to be split into endpoint,
 *  bucket and key, path-style addressing configured for MinIO, and a second
 *  code path maintained beside the plain-URL fetch that football uses. Signing
 *  adds a header to the request already being made — the streaming, the gzip
 *  sniffing and the error handling are all unchanged, and a public URL still
 *  goes out unsigned. Everything here is `node:crypto`.
 *
 *  Only what a GET needs: no payload signing beyond the empty-body hash, no
 *  chunked uploads, no session tokens unless one is supplied. If this ever has
 *  to PUT, that is a different function rather than a flag on this one.
 *
 *  Verified against a real MinIO rather than against remembered constants — a
 *  private bucket refuses the unsigned request with 403 and serves the signed
 *  one. Asserting a signature I had written from memory would have proved only
 *  that two copies of my memory agreed.
 */

import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** The hash of an empty body, which is every request this signs. */
const EMPTY = sha256('');

/** `20260830T204512Z` and `20260830`, which is the only date format involved. */
function stamps(when) {
	const iso = when.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	return { amzDate: iso, date: iso.slice(0, 8) };
}

/** Percent-encode a path segment the way S3 expects.
 *
 *  encodeURIComponent leaves !'()* alone and S3 does not, so those are encoded
 *  by hand. A key containing a bracket signs wrong otherwise, and the failure is
 *  a 403 that says nothing about why.
 */
const encodeSegment = (s) => encodeURIComponent(s)
	.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Headers that authorise a GET of `url`.
 *
 *  @param url          the object's full URL, virtual-hosted or path style.
 *  @param credentials  `{ accessKeyId, secretAccessKey, region, sessionToken }`.
 *  @param when         the request time; injected so a test is not a clock.
 */
export function signGet(url, { accessKeyId, secretAccessKey, region = 'us-east-1', sessionToken = null }, when = new Date()) {
	if (!accessKeyId || !secretAccessKey) throw new Error('signGet needs accessKeyId and secretAccessKey');
	const u = new URL(url);
	const { amzDate, date } = stamps(when);
	const service = 's3';

	// The host header carries the port when there is one, because that is what
	// the client sends and the signature covers what is sent. A signature over
	// "minio" for a request to "minio:9000" is rejected, and MinIO on a
	// non-default port is the common case here.
	const host = u.host;

	const headers = {
		host,
		'x-amz-content-sha256': EMPTY,
		'x-amz-date': amzDate,
		...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
	};

	// Sorted by lowercased name, values trimmed, each line terminated — the
	// canonical form is exact and a stray space changes the signature.
	const names = Object.keys(headers).sort();
	const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
	const signedHeaders = names.join(';');

	// Each path segment is encoded, and the slashes are not.
	const canonicalUri = u.pathname.split('/').map(encodeSegment).join('/') || '/';

	// Sorted by name, encoded, and every parameter present even when empty.
	const canonicalQuery = [...u.searchParams.keys()].sort()
		.map((k) => `${encodeSegment(k)}=${encodeSegment(u.searchParams.get(k))}`)
		.join('&');

	const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, EMPTY].join('\n');
	const scope = `${date}/${region}/${service}/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

	const signing = ['aws4_request'].reduce(
		(key, part) => hmac(key, part),
		[region, service].reduce((key, part) => hmac(key, part), hmac(`AWS4${secretAccessKey}`, date)));
	const signature = createHmac('sha256', signing).update(stringToSign).digest('hex');

	return {
		...headers,
		Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, `
			+ `SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
}

/** Credentials from the environment, or null when none are set.
 *
 *  Null rather than throwing, because an unauthenticated fetch is the normal
 *  case: nflverse and FiveThirtyEight are public URLs and must not start
 *  demanding keys because a bucket was configured for baseball.
 */
export function credentialsFromEnv(env = process.env) {
	const accessKeyId = env.S3_ACCESS_KEY_ID;
	const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) return null;
	return {
		accessKeyId,
		secretAccessKey,
		region: env.S3_REGION || 'us-east-1',
		sessionToken: env.S3_SESSION_TOKEN || null,
	};
}
