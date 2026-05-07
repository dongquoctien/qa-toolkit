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
  "created": [{ "issueId": "ISS-001", "jiraKey": "ELS-2001", "url": "...", "attached": ["ISS-001-auto-48471.png"] }],
  "skipped": [{ "issueId": "ISS-002", "reason": "already-synced" }],
  "failed":  [{ "issueId": "ISS-003", "error": "<message>" }],
  "attachFailed": [{ "issueId": "ISS-001", "jiraKey": "ELS-2001", "files": ["ISS-001-auto-48471.png"], "error": "<message>" }],
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
  "jiraKey":  "ELS-2001",
  "jiraUrl":  "https://<workspace>.atlassian.net/browse/ELS-2001",
  "syncedAt": "<ISO now>",
  "mode":    "subtasks"
}
```

This mutation is in-memory. The caller (`/qa:sync`) is responsible for writing the report back to disk.

## Markdown description template

The issue description is a **Markdown string** that the MCP server converts to Jira wiki markup. The template below is engineered to survive the adapter without column-shift, escape-bombs, or italic-flips. Three rules drive the design:

1. **Default body is a bold-key list, not a Markdown table.** A literal `|` in a Markdown-table cell shifts columns under most adapters. The metadata block is therefore a **bold-key list** by default. Selectors and computed values that contain `|` go inside fenced code blocks — `|` is harmless there. **Tables are available as opt-in (`config.bodyFormat === "table"`)** and must follow the column rules in "Table format" below.
2. **Embed images by attachment filename, not URL.** Use the wiki-image macro `!filename.png|thumbnail!`. The attachment must already exist on the ticket (Step 2b); if attachment fails, the same filename appears as plain text so a human can re-attach it.
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
**File\:line:** {issue.source.file}:{issue.source.line}     ← omit line if missing

**Note:** {translate(issue.note)}     ← omit line if note is empty/missing

**Selector{selectors.length>1?"s":""}:**
{selectors.length === 1
  ? "`" + selectors[0] + "`"
  : selectors.map((s,i)=>`${i+1}. \`${s}\``).join("\n")}

**Expected**
```
{format(issue.expected)}
```

**Actual (computed)**
{renderActualBlocks(issue, selectors)}

**Figma:** [{figmaAnchor}]({figmaLink})     ← REQUIRED when figmaLink is resolvable; see Figma rules below

**Screenshots**
{renderScreenshots(shots)}

_Reported by {report.reporter || "QA Annotator"} · {report.exportedAt}_
```

> **Escape rule for `**` keys.** Field labels are wrapped in `**bold**`. When emitting a literal colon right after a key — e.g. `**File:line:**` — escape the inner colon as `**File\:line:**` so adapters don't reinterpret. The values themselves never need escaping in this layout because they're not next to a `|`.

### Per-issue body (opt-in — `bodyFormat: "table"`)

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
| File:line | `{issue.source.file}:{issue.source.line}` |     ← wrap in inline code; omit row if missing
| Note | {translate(issue.note)} |     ← omit row if note is empty

**Selector{selectors.length>1?"s":""}:**
{selectors block — same as list mode}

**Expected**
{fenced block — same as list mode}

**Actual (computed)**
{renderActualBlocks — same as list mode}

**Figma:** [{figmaAnchor}]({figmaLink})

**Screenshots**
{renderScreenshots — same as list mode}

_Reported by {report.reporter || "QA Annotator"} · {report.exportedAt}_
```

**Table-cell rules (must follow exactly):**

