---
name: qa-figma-crawl
description: Crawl a Figma file via the Figma MCP and produce a qa-figma-tree-v1 cache so the QA Annotator extension can resolve nearest Figma frames for picked DOM elements.
---

# Skill — qa-figma-crawl

Walk the Figma file referenced by a profile and emit a flat node lookup + per-viewport section list. The output is consumed by the extension's `figma-matcher` (Phase B) to auto-fill `expected.figmaLink` for picked elements.

## Inputs

```jsonc
{
  "profile": <parsed qa-profile-v1 object>,
  "options": {
    "viewports": ["desktop","laptop","tablet","mobile"],  // optional filter; default = all
    "maxDepth": 8,                                          // skip nodes deeper than this
    "includeText": true,                                    // collect TEXT node strings
    "minFrameSize": 8,                                      // skip frames smaller than 8x8 px
    "scanSrc": true                                         // ALSO scan src code for sectionIndex (default true)
  }
}
```

## Required MCP

`figma` (a.k.a. `mcp__figma__*` or `mcp__claude_ai_Figma__*`). Without it, return `{ error: "mcp-unavailable" }`.

Tool used: **`get_metadata`** (returns the node hierarchy). Avoid `get_design_context` here — too verbose and costs more tokens.

## Output

A `qa-figma-tree-v1` object. See `plugins/qa-tooling/templates/qa-figma-tree.template.json` for the canonical shape.

## Steps

### 1. Resolve the page list

For each entry in `profile.pages`:
- If the entry has `figma.viewportVariants`, queue a (pageName, viewport, nodeId) tuple per variant.
- Else if it has `figma.nodeId`, queue a single (pageName, "desktop", nodeId) tuple.
- If `profile.pages` is missing or empty, fall back to one tuple `(profile.id, "desktop", "0:1")` — **but warn** that without explicit pages the matcher will only see the file root.

Filter the queue by `options.viewports` if provided.

### 2. Crawl per page-viewport

For each tuple, call `mcp__figma__get_metadata({ fileKey: profile.figma.fileKey, nodeId, depth: options.maxDepth })`.

The MCP returns the node and its descendants. Walk the result depth-first:

