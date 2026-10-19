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

// Icon-only share buttons for a compact per-card share row: native share when
// supported, otherwise the per-platform intent links, plus copy. Pair with
// wireShareRow() after inserting into the DOM.
export function shareButtonsHtml(btnClass) {
	const items = labeledShareItems();
	return items.map((it) => it.html(btnClass, false)).join('');
}

// Labeled share buttons for the footer dropdown menu.
export function labeledShareButtonsHtml(btnClass) {
	const items = labeledShareItems();
	return items.map((it) => it.html(btnClass, true)).join('');
}

function labeledShareItems() {
	const native = !!navigator.share;
	const items = [];
	if (native) {
		items.push({
			share: 'native',
			icon: 'mdi-share-variant',
			label: 'Share',
			html: (c, labeled) => `<button class="${c}" data-share="native" type="button" aria-label="Share">${iconHtml('mdi-share-variant', labeled)}${labeled ? 'Share' : ''}</button>`,
		});
	} else {
		for (const [share, icon, label] of [['x', 'mdi-twitter', 'Post on X'], ['bsky', 'mdi-butterfly', 'Post on Bluesky'], ['fb', 'mdi-facebook', 'Share on Facebook'], ['reddit', 'mdi-reddit', 'Post on Reddit']]) {
			items.push({
				share,
				icon,
				label,
				html: (c, labeled) => `<a class="${c}" data-share="${share}" href="#" target="_blank" rel="noopener noreferrer" aria-label="${label}">${iconHtml(icon, labeled)}${labeled ? label : ''}</a>`,
			});
		}
	}
	items.push({
		share: 'copy',
		icon: 'mdi-clipboard-outline',
		label: 'Copy link',
		html: (c, labeled) => `<button class="${c}" data-share="copy" type="button" aria-label="Copy link">${iconHtml('mdi-clipboard-outline', labeled)}${labeled ? 'Copy link' : ''}</button>`,
	});
	return items;
}

const iconHtml = (icon, labeled) => `<i class="mdi ${icon}${labeled ? ' footer-share-item-icon' : ' share-icon'}"></i>`;

// Wire the [data-share] buttons inside `row` to share `message` + `url`.
export function wireShareRow(row, message, url) {
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
					flashCopied(btn, '<i class="mdi mdi-check"></i>');
					copyText(`${message}\n\n${url}`);
				});
				break;
		}
	});
}

// Wire the footer Share dropdown toggle: click the trigger to show/hide the
// menu, click outside or Escape to close. Call once per page after the menu
// is populated.
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
	const toggle = (e) => { e.stopPropagation(); open(menu.hidden); };
	const close = () => open(false);

	trigger.addEventListener('click', toggle);
	document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== trigger) close(); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); trigger.focus(); } });
	menu.addEventListener('click', close);
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
