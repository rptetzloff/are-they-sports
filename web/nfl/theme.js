// The theme switcher: System, Light or Dark, as a button in the footer nav
// that steps through the three. The choice is the html element's
// data-theme ("light" / "dark"; System is none, and the stylesheet follows
// the device), kept in localStorage. Each page's <head> applies a saved
// choice before the stylesheet paints, so a light page never flashes green;
// this script only adds the button and changes the choice. Ported from the
// Brewers repo, where it is the same file.
(() => {
	const KEY = 'theme';
	const ORDER = ['system', 'light', 'dark'];
	const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
	const ICON = { system: 'mdi-theme-light-dark', light: 'mdi-white-balance-sunny', dark: 'mdi-weather-night' };

	const read = () => {
		try {
			const v = localStorage.getItem(KEY);
			return v === 'light' || v === 'dark' ? v : 'system';
		} catch { return 'system'; }
	};
	const apply = (choice) => {
		if (choice === 'system') document.documentElement.removeAttribute('data-theme');
		else document.documentElement.setAttribute('data-theme', choice);
		try {
			if (choice === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, choice);
		} catch { /* private mode: the choice lasts this page */ }
	};

	function mount() {
		const nav = document.querySelector('.footer-nav');
		if (!nav || nav.querySelector('.theme-toggle')) return;
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'footer-nav-link theme-toggle';
		const render = () => {
			const c = read();
			const next = ORDER[(ORDER.indexOf(c) + 1) % ORDER.length];
			// An icon only: the footer was full, and a label made it wrap.
			btn.innerHTML = `<i class="mdi ${ICON[c]}" aria-hidden="true"></i>`;
			btn.title = `Theme: ${LABEL[c]} — click for ${LABEL[next]}`;
			btn.setAttribute('aria-label', `Theme: ${LABEL[c]}. Switch to ${LABEL[next]}`);
		};
		btn.addEventListener('click', () => {
			const c = read();
			apply(ORDER[(ORDER.indexOf(c) + 1) % ORDER.length]);
			render();
		});
		render();
		// Before the GitHub link, which stays last.
		nav.insertBefore(btn, nav.querySelector('.footer-github'));
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
	else mount();
})();
