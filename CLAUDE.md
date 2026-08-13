# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Manifest V3 Chrome/Edge extension. No build step, no bundler, no package manager, no tests — plain JS/HTML/CSS loaded directly by the browser. Hides distracting Facebook feed/sidebar sections (Birthdays, Contacts, Shortcuts, Stories, Reels, Videos, Sponsored) and lets the user tag or hide specific people's posts.

## Load / test in browser

There is no CLI build or test suite. To verify a change:
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer Mode, "Load unpacked", select this folder.
3. Open/refresh a Facebook tab — content script runs at `document_start` (see note below on why).
4. After editing `content.js`/`content.css`, click the reload icon on the extension card, then refresh the Facebook tab.
5. After editing `popup.*`/`options.*`/`settings.js`, just reopen the popup or options page (no extension reload needed unless `manifest.json` changed).

Manual verification is the only verification path here — there's no automated test harness. When making a change, state what you clicked through in Facebook to confirm it.

## Architecture

Two independent pieces, connected only through `chrome.storage.local`:

- **Settings UI** — `popup.html` (compact popup) and `options.html` (full page, opened via `chrome.runtime.openOptionsPage()` — `manifest.json`'s `options_ui.open_in_tab: true`). Both load the same `settings.js`, which reads/writes `chrome.storage.local` directly; the two HTML files just need matching element IDs (checkboxes by id, `tagName`/`tagValue`/`addTag`/`tagChips`, `hiddenPeople` textarea, `save`/`status`). `popup.html` also has an `openOptions` button `settings.js` wires to `chrome.runtime.openOptionsPage()`; `options.html` has no such button since it *is* the full page.
  - `tags` is stored as `{ "Full Name": "tag text" }`, edited as chips (add via two inputs + Enter/click, remove via ×) rather than free text.
  - `hiddenPeople` stays a plain textarea, one name per line → string array on save.
- **`content.js`** — injected into every `facebook.com` page. Loads settings from storage, applies DOM hiding/tagging, and re-applies on every DOM mutation via a throttled `MutationObserver`, plus a 1s `setInterval` safety-net poll (Facebook's SPA re-renders can otherwise leave a widget unhidden until some unrelated mutation happens to trigger a recheck — see comment at the bottom of the file). Also listens for `chrome.storage.onChanged` so changes in either settings UI take effect without a page refresh.
- **`content.css`** — the `.fbcustom-hidden` (display:none), `.fbcustom-tag` (badge), and `.fbcustom-tag-btn` (small "+"/"✎" button next to each author name, click → prompt → saves via `chrome.storage.local`) classes content.js toggles/injects.

Both `settings.js` and `content.js` define their own copy of `DEFAULTS` — keep them in sync when adding a setting (add to both `DEFAULTS` objects, add a checkbox with matching id to *both* `popup.html` and `options.html` + the id to `CHECKBOX_IDS` in `settings.js`, add the read/apply logic in `content.js`'s `processPage()`).

### DOM-matching strategy (content.js)

Facebook has no stable class names or public API, so all matching is heuristic, by design:
- `findExactTextElements(list)` finds leaf elements (no children) whose exact trimmed text matches a known string (e.g. "Birthdays", "Sponsored"). Leaf-only avoids matching a wrapper div that merely *contains* the word. Doesn't work for headings whose text is split across a nested icon + zero-width-space span (e.g. "People You May Know") — those need a different anchor (see `hidePeopleYouMayKnow`).
- `hideTopLevelChildOfAncestor(startEl, ancestor, markerAttr)` walks up from a matched element to the nearest child of a given ancestor and hides that whole child — hides "the widget" without knowing FB's generated class names. Silently no-ops if `ancestor` is null, so a wrong/missing ancestor selector fails quietly rather than throwing — worth grepping for stray `null` ancestors if a hide isn't taking effect.
- `hideArticleAncestor` / `getAuthorLinksInArticle` locate the enclosing `[role="article"]` post for sponsored-post and person-based hiding/tagging.
- `hideEnclosingCard(startEl, markerAttr)` hides the nearest ancestor carrying the inline `style="border-radius: ...var(--card-corner-radius)..."` used by Stories/Reels/People-You-May-Know card wrappers — hides the card's title+menu along with its tray, not just the tray. **Caveat**: that style isn't unique to these widgets; FB's design system reuses it broadly, so on some pages `closest()` can walk past the intended small card and match something far larger. Guarded with `!card.querySelector('[role="article"]')` (never hide a card that contains an actual post) after this exact failure mode broke post loading on profile pages — don't remove that guard without a replacement safety check.
- Every hide/tag operation sets a `data-fbcustom-*` marker attribute so the mutation observer doesn't reprocess the same element repeatedly.
- `HEADING_MATCHERS` text is English-only. Facebook UI language is per-account; if you need another language, add more strings to the matcher arrays (comment in the file explains this).

When Facebook changes its markup, matching by heading text, `aria-label`, or a stable inline style/CSS-variable reference tends to survive redesigns better than positional/class selectors — keep new heuristics in that style, and prefer anchoring from an element you can already reliably match (e.g. a widget's `aria-label`'d region) over guessing at ancestor roles like `[role="feed"]`, which may not exist above every widget.
