# Shared code

Code reused across multiple extensions in this monorepo. Currently a placeholder
— extracted modules will land here as the second extension begins.

## Planned structure

```
shared/
├── profile-schema/     ← qa-profile-v1, qa-figma-tree-v1 JSON schemas + validator
├── ui-primitives/      ← form modal, focus trap, severity pill, sidebar TOC
├── runtime-buffer/     ← console + network capture (page MAIN world)
├── messages/           ← chrome.runtime message constants
└── README.md
```

## Why no build step

Like every extension here, shared modules use plain JS / IIFE attaching to
`self.QA.<module>`. Extensions import via relative path:

```js
// extensions/qa-i18n-coverage/manifest.json
"content_scripts": [{
  "js": [
    "../../shared/runtime-buffer/runtime-buffer.js",
    "../../shared/ui-primitives/form-modal.js",
    "src/content/content.js"
  ]
}]
```

Chrome MV3 supports relative paths inside content_scripts as long as the file
is inside the loaded extension folder. For shared/, we use a small build script
(`scripts/sync-shared.mjs`) to copy `shared/<module>/` into each extension's
`src/_shared/<module>/` at package time. No bundler, no transform.

## Extraction policy

Move code from `extensions/qa-annotator/src/` into `shared/` only when:

1. A second extension actually needs it (don't speculate)
2. The API is stable (≥ 2 weeks no breaking change)
3. There's a dedicated test or smoke script in `shared/<module>/test/`

Until then, copy-paste is fine.
