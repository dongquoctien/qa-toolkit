---
name: qa-generate-profile
description: Compose a qa-profile-v1 JSON object from detected stack info and user-provided Jira/Figma answers.
---

# Skill — qa-generate-profile

Build a profile that conforms to `qa-profile-v1` so the QA Annotator extension can consume it. Used by `/qa:init`.

## Inputs

```jsonc
{
  "stack":   <output of qa-detect-stack>,
  "answers": {
    "jiraProjectKey": "ELS" | null,
    "jiraDefaultParent": "ELS-1234" | null,
    "figmaFileKey": "<key>" | null,
    "profileNameOverride": "<custom name>" | null
  },
  "now": "<ISO timestamp the caller provides>"
}
```

## Output — `qa-profile-v1`

```jsonc
{
  "$schema": "qa-profile-v1",
  "id": "<slug>",
  "name": "<human-readable>",
  "version": "1.0.0",
  "createdAt": "<ISO>",
  "updatedAt": "<ISO>",

  "urlPatterns": [
    "http://localhost:*/*",
    "http://127.0.0.1:*/*"
    // + production patterns inferred from git remote, see below
  ],

  "framework": { "type": "astro", "version": "5.18.1" },

  "conventions": {
    "sectionAttribute": "data-section",
    "i18nKeyAttribute": "data-i18n-key",
    "sourceMapAttribute": "data-astro-source-loc"
  },

  "localeStrategy": {
    "type": "url-prefix",
    "supportedLocales": ["en","ko","vi","ja","zh"],
    "defaultLocale": "en",
    "prefixDefaultLocale": false
  },

  "sections": [
    {
      "name": "HeroSection",
      "file": "src/components/Hero.astro",
      // figma block is optional — present when stack mining or user prompts produced a nodeId
      "figma": {
        "nodeId": "3880:2925",
        "viewportVariants": { "desktop": "3880:2925", "tablet": null, "mobile": null }
      }
    }
  ],

  "pages": [
    {
      "name": "home",
      "figma": {
        "nodeId": "3880:2879",
        "viewportVariants": { "desktop": "3880:2879", "tablet": "3880:17016", "mobile": "3880:27786" }
      }
    }
  ],

  "pageDetection": [
    { "pattern": "^/(en|ko|vi|ja|zh)?/?$",            "pageName": "home" },
    { "pattern": "^/(en|ko|vi|ja|zh)?/about-us/?$",   "pageName": "about-us" },
    { "pattern": "^/(en|ko|vi|ja|zh)?/technology/?$", "pageName": "technology" }
  ],

  "jira": {
    "projectKey": "ELS",
    "defaultParent": "ELS-1234",
    "defaultMode": "subtasks",
    "defaultLabels": ["qa", "visual-fidelity", "qa-annotator"],
    "severityToPriority": {
      "critical": "Highest",
      "major":    "High",
      "minor":    "Medium",
      "trivial":  "Low"
    }
  },

  "figma": {
    "fileKey": "<key or null>",
    "fileSlug": "<slug or null>",
    "linkTemplate": "https://www.figma.com/design/{fileKey}/{fileSlug}?node-id={nodeId}"
  },

  "screenshots": {
    "githubRawBase": "<from stack.git.githubRawBase>",
    "branch": "<branch>"
  },

  "issueTemplates": {
    "defaultSeverity": "minor",
    "defaultType": "visual"
  }
}
```

## Composition rules

### `id`

`<slug>-<dateYYYYMMDD>` where slug is derived from:
- `stack.git.remote` → take the last segment, lowercase, replace non-alnum with `-`. e.g. `github.com/ohmyhotelco/home` → `home-omh` is OK, but a safer default is just `home`.
- If no git, use the basename of `projectRoot`.

If `answers.profileNameOverride` is provided, slugify it for the id.

### `name`

`<repo-or-folder>` `(<framework.type>)` — e.g. `home (astro)`. If `profileNameOverride` provided, use it verbatim.

### `urlPatterns`

Always include:
- `http://localhost:*/*`
- `http://127.0.0.1:*/*`

Plus, if `stack.git.remote` is `github.com/<org>/<repo>`, **best-effort** add `https://*.${org}.com/*` only if the org name looks like a real domain root (heuristic: org name length > 3 and contains no digits). Otherwise leave the array as just localhost — the user can edit it.

### `framework`

Copy directly from `stack.framework`.

### `conventions`

Always include `sectionAttribute: "data-section"` and `i18nKeyAttribute: "data-i18n-key"`. If framework is Astro, also include `sourceMapAttribute: "data-astro-source-loc"`.

