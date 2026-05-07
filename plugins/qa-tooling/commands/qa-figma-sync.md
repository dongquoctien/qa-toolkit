---
name: qa:figma-sync
description: Crawl the project's Figma file and produce docs/qa/qa-figma-tree.json so the QA Annotator extension can auto-fill nearest-frame Figma deeplinks for picked elements.
argument-hint: "[--force] [--viewports desktop,tablet,mobile]"
---

# /qa:figma-sync — Cache the Figma frame tree

Build a sidecar file (`docs/qa/qa-figma-tree.json`) the QA Annotator extension reads at profile-import time. The tree lets the extension match a clicked DOM element to the **nearest enclosing Figma frame** and prefill the issue's Figma link.

The crawl is one-time per Figma-file change. Re-run when the designer reorganizes frames.

## Inputs

Flags (all optional):
- `--force` — overwrite the existing tree without asking.
- `--viewports <csv>` — restrict the crawl to specific viewport variants (e.g. `desktop,mobile`). Default: every variant declared in `profile.pages`.
- `--pages <csv>` — restrict the crawl to specific page names (e.g. `home,<page-name>`). Default: every entry in `profile.pages`.
- `--max-depth <N>` — depth cap (default 8). Lower = smaller file + faster crawl.

**Default behaviour (no flags):** crawl every entry in `profile.pages` × every declared viewport variant. The output tree omits `partial` and `partialNote` fields entirely. If a previous run had left these fields behind (because it was narrowed via `--pages` or `--viewports`), the new full crawl **overwrites** them — the resulting file must NOT carry stale `partial: true`.

**Narrowed crawl (`--pages` or `--viewports` provided):** set `tree.partial = true` and write a `tree.partialNote` explaining what was skipped, so the next run can complete it. Also emit `tree.missingTuples = ["<page>/<viewport>", ...]` listing every (page, viewport) combination present in the profile but skipped this run.

## Required MCP

`figma`. If not connected → abort with `fix: connect the Figma MCP server, then re-run /qa:figma-sync`.

## Steps

### 1. Read the profile

Read `docs/qa/qa-profile.json`. Required fields for this command:
- `figma.fileKey` (mandatory)
- `pages[]` with `figma.nodeId` and/or `figma.viewportVariants` (at least one page recommended; falls back to file root if missing — warn the user)

### 2. Confirm overwrite

If `docs/qa/qa-figma-tree.json` already exists and `--force` is NOT passed, call `AskUserQuestion`:

```
header: "Overwrite"
question: "qa-figma-tree.json already exists (crawled <date>, <N> nodes). Re-crawl?"
options:
  - "Re-crawl (Recommended)" — full overwrite
  - "Cancel"
```

### 3. Run the crawl

Invoke the **`qa-figma-crawl`** skill with:
- `profile` = the loaded profile
- `options.viewports` = parsed `--viewports` (or `null` for all)
- `options.maxDepth` = parsed `--max-depth` (default 8)
- `options.includeText` = `true`
- `options.minFrameSize` = `8`

While running, print progress: `Crawling home/desktop … 312 nodes`. One line per (page, viewport).

### 4. Validate + write

After the skill returns:
- If it returned `{ error: ... }`, print the error and abort.
- Else, Write the result to `docs/qa/qa-figma-tree.json` with 2-space indent.
- Compute file size and report.

### 5. Print summary

```
Reading: docs/qa/qa-profile.json
Figma file: <fileKey> (<fileSlug>)

Crawling…
  <page-name> / desktop  → <N> nodes (rootNodeId <nodeId>)
  <page-name> / tablet   → <N> nodes
  <page-name> / mobile   → <N> nodes
  …

✓ Wrote docs/qa/qa-figma-tree.json (<size> · <N> nodes · <P> pages × <V> viewports)
✓ Crawled at <ISO timestamp>
ℹ Re-run /qa:figma-sync after the designer reorganizes the file.

Next steps:
  1. Re-import qa-profile.json + qa-figma-tree.json into the extension
     (Settings → Import Profile auto-detects the sidecar tree if it lives in
     the same folder as the profile JSON).
  2. Pick any element on the live site. The modal's "Figma link" field will
     be prefilled with the nearest matching frame, and a breadcrumb tooltip
     shows the ancestor chain (e.g. "<page-name> > <SectionLayerName> > Frame 45").
```

## Failure modes

- **No `figma.fileKey` in profile** — abort with `fix: re-run /qa:init and provide the Figma file key, OR add it manually to qa-profile.json`.
- **Empty `profile.pages`** — warn (not abort): `pages[] is empty — crawler will use the file root as a single fallback page. Match accuracy will suffer.`
- **MCP returns 404 for a page nodeId** — log the error and continue with the next page. Final summary shows the missing pages.
- **Crawl exceeds 5 minutes** — print a warning, suggest using `--viewports desktop` to narrow the scope.

## Idempotency

Same inputs → same output (modulo crawledAt timestamp). The tree is fully rebuilt on every run; there is no incremental sync.
