---
name: qa:sync
description: Read a QA report (JSON or ZIP) and create/update Jira issues via the Atlassian MCP server.
argument-hint: "[report-path] [--mode subtasks|tasks|append-comment|append-description] [--parent KEY-NN] [--dry-run]"
---

# /qa:sync — QA Report → Jira

Convert a QA Annotator report into Jira issues. The command **never auto-decides** between creating subtasks and editing an existing ticket — it always confirms via `AskUserQuestion` when the choice is ambiguous.

> **Interaction convention:** ALWAYS use the `AskUserQuestion` tool to gather user input. Never write inline `? ...` prompts and wait for a free-text reply. This command emits up to seven structured prompts before any Jira write:
>
> 1. **mode** — when `--mode` is missing
> 2. **parent** — when no parent is resolved
> 3. **summary format** — defaults to `[VP] title — selector`; only asked if `--summary-format` is missing
> 4. **body format** — defaults to bold-key list; only asked if `--body-format` is missing AND the user has hinted at wanting a table (e.g. via the AskUserQuestion "Style options" path or asked at run-time). Otherwise silently use `list`.
> 5. **translate** — defaults to `en` (translate prose to English); only asked if `--translate` is missing AND the report contains non-English title/note (cheap heuristic: any non-ASCII letter in `title || note` across issues). If everything is already English, silently use `en` (it's a pass-through).
> 6. **audience** — defaults to `tech` (the deterministic Dev+QA template). **Only asked if** the user message contains an explicit audience hint (e.g. "leader review", "BA review", "stakeholder", "for PM", "Three Amigos", "executive summary", "JSON payload", "machine readable") OR the `--audience` flag is set to a non-tech value. Otherwise silently use `tech` and do NOT prompt — keeping the default flow zero-friction for the common case.
> 7. **parent confirmation** — required even when parent came from a flag.
>
> Skip a prompt only when its value is already known from flags / report hints / profile defaults / the language or audience heuristic above.

## Inputs

Positional argument (optional): path to a `qa-report.json` or `.zip`. If omitted, find the most recent report under `docs/qa/reports/<date>/qa-report.json` (sort folders by name, descending — they're date-stamped).

Flags:
- `--mode subtasks` — each issue becomes a Jira **Sub-task** under `--parent`.
- `--mode tasks` — each issue becomes a top-level Jira Task (no parent required).
- `--mode append-comment` — append all issues as a single ADF **comment** on `--parent` (no new tickets, parent description untouched).
- `--mode append-description` — append the QA report block to the **description** of `--parent` via `jira_update_issue` (mutates the parent ticket itself; original description is preserved above the appended block).
- `--mode append` — alias for `--mode append-comment` (kept for back-compat).
- `--parent KEY-NN` — override `report.syncHints.suggestedParent` and `profile.jira.defaultParent`.
- `--summary-format default|qa-id|title-only` — pick the Jira summary template without prompting. Default is `default` (= `[VP] title — selector`).
- `--body-format list|table` — pick the description metadata layout. Default is `list` (bold-key list, safest under all MCP adapters). `table` opts into a 2-column Field/Value Markdown table for short metadata; Selector / Expected / Actual / Figma / Screenshots stay outside the table either way.
- `--translate en|off` — translate user-authored prose (title, note, expected free-text) to English. Default is `en`. Use `off` to keep the source language verbatim. Field labels are always English regardless. Computed values (px/rgb/url/selector) are never translated.
- `--audience tech|leader|ba|qa|ai|all` — pick the comment template format. Default is `tech` (Dev+QA deterministic template, the silent default). `leader` = severity-first metadata + decision aid. `ba` = Gherkin Given-When-Then + business impact. `qa` = test execution metadata + verification checklist. `ai` = JSON `qa-finding-v1` payload for downstream agents. `all` = post one comment per persona (5 comments total). **This is a power-user flag** — most users should leave it unset and let the silent `tech` default handle 95% of cases. See Step 3f for when the prompt surfaces.
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
  - <top guess from branch name regex (e.g. `<KEY>-<NNNN>-foo` → `<KEY>-<NNNN>`)>
  - <top guess from recent commit subjects>
  // implicit "Other" for free entry
```

Never use an inline `? ...` prompt.

**3c. Confirm summary format (REQUIRED when `--summary-format` is absent).** The skill template enforces deterministic body content (English-only labels, no narrative reinterpretation), but the **issue summary line** is the most user-visible field and the one that varied across machines in past runs (e.g. `[QA] ISS-003 — Heading wraps...` vs `[1536×695 · 2xl · @1.25x] Trader check — div.Layout...`). Always call `AskUserQuestion`:

```
header: "Summary format"
question: "How should each Jira issue's summary line be built?"
options:
  - "[viewport] title — selector  (Recommended — default deterministic form)"   // → default
  - "[QA] {issueId} — title"                                                    // → qa-id
  - "title only (shortest, may collide for similar issues)"                     // → title-only
```

If `--summary-format` is set, use it without prompting. The chosen value is passed to the skill as `config.summaryFormat`. The body template (description) is **never** customized through this prompt — it is fixed by the skill spec.

**3d. Body format (silent default).** If `--body-format` is provided, use it. Otherwise default to `list` and do NOT prompt. Only call `AskUserQuestion` if the user explicitly asked for "table style" / "more compact body" / "có bảng table" in their request, OR if a previous run for this report used `table` (no such state today, so effectively: only when explicitly asked):

```
header: "Body format"
question: "How should each issue's metadata block be laid out?"
options:
  - "Bold-key list — `**Severity:** minor` per line  (Recommended — safest)"        // → list
  - "2-column Field/Value table — compact for short metadata"                       // → table
```

`table` is cosmetic only; Selector/Expected/Actual/Figma/Screenshots layouts are unchanged. The chosen value is passed to the skill as `config.bodyFormat`.

**3e. Translation (silent default).** If `--translate` is provided, use it. Otherwise:
- Compute a quick heuristic: any non-ASCII letter (`/[^\x00-\x7F]/`) inside `report.issues.map(i => (i.title||"") + " " + (i.note||""))`. If false → silently set `config.translate = "en"` (pass-through, no-op) and do NOT prompt. If true → prompt:

```
header: "Translation"
question: "Some issue titles/notes are not in English. Translate to English when posting to Jira?"
options:
  - "Yes — translate title/note/note-like fields to English  (Recommended)"   // → en
  - "No — keep the source language verbatim"                                  // → off
```

Field labels (`Severity`, `Type`, …) are always English regardless. Selectors / computed CSS / URLs / IDs are never translated. The chosen value is passed to the skill as `config.translate`.

**3f. Audience format (silent default — same pattern as 3d).** If `--audience` is provided, use it. Otherwise:

- Run `detectAudienceHint(userMessage)` — see the helper in the `qa-sync-jira` skill spec. The detector matches case-insensitive keywords in the user's most recent message:
  - `leader|stakeholder|executive|PM review|product manager|triage view` → `leader`
  - `BA|business analyst|acceptance criteria|gherkin|three amigos|user story link` → `ba`
  - `test execution|verification checklist|regression|QA review|coverage scope|re-test` → `qa`
  - `AI agent|machine readable|JSON payload|code-fix bot|structured data|downstream agent` → `ai`
  - "all audiences", "every persona", "five views" → `all`
- If the detector returns `null` → silently set `config.audience = "tech"` and do NOT prompt. **This is the 95% case.**
- If the detector returns a non-null hint → call `AskUserQuestion` to confirm (do not assume — the user may have referenced the keyword in passing):

```
header: "Audience"
question: "Detected audience hint: {detected}. Use a non-default comment format?"
options:
  - "{detected} format (Recommended based on your message)"           // → detected
  - "Tech (Dev + QA) — default deterministic template"                // → tech (the silent default)
  - "All audiences — post 5 separate comments, one per persona"       // → all
  - "Cancel sync"                                                     // → abort
```

The chosen value is passed to the skill as `config.audience`. The skill spec defines per-audience helpers (`renderTechBody`, `renderLeaderBody`, `renderBABody`, `renderQABody`, `renderAIBody`); see `qa-sync-jira/SKILL.md` for the per-audience templates.

> **Why "soft prompt" instead of always asking?** The `tech` template covers Dev + QA workflow, which is 95% of QA→Dev sync traffic. Forcing every user to pick an audience when they don't have a strong preference adds friction and decision fatigue. The detection heuristic surfaces the prompt only when the user has already hinted at a non-default need — see memory `feedback_ask_user_question.md` ("if a value can be inferred from detection, the profile, or git context, do not ask at all"). Power users with explicit audience needs use the `--audience` CLI flag.

### 4. Verify and confirm parent (skip if mode is `tasks`)

**4a. Verify exists.** Call `mcp-atlassian.jira_get_issue` with the resolved parent key. If it 404s → abort with `fix: parent <KEY> not found in Jira`.

**4b. Confirm with the user (REQUIRED — do NOT skip even when parent came from a flag).** Print the parent's summary, status, and assignee, then call `AskUserQuestion`. The question line lists every resolved config value so the user can spot the wrong default before any Jira write:

```
header: "Confirm parent"
question: "Parent: {KEY} — \"{summary}\" (status: {status}, assignee: {assignee or 'unassigned'}). Mode: {mode} · Summary: {summaryFormat} · Body: {bodyFormat} · Translate: {translate} · Audience: {audience}. Proceed?"
options:
  - "Yes, proceed (Recommended)"
  - "Pick a different parent"     // → restart Step 3b prompt
  - "Change mode"                 // → restart Step 3a prompt
  - "Change summary format"       // → restart Step 3c prompt
  - "Change body format"          // → restart Step 3d prompt
  - "Change translation"          // → restart Step 3e prompt
  - "Cancel"                      // → abort with no Jira writes
```

> The `Audience: {audience}` token in the question line is **always shown** so the user can spot it before any Jira write — even when audience was set by the silent default. If the user wants to change it from the confirmation step, they pick "Cancel" and re-run with `--audience <value>` flag, OR re-trigger the prompt by adding an audience keyword to their next message. Adding "Change audience" as a top-level option here would bloat the option list past 7; use the flag for one-time overrides.

Only after the user picks "Yes, proceed" may the command call any `jira_create_issue` / `jira_add_comment` / `jira_update_issue`. This guard applies even with `--dry-run` so the dry-run summary reflects the user's confirmed choice.

### 5. Iterate issues

For each `issue` in `report.issues`:

- Skip if `issue.synced?.jiraKey` already exists (idempotent re-run).
- Build the Jira description as **Markdown** by following the `qa-sync-jira` skill template **verbatim** — fill placeholders, do not paraphrase, do not invent extra sections, do not translate field labels (English-only). **Never pass ADF JSON, raw wiki markup, or HTML**: the MCP server runs a Markdown→wiki adapter on every body and re-escaping breaks `!file!`, `||header||`, and any `|` inside Markdown table cells. The skill template uses a bold-key list (when `bodyFormat === "list"`) or a 2-col Field/Value table (when `bodyFormat === "table"`); both layouts use the wiki image macro `!filename|thumbnail!` for screenshots. **Figma:** when `issue.expected.figmaLink` is set, emit it as `[breadcrumb](url)` (Markdown link, not a bare URL, not inside backticks) so it renders as a clickable wiki link with `:` URL-encoded.
- **Per-element expected overrides:** when `issue.expectedPerElement` is an array with any non-null entry, the skill emits one extra `**Expected — (N) overrides**` block per non-null index, BELOW the shared `**Expected**` block. The shared block is always rendered too — the two surfaces co-exist. Do not merge them. See `renderExpectedOverrides` in the skill spec.
- **Translation (when `translate === "en"`):** translate `displayTitle` (= `issue.title || issue.note || issue.id`) and `issue.note` to English BEFORE building summary or description. Cache the translated string and reuse it in both places (summary + `### heading`) so they always match. Computed values, selectors, URLs, IDs are NEVER translated.
- Build the Jira summary using `summaryFormat` resolved in Step 3c (passed to the skill as `config.summaryFormat`). Pass also `config.bodyFormat` and `config.translate` from Steps 3d / 3e.
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
Reading: docs/qa/reports/<date>/qa-report.json
Profile: <profile-id>
Mode:    subtasks
Parent:  <KEY>-<NNNN> — "<parent summary>"

Creating Jira sub-tasks...
[ 1/15] ISS-001 H2 size mismatch          → <KEY>-NNNN  (2 screenshots attached)
[ 2/15] ISS-002 Card shadow too light     → <KEY>-NNNN  (1 screenshot attached)
...
[15/15] ISS-015 ...                       → <KEY>-NNNN  (attach failed — see below)

✓ 15 created · 0 skipped · 0 failed
✓ 14 with screenshots attached · 1 attach failed · 0 missing on disk
✓ Updated docs/qa/reports/<date>/qa-report.json with synced fields
✓ View: https://<workspace>.atlassian.net/browse/<KEY>-<NNNN>

Attach failures (re-upload manually):
  <KEY>-NNNN ← ISS-NNN-auto-<hash>.png
```

For failures, print the issue id, the Jira error message, and continue with the next issue. At the end, list creation failures and attach failures separately. Attach failures are always recoverable — the issue exists and the description names every PNG so the user knows what to drag in.

## Idempotency

This command is safe to re-run. Issues already marked `synced` are skipped silently. The user can delete a `synced` block to force re-creation.
