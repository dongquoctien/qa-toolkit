---
name: qa:doctor
description: Health-check QA tooling setup in the current project — profile validity, source conventions, MCP availability.
argument-hint: ""
---

# /qa:doctor — Health Check

Run a checklist of checks against the current project and report each as `✓ pass`, `⚠ warn`, or `✗ fail`. Be specific — every warn/fail must include a one-line "fix:" suggestion.

## Steps

For each item below, perform the check and add a line to the report. Use parallel tool calls where the checks are independent.

### A. Profile file

1. **Profile exists** — does `docs/qa/qa-profile.json` exist? (Read; missing → fail with `fix: run /qa:init`.)
2. **Profile parses** — is it valid JSON? (fail → `fix: file is not valid JSON, recreate with /qa:init --force`.)
3. **Profile has minimum fields** — `id`, `name`, `urlPatterns` (non-empty array), `framework.type`. (warn per missing field, `fix:` regenerate.)
4. **Schema marker** — `$schema === "qa-profile-v1"`. (warn if mismatch.)

### B. Source conventions

5. **Framework match** — read `package.json`. Does the framework declared in the profile (`framework.type`) match what's actually in dependencies? (warn on mismatch, `fix: regenerate profile`.)
6. **`data-section` attributes present** — Grep `data-section=` across `src/**/*.astro`, `src/**/*.tsx`, `src/**/*.jsx`, `src/**/*.vue`. If 0 matches, warn `fix: add data-section="<name>" to top-level section elements so the QA extension can identify them`.
7. **`data-i18n-key` attributes (warn-only)** — Grep `data-i18n-key=`. If 0 matches AND the profile has `localeStrategy.supportedLocales.length > 1`, warn `fix: optional — adding data-i18n-key on translated text enables i18n auto-detect in the extension`.
8. **Astro-only: source maps** — if framework is Astro, read `astro.config.mjs` and check whether `vite.build.sourcemap` is truthy. If false/absent, warn `fix: enable vite.build.sourcemap so the extension can resolve file:line from rendered DOM`.

### C. Figma tree (only if profile.figma.fileKey is set)

Skip this entire block when `profile.figma?.fileKey` is null/missing.

9. **Figma tree exists** — does `docs/qa/qa-figma-tree.json` exist? (warn → `fix: run /qa:figma-sync to enable per-element Figma deeplinks`.)
10. **Figma tree fresh** — Read the tree if present. If `crawledAt` is older than 30 days, warn `fix: re-run /qa:figma-sync — the Figma file may have changed since last crawl`.
11. **Figma tree matches profile** — verify `tree.fileKey === profile.figma.fileKey`. Mismatch → fail `fix: profile and tree disagree on which Figma file to use`.

### D. Reports + git hygiene

12. **Reports dir** — `docs/qa/reports/` exists? (warn → `fix: mkdir docs/qa/reports`.)
13. **`.gitignore` excludes report zips** — Read `.gitignore`. Does it ignore `docs/qa/reports/*.zip` (or a superset)? (warn → `fix: append the line, /qa:init can do this for you`.)

### E. MCP availability

For each MCP, do a low-cost probe and report whether it's reachable. If not connected, mark warn with the install hint — these are recommended, not required.

14. **Atlassian MCP** — try a no-op call such as `mcp-atlassian.jira_get_all_projects` with a tiny limit, OR check whether the tool name appears in the available tool list. (warn if absent → `fix: install/connect the mcp-atlassian server; needed for /qa:sync`.)
15. **Figma MCP** — check whether `mcp__figma__get_metadata` or `mcp__claude_ai_Figma__get_metadata` is available. (warn → `fix: connect Figma MCP; needed for /qa:figma-sync`.)
16. **chrome-devtools MCP** — check whether `mcp__chrome-devtools__navigate_page` is available. (warn → `fix: connect chrome-devtools MCP; needed for /qa:screenshot — Phase 2`.)

For the MCP checks, **do not** actually issue a remote call if you can detect availability from the tool list alone — prefer that. If you do call, use the smallest possible request.

## Output format

Print a single grouped checklist:

```
QA Tooling — Doctor Report
──────────────────────────
Profile
  ✓ docs/qa/qa-profile.json exists
  ✓ Parses as JSON
  ✓ Required fields present
  ⚠ $schema is "qa-profile-v0.9" (expected "qa-profile-v1")
    fix: regenerate with /qa:init --force

Source conventions
  ✓ Framework matches package.json (astro)
  ✓ 16 data-section attributes found
  ⚠ No data-i18n-key found (5 locales declared)
    fix: optional — adding data-i18n-key on translated text enables i18n auto-detect

Figma tree
  ✓ docs/qa/qa-figma-tree.json exists (2,847 nodes, crawled 3 days ago)
  ✓ Tree fileKey matches profile

Reports
  ✓ docs/qa/reports/ exists
  ✗ .gitignore does not exclude docs/qa/reports/*.zip
    fix: append "docs/qa/reports/*.zip" to .gitignore

MCP servers
  ✓ mcp-atlassian connected
  ⚠ Figma MCP not connected
    fix: connect Figma MCP for /qa:figma-sync
  ✓ chrome-devtools MCP connected

Summary: 9 pass · 3 warn · 1 fail
```

End with one line: `Summary: <N> pass · <N> warn · <N> fail`. If any `fail`, the overall command exits non-zero in spirit (just say "✗ Setup has blocking issues — see above"). Otherwise, "✓ Setup looks good" or "⚠ Setup works but has warnings".
