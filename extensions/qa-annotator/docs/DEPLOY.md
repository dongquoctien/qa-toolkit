# Deploy

How to ship the extension and the plugin to teammates / production.

> Status: both pieces are Phase 1 / internal. Plugin marketplace install is live. Extension distributed via GitHub Releases (load unpacked); Chrome Web Store not yet.

## Quickstart

| What you want to do | How |
|---|---|
| Share the extension with QA team | `git tag v0.X.0 && git push origin v0.X.0` → CI builds + uploads to release. Share `https://github.com/dongquoctien/qa-toolkit/releases/latest` |
| Share the plugin with devs | They run `/plugin marketplace add dongquoctien/qa-toolkit` then `/plugin install qa-tooling@qa-annotator` |
| Build extension ZIP locally | `node scripts/package-extension.mjs` → `dist/qa-annotator-extension-v<ver>.zip` |
| Bump version | Edit `manifest.json#version` AND `plugins/qa-tooling/plugin.json#version` AND `.claude-plugin/marketplace.json#metadata.version` AND `#plugins[0].version`, commit, then tag |

---

## 1. Chrome extension — internal team (load unpacked)

**Audience:** QA + dev on your team. Easiest path, no review cycles.

### One-time per teammate
1. Clone or download this repo.
2. Open `chrome://extensions` in their browser.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the repo root (the folder containing `manifest.json`).
6. Pin the **QA Annotator** icon to the toolbar (puzzle-piece menu → pin).

### When extension code changes
1. `git pull` (or share a fresh ZIP).
2. `chrome://extensions` → click the **Reload** icon on the extension card.
3. Refresh any open page where the inspector is active.

### Distribution via GitHub Releases (recommended)

The fastest way to ship to a team:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A GitHub Actions workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) catches the tag, packages the extension, and uploads the ZIP as a release asset. Team members download from:

```
https://github.com/dongquoctien/qa-toolkit/releases/latest
```

The workflow:
1. Reads `manifest.json#version` and verifies it matches the tag (fails the build otherwise — keeps versions in sync).
2. Runs `node scripts/package-extension.mjs` to produce `dist/qa-annotator-extension-v<version>.zip`.
3. Creates the release if it doesn't exist (`--generate-notes` writes a changelog from commits since last tag), or uploads the ZIP to an existing release with `--clobber`.

You can also run the workflow manually via `Actions → Release extension → Run workflow` — that path uploads the ZIP as a 7-day artifact instead of a permanent release asset (useful for previewing).

### Local packaging (for testing before release)

```bash
node scripts/package-extension.mjs              # version pulled from manifest.json
node scripts/package-extension.mjs 0.2.0        # override version
# or via the bash wrapper:
./scripts/package-extension.sh
```

Output: `dist/qa-annotator-extension-v<version>.zip` containing `manifest.json`, `src/`, `assets/`, `README.md`. The `plugins/`, `docs/`, `scripts/`, and root markdown files are excluded. Recipient unzips → load unpacked from the unzipped folder.

> The packager is pure Node — no `zip` CLI required, works on Windows / macOS / Linux. It uses the same store-mode ZIP writer as the runtime ZIP export (`src/lib/zip-store.js`).

---

## 2. Chrome extension — Web Store (future)

Not yet shipped. When ready:

1. Run `./scripts/package-extension.sh` — produces `dist/qa-annotator-extension-v<version>.zip` containing only runtime files (`manifest.json`, `src/`, `assets/`, `README.md`). Excludes `plugins/`, `docs/`, planning docs.
2. Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. New item → upload the ZIP.
4. Fill in store listing (name, description, screenshots, icon — already at `assets/extension_icon128.png`).
5. Privacy practices: declare what `<all_urls>`, `clipboardRead`, `tabs`, `storage`, `downloads` are used for.
6. Submit for review (typical 1–3 days).
7. After approval, share the `chrome.google.com/webstore/detail/...` link.

**Pre-publish checklist:**
- [ ] Bump `manifest.json#version` (semver).
- [ ] Update `STATUS.md` "Last updated" line.
- [ ] Verify `manifest.json#description` reads well in the store listing.
- [ ] Take fresh screenshots showing inspector + modal + Figma auto-fill.
- [ ] Privacy policy URL (Web Store requires one for `<all_urls>` extensions).

---

## 3. Claude Code plugin — marketplace install (recommended)

**Audience:** any dev who wants `/qa:*` commands.

### One-time per machine
The repo declares a Claude Code marketplace via `.claude-plugin/marketplace.json`. In any Claude Code session, regardless of project:

```
/plugin marketplace add dongquoctien/qa-toolkit
/plugin install qa-tooling@qa-annotator
```

