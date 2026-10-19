// The game page's HTML, from the box score lib/espn-box.js builds: the
// score and where it was played, the line score by quarter, the scoring
// plays, the team stats side by side, the drives, and each team's player
// tables. Pure functions over that object, so the tests pin the markup and
// game.js only fetches and redraws.

import { fieldTrackerHtml } from './field-core.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SEASON_TYPE = { 1: 'Preseason', 3: 'Playoffs' };

/** "Sunday, October 11, 2026" from "2026-10-11", without a time zone shift. */
export function longDate(iso) {
	if (!iso) return '';
	const d = new Date(`${iso}T12:00:00`);
	return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** A quarter's name: 1-4, then OT, 2OT for a playoff game that needs it. */
export const quarterName = (n) => (n <= 4 ? String(n) : n === 5 ? 'OT' : `${n - 4}OT`);

/** The page title: "Bears 7, Packers 31" once played, "Bears @ Packers"
 *  before, visitors first as a box score reads. */
export function gameTitle(box) {
	const { away, home } = box;
	return box.state === 'pre'
		? `${away.short} @ ${home.short}`
		: `${away.short} ${away.score}, ${home.short} ${home.score}`;
}

/** The heading block: both teams with scores and records, the status, and
 *  the date, place, crowd and network. */
export function headerHtml(box) {
	const { away, home } = box;
	const played = box.state !== 'pre';
	const teamHtml = (t, s) => `<div class="game-team${box.teamSide === s ? ' game-team-ours' : ''}${box.final && t.winner ? ' game-team-won' : ''}">`
		+ `<div class="game-team-name">${esc(t.name)}${box.live && box.situation?.possession === s ? ' <i class="mdi mdi-football game-ball" aria-label="has the ball" title="Has the ball"></i>' : ''}</div>`
		+ (t.record ? `<div class="game-team-record">${esc(t.record)}</div>` : '')
		+ (played ? `<div class="game-team-score">${esc(t.score)}</div>` : '')
		+ '</div>';
	const when = box.state === 'pre' && box.kickoff
		? new Date(box.kickoff).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
		: longDate(box.date);
	const phase = [SEASON_TYPE[box.seasonType], box.seasonType === 2 && box.week ? `Week ${box.week}` : ''].filter(Boolean).join(' · ');
	const meta = [
		esc(when),
		phase && esc(phase),
		box.venue && esc(box.city ? `${box.venue}, ${box.city}` : box.venue),
		box.attendance && `Att: ${box.attendance.toLocaleString('en-US')}`,
		box.broadcast && esc(box.broadcast),
	].filter(Boolean).join(' · ');
	const day = gameDayLine(box);
	// Before kickoff ESPN's status is the start time in Eastern ("10/18 -
	// 8:20 PM EDT"), which next to the meta line's local time reads as a
	// second, different kickoff. The meta line says it already.
	const status = box.live
		? `<div class="game-status-line game-status-live"><span class="live-indicator-small"></span>${esc(box.status)}</div>`
		: box.state === 'pre' ? '' : `<div class="game-status-line">${esc(box.status)}</div>`;
	return `<div class="game-header">${teamHtml(away, 'away')}<div class="game-at">@</div>${teamHtml(home, 'home')}</div>${status}<div class="game-meta">${meta}</div>`
		+ (day ? `<div class="game-meta game-day">${day}</div>` : '');
}

const ROOF = { outdoors: 'Outdoors', dome: 'Dome', closed: 'Roof closed', open: 'Roof open' };

/** The day as nflverse recorded it: roof, surface, weather, referee. Past
 *  games only; the games CSV has them from 1999. Weather only outdoors,
 *  where nflverse records it. */
export function gameDayLine(box) {
	const d = box.gameDay;
	if (!d) return '';
	const weather = [d.temp && `${d.temp}°F`, d.wind && d.wind !== '0' ? `wind ${d.wind} mph` : ''].filter(Boolean).join(', ');
	return [
		d.roof && esc(ROOF[d.roof] || d.roof),
		d.surface && esc(d.surface.replace(/^./, (c) => c.toUpperCase())),
		weather && esc(weather),
		d.referee && `Referee ${esc(d.referee)}`,
	].filter(Boolean).join(' · ');
}

/** What ESPN's record of a finished game lacks, as a sentence, or ''. */
export function missingNote(box) {
	const c = box.coverage;
	if (!c || !box.final) return '';
	const missing = [!c.quarters && 'the score by quarter', !c.scoring && 'every scoring play', !c.drives && 'the drives'].filter(Boolean);
	if (!missing.length) return '';
	const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} or ${missing.at(-1)}`;
	return `<p class="game-missing">ESPN's record of this game does not have ${list}.</p>`;
}

