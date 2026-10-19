// The season as a subscribable calendar: one event per game, titled with the
// channel and, when a provider is chosen, its channel number on that
// provider ("Brewers vs Dodgers · FOX 11"). Calendar apps poll the feed, so
// a channel ESPN adds late, a final score or a postponement shows up on its
// own.
//
// Pure: the server fetches the schedule and passes it in. iCalendar is
// RFC 5545: CRLF line ends, text escaped, lines folded at 75 octets.
//
// Copied from the baseball site's lib/calendar.js at 4441d89. The club, its
// name and its clock were literals ('MIL', 'Brewers', America/Chicago) and
// now come from SITE — which on the server is the deployment's one club,
// because lib/web-routes.js sets globalThis.CLUB before importing anything
// under web/. Imported dynamically for that reason, never at the top of
// server.js.

import {
	resolveChannel, broadcastType, primaryBroadcast, providerChannel, formatChannelNum,
	broadcastsWithSimulcasts,
} from '../web/mlb/tv-core.js';
import { SITE } from '../web/mlb/site.js';

const TEAM = SITE.espnAbbr;
const GAME_HOURS = 3;
const TV = new Set(['broadcast', 'cable', 'regional']);

/** RFC 5545 TEXT: backslash, semicolon and comma escaped, newlines as \n. */
export const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets, continuation lines starting with a
 *  space. Counted in UTF-8 bytes, and never splitting a character. */
export function foldLine(line) {
	const out = [];
	let cur = '', bytes = 0;
	for (const ch of line) {
		const n = Buffer.byteLength(ch);
		const limit = out.length ? 74 : 75; // continuation lines spend one on the space
		if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
		cur += ch;
		bytes += n;
	}
	out.push(cur);
	return out.map((l, i) => (i ? ` ${l}` : l)).join('\r\n');
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (d) => d.toLocaleDateString('en-CA', { timeZone: SITE.timeZone }).replace(/-/g, '');

/** A broadcast's name with its number on the provider: "FOX 11". */
function withNumber(lookup, b, provider, area) {
	const name = b.media.shortName;
	const ch = resolveChannel(lookup, name);
	if (!provider || !ch || !TV.has(ch.type)) return name;
	const raw = providerChannel(lookup, provider, ch.key, area);
	return raw ? `${name} ${formatChannelNum(raw).text}` : name;
}

/** One game as a VEVENT's lines (unfolded). */
export function gameEvent(event, lookup, simulcasts, { provider = null, area = 0, origin, now }) {
	const comp = event.competitions?.[0] || {};
	const us = comp.competitors?.find((c) => c.team?.abbreviation === TEAM);
	const them = comp.competitors?.find((c) => c.team?.abbreviation !== TEAM)?.team;
	const opp = them?.shortDisplayName || them?.displayName || 'TBD';
	const home = us?.homeAway === 'home';
	const status = comp.status?.type?.name || '';
	const cancelled = status === 'STATUS_POSTPONED' || status === 'STATUS_CANCELED';
	const final = status === 'STATUS_FINAL';

	const all = broadcastsWithSimulcasts(event, simulcasts).filter((b) => b.media?.shortName);
	const byType = (types) => all.filter((b) => types.has(broadcastType(lookup, b)));
	const tv = byType(TV);
	const streaming = byType(new Set(['streaming']));
	const radio = byType(new Set(['radio']));
	const lead = primaryBroadcast(lookup, tv.length ? tv : all);

	const matchup = `${home ? 'vs' : '@'} ${opp}`;
	let summary;
	if (final) {
		const score = (c) => parseInt(c?.score?.value ?? c?.score ?? 0, 10) || 0;
		const mine = score(us), theirs = score(comp.competitors?.find((c) => c !== us));
		summary = `${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${mine}–${theirs} ${matchup}`;
	} else {
		const where = lead ? withNumber(lookup, lead, provider, area) : 'not on TV';
		summary = `${cancelled ? 'Postponed: ' : ''}${SITE.team} ${matchup} · ${where}`;
	}

	const round = (comp.notes || []).map((n) => n.headline).find(Boolean);
	const providerName = provider ? lookup.providers[provider]?.display_name : null;
	const list = (label, items) => (items.length ? [`${label}: ${items.map((b) => withNumber(lookup, b, provider, area)).join(', ')}`] : []);
	const description = [
		...(round ? [round] : []),
		...list('TV', tv),
		...list('Streaming', streaming),
		...list('Radio', radio),
		...(!tv.length && !streaming.length ? ['Not on TV or streaming, as far as ESPN lists.'] : []),
		...(providerName ? [`Channel numbers for ${providerName}. Check your local guide.`] : []),
		`${origin}/`,
	].join('\n');

	const start = new Date(event.date);
	// timeValid false is ESPN for "time to be announced": an all-day event
	// rather than a guessed start.
	const timed = comp.timeValid !== false;
	const lines = [
		'BEGIN:VEVENT',
		`UID:${event.id}@arethebrewersontv.com`,
		`DTSTAMP:${stamp(now)}`,
		...(timed
			? [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + GAME_HOURS * 3600e3))}`]
			: [`DTSTART;VALUE=DATE:${dateOnly(start)}`]),
		`SUMMARY:${icsText(summary)}`,
		`DESCRIPTION:${icsText(description)}`,
		...(comp.venue?.fullName ? [`LOCATION:${icsText(comp.venue.fullName)}`] : []),
		`URL:${origin}/`,
		...(cancelled ? ['STATUS:CANCELLED'] : []),
		'END:VEVENT',
	];
	return lines;
}

/** The whole calendar. `events` are the season's ESPN schedule events,
 *  tagged _t pre/regular/post; spring training is left out. */
export function buildCalendar(events, lookup, simulcasts, { provider = null, area = 0, origin, now = new Date() }) {
	const providerName = provider ? lookup.providers[provider]?.display_name : null;
	const name = providerName ? `${SITE.team} on TV · ${providerName}` : `${SITE.team} on TV`;
	const games = events
		.filter((e) => e._t !== 'pre')
		.sort((a, b) => new Date(a.date) - new Date(b.date));
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:-//are-they-sports//${SITE.team} on TV//EN`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${icsText(name)}`,
		`X-WR-TIMEZONE:${SITE.timeZone}`,
		// Channels get added and games postponed; ask apps to check back.
		'REFRESH-INTERVAL;VALUE=DURATION:PT3H',
		'X-PUBLISHED-TTL:PT3H',
		...games.flatMap((e) => gameEvent(e, lookup, simulcasts, { provider, area, origin, now })),
		'END:VCALENDAR',
	];
	return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
