# Install — QA Annotator Extension

## Prerequisites

- Chrome 114+ or any Chromium browser (Edge, Brave, etc.).
- Optional but recommended: the [`qa-tooling` Claude Code plugin](../plugins/qa-tooling/README.md) to generate a project profile.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the repo root: `D:\Github\qa-annotator-extension`.
5. The extension appears as **QA Annotator**. Pin it to the toolbar.

> **Icons.** The extension ships with a Q&A speech-bubble icon at `assets/extension_icon{16,32,48,128}.png`, registered both as the toolbar (`action.default_icon`) and the extension-management icon (`icons`). To swap the artwork, replace those four PNGs and reload — no manifest change needed.

## First-time setup

The extension ships with an **empty** built-in profile that works on any site (no source mapping, no Jira hints). To get the full value, import a project-specific profile.

### Option A — Generate a profile via the plugin (recommended)

In a Claude Code session at the target project:

```
/qa:init           # produces docs/qa/qa-profile.json
/qa:figma-sync     # OPTIONAL: produces docs/qa/qa-figma-tree.json for auto-fill
```

Then in the extension popup → **Settings**:

1. **Import profile** → pick `docs/qa/qa-profile.json` → tick "Set as active".
2. **(Optional) Import Figma tree** in the "Figma frame tree" card → choose the same profile from the dropdown → upload `docs/qa/qa-figma-tree.json`. The tree must reference the same `fileKey` as the profile — the import warns otherwise.

With the tree imported, every issue you create gets a `Figma link` field auto-filled with the **nearest enclosing Figma frame** for the picked element. The chip ⚡ *auto-matched* and the breadcrumb (e.g. `home > Section3 > Frame 45`) tell you which layer was matched. Edit or clear the link freely.

### Option B — Hand-write a profile

Copy [`plugins/qa-tooling/templates/qa-profile.template.json`](../plugins/qa-tooling/templates/qa-profile.template.json), fill in your values, and import via Settings.

## Use it

1. Open the target site in Chrome.
2. Click the **QA Annotator** toolbar icon. Pick the active profile from the dropdown.
3. Click **Start Inspector**. The page tints with a crosshair cursor and a floating bar appears bottom-right.
4. Hover any element — a pink outline highlights it.
   - **Click** → opens the issue form for that element.
   - **Shift+Click** → adds the element to a selection set; keep shift+clicking to add more. The bar shows `+N` and a **Done** button. Click **Done** (or press Enter) when finished — opens ONE issue with all picked elements.
5. **A cropped screenshot is auto-captured** before the modal opens — a tight crop around the picked element(s) with a red border on each. You'll see it as the first thumbnail in the **Screenshots** strip.
6. Fill **Title**, **Severity**, **Type**. Default Expected rows include `font-size` and `font-weight`; the property field is a searchable combo of common CSS properties. Click **+ Add property** for more rows.
7. **Add more images** to the issue:
   - **Recapture** — re-grab the page (modal hides momentarily).
   - **Paste image** — paste from clipboard. You can also Ctrl/Cmd+V anywhere in the modal.
   - **Upload…** — pick one or more image files.
   - Drag thumbnails to reorder, click thumbnail to preview full-size, × to delete.
8. Click **Save issue**.
9. When done with the session, open the popup and click **Export ZIP** (or JSON / Markdown).

Press **Esc** to stop the inspector at any time.

## Where things live

| What | Where | Notes |
|---|---|---|
| Saved issues | `chrome.storage.local` under key `issues` | Survives browser restarts. Quota ≈ 5–10 MB total per extension. Each screenshot data URL costs ~50–500 KB depending on viewport size. |
| Profiles | `chrome.storage.local` under `profiles` + `activeProfileId` | Imported via Settings page. |
| Figma trees | `chrome.storage.local` under `figmaTree:<profileId>` | One per profile, auto-deleted when the profile is removed. Compressed: ~40% smaller than the raw JSON the plugin emits. Typical size 0.5–2 MB. |
| Screenshots (in-memory) | Inside each issue as `screenshots[].dataUrl` (base64 PNG) | When you Export ZIP they're written to `screenshots/` inside the zip with filenames like `ISS-001-auto-12345.png`. |
| Exported files | Your **Downloads** folder | Filename pattern: `qa-report-<profileId>-<YYYY-MM-DD>.{json,md,zip}`. |
| Extension source | The folder you loaded unpacked from | Editing source + clicking **Reload** in `chrome://extensions` picks up changes. |

### Inspecting stored data

DevTools on any page where the extension runs → **Application → Storage → Extension storage → Local** shows the full `issues`, `profiles`, `activeProfileId` keys.

### Clearing

- One issue: open it, click ×. (Phase 2 — not in MVP yet, use Clear all for now.)
- All issues: **Clear all issues** button in the popup.
- Profile: Settings page → Delete on the row.
- Everything: `chrome://extensions` → Remove the extension and re-load unpacked.

### Hitting the storage quota

Around 30–60 issues with screenshots is typical. If saves start failing silently:

1. Export ZIP to preserve the work.
2. Click **Clear all issues**.
3. Re-import the ZIP later if needed (Phase 2 — for now keep the JSON externally).

## Troubleshooting

- **"Content script not loaded"** — extension can't run on `chrome://`, the Web Store, or PDF viewer pages. Use a normal website.
- **No source `file:line`** — the active profile must declare `framework.type: "astro"` AND the Astro project must build with `vite.build.sourcemap` enabled. Otherwise the generic adapter is used and source mapping is skipped.
- **Screenshot button does nothing** — check `chrome://extensions` → Errors. Most often the page has CSP that blocks `chrome.tabs.captureVisibleTab`. Disable extensions known to interfere or test on a different site.

## Uninstall / reinstall

After editing the source, hit the **Reload** button on the extension's card in `chrome://extensions`. Hard reset: **Remove**, then **Load unpacked** again.
