---
name: qa-detect-stack
description: Detect the framework, locales, sections, Figma key, and git context of a JS/TS project for QA tooling profile generation.
---

# Skill — qa-detect-stack

Inspect the current project root and produce a structured object describing its stack. Used by `/qa:init` and `/qa:doctor`.

## Inputs

```jsonc
{
  "projectRoot":     "<absolute path>",      // usually CWD
  "workspaceHint":   "<relative path or null>" // forwarded from /qa:init --workspace
}
```

## Output shape

Return a single JSON object:

```jsonc
{
  "projectRoot": "<absolute path>",
  "workspaceRoot": "<absolute path of the chosen app — equals projectRoot in single-package repos>",
  "isMonorepo": false,
  "candidateWorkspaces": [
    { "path": "apps/web", "name": "@org/web", "framework": "astro" }
  ],
  "framework": { "type": "astro|nextjs|vue|react|generic", "version": "<semver or 'unknown'>" },
  "locales": ["en", "ko", "vi", "ja", "zh"],
  "defaultLocale": "en",
  "localeStrategy": {
    "type": "url-prefix|query-param|cookie|none",
    "prefixDefaultLocale": true
    // false = default locale is served at "/" with no prefix; other locales at "/<locale>/..."
    // true  = every locale gets its own prefix, including the default
  },
  "sections": [{ "name": "HeroSection", "file": "src/components/Hero.astro", "line": 12 }],
  "routes": [{ "name": "about-us", "path": "/about-us", "file": "src/pages/about-us.astro" }],
  "i18nFiles": ["src/i18n/en.json", "src/i18n/ko.json"],
  "figmaFileKey": "<key or null>",
  "figmaFileSlug": "<slug or null>",
  "figmaPages": [
    // Per-page nodeIds with viewport variants. Empty array if no source provides them.
    {
      "pageName": "home",
      "nodeId": "3880:2879",                   // primary (usually desktop)
      "viewportVariants": { "desktop": "3880:2879", "tablet": "...", "mobile": "..." }
    }
  ],
  "figmaSections": [
    // Per-section nodeIds. `pageName` ties back to figmaPages; `sectionName`
    // matches the data-section attribute value found in the source.
    {
      "pageName": "home",
      "sectionName": "HeroSection",
      "nodeId": "3880:2925",
      "viewportVariants": { "desktop": "3880:2925", "tablet": "...", "mobile": "..." },
      "source": "component-map" | "data-attr" | "comment"
    }
  ],
  "git": {
    "remote": "github.com/<org>/<repo>",
    "branch": "<branch>",
    "reporterEmail": "<git config user.email>",
    "githubRawBase": "https://github.com/<org>/<repo>/raw/<branch>/docs/qa/reports/{date}/screenshots/"
  },
  "jiraProjectKeyGuess": "ELS"
}
```

If a field can't be determined, set it to `null` (or `[]` for arrays). Never fabricate values.

## Detection steps

Run these in parallel where possible.

### 0. Workspace resolution (monorepos)

Before reading `package.json`, decide which directory is the **app to profile**. This handles monorepos cleanly.

1. Read `<projectRoot>/package.json`. If it has a `workspaces` field (array OR object with `packages`), this is a monorepo root.
2. Also detect `pnpm-workspace.yaml` and `lerna.json#packages` for non-npm workspace tools — same handling.
3. If a monorepo:
   - Expand each workspace glob (e.g. `apps/*`, `packages/*`) and read every nested `package.json`.
   - Build `candidateWorkspaces`: `[{ path, name, framework }]` where framework is detected per the rules in step 1 below.
   - Filter to candidates whose framework is in `["astro","nextjs","nuxt","vue","react"]` — QA tooling targets web apps. If only one candidate remains, auto-pick it.
   - Set `workspaceRoot` to the picked candidate's absolute path. Set `isMonorepo: true`.
