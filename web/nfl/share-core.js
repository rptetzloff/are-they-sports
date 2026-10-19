// Shared share-button helpers for the browser pages (main.js and records.js):
// share-intent URL builders and copy-to-clipboard with visual flash feedback.

export function intentUrls(message, url) {
	const text = `${message}\n\n${url}`;
	return {
		x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
		bsky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
		fb: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(message)}`,
		reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(message)}`,
	};
}

// Share buttons: native share when supported, otherwise the per-platform
// intent links, plus copy. Two formats — icon-only (compact, inside cards)
// and labelled (page-level rows, matching the main page's share section).
// Pair with wireShareRow() after inserting into the DOM.
const SHARE_DEFS = [
	['x', 'mdi-twitter', 'Post on X'],
	['bsky', 'mdi-butterfly', 'Post on Bluesky'],
	['fb', 'mdi-facebook', 'Share on Facebook'],
	['reddit', 'mdi-reddit', 'Post on Reddit'],
];

export function shareButtonsHtml(btnClass, { labels = false } = {}) {
	const native = !!navigator.share;
	const text = (label) => (labels ? label : '');
	const alts = native ? '' : SHARE_DEFS.map(([key, icon, label]) =>
		`<a class="${btnClass}" data-share="${key}" href="#" target="_blank" rel="noopener noreferrer" aria-label="${label}"><i class="mdi ${icon} share-icon"></i>${text(label)}</a>`
	).join('\n\t\t');
	return `${native ? `<button class="${btnClass}" data-share="native" aria-label="Share"><i class="mdi mdi-share-variant share-icon"></i>${text('Share')}</button>` : ''}
		${alts}
		<button class="${btnClass}" data-share="copy" aria-label="Copy link"><i class="mdi mdi-clipboard-outline share-icon"></i>${text('Copy link')}</button>`;
}

// Wire the [data-share] buttons inside `row` to share `message` + `url`.
export function wireShareRow(row, message, url, { labels = false } = {}) {
	const links = intentUrls(message, url);
	row.querySelectorAll('[data-share]').forEach((btn) => {
		switch (btn.dataset.share) {
			case 'x': btn.href = links.x; break;
			case 'bsky': btn.href = links.bsky; break;
			case 'fb': btn.href = links.fb; break;
			case 'reddit': btn.href = links.reddit; break;
			case 'native':
				btn.addEventListener('click', async () => {
					try { await navigator.share({ text: message, url }); } catch { /* user cancelled */ }
				});
				break;
			case 'copy':
				btn.addEventListener('click', () => {
					flashCopied(btn, labels
						? '<i class="mdi mdi-check share-icon"></i>Copied!'
						: '<i class="mdi mdi-check"></i>');
					copyText(`${message}\n\n${url}`);
				});
				break;
		}
	});
}

// Wire the footer Share dropdown: the trigger shows and hides the menu, a
// click outside or Escape closes it. Safe to call more than once. Ported
// from the Brewers repo's share-core.js.
export function wireShareDropdown() {
	const trigger = document.getElementById('footer-share-trigger');
	if (!trigger || trigger.dataset.wired) return;
	const menu = trigger.parentElement.querySelector('.footer-share');
	if (!menu) return;
	trigger.dataset.wired = '1';

	const open = (on) => {
		menu.hidden = !on;
		trigger.setAttribute('aria-expanded', String(on));
	};
	trigger.addEventListener('click', (e) => { e.stopPropagation(); open(menu.hidden); });
	document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== trigger) open(false); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { open(false); trigger.focus(); } });
	// Copy flashes "Copied!" in place, so the menu stays open for it; any
	// other item leaves the page or opens the native sheet.
	menu.addEventListener('click', (e) => { if (e.target.closest('[data-share]:not([data-share="copy"]), a, #share-native')) open(false); });
}

// Flash a button into its "copied" state for 2s, restoring its original
// content afterwards. Safe to call repeatedly (re-clicks reset the timer).
const flashState = new WeakMap(); // btn -> { original, timer }
export function flashCopied(btn, flashHtml) {
	let st = flashState.get(btn);
	if (!st) { st = { original: btn.innerHTML, timer: null }; flashState.set(btn, st); }
	if (st.timer) clearTimeout(st.timer);
	btn.innerHTML = flashHtml;
	btn.classList.add('copy-success');
	st.timer = setTimeout(() => {
		btn.innerHTML = st.original;
		btn.classList.remove('copy-success');
		st.timer = null;
	}, 2000);
}

// Copy text to the clipboard, with a legacy fallback for older/insecure
// contexts. Never throws — callers flash feedback before calling this.
export async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
	} catch (_) {
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		} catch (_) {}
	}
}
