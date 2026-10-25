/** Which NFL game a TV market's CBS and FOX stations carry, from 506sports'
 *  weekly coverage maps (https://506sports.com/nfl.php).
 *
 *  ESPN calls every game's broadcast "national", but a Sunday-afternoon CBS or
 *  FOX game is regional: each station carries one game of its window, picked by
 *  market. 506sports publishes a map a window -- CBS early, late or single,
 *  FOX early or late -- with each market coloured by the game it gets, and a
 *  legend pairing each colour (a swatch image) with a matchup. This reads the
 *  colour at a market's point on the map and names the game.
 *
 *  The national games are listed above the maps, and a streaming-only one
 *  (Prime Video, Netflix, YouTube, the NFL Network abroad) names the
 *  over-the-air stations that simulcast it in the teams' home markets:
 *  "also WGBA/NBC Green Bay, WITI/FOX Milwaukee". A market not listed has the
 *  stream only -- Wausau has a Packers game on CBS, but not on Thursday night.
 *
 *  The pages are read at most every few hours and the maps, whose URLs carry a
 *  version (07-CBS-V2.png), once each. 506sports' maps are unofficial and say
 *  so; the page that uses this links to them. */
import { get as httpsGet } from 'node:https';
import { decodePng } from './png.js';

const SITE = 'https://506sports.com/';
const AGENT = 'are-they-sports (aretheyon.tv)';

/** Each market's point on the maps, in pixels of the 1280x720 base map 506sports
 *  has used all of 2026. Calibrated against maps that split the region
 *  between games (2026 weeks 1, 2 and 7): each point falls inside its market on
 *  every one, and away from the labels, which are drawn over the colour.
 *  A market's name is how a service area names it (tv_area.dma) and how
 *  506sports names it in a simulcast ("WITI/FOX Milwaukee"). */
export const DMA_POINTS = {
	Duluth: [725, 132],
	'Green Bay': [796, 201],
	'La Crosse': [736, 214],
	Madison: [774, 221],
	Milwaukee: [801, 225],
	Minneapolis: [674, 163],
	Wausau: [770, 181],
};
const MAP_SIZE = [1280, 720];

/** The 506sports page for a week, as its parts: national games with their
 *  simulcasts, and the regional windows with their map and legend. */
export function parseWeekPage(html) {
	// Comments out first: until a week's maps are posted, 506sports keeps each
	// map commented out (<!--<div id="map"><img src="2026/08-CBS-E.png">-->)
	// and the simulcast lines with it, and a commented map is not a map.
	const text = String(html).replace(/<!--[\s\S]*?-->/g, '');
	const national = [];
	for (const m of text.matchAll(/<div id="cgame">([\s\S]*?)<\/div>\s*<\/div>/g)) {
		const block = m[1];
		const get = (id) => (block.match(new RegExp(`<div id="${id}">([^<]*)`))?.[1] ?? '').trim();
		const also = block.match(/also ([^<]+)/)?.[1] ?? '';
		national.push({
			matchup: get('cmatchup'),
			network: get('cntwk'),
			// "WGBA/NBC Green Bay" -> the station, its network and its market.
			simulcasts: also.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
				const [, call = '', net = '', market = ''] = s.match(/^(\S+?)\/(\S+)\s+(.+)$/) ?? [];
				return { call, net, market };
			}).filter((s) => s.call),
		});
	}
	const regional = [];
	// Each window: its heading ("CBS EARLY"), its map, and its legend.
	const parts = text.split(/<font size="5">/).slice(1);
	for (const part of parts) {
		const heading = part.match(/^([^<]+)</)?.[1]?.trim() ?? '';
		const hm = heading.match(/^(CBS|FOX)\s+(EARLY|LATE|SINGLE)/i);
		if (!hm) continue;
		// No map yet is a window still, its games listed and not yet placed.
		const map = part.match(/<div id="map">\s*<img src="([^"]+)"/)?.[1] ?? null;
		// A matchup can carry markup of its own: "Baltimore vs Dallas <i>(in Rio
		// de Janeiro)</i>".
		const games = [...part.matchAll(/nfl\/swatches\/(\d+)\.png'>\s*<\/div>\s*<div id='matchup'>([\s\S]*?)<\/div>/g)]
			.map((g) => {
				const text = g[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
				return { swatch: Number(g[1]), matchup: text.replace(/\s*\(LATE\)\s*$/i, '').trim(), late: /\(LATE\)/i.test(text) };
			});
		regional.push({ network: hm[1].toUpperCase(), window: hm[2].toUpperCase(), map, games });
	}
	return { national, regional };
}

const close = (a, b) => Math.abs(a[0] - b[0]) <= 10 && Math.abs(a[1] - b[1]) <= 10 && Math.abs(a[2] - b[2]) <= 10;

/** A swatch's colours: a plain swatch has one, a hatched one (the window's
 *  most-carried game) two. Rare antialiasing shades are left out. */
export function swatchColors(png) {
	const counts = new Map();
	for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
		const key = png.pixel(x, y).join(',');
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const total = png.width * png.height;
	return [...counts].filter(([, n]) => n / total > 0.05).map(([k]) => k.split(',').map(Number));
}

/** Which swatch a market's point is, by majority over the 9x9 pixels around
 *  it (a hatched game is striped, and a point can sit on a county line), or
 *  null where no swatch's colour is there -- a map whose layout changed. */
export function swatchAt(png, [px, py], swatches) {
	const votes = new Map();
	for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
		const p = png.pixel(px + dx, py + dy);
		for (const [n, colors] of swatches) {
			if (colors.some((c) => close(c, p))) { votes.set(n, (votes.get(n) ?? 0) + 1); break; }
		}
	}
	const best = [...votes].sort((a, b) => b[1] - a[1])[0];
	return best && best[1] >= 20 ? best[0] : null;
}

