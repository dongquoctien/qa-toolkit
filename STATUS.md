# Status — QA Annotator

> Last updated: 2026-05-09
> Owner: itdongquoctien

---

## ✅ Sprint 5 patch — v0.6.2 (shipped 2026-05-15)

> User reported: the `📱 360×640` chip pinned top-right of the emulated viewport covers the host site's menu/search/login. QA needed Inspector to click on elements behind the chip but couldn't.
>
> Fix: chip now auto-hides while Inspector is active (`pauseForInspector()` only hides chip, doesn't disable emulation). When Inspector stops (Esc), chip returns. The emulated viewport stays at 360×640 throughout — Inspector picks against the actual mobile layout that's visible.

## ✅ Sprint 5 — v0.6.1 (shipped 2026-05-09)

> User asked: when browser viewport shrinks to 360px to test mobile bug, the QA modal + annotation editor also shrink — hard to log bugs. Suggested: emulate viewport via plugin instead of resizing window, so popup stays full size.
>
> **v0.6.0 first attempt** used DOM-wrap (move host content into a 360px column). It worked for screenshot purposes but CSS media queries did NOT trigger because they read viewport width, not container width. Live test on ohmyhotelnco.com confirmed: navbar still rendered desktop layout inside the 360px column.
>
> **v0.6.1 fix** switches to `chrome.debugger.Emulation.setDeviceMetricsOverride` — same API DevTools Device Mode uses. Real viewport spoof. Trade-off: Chrome shows a debugger banner while active.

### Sprint 5 result — viewport emulator (v0.6.1 final architecture)

| # | Task | Files |
|---|---|---|
| 5.1 | **Service worker emulation** — `chrome.debugger.attach` per tab, `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled`. Per-tab `viewportState` map. Auto-detach on tab close + on user-dismiss banner. | `src/background/service-worker.js` (+~60 LOC) |
| 5.2 | **viewport-emulator.js thin wrapper** — sends `MSG.VIEWPORT_SET` to SW, renders in-page chip, manages sessionStorage. No host DOM manipulation. | `src/core/viewport-emulator.js` (~100 LOC) |
| 5.3 | **Popup UI — viewport dropdown** — 5 presets (Native / 360 / 414 / 768 / 1024) + Custom number input. Restores state from SW on popup open. | `src/popup/popup.html`, `popup.js`, `popup.css` |
| 5.4 | **CSS — chip only** — `#qa-viewport-chip` pink pill top-right with width × height label. Old wrap CSS removed. | `src/content/content.css` |
| 5.5 | **Manifest + CLAUDE.md gotcha #24** — add `debugger` permission, register viewport-emulator.js AFTER inspector.js. Bump 0.6.0 → 0.6.1. | manifest, docs |

### Why chrome.debugger after all?

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **DOM wrap (v0.6.0)** | No special permission | CSS media queries DON'T trigger → desktop layout still renders | ❌ Failed live test on ohmyhotelnco.com |
| **`chrome.debugger.Emulation.setDeviceMetricsOverride` (v0.6.1)** | Spoofs `window.innerWidth`, full DevTools Device Mode fidelity, media queries trigger | Requires `debugger` permission → banner | ✅ Accepted trade-off |
| CSS `transform: scale` | Pure CSS | Doesn't trigger media queries either | ❌ |

Chrome Web Store impact: extensions with `debugger` permission DO ship (e.g. React DevTools, Vue DevTools). Web Store flag is on misuse, not declaration.

### Defaults + UX details

- **Presets**: 360 (iPhone SE), 414 (iPhone 12 Pro), 768 (iPad mini), 1024 (iPad Pro), Native (off), Custom (200–2400px)
- **Height auto-derived** from preset (360→640, 414→896, 768→1024, 1024→1366). Custom uses 16:9.
- **`mobile: true`** when width < 768 → also enables touch emulation
- **Persist**: per-tab `sessionStorage["qa-viewport-w"]` — survives reload, resets on tab close
- **Inspector**: auto-pauses emulator while picking, restores after stop
- **Indicator chip**: pink pill `📱 360×640` pinned top-right of emulated viewport, pointer-events:none

---

## ✅ Sprint 4 — v0.5.0 (shipped 2026-05-09)

> User asked: add a manual capture flow — drag a custom region instead of auto-crop around a picked element. Two entry points: popup "Quick capture" icon + modal "New screenshot" button.

### Sprint 4 result — manual region capture

| # | Task | Files |
|---|---|---|
| 4.1 | **region-selector.js** — full-screen drag overlay. 4-way cutout backdrop, accent border with corner handles, dimension label, Capture/Cancel buttons under selection, Esc/Enter shortcuts. Min 8×8 threshold (treat smaller as click). Returns `{x,y,w,h}` viewport rect. | `src/core/region-selector.js` (~190 LOC) |
| 4.2 | **content.js manualRegionCapture pipeline** — hide overlay → region pick → captureVisibleTab → cropAndAnnotate(annotate=false) → annotation editor → return shot. Handler `MANUAL_CAPTURE_START` for popup-triggered flow. | `content.js` (+~120 LOC), `lib/messages.js` |
| 4.3 | **issue-builder.buildBlank** — manual-only issue with no element/computed/source. Marks `isManual: true`. Modal handles missing element gracefully (skips Element + Computed rows). | `issue-builder.js` (+~70 LOC) |
| 4.4 | **Form modal — New screenshot button + rename Recapture** — added `qa-new-shot` button next to Recapture. Renamed Recapture → "Recapture (auto)" so user knows the difference. Element row hides when `hasElements === false`. | `form-modal.js` |
| 4.5 | **Popup — Quick capture icon** — crop SVG icon button next to Start Inspector. Click → message content script → window.close(). | `popup.html/js/css` |
| 4.6 | **Test live qua MCP** — region drag pixel-perfect, Capture / Cancel / Esc / min-size all work. Full flow region → editor verified. | — |
| 4.7 | **Docs + release v0.5.0** | docs + manifest |

### Two entry points

| Trigger | Use case | Issue model |
|---|---|---|
| Popup "Quick capture" icon | Bug không liên quan element cụ thể (vd graph mismatch, icon misalign across multiple elements) | `buildBlank()` → manual-only issue, no element/computed |
| Modal "New screenshot" button | Đã có issue đang fill, muốn capture thêm region khác | Push thêm shot vào `issue.screenshots[]` |

### UX details

- **Backdrop**: 30% black dim toàn viewport, **clear** trong selection rect
- **Selection**: pink 2px border, 4 white-pink corner handles, dim label "300 × 200" pink badge top-left
- **Buttons**: floating "Cancel" + "Capture" (pink primary) ngay dưới selection
- **Banner**: "Drag to select an area · Esc cancel · Enter capture" — fade dim after 3s
- **Min size**: drag <8×8 → treat as click, reset to idle
- **Out-of-bounds**: button position auto-flips above selection if too close to viewport bottom

### Verified live via MCP

- ✅ Region overlay opens with backdrop + banner
- ✅ Drag rectangle 100,100 → 400,300 → box visible 300×200, dim label correct
- ✅ Capture button click → returns rect, overlay closes
- ✅ Esc cancels, returns null
- ✅ Min-size 5×5 drag → treat as click, reset (no false rect)
- ✅ Full flow: region → cropped image → annotation editor opens with 6 tools
- ✅ Popup: Start Inspector flex:1 + Quick capture icon button bên phải

---

## ✅ Sprint 3 — v0.4.0 (shipped 2026-05-08)

> User asked: per-mode form builder so each QA mode has its own visible/required fields. Research showed Linear/Jira/Notion patterns — landed on Notion-style table + Jira 3-state pill, scoped by mode tabs.

### Sprint 3 result — form builder per mode

| # | Task | Files |
|---|---|---|
| 3.1 | **Form config schema + resolver** — `DEFAULT_FORM_CONFIG[mode]` per-mode defaults. `getEffectiveFormConfig(mode, settings)` deep-merges user override on top of defaults. Field state: 'hidden' \| 'optional' \| 'required'. Sub-field schema declared per panel for v0.5.0 expand-row UI. | `src/core/form-config.js` (~200 LOC) |
| 3.2 | **Settings UI — form builder card** — tabs across 6 modes, table of common fields + panels, 3-state segmented pill (Hidden/Optional/Required). Toolbar: Copy from another mode + Reset to defaults. | `settings.html`, `settings.js` (~150 LOC), `settings.css` |
| 3.3 | **Form modal integration** — reads `getFormConfig()` per render. Common rows (Title/Severity/Type/Note/Expected CSS/Figma/Screenshots) render conditionally based on `fieldVisible(formCfg, id)`. Required indicator (red asterisk). Validation gate uses `fieldRequired()`. Panel registry consults form config for visibility. | `form-modal.js` (~80 LOC delta), `panel-registry.js#panelsForMode` (form-config aware) |
| 3.4 | **Docs + release** — bump 0.3.0 → 0.4.0, STATUS / CLAUDE / README updated, tag v0.4.0 | docs + manifest |

### Schema

```js
settings.modeForms = {
  'prod-bug': {
    fields: { title: 'required', severity: 'required', type: 'optional', note: 'optional', expectedCss: 'hidden', figmaLink: 'hidden', screenshots: 'optional' },
    panels: { 'runtime-context': { state: 'required', fields: { reproSteps: 'required' } } }
  },
  'design-fidelity': { /* ... */ },
  // ...
}
```

### Default form config per mode

| Mode | Required common fields | Required panel | Hidden fields |
|---|---|---|---|
| prod-bug | title · severity | runtime-context | expectedCss · figmaLink |
| design-fidelity | title | design-fidelity | (none — show Figma + Expected) |
| admin | title · severity | app-state | expectedCss · figmaLink |
| a11y | title · severity | a11y-findings | expectedCss · figmaLink |
| i18n | title | i18n-findings | expectedCss · figmaLink |
| custom | title · severity | (none required) | (none — all visible) |

### Verified live via chrome-devtools MCP

- ✅ 6 tabs render, prod-bug active default
- ✅ 13 rows (7 common + 6 panels), each with 3-state pill
- ✅ Pill toggle persists to `settings.modeForms[mode].fields[field]`
- ✅ Locked pill on core fields (Title/Severity always required, can't change)
- ✅ Hidden = gray pill, Optional = blue, Required = pink (theme accent)
- ✅ Modal validation reads required fields from form config (not legacy `defaults.requiredFields`)
- ✅ Modal renders only visible fields per mode
- ✅ Required asterisk (red `*`) on labels of required fields
- ✅ "Copy from" toolbar button copies config from one mode to another
- ✅ "Reset to defaults" clears user override for active tab

---

## ✅ Sprint 2 — v0.3.0 (shipped 2026-05-08)

> User asked: each QA mode needs its own form fields, not the same form for everything. Research showed Linear-style "issue type" pattern hides irrelevant fields. Approach 2 — dynamic panel registry — picked.

### Sprint 2 result — mode-aware modal panels

| # | Task | Files |
|---|---|---|
| 2.1 | **Panel registry** — `register/render/mount/harvest` contract. Mode → panels[] map. Custom mode reads `settings.customPanels[]`. Click-to-collapse panel headers. Cleanup queue in form-modal lifecycle. | `src/core/panel-registry.js` (~180 LOC), `form-modal.js` (mount + harvest hook + cleanups[]) |
| 2.2 | **Pin notes panel** (universal) — list every numbered pin per screenshot, textarea per pin, mutates `screenshots[i].annotations.layers[j].note` on save. Round-trip lossless with annotation-editor. | `src/core/panels/pin-notes.js` (~140 LOC) |
| 2.3 | **Runtime context panel** (prod-bug + admin) — repro steps numbered list (add/remove/renumber), expected vs actual textareas. Auto-displays console + network + env from Sprint 1 buffer. | `src/core/panels/runtime-context.js` (~210 LOC) |
| 2.4 | **Design fidelity panel** (design-fidelity) — mismatch category 6-radio (spacing/color/typography/alignment/asset/other), Figma link auto-matched, breadcrumb, breakpoint, implementation notes. | `src/core/panels/design-fidelity.js` (~120 LOC) |
| 2.5 | **App state panel** (admin) — auto-detects role/tenant from `data-user-role` / `data-tenant-id` attrs (configurable via `settings.appStateSelectors`). Manual: action attempted, form payload (JSON paste). Auto: route, open modal, table state. | `src/core/panels/app-state.js` (~140 LOC) |
| 2.6 | **A11y findings panel** (a11y) — rich axe display: violations list with WCAG SC + helpUrl + impact badge + selector. Contrast row with swatches + ratio + pass/fail. User edits: rule selection, affected user group (7 options), fix suggestion. | `src/core/panels/a11y-findings.js` (~160 LOC) |
| 2.7 | **i18n findings panel** (i18n) — auto-detect locale (from context) + direction (from document.dir) + i18n key (from element). Manual: bug category (8 types: truncation/mirroring/hardcoded/plural/format/translation/missing), source string, rendered string, linguistic vs technical, notes. | `src/core/panels/i18n-findings.js` (~140 LOC) |
| 2.8 | **Exporter + Jira sync update** — `renderPanelsMarkdown` block per issue. Each panel has its own MD renderer that skips silently when empty. Settings card "Custom mode panels" with checkbox grid for user preset. | `src/lib/exporter.js` (+~140 LOC), `settings.html`, `settings.js`, `settings.css` |
| 2.9 | **Docs + release** — bump 0.2.0 → 0.3.0, STATUS / CLAUDE / README updated, tag v0.3.0 | docs + manifest |

### Mode → panels mapping

| Mode | Panels (in render order) |
|---|---|
| `prod-bug` | runtime-context · pin-notes |
| `design-fidelity` | design-fidelity · pin-notes |
| `admin` | runtime-context · app-state · pin-notes |
| `a11y` | a11y-findings · pin-notes |
| `i18n` | i18n-findings · pin-notes |
| `custom` | user picks via Settings → "Custom mode panels" checkboxes (empty = all) |

### Schema additions (issue model)

```js
issue.panels = {
  'runtime-context': { reproSteps[], expected, actual },
  'design-fidelity': { mismatchCategory, notes },
  'app-state':       { role, tenantId, actionAttempted, formPayload, auto: { route, openModal, tableState } },
  'a11y-findings':   { selectedRule, affectedUserGroup, fixSuggestion },
  'i18n-findings':   { locale, direction, i18nKey, bugCategory, sourceString, renderedString, linguisticOrTechnical, notes },
  'pin-notes':       { entries: [{ shotIdx, n, note }], count }
}
```

Empty panel data is skipped on serialize; old issues without `panels` still load (panels object is optional).

### Verified live via chrome-devtools MCP

- ✅ Each mode loads only the right panels (prod-bug=2, admin=3, a11y=2, i18n=2)
- ✅ Auto-detection: role/tenant from body attrs, route from location, locale from context, direction from document.dir, i18n key from element
- ✅ Click panel header → collapse/expand (chevron rotates)
- ✅ Custom mode reads `settings.customPanels[]`; empty = show all
- ✅ Round-trip: pin notes save mutates `layer.note`, reload restores
- ✅ Runtime context: add/remove step renumbers correctly
- ✅ Markdown export renders all 6 panels in order with proper formatting
- ✅ Settings page "Custom mode panels" grid renders 6 panels with mode chips

---

## ✅ Sprint 1 — v0.2.0 (shipped 2026-05-08)

> The user's ask was: extension currently only catches CSS/computed mismatches; grow it into a real QA workhorse covering frontend AND admin systems. Specifically: numbered/annotated screenshots ("chụp ảnh đánh số và chú thích"), bug area + fix area markup ("phần lỗi, phần nên sửa"), and works without Figma (PROD bugs, admin systems).

### Sprint 1 result — 8 features shipped

| # | Task | Files |
|---|---|---|
| 1.1 | **Settings expansion** — QA mode picker (PROD-bug / Design-fidelity / Admin / A11y / i18n / Custom), capture prefs, privacy & redaction, capture-sources grid, issue defaults, integrations, inspector behavior | `src/settings/settings.html`, `settings.js`, `settings.css`, `service-worker.js` (DEFAULT_SETTINGS + deepShallow merge) |
| 1.2 | **Annotation editor** — canvas overlay: numbered pin auto-increment, arrow, rectangle (red=bug / green=expected / info), text callout, freehand, blur PII (pixelate sampling base canvas). Undo/redo, hotkeys P/R/A/T/B/F. Persist as flattened PNG + annotations source for re-edit | `src/core/annotation-editor.js` (~480 LOC), `form-modal.js` (✎ thumb badges), `content.js` (maybeAnnotate hook), `content.css`, `manifest.json` |
| 1.3 | **Console + network capture** — world MAIN inject, ring-buffer last 50 console errors + 20 failed requests, attached at pick. Honors `settings.privacy.redactPatterns`. Bridge via `window.postMessage` with requestId routing | `src/lib/runtime-buffer.js`, `src/content/runtime-bridge.js`, `form-modal.js` (renderRuntimeContext), `content.js`, `manifest.json` (web_accessible_resources) |
| 1.4 | **Accessibility quick-scan** — axe-core 4.10.3 bundled (~540KB MPL), `scan(el)` → trimmed violations + WCAG SC tags, `quickContrast(el)` → sync ratio calc. Contrast badge on inspector tooltip when mode=a11y. Subtree filter so violations don't leak from sibling subtrees | `src/vendor/axe.min.js`, `src/lib/a11y-scan.js`, `form-modal.js` (renderA11yFindings), `inspector.js` (setMode + badge), `content.js`, `manifest.json` |
| 1.5 | **Issue defaults** — title template substitution (`{{section}}/{{page}}/{{viewport}}/{{tag}}/{{element}}/...`), auto-tag rules from URL regex, severity hotkeys 1/2/3/4, required-field validation gate (banner + red outline + auto-clear on input) | `issue-builder.js#expandTemplate`, `computeAutoTags`, `form-modal.js#validateRequired`, `content.css` |
| 1.6 | **Mode-scoped settings UI** — `data-modes` attribute filters cards visible per mode. Primary cards highlighted (pink border + "recommended" tag), non-primary auto-collapse. "Show all cards" link to break out. Hint banner per mode | `settings.html` (data-modes attrs), `settings.js` (applyModeVisibility, MODES presets), `settings.css` |
| 1.7 | **Mode + pin count UX surface** — popup mode chip (color-coded per mode: red/purple/blue/green/orange/gray) + total pin chip. Modal mode chip + pin chip in header. Per-thumbnail pin/annot badges. Issues table "Annotations" column | `popup.html/js/css` (mode-chip, pin-summary), `form-modal.js` (modeChip, pinChip, qa-thumb-pin-badge, qa-thumb-annot-badge), `settings.html/js` (Annotations column) |
| 1.8 | **Card reorder** — workflow logic order: Setup → Data → Workflow tuning (Inspector first) → Output (Integrations) → Cosmetic (Theme) → Footer (Advanced). Inspector behavior moved 12→6, Theme color moved 6→12 | `settings.html` |

### Settings storage schema (expanded — backward-compatible default-merge)

```js
chrome.storage.local["settings"] = {
  // existing
  inspectorColor: "#ec4899",

  // NEW — first-run mode picker; presets others
  mode: "prod-bug",                     // prod-bug | design-fidelity | admin | a11y | i18n | custom
  modeChosenAt: "2026-05-08T...",       // null until user picks once

  // capture
  capture: {
    openAnnotationEditor: true,         // open editor after capture before save
    pinStyle: "circle-number",          // circle-number | square-number | letter | prefix
    pinPrefix: "",                      // "BUG-" → BUG-1, BUG-2
    pinColorMode: "accent",             // accent | severity
    defaultTool: "pin",                 // pin | rect | arrow | text | blur | freehand
    padding: 80,
    stitchingMaxSlices: 8,
    autoCapture: true,                  // false = manual button, no auto on pick
    pngQuality: "standard",             // low | standard | high
    hideSelectorsBeforeCapture: []      // CSS selectors to display:none for capture window
  },

  // privacy & redaction
  privacy: {
    blurSelectors: [
      "input[type=password]",
      "input[type=email]",
      "[data-pii]"
    ],
    redactPatterns: [],                 // regex source strings, applied to console + network bodies
    rrwebStripStorage: true,
    hashUserIds: false,
    rrwebAllowlistDomains: []
  },

  // capture sources — what auto-attaches at pick
  sources: {
    computed: true,
    source: true,
    consoleErrors: false,
    networkFailures: false,
    a11y: false,
    rrweb: false,                       // Sprint 2
    appState: false,                    // Sprint 2
    perfMetrics: false                  // Sprint 2
  },

  // issue defaults
  defaults: {
    severity: "minor",
    type: "bug",
    requiredFields: ["title", "severity"],
    titleTemplate: "",                  // "[{{section}}] " expanded at build time
    severityColors: {
      critical: "#ef4444",
      major: "#f97316",
      minor: "#eab308",
      info: "#3b82f6"
    },
    autoTagRules: [],                   // [{ pattern: "/admin/", tag: "area:admin" }]
    severityHotkeys: { "1": "critical", "2": "major", "3": "minor" }
  },

  // integrations (optional overrides on top of profile)
  integrations: {
    jiraProjectKey: "",
    jiraAssignee: "",
    jiraLabels: [],
    jiraParent: "",
    slackWebhook: "",
    githubRepo: "",
    figmaToken: ""
  },

  // inspector behavior
  inspector: {
    thickness: 3,
    style: "solid",
    showTooltip: true,
    tooltipFields: ["tag", "classes", "computed", "breakpoint"],
    clickThrough: false,
    domainBlocklist: [],
    autoStopAfterPick: true,
    shortcuts: { pick: "click", multi: "shift+click", done: "Enter", stop: "Escape" }
  },

  // advanced
  advanced: {
    debugLogging: false
  }
}
```

### Mode presets — what each mode toggles

| Mode | sources.* on by default | UI changes |
|---|---|---|
| `prod-bug` | computed, source, consoleErrors, networkFailures | Figma block hidden in modal |
| `design-fidelity` | computed, source | Figma block prominent + token suggestion (Sprint 2) |
| `admin` | computed, source, consoleErrors, networkFailures, appState | App-state row in modal |
| `a11y` | computed, source, a11y | A11y tab open by default; contrast badge always |
| `i18n` | computed, source | Pseudolocale toggle in popup; locale switcher row |
| `custom` | (user picks) | All toggles surfaced |

### Annotation file format (`screenshots[i].annotations`)

```js
{
  width: 1280, height: 720,
  layers: [
    { type: "pin",  x: 120, y: 80, n: 1, color: "#ef4444", note: "wrong padding" },
    { type: "rect", x: 100, y: 60, w: 200, h: 100, color: "#ef4444", role: "bug" },
    { type: "rect", x: 320, y: 60, w: 200, h: 100, color: "#22c55e", role: "expected" },
    { type: "arrow", x1: 150, y1: 110, x2: 320, y2: 110, color: "#0ea5e9" },
    { type: "text", x: 220, y: 50, text: "should match design", color: "#1f2937", font: "14px" },
    { type: "blur", x: 50, y: 200, w: 100, h: 30, radius: 8 },
    { type: "freehand", points: [[10,10],[20,15],...], color: "#ef4444", width: 2 }
  ]
}
```

`dataUrl` = the *flattened* PNG (already drawn). `annotations` = re-editable source. Settings page modal can re-open editor on a saved issue and reload these layers.

---

## Big picture

Two-piece QA tooling for any web project:

| Piece | Purpose | Phase 1 status |
|---|---|---|
| **Chrome extension** (root of this repo) | Click any element on a live site → log a QA issue with computed styles, source `file:line`, screenshot, viewport context, **auto-resolved Figma deeplink** | ✅ Built and tested live in Chrome |
| **Claude Code plugin** ([`plugins/qa-tooling/`](plugins/qa-tooling/)) | `/qa:init` auto-detects stack → `qa-profile.json`. `/qa:figma-sync` crawls Figma → `qa-figma-tree.json`. `/qa:sync` pushes QA reports to Jira via MCP. | ✅ Specs done; `/qa:figma-sync` exercised live against about-us project |

The two are linked by **two files** generated by the plugin and consumed by the extension:

- `qa-profile.json` — project conventions (URL patterns, framework, locales, sections, Jira/Figma defaults)
- `qa-figma-tree.json` — cached Figma frame tree for nearest-ancestor matching

---

## ✅ Done

### Extension (v0.2.0 — Sprint 1, 2026-05-08)

#### QA modes (workflow presets)
- Six modes: `prod-bug` (live site bugs), `design-fidelity` (Figma compare), `admin` (CMS / internal), `a11y` (accessibility), `i18n` (localization), `custom` (user-tuned).
- First-run picker in Settings → "QA mode" card. Each mode auto-toggles `sources.*` defaults and surfaces only the relevant Settings cards (data-modes attribute on each card).
- Mode chip color-coded across popup header, modal header — red/purple/blue/green/orange/gray per mode.

#### Annotation editor (canvas, post-capture)
- Opens after auto-capture (toggleable via `settings.capture.openAnnotationEditor`).
- Six tools: numbered pin (auto-increment, four styles: circle/square/letter/prefix), rectangle (red=bug / green=expected / accent=info), arrow with arrowhead, text callout, blur (pixelate sampling base canvas — PII redaction), freehand pen.
- Undo / Redo (Ctrl+Z / Ctrl+Shift+Z, 30-snapshot history). Hotkeys P/R/A/T/B/F.
- Persists both flattened PNG (`screenshots[i].dataUrl`) AND re-editable annotation source (`screenshots[i].annotations.layers[]`). Settings page can re-open editor on saved issues.

#### Console + network capture (page-world ring buffer)
- World MAIN injection via `web_accessible_resources` + `<script>` tag. Idempotent guard `__qaRuntimeBufferLoaded`.
- Intercepts `console.error`, `console.warn`, `window.error`, `unhandledrejection`, `fetch`, `XMLHttpRequest`. Only failures (status ≥ 400 or thrown) are buffered.
- Ring buffers: 50 console events, 20 network failures.
- `settings.privacy.redactPatterns` (regex source strings) scrub bodies + URLs before storage.
- Bridge via `window.postMessage({ src: 'qa-ext'/'qa-runtime' })` with requestId routing. 250ms timeout fallback.

#### Accessibility scan (axe-core 4.10.3)
- Bundled in `src/vendor/axe.min.js` (~540KB, MPL 2.0). Loaded as content_script.
- `QA.a11yScan.scan(element)` — axe.run scoped to subtree, post-filtered so violations from sibling subtrees don't leak through. Returns trimmed violations with WCAG SC tags + helpUrl.
- `QA.a11yScan.quickContrast(element)` — synchronous WCAG 2.x AA contrast calc (no axe call). Used by inspector tooltip when `mode === 'a11y'` to render a `✓ 4.5:1` / `✗ 2.34:1` badge.

#### Issue defaults (settings-driven)
- Title template substitution: `{{section}}`, `{{page}}`, `{{viewport}}`, `{{breakpoint}}`, `{{tag}}`, `{{element}}`, `{{i18nKey}}`, `{{url}}` expanded at issue-build time.
- Auto-tag rules: URL regex match → `issue.tags[]` populated. Bad regex skipped silently.
- Severity hotkeys: 1=critical, 2=major, 3=minor, 4=info (configurable). Skips when typing in input/textarea/select.
- Required-field validation: banner + red outline on missing fields. Save button blocked. Auto-clears on input.

#### Mode + pin count UX surfacing
- Popup header: mode chip ("PROD BUG" / "Design" / "Admin" / "A11y" / "i18n" / "Custom") with mode-specific color. Issues count + total pin chip ("4 pins").
- Modal header: ID badge + mode chip + 📍N pin chip + viewport chip + section/source + close.
- Each thumbnail: 📍N pin badge + ✦N other-shapes badge (rect/arrow/text/blur).
- Settings issues table: "Annotations" column with 📍N + ✦N tags + "X/Y shots" hint.

### Extension (Phase 1)

#### Core inspector
- Manifest V3 with `<all_urls>` host permission
- Hover-highlight + crosshair cursor (theme-color outline)
- Click-to-pick single element
- **Shift+click to add** to multi-pick set; floating bar shows `+N` and Done button (Enter shortcut)
- Esc anywhere stops inspector
- Tooltip auto-flips below element when near top of viewport (avoids being clipped under sticky page headers)

#### Issue model
- `issue.id` ISS-001…ISS-NNN auto-generated
- Computed styles per element (`computedPerElement[]`); auto-grouped when identical, per-element tabs in modal when different (rows in `qa-elements-list` are the tabs)
- Per-element selector list with `data-section` / `data-component` / `data-page` / `data-i18n-key` (renamed from `data-i18n`) hints
- Astro source mapping when `vite.build.sourcemap` is enabled (resolves `file:line`)
- Viewport / device snapshot per issue: `viewport.{w,h,dpr,orientation}`, `document.{w,h,scrollX,scrollY}`, `breakpoint.{label,generic,all:{tailwind,bootstrap,generic}}`, `device.{platform,isMobile,isTouch,prefersDark,prefersReducedMotion,userAgentBrand}`
- `viewportLabel` chip in modal header (e.g. "1280×800 · lg · @1.5x")

#### Modal UX
- Cancel: header X, footer Cancel button, Esc, backdrop click — all close
- Searchable property combo for Expected (datalist of 30+ CSS props); default 2 rows (font-size, font-weight); + Add property / × remove
- Auto-fills `expected.figmaLink` from the imported Figma tree using nearest-ancestor matcher (hierarchy-first → bbox containment → text bonus)
- ⚡ "auto-matched" chip + breadcrumb under Figma link, e.g. `1920_home > section 4 > Frame 1000003737 (• Recognition | There are reasons why global partners choose us.)`
- HTML entity decoding in breadcrumb summaries

#### Screenshots
- Auto-captured **before modal opens** (overlays hidden + `requestAnimationFrame` × 2 so capture sees only the page)
- Cropped to bounding box of all picked elements + 80px padding
- Theme-colored border drawn on each picked rect
- Multi-image gallery: drag-reorder, delete, click-to-preview
- 3 ways to add more: **Recapture** (re-grab page) · **Paste image** (clipboard, also Ctrl/Cmd+V anywhere in modal) · **Upload** (file picker, multi-select)

#### Saved-issue management (v0.1.5)
- Settings page: "Saved issues" card lists every issue in storage (ID · title · severity · page/section · viewport · saved date)
- **Edit** opens the same form-modal used during pick — title / severity / type / expected / per-element overrides / note / paste/upload screenshots; save persists via `MSG.ISSUE_SAVE`. Recapture button hidden in this context (no source DOM)
- **Delete** removes a single issue (Clear All in popup still works for bulk)
- **Import report** ingests a `.zip` (full export with screenshots) or `.json` (`qa-report-v1`); skips duplicate IDs by default; reports `(N imported, M skipped, K screenshots reattached)`. Re-attaches screenshot dataUrls from ZIP entries by `relativePath` lookup with basename fallback

#### Profile + theme color
- Settings page: Import profile (file or paste JSON) → validation → table list with set-active / delete
- Theme color: 6 preset swatches + custom `<input type=color>`. Drives inspector outline, multi-pick rings, screenshot border, AND popup/modal/settings UI accents (single var `--qa-accent` everywhere)

#### Figma frame tree
- Settings page: separate import card per profile
- Validates `tree.fileKey === profile.figma.fileKey` (with override prompt)
- Stored compressed in `chrome.storage.local["figmaTree:<profileId>"]`
- Compression: 1-char keys, drop `_doc`, drop empty bbox, decode-aware
- Cascade-deletes when profile is deleted
- `figma-matcher.js` runtime:
  - X-axis scaled to live viewport, **Y-axis NOT scaled** (matches typical responsive web layouts)
  - Hierarchy-first: prefers `sectionIndex[name].figmaNodeId` (auto-resolved or `// figma:` comment)
  - Falls back to bbox-contains-rect smallest-frame match
  - Text bonuses on Figma TEXT match + on `sectionIndex.texts` match
  - Breadcrumb shows summary of frame contents (concatenated descendant text)

#### Export
- JSON (`qa-report-v1`)
- Markdown — heading + per-issue (selector list, computed grouped vs per-element, screenshot links, viewport)
- ZIP — JSON + MD + `screenshots/<filename>` PNGs
- All multi-screenshot per issue (`issue.screenshots[]`)
- Viewport coverage in report header (`viewportsTested`)
- Idempotent — saved issues survive browser restart in `chrome.storage.local["issues"]`

#### Icons
- 16 / 32 / 48 / 128 px PNGs in `assets/`
- Wired into manifest `action.default_icon` + top-level `icons`

### Plugin (Phase 1)

#### Commands
- `/qa:init` — auto-detect framework, locales, sections, routes, Figma file, git remote. Writes `docs/qa/qa-profile.json` + README + `.gitkeep`. Asks at most 3 `AskUserQuestion` prompts (Jira project, parent ticket, Figma key) — only when not detectable. Optional follow-up prompt for per-page Figma nodeIds.
- `/qa:doctor` — health-check across 5 dimensions (Profile · Source conventions · Figma tree · Reports · MCP availability). Each item: ✓ pass / ⚠ warn / ✗ fail with one-line fix.
- `/qa:sync` — read latest QA report → create Jira sub-tasks (or tasks / append) via `mcp-atlassian`. Idempotent (skip already-synced). Surfaces multi-pick selectors, multi-screenshot links, breakpoint+device row.
- `/qa:figma-sync` — crawl Figma file via MCP → emit `docs/qa/qa-figma-tree.json` for the matcher. Default = full crawl. `--pages`/`--viewports` flags narrow scope and mark `partial: true`. **Auto-cross-references i18n strings to Figma TEXT nodes** to populate `sectionIndex[*].figmaNodeId` automatically.

#### Skills (encapsulated logic)
- `qa-detect-stack` — workspace resolution (monorepo aware), framework, locales (incl. `prefixDefaultLocale`), sections, routes (Astro/Next), Figma key+slug, git, Jira project guess. Mines per-section nodeIds from `docs/design-system/component-map.json` + `data-figma-node-id` attrs + `// figma:` comments.
- `qa-generate-profile` — composes `qa-profile-v1` from stack + answers. Adds `pages[]`, `pageDetection[]`, `sections[].figma`, `localeStrategy.prefixDefaultLocale`, etc.
- `qa-figma-crawl` — MCP traversal per (page, viewport) → flat node lookup. Coordinate normalization (page root = (0,0); descendants accumulate offsets — verified against MCP behavior on 2026-05-07). Computes `summary` field per FRAME = concatenated descendant text. Builds `sectionIndex` from src + cross-references with i18n.
- `qa-sync-jira` — ADF body builder. Multi-element list, per-element computed blocks when not identical, viewport/breakpoint/device rows, screenshot link per shot, append-mode session header with `viewportsTested`.

#### Templates
- `qa-profile.template.json`, `qa-figma-tree.template.json`, `qa-readme.template.md`

#### Memory & convention
- `feedback_ask_user_question.md` — always use `AskUserQuestion`, never inline `?` prompts
- `feedback_gitignore_docs_blanket_rule.md` — rewrite flat `docs/` to `docs/*` + `!docs/qa` + `!docs/qa/**`
- `feedback_figma_mcp_coords.md` — MCP `get_metadata` returns parent-relative coords for descendants

### Documentation
- [`README.md`](README.md) (this repo)
- [`docs/INSTALL.md`](docs/INSTALL.md) — extension load + workflow + storage layout
- [`plugins/qa-tooling/README.md`](plugins/qa-tooling/README.md) — commands, skills, install
- [`docs/archive/`](docs/archive/) — original PLAN.md, PLUGIN_PLAN.md, SUMMARY.md, FLOWCHARTS.md (historical design docs)

---

## ⚠️ Known limitations

| Area | Note |
|---|---|
| **Astro source maps** | `file:line` only resolves when target project enables `vite.build.sourcemap`. Most public projects don't — adapter falls back to `generic`. About-us project still doesn't have it. |
| **i18n attr** | Renamed to `i18nKeyAttribute` (Phase 1 originally used `i18nAttribute`). Plugin emits the new name; built-in `empty.qa-profile.json` matches. |
| **Static text scan in `qa-figma-crawl`** | Only catches literal `<h2>String</h2>`. Projects using i18n props (`{t('hero.headline')}` or `{prop.headline}`) yield empty `texts[]`. Cross-reference falls back to i18n source (`src/i18n/en.json`) but only when keyword maps section name → i18n namespace (KEYWORDS table is project-specific in current backfill). |
| **about-us tree is partial** | Currently `qa-figma-tree.json` covers only **home page × 4 viewports**. 23 `(page, viewport)` tuples remain. Run `/qa:figma-sync` (no flags) in a Claude Code session at that project to complete. |
| **No live test of `/qa:sync`** | Spec is complete but no Jira issues were actually created during testing. |
| **`/qa:doctor` warns silently** | `/qa:doctor` returns text only — no exit code, no machine-readable status. |

## 🐛 Real bugs caught + fixed (history)

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | Cancel button (footer) didn't close modal | `form-modal.js` used `querySelector` instead of `querySelectorAll` | Switched to `querySelectorAll` |
| 2 | Screenshot captured the dimmed modal | Capture happened AFTER modal opened | Moved capture BEFORE modal; hide overlays + RAF×2 |
| 3 | Tooltip clipped under sticky page header | Tooltip placed at `top - 22px` always | Flip below when `r.top < 26px` + horizontal clamp |
| 4 | Markdown export missing extra elements | Only used `i.element.selector` | List all `i.elements[]` |
| 5 | Figma matcher matched parent-relative coords as absolute | XML parser logic | Walk-and-accumulate offsets per ancestor stack |
| 6 | `i18nAttribute` vs `i18nKeyAttribute` mismatch | Plugin emits new name, extension read old | Renamed extension to read new name |
| 7 | `pageDetection` not emitted by plugin | qa-generate-profile skill missing field | Spec'd; backfilled about-us profile |
| 8 | Multi-pick / multi-screenshot ignored in Jira sync | qa-sync-jira spec referenced primary only | Spec rewritten for arrays |
| 9 | Y-scale wrong on >1920 viewports | matcher scaled both X and Y | scaleX only; scaleY = 1 |
| 10 | Image gallery `applyColorPreview` undefined | settings.js renamed function but missed event listener | Renamed to `applyTheme` consistently |
| 11 | matcher crash on null layer name | `pickSectionRoot` called `n.n.replace` | Added null guards |
| 12 | Tree imports stored as 54.6 KB instead of 164 KB | `compressTree` read long-form keys but tree had short-form | Accept both via `?? short` fallback |
| 13 | RecognitionSection link landed on page root | sectionName ≠ Figma layer name + Y-scale bug | Cross-ref auto-fills `sectionIndex.figmaNodeId`; Y-scale fix |

---

## ❌ Not built (Phase 2+)

### Extension Phase 2
- Side Panel API (chrome.sidePanel) — modal in panel, survives navigation
- Profile editor in settings (currently must edit JSON externally + re-import)

### Plugin Phase 2
- `/qa:profile show/validate/export/update` sub-commands
- `/qa:fix` — read report → auto-patch source
- `/qa:review <ELS-NN>` — open Jira ticket, fetch Figma node, vision-diff vs current rendering
- `/qa:screenshot <page>` — bulk-capture rendered screenshots via chrome-devtools MCP
- `/qa:report` — markdown / HTML / Slack export of a session

### Plugin internals
- `qa-fix-issues` skill
- `qa-figma-diff` skill
- `qa-inject-attributes` skill (auto-add `data-i18n-key` to Astro components)
- Bigger story: section-name → Figma layer name registry (currently project-specific KEYWORDS hardcoded in test backfill)

### Test surface
- No automated test runner. Smoke tests done via Node scripts in `.tmp/` (deleted after each run).
- No CI for either extension or plugin.

### Distribution
- Extension not published to Chrome Web Store (load-unpacked only).
- Plugin not registered with any Claude Code marketplace.

---

## 🗺️ Architectural map

```
qa-annotator-extension/
├── manifest.json                ← Chrome MV3 manifest (root because that's where Chrome looks)
├── src/                         ← Extension JS
│   ├── content/                 ← In-page bootstrap, overlay, CSS
│   ├── core/                    ← inspector, form-modal, issue-builder, screenshot
│   ├── adapters/                ← framework adapters (astro, generic)
│   ├── profile/                 ← profile-manager (ESM in service-worker), profile-validator (IIFE in settings page)
│   ├── popup/                   ← toolbar popup
│   ├── settings/                ← options page (import + theme + figma tree)
│   ├── background/              ← MV3 service worker (storage owner, screenshot capture, broadcast)
│   └── lib/                     ← messages, glob-match, locale-detector, viewport-detector, figma-matcher, exporter, zip-store
│
├── plugins/qa-tooling/                      ← Claude Code plugin "qa-tooling"
│   ├── plugin.json              ← manifest registering 4 commands + 4 skills
│   ├── commands/                ← /qa:init, /qa:doctor, /qa:sync, /qa:figma-sync
│   ├── skills/                  ← qa-detect-stack, qa-generate-profile, qa-sync-jira, qa-figma-crawl
│   ├── templates/               ← qa-profile, qa-figma-tree, qa-readme
│   └── README.md
│
├── assets/                      ← extension icons (16/32/48/128)
├── docs/
│   ├── INSTALL.md               ← user-facing extension install
│   └── archive/                 ← original PLAN.md, PLUGIN_PLAN.md, SUMMARY.md, FLOWCHARTS.md
├── README.md                    ← entry point — install + links
├── STATUS.md                    ← this file (what's done / not done / known issues)
└── CLAUDE.md                    ← codebase guide for Claude Code in future sessions
```

## 🔄 Workflows

### Daily QA (extension)
```
QA opens site → toolbar icon → Start Inspector → click element
   → modal opens with auto-captured screenshot + auto-filled Figma link
   → fill Title / Severity / Type / Expected → Save
QA repeats…
   → popup → Export ZIP → ZIP saved to Downloads folder
QA hands ZIP off to dev (or runs /qa:sync themselves).
```

### Setup (one-time, plugin)
```
Dev opens Claude Code session at the target project
   /qa:init                      → docs/qa/qa-profile.json + README
   /qa:figma-sync                → docs/qa/qa-figma-tree.json (full crawl)
   /qa:doctor                    → ✓ checks
QA imports both files into the extension via Settings.
```

### Sync to Jira (plugin)
```
QA exports ZIP → unzips into project's docs/qa/reports/<date>/
Dev opens Claude Code:
   /qa:sync                      → Jira sub-tasks created under default parent
                                   → report.json mutated with synced{jiraKey, jiraUrl}
```

---

## 🎯 Pick the next thing

If picking up Phase 2, suggested order:
1. `/qa:fix` — biggest dev productivity win
2. `/qa:profile` sub-commands — small, high frequency
3. `/qa:report` — easy output formats people ask for
4. Side Panel UI for the extension — better DX
5. Extension Web Store publish + automated CI
