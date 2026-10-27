        import { parseGamesCsv, parseGameinfoCsv, parseCurrentNamesCsv, BREWERS_IDS, computeSeasonHistory, parseTeamstatsLineScores, seasonTally, onThisDayCandidates, otdInterest, otdPick, localDate as parseLocalDate, streakBannerHtml, recentFormParts, ROUND_LABEL, lastMeetings, hyphenRecord, esc } from './records-core.js';
        import { computeHeadToHead } from './h2h-core.js';
import { SITE } from './site.js';
        import { buildChartSvg } from './history-chart.js';
        import { liveSituation, isBetweenInnings, situationHtml } from './situation-core.js';
        import { liveDetailHtml, probablesHtml, probableStarters, scoringPlays, scoringPlaysHtml } from './live-core.js';
        import { scheduleListHtml, monthChipsHtml } from './schedule-core.js';
        import { espnPostseasonGames, postseasonPanelHtml, worldSeriesTitle } from './playoff-core.js';
        import { bracketSeries, bracketHtml, opponentTrackerHtml, bracketRefreshMs } from './bracket-core.js';
        import { intentUrls, copyText, flashCopied, wireShareDropdown } from './share-core.js';
        import { parseTvLookup, resolveChannel, tvStatus, primaryBroadcast, providerChannel, formatChannelNum, channelNumberFor, parseSimulcasts, broadcastsWithSimulcasts, dayCT, EMPTY_LOOKUP } from './tv-core.js';

        function buildSeasonMap(games) {
        	const map = {};
        	games.forEach(g => {
        		const yr = parseInt(g.season);
        		if (!map[yr]) map[yr] = [];
        		map[yr].push(g);
        	});
        	return map;
        }

        class BrewersTracker {
        	constructor() {
        		this.apiUrl = `api/espn/apis/site/v2/sports/${SITE.espnLeague}/teams/${SITE.espnSlug}/schedule`;
        		this.countdownInterval = null;
        		this.liveUpdateInterval = null;
        		this.currentSeason = null;
        		this.latestSeason = null;
        		this.earliestSeason = SITE.firstSeason;
        		this.csvBySeason = {};
        		this.csvMaxSeason = 2020;
        		this.seasonRecords = {};
        		this.photosBySeason = {};
        		this.channelMeta = {};
        		this.providerMeta = {};
        		this.providerAliasIndex = new Map();
        		this.tvLookup = EMPTY_LOOKUP;
        		this.selectedProvider = localStorage.getItem('tvProvider') || null;
        		this.lineScores = null;
        		this.init();
        	}

        	// Local simulcast stations for a game's (Central-time) date, from
        	// data/simulcasts.csv.
        	simulcastChannelsFor(game) {
        		if (!this.simulcastsByDate?.size || !game?.date) return [];
        		return this.simulcastsByDate.get(dayCT(game.date)) || [];
        	}

        	// A game's broadcasts plus synthetic TV entries for any local
        	// simulcast stations that day. Use this instead of reading the ESPN
        	// broadcasts array directly. The TV logic itself is tv-core.js,
        	// shared with the server's link previews and the calendar feed.
        	broadcastsFor(game) {
        		return broadcastsWithSimulcasts(game, this.simulcastsByDate);
        	}

        	getTvStatus(game) {
        		if (!game) return 'no';
        		return tvStatus(this.tvLookup, this.broadcastsFor(game));
        	}

        	// The broadcast to show next to the game date: linear TV over
        	// streaming over radio (tv-core's primaryBroadcast).
        	_primaryOf(broadcasts) {
        		return primaryBroadcast(this.tvLookup, broadcasts);
        	}

        	pickPrimaryBroadcast(game) {
        		return this._primaryOf(this.broadcastsFor(game));
        	}

        	// Broadcasts to show on the schedule row: the primary regular
        	// broadcast (e.g. Brewers.TV) plus, on simulcast days, the primary
        	// simulcast station — both are worth a look.
        	scheduleBroadcasts(game) {
        		const all = this.broadcastsFor(game);
        		const regular = all.filter(b => !b._simulcast && b.media?.shortName);
        		const sims = all.filter(b => b._simulcast);
        		const out = [];
        		const prim = this._primaryOf(regular.length ? regular : all);
        		if (prim?.media?.shortName) out.push(prim);
        		const sim = this._primaryOf(sims);
        		if (sim && sim !== prim) out.push(sim);
        		return out;
        	}

        	async init() {
        		try {
        			['playoff-details', 'streak-details', 'otd-details'].forEach(id => {
        				const details = document.getElementById(id);
        				if (!details) return;
        				const stored = localStorage.getItem(`sectionOpen:${id}`);
        				if (stored !== null) details.open = stored === 'true';
        				details.addEventListener('toggle', () => {
        					localStorage.setItem(`sectionOpen:${id}`, details.open ? 'true' : 'false');
        				});
        			});

        			// broadcast_channels.csv was deleted long ago and its fetch 404'd on
        			// every page load; channel_lookup.csv is the channel table now.
        			const [gamesRes, namesRes, photosRes, channelLookupRes, providerLookupRes, teamstatsRes, playersRes, simulcastsRes, curGamesRes] = await Promise.all([
        				fetch('./data/gameinfo.csv'),
        				fetch('./data/CurrentNames.csv'),
        				fetch('./data/photos.csv').catch(() => null),
        				fetch('./data/channel_lookup.csv'),
        				fetch('./data/provider_lookup.csv'),
        				fetch('./data/teamstats.csv'),
        				fetch('./data/biofile0.csv'),
        				fetch('./data/simulcasts.csv').catch(() => null),
        				fetch('api/current/gameinfo.csv').catch(() => null),
        			]);
        			// Local over-the-air simulcast games (hand-maintained; these never
        			// appear in the ESPN/MLB broadcast feeds, only in press releases).
        			this.simulcastsByDate = simulcastsRes?.ok ? parseSimulcasts(await simulcastsRes.text()) : new Map();
        			if (channelLookupRes.ok && providerLookupRes.ok) {
        				this._loadTvLookup(await channelLookupRes.text(), await providerLookupRes.text());
        			}
        			if (gamesRes.ok && namesRes.ok) {
        				const teamstatsText = teamstatsRes?.ok ? await teamstatsRes.text() : null;
        				const namesText = await namesRes.text();
        				const gamesText = await gamesRes.text();
        				const games = parseGameinfoCsv(gamesText, namesText, teamstatsText);
        				this.namesData = parseCurrentNamesCsv(namesText);
        				this.teamNames = this.namesData.teamNames;
        				if (playersRes?.ok) {
        					this.playerNames = new Map(
        						parseGamesCsv(await playersRes.text()).map(p => [p.id, `${p.usename} ${p.lastname}`.trim()])
        					);
        				}
        				this.csvBySeason = buildSeasonMap(games);
        				if (teamstatsText) this.lineScores = parseTeamstatsLineScores(teamstatsText);
        				// Current-season games synthesized from ESPN (data lines matching
        				// the gameinfo header; empty once Retrosheet covers the season).
        				// Merged ONLY into the h2h numbers — csvBySeason and friends must
        				// stay CSV-only so season routing still treats this season as ESPN's.
        				let h2hGames = games;
        				const curGamesText = curGamesRes?.ok ? (await curGamesRes.text()).trim() : '';
        				if (curGamesText) {
        					const header = gamesText.slice(0, gamesText.indexOf('\n'));
        					h2hGames = games.concat(parseGameinfoCsv(`${header}\n${curGamesText}`, namesText, null));
        				}
        				// franchise code -> all-time head-to-head entry, for schedule annotations
        				this.h2hByFranchise = new Map(computeHeadToHead(h2hGames).opponents.map(o => [o.franchise, o]));
        				// Kept for the streak box's "last 10 vs next opponent" line.
        				this.h2hRows = h2hGames;
        				// display name -> franchise code, so ESPN's team.displayName (e.g.
        				// "Chicago Cubs") can resolve to a franchise code for h2h lookup.
        				// Built from every era name so relocated/rebranded franchises match
        				// regardless of which name ESPN uses.
        				this.displayNameToFranchise = new Map();
        				for (const [fran, eras] of Object.entries(this.namesData.franchiseEras)) {
        					for (const era of eras) this.displayNameToFranchise.set(era.display, fran);
        				}
        				this.seasonHistory = computeSeasonHistory(games);
        				this.renderHistorySpark();
        				const seasons = Object.keys(this.csvBySeason).map(Number).sort((a, b) => a - b);
        				if (seasons.length) {
        					this.earliestSeason = seasons[0];
        					this.csvMaxSeason = seasons[seasons.length - 1];
        				}
        				// Build season records from games for undefeated-season lookups
        				games.forEach(g => {
        					const yr = parseInt(g.season);
        					if (!this.seasonRecords[yr]) this.seasonRecords[yr] = { season: yr, reg_w: 0, reg_l: 0, reg_t: 0, post_w: 0, post_l: 0, post_t: 0 };
        					const sr = this.seasonRecords[yr];
        					const res = g['result'];
        					if (g.championship && res === 'WIN') sr.title = true;
        					if (g.regular_season === '1') {
        						if (res === 'WIN') sr.reg_w++; else if (res === 'LOSS') sr.reg_l++; else if (res === 'TIE') sr.reg_t++;
        					} else if (g.playoff === '1') {
        						if (res === 'WIN') sr.post_w++; else if (res === 'LOSS') sr.post_l++; else if (res === 'TIE') sr.post_t++;
        					}
        				});
        			}
        			if (photosRes?.ok) {
        				const raw = await photosRes.text();
        				parseGamesCsv(raw).forEach(p => {
        					const yr = parseInt(p.season);
        					if (!this.photosBySeason[yr]) this.photosBySeason[yr] = [];
        					this.photosBySeason[yr].push(p);
        				});
        			}
        			this.initGallery();
        			this.initWatchModal();
        			this.initProviderModal();
        			this.initLinescoreModal();
        			this.initStandingsModal();
        			this.buildOnThisDay();
        			const params = new URLSearchParams(window.location.search);
        			const seasonParam = params.get('season');
        			const pathMatch = window.location.pathname.match(/\/(\d{4})\/?$/);
        			const requestedSeason = seasonParam
                    ? parseInt(seasonParam, 10)
                    : pathMatch ? parseInt(pathMatch[1], 10) : null;
                    await this.fetchBrewersData(requestedSeason || undefined);
                    this.setupSeasonSelector();
                } catch (error) {
                 this.showError(`Failed to load ${SITE.team} data`);
                 console.error('Error:', error);
             }
         }

         setupSeasonSelector() {
          const prevBtn = document.getElementById('season-prev');
          const nextBtn = document.getElementById('season-next');
          const prev10Btn = document.getElementById('season-prev10');
          const next10Btn = document.getElementById('season-next10');
          const firstBtn = document.getElementById('season-first');
          const lastBtn = document.getElementById('season-last');

          window.addEventListener('popstate', (e) => {
             const season = e.state?.season;
             if (season) this.loadSeason(season, false);
         });

          firstBtn.addEventListener('click', () => {
             if (this.currentSeason !== this.earliestSeason) this.loadSeason(this.earliestSeason);
         });

          lastBtn.addEventListener('click', () => {
             if (this.currentSeason !== this.latestSeason) this.loadSeason(this.latestSeason);
         });

          prev10Btn.addEventListener('click', () => {
             const target = Math.max(this.earliestSeason, this.currentSeason - 10);
             if (target !== this.currentSeason) this.loadSeason(target);
         });

          next10Btn.addEventListener('click', () => {
             const target = Math.min(this.latestSeason, this.currentSeason + 10);
             if (target !== this.currentSeason) this.loadSeason(target);
         });

          prevBtn.addEventListener('click', () => {
             if (this.currentSeason > this.earliestSeason) this.loadSeason(this.currentSeason - 1);
         });

          nextBtn.addEventListener('click', () => {
             if (this.currentSeason < this.latestSeason) this.loadSeason(this.currentSeason + 1);
         });
      }

      updateSiteTitle() {
          const el = document.getElementById('site-title');
          if (!el) return;
          const link = el.querySelector('a');
          if (link) link.textContent = SITE.title;
      }

      // Compact franchise-history sparkline under the answer; the currently
      // viewed season gets a white marker. Links through to /history.
      renderHistorySpark() {
          const el = document.getElementById('history-spark');
          if (!el || !this.seasonHistory?.length) return;
          el.innerHTML = buildChartSvg(this.seasonHistory, {
              width: 600, height: 80,
              axes: false,
              highlight: this.currentSeason,
          });
      }

      updateSeasonSelector() {
          this.updateSiteTitle();
          this.renderHistorySpark();
          this.renderScheduleProviderBar();
          const label = document.getElementById('season-label');
          const prevBtn = document.getElementById('season-prev');
          const nextBtn = document.getElementById('season-next');
          const prev10Btn = document.getElementById('season-prev10');
          const next10Btn = document.getElementById('season-next10');
          const firstBtn = document.getElementById('season-first');
          const lastBtn = document.getElementById('season-last');

          label.textContent = `${SITE.seasonLabel(this.currentSeason)} Season`;
          prevBtn.disabled = this.currentSeason <= this.earliestSeason;
          nextBtn.disabled = this.currentSeason >= this.latestSeason;
          prev10Btn.disabled = this.currentSeason <= this.earliestSeason;
          next10Btn.disabled = this.currentSeason >= this.latestSeason;
          firstBtn.disabled = this.currentSeason <= this.earliestSeason;
          lastBtn.disabled = this.currentSeason >= this.latestSeason;

          const existingBtn = document.getElementById('gallery-open-btn');
          if (existingBtn) existingBtn.remove();
          if (this.photosBySeason[this.currentSeason]?.length) {
             const btn = document.createElement('button');
             btn.id = 'gallery-open-btn';
             btn.className = 'gallery-btn';
             btn.innerHTML = '<i class="mdi mdi-image-multiple"></i> Photos';
             btn.addEventListener('click', () => this.openGallery(this.currentSeason));
             const selector = document.getElementById('season-selector');
             selector.insertAdjacentElement('afterend', btn);
         }
     }

     async loadSeason(year, pushState = true) {
      if (this.liveUpdateInterval) {
         clearInterval(this.liveUpdateInterval);
         this.liveUpdateInterval = null;
     }
     const answerEl = document.getElementById('answer');
     const recordEl = document.getElementById('record');
     const streakEl = document.getElementById('streak-banner');
     answerEl.innerHTML = 'Loading...';
     answerEl.className = 'answer loading';
     recordEl.textContent = '';
     if (streakEl) streakEl.hidden = true;
     document.getElementById('schedule-grid').innerHTML = '<div class="loading">Loading schedule...</div>';

     if (pushState) {
         const url = new URL(`${year}${window.location.search}`, document.baseURI);
         // Relative to <base>, which names the club in a multi-club deployment.
         url.searchParams.delete('season');
         history.pushState({ season: year }, '', url.toString());
     }

     try {
         await this.fetchBrewersData(year);
     } catch (error) {
         this.showError('Failed to load season data');
     }
 }

 usesCsvData(season) {
  return season != null && season <= this.csvMaxSeason && this.csvBySeason[season] != null;
}

// Basketball's season is named by the year it ends, so from August on the
// season to show is next year's.
_defaultSeason() {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

async fetchBrewersData(season) {
  const effectiveSeason = season ?? this._defaultSeason();
  if (this.usesCsvData(effectiveSeason)) {
    this.processCsvSeasonData(effectiveSeason);
    return;
  }

 try {
     const seasonParam = season ? `&season=${season}` : '';
     const [preRes, regularRes, postRes] = await Promise.all([
        fetch(`${this.apiUrl}?seasontype=1${seasonParam}`),
        fetch(`${this.apiUrl}?seasontype=2${seasonParam}`),
        fetch(`${this.apiUrl}?seasontype=3${seasonParam}`),
    ]);
     const [preData, regularData, postData] = await Promise.all([
        preRes.json(),
        regularRes.json(),
        postRes.json(),
    ]);

     const preEvents = (preData.events || []).map(e => ({ ...e, _seasonType: 'pre' }));
     // The NBA Cup final (ESPN's type CC) is in ESPN's regular season and not in the
     // league's standings: it shows on the schedule and counts in no record,
     // as sports/nba.js leaves it out of the load.
     const regularEvents = (regularData.events || []).map(e => ({ ...e, _seasonType: 'regular', _notCounted: e.competitions?.[0]?.type?.abbreviation === 'CC' }));
     const postEvents = (postData.events || []).map(e => ({ ...e, _seasonType: 'post' }));
     const allEvents = [...preEvents, ...regularEvents, ...postEvents];

     const mergedData = { ...regularData, events: allEvents };

        			// If ESPN returns no events and we have CSV data, fall back to CSV
     if (allEvents.length === 0 && this.usesCsvData(effectiveSeason)) {
        this.processCsvSeasonData(effectiveSeason);
        return;
    }

    const liveGame = allEvents.find(event => {
        const status = event.competitions?.[0]?.status?.type?.name;
        return status === 'STATUS_IN_PROGRESS' || status === 'STATUS_HALFTIME' || status === 'STATUS_DELAYED';
    });

    this._lastFullRefresh = Date.now();
    this._liveContext = liveGame ? { liveGame, mergedData } : null;
    if (liveGame) {
        await this.fetchLiveGameScore(liveGame, mergedData);
    } else {
        this.processScheduleData(mergedData);
    }
} catch (error) {
        			// If ESPN fetch fails and we have CSV data for this season, use it
 if (this.usesCsvData(effectiveSeason)) {
    this.processCsvSeasonData(effectiveSeason);
} else {
    this.processScheduleData({ events: [] });
}
}
}

processCsvSeasonData(season) {
  const games = this.csvBySeason[season] || [];

  this.currentSeason = season;
  if (!this.latestSeason) {
        			// Determine latest season from ESPN on first load — but if we're bootstrapping
        			// from a CSV season directly, the current (ESPN-covered) season may be newer
        			// than the CSV data, so allow navigating forward to the calendar year.
     this.latestSeason = Math.max(this.csvMaxSeason || 0, new Date().getFullYear());
 }
 this.updateSeasonSelector();

 document.getElementById('schedule-title').innerHTML = `<i class="mdi mdi-calendar-month"></i> ${SITE.seasonLabel(season)} Season Schedule`;

        		// The tally lives in records-core so it can be tested; this method
        		// renders. Both halves used to be here.
 const { wins, losses, ties, postseason, championshipName, undefeated } = seasonTally(games);

 this.displayResult(undefeated, wins, losses, ties, true, championshipName, postseason, null);
 // A past season's series, all finished: `settled` sizes each one by its
 // winner, because the 1982 ALCS was best of five and 3-2 was a win.
 this.updatePlayoffPanel(games
   .filter(g => g.regular_season !== '1')
   .sort((a, b) => (a.date < b.date ? -1 : 1))
   .map(g => ({ round: ROUND_LABEL[g.gametype] || 'Postseason', opponent: g.Opponent, opponentNick: g.OpponentNick, result: g.result || null })),
   null, { settled: true });
 this.displayCsvSchedule(games, season);
 this.scrollToGameAnchor();
 this.showLastUpdated();
 this.setDataCredit(true);
 this.updateLastUndefeated(wins, losses);
 this.setupShareButtons();

 const csvCompletedGames = games
 .filter(g => g.regular_season === '1' && g['result'])
 .map(g => ({ result: g['result'], date: parseLocalDate(g.date) }));
 this.updateStreakBanner(csvCompletedGames, season !== this.latestSeason);
}

// All-time head-to-head note linking to the opponent's rivalry page.
// Returns null for opponents with no CSV history (shouldn't happen).
h2hNote(franchiseOrName) {
  const fran = this.displayNameToFranchise?.get(franchiseOrName) || franchiseOrName;
  const o = this.h2hByFranchise?.get(fran);
  if (!o) return null;
  const note = document.createElement('a');
  note.className = 'game-h2h';
  // The head-to-head page by name; the server sends a name to its code's
  // address (server.js, the opponent route). The site's `vs.html?vs=` form
  // has no route here.
  note.href = `vs/${o.slug}`;
  note.textContent = `All-time: ${o.record}`;
  note.title = `${SITE.team} vs ${o.name} — all-time head-to-head`;
  return note;
}

// A past season (Retrosheet): every game a compact row (schedule-core.js),
// a click on one opening its line score.
displayCsvSchedule(games, season) {
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  const phaseOf = (g) => {
    if (g.regular_season === '1') return 'regular';
    if (g.playoff !== '1') return 'other';
    // The schedule's postseason headings: the national final, the Final Four,
    // the regionals, the tournament's first weekend, and the rest.
    const gt = (g.gametype || '').toUpperCase();
    return gt === 'W' ? 'ws' : gt === 'F4' || gt === 'THIRD' ? 'lcs' : gt === 'E8' || gt === 'S16' || gt === 'R3RD' ? 'ds'
      : ['R64', 'R32', 'FF', 'NCAA'].includes(gt) ? 'wc' : 'post';
  };
  this._csvByGid = new Map(sorted.map((g) => [g.gid, g]));
  this._eventsById = null;
  const rows = sorted.map((g) => {
    const res = g.result === 'WIN' ? 'win' : g.result === 'LOSS' ? 'loss' : 'tie';
    const clickable = Boolean(g.gid && this.lineScores?.has(g.gid));
    return {
      key: g.gid, anchor: g.gid ? `g-${g.gid}` : '', date: parseLocalDate(g.date),
      // Retrosheet's rows say 'home' / 'away' in lower case; the card this
      // replaced compared against 'AWAY' and showed every road game as "vs".
      home: String(g.location || '').toLowerCase() !== 'away',
      opp: g.OpponentNick || g.Opponent, state: res,
      text: `${res === 'win' ? 'W' : res === 'loss' ? 'L' : 'T'} ${parseInt(g.scoreFor) || 0}-${parseInt(g.scoreAgainst) || 0}`,
      tv: [], phase: phaseOf(g), clickable, title: clickable ? 'Line score' : '',
      // Every Retrosheet game has its box score page; there is no ESPN id
      // for a season Retrosheet covers.
      links: g.gid ? { summary: clickable, box: SITE.gamePages ? `game/${encodeURIComponent(g.gid)}` : null } : null,
    };
  });
  this.renderScheduleList(rows, {
    regular: 'Regular Season', wc: 'NCAA Tournament', ds: 'NCAA Tournament: Regionals', lcs: 'Final Four',
    ws: 'National Championship', post: 'Postseason', other: 'Preseason / Exhibition',
  }, { season, featured: null, scrollTo: null });
}

scrollToGameAnchor() {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#g-')) return;
  const el = document.getElementById(hash.slice(1));
  if (!el) return;
  this.centerInSchedule(el, 'smooth');
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 2500);
}

// Scroll the schedule list so `el` sits in its middle.
centerInSchedule(el, behavior = 'auto') {
  const grid = document.getElementById('schedule-grid');
  const top = el.offsetTop - (grid.clientHeight / 2) + (el.offsetHeight / 2);
  grid.scrollTo({ top: Math.max(0, top), behavior });
}

/**
 * Draw the schedule list: the pinned game (live, else next) above it, a
 * chip a month, and the compact rows. The first time a season is drawn the
 * list scrolls to `scrollTo` (the latest game); a redraw of the same season
 * — the 15-second live refresh — keeps the reader's place.
 */
renderScheduleList(rows, phaseLabels, { season, featured, scrollTo }) {
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  const pinned = document.getElementById('schedule-featured');
  const sameSeason = this._scheduleSeason === season;
  const keep = grid.scrollTop;

  pinned.innerHTML = '';
  if (featured) pinned.appendChild(featured);
  pinned.hidden = !featured;

  grid.innerHTML = rows.length ? scheduleListHtml(rows, phaseLabels) : '<div class="loading">No games scheduled.</div>';
  chips.innerHTML = monthChipsHtml(rows);
  chips.hidden = !chips.innerHTML;
  this.wireSchedule();

  if (sameSeason) {
    grid.scrollTop = keep;
  } else {
    this._scheduleSeason = season;
    const target = scrollTo && grid.querySelector(`.sched-row[data-key="${CSS.escape(String(scrollTo))}"]`);
    if (target) this.centerInSchedule(target);
    else grid.scrollTop = 0;
  }
  this.markActiveMonth();
}

// Clicks on rows and month chips, wired once: the list is redrawn, its
// container is not.
wireSchedule() {
  if (this._scheduleWired) return;
  this._scheduleWired = true;
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  const open = (row) => {
    const key = row.dataset.key;
    const event = this._eventsById?.get(key);
    if (event) {
      const st = event.competitions?.[0]?.status?.type;
      if (st?.state === 'post' || st?.state === 'in') this.openLinescoreFromEvent(event);
      else this.openWatchModal(event);
      return;
    }
    const g = this._csvByGid?.get(key);
    if (g && this.lineScores?.has(g.gid)) this.openLinescoreModal(g);
  };
  // A played game's row carries its own links (summary, box score, ESPN).
  // A click on Box or ESPN follows the link and must not also open the
  // summary behind it; the Summary button opens it like the row does. The
  // row's keyboard handling leaves the links to their own Enter.
  grid.addEventListener('click', (e) => {
    const link = e.target.closest('.sched-link');
    if (link && link.dataset.act !== 'summary') return;
    const row = e.target.closest('.sched-row');
    if (row && (row.classList.contains('sched-click') || link)) open(row);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.target.closest('.sched-link')) return;
    const row = e.target.closest('.sched-row.sched-click');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(row); }
  });
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.sched-chip');
    if (!chip) return;
    // A chip names the group it jumps to: a regular-season month, or the
    // first month of the preseason or a postseason round.
    const group = [...grid.querySelectorAll('.sched-group')].find((g) => g.dataset.group === chip.dataset.group);
    // The phase's divider sits just above its first group; land on it, so
    // "Playoffs" is in view, not scrolled just past.
    const divider = group?.previousElementSibling?.classList.contains('season-divider') ? group.previousElementSibling : null;
    // Remembered for markActiveMonth: a group near the end cannot scroll to
    // the top of the list, so at the bottom the chip clicked is the one lit.
    this._chipTarget = chip.dataset.group;
    if (group) grid.scrollTo({ top: (divider || group).offsetTop, behavior: 'smooth' });
    // Already at the bottom, the list does not move and no scroll event
    // comes: mark the chip now.
    this.markActiveMonth();
  });
  // The reader scrolling the list themselves lets go of a chip's jump (the
  // smooth scroll a chip starts passes "not at the bottom" on its way, so
  // the scroll event itself cannot be what clears it).
  const letGo = () => { this._chipTarget = null; };
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) grid.addEventListener(type, letGo, { passive: true });
  let ticking = false;
  grid.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; this.markActiveMonth(); });
  });
}

