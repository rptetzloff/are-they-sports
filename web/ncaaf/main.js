        import { parseGamesCsv, computeSeasonHistory, localDate, seasonTally, onThisDayCandidates, onThisDayPool, onThisDayView, streakBannerHtml, esc, seasonBeingPlayed } from './records-core.js';
import { SITE } from './site.js';
import { scheduleListHtml, monthChipsHtml } from './schedule-core.js';
import { loadGames } from './games-client.js';
import { withScoreboard, tvLineOf } from './scoreboard-core.js';
import { installTvUi } from './tv-ui.js';
import { fieldTrackerHtml } from './field-core.js';
import { gameSummaryHtml, gameTitle } from './game-core.js';
import { seasonVerdict } from './lib/season-state.js';
        import { computeHeadToHead, canonicalOpponent } from './h2h-core.js';
        import { buildChartSvg } from './history-chart.js';
        import { intentUrls, copyText, flashCopied, wireShareDropdown } from './share-core.js';

        function buildSeasonMap(games) {
        	const map = {};
        	games.forEach(g => {
        		const yr = parseInt(g.season);
        		if (!map[yr]) map[yr] = [];
        		map[yr].push(g);
        	});
        	return map;
        }

        class PackersTracker {
        	constructor() {
        		this.apiUrl = `api/espn/apis/site/v2/sports/${SITE.espnLeague}/teams/${SITE.espnSlug}/schedule`;
        		this.scoreboardUrl = `api/espn/apis/site/v2/sports/${SITE.espnLeague}/scoreboard`;
        		this.countdownInterval = null;
        		this.liveUpdateInterval = null;
        		this.currentSeason = null;
        		this.latestSeason = null;
        		this.earliestSeason = SITE.firstSeason;
        		this.csvBySeason = {};
        		this.csvMaxSeason = 2020;
        		this.seasonRecords = {};
        		this.photosBySeason = {};
        		// The TV provider picker's state (tv-ui.js).
        		this.initTvState();
        		this.init();
        	}

        	async init() {
        		try {
        			['streak-details', 'otd-details'].forEach(id => {
        				const details = document.getElementById(id);
        				if (!details) return;
        				const stored = localStorage.getItem(`sectionOpen:${id}`);
        				if (stored !== null) details.open = stored === 'true';
        				details.addEventListener('toggle', () => {
        					localStorage.setItem(`sectionOpen:${id}`, details.open ? 'true' : 'false');
        				});
        			});

        			const [loaded, recordsRes, photosRes] = await Promise.all([
        				loadGames().catch(() => null),
        				fetch('data/season_records.csv'),
        				fetch('./data/photos.csv'),
        				// Providers and channel numbers (tv-ui.js), before the schedule
        				// that shows them. Without them the page has no picker.
        				this.loadTv().catch(e => console.error(e)),
        			]);
        			if (loaded) {
        				// The season map is the file's alone: it decides which seasons
        				// are read from the CSV, and the season being played is read
        				// from ESPN. Head-to-head and the history spark count every
        				// game, the season being played included (games-client.js).
        				const { games, fileGames } = loaded;
        				this.csvBySeason = buildSeasonMap(fileGames);
        				// name -> all-time head-to-head entry, for schedule annotations
        				this.h2hByName = new Map(computeHeadToHead(games).opponents.map(o => [o.name, o]));
        				this.seasonHistory = computeSeasonHistory(games);
        				this.renderHistorySpark();
        				const seasons = Object.keys(this.csvBySeason).map(Number).sort((a, b) => a - b);
        				if (seasons.length) {
        					this.earliestSeason = seasons[0];
        					this.csvMaxSeason = seasons[seasons.length - 1];
        				}
        			}
        			if (recordsRes.ok) {
        				const raw = await recordsRes.text();
        				parseGamesCsv(raw).forEach(r => {
        					this.seasonRecords[parseInt(r.season)] = r;
        				});
        			}
        			if (photosRes.ok) {
        				const raw = await photosRes.text();
        				parseGamesCsv(raw).forEach(p => {
        					const yr = parseInt(p.season);
        					if (!this.photosBySeason[yr]) this.photosBySeason[yr] = [];
        					this.photosBySeason[yr].push(p);
        				});
        			}
        			this.initGallery();
        			this.initSummaryModal();
        			this.buildOnThisDay();
        			const params = new URLSearchParams(window.location.search);
        			const seasonParam = params.get('season');
        			const pathMatch = window.location.pathname.match(/\/(\d{4})\/?$/);
        			const requestedSeason = seasonParam
                    ? parseInt(seasonParam, 10)
                    : pathMatch ? parseInt(pathMatch[1], 10) : null;
                    await this.fetchPackersData(requestedSeason || undefined);
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
          const past = this.currentSeason && this.latestSeason && this.currentSeason < this.latestSeason;
          el.textContent = past
              ? `Were the ${SITE.team} Undefeated in ${this.currentSeason}?`
              : SITE.title;
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
          const label = document.getElementById('season-label');
          const prevBtn = document.getElementById('season-prev');
          const nextBtn = document.getElementById('season-next');
          const prev10Btn = document.getElementById('season-prev10');
          const next10Btn = document.getElementById('season-next10');
          const firstBtn = document.getElementById('season-first');
          const lastBtn = document.getElementById('season-last');

          label.textContent = `${this.currentSeason} Season`;
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
         await this.fetchPackersData(year);
     } catch (error) {
         this.showError('Failed to load season data');
     }
 }

 // A past season comes from the CSV. The season being played comes from
 // ESPN even once its games are in the CSV, which would show it as finished;
 // the CSV is only its fallback when ESPN fails (hasCsvSeason).
 usesCsvData(season) {
  return this.hasCsvSeason(season) && season < seasonBeingPlayed();
}

 hasCsvSeason(season) {
  return season != null && season <= this.csvMaxSeason && this.csvBySeason[season] != null;
}

async fetchPackersData(season) {
        		// For seasons covered by the CSV, use local data
  if (season && this.usesCsvData(season)) {
     this.processCsvSeasonData(season);
     return;
 }

 try {
     const seasonParam = season ? `&season=${season}` : '';
     // The season being played also reads this week's scoreboard, which
     // knows a game is live minutes before the team schedule does
     // (scoreboard-core.js). A past season's games are all settled.
     const current = !season || season === this.latestSeason;
     const [preRes, regularRes, postRes, scoreboard] = await Promise.all([
        fetch(`${this.apiUrl}?seasontype=1${seasonParam}`),
        fetch(`${this.apiUrl}?seasontype=2${seasonParam}`),
        fetch(`${this.apiUrl}?seasontype=3${seasonParam}`),
        current ? fetch(this.scoreboardUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    ]);
     const [preData, regularData, postData] = await Promise.all([
        preRes.json(),
        regularRes.json(),
        postRes.json(),
    ]);

     const preEvents = (preData.events || []).map(e => ({ ...e, _seasonType: 'pre' }));
     const regularEvents = (regularData.events || []).map(e => ({ ...e, _seasonType: 'regular' }));
     const postEvents = (postData.events || []).map(e => ({ ...e, _seasonType: 'post' }));
     const allEvents = withScoreboard([...preEvents, ...regularEvents, ...postEvents], scoreboard);

     const mergedData = { ...regularData, events: allEvents };

        			// If ESPN returns no events and we have CSV data, fall back to CSV
     if (allEvents.length === 0 && season && this.hasCsvSeason(season)) {
        this.processCsvSeasonData(season);
        return;
    }

    // 'in' covers every in-game status — halftime, end of a quarter, a
    // delay — where the list of names this used to check missed some.
    const liveGame = allEvents.find(event => event.competitions?.[0]?.status?.type?.state === 'in');

    if (liveGame) {
        await this.fetchLiveGameScore(liveGame, mergedData);
    } else {
        this.processScheduleData(mergedData);
    }
} catch (error) {
        			// If ESPN fetch fails and we have CSV data for this season, use it
 if (season && this.hasCsvSeason(season)) {
    this.processCsvSeasonData(season);
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
        			// from a CSV season directly, use the current year as a proxy
     this.latestSeason = new Date().getFullYear();
 }
 this.updateSeasonSelector();

 document.getElementById('schedule-title').innerHTML = `<i class="mdi mdi-calendar-month"></i> ${season} Season Schedule`;

        		// The tally lives in records-core so it can be tested; this method
        		// renders. Both halves used to be here, which is how every past
        		// season came to show 0-0 with nothing failing.
 const { wins, losses, ties, postseason, championshipName, undefeated } = seasonTally(games);

 this.displayResult(seasonVerdict({ wins, losses, ties, isPastSeason: true }), wins, losses, ties, true, championshipName, postseason, null);
 this.displayCsvSchedule(games, season);
 this.showLastUpdated();
 this.setDataCredit(true);
 this.updateLastUndefeated(wins, losses);
 this.setupShareButtons();

 const csvCompletedGames = games
 .filter(g => g.regular_season === '1' && g.result)
 .map(g => ({ result: g.result, date: new Date(g.date) }));
 this.updateStreakBanner(csvCompletedGames, season !== this.latestSeason);
}

// The all-time head-to-head against an opponent, linking to its rivalry
// page, as { href, text, title } for a schedule row. Null for an opponent
// with no CSV history (shouldn't happen).
h2hLink(opponentName) {
  const o = this.h2hByName?.get(canonicalOpponent(opponentName));
  if (!o) return null;
  return { href: `vs/${o.slug}`, text: o.record, title: `${SITE.team} vs ${o.name} — all-time head-to-head` };
}

// The same, as the note on the pinned game's card.
h2hNote(opponentName) {
  const link = this.h2hLink(opponentName);
  if (!link) return null;
  const note = document.createElement('a');
  note.className = 'game-h2h';
  note.href = link.href;
  note.textContent = `All-time: ${link.text}`;
  note.title = link.title;
  return note;
}

// A past season (the CSV): every game a compact row (schedule-core.js).
displayCsvSchedule(games, season) {
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  // Head-to-head notes only make sense on the current season's schedule.
  const showH2h = season === this.latestSeason;
  const rows = sorted.map((g) => {
    const res = g.result === 'WIN' ? 'win' : g.result === 'LOSS' ? 'loss' : 'tie';
    const isSuperBowl = Boolean(g.championship && g.championship.trim());
    // From 1999 a game carries ESPN's id: its row opens the summary and
    // links to the box score page, as this season's do. Before 1999 there
    // is no box score to link to.
    const id = g.espnId;
    return {
      key: id || `${g.date}-${g.Opponent}`, date: localDate(g.date),
      clickable: Boolean(id), title: id ? 'Summary' : '',
      links: id ? {
        summary: true,
        box: SITE.gamePages ? `game/${encodeURIComponent(id)}` : null,
        espn: `https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(id)}`,
      } : null,
      // HOME, AWAY or NEUTRAL; a neutral site reads "vs", as the card did.
      home: g.location !== 'AWAY',
      opp: g.Opponent, state: res,
      text: `${res === 'win' ? 'W' : res === 'loss' ? 'L' : 'T'} ${parseInt(g.scoreFor) || 0}-${parseInt(g.scoreAgainst) || 0}`,
      tv: isSuperBowl ? [g.championship] : [],
      phase: g.playoff === '1' ? 'post' : g.regular_season === '1' ? 'regular' : 'other',
      h2h: showH2h ? this.h2hLink(g.Opponent) : null,
    };
  });
  this.renderScheduleList(rows, { regular: 'Regular Season', post: 'Playoffs', other: 'Other' }, { season, featured: null, scrollTo: null });
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
 * — the 30-second live refresh — keeps the reader's place. Before, every
 * refresh scrolled it back.
 */
renderScheduleList(rows, phaseLabels, { season, featured, scrollTo }) {
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  const pinned = document.getElementById('schedule-featured');
  const sameSeason = this._scheduleSeason === `${season}`;
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
    this._scheduleSeason = `${season}`;
    const target = scrollTo && grid.querySelector(`.sched-row[data-key="${CSS.escape(String(scrollTo))}"]`);
    if (target) this.centerInSchedule(target);
    else grid.scrollTop = 0;
  }
  this.markActiveMonth();
}

// A row opens where to watch a game still to come (tv-ui.js), and the
// summary of one played or being played.
openScheduleRow(row) {
  const event = this._eventsById?.get(row.dataset.key);
  if (event?.competitions?.[0]?.status?.type?.state === 'pre') return this.openWatchModal(event);
  return this.openGameSummary(row.dataset.key, row);
}

// The month chips and the list's scrolling, wired once: the list is
// redrawn, its container is not.
wireSchedule() {
  if (this._scheduleWired) return;
  this._scheduleWired = true;
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  // A played game's row opens its summary; so does its Summary button. Box,
  // ESPN and the head-to-head link follow their own hrefs and must not also
  // open the summary behind them. The row's keyboard handling leaves the
  // links to their own Enter.
  grid.addEventListener('click', (e) => {
    const link = e.target.closest('.sched-link, .sched-h2h');
    if (link && link.dataset.act !== 'summary') return;
    const row = e.target.closest('.sched-row.sched-click');
    if (row) this.openScheduleRow(row);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.target.closest('.sched-link, .sched-h2h')) return;
    const row = e.target.closest('.sched-row.sched-click');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.openScheduleRow(row); }
  });
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.sched-chip');
    if (!chip) return;
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

// Light the chip standing for the group at the top of the list.
markActiveMonth() {
  const grid = document.getElementById('schedule-grid');
  const chips = document.getElementById('schedule-months');
  // The first group not scrolled fully past the top, so a phase divider at
  // the top marks the group below it rather than the one that just ended.
  let current = null;
  const groups = [...grid.querySelectorAll('.sched-group')];
  for (const group of groups) {
    if (group.offsetTop + group.offsetHeight > grid.scrollTop + 8) { current = group.dataset.group; break; }
  }
  // Scrolled to the bottom, the last groups can never reach the top: the
  // chip clicked to get there is the one lit, or, scrolled there by hand,
  // the season's last group.
  const atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
  if (atBottom && grid.scrollTop > 0) current = this._chipTarget || groups[groups.length - 1]?.dataset.group || current;
  chips.querySelectorAll('.sched-chip').forEach((c) => {
    const on = Boolean(current) && (c.dataset.covers || '').split(' ').includes(current);
    c.classList.toggle('active', on);
  });
}

        	// The live game's detail. Its status, scores and situation are already
        	// the scoreboard's (scoreboard-core.js, merged in fetchPackersData).
        	// What this adds is the game's box score from /api/boxscore/<id>,
        	// about 5KB during a game, for the field and the drive's plays on the
        	// live card. It used to re-fetch the scoreboard and, when the game was
        	// not on it, ESPN's whole summary: 600KB every 30 seconds.
        	async fetchLiveGameScore(liveGame, scheduleData) {
        		const sit = liveGame.competitions?.[0]?.situation;
        		if (sit) {
        			liveGame.lastPlay = {
        				downDistanceText: sit.downDistanceText,
        				possession: sit.possession,
        				drive: sit.lastPlay?.drive,
        				text: sit.lastPlay?.text,
        			};
        		}
        		try {
        			const res = await fetch(`api/boxscore/${encodeURIComponent(liveGame.id)}`, { cache: 'no-cache' });
        			if (res.ok) {
        				const box = await res.json();
        				liveGame._box = box;
        				// The scores too, should the scoreboard have failed.
        				for (const c of liveGame.competitions[0].competitors) {
        					const t = c.team.abbreviation === box.home.abbr ? box.home : c.team.abbreviation === box.away.abbr ? box.away : null;
        					if (t && t.score !== '' && c.score == null) c.score = { value: Number(t.score), displayValue: String(t.score) };
        				}
        			}
        		} catch (error) {
        			console.error('Live box score failed:', error);
        		}
        		this.processScheduleData(scheduleData);
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
        		if (!isPastSeason && this.isOffseason(events)) {
        			this.displayOffseasonMessage();
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
        				let packersScore = 0, opponentScore = 0;
        				competitors.forEach(competitor => {
        					if (competitor.team.abbreviation === SITE.espnAbbr) {
        						packersScore = parseInt(competitor.score.value) || 0;
        					} else {
        						opponentScore = parseInt(competitor.score.value) || 0;
        					}
        				});
        				if (packersScore > opponentScore) w++;
        				else if (packersScore < opponentScore) l++;
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
        			return status === 'STATUS_FINAL' && event._seasonType === 'regular';
        		});

        		const completedPost = events.filter(event => {
        			const status = event.competitions?.[0]?.status?.type?.name;
        			return status === 'STATUS_FINAL' && event._seasonType === 'post';
        		});

        		const preRecord = countRecord(completedPre);
        		const { w: wins, l: losses, t: ties } = countRecord(completedRegular);
        		const postRecord = countRecord(completedPost);

        		let superBowlName = null;
        		completedPost.forEach(event => {
        			const notes = event.competitions?.[0]?.notes || [];
        			const sbNote = notes.find(n => /super bowl/i.test(n.headline || ''));
        			if (!sbNote) return;
        			const competitors = event.competitions[0].competitors;
        			let packersScore = 0, opponentScore = 0;
        			competitors.forEach(c => {
        				if (c.team.abbreviation === SITE.espnAbbr) packersScore = parseInt(c.score?.value) || 0;
        				else opponentScore = parseInt(c.score?.value) || 0;
        			});
        			if (packersScore > opponentScore) superBowlName = sbNote.headline;
        		});

        		const verdict = seasonVerdict({ wins, losses, ties, isPastSeason });
        		// The question is whether they are on TV (Ray, 2026-10-21): the
        		// game on now, else the next one, as the baseball page asks it.
        		// Only for the season being played; a past season answers with
        		// how it ended.
        		let tvGame = null;
        		if (!isPastSeason) {
        			const now = new Date();
        			tvGame = events.find(e => e.competitions?.[0]?.status?.type?.state === 'in')
        				|| events.filter(e => new Date(e.date) > now && e.competitions?.[0]?.status?.type?.state === 'pre')
        					.sort((a, b) => new Date(a.date) - new Date(b.date))[0]
        				|| null;
        		}
        		this.displayResult(verdict, wins, losses, ties, isPastSeason, superBowlName, postRecord, preRecord, tvGame);
        		this.displaySchedule(events, isPastSeason);
        		this.showLastUpdated();
        		this.setDataCredit(false);
        		this.updateLastUndefeated(wins, losses);
        		this.setupShareButtons();

        		const espnCompletedGames = completedRegular.map(event => {
        			const competitors = event.competitions[0].competitors;
        			let packersScore = 0, opponentScore = 0;
        			competitors.forEach(c => {
        				if (c.team.abbreviation === SITE.espnAbbr) packersScore = parseInt(c.score?.value || c.score || 0);
        				else opponentScore = parseInt(c.score?.value || c.score || 0);
        			});
        			const result = packersScore > opponentScore ? 'WIN' : packersScore < opponentScore ? 'LOSS' : 'TIE';
        			return { result, date: new Date(event.date) };
        		});
        		this.updateStreakBanner(espnCompletedGames, isPastSeason);
        	}

        	updateScheduleTitle(year, seasonType) {
        		const titleEl = document.getElementById('schedule-title');
        		if (!titleEl) return;
        		const yearLabel = year ? `${year} ` : '';
        		const isRegular = !seasonType || seasonType.toLowerCase().includes('regular');
        		const typeLabel = !isRegular ? ` (${seasonType})` : '';
        		titleEl.innerHTML = `<i class="mdi mdi-calendar-month"></i> ${yearLabel}Season Schedule${typeLabel}`;
        	}

        	isOffseason(events) {
        		const now = new Date();
        		const isOffseasonMonth = now.getMonth() >= 2 && now.getMonth() <= 7;
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
        		answerEl.textContent = 'OFFSEASON';
        		answerEl.className = 'answer offseason';
        		document.body.classList.remove('undefeated');
        		document.body.classList.add('offseason');

        		recordEl.textContent = 'The season hasn\'t started yet!';
        	}

        	// The answer's second line: the selected provider's channel when there
        	// is one (tv-ui.js _providerNoteHtml), else when and where the game is.
        	// The baseball page's version adds only the provider's line; this page
        	// has said when and where since it began asking the TV question.
        	refreshAnswerNote() {
        		const answerEl = document.getElementById('answer');
        		if (!answerEl) return;
        		answerEl.querySelector('.answer-provider-note')?.remove();
        		const { tvGame, isPastSeason, superBowlName } = this._lastResult || {};
        		if (isPastSeason || superBowlName || !tvGame) return;
        		const where = tvLineOf(tvGame);
        		// A regional CBS or FOX game says so, with that week's coverage map,
        		// when no provider's market says whether this station has it.
        		const regional = this.regionalNoteHtml(tvGame);
        		const html = this._providerNoteHtml() || (where ? `<div class="answer-provider-note">${esc(where)}${regional ? ` · ${regional.html}` : ''}</div>` : '');
        		if (html) answerEl.insertAdjacentHTML('beforeend', html);
        	}

        	displayResult(verdict, wins, losses, ties, isPastSeason = false, superBowlName = null, postRecord = null, preRecord = null, tvGame = null) {
        		const answerEl = document.getElementById('answer');
        		const recordEl = document.getElementById('record');

        		this._lastResult = { verdict, wins, losses, ties, isPastSeason, superBowlName, postRecord, preRecord, tvGame };
        		this._isOffseason = false;

        		// The answer is the word alone. It used to sit between rows of
        		// emoji, a cheese a win and a sad face a loss, behind a toggle;
        		// both went in October 2026.
        		if (superBowlName) {
        			answerEl.innerHTML = `${esc(superBowlName.toUpperCase())}<br>CHAMPIONS!`;
        			answerEl.className = 'answer champions';
        			document.body.classList.remove('undefeated');
        		} else if (!isPastSeason) {
        			// On TV: the game on now, else the next, by ESPN's word for each
        			// of its broadcasts. Nothing left on the schedule is a NO.
        			// tv-core.js's rule, with the channel table where it knows a
        			// network and ESPN's own word where it does not.
        			const status = this.getTvStatus(tvGame);
        			this._lastResult.tvStatus = status;
        			answerEl.textContent = { yes: 'YES!!!', streaming: 'STREAMING ONLY', no: 'NO' }[status];
        			answerEl.className = `answer ${status}`;
        			document.body.classList.toggle('undefeated', status === 'yes');
        			this.refreshAnswerNote();
        			// As on the baseball page: the answer opens where to watch.
        			const watchable = tvGame && this.broadcastsFor(tvGame).some(b => b.media?.shortName);
        			answerEl.style.cursor = watchable ? 'pointer' : '';
        			answerEl.title = watchable ? 'Click to see where to watch' : '';
        			answerEl.onclick = watchable ? () => this.openWatchModal(tvGame) : null;
        		} else if (verdict === 'undefeated') {
        			// A past season without a loss still says so, as a fact rather
        			// than as the answer to the question.
        			answerEl.textContent = 'UNDEFEATED';
        			answerEl.className = 'answer yes';
        			document.body.classList.add('undefeated');
        		} else {
        			// A past season: no answer; the record says it.
        			answerEl.textContent = '';
        			answerEl.className = 'answer past';
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
                ? `Playoff Record: ${postRecord.w}-${postRecord.l}-${postRecord.t}`
                : `Playoff Record: ${postRecord.w}-${postRecord.l}`)
             : null;

             let html = '';
             if (preText) html += `<span class="preseason-record">${preText}</span><br>`;
             html += regularText;
             if (postText) html += `<br><span class="playoff-record">${postText}</span>`;
             recordEl.innerHTML = html;
         }

         displaySchedule(events, isPastSeason = false) {
          const now = new Date();
          // Kept for the TV picker, which redraws the schedule with channel
          // numbers when the provider changes (tv-ui.js _rerenderSchedule), and
          // for a row's click to find its game.
          this._lastScheduleEvents = events;
          this._lastIsPastSeason = isPastSeason;
          this._eventsById = new Map(events.map(e => [String(e.id), e]));

          const sortedEvents = events.sort((a, b) => new Date(a.date) - new Date(b.date));

          const nextGame = sortedEvents.find(event => {
             const gameDate = new Date(event.date);
             const status = event.competitions?.[0]?.status?.type?.name;
             return gameDate > now && status === 'STATUS_SCHEDULED';
         });

          const liveGame = sortedEvents.find(event => event.competitions?.[0]?.status?.type?.state === 'in');

          const rows = sortedEvents.map((event) => this.espnScheduleRow(event, nextGame, liveGame, isPastSeason));
          // The live game, else the next one, as the full card above the list:
          // the live detail, or the countdown.
          const pinnedEvent = !isPastSeason ? (liveGame || nextGame) : null;
          const featured = pinnedEvent ? this.createGameItem(pinnedEvent, nextGame, liveGame, now) : null;
          // The latest game played (or the one being played) is where the
          // list opens.
          const latest = [...sortedEvents].reverse().find((e) => ['post', 'in'].includes(e.competitions?.[0]?.status?.type?.state));
          this.renderScheduleList(rows, { pre: 'Preseason', regular: 'Regular Season', post: 'Playoffs' }, {
             season: `${this.currentSeason}`, featured, scrollTo: latest?.id ?? null,
          });

          if (!isPastSeason && liveGame) this.startLiveUpdates();
          this.renderScheduleProviderBar();
    }

    // One ESPN game as a schedule row: result, live score or start time, and
    // its network for games still to come.
    espnScheduleRow(event, nextGame, liveGame, isPastSeason) {
      const comp = event.competitions[0];
      const st = comp.status?.type || {};
      const gb = comp.competitors.find((c) => c.team.abbreviation === SITE.espnAbbr);
      const opp = comp.competitors.find((c) => c !== gb) || {};
      const score = (c) => parseInt(c?.score?.value ?? c?.score?.displayValue ?? c?.score ?? 0) || 0;
      const date = new Date(event.date);
      const isLive = liveGame && event.id === liveGame.id;
      let state;
      let text;
      if (st.state === 'post' && st.name === 'STATUS_FINAL') {
        const [p, o] = [score(gb), score(opp)];
        state = p > o ? 'win' : p < o ? 'loss' : 'tie';
        text = `${state === 'win' ? 'W' : state === 'loss' ? 'L' : 'T'} ${p}-${o}`;
      } else if (isLive || st.state === 'in') {
        state = 'live';
        text = `${score(gb)}-${score(opp)} ${st.shortDetail || ''}`.trim();
      } else if (st.state === 'post') {
        state = 'postponed';
        text = st.shortDetail || st.description || 'Postponed';
      } else {
        state = nextGame && event.id === nextGame.id ? 'next' : 'upcoming';
        text = event.timeValid === false ? 'TBD' : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      const upcoming = state === 'next' || state === 'upcoming';
      // The networks to name, with the selected provider's channel number
      // (tv-ui.js), as the baseball page's rows have them.
      const tvLabels = this.scheduleBroadcasts(event).map(b => {
        // A regional game this market's station does not carry has no channel
        // to give (coverage-core.js); one with no market to check says so.
        const regional = this.regionalLabel(event, b);
        const num = regional ? null : this.scheduleChannelNumber(b);
        return `${this.resolveChannel(b.media.shortName)?.display_name || b.media.shortName}${num ? ` ${num}` : ''}${regional ? ` (${regional})` : ''}`;
      });
      return {
        key: String(event.id), date, phase: event._seasonType,
        home: gb?.homeAway === 'home',
        opp: opp.team?.shortDisplayName || opp.team?.name || opp.team?.displayName || '',
        state, text,
        tv: upcoming ? tvLabels : [],
        // H2H only on the current season's schedule (offseason included).
        h2h: this.currentSeason === this.latestSeason ? this.h2hLink(opp.team?.displayName) : null,
        // A game played or being played: its summary pop-up, which a click
        // anywhere on the row also opens, its box score page, and ESPN's.
        links: upcoming || state === 'postponed' ? null : {
          summary: true,
          box: SITE.gamePages ? `game/${encodeURIComponent(event.id)}` : null,
          espn: `https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(event.id)}`,
        },
        // A game to come opens where to watch it; a played one its summary.
        clickable: state !== 'postponed' && (!upcoming || tvLabels.length > 0),
        title: !upcoming && state !== 'postponed' ? 'Summary' : '',
      };
    }

    // The schedule's pop-up for one game: the box score's summary
    // (game-core.js), from /api/boxscore/<id>, which the server reduces from
    // ESPN's 600KB summary to about 15KB. Focus goes back to the row that
    // opened it.
    async openGameSummary(id, opener) {
      const modal = document.getElementById('summary-modal');
      const title = document.getElementById('summary-title');
      const body = document.getElementById('summary-body');
      this._summaryOpener = opener || null;
      this._summaryId = id;
      title.textContent = 'Game Summary';
      body.innerHTML = '<div class="loading">Loading…</div>';
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.getElementById('summary-close').focus();
      try {
        const res = await fetch(`api/boxscore/${encodeURIComponent(id)}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const box = await res.json();
        // A slow answer for a game the reader has since closed or replaced.
        if (this._summaryId !== id || modal.hidden) return;
        title.textContent = gameTitle(box);
        body.innerHTML = gameSummaryHtml(box);
      } catch (err) {
        if (this._summaryId !== id) return;
        body.innerHTML = SITE.gamePages
          ? `<p class="record-empty">Could not load this game. <a href="game/${encodeURIComponent(id)}">Open its box score</a> instead.</p>`
          : '<p class="record-empty">Could not load this game.</p>';
        console.error('Summary error:', err);
      }
    }

    closeGameSummary() {
      const modal = document.getElementById('summary-modal');
      if (modal.hidden) return;
      modal.hidden = true;
      this._summaryId = null;
      document.body.style.overflow = '';
      this._summaryOpener?.focus();
    }

    initSummaryModal() {
      const modal = document.getElementById('summary-modal');
      modal.querySelector('.gallery-backdrop').addEventListener('click', () => this.closeGameSummary());
      document.getElementById('summary-close').addEventListener('click', () => this.closeGameSummary());
      document.addEventListener('keydown', (e) => {
        if (!modal.hidden && e.key === 'Escape') this.closeGameSummary();
      });
    }

createGameItem(event, nextGame, liveGame, now) {
  const competition = event.competitions[0];
  const competitors = competition.competitors;
  const status = competition.status;
  const date = new Date(event.date);

  const isLive = liveGame && event.id === liveGame.id;

  let packersScore = 0;
  let opponentScore = 0;
  let opponent = '';
  let isHome = false;

  competitors.forEach(competitor => {
     if (competitor.team.abbreviation === SITE.espnAbbr) {
        packersScore = parseInt(
           competitor.score?.value ||
           competitor.score?.displayValue ||
           competitor.score ||
           0
           );
        isHome = competitor.homeAway === 'home';
    } else {
        opponentScore = parseInt(
           competitor.score?.value ||
           competitor.score?.displayValue ||
           competitor.score ||
           0
           );
        opponent = competitor.team.displayName;
    }
});

  const gameItem = document.createElement('div');
  gameItem.className = 'game-item';

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
     if (packersScore > opponentScore) {
        gameItem.classList.add('win');
    } else if (packersScore < opponentScore) {
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

const dateDiv = document.createElement('div');
dateDiv.className = 'game-date';

// The networks, with the selected provider's channel number, as the baseball
// card has them (tv-ui.js).
const network = this.scheduleBroadcasts(event).map(b => {
  const regional = this.regionalLabel(event, b);
  const num = regional ? null : this.scheduleChannelNumber(b);
  return `${esc(this.resolveChannel(b.media.shortName)?.display_name || b.media.shortName)}${num ? ` <span class="game-channum">Ch. ${esc(num)}</span>` : ''}${regional ? ` <span class="game-channum">${esc(regional)}</span>` : ''}`;
}).join('<span class="game-network-sep"> · </span>');

if (isLive || isInProgress) {
 dateDiv.innerHTML = `<span class="live-indicator-small"></span>LIVE NOW${network ? ` · <span class="game-network">${network}</span>` : ''}`;
} else {
 const dateText = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});
 dateDiv.innerHTML = network
 ? `${dateText} · <span class="game-network">${network}</span>`
 : dateText;
}

gameDetails.appendChild(opponentDiv);
gameDetails.appendChild(dateDiv);

// H2H notes only on the current season's schedule (offseason included —
// displaySchedule's isPastSeason arg also covers "don't autoscroll", so
// key off the season instead).
if (this.currentSeason === this.latestSeason) {
 const h2h = this.h2hNote(opponent);
 if (h2h) gameDetails.appendChild(h2h);
}

if (isLive || isInProgress) {
 const statusDiv = document.createElement('div');
 statusDiv.className = 'game-status';
 statusDiv.textContent = status.type.detail || status.type.shortDetail || 'Live';
 gameDetails.appendChild(statusDiv);

 // The field with the drive under way (field-core.js), from the game's box
 // score; the text below is what shows when that could not be fetched.
 if (event._box && (event._box.drive || event._box.situation)) {
    const tracker = document.createElement('div');
    tracker.className = 'live-card-tracker';
    tracker.innerHTML = fieldTrackerHtml(event._box);
    gameDetails.appendChild(tracker);
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
    countdownDiv.textContent = '🏈 Game Time!';
}

gameDetails.appendChild(countdownDiv);
}

gameInfo.appendChild(gameDetails);
gameItem.appendChild(gameInfo);

if (isCompleted) {
 const scoreDiv = document.createElement('div');
 scoreDiv.className = 'game-score';

 let resultIndicator = '';
 if (packersScore > opponentScore) {
    scoreDiv.classList.add('win');
    resultIndicator = 'W ';
} else if (packersScore < opponentScore) {
    scoreDiv.classList.add('loss');
    resultIndicator = 'L ';
} else {
    resultIndicator = 'T ';
}

const scoreLink = document.createElement('a');
if (SITE.gamePages) scoreLink.href = `game/${encodeURIComponent(event.id)}`;
scoreLink.textContent = `${resultIndicator}${packersScore}-${opponentScore}`;
scoreLink.style.color = 'inherit';
scoreLink.style.textDecoration = 'none';

scoreDiv.appendChild(scoreLink);
scoreDiv.style.textAlign = 'center';
scoreDiv.style.marginTop = '0.5rem';
scoreDiv.style.width = '100%';
gameItem.appendChild(scoreDiv);
} else if (isLive || isInProgress) {
 const scoreDiv = document.createElement('div');
 scoreDiv.className = 'game-score live';

 const scoreLink = document.createElement('a');
 if (SITE.gamePages) scoreLink.href = `game/${encodeURIComponent(event.id)}`;
 scoreLink.textContent = `${packersScore}-${opponentScore}`;
 scoreLink.style.color = 'inherit';
 scoreLink.style.textDecoration = 'none';

 scoreDiv.appendChild(scoreLink);
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

  this.liveUpdateInterval = setInterval(async () => {
     try {
        await this.fetchPackersData();
    } catch (error) {
        console.error('Error updating live game:', error);
    }
}, 30000);
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

getShareMessage() {
  const season = this.currentSeason;
  const isPast = season && this.latestSeason && season < this.latestSeason;

  if (this._isOffseason) {
     return `🏈 ${SITE.fullName} offseason - can't wait for the ${season} season!${SITE.tag}`;
 }

 if (!this._lastResult) return `${SITE.fullName} ${season} season${SITE.tag}`;

 const { verdict, wins, losses, ties, superBowlName } = this._lastResult;

 if (superBowlName) {
     return `🏆 The ${season} ${SITE.fullName} won ${superBowlName.toUpperCase()}!${SITE.tag}`;
 }

 const recordText = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

 if (isPast) {
     if (verdict === 'undefeated') {
        return `${SITE.emoji || '🏈'} The ${season} ${SITE.fullName} finished the regular season UNDEFEATED at ${recordText}!${SITE.tag}`;
    } else {
        return `The ${season} ${SITE.fullName} finished ${recordText}.${SITE.tag}`;
    }
} else {
 // A share of a season that has not started should say so rather than
 // announcing a 0-0 record as though it were news.
 if (verdict === 'not-started') {
    return `🏈 ${SITE.copy.seasonNotStarted} — the ${season} ${SITE.fullName} season is almost here!${SITE.tag}`;
}
 if (verdict === 'undefeated') {
    return `${SITE.emoji || '🏈'} The ${SITE.fullName} are UNDEFEATED so far in ${season}! ${recordText} ${SITE.emoji || '🏈'}${SITE.tag}`;
} else {
    return `The ${SITE.fullName} are ${recordText} so far in the ${season} season.${SITE.tag}`;
}
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

buildOnThisDay() {
  const el = document.getElementById('on-this-day');
  if (!el) return;

  const dateParam = new URLSearchParams(window.location.search).get('otd');
  const today = dateParam ? localDate(`2000-${dateParam}`) : new Date();
  const todayMonth = isNaN(today) ? new Date().getMonth() : today.getMonth();
  const todayDay = isNaN(today) ? new Date().getDate() : today.getDate();

  const candidates = onThisDayCandidates(this.csvBySeason, todayMonth, todayDay);
  const pool = candidates.length ? onThisDayPool(candidates, this.photosBySeason) : [];

  // Packers born today, from /api/born: the exact day, where the games look
  // three days either side. The game renders at once and the birthdays join
  // it when they arrive; on a day with no game near it, the birthdays are
  // the card.
  this._otdBirths = [];
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  if (pick) this._renderOnThisDay(el, pick, pool);
  else el.hidden = true;
  const monthDay = `${String(todayMonth + 1).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
  fetch(`api/born/${monthDay}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((born) => {
      this._otdBirths = Array.isArray(born) ? born : [];
      if (!this._otdBirths.length) return;
      // The game shown may have changed with the refresh button.
      if (pick) this._renderOnThisDay(el, this._otdPick || pick, pool);
      else this._renderBirthsOnly(el);
    })
    .catch(() => {});
}

// ?otd= comes from the address bar, so it is escaped where it becomes HTML:
// unescaped, /?otd=<img src=x onerror=…> ran script in the page (CodeQL
// alert #2, js/xss). Everything else in the card comes from the CSV and is
// escaped too, rather than trusted.
_otdResetLink() {
  const otdParam = new URLSearchParams(window.location.search).get('otd');
  return otdParam
  ? `<a class="otd-reset" href="${esc(window.location.pathname)}" aria-label="Reset date override">Using ${esc(otdParam)} &times;</a>`
  : '';
}

// "Born on this day: Aaron Rodgers (1983) · …": the three longest Packers
// careers, linked to their pages, and a count of the rest.
_birthsHtml() {
  const born = this._otdBirths || [];
  if (!born.length) return '';
  const shown = born.slice(0, 3).map((b) => `<a href="player/${esc(b.id)}">${esc(b.name)}</a> <span class="otd-born-year">(${esc(b.year)})</span>`);
  const more = born.length > 3 ? ` <span class="otd-born-year">+ ${born.length - 3} more</span>` : '';
  return `<div class="otd-born"><i class="mdi mdi-cake-variant"></i> Born on this day: ${shown.join(' · ')}${more}</div>`;
}

_renderBirthsOnly(el) {
  el.innerHTML = `
        			<div class="otd-header">
        				<span class="otd-label"><i class="mdi mdi-calendar-today"></i> On This Day in ${SITE.team} History</span>
        				<span class="otd-actions">${this._otdResetLink()}</span>
        			</div>
    ${this._birthsHtml()}`;
  el.hidden = false;
}

_renderOnThisDay(el, pick, pool) {
  const { season } = pick;
  const { opponent, resultClass, resultLabel, scoreText, gameTypeLabel, dateStr } = onThisDayView(pick);

  // The same game drawn again, when the birthdays arrive, keeps its photo.
  const photos = this.photosBySeason[season] || [];
  const photo = this._otdPick === pick ? this._otdPhoto
    : (photos.length ? photos[Math.floor(Math.random() * photos.length)] : null);
  this._otdPick = pick;
  this._otdPhoto = photo;
  const resetLink = this._otdResetLink();

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
        						<a href="${season}" class="otd-year">${season} Season</a>
        						<span class="otd-game-type">${esc(gameTypeLabel)}</span>
        					</div>
        					<div class="otd-game-row">
        						<span class="otd-result-badge ${esc(resultClass)}">${esc(resultLabel)}</span>
        						<span class="otd-matchup">vs. ${esc(opponent)}</span>
    ${scoreText ? `<span class="otd-score">${esc(scoreText)}</span>` : ''}
        					</div>
        					<div class="otd-date">${esc(dateStr)}, ${esc(season)}</div>
        				</div>
        			</div>
    ${this._birthsHtml()}
`;
el.hidden = false;

document.getElementById('otd-refresh')?.addEventListener('click', () => {
 if (pool.length > 1) {
    const next = pool.filter(c => c !== pick)[Math.floor(Math.random() * (pool.length - 1))];
    this._renderOnThisDay(el, next, pool);
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

updateStreakBanner(completedGames, isPastSeason) {
  const el = document.getElementById('streak-banner');
  if (!el) return;
  // The six sentences live in records-core, where they are reachable by a test.
  const html = streakBannerHtml(completedGames, { isPastSeason });
  if (html === null) { el.hidden = true; return; }
  el.innerHTML = html;
  el.hidden = false;
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
     if (parseInt(r.reg_l) === 0 && parseInt(r.reg_w) > 0) {
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

  title.textContent = `${season} Season Photos`;
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
     answerEl.innerHTML = `<div style="color: #ff6b6b;">${message}</div>`;
     answerEl.className = 'answer error';
 }

 if (recordEl) {
     recordEl.textContent = 'Unable to load data';
 }
}
}

// The baseball page's TV provider picker, "where to watch" and channel numbers.
installTvUi(PackersTracker);

document.addEventListener('DOMContentLoaded', () => {
   new PackersTracker();
});
