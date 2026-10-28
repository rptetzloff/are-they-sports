// A season named as the club pages name it, everywhere the server draws one
// (Ray, 2026-10-27: "fix it everywhere").
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seasonName, seasonSpan, SPLIT_SEASONS } from '../lib/seasons.js'
import { championsPage, standingsPage, leagueSchedulePage } from '../lib/render.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COLORS = { base: '#222', accent: '#fff' }

test('the sports split across two years are exactly those whose club pages say so', () => {
	for (const sport of readdirSync(join(ROOT, 'web'))) {
		const site = join(ROOT, 'web', sport, 'site.js')
		if (!existsSync(site)) continue
		const split = /seasonLabel: \(season\) => `\$\{Number\(season\) - 1\}-\$\{season\}`/.test(readFileSync(site, 'utf8'))
		assert.equal(SPLIT_SEASONS.has(sport), split, sport)
	}
	assert.equal(seasonName('nba', 2027), '2026-2027')
	assert.equal(seasonName('nfl', 2026), '2026')
	assert.equal(seasonName('nhl', null), '')
	assert.equal(seasonSpan('nba', 1967, 2026), '1966–2026')
	assert.equal(seasonSpan('mlb', 2001, 2005), '2001–2005')
	assert.equal(seasonSpan('nhl', 2016, 2016), '2015-2016')
})

test('champions, standings and the schedule name the season so', () => {
	const champs = championsPage({ heading: 'NBA champions', colors: COLORS, champions: [
		{ sport: 'nba', season: 2016, league: 'NBA', champion: 'CLE', championName: 'Cavaliers', runnerUp: 'GSW', runnerUpName: 'Warriors', method: 'championship series' },
		{ sport: 'nba', season: 1950, league: 'NBA', champion: 'MNL', championName: 'Lakers', method: 'championship series' },
	] })
	assert.match(champs, /<td class="dim">2015-2016<\/td>/)
	assert.match(champs, /2 titles, 1949–2016/)
	const stand = standingsPage({ standings: { season: 2027, groups: [] }, label: 'NHL', seasons: [2026, 2027], season: 2027, heading: 'NHL', colors: COLORS })
	assert.match(stand, /<h1>NHL standings 2026-2027<\/h1>/)
	assert.match(stand, /<span class="current">2026-2027<span class="season-word"> Season<\/span><\/span>/)
	const sched = leagueSchedulePage({ schedule: { season: 2025, seasons: [2025], periods: [], period: null }, heading: 'NCAAM', colors: COLORS, resolve: (c) => ({ name: c }), label: 'NCAAM' })
	assert.match(sched, /<h1>NCAAM schedule 2024-2025<\/h1>/)
	// Several sports on one page keep the number: no one way to name it.
	const all = standingsPage({ standings: { season: 2026, groups: [] }, label: 'NFL', more: [{ label: 'NBA', standings: { season: 2027, groups: [] } }], seasons: [2026, 2027], heading: 'Every club', colors: COLORS })
	assert.match(all, /league-heading">NBA 2026-2027</)
	assert.match(all, /league-heading">NFL 2026</)
})
