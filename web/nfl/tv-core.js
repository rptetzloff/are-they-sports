// Is it on TV, on which channel, and what number is that on your provider:
// pure functions over the channel and provider tables, shared by the browser
// page (main.js), the server's link-preview state (lib/seasons.js) and the
// calendar feed (lib/calendar.js).
//
// This logic lived in main.js, with a second, slightly different copy in
// lib/seasons.js for the share cards. The calendar would have been a third.
// The two copies already disagreed on which names they matched: main.js
// knew a channel's key and alias, the server also its display name and every
// comma-separated alias. This takes the broader matching for both.

import { parseGamesCsv } from './records-core.js';
import { SITE } from './site.js';

const TV_TYPES = new Set(['broadcast', 'cable', 'regional']);

/** A lookup with nothing in it, for before the tables have loaded: every
 *  channel is unknown, so ESPN's own labels decide. */
export const EMPTY_LOOKUP = { channels: {}, byName: new Map(), providers: {}, providerAliasIndex: new Map() };

/** Channel and provider tables, from channel_lookup.csv and
 *  provider_lookup.csv. `channels` is keyed by channel key (and alias, both
 *  pointing at one entry); `byName` finds a channel by any of its names,
 *  case-insensitively; each provider carries its lineup as channel key ->
 *  the raw cell ("11 (WZAW) | 1 (WLUK)" for providers with service areas). */
export function parseTvLookup(channelLookupCsv, providerLookupCsv) {
	const channelRows = parseGamesCsv(channelLookupCsv);
	const providerRows = providerLookupCsv ? parseGamesCsv(providerLookupCsv) : [];

	const channels = {};
	const byName = new Map();
	for (const ch of channelRows) {
		const key = (ch.key || '').trim();
		if (!key) continue;
		const meta = {
			key,
			display_name: ch.display_name || key,
			type: (ch.type || '').trim() || 'cable',
			description: (ch.description || '').trim() || null,
			website_url: (ch.website_url || '').trim() || null,
			providers: [],
			sort_order: 99,
		};
		const aliases = (ch.alias || '').split(',').map((s) => s.trim()).filter(Boolean);
		if (!channels[key]) channels[key] = meta;
		for (const a of aliases) if (!channels[a]) channels[a] = meta;
		for (const n of [key, meta.display_name, ...aliases]) {
			const lower = n.toLowerCase();
			if (!byName.has(lower)) byName.set(lower, meta);
		}
	}

	const providers = {};
	const providerAliasIndex = new Map();
	for (const p of providerRows) {
		const key = p.provider;
		if (!key) continue;
		providers[key] = {
			key,
			display_name: p.display_name,
			alternate_name: p.alternate_name || '',
			website_url: p.website_url || '',
			channel_lineup: p.channel_lineup || '',
			service_areas: (p.service_areas || '').split('|').map((s) => s.trim()).filter(Boolean),
			logo_url: (p.logo_url || '').trim(),
			logo_bg: (p.logo_bg || '').trim(),
			// ?? p.sponsor: the column's old name — browser-cached CSVs can serve
			// it for up to an hour after deploy.
			displayLogo: /^(yes|true|1)$/i.test(((p.display_logo ?? p.sponsor) || '').trim()),
			channels: {},
		};
		for (const n of [p.display_name, ...(p.alternate_name || '').split(',').map((s) => s.trim()).filter(Boolean)]) {
			if (n) providerAliasIndex.set(n.toLowerCase(), key);
		}
	}
	// channel_lookup's columns after the fixed ones are provider keys.
	for (const ch of channelRows) {
		const aliases = (ch.alias || '').split(',').map((s) => s.trim()).filter(Boolean);
		for (const pk of Object.keys(providers)) {
			const v = (ch[pk] || '').trim();
			if (!v || v.toLowerCase() === 'varies by market') continue;
			providers[pk].channels[ch.key] = v;
			for (const a of aliases) providers[pk].channels[a] = v;
		}
	}
	return { channels, byName, providers, providerAliasIndex };
}

/** The channel a network name refers to, or null when it is not in the table. */
export function resolveChannel(lookup, name) {
	if (!name) return null;
	return lookup.byName.get(name.trim().toLowerCase()) || null;
}

/** 'yes', 'streaming' or 'no' for a game's broadcasts. A channel the table
 *  types broadcast/cable/regional counts as on TV even when ESPN labels it
 *  Streaming (Brewers.TV is carried by cable and satellite providers); a
 *  channel the table does not know falls back to ESPN's own label. */
export function tvStatus(lookup, broadcasts) {
	if (!broadcasts?.length) return 'no';
	let hasTV = false, hasStreaming = false;
	for (const b of broadcasts) {
		const name = b.media?.shortName;
		if (!name) continue;
		const ch = resolveChannel(lookup, name);
		if (ch) {
			if (TV_TYPES.has(ch.type)) { hasTV = true; continue; }
			if (ch.type === 'streaming') { hasStreaming = true; continue; }
		}
		const t = b.type?.shortName || '';
		if (t === 'TV') hasTV = true;
		else if (t === 'Streaming') hasStreaming = true;
	}
	return hasTV ? 'yes' : hasStreaming ? 'streaming' : 'no';
}