// The chip standing for the group at the top of the list — a regular-season
// month, or the preseason or a postseason round.
markActiveMonth() {
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  // The first group that has not scrolled fully past the top of the list —
  // so a phase divider at the top marks the group below it, not the one that
  // just ended. (A group's offsetTop, unlike its sticky heading's, does not
  // move as the list scrolls.)
  let current = null;
  const groups = [...grid.querySelectorAll('.sched-group')];
  for (const group of groups) {
    if (group.offsetTop + group.offsetHeight > grid.scrollTop + 8) { current = group.dataset.group; break; }
  }
  // Scrolled to the bottom, the last groups — a postseason round or two —
  // can never reach the top: the chip clicked to get there is the one lit,
  // or, scrolled there by hand, the season's last group.
  const atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
  if (atBottom && grid.scrollTop > 0) current = this._chipTarget || groups[groups.length - 1]?.dataset.group || current;
  chips.querySelectorAll('.sched-chip').forEach((c) => {
    const on = Boolean(current) && (c.dataset.covers || '').split(' ').includes(current);
    c.classList.toggle('active', on);
  });
}

        	async fetchLiveGameScore(liveGame, scheduleData) {
        		// The server's reduced live detail first: score, base-out state,
        		// pitchers, the at-bat pitch by pitch and the last plays, a few KB
        		// (live-core.js). The scoreboard below is the fallback.
        		try {
        			const res = await fetch(`api/live/${encodeURIComponent(liveGame.id)}`);
        			const detail = res.ok ? await res.json() : null;
        			if (detail && detail.state === 'in') {
        				for (const t of detail.teams) {
        					const c = liveGame.competitions[0].competitors.find(comp => String(comp.team.id) === t.id);
        					if (c && t.score !== null) c.score = { ...(typeof c.score === 'object' ? c.score : {}), value: t.score, displayValue: String(t.score) };
        				}
        				liveGame.situation = liveSituation(detail.situation);
        				liveGame.live = detail;
        				liveGame.lastPlay = null;
        				this.processScheduleData(scheduleData);
        				return;
        			}
        		} catch { /* fall through to the scoreboard */ }
        		try {
        			const gameId = liveGame.id;
        			const scoreboardUrl = `api/espn/apis/site/v2/sports/${SITE.espnLeague}/scoreboard`;
        			const response = await fetch(scoreboardUrl);
        			const scoreboardData = await response.json();

        			const currentGame = scoreboardData.events?.find(event => event.id === gameId);

        			if (currentGame && currentGame.competitions?.[0]?.competitors) {
        				currentGame.competitions[0].competitors.forEach(competitor => {
        					const teamId = competitor.team.id;
        					const score = competitor.score;
        					const scheduleCompetitor = liveGame.competitions[0].competitors.find(comp => comp.team.id === teamId);
        					if (scheduleCompetitor && score) {
        						scheduleCompetitor.score = score;
        					}
        				});

        				if (currentGame.competitions?.[0]?.situation) {
        					const situation = currentGame.competitions[0].situation;
        					liveGame.situation = liveSituation(situation);
        					liveGame.lastPlay = {
        						downDistanceText: situation.downDistanceText,
        						possession: situation.possession,
        						drive: situation.lastPlay?.drive,
        						text: situation.lastPlay?.text
        					};
        				}
        			} else {
        				const boxscoreUrl = `api/espn/apis/site/v2/sports/${SITE.espnLeague}/summary?event=${gameId}`;
        				const boxResponse = await fetch(boxscoreUrl);
        				const boxscoreData = await boxResponse.json();

        				if (boxscoreData.header?.competitions?.[0]?.competitors) {
        					boxscoreData.header.competitions[0].competitors.forEach(competitor => {
        						const teamId = competitor.team.id;
        						const score = competitor.score;
        						const scheduleCompetitor = liveGame.competitions[0].competitors.find(comp => comp.team.id === teamId);
        						if (scheduleCompetitor && score) {
        							scheduleCompetitor.score = score;
        						}
        					});
        				}

        				liveGame.situation = liveSituation(boxscoreData.situation);

        				if (boxscoreData.drives?.current?.plays?.length > 0) {
        					const lastPlay = boxscoreData.drives.current.plays[boxscoreData.drives.current.plays.length - 1];
        					liveGame.lastPlay = {
        						downDistanceText: boxscoreData.situation?.downDistanceText,
        						possession: boxscoreData.situation?.possession,
        						drive: { description: boxscoreData.drives?.current?.description },
        						text: lastPlay.text || lastPlay.description
        					};
        				} else if (boxscoreData.situation) {
        					liveGame.lastPlay = {
        						downDistanceText: boxscoreData.situation.downDistanceText,
        						possession: boxscoreData.situation.possession,
        						drive: boxscoreData.situation.lastPlay?.drive,
        						text: boxscoreData.situation.lastPlay?.text
        					};
        				}
        			}

        			this.processScheduleData(scheduleData);
        		} catch (error) {
        			this.processScheduleData(scheduleData);
        		}
        	}

        	processScheduleData(data) {
        		const events = data.events || [];

        		const seasonData = data.requestedSeason || data.season;
        		const season = seasonData?.year;
        		const seasonType = seasonData?.name;
        		this.updateScheduleTitle(season, seasonType);

        		if (season) {
        			this.currentSeason = season;
        			if (!this.latestSeason) this.latestSeason = season;
        			this.updateSeasonSelector();
        		}

        		const isPastSeason = this.currentSeason && this.latestSeason && this.currentSeason < this.latestSeason;
        		// A title outlasts the offseason: a Series won on Oct 31 would
        		// otherwise give way to "offseason" at midnight, for the winter.
        		const wonTitle = worldSeriesTitle(events.filter(e => e._seasonType === 'post'));
        		if (!isPastSeason && !wonTitle && this.isOffseason(events)) {
        			this.displayOffseasonMessage();
        			this.updatePlayoffPanel([], null);
        			this.displaySchedule(events, true);
        			this.showLastUpdated();
        			this.updateLastUndefeated(0, 0);
        			this.setupShareButtons();
        			const el = document.getElementById('streak-banner');
        			if (el) el.hidden = true;
        			return;
        		}

        		const countRecord = (gameList) => {
        			let w = 0, l = 0, t = 0;
        			gameList.forEach(event => {
        				const competitors = event.competitions[0].competitors;
        				let brewersScore = 0, opponentScore = 0;
        				competitors.forEach(competitor => {
        					if (competitor.team.abbreviation === SITE.espnAbbr) {
        						brewersScore = parseInt(competitor.score.value) || 0;
        					} else {
        						opponentScore = parseInt(competitor.score.value) || 0;
        					}
        				});
        				if (brewersScore > opponentScore) w++;
        				else if (brewersScore < opponentScore) l++;
        				else t++;
        			});
        			return { w, l, t };
        		};

        		const completedPre = events.filter(event => {
        			const status = event.competitions?.[0]?.status?.type?.name;
        			return status === 'STATUS_FINAL' && event._seasonType === 'pre';
        		});

        		const completedRegular = events.filter(event => {
        			const status = event.competitions?.[0]?.status?.type?.name;
        			return status === 'STATUS_FINAL' && event._seasonType === 'regular' && !event._notCounted;
        		});

        		const completedPost = events.filter(event => {
        			const status = event.competitions?.[0]?.status?.type?.name;
        			return status === 'STATUS_FINAL' && event._seasonType === 'post';
        		});

        		const preRecord = countRecord(completedPre);
        		const { w: wins, l: losses, t: ties } = countRecord(completedRegular);
        		const postRecord = countRecord(completedPost);

        		// World Series champions only once the Brewers have won the
        		// series: four wins (playoff-core.js, shared with the server).
        		const worldSeriesName = worldSeriesTitle(completedPost);

        		// Every postseason game, played or not: a series that has not
        		// started still has to show, as 0-0. ESPN names the round in the
        		// game's note ("NLCS - Game 5 If Necessary").
        		const postGames = espnPostseasonGames(events.filter(event => event._seasonType === 'post'));

        		const isUndefeated = losses === 0 && wins > 0;

        		// Determine TV status for today's game (current season only)
        		let tvStatus = null;
        		let tvGame = null;
        		if (!isPastSeason) {
        			const now = new Date();
        			const liveNow = events.find(e => {
        				const s = e.competitions?.[0]?.status?.type?.name;
        				return s === 'STATUS_IN_PROGRESS' || s === 'STATUS_HALFTIME' ||
        					s === 'STATUS_DELAYED' || s === 'STATUS_BREAK' ||
        					s === 'STATUS_TIMEOUT' || s === 'STATUS_END_PERIOD' || s === 'STATUS_RAIN_DELAY';
        			});
        			const nextScheduled = events
        				.filter(e => new Date(e.date) > now && e.competitions?.[0]?.status?.type?.name === 'STATUS_SCHEDULED')
        				.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        			tvGame = liveNow || nextScheduled;
        			// Every club asks the TV question (Ray, 2026-10-21). One without
        			// channel listings answers it from ESPN's word for each broadcast
        			// (tv-core.js tvStatus, with an empty table).
        			tvStatus = this.getTvStatus(tvGame);
        		}

        		this.displayResult(isUndefeated, wins, losses, ties, isPastSeason, worldSeriesName, postRecord, preRecord, tvStatus, tvGame);
        		this.displaySchedule(events, isPastSeason);
        		this.showLastUpdated();
        		this.setDataCredit(false);
        		this.updateLastUndefeated(wins, losses);
        		this.setupShareButtons();

        		// The season being played counts its playoff games too, so the
        		// current streak, last 10 and October carry on into the postseason
        		// instead of stopping at game 162. A past season stays regular-
        		// season only: its sentence is "Finished the regular season
        		// undefeated", which a playoff loss must not change.
        		const streakGames = isPastSeason ? completedRegular : [...completedRegular, ...completedPost];
        		const espnCompletedGames = streakGames.map(event => {
        			const competitors = event.competitions[0].competitors;
        			let brewersScore = 0, opponentScore = 0;
        			competitors.forEach(c => {
        				// ?? not ||: a shutout's score.value is 0, which || would skip,
        				// falling back to the score object itself -> NaN -> phantom 'TIE'.
        				if (c.team.abbreviation === SITE.espnAbbr) brewersScore = parseInt(c.score?.value ?? c.score ?? 0) || 0;
        				else opponentScore = parseInt(c.score?.value ?? c.score ?? 0) || 0;
        			});
        			const result = brewersScore > opponentScore ? 'WIN' : brewersScore < opponentScore ? 'LOSS' : 'TIE';
        			return { result, date: new Date(event.date) };
        		});
        		this.updateStreakBanner(espnCompletedGames, isPastSeason, tvGame);
        		this.updatePlayoffPanel(postGames, isPastSeason ? null : completedRegular.length, { settled: isPastSeason });
        	}

        	updateScheduleTitle(year, seasonType) {
        		const titleEl = document.getElementById('schedule-title');
        		if (!titleEl) return;
        		const yearLabel = year ? `${SITE.seasonLabel(year)} ` : '';
        		const isRegular = !seasonType || seasonType.toLowerCase().includes('regular');
        		const typeLabel = !isRegular ? ` (${seasonType})` : '';
        		titleEl.innerHTML = `<i class="mdi mdi-calendar-month"></i> ${yearLabel}Season Schedule${typeLabel}`;
        	}

        	isOffseason(events) {
        		const now = new Date();
        		// July through September: after the Finals, before training camp.
        		const isOffseasonMonth = now.getMonth() >= 6 && now.getMonth() <= 8;
        		const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        		const hasUpcomingGames = events.some(event => {
        			const gameDate = new Date(event.date);
        			const status = event.competitions?.[0]?.status?.type?.name;
        			return gameDate > now && gameDate <= thirtyDaysFromNow && status === 'STATUS_SCHEDULED';
        		});
        		return isOffseasonMonth && !hasUpcomingGames;
        	}

        	displayOffseasonMessage() {
        		const answerEl = document.getElementById('answer');
        		const recordEl = document.getElementById('record');

        		this._lastResult = null;
        		this._isOffseason = true;
        		answerEl.innerHTML = `OFFSEASON`;
        		answerEl.className = 'answer offseason';
        		document.body.classList.remove('undefeated');
        		document.body.classList.add('offseason');

        		recordEl.textContent = 'The season hasn\'t started yet!';
        	}

        	// "Amherst Communications has the next game on Brewers.TV (Ch. 16)"
        	// under the big YES — only when a provider is selected and today's
        	// game is on TV.
        	_providerNoteHtml() {
        		const { tvStatus, tvGame } = this._lastResult || {};
        		if (tvStatus !== 'yes' || !tvGame) return '';
        		const provider = this.selectedProvider && this.providerMeta[this.selectedProvider];
        		if (!provider) return '';
        		const tvTypes = new Set(['broadcast', 'cable', 'regional']);
        		const b = this._primaryOf(this.broadcastsFor(tvGame).filter(x => {
        			const name = x.media?.shortName;
        			if (!name) return false;
        			const ch = this.resolveChannel(name);
        			return ch ? tvTypes.has(ch.type) : (x.type?.shortName || '').toUpperCase() === 'TV';
        		}));
        		if (!b) return '';
        		const ch = this.resolveChannel(b.media.shortName);
        		const network = ch?.display_name || b.media.shortName;
        		const num = this.scheduleChannelNumber(b);
        		const live = tvGame.competitions?.[0]?.status?.type?.state === 'in';
        		const gameWord = live ? 'game' : 'next game';
        		// Providers flagged display_logo get banner treatment: a large
        		// logo block on their background color, with the channel centered
        		// underneath. Clicks bubble to the answer (Where to Watch).
        		if (provider.displayLogo && provider.logo_url) {
        			const bg = provider.logo_bg ? ` style="background:${provider.logo_bg}"` : '';
        			const chPill = num ? ` <span class="answer-provider-ch">Ch. ${num}</span>` : '';
        			return `<div class="answer-provider-note answer-provider-note-sponsor">
        				<span class="answer-sponsor-banner" role="button" title="Where to watch">
        					<span class="answer-sponsor-logo"${bg}><img src="${provider.logo_url}" alt="${provider.display_name} logo"></span>
        					<span class="answer-sponsor-ch">has the ${gameWord} on <strong>${network}</strong>${chPill}</span>
        				</span>
        			</div>`;
        		}
        		return `<div class="answer-provider-note">${provider.display_name} has the ${gameWord} on ${network}${num ? ` (Ch. ${num})` : ''}</div>`;
        	}

        	// Re-render the note when the provider or service area changes.
        	refreshAnswerNote() {
        		const answerEl = document.getElementById('answer');
        		if (!answerEl) return;
        		answerEl.querySelector('.answer-provider-note')?.remove();
        		if (answerEl.classList.contains('yes')) {
        			answerEl.insertAdjacentHTML('beforeend', this._providerNoteHtml());
        		}
        	}

        	emojiRowHtml(emoji, count) {
        		if (count <= 0 || !emoji) return '';
        		const spans = Array.from({ length: count }, () => `<span>${emoji}</span>`).join('');
        		return `<div class="emoji-row">${spans}</div>`;
        	}

        	displayResult(isUndefeated, wins, losses, ties, isPastSeason = false, worldSeriesName = null, postRecord = null, preRecord = null, tvStatus = null, tvGame = null) {
        		const answerEl = document.getElementById('answer');
        		const recordEl = document.getElementById('record');

        		this._lastResult = { isUndefeated, wins, losses, ties, isPastSeason, worldSeriesName, postRecord, preRecord, tvStatus, tvGame };
        		this._isOffseason = false;

        		if (worldSeriesName) {
        			answerEl.innerHTML = `🏆${SITE.emoji}<br>${worldSeriesName.toUpperCase()}<br>CHAMPIONS!<br>🎉`;
        			answerEl.className = 'answer champions';
        			document.body.classList.remove('undefeated');
        		} else if (!isPastSeason && tvStatus !== null) {
        			// Current season: answer based on whether today's game is on TV.
        			// The badge is clickable when we have broadcast data for the
        			// game it refers to, opening the same Where-to-watch modal the
        			// schedule's watch button uses.
        			const hasBroadcasts = tvGame && this.broadcastsFor(tvGame).some(b => b.media?.shortName);
        			if (tvStatus === 'yes') {
        				answerEl.innerHTML = `YES!!!${this._providerNoteHtml()}`;
        				answerEl.className = 'answer yes';
        				document.body.classList.add('undefeated');
        			} else if (tvStatus === 'streaming') {
        				answerEl.innerHTML = `STREAMING ONLY`;
        				answerEl.className = 'answer streaming';
        				document.body.classList.remove('undefeated');
        			} else {
        				answerEl.innerHTML = `NO`;
        				answerEl.className = 'answer no';
        				document.body.classList.remove('undefeated');
        			}
        			if (hasBroadcasts) {
        				answerEl.style.cursor = 'pointer';
        				answerEl.title = 'Click to see where to watch';
        				answerEl.onclick = () => this.openWatchModal(tvGame);
        			} else {
        				answerEl.style.cursor = '';
        				answerEl.title = '';
        				answerEl.onclick = null;
        			}
        		} else if (isUndefeated) {
        			const beerHtml = !isPastSeason ? this.emojiRowHtml(SITE.emoji, 1) : '';
        			answerEl.innerHTML = `YES!!!${beerHtml}`;
        			answerEl.className = 'answer yes';
        			document.body.classList.add('undefeated');
        		} else if (isPastSeason) {
        			// Past seasons: show no YES/NO/streaming answer, just the record.
        			answerEl.innerHTML = '';
        			answerEl.className = 'answer past';
        			document.body.classList.remove('undefeated');
        		} else {
        			const beerHtml = this.emojiRowHtml(SITE.emoji, 1);
        			answerEl.innerHTML = `NO${beerHtml}`;
        			answerEl.className = 'answer no';
        			document.body.classList.remove('undefeated');
        		}

        		const recordLabel = isPastSeason ? 'Final Record' : 'Current Record';
        		const regularText = ties > 0
             ? `${recordLabel}: ${wins}-${losses}-${ties}`
             : `${recordLabel}: ${wins}-${losses}`;

             const hasPreGames = preRecord && (preRecord.w > 0 || preRecord.l > 0);
             const hasPostGames = postRecord && (postRecord.w > 0 || postRecord.l > 0);

             const preText = hasPreGames
             ? (preRecord.t > 0
                ? `Preseason: ${preRecord.w}-${preRecord.l}-${preRecord.t}`
                : `Preseason: ${preRecord.w}-${preRecord.l}`)
             : null;

             const postText = hasPostGames
             ? (postRecord.t > 0
                ? `Postseason Record: ${postRecord.w}-${postRecord.l}-${postRecord.t}`
                : `Postseason Record: ${postRecord.w}-${postRecord.l}`)
             : null;

             let html = '';
             if (preText) html += `<span class="preseason-record">${preText}</span><br>`;
             if (!isPastSeason) {
               html += `<span class="record-standings-link" title="Click to view standings">${regularText}</span>`;
             } else {
               html += regularText;
             }
             if (postText) html += `<br><span class="playoff-record">${postText}</span>`;
             recordEl.innerHTML = html;
             if (!isPastSeason) {
               const link = recordEl.querySelector('.record-standings-link');
               if (link) link.addEventListener('click', () => this.openStandingsModal());
             }
         }

         displaySchedule(events, isPastSeason = false) {
          const now = new Date();

          const sortedEvents = events.sort((a, b) => new Date(a.date) - new Date(b.date));

          const nextGame = sortedEvents.find(event => {
             const gameDate = new Date(event.date);
             const status = event.competitions?.[0]?.status?.type?.name;
             return gameDate > now && status === 'STATUS_SCHEDULED';
         });

          const liveGame = sortedEvents.find(event => {
             const status = event.competitions?.[0]?.status?.type?.name;
             return status === 'STATUS_IN_PROGRESS' ||
             status === 'STATUS_HALFTIME' ||
             status === 'STATUS_DELAYED' ||
             status === 'STATUS_BREAK' ||
             status === 'STATUS_TIMEOUT' ||
             status === 'STATUS_END_PERIOD' ||
             status === 'STATUS_RAIN_DELAY';
         });

          // Cache so the schedule can be re-rendered when the selected TV
          // provider changes (channel numbers depend on the provider).
          this._lastScheduleEvents = sortedEvents;
          this._lastIsPastSeason = isPastSeason;
          this._eventsById = new Map(sortedEvents.map((e) => [String(e.id), e]));
          this._csvByGid = null;

          const rows = sortedEvents.map((event) => this.espnScheduleRow(event, nextGame, liveGame, isPastSeason));
          // The live game, else the next one, as the full card above the list:
          // the live detail, the countdown, the probables.
          const pinnedEvent = !isPastSeason ? (liveGame || nextGame) : null;
          const featured = pinnedEvent ? this.createGameItem(pinnedEvent, nextGame, liveGame, now) : null;
          // The latest game played (or the one being played) is where the
          // list opens.
          const latest = [...sortedEvents].reverse().find((e) => ['post', 'in'].includes(e.competitions?.[0]?.status?.type?.state));
          this.renderScheduleList(rows, { pre: 'Preseason', regular: 'Regular Season', post: 'Playoffs' }, {
             season: `${this.currentSeason}`, featured, scrollTo: latest?.id ?? null,
          });

          if (!isPastSeason && liveGame) this.startLiveUpdates();
    }

    // One ESPN game as a schedule row: result, live score or start time, and
    // its TV for games still to come.
    espnScheduleRow(event, nextGame, liveGame, isPastSeason) {
      const comp = event.competitions[0];
      const st = comp.status?.type || {};
      const mil = comp.competitors.find((c) => c.team.abbreviation === SITE.espnAbbr);
      const opp = comp.competitors.find((c) => c !== mil) || {};
      const score = (c) => parseInt(c?.score?.value ?? c?.score?.displayValue ?? c?.score ?? 0) || 0;
      const date = new Date(event.date);
      const isLive = liveGame && event.id === liveGame.id;
      let state;
      let text;
      if (st.state === 'post' && st.name === 'STATUS_FINAL') {
        const [b, o] = [score(mil), score(opp)];
        state = b > o ? 'win' : b < o ? 'loss' : 'tie';
        text = `${state === 'win' ? 'W' : state === 'loss' ? 'L' : 'T'} ${b}-${o}`;
      } else if (isLive || st.state === 'in') {
        state = 'live';
        text = `${score(mil)}-${score(opp)} ${st.shortDetail || ''}`.trim();
      } else if (st.state === 'post') {
        state = 'postponed';
        text = st.shortDetail || st.description || 'Postponed';
      } else {
        state = nextGame && event.id === nextGame.id ? 'next' : 'upcoming';
        text = event.timeValid === false ? 'TBD' : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      const upcoming = state === 'next' || state === 'upcoming';
      const tv = upcoming ? this.scheduleBroadcasts(event).map((b) => {
        const num = this.scheduleChannelNumber(b);
        // The network's own name where the tables know it: ESPN's 'MyMi' is
        // MyMilwaukee24.
        return `${this.resolveChannel(b.media.shortName)?.display_name || b.media.shortName}${num ? ` ${num}` : ''}`;
      }) : [];
      const canWatch = upcoming && !isPastSeason && this.broadcastsFor(event).some((b) => b.media?.shortName);
      const clickable = state === 'win' || state === 'loss' || state === 'tie' || state === 'live' || canWatch;
      return {
        key: String(event.id), date, phase: event._seasonType,
        home: mil?.homeAway === 'home',
        opp: opp.team?.shortDisplayName || opp.team?.name || opp.team?.displayName || '',
        state, text, tv, clickable,
        // A game played or being played: its summary pop-up, the site's box
        // score (built from ESPN's, /game/<id>), and ESPN's own page.
        links: upcoming || state === 'postponed' ? null : {
          summary: true,
          box: SITE.gamePages ? `game/${encodeURIComponent(event.id)}` : null,
          espn: `https://www.espn.com/${SITE.espnWeb}/game/_/gameId/${encodeURIComponent(event.id)}`,
        },
        title: state === 'live' || !upcoming ? 'Line score' : canWatch ? 'Where to watch' : '',
      };
    }

createGameItem(event, nextGame, liveGame, now) {
  const competition = event.competitions[0];
  const competitors = competition.competitors;
  const status = competition.status;
  const date = new Date(event.date);

  const isLive = liveGame && event.id === liveGame.id;

  let brewersScore = 0;
  let opponentScore = 0;
  let opponent = '';
  let isHome = false;

  competitors.forEach(competitor => {
     if (competitor.team.abbreviation === SITE.espnAbbr) {
        brewersScore = parseInt(
           competitor.score?.value ??
           competitor.score?.displayValue ??
           competitor.score ??
           0
           ) || 0;
        isHome = competitor.homeAway === 'home';
    } else {
        opponentScore = parseInt(
           competitor.score?.value ??
           competitor.score?.displayValue ??
           competitor.score ??
           0
           ) || 0;
        opponent = competitor.team.displayName;
    }
});

  const gameItem = document.createElement('div');
  gameItem.className = 'game-item';
  gameItem.dataset.eventId = event.id;

  const isNext = nextGame && event.id === nextGame.id && !isLive;
  const isCompleted = status.type.name === 'STATUS_FINAL';
  const isInProgress = status.type.name === 'STATUS_IN_PROGRESS' ||
  status.type.name === 'STATUS_HALFTIME' ||
  status.type.name === 'STATUS_DELAYED' ||
  status.type.name === 'STATUS_BREAK' ||
  status.type.name === 'STATUS_TIMEOUT' ||
  status.type.name === 'STATUS_END_PERIOD' ||
  status.type.name === 'STATUS_RAIN_DELAY';

  if (isLive) {
     gameItem.classList.add('live');
 } else if (isNext) {
     gameItem.classList.add('next');
 } else if (isCompleted) {
     gameItem.classList.add('completed');
     if (brewersScore > opponentScore) {
        gameItem.classList.add('win');
    } else if (brewersScore < opponentScore) {
        gameItem.classList.add('loss');
    }
}

const gameInfo = document.createElement('div');
gameInfo.className = 'game-info';

const gameDetails = document.createElement('div');
gameDetails.className = 'game-details';

const opponentDiv = document.createElement('div');
opponentDiv.className = 'game-opponent';
opponentDiv.textContent = `${isHome ? 'vs' : '@'} ${opponent}`;

const scheduleBroadcasts = this.scheduleBroadcasts(event);
const hasBroadcasts = this.broadcastsFor(event).some(b => b.media?.shortName);
const gameIsCompleted = status.type.name === 'STATUS_FINAL';
const canWatch = hasBroadcasts && !gameIsCompleted && this.currentSeason === this.latestSeason;

gameDetails.appendChild(opponentDiv);

// All-time head-to-head sits right below the opponent.
if (this.currentSeason === this.latestSeason) {
 const h2h = this.h2hNote(opponent);
 if (h2h) gameDetails.appendChild(h2h);
}

const dateDiv = document.createElement('div');
dateDiv.className = 'game-date';
if (isLive || isInProgress) {
 dateDiv.innerHTML = `<span class="live-indicator-small"></span>LIVE NOW`;
} else {
 dateDiv.textContent = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});
}
gameDetails.appendChild(dateDiv);