4. If `workspaceHint` (input) is non-null, resolve it relative to `projectRoot` and use that as `workspaceRoot` directly — overrides auto-detection. Validate the path has a `package.json`.
5. If multiple candidates and no hint, return early with `{ needsWorkspaceChoice: true, candidateWorkspaces, ... }` — the caller (`/qa:init`) will prompt the user.
6. If single-package repo, `workspaceRoot === projectRoot`, `isMonorepo: false`, `candidateWorkspaces: []`.

**All subsequent steps read from `workspaceRoot`, NOT `projectRoot`.** Update Glob/Read paths accordingly.

### 1. `package.json`

Read `<workspaceRoot>/package.json`. Extract `dependencies` and `devDependencies` merged.

- If `astro` → `framework = { type: "astro", version: <coerced semver> }`
- Else if `next` → `nextjs`
- Else if `nuxt` → `nuxt`
- Else if `vue` → `vue`
- Else if `react` (and no next) → `react`
- Else → `generic`

Strip leading `^`/`~`/`>=` from version when reporting.

### 2. Locale files

Glob `src/i18n/*.json` (also try `src/locales/*.json`, `src/translations/*.json`, `i18n/*.json` as fallbacks). The basenames (without extension) are the locale codes.

For `defaultLocale`:
- If framework is Astro, Read `astro.config.mjs` and regex `defaultLocale\s*:\s*["']([^"']+)["']`.
- Else if framework is Next, Read `next.config.js`/`next.config.mjs` and regex similarly under `i18n.defaultLocale`.
- Else fall back to `"en"` if `"en"` is in the list, else first.

For `localeStrategy.type`:
- Astro/Next typically use `url-prefix` — use that as default if locales > 1.
- If locales ≤ 1, use `none`.

For `localeStrategy.prefixDefaultLocale` (only meaningful when `type === "url-prefix"`):
- **Astro:** Read `astro.config.mjs`. Look for `i18n.routing.prefixDefaultLocale` (boolean). Astro's default is `false` — if the key is absent OR explicitly `false`, set `prefixDefaultLocale: false`. If `true`, set `true`.
- **Next.js:** In Next, all locales (including default) get a prefix unless `localeDetection: false` is set. Default `prefixDefaultLocale: true` for Next, override to `false` if the user has explicitly disabled prefixes via custom routing.
- **Other / unknown:** default `true` (safer — extension will treat the default locale path as `/<defaultLocale>/...`).
- If `type !== "url-prefix"`, omit `prefixDefaultLocale` from the output.

### 3. Sections

Use Grep (not Bash):

```
pattern: data-section="
glob:    src/**/*.{astro,tsx,jsx,vue,svelte}
output_mode: content
-n: true
```

For each match, parse out the value of `data-section="..."` and record `{ name, file, line }`. Deduplicate by name.

### 3.5. Routes

Enumerate top-level pages so the extension can map URL → page name.

- **Astro:** Glob `src/pages/**/*.{astro,md,mdx}`. Skip `src/pages/api/**`. For each:
  - `src/pages/index.astro` → `{ name: "home", path: "/", file: "..." }`
  - `src/pages/about-us.astro` → `{ name: "about-us", path: "/about-us", file: "..." }`
  - `src/pages/about-us/index.astro` → same as above
  - `src/pages/[locale]/about-us.astro` or `src/pages/[lang]/about-us.astro` → strip the `[locale]` segment
  - Bracketed dynamic segments (`[slug]`) → keep the path with `:slug` placeholder, mark as `dynamic: true`
- **Next.js (Pages Router):** Glob `pages/**/*.{js,jsx,ts,tsx}`, skip `pages/api/**` and `pages/_*.{...}`. Same naming rules.
- **Next.js (App Router):** Glob `app/**/page.{js,jsx,ts,tsx}`. The route path is the directory chain minus group segments `(name)`.
- **Other / unknown:** return `routes: []`.

The caller (`qa-generate-profile`) converts these to `pageDetection` regex rules.

### 4. Figma file key + slug

In order, try:

