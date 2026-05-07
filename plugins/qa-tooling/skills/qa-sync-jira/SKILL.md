---
name: qa-sync-jira
description: Create or update Jira issues from a QA Annotator report via the mcp-atlassian server.
---

# Skill — qa-sync-jira

Push a `qa-report-v1` JSON into Jira. Used by `/qa:sync`.

## Inputs

```jsonc
{
  "report":  <parsed qa-report-v1 object>,
  "profile": <parsed qa-profile-v1 object>,
  "config": {
    "mode":          "subtasks" | "tasks" | "append-comment" | "append-description",
    "parent":        "<KEY-NN>" | null,
    "summaryFormat": "default" | "qa-id" | "title-only",   // default = [VP] title — selector
    "translate":     "en" | "off",                         // default "en" — translate title/note/expected prose
    "bodyFormat":    "list" | "table",                     // default "list" — bold-key list
    "audience":      "tech" | "leader" | "ba" | "qa" | "ai" | "all",   // default "tech" — see "Audience formats" below
    "dryRun":        false
  }
}
```

## MCP tool used

`mcp-atlassian` server. Common tool names (use whichever the runtime exposes):

- `mcp__mcp-atlassian__jira_get_issue`
- `mcp__mcp-atlassian__jira_create_issue`
- `mcp__mcp-atlassian__jira_add_comment`
- `mcp__mcp-atlassian__jira_update_issue` (used for `append-description` mode AND for attaching screenshots after create)
- `mcp__mcp-atlassian__jira_search`

> **Body format constraint.** All write tools (`jira_create_issue` / `jira_update_issue` / `jira_add_comment`) accept **Markdown only** — the MCP server runs a Markdown→Jira-wiki adapter on the body before sending it to the REST API. **Do NOT pass ADF JSON, raw wiki markup, or HTML** — they get re-escaped by the adapter (e.g. `!file!` becomes `\!file\!`, table headers turn into `||#||`, `*bold*` flips to `_italic_`, `|` inside a Markdown-table cell breaks columns). The templates below are designed to survive this adapter without distortion.

> **Determinism constraint (read this before composing any body).** This skill emits a **single fixed template** — fill in the placeholders, do not paraphrase. Never invent extra sections like "Observed", "Delta", or "Original title". Field labels are **English-only** (`Severity`, `Type`, `Page`, `Locale`, `Viewport`, `Breakpoint`, `Device`, `File:line`, `Selector(s)`, `Expected`, `Actual (computed)`, `Figma`, `Screenshots`).
>
> **Translation rules (depend on `config.translate`):**
>
> - `config.translate === "en"` (DEFAULT): translate user-authored prose fields — `issue.title`, `issue.note`, and any free-text inside `issue.expected` (e.g. a string description, NOT keyed values like `font-size`) — into natural English. If the source is already English, pass-through unchanged. **Never translate technical values**: selectors, computed CSS (px/rgb/url/font-family), Figma URLs/nodeIds/breadcrumbs, file paths, attribute names, ID strings (`ISS-001`).
> - `config.translate === "off"`: pass title/note/expected through verbatim regardless of language.
>
> **Body-format rules (depend on `config.bodyFormat`):**
>
> - `config.bodyFormat === "list"` (DEFAULT): bold-key list, one `**Key:** value` per line. Safe under all MCP adapter behaviors.
> - `config.bodyFormat === "table"` (opt-in): 2-column Markdown table for short metadata (Severity, Type, Page, Locale, Viewport, Breakpoint, Device, File:line). Selector / Expected / Actual / Figma / Screenshots always stay outside the table (fenced blocks / link / wiki macro). See "Table format" section below.
>
> The output of this skill must be byte-equivalent across machines for the same `(report, profile, config)` triple.

> **Caller responsibility:** the caller (`/qa:sync`) MUST have already obtained user confirmation via `AskUserQuestion` for **mode**, **parent**, AND **summary format** before invoking this skill. The skill performs MCP writes immediately and does not re-confirm. If `dryRun` is true, no MCP writes happen regardless.

If `mcp-atlassian` is not available, return `{ error: "mcp-unavailable" }` and stop. Do not fall back to direct HTTP.

## Output shape

Return after running:

