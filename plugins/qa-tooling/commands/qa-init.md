---
name: qa:init
description: Bootstrap QA tooling in the current project — auto-detect stack and generate qa-profile.json for the QA Annotator extension.
argument-hint: "[--target <name>] [--force]"
---

# /qa:init — Bootstrap QA Tooling

You are bootstrapping QA tooling for the project at the current working directory. Your job is to **auto-detect as much as possible**, ask the user only when a value cannot be inferred, and produce a valid `qa-profile.json` plus a short README.

## Inputs

Arguments (optional):
- `--target <name>` — Profile name override (default: derived from repo name).
- `--workspace <path>` — In a monorepo, the relative path of the app to profile (e.g. `apps/web`). Skips the workspace-choice prompt.
- `--force` — Overwrite existing `docs/qa/qa-profile.json` without asking.

If `docs/qa/qa-profile.json` already exists and `--force` was NOT passed, **stop and call `AskUserQuestion`** with options `Overwrite`, `Merge (keep existing jira/figma values)`, `Abort`. Include the existing profile id/name in the question text so the user can decide. Never use an inline `? ...` prompt.

## Steps

### 1. Detect the stack

Run the **`qa-detect-stack`** skill, passing `workspaceHint = <--workspace value or null>`.

It reads `package.json`, locale files, components, git config, and `.claude/homepage-plugin.json` if present, and returns a structured object.

**Monorepo handling:** if the result has `needsWorkspaceChoice: true`, call `AskUserQuestion` with `header: "Workspace"` and one option per `candidateWorkspaces[].path` (label = `path` + framework, e.g. `apps/web (astro)`). After the user picks, **re-run** `qa-detect-stack` with `workspaceHint = <chosen path>` to get the full output. Skip this prompt if `--workspace` was passed.

If detection finds no `package.json`, abort with a clear message — this command requires a JS/TS project.

The profile and all output paths are written **inside `workspaceRoot`**, not `projectRoot`. So in a monorepo where the user picks `apps/web`, files land at `apps/web/docs/qa/qa-profile.json`.

### 2. Resolve missing values with the user

> **Interaction convention:** ALWAYS use the `AskUserQuestion` tool to gather user input. Never write inline `? ...` prompts and wait for a free-text reply. Skip a question entirely if its value is already known from detection, profile, or context.

After detection, the only values that may still be missing are:

- **Jira project key** — first try to auto-infer from the current branch (`ELS-1234-foo` → `ELS`) or from recent commit messages.
- **Default Jira parent ticket** — never auto-detected.
- **Figma file key** — only missing if neither `.claude/homepage-plugin.json#figmaFileKey` nor `figma.config.json` provided one.

Build a **single** `AskUserQuestion` call containing **only** the questions whose answers are still unknown (1–3 questions). If every value is already detected, skip this step entirely.

