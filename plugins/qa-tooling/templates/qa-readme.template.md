# QA — {{profileName}}

This folder is managed by the **qa-tooling** Claude Code plugin.

| | |
|---|---|
| Framework | `{{frameworkType}}` |
| Jira project | `{{jiraProject}}` |
| Figma file | `{{figmaFileKey}}` |

## Files

- `qa-profile.json` — generated profile. Import into the QA Annotator Chrome extension under **Settings → Import**.
- `reports/<date>/qa-report.json` — exported by QA from the extension. One folder per session.
- `reports/<date>/screenshots/*.png` — screenshots attached to issues.

## Daily workflow

```
QA opens extension → selects this profile → tests pages → exports ZIP
QA extracts ZIP into reports/<date>/
Dev runs:  /qa:sync
           → creates one Jira sub-task per issue under the default parent
```

## Commands

| Command | When |
|---|---|
| `/qa:init` | Once per project (already done — produced this folder). |
| `/qa:doctor` | Anytime — verifies profile + MCP servers + source conventions. |
| `/qa:sync` | After every QA session — pushes report into Jira. |

## Updating the profile

Edit `qa-profile.json` directly, or re-run `/qa:init --force` to regenerate from current code.

If you change the profile, re-import it into the extension so QA picks up the new version.