// Channel/network on its own line below the date. Clickable to open the
// "Where to watch" modal when full broadcast data is available.
// Completed games don't need a TV listing.
if ((scheduleBroadcasts.length || canWatch) && !gameIsCompleted) {
 const channelLine = document.createElement('div');
 channelLine.className = 'game-channel';
 let html = '';
 if (isLive || isInProgress) html += `<span class="live-indicator-small"></span>`;
 if (scheduleBroadcasts.length) {
   html += scheduleBroadcasts.map(b => {
     const name = this.resolveChannel(b.media.shortName)?.display_name || b.media.shortName;
     const num = this.scheduleChannelNumber(b);
     return `<span class="game-network">${name}${num ? ` <span class="game-channum">Ch. ${num}</span>` : ''}</span>`;
   }).join('<span class="game-network-sep"> · </span>');
 }
 if (canWatch && !scheduleBroadcasts.length) {
   html += `<i class="mdi mdi-television-play"></i> Where to watch`;
 }
 channelLine.innerHTML = html;
 if (canWatch) {
   channelLine.classList.add('game-channel-watchable');
   channelLine.title = 'Click for where to watch';
   channelLine.addEventListener('click', (e) => {
     e.stopPropagation();
     this.openWatchModal(event);
   });
 }
 gameDetails.appendChild(channelLine);
}

