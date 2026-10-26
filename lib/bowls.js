/** College football bowls' names and the rows that give them: the parsing
 *  scripts/ncaaf-bowls.mjs does, kept apart so it can be tested without the
 *  network. */

/** A sponsor's name off a bowl's: "Rose Bowl Game Presented by Prudential",
 *  "CFP NATIONAL CHAMPIONSHIP GAME PRES. BY AT&T", "R+L CARRIERS NEW ORLEANS
 *  BOWL" keeps its sponsor: it is the bowl's name. Capitals become title case. */
export function bowlName(note) {
	// ESPN's older notes end with the place: ROSE BOWL AT PASADENA CA.
	let n = String(note ?? '').trim().replace(/\s+(presented|pres\.?|powered)\s+by\s+.*$/i, '').replace(/\s+AT\s+[A-Z .,'-]+$/, '').trim();
	if (n && n === n.toUpperCase()) n = n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bCfp\b/, 'CFP').replace(/\bR\+l\b/, 'R+L');
	return n;
}

export const plain = (cell) => cell.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?|<[^>]+>|\{\{[^}]*\}\}/g, '').replace(/^\s*(?:align|style|rowspan|colspan)=[^|]*\|/i, '').trim();
/** Bowl rows from a page: a row linking "<year> <name>" and giving two scores. */
export function bowlRows(text) {
	const out = [];
	for (const row of text.split(/\n\|-/)) {
		const link = /\[\[(\d{4}) ([^\]|]*?(?:Bowl|Classic|Game)[^\]|]*?)(?:\s*\((?:January|December)[^)]*\))?(?:\|[^\]]*)?\]\]/.exec(row);
		if (!link) continue;
		// Each team linked to its season's article, its score right after:
		// "'''[[1985 Fresno State Bulldogs football team|Fresno State]]''' 51".
		const linked = [...row.matchAll(/\[\[[^\]|]*football team\|([^\]]+)\]\]'*\s*(\d{1,3})\b/g)];
		if (linked.length >= 2) {
			out.push({ year: Number(link[1]), bowl: link[2].trim(), scores: linked.slice(0, 2).map((m) => Number(m[2])), teams: linked.slice(0, 2).map((m) => m[1]) });
			continue;
		}
		const teamLinks = [...row.matchAll(/\[\[[^\]|]*football team\|([^\]]+)\]\]/g)].map((m) => m[1]);
		const rawCells = row.split(/\n\||\|\|/);
		// Or the result in one cell, a name and score a line: "'''USC 20'''<br>Texas A&M 0" (1975).
		const lines = rawCells.map((c) => [...c.replace(/'''?/g, '').matchAll(/([A-Za-z][A-Za-z.&'() -]*?)\s+(\d{1,3})\s*(?=<br\s*\/?>|$)/g)]).find((m) => m.length === 2);
		if (lines) {
			out.push({ year: Number(link[1]), bowl: link[2].trim(), scores: lines.map((m) => Number(m[2])), teams: [...lines.map((m) => m[1]), ...teamLinks] });
			continue;
		}
		// Or the score as a pair in a cell of its own: "13–7" (1965).
		const pair = rawCells.map((c) => /^\s*(\d{1,3})\s*[–-]\s*(\d{1,3})\s*$/.exec(plain(c))).find(Boolean);
		if (pair) {
			out.push({ year: Number(link[1]), bowl: link[2].trim(), scores: [Number(pair[1]), Number(pair[2])], teams: teamLinks });
			continue;
		}
		// Else a cell a team and a cell a score, as the 1950s pages have them.
		const cells = rawCells.map(plain).filter(Boolean);
		const scores = cells.filter((c) => /^\d{1,3}$/.test(c)).map(Number);
		if (scores.length < 2) continue;
		const teams = cells.filter((c) => !/^\d{1,3}$/.test(c) && c !== link[2] && !/^(?:No\.\s*\d+\s*)?$/.test(c)).map((c) => c.replace(/^No\.\s*\d+\s*/, ''));
		out.push({ year: Number(link[1]), bowl: link[2].trim(), scores: scores.slice(0, 2), teams });
	}
	return out;
}
