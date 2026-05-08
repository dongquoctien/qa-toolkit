# QA Annotator

> Click any element on a live site → log a QA issue with computed styles, a cropped screenshot, and a deeplink to the matching Figma frame. Sync to Jira via Claude Code.

<p align="center">
  <img src="img/issue-modal.png" alt="In-page issue modal with auto-captured screenshot, computed styles, and auto-matched Figma deeplink" width="780" />
</p>

Two pieces, one repo:

| Piece | What it is | Audience |
|---|---|---|
| **Chrome extension** (this repo, root) | Inspector overlay + form modal + ZIP export. Multi-pick (shift-click), auto-cropped screenshots with red border, multi-image gallery, auto-filled Figma links via tree matcher. | QA engineers |
| **Claude Code plugin** ([`plugins/qa-tooling/`](plugins/qa-tooling/README.md)) | `/qa:init` auto-detects project stack and generates `qa-profile.json`. `/qa:figma-sync` crawls Figma file. `/qa:sync` pushes QA reports into Jira via MCP. | Dev / QA leads |

Both pieces share two JSON files: **`qa-profile.json`** (project conventions) and **`qa-figma-tree.json`** (cached Figma frame tree). Plugin generates them; extension consumes them.

---

## Install

### Extension

**For QA team (no git, no clone):** download the latest ZIP from [Releases](https://github.com/dongquoctien/qa-annotator-extension/releases/latest), unzip, then in Chrome:
1. Open `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** → select the unzipped folder.
3. Pin the **QA Annotator** icon to the toolbar.

**For devs (clone + load source):** clone this repo, then **Load unpacked** → select the repo root.

Either way: click the icon → **Settings** → import a `qa-profile.json` from any project, then optionally import its `qa-figma-tree.json`.

Without imports, the extension uses the bundled empty profile and works on any URL — just no source mapping or Figma auto-fill. See [`docs/INSTALL.md`](docs/INSTALL.md) for the full workflow + storage layout.

### Plugin (recommended — Claude Code marketplace)

In a Claude Code session at any project:

```
/plugin marketplace add dongquoctien/qa-annotator-extension
/plugin install qa-tooling@qa-annotator
```

Then run `/qa:init` to generate `docs/qa/qa-profile.json`. To update: `/plugin marketplace update qa-annotator`.

See [`plugins/qa-tooling/README.md`](plugins/qa-tooling/README.md) for all four commands. Manual install (no marketplace) instructions also there.

---

## Daily workflow

```
1. QA opens target site → starts Inspector → clicks elements
2. Each click: modal opens with auto-captured cropped screenshot
                    + auto-filled Figma deeplink (when tree imported)
                    + per-element computed styles
3. QA fills Title / Severity / Expected → Save
4. End of session: popup → Export ZIP
5. Dev runs /qa:sync → Jira sub-tasks created
```

### Toolbar popup

Pick the active profile, start the Inspector, and export reports as JSON / Markdown / ZIP.

<p align="center">
  <img src="img/popup.png" alt="Toolbar popup: profile selector, Start Inspector button, JSON/MD/ZIP exports" width="320" />
</p>

### Settings — profiles, Figma trees, theme

Import a `qa-profile.json` and a `qa-figma-tree.json` per project. The active profile drives URL detection, locale strategy, and Figma auto-fill.

<p align="center">
  <img src="img/settings-profiles.png" alt="Settings page: import profile, saved profiles table, Figma frame tree import" width="780" />
</p>

### Settings — saved issues + report import

Edit / delete saved issues without re-picking. Re-import a previously exported ZIP or JSON to bring issues back (skips duplicate IDs).

<p align="center">
  <img src="img/settings-issues.png" alt="Settings page: saved issues table with edit/delete and Import issues button; theme color swatches" width="780" />
</p>

---

## Keyboard / mouse shortcuts (in-page)

| Action | Shortcut |
|---|---|
| Stop inspector | `Esc` |
| Pick single element | Click |
| Add to multi-pick set | `Shift` + Click |
| Commit multi-pick (open modal) | Press **Done** button or `Enter` |
| Paste image into modal | `Ctrl/Cmd` + `V` anywhere in modal |
| Close modal | `Esc`, header `×`, footer **Cancel**, or click backdrop |

---

## More docs

| Doc | What |
|---|---|
| [`STATUS.md`](STATUS.md) | What's built · what's not · known limitations · bugs caught + fixed |
| [`CLAUDE.md`](CLAUDE.md) | Codebase guide for Claude Code in future sessions — architecture, conventions, gotchas |
| [`docs/INSTALL.md`](docs/INSTALL.md) | Extension install + workflow + chrome.storage details |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Deploying plugin + extension (load unpacked, future Web Store) |
| [`plugins/qa-tooling/README.md`](plugins/qa-tooling/README.md) | Plugin commands · skills · install in another project |
| [`docs/archive/`](docs/archive/) | Original Phase 1 design docs (PLAN, PLUGIN_PLAN, SUMMARY, FLOWCHARTS) |

---

## Status

- **Extension** Phase 1 complete and tested live in Chrome against the about-us project.
- **Plugin** Phase 1 complete; `/qa:init`, `/qa:doctor`, `/qa:figma-sync` exercised live against about-us; `/qa:sync` spec done but not yet exercised against a real Jira workspace.

Phase 2 ideas listed in [`STATUS.md`](STATUS.md#-not-built-phase-2).
