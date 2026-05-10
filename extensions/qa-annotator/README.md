# QA Annotator — Chrome Extension

Click any element on a live web page → log a styled QA issue with computed
styles, source `file:line`, screenshot, viewport context, and an auto-resolved
Figma deeplink. Export issues as JSON / Markdown / ZIP, or push them to Jira
via the companion Claude Code plugin.

> Part of the [`qa-toolkit` monorepo](../../README.md). For roadmap of other
> planned extensions (i18n coverage, API monitor, visual regression…) see the
> top-level README.

## Quick install

1. `chrome://extensions` → **Developer mode** ON
2. **Load unpacked** → select `<repo>/extensions/qa-annotator/`
3. Pin **QA Annotator** to the toolbar

Detailed setup, profile import, and troubleshooting: [`docs/INSTALL.md`](docs/INSTALL.md).

## What's inside

- **Inspector**: hover-highlight + click-to-pick + shift-click multi-pick + Esc
- **Auto-capture**: viewport screenshot cropped to picked element + theme border
- **Annotation editor** (post-capture): numbered pins, rectangles, arrows, blur,
  text callouts, freehand. Hotkeys P/R/A/T/B/F. Persists re-editable layers.
- **6 QA modes**: PROD bug · Design fidelity · Admin · A11y · i18n · Custom.
  Each mode toggles the right capture sources + modal panels by default.
- **Mode-aware modal**: per-mode form builder, panel registry, severity
  segmented pill, draft auto-save, right-rail TOC, Tab focus trap.
- **Console + network capture** (page MAIN world ring buffer)
- **A11y scan** (axe-core 4.10.3 bundled, ~540 KB)
- **Multi-screenshot gallery** with drag-reorder, paste, upload, recapture

## Companion plugin

The [`qa-tooling`](../../plugins/qa-tooling/README.md) Claude Code plugin
generates `qa-profile.json` and `qa-figma-tree.json` for any project. Without
it the extension still works (built-in empty profile), you just lose:

- Auto-fill of Figma deeplinks per picked element
- Project-aware section / page detection
- Jira project / parent ticket defaults

## Status

- **Current**: v0.6.0 — UX improvements (segmented severity pill, sticky TOC,
  draft auto-save, settings sidebar + search, a11y hardening, pin-notes
  lazy-mount fix)
- **Roadmap**: see top-level [`STATUS.md`](../../STATUS.md)
- **Codebase guide for AI**: [`../../CLAUDE.md`](../../CLAUDE.md)

## License

MIT — see [`LICENSE`](../../LICENSE) at repo root.
