import { SITE } from './site.js';
// Shared (browser + node) SVG builder for the franchise-history chart: one
// point per season. Pure string output, no DOM — the /history page, the
// homepage sparkline, and the server-rendered social card all use it.

const GOLD = '#FFB612';
const WHITE = '#FFFFFF';
const DARK = '#152A1E';

// Plottable per-season metrics. Metrics in the same scale group share a real
// labeled axis; mixing groups falls back to per-series normalization (shapes
// stay honest, tooltips carry the exact numbers).
export const METRICS = {
	winPct: { label: 'Win %', color: GOLD, group: 'pct' },
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
export function buildChartSvg(history, {
	width = 1000, height = 420,
	metrics = ['winPct'],
	axes = true,
	eras = null,
	markers = true,
	hitAreas = false,
	highlight = null,
	emoji = false,
} = {}) {
	const stripH = eras ? 20 : 0;
	const pad = axes
		? { l: 46, r: 16, t: (emoji ? 26 : 16) + stripH, b: 30 }
		: { l: 4, r: 4, t: (emoji ? 16 : 6) + stripH, b: 6 };
	const plotW = width - pad.l - pad.r;
	const plotH = height - pad.t - pad.b;
	const first = history[0].season, last = history[history.length - 1].season;
	const x = (season) => pad.l + ((season - first) / (last - first)) * plotW;

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
			const from = Math.max(era.from - 0.5, first), to = Math.min(era.to + 0.5, last);
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
			if (s.undefeated && !s.champion) {
				parts.push(`<circle cx="${x(s.season).toFixed(1)}" cy="${my(s[markerMetric]).toFixed(1)}" r="${axes ? 6 : 3.5}" fill="none" stroke="${WHITE}" stroke-width="1.5"/>`);
			}
			if (!s.champion) continue;
			parts.push(`<circle cx="${x(s.season).toFixed(1)}" cy="${my(s[markerMetric]).toFixed(1)}" r="${axes ? 5 : 2.5}" fill="${GOLD}" stroke="${DARK}" stroke-width="1.5"/>`);
			if (emoji) {
				parts.push(`<text x="${x(s.season).toFixed(1)}" y="${(my(s[markerMetric]) - (axes ? 10 : 6)).toFixed(1)}" font-size="${axes ? 14 : 9}" text-anchor="middle">🏆</text>`);
			}
		}
	}

	if (highlight != null) {
		const s = history.find((h) => h.season === highlight);
		if (s) parts.push(`<circle cx="${x(s.season).toFixed(1)}" cy="${my(s[markerMetric]).toFixed(1)}" r="${axes ? 6 : 3.5}" fill="${WHITE}" stroke="${DARK}" stroke-width="1.5"/>`);
	}

	if (hitAreas) {
		const step = plotW / (last - first);
		for (const s of history) {
			parts.push(`<rect data-season="${s.season}" x="${(x(s.season) - step / 2).toFixed(1)}" y="${pad.t - (eras ? 0 : stripH)}" width="${step.toFixed(1)}" height="${height - pad.t}" fill="transparent" style="cursor:pointer"/>`);
		}
		if (eras) {
			for (const era of eras) {
				const from = Math.max(era.from - 0.5, first), to = Math.min(era.to + 0.5, last);
				if (to < from || !era.key) continue;
				parts.push(`<rect data-era="${era.key}" x="${x(from).toFixed(1)}" y="${pad.t - stripH}" width="${(x(to) - x(from)).toFixed(1)}" height="${stripH}" fill="transparent" style="cursor:pointer"/>`);
			}
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`;
}
