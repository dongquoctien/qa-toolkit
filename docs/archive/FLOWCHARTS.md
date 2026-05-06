# QA Annotator Extension — Visual Flow Charts

> Companion document to `PLAN.md`. Đọc cái này trước khi code để hình dung tổng thể.

---

## 1. Big picture — Vai trò các bên

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│   ┌──────────┐     ┌─────────────┐     ┌──────────┐    ┌──────────┐  │
│   │   QA     │     │  Extension  │     │  Claude  │    │   Jira   │  │
│   │ (người)  │     │  (Chrome)   │     │  + MCP   │    │  Cloud   │  │
│   └─────┬────┘     └──────┬──────┘     └────┬─────┘    └────┬─────┘  │
│         │                  │                  │                │       │
│         │  1. Cài extension │                  │                │       │
│         │ ────────────────▶│                  │                │       │
│         │                  │                  │                │       │
│         │  2. Chọn profile │                  │                │       │
│         │     "home OMH"   │                  │                │       │
│         │ ────────────────▶│                  │                │       │
│         │                  │                  │                │       │
│         │  3. Mở website   │                  │                │       │
│         │     localhost…   │                  │                │       │
│         │ ────────────────▶│                  │                │       │
│         │                  │                  │                │       │
│         │  4. Toggle ON +  │                  │                │       │
│         │     click element│                  │                │       │
│         │ ────────────────▶│                  │                │       │
│         │                  │                  │                │       │
│         │  5. Note + save  │                  │                │       │
│         │ ────────────────▶│                  │                │       │
│         │                  │                  │                │       │
│         │  …(lặp 5–20 lần)…│                  │                │       │
│         │                  │                  │                │       │
│         │  6. Export ZIP   │                  │                │       │
│         │ ◀──────────────── │                  │                │       │
│         │                  │                  │                │       │
│         │  7. Mở Claude,   │                  │                │       │
│         │     đính kèm ZIP │                  │                │       │
│         │ ─────────────────────────────────▶│                │       │
│         │                  │                  │                │       │
│         │                  │                  │  8. MCP        │       │
│         │                  │                  │     create     │       │
│         │                  │                  │     subtasks   │       │
│         │                  │                  │ ──────────────▶│       │
│         │                  │                  │                │       │
│         │  9. Done. Jira   │                  │                │       │
│         │     có 15 task   │                  │                │       │
│         │ ◀──────────────────────────────────────────────────│       │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Extension không gọi Jira API. Claude làm cầu nối qua MCP Atlassian.

---

## 2. Architecture — 4 Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LAYER 4 — PROFILE                                       │   │
│  │  (project-specific config, JSON file)                    │   │
│  │                                                           │   │
│  │   home.qa-profile.json   shop.qa-profile.json   …        │   │
│  │   ─ urlPatterns          ─ urlPatterns                   │   │
│  │   ─ framework: astro     ─ framework: nextjs             │   │
│  │   ─ jira: ELS            ─ jira: SHOP                    │   │
│  └─────────────────────┬────────────────────────────────────┘   │
│                        │ user load qua Settings                  │
│                        ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LAYER 3 — ADAPTER                                       │   │
│  │  (framework-specific extraction logic)                   │   │
│  │                                                           │   │
│  │   ┌────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐ │   │
│  │   │ Astro  │  │ Next.js  │  │ Vue     │  │ Generic  │ │   │
│  │   ├────────┤  ├──────────┤  ├─────────┤  ├──────────┤ │   │
│  │   │ extract│  │ extract  │  │ extract │  │ fallback │ │   │
│  │   │ source │  │ source   │  │ source  │  │ no source│ │   │
│  │   │ section│  │ section  │  │ section │  │ section  │ │   │
│  │   │ i18n   │  │ i18n     │  │ i18n    │  │ i18n     │ │   │
│  │   └────────┘  └──────────┘  └─────────┘  └──────────┘ │   │
│  └─────────────────────┬────────────────────────────────────┘   │
│                        │ chosen by profile.framework.type        │
│                        ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LAYER 2 — CORE                                          │   │
│  │  (framework-agnostic, vanilla JS)                        │   │
│  │                                                           │   │
│  │   • inspector  → highlight/click                         │   │
│  │   • modal      → fill form                               │   │
│  │   • builder    → compose Issue object                    │   │
│  │   • styles     → getComputedStyle whitelist              │   │
│  │   • selector   → unique CSS selector                     │   │
│  │   • exporter   → JSON / MD / ZIP                         │   │
│  └─────────────────────┬────────────────────────────────────┘   │
│                        │                                          │
│                        ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LAYER 1 — PLATFORM (Chrome MV3)                         │   │
│  │                                                           │   │
│  │   manifest.json      content scripts      popup.html     │   │
│  │   service-worker     chrome.storage       chrome.tabs    │   │
│  │   chrome.downloads   side panel API       options page   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. User flow — Cài & dùng lần đầu