```jsonc
{
  "created": [{ "issueId": "ISS-001", "jiraKey": "<KEY>-NNNN", "url": "...", "attached": ["ISS-001-auto-<hash>.png"] }],
  "skipped": [{ "issueId": "ISS-002", "reason": "already-synced" }],
  "failed":  [{ "issueId": "ISS-003", "error": "<message>" }],
  "attachFailed": [{ "issueId": "ISS-001", "jiraKey": "<KEY>-NNNN", "files": ["ISS-001-auto-<hash>.png"], "error": "<message>" }],
  "attachWarnings": { "ISS-004": ["ISS-004-fixed-12.png"] },   // files referenced by report but not on disk
  "appendCommentKey": "<key if mode=append-comment, else null>",
  "appendDescriptionKey": "<key if mode=append-description, else null>"
}
```

## Steps

### 1. Resolve parent (if needed)

If `mode` is `subtasks`, `append-comment`, or `append-description`, parent must be set. If absent, return `{ error: "no-parent" }`.

Call `jira_get_issue` on the parent. If 404, return `{ error: "parent-not-found", parent }`.

### 2. Per-issue loop (mode `subtasks` or `tasks`)

For each `issue` in `report.issues`:

- Skip if `issue.synced?.jiraKey` exists → push to `skipped` with reason `already-synced`.
- Resolve **selectors** for the issue:
  - `selectors = issue.elements?.map(e => e.selector) ?? [issue.element.selector]`
  - `primarySelector = selectors[0]`
- Resolve **screenshots**:
  - `shots = issue.screenshots ?? (issue.screenshot ? [issue.screenshot] : [])`
- Resolve **viewport label**:
  - Prefer `issue.context.viewportLabel` (e.g. `"1280×800 · lg · @2x"`)
  - Fall back to `${vp.w}×${vp.h}` from `issue.context.viewport`
  - Final fallback: `report.scope.viewport` (legacy reports)
- Resolve **screenshot file paths** (absolute, OS-native — needed for attach in Step 2b):
  - For each `shot` in `shots`, compute `absPath = <projectRoot>/docs/qa/reports/<report.scope.date>/screenshots/<shot.filename>`.
  - On Windows use backslashes; on POSIX use forward slashes. The MCP `attachments` parameter accepts a JSON array of strings.
  - If a file does not exist on disk (e.g., the report came in without exported screenshots), record the missing filenames in `attachWarnings[issueId]` and proceed without that path.
- Resolve **displayTitle** = translate(`issue.title || issue.note || issue.id`) per `config.translate`. When the source is already English, output equals input. The same `displayTitle` is reused in the description's `### {heading}` line — translate ONCE per issue so summary and heading stay aligned.
- Build the **summary** based on `config.summaryFormat`:
  - `default` (when no override) → `[{viewportLabel}] {displayTitle} — {primarySelector || issue.source.file}`
  - `qa-id` → `[QA] {issue.id} — {displayTitle || "(no title)"}`
  - `title-only` → `{displayTitle}`
  Truncate the final string to 120 chars (preserve UTF-8 boundary). Do NOT inject decorative prefixes like `[QA]` unless the format explicitly says so.
- Build the **description** as **Markdown** (see template below). Do NOT pass ADF.
- Build the fields:
  ```js
  // jira_create_issue arguments
  {
    project_key: profile.jira.projectKey,
    summary,
    issue_type: mode === "subtasks" ? "Subtask" : "Task",   // MCP uses "Subtask", not "Sub-task"
    description,                                             // Markdown string
    additional_fields: JSON.stringify({
      parent: mode === "subtasks" ? parent : undefined,      // string key, not { key }
      priority: { name: severityToPriority[issue.severity] || "Medium" },
      labels: dedupe([...(profile.jira.defaultLabels || []), "qa-annotator", `severity-${issue.severity}`])
    })
  }
  ```
- If `dryRun`, push to a planned-actions list (include `absPaths`) and continue.
- Else, call `jira_create_issue`. On success, record `{ issueId: issue.id, jiraKey: result.key, url: result.self || derived }`.
- On failure, record under `failed` and continue.

### 2b. Attach screenshots to the new issue

Run this immediately after a successful `jira_create_issue` for modes `subtasks` and `tasks`. Skip in `dryRun`.

