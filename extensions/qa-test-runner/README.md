# QA Test Runner — Chrome Extension

> **Status: v0.1.0 — Issue re-check shipped.** Recorder + replay still scaffolded
> placeholders; see [Milestones](#milestones). Read this file before opening a
> PR for any feature — the design decisions below hold up across the next 3-4
> milestones.

Companion extension to [qa-annotator](../qa-annotator/README.md). Where qa-annotator
is for **logging** issues (one-off, manual), qa-test-runner is for **regression** —
record a flow once on dev, replay it on stg/prod, and re-check every issue
qa-annotator already caught to confirm fixes shipped without regressions.

> Part of the [`qa-toolkit` monorepo](../../README.md). Shares the
> `qa-profile.json` / `qa-figma-tree.json` contracts but runs independently —
> you can install qa-test-runner without qa-annotator, you just lose the
> "re-check existing issues" feature.

---

## Why this extension exists

QA today on this team:

```
DEV         → manually click through flows, log issues via qa-annotator
              ↓
STG         → repeat the same clicks manually (1-2 hrs/release)
              ↓
PROD smoke  → cherry-pick critical paths, hope nothing slips
```

QA tomorrow with qa-test-runner:

```
DEV         → record flow ONCE → save to <project>/docs/qa/test-suites/*.json
              → log issues via qa-annotator → save to docs/qa/reports/<date>/
              ↓
STG         → "Run regression suite" → all flows replay automatically
              + every issue selector re-checked → diff vs dev baseline
              ↓
PROD smoke  → run the same suite → screenshot the deltas → ship
```

Goal: **recover 1-2 hours per release**, catch DOM drift before users do, and
make "did we fix the bug?" a one-click answer.

---

## What's in scope

The extension does five things, in priority order:

### 1. Re-check qa-annotator issues *(v0.1.0 — first feature)*

Read a `qa-report-v1` JSON (exported by qa-annotator) → for each issue,
re-locate the picked element on the current page → compare against the issue's
recorded `expected` block → emit pass / fail / drift.

**Why first**: smallest scope, highest ROI. No recorder needed. Just reuses
qa-annotator's selector + computed-style data and runs `getComputedStyle()`
again. Solves "did we fix issue ELS-1379 on stg?" in one click.

### 2. Recorder *(v0.1.0)*

Click toolbar → record button → user performs a flow → click stop → flow
saved as a `TestSequence` JSON. Each step carries:

- **Action**: `click | type | wait | navigate | scroll | hover`
- **Selector fingerprint** (hybrid — see [Selector strategy](#selector-strategy))
- **Wait hints**: `domcontentloaded`, `networkidle`, `manual N ms`
- **Optional assertions**: appended after a step via the floating bar

### 3. Player *(v0.2.0)*

Replay a saved sequence on the current page. Per step: resolve selector,
wait for element, execute action, run assertion, capture screenshot, emit
event for the side-panel UI to render live.

### 4. Cross-environment diff *(v0.2.0)*

Recording on `dev.foo.com` should replay on `stg.foo.com` without manual
URL editing. Suite files store **environment-relative URLs**:

```json
{
  "baseUrl": "{{env}}",
  "envs": {
    "dev": "https://dev-adm.example.com",
    "stg": "https://stg-adm.example.com",
    "prod": "https://adm.example.com"
  },
  "steps": [
    { "type": "navigate", "path": "/hotel/reservation-list-ota" },
    ...
  ]
}
```

Replay UI lets the user pick which env to run against. Storage of `envs`
mapping comes from `qa-profile.json#urlPatterns` so projects stay in sync.

### 5. Report + diff UI *(v0.3.0)*

After a suite run: side panel renders pass/fail per step, screenshot
comparison (recorded vs replayed), and DOM-drift summary (which steps
fell back from primary selector to a lower-priority one — early signal of
"front-end refactor will break this suite").

---

## What's NOT in scope

- **Cross-browser**: Chrome/Edge only. No Firefox port.
- **Performance benchmarking**: see qa-visual-regression in roadmap (#4).
- **API testing without UI**: not the goal — use Postman/Insomnia.
- **Replacing Playwright/Cypress**: this is for QA who don't write code.
  Output is JSON, not a `.spec.ts` file. Devs who want code-first should
  keep using their existing framework.
- **CI runner**: extensions can't run in CI. The recorded JSON is
  *technically* compatible with a Playwright bridge (future), but actual
  CI execution is out of scope for v1.

---

## Architecture

```
extensions/qa-test-runner/
├── manifest.json                  ← MV3, content_scripts on <all_urls>
├── src/
│   ├── background/
│   │   └── service-worker.js      ← storage owner, suite CRUD, capture-visible-tab
│   ├── content/
│   │   ├── content.js             ← bootstrap, message routing, lifecycle
│   │   ├── content.css            ← floating bar, replay banner, assertion highlight
│   │   ├── recorder.js            ← capture click/type/scroll/navigate, emit TestStep
│   │   └── player.js              ← replay TestSequence, run assertions, capture deltas
│   ├── lib/
│   │   ├── messages.js            ← MSG constants (qa-tr/* namespace)
│   │   └── selector-strategy.js   ← hybrid resolver: testid → role → text → css
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js               ← Record / Run suite / Re-check issues entry points
│   └── (sidebar/)                 ← v0.3.0 chrome.sidePanel report UI
├── docs/
│   ├── INSTALL.md
│   ├── ARCHITECTURE.md            ← deeper dive on selector strategy + storage
│   └── PROTOCOL.md                ← TestSequence JSON schema (qa-test-suite-v1)
├── assets/                        ← icon PNGs (16/32/48/128) — TODO
└── scripts/
    └── package-extension.mjs      ← reuse pattern from qa-annotator
```

### Selector strategy

Recording captures **all** fingerprints up-front so replay has options:

```js
{
  selector: '.reservation-row:nth-of-type(2) .btn-confirm',    // qa-annotator-style
  testid:   'confirm-reservation-btn',                          // data-testid / data-qa
  role:     'button',                                           // ARIA role
  name:     'Confirm reservation',                              // accessible name
  text:     'Confirm',                                          // visible text
  cssRelaxed: '[role=button]:contains("Confirm")'              // last-resort
}
```

At replay time, `selectorStrategy.resolve()` walks the list:

| Order | Source | Why this order |
|---|---|---|
| 1 | `testid` | Stable across UI refactors. Best signal when present. |
| 2 | `selector` | qa-annotator's CSS path. Cheap, often unique. |
| 3 | `role` + `name` | Survives className changes. Standard a11y pattern. |
| 4 | `text` | Survives DOM restructure. Brittle to copy edits. |
| 5 | `cssRelaxed` | Last resort. Logs a warning. |

Returns `{ element, hitVia, drifted }`. `drifted: true` when primary failed
and a fallback matched — surfaces as a yellow chip in the report so the QA
knows the test is one DOM-tweak from breaking.

### Storage strategy

| Data | Where | Why |
|---|---|---|
| Test suites (JSON, < 100 KB each) | `chrome.storage.local["suite:<id>"]` | Small, sync-friendly. |
| Run results (with screenshots) | `IndexedDB qa-tr-runs` | Screenshots blow past the 5–10 MB local quota fast. |
| User settings | `chrome.storage.local["settings"]` | Same shape as qa-annotator for reuse. |
| Suite file checked into project repo | `<project>/docs/qa/test-suites/*.json` | qa-tooling plugin can list / sync these (future `/qa:test` command). |

Suite files in the project repo are the source of truth — extension storage
is a working copy. Import / export round-trips losslessly.

---

## Schema — `qa-test-suite-v1`

```jsonc
{
  "$schema": "qa-test-suite-v1",
  "id": "ota-reservation-confirm",
  "name": "OTA reservation — confirm flow",
  "createdAt": "2026-05-10T12:00:00Z",
  "createdBy": "qa@example.com",
  "envs": {
    "dev":  "https://dev-adm.example.com",
    "stg":  "https://stg-adm.example.com",
    "prod": "https://adm.example.com"
  },
  "preconditions": [
    "User is logged in as ops role",
    "At least one OTA reservation exists with status=pending"
  ],
  "steps": [
    {
      "type": "navigate",
      "path": "/hotel/reservation-list-ota",
      "waitFor": "networkidle",
      "at": 0
    },
    {
      "type": "click",
      "fingerprint": {
        "selector": ".reservation-row:nth-of-type(2) .btn-confirm",
        "testid": null,
        "role": "button",
        "name": "Confirm",
        "text": "Confirm"
      },
      "at": 1230
    },
    {
      "type": "type",
      "fingerprint": { "testid": "confirm-note-input", "selector": "textarea[name=note]" },
      "value": "Approved by ops",
      "at": 2450
    },
    {
      "type": "assert",
      "kind": "text",
      "fingerprint": { "selector": ".toast-success" },
      "expected": "Reservation confirmed",
      "at": 4100
    }
  ]
}
```

Run results follow `qa-test-run-v1` (deferred — defined when player ships):

```jsonc
{
  "$schema": "qa-test-run-v1",
  "suiteId": "ota-reservation-confirm",
  "env": "stg",
  "startedAt": "2026-05-10T13:30:00Z",
  "durationMs": 12340,
  "status": "fail",
  "summary": { "total": 4, "passed": 3, "failed": 1, "drifted": 1 },
  "steps": [
    { "idx": 0, "status": "pass", "durationMs": 800 },
    { "idx": 1, "status": "pass", "durationMs": 320, "drifted": true, "hitVia": "text" },
    { "idx": 2, "status": "pass", "durationMs": 410 },
    { "idx": 3, "status": "fail", "durationMs": 5000, "error": "Expected text 'Reservation confirmed', got 'Network error'" }
  ],
  "screenshots": ["sha256:abcd...", "sha256:efgh..."]
}
```

---

## Issue-recheck protocol

Read a qa-annotator `qa-report-v1.zip` (or `.json`) → for each issue:

1. Navigate to `issue.url` (or skip if a different host — log as "out of scope").
2. Resolve `issue.elements[]` selectors. If any miss, mark `STALE_SELECTOR`.
3. For matched elements, run `getComputedStyle()` and compare against
   `issue.expected.*` properties.
4. Emit per-issue verdict:
   - `FIXED` — expected values now match
   - `STILL_BROKEN` — same mismatch as recorded
   - `REGRESSED` — was fixed (no recorded mismatch) but is now broken
   - `STALE_SELECTOR` — element gone, can't verify
   - `OUT_OF_SCOPE` — issue URL doesn't match current host

Export the result as `qa-recheck-v1.json` for archival + `/qa:sync`-style
follow-up tickets.

---

## Milestones

| Version | Features | Estimate |
|---|---|---|
| **v0.0.1** *(scaffold)* | Folder structure, manifest, module placeholders, README | ✅ done |
| **v0.1.0** *(this release)* | Issue re-check: import qa-report-v1 ZIP/JSON → resolve selector on current tab → diff expected vs current computed styles → emit FIXED / STILL_BROKEN / STALE_SELECTOR / OUT_OF_SCOPE / NO_EXPECTED. Popup with file picker, expandable per-property table, JSON export of result. Recorder/player still placeholders. | ✅ done |
| **v0.2.0** | Recorder (click + type + navigate + assertions), basic player, suite list in popup, save sequence to chrome.storage / suite file | 2–3 sessions |
| **v0.2.0** | Player (replay + assertions), cross-env URL substitution, run-result storage in IndexedDB, basic report popup | 2–3 sessions |
| **v0.3.0** | Side-panel report UI with screenshot diff, suite import/export `<project>/docs/qa/test-suites/`, drift dashboard | 2 sessions |
| **v0.4.0** | Settings page (env mapping editor, default wait timeout, screenshot on/off), suite tags + filter | 1 session |
| **v0.5.0** | Companion plugin command `/qa:test list/run/report` so devs can trigger from Claude Code | 1 session |
| **v1.0.0** | Polish, real icons, Chrome Web Store submission readiness | — |

---

## Coordination with qa-annotator

| Area | Sharing strategy |
|---|---|
| `qa-profile.json` schema | Read-only consumer. Same schema, no changes. |
| Selector logic | qa-annotator's `unique-selector.js` is generic enough — copy into `shared/selector/` once a 3rd extension lands (per shared/README extraction policy). For now, qa-test-runner has its own `selector-strategy.js` because the hybrid logic is bigger than what qa-annotator does. |
| Issue recheck | Imports `qa-report-v1` JSON exported by qa-annotator. No runtime coupling. |
| Settings | Separate `settings` key. Same structural conventions (mode, capture, privacy) so users feel at home. |
| Theme color | Both extensions read `--qa-accent` from their own settings — defaults to the same pink. v0.1.0 may add a sync option. |

---

## Install

1. `chrome://extensions` → **Developer mode**
2. **Load unpacked** → `extensions/qa-test-runner/`
3. Pin **QA Test Runner** to the toolbar
4. Optional: install qa-annotator alongside for full toolkit

## Usage (v0.1.0)

1. In qa-annotator, after logging issues, click **Export ZIP** (or JSON) from
   the popup.
2. Open the target site (any environment — dev, stg, prod) and navigate to
   where the issue was originally logged. The extension matches by hostname
   and selector — different host returns `OUT_OF_SCOPE`.
3. Click the **QA Test Runner** toolbar icon → pick the report file → click
   **Re-check on this tab**.
4. Each issue gets a verdict chip. Expand a row to see per-property `expected`
   vs `current` values side-by-side.
5. Click **Export JSON** to save the result as `qa-recheck-v1.json` for
   archival or follow-up Jira sync.

### Verdicts at a glance

| Chip | Meaning |
|---|---|
| `FIXED` | Every expected CSS row now matches the live computed value. |
| `BROKEN` | At least one row mismatches. The recorded broken value is still present (or has drifted to a different wrong value). |
| `STALE` | None of the issue's selectors resolved on the page. The element was renamed/removed or the tab is on the wrong route. |
| `OUT-SCOPE` | Issue was logged on a different hostname. Open the right environment first. |
| `NO-EXP` | Issue has no expected CSS rows to verify (only Figma link or pin notes). Skipped. |

---

## License

MIT — see [`LICENSE`](../../LICENSE) at repo root.