```
START
  │
  ▼
┌─────────────────────────────────┐
│ QA cài extension                 │
│ chrome://extensions →            │
│ Load unpacked →                  │
│ chọn folder qa-annotator         │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Extension load lần đầu           │
│ → service-worker import         │
│   built-in profiles              │
│ → notification:                 │
│   "1 profile loaded: Home OMH"  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ QA mở localhost:4322             │
│ (hoặc URL match profile)         │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Service worker:                  │
│   findMatchingProfile(url)       │
│   → home-omh                     │
│   → set badge "✓ Home OMH"       │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ QA click icon extension          │
│ Popup hiển thị:                  │
│   - Profile: Home OMH            │
│   - Page: home  Locale: en       │
│   - Toggle Inspector OFF         │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Click toggle → Inspector ON      │
│ Popup gửi message xuống content  │
│ Content script:                  │
│   - cursor crosshair             │
│   - add hover/click listeners    │
│   - load adapter (Astro)         │
└────────────────┬────────────────┘
                 │
                 ▼
       (continue ở flow 4)
```

---

## 4. Click flow — Khi QA click element

```
QA hover h2 "There are reasons…"
        │
        ▼
┌──────────────────────────────────┐
│ Content script — mouseover       │
│  - Highlight el orange outline   │
│  - Tooltip phía trên:            │
│    "h2 · 36px · …Section.astro:83"│
└──────────────┬───────────────────┘
               │
               ▼
QA click element
        │
        ▼
┌──────────────────────────────────┐
│ Content script — click capture   │
│  - preventDefault                │
│  - stopPropagation               │
└──────────────┬───────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ Build Issue partial qua Adapter + Core:          │
│                                                   │
│  ┌─ Adapter (Astro) ──┐                          │
│  │ extractSource(el)   │ → file: …Section.astro  │
│  │                     │   line: 83              │
│  │ extractSection(el)  │ → "RecognitionSection"  │
│  │ extractI18nKey(el)  │ → "home.recognition…"   │
│  └─────────────────────┘                          │
│                                                   │
│  ┌─ Core ─────────────┐                          │
│  │ uniqueSelector(el)  │ → "[data-section=…]…"   │
│  │ pickComputed(el,    │ → {fontSize: '36px',…}  │
│  │   profile.props)    │                          │
│  │ rect()              │ → {x:320,y:180,…}       │
│  └─────────────────────┘                          │
│                                                   │
│  ┌─ Lib ──────────────┐                          │
│  │ localeDetector      │ → 'en'                  │
│  │ pageDetector        │ → 'home'                │
│  └─────────────────────┘                          │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Show form modal in-page          │
│ (z-index: 2147483647)            │
│                                   │
│ Fields auto-filled:              │
│  - Selector                      │
│  - Source (file:line)            │
│  - Computed styles               │
│  - Section / i18n key / page     │
│                                   │
│ Fields QA fill:                  │
│  - Severity / Type               │
│  - Title (or pick template)      │
│  - Expected (Figma)              │
│  - Note                          │
│  - Screenshot (optional)         │
└──────────────┬───────────────────┘
               │
               ▼
QA click "Save"
        │
        ▼
┌──────────────────────────────────┐
│ - Validate required              │
│ - Generate ID: ISS-001           │
│ - (Optional) capture screenshot  │
│   → background.js handle         │
│ - Save vào chrome.storage.local  │
│   key: issues:{origin}           │
│ - Update badge counter +1        │
│ - Close modal                    │
│ - Inspector vẫn ON, sẵn sàng     │
│   click element tiếp             │
└──────────────────────────────────┘
```