- Filter `absPaths` to only files that exist on disk.
- If non-empty, call:
  ```js
  jira_update_issue({
    issue_key: result.key,
    fields: "{}",                                  // no field updates
    attachments: JSON.stringify(absPaths)          // JSON array of absolute paths
  })
  ```
- If the attach call fails (network, permissions, file too big), record `{ issueId, jiraKey, error }` under `attachFailed[]` but **leave the issue created** — the description already contains plain filenames as a fallback (see template). Do not delete the ticket.
- For modes `append-comment` / `append-description`, attach all distinct screenshot files to the **parent** in one combined call after the comment/description write succeeds. Deduplicate filenames across issues.

### 3. Append-comment mode

Build one **Markdown** body using the report-level header followed by per-issue sections. Call `jira_add_comment(issue_key=parent, body=markdown)`. Record the parent key in `appendCommentKey`.

After the comment write succeeds, attach all distinct screenshot files to the **parent** in one combined call:
```js
jira_update_issue({
  issue_key: parent,
  fields: "{}",
  attachments: JSON.stringify(distinctAbsPaths)
})
```
Deduplicate filenames across issues; skip files not on disk (record under `attachWarnings`).

### 3b. Append-description mode

Goal: mutate the parent ticket's `description` field, preserving the existing description on top.

1. Read the parent's current description from the Step 1 `jira_get_issue` response. The MCP server returns `fields.description` as **Markdown** (it has already converted from wiki for you).
2. Build the QA report block as a Markdown document — report-level header plus per-issue sections (see template).
3. Compose new description:
   - If existing description is null/empty → `newDescription = qaBlock`.
   - Else → `newDescription = existing + "\n\n---\n\n" + qaBlock`. The `---` is a Markdown horizontal rule and survives the adapter as a wiki `----`.
4. Call `jira_update_issue(issue_key=parent, fields=JSON.stringify({ description: newDescription }))`.
5. Attach distinct screenshots to the parent in a follow-up `jira_update_issue` call (same shape as Step 3's attach).
6. Record the parent key in `appendDescriptionKey`.

If `dryRun`, return the prospective new description in a `dryRunPreview.description` field and skip the actual `jira_update_issue` calls.

### 4. Mutate the report

For each successful create, set on the source issue:

```jsonc
"synced": {
  "jiraKey":  "<KEY>-NNNN",
  "jiraUrl":  "https://<workspace>.atlassian.net/browse/<KEY>-NNNN",
  "syncedAt": "<ISO now>",
  "mode":    "subtasks"
}
```

This mutation is in-memory. The caller (`/qa:sync`) is responsible for writing the report back to disk.

## Markdown description template

The issue description is a **Markdown string** that the MCP server converts to Jira wiki markup. The template below is engineered to survive the adapter without column-shift, escape-bombs, or italic-flips. Three rules drive the design:

1. **Default body is a bold-key list, not a Markdown table.** A literal `|` in a Markdown-table cell shifts columns under most adapters. The metadata block is therefore a **bold-key list** by default. Selectors and computed values that contain `|` go inside fenced code blocks — `|` is harmless there. **Tables are available as opt-in (`config.bodyFormat === "table"`)** and must follow the column rules in "Table format" below.
2. **Reference screenshots by filename in plain text — do NOT use wiki-image macros.** Verified live on ELS-1317 (2026-05-07): the adapter rewrites `!filename.png|thumbnail!` into Markdown `![](filename.png)`, which Jira UI then renders as **literal text** (no thumbnail, no broken-image placeholder). Both wiki and Markdown image syntax fail on this adapter. Strategy: upload PNGs as attachments via `jira_update_issue` (Step 2b) and emit a plain-text bullet list of filenames in the description. Jira's sidebar **Attachments** panel renders thumbnails automatically — no inline embed needed.
3. **Translate user prose, not technical values.** When `config.translate === "en"` (default), `displayTitle`, `issue.note`, and any free-text inside `issue.expected` get translated to natural English. Selectors, computed CSS, URLs, file paths, and Figma breadcrumbs are passed through verbatim.

### Per-issue body (default — `bodyFormat: "list"`)

```md
### {displayTitle}     ← reuse the same translated value used in summary

**Severity:** {issue.severity}
**Type:** {issue.type}
**Page:** {issue.page || report.scope.url}
**Locale:** {issue.context.locale || report.scope.locale}
**Viewport:** {viewportLabel}
**Breakpoint:** {issue.context.breakpoint.label}     ← omit line if missing
**Device:** {issue.context.device.platform}{isMobile ? " · mobile" : ""}     ← omit line if missing
**File:line:** {issue.source.file}:{issue.source.line}     ← omit line if missing

**Note:** {translate(issue.note)}     ← omit line if note is empty/missing

**Selector{selectors.length>1?"s":""}:**
{selectors.length === 1
  ? "`" + selectors[0] + "`"
  : selectors.map((s,i)=>`${i+1}. \`${s}\``).join("\n")}

