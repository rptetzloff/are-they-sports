// The TV provider picker, the "where to watch" dialog, the schedule's
// provider bar and calendar row, and the channel numbers they show: the
// baseball page's own methods (web/mlb/main.js), copied verbatim, for the
// football page (Ray, 2026-10-21: "the provider selector should appear on all
// sports").
//
// Installed onto the page's class (installTvUi) rather than rewritten, so the
// two pages pick a provider the same way, and a method the page defines itself
// is kept, not overwritten. What these ask of the page: displaySchedule(events,
// isPast) and its _lastScheduleEvents / _lastIsPastSeason, usesCsvData(season),
// currentSeason, updateIntentLinks() and _lastResult ({ tvStatus, tvGame }).
//
// Built by a script from web/mlb/main.js; a change to the baseball page's
// picker is a change to make here too.
import { SITE } from './site.js';
import { copyText, flashCopied } from './share-core.js';
import { parseTvLookup, resolveChannel, tvStatus, primaryBroadcast, providerChannel, formatChannelNum, channelNumberFor, parseSimulcasts, broadcastsWithSimulcasts, dayCT, EMPTY_LOOKUP } from './tv-core.js';
import { coverageOf } from './coverage-core.js';

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class TvUi {
// The state the methods read, as the baseball page's constructor sets it.
initTvState() {
  this.channelMeta = {};
  this.providerMeta = {};
  this.providerAliasIndex = new Map();
  this.tvLookup = EMPTY_LOOKUP;
  this.simulcastsByDate = new Map();
  try { this.selectedProvider = localStorage.getItem('tvProvider') || null; } catch { this.selectedProvider = null; }
}

// The three files the server builds from its TV tables (lib/tv.js). Without
// them the page has no providers, and shows no picker.
async loadTv() {
  const [channels, providers, simulcasts] = await Promise.all(
    ['channel_lookup', 'provider_lookup', 'simulcasts'].map((f) => fetch(`data/${f}.csv`).catch(() => null)));
  if (channels?.ok && providers?.ok) this._loadTvLookup(await channels.text(), await providers.text());
  this.simulcastsByDate = simulcasts?.ok ? parseSimulcasts(await simulcasts.text()) : new Map();
  this.initWatchModal();
  this.initProviderModal();
}

        	simulcastChannelsFor(game) {
        		if (!this.simulcastsByDate?.size || !game?.date) return [];
        		return this.simulcastsByDate.get(dayCT(game.date)) || [];
        	}

        	// A game's broadcasts plus synthetic TV entries for any local
        	// simulcast stations that day. Use this instead of reading the ESPN
        	// broadcasts array directly. The TV logic itself is tv-core.js,
        	// shared with the server's link previews and the calendar feed.
        	broadcastsFor(game) {
        		const all = broadcastsWithSimulcasts(game, this.simulcastsByDate);
        		// A streaming-only game's over-the-air simulcast is the home
        		// markets' alone: Wausau has a Packers game on CBS, but not a
        		// Thursday night one on Green Bay's station. Where the week's
        		// coverage lists the stations and the viewer's market is not among
        		// them, the simulcast is not theirs to watch.
        		const cov = this.regionalOf(game);
        		if (cov && 'simulcast' in cov && this.selectedDma() && !cov.simulcast) return all.filter((b) => !b._simulcast);
        		// And where it is the viewer's, the station's network, so their
        		// area's channel for it is named (Green Bay's NBC, WGBA) without a
        		// simulcast day entered by hand.
        		if (cov?.station && !all.some((b) => b._simulcast)) {
        			return [...all, { media: { shortName: cov.station.net }, type: { shortName: 'TV' }, market: { type: 'Home' }, _simulcast: true, _station: cov.station.call }];
        		}
        		return all;
        	}

        	// The viewer's TV market: their provider's service area's (set in the
        	// admin), or null when no provider is chosen or the area has none.
        	selectedDma() {
        		const p = this.selectedProvider && this.providerMeta?.[this.selectedProvider];
        		if (!p) return null;
        		return p.service_area_dmas?.[this.selectedServiceAreaIndex(this.selectedProvider)] || null;
        	}

        	// The week's coverage maps (api/coverage, from 506sports), fetched
        	// once a week a page; the note and the schedule redraw when they land.
        	coverageFor(event) {
        		const season = event?.season?.year, week = event?.week?.number;
        		// The regular season only: 506sports maps no playoff game. A schedule's
        		// event says seasonType.type, a scoreboard's season.type.
        		if (!season || !week || (event?.seasonType?.type ?? event?.season?.type) !== 2) return null;
        		const key = `${season}|${week}`;
        		this._coverage ??= new Map();
        		if (!this._coverage.has(key)) {
        			this._coverage.set(key, null);
        			fetch(`api/coverage?season=${season}&week=${week}`)
        				.then((r) => (r.ok ? r.json() : null))
        				.then((c) => {
        					if (!c || !(c.regional?.length || c.national?.length)) return;
        					this._coverage.set(key, c);
        					this.refreshAnswerNote();
        					this._rerenderSchedule();
        				})
        				.catch(() => {});
        		}
        		return this._coverage.get(key);
        	}

        	// What the coverage says of this game for the viewer's market
        	// (coverage-core.js coverageOf), or null.
        	regionalOf(event) {
        		return coverageOf(this.coverageFor(event), event, this.selectedDma());
        	}

        	// "CBS · regional" or "CBS · not here" for a schedule row.
        	regionalLabel(event, b) {
        		const cov = this.regionalOf(event);
        		if (!cov?.regional || cov.network !== String(b?.media?.shortName || '').toUpperCase()) return null;
        		return cov.carried === false ? 'not in your area' : cov.carried === null ? 'regional' : null;
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
        			return ch ? tvTypes.has(ch.type) : (x.type?.shortName || '') === 'TV';
        		}));
        		if (!b) return '';
        		const ch = this.resolveChannel(b.media.shortName);
        		const network = ch?.display_name || b.media.shortName;
        		// A regional CBS or FOX game this market's station does not carry:
        		// say which it carries instead, not a channel the game is not on.
        		const regional = this.regionalNoteHtml(tvGame, b);
        		if (regional?.instead) return `<div class="answer-provider-note">${regional.html}</div>`;
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
        		return `<div class="answer-provider-note">${provider.display_name} has the ${gameWord} on ${network}${num ? ` (Ch. ${num})` : ''}${regional ? ` · ${regional.html}` : ''}</div>`;
        	}

        	// What a regional game means for the viewer's market (coverage-core.js),
        	// as a fragment of the note, or null for a game every station has.
        	// { instead: true } when this market's station carries another game.
        	regionalNoteHtml(game, b = this._primaryOf(this.broadcastsFor(game))) {
        		const cov = this.regionalOf(game);
        		if (!cov?.regional || cov.network !== String(b?.media?.shortName || '').toUpperCase()) return null;
        		const map = `<a href="${escHtml(cov.map)}" target="_blank" rel="noopener noreferrer">coverage map</a>`;
        		const provider = this.selectedProvider && this.providerMeta[this.selectedProvider];
        		const area = provider?.service_areas?.[this.selectedServiceAreaIndex(this.selectedProvider)] || 'your area';
        		if (cov.carried === false) return { instead: true, html: `${escHtml(cov.network)} in ${escHtml(area)} has ${escHtml(cov.other)} instead · ${map}` };
        		if (cov.carried === null) return { instead: false, html: `regional on ${escHtml(cov.network)}: it depends on your area · ${map}` };
        		return null;
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
  const tv = raw.filter(b => (b.type?.shortName || '') === 'TV');
  const streaming = raw.filter(b => (b.type?.shortName || '') === 'Streaming');
  const radio = raw.filter(b => (b.type?.shortName || '') === 'Radio');

  // Resolve each to our channel metadata; dedupe by display name + type.
  const resolve = (list) => {
    const seen = new Set();
    const out = [];
    for (const b of list) {
      const name = b.media.shortName;
      const ch = this.resolveChannel(name) || {
        key: name, display_name: name,
        type: b.type?.shortName === 'Streaming' ? 'streaming'
          : b.type?.shortName === 'Radio' ? 'radio' : 'cable',
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

}

/** Give the page's class the methods it does not already have. */
export function installTvUi(Target) {
  for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(TvUi.prototype))) {
    if (name === 'constructor' || Object.prototype.hasOwnProperty.call(Target.prototype, name)) continue;
    Object.defineProperty(Target.prototype, name, desc);
  }
}
