// Shared by both popup.html (compact) and options.html (full-page) — same
// element IDs in both, so one script drives either UI. Kept as a single
// file instead of duplicating this logic per page.

// Applied synchronously, before DOMContentLoaded, to minimize the flash of
// the wrong theme: <html> already exists by the time this script runs
// (it's loaded at the end of <body>), so a best-guess based on the OS
// theme can paint immediately. The real stored choice — if the user ever
// toggled it — overrides this guess once storage responds, below.
(function paintBestGuessTheme() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
})();

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const toggle = document.getElementById("themeToggle");
  if (toggle) toggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

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
  tagColors: {},     // { "tag text": "#rrggbb" } — the predefined-tag
                      // palette; one color per distinct tag, shared by
                      // everyone tagged with it.
  hiddenPeople: []
};

const CHECKBOX_IDS = [
  "hideBirthdays",
  "hideContacts",
  "hideShortcuts",
  "hideStories",
  "hideReels",
  "hideVideos",
  "hideSponsored",
  "hidePeopleYouMayKnow",
  "hideUnfollowed"
];

const DEFAULT_TAG_COLOR = "#1877f2";

// In-memory copies while the page is open. `tags` maps name -> tag text
// (plain string, must be a key already present in tagColors); `tagColors`
// is the predefined-tag palette, managed in its own section, independent
// of any person assignment. Nothing persists until "Save" is clicked,
// same as the checkboxes and the hiddenPeople list.
let tags = {};
let tagColors = {};

function refreshTagValueOptions() {
  const select = document.getElementById("tagValue");
  if (!select) return;
  const previousValue = select.value;
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = Object.keys(tagColors).length
    ? "Select a tag…"
    : "Add a predefined tag first ↑";
  select.appendChild(placeholder);

  Object.keys(tagColors).forEach((text) => {
    const option = document.createElement("option");
    option.value = text;
    option.textContent = text;
    select.appendChild(option);
  });

  // Keep the current selection if it's still valid, otherwise fall back
  // to the placeholder rather than silently jumping to some other tag.
  select.value = tagColors[previousValue] ? previousValue : "";
}

function renderPredefinedTagChips() {
  const container = document.getElementById("predefinedTagChips");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(tagColors).forEach(([text, color]) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "tag-chip-color";
    colorInput.value = color;
    colorInput.title = `Color for "${text}"`;
    colorInput.addEventListener("input", () => {
      tagColors[text] = colorInput.value;
    });
    chip.appendChild(colorInput);

    const textEl = document.createElement("span");
    textEl.className = "tag-chip-text";
    textEl.textContent = text;
    chip.appendChild(textEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "tag-chip-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove predefined tag "${text}"`);
    removeBtn.addEventListener("click", () => {
      delete tagColors[text];
      // People already carrying this tag text keep it — just falls back
      // to the default color in the feed until re-tagged with something
      // still in the palette. Not cascading the delete into `tags` since
      // that would silently un-tag people with no warning.
      renderPredefinedTagChips();
      refreshTagValueOptions();
    });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });
}

function renderTagChips() {
  const container = document.getElementById("tagChips");
  container.innerHTML = "";
  Object.entries(tags).forEach(([name, text]) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";

    const swatch = document.createElement("span");
    swatch.className = "tag-chip-swatch";
    swatch.style.background = tagColors[text] || DEFAULT_TAG_COLOR;
    chip.appendChild(swatch);

    const textEl = document.createElement("span");
    textEl.className = "tag-chip-text";

    const nameEl = document.createElement("span");
    nameEl.className = "tag-chip-name";
    nameEl.textContent = name;
    textEl.appendChild(nameEl);

    textEl.appendChild(document.createTextNode(`: ${text}`));
    chip.appendChild(textEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "tag-chip-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove tag for ${name}`);
    removeBtn.addEventListener("click", () => {
      delete tags[name];
      renderTagChips();
    });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });
}

function listToText(list) {
  return list.join("\n");
}

function textToList(text) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

document.addEventListener("DOMContentLoaded", () => {
  // Theme is a personal display preference shared between popup and
  // options — read/written independently of the main Save button so it
  // feels instant, like any other app's dark-mode switch.
  chrome.storage.local.get({ theme: null }, (stored) => {
    if (stored.theme) applyTheme(stored.theme);
    else applyTheme(document.documentElement.getAttribute("data-theme")); // keep the OS-guess, just sync the toggle icon
  });
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      chrome.storage.local.set({ theme: next });
    });
  }

  chrome.storage.local.get(DEFAULTS, (stored) => {
    CHECKBOX_IDS.forEach((id) => {
      document.getElementById(id).checked = !!stored[id];
    });

    tagColors = { ...(stored.tagColors || {}) };
    tags = {};
    // A brief earlier version stored tags[name] as { text, color } (one
    // color per person, not per tag) instead of today's plain string.
    // Migrate that shape in-place: keep the text, and seed tagColors from
    // whichever color was already set if this tag text has none yet.
    Object.entries(stored.tags || {}).forEach(([name, raw]) => {
      if (typeof raw === "string") {
        tags[name] = raw;
      } else if (raw && raw.text) {
        tags[name] = raw.text;
        if (!tagColors[raw.text]) tagColors[raw.text] = raw.color || DEFAULT_TAG_COLOR;
      }
    });

    renderPredefinedTagChips();
    refreshTagValueOptions();
    renderTagChips();
    document.getElementById("hiddenPeople").value = listToText(stored.hiddenPeople || []);
  });

  const predefinedTextInput = document.getElementById("predefinedTagText");
  const predefinedColorInput = document.getElementById("predefinedTagColor");

  function addPredefinedTagFromInputs() {
    const text = predefinedTextInput.value.trim();
    if (!text) return;
    tagColors[text] = predefinedColorInput.value || DEFAULT_TAG_COLOR;
    predefinedTextInput.value = "";
    predefinedTextInput.focus();
    renderPredefinedTagChips();
    refreshTagValueOptions();
  }

  document.getElementById("addPredefinedTag").addEventListener("click", addPredefinedTagFromInputs);
  predefinedTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPredefinedTagFromInputs();
  });

  const nameInput = document.getElementById("tagName");
  const tagSelect = document.getElementById("tagValue");

  function addTagFromInputs() {
    const name = nameInput.value.trim();
    const text = tagSelect.value;
    if (!name || !text) return;
    tags[name] = text;
    nameInput.value = "";
    tagSelect.value = "";
    nameInput.focus();
    renderTagChips();
  }

  document.getElementById("addTag").addEventListener("click", addTagFromInputs);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTagFromInputs();
  });

  document.getElementById("save").addEventListener("click", () => {
    const update = {};
    CHECKBOX_IDS.forEach((id) => {
      update[id] = document.getElementById(id).checked;
    });
    update.tags = tags;
    update.tagColors = tagColors;
    update.hiddenPeople = textToList(document.getElementById("hiddenPeople").value);

    chrome.storage.local.set(update, () => {
      const status = document.getElementById("status");
      status.textContent = "Saved ✓";
      setTimeout(() => (status.textContent = ""), 1500);
    });
  });

  // Only present in popup.html — options.html is already the full page.
  const openOptionsBtn = document.getElementById("openOptions");
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  }
});
