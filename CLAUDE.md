# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read this when picking up this repo in a future session. It covers architecture, conventions, gotchas, and how to extend each piece without breaking the contract between them.

> Status snapshot lives in [`STATUS.md`](STATUS.md). Read that for "what's done vs not done"; this file is "how to navigate the code."

---

## Repo at a glance

```
qa-annotator-extension/
├── manifest.json                ← Chrome MV3 — must stay at repo root
├── src/                         ← Extension code (vanilla JS, no bundler)
├── plugins/qa-tooling/                      ← Claude Code plugin "qa-tooling"
├── assets/                      ← Extension PNG icons
├── docs/                        ← INSTALL, DEPLOY, archive
├── README.md                    ← entry point
├── STATUS.md                    ← done / not done / known issues
└── CLAUDE.md                    ← this file
```

The extension and the plugin are **independent** — they share two JSON contracts (`qa-profile-v1` and `qa-figma-tree-v1`) but have no runtime coupling. You can ship either one alone.

---

## Architecture invariants

### 1. The two contracts (don't break these)

**`qa-profile-v1`** — produced by `/qa:init`, consumed by extension. Required fields: `id`, `name`, `urlPatterns`, `framework.type`. Sensitive fields the matcher needs:
- `pages[]` — `[{ name, figma: { nodeId, viewportVariants } }]`
- `pageDetection[]` — `[{ pattern, pageName }]` regex → page-name map
- `localeStrategy.prefixDefaultLocale` — controls URL→locale mapping
- `conventions.i18nKeyAttribute` (NOT `i18nAttribute` — was renamed; built-in empty profile fixed)
- `figma.fileKey`, `figma.fileSlug`, `figma.linkTemplate`

**`qa-figma-tree-v1`** — produced by `/qa:figma-sync`, consumed by extension's matcher. Required: `fileKey`, `pages[]`, `nodes` (compressed: `n/t/p/d/b/v/x/s` 1-char keys). Optional: `sectionIndex`, `partial: true`, `missingTuples[]`.

