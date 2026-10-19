// Adds a "Disclaimer" link to the footer nav on every page and injects the
// modal it opens: the channel-listings disclaimer, the required Retrosheet
// notice, and ESPN usage.
//
// In are-they-sports the club comes from window.CLUB (lib/web.js), and three
// claims changed rather than being copied: Retrosheet's notice is the current
// one (the site still gave a postal address their terms no longer carry); the
// channel section appears only for a club with listings; and the code is not
// called MIT-licensed, because this repo carries no licence file.
(() => {
	const CLUB = window.CLUB ?? { fullName: 'this club', site: {} };
	const REPO = 'https://github.com/rptetzloff/are-they-sports';
	function init() {
		const nav = document.querySelector('.footer-nav');
		if (!nav) return;

		const link = document.createElement('button');
		link.type = 'button';
		link.className = 'footer-nav-link license-link';
		link.innerHTML = '<i class="mdi mdi-license"></i><span class="footer-nav-label">Disclaimer</span>';
		nav.insertBefore(link, nav.querySelector('.footer-github'));

		const overlay = document.createElement('div');
		overlay.className = 'license-overlay';
		overlay.hidden = true;
		overlay.innerHTML = `
			<div class="license-modal" role="dialog" aria-modal="true" aria-label="Data and licenses">
				<button class="license-close" aria-label="Close"><i class="mdi mdi-close"></i></button>
				<h2><i class="mdi mdi-license"></i> Data &amp; Licenses</h2>
				<p>This is an independent fan site. Unless otherwise noted, it is not
				affiliated with, sponsored by, or endorsed by the ${CLUB.fullName},
				Major League Baseball, any data provider, or any TV service provider
				named on this site. All team names, logos, and trademarks belong to
				their respective owners.</p>
				${CLUB.site.tv ? `<h3>Channel information</h3>
				<p>Channel information is based on publicly available channel listings.
				Please check your local channel guide for the most accurate broadcast
				information.</p>` : ''}
				<h3>Retrosheet</h3>
				<p>The information used here was obtained free of charge from and is copyrighted
				by Retrosheet. Interested parties may contact Retrosheet at
				"www.retrosheet.org".</p>
				<p>All historical game data (${CLUB.site.firstSeason}–present) comes from
				<a href="https://www.retrosheet.org" target="_blank" rel="noopener noreferrer">retrosheet.org</a>.</p>
				<h3>ESPN</h3>
				<p>Live schedule, score, standings, and broadcast information for the current
				season is retrieved from ESPN's publicly available API. This site is not
				affiliated with, sponsored by, or endorsed by ESPN or Major League Baseball.</p>
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
