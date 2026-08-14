# Feedscape for Facebook

![Feedscape for Facebook](docs/banner.png)

A Chrome/Edge browser extension that cleans up your Facebook feed and lets you tag or hide specific people — no account, no backend, no tracking. Everything stays on your machine in the browser's local storage.

## What it does

**Hide feed clutter** — toggle any of:
- Birthdays
- Contacts
- Your Shortcuts
- Stories
- Reels
- Sponsored posts
- People You May Know
- Video posts (off by default — hides *any* post containing a video, which is a broad net)
- Posts from Pages/Groups/people you don't follow

**Tag people** — add a colored badge next to someone's name everywhere they show up in your feed (e.g. `Colleague`, `Family`, `News Paper`). Tags are reusable: define a tag once with a color in the **Predefined tags** palette, then assign it to as many people as you like — they'll all share that same color.

**Hide specific people's posts** — list names you never want to see, regardless of what they post.

**Light/dark mode** — a toggle in both the popup and the full settings page, independent of your OS theme.

## Install (unpacked, for now)

This extension isn't published to the Chrome Web Store yet, so it's installed the same way any developer loads a local extension:

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions` on Edge).
3. Turn on **Developer mode** (top-right toggle on Chrome, or in the left sidebar on Edge).
4. Click **Load unpacked** and select this project's folder.
5. Open or refresh a `facebook.com` tab — the extension is now active.

You'll see the icon in your browser toolbar (pin it via the extensions puzzle-piece menu if it isn't visible).

## Using it

### The popup (quick access)

Click the toolbar icon to open a compact settings panel:

- **Feed sections** — check anything you want hidden. Unchecked = shown normally.
- **Predefined tags** — type a tag name (e.g. `Colleague`), pick a color, click **Add**. This defines the tag; it doesn't assign it to anyone yet.
- **Tag people** — type a person's exact name (as it appears on Facebook), pick one of your predefined tags from the dropdown, click **Add**.
- **Hide people's posts** — one full name per line in the text box. Matched exactly, so use their full display name.
- **Save** — nothing takes effect until you click this.
- **Open full settings ↗** — opens the same controls in a full browser tab, more comfortable for managing a longer list of tags/names.

After saving, **refresh any open Facebook tab** — most changes apply live via a listener, but a refresh guarantees everything re-applies cleanly.

### Tagging directly from the feed

You don't have to go through the popup to tag someone. Next to every post's author name (and on profile pages, next to the profile owner's name), you'll see a small **+** button — click it to open a popover right there:

- Type a tag name (autocompletes from your predefined tags) and pick a color.
- Click **Save** to apply it, or **Remove** to clear an existing tag.
- If the name already has a tag, the button shows **✎** instead of **+**.

Since a tag's color is shared across everyone who has it, editing the color here updates it everywhere that tag is used — including tags added from the popup.

### Toggling dark mode

Click the 🌙/☀️ button in the top corner of either the popup or the full settings page. The choice is remembered and applied instantly in both places; it doesn't need Save and isn't tied to your system theme (though it starts out matching your OS preference the first time you open it).

## How it works (for the curious)

Facebook's markup has no stable public API, so hiding/tagging is done by matching visible text, `aria-label`s, and semantic attributes (`role="article"`, `data-pagelet`, etc.) rather than relying on class names, which Facebook regenerates on every deploy. This makes it fairly resilient to redesigns, but not immune — if something stops working after a Facebook update, that's almost certainly why.

Two independent pieces, connected only through the browser's local storage:

- **Settings UI** (`popup.html` / `options.html`, sharing `settings.js`) — reads and writes your preferences.
- **Content script** (`content.js`) — runs on every Facebook page, reads those preferences, and applies the hiding/tagging live as you scroll.

See [CLAUDE.md](CLAUDE.md) if you want the deeper architectural notes (matching heuristics, known edge cases, etc.).

## Known limitations

- Heading text matching (Birthdays, Contacts, Your Shortcuts, People You May Know) is English-only. If your Facebook UI is in another language, those specific toggles won't match — open an issue or a PR with the translated strings.
- Hiding is heuristic-based, not a Facebook API. A Facebook redesign can occasionally break one feature until the matching logic is updated.
- "Hide people's posts" and "Tag people" match on exact display name — nicknames or name changes won't match automatically.

## Privacy

No data ever leaves your browser. All settings (checkboxes, tags, hidden names) are stored in `chrome.storage.local`, scoped to your browser profile. The extension makes no network requests of its own.
