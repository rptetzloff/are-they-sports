// Does the site fit a phone? Ask the browser, not a screenshot.
//
// `chrome --headless --screenshot --window-size=390,900` DOES NOT give a 390px
// viewport on Windows. The window has a minimum width, the page lays out wider
// than asked for, and the image is cropped to the size requested — so the
// picture shows a clipped heading and a cut-off column on a page that is
// perfectly fine. A list of four overflowing pages produced that way was wrong
// about two of them and missed the worst one. Above about 500px the command is
// honest, which is why CLAUDE.md's 1400px technique has held up.
//
// This drives the same browser over the DevTools protocol instead and sets
// `Emulation.setDeviceMetricsOverride`, which is the real thing. Node ships a
// WebSocket client, so it costs no dependency — the same bar every other tool
// in this repo is held to.
//
// It answers what a screenshot cannot: WHICH element is too wide. When
// /coaches was 174px over, the answer was `table.league-table.leaders-table`,
// and every offender on every page was a `<table>`. That is what turned a
// vague "tables overflow" into a one-rule fix.
//
// Measured after the fix: 0 of 16 pages overflow at 320, 360, 390 and 1400.
//
//   node scripts/viewport.mjs [width] [baseUrl]
//
// It needs a server already running with games loaded, because an unavailable
// club answers 503 and a 503 page has no table on it to be too wide.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const WIDTH = Number(process.argv[2] ?? 390);
const BASE = process.argv[3] ?? 'http://localhost:3000';
const PORT = 9333;

// Chrome's location is not discoverable in any portable way, so it is a list
// rather than a guess, and it says so when none of them is there.
const CANDIDATES = [
	process.env.CHROME_PATH,
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

// One page per SHAPE, not per route: the four that overflowed were four
// different tables, and a fifth copy of the same table proves nothing.
const PAGES = [
	'/', '/nfl/packers', '/nfl/packers/2011', '/nfl/packers/records',
	'/nfl/packers/history', '/nfl/packers/vs', '/nfl/packers/vs/chi',
	'/nfl/packers/coaches', '/nfl/packers/champions', '/nfl/packers/schedule',
	'/nfl/packers/standings', '/mlb/brewers', '/mlb/brewers/vs/atl',
	'/mlb/brewers/managers', '/nfl/records', '/nfl/schedule/2011',
];

// Deduplicated to the OUTERMOST offender: a table inside an overflowing section
// reports both, and only the outer one is the thing to fix.
const PROBE = `(() => {
	const vw = document.documentElement.clientWidth;
	const depth = (n) => { let k = 0; while ((n = n.parentElement)) k++; return k; };
	const bad = [];
	for (const el of document.querySelectorAll('body *')) {
		const r = el.getBoundingClientRect();
		if (r.width <= vw + 0.5 && r.right <= vw + 0.5) continue;
		bad.push({ tag: el.tagName.toLowerCase(), cls: el.className || '', w: Math.round(r.width), depth: depth(el) });
	}
	bad.sort((a, b) => a.depth - b.depth);
	return JSON.stringify({
		over: document.documentElement.scrollWidth - vw,
		offenders: bad.slice(0, 3),
	});
})()`;

const launch = () => {
	for (const path of CANDIDATES) {
		try {
			return spawn(path, [
				'--headless', '--disable-gpu', `--remote-debugging-port=${PORT}`,
				'--no-first-run', '--user-data-dir=' + (process.env.TEMP ?? '/tmp') + '/ats-viewport',
				'about:blank',
			], { stdio: 'ignore' });
		} catch { /* try the next one */ }
	}
	throw new Error(`no chrome found. Tried:\n  ${CANDIDATES.join('\n  ')}\nSet CHROME_PATH.`);
};

const chrome = launch();
const endpoint = async () => {
	for (let i = 0; i < 60; i++) {
		try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
		catch { await sleep(250); }
	}
	throw new Error('chrome never opened its debugging port');
};

const { webSocketDebuggerUrl } = await endpoint();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
	const msg = JSON.parse(e.data);
	if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? {}); pending.delete(msg.id); }
};
const send = (method, params = {}, session) => new Promise((resolve) => {
	const n = ++id;
	pending.set(n, resolve);
	ws.send(JSON.stringify({ id: n, method, params, ...(session ? { sessionId: session } : {}) }));
});

const { targetInfos } = await send('Target.getTargets');
const target = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
// `mobile: true` as well as the width, because a page can respond to the
// pointer type and not only to the size.
await send('Emulation.setDeviceMetricsOverride',
	{ width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId);

let broken = 0;
for (const path of PAGES) {
	await send('Page.navigate', { url: BASE + path }, sessionId);
	// The pages are server-rendered with no script, so this is waiting for the
	// navigation rather than for anything on the page to finish.
	await sleep(600);
	const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId);
	const { over, offenders } = JSON.parse(r.result.value);
	if (over > 0) broken++;
	console.log(`${over > 0 ? 'OVERFLOW' : '    ok  '} ${String(over).padStart(4)}px  ${path}`);
	if (over > 0) {
		for (const o of offenders) {
			console.log(`               ${o.tag}${o.cls ? '.' + o.cls.trim().split(/\s+/).join('.') : ''} w=${o.w}`);
		}
	}
}

console.log(`\n${broken} of ${PAGES.length} pages overflow at ${WIDTH}px`);
ws.close();
chrome.kill();
process.exit(broken ? 1 : 0);