---

## 5. Profile system

### 5.1 URL match flow

```
QA mở URL: https://www.ohmyhotelnco.com/about
                  │
                  ▼
┌──────────────────────────────────────────────┐
│ chrome.tabs.onUpdated event                  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│ profileManager.findMatchingProfile(url)      │
│                                                │
│ Loop qua all profiles:                       │
│                                                │
│  profile #1 home-omh                         │
│    urlPatterns: [                            │
│      "http://localhost:*/*",                 │
│      "https://*.ohmyhotelnco.com/*"  ← MATCH│
│    ]                                          │
│  → return profile #1                         │
│                                                │
│  (skip remaining)                            │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│ Set chrome.storage:                          │
│   inspector:state.activeProfileId = home-omh │
│                                                │
│ Set badge:                                   │
│   ✓ "Home OMH"                               │
└──────────────────────────────────────────────┘


Trường hợp không match:

QA mở URL: https://example.com/
                  │
                  ▼
findMatchingProfile() returns null
                  │
                  ▼
┌──────────────────────────────────────────────┐
│ Badge: ⚠ "No profile"                        │
│                                                │
│ Khi QA click icon:                           │
│   Popup hiển thị "No profile match"          │
│   3 lựa chọn:                                │
│   - Use Generic profile                      │
│   - Add URL to existing profile              │
│   - Create new profile from this URL         │
└──────────────────────────────────────────────┘
```

### 5.2 Profile lifecycle

```
   ┌─────────────────────┐
   │ Built-in profile    │
   │ home.qa-profile.json│
   │ (ship trong ext)    │
   └──────────┬──────────┘
              │ first install
              ▼
   ┌─────────────────────┐         ┌──────────────────┐
   │ chrome.storage      │ ◀────── │ User Settings UI │
   │   profiles[]        │         │ (CRUD)            │
   └──────────┬──────────┘         └──────────────────┘
              │
              ├─────────── User Action ──────────┐
              │                                    │
              ▼                                    ▼
   ┌─────────────────────┐         ┌──────────────────┐
   │ Edit existing       │         │ Import file       │
   │ (Settings → edit)   │         │ (.qa-profile.json)│
   └─────────────────────┘         └──────────────────┘
              │                                    │
              └────────────┬───────────────────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Validate schema      │
                └──────────┬──────────┘
                           │
                ┌──────────┴──────────┐
                ▼                      ▼
            Valid                  Invalid
                │                      │
                ▼                      ▼
        Save vào storage      Show error UX
```

---

## 6. Adapter selection

```
Inspector active, QA click element
                  │
                  ▼
┌──────────────────────────────────────────┐
│ activeProfile = profileManager           │
│   .getActive(tabId)                      │
│ → home-omh                               │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ adapter = adapterRegistry.get(           │
│   activeProfile.framework.type            │
│ )                                          │
│ → AstroAdapter                           │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ adapter.canHandle()                       │
│   - Có element nào có data-astro-source* │
│   - YES → return true                     │
└──────────────────┬───────────────────────┘
                   │ true
                   ▼
┌──────────────────────────────────────────┐
│ Use AstroAdapter                          │
│   extractSource(el, profile)             │
│   extractSection(el, profile)            │
│   extractI18nKey(el, profile)            │
└──────────────────────────────────────────┘


Nếu canHandle() = false (Astro prod build, ko có data-astro-source-*):

                   ▼
┌──────────────────────────────────────────┐
│ Fallback chain:                           │
│   Astro → Generic                         │
│                                            │
│ adapter = AdapterRegistry.fallback()     │
│ → GenericAdapter                          │
│                                            │
│ source: { file: null, line: null }       │
│ section: vẫn read từ data-section        │
│ i18n: vẫn read từ data-i18n-key          │
└──────────────────────────────────────────┘
```