if (isLive || isInProgress) {
 const statusDiv = document.createElement('div');
 statusDiv.className = 'game-status';
 statusDiv.textContent = status.type.detail || status.type.shortDetail || 'Live';
 gameDetails.appendChild(statusDiv);

 if (event.situation && !isBetweenInnings(status.type.detail || status.type.shortDetail)) {
    gameDetails.insertAdjacentHTML('beforeend', situationHtml(event.situation));
 }

 // Pitchers, the at-bat pitch by pitch and the last plays, from /api/live.
 if (event.live) {
    gameDetails.insertAdjacentHTML('beforeend', liveDetailHtml(event.live));
 } else if (event.lastPlay) {
    const lastPlayDiv = document.createElement('div');
    lastPlayDiv.className = 'last-play';

    let playText = '';
    if (event.lastPlay.possession) {
       const possessionTeam = competitors.find(comp => comp.team.id == event.lastPlay.possession);
       const teamName = possessionTeam ? possessionTeam.team.abbreviation : event.lastPlay.possession;
       playText += `${teamName} Ball\n`;
   }
   if (event.lastPlay.downDistanceText) {
       playText += event.lastPlay.downDistanceText + '\n';
   }
   if (event.lastPlay.drive?.description) {
       let driveTeam = '';
       if (event.lastPlay.drive.team) {
          const driveTeamData = competitors.find(comp => comp.team.id == event.lastPlay.drive.team);
          driveTeam = driveTeamData ? `${driveTeamData.team.abbreviation} ` : '';
      }
      playText += `${driveTeam}Drive: ${event.lastPlay.drive.description}\n`;
  }
  if (event.lastPlay.text) {
   playText += `\nLast Play:\n${event.lastPlay.text}`;
}

if (playText.trim()) {
   lastPlayDiv.textContent = playText.trim();
   gameDetails.appendChild(lastPlayDiv);
}
}
}

if (isNext) {
 const countdownDiv = document.createElement('div');
 countdownDiv.className = 'countdown-small';

 const timeLeft = date - now;
 if (timeLeft > 0) {
    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    let countdownText = '⏰ ';
    if (days > 0) countdownText += `${days}d ${hours}h ${minutes}m`;
    else if (hours > 0) countdownText += `${hours}h ${minutes}m`;
    else countdownText += `${minutes}m`;

    countdownDiv.textContent = countdownText;
} else {
    countdownDiv.textContent = '⏰ Game Time!';
}

gameDetails.appendChild(countdownDiv);
 // The probable starters, once ESPN has them (usually a day or two out).
 gameDetails.insertAdjacentHTML('beforeend', probablesHtml(probableStarters(event)));
}

gameInfo.appendChild(gameDetails);
gameItem.appendChild(gameInfo);

if (isCompleted) {
 const scoreDiv = document.createElement('div');
 scoreDiv.className = 'game-score';

 let resultIndicator = '';
 if (brewersScore > opponentScore) {
    scoreDiv.classList.add('win');
    resultIndicator = 'W ';
} else if (brewersScore < opponentScore) {
    scoreDiv.classList.add('loss');
    resultIndicator = 'L ';
} else {
    resultIndicator = 'T ';
}

const hasLinescore = (competition.linescores && competition.linescores.length > 0) ||
  competitors.some(c => c.linescores && c.linescores.length > 0);

if (hasLinescore) {
  scoreDiv.classList.add('linescore-trigger');
  scoreDiv.title = 'Click for line score';
  scoreDiv.textContent = `${resultIndicator}${brewersScore}-${opponentScore}`;
  scoreDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    this.openLinescoreFromEvent(event);
  });
} else {
  scoreDiv.classList.add('linescore-trigger');
  scoreDiv.title = 'Click for line score';
  scoreDiv.textContent = `${resultIndicator}${brewersScore}-${opponentScore}`;
  scoreDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    this.openLinescoreFromEvent(event);
  });
}
scoreDiv.style.textAlign = 'center';
scoreDiv.style.marginTop = '0.5rem';
scoreDiv.style.width = '100%';
gameItem.appendChild(scoreDiv);
} else if (isLive || isInProgress) {
 const scoreDiv = document.createElement('div');
 scoreDiv.className = 'game-score live linescore-trigger';
 scoreDiv.title = 'Click for line score';
 scoreDiv.textContent = `${brewersScore}-${opponentScore}`;
 scoreDiv.addEventListener('click', (e) => {
   e.stopPropagation();
   this.openLinescoreFromEvent(event);
 });
 scoreDiv.style.textAlign = 'center';
 scoreDiv.style.marginTop = '0.5rem';
 scoreDiv.style.width = '100%';
 gameItem.appendChild(scoreDiv);
}

return gameItem;
}

startLiveUpdates() {
  if (this.liveUpdateInterval) clearInterval(this.liveUpdateInterval);
  if (this.countdownInterval) clearInterval(this.countdownInterval);

  // Every 15s during a game: the live card follows pitch by pitch, and the
  // server's cache of the game holds 15s too, so this is about one pitch
  // behind at most and ESPN still sees one request per 15s in all. Only the
  // live detail (/api/live, a few KB) comes every 15s; the three schedules,
  // which say when the game has ended, reload once a minute as before.
  this.liveUpdateInterval = setInterval(async () => {
     try {
        const ctx = this._liveContext;
        if (ctx && Date.now() - (this._lastFullRefresh || 0) < 60000) {
           await this.fetchLiveGameScore(ctx.liveGame, ctx.mergedData);
        } else {
           await this.fetchBrewersData();
        }
    } catch (error) {
        console.error('Error updating live game:', error);
    }
}, 15000);
}

// Always shown in are-they-sports. The site showed it only on a past season,
// but the season being played draws on the same history — the sparkline, the
// all-time records, on this day — and Retrosheet's notice and nflverse's
// CC BY attribution are conditions of using it, not decoration.
setDataCredit() {
  const el = document.getElementById('data-credit');
  if (el) el.style.display = '';
}

showLastUpdated() {
  const el = document.getElementById('last-updated');
  const now = new Date();
  el.textContent = `Last updated: ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;
}

setupShareButtons() {
   if (this._shareSetup) {
      this.updateIntentLinks();
      return;
  }
  this._shareSetup = true;

  const nativeBtn = document.getElementById('share-native');
  const copyBtn = document.getElementById('share-copy');

  if (navigator.share) {
      nativeBtn.hidden = false;
      nativeBtn.addEventListener('click', () => this.nativeShare());
  } else {
      document.getElementById('share-x').hidden = false;
      document.getElementById('share-bsky').hidden = false;
      document.getElementById('share-fb').hidden = false;
      document.getElementById('share-reddit').hidden = false;
  }

        	// Always offer Copy — even on browsers that support the native share sheet,
        	// so there's an always-available button with visible click feedback.
  copyBtn.hidden = false;
  copyBtn.addEventListener('click', () => this.copyLink());

  this.updateIntentLinks();
  wireShareDropdown();
}

// Watching details for today's game: network, plus the user's provider and
// channel number when one is selected in the channel guide.
_shareTvLine() {
  const { tvStatus, tvGame } = this._lastResult || {};
  if (!tvGame || (tvStatus !== 'yes' && tvStatus !== 'streaming')) return null;
  const opp = tvGame.competitions?.[0]?.competitors?.find(c => c.team?.abbreviation !== SITE.espnAbbr)?.team?.shortDisplayName;
  // Name the regular network; a local simulcast gets its own mention below
  // rather than reading as the network ("watch on Simulcast").
  const regular = this.broadcastsFor(tvGame).filter(x => !x._simulcast);
  const b = this._primaryOf(regular.length ? regular : this.broadcastsFor(tvGame));
  const name = b?.media?.shortName;
  const ch = name ? this.resolveChannel(name) : null;
  const network = ch?.display_name || name || null;
  let watch = network ? ` on ${network}` : '';
  if (network && this.selectedProvider) {
    const num = this.resolveProviderChannel(this.selectedProvider, ch?.key || name, this.selectedServiceAreaIndex(this.selectedProvider));
    const provider = this.providerMeta[this.selectedProvider]?.display_name;
    if (num && provider) watch = ` on ${network} (ch. ${this.formatChannelNum(num).text} on ${provider})`;
  }
  const vs = opp ? ` vs the ${opp}` : '';
  const simulcast = this.simulcastChannelsFor(tvGame).length ? ' — plus a free over-the-air simulcast' : '';
  return tvStatus === 'yes'
    ? `📺 The ${SITE.team} are ON TV today${vs}${watch}${simulcast}!`
    : `📱 The ${SITE.team} are streaming today${vs}${watch}${simulcast}!`;
}

getShareMessage() {
  const season = this.currentSeason;
  const isPast = season && this.latestSeason && season < this.latestSeason;

  if (this._isOffseason) {
     return `🏀 ${SITE.fullName} offseason - can't wait for the ${season} season!${SITE.tag}`;
 }

 if (!this._lastResult) return `${SITE.fullName} ${season} season${SITE.tag}`;

 const { isUndefeated, wins, losses, ties, worldSeriesName } = this._lastResult;

 if (worldSeriesName) {
     return `🏆 The ${season} ${SITE.fullName} won ${worldSeriesName.toUpperCase()}!${SITE.tag}`;
 }

 const recordText = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

 if (isPast) {
     if (isUndefeated) {
        return `🏀 The ${season} ${SITE.fullName} finished the regular season UNDEFEATED at ${recordText}!${SITE.tag}`;
    } else {
        return `The ${season} ${SITE.fullName} finished ${recordText}.${SITE.tag}`;
    }
} else {
 const base = isUndefeated
    ? `🏀 The ${SITE.fullName} are UNDEFEATED so far in ${season}! ${recordText} 🏀`
    : `The ${SITE.fullName} are ${recordText} so far in the ${season} season.`;
 const tvLine = this._shareTvLine();
 return tvLine ? `${tvLine} ${base}${SITE.tag}` : `${base}${SITE.tag}`;
}
}

