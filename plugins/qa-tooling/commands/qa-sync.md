---
name: qa:sync
description: Read a QA report (JSON or ZIP) and create/update Jira issues via the Atlassian MCP server.
argument-hint: "[report-path] [--mode subtasks|tasks|append-comment|append-description] [--parent KEY-NN] [--dry-run]"
---

# /qa:sync — QA Report → Jira

Convert a QA Annotator report into Jira issues. The command **never auto-decides** between creating subtasks and editing an existing ticket — it always confirms via `AskUserQuestion` when the choice is ambiguous.

> **Interaction convention:** ALWAYS use the `AskUserQuestion` tool to gather user input. Never write inline `? ...` prompts and wait for a free-text reply. This command emits up to three structured prompts: **(1) mode** when `--mode` is missing, **(2) parent** when no parent is resolved, **(3) parent confirmation** before any Jira write. Skip a prompt only when its value is already known from flags / report hints / profile defaults.

## Inputs

Positional argument (optional): path to a `qa-report.json` or `.zip`. If omitted, find the most recent report under `docs/qa/reports/<date>/qa-report.json` (sort folders by name, descending — they're date-stamped).

Flags:
- `--mode subtasks` — each issue becomes a Jira **Sub-task** under `--parent`.
- `--mode tasks` — each issue becomes a top-level Jira Task (no parent required).
- `--mode append-comment` — append all issues as a single ADF **comment** on `--parent` (no new tickets, parent description untouched).
- `--mode append-description` — append the QA report block to the **description** of `--parent` via `jira_update_issue` (mutates the parent ticket itself; original description is preserved above the appended block).
- `--mode append` — alias for `--mode append-comment` (kept for back-compat).
- `--parent KEY-NN` — override `report.syncHints.suggestedParent` and `profile.jira.defaultParent`.
- `--dry-run` — print what would be created/updated, do not call MCP write.

**No `--mode` flag → ALWAYS prompt.** There is no implicit default. See Step 3.

## Required MCP

`mcp-atlassian` — if not available, abort with `fix: connect the mcp-atlassian server, then re-run /qa:sync`.

## Steps

### 1. Locate and load the report

- If path is a `.zip`, ask the user to extract it first to `docs/qa/reports/<date>/` and re-run. (Do not extract automatically — keeps the command predictable.)
- If path is a `.json`, Read it.
- If path is omitted, Glob `docs/qa/reports/*/qa-report.json`, pick the lexicographically greatest folder.

Validate the loaded JSON has `report.profile.id`, `report.issues` (array). If invalid → abort with the specific missing field.

### 2. Load the profile

Read `docs/qa/qa-profile.json`. The report's `profile.id` should match `profile.id` — if not, warn and continue (the user may have multiple profiles).

### 3. Resolve sync config

Precedence for `mode` and `parent` (highest first):
1. CLI flags (`--mode`, `--parent`)
2. `report.syncHints` (`suggestedJiraProject`, `suggestedParent`)
3. `profile.jira` (`projectKey`, `defaultParent`)

Note: `report.syncHints.defaultMode` and `profile.jira.defaultMode` are treated as **suggestions only**, never as silent defaults — see 3a.

**3a. Prompt for mode (REQUIRED when `--mode` is absent).** Always call `AskUserQuestion`:

```
header: "Sync mode"
question: "How should the {N} QA issue(s) be pushed to Jira?"
options:
  - "Create sub-tasks under a parent ticket (Recommended)"  // → subtasks
  - "Append as a comment on a parent ticket"                // → append-comment
  - "Append into the description of a parent ticket"        // → append-description
  - "Create top-level tasks (no parent)"                    // → tasks
```

If `report.syncHints.defaultMode` or `profile.jira.defaultMode` is set, list that option **first** and add `(Recommended)` to its label — but still ask. Never skip this prompt just because a default exists. The only way to bypass is the explicit `--mode` flag.

**3b. Resolve parent (skip if final mode is `tasks`).** If `parent` is still unresolved after flag/hint/profile precedence, call `AskUserQuestion`:

```
header: "Parent"
question: "Which Jira ticket should be the parent for this QA session?"
options:
  - <top guess from report.syncHints.suggestedParent>      // if present
  - <top guess from branch name regex (e.g. ELS-1234-foo → ELS-1234)>
  - <top guess from recent commit subjects>
  // implicit "Other" for free entry
```

Never use an inline `? ...` prompt.

### 4. Verify and confirm parent (skip if mode is `tasks`)

**4a. Verify exists.** Call `mcp-atlassian.jira_get_issue` with the resolved parent key. If it 404s → abort with `fix: parent <KEY> not found in Jira`.

**4b. Confirm with the user (REQUIRED — do NOT skip even when parent came from a flag).** Print the parent's summary, status, and assignee, then call `AskUserQuestion`:

```
header: "Confirm parent"
question: "Parent ticket: {KEY} — \"{summary}\" (status: {status}, assignee: {assignee or 'unassigned'}). Proceed in mode '{mode}'?"
options:
  - "Yes, proceed (Recommended)"
  - "Pick a different parent"   // → restart Step 3b prompt
  - "Change mode"               // → restart Step 3a prompt
  - "Cancel"                    // → abort with no Jira writes
```

Only after the user picks "Yes, proceed" may the command call any `jira_create_issue` / `jira_add_comment` / `jira_update_issue`. This guard applies even with `--dry-run` so the dry-run summary reflects the user's confirmed choice.

### 5. Iterate issues

For each `issue` in `report.issues`:

- Skip if `issue.synced?.jiraKey` already exists (idempotent re-run).
- Build the Jira description as **Markdown** — see `qa-sync-jira` skill for the layout. **Never pass ADF JSON, raw wiki markup, or HTML**: the MCP server runs a Markdown→wiki adapter on every body and re-escaping breaks `!file!`, `||header||`, and any `|` inside Markdown table cells. The skill template uses a bold-key list (no `|`) and the wiki image macro `!filename|thumbnail!` to dodge those failure modes.
- Map `issue.severity` → Jira priority via `profile.jira.severityToPriority` if present, else use these defaults:
  - `critical` → Highest
  - `major` → High
  - `minor` → Medium
  - `trivial` → Low
- Apply `profile.jira.defaultLabels` plus `["qa-annotator"]`.
- Mode-specific:
  - `subtasks` → `mcp-atlassian.jira_create_issue` with `issue_type: "Subtask"`, `additional_fields.parent: "<key>"`.
  - `tasks` → same call without parent, `issue_type: "Task"`.
  - `append-comment` (alias `append`) → batch all issues into one Markdown comment, single `mcp-atlassian.jira_add_comment` call on parent. Skip the per-issue create loop.
  - `append-description` → fetch parent's current description with `jira_get_issue` (returned as Markdown by the MCP server), then call `jira_update_issue` with the original description **preserved on top** + a `---` horizontal rule + the QA report block appended below. The QA block opens with a level-2 Markdown heading: `## QA session — <profile.name> · <report.scope.date>`. If parent has no description, write the QA block as the new description.
- **After every successful create / append**, attach the relevant screenshot PNGs to the same Jira issue (or to the parent in append modes). The skill calls `jira_update_issue` with the `attachments` parameter set to a JSON array of absolute file paths under `docs/qa/reports/<date>/screenshots/`. If a referenced PNG is missing on disk, skip that file (it stays as plain-text in the description) and record it under `attachWarnings`. If the attach call itself fails, leave the ticket in place and record it under `attachFailed` for the summary.

If `--dry-run`, print the planned action for each issue (including the list of PNGs that would be attached) and stop.

### 6. Update report with sync results

After each successful Jira create, mutate the in-memory report so `issue.synced = { jiraKey, jiraUrl, syncedAt: <ISO timestamp> }`. After the loop, Write the updated JSON back to the same path with 2-space indent.

### 7. Print summary

```
Reading: docs/qa/reports/2026-05-06/qa-report.json
Profile: home-omh
Mode:    subtasks
Parent:  ELS-1234 — "Implement Home Page V2-EN"

Creating Jira sub-tasks...
[ 1/15] ISS-001 H2 size mismatch          → ELS-2001  (2 screenshots attached)
[ 2/15] ISS-002 Card shadow too light     → ELS-2002  (1 screenshot attached)
...
[15/15] ISS-015 ...                       → ELS-2015  (attach failed — see below)

✓ 15 created · 0 skipped · 0 failed
✓ 14 with screenshots attached · 1 attach failed · 0 missing on disk
✓ Updated docs/qa/reports/2026-05-06/qa-report.json with synced fields
✓ View: https://<workspace>.atlassian.net/browse/ELS-1234

Attach failures (re-upload manually):
  ELS-2015 ← ISS-015-auto-99412.png
```

For failures, print the issue id, the Jira error message, and continue with the next issue. At the end, list creation failures and attach failures separately. Attach failures are always recoverable — the issue exists and the description names every PNG so the user knows what to drag in.

## Idempotency

This command is safe to re-run. Issues already marked `synced` are skipped silently. The user can delete a `synced` block to force re-creation.