/** Which sections came from nflverse's play-by-play, where ESPN's record
 *  lacked them, as a sentence crediting it (CC BY 4.0 asks for that), or ''. */
export function filledNote(box) {
	const names = { quarters: 'the score by quarter', scoring: 'the scoring plays', drives: 'the drives' };
	const parts = (box.filled || []).map((p) => names[p]).filter(Boolean);
	if (!parts.length) return '';
	const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
	const cap = list[0].toUpperCase() + list.slice(1);
	return `<p class="game-missing">${cap} from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer">nflverse</a> play-by-play (CC BY 4.0), where ESPN's record of this game lacks ${parts.length === 1 ? 'it' : 'them'}.</p>`;
}

/** Down and distance, who has the ball and the last play, for a game in
 *  progress. Empty otherwise. */
export function situationHtml(box) {
	const s = box.situation;
	if (!s) return '';
	const ball = s.possession ? box[s.possession].short : '';
	const lines = [
		ball && `<div class="game-sit-ball"><i class="mdi mdi-football" aria-hidden="true"></i> ${esc(ball)} ball${s.downDistance ? ` · ${esc(s.downDistance)}` : ''}</div>`,
		s.lastPlay && `<div class="game-sit-play">${esc(s.lastPlay)}</div>`,
	].filter(Boolean);
	return lines.length ? `<div class="game-situation">${lines.join('')}</div>` : '';
}

/** The score by quarter, with OT columns only when there was overtime: the
 *  table alone, for the page's section and the schedule's summary. */
function lineScoreTable(box) {
	const { away, home } = box;
	const n = Math.max(4, away.quarters.length, home.quarters.length);
	if (!away.quarters.length && !home.quarters.length) return '';
	const head = Array.from({ length: n }, (_, i) => `<th>${quarterName(i + 1)}</th>`).join('');
	const row = (t, s) => `<tr${box.teamSide === s ? ' class="game-row-ours"' : ''}><th scope="row">${esc(t.abbr)}</th>`
		+ Array.from({ length: n }, (_, i) => `<td>${esc(t.quarters[i] ?? '')}</td>`).join('')
		+ `<td class="game-total">${esc(t.score)}</td></tr>`;
	return `<div class="game-table-wrap"><table class="game-table game-linescore"><thead><tr><th></th>${head}<th>T</th></tr></thead><tbody>${row(away, 'away')}${row(home, 'home')}</tbody></table></div>`;
}

export function lineScoreHtml(box) {
	const table = lineScoreTable(box);
	return table ? section('Score by Quarter', table) : '';
}

/** Every score in order, under its quarter, with the running score. */
export function scoringHtml(box) {
	const list = scoringList(box);
	return list ? section('Scoring', list) : '';
}

function scoringList(box) {
	if (!box.scoring.length) return '';
	let q = null;
	const out = [];
	for (const p of box.scoring) {
		if (p.quarter !== q) {
			q = p.quarter;
			out.push(`<div class="game-quarter">${q <= 4 ? `${ordinal(q)} Quarter` : esc(quarterName(q))}</div>`);
		}
		const team = p.side ? box[p.side] : null;
		out.push(`<div class="game-score-play${p.side === box.teamSide ? ' game-row-ours' : ''}">`
			+ `<span class="game-sp-team">${esc(team?.abbr || '')}</span>`
			+ `<span class="game-sp-type">${esc(p.type)}</span>`
			+ `<span class="game-sp-text">${esc(p.text)}<span class="game-sp-clock">${esc(p.clock)}</span></span>`
			+ `<span class="game-sp-score">${esc(p.away)}–${esc(p.home)}</span>`
			+ '</div>');
	}
	return out.join('');
}

// The leaders a summary names: each side's top passer, rusher and receiver,
// by yards. Football's counterpart to a baseball summary's winning and
// losing pitchers.
const LEADER_CATS = [['passing', 'Passing'], ['rushing', 'Rushing'], ['receiving', 'Receiving']];

