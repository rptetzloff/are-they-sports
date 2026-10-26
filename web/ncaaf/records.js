// Records & Superlatives page: computes superlatives from the games CSV
// (records-core.js, shared with the server) and renders one shareable card each.
//
// IN are-they-sports: the Packers site's page, made any club's. Its words
// come from SITE, and its paths are relative, against the <base> the server
// writes (lib/web.js shell), so it works under a club's root as well as at /.
import { SITE } from './site.js';
import { computeSuperlatives, recordsCopy, formatDate, RECORD_SLUGS, esc } from './records-core.js';
import { loadGames } from './games-client.js';
import { shareButtonsHtml, wireShareRow, wireShareDropdown } from './share-core.js';

const pageUrl = (path) => new URL(path, document.baseURI).href;

const yearLink = (yr) => `<a href="${yr}">${yr}</a>`;
const gameFlag = (g) => (g.championship ? ` · ${SITE.championship}` : g.playoff ? ' · Postseason' : '');
// Blowout entries link the date to the game's season page (a January playoff
// game belongs to the prior year's season, so the season, not the date's year).
const blowoutEntry = (g) => ({
	main: `${g.pf}–${g.pa}`, sub: `vs ${g.opponent}`,
	detailHtml: `<a href="${g.season}">${esc(formatDate(g.date))}</a>${esc(gameFlag(g))}`,
});

const CARDS = [
	{
		slug: 'best-starts', icon: 'mdi-rocket-launch-outline', title: 'Best Season Starts',
		note: 'Wins to open a season',
		entries: (d) => d.bestStarts.map((b) => ({ main: `${b.games}–0`, subHtml: yearLink(b.season) })),
	},
	{
		slug: 'perfect-seasons', icon: 'mdi-trophy-outline', title: `${SITE.losslessSeasonNoun} Seasons`,
		note: 'Finished the regular season without a loss',
		entries: (d) => d.perfectSeasons.map((p) => ({ main: p.record, subHtml: yearLink(p.season) })),
		empty: `No ${SITE.losslessSeasonNoun.toLowerCase()} seasons. Yet.`,
	},
	{
		slug: 'win-streaks', icon: 'mdi-fire', title: 'Longest Win Streaks',
		note: 'Consecutive regular-season wins (ties end a streak)',
		entries: (d) => d.winStreaks.map((s) => ({
			main: `${s.games} straight`,
			subHtml: s.startSeason === s.endSeason
				? yearLink(s.startSeason)
				: `${yearLink(s.startSeason)}–${yearLink(s.endSeason)}`,
			detail: `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`,
		})),
	},
	{
		slug: 'worst-starts', icon: 'mdi-trending-down', title: 'Worst Season Starts',
		note: 'Losses to open a season',
		entries: (d) => d.worstStarts.map((w) => ({ main: `0–${w.games}`, subHtml: yearLink(w.season) })),
	},
	{
		slug: 'lopsided-wins', icon: 'mdi-scoreboard-outline', title: 'Most Lopsided Wins',
		note: 'Biggest margins of victory, bowls and playoffs included',
		entries: (d) => d.lopsidedWins.map(blowoutEntry),
	},
	{
		slug: 'worst-losses', icon: 'mdi-thumb-down-outline', title: 'Worst Losses',
		note: 'Biggest margins of defeat, bowls and playoffs included',
		entries: (d) => d.lopsidedLosses.map(blowoutEntry),
	},
	{
		slug: 'best-seasons', icon: 'mdi-star-outline', title: 'Best Seasons',
		note: 'Highest regular-season win percentage',
		entries: (d) => d.bestSeasons.map((b) => ({
			main: b.record, subHtml: yearLink(b.season),
			detail: `${(b.winPct * 100).toFixed(1)}%`,
		})),
	},
	{
		slug: 'worst-seasons', icon: 'mdi-emoticon-sad-outline', title: 'Worst Seasons',
		note: 'Lowest regular-season win percentage',
		entries: (d) => d.worstSeasons.map((w) => ({
			main: w.record, subHtml: yearLink(w.season),
			detail: `${(w.winPct * 100).toFixed(1)}%`,
		})),
	},
	{
		slug: 'losing-streaks', icon: 'mdi-snowflake', title: 'Longest Losing Streaks',
		note: 'Consecutive regular-season losses (ties end a streak)',
		entries: (d) => d.loseStreaks.map((s) => ({
			main: `${s.games} straight`,
			subHtml: s.startSeason === s.endSeason
				? yearLink(s.startSeason)
				: `${yearLink(s.startSeason)}–${yearLink(s.endSeason)}`,
			detail: `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`,
		})),
		empty: SITE.copy.noLosingStreak,
	},
	{
		slug: 'playoff-appearances', icon: 'mdi-tournament', title: 'Postseason Appearances',
		note: 'Seasons that reached the postseason',
		// Newest first and not trimmed to top-N: this is a list of every one,
		// like ties, rather than a ranking.
		entries: (d) => d.playoffAppearances.map((a) => ({
			main: a.record, subHtml: yearLink(a.season),
			detail: a.championship ? `${SITE.championship}${a.won ? ' — won' : ''}` : `${a.games} game${a.games === 1 ? '' : 's'}`,
		})),
		empty: SITE.copy.noPlayoffs,
	},
	{
		slug: 'championship-appearances', icon: 'mdi-trophy', title: `${SITE.championship} Appearances`,
		note: `Seasons that reached the ${SITE.championship}`,
		entries: (d) => d.championshipAppearances.map((c) => ({
			main: c.won ? 'Won' : 'Lost', subHtml: yearLink(c.season),
			detail: c.record,
		})),
		empty: SITE.copy.noChampionship,
	},
	{
		slug: 'ties', icon: 'mdi-equal', title: 'Ties',
		note: 'Every tie in franchise history, most recent first — overtime arrived in 1974',
		entries: (d) => d.ties.map(blowoutEntry),
		empty: SITE.copy.noTies,
	},
];