/** The week's coverage: every market's game in every regional window, and
 *  the national games' simulcasts. `fetchBuffer(url)` answers a Buffer or
 *  null; images are fetched once each through `images` (a Map kept by the
 *  caller, since their URLs are versioned). A map not posted yet is not
 *  remembered: before the Wednesday it goes up, the page already names it
 *  (2026/08-CBS-E.png) and it answers 404, and kept as missing it would never
 *  have been read once posted at the same address. `posted` says which. */
export async function weekCoverage(season, week, { fetchBuffer, images = new Map(), points = DMA_POINTS }) {
	const url = `${SITE}nfl.php?yr=${season}&wk=${week}`;
	const page = await fetchBuffer(url);
	if (!page) return null;
	const { national, regional } = parseWeekPage(page.toString('utf8'));
	const image = async (path) => {
		if (images.has(path)) return images.get(path);
		const buf = await fetchBuffer(SITE + path);
		if (!buf) return null;
		const png = decodePng(buf);
		images.set(path, png);
		return png;
	};
	const windows = [];
	for (const w of regional) {
		const png = w.map ? await image(w.map).catch(() => null) : null;
		const byDma = {};
		const posted = Boolean(png && png.width === MAP_SIZE[0] && png.height === MAP_SIZE[1]);
		if (posted) {
			const swatches = [];
			for (const g of w.games) {
				const s = await image(`nfl/swatches/${g.swatch}.png`).catch(() => null);
				if (s) swatches.push([g.swatch, swatchColors(s)]);
			}
			for (const [dma, point] of Object.entries(points)) {
				const n = swatchAt(png, point, swatches);
				const game = w.games.find((g) => g.swatch === n);
				if (game) byDma[dma] = game.matchup;
			}
		}
		windows.push({ network: w.network, window: w.window, map: w.map ? SITE + w.map : null, games: w.games.map((g) => g.matchup), byDma, posted });
	}
	return { season, week, url, national, regional: windows, posted: windows.every((w) => w.posted) };
}

export { sidesOf, nameMatches } from '../web/nfl/coverage-core.js';

/** Every market to read: the calibrated ones, and each service area placed on
 *  the map in the admin (tv_area.map_x, map_y), by the market name it was
 *  given. A placed point for a calibrated market's name wins: whoever placed it
 *  knew where their area is. */
export function marketPoints(areas = []) {
	const points = { ...DMA_POINTS };
	for (const a of areas) {
		if (a.dma && Number.isInteger(a.mapX) && Number.isInteger(a.mapY)) points[a.dma] = [a.mapX, a.mapY];
	}
	return points;
}

// The week's coverage, one copy for the process: a week's page held three
// hours once its maps are all up and twenty minutes before (a map posted on
// the Wednesday is read within the half hour), a failed read retried after
// ten with the last good answer kept, and each posted image once, its URL
// versioned. Keyed by the markets read too, so placing one is read at once.
const state = { weeks: new Map(), images: new Map() };

// Through node:https, not fetch: 506sports' Cloudflare answers Node's fetch
// 403 whatever it is called -- it tells clients apart by their connection, not
// their user agent -- and the https module 200.
export const fetchBuffer = (url) => new Promise((resolve) => {
	const req = httpsGet(url, { headers: { 'user-agent': AGENT }, timeout: 15_000 }, (r) => {
		if (r.statusCode !== 200) { r.resume(); return resolve(null); }
		const parts = [];
		r.on('data', (d) => parts.push(d));
		r.on('end', () => resolve(Buffer.concat(parts)));
		r.on('error', () => resolve(null));
	});
	req.on('timeout', () => req.destroy());
	req.on('error', () => resolve(null));
});

export async function coverageFor(season, week, { points = DMA_POINTS, fetch: get = fetchBuffer, now = Date.now } = {}) {
	const key = `${season}|${week}|${JSON.stringify(Object.entries(points).sort())}`;
	const had = state.weeks.get(key);
	const life = had?.value?.posted ? 3 * 3600_000 : had?.value ? 20 * 60_000 : 10 * 60_000;
	if (had && now() - had.at < life) return had.value;
	const value = await weekCoverage(season, week, { fetchBuffer: get, images: state.images, points }).catch(() => null);
	state.weeks.set(key, { at: now(), value: value ?? had?.value ?? null });
	return value ?? had?.value ?? null;
}

/** A posted map to place a market on, for the admin page: the newest read,
 *  else one known to be posted. Every one is the same 1280x720 base map. */
export const REFERENCE_MAP = `${SITE}2026/07-CBS-V2.png`;
export function postedMap() {
	const maps = [...state.images.keys()].filter((k) => /^\d{4}\/\d{2}-(CBS|FOX)/.test(k)).sort();
	return maps.length ? SITE + maps.at(-1) : REFERENCE_MAP;
}