/** A broadcast's kind: the table's type, else ESPN's label. */
export function broadcastType(lookup, b) {
	const ch = resolveChannel(lookup, b.media?.shortName);
	if (ch) return ch.type;
	const t = b.type?.shortName;
	return t === 'Streaming' ? 'streaming' : t === 'Radio' ? 'radio' : 'cable';
}

const TYPE_RANK = { broadcast: 0, regional: 1, cable: 2, streaming: 3, radio: 4 };

/** The broadcast worth naming first: linear TV over streaming over radio,
 *  since ESPN often lists MLB.TV first when a TV channel is available. */
export function primaryBroadcast(lookup, broadcasts) {
	if (!broadcasts?.length) return null;
	const rank = (b) => (b.media?.shortName ? TYPE_RANK[broadcastType(lookup, b)] ?? 5 : 99);
	return broadcasts.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
}

/** A network's channel on one provider, as the table cell has it, with the
 *  service-area variant picked when the provider has areas and the cell
 *  lists one per area ("11 (WZAW) | 1 (WLUK)"). Null when not carried. */
export function providerChannel(lookup, providerKey, networkName, areaIndex = 0) {
	const p = lookup.providers[providerKey];
	if (!p || !networkName) return null;
	const key = networkName.trim();
	let raw = p.channels[key];
	if (!raw) {
		const lower = key.toLowerCase();
		for (const [k, v] of Object.entries(p.channels)) if (k.toLowerCase() === lower) { raw = v; break; }
	}
	if (!raw) return null;
	if (p.service_areas.length > 1 && raw.includes('|')) {
		// Empty places are kept: an area without the channel is an empty one
		// (lib/tv.js channelLookupCsv), and dropping it read the next area's
		// channel as this one's. Not carried there is null, not a neighbour's.
		const parts = raw.split('|').map((s) => s.trim());
		if (parts.length > 1) {
			const i = Number.isInteger(areaIndex) && areaIndex >= 0 && areaIndex < parts.length ? areaIndex : 0;
			return parts[i] || null;
		}
	}
	return raw;
}

/** Channel cells use two notations that need spelling out for display:
 *  "A or B" — listings disagree, the channel is one of these; "A / B" — an
 *  SD / HD pair. Returns { text, ambiguous }. */
export function formatChannelNum(raw) {
	if (!raw) return { text: raw, ambiguous: false };
	const fmtPart = (part) => {
		const m = part.trim().match(/^(\d+)\s*\/\s*(\d+)\s*(\(.*\))?$/);
		if (m) return `${m[1]} (SD) / ${m[2]} (HD)${m[3] ? ` ${m[3]}` : ''}`;
		return part.trim();
	};
	const orParts = raw.split(/\s+or\s+/i);
	return { text: orParts.map(fmtPart).join(' or '), ambiguous: orParts.length > 1 };
}

/** A broadcast's channel number on a provider, for display — linear TV only,
 *  never streaming or radio. Null when there is nothing to show. */
export function channelNumberFor(lookup, providerKey, broadcast, areaIndex = 0) {
	const name = broadcast?.media?.shortName;
	if (!name || !lookup.providers[providerKey]) return null;
	const ch = resolveChannel(lookup, name);
	if (!ch || !TV_TYPES.has(ch.type)) return null;
	const raw = providerChannel(lookup, providerKey, ch.key || name, areaIndex);
	return raw ? formatChannelNum(raw).text : null;
}

// --- local simulcasts ---

/** data/simulcasts.csv: date -> channel names. These games are carried by
 *  local over-the-air stations and never appear in ESPN's broadcast list. */
export function parseSimulcasts(csv) {
	const out = new Map();
	if (!csv) return out;
	for (const row of parseGamesCsv(csv)) {
		const chans = (row.channels || '').split('|').map((s) => s.trim()).filter(Boolean);
		if (row.date?.trim() && chans.length) out.set(row.date.trim(), chans);
	}
	return out;
}

/** A game's Central-time date, which is how simulcasts and "today" are kept. */
// The clock is a parameter for the server, which serves many clubs; the page
// has one, and it is SITE's.
export const dayCT = (d, timeZone = SITE.timeZone) => new Date(d).toLocaleDateString('en-CA', { timeZone });

/** A game's broadcasts plus a TV entry for each local simulcast that day. */
export function broadcastsWithSimulcasts(event, simulcasts, timeZone = SITE.timeZone) {
	const real = event?.competitions?.[0]?.broadcasts || [];
	if (!simulcasts?.size || !event?.date) return real;
	const extra = (simulcasts.get(dayCT(event.date, timeZone)) || []).map((name) => ({
		media: { shortName: name }, type: { shortName: 'TV' }, market: { type: 'Home' }, _simulcast: true,
	}));
	return extra.length ? [...real, ...extra] : real;
}