function entryHtml(e, i) {
	const sub = e.subHtml ?? esc(e.sub);
	const detail = e.detailHtml ?? (e.detail ? esc(e.detail) : '');
	return `<li class="record-entry${i === 0 ? ' record-entry-top' : ''}">
		<span class="record-entry-main">${esc(e.main)}</span>
		<span class="record-entry-sub">${sub}</span>
		${detail ? `<span class="record-entry-detail">${detail}</span>` : ''}
	</li>`;
}

function shareRowHtml(slug) {
	return `<div class="record-share" data-slug="${slug}">${shareButtonsHtml('share-btn record-share-btn')}</div>`;
}

function cardHtml(card, data) {
	const entries = card.entries(data);
	const body = entries.length
		? `<ol class="record-list">${entries.map(entryHtml).join('')}</ol>`
		: `<p class="record-empty">${esc(card.empty || 'Nothing here yet.')}</p>`;
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

// /records/<slug> deep link (or ?card=<slug> when served statically in dev).
function requestedSlug() {
	const m = window.location.pathname.match(/\/records\/([a-z-]+)\/?$/);
	const slug = m ? m[1] : new URLSearchParams(window.location.search).get('card');
	return RECORD_SLUGS.includes(slug) ? slug : null;
}

async function init() {
	const grid = document.getElementById('records-grid');
	try {
		// The season being played counts, from ESPN (games-client.js).
		const { games } = await loadGames();
		const data = computeSuperlatives(games);
		document.getElementById('records-subtitle').textContent =
			`${SITE.fullName} · ${data.seasonRange.first}–${data.seasonRange.last}`;
		// The manifest decides which cards this deployment publishes, and in
		// what order. CARDS is the catalogue of what can be rendered; SITE.records
		// is the selection — so a sport that has no losing-streak card simply
		// omits the slug rather than the code having to know about it.
		//
		// A slug in the manifest with no card here is a configuration mistake and
		// says so, rather than silently rendering one card fewer.
		const missing = SITE.records.filter((slug) => !CARDS.some((c) => c.slug === slug));
		if (missing.length) console.warn(`records: no card defined for ${missing.join(', ')}`);
		const published = SITE.records
			.map((slug) => CARDS.find((c) => c.slug === slug))
			.filter(Boolean);
		grid.innerHTML = published.map((c) => cardHtml(c, data)).join('');
		wireShares(grid, data);

		// The page's share buttons live in the footer's Share menu.
		const share = document.getElementById('footer-share');
		share.innerHTML = shareButtonsHtml('footer-share-item', { labels: true });
		wireShareRow(share, recordsCopy('overview', data).desc, pageUrl('records'), { labels: true });
		wireShareDropdown();

		const slug = requestedSlug();
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