**Expected**
```
{format(issue.expected)}
```

{renderExpectedOverrides(issue)}     ← REQUIRED when issue.expectedPerElement has any non-null entry; otherwise omit

**Actual (computed)**
{renderActualBlocks(issue, selectors)}

**Figma:** [{figmaAnchor}]({figmaLink})     ← REQUIRED when figmaLink is resolvable; see Figma rules below

**Screenshots**
{renderScreenshots(shots)}

_Reported by {report.reporter || "QA Annotator"} · {report.exportedAt}_
```

> **No escape needed for `:` inside bold labels.** Field labels are wrapped in `**bold**` and may contain a literal `:` (e.g. `**File:line:**`). Do **NOT** escape the inner colon as `\:` — verified live on ELS-1317 (2026-05-07): the adapter passes the backslash through to the rendered UI as a visible `\` character, breaking the label. Plain `**File:line:**` renders correctly. Values themselves never need escaping in this layout because they're not next to a `|`.

### Per-issue body (opt-in — `bodyFormat: "table"`)

> ⚠ **Use sparingly.** Verified live on ELS-1317 (2026-05-07) against the mcp-atlassian adapter on Atlassian Cloud:
> - **`|` in a cell — even backslash-escaped or backtick-wrapped — fragments the row into extra columns.** No escape strategy works.
> - **Inline code `` ` `` is stripped inside cells** — file paths and selectors lose their monospace styling.
> - Empty cells render blank, not as `—`.
>
> Result: `bodyFormat: "table"` is safe **only** for short metadata fields whose values are guaranteed `|`-free and don't need monospace presentation (Severity, Type, Page, Locale, Viewport, Breakpoint, Device labels). For real QA data, `bodyFormat: "list"` (the default) is almost always the right choice — `font-family` values, file paths with regex-like selectors, and computed CSS often contain `|` or need monospace.