updateIntentLinks() {
  const links = intentUrls(this.getShareMessage(), window.location.href);
  for (const [key, id] of [['x', 'share-x'], ['bsky', 'share-bsky'], ['fb', 'share-fb'], ['reddit', 'share-reddit']]) {
    const btn = document.getElementById(id);
    if (btn) btn.href = links[key];
  }
}

async nativeShare() {
  const message = this.getShareMessage();
  const url = window.location.href;
  try {
     await navigator.share({ text: message, url });
 } catch (err) {
     if (err.name !== 'AbortError') this.copyLink();
 }
}

async copyLink() {
    const copyBtn = document.getElementById('share-copy');
    const shareText = `${this.getShareMessage()}\n\nCheck it out: ${window.location.href}`;
        // Flash FIRST, synchronously on click, so feedback never depends on the
        // clipboard call succeeding or on a permission prompt.
    flashCopied(copyBtn, '<i class="mdi mdi-check share-icon"></i>Copied!');
    await copyText(shareText);
}

// How noteworthy was this game? Blowouts, slugfests, extra innings, playoff
// games, homer barrages, and no-hitters float to the top of On This Day.
// Random pick weighted by interest — ordinary games still show up, just less.
// The ?otd=MM-DD date override, or null. Only that shape is accepted: the
// value used to be written into the panel as-is, so /?otd=<img onerror=…>
// ran script on the site (CodeQL alert #5).
otdOverride() {
  const v = new URLSearchParams(window.location.search).get('otd');
  return v && /^\d{2}-\d{2}$/.test(v) ? v : null;
}

buildOnThisDay() {
  const el = document.getElementById('on-this-day');
  if (!el) return;

  const dateParam = this.otdOverride();
  const today = dateParam ? parseLocalDate(`2000-${dateParam}`) : new Date();
  const todayMonth = isNaN(today) ? new Date().getMonth() : today.getMonth();
  const todayDay = isNaN(today) ? new Date().getDate() : today.getDate();

  // The window is site.js's onThisDayWindowDays: exact here, three days either
  // side on the football site. Same function, one number.
  const candidates = onThisDayCandidates(this.csvBySeason, todayMonth, todayDay);
  for (const c of candidates) c.interest = otdInterest(c, this.lineScores);

  // Brewers born today, from /api/born. The game renders at once and the
  // birthdays join it when they arrive; on a day with no game — most of the
  // winter — the birthdays are the panel, which used to hide.
  this._otdBirths = [];
  const pick = candidates.length ? otdPick(candidates) : null;
  const render = () => {
    if (pick) this._renderOnThisDay(el, pick, candidates);
    else if (this._otdBirths.length) this._renderBirthsOnly(el);
    else el.hidden = true;
  };
  render();
  const monthDay = `${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
  fetch(`api/born/${monthDay}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((born) => { this._otdBirths = Array.isArray(born) ? born : []; if (this._otdBirths.length) render(); })
    .catch(() => {});
}

// "Born on this day: Robin Yount (1955) · ..." — the three longest Brewers
// careers, linked to their pages, and a count of the rest.
_birthsHtml() {
  const born = this._otdBirths || [];
  if (!born.length) return '';
  const shown = born.slice(0, 3).map((b) => `<a href="player/${esc(b.id)}">${esc(b.name)}</a> <span class="otd-born-year">(${b.year})</span>`);
  const more = born.length > 3 ? ` <span class="otd-born-year">+ ${born.length - 3} more</span>` : '';
  return `<div class="otd-born"><i class="mdi mdi-cake-variant"></i> Born on this day: ${shown.join(' · ')}${more}</div>`;
}

_renderBirthsOnly(el) {
  el.innerHTML = `
    <div class="otd-header">
      <span class="otd-label"><i class="mdi mdi-calendar-today"></i> On This Day in ${SITE.team} History</span>
    </div>
    ${this._birthsHtml()}`;
  el.hidden = false;
}

_renderOnThisDay(el, pick, pool) {
  const { game, season, date } = pick;
  const result = game['result'];
  const opponent = game['Opponent'] || game['opponent'] || 'Unknown';
  const brewersScore = game['scoreFor'];
  const oppScore = game['scoreAgainst'];
  const isPlayoff = game['playoff'] === '1' || game['playoff'] === 'true';
  const isWorldSeries = game['championship'] && game['championship'] !== '';

  const resultClass = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'tie';
  const resultLabel = result === 'WIN' ? 'W' : result === 'LOSS' ? 'L' : 'T';
  const scoreText = brewersScore && oppScore ? `${brewersScore}–${oppScore}` : '';
  const gameTypeLabel = isWorldSeries ? SITE.championship : isPlayoff ? 'Postseason' : 'Regular Season';
  const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const photos = this.photosBySeason[season] || [];
  const photo = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null;

  const otdParam = this.otdOverride();
  const resetLink = otdParam
  ? `<a class="otd-reset" href="${esc(window.location.pathname)}" aria-label="Reset date override">Using ${esc(otdParam)} &times;</a>`
  : '';

  el.innerHTML = `
        			<div class="otd-header">
        				<span class="otd-label"><i class="mdi mdi-calendar-today"></i> On This Day in ${SITE.team} History</span>
        				<span class="otd-actions">
        					${resetLink}
        					<button class="otd-refresh" id="otd-refresh" aria-label="Show another"><i class="mdi mdi-refresh"></i></button>
        				</span>
        			</div>
        			<div class="otd-body">
    ${photo ? `<a href="${esc(photo.url)}" target="_blank" rel="noopener noreferrer" class="otd-photo-link"><img class="otd-photo" src="${esc(photo.url)}" alt="${esc(photo.caption || '')}" loading="lazy"></a>` : ''}
        				<div class="otd-info">
        					<div class="otd-season-link">
        						<a href="${season}" class="otd-year">${SITE.seasonLabel(season)} Season</a>
        						<span class="otd-game-type">${gameTypeLabel}</span>
        					</div>
        					<div class="otd-game-row">
        						<span class="otd-result-badge ${resultClass}">${resultLabel}</span>
    ${game.gid && SITE.gamePages
        ? `<a class="otd-matchup otd-game-link" href="game/${esc(game.gid)}" title="Full box score">vs. ${esc(opponent)}${scoreText ? ` <span class="otd-score">${scoreText}</span>` : ''}</a>`
        : `<span class="otd-matchup">vs. ${esc(opponent)}</span>${scoreText ? `<span class="otd-score">${scoreText}</span>` : ''}`}
        					</div>
        					<div class="otd-date">${dateStr}, ${season}</div>
        				</div>
        			</div>
        			${this._birthsHtml()}
`;
el.hidden = false;

document.getElementById('otd-refresh')?.addEventListener('click', () => {
 if (pool.length > 1) {
    this._renderOnThisDay(el, otdPick(pool, pick), pool);
}
});
}

computeStreak(completedGames) {
  const sorted = [...completedGames].sort((a, b) => a.date - b.date);
  let lastLoss = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
     if (sorted[i].result === 'LOSS') { lastLoss = sorted[i]; break; }
 }
 let winStreak = 0;
 for (let i = sorted.length - 1; i >= 0; i--) {
     if (sorted[i].result === 'WIN') winStreak++;
     else break;
 }
 const now = new Date();
 const daysSince = lastLoss
 ? Math.floor((now - lastLoss.date) / (1000 * 60 * 60 * 24))
 : null;
 return { winStreak, lastLoss, daysSince };
}

// The playoff panel: the series once a postseason game is on the schedule,
// otherwise the race for one over the last RACE_WINDOW_GAMES of the regular
// season. `gamesPlayed` is null for anything but the season being played.
// The standings are fetched only inside that window, so most of the year
// this costs nothing.
async updatePlayoffPanel(postGames, gamesPlayed, { settled = false } = {}) {
  const details = document.getElementById('playoff-details');
  const body = document.getElementById('playoff-panel');
  const title = document.getElementById('playoff-summary');
  if (!details || !body) return;
  const show = (label, html) => {
    if (!html) { details.hidden = true; return; }
    title.textContent = label;
    body.innerHTML = html;
    details.hidden = false;
  };

  // College has no bracket here (sixty-eight teams is not the NBA's
  // sixteen) and no race: a bid is no standings' to give.
  this.stopBracket();
  if (postGames.length) return show('Postseason', postseasonPanelHtml(postGames, { settled }));
  show(null, null);
}

// The rest of the postseason (bracket-core.js): under the Brewers' series,
// the one deciding who they play next, and the whole bracket folded below.
// Fetched a minute apart while any playoff game is on, else when the next
// one starts (bracketRefreshMs). The panel is redrawn with every schedule
// load; a redraw within a minute of the last fetch reuses it.
async loadBracket() {
  this._bracketOn = true;
  if (this._bracket && Date.now() - this._bracket.at < 60 * 1000) return this.renderBracket();
  clearTimeout(this._bracketTimer);
  let wait = 5 * 60 * 1000;
  try {
    const res = await fetch('api/bracket');
    if (!res.ok) throw new Error(`bracket ${res.status}`);
    const { games } = await res.json();
    this._bracket = { at: Date.now(), series: bracketSeries(games) };
    wait = bracketRefreshMs(this._bracket.series);
  } catch { /* keep the last copy, and try again in five minutes */ }
  if (!this._bracketOn) return;
  this.renderBracket();
  this._bracketTimer = setTimeout(() => {
    if (this._bracket) this._bracket.at = 0;
    this.loadBracket();
  }, wait);
}

stopBracket() {
  this._bracketOn = false;
  clearTimeout(this._bracketTimer);
}

renderBracket() {
  const body = document.getElementById('playoff-panel');
  if (!this._bracketOn || !body || !this._bracket) return;
  body.querySelectorAll('.po-tracker, .po-bracket').forEach(el => el.remove());
  const { series } = this._bracket;
  const tracker = opponentTrackerHtml(series, SITE.espnAbbr);
  if (tracker) {
    // Right under the current series, above the ones already played.
    const earlier = body.querySelector('.po-earlier');
    if (earlier) earlier.insertAdjacentHTML('beforebegin', tracker);
    else body.insertAdjacentHTML('beforeend', tracker);
  }
  const bracket = bracketHtml(series, SITE.espnAbbr);
  if (!bracket) return;
  let open = false;
  try { open = localStorage.getItem('bracketOpen') === '1'; } catch { /* closed */ }
  body.insertAdjacentHTML('beforeend', `<details class="po-bracket"${open ? ' open' : ''}><summary>Playoff bracket</summary>${bracket}</details>`);
  body.querySelector('.po-bracket').addEventListener('toggle', (e) => {
    try { localStorage.setItem('bracketOpen', e.currentTarget.open ? '1' : '0'); } catch { /* not kept */ }
  });
}

updateStreakBanner(completedGames, isPastSeason, nextGame) {
  const el = document.getElementById('streak-banner');
  if (!el) return;
  // The six sentences are shared with the football site; recent form is ours.
  let html = streakBannerHtml(completedGames, { isPastSeason });
  if (html === null) { el.hidden = true; return; }

  if (!isPastSeason) {
    const sorted = [...completedGames].sort((a, b) => a.date - b.date);
    const parts = recentFormParts(sorted);
    const vs = this._lastTenVsNext(nextGame);
    if (vs) parts.push(vs);
    if (parts.length) html += `<div class="streak-extra">${parts.join(' &middot; ')}</div>`;
  }

  el.innerHTML = html;
  el.hidden = false;
}

// Resolving the next opponent out of the live ESPN payload, which is this
// file's job; lastMeetings does the part that only needs rows.
_lastTenVsNext(nextGame) {
  if (!nextGame || !this.h2hRows) return null;
  const oppTeam = nextGame.competitions?.[0]?.competitors
    ?.find(c => c.team?.abbreviation !== SITE.espnAbbr)?.team;
  const fran = oppTeam && this.displayNameToFranchise?.get(oppTeam.displayName);
  const o = fran && this.h2hByFranchise?.get(fran);
  if (!o) return null;
  const vsGames = lastMeetings(this.h2hRows, fran);
  if (!vsGames.length) return null;
  const short = oppTeam.shortDisplayName || o.name;
  return `Last ${vsGames.length} vs <a href="vs/${o.slug}">${short}</a>: <strong>${hyphenRecord(vsGames)}</strong>`;
}

updateLastUndefeated(currentSeasonWins, currentSeasonLosses) {
  const el = document.getElementById('last-undefeated');
  if (!el) return;

        		// Check if current season being viewed is itself undefeated (in-progress or final)
  const currentIsUndefeated = currentSeasonLosses === 0 && currentSeasonWins > 0;

        		// Find last undefeated season from CSV records (excluding current if it's live)
  let lastYear = null;
  const csvYears = Object.keys(this.seasonRecords).map(Number).sort((a, b) => a - b);
  for (const yr of csvYears) {
     const r = this.seasonRecords[yr];
     // Unbeaten with the title only (records-core.js computeSeasonHistory).
     if (r.title && parseInt(r.reg_l) === 0 && parseInt(r.post_l) === 0 && parseInt(r.reg_w) > 0) {
        lastYear = yr;
    }
}

        		// Also account for ESPN seasons (post-2020): if current season is undefeated and complete, it qualifies
        		// but we want the last historical one to link to, not the current
if (!lastYear) {
 el.innerHTML = '';
 return;
}

const isCurrent = this.currentSeason === lastYear;
const suffix = isCurrent ? '' : `The ${SITE.team} were last undefeated in <a href="${lastYear}" class="last-undefeated-link">${lastYear}</a>.`;

if (currentIsUndefeated && this.currentSeason === this.latestSeason) {
 el.innerHTML = '';
} else if (isCurrent) {
 el.innerHTML = '';
} else {
 el.innerHTML = suffix;
}
}

resolveChannel(networkName) {
  return resolveChannel(this.tvLookup, networkName);
}

// The channel and provider tables, parsed by tv-core.js. channelMeta and
// providerMeta stay as views onto them because the provider picker, the
// watch modal and the schedule read them directly.
_loadTvLookup(channelLookupRaw, providerLookupRaw) {
  this.tvLookup = parseTvLookup(channelLookupRaw, providerLookupRaw);
  this.channelMeta = this.tvLookup.channels;
  this.providerMeta = this.tvLookup.providers;
  this.providerAliasIndex = this.tvLookup.providerAliasIndex;
}

