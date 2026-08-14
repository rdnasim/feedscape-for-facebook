(function () {
  "use strict";

  const DEFAULTS = {
    hideBirthdays: true,
    hideContacts: true,
    hideShortcuts: true,
    hideStories: true,
    hideReels: true,
    hideVideos: false,
    hideSponsored: true,
    hidePeopleYouMayKnow: true,
    hideUnfollowed: true,
    tags: {},          // { "Full Name": "tag text" }
    tagColors: {},     // { "tag text": "#rrggbb" } — one color per distinct
                        // tag text, shared by everyone tagged with it.
    hiddenPeople: []   // ["Full Name", ...]
  };

  const DEFAULT_TAG_COLOR = "#1877f2";

  // A brief earlier version stored `tags[name]` as { text, color } (one
  // color per person, not per tag). Extract just the text here regardless
  // of which shape is present, so a color set that way still migrates
  // cleanly into the shared tagColors registry the first time it's
  // touched again (see setPersonTag).
  function getPersonTagText(name) {
    const raw = settings.tags[name];
    if (!raw) return null;
    return typeof raw === "string" ? raw : raw.text || null;
  }

  function getTagColor(tagText) {
    return (settings.tagColors && settings.tagColors[tagText]) || DEFAULT_TAG_COLOR;
  }

  let settings = { ...DEFAULTS };

  // Text used to locate right/left column widgets. Facebook only shows one
  // language at a time per account, so add more strings here if your UI
  // language isn't English (e.g. add 'Anniversaires' for French Birthdays).
  const HEADING_MATCHERS = {
    birthdays: ["Birthdays"],
    contacts: ["Contacts"],
    shortcuts: ["Your shortcuts"],
    peopleYouMayKnow: ["People You May Know", "People you may know"]
  };

  function loadSettings(cb) {
    chrome.storage.local.get(DEFAULTS, (stored) => {
      settings = { ...DEFAULTS, ...stored };
      cb && cb();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key in changes) {
      settings[key] = changes[key].newValue;
    }
    processPage();
  });

  function textMatches(el, list) {
    const t = (el.textContent || "").trim();
    return list.includes(t);
  }

  // Find leaf elements (no element children) whose exact text matches one
  // of `list`. Leaf-only avoids matching a giant wrapper div that happens
  // to contain the word somewhere inside it.
  function findExactTextElements(list) {
    const results = [];
    const all = document.querySelectorAll("span, h2, h3, a, div");
    for (const el of all) {
      if (el.children.length === 0 && textMatches(el, list)) {
        results.push(el);
      }
    }
    return results;
  }

  // Walk up from `startEl` until we reach the direct child of `ancestor`,
  // then hide that whole child. This hides "the widget", not just the
  // heading text/line, without needing to know FB's generated class names.
  function hideTopLevelChildOfAncestor(startEl, ancestor, markerAttr) {
    if (!ancestor) return false;
    let node = startEl;
    while (node.parentElement && node.parentElement !== ancestor) {
      node = node.parentElement;
    }
    if (node.parentElement === ancestor && !node.hasAttribute(markerAttr)) {
      node.classList.add("fbcustom-hidden");
      node.setAttribute(markerAttr, "1");
      return true;
    }
    return false;
  }

  // Hides "the whole post" starting from any element inside it. The naive
  // closest('[role="article"]') doesn't work for every caller: that role
  // only wraps a post's message/media/actions area, not its header row —
  // confirmed live, the author-name link and a post's "Follow" button
  // both sit outside any [role="article"] (see getAuthorNameLinks above).
  // Tier 1 (fast path) handles elements already inside the article (e.g.
  // a "Sponsored" label in the message body). Tier 2 walks up from a
  // header-zone element looking for the smallest ancestor containing
  // exactly one [role="article"] descendant. Some ad units have neither
  // [role="article"] nor [role="feed"] anywhere in their ancestry at all
  // (also confirmed live) — tier 3 falls back to the nearest
  // [data-pagelet] ancestor, which FB scopes to one feed story/widget
  // precisely (e.g. "FeedUnit_5"), same pattern already used elsewhere in
  // this file for the left-nav Shortcuts widget. Each tier bails rather
  // than guess broad, so this can't end up hiding multiple posts at once.
  function hideArticleAncestor(startEl, markerAttr) {
    let node = startEl.closest('[role="article"]');
    if (node) {
      if (!node.hasAttribute(markerAttr)) {
        node.classList.add("fbcustom-hidden");
        node.setAttribute(markerAttr, "1");
      }
      return true;
    }

    node = startEl.parentElement;
    for (let i = 0; i < 20 && node; i++) {
      const count = node.querySelectorAll('[role="article"]').length;
      if (count === 1) {
        if (!node.hasAttribute(markerAttr)) {
          node.classList.add("fbcustom-hidden");
          node.setAttribute(markerAttr, "1");
        }
        return true;
      }
      if (count > 1) break; // walked past the post — try data-pagelet instead
      node = node.parentElement;
    }

    const pagelet = startEl.closest("[data-pagelet]");
    if (pagelet) {
      if (!pagelet.hasAttribute(markerAttr)) {
        pagelet.classList.add("fbcustom-hidden");
        pagelet.setAttribute(markerAttr, "1");
      }
      return true;
    }

    return false;
  }

  // Stories/Reels/People-You-May-Know shelves render their outer card
  // wrapper with this inline style (a computed border-radius referencing
  // the --card-corner-radius custom property). BUT this isn't unique to
  // these widgets — FB's design system reuses the same rounded-card style
  // broadly, so closest() can walk past the small widget card and land on
  // something much bigger (e.g. a whole content column), which caused real
  // posts/profile content to disappear. Guard against that: never hide a
  // matched card if it contains an actual post — a genuine shelf widget
  // never does, so this only blocks the mistargeted case.
  function hideEnclosingCard(startEl, markerAttr) {
    const card = startEl.closest('div[style*="card-corner-radius"]');
    if (card && !card.hasAttribute(markerAttr) && !card.querySelector('[role="article"]')) {
      card.classList.add("fbcustom-hidden");
      card.setAttribute(markerAttr, "1");
      return true;
    }
    return false;
  }

  function hideRightColumnWidget(headingList, key) {
    const els = findExactTextElements(headingList);
    for (const el of els) {
      const ancestor = el.closest('[role="complementary"]');
      hideTopLevelChildOfAncestor(el, ancestor, `data-fbcustom-${key}`);
    }
  }

  function hideLeftShortcuts() {
    const els = findExactTextElements(HEADING_MATCHERS.shortcuts);
    for (const el of els) {
      const ancestor = el.closest('[role="navigation"]') || el.closest("[data-pagelet]");
      hideTopLevelChildOfAncestor(el, ancestor, "data-fbcustom-shortcuts");
    }
  }

  function hideStoriesTray() {
    // Hide the tray/avatar-row region itself.
    const candidates = document.querySelectorAll('[aria-label="Stories"], [aria-label*="Stories" i]');
    for (const el of candidates) {
      const region = el.closest('[role="region"], [role="complementary"]') || el;
      if (!region.hasAttribute("data-fbcustom-stories")) {
        region.classList.add("fbcustom-hidden");
        region.setAttribute("data-fbcustom-stories", "1");
      }
      // The above only hides the scroll region, not the card header
      // ("Stories" title + 3-dot menu) sitting above it as a separate
      // sibling block — hide the whole card instead.
      hideEnclosingCard(region, "data-fbcustom-storiesCard");
    }
  }

  function hideReelsShelf() {
    // Hide the tray/thumbnail-row region itself.
    const candidates = document.querySelectorAll('[aria-label*="Reels" i]');
    for (const el of candidates) {
      const region = el.closest('[role="region"]') || el;
      if (!region.hasAttribute("data-fbcustom-reels")) {
        region.classList.add("fbcustom-hidden");
        region.setAttribute("data-fbcustom-reels", "1");
      }
      // Same leftover-header issue as Stories — hide the whole card.
      hideEnclosingCard(region, "data-fbcustom-reelsCard");
    }
  }

  function hidePeopleYouMayKnow() {
    // Right-column widget (heading text match, same as Birthdays/Contacts).
    hideRightColumnWidget(HEADING_MATCHERS.peopleYouMayKnow, "peopleYouMayKnow");

    // In-feed "People You May Know" suggestion carousel — same aria-label
    // shelf pattern as Stories/Reels.
    const candidates = document.querySelectorAll('[aria-label*="People You May Know" i]');
    for (const el of candidates) {
      const region = el.closest('[role="region"]') || el;
      if (!region.hasAttribute("data-fbcustom-peopleYouMayKnow")) {
        region.classList.add("fbcustom-hidden");
        region.setAttribute("data-fbcustom-peopleYouMayKnow", "1");
      }
      // Same leftover-header issue as Stories/Reels — hide the whole card.
      hideEnclosingCard(region, "data-fbcustom-peopleYouMayKnowCard");
    }
  }

  // Hides posts from Pages/Groups/public figures the account doesn't
  // follow. Facebook shows a "Follow" button next to the author name in
  // the post header specifically when you're not already following that
  // source — friends and pages you follow don't get one — so it's a
  // reliable signal without needing to know the source's name up front.
  function hideUnfollowedPosts() {
    const els = findExactTextElements(["Follow"]);
    for (const el of els) {
      hideArticleAncestor(el, "data-fbcustom-unfollowed");
    }
  }

  function hideSponsoredPosts() {
    const els = findExactTextElements(["Sponsored"]);
    for (const el of els) {
      hideArticleAncestor(el, "data-fbcustom-sponsored");
    }

    // Fallback: Facebook marks ad markup with data-ad-* attributes
    // (data-ad-preview, data-ad-comet-preview, data-ad-rendering-role)
    // regardless of UI language, so this catches sponsored posts the
    // "Sponsored" text match above misses (non-English UI, or the label
    // rendering differently than expected). Some ad units (e.g. Reels-style
    // video ads) aren't wrapped in [role="article"] like normal posts, so
    // fall back to hiding the top-level child of the feed container itself.
    const markers = document.querySelectorAll(
      "[data-ad-preview], [data-ad-comet-preview], [data-ad-rendering-role]"
    );
    for (const el of markers) {
      if (hideArticleAncestor(el, "data-fbcustom-sponsored")) continue;
      const feed = el.closest('[role="feed"]');
      hideTopLevelChildOfAncestor(el, feed, "data-fbcustom-sponsored");
    }
  }

  // Interpreted as: hide feed posts that contain a native <video> player.
  // (Reels are handled separately above.) Off by default since it's a
  // broad net — turn on in the popup if that's what you want.
  function hideVideoPosts() {
    const articles = document.querySelectorAll('[role="article"]:not([data-fbcustom-video])');
    for (const article of articles) {
      if (article.querySelector("video")) {
        article.classList.add("fbcustom-hidden");
        article.setAttribute("data-fbcustom-video", "1");
      }
    }
  }

  // Confirmed against a live page: the author-name link is NOT a descendant
  // of the nearest [role="article"] — that role apparently only wraps the
  // message/media/actions portion of a post, while the name/avatar header
  // row sits as a sibling outside it. So this searches the whole document
  // rather than being scoped per-article; callers that need "the post" for
  // a given name link still get there via link.closest('[role="article"]'),
  // which degrades safely to null (no-op) when that scoping doesn't apply.
  function getAuthorNameLinks() {
    return document.querySelectorAll(
      'h2 a[role="link"], h3 a[role="link"], h4 a[role="link"], h2 a, h3 a, h4 a, strong a[role="link"]'
    );
  }

  // Looks up to `maxHops` following siblings of `startEl` for one carrying
  // `className`. Used to find the tag badge/button we may have already
  // attached next to an author link, regardless of which order they're
  // currently in (badge only exists once a tag is set).
  function findSiblingByClass(startEl, className, maxHops) {
    let node = startEl.nextElementSibling;
    for (let i = 0; i < maxHops && node; i++) {
      if (node.classList.contains(className)) return node;
      node = node.nextElementSibling;
    }
    return null;
  }

  // Tag text is unique — one color per distinct tag, shared by everyone
  // tagged with it. `color` is optional: pass it to set/overwrite that
  // tag's color (affects every person who has this tag, not just `name`);
  // omit it to leave the tag's existing color alone, defaulting a
  // brand-new tag text to DEFAULT_TAG_COLOR.
  function setPersonTag(name, tagText, color) {
    const updatedTags = { ...settings.tags };
    const updatedColors = { ...settings.tagColors };
    const trimmed = (tagText || "").trim();
    if (trimmed) {
      updatedTags[name] = trimmed;
      if (color) {
        updatedColors[trimmed] = color;
      } else if (!updatedColors[trimmed]) {
        updatedColors[trimmed] = DEFAULT_TAG_COLOR;
      }
    } else {
      delete updatedTags[name];
      // Not deleting the color entry even if this was the last person with
      // that tag — harmless leftover, and keeps the color stable if the
      // same tag text gets reused on someone else later.
    }
    // Round-trips through chrome.storage.onChanged (see top of file), which
    // updates `settings` and re-runs processPage() — same path the popup's
    // Save button uses, so badges/buttons everywhere stay in sync.
    chrome.storage.local.set({ tags: updatedTags, tagColors: updatedColors });
  }

  // Small on-page popover with a text input + color picker, replacing the
  // native window.prompt() so tag color can be set right from the feed
  // (a native prompt has no way to offer a color picker). Appended to
  // document.body rather than nested near the trigger button, since FB's
  // own containers can clip an absolutely-positioned child via
  // overflow:hidden; a fixed-position element anchored via
  // getBoundingClientRect avoids that.
  let openTagEditorClose = null;

  function closeTagEditor() {
    if (openTagEditorClose) {
      openTagEditorClose();
      openTagEditorClose = null;
    }
  }

  function openTagEditor(name, anchorEl) {
    closeTagEditor(); // only one open at a time

    const currentText = getPersonTagText(name);
    const rect = anchorEl.getBoundingClientRect();

    const editor = document.createElement("div");
    editor.className = "fbcustom-tag-editor";
    editor.style.top = `${rect.bottom + 6}px`;
    editor.style.left = `${Math.max(8, rect.left)}px`;

    const label = document.createElement("div");
    label.className = "fbcustom-tag-editor-label";
    label.textContent = `Tag for ${name}`;
    editor.appendChild(label);

    const row = document.createElement("div");
    row.className = "fbcustom-tag-editor-row";

    const listId = "fbcustom-tag-suggestions";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.placeholder = "Tag";
    textInput.setAttribute("list", listId);
    textInput.value = currentText || "";
    row.appendChild(textInput);

    if (!document.getElementById(listId)) {
      const datalist = document.createElement("datalist");
      datalist.id = listId;
      document.body.appendChild(datalist);
    }
    const datalist = document.getElementById(listId);
    datalist.innerHTML = "";
    Object.keys(settings.tagColors || {}).forEach((text) => {
      const option = document.createElement("option");
      option.value = text;
      datalist.appendChild(option);
    });

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentText ? getTagColor(currentText) : DEFAULT_TAG_COLOR;
    row.appendChild(colorInput);

    // Tag text is unique — typing an existing tag's name should show its
    // real shared color, not whatever the picker happened to be showing.
    textInput.addEventListener("input", () => {
      const match = settings.tagColors && settings.tagColors[textInput.value.trim()];
      if (match) colorInput.value = match;
    });

    editor.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "fbcustom-tag-editor-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      setPersonTag(name, textInput.value, colorInput.value);
      closeTagEditor();
    });
    actions.appendChild(saveBtn);

    if (currentText) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "fbcustom-tag-editor-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        setPersonTag(name, "");
        closeTagEditor();
      });
      actions.appendChild(removeBtn);
    }

    editor.appendChild(actions);
    document.body.appendChild(editor);
    textInput.focus();
    textInput.select();

    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
      if (e.key === "Escape") closeTagEditor();
    });

    // Close on outside click, but not on the click that opened it (the
    // listener is added on a microtask delay for that reason).
    const onOutsideClick = (e) => {
      if (!editor.contains(e.target)) closeTagEditor();
    };
    setTimeout(() => document.addEventListener("mousedown", onOutsideClick), 0);

    openTagEditorClose = () => {
      document.removeEventListener("mousedown", onOutsideClick);
      editor.remove();
    };
  }

  function applyPersonFeatures() {
    const hasHidden = settings.hiddenPeople.length > 0;

    const links = getAuthorNameLinks();
    for (const link of links) {
      const name = (link.textContent || "").trim();
      if (!name) continue;

      if (hasHidden && settings.hiddenPeople.includes(name)) {
        hideArticleAncestor(link, "data-fbcustom-person");
      }

      // Highlight the whole title area (not just the small badge) when
      // this person is tagged, so a tagged post stands out while scanning
      // the feed instead of needing to spot the badge text. Anchored on
      // the profile_name wrapper, same semantic-attribute anchoring this
      // file already uses elsewhere — falls back to the nearest heading if
      // that wrapper isn't present on some post variant.
      const titleArea = link.closest('[data-ad-rendering-role="profile_name"]') || link.closest("h2, h3, h4");

      // Keep the badge text/color in sync with the current tag (rather
      // than only ever creating it once) so editing a tag — via the popup
      // or the feed button below — doesn't leave stale text/color behind.
      // Color comes from the shared tagColors registry (same tag text =
      // same color everywhere), not from this person's entry directly.
      const tagText = getPersonTagText(name);
      const tagColor = tagText ? getTagColor(tagText) : null;
      if (titleArea) {
        titleArea.classList.toggle("fbcustom-tag-highlight", !!tagText);
        if (tagText) titleArea.style.setProperty("--tag-color", tagColor);
        else titleArea.style.removeProperty("--tag-color");
      }
      let badge = findSiblingByClass(link, "fbcustom-tag", 2);
      if (tagText) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "fbcustom-tag";
          link.insertAdjacentElement("afterend", badge);
        }
        if (badge.textContent !== tagText) badge.textContent = tagText;
        badge.style.setProperty("--tag-color", tagColor);
      } else if (badge) {
        badge.remove();
        badge = null;
      }

      // "+"/"✎" button to add or edit this person's tag right from the
      // feed, instead of opening the popup and typing the name by hand.
      let btn = findSiblingByClass(link, "fbcustom-tag-btn", 2);
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fbcustom-tag-btn";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTagEditor(name, btn);
        });
      }
      const afterEl = badge || link;
      if (btn.previousElementSibling !== afterEl) {
        // insertAdjacentElement moves an already-attached element rather
        // than cloning it, so the click listener above survives this.
        afterEl.insertAdjacentElement("afterend", btn);
      }
      btn.textContent = tagText ? "✎" : "+";
      btn.title = tagText ? `Edit tag for ${name}` : `Add tag for ${name}`;
    }
  }

  // Adds the same "+"/"✎" tag button next to a profile's own name at the
  // top of their profile page. That name has no stable selector of its
  // own — it's a plain `[role="button"]` div, a pattern used all over FB —
  // so anchor off the "X followers" link next to it instead, which is
  // unique and semantic. Bounded walk-up; no-ops safely if not found
  // rather than risk grabbing the wrong element.
  function addProfileHeaderTagButton() {
    const followersLink = document.querySelector('a[href*="/followers/"]');
    if (!followersLink) return;

    let scope = followersLink;
    let nameBtn = null;
    for (let i = 0; i < 6 && scope && !nameBtn; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      nameBtn = scope.querySelector('div[role="button"][tabindex="0"]');
    }
    if (!nameBtn) return;

    const name = (nameBtn.textContent || "").trim();
    if (!name) return;

    let btn = findSiblingByClass(nameBtn, "fbcustom-profile-tag-btn", 1);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fbcustom-tag-btn fbcustom-profile-tag-btn";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTagEditor(name, btn);
      });
      nameBtn.insertAdjacentElement("afterend", btn);
    }
    const tagText = getPersonTagText(name);
    btn.textContent = tagText ? "✎" : "+";
    btn.title = tagText ? `Edit tag for ${name}` : `Add tag for ${name}`;
  }

  function processPage() {
    if (settings.hideBirthdays) hideRightColumnWidget(HEADING_MATCHERS.birthdays, "birthdays");
    if (settings.hideContacts) hideRightColumnWidget(HEADING_MATCHERS.contacts, "contacts");
    if (settings.hideShortcuts) hideLeftShortcuts();
    if (settings.hideStories) hideStoriesTray();
    if (settings.hideReels) hideReelsShelf();
    if (settings.hideSponsored) hideSponsoredPosts();
    if (settings.hidePeopleYouMayKnow) hidePeopleYouMayKnow();
    if (settings.hideUnfollowed) hideUnfollowedPosts();
    if (settings.hideVideos) hideVideoPosts();
    applyPersonFeatures();
    addProfileHeaderTagButton();
  }

  // Facebook is a heavily dynamic SPA, so we re-run on every DOM mutation,
  // but throttled/idle so we don't hammer the page while scrolling.
  let scheduled = false;
  function scheduleProcess() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      processPage();
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 150 });
    } else {
      setTimeout(run, 150);
    }
  }

  loadSettings(() => {
    processPage();
    const observer = new MutationObserver(scheduleProcess);
    // Script now runs at document_start (see manifest.json) so hiding kicks
    // in before FB renders the widgets, instead of flashing them visible
    // until document_idle. document.body doesn't exist yet at this point,
    // so observe documentElement (always present) instead.
    //
    // Also watch aria-label mutations: some widgets (e.g. "People You May
    // Know") mount an empty shell first and attach aria-label once content
    // loads in. That's not a childList change, so without this we'd only
    // recheck once some *unrelated* child happens to be inserted nearby,
    // leaving the widget visible in the meantime.
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label"]
    });

    // Safety net: some widgets (e.g. new "People You May Know" instances
    // inserted while scrolling) keep showing up unhidden for a beat even
    // though the matchers above are correct and the observer does fire —
    // exact cause unconfirmed (could be a burst of rapid mutations during
    // fast scroll starving requestIdleCallback, or React resetting the
    // node's `class` attribute on a re-render we don't watch for, since
    // watching `class` directly across the whole page would mean re-running
    // processPage far too often). A once-a-second poll is a cheap
    // self-healing backstop either way, instead of staying wrong until an
    // unrelated mutation happens to trigger the next recheck.
    setInterval(scheduleProcess, 1000);
  });
})();
