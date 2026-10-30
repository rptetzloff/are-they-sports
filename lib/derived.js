/** Memoising what the league pages compute, without letting them go stale.
 *
 *  Measured before writing this: `/records` under `SCOPE=all` is 62 clubs and
 *  471,453 rows. The rows themselves are already cached per franchise and cost
 *  0ms warm; `computeLeague` over them costs **232ms on every request**, every
 *  time, for a page whose inputs change a few times a day. That was the whole
 *  warm cost of the route.
 *
 *  The hard part is not the memo, it is the invalidation. `server.js` already
 *  explains why an unbounded cache is the wrong answer: caching for the life of
 *  the process hid a playoff-flag correction once and a franchise remapping
 *  once, and both times the site looked right and was quietly wrong. A derived
 *  cache repeats that failure one layer up, and worse, because it survives the
 *  fix to the layer below.
 *
 *  So the key carries the inputs' own version. The per-franchise game cache
 *  already tracks `max(observed_at)` per club and re-reads when it moves; this
 *  reads those same stamps and joins them. No extra queries, and the memo is
 *  invalid the instant any club's rows are re-read — including by the server's
 *  own live refresh, which is the case that matters during a game.
 *
 *  It is bounded, because the key includes the season and there are a hundred
 *  and some of those per sport, times three views. An unbounded map here would
 *  be a slow leak that only shows up on a long-lived deployment — which is the
 *  only kind this has.
 */

/** Least-recently-used, oldest evicted first.
 *
 *  A Map iterates in insertion order, so re-inserting on read is the whole
 *  implementation. Small enough to read, which is why it is here rather than a
 *  dependency.
 */
export class Lru {
	constructor(max = 64) {
		if (!(max > 0)) throw new Error('an Lru with no room is not a cache');
		this.max = max;
		this.map = new Map();
	}

	get(key) {
		if (!this.map.has(key)) return undefined;
		// Re-insert to mark it fresh. Without this the eviction order is
		// insertion order, which evicts the entry being hit every request and
		// keeps the ones nobody asks for.
		const value = this.map.get(key);
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	set(key, value) {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
		return value;
	}

	get size() { return this.map.size; }
}

/** `fn` over every item, `limit` at a time, in the items' order.
 *
 *  For reading every club at once. A Promise.all over 1,036 clubs puts 1,036
 *  queries in front of a pool of five, and a query queued longer than the pool's
 *  connection timeout (5s) fails: the whole-league pages did, at 1,036 clubs and
 *  not at 672, and dev's cold /records was already 6.3s. Limited, the same reads
 *  take the same time and nothing is queued at the pool. */
export async function mapLimited(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** A version string for a set of clubs, from the stamps their rows were read at.
 *
 *  `stampOf` is given a club entry and returns whatever the game cache recorded
 *  for it — an ISO date, or null for a club not yet read. A club that has never
 *  been read must not collide with one read at an unknown time, so null gets its
 *  own marker rather than an empty string.
 *
 *  Sport-qualified, because a bare franchise code is a bug waiting for a second
 *  sport: BAL is the Orioles and the Ravens, MIN the Twins and the Vikings.
 */
export function versionOf(clubs, stampOf) {
	const parts = [];
	for (const c of clubs) {
		const stamp = stampOf(c);
		parts.push(`${c.sport}/${c.franchise}@${stamp ?? '-'}`);
	}
	// Sorted, so the same set of clubs in a different order is the same version.
	// The scope resolves in a stable order today and relying on that would be an
	// invariant nothing asserts.
	return parts.sort().join(',');
}

/** Return the memoised value for `key`, computing it if the inputs have moved. */
export function memo(cache, key, version, compute) {
	const hit = cache.get(key);
	if (hit && hit.version === version) return hit.value;
	const value = compute();
	cache.set(key, { version, value });
	return value;
}

/** Fold changed rows into rows already held, in the order the query returns.
 *
 *  Keyed on `gid`, which is the game's own id: a row that already exists is
 *  REPLACED rather than appended, or a live score update would show the game
 *  twice — once at 0-0 and once final.
 *
 *  Sorted by (date, gid) to match the ORDER BY the full query uses, so an
 *  incrementally-updated list and a freshly-read one are the same list. A game
 *  whose date was corrected moves to its new place rather than staying where it
 *  was read.
 *
 *  This CANNOT see a deletion — a row removed from the database is still in the
 *  array. That is why the caller only takes this path when the stamp moved
 *  forward, and reloads outright when it did not: a stamp going backwards means
 *  rows left, and nothing about them can be inferred from what remains.
 */
export function mergeGames(held, changed) {
	if (!changed.length) return held;
	const byId = new Map(held.map((r) => [r.gid, r]));
	for (const row of changed) byId.set(row.gid, row);
	return [...byId.values()].sort((a, b) => (a.date < b.date ? -1
		: a.date > b.date ? 1
		: a.gid < b.gid ? -1 : a.gid > b.gid ? 1 : 0));
}

