// Adds a "Disclaimer" link to the footer nav and injects the modal it opens:
// who the site is not affiliated with, where its data comes from — the sources
// and the notices they require — and how to ask for a correction.
//
// The baseball site's modal, made one for every sport. The same file is copied
// into web/mlb, web/nfl and web/nba, and test/web.test.js holds the copies
// identical, so there is one disclaimer to keep right rather than three.
//
// The data section is the server's: lib/credits.js says what each sport's
// sources ask for (Retrosheet's notice in full, CC BY's licence links and the
// statement that the data was reshaped), and the shell carries it in a
// <template id="data-credit">. Ray, 2026-10-19: the credit lives here, not in
// the page's main column. The baseball site's own modal already carried
// Retrosheet's notice the same way.
//
// Changed from that modal rather than copied: the club and league come from
// window.CLUB; the channel section appears only for a club with TV listings;
// Retrosheet's notice is the current one (the site's gave a postal address
// their terms no longer carry); and the code is not called MIT-licensed,
// because this repository has no licence file.
(() => {
	const CLUB = window.CLUB ?? { fullName: 'this club', site: {} };
	const REPO = 'https://github.com/rptetzloff/are-they-sports';
	const league = CLUB.site.leagueName || 'the league';
	function init() {
		const nav = document.querySelector('.footer-nav');
		if (!nav) return;

		const link = document.createElement('button');
		link.type = 'button';
		link.className = 'footer-nav-link license-link';
		link.innerHTML = '<i class="mdi mdi-license"></i><span class="footer-nav-label">Disclaimer</span>';
		nav.insertBefore(link, nav.querySelector('.footer-github'));

		const credit = document.getElementById('data-credit');
		const data = credit ? credit.innerHTML.trim() : '';

		const overlay = document.createElement('div');
		overlay.className = 'license-overlay';
		overlay.hidden = true;
		overlay.innerHTML = `
			<div class="license-modal" role="dialog" aria-modal="true" aria-label="Data and licenses">
				<button class="license-close" aria-label="Close"><i class="mdi mdi-close"></i></button>
				<h2><i class="mdi mdi-license"></i> Data &amp; Licenses</h2>
				<p>This is an independent fan site. Unless otherwise noted, it is not
				affiliated with, sponsored by, or endorsed by the ${CLUB.fullName},
				${league}, ${CLUB.site.tv ? 'any data provider, or any TV service provider named on this site' : 'or any data provider'}.
				All team names, logos, and trademarks belong to their respective owners.</p>
				${CLUB.site.tv ? `<h3>Channel information</h3>
				<p>Channel information is based on publicly available channel listings.
				Please check your local channel guide for the most accurate broadcast
				information.</p>` : ''}
				${data ? `<h3>Data</h3>
				<div class="license-data">${data}</div>` : ''}
				<h3>ESPN</h3>
				<p>Live schedule, score, standings, and broadcast information for the current
				season is retrieved from ESPN's publicly available API. This site is not
				affiliated with, sponsored by, or endorsed by ESPN or ${league}.</p>
				<h3>Site</h3>
				<p>The site's code is on
				<a href="${REPO}" target="_blank" rel="noopener noreferrer">GitHub</a>.
				Bundled Liberation Sans fonts are © Red Hat, Inc., licensed under the SIL Open Font License 1.1.</p>
				<h3>Corrections</h3>
				<p>To provide additional information, or to request that information be
				removed or changed, please
				<a href="${REPO}/issues/new" target="_blank" rel="noopener noreferrer">submit an issue</a>.</p>
			</div>`;
		document.body.appendChild(overlay);

		const close = () => { overlay.hidden = true; };
		link.addEventListener('click', () => { overlay.hidden = false; });
		overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
		overlay.querySelector('.license-close').addEventListener('click', close);
		document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