### `localeStrategy`

- `supportedLocales` from `stack.locales` (empty array if none detected)
- `defaultLocale` from `stack.defaultLocale`
- `type` from `stack.localeStrategy.type`. If `supportedLocales.length <= 1`, force `type: "none"`.
- `prefixDefaultLocale`: copy from `stack.localeStrategy.prefixDefaultLocale` when `type === "url-prefix"`. Omit otherwise. The QA Annotator extension uses this to decide whether `/about-us/` is the EN page (false) or whether `/en/about-us/` is required (true).

### `sections`

Map `stack.sections` to `[{ name, file }]` (drop the `line` field — keeping it makes the profile churn whenever line numbers shift).

For each section, if `stack.figmaSections` has an entry with the same `sectionName`, attach a `figma` sub-block:

```jsonc
{
  "name": "HeroSection",
  "file": "src/components/sections/HeroSection.astro",
  "figma": {
    "nodeId": "3880:2925",
    "viewportVariants": { "desktop": "...", "tablet": "...", "mobile": "..." }
  }
}
```

- `viewportVariants` keys with `null` values are kept so consumers can detect "this viewport not yet designed".
- If `stack.figmaSections` had no entry for the section name, omit the `figma` field entirely. The extension's modal will still allow QA to paste a Figma link manually per issue.

### `pages`

NEW field, peer of `sections`. Build from `stack.figmaPages`:

```jsonc
"pages": [
  {
    "name": "home",
    "figma": {
      "nodeId": "3880:2879",
      "viewportVariants": { "desktop": "...", "tablet": "...", "mobile": "..." }
    }
  }
]
```

Omit the `pages` array entirely if `stack.figmaPages` is empty. The extension uses this to build a "go to Figma page" link in addition to the per-section link.

### `pageDetection`

Build one entry per `stack.routes[]` entry:

- **`pattern`** — JS regex string anchored at start.
  - Honor `localeStrategy.prefixDefaultLocale`. When `false`, the locale prefix is optional: `^/(<loc1>|<loc2>|...)?(<route-path>)/?$`. When `true`, it's required: `^/(<loc1>|<loc2>|...)(<route-path>)/?$`. When `localeStrategy.type !== "url-prefix"`, just use `^<route-path>/?$`.
  - The home route's path is `/` — use `^/(<locales>)?/?$` (no extra path segment).
  - Escape regex meta-chars in the route path. Bracketed dynamic segments like `[slug]` become `[^/]+`.
- **`pageName`** — `route.name` (`"home"`, `"about-us"`, etc.)

Skip routes whose name starts with `_` (Astro/Next conventions for layouts/error pages). Skip API routes.

If `stack.routes` is empty, omit `pageDetection` entirely (extension's `detectPage` already returns `null` safely).

### `jira`

- `projectKey` = `answers.jiraProjectKey ?? stack.jiraProjectKeyGuess ?? null`. If null, omit the entire `jira.projectKey` field but keep the block with sensible defaults — the user can fill it later.
- `defaultParent` = `answers.jiraDefaultParent ?? null` (omit if null).
- Always include `defaultMode: "subtasks"`, `defaultLabels`, `severityToPriority` with the defaults shown above.

### `figma`

- `fileKey` = `answers.figmaFileKey ?? stack.figmaFileKey ?? null`.
- `fileSlug` = `stack.figmaFileSlug ?? null`. (Not user-prompted — only set if extracted from a config file's URL.)
- `linkTemplate`:
  - If `fileSlug` is set: `https://www.figma.com/design/{fileKey}/{fileSlug}?node-id={nodeId}` (canonical form).
  - If `fileSlug` is null: `https://www.figma.com/design/{fileKey}?node-id={nodeId}` (still resolves correctly, slug is cosmetic).

**Note for consumers:** when substituting `{nodeId}`, use Figma's URL form (hyphen) e.g. `2-5103`, not the API form (`2:5103`).

### `screenshots`

Copy from `stack.git.githubRawBase` and `stack.git.branch`. If no git, omit the block.

### Timestamps

`createdAt` and `updatedAt` both = `inputs.now`.

## Validation before returning

Reject the result and surface a clear error if any of these are violated:

- `id` is empty
- `urlPatterns` is empty
- `framework.type` is not in `["astro","nextjs","vue","react","generic","nuxt"]`
- `localeStrategy.supportedLocales` contains duplicates

The caller is responsible for actually writing the file — this skill only **returns** the validated object.