/** One side's leaders as [{ title, name, line }], where line is the
 *  category's first few stats as ESPN labels them ("25/31, 367 YDS, 2 TD"). */
export function leadersOf(box, side) {
	const out = [];
	for (const [key, title] of LEADER_CATS) {
		const c = box.players[side].find((p) => p.key === key);
		const yds = c?.labels.indexOf('YDS') ?? -1;
		if (!c?.rows.length || yds < 0) continue;
		const top = c.rows.reduce((a, b) => (Number(b.stats[yds]) > Number(a.stats[yds]) ? b : a));
		const pick = (label) => {
			const i = c.labels.indexOf(label);
			return i < 0 ? null : top.stats[i];
		};
		const parts = key === 'passing'
			? [pick('C/ATT'), `${pick('YDS')} YDS`, `${pick('TD')} TD`, Number(pick('INT')) ? `${pick('INT')} INT` : null]
			: key === 'rushing'
				? [`${pick('CAR')} CAR`, `${pick('YDS')} YDS`, Number(pick('TD')) ? `${pick('TD')} TD` : null]
				: [`${pick('REC')} REC`, `${pick('YDS')} YDS`, Number(pick('TD')) ? `${pick('TD')} TD` : null];
		out.push({ title, name: top.name, line: parts.filter((p) => p != null && !/^(null|undefined) /.test(p)).join(', ') });
	}
	return out;
}

/**
 * The schedule's pop-up summary of a game: its status, where and when, the
 * crowd and network, the score by quarter, each side's leaders, every
 * scoring play, and the way to the full box score. What the Brewers site's
 * line-score pop-up is, for football.
 */
export function gameSummaryHtml(box) {
	const meta = [
		esc(longDate(box.date)),
		box.venue && esc(box.city ? `${box.venue}, ${box.city}` : box.venue),
		box.attendance && `Att: ${box.attendance.toLocaleString('en-US')}`,
		box.broadcast && esc(box.broadcast),
	].filter(Boolean).join(' · ');
	const status = box.live
		? `<div class="game-status-line game-status-live"><span class="live-indicator-small"></span>${esc(box.status)}</div>`
		: `<div class="game-status-line">${esc(box.status)}</div>`;
	const order = box.teamSide === 'away' ? ['away', 'home'] : ['home', 'away'];
	const leaders = order.map((s) => {
		const ls = leadersOf(box, s);
		if (!ls.length) return '';
		return `<div class="summary-leaders${s === box.teamSide ? ' summary-leaders-ours' : ''}"><div class="summary-leaders-team">${esc(box[s].short)}</div>`
			+ ls.map((l) => `<div class="summary-leader"><span class="summary-leader-cat">${esc(l.title)}</span><span class="summary-leader-name">${esc(l.name)}</span><span class="summary-leader-line">${esc(l.line)}</span></div>`).join('')
			+ '</div>';
	}).join('');
	const scoring = has(box, 'scoring') ? scoringList(box) : '';
	const day = gameDayLine(box);
	return `${status}<div class="game-meta">${meta}</div>`
		+ (day ? `<div class="game-meta game-day">${day}</div>` : '')
		+ (box.drive ? fieldTrackerHtml(box) : situationHtml(box))
		+ missingNote(box)
		+ filledNote(box)
		+ (has(box, 'quarters') ? lineScoreTable(box) : '')
		+ (leaders ? `<div class="summary-leaders-wrap">${leaders}</div>` : '')
		+ (scoring ? `<h3 class="game-section-title">Scoring</h3>${scoring}` : '')
		+ `<div class="summary-links"><a class="summary-box-link" href="game/${esc(box.id)}">Full Box Score <i class="mdi mdi-arrow-right" aria-hidden="true"></i></a>`
		+ `<a class="summary-espn-link" href="https://www.espn.com/nfl/game/_/gameId/${esc(box.id)}" target="_blank" rel="noopener noreferrer">ESPN <i class="mdi mdi-open-in-new" aria-hidden="true"></i></a></div>`;
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n] || 'th'}`;

/** The team stats, one row each, the two sides either side of the label. */
export function teamStatsHtml(box) {
	if (!box.teamStats.length) return '';
	const { away, home } = box;
	const rows = box.teamStats.map((s) => `<tr><td>${esc(s.away)}</td><th scope="row">${esc(s.label)}</th><td>${esc(s.home)}</td></tr>`).join('');
	return section('Team Stats', `<div class="game-table-wrap"><table class="game-table game-teamstats"><thead><tr><th>${esc(away.abbr)}</th><th></th><th>${esc(home.abbr)}</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

