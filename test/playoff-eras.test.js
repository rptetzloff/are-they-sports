// Best playoff runs ranked within each playoff format (Ray, 2026-10-30): a
// champion needed 8 wins in the NHL of 1967 and 16 in 1987's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLAYOFF_ERAS } from '../lib/league.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const siteEras = (sport) => {
	const text = readFileSync(join(ROOT, 'web', sport, 'site.js'), 'utf8')
	const block = text.slice(text.indexOf('playoffEras: ['), text.indexOf('],', text.indexOf('playoffEras: [')))
	return [...block.matchAll(/\{ label: '([^']*)'(?:, from: (\d+))?(?:, to: (\d+))? \}/g)]
		.map(([, label, from, to]) => ({ label, ...(from ? { from: Number(from) } : {}), ...(to ? { to: Number(to) } : {}) }))
}

for (const sport of ['mlb', 'nba', 'nhl']) {
	test(`${sport}: the club and league pages rank the same eras, with no season left out`, () => {
		const eras = PLAYOFF_ERAS[sport]
		assert.deepEqual(siteEras(sport), eras)
		assert.equal(eras[0].from, undefined, 'the first runs from the beginning')
		assert.equal(eras.at(-1).to, undefined, 'the last runs on')
		for (let i = 1; i < eras.length; i++) assert.equal(eras[i].from, eras[i - 1].to + 1, eras[i].label)
	})
}
