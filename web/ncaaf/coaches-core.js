import { SITE } from './site.js';
import { rec } from './records-core.js';

/** Title case for a manifest noun used at the start of a heading. The
 *  manifest stores lowercase because most uses are mid-sentence. */
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// Head-coach rows for the coaches page and the history chart's eras.
//
// IN are-they-sports: the Packers site computed these in the browser from a
// curated file of tenures, which only the Packers had. Every club's coaches
// are tallied on the server instead (lib/leaders.js: games per coach where
// nflverse has them, the stated tenures before 1999), numbered in the club's
// own count, and served as data/coaches.json. This turns that tally into the
// rows the Packers' pages drew. Pure functions only.

export const slugifyCoach = (name) =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** data/coaches.json's coaches, in the club's order, as the pages' rows. */
export function coachRows({ coaches = [] } = {}) {
	return [...coaches]
		.sort((a, b) => (a.num ?? 0) - (b.num ?? 0) || (a.firstSeason ?? 0) - (b.firstSeason ?? 0))
		.map((l) => {
			const games = l.w + l.l + l.t;
			const playoffGames = (l.playoffW ?? 0) + (l.playoffL ?? 0);
			return {
				name: l.name, slug: slugifyCoach(l.name),
				interim: Boolean(l.interim),
				num: l.num, numLabel: l.label ?? String(l.num ?? ''),
				firstSeason: l.firstSeason, lastSeason: l.lastSeason,
				tenure: l.firstSeason === l.lastSeason ? String(l.firstSeason) : `${l.firstSeason}–${l.lastSeason}`,
				wins: l.w, losses: l.l, ties: l.t,
				record: rec(l.w, l.l, l.t),
				winPct: games ? (l.w + l.t / 2) / games : 0,
				playoffGames,
				playoffWins: l.playoffW ?? 0,
				playoffRecord: playoffGames ? rec(l.playoffW ?? 0, l.playoffL ?? 0, 0) : null,
				titles: (l.titles ?? []).length,
			};
		});
}

// Meta copy for the /coaches page, shared by server OG meta and client share.
export function coachesCopy(data) {
	const { coaches } = data;
	const regular = coaches.filter((c) => !c.interim).length;
	const wins = [...coaches].sort((a, b) => b.wins - a.wins)[0];
	const titles = coaches.reduce((s, c) => s + c.titles, 0);
	return {
		title: `${SITE.team} Head ${cap(SITE.leaderPlural)}, ${coaches[0].firstSeason}–present`,
		desc: `Every ${SITE.fullName} head ${SITE.leaderNoun} and their record — ${regular} of them (plus interim stints), ${titles} championships. Most wins: ${wins.name} (${wins.record}).`,
	};
}
