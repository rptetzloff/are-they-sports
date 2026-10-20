import { SITE } from './site.js';
// Shared (browser + node) SVG builder for the franchise-history chart: one
// point per season. Pure string output, no DOM — the /history page, the
// homepage sparkline, and the server-rendered social card all use it.

const GOLD = '#FFC52F';
const WHITE = '#FFFFFF';
const DARK = '#0d1d38';

// Playoff tiers, shallowest → deepest. `marker` is the SVG glyph drawn on the
// chart line at each playoff season; `label` is the legend / tooltip name.
export const POSTSEASON = {
	wsWin:        { tier: 5, color: GOLD,           label: `${SITE.championship} win`,        glyph: '★' },
	wsApp:        { tier: 4, color: '#FFD66B',      label: `${SITE.championship} appearance`,  glyph: '◆' },
	// MLS's rounds, on the baseball chart's tiers: the keys stay, the names
	// are MLS's. A wild card is drawn as Round One, a playoff appearance.
	lcs:          { tier: 3, color: '#7FC4FF',      label: 'Conference Final',         glyph: '▲' },
	division:     { tier: 2, color: '#9BD7A3',      label: 'Conference Semifinal',     glyph: '■' },
	wildcard:     { tier: 1, color: '#C9A8E8',      label: 'Round One',                glyph: '●' },
};

// Map a season's deepest `postseason` round code (F/D/L/W) + World Series
// result to the highest applicable tier. wsWin outranks a WS appearance.
export function postseasonTier(s) {
	if (s.champion && s.championship) return 'wsWin';
	switch (s.postseason) {
		case 'W': return 'wsApp';
		case 'L': return 'lcs';
		case 'D': return 'division';
		case 'F': return 'wildcard';
		case 'X': return 'wildcard';
		default: return null;
	}
}

// Plottable per-season metrics. Metrics in the same scale group share a real
// labeled axis; mixing groups falls back to per-series normalization (shapes
// stay honest, tooltips carry the exact numbers).
export const METRICS = {
	// Points percentage, three a win (records-core computeSeasonHistory), under
	// the key the chart reads.
	winPct: { label: 'Points %', color: GOLD, group: 'pct' },
	wins: { label: 'Wins', color: WHITE, group: 'count' },
	pf: { label: SITE.scoreForLabel, color: '#7FC4FF', group: 'points' },
	pa: { label: SITE.scoreAgainstLabel, color: '#FF6B6B', group: 'points' },
};

// history: computeSeasonHistory() output. Options:
//   width/height  — SVG pixel size (also the viewBox)
//   metrics       — array of METRICS keys to plot (first is the primary line)
//   axes          — draw y-axis labels and gridlines
//   eras          — era bands: [{ label, from, to, key }] or null. Bands get a
//                   hoverable top strip carrying data-era="key" when hitAreas
//                   is on, so pages can attach coach tooltips.
//   markers       — championship dots (drawn on the win% line if plotted,
//                   else the first metric)
//   hitAreas      — invisible per-season hover/click columns (data-season)
//   highlight     — a season number to mark with a distinct dot, or null
//   emoji         — trophy glyphs above championship dots (browser only;
//                   the PNG renderer has no emoji font)
// The postseason markers as drawn shapes rather than text glyphs, for the
// share cards. Those render with Liberation Sans and no system fonts, and it
// has no ★ or ◆: the 1982 World Series marker came out as an empty box on
// the history card. The browser has the glyphs and keeps using them.
function markerShape(tier, cx, cy, sz, color) {
	const r = sz / 2;
	const pts = (list) => list.map(([px, py]) => `${(cx + px).toFixed(1)},${(cy + py).toFixed(1)}`).join(' ');
	switch (tier) {
		case 'wsWin': {
			const star = [];
			for (let i = 0; i < 10; i++) {
				const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
				star.push([rr * Math.cos(a), rr * Math.sin(a)]);
			}
			return `<polygon points="${pts(star)}" fill="${color}" stroke="${DARK}" stroke-width="0.5"/>`;
		}
		case 'wsApp': return `<polygon points="${pts([[0, -r], [r * 0.75, 0], [0, r], [-r * 0.75, 0]])}" fill="${color}"/>`;
		case 'lcs': return `<polygon points="${pts([[0, -r * 0.8], [r * 0.8, r * 0.6], [-r * 0.8, r * 0.6]])}" fill="${color}"/>`;
		case 'division': return `<rect x="${(cx - r * 0.6).toFixed(1)}" y="${(cy - r * 0.6).toFixed(1)}" width="${(r * 1.2).toFixed(1)}" height="${(r * 1.2).toFixed(1)}" fill="${color}"/>`;
		default: return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.6).toFixed(1)}" fill="${color}"/>`;
	}
}