---

## 7. Export flow

```
QA click "Export ZIP" trong popup
              │
              ▼
┌──────────────────────────────────────────┐
│ Popup gửi message:                        │
│   { type: 'EXPORT', format: 'zip' }      │
│ → service worker                          │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ Service worker:                           │
│ 1. Đọc storage:                          │
│    - profile (active)                     │
│    - issues:{origin}                      │
│    - settings:global (reporter name)      │
│                                            │
│ 2. Build Report:                          │
│    {                                       │
│      $schema: 'qa-report-v1',            │
│      report: {                            │
│        profile: { id, name, version },   │
│        scope: { url, viewport, locale }, │
│        syncHints: profile.jira,          │
│        counts: { …},                      │
│        issues: [...]                      │
│      }                                     │
│    }                                       │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ Lazy-load JSZip                           │
│                                            │
│ zip = new JSZip()                         │
│ zip.file('qa-report.json', json)         │
│ zip.file('qa-report.md',   md)           │
│                                            │
│ for issue of issues:                      │
│   if issue.screenshot:                    │
│     zip.folder('screenshots').file(       │
│       issue.screenshot.filename,          │
│       blob                                 │
│     )                                      │
│                                            │
│ blob = zip.generateAsync()               │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ chrome.downloads.download({               │
│   url: URL.createObjectURL(blob),        │
│   filename:                               │
│     'qa-report-2026-05-06.zip'           │
│ })                                         │
└──────────────────┬───────────────────────┘
                   │
                   ▼
File `.zip` về Downloads folder
              │
              ▼
QA giải nén vào docs/qa/reports/2026-05-06/
              │
              ▼
       (Continue ở flow 8)
```

---

## 8. Sync to Jira (qua Claude + MCP)

```
QA mở Claude Code (terminal hoặc claude.ai)
              │
              ▼
┌─────────────────────────────────────────────┐
│ QA gõ prompt:                                │
│                                               │
│ "Đính kèm: qa-report-2026-05-06.json        │
│  + screenshots/ folder                       │
│                                               │
│  Yêu cầu:                                    │
│  Tạo subtasks dưới ELS-1234 theo syncHints, │
│  upload screenshot URL từ GitHub raw,       │
│  in summary."                                │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Claude:                                      │
│ 1. Read qa-report.json                       │
│ 2. Parse syncHints:                         │
│    {                                          │
│      suggestedJiraProject: 'ELS',           │
│      suggestedParent: 'ELS-1234',           │
│      suggestedMode: 'subtasks',             │
│      labelDefaults: ['qa','visual-fidelity'] │
│    }                                          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Step 1: Verify parent (MCP)                  │
│   mcp__mcp-atlassian__jira_get_issue        │
│     issue_key: 'ELS-1234'                   │
│ → Found: "Implement Recognition section"    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Step 2: (Optional) Commit screenshots        │
│   git add docs/qa/reports/.../screenshots/  │
│   git commit -m "qa: 2026-05-06 reports"    │
│   git push                                   │
│ → Có URL raw GitHub                         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Step 3: Loop issues                          │
│                                               │
│ for issue of report.issues:                  │
│   if issue.synced != null: skip             │
│                                               │
│   payload = buildJiraPayload(issue, profile)│
│   {                                           │
│     project: 'ELS',                          │
│     issuetype: 'Sub-task',                   │
│     parent: 'ELS-1234',                      │
│     summary: '[QA] {section} · {title}',    │
│     description: buildADF(issue),            │
│     priority: severityToPriority[severity], │
│     labels: ['qa', 'visual-fidelity',       │
│              'viewport-1280', 'locale-en',  │
│              'section-recognition', 'visual']│
│   }                                           │
│                                               │
│   mcp__mcp-atlassian__jira_create_issue     │
│     ...payload                               │
│   → 'ELS-2001'                              │
│                                               │
│   mark synced: { to: 'ELS-2001', mode: ... }│
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Step 4: Update qa-report.json                │
│   write file với synced fields đã update    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Step 5: Report back                          │
│                                               │
│ "✓ 15 subtasks created under ELS-1234        │
│  ELS-2001  ISS-001 H2 size mismatch          │
│  ELS-2002  ISS-002 Card shadow too light    │
│  …                                            │
│  ELS-2015  ISS-015 …                         │
│                                               │
│  Open Jira: https://....atlassian.net/      │
│  browse/ELS-1234"                            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
                  END
```