When the user explicitly opts in (via `--body-format table` or the AskUserQuestion choice), replace the metadata bold-key block with a 2-column Markdown table. Selector / Expected / Actual / Figma / Screenshots stay outside the table (their content contains `|`, fenced blocks, or wiki macros that don't survive table cells).

```md
### {displayTitle}

| Field | Value |
| --- | --- |
| Severity | {issue.severity} |
| Type | {issue.type} |
| Page | {issue.page || report.scope.url} |
| Locale | {issue.context.locale || report.scope.locale} |
| Viewport | {viewportLabel} |
| Breakpoint | {issue.context.breakpoint.label} |     ← omit row if missing
| Device | {issue.context.device.platform}{isMobile ? " · mobile" : ""} |     ← omit row if missing
| File:line | {issue.source.file}:{issue.source.line} |     ← plain text; backticks get stripped inside cells (verified live, ELS-1317). Omit row if missing.
| Note | {translate(issue.note)} |     ← omit row if note is empty

**Selector{selectors.length>1?"s":""}:**
{selectors block — same as list mode}

**Expected**
{fenced block — same as list mode}

{renderExpectedOverrides — same as list mode; emit only when expectedPerElement has non-null entries}

**Actual (computed)**
{renderActualBlocks — same as list mode}

**Figma:** [{figmaAnchor}]({figmaLink})

**Screenshots**
{renderScreenshots — same as list mode}

_Reported by {report.reporter || "QA Annotator"} · {report.exportedAt}_
```

**Table-cell rules (must follow exactly):**

1. **NEVER let `|` enter a cell — neither raw, nor backslash-escaped, nor wrapped in backticks.** Verified live on ELS-1317 (2026-05-07): rows with body `` `a \| b \| c` `` and `a \| b \| c` both fragmented into 4 columns. Inline code formatting itself gets stripped from table cells, so backticks neither protect against `|` nor preserve monospace styling. **If a value can ever contain `|` (file paths with regex hints, computed CSS like `font-family: ..., system-ui, sans-serif`, selectors with attribute matchers), MOVE the row out of the table** — render it as a `**Key:** value` line below instead. The `table` opt-in is for short, guaranteed `|`-free metadata only.
2. **Inline code `` `value` `` is NOT preserved inside cells.** Backticks render as plain text, monospace styling is lost. If you need monospace presentation (file paths, selectors), move the row out of the table.
3. **No fenced blocks, no multi-line content, no wiki macros inside cells.** Table cells must be single-line. Anything multi-line (Selector, Expected, Actual, Screenshots) goes outside the table.
4. **Omit the row entirely** when the field is missing (don't leave an empty value cell — empty cells render as a blank cell, which is visually noisy).
5. **Header row is exactly `| Field | Value |`** with `| --- | --- |` separator. Do not invent extra columns.

### Helpers

**`translate(text)`** — used for `displayTitle`, `issue.note`, and free-text strings inside `issue.expected`:
- If `config.translate === "off"` → return `text` unchanged.
- If `config.translate === "en"` (DEFAULT) → translate to natural English. Detect source language from the text itself; if already English, return unchanged. Preserve casing intent (sentence case stays sentence case). Keep technical tokens verbatim (`px`, `rgb`, hex codes, IDs like `ISS-001`, selectors, URLs, file paths). Do not invent extra context — translate what's there, do not "improve" the wording.
- Inputs that are clearly NOT prose (looks like a selector, contains `>`, `:`, or starts with a tag selector) → return verbatim regardless of language. Translation is for human-readable strings only.
- Apply translation **once per field per issue** so the same translated `displayTitle` is used in both summary and `### heading`.

**`format(value)`** — string content for fenced code blocks (Expected, single-Actual):
- string → as-is (do NOT translate — Expected values are technical specs)
- object → `key: val` lines joined by `\n` (keys and values both verbatim)
- empty / null → `—`

**`renderExpectedOverrides(issue)`** — returns a Markdown string for per-element expected overrides, or empty string when there are none:

- If `issue.expectedPerElement` is missing, not an array, or every entry is `null` / empty → return `""`. The shared **Expected** block above is the only one rendered.
- Otherwise, for each entry `ovr` at index `idx`:
  - Skip if `ovr` is `null` or `Object.keys(ovr).length === 0`.
  - Emit a sub-block:
    ```md
    **Expected — ({idx + 1}) overrides**
    ```
    {key}: {value}
    {key}: {value}
    ```
    ```
- Keep blocks separated by a blank line. The numbering aligns with the `**Selector{s}:**` list above so reviewers can cross-reference (e.g. `(2)` here = the 2nd selector).
- **Do NOT merge `issue.expected` into the override block.** The shared block already conveys the baseline; merging hides the QA author's intent (which fields they meant to override versus inherit). Render shared and overrides as two distinct surfaces.
- **Do NOT translate** keys or values inside overrides. They are technical CSS, identical to the shared block's rules.
- Figma-related keys (`figmaLink`, `figmaNodeId`, `figmaBreadcrumb`, …) are guaranteed to be absent from `expectedPerElement` entries — the extension strips them on save. If for any reason one slips through, ignore it.

**`renderActualBlocks(issue, selectors)`** — returns a Markdown string:
- If `issue.computedPerElement?.length > 1`:
  - If `issue.computedAllIdentical === true` → one fenced block. The line above the fence reads `_(1)(2)…(N) — identical_`. Body = `format(computedPerElement[0])`.
  - Else → for each element N: a paragraph `_(N) {selectors[N]}_` followed by a fenced code block of `format(computedPerElement[N])`.
- Else → single fenced code block of `issue.actual ?? issue.computed`.

All fences are triple-backtick with no language tag. Inside the fence, `|`, `*`, `_`, `!` are inert — no escaping needed.

**`renderScreenshots(shots)`** — returns a Markdown string. Per shot, emit ONE plain-text bullet:

```md
- `{shot.filename}` — `{relativePath}`
```

`relativePath` = `screenshots/{shot.filename}` so reviewers can locate the source file under `docs/qa/reports/<date>/`.

**Why no inline embed?** Verified live on ELS-1317 (2026-05-07): both `!filename|thumbnail!` (wiki macro) and `![](filename)` (Markdown image) get adapter-mangled and render as literal text in the Jira UI. The reliable channel is the **Attachments panel in the sidebar** — Jira renders thumbnails there automatically once `jira_update_issue` (Step 2b) uploads the PNGs. The plain-text bullet in the description tells the reviewer which file in the panel corresponds to which finding.

If `shots` is empty, omit the **Screenshots** section entirely.

**Figma link rules (must follow when emitting the `**Figma:**` line):**

1. **Source of truth**: prefer `issue.expected.figmaLink` if present (the extension already URL-encoded it). Else build from `profile.figma.linkTemplate` substituting `{fileKey}`, `{fileSlug}`, `{nodeId}` — and **URL-encode `nodeId`** by replacing `:` with `%3A` (e.g. `1234:5678` → `1234%3A5678`). A raw `:` in the URL silently breaks deeplink resolution on some Figma builds.
2. **Anchor text** (`figmaAnchor`): pick in this order — `issue.expected.figmaBreadcrumb` (most informative) → `issue.expected.figmaNodeName` → `"Open in Figma"`. Never leave the link bare.
3. **Always Markdown-link form** `[anchor](url)` so the adapter outputs a clickable wiki link `[anchor|url]`. Do NOT emit the URL alone, do NOT wrap inside backticks (would render as code, not a link).
4. **Skip the line entirely** only when neither `issue.expected.figmaLink` nor (`profile.figma.fileKey` + `issue.expected.figmaNodeId`) is available. Do not emit a placeholder like `[no figma]`.

### Report-level header (modes `append-comment` and `append-description`)

Build one Markdown document that begins with a summary block before per-issue sections:

```md
## QA session — {profile.name} · {report.scope.date}

**Total issues:** {report.counts.total}
**Viewports tested:** {report.scope.viewportsTested.map(v => `${v.w}×${v.h} (${v.breakpoint}) ×${v.count}`).join(", ")}
**URL:** {report.scope.url}

---
```

Per-issue sections that follow use the same per-issue template above, downshifted by one heading level (`###` becomes `####`).

This gives the parent ticket an at-a-glance view of which screen sizes the session covered.

## Anti-patterns (do NOT do these — they caused inconsistent subtasks observed across machines)

The following were observed across machines and must be rejected:

1. **Narrative re-composition** — emitting custom sections like `## QA Annotator finding — ISS-NNN`, `### Observed (actual)`, `### Delta`, `**Original title:**`. These are creative rewrites, not the template. Stick to the per-issue template above.
2. **Markdown table when `bodyFormat === "list"`** — only opt in to a table when `config.bodyFormat === "table"`. Even in `"table"` mode, **never put a value containing `|` into a cell** (regardless of escapes or backticks — both fail on this adapter). File paths, selectors with attribute matchers, computed CSS like `font-family: ..., system-ui, sans-serif` all need to render as bold-key lines below the table, NOT as extra rows. Inline code wrapping is also stripped from cells; if monospace presentation matters, the row belongs outside the table.
3. **Translated field labels** — labels are always English (`Severity`, `Type`, `Page`, …). When `config.translate === "en"`, prose VALUES (title, note, expected free-text) are translated; LABELS never are. When `config.translate === "off"`, nothing is translated.
4. **Translated technical values** — selectors, computed CSS (px/rgb/hex), URLs, file paths, Figma breadcrumbs, IDs (`ISS-001`) must pass through verbatim under either translate setting.
5. **Bare Figma URL or "Open in Figma" without breadcrumb** — when `figmaBreadcrumb` is available, use it. `Open in Figma` is the last-resort anchor only.
6. **Unencoded `:` in nodeId** — `node-id=1234:5678` instead of `1234%3A5678`. Always encode.
7. **Inline image embeds — both wiki and Markdown forms render as literal text on this adapter.** Verified live on ELS-1317 (2026-05-07): `!filename|thumbnail!` (wiki) gets rewritten to `![](filename)` (Markdown), which Jira UI then renders as plain text — no thumbnail, no broken-image placeholder. Do NOT emit either form. Use the plain-text bullet from `renderScreenshots` and rely on the **Attachments panel** in the Jira sidebar (which auto-renders thumbnails for files uploaded via Step 2b's `jira_update_issue`).
8. **Re-translating per call site** — translate `title` and `note` ONCE at the top of issue processing and reuse the cached value in both summary and heading. Translating twice can produce different strings on different invocations of the same MCP tool.
9. **Merging `expectedPerElement` into the shared `Expected` block** — the override array is rendered as separate `**Expected — (N) overrides**` sub-blocks, not folded into the shared block. Two distinct surfaces preserve QA intent (which fields were chosen as overrides vs. inherited from All). Conversely, do not omit the shared block when overrides exist; both render together.

If you find yourself about to emit any of the above, stop and re-read the per-issue template.

## Audience formats (`config.audience`)

The default audience is `tech` — the per-issue template described above (engineered for Dev + QA workflow, deterministic, byte-equivalent across machines). All other audiences are **opt-in via explicit hint** (`/qa:sync` Step 3f surfaces an `AskUserQuestion` only when the user message contains an audience keyword) or via the `--audience` CLI flag. Most users never see audiences other than `tech`.

### `tech` (default)

The per-issue template defined earlier in this spec. Severity / Type / Page / Locale / Viewport / Breakpoint / Device as bold-key list (or table if `bodyFormat: "table"`); selectors as numbered list with inline code; Expected / Actual as fenced blocks; Figma as Markdown link; Screenshots as plain-text bullet list. **Suitable for:** Dev + QA. **Audience:** technical readers who copy-paste selectors and diff computed CSS.

### `leader`

Severity-first metadata at top, 1-line "What's wrong" prose translation of the CSS delta, "User impact" bullets (visual hierarchy / layout drift / scope / customer reach), and a 3-option "Decision aid" trade-off table (fix now / defer / won't-fix). Selectors and computed CSS are HIDDEN — leader gets a link to the tech-view comment for detail. **Suitable for:** Engineering Manager, PM, triage meetings. **Tone:** executive, scannable, decision-supporting.

### `ba`

Gherkin-style Acceptance Criteria block in a fenced code block (`Feature: ... Scenario: ... Given/When/Then/And/But`) where the "But" clause captures the failing actual outcome. "Business impact" prose with brand/value/channel framing (e.g., "trust narrative weakened", "value proposition lost", "channel: tablet users 15-20% of B2B traffic"). "Linked artifacts" with placeholder for parent user story / Epic. Closes with "Three Amigos sync" suggestion. Selectors and computed CSS hidden. **Suitable for:** Business Analyst, Product Owner, design review. **Tone:** narrative, business intent, collaborative.

### `qa`

QA-test-execution metadata table (Tester / Profile / Reproducibility / Regression risk / Re-test ETA), test steps with `✅` checkmarks (executed), Findings table with Pass/Fail per assertion (e.g., 3/6 passed), "Coverage scope" with `✅`/`⏳` per viewport, "Verification checklist (post-fix)" of 5-7 actionable items, "Sibling tickets to watch" section for regression hunting. **Suitable for:** QA Lead, test execution audit, pre-promotion validation. **Tone:** procedural, audit-trail.

### `ai`

JSON `qa-finding-v1` schema in a fenced code block — every field machine-parseable. Includes `delta` array with `diff_px` / `diff_kind` enums, `fix_hints` block with `candidate_files` / `candidate_classes` / `responsive_hint`, `regression_signals` boolean flags. "Cross-reference contract" table maps each JSON field to its source-of-truth module. Closes with "Suggested AI tasks" instructing downstream code-fix agents / regression classifiers / doc bots. **Caveat:** when emitting JSON, **prefer camelCase over snake_case for keys** — the mcp-atlassian adapter rewrites `_underscore_` identifiers to italic markup `*…*` even inside fenced code blocks (verified live on ELS-1317 comment 14476). If snake_case is required for downstream consumers, escape underscores or document a post-fetch normalize step. **Suitable for:** Claude code-fix agent, regression-classifier bot, doc-generator pipelines. **Tone:** declarative, machine-first.

### `all`

Posts FIVE separate comments — one for each of `tech`, `leader`, `ba`, `qa`, `ai` — in that order, each with a heading prefix `[TECH view]` / `[LEADER view]` / etc. Cross-link via `[See AI view](#)` style references at the bottom of each comment. Use **only when** the same finding needs to reach multiple audiences in parallel (e.g., a critical bug that needs Dev + Leader + BA review simultaneously). Default workflow is single-comment `tech`; `all` is for special cases (post-mortem, root-cause meeting, customer-impact incident).

### Helper: `detectAudienceHint(userMessage)`

Returns `"tech"` | `"leader"` | `"ba"` | `"qa"` | `"ai"` | `"all"` | `null`. Implementation:

```js
function detectAudienceHint(msg) {
  if (!msg) return null;
  const m = msg.toLowerCase();
  if (/\b(all audiences?|every persona|five views?|all five|every audience)\b/.test(m)) return "all";
  if (/\b(ai agent|machine[- ]readable|json payload|code[- ]fix bot|structured data|downstream agent|claude agent|llm[- ]friendly)\b/.test(m)) return "ai";
  if (/\b(ba review|business analyst|acceptance criteria|gherkin|three amigos|user story link|product owner)\b/.test(m)) return "ba";
  if (/\b(leader review|stakeholder|executive|pm review|product manager|triage view|engineering manager)\b/.test(m)) return "leader";
  if (/\b(test execution|verification checklist|regression hunt|qa review|coverage scope|re[- ]test plan)\b/.test(m)) return "qa";
  return null;  // → silent default tech
}
```

The detector is intentionally **conservative** — it returns `null` when there's no explicit signal so the silent default `tech` stays in place. False positives (user mentions "leader" in passing without wanting a leader-format) are caught by the `AskUserQuestion` confirmation in Step 3f, which lets the user override back to `tech`.

### Per-audience helper signatures

The skill MUST implement one helper per audience. Each helper returns the full Markdown body for one issue:

```js
function renderTechBody(issue, profile, config)    // → existing template (this file's main spec)
function renderLeaderBody(issue, profile, config)  // → metadata table + What's wrong + User impact + Decision aid
function renderBABody(issue, profile, config)      // → Gherkin block + Business impact + Linked artifacts
function renderQABody(issue, profile, config)      // → QA metadata + Test steps + Findings + Coverage + Verification
function renderAIBody(issue, profile, config)      // → JSON qa-finding-v1 + Cross-reference contract + Suggested AI tasks
```

For `audience === "all"`, call all five helpers and post 5 separate comments. For other modes, call only the matching helper. The summary line (`config.summaryFormat`) and the report-level header (for append modes) are SHARED across audiences — only the per-issue body changes.

> **Live evidence:** all five formats were posted to ELS-1317 on 2026-05-07 (comments 14470 list, 14471 table, 14472 dev, 14473 leader, 14474 BA, 14475 QA, 14476 AI) and verified to render correctly on Atlassian Cloud. The `tech` template is the most defensive against adapter quirks; other audiences inherit the same Markdown safety rules (no `|` in table cells, no wiki image macros, no `\:` escapes, no snake_case in fenced JSON for `ai`).

## Idempotency

The skill is fully idempotent: re-running with the same inputs after success yields all `skipped: already-synced` and zero new Jira issues. To force re-creation, the caller deletes the `synced` block on an issue.

## Edge cases

- **Issue missing `severity`** → default `minor`, priority `Medium`, no error.
- **Issue missing `expected` and `actual`** → still create the ticket; the corresponding fenced blocks contain `—`.
- **`profile.jira.projectKey` missing** in `tasks` mode → return `{ error: "no-project-key" }`.
- **MCP rate limiting** → if a single create fails with a 429-like error, sleep ~2s and retry once. After two failures, mark as `failed` and continue.
- **Screenshot file missing on disk** (report references `shot.filename` but PNG was never exported) → omit from `attachments` JSON; still emit the plain-text fallback line in description so the user knows what to look for; record in `attachWarnings`.
- **Attach call fails after issue create** → leave the ticket in place; record in `attachFailed` so the summary tells the user which tickets need a manual upload. The description's plain-text bullet from `renderScreenshots` already names every PNG so a human can drag-and-drop the file into the ticket via Jira's sidebar.
