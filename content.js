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
    hiddenPeople: []   // ["Full Name", ...]
  };

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

  function hideArticleAncestor(startEl, markerAttr) {
    const article = startEl.closest('[role="article"]');
    if (article && !article.hasAttribute(markerAttr)) {
      article.classList.add("fbcustom-hidden");
      article.setAttribute(markerAttr, "1");
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

  function getAuthorLinksInArticle(article) {
    return article.querySelectorAll(
      'h2 a[role="link"], h3 a[role="link"], h2 a, h3 a, strong a[role="link"]'
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

  function setPersonTag(name, tagText) {
    const updated = { ...settings.tags };
    const trimmed = (tagText || "").trim();
    if (trimmed) {
      updated[name] = trimmed;
    } else {
      delete updated[name];
    }
    // Round-trips through chrome.storage.onChanged (see top of file), which
    // updates `settings` and re-runs processPage() — same path the popup's
    // Save button uses, so badges/buttons everywhere stay in sync.
    chrome.storage.local.set({ tags: updated });
  }

  function applyPersonFeatures() {
    const hasHidden = settings.hiddenPeople.length > 0;

    const articles = document.querySelectorAll('[role="article"]');
    for (const article of articles) {
      const links = getAuthorLinksInArticle(article);
      for (const link of links) {
        const name = (link.textContent || "").trim();
        if (!name) continue;

        if (hasHidden && settings.hiddenPeople.includes(name)) {
          article.classList.add("fbcustom-hidden");
          article.setAttribute("data-fbcustom-person", "1");
        }

        // Keep the badge text in sync with the current tag (rather than
        // only ever creating it once) so editing a tag — via the popup or
        // the feed button below — doesn't leave stale text behind.
        const tagText = settings.tags[name];
        let badge = findSiblingByClass(link, "fbcustom-tag", 2);
        if (tagText) {
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "fbcustom-tag";
            link.insertAdjacentElement("afterend", badge);
          }
          if (badge.textContent !== tagText) badge.textContent = tagText;
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
            const next = window.prompt(`Tag for ${name}:`, settings.tags[name] || "");
            if (next === null) return; // cancelled
            setPersonTag(name, next);
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