1. Read `.claude/homepage-plugin.json` → `figmaFileKey` field, AND extract slug from `figmaFileUrl` (regex: `figma\.com/design/[A-Za-z0-9]+/([^/?]+)`).
2. Read `figma.config.json` → `fileKey` and optional `fileSlug`.
3. Read `.figma/config.json` → `fileKey` and optional `fileSlug`.

Return both `figmaFileKey` and `figmaFileSlug` (either may be null independently — slug is optional, links work without it but the canonical form includes it).

### 4.5. Figma nodeIds — per-page and per-section

Three sources, applied in this order. Last-write-wins per `(pageName, sectionName)` key.

**Source A — `docs/design-system/component-map.json`** (richest)

If the file exists at `<workspaceRoot>/docs/design-system/component-map.json`, read it. Expected shape:

```jsonc
{
  "figmaFileKey": "...",
  "pages": {
    "<pageName>": {
      "figmaPageNodeId": "3880:2879",
      "viewportVariants": { "desktop": "...", "tablet": "...", "mobile": "..." },
      "sections": [
        { "sectionName": "Hero", "sectionType": "HeroSection", "sectionNodeId": "3880:2925",
          "mobileNodeId": null, "tabletNodeId": null }
      ]
    }
  }
}
```

Mapping:
- For each `pages[pageName]`:
  - Add a `figmaPages` entry: `{ pageName, nodeId: pages[p].figmaPageNodeId, viewportVariants: pages[p].viewportVariants ?? {} }`.
  - For each `pages[pageName].sections[i]`:
    - Use `sectionType` (matches `data-section` attr) when present, else `sectionName`.
    - `nodeId = section.sectionNodeId`
    - `viewportVariants = { desktop: section.sectionNodeId, tablet: section.tabletNodeId ?? null, mobile: section.mobileNodeId ?? null }` — null entries are kept so consumers can detect "viewport-specific node not designed yet".
    - Add `figmaSections` entry with `source: "component-map"`.

**Source B — inline `data-figma-node-id` attributes** (in source code)

Grep `data-figma-node-id="` across `src/**/*.{astro,tsx,jsx,vue,svelte}`. For each match:
- Find the nearest enclosing element with `data-section="<name>"` (same file, before-or-equal line).
- Try to detect `data-figma-page="<pageName>"` on a parent — optional.
- Append `figmaSections` entry: `{ pageName, sectionName, nodeId, source: "data-attr" }` — only if not already provided by Source A.

**Source C — `// figma: <nodeId>` comments**

Grep `(?://|/\*|\*)\s*figma:\s*([0-9]+[:\-][0-9]+)` across the same source files. Match the comment to the nearest section component (same file, look forward up to 50 lines for a `data-section="..."` attribute or component name matching `<Section>`). Append with `source: "comment"`.

Return `figmaPages: []` and `figmaSections: []` when no source provides anything. **Never call the Figma MCP from this skill** — that's an explicit decision to keep detection fast and offline. The caller (`/qa:init`) decides whether to prompt the user.

Do **not** ask the user here — the caller handles prompting.

### 5. Git context

Run via Bash (PowerShell-safe — these commands work in both):

- `git remote get-url origin` → parse `git@github.com:org/repo.git` or `https://github.com/org/repo.git` → `org/repo`. The `.remote` output is `github.com/org/repo`.
- `git branch --show-current` → `branch`.
- `git config user.email` → `reporterEmail`.

If the project is not a git repo, set `git: null`.

`githubRawBase` is constructed by template substitution as shown in the output shape (with literal `{date}` left in — the report will replace it).

### 6. Jira project key guess

Try, in order:

1. **Branch name** — match `^([A-Z][A-Z0-9]{1,9})-\d+` against current branch.
2. **Recent commits** — `git log --oneline -50`. Find all `[A-Z][A-Z0-9]{1,9}-\d+` matches, count occurrences, return the most common prefix.
3. Otherwise null.

## Notes

- This skill is **read-only**. It never writes files.
- If `package.json` is missing, return `{ error: "no-package-json", projectRoot }` and stop.
- Prefer the dedicated tools (Read, Glob, Grep) over `Bash` for filesystem inspection. Use `Bash` only for git commands.
