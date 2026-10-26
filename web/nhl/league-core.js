// A league's page: every game of a day (or of a week, for football) from
// ESPN's scoreboard, and one of them as a card in the slot where a club's page
// shows its own game (Ray, 2026-10-20: "it should open the mini-card in the
// slot where the single game card would be for a single team").
//
// The same file in every sport's front end (web/<sport>/league-core.js): it
// reads ESPN's scoreboard, which every sport shares, and nothing of a sport's
// own code. Pure functions — no fetch, no DOM — so a test can run them.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 24 * 60 * 60 * 1000;
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- periods ----------------------------------------------------------------

/** '2026-10-20' from an ESPN calendar instant ('2026-10-20T07:00Z'). ESPN
 *  writes a game day as the instant its US day begins, so the date part is
 *  the day it means. */
export const isoDay = (instant) => String(instant).slice(0, 10);
/** '20261020', ESPN's `dates` form. */
export const espnDay = (day) => day.replace(/-/g, '');
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The periods a scoreboard response's calendar offers, in order: one a game
 * day for a daily sport, one a week for football. A period is
 *   { key, label, day } for a day ('d2026-10-20'), or
 *   { key, label, season, type, week, start, end } for a week ('w2026-2-7').
 *
 * ESPN writes the calendar three ways, and each is read as it is written:
 *   - a list of game days (`calendarIsWhitelist`: hockey, basketball, soccer);
 *   - the days WITHOUT games inside the season's span (baseball, whose
 *     calendar says false: its 22 entries are the All-Star break and the
 *     like, not its 22 game days);
 *   - season types, each a list of weeks (football's `list`).
 */
export function calendarPeriods(scoreboard) {
	const lg = scoreboard?.leagues?.[0];
	if (!lg) return [];
	const cal = lg.calendar ?? [];
	if (lg.calendarType === 'list' || (cal.length && typeof cal[0] === 'object')) {
		const season = scoreboard.season?.year ?? lg.season?.year;
		const out = [];
		for (const type of cal) {
			const t = Number(type.value);
			// The off season is a type with weeks of its own, and no games.
			if (!(t >= 1 && t <= 3)) continue;
			for (const w of type.entries ?? []) {
				out.push({
					key: `w${season}-${t}-${w.value}`,
					label: t === 2 ? w.label : `${type.label === 'Preseason' ? 'Preseason' : ''} ${w.label}`.trim(),
					season, type: t, week: Number(w.value),
					start: w.startDate, end: w.endDate,
				});
			}
		}
		return out;
	}
	const days = cal.map(isoDay);
	if (lg.calendarIsWhitelist !== false) return [...new Set(days)].sort().map(dayPeriod);
	// The days of the span less the ones listed.
	const start = isoDay(lg.calendarStartDate ?? lg.season?.startDate ?? '');
	const end = isoDay(lg.calendarEndDate ?? lg.season?.endDate ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
	const off = new Set(days);
	const out = [];
	for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) if (!off.has(d)) out.push(dayPeriod(d));
	return out;
}

export const dayPeriod = (day) => {
	const d = new Date(`${day}T12:00:00Z`);
	return { key: `d${day}`, label: `${DOW[d.getUTCDay()]}, ${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, day };
};

/** The period a scoreboard answered for: its week, or the day it shows. */
export function currentPeriod(scoreboard, periods) {
	if (scoreboard?.week?.number != null && scoreboard.season) {
		const key = `w${scoreboard.season.year}-${scoreboard.season.type}-${scoreboard.week.number}`;
		return periods.find((p) => p.key === key) ?? null;
	}
	const day = scoreboard?.day?.date ? isoDay(scoreboard.day.date) : null;
	return day ? (periods.find((p) => p.day === day) ?? dayPeriod(day)) : null;
}

/** The scoreboard query for a period: `dates` for a day; season, type and
 *  week for football. */
export function periodQuery(p) {
	if (!p) return '';
	if (p.day) return `dates=${espnDay(p.day)}`;
	return `dates=${p.season}&seasontype=${p.type}&week=${p.week}`;
}

/** A period from a URL's `p` parameter ('d2026-10-20', 'w2026-2-7'), or null. */
export function parsePeriodKey(key) {
	const d = /^d(\d{4}-\d{2}-\d{2})$/.exec(key ?? '');
	if (d) return dayPeriod(d[1]);
	const w = /^w(\d{4})-([1-3])-(\d{1,2})$/.exec(key ?? '');
	if (w) return { key, label: '', season: Number(w[1]), type: Number(w[2]), week: Number(w[3]) };
	return null;
}

// --- games ------------------------------------------------------------------

const scoreOf = (c) => {
	const v = c?.score?.value ?? c?.score?.displayValue ?? c?.score;
	return v == null || v === '' ? null : Number(v);
};

/** The parts of a scoreboard event the page reads, from both sides. */
export function gameOf(event) {
	const comp = event?.competitions?.[0] ?? {};
	const st = comp.status?.type ?? {};
	const side = (where) => {
		const c = (comp.competitors ?? []).find((x) => x.homeAway === where) ?? {};
		return {
			id: String(c.team?.id ?? c.id ?? ''),
			abbr: c.team?.abbreviation ?? '',
			name: c.team?.displayName ?? c.team?.name ?? '',
			short: c.team?.shortDisplayName ?? c.team?.name ?? '',
			// Its place in the poll, where the league has one (college football;
			// ESPN says 99 for unranked).
			rank: c.curatedRank?.current >= 1 && c.curatedRank.current <= 25 ? c.curatedRank.current : null,
			score: scoreOf(c),
			pens: c.shootoutScore ?? null,
			winner: c.winner === true,
			record: (c.records ?? []).find((r) => r.type === 'total' || r.name === 'overall')?.summary ?? c.records?.[0]?.summary ?? '',
			lines: (c.linescores ?? []).map((l) => l.displayValue ?? l.value),
			hits: c.hits ?? null,
			errors: c.errors ?? null,
			probable: (c.probables ?? []).map((p) => p.athlete?.displayName).filter(Boolean)[0] ?? null,
		};
	};
	return {
		id: String(event?.id ?? ''),
		date: event?.date ?? comp.date ?? '',
		away: side('away'),
		home: side('home'),
		neutral: comp.neutralSite === true,
		state: st.state ?? 'pre',
		final: st.completed === true,
		postponed: /POSTPONED|CANCELED|SUSPENDED/.test(st.name ?? ''),
		detail: st.shortDetail ?? st.detail ?? '',
		note: comp.notes?.[0]?.headline ?? '',
		venue: comp.venue?.fullName ?? '',
		city: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', '),
		tv: [...new Set((comp.broadcasts ?? []).flatMap((b) => b.names ?? []).filter(Boolean))],
		situation: comp.situation ?? null,
		leaders: (comp.leaders ?? []).map((l) => {
			const top = l.leaders?.[0];
			return top ? { label: l.shortDisplayName ?? l.displayName ?? '', who: top.athlete?.displayName ?? '', value: top.displayValue ?? '' } : null;
		}).filter(Boolean),
		espn: (event?.links ?? []).find((l) => (l.rel ?? []).includes('summary'))?.href ?? event?.links?.[0]?.href ?? '',
	};
}

const timeOf = (iso, timeZone) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
const dayOf = (iso, timeZone) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) });

/** What a game's row says on its right: the score once it has one, the
 *  start time before. */
export function scoreText(g, { timeZone } = {}) {
	if (g.postponed) return g.detail || 'Postponed';
	if (g.state === 'pre') return timeOf(g.date, timeZone);
	const pens = g.away.pens != null && g.home.pens != null ? ` (${g.away.pens}–${g.home.pens} pens)` : '';
	return `${g.away.score ?? 0}–${g.home.score ?? 0}${pens}`;
}

/** The game to open on: a live one, else the next to start, else the last
 *  to finish. */
export function pickGame(games, now = Date.now()) {
	if (!games.length) return null;
	const live = games.find((g) => g.state === 'in');
	if (live) return live;
	const next = games.filter((g) => g.state === 'pre' && !g.postponed && Date.parse(g.date) >= now - 6 * 60 * 60 * 1000)
		.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
	if (next) return next;
	return [...games].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
}

/** The period's games as rows, in the front page's own row markup
 *  (schedule-core.js scheduleRowHtml's classes), so they look as a club's
 *  schedule does: when, the two clubs, the score or start time, TV. A week
 *  says the day; a day says only the time. */
export function gameRowsHtml(games, { selected = null, weekly = false, timeZone } = {}) {
	if (!games.length) return '<div class="loading">No games.</div>';
	return [...games].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id)).map((g) => {
		const state = g.postponed ? 'postponed' : g.state === 'in' ? 'live' : g.state === 'post' ? 'final' : 'upcoming';
		// A week's row says the day; a day's says the start time, then how the
		// game stands once it has begun. The score sits on the right.
		const when = weekly ? dayOf(g.date, timeZone) : (g.state === 'pre' && !g.postponed ? timeOf(g.date, timeZone) : g.detail);
		const out = !weekly && g.state === 'pre' && !g.postponed ? '' : scoreText(g, { timeZone });
		const won = (s) => (g.final && s.winner ? ' league-won' : '');
		return `<div class="sched-row sched-${state} sched-click league-row${g.id === selected ? ' league-row-on' : ''}" data-key="${esc(g.id)}" role="button" tabindex="0"`
			+ ` aria-label="${esc(`${g.away.name} at ${g.home.name}`)}"${g.id === selected ? ' aria-current="true"' : ''}>`
			+ `<span class="sched-date">${esc(when)}</span>`
			+ `<span class="sched-opp"><span class="${won(g.away).trim()}">${ranked(g.away)}</span> ${g.neutral ? 'vs' : '@'} <span class="${won(g.home).trim()}">${ranked(g.home)}</span></span>`
			+ `<span class="sched-out">${state === 'live' ? '<span class="live-indicator-small"></span>' : ''}${esc(out)}</span>`
			+ `<span class="sched-tv" title="${esc(g.tv.join(', '))}">${esc(g.tv.join(' · '))}</span>`
			+ '</div>';
	}).join('');
}

/** One game as a card, from neither side: both clubs, both scores, where and
 *  when, how to watch, and how it stands or ended. `clubHref(name)` gives a
 *  club's page on this site when there is one; `extraHtml` is the sport's
 *  own live detail (baseball's bases and outs), already drawn. */
export function gameCardHtml(g, { clubHref = () => null, timeZone, extraHtml = '' } = {}) {
	const live = g.state === 'in';
	const cls = ['game-item', 'league-card', live ? 'live' : g.final ? 'completed' : 'next'].join(' ');
	const team = (t) => {
		const href = clubHref(t.name);
		const name = href ? `<a href="${esc(href)}">${esc(t.name)}</a>` : esc(t.name);
		const lead = g.state !== 'pre' && t.score != null;
		return `<div class="league-team${g.final && t.winner ? ' league-won' : ''}">`
			+ `<span class="league-name">${t.rank ? `<span class="league-rank">${t.rank}</span> ` : ''}${name}${t.record ? ` <span class="league-record">${esc(t.record)}</span>` : ''}</span>`
			+ (lead ? `<span class="league-score">${esc(t.score)}${t.pens != null ? ` <span class="league-record">(${esc(t.pens)})</span>` : ''}</span>` : '')
			+ '</div>';
	};
	const when = g.state === 'pre'
		? `${dayOf(g.date, timeZone)}, ${timeOf(g.date, timeZone)}`
		: live ? `<span class="live-indicator-small"></span>${esc(g.detail || 'Live')}` : esc(g.detail || 'Final');
	const lines = [
		g.note ? `<div class="game-status">${esc(g.note)}</div>` : '',
		`<div class="game-date">${g.state === 'pre' ? esc(when) : when}</div>`,
		g.venue ? `<div class="league-venue">${esc(g.venue)}${g.city ? ` · ${esc(g.city)}` : ''}</div>` : '',
		g.tv.length && !g.final ? `<div class="game-channel"><span class="game-network">${esc(g.tv.join(' · '))}</span></div>` : '',
	];
	// Starting pitchers or goalies, where ESPN names them before the game.
	if (g.state === 'pre' && (g.away.probable || g.home.probable)) {
		lines.push(`<div class="league-probables">${esc(g.away.probable ?? 'TBD')} vs ${esc(g.home.probable ?? 'TBD')}</div>`);
	}
	if (live && g.situation) {
		const s = g.situation;
		const said = [s.downDistanceText, s.possessionText].filter(Boolean).join(' · ');
		if (said) lines.push(`<div class="game-status">${esc(said)}</div>`);
		if (s.lastPlay?.text) lines.push(`<div class="last-play">${esc(s.lastPlay.text)}</div>`);
	}
	return `<div class="${cls}" data-event-id="${esc(g.id)}">`
		+ `<div class="league-teams">${team(g.away)}${team(g.home)}</div>`
		+ `<div class="game-details">${lines.filter(Boolean).join('')}${extraHtml}</div>`
		+ lineScoreHtml(g)
		+ (g.final && g.leaders.length ? `<div class="league-leaders">${g.leaders.slice(0, 3).map((l) => `<div><span class="league-record">${esc(l.label)}</span> ${esc(l.who)} <span class="league-record">${esc(l.value)}</span></div>`).join('')}</div>` : '')
		+ (g.espn ? `<div class="league-links"><a href="${esc(g.espn)}" target="_blank" rel="noopener noreferrer">This game on ESPN</a></div>` : '')
		+ '</div>';
}

/** The score by period, once there is one: innings, quarters, periods or
 *  halves, and baseball's hits and errors where ESPN gives them. */
export function lineScoreHtml(g) {
	const n = Math.max(g.away.lines.length, g.home.lines.length);
	if (!n || g.state === 'pre') return '';
	const heads = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('');
	const he = g.away.hits != null && g.home.hits != null;
	const row = (t) => `<tr><th scope="row">${esc(t.abbr)}</th>${Array.from({ length: n }, (_, i) => `<td>${esc(t.lines[i] ?? '')}</td>`).join('')}`
		+ `<td class="league-total">${esc(t.score ?? '')}</td>${he ? `<td>${esc(t.hits)}</td><td>${esc(t.errors ?? '')}</td>` : ''}</tr>`;
	return `<table class="league-linescore"><thead><tr><th></th>${heads}<th>${he ? 'R' : 'T'}</th>${he ? '<th>H</th><th>E</th>' : ''}</tr></thead>`
		+ `<tbody>${row(g.away)}${row(g.home)}</tbody></table>`;
}

/** How long until the period is worth fetching again: 20 seconds while a
 *  game is on, a minute while one is past its start and not begun, five
 *  minutes while any is still to play, and not at all once all are over. */
export function refreshMs(games, now = Date.now()) {
	if (games.some((g) => g.state === 'in')) return 20 * 1000;
	const ahead = games.filter((g) => g.state === 'pre' && !g.postponed).map((g) => Date.parse(g.date));
	if (ahead.some((t) => t <= now)) return 60 * 1000;
	if (ahead.length) return Math.max(60 * 1000, Math.min(5 * 60 * 1000, Math.min(...ahead) - now));
	return null;
}

// --- football's postseason ----------------------------------------------------

/** A side's short name with its place in the poll, where it has one. */
const ranked = (t) => `${t.rank ? `<span class="league-rank">${t.rank}</span> ` : ''}${esc(t.short)}`;

/** Football's playoffs as rounds of single games, AFC above NFC, from the
 *  postseason weeks' scoreboards. The bracket the baseball family draws is a
 *  series per matchup (bracket-core.js); a football round is one game, so it
 *  is drawn as the round's games instead. The Pro Bowl's week is not a round. */
export function footballRounds(weeks) {
	return weeks.map(({ label, key = '', events }) => ({
		label, key,
		games: (events ?? []).map(gameOf)
			.filter((g) => !/pro bowl/i.test(`${g.note} ${label}`) && g.away.name && g.home.name)
			.sort((a, b) => conferenceOrder(a) - conferenceOrder(b) || Date.parse(a.date) - Date.parse(b.date)),
	})).filter((r) => r.games.length);
}
const conferenceOrder = (g) => (/AFC/.test(g.note) ? 0 : /NFC/.test(g.note) ? 1 : 2);

export function footballBracketHtml(rounds, { selected = null } = {}) {
	if (!rounds.length) return null;
	const cell = (g) => {
		const t = (s) => `<div class="lb-t${g.final && s.winner ? ' league-won' : ''}"><span>${esc(s.abbr || s.short)}</span><span>${g.state === 'pre' ? '' : esc(s.score ?? '')}</span></div>`;
		return `<button type="button" class="lb-g${g.id === selected ? ' league-row-on' : ''}${g.state === 'in' ? ' lb-live' : ''}" data-key="${esc(g.id)}" title="${esc(g.note || `${g.away.name} at ${g.home.name}`)}">${t(g.away)}${t(g.home)}</button>`;
	};
	return `<div class="lb">${rounds.map((r) => `<section class="lb-round" data-period="${esc(r.key)}"><div class="lb-head">${esc(r.label)}</div>${r.games.map(cell).join('')}</section>`).join('')}</div>`;
}