This pulls the plugin and registers it. Open a project and run `/qa:init`.

### Updating
```
/plugin marketplace update qa-annotator
```

This re-fetches from the GitHub default branch. Plugin loads on the next Claude Code session.

### Manual install (no marketplace)
If marketplace isn't available, point Claude Code at the plugin directory directly. Add to the project's `.claude/settings.json`:

```jsonc
{
  "plugins": [
    "<absolute-path-to>/qa-annotator-extension/plugins/qa-tooling"
  ]
}
```

Or copy `plugins/qa-tooling/` into the project at `.claude/plugins/qa-tooling/` (also auto-discovered).

### Recommended MCP servers (per session)
- `mcp-atlassian` — for `/qa:sync`
- `figma` — for `/qa:figma-sync`
- `chrome-devtools` — Phase 2 (`/qa:screenshot`)

`/qa:doctor` warns when these aren't connected.

### Updating
When `plugins/qa-tooling/` changes in this repo, marketplace users run `/plugin marketplace update qa-annotator`. Manual-install users `git pull` from the consuming project. Either way the plugin is read on next Claude Code session start, no reload required.

---

## 4. Claude Code plugin — multiple teams

The marketplace install (§3) already handles this — every Claude Code user runs the same `/plugin marketplace add` command and gets the latest version.

If a team prefers pinning to a fork or a tag:

### Pin to a tag
```
/plugin marketplace add dongquoctien/qa-toolkit@v0.1.0
```

### Use an internal fork
```
/plugin marketplace add <your-org>/qa-annotator-fork
```

### Git submodule (advanced)
Each project adds this repo as a submodule at `tools/qa-annotator-extension/`, then references `tools/qa-annotator-extension/plugins/qa-tooling` in `.claude/settings.json`.

```bash
git submodule add git@github.com:dongquoctien/qa-toolkit tools/qa-annotator-extension
```

---

## 5. About-us project sample artifacts

For testing / reference:

```
D:\Code\worktree\homepage\about-us\docs\qa\
├── qa-profile.json          ← generated by /qa:init
├── qa-figma-tree.json       ← generated by /qa:figma-sync (currently partial: home page only)
├── README.md                ← generated by /qa:init
└── reports/                 ← QA exports go here (.gitkeep present)
```

Use those as live examples when testing the extension.

---

## 6. Versioning

Single version source: `manifest.json#version`. Plugin manifest mirrors it.

| Component | Version reference | When to bump |
|---|---|---|
| Extension | `manifest.json#version` | Any user-visible change in extension |
| Plugin | `plugins/qa-tooling/plugin.json#version` AND `.claude-plugin/marketplace.json#plugins[0].version` | Any change in commands/skills/templates |
| Marketplace | `.claude-plugin/marketplace.json#metadata.version` | Aggregate marketplace version (bump when any plugin bumps) |
| qa-profile schema | `qa-profile-v1` (in field `$schema`) | Breaking schema change → `v2` |
| qa-figma-tree schema | `qa-figma-tree-v1` | Breaking schema change → `v2` |
| Report schema | `qa-report-v1` | Breaking schema change → `v2` |

Schema bumps require updating BOTH the producer (plugin) AND consumer (extension validators + matcher).

---

## 7. Rollback

### Extension
- `chrome://extensions` → Remove → re-load an older folder.
- For Web Store: dashboard → Item → "Restore" a previous version.
- User data (`chrome.storage.local`) survives unless they uninstall the extension.

### Plugin
- `git checkout <previous-tag>` in the plugin source folder.
- Plugin is read on Claude Code session start, so a new session picks up the rollback.

### About-us project sample artifacts
- `qa-profile.json` and `qa-figma-tree.json` are generated and overwriting them is safe (`/qa:init --force`, `/qa:figma-sync --force`).

---

## 8. Pre-flight checklist before any deploy

Run through this before sharing a build:

- [ ] `chrome://extensions` shows zero errors after reload
- [ ] Inspector starts and stops cleanly (Esc works)
- [ ] Single-click and shift-click both produce correct breadcrumbs in the modal
- [ ] Screenshot is cropped + bordered, not the dimmed modal
- [ ] Export ZIP contains JSON + MD + screenshots/ folder with all images
- [ ] Settings page loads and lists imported profiles + trees
- [ ] Theme color change propagates to inspector (live tab) without reload
- [ ] Plugin: `/qa:doctor` shows no `✗ fail` items in a real project
- [ ] Plugin: `/qa:figma-sync --pages <page>` writes a valid `qa-figma-tree-v1` file
- [ ] STATUS.md "Last updated" date matches today
