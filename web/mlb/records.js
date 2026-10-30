// Records & Superlatives page: computes superlatives from the games CSV
// (records-core.js, shared with the server) and renders one shareable card each.
//
// IN are-they-sports: the Brewers site's page, made any club's. The cards are
// the ones the sport publishes (SITE.records), and the box-score ones only
// where there are box scores — there are none here yet, and a card saying
// "The Brewers have never thrown a no-hitter" because no box score was loaded
// would be a false sentence, not an empty one. Every game links to its season.
import { parseGameinfoCsv, computeSuperlatives, computeTeamstatsRecords, recordsCopy, formatDate, formatEra, RECORD_SLUGS, BOX_SCORE_RECORDS, esc } from './records-core.js';
import { METRICS } from './history-chart.js';
import { shareButtonsHtml, labeledShareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';
import { SITE } from './site.js';

const seasonName = (season) => (SITE.seasonLabel ? SITE.seasonLabel(season) : String(season));
const pageUrl = (path) => new URL(path, document.baseURI).href;
// Hockey and soccer rank by points, and their percentage is a points one.
const pctWord = METRICS.winPct.label === 'Points %' ? 'points percentage' : 'winning percentage';
const T = SITE.team;

const yearLink = (yr) => `<a href="${yr}">${esc(seasonName(yr))}</a>`;
const gameLink = (season, gid, label) => `<a href="${esc(season)}">${label}</a>`;
const gameFlag = (g) => (g.championship ? ` · ${SITE.championship}` : g.playoff ? ' · Playoffs' : '');
const blowoutEntry = (g) => ({
	main: `${g.pf}–${g.pa}`, sub: `vs ${g.opponent}`,
	detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}`,
});
// No-hitter entry: like a blowout entry, but says who threw it — one pitcher
// is an individual no-hitter, several a combined one.
const noHitterEntry = (g) => {
	const who = g.pitchers?.length
		? `${esc(g.pitchers.join(', '))}${g.pitchers.length > 1 ? ' <span class="record-combined">(combined)</span>' : ''}`
		: '';
	return {
		main: `${g.pf}–${g.pa}`, sub: `vs ${g.opponent}`,
		detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}${who ? ` · ${who}` : ''}`,
	};
};

const teamEraEntry = (s) => ({
	main: formatEra(s.era),
	subHtml: yearLink(s.season),
	detail: `${s.record} · ${s.ip} innings`,
});
const pitcherEraEntry = (s) => ({
	main: formatEra(s.era),
	sub: s.player,
	detailHtml: `${yearLink(s.season)} · ${esc(s.ip)} innings · ${s.gs} starts`,
});
// ".938", and "1.000" for a perfect one, which padding the thousandths
// printed as ".1000".
const pct3 = (p) => p.toFixed(3).replace(/^0/, '');
const seasonEntry = (s) => ({
	main: s.record,
	subHtml: yearLink(s.season),
	detailHtml: `${pct3(s.winPct)} ${pctWord}`,
});

// Card order pairs related records side by side in the two-column grid.
const streakEntries = (list) => (list || []).map((s) => ({
	main: `${s.games} straight`,
	subHtml: s.startSeason === s.endSeason
		? yearLink(s.startSeason)
		: `${yearLink(s.startSeason)}–${yearLink(s.endSeason)}`,
	detailHtml: `${gameLink(s.startSeason, s.startGid, esc(formatDate(s.startDate)))} – ${gameLink(s.endSeason, s.endGid, esc(formatDate(s.endDate)))}`,
}));

/** Whether a season is in a playoff era, and the era's years for its heading. */
const inEra = (season, era) => (era.from == null || season >= era.from) && (era.to == null || season <= era.to);
const eraYears = (era) => (era.from == null ? `to ${seasonName(era.to)}` : era.to == null ? `${seasonName(era.from)} on` : `${seasonName(era.from)}${SITE.seasonLabel ? ' to ' : '–'}${seasonName(era.to)}`);