resolveProviderByName(query) {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // exact alias match
  const hit = this.providerAliasIndex.get(q);
  if (hit) return this.providerMeta[hit];
  // partial match (starts-with then includes)
  for (const [alias, key] of this.providerAliasIndex) {
    if (alias.startsWith(q)) return this.providerMeta[key];
  }
  for (const [alias, key] of this.providerAliasIndex) {
    if (alias.includes(q)) return this.providerMeta[key];
  }
  return null;
}

formatChannelNum(raw) {
  return formatChannelNum(raw);
}

resolveProviderChannel(providerKey, networkName, areaIndex) {
  return providerChannel(this.tvLookup, providerKey, networkName, areaIndex);
}

selectedServiceAreaIndex(providerKey) {
  if (!providerKey) return 0;
  const idx = parseInt(localStorage.getItem(`tvServiceArea.${providerKey}`), 10);
  return Number.isInteger(idx) && idx >= 0 ? idx : 0;
}

setServiceAreaIndex(providerKey, idx) {
  if (!providerKey) return;
  localStorage.setItem(`tvServiceArea.${providerKey}`, String(idx));
}

// Channel number to show inline in the schedule for a broadcast, based on
// the viewer's selected provider. Null when no provider is set, the
// broadcast isn't on linear TV, or the channel isn't in the provider's lineup.
scheduleChannelNumber(broadcast) {
  if (!this.selectedProvider) return null;
  return channelNumberFor(this.tvLookup, this.selectedProvider, broadcast, this.selectedServiceAreaIndex(this.selectedProvider));
}

_rerenderSchedule() {
  if (this._lastScheduleEvents) {
    this.displaySchedule(this._lastScheduleEvents, this._lastIsPastSeason);
  }
}

providerOptions() {
  return Object.values(this.providerMeta)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

initWatchModal() {
  const modal = document.getElementById('watch-modal');
  const backdrop = modal.querySelector('.watch-backdrop');
  const closeBtn = document.getElementById('watch-close');
  backdrop.addEventListener('click', () => this.closeWatchModal());
  closeBtn.addEventListener('click', () => this.closeWatchModal());
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') this.closeWatchModal();
  });
}

// Small provider logo element, or null when the provider has none. Logos are
// often white-on-transparent, so an optional logo_bg color block sits behind
// them. A failed image load removes the element rather than showing a broken
// icon.
providerLogoEl(provider, large = false) {
  // display_logo is the master switch: a provider with a logo on file but
  // the flag off renders as name-only everywhere.
  if (!provider?.logo_url || !provider.displayLogo) return null;
  const wrap = document.createElement('span');
  wrap.className = 'provider-logo' + (large ? ' provider-logo-large' : '');
  if (provider.logo_bg) wrap.style.background = provider.logo_bg;
  const img = document.createElement('img');
  img.src = provider.logo_url;
  img.alt = `${provider.display_name} logo`;
  img.loading = 'lazy';
  img.addEventListener('error', () => wrap.remove());
  wrap.appendChild(img);
  return wrap;
}

// Providers matching a query, ranked starts-with before contains, matching
// display names and aliases (so "charter" finds Spectrum). An empty query
// returns everything — the dropdown doubles as a browsable list.
_providerMatches(q) {
  const opts = this.providerOptions();
  if (!q) return opts.map(p => ({ p, via: null }));
  const scored = [];
  for (const p of opts) {
    const names = [p.display_name, ...(p.alternate_name || '').split(',').map(s => s.trim()).filter(Boolean)];
    let best = null;
    for (const n of names) {
      const ln = n.toLowerCase();
      const rank = ln.startsWith(q) ? 0 : ln.includes(q) ? 1 : -1;
      if (rank < 0) continue;
      const via = n === p.display_name ? null : n;
      if (!best || rank < best.rank || (rank === best.rank && !via && best.via)) best = { rank, via };
    }
    if (best) scored.push({ p, via: best.via, rank: best.rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.p.display_name.localeCompare(b.p.display_name));
  return scored;
}

// Shared provider search input (used by the watch modal and the schedule bar).
// Owns the selectedProvider/localStorage state; calls onChange(match, source)
// after every apply so each caller can refresh its own dependents — source is
// 'row' (explicit pick), 'typed', 'blur', 'clear', or 'area'.
// The suggestion list is custom-rendered — native <datalist> is unusable on
// Android (blank suggestion chips) and unstylable everywhere else. With
// inline: true the list renders in-flow and stays open (for the dedicated
// provider dialog, where a floating overlay would clip against the modal).
_buildProviderInput({ label, inputId, listId, placeholder, onChange, inline = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'watch-provider-picker';

  if (label) {
    const lbl = document.createElement('label');
    lbl.className = 'watch-provider-label';
    lbl.htmlFor = inputId;
    lbl.textContent = label;
    wrap.appendChild(lbl);
  }

  const inputWrap = document.createElement('div');
  inputWrap.className = 'watch-provider-input-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.className = 'watch-provider-input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  if (this.selectedProvider && this.providerMeta[this.selectedProvider]) {
    input.value = this.providerMeta[this.selectedProvider].display_name;
  }
  inputWrap.appendChild(input);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'watch-provider-clear';
  clearBtn.setAttribute('aria-label', 'Clear provider');
  clearBtn.innerHTML = '<i class="mdi mdi-close"></i>';
  clearBtn.hidden = !input.value;
  inputWrap.appendChild(clearBtn);

  const sugg = document.createElement('div');
  sugg.id = listId;
  sugg.className = 'watch-provider-suggestions' + (inline ? ' watch-provider-suggestions-inline' : '');
  sugg.setAttribute('role', 'listbox');
  sugg.hidden = true;

  wrap.appendChild(inputWrap);
  // Inline mode renders the list as a sibling below the input box; overlay
  // mode floats it from inside the input wrap. Keeping it out of the input
  // wrap in inline mode also keeps the clear button anchored to the input.
  if (inline) wrap.appendChild(sugg);
  else inputWrap.appendChild(sugg);

  const hint = document.createElement('div');
  hint.className = 'watch-provider-hint';
  hint.hidden = true;
  wrap.appendChild(hint);

  // Service-area picker — only shown when the selected provider splits its
  // channel lineup across multiple service areas. Rendered as the same
  // tappable rows as the provider suggestions.
  const areaWrap = document.createElement('div');
  areaWrap.className = 'watch-service-area-picker';
  areaWrap.hidden = true;

  const areaLabel = document.createElement('div');
  areaLabel.className = 'watch-service-area-label';
  areaLabel.textContent = 'Service area';
  areaWrap.appendChild(areaLabel);

  const areaList = document.createElement('div');
  areaList.className = 'watch-area-options';
  areaList.setAttribute('role', 'listbox');
  areaWrap.appendChild(areaList);

  wrap.appendChild(areaWrap);

  const refreshArea = (match) => {
    const areas = match && Array.isArray(match.service_areas) ? match.service_areas : [];
    areaList.innerHTML = '';
    if (areas.length > 1) {
      const saved = Math.min(this.selectedServiceAreaIndex(match.key), areas.length - 1);
      areas.forEach((name, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'watch-provider-suggestion watch-area-option' + (i === saved ? ' active' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(i === saved));
        const nameSpan = document.createElement('span');
        nameSpan.className = 'watch-provider-suggestion-name';
        nameSpan.textContent = name;
        row.appendChild(nameSpan);
        row.addEventListener('click', () => {
          this.setServiceAreaIndex(match.key, i);
          areaList.querySelectorAll('.watch-area-option').forEach((r, j) => {
            r.classList.toggle('active', j === i);
            r.setAttribute('aria-selected', String(j === i));
          });
          onChange(match, 'area');
          this.refreshAnswerNote();
        });
        areaList.appendChild(row);
      });
      areaWrap.hidden = false;
    } else {
      areaWrap.hidden = true;
    }
  };

  refreshArea(this.selectedProvider && this.providerMeta[this.selectedProvider]
    ? this.providerMeta[this.selectedProvider] : null);

  const applyMatch = (match, { persistInput = true, source = 'typed' } = {}) => {
    if (match) {
      this.selectedProvider = match.key;
      localStorage.setItem('tvProvider', match.key);
      if (persistInput) input.value = match.display_name;
      hint.hidden = true;
    } else {
      this.selectedProvider = null;
      localStorage.removeItem('tvProvider');
      hint.hidden = !input.value.trim();
      hint.textContent = input.value.trim() ? `No provider matching "${input.value.trim()}".` : '';
    }
    clearBtn.hidden = !input.value;
    refreshArea(match);
    onChange(match, source);
    // The share message and the answer's provider note carry the selected
    // provider's channel info — refresh both whenever the provider changes.
    this.updateIntentLinks();
    this.refreshAnswerNote();
  };

  // Custom suggestion dropdown: shows every provider on focus, filters as
  // the visitor types (aliases included, shown as a secondary label).
  let activeIdx = -1;
  let currentMatches = [];
  const hideSugg = () => {
    activeIdx = -1;
    sugg.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const renderSugg = () => {
    let q = input.value.trim().toLowerCase();
    // When the input just holds the current selection, filtering to that one
    // provider is a useless echo — show the full list for browsing instead.
    const selName = this.selectedProvider && this.providerMeta[this.selectedProvider]?.display_name.toLowerCase();
    if (q && q === selName) q = '';
    currentMatches = this._providerMatches(q);
    sugg.innerHTML = '';
    if (!currentMatches.length) { hideSugg(); return; }
    currentMatches.forEach((m, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'watch-provider-suggestion' + (i === activeIdx ? ' active' : '');
      row.setAttribute('role', 'option');
      const logo = this.providerLogoEl(m.p);
      if (logo) row.appendChild(logo);
      const name = document.createElement('span');
      name.className = 'watch-provider-suggestion-name';
      name.textContent = m.p.display_name;
      row.appendChild(name);
      if (m.via) {
        const via = document.createElement('span');
        via.className = 'watch-provider-suggestion-via';
        via.textContent = m.via;
        row.appendChild(via);
      }
      // pointerdown fires before the input's blur, so focus stays put.
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        applyMatch(m.p, { source: 'row' });
        hideSugg();
      });
      sugg.appendChild(row);
    });
    sugg.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('focus', renderSugg);
  if (!inline) input.addEventListener('blur', hideSugg);
  if (inline) renderSugg();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideSugg(); return; }
    if (sugg.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { renderSugg(); return; }
    if (sugg.hidden) return;
    const rows = sugg.querySelectorAll('.watch-provider-suggestion');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = e.key === 'ArrowDown' ? Math.min(activeIdx + 1, rows.length - 1) : Math.max(activeIdx - 1, 0);
      rows.forEach((r, i) => r.classList.toggle('active', i === activeIdx));
      rows[activeIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIdx >= 0 && currentMatches[activeIdx]) {
      e.preventDefault();
      applyMatch(currentMatches[activeIdx].p, { source: 'row' });
      hideSugg();
    }
  });

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    activeIdx = -1;
    const v = input.value.trim();
    if (!v) {
      applyMatch(null, { persistInput: false });
      renderSugg();
      return;
    }
    const exact = this.providerAliasIndex.get(v.toLowerCase());
    if (exact) {
      // Typed the full name: apply it (without rewriting the input mid-word)
      // and get the list out of the way — the service areas, if any, are the
      // next step. Refocusing the input brings the full list back.
      applyMatch(this.providerMeta[exact], { persistInput: false });
      hideSugg();
    } else {
      hint.hidden = true;
      renderSugg();
    }
  });

  input.addEventListener('change', () => {
    const match = this.resolveProviderByName(input.value);
    applyMatch(match, { persistInput: !!match, source: 'blur' });
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    applyMatch(null, { persistInput: false, source: 'clear' });
    input.focus();
    renderSugg();
  });

  return wrap;
}

_renderProviderPicker(channelsEl) {
  channelsEl.innerHTML = '';
  channelsEl.appendChild(this._buildProviderInput({
    label: 'Your TV provider',
    inputId: 'watch-provider-input',
    listId: 'watch-provider-list',
    placeholder: `Search providers (e.g. ${SITE.providerExamples})…`,
    onChange: () => {
      this._renderWatchChannels(channelsEl, channelsEl._resolved, channelsEl._radioResolved);
      this._rerenderSchedule();
      this._refreshScheduleProviderDisplay();
    },
  }));
}

// Compact bar under the schedule showing the selected TV provider with a
// button that opens a modal to change it. Hidden for historical (CSV-only)
// seasons, which have no broadcast data.
renderScheduleProviderBar() {
  const bar = document.getElementById('schedule-provider-bar');
  if (!bar) return;
  const hasProviders = this.providerMeta && Object.keys(this.providerMeta).length > 0;
  const isCsvSeason = this.usesCsvData(this.currentSeason);
  bar.hidden = !hasProviders || isCsvSeason;
  if (bar.hidden) return;

  bar.innerHTML = '';

  const current = this.selectedProvider && this.providerMeta[this.selectedProvider]
    ? this.providerMeta[this.selectedProvider].display_name : null;

  const display = document.createElement('div');
  display.className = 'schedule-provider-display';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'schedule-provider-label';
  labelSpan.textContent = 'TV provider';

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'schedule-provider-change';
  changeBtn.innerHTML = current
    ? '<i class="mdi mdi-pencil"></i> Change'
    : '<i class="mdi mdi-magnify"></i> Choose';
  changeBtn.addEventListener('click', () => this.openProviderModal());

  // Providers that supply a logo get sponsor-style billing: a banner the
  // width of the bar with the name captioned underneath. The label and
  // button move to a header row above it. Without a logo, everything sits
  // on one line as before.
  const logo = current ? this.providerLogoEl(this.providerMeta[this.selectedProvider], true) : null;
  if (logo) {
    display.classList.add('schedule-provider-display-banner');
    const header = document.createElement('div');
    header.className = 'schedule-provider-header';
    header.appendChild(labelSpan);
    header.appendChild(changeBtn);
    display.appendChild(header);
    const slot = document.createElement('div');
    slot.className = 'schedule-provider-slot';
    // Banner logos link to the provider's website.
    const meta = this.providerMeta[this.selectedProvider];
    if (meta.displayLogo && meta.website_url) {
      const link = document.createElement('a');
      link.className = 'schedule-provider-logo-link';
      link.href = meta.website_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = meta.display_name;
      link.appendChild(logo);
      slot.appendChild(link);
    } else {
      slot.appendChild(logo);
    }
    const caption = document.createElement('span');
    caption.className = 'schedule-provider-caption';
    caption.textContent = current;
    slot.appendChild(caption);
    display.appendChild(slot);
  } else {
    display.appendChild(labelSpan);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'schedule-provider-name';
    if (current) {
      nameSpan.textContent = current;
    } else {
      nameSpan.classList.add('schedule-provider-none');
      nameSpan.textContent = 'Not selected';
    }
    display.appendChild(nameSpan);
    display.appendChild(changeBtn);
  }

  bar.appendChild(display);
  bar.appendChild(this.calendarRowEl());
}

