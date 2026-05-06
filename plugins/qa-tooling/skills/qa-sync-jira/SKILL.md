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
    "mode":   "subtasks" | "tasks" | "append",
    "parent": "<KEY-NN>" | null,
    "dryRun": false
  }
}
```

## MCP tool used

`mcp-atlassian` server. Common tool names (use whichever the runtime exposes):

- `mcp__mcp-atlassian__jira_get_issue`
- `mcp__mcp-atlassian__jira_create_issue`
- `mcp__mcp-atlassian__jira_add_comment`
- `mcp__mcp-atlassian__jira_search`

If `mcp-atlassian` is not available, return `{ error: "mcp-unavailable" }` and stop. Do not fall back to direct HTTP.

## Output shape

Return after running:

```jsonc
{
  "created": [{ "issueId": "ISS-001", "jiraKey": "ELS-2001", "url": "..." }],
  "skipped": [{ "issueId": "ISS-002", "reason": "already-synced" }],
  "failed":  [{ "issueId": "ISS-003", "error": "<message>" }],
  "appendCommentKey": "<key if mode=append, else null>"
}
```

## Steps

### 1. Resolve parent (if needed)

If `mode` is `subtasks` or `append`, parent must be set. If absent, return `{ error: "no-parent" }`.

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
- Build the **summary**: `[{viewportLabel}] {issue.title || issue.note || issue.id} — {primarySelector || issue.source.file}`. Truncate to 120 chars.
- Build the **description** as ADF (see schema below).
- Build the fields:
  ```js
  {
    project: { key: profile.jira.projectKey },
    issuetype: { name: mode === "subtasks" ? "Sub-task" : "Task" },
    parent: mode === "subtasks" ? { key: parent } : undefined,
    summary,
    description, // ADF object
    priority: { name: severityToPriority[issue.severity] || "Medium" },
    labels: dedupe([...(profile.jira.defaultLabels || []), "qa-annotator", `severity-${issue.severity}`])
  }
  ```
- If `dryRun`, push to a planned-actions list and continue.
- Else, call `jira_create_issue`. On success, record `{ issueId: issue.id, jiraKey: result.key, url: result.self || derived }`.
- On failure, record under `failed` and continue.

### 3. Append mode

Build one ADF document containing a heading per issue and a compact table. Call `jira_add_comment(parent, body=adfDoc)`. Record the parent key in `appendCommentKey`.

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

## ADF description template

The issue description is a single ADF document. The structure below is a sketch — adapt to the MCP server's expected shape:

```jsonc
{
  "type": "doc",
  "version": 1,
  "content": [
    // 1. Heading = issue title (or note, or id)
    { "type": "heading", "attrs": { "level": 3 }, "content": [{ "type": "text", "text": "<issue.title || issue.note || issue.id>" }] },

    // 2. Metadata table
    { "type": "table", "attrs": { "isNumberColumnEnabled": false, "layout": "default" }, "content": [
      <row "Severity"    | issue.severity>,
      <row "Type"        | issue.type>,
      <row "Page"        | issue.page or report.scope.url>,
      <row "Locale"      | issue.context.locale or report.scope.locale>,
      <row "Viewport"    | viewportLabel>,                              // see resolution rules above
      <row "Breakpoint"  | issue.context.breakpoint?.label>,            // optional, omit row if missing
      <row "Device"      | issue.context.device?.platform + (isMobile ? " · mobile" : "")>,  // optional
      <row "File:line"   | `${issue.source.file}:${issue.source.line}` (optional)>
    ]},

    // 3. Selector(s) — single OR ordered list when multi-pick
    selectors.length === 1
      ? { "type": "paragraph", "content": [
          { "type": "text", "text": "Selector: " },
          { "type": "text", "text": selectors[0], "marks": [{ "type": "code" }] }
        ]}
      : { "type": "orderedList", "content": selectors.map(s => ({
          "type": "listItem", "content": [{
            "type": "paragraph", "content": [{ "type": "text", "text": s, "marks": [{ "type": "code" }] }]
          }]
        }))},

    // 4. Expected vs Actual
    //    For Actual, use issue.computedPerElement when length > 1 AND !computedAllIdentical:
    //      render one fenced block per element, headed by "(N) <selector>".
    //    Otherwise fall back to a single block from issue.actual / issue.computed.
    { "type": "paragraph", "content": [{ "type": "text", "text": "Expected", "marks": [{ "type": "strong" }] }] },
    <code-block(format(issue.expected))>,

    { "type": "paragraph", "content": [{ "type": "text", "text": "Actual (computed)", "marks": [{ "type": "strong" }] }] },
    ...renderActualBlocks(issue, selectors),  // see helper below

    // 5. Reporter line
    { "type": "paragraph", "content": [{ "type": "text", "text": `Reported by ${report.reporter || "QA Annotator"} · ${report.exportedAt}` }] },

    // 6. Figma link (only if profile.figma.fileKey and issue.expected.figmaNodeId)
    { "type": "paragraph", "content": [{
      "type": "text", "text": "Figma reference",
      "marks": [{ "type": "link", "attrs": { "href": <built link from profile.figma.linkTemplate> } }]
    }]},

    // 7. Screenshot links — ONE PER SHOT in shots[]
    //    Use profile.screenshots.githubRawBase, substitute {date} from report.scope.date,
    //    append shot.filename (NOT relativePath — base already ends with /screenshots/).
    ...shots.map((shot, i) => ({
      "type": "paragraph", "content": [{
        "type": "text",
        "text": shots.length > 1 ? `Screenshot ${i + 1}` : "Screenshot",
        "marks": [{ "type": "link", "attrs": { "href": <githubRawBase> + shot.filename } }]
      }]
    }))
  ]
}
```

### Helpers

**`format(value)`** — used in expected / single-actual blocks:
- string → as-is
- object → `key: val` lines joined by `\n`
- empty / null → `—`

**`renderActualBlocks(issue, selectors)`** — returns ADF nodes:
- If `issue.computedPerElement?.length > 1`:
  - If `issue.computedAllIdentical === true` → one code-block headed by `(1)(2)...(N) — identical`, body = `format(computedPerElement[0])`.
  - Else → one paragraph + code-block per element, paragraph reads `(N) <selectors[N]>` and code-block contains `format(computedPerElement[N])`.
- Else → single code-block from `issue.actual ?? issue.computed`.

### Report-level header (mode `append` only)

When mode is `append`, build one large ADF doc that begins with a summary block before per-issue sections:

```
**QA session — <profile.name> · <report.scope.date>**
- Total issues: <report.counts.total>
- Viewports tested: <report.scope.viewportsTested.map(v => `${v.w}×${v.h} (${v.breakpoint}) ×${v.count}`).join(", ")>
- URL: <report.scope.url>
```

This gives the parent ticket an at-a-glance view of which screen sizes the session covered.

## Idempotency

The skill is fully idempotent: re-running with the same inputs after success yields all `skipped: already-synced` and zero new Jira issues. To force re-creation, the caller deletes the `synced` block on an issue.

## Edge cases

- **Issue missing `severity`** → default `minor`, priority `Medium`, no error.
- **Issue missing `expected` and `actual`** → still create the ticket; tables show `—`.
- **`profile.jira.projectKey` missing** in `tasks` mode → return `{ error: "no-project-key" }`.
- **MCP rate limiting** → if a single create fails with a 429-like error, sleep ~2s and retry once. After two failures, mark as `failed` and continue.