/** Each finished postseason's record, best first: winning percentage, then
 *  more wins, then the earlier year. A postseason is over when the club was
 *  knocked out or won the title; one still going is left out, as a season
 *  being played is left out of Best Seasons. Every series decided is not
 *  enough: the Brewers' 2026 was 7-1 and "Won LCS" with the World Series
 *  still to play.
 *  `reached` is how it ended: the title, or the last series and its result. */
export function bestPlayoffRuns(appearances = [], top = 5) {
	const over = (a) => {
		const last = a.series.at(-1);
		return Boolean(last) && (last.result === 'Lost' || (last.round === 'W' && last.result === 'Won'));
	};
	return appearances
		.filter(over)
		.map((a) => {
			const w = a.series.reduce((n, s) => n + s.wins, 0);
			const l = a.series.reduce((n, s) => n + s.losses, 0);
			const last = a.series.at(-1);
			const champion = last.round === 'W' && last.result === 'Won';
			return {
				season: a.season, wins: w, losses: l, record: `${w}–${l}`,
				winPct: w + l ? w / (w + l) : 0,
				reached: champion ? `Won the ${SITE.championship}` : `${last.result} ${last.roundLabel}`,
			};
		})
		.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || a.season - b.season)
		.slice(0, top);
}

const CARDS = [
	{
		slug: 'best-seasons', icon: 'mdi-crown', title: 'Best Seasons',
		note: `Highest ${pctWord} among completed regular seasons`,
		entries: (d) => d.bestSeasons.map(seasonEntry),
	},
	{
		slug: 'worst-seasons', icon: 'mdi-emoticon-sad-outline', title: 'Worst Seasons',
		note: `Lowest ${pctWord} among completed regular seasons`,
		entries: (d) => d.worstSeasons.map(seasonEntry),
	},
	{
		slug: 'best-team-era', icon: 'mdi-shield-check-outline', title: 'Best Team ERA',
		note: 'Lowest team ERA among completed regular seasons',
		entries: (d) => (d.bestTeamEra || []).map(teamEraEntry),
	},
	{
		slug: 'worst-team-era', icon: 'mdi-fire-alert', title: 'Worst Team ERA',
		note: 'Highest team ERA among completed regular seasons',
		entries: (d) => (d.worstTeamEra || []).map(teamEraEntry),
	},
	{
		slug: 'best-pitcher-era', icon: 'mdi-account-check-outline', title: 'Best Pitcher ERA',
		note: `Lowest single-season ERA by a ${T} pitcher, one inning per team game to qualify`,
		entries: (d) => (d.bestPitcherEra || []).map(pitcherEraEntry),
	},
	{
		slug: 'worst-pitcher-era', icon: 'mdi-account-alert-outline', title: 'Worst Pitcher ERA',
		note: `Highest single-season ERA by a ${T} pitcher, one inning per team game to qualify`,
		entries: (d) => (d.worstPitcherEra || []).map(pitcherEraEntry),
	},
	{
		slug: 'best-starts', icon: 'mdi-rocket-launch-outline', title: 'Best Season Starts',
		note: 'Wins to open a season',
		entries: (d) => d.bestStarts.map((b) => ({ main: `${b.games}–0`, subHtml: yearLink(b.season) })),
	},
	{
		slug: 'worst-starts', icon: 'mdi-trending-down', title: 'Worst Season Starts',
		note: 'Losses to open a season',
		entries: (d) => d.worstStarts.map((w) => ({ main: `0–${w.games}`, subHtml: yearLink(w.season) })),
	},
	{
		slug: 'win-streaks', icon: 'mdi-fire', title: 'Longest Win Streaks',
		note: 'Consecutive regular-season wins (ties end a streak)',
		entries: (d) => streakEntries(d.winStreaks),
	},
	{
		slug: 'losing-streaks', icon: 'mdi-snowflake', title: 'Longest Losing Streaks',
		note: 'Consecutive regular-season losses (ties end a streak)',
		entries: (d) => streakEntries(d.loseStreaks),
		empty: SITE.copy.noLosingStreak,
	},
	{
		slug: 'lopsided-wins', icon: 'mdi-scoreboard-outline', title: 'Most Lopsided Wins',
		note: 'Biggest margins of victory, playoffs included',
		entries: (d) => d.lopsidedWins.map(blowoutEntry),
	},
	{
		slug: 'worst-losses', icon: 'mdi-thumb-down-outline', title: 'Worst Losses',
		note: 'Biggest margins of defeat, playoffs included',
		entries: (d) => d.lopsidedLosses.map(blowoutEntry),
	},
	{
		slug: 'no-hitters', icon: 'mdi-baseball', title: 'No-Hitters',
		note: 'Every no-hitter in franchise history, individual and combined, most recent first',
		highlightTop: false,
		entries: (d) => d.noHitters.map(noHitterEntry),
		empty: SITE.copy.noNoHitter,
	},
	{
		slug: 'perfect-games', icon: 'mdi-baseball-diamond', title: 'Perfect Games',
		note: 'Every perfect game in franchise history, most recent first',
		highlightTop: false,
		entries: (d) => d.perfectGames.map(noHitterEntry),
		empty: SITE.copy.noPerfectGame,
	},
	{
		slug: 'most-hr-game', icon: 'mdi-baseball-bat', title: 'Most Home Runs in a Game (Team)',
		note: `Most home runs hit by the ${T} in a single game (ties included)`,
		entries: (d) => (d.mostTeamHrGames || []).map((g) => ({
			main: `${g.hr} HR`,
			sub: `vs ${g.opponent} (${g.pf}–${g.pa})`,
			detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}`,
		})),
	},
	{
		slug: 'player-hr-game', icon: 'mdi-account-star-outline', title: 'Most Home Runs in a Game (Player)',
		note: `Every three-homer game by a ${T} player, best first`,
		highlightTop: false,
		entries: (d) => (d.playerHrGames || []).map((g) => ({
			main: `${g.hr} HR`,
			sub: `${g.player} vs ${g.opponent}`,
			detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))} · ${g.rbi} RBI`,
		})),
	},
	{
		slug: 'player-rbi-game', icon: 'mdi-counter', title: 'Most RBIs in a Game (Player)',
		note: `Best single-game RBI totals by a ${T} player (ties included)`,
		entries: (d) => (d.playerRbiGames || []).map((g) => ({
			main: `${g.rbi} RBI`,
			sub: `${g.player} vs ${g.opponent}`,
			detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))} · ${g.h} H, ${g.hr} HR`,
		})),
	},
	{
		slug: 'cycles', icon: 'mdi-sync-circle', title: 'Cycles',
		note: `Every ${T} player to hit for the cycle, most recent first`,
		highlightTop: false,
		entries: (d) => (d.cycles || []).map((c) => ({
			main: c.player,
			sub: `vs ${c.opponent}`,
			detailHtml: `${gameLink(c.season, c.gid, esc(formatDate(c.date)))}${esc(gameFlag(c))} · ${c.h}-for-${c.ab}`,
		})),
	},
	{
		slug: 'playoff-appearances', icon: 'mdi-medal-outline', title: 'Playoff Appearances',
		note: `${T} postseason series results by year`,
		highlightTop: false,
		entries: (d) => d.playoffAppearances.map((p) => ({
			main: seasonName(p.season),
			subHtml: p.series.map((s) => gameLink(s.season, s.firstGid, `${esc(s.result)} ${esc(s.roundLabel)} vs ${esc(s.opponent)} (${esc(s.record)})`)).join('<br>'),
		})),
		empty: SITE.copy.noPlayoffs,
	},
	{
		slug: 'best-playoff-runs', icon: 'mdi-chart-line-variant', title: 'Best Playoff Runs',
		note: `${T} postseasons by winning percentage, then wins${SITE.playoffEras ? ', in each era' : ''}`,
		// One list a playoff era where the sport has them (SITE.playoffEras),
		// one list where it does not.
		groups: (d) => (SITE.playoffEras ?? [{}]).map((era) => ({
			label: era.label ? `${era.label} · ${eraYears(era)}` : null,
			entries: bestPlayoffRuns(d.playoffAppearances.filter((a) => inEra(a.season, era))).map((r) => ({
				main: r.record,
				subHtml: yearLink(r.season),
				detailHtml: `${pct3(r.winPct)} · ${esc(r.reached)}`,
			})),
		})),
		empty: SITE.copy.noPlayoffs,
	},
	{
		slug: 'world-series-appearances', icon: 'mdi-trophy-outline', title: `${SITE.championship} Appearances`,
		note: `${T} ${SITE.championship} results by year`,
		highlightTop: false,
		entries: (d) => d.championshipAppearances.map((p) => ({
			main: seasonName(p.season),
			subHtml: gameLink(p.season, p.firstGid, `${esc(p.result)} vs ${esc(p.opponent)} (${esc(p.record)})`),
		})),
		empty: SITE.copy.noWorldSeries,
	},
	{
		slug: 'player-error-game', icon: 'mdi-alert-circle-outline', title: 'Most Errors in a Game (Player)',
		note: `Most errors charged to a ${T} player in a single game (ties included)`,
		entries: (d) => (d.playerErrorGames || []).map((g) => ({
			main: `${g.e} E`,
			sub: `${g.player} (${g.pos}) vs ${g.opponent}`,
			detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}`,
		})),
	},
	{
		slug: 'team-error-game', icon: 'mdi-alert-octagon-outline', title: 'Most Errors in a Game (Team)',
		note: `Most errors committed by the ${T} in a single game (ties included)`,
		entries: (d) => (d.mostTeamErrorGames || []).map((g) => ({
			main: `${g.e} E`,
			sub: `vs ${g.opponent} (${g.pf}–${g.pa})`,
			detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}`,
		})),
	},
	{
		slug: 'triple-plays', icon: 'mdi-numeric-3-circle-outline', title: 'Triple Plays',
		note: `Every triple play the ${T} have turned, most recent first`,
		highlightTop: false,
		entries: (d) => (d.triplePlays || []).map((g) => {
			const who = g.fielders?.length
				? ` · ${esc(g.fielders.map((f) => `${f.name} (${f.pos})`).join(', '))}`
				: '';
			return {
				main: g.count > 1 ? `${g.count} in one game` : `vs ${g.opponent}`,
				sub: g.count > 1 ? `vs ${g.opponent}` : `${g.pf}–${g.pa}`,
				detailHtml: `${gameLink(g.season, g.gid, esc(formatDate(g.date)))}${esc(gameFlag(g))}${who}`,
			};
		}),
		empty: SITE.copy.noTriplePlay,
	},
	{
		slug: 'ties', icon: 'mdi-equal', title: 'Ties',
		note: 'Every tie in franchise history, most recent first',
		highlightTop: false,
		entries: (d) => d.ties.map(blowoutEntry),
		empty: SITE.copy.noTies,
	},
];

function entryHtml(e, i, highlightTop) {
	const sub = e.subHtml ?? esc(e.sub);
	const detail = e.detailHtml ?? (e.detail ? esc(e.detail) : '');
	return `<li class="record-entry${highlightTop && i === 0 ? ' record-entry-top' : ''}">
		<span class="record-entry-main">${esc(e.main)}</span>
		<span class="record-entry-sub">${sub}</span>
		${detail ? `<span class="record-entry-detail">${detail}</span>` : ''}
	</li>`;
}

function shareRowHtml(slug) {
	return `<div class="record-share" data-slug="${slug}">${shareButtonsHtml('share-btn record-share-btn')}</div>`;
}

function listHtml(card, entries) {
	return `<ol class="record-list">${entries.map((e, i) => entryHtml(e, i, card.highlightTop !== false)).join('')}</ol>`;
}

function cardHtml(card, data) {
	// A card of several lists (Best Playoff Runs, by era) has a heading over
	// each; an era the club has nothing in is left out.
	const groups = card.groups ? card.groups(data).filter((g) => g.entries.length) : null;
	const entries = groups ? groups.flatMap((g) => g.entries) : card.entries(data);
	const body = !entries.length
		? `<p class="record-empty">${esc(card.empty || 'Nothing here yet.')}</p>`
		: groups
			? groups.map((g) => `${g.label ? `<h3 class="record-group-title">${esc(g.label)}</h3>` : ''}${listHtml(card, g.entries)}`).join('')
			: listHtml(card, entries);
	return `<section class="record-card" id="card-${card.slug}">
		<h2 class="record-card-title"><i class="mdi ${card.icon}"></i> ${esc(card.title)}</h2>
		<p class="record-note">${esc(card.note)}</p>
		${body}
		${shareRowHtml(card.slug)}
	</section>`;
}

function wireShares(grid, data) {
	grid.querySelectorAll('.record-share').forEach((row) => {
		const slug = row.dataset.slug;
		wireShareRow(row, recordsCopy(slug, data).desc, pageUrl(`records/${slug}`));
	});
}

function requestedSlug(cards) {
	const m = window.location.pathname.match(/\/records\/([a-z-]+)\/?$/);
	const slug = m ? m[1] : new URLSearchParams(window.location.search).get('card');
	return cards.some((c) => c.slug === slug) ? slug : null;
}

async function init() {
	const grid = document.getElementById('records-grid');
	try {
		const [gamesRes, namesRes, curGamesRes] = await Promise.all([
			fetch('data/gameinfo.csv'),
			fetch('data/CurrentNames.csv'),
			fetch('api/current/gameinfo.csv').catch(() => null),
		]);
		if (!gamesRes.ok || !namesRes.ok) throw new Error('CSV fetch failed');
		// The season being played, appended so streaks, starts, margins and the
		// postseason count it.
		const curGames = curGamesRes?.ok ? (await curGamesRes.text()).trim() : '';
		const gamesText = (await gamesRes.text()).trimEnd() + (curGames ? '\n' + curGames : '');
		const rows = parseGameinfoCsv(gamesText, await namesRes.text());
		const data = { ...computeSuperlatives(rows), ...computeTeamstatsRecords(rows, '') };
		// The sport's cards, less the box-score ones while there are no box scores.
		const cards = CARDS.filter((c) => RECORD_SLUGS.includes(c.slug)
			&& !(BOX_SCORE_RECORDS.has(c.slug) && !data.boxSeasonRange));
		const { first, last } = data.seasonRange;
		document.getElementById('records-subtitle').textContent =
			`${SITE.fullName} · ${first === last ? seasonName(first) : `${seasonName(first)}${SITE.seasonLabel ? ' to ' : '–'}${seasonName(last)}`}`;
		grid.innerHTML = cards.map((c) => cardHtml(c, data)).join('');
		wireShares(grid, data);

		const footerShare = document.getElementById('records-share');
		footerShare.innerHTML = labeledShareButtonsHtml('footer-share-item');
		wireShareRow(footerShare, recordsCopy('overview', data).desc, pageUrl('records'));
		wireShareDropdown();

		const slug = requestedSlug(cards);
		if (slug) {
			document.title = recordsCopy(slug, data).title;
			const card = document.getElementById(`card-${slug}`);
			if (card) {
				card.classList.add('record-card-focus');
				card.scrollIntoView({ block: 'center' });
			}
		}
	} catch (e) {
		grid.innerHTML = '<p class="record-empty">Could not load the game data. Try again later.</p>';
		console.error(e);
	}
}

init();