// The season as a calendar subscription, with this provider's channel
// numbers in each game's title. webcal:// opens the subscribe dialog in
// Apple Calendar and Outlook; Google Calendar takes the same feed through
// its cid parameter; the copy button is for everything else.
calendarRowEl() {
  const provider = this.selectedProvider && this.providerMeta[this.selectedProvider] ? this.selectedProvider : null;
  const area = provider && this.providerMeta[provider].service_areas.length > 1 ? this.selectedServiceAreaIndex(provider) : 0;
  const path = provider ? `calendar/${encodeURIComponent(provider)}.ics${area ? `?area=${area}` : ''}` : 'calendar.ics';
  const https = new URL(path, document.baseURI).href;
  const webcal = https.replace(/^https?:/, 'webcal:');

  const row = document.createElement('div');
  row.className = 'schedule-calendar';
  const label = document.createElement('span');
  label.className = 'schedule-provider-label';
  label.innerHTML = '<i class="mdi mdi-calendar-sync"></i> Calendar';
  row.appendChild(label);

  // `external` says which link opens a new tab. It was decided by checking
  // the href for a Google prefix, which CodeQL read as URL sanitization;
  // the caller knows which link is Google's, so it says so.
  const link = (text, href, title, external = false) => {
    const a = document.createElement('a');
    a.className = 'schedule-calendar-link';
    a.href = href;
    a.textContent = text;
    a.title = title;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };
  row.appendChild(link('Subscribe', webcal, 'Apple Calendar, Outlook and most calendar apps'));
  row.appendChild(link('Google', `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, 'Add to Google Calendar', true));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'schedule-calendar-link';
  copy.innerHTML = '<i class="mdi mdi-link-variant"></i> Copy link';
  copy.addEventListener('click', async () => {
    await copyText(https);
    flashCopied(copy, '<i class="mdi mdi-check"></i> Copied');
  });
  row.appendChild(copy);

  const note = document.createElement('span');
  note.className = 'schedule-calendar-note';
  note.textContent = provider
    ? `Every game, with ${this.providerMeta[provider].display_name} channel numbers. Updates itself.`
    : 'Every game and its channel. Choose a provider to add channel numbers.';
  row.appendChild(note);
  return row;
}

initProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (!modal) return;
  const backdrop = modal.querySelector('.provider-backdrop');
  const closeBtn = document.getElementById('provider-close');
  backdrop.addEventListener('click', () => this.closeProviderModal());
  closeBtn.addEventListener('click', () => this.closeProviderModal());
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') this.closeProviderModal();
  });
}

openProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (!modal) return;
  const container = document.getElementById('provider-picker-container');
  container.innerHTML = '';
  container.appendChild(this._buildProviderInput({
    label: 'Your TV provider',
    inputId: 'schedule-provider-input',
    listId: 'schedule-provider-list',
    placeholder: `Search providers (e.g. ${SITE.providerExamples})…`,
    inline: true,
    onChange: (match, source) => {
      this._rerenderSchedule();
      const watchEl = document.getElementById('watch-channels');
      if (watchEl && watchEl._resolved) {
        this._renderWatchChannels(watchEl, watchEl._resolved, watchEl._radioResolved);
      }
      this._refreshScheduleProviderDisplay();
      // Explicitly picking a provider finishes the dialog — unless a service
      // area still needs choosing; picking the area finishes it too.
      const needsArea = match && Array.isArray(match.service_areas) && match.service_areas.length > 1;
      if (source === 'area' || (source === 'row' && !needsArea)) this.closeProviderModal();
    },
  }));
  modal.hidden = false;
  const inp = container.querySelector('input');
  if (inp) { inp.focus(); inp.select(); }
}

closeProviderModal() {
  const modal = document.getElementById('provider-modal');
  if (modal) modal.hidden = true;
}

// Update just the name/button text in the schedule bar without rebuilding it
// (used when the provider changes from elsewhere, e.g. the watch modal).
_refreshScheduleProviderDisplay() {
  // The bar's layout differs between logo (banner) and plain providers, so a
  // surgical text update isn't enough — rebuild it from the current state.
  this.renderScheduleProviderBar();
}

_renderWatchChannels(channelsEl, resolved, radioResolved) {
  // Remove previously rendered channel sections (keep the picker).
  [...channelsEl.querySelectorAll('.watch-channel-section')].forEach(el => el.remove());

  if ((!resolved || resolved.length === 0) && (!radioResolved || radioResolved.length === 0)) {
    const empty = document.createElement('p');
  empty.className = 'watch-no-data watch-channel-section';
  empty.textContent = 'No broadcast information available for this game.';
  channelsEl.appendChild(empty);
  return;
  }

  const typeOrder = ['broadcast', 'cable', 'regional', 'streaming', 'radio'];
  const typeLabels = { broadcast: 'On TV — Broadcast', cable: 'On TV — Cable', regional: 'Regional TV', streaming: 'Streaming', radio: 'Radio' };
  const groups = {};
  resolved.forEach(ch => {
    const t = typeOrder.includes(ch.type) ? ch.type : 'cable';
    if (!groups[t]) groups[t] = [];
    groups[t].push(ch);
  });
  (radioResolved || []).forEach(ch => {
    if (!groups['radio']) groups['radio'] = [];
    groups['radio'].push(ch);
  });

  const provider = this.selectedProvider && this.providerMeta[this.selectedProvider] ? this.providerMeta[this.selectedProvider] : null;
  const showChannelNum = Boolean(provider);
  // Only show channel numbers for broadcast/cable/regional — never streaming or radio.
  const numTypes = new Set(['broadcast', 'cable', 'regional']);

  typeOrder.forEach(type => {
    if (!groups[type]) return;
    const section = document.createElement('div');
    section.className = 'watch-channel-section';

    const label = document.createElement('div');
    label.className = 'watch-group-label';
    label.textContent = typeLabels[type];
    section.appendChild(label);

    const list = document.createElement('div');
    list.className = 'watch-channel-list';

    groups[type].forEach(ch => {
      const item = document.createElement('div');
      item.className = 'watch-channel-item';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'watch-channel-name';
      if (ch.website_url) {
        nameDiv.innerHTML = `<a href="${ch.website_url}" target="_blank" rel="noopener noreferrer">${ch.display_name}</a>`;
      } else {
        nameDiv.textContent = ch.display_name;
      }
      item.appendChild(nameDiv);

      if (ch.description) {
        const desc = document.createElement('div');
        desc.className = 'watch-channel-desc';
        desc.textContent = ch.description;
        item.appendChild(desc);
      }

      if (showChannelNum && numTypes.has(type)) {
        const num = this.resolveProviderChannel(provider.key, ch.key, this.selectedServiceAreaIndex(provider.key));
        const numDiv = document.createElement('div');
        numDiv.className = 'watch-channel-num';
        if (num) {
          const fmt = this.formatChannelNum(num);
          const note = fmt.ambiguous ? ` <span class="watch-channel-num-note">(listings vary — check your guide)</span>` : '';
          numDiv.innerHTML = `<span class="watch-channel-num-label">${provider.display_name}</span> <span class="watch-channel-num-value">Ch. ${fmt.text}</span>${note}`;
        } else {
          numDiv.innerHTML = `<span class="watch-channel-num-label watch-channel-num-none">Not listed for ${provider.display_name}</span>`;
        }
        item.appendChild(numDiv);
      }

      const providers = Array.isArray(ch.providers) ? ch.providers : [];
      // Merge in local providers from our lookup that carry this channel
      const localProviders = [];
      for (const pk of Object.keys(this.providerMeta)) {
        const p = this.providerMeta[pk];
        if (p.channels && p.channels[ch.key]) {
          localProviders.push(p.display_name);
        }
      }
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const seenProviders = new Set();
      const merged = [];
      for (const name of [...providers, ...localProviders]) {
        const k = norm(name);
        if (!seenProviders.has(k)) { seenProviders.add(k); merged.push(name); }
      }
      if (merged.length > 0) {
        const pDiv = document.createElement('div');
        pDiv.className = 'watch-providers';
        pDiv.textContent = 'Available on: ' + merged.join(', ');
        item.appendChild(pDiv);
      }

      list.appendChild(item);
    });

    section.appendChild(list);
    channelsEl.appendChild(section);
  });
}

async openWatchModal(event) {
  const modal = document.getElementById('watch-modal');
  const gameInfoEl = document.getElementById('watch-game-info');
  const channelsEl = document.getElementById('watch-channels');

  channelsEl.innerHTML = '<p class="watch-no-data">Loading channels…</p>';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  // Game info line
  const competition = event.competitions?.[0];
  const date = new Date(event.date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const competitors = competition?.competitors || [];
  let opponent = '';
  let isHome = false;
  competitors.forEach(c => {
    if (c.team.abbreviation === SITE.espnAbbr) isHome = c.homeAway === 'home';
    else opponent = c.team.displayName;
  });
  gameInfoEl.textContent = `${isHome ? 'vs' : '@'} ${opponent} · ${dateStr}`;

  // Extract broadcasts from the ESPN event we already have.
  // Each broadcast: { type: { shortName: 'TV'|'Streaming'|'Radio' },
  //                   market: { type: 'National'|'Home'|'Away' },
  //                   media: { shortName: 'FOX' } }
  const raw = this.broadcastsFor(event).filter(b => b.media?.shortName);
  const tv = raw.filter(b => (b.type?.shortName || '').toUpperCase() === 'TV');
  const streaming = raw.filter(b => (b.type?.shortName || '').toUpperCase() === 'STREAMING');
  const radio = raw.filter(b => (b.type?.shortName || '').toUpperCase() === 'RADIO');

  // Resolve each to our channel metadata; dedupe by display name + type.
  const resolve = (list) => {
    const seen = new Set();
    const out = [];
    for (const b of list) {
      const name = b.media.shortName;
      const ch = this.resolveChannel(name) || {
        key: name, display_name: name,
        type: b.type?.shortName?.toUpperCase() === 'STREAMING' ? 'streaming'
          : b.type?.shortName?.toUpperCase() === 'RADIO' ? 'radio' : 'cable',
        providers: [], description: null, website_url: null,
      };
      const sig = ch.display_name + '|' + ch.type;
      if (!seen.has(sig)) { seen.add(sig); out.push(ch); }
    }
    return out;
  };

  const resolved = [...resolve(tv), ...resolve(streaming)];
  const radioResolved = resolve(radio);

  // Picker (session-persistent provider) + channel sections.
  this._renderProviderPicker(channelsEl);
  channelsEl._resolved = resolved;
  channelsEl._radioResolved = radioResolved;
  this._renderWatchChannels(channelsEl, resolved, radioResolved);
}

closeWatchModal() {
  document.getElementById('watch-modal').hidden = true;
  document.body.style.overflow = '';
}

initLinescoreModal() {
  const modal = document.getElementById('linescore-modal');
  modal.querySelector('.linescore-backdrop').addEventListener('click', () => this.closeLinescoreModal());
  document.getElementById('linescore-close').addEventListener('click', () => this.closeLinescoreModal());
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') this.closeLinescoreModal();
  });
}

initStandingsModal() {
  const modal = document.getElementById('standings-modal');
  modal.querySelector('.standings-backdrop').addEventListener('click', () => this.closeStandingsModal());
  document.getElementById('standings-close').addEventListener('click', () => this.closeStandingsModal());
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') this.closeStandingsModal();
  });
}

async openStandingsModal() {
  const modal = document.getElementById('standings-modal');
  const body = document.getElementById('standings-body');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<div class="loading">Loading standings...</div>';

  try {
    // One call, every conference (ESPN's Division I, flat), and the club's
    // own shown: its conference record, then its season's.
    this._standingsData = await fetch(`api/espn/apis/v2/sports/${SITE.espnLeague}/standings?level=3`).then(r => r.json());
    body.innerHTML = this._conferenceStandingsHtml(this._standingsData);
  } catch {
    body.innerHTML = '<p class="record-empty">Could not load standings.</p>';
  }
}

/** The club's conference from ESPN's standings: in its order (ESPN's seed),
 *  with the conference record, the season's and the streak. */
_conferenceStandingsHtml(data) {
  const me = String(SITE.espnSlug);
  const conf = (data.children || []).find(c => (c.standings?.entries || []).some(e => String(e.team?.id) === me));
  if (!conf) return '<p class="record-empty">No conference standings.</p>';
  const stat = (e, type) => (e.stats || []).find(s => s.type === type)?.displayValue ?? '—';
  const seed = (e) => Number((e.stats || []).find(s => s.type === 'playoffseed')?.value) || 99;
  const rows = conf.standings.entries.slice().sort((a, b) => seed(a) - seed(b)).map(e => `<tr class="${String(e.team?.id) === me ? 'standings-brewers' : ''}">
      <td class="standings-team-cell">${e.team?.shortDisplayName || e.team?.displayName || ''}</td>
      <td class="standings-num">${stat(e, 'vsconf')}</td><td class="standings-num">${stat(e, 'total')}</td><td class="standings-num">${stat(e, 'streak')}</td>
    </tr>`).join('');
  return `<div class="standings-block"><div class="standings-div-label">${conf.name}</div>
    <div class="standings-scroll"><table class="standings-table">
      <thead><tr><th class="standings-team-cell">Team</th><th class="standings-num">Conf</th><th class="standings-num">Overall</th><th class="standings-num">Streak</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

_buildStandingsShell() {
  return `
    <div class="standings-tabs" role="tablist">
      <button class="standings-tab" data-tab="conference" role="tab">Conference</button>
      <button class="standings-tab" data-tab="division" role="tab">Division</button>
      <button class="standings-tab" data-tab="league" role="tab">NCAA</button>
    </div>
    <div class="standings-panel"></div>`;
}

_wireStandingsTabs(body) {
  body.querySelectorAll('.standings-tab').forEach(btn => {
    btn.addEventListener('click', () => this._showStandingsTab(body, btn.dataset.tab));
  });
}

_showStandingsTab(body, tab) {
  body.querySelectorAll('.standings-tab').forEach(b => b.classList.toggle('standings-tab-active', b.dataset.tab === tab));
  const panel = body.querySelector('.standings-panel');
  panel.innerHTML = this._renderStandingsTab(tab);
}

/** Conferences, each with its divisions and every entry, from the level=3
 *  payload. East first, as the league lists them. */
_parseConferences(data) {
  return (data.children || []).map(conf => ({
    name: conf.name,
    short: conf.name.replace(' Conference', ''),
    divisions: (conf.children || []).map(div => ({
      name: div.name,
      short: div.name.replace(' Division', ''),
      entries: div.standings?.entries || [],
    })),
  }));
}

_stat(entry, abbr) {
  const s = (entry.stats || []).find(st => st.abbreviation === abbr || st.name === abbr);
  return s?.displayValue ?? '—';
}

_statValue(entry, name) {
  const s = (entry.stats || []).find(st => st.name === name || st.abbreviation === name);
  return Number(s?.value);
}

_parsePct(entry) {
  const raw = this._stat(entry, 'PCT');
  return parseFloat(raw.startsWith('.') ? '0' + raw : raw) || 0;
}

_divisionTableHtml(div, showDivName, cols, playoffTags) {
  const defaultCols = ['W','L','PCT','GB','STRK','L10'];
  const activeCols = cols || defaultCols;
  const colLabels = { W:'W', L:'L', PCT:'PCT', GB:'GB', STRK:'Streak', L10:'L10', 'Last Ten Games':'L10', Home:'Home', Road:'Away', DIFF:'Diff' };

  const headers = activeCols.map(c => `<th class="standings-num">${colLabels[c] ?? c}</th>`).join('');
  const rows = div.entries.map((entry) => {
    const abbr = entry.team?.abbreviation || '';
    const isMil = abbr === SITE.espnAbbr;
    const name = entry.team?.shortDisplayName || entry.team?.displayName || abbr;
    const cells = activeCols.map(c => `<td class="standings-num">${this._stat(entry, c)}</td>`).join('');
    const tag = playoffTags?.[entry.team?.id];
    // Seeds 1-6 are in the playoffs, 7-10 in the play-in; the two tag classes
    // are the baseball page's division and wild card ones, in the same colours.
    const tagHtml = tag === 'po' ? ' <span class="standings-tag standings-tag-div">PO</span>'
                  : tag === 'pi'  ? ' <span class="standings-tag standings-tag-wc">PI</span>'
                  : '';
    return `<tr class="${isMil ? 'standings-brewers' : ''}">
      <td class="standings-team-cell">${name}${tagHtml}</td>${cells}
    </tr>`;
  }).join('');

  const header = showDivName ? `<div class="standings-div-label">${div.short}</div>` : '';
  return `<div class="standings-block">${header}
    <div class="standings-scroll">
      <table class="standings-table">
        <thead><tr><th class="standings-team-cell">Team</th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

_renderStandingsTab(tab) {
  const confs = this._parseConferences(this._standingsData);
  const cols = ['W','L','PCT','GB','STRK','L10'];

  if (tab === 'conference') {
    return confs.map(conf => {
      const seed = (e) => this._statValue(e, 'playoffSeed') || 99;
      const entries = conf.divisions.flatMap(d => d.entries).slice().sort((a, b) => seed(a) - seed(b));
      const tags = {};
      for (const e of entries) {
        const n = seed(e);
        if (n <= 6) tags[e.team?.id] = 'po';
        else if (n <= 10) tags[e.team?.id] = 'pi';
      }
      return `<div class="standings-league-section">
        ${this._divisionTableHtml({ short: conf.name, entries }, true, cols, tags)}
      </div>`;
    }).join('');
  }

  if (tab === 'division') {
    return confs.map(conf => `
      <div class="standings-league-section">
        <div class="standings-league-label">${conf.name}</div>
        ${conf.divisions.map(d => this._divisionTableHtml(d, true, cols)).join('')}
      </div>`).join('');
  }

  if (tab === 'league') {
    const all = confs.flatMap(c => c.divisions.flatMap(d => d.entries));
    all.sort((a, b) => this._parsePct(b) - this._parsePct(a));
    return this._divisionTableHtml({ short: '', entries: all }, false, ['W','L','PCT','GB','STRK','L10','Home','Road']);
  }

  return '';
}

_renderStandings(alData, nlData) {
  // kept for compatibility; not called after tab refactor
  return '';
}

closeStandingsModal() {
  document.getElementById('standings-modal').hidden = true;
  document.body.style.overflow = '';
}

openLinescoreModal(g) {
  const ls = this.lineScores?.get(g.gid);
  if (!ls) return;
  const { visitor, home } = ls;
  if (!visitor || !home) return;

  const brewersAbbr = BREWERS_IDS.has(home.team) ? home.team : visitor.team;
  const brewersIsHome = BREWERS_IDS.has(home.team);
  const oppLabel = g.Opponent;
  const brewersLabel = this.teamNames?.[brewersAbbr] || SITE.fullName;
  const visLabel = brewersIsHome ? oppLabel : brewersLabel;
  const homLabel = brewersIsHome ? brewersLabel : oppLabel;

  const date = parseLocalDate(g.date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const playerName = (id) => (id && this.playerNames?.get(id)) || null;
  const pitchers = {
    wp: playerName(g.wp),
    lp: playerName(g.lp),
    save: playerName(g.save),
  };
  const boxScoreUrl = g.gid && SITE.gamePages ? `game/${g.gid}` : '';
  this._renderLinescore(`${visLabel} @ ${homLabel} — ${dateStr}`, visitor, home, visLabel, homLabel, !brewersIsHome, boxScoreUrl, false, pitchers);
}

openLinescoreFromEvent(event) {
  const competition = event.competitions[0];
  const competitors = competition.competitors;

  let milC = null, oppC = null;
  competitors.forEach(c => {
    if (c.team.abbreviation === SITE.espnAbbr) milC = c;
    else oppC = c;
  });
  if (!milC || !oppC) return;

  const milIsHome = milC.homeAway === 'home';
  const visC = milIsHome ? oppC : milC;
  const homC = milIsHome ? milC : oppC;
  const visLabel = visC.team.displayName || visC.team.shortDisplayName || visC.team.abbreviation;
  const homLabel = homC.team.displayName || homC.team.shortDisplayName || homC.team.abbreviation;

  const date = new Date(event.date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const title = `${visLabel} @ ${homLabel} — ${dateStr}`;
  // The site's own box score page, built from ESPN's summary for a game this
  // season (espn-box-core.js): lineups, batting and pitching lines, notes.
  const boxScoreUrl = event.id && SITE.gamePages ? `game/${encodeURIComponent(event.id)}` : '';

  // Show a loading state while we fetch the full linescore from the summary endpoint.
  // The schedule endpoint omits inning-by-inning runs and H/E; the summary endpoint has them.
  this._renderLinescore(title, { inns: [], r: 0, h: 0, e: 0 }, { inns: [], r: 0, h: 0, e: 0 }, visLabel, homLabel, milIsHome, boxScoreUrl, true);

  fetch(`api/espn/apis/site/v2/sports/${SITE.espnLeague}/summary?event=${event.id}`)
    .then(r => r.json())
    .then(data => {
      const comp = data.header?.competitions?.[0];
      if (!comp?.competitors) {
        this._renderLinescoreFromSchedule(title, visC, homC, visLabel, homLabel, milIsHome, boxScoreUrl);
        return;
      }
      let milS = null, oppS = null;
      comp.competitors.forEach(c => {
        if (c.team.abbreviation === SITE.espnAbbr) milS = c;
        else oppS = c;
      });
      if (!milS || !oppS) {
        this._renderLinescoreFromSchedule(title, visC, homC, visLabel, homLabel, milIsHome, boxScoreUrl);
        return;
      }
      const visS = milIsHome ? oppS : milS;
      const homS = milIsHome ? milS : oppS;

      const toInns = (c) => {
        const ls = c.linescores || [];
        return ls.map(e => {
          const v = e.value ?? e.displayValue;
          return v === null || v === undefined ? '' : String(v);
        });
      };
      const sumHits = (c) => (c.linescores || []).reduce((s, e) => s + (parseInt(e.hits) || 0), 0);
      const sumErrors = (c) => (c.linescores || []).reduce((s, e) => s + (parseInt(e.errors) || 0), 0);

      const visitor = {
        inns: toInns(visS),
        r: parseInt(visS.score?.value ?? visS.score ?? 0),
        h: sumHits(visS),
        e: sumErrors(visS),
      };
      const home = {
        inns: toInns(homS),
        r: parseInt(homS.score?.value ?? homS.score ?? 0),
        h: sumHits(homS),
        e: sumErrors(homS),
      };
      // Basketball's in place of baseball's pitchers of record: each side's
      // leading scorer, from the summary's leaders.
      const topScorer = (abbr) => {
        const team = (data.leaders || []).find((t) => t.team?.abbreviation === abbr);
        const cat = (team?.leaders || []).find((c) => c.name === 'points');
        const best = cat?.leaders?.[0];
        return best ? `${best.athlete?.displayName ?? best.athlete?.shortName ?? ''} ${best.displayValue ?? ''}`.trim() : null;
      };
      const pitchers = { away: topScorer(visS.team.abbreviation), home: topScorer(homS.team.abbreviation), awayLabel: visS.team.abbreviation, homeLabel: homS.team.abbreviation };
      this._renderLinescore(title, visitor, home, visLabel, homLabel, milIsHome, boxScoreUrl, false, pitchers, '');
    })
    .catch(() => {
      this._renderLinescoreFromSchedule(title, visC, homC, visLabel, homLabel, milIsHome, boxScoreUrl);
    });
}

_renderLinescoreFromSchedule(title, visC, homC, visLabel, homLabel, milIsHome, boxScoreUrl) {
  const toInns = (c) => {
    const ls = c.linescores || [];
    return ls.map(e => {
      const v = e.value ?? e.displayValue;
      return v === null || v === undefined ? '' : String(v);
    });
  };
  const sumHits = (c) => (c.linescores || []).reduce((s, e) => s + (parseInt(e.hits) || 0), 0);
  const sumErrors = (c) => (c.linescores || []).reduce((s, e) => s + (parseInt(e.errors) || 0), 0);
  const visitor = {
    inns: toInns(visC),
    r: parseInt(visC.score?.value ?? visC.score ?? 0),
    h: sumHits(visC),
    e: sumErrors(visC),
  };
  const home = {
    inns: toInns(homC),
    r: parseInt(homC.score?.value ?? homC.score ?? 0),
    h: sumHits(homC),
    e: sumErrors(homC),
  };
  this._renderLinescore(title, visitor, home, visLabel, homLabel, milIsHome, boxScoreUrl);
}

_renderLinescore(title, visitor, home, visLabel, homLabel, milIsHome, boxScoreUrl = '', loading = false, pitchers = null, scoringHtml = '') {
  const modal = document.getElementById('linescore-modal');
  document.getElementById('linescore-title').textContent = title;
  const body = document.getElementById('linescore-body');

  if (loading) {
    body.innerHTML = `<div class="loading">Loading line score…</div>`;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    return;
  }

  // Four quarters, and as many overtimes as were played.
  const maxInns = Math.max(
    ...visitor.inns.map((v, i) => (v !== '' ? i + 1 : 0)),
    ...home.inns.map((v, i) => (v !== '' ? i + 1 : 0)),
    4
  );

  const formatCell = (val) => (val === '' || val === undefined || val === null ? '' : val);
  const periodName = (i) => (i < 4 ? String(i + 1) : i === 4 ? 'OT' : `OT${i - 3}`);

  const innHeaders = Array.from({ length: maxInns }, (_, i) => `<th>${periodName(i)}</th>`).join('');
  const visInns = Array.from({ length: maxInns }, (_, i) => `<td>${formatCell(visitor.inns[i])}</td>`).join('');
  const homInns = Array.from({ length: maxInns }, (_, i) => `<td>${formatCell(home.inns[i])}</td>`).join('');

  // One total; basketball has no hits or errors.
  const rheHeaders = `<th class="linescore-rhe">T</th>`;
  const visRhe = `<td class="linescore-rhe linescore-total">${visitor.r}</td>`;
  const homRhe = `<td class="linescore-rhe linescore-total">${home.r}</td>`;

  body.innerHTML = `
    <div class="linescore-wrap">
      <table class="linescore-table">
        <thead>
          <tr>
            <th class="linescore-team-col">Team</th>
            ${innHeaders}
            ${rheHeaders}
          </tr>
        </thead>
        <tbody>
          <tr class="${milIsHome ? '' : 'linescore-brewers'}">
            <td class="linescore-team-col">${visLabel}</td>
            ${visInns}
            ${visRhe}
          </tr>
          <tr class="${milIsHome ? 'linescore-brewers' : ''}">
            <td class="linescore-team-col">${homLabel}</td>
            ${homInns}
            ${homRhe}
          </tr>
        </tbody>
      </table>
    </div>
    ${pitchers ? this._renderPitchers(pitchers) : ''}
    ${scoringHtml}
    ${boxScoreUrl ? (boxScoreUrl.startsWith('game/')
      ? `<a class="linescore-box-link" href="${boxScoreUrl}">Full Box Score <i class="mdi mdi-arrow-right"></i></a>`
      : `<a class="linescore-box-link" href="${boxScoreUrl}" target="_blank" rel="noopener noreferrer">Full Box Score on ESPN <i class="mdi mdi-open-in-new"></i></a>`) : ''}
  `;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

// Each side's leading scorer, in the baseball page's pitcher-of-record row.
_renderPitchers(pitchers) {
  const items = [];
  if (pitchers.away) items.push(`<span class="linescore-pitcher"><span class="linescore-pitcher-label">${esc(pitchers.awayLabel)}</span><span class="linescore-pitcher-name">${esc(pitchers.away)}</span></span>`);
  if (pitchers.home) items.push(`<span class="linescore-pitcher"><span class="linescore-pitcher-label">${esc(pitchers.homeLabel)}</span><span class="linescore-pitcher-name">${esc(pitchers.home)}</span></span>`);
  if (!items.length) return '';
  return `<div class="linescore-pitchers">${items.join('')}</div>`;
}

closeLinescoreModal() {
  document.getElementById('linescore-modal').hidden = true;
  document.body.style.overflow = '';
}

initGallery() {
  const modal = document.getElementById('photo-gallery-modal');
  const backdrop = modal.querySelector('.gallery-backdrop');
  const closeBtn = document.getElementById('gallery-close');

  backdrop.addEventListener('click', () => this.closeGallery());
  closeBtn.addEventListener('click', () => this.closeGallery());
  document.addEventListener('keydown', (e) => {
     if (!document.getElementById('lightbox').hidden) {
        if (e.key === 'Escape') this.closeLightbox();
        else if (e.key === 'ArrowLeft') this.stepLightbox(-1);
        else if (e.key === 'ArrowRight') this.stepLightbox(1);
    } else if (!modal.hidden) {
        if (e.key === 'Escape') this.closeGallery();
    }
});

  const lightbox = document.getElementById('lightbox');
  document.getElementById('lightbox-close').addEventListener('click', () => this.closeLightbox());
  document.getElementById('lightbox-prev').addEventListener('click', () => this.stepLightbox(-1));
  document.getElementById('lightbox-next').addEventListener('click', () => this.stepLightbox(1));
  lightbox.addEventListener('click', (e) => {
     if (e.target === lightbox || e.target === document.getElementById('lightbox-img')) this.closeLightbox();
 });
}

openLightbox(photo, photos) {
  this._lightboxPhotos = photos;
  this._lightboxIndex = photos.indexOf(photo);
  this._renderLightbox();
  document.getElementById('lightbox').hidden = false;
}

_renderLightbox() {
  const photos = this._lightboxPhotos;
  const idx = this._lightboxIndex;
  const photo = photos[idx];

  document.getElementById('lightbox-img').src = photo.url;
  document.getElementById('lightbox-img').alt = photo.caption;
  document.getElementById('lightbox-caption').textContent = photo.caption;
  const licenseEl = document.getElementById('lightbox-license');
  if (photo.license_url) {
     licenseEl.innerHTML = `License: <a href="${photo.license_url}" target="_blank" rel="noopener noreferrer">${photo.license}</a>`;
 } else {
     licenseEl.textContent = `License: ${photo.license}`;
 }
 document.getElementById('lightbox-prev').classList.toggle('hidden', idx === 0);
 document.getElementById('lightbox-next').classList.toggle('hidden', idx === photos.length - 1);
}

stepLightbox(dir) {
  const next = this._lightboxIndex + dir;
  if (next < 0 || next >= this._lightboxPhotos.length) return;
  this._lightboxIndex = next;
  this._renderLightbox();
}

closeLightbox() {
  document.getElementById('lightbox').hidden = true;
}

openGallery(season) {
  const modal = document.getElementById('photo-gallery-modal');
  const grid = document.getElementById('gallery-grid');
  const title = document.getElementById('gallery-title');
  const photos = this.photosBySeason[season] || [];

  title.textContent = `${SITE.seasonLabel(season)} Season Photos`;
  grid.innerHTML = '';

  photos.forEach(p => {
     const item = document.createElement('div');
     item.className = 'gallery-item';

     const img = document.createElement('img');
     img.src = p.url;
     img.alt = p.caption;
     img.loading = 'lazy';
     img.addEventListener('click', () => this.openLightbox(p, photos));

     const info = document.createElement('div');
     info.className = 'gallery-item-info';

     const caption = document.createElement('p');
     caption.className = 'gallery-caption';
     caption.textContent = p.caption;

     const license = document.createElement('p');
     license.className = 'gallery-license';
     if (p.license_url) {
        license.innerHTML = `License: <a href="${p.license_url}" target="_blank" rel="noopener noreferrer">${p.license}</a>`;
    } else {
        license.textContent = `License: ${p.license}`;
    }

    info.appendChild(caption);
    info.appendChild(license);
    item.appendChild(img);
    item.appendChild(info);
    grid.appendChild(item);
});

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

closeGallery() {
  const modal = document.getElementById('photo-gallery-modal');
  modal.hidden = true;
  document.body.style.overflow = '';
}

showError(message) {
  const answerEl = document.getElementById('answer');
  const recordEl = document.getElementById('record');

  if (answerEl) {
     answerEl.innerHTML = `<div style="color: var(--loss-light, #ff6b6b);">${message}</div>`;
     answerEl.className = 'answer error';
 }

 if (recordEl) {
     recordEl.textContent = 'Unable to load data';
 }
}
}

document.addEventListener('DOMContentLoaded', () => {
   // Exposed for debugging in the console.
   window.__brewersTracker = new BrewersTracker();
});