- Skip nodes with type not in `["FRAME","SECTION","COMPONENT","INSTANCE","GROUP","TEXT"]` (we don't need vectors, ellipses, etc., for matching).
- Skip frames whose width or height is below `options.minFrameSize`.
- Skip nodes deeper than `options.maxDepth` from the entry root.
- For each kept node, write into `nodes[id]`:
  ```jsonc
  {
    "id": "<id>",
    "name": "<n.name>",                                 // Figma layer name (often "Frame 1000003792" — meaningless on its own)
    "type": "<n.type>",
    "parentId": "<id of nearest kept ancestor>",
    "depth": <depth from page root>,
    "bbox": { "x": <absolute X relative to page root>, "y": ..., "w": ..., "h": ... },
    "viewport": "<the tuple's viewport>",
    "pageName": "<the tuple's pageName>",
    "text": (n.type === "TEXT" && options.includeText) ? truncate(n.characters, 240) : undefined,
    "summary": (n.type !== "TEXT") ? "<concat of descendant TEXT strings>" : undefined,
    "breadcrumb": "<built by joining ancestor names with ' > '>"
  }
  ```

- **summary** (compressed key `s` in stored tree) — for FRAME / INSTANCE / GROUP nodes only:
  - Walk descendants depth-first.
  - Collect each descendant's `text` value when present.
  - Join with `" | "`, truncate to **200 chars**.
  - This makes a Frame node self-describing in the matcher's breadcrumb without the consumer having to walk descendants again.
  - Example: `Frame 1000003831 → "Built for Asia's Hotels, Designed for the World | The Supply Architecture for Global Hotels | 70,000+ | Direct Contracts | 800,000+ | Global Inventory"`.
  - Skip when no descendant has text (results in `summary` being absent — matcher must tolerate undefined).
- For each top-level child of the page root (depth 1) whose `bbox.h >= 200` (heuristic: real sections are tall), record its id under `pages[].viewports[].sections`.

### 3. Compute breadcrumb

Walk parent chain when writing each node — keep cumulative breadcrumb. Cap at 6 levels to prevent giant strings.

### 4. Stats

After the crawl, fill `stats`:
```js
{
  pageCount:       pages.length,
  viewportCount:   pages.reduce((s, p) => s + p.viewports.length, 0),
  nodeCount:       Object.keys(nodes).length,
  frameCount:      <count where type === "FRAME">,
  textCount:       <count where type === "TEXT">,
  skippedTooDeep:  <incremented during walk>
}
```

### 4.5. Build sectionIndex from source code (when `options.scanSrc !== false`)

Scan the project's section components and emit `tree.sectionIndex` — a per-section hint table the matcher uses to disambiguate Figma frames at runtime. **No MCP calls** in this step; it's pure file IO so it's cheap.

For each entry in `profile.sections`:

1. **Read the file** at `<workspaceRoot>/<section.file>`. If missing, skip with a warning.
2. **Extract `// figma:` annotations** anywhere in the file. Two accepted forms:
   ```
   // figma: 3880:2963
   {/* figma: 3880-2963 */}
   <!-- figma: 3880:2963 -->
   ```
   Regex (case-insensitive): `figma:\s*([0-9]+[:-][0-9]+)`. Normalize hyphen → colon. Take the FIRST occurrence — that's the section root. If there are more, store them under `figmaInnerNodeIds[]` for use by deep-frame matching.
3. **Extract static text strings** from the file. Targets:
   - JSX/Astro children of `<h1>`, `<h2>`, `<h3>`, `<h4>`, `<p>`, `<span>` when the content is a string literal (not `{variable}` or `{t('key')}`).
   - Top-of-file `const COPY = { ... }` blocks (best-effort — collect all string-literal values).
   - Astro frontmatter `const heading = "...";` declarations.
   Skip any text shorter than 3 chars or longer than 200 chars. Cap per-section at 30 strings.
4. **Detect Figma URL imports** like `// figma-url: https://www.figma.com/design/.../n?node-id=3880-2963` and treat them the same as `// figma:` annotations.
5. **Detect data-figma-node-id attribute** in templates: `data-figma-node-id="3880-2963"` on top-level section element. Same priority as `// figma:` comment.
6. **Cross-reference texts against Figma to auto-resolve `figmaNodeId`** (when steps 2/4/5 didn't find one):
   - Take all the strings collected in step 3.
   - For each top-level section node listed in `pages[].viewports[].sections`, count how many of those strings match (case-insensitive substring) any TEXT descendant of that section.
   - If one section node has at least **2 matches** AND beats the runner-up by ≥ 2 → set `sectionIndex[name].figmaNodeId` to that node id, set `source: "cross-ref"`.
   - Tie or insufficient matches → leave `figmaNodeId: null`. Better to skip than guess wrong.
   - Apply the same logic to i18n keys: if `texts` contains `t('hero.headline')`, look up the resolved string from `src/i18n/<defaultLocale>.json`, then run the same matcher.

Output shape:

```jsonc
"sectionIndex": {
  "WhyOhmyhotelCoSection": {
    "file": "src/components/sections/WhyOhmyhotelCoSection.astro",
    "figmaNodeId": "3880:2963",            // optional — present when annotation found
    "figmaInnerNodeIds": ["3880:2966"],    // optional — additional figma: comments inside
    "texts": [
      "Why Ohmyhotel&Co",
      "Is hotel distribution in Asia still fragmented?",
      "There are many channels, and management is complex.",
      "..."
    ],
    "source": "data-attr|comment|both|texts-only"
  }
}
```

Sections without ANY signal (no comment, no static text) are still recorded with empty `texts: []` and `source: "none"` — so the runtime knows the section was scanned and didn't yield hints (vs. not-scanned-at-all).

### 5. Validation

Reject the result if:
- `pages.length === 0`
- `nodeCount === 0`
- Any `nodes[id].parentId` references an id that is not in the `nodes` map (orphan check).

## Behavior notes

- **Coordinate system** (verified against `mcp__figma__get_metadata` 2026-05-07):
  - The MCP returns `<frame x="..." y="...">` for **every** frame.
  - The **page root** carries absolute file coords (e.g. `x="20977" y="17376"`).
  - **Every descendant** carries coords RELATIVE TO ITS PARENT (not absolute), e.g. a header at depth 1 reports `x="0" y="0"`, a `Frame 47` inside it reports `x="390" y="0"`.
  - To produce the bbox shape we want (everything relative to the page root, root at `(0,0)`):
    1. Set the page root's bbox to `{ x: 0, y: 0, w: rootW, h: rootH }`.
    2. Walk depth-first carrying a parallel stack of cumulative `(x, y)` offsets.
    3. For each descendant, its bbox is `{ x: parentAbs.x + localX, y: parentAbs.y + localY, w, h }`.
  - **Do NOT subtract the root's absolute file coords from every descendant** — descendants are already parent-relative, so subtracting would over-correct. (This was a bug in an earlier draft of this spec; verified end-to-end with the about-us project on 2026-05-07.)
- **Multiple roots per page**: most projects have only one Figma frame per (page, viewport). If the MCP returns several siblings, write them all and pick the largest as `rootNodeId`.
- **Rate limiting**: Figma's `get_metadata` can be slow on large files. Crawl one viewport at a time, log progress.
- **Text deduplication**: skip TEXT nodes with `text === ""` or `text.length > 500` (probably long body copy that bloats the tree).

## Edge cases

- **Page nodeId not in file**: MCP returns 404. Record under `errors.missing` and continue with the next tuple.
- **Profile has `figma.fileKey === null`**: return `{ error: "no-file-key" }` immediately.
- **Crawl produces 0 nodes**: probably a bad page nodeId (e.g., a comment or vector). Return with stats but a `warnings: ["page <name> produced 0 nodes"]` array.
- **Viewport variants have different page widths**: the matcher uses normalized bbox; sizes differ per viewport, but the extension already knows its own `context.viewport.w` so it applies a scale factor when comparing.