export function buildChartSvg(history, {
	width = 1000, height = 420,
	metrics = ['winPct'],
	axes = true,
	eras = null,
	markers = true,
	hitAreas = false,
	highlight = null,
	emoji = false,
	milestones = null,
	shapes = false,
} = {}) {
	const stripH = eras ? 20 : 0;
	const msTrackH = milestones ? 34 : 0; // two 17px tracks: team + park
	const pad = axes
		? { l: 46, r: 16, t: (emoji ? 26 : 16) + stripH, b: 30 + msTrackH }
		: { l: 4, r: 4, t: (emoji ? 16 : 6) + stripH, b: 6 + msTrackH };
	const plotW = width - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const first = history[0].season, last = history[history.length - 1].season;
	const x = (season) => pad.l + ((season - first) / (last - first)) * plotW;
	// Era bands may be keyed by exact ISO dates (YYYY-MM-DD) so stints don't
	// overlap into neighboring seasons. Convert a date to a fractional season
	// position on the same grid as the integer-season data points.
	const seasonOfDate = (iso) => {
		const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
		// Fractional year via day-of-year / 365.
		const days = [31, (((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		let doy = d;
		for (let i = 0; i < m - 1; i++) doy += days[i];
		return y + (doy - 1) / 365;
	};
	const eraFrom = (era) => typeof era.from === 'string' ? seasonOfDate(era.from) : era.from;
	const eraTo = (era) => typeof era.to === 'string' ? seasonOfDate(era.to) : era.to;

	// One shared scale when every metric is in the same group; otherwise each
	// series normalizes to its own max.
	const groups = new Set(metrics.map((m) => METRICS[m].group));
	const shared = groups.size === 1;
	const maxOf = (m) => (METRICS[m].group === 'pct' ? 1 : Math.max(1, ...history.map((s) => s[m])));
	const sharedMax = shared ? Math.max(...metrics.map(maxOf)) : null;
	const yFor = (m) => {
		const max = shared ? sharedMax : maxOf(m);
		return (v) => pad.t + (1 - v / max) * plotH;
	};

	const parts = [];

	if (eras) {
		let i = 0;
		for (const era of eras) {
			const from = Math.max(eraFrom(era), first), to = Math.min(eraTo(era), last);
			if (to < from) continue;
			const bx = x(from), bw = x(to) - x(from);
			parts.push(`<rect x="${bx.toFixed(1)}" y="${pad.t - stripH}" width="${bw.toFixed(1)}" height="${(plotH + stripH).toFixed(1)}" fill="${GOLD}" opacity="${i % 2 ? 0.1 : 0.045}"/>`);
			if (era.label && bw > 54) {
				parts.push(`<text x="${(bx + bw / 2).toFixed(1)}" y="${pad.t - stripH + 14}" font-size="12" fill="${GOLD}" opacity="0.8" text-anchor="middle">${era.label}</text>`);
			}
			i++;
		}
	}

	if (axes) {
		const axisMax = shared ? sharedMax : null;
		if (axisMax != null) {
			const pct = groups.has('pct');
			const ticks = pct ? [0, 0.25, 0.5, 0.75, 1]
				: [0, Math.round(axisMax / 2), axisMax];
			const yy = yFor(metrics[0]);
			for (const tv of ticks) {
				const ty = yy(tv);
				const mid = pct && tv === 0.5;
				parts.push(`<line x1="${pad.l}" y1="${ty.toFixed(1)}" x2="${width - pad.r}" y2="${ty.toFixed(1)}" stroke="${WHITE}" opacity="${mid ? 0.3 : 0.08}"${mid ? ' stroke-dasharray="4 4"' : ''}/>`);
				parts.push(`<text x="${pad.l - 8}" y="${(ty + 4).toFixed(1)}" font-size="12" fill="${WHITE}" opacity="0.55" text-anchor="end">${pct ? (tv === 0 || tv === 1 ? `${tv}` : `.${tv * 100}`) : tv}</text>`);
			}
		}
		for (let decade = Math.ceil(first / 20) * 20; decade <= last; decade += 20) {
			parts.push(`<text x="${x(decade).toFixed(1)}" y="${height - 8}" font-size="12" fill="${WHITE}" opacity="0.55" text-anchor="middle">${decade}</text>`);
		}
	} else if (groups.has('pct')) {
		const yy = yFor(metrics.find((m) => METRICS[m].group === 'pct'));
		parts.push(`<line x1="${pad.l}" y1="${yy(0.5).toFixed(1)}" x2="${width - pad.r}" y2="${yy(0.5).toFixed(1)}" stroke="${WHITE}" opacity="0.25" stroke-dasharray="3 3"/>`);
	}

	for (const m of metrics) {
		const yy = yFor(m);
		const pts = history.map((s) => `${x(s.season).toFixed(1)},${yy(s[m]).toFixed(1)}`).join(' ');
		parts.push(`<polyline points="${pts}" fill="none" stroke="${METRICS[m].color}" stroke-width="${axes ? 2 : 1.5}" stroke-linejoin="round"${m === 'pa' ? ' stroke-dasharray="5 3"' : ''}/>`);
	}

	const markerMetric = metrics.includes('winPct') ? 'winPct' : metrics[0];
	const my = yFor(markerMetric);
	if (markers) {
		for (const s of history) {
			const tier = postseasonTier(s);
			if (!tier) continue;
			const P = POSTSEASON[tier];
			const cy = my(s[markerMetric]);
			const sz = tier === 'wsWin' ? 16 : (tier === 'wsApp' ? 14 : 12);
			if (shapes) {
				parts.push(markerShape(tier, x(s.season), cy, sz, P.color));
				continue;
			}
			parts.push(`<text x="${x(s.season).toFixed(1)}" y="${(cy + sz / 3).toFixed(1)}" font-size="${sz}" fill="${P.color}" text-anchor="middle"${tier === 'wsWin' ? ` stroke="${DARK}" stroke-width="0.5"` : ''}>${P.glyph}</text>`);
		}
	}

	if (highlight != null) {
		const s = history.find((h) => h.season === highlight);
		if (s) parts.push(`<circle cx="${x(s.season).toFixed(1)}" cy="${my(s[markerMetric]).toFixed(1)}" r="${axes ? 6 : 3.5}" fill="${WHITE}" stroke="${DARK}" stroke-width="1.5"/>`);
	}

	if (hitAreas) {
		const step = plotW / (last - first);
		for (const s of history) {
			parts.push(`<rect data-season="${s.season}" x="${(x(s.season) - step / 2).toFixed(1)}" y="${pad.t - (eras ? 0 : stripH)}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent" style="cursor:pointer"/>`);
		}
		if (eras) {
			for (const era of eras) {
				const from = Math.max(eraFrom(era), first), to = Math.min(eraTo(era), last);
				if (to < from || !era.key) continue;
				parts.push(`<rect data-era="${era.key}" x="${x(from).toFixed(1)}" y="${pad.t - stripH}" width="${(x(to) - x(from)).toFixed(1)}" height="${stripH}" fill="transparent" style="cursor:pointer"/>`);
			}
		}
	}

	if (milestones) {
		// Two icon tracks at the bottom, just below the plot and near the
		// year labels: team-identity row then park row. Placing them here
		// keeps them clear of the manager strip at the top, so its tooltip
		// can't steal the hover. A dashed reference line runs from the top of
		// the plot down to the icon. Drawn last so the icons sit above the
		// per-season hit-areas and stay hoverable.
		const trackTop = height - pad.b;
		const teamY = trackTop + 8;
		const parkY = trackTop + 25;
		for (const ms of milestones) {
			const px = x(seasonOfDate(ms.date));
			if (px < pad.l || px > width - pad.r) continue;
			const rowY = ms.type === 'team' ? teamY : parkY;
			const glyph = ms.type === 'team' ? '⬡' : '⌂';
			const attr = String(ms.label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
			parts.push(`<line x1="${px.toFixed(1)}" y1="${pad.t.toFixed(1)}" x2="${px.toFixed(1)}" y2="${(rowY + 4).toFixed(1)}" stroke="${WHITE}" stroke-width="1" stroke-dasharray="2 3" opacity="0.25"/>`);
			parts.push(`<text data-milestone="${attr}" data-milestone-type="${ms.type}" x="${px.toFixed(1)}" y="${(rowY + 4).toFixed(1)}" font-size="14" fill="${GOLD}" text-anchor="middle" style="cursor:help">${glyph}</text>`);
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;
}