---

## 9. Project structure visual

```
qa-annotator-extension/
│
├── 📄 manifest.json
├── 📄 README.md
├── 📄 PLAN.md
├── 📄 FLOWCHARTS.md          ← bạn đang đọc
├── 📄 CHANGELOG.md
│
├── 📁 src/
│   │
│   ├── 📁 core/              ← LAYER 2 — agnostic
│   │   ├── inspector.js
│   │   ├── form-modal.js
│   │   ├── issue-builder.js
│   │   ├── computed-styles.js
│   │   ├── unique-selector.js
│   │   └── id-generator.js
│   │
│   ├── 📁 adapters/          ← LAYER 3 — framework
│   │   ├── adapter-registry.js
│   │   ├── adapter-astro.js
│   │   ├── adapter-nextjs.js
│   │   ├── adapter-vue.js
│   │   ├── adapter-react.js
│   │   └── adapter-generic.js
│   │
│   ├── 📁 profile/           ← LAYER 4 — config
│   │   ├── profile-manager.js
│   │   ├── profile-validator.js
│   │   ├── profile-matcher.js
│   │   └── 📁 built-in/
│   │       ├── home.qa-profile.json
│   │       └── empty.qa-profile.json
│   │
│   ├── 📁 content/           ← LAYER 1
│   │   ├── content.js
│   │   ├── content.css
│   │   └── overlay.js
│   │
│   ├── 📁 background/
│   │   └── service-worker.js
│   │
│   ├── 📁 popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   │
│   ├── 📁 sidebar/           ← Phase 2
│   │   └── (deferred)
│   │
│   ├── 📁 settings/
│   │   ├── settings.html
│   │   ├── settings.js
│   │   ├── settings.css
│   │   └── 📁 components/
│   │       ├── profile-list.js
│   │       ├── profile-editor.js
│   │       └── profile-importer.js
│   │
│   └── 📁 lib/
│       ├── jszip.min.js
│       ├── exporter.js
│       ├── glob-match.js
│       ├── locale-detector.js
│       └── messages.js
│
├── 📁 assets/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── 📁 templates/
│   ├── home.qa-profile.json    ← copy của built-in (cho QA download)
│   └── empty.qa-profile.json
│
└── 📁 docs/
    ├── INSTALL.md
    ├── USER_GUIDE.md
    ├── PROFILE_GUIDE.md
    ├── ADAPTER_GUIDE.md
    └── CLAUDE_PROMPTS.md
```

---

## 10. Data flow — Issue object journey