After this prompt, run a second optional prompt for **per-section Figma nodeIds** if and only if BOTH:
- `stack.figmaPages.length === 0` AND `stack.figmaSections.length === 0` (no nodeIds mined from any source — common for legacy / live React apps without `docs/design-system/`).
- `stack.figmaFileKey` is set (no point asking for nodeIds when the user doesn't have a Figma file linked).

The prompt:

```
header: "Figma nodes"
question: "No Figma nodeIds found in the codebase. Add some now? (Optional — extension still works without them.)"
options:
- "Skip — add later" (Recommended, default)
- "Add file-level only — link the file but no per-section nodes"
- "Add per-page nodeIds — I'll prompt for each detected page"
```

If user picks "Add per-page nodeIds":
- For each entry in `stack.routes` (limit 5 to avoid prompt fatigue), do a follow-up `AskUserQuestion` asking for that page's primary Figma nodeId. Provide options like `Skip this page` plus an `Other` for free-form `XXXX:YYYY` entry. Accept `XXXX-YYYY` (URL form) and normalize to `XXXX:YYYY` (API form). Build `stack.figmaPages` entries from the answers.

Section-level prompts are NOT done here — too many to ask interactively. Document that QA can edit `qa-profile.json#sections[].figma.nodeId` manually, or paste a Figma link per-issue in the extension.

Suggested option sets:

- **Jira project key**: 2–3 detected/likely candidates (top guess from branch + top from commit log) plus an "Other" implicit fallback. If detection produced a single confident guess, still confirm via AskUserQuestion with that as the recommended option.
- **Jira parent ticket**: options should include `Skip — set later` (recommended when no parent is obvious), plus any keys that appear in recent commits or branch name. Allow the user to type a custom key via "Other".
- **Figma file key**: options include `Skip — no Figma diff` (recommended) and any key found in nearby config files.

Each question must use `header` ≤ 12 chars (e.g. `Jira proj`, `Parent`, `Figma key`).

### 3. Generate the profile

Run the **`qa-generate-profile`** skill, passing the detect output + user answers. It returns a profile JSON object that conforms to `qa-profile-v1`.

### 4. Write outputs

Create (using Write):

1. `docs/qa/qa-profile.json` — the generated profile, pretty-printed with 2-space indent.
2. `docs/qa/README.md` — copy from `${PLUGIN_ROOT}/templates/qa-readme.template.md`, substituting `{{profileName}}`, `{{jiraProject}}`, `{{figmaFileKey}}`, `{{frameworkType}}`. If a value is missing, leave the placeholder as `_(not set)_`.
3. `docs/qa/reports/.gitkeep` — empty file so the folder is committed.

If `.gitignore` exists at repo root, ensure the QA workspace is trackable:

1. **Check for a blanket `docs/` rule** (a line that exactly matches `docs/` or `/docs/`). If present, **rewrite** it to a glob + negation form, otherwise the QA outputs we just wrote will stay untracked. Per `gitignore(5)`, once a parent directory is excluded, negations inside cannot re-include — so we must change the parent rule itself.

   Replace:
   ```
   docs/
   ```
   with:
   ```
   docs/*
   !docs/qa
   !docs/qa/**
   ```

2. **Verify** with `git check-ignore -v docs/qa/qa-profile.json` — the rule reported should be the negation (`!docs/qa/**`), not the original `docs/`. If the original still wins, the rewrite did not take — surface this as a warning to the user.

3. **Append the report-zip exclude** if not already present (the QA Annotator extension exports temporary ZIPs that should not be committed):
   ```
   # QA Annotator — temporary report archives
   docs/qa/reports/*.zip
   ```

If `.gitignore` does not have a `docs/` blanket rule, just append the report-zip line.

Do **not** auto-commit — leave the changes staged-by-edit only.

### 5. Print summary

Output a concise summary to the user:

```
✓ Detected:
  - Framework: <type> <version>
  - Locales:   <comma list> (default: <default>)
  - Sections:  <count> found via data-section
  - Figma:     <fileKey or "(none — optional)">
  - Repo:      <github org/repo> (branch: <branch>)
  - Jira:      <projectKey> (parent: <parent or "—">)

✓ Wrote:
  - docs/qa/qa-profile.json
  - docs/qa/README.md
  - docs/qa/reports/.gitkeep

Next steps:
  1. Review docs/qa/qa-profile.json
  2. Open the QA Annotator Chrome extension → Settings → Import → docs/qa/qa-profile.json
  3. Run /qa:doctor to verify setup
  4. After QA exports a report ZIP, run /qa:sync to push issues into Jira
```

Keep the summary tight — no extra commentary unless something failed.

## Failure modes

- **No `package.json`** → abort, tell user this command needs a JS/TS project root.
- **Profile already exists, no `--force`** → ask before overwriting.
- **Detection succeeds but produces empty `sections` and empty `locales`** → still write the profile (a project may not use those conventions yet) but warn that some QA features will be limited.