If you change either schema, bump the `$schema` value AND update both producer (plugins/qa-tooling/skills) and consumer (extension/lib/profile-validator.js + figma-matcher.js + service-worker.js#compressTree).

### 2. The extension has no build step

Pure vanilla JS, no bundler. Manifest content_scripts list is a hand-ordered list — order matters because:
- `src/lib/messages.js` defines `QA.MSG` constants
- `src/lib/figma-matcher.js` reads `QA.MSG`
- `src/core/issue-builder.js` reads `QA.uniqueSelector`, `QA.computedStyles`, `QA.localeDetector`, `QA.viewportDetector`, `QA.adapterRegistry`, `QA.figmaMatcher`, `QA.idGen`
- Everything attaches to `self.QA.<module>` via IIFE

If you add a new lib, add it to `manifest.json`'s `content_scripts.js` array in the right position (BEFORE its consumers).

### 3. ESM vs IIFE split

| Context | Module style |
|---|---|
| `src/background/service-worker.js` | ESM (`import`) — declared `"type": "module"` in manifest |
| `src/profile/profile-manager.js` | ESM (imported by service-worker) |
| Everything else | IIFE attaching to `self.QA` |

If you write a new file used by both the service-worker AND content/popup/settings, you'll need to maintain two versions OR inline the logic. `profile-validator.js` keeps an IIFE classic-script form for the settings page; the service-worker has its own duplicated `validate()` because mixing ESM + classic in `<script>` is painful. Inline duplication is fine for tiny logic.

### 4. The plugin is documentation, not code

`plugins/qa-tooling/commands/*.md` and `plugins/qa-tooling/skills/*/SKILL.md` are **instructions for Claude Code**, not executable scripts. They tell Claude:
- What MCP tools to call
- What files to read
- What `AskUserQuestion` prompts to ask
- What output shape to write

When Claude Code runs `/qa:figma-sync`, it reads `plugins/qa-tooling/commands/qa-figma-sync.md` and follows the steps. There's no node script that does it. So:
- Edit specs as markdown — narrative + JSON-shape examples
- Be precise about regex / coord systems / edge cases — Claude follows literally
- Use the canonical shape forms in templates (e.g. `qa-profile.template.json`)

---

## Key files (one-line tour)

### Extension
| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Permissions, content_scripts (order matters), web_accessible_resources for the built-in empty profile. |
| `src/content/content.js` | Bootstrap. Owns inspector lifecycle. Bridges popup ↔ inspector ↔ form-modal. |
| `src/core/inspector.js` | Hover-highlight + click + shift-click set. **Tooltip auto-flips below element** when near top of viewport (avoids being hidden under sticky page headers). |
| `src/core/form-modal.js` | The big modal. Multi-image gallery, computed-tabs (rows in qa-elements-list double as tabs), Figma chip + breadcrumb. |
| `src/core/issue-builder.js` | Builds the `Issue` object from picked element(s). Calls `QA.figmaMatcher.match()` if a tree is loaded. |
| `src/core/screenshot.js` | Crops `chrome.tabs.captureVisibleTab` PNG to picked rects + draws border. Reads `--qa-accent` CSS var live. |
| `src/lib/figma-matcher.js` | Hierarchy-first nearest-frame matcher. **Y-axis NOT scaled** (responsive web layouts). Decodes HTML entities. |
| `src/lib/viewport-detector.js` | Snapshot of viewport / breakpoint / device for issue.context. |
| `src/lib/exporter.js` | Builds qa-report-v1 + Markdown + ZIP entries. Aggregates `viewportsTested`. |
| `src/background/service-worker.js` | Storage owner. **`compressTree` accepts both long-form and short-form keys** — always use `?? short` fallback when reading tree fields. |
| `src/profile/profile-manager.js` | ESM profile CRUD with seed-on-install of empty profile. |
| `src/settings/settings.html`+`.js` | Card order: Import → Saved profiles → Saved issues → Figma tree → Theme color. **Loads `content.css` + `form-modal.js`** so the issue-edit modal can render here exactly as it does in-page. |
| `src/popup/popup.html`+`.js` | 380px wide. JSON/MD/ZIP export buttons on one row. |

### Plugin
| File | Role |
|---|---|
| `plugins/qa-tooling/plugin.json` | Manifest registering 4 commands + 4 skills. |
| `plugins/qa-tooling/commands/qa-init.md` | Single largest spec. Auto-detect everything; ≤3 AskUserQuestion prompts. |
| `plugins/qa-tooling/commands/qa-figma-sync.md` | MCP crawl + src scan. Default = full crawl (no `partial`). `--pages` / `--viewports` narrow → `partial: true`. |
| `plugins/qa-tooling/commands/qa-sync.md` | Jira issue creator (Markdown body, NOT ADF — see Gotcha #10). Multi-element list, multi-screenshot links, breakpoint+device row. |
| `plugins/qa-tooling/commands/qa-doctor.md` | 16 numbered checks across 5 sections (A Profile / B Source / C Figma tree / D Reports / E MCP). |
| `plugins/qa-tooling/skills/qa-figma-crawl/SKILL.md` | The biggest skill spec. **Coordinate system** section is critical: descendants are parent-relative (NOT absolute), so accumulate offsets — verified against MCP behavior 2026-05-07. |

---

## Conventions

### Always-use tools
- **`AskUserQuestion`** for every user prompt in a command/skill. Never inline `?` chat prompts. (See memory `feedback_ask_user_question.md`.)
- **Dedicated tools over Bash** for filesystem ops (Glob, Grep, Read, Edit). Bash only for git / shell-only operations.
- **No emojis in code** unless explicitly requested. Status reports / breadcrumbs use ✓ ⚠ ✗ ⚡ • sparingly.

### Naming
- Storage keys are flat strings: `profiles`, `activeProfileId`, `issues`, `settings`, `figmaTree:<profileId>`.
- Message types are `qa/<area>/<action>` (`qa/profile/get-active`, `qa/figma-tree/import`).
- CSS classes for in-page UI all start with `.qa-` and use `!important` (because they fight host-page styles).
- DOM ids for inspector overlays: `#qa-inspector-highlight`, `#qa-inspector-tooltip`. Don't reuse for anything else.

### CSS color
- Single var `--qa-accent` drives **everything** (inspector outline, multi-rings, screenshot border, modal accents, popup buttons, settings buttons).
- Set on `document.documentElement` from `chrome.storage.local["settings"].inspectorColor`.
- For soft fills, use `color-mix(in srgb, var(--qa-accent) NN%, transparent)` so it tracks the var.

---

## Gotchas (each one bit me at least once)

### 1. Figma MCP coords are parent-relative
`mcp__figma__get_metadata` returns `<frame x="..." y="...">` for every frame, but the page root carries absolute file coords while every descendant is **relative to its direct parent**. Don't subtract root coords from descendants — accumulate offsets down the parent stack instead. Memory: `feedback_figma_mcp_coords.md`.

### 2. Compress tree must accept both schemas
`compressTree` was reading long-form keys (`n.name`, `n.bbox`) but trees on disk often use short-form (`n.n`, `n.b`) because the test build script wrote them that way. Result: every node stored as `{n: undefined, t: undefined, ...}` and matcher fell back to page root. **Fix is in place** with `raw.name ?? raw.n` etc. — keep this when refactoring.

### 3. Y-axis must NOT be scaled
Live page width 2560 vs Figma desktop variant 1920 → a naive `liveScale = 2560/1920 = 1.33` applied to Y axis projects element rect ABOVE the actual section. Web layouts at supersize widths don't compress vertically — they pad horizontally. **`scaleY = 1` always.**

### 4. Tooltip near top of viewport
Inspector tooltip is positioned with `transform: translate(x, y - 22)`. When element is at `r.top < 26px`, this places the tooltip in the document area covered by the host page's sticky header — invisible. Check `r.top` and flip below the element when needed.

### 5. Cancel buttons (plural)
The form modal has THREE cancel-equivalents: header `×`, footer **Cancel**, Esc, backdrop click. Use `querySelectorAll('.qa-cancel')` not `querySelector` — the latter only finds the first.

### 6. `i18nAttribute` vs `i18nKeyAttribute`
Old name was `i18nAttribute`. Renamed to `i18nKeyAttribute` for symmetry. Both extension's `issue-builder.js` and built-in `empty.qa-profile.json` were updated. Plugin emits the new name. Don't reintroduce the old.

### 7. `docs/` blanket gitignore breaks `/qa:init`
A flat `docs/` line in `.gitignore` makes git short-circuit; appending `!docs/qa/**` doesn't re-include because the parent dir was already excluded. `qa-init.md` rewrites this to `docs/*` + `!docs/qa` + `!docs/qa/**`. Memory: `feedback_gitignore_docs_blanket_rule.md`.

### 8. Screenshot capture order matters
Capture must happen **before** the modal opens (not after — `chrome.tabs.captureVisibleTab` would see the dimmed modal). The flow: `inspector.stop() → overlay.hide() → requestAnimationFrame() × 2 → captureVisibleTab → modal.open(with screenshot already attached)`.

### 9. Auto-pulse animation on the floating bar
Uses `color-mix(in srgb, var(--qa-accent) ...%, transparent)` in keyframes. Older Chrome (<111) doesn't support `color-mix` in keyframes reliably. Manifest min Chrome is 114, so it's fine — just don't drop the version requirement.

### 10. mcp-atlassian write tools accept Markdown only — never ADF or wiki
`jira_create_issue` / `jira_update_issue` / `jira_add_comment` run a Markdown→wiki adapter on the body. Passing ADF JSON, raw wiki markup (e.g. `||header||` rows or `!file|thumbnail!` outside a Markdown context), or HTML triggers re-escaping: `!` becomes `\!` (image macro breaks), `*bold*` flips to `_italic_`, `||` headers prepend `||#||` shifting every column. The `qa-sync-jira` skill therefore uses a **bold-key list** for metadata (no `|` anywhere), fenced code blocks for selectors / computed values (where `|` is inert), and the wiki image macro `!filename|thumbnail!` only because it has no Markdown counterpart and passes through verbatim. Screenshots must be uploaded via `jira_update_issue`'s `attachments` parameter (JSON array of absolute paths) so the macro resolves against a real attachment. If the upload step fails, leave the issue created and surface the filename plain-text in the description so a human can drag-and-drop.

### 11. `form-modal.js` runs in TWO contexts
Originally written for the in-page content script. As of 0.1.5 it is also loaded by `src/settings/settings.html` so users can edit saved issues without re-picking. Two contracts that drop out of this:

- **`opts.disableRecapture`** must be true in settings — there is no source DOM element on the settings page, so the Recapture button would do nothing. The render function omits the button when this flag is set; the click-binding guard (`if (recaptureBtn)`) keeps it safe even if a caller forgets the flag.
- **Caller owns persistence**. Content script writes to `MSG.ISSUE_SAVE` after `formModal.open()` resolves; settings page does the same. If you add a third caller (e.g. side panel later), do the save yourself — the modal does not call `chrome.runtime.sendMessage`.

The settings page also reuses the in-page CSS by directly linking `content.css`. Keep `.qa-ext-ui.qa-modal-overlay` styles host-page-proof (with `!important` everywhere) so they don't leak/conflict in the options page either.

### 12. `expectedPerElement` invariants

Multi-pick issues carry a sparse override array `expectedPerElement` alongside the shared `expected`. Three rules the modal, exporter, and Jira skill all depend on:

- **Length matches `elements.length`** when present. Single-pick issues set `expectedPerElement` to `undefined` so it never serializes.
- **`null` (not `{}`) means "inherit"**. The modal's harvest collapses empty objects to `null`; consumers loop with `Array.isArray(epe) && epe.some(o => o && Object.keys(o).length)` before rendering. An empty object would render as a confusing blank "(N) overrides" section.
- **No `figma*` keys in overrides**. Figma fields (`figmaLink`, `figmaNodeId`, `figmaBreadcrumb`, `figmaScore`, `figmaViewport`, `figmaAutoMatched`) live only on shared `expected` — there's exactly one Figma anchor per issue. The modal strips these on save; the Jira skill defensively ignores them if a hand-edited report sneaks one in. Don't loosen this on either side.

The Jira skill renders shared and overrides as TWO separate blocks (`**Expected**` and `**Expected — (N) overrides**`). Never merge — the QA author's intent (which fields they chose to override vs. inherit) gets lost when you flatten.

---

## Common tasks

### Add a new slash command to the plugin

1. Write `plugins/qa-tooling/commands/qa-<n>.md` with frontmatter + clear `## Steps` heading
2. Add to `plugins/qa-tooling/plugin.json`'s `commands[]` array
3. Update `plugins/qa-tooling/README.md` table
4. If the command produces a new artifact, document the file path in `STATUS.md` and update `/qa:doctor` to check it

### Bump the plugin version

Bumping `plugins/qa-tooling/plugin.json#version` alone is **not enough** — Claude Code's `/plugin update` checks the version in `.claude-plugin/marketplace.json`, not in the plugin's own manifest. If only the plugin manifest is bumped, `/plugin update` will report "already up-to-date" and never pull the new code. Bump **all three** in the same PR:

1. `plugins/qa-tooling/plugin.json` → `version`
2. `.claude-plugin/marketplace.json` → `metadata.version` AND `plugins[].version` (the `qa-tooling` entry)
3. After merge, users run `/plugin update qa-tooling` then `/reload-plugins` to apply.

### Add a new field to qa-profile

1. Update `plugins/qa-tooling/templates/qa-profile.template.json` (with example value)
2. Update `plugins/qa-tooling/skills/qa-generate-profile/SKILL.md` composition rules
3. Update `plugins/qa-tooling/commands/qa-doctor.md` if the field should be validated
4. Update `src/profile/profile-validator.js` if the field is required (also duplicated in `service-worker.js`)
5. Update extension consumer (likely `src/core/issue-builder.js` for fields like conventions, or `src/lib/locale-detector.js` for locale fields)
6. Optionally regenerate the test profile at `D:\Code\worktree\homepage\about-us\docs\qa\qa-profile.json`

### Add a new computed signal to figma-matcher

The matcher's order is: `pickPage → pickViewportVariant → pickSectionRoot → containment + scoring`. To add a new heuristic:

- For **section resolution** (which subtree to scope to), add a priority to `pickSectionRoot`. Highest is `tree.sectionIndex[name].figmaNodeId`.
- For **frame matching within scope**, modify the score formula in `match()`. Current bonuses: +0.15 for Figma TEXT match, +0.10 for `sectionIndex.texts` match.

### Test changes

There's no automated test runner. Use a Node smoke script:

```js
// .tmp/test.mjs (delete after)
import { readFileSync } from 'node:fs';
global.self = global;
eval(readFileSync('src/lib/figma-matcher.js', 'utf8'));
const tree = JSON.parse(readFileSync('D:/Code/worktree/homepage/about-us/docs/qa/qa-figma-tree.json', 'utf8'));
const result = QA.figmaMatcher.match(tree, { /* ... */ });
console.log(result);
```

For Chrome integration test, use the chrome-devtools MCP — see test transcripts in git history (search "test plugin" / "test với chrome mcp").

### Backfill the about-us tree

After changing tree schema, you need to regenerate `D:\Code\worktree\homepage\about-us\docs\qa\qa-figma-tree.json`. Two options:

- **Real**: in a Claude Code session at that project, run `/qa:figma-sync` (no flags = full crawl).
- **Quick**: Node script that reads existing tree, mutates, writes. Drop in `.tmp/` and clean up after.

---

## Memory

User has these memories saved at `~/.claude/projects/D--Github-qa-annotator-extension/memory/`:

- `feedback_ask_user_question.md` — never inline `?` prompts
- `feedback_gitignore_docs_blanket_rule.md` — rewrite flat `docs/` rule
- `feedback_figma_mcp_coords.md` — accumulate offsets, don't subtract root

When making related decisions, check `MEMORY.md` (auto-loaded into Claude's context).

---

## Where to look when something breaks

| Symptom | First place to look |
|---|---|
| Inspector tooltip hidden | `src/core/inspector.js#moveHighlight` (top-of-viewport flip) |
| Modal save button doesn't fire | `src/core/form-modal.js#open` event listeners (Cancel querySelectorAll bug) |
| Screenshot shows the dimmed modal | `src/content/content.js#openIssueForElements` capture order |
| Auto-fill Figma link goes to page root | First check tree's compressed-key handling in `service-worker.js#compressTree`, then check `figma-matcher.js#pickSectionRoot` priority |
| Tree imported but tiny size (~50KB for 1000 nodes) | `compressTree` reading wrong keys — see Gotcha #2 |
| Y-coords off when on big monitor | `figma-matcher.js#match` — confirm `scaleY = 1` |
| `/qa:init` produces files but git ignores them | `.gitignore` has flat `docs/` rule — rewrite per Gotcha #7 |
| Match for picked element is wrong frame | Check `tree.sectionIndex[name].figmaNodeId` is correct; if null, the cross-reference didn't resolve. Look at `qa-figma-crawl` skill spec §6 |

---

## Don't

- Don't add a build step. The whole point is "load unpacked" simplicity.
- Don't bundle JSZip. The custom `zip-store.js` (store-mode only) is enough for MVP.
- Don't use shadow DOM in the modal. Multiple sites have CSP that blocks attachShadow on cross-origin iframes; vanilla `!important` CSS is more portable.
- Don't store screenshot dataURLs in `sync` storage (`chrome.storage.sync` has 100 KB quota). Use `local` (5–10 MB).
- Don't break message protocol without bumping the `qa/<area>/<action>` namespace prefix.

---

## Future-proofing notes

- Schema versioning: profile is `qa-profile-v1`, tree is `qa-figma-tree-v1`. Bump to `v2` when making breaking changes; service-worker should accept both during a deprecation window.
- Plugin works in any Claude Code project that has the right MCPs (mcp-atlassian for sync, figma for crawl). Decoupled from any specific repo.
- Extension can technically work with NO profile imported (uses bundled empty). Don't break that — it's the "first-time install" UX.
