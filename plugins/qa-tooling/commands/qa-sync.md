---
name: qa:sync
description: Read a QA report (JSON or ZIP) and create/update Jira issues via the Atlassian MCP server.
argument-hint: "[report-path] [--mode subtasks|tasks|append] [--parent KEY-NN] [--dry-run]"
---

# /qa:sync — QA Report → Jira

Convert a QA Annotator report into Jira issues. Default behaviour: create one **sub-task per issue** under the profile's `defaultParent`.

## Inputs

Positional argument (optional): path to a `qa-report.json` or `.zip`. If omitted, find the most recent report under `docs/qa/reports/<date>/qa-report.json` (sort folders by name, descending — they're date-stamped).

Flags:
- `--mode subtasks` *(default)* — each issue becomes a Jira **Sub-task** under `--parent`.
- `--mode tasks` — each issue becomes a top-level Jira Task (no parent required).
- `--mode append` — append all issues as a single comment on `--parent` (no new tickets).
- `--parent KEY-NN` — override `report.syncHints.suggestedParent` and `profile.jira.defaultParent`.
- `--dry-run` — print what would be created, do not call MCP create.

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

Precedence (highest first):
1. CLI flags (`--mode`, `--parent`)
2. `report.syncHints` (`suggestedJiraProject`, `suggestedParent`, `defaultMode`)
3. `profile.jira` (`projectKey`, `defaultParent`, `defaultMode`)

If, after merging, `mode === "subtasks"` or `"append"` and there is no parent key → call `AskUserQuestion` with `header: "Parent"` and a single question whose options include the most likely candidates (e.g. tickets referenced in recent commits or branch name) plus an implicit "Other" for free entry. Never use an inline `? ...` prompt.

### 4. Verify parent (skip if mode is `tasks`)

Call `mcp-atlassian.jira_get_issue` with the resolved parent key. If it 404s → abort with `fix: parent <KEY> not found in Jira`. Print the parent's summary so the user can confirm visually.

### 5. Iterate issues

For each `issue` in `report.issues`:

- Skip if `issue.synced?.jiraKey` already exists (idempotent re-run).
- Build the Jira description as ADF (Atlassian Document Format) — see `qa-sync-jira` skill for the table layout.
- Map `issue.severity` → Jira priority via `profile.jira.severityToPriority` if present, else use these defaults:
  - `critical` → Highest
  - `major` → High
  - `minor` → Medium
  - `trivial` → Low
- Apply `profile.jira.defaultLabels` plus `["qa-annotator"]`.
- Mode-specific:
  - `subtasks` → `mcp-atlassian.jira_create_issue` with `issuetype: "Sub-task"`, `parent: <key>`.
  - `tasks` → same call without parent, `issuetype: "Task"`.
  - `append` → batch all issues into one ADF comment, single `mcp-atlassian.jira_add_comment` call on parent. Skip the per-issue loop.

If `--dry-run`, print the planned action for each issue and stop.

### 6. Update report with sync results

After each successful Jira create, mutate the in-memory report so `issue.synced = { jiraKey, jiraUrl, syncedAt: <ISO timestamp> }`. After the loop, Write the updated JSON back to the same path with 2-space indent.

### 7. Print summary

```
Reading: docs/qa/reports/2026-05-06/qa-report.json
Profile: home-omh
Mode:    subtasks
Parent:  ELS-1234 — "Implement Home Page V2-EN"

Creating Jira sub-tasks...
[ 1/15] ISS-001 H2 size mismatch          → ELS-2001
[ 2/15] ISS-002 Card shadow too light     → ELS-2002
...
[15/15] ISS-015 ...                       → ELS-2015

✓ 15 created · 0 skipped · 0 failed
✓ Updated docs/qa/reports/2026-05-06/qa-report.json with synced fields
✓ View: https://<workspace>.atlassian.net/browse/ELS-1234
```

For failures, print the issue id, the Jira error message, and continue with the next issue. At the end, list failures separately.

## Idempotency

This command is safe to re-run. Issues already marked `synced` are skipped silently. The user can delete a `synced` block to force re-creation.