/** Each possession: who, when it started, how far it went and how it ended. */
export function drivesHtml(box) {
	if (!box.drives.length) return '';
	const rows = box.drives.map((d) => `<tr class="${[d.side === box.teamSide ? 'game-row-ours' : '', d.score ? 'game-drive-score' : ''].filter(Boolean).join(' ')}">`
		+ `<td>${esc(d.side ? box[d.side].abbr : '')}</td>`
		+ `<td>${esc(d.quarter ? quarterName(d.quarter) : '')} ${esc(d.start)}</td>`
		+ `<td>${esc(d.from)}</td>`
		+ `<td>${esc(d.summary)}</td>`
		+ `<td class="game-drive-result">${esc(d.result)}</td></tr>`).join('');
	return section('Drives', `<div class="game-table-wrap"><table class="game-table game-drives"><thead><tr><th>Team</th><th>Start</th><th>From</th><th>Drive</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

/** One team's player tables, one per category, as ESPN labels them: the
 *  body of that team's tab. */
export function playersHtml(box, side) {
	const cats = box.players[side];
	if (!cats.length) return '';
	return cats.map((c) => {
		const head = `<tr><th class="game-player-col">${esc(c.title)}</th>${c.labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr>`;
		const rows = c.rows.map((r) => `<tr><th scope="row" class="game-player-col">${esc(r.name)}</th>${c.labels.map((_, i) => `<td>${esc(r.stats[i] ?? '')}</td>`).join('')}</tr>`).join('');
		const totals = c.totals && c.rows.length > 1
			? `<tr class="game-total-row"><th scope="row" class="game-player-col">Team</th>${c.labels.map((_, i) => `<td>${esc(c.totals[i] ?? '')}</td>`).join('')}</tr>`
			: '';
		return `<div class="game-table-wrap"><table class="game-table game-players"><thead>${head}</thead><tbody>${rows}${totals}</tbody></table></div>`;
	}).join('');
}

/**
 * The player stats as two team tabs, as the Brewers box score page has
 * them: away on the left, home on the right, as the line score reads. The
 * open one is `selected` ('away' or 'home'), else ours. Both panels are in
 * the page and a tab only hides the other, so switching needs no redraw.
 */
export function teamTabsHtml(box, selected = null) {
	const sides = ['away', 'home'].filter((s) => box.players[s].length);
	if (!sides.length) return '';
	const open = sides.includes(selected) ? selected : sides.includes(box.teamSide) ? box.teamSide : sides[0];
	const tabs = sides.map((s) => `<button type="button" class="game-teamtab${s === open ? ' active' : ''}${s === box.teamSide ? ' game-teamtab-ours' : ''}" role="tab" id="game-tab-${s}" aria-controls="game-panel-${s}" aria-selected="${s === open}" data-side="${s}">${esc(box[s].name)}</button>`).join('');
	const panels = sides.map((s) => `<div class="game-teampanel" role="tabpanel" id="game-panel-${s}" aria-labelledby="game-tab-${s}" data-side="${s}"${s === open ? '' : ' hidden'}>${playersHtml(box, s)}</div>`).join('');
	return section('Player Stats', `<div class="game-teamtabs" role="tablist">${tabs}</div>${panels}`);
}

function section(title, body) {
	return `<section class="game-section"><h3 class="game-section-title">${esc(title)}</h3>${body}</section>`;
}

/** The whole page body. `selected` is the team tab the reader picked. */
export function gamePageHtml(box, selected = null) {
	return headerHtml(box)
		// A game in progress: the field with the drive under way, or, with no
		// drive to draw, the plain situation line.
		+ (box.drive ? section('Live', fieldTrackerHtml(box)) : situationHtml(box))
		// A finished game's section that ESPN has only part of is left out,
		// with a line saying so, rather than drawn as if it were the game.
		+ missingNote(box)
		+ filledNote(box)
		+ (has(box, 'quarters') ? lineScoreHtml(box) : '')
		+ (has(box, 'scoring') ? scoringHtml(box) : '')
		+ teamStatsHtml(box)
		+ teamTabsHtml(box, selected)
		+ (has(box, 'drives') ? drivesHtml(box) : '');
}

const has = (box, part) => !box.coverage || box.coverage[part];
