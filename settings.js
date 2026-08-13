// Shared by both popup.html (compact) and options.html (full-page) — same
// element IDs in both, so one script drives either UI. Kept as a single
// file instead of duplicating this logic per page.

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
  tags: {},
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

// In-memory copy of the tags map while the page is open. Chip add/remove
// only mutate this; nothing is persisted until "Save" is clicked, same as
// the checkboxes and the hiddenPeople list.
let tags = {};

function renderTagChips() {
  const container = document.getElementById("tagChips");
  container.innerHTML = "";
  Object.entries(tags).forEach(([name, tag]) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";

    const textEl = document.createElement("span");
    textEl.className = "tag-chip-text";

    const nameEl = document.createElement("span");
    nameEl.className = "tag-chip-name";
    nameEl.textContent = name;
    textEl.appendChild(nameEl);

    textEl.appendChild(document.createTextNode(`: ${tag}`));
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
  chrome.storage.local.get(DEFAULTS, (stored) => {
    CHECKBOX_IDS.forEach((id) => {
      document.getElementById(id).checked = !!stored[id];
    });
    tags = { ...(stored.tags || {}) };
    renderTagChips();
    document.getElementById("hiddenPeople").value = listToText(stored.hiddenPeople || []);
  });

  const nameInput = document.getElementById("tagName");
  const tagInput = document.getElementById("tagValue");

  function addTagFromInputs() {
    const name = nameInput.value.trim();
    const tag = tagInput.value.trim();
    if (!name || !tag) return;
    tags[name] = tag;
    nameInput.value = "";
    tagInput.value = "";
    nameInput.focus();
    renderTagChips();
  }

  document.getElementById("addTag").addEventListener("click", addTagFromInputs);
  [nameInput, tagInput].forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTagFromInputs();
    });
  });

  document.getElementById("save").addEventListener("click", () => {
    const update = {};
    CHECKBOX_IDS.forEach((id) => {
      update[id] = document.getElementById(id).checked;
    });
    update.tags = tags;
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