```
┌──────────────────┐
│ DOM Element      │
│ <h2 id="…">      │
└────────┬─────────┘
         │ click
         ▼
┌──────────────────────────────────────────┐
│ Adapter.extract*() + Core.pickStyles()    │
│                                            │
│ Issue = {                                  │
│   element: { selector, tag, rect, … },   │
│   source: { file, line, adapter },       │
│   computed: { fontSize, color, … },      │
│   section, i18nKey, page, locale, …      │
│ }                                          │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Form modal (QA fill)                      │
│                                            │
│ Issue += {                                 │
│   id, severity, type, title,             │
│   expected, note,                         │
│   screenshot                              │
│ }                                          │
└────────┬─────────────────────────────────┘
         │ save
         ▼
┌──────────────────────────────────────────┐
│ chrome.storage.local                      │
│                                            │
│ issues:{origin} = [Issue, Issue, …]      │
└────────┬─────────────────────────────────┘
         │ export
         ▼
┌──────────────────────────────────────────┐
│ Exporter builds Report                    │
│                                            │
│ Report = {                                 │
│   profile: { snapshot },                  │
│   syncHints: profile.jira,               │
│   counts, issues                          │
│ }                                          │
└────────┬─────────────────────────────────┘
         │ ZIP packaging
         ▼
┌──────────────────────────────────────────┐
│ qa-report-2026-05-06.zip                  │
│   ├── qa-report.json                     │
│   ├── qa-report.md                       │
│   └── screenshots/                       │
│       ├── iss-001.png                    │
│       └── …                              │
└────────┬─────────────────────────────────┘
         │ user attach
         ▼
┌──────────────────────────────────────────┐
│ Claude (đính kèm + prompt)               │
│                                            │
│ Read JSON → Parse → Loop issues          │
└────────┬─────────────────────────────────┘
         │ MCP calls
         ▼
┌──────────────────────────────────────────┐
│ Jira Cloud                                │
│                                            │
│ ELS-2001, ELS-2002, …, ELS-2015          │
└──────────────────────────────────────────┘
```

---

## 11. State machine — Inspector

```
                    ┌─────────────┐
                    │     OFF     │ ◀─── initial
                    └──────┬──────┘
                           │
                  toggle ON│   ▲
                           │   │ toggle OFF
                           ▼   │
                    ┌─────────────┐
                    │   READY     │
                    │ (cursor=↘)  │
                    └──────┬──────┘
                           │
                  hover el │
                           ▼
                    ┌─────────────┐
                    │ HIGHLIGHTING│
                    │ (orange box │
                    │  + tooltip) │
                    └──────┬──────┘
                           │
                    click  │
                           ▼
                    ┌─────────────┐
                    │ FORM_OPEN   │
                    │ (modal)     │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │ Cancel        │ Save         │
            ▼               ▼              │
    ┌────────────┐   ┌─────────────┐      │
    │   READY    │   │  SAVING     │      │
    │ (back to)  │   │ (spinner)   │      │
    └────────────┘   └──────┬──────┘      │
                            │              │
                            ▼              │
                    ┌────────────┐         │
                    │  SAVED     │         │
                    │ (toast +1) │─────────┘
                    └────────────┘
```

---

## 12. Storage layout visual

```
chrome.storage.local
│
├── settings:global
│   {
│     reporterName: "tester1",
│     lastActiveProfileId: "home-omh",
│     ui: { theme: "light", … }
│   }
│
├── profiles
│   [
│     { id: "home-omh",  name: "Home OMH",       … },
│     { id: "shop-next", name: "Shop (Next.js)", … },
│     { id: "blog-vue",  name: "Blog (Vue)",     … }
│   ]
│
├── issues:http://localhost:4322
│   [
│     Issue, Issue, Issue, …
│   ]
│
├── issues:https://www.ohmyhotelnco.com
│   [
│     Issue, Issue, …
│   ]
│
├── inspector:state
│   {
│     enabled: true,
│     tabId: 1234,
│     activeProfileId: "home-omh"
│   }
│
└── counter:home-omh
    42       ← next ID = ISS-042
```

---

## Tóm tắt

- **4 layers** tách biệt: Profile → Adapter → Core → Platform
- **Profile** = file JSON config — extension dùng được mọi project
- **Adapter** = code framework-specific — Astro/Next/Vue/Generic
- **Core** = vanilla JS — không phụ thuộc framework
- **Sync Jira** = qua Claude + MCP, không qua HTTP từ extension
- **Storage** = `chrome.storage.local` — profiles, issues per origin, state
- **Export** = ZIP chứa JSON + MD + screenshots → đính kèm cho Claude

Đọc xong, có gì confused → hỏi tiếp. Nếu OK rồi → trả lời 13 câu hỏi trong PLAN.md mục 19 để tôi bắt đầu code.