1. **Never let an unescaped `|` enter a cell.** If a value can contain `|` (e.g. some `device.userAgent` strings), wrap the entire value in inline code `` `value` `` — `|` is inert inside backticks. Values like `Severity` / `Type` / `Locale` / breakpoint labels never contain `|`, so they go bare.
2. **No fenced blocks, no multi-line content, no wiki macros inside cells.** Table cells must be single-line. Anything multi-line (Selector, Expected, Actual, Screenshots) goes outside the table.
3. **Omit the row entirely** when the field is missing (don't leave an empty value cell — empty cells render as `—` on some adapters and are noisy).
4. **Header row is exactly `| Field | Value |`** with `| --- | --- |` separator. Do not invent extra columns.

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

**`renderActualBlocks(issue, selectors)`** — returns a Markdown string:
- If `issue.computedPerElement?.length > 1`:
  - If `issue.computedAllIdentical === true` → one fenced block. The line above the fence reads `_(1)(2)…(N) — identical_`. Body = `format(computedPerElement[0])`.
  - Else → for each element N: a paragraph `_(N) {selectors[N]}_` followed by a fenced code block of `format(computedPerElement[N])`.
- Else → single fenced code block of `issue.actual ?? issue.computed`.

All fences are triple-backtick with no language tag. Inside the fence, `|`, `*`, `_`, `!` are inert — no escaping needed.

**`renderScreenshots(shots)`** — returns a Markdown string. Per shot:

```md
- !{shot.filename}|thumbnail!     ← the wiki image macro; renders if attachment exists
  `{shot.filename}` — `{relativePath}`     ← always emitted as plain-text fallback
```

The wiki macro `!file|thumbnail!` is one of the few wiki-only fragments that the Markdown adapter passes through verbatim (it has no Markdown counterpart). The plain-text line on the next bullet is **always emitted** regardless of attach success — it tells a human reviewer exactly which file to look for if the thumbnail fails to render. `relativePath` = `screenshots/{shot.filename}` so the user can locate it under `docs/qa/reports/<date>/`.

If `shots` is empty, omit the **Screenshots** section entirely.

**Figma link rules (must follow when emitting the `**Figma:**` line):**

1. **Source of truth**: prefer `issue.expected.figmaLink` if present (the extension already URL-encoded it). Else build from `profile.figma.linkTemplate` substituting `{fileKey}`, `{fileSlug}`, `{nodeId}` — and **URL-encode `nodeId`** by replacing `:` with `%3A` (e.g. `3880:2925` → `3880%3A2925`). A raw `:` in the URL silently breaks deeplink resolution on some Figma builds.
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

## Anti-patterns (do NOT do these — they caused inconsistent ELS-1317 subtasks)

The following were observed across machines and must be rejected:

1. **Narrative re-composition** — emitting custom sections like `## QA Annotator finding — ISS-NNN`, `### Observed (actual)`, `### Delta`, `**Original title:**`. These are creative rewrites, not the template. Stick to the per-issue template above.
2. **Markdown table when `bodyFormat === "list"`** — only opt in to a table when `config.bodyFormat === "table"`. In `"table"` mode, follow the column rules in the "Table format" section: never let an unescaped `|` into a cell, no fenced blocks/wiki macros inside cells, no extra columns.
3. **Translated field labels** — labels are always English (`Severity`, `Type`, `Page`, …). When `config.translate === "en"`, prose VALUES (title, note, expected free-text) are translated; LABELS never are. When `config.translate === "off"`, nothing is translated.
4. **Translated technical values** — selectors, computed CSS (px/rgb/hex), URLs, file paths, Figma breadcrumbs, IDs (`ISS-001`) must pass through verbatim under either translate setting.
5. **Bare Figma URL or "Open in Figma" without breadcrumb** — when `figmaBreadcrumb` is available, use it. `Open in Figma` is the last-resort anchor only.
6. **Unencoded `:` in nodeId** — `node-id=3880:2925` instead of `3880%3A2925`. Always encode.
7. **Wiki image macro re-escaped to Markdown** — emitting `![](file.png)` (Markdown image syntax) gets adapter-mangled to `\![](file.png)`. Use the wiki macro `!filename|thumbnail!` exactly as written in `renderScreenshots`.
8. **Re-translating per call site** — translate `title` and `note` ONCE at the top of issue processing and reuse the cached value in both summary and heading. Translating twice can produce different strings on different invocations of the same MCP tool.

If you find yourself about to emit any of the above, stop and re-read the per-issue template.

## Idempotency

The skill is fully idempotent: re-running with the same inputs after success yields all `skipped: already-synced` and zero new Jira issues. To force re-creation, the caller deletes the `synced` block on an issue.

## Edge cases

- **Issue missing `severity`** → default `minor`, priority `Medium`, no error.
- **Issue missing `expected` and `actual`** → still create the ticket; the corresponding fenced blocks contain `—`.
- **`profile.jira.projectKey` missing** in `tasks` mode → return `{ error: "no-project-key" }`.
- **MCP rate limiting** → if a single create fails with a 429-like error, sleep ~2s and retry once. After two failures, mark as `failed` and continue.
- **Screenshot file missing on disk** (report references `shot.filename` but PNG was never exported) → omit from `attachments` JSON; still emit the plain-text fallback line in description so the user knows what to look for; record in `attachWarnings`.
- **Attach call fails after issue create** → leave the ticket in place; record in `attachFailed` so the summary tells the user which tickets need a manual upload.
- **Wiki image macro renders as text on some Jira instances** (older DC, custom themes that disable inline images) → harmless. The plain-text filename line below the macro tells the human reviewer what file to open from the local repo.
