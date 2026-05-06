# OMH Co — QA Annotator Chrome Extension · Plan v2

> **Repo:** `D:\Github\qa-annotator-extension`
> **Architecture:** Generic core + Settings UI + Profile file
> **First-use case:** `D:\Code\worktree\homepage\home` (ohmyhotelnco-revise)
> **Owner:** itdongquoctien
> **Last updated:** 2026-05-06 · v2

---

## 1. Mục tiêu

Xây Chrome extension **generic** cho QA/QC dùng được trên **mọi website**, để:

1. Click trực tiếp lên element trên live page
2. Tự động thu thập selector / source / computed styles theo **profile config** của project
3. Note manual: severity, type, expected (Figma), actual, screenshot
4. Export JSON + Markdown + ZIP
5. Sync sang Jira Cloud qua **Claude + MCP Atlassian** (KHÔNG dùng HTTP)

### Khả năng đa project

- **1 extension** dùng cho **N projects** (home, mobile-app, marketing-site, ...)
- Mỗi project = 1 **Profile** (file JSON config)
- QA switch profile khi đổi project — extension auto-adapt convention

```
┌─ Extension ──┐         ┌─ Profile (JSON) ─┐
│   Generic    │ ──────▶ │   Project-specific│
│   Core       │ ◀────── │   conventions     │
└──────────────┘         └───────────────────┘

Generic core:                Profile config:
- click + form + export      - URL patterns
- screenshot + storage       - framework (Astro/Next/Vue/...)
- export JSON/MD/ZIP         - section/i18n attributes
- Claude prompt templates    - locale strategy
                             - Jira sync hints
                             - Figma file key
                             - GitHub raw base URL
```

---

## 2. Phạm vi & Non-goals

### In scope (Phase 1 MVP — generic + home profile)

- Manifest V3 Chrome extension generic
- **Profile system**: Settings UI + import/export `.qa-profile.json`
- **Built-in profile**: home (Astro V2-EN)
- Click-to-inspect mode toggle
- Form modal/sidebar
- Auto-fill computed styles + framework-aware source mapping
- Persistence qua `chrome.storage.local`
- Export JSON + Markdown
- Screenshot capture
- ZIP packaging
- Hoạt động trên: any URL (`<all_urls>` với optional permissions)

### Out of scope (giai đoạn này)

- Direct Jira REST API call (đã quyết định dùng Claude MCP)
- Figma API integration (Phase 3)
- Pixel-diff với Figma screenshot (Phase 3)
- DevTools panel (Phase 3)
- Chrome Web Store publish (chỉ Load unpacked nội bộ)

---

## 3. Kiến trúc generic

### 3.1 Layers

```
┌──────────────────────────────────────────────────────┐
│ LAYER 4: PROFILE (project-specific config)            │
│   home.qa-profile.json / next-app.qa-profile.json     │
└──────────────────────────────────────────────────────┘
                       ▲ load by user
┌──────────────────────────────────────────────────────┐
│ LAYER 3: ADAPTER (framework-specific logic)           │
│   AstroAdapter / NextAdapter / VueAdapter / Generic   │
│   - extract source (file:line)                        │
│   - extract i18n key                                  │
│   - extract section name                              │
└──────────────────────────────────────────────────────┘
                       ▲ chosen by profile.framework
┌──────────────────────────────────────────────────────┐
│ LAYER 2: CORE (framework-agnostic)                    │
│   - inspector + click + highlight                     │
│   - form modal                                        │
│   - storage + ID gen + export                         │
│   - getComputedStyle + getBoundingClientRect          │
└──────────────────────────────────────────────────────┘
                       ▲
┌──────────────────────────────────────────────────────┐
│ LAYER 1: PLATFORM (Chrome MV3)                        │
│   - manifest, content script, background, popup       │
│   - chrome.storage.local / chrome.tabs.captureVisibleTab │
└──────────────────────────────────────────────────────┘
```

### 3.2 Module diagram

```
                  ┌──────────────────┐
                  │  Profile Manager │ ◀── load/save/import/export
                  └─────┬────────────┘
                        │ active profile
                        ▼
       ┌────────────────────────────────────┐
       │      Adapter Registry               │
       │  ┌─────────┬─────────┬──────────┐  │
       │  │ Astro   │ Next.js │ Generic  │  │
       │  └─────────┴─────────┴──────────┘  │
       └────────────────────────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │  Inspector Engine     │ — Layer 2 core
            │  - click handler      │
            │  - highlight overlay  │
            │  - form modal         │
            └──────────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │  Issue Builder        │
            │  uses Adapter to      │
            │  enrich Issue object  │
            └──────────────────────┘
```

---

## 4. Profile schema

### 4.1 Profile file `.qa-profile.json`

```typescript
interface Profile {
  $schema: 'qa-profile-v1';
  id: string;                    // 'home-omh' (slug, unique)
  name: string;                  // 'Ohmyhotel Co — Homepage'
  description?: string;
  version: string;               // '1.0.0'
  createdAt: string;
  updatedAt: string;

  /** URL patterns extension sẽ match (glob style) */
  urlPatterns: string[];
  // VD: ["http://localhost:*/*", "https://*.ohmyhotelnco.com/*"]

  /** Framework adapter — chọn 1 trong số đăng ký */
  framework: {
    type: 'astro' | 'nextjs' | 'vue' | 'react' | 'generic';
    /** Astro */
    sourceAttributePrefix?: string;  // 'data-astro-source'
    /** Next.js */
    sourceMapEndpoint?: string;      // '/_next/source-map.json' nếu có
    /** Custom */
    customSelectorMap?: string;      // URL/path tới file mapping
  };

  /** Conventions của project */
  conventions: {
    sectionAttribute?: string;       // 'data-section' — null nếu không dùng
    i18nAttribute?: string;          // 'data-i18n-key'
    componentAttribute?: string;     // 'data-component' — đánh dấu component name
    pageAttribute?: string;          // 'data-page' — page identifier
  };

  /** Phát hiện locale từ URL/page */
  localeStrategy: {
    type: 'url-prefix' | 'subdomain' | 'cookie' | 'html-lang' | 'query-param' | 'none';
    /** URL prefix: '/{locale}/...' với supportedLocales ['en','ko','vi','ja','zh'] */
    supportedLocales?: string[];
    /** Query param: ?lang=ko */
    paramName?: string;
    /** Cookie: cookie name */
    cookieName?: string;
    /** Default khi không detect được */
    defaultLocale?: string;
  };

  /** Computed style properties cần auto-collect khi click */
  computedProps?: string[];
  // Default fallback nếu không có: COMPUTED_PROPS_DEFAULT (xem 8.3)

  /** Map page name từ URL pattern */
  pageDetection?: Array<{
    pattern: string;               // '/about*'
    pageName: string;              // 'about'
  }>;

  /** Jira sync defaults — đưa vào syncHints khi export */
  jira?: {
    projectKey: string;            // 'ELS'
    defaultParent?: string;        // 'ELS-1234'
    defaultMode?: 'append' | 'subtasks' | 'create-new';
    defaultLabels?: string[];      // ['qa', 'visual-fidelity']
    severityToPriority?: Record<string, string>;
    // {critical:'Highest', major:'High', minor:'Medium', info:'Low'}
    assigneeHint?: string;
  };

  /** Figma reference */
  figma?: {
    fileKey: string;
    linkTemplate: string;
    // 'https://figma.com/design/{fileKey}?node-id={nodeId}'
  };

  /** Screenshot hosting */
  screenshots?: {
    /** Base URL để generate raw GitHub link cho Jira description */
    githubRawBase?: string;
    // 'https://github.com/ohmyhotelco/home/raw/{branch}/docs/qa/reports/{date}/screenshots/'
    branch?: string;               // default branch name
  };

  /** Issue templates — preset cho QA gặp pattern lặp */
  issueTemplates?: Array<{
    id: string;
    label: string;                 // 'Font size mismatch'
    severity: string;
    type: string;
    titleTemplate?: string;        // '{section} · font-size {expected} → {actual}'
    noteTemplate?: string;
  }>;
}
```

### 4.2 Built-in profile: `home.qa-profile.json`

```json
{
  "$schema": "qa-profile-v1",
  "id": "home-omh",
  "name": "Ohmyhotel Co — Homepage (Astro V2-EN)",
  "description": "OMH marketing site (5 locales, Astro 5)",
  "version": "1.0.0",
  "createdAt": "2026-05-06T00:00:00Z",
  "updatedAt": "2026-05-06T00:00:00Z",

  "urlPatterns": [
    "http://localhost:*/*",
    "https://dev-ohmyhotelnco.ohmyhotel.com/*",
    "https://test-ohmyhotelnco.ohmyhotel.com/*",
    "https://ohmyhotelnco.com/*",
    "https://www.ohmyhotelnco.com/*"
  ],

  "framework": {
    "type": "astro",
    "sourceAttributePrefix": "data-astro-source"
  },

  "conventions": {
    "sectionAttribute": "data-section",
    "i18nAttribute": "data-i18n-key",
    "pageAttribute": "data-page"
  },

  "localeStrategy": {
    "type": "url-prefix",
    "supportedLocales": ["en", "ko", "vi", "ja", "zh"],
    "defaultLocale": "en"
  },

  "computedProps": [
    "fontSize", "fontWeight", "lineHeight", "fontFamily",
    "color", "backgroundColor",
    "width", "height",
    "padding", "margin",
    "borderRadius", "boxShadow",
    "display", "gap", "opacity"
  ],

  "pageDetection": [
    { "pattern": "/(/(en|ko|vi|ja|zh))?/?$",       "pageName": "home" },
    { "pattern": "/(/(en|ko|vi|ja|zh))?/about/?$", "pageName": "about" },
    { "pattern": "/(/(en|ko|vi|ja|zh))?/technology/?$", "pageName": "technology" },
    { "pattern": "/(/(en|ko|vi|ja|zh))?/business/?$", "pageName": "business" },
    { "pattern": "/(/(en|ko|vi|ja|zh))?/careers/?$", "pageName": "careers" },
    { "pattern": "/(/(en|ko|vi|ja|zh))?/newsroom/?$", "pageName": "newsroom" }
  ],

  "jira": {
    "projectKey": "ELS",
    "defaultParent": "ELS-1234",
    "defaultMode": "subtasks",
    "defaultLabels": ["qa", "visual-fidelity"],
    "severityToPriority": {
      "critical": "Highest",
      "major":    "High",
      "minor":    "Medium",
      "info":     "Low"
    }
  },

  "figma": {
    "fileKey": "bdRmMjKyxMegvVhGtH2Zwv",
    "linkTemplate": "https://figma.com/design/{fileKey}?node-id={nodeId}"
  },

  "screenshots": {
    "githubRawBase": "https://github.com/ohmyhotelco/home/raw/{branch}/docs/qa/reports/{date}/screenshots/",
    "branch": "main"
  },

  "issueTemplates": [
    {
      "id": "tpl-font-size",
      "label": "Font size mismatch",
      "severity": "major",
      "type": "visual",
      "titleTemplate": "{section} · font-size mismatch ({expected.fontSize} → {actual.fontSize})"
    },
    {
      "id": "tpl-i18n-missing",
      "label": "i18n key missing/wrong",
      "severity": "major",
      "type": "i18n"
    },
    {
      "id": "tpl-touch-target",
      "label": "Touch target < 44px",
      "severity": "minor",
      "type": "a11y"
    }
  ]
}
```

### 4.3 Empty profile template (cho project mới)

`templates/empty.qa-profile.json` — QA copy + edit khi onboard project mới.

---

## 5. File structure

```
qa-annotator-extension/
├── manifest.json
├── README.md
├── PLAN.md                          ← file này
├── CHANGELOG.md
├── package.json                     ← (tùy) npm scripts đóng gói
├── .gitignore
│
├── src/
│   ├── core/                        ← LAYER 2: framework-agnostic
│   │   ├── inspector.js             ← hover/click/highlight
│   │   ├── form-modal.js            ← modal in-page
│   │   ├── issue-builder.js         ← compose Issue object
│   │   ├── computed-styles.js       ← getComputedStyle helper
│   │   ├── unique-selector.js       ← vendor lib
│   │   └── id-generator.js          ← ISS-001, ISS-002, ...
│   │
│   ├── adapters/                    ← LAYER 3: framework-specific
│   │   ├── adapter-registry.js      ← lookup by type
│   │   ├── adapter-astro.js         ← reads data-astro-source-*
│   │   ├── adapter-nextjs.js        ← reads data-nextjs-* hoặc source map
│   │   ├── adapter-vue.js           ← reads data-v-* + Vue DevTools hooks
│   │   ├── adapter-react.js         ← reads __REACT_DEVTOOLS_GLOBAL_HOOK__
│   │   └── adapter-generic.js       ← fallback (không có source mapping)
│   │
│   ├── profile/                     ← profile manager
│   │   ├── profile-manager.js       ← load/save/import/export
│   │   ├── profile-validator.js     ← validate JSON schema
│   │   ├── profile-matcher.js       ← match URL → profile
│   │   └── built-in/
│   │       ├── home.qa-profile.json
│   │       └── empty.qa-profile.json
│   │
│   ├── content/                     ← LAYER 1 content scripts
│   │   ├── content.js               ← bootstrap, message handler
│   │   ├── content.css              ← styles có namespace .qa-*
│   │   └── overlay.js               ← floating bar trong page
│   │
│   ├── background/
│   │   └── service-worker.js        ← screenshot, downloads, relay
│   │
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js                 ← profile selector + toggle + count
│   │   └── popup.css
│   │
│   ├── sidebar/                     ← Phase 2 — Side Panel API
│   │   ├── sidebar.html
│   │   ├── sidebar.js
│   │   └── sidebar.css
│   │
│   ├── settings/                    ← Settings page (Phase 1)
│   │   ├── settings.html
│   │   ├── settings.js              ← UI quản lý profiles
│   │   ├── settings.css
│   │   └── components/
│   │       ├── profile-list.js
│   │       ├── profile-editor.js
│   │       └── profile-importer.js
│   │
│   └── lib/
│       ├── jszip.min.js             ← vendor (~95KB)
│       ├── exporter.js              ← JSON/MD/ZIP build
│       ├── glob-match.js            ← URL pattern matching
│       ├── locale-detector.js       ← áp dụng localeStrategy
│       └── messages.js              ← message constants
│
├── assets/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── templates/                       ← user import vào extension
│   ├── home.qa-profile.json         ← copy của built-in
│   └── empty.qa-profile.json
│
└── docs/
    ├── INSTALL.md
    ├── USER_GUIDE.md
    ├── PROFILE_GUIDE.md             ← cách viết profile cho project mới
    ├── ADAPTER_GUIDE.md             ← cách viết adapter mới (advanced)
    └── CLAUDE_PROMPTS.md
```

---

## 6. Manifest V3

```json
{
  "manifest_version": 3,
  "name": "QA Annotator (multi-project)",
  "short_name": "QA Annotator",
  "version": "0.1.0",
  "description": "Click any element on any website to log QA/QC issues. Project-aware via Profiles. Sync to Jira via Claude.",

  "minimum_chrome_version": "114",

  "permissions": [
    "activeTab",
    "storage",
    "scripting",
    "downloads",
    "tabs",
    "sidePanel"
  ],

  "host_permissions": [
    "<all_urls>"
  ],

  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "QA Annotator",
    "default_icon": {
      "16": "assets/icon-16.png",
      "32": "assets/icon-32.png",
      "48": "assets/icon-48.png"
    }
  },

  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "exclude_matches": [
        "*://chrome.google.com/*",
        "*://chromewebstore.google.com/*",
        "*://accounts.google.com/*"
      ],
      "js": [
        "src/lib/glob-match.js",
        "src/lib/locale-detector.js",
        "src/lib/messages.js",
        "src/core/unique-selector.js",
        "src/core/computed-styles.js",
        "src/core/id-generator.js",
        "src/adapters/adapter-generic.js",
        "src/adapters/adapter-astro.js",
        "src/adapters/adapter-nextjs.js",
        "src/adapters/adapter-vue.js",
        "src/adapters/adapter-react.js",
        "src/adapters/adapter-registry.js",
        "src/core/issue-builder.js",
        "src/core/inspector.js",
        "src/core/form-modal.js",
        "src/content/overlay.js",
        "src/content/content.js"
      ],
      "css": ["src/content/content.css"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],

  "side_panel": {
    "default_path": "src/sidebar/sidebar.html"
  },

  "options_page": "src/settings/settings.html",

  "icons": {
    "16":  "assets/icon-16.png",
    "32":  "assets/icon-32.png",
    "48":  "assets/icon-48.png",
    "128": "assets/icon-128.png"
  },

  "web_accessible_resources": [
    {
      "resources": [
        "src/profile/built-in/*.json",
        "templates/*.json"
      ],
      "matches": ["<all_urls>"]
    }
  ]
}
```

**Note về `<all_urls>`:**
- Cần để extension chạy mọi site
- Chrome sẽ cảnh báo "Read and change all your data on websites you visit" — chấp nhận được vì internal tool
- Inspector chỉ active khi user toggle ON → không tự động chạy
- Có thể xem xét `optional_host_permissions` nếu muốn user grant từng domain

---

## 7. UX/UI

### 7.1 Popup (click extension icon)

```
┌─ QA Annotator ────────────────────────────┐
│                                             │
│ Profile  [Home OMH ▾]   [+] Manage         │
│ ✓ URL match: localhost:4322                 │
│                                             │
│ Inspector   ◯───●  ON                       │
│                                             │
│ Page detected: home                         │
│ Locale:        en                           │
│ Viewport:      1280 × 800                   │
│                                             │
│ Issues on this URL: 3                       │
│   [ View all ▾ ]                           │
│                                             │
│ ──────────────────────────────              │
│                                             │
│  [ Open Side Panel ]                        │
│  [ Export ▾ ]                               │
│     ├─ JSON                                 │
│     ├─ Markdown                             │
│     └─ ZIP                                  │
│                                             │
│  [ Settings ↗ ]    [ Help ↗ ]               │
└─────────────────────────────────────────────┘
```

**State badge logic:**

| State | Badge |
|-------|-------|
| Profile chưa match URL | ⚠️ "No profile" — click để chọn/tạo |
| Profile match | ✓ "Home OMH" |
| Inspector ON | 🔴 đỏ chấm + count |
| Inspector OFF | ⚫ xám |

### 7.2 Settings page

```
┌─ QA Annotator — Settings ────────────────────────┐
│ ▼ Profiles                                         │
│                                                    │
│ ┌─────────────────────────────────────────────┐   │
│ │ ◉ home-omh    Ohmyhotel Co — Homepage        │   │
│ │   Astro · 5 locales · ELS · 6 patterns       │   │
│ │   [Edit]  [Duplicate]  [Export]  [Delete]    │   │
│ ├─────────────────────────────────────────────┤   │
│ │ ○ next-shop  Next.js shop                    │   │
│ │   Next.js · 1 locale · SHOP · 2 patterns     │   │
│ │   [Edit]  [Duplicate]  [Export]  [Delete]    │   │
│ └─────────────────────────────────────────────┘   │
│                                                    │
│ [ + New profile ]  [ Import from file ]  [ ⚙ Empty ]│
│                                                    │
│ ─────────────────────────────────────              │
│                                                    │
│ ▼ Active profile: home-omh                         │
│                                                    │
│  ▸ Basic                                           │
│    ID:           home-omh                          │
│    Name:         Ohmyhotel Co — Homepage           │
│    Description:  OMH marketing site (5 locales)    │
│                                                    │
│  ▸ URL patterns                                    │
│    ☑ http://localhost:*/*                          │
│    ☑ https://*.ohmyhotelnco.com/*                  │
│    [+ Add pattern]                                 │
│                                                    │
│  ▸ Framework                                       │
│    Type: ◉ Astro  ○ Next.js  ○ Vue  ○ Generic     │
│    Source attribute prefix: data-astro-source      │
│                                                    │
│  ▸ Conventions                                     │
│    Section attribute:  data-section                │
│    i18n attribute:     data-i18n-key               │
│                                                    │
│  ▸ Locale detection                                │
│    Strategy: ◉ URL prefix                          │
│    Supported: [en, ko, vi, ja, zh]                 │
│    Default:   en                                   │
│                                                    │
│  ▸ Page detection                                  │
│    /  → home                                       │
│    /about → about                                  │
│    [+ Add rule]                                    │
│                                                    │
│  ▸ Computed properties                             │
│    [✓ font-size  ✓ color  ✓ padding  …]            │
│    [+ Add property]                                │
│                                                    │
│  ▸ Jira sync                                       │
│    Project key:   ELS                              │
│    Default parent: ELS-1234                        │
│    Default mode:  subtasks                         │
│    Labels:        qa, visual-fidelity              │
│    Severity → Priority: critical→Highest, ...      │
│                                                    │
│  ▸ Figma                                           │
│    File key:  bdRmMjKyxMegvVhGtH2Zwv               │
│    Link tpl:  https://figma.com/design/{fileKey}…  │
│                                                    │
│  ▸ Screenshots                                     │
│    GitHub raw base: https://.../{branch}/docs/...  │
│    Branch: main                                    │
│                                                    │
│  ▸ Issue templates                                 │
│    [+ Font size mismatch]                          │
│    [+ i18n key missing]                            │
│    [+ Touch target < 44px]                         │
│                                                    │
│  [ Save changes ]  [ Discard ]                     │
└────────────────────────────────────────────────────┘
```

### 7.3 Profile picker (in popup)

Khi URL không match profile nào, popup hiển thị:

```
┌─ No profile match for this URL ──────────────┐
│                                                │
│  URL: https://example.com/                    │
│                                                │
│  Choose what to do:                            │
│                                                │
│  [ ◉ Use Generic profile (no auto-detect) ]   │
│  [ ○ Add this URL to existing profile  ▾ ]    │
│  [ ○ Create new profile from this URL    ]    │
│                                                │
│  [ Continue ]  [ Cancel ]                      │
└────────────────────────────────────────────────┘
```

### 7.4 Form modal (auto-fill theo profile)

```
┌─ Log issue · Profile: home-omh ──────────────┐
│ × close                                        │
│                                                │
│ ◉ Element                                      │
│   <h2 id="recognition-heading">                │
│   Selector: [data-section=…] #recognition-…   │
│   Source:   RecognitionSection.astro:83        │
│            (via Astro adapter)                 │
│   Section:  RecognitionSection                 │
│   i18n key: home.recognition.headline          │
│   Page:     home  ·  Locale: en                │
│                                                │
│ ◉ Computed (whitelist từ profile)              │
│   font-size:    36px                           │
│   line-height:  43.2px                         │
│   color:        rgb(25,31,40)                  │
│   font-weight:  700                            │
│                                                │
│ ◉ Quick template                               │
│   [ Font size mismatch ▾ ]                     │
│   [ i18n missing ]                             │
│   [ Touch target < 44px ]                      │
│                                                │
│ ◉ Issue                                        │
│   Severity:  ○ critical  ● major  ○ minor      │
│   Type:      [visual ▾]                        │
│                                                │
│   Title:                                       │
│   [Recognition · font-size 48 → 36__________]  │
│   (auto từ template)                           │
│                                                │
│   Expected:                                    │
│   font-size: [48px____]                        │
│   Figma node: [3882:39705_____] [Open Figma↗] │
│                                                │
│   Note:                                        │
│   ┌──────────────────────────────────────┐   │
│   │ H2 ở viewport 1280 nhỏ hơn 12px       │   │
│   └──────────────────────────────────────┘   │
│                                                │
│   📷 [ Capture screenshot ]                    │
│                                                │
│   [ Cancel ]   [ Save & continue ]             │
└────────────────────────────────────────────────┘
```

---

## 8. Adapter system

### 8.1 Adapter interface

```typescript
interface Adapter {
  type: string;               // 'astro' | 'nextjs' | …

  /** Có thể chạy trên page này không? Tự detect, không bắt buộc match profile */
  canHandle(): boolean;

  /** Lấy file:line nguồn của element */
  extractSource(el: Element, profile: Profile): {
    file: string | null;
    line: number | null;
    column: number | null;
  };

  /** Lấy section name */
  extractSection(el: Element, profile: Profile): string | null;

  /** Lấy i18n key */
  extractI18nKey(el: Element, profile: Profile): string | null;

  /** Lấy component name (nếu có) */
  extractComponent(el: Element, profile: Profile): string | null;
}
```

### 8.2 Astro adapter

```js
class AstroAdapter {
  type = 'astro';

  canHandle() {
    // Có element nào có data-astro-source-file không
    return !!document.querySelector('[data-astro-source-file]');
  }

  extractSource(el, profile) {
    const prefix = profile.framework.sourceAttributePrefix || 'data-astro-source';
    const fileAttr = `${prefix}-file`;
    const locAttr = `${prefix}-loc`;

    let cur = el;
    while (cur && cur !== document.body) {
      const file = cur.getAttribute(fileAttr);
      if (file) {
        const loc = cur.getAttribute(locAttr) || '';
        const [line, column] = loc.split(':').map(Number);
        return {
          file: this.normalizePath(file),
          line: line || null,
          column: column || null,
        };
      }
      cur = cur.parentElement;
    }
    return { file: null, line: null, column: null };
  }

  extractSection(el, profile) {
    const attr = profile.conventions.sectionAttribute;
    if (!attr) return null;
    return el.closest(`[${attr}]`)?.getAttribute(attr) || null;
  }

  extractI18nKey(el, profile) {
    const attr = profile.conventions.i18nAttribute;
    if (!attr) return null;
    return el.closest(`[${attr}]`)?.getAttribute(attr) || null;
  }

  extractComponent(el, profile) {
    const attr = profile.conventions.componentAttribute;
    if (!attr) return null;
    return el.closest(`[${attr}]`)?.getAttribute(attr) || null;
  }

  normalizePath(absPath) {
    // 'D:\Code\worktree\homepage\home\src\components\…' →
    // 'src/components/…'
    return absPath
      .replace(/\\/g, '/')
      .replace(/^.*\/(src|app|pages|components|lib)\//, '$1/');
  }
}
```

### 8.3 Generic adapter (fallback)

```js
class GenericAdapter {
  type = 'generic';
  canHandle() { return true; }

  extractSource() { return { file: null, line: null, column: null }; }
  extractSection(el, profile) {
    const attr = profile.conventions.sectionAttribute;
    if (!attr) return null;
    return el.closest(`[${attr}]`)?.getAttribute(attr) || null;
  }
  extractI18nKey(el, profile) { /* same pattern */ }
  extractComponent() { return null; }
}
```

### 8.4 Next.js adapter (Phase 2)

Next.js + React không có inline source attribute mặc định. 2 cách:

1. **Yêu cầu project bật `compilerOptions.devSrcAnnotation`** (từ Next 13+) → `data-next-component`/`__source` annotation
2. **Đọc React Fiber qua `__REACT_DEVTOOLS_GLOBAL_HOOK__`** — phức tạp, dễ break

→ Phase 2 sẽ chọn cách 1.

### 8.5 Vue adapter (Phase 2)

Vue có `data-v-{hash}` cho scoped CSS, không phải source mapping. Cần:
1. Yêu cầu Vite plugin `vite-plugin-vue-source-block` thêm `data-vue-source-file/loc`
2. Hoặc Vue DevTools hook

---

## 9. Data model

### 9.1 Issue

```typescript
interface Issue {
  id: string;                       // 'ISS-001'
  profileId: string;                // 'home-omh'  ← MỚI
  severity: 'critical' | 'major' | 'minor' | 'info';
  type: 'visual' | 'content' | 'i18n' | 'a11y' | 'interactive' | 'broken';
  title: string;

  page: string | null;              // detected từ profile.pageDetection
  section: string | null;
  component: string | null;         // mới — từ data-component nếu có

  element: {
    selector: string;
    tagName: string;
    textContent: string;
    attributes: Record<string, string>;
    rect: { x: number; y: number; w: number; h: number };
    i18nKey: string | null;
  };

  source: {
    file: string | null;
    line: number | null;
    column: number | null;
    adapter: string;                // 'astro' / 'generic' / ...
  };

  computed: Record<string, string>; // theo profile.computedProps

  expected: {
    /* free-form key/value, QA fill */
    fromFigma?: string;
    figmaLink?: string;
    customNote?: string;
  };

  actual: Record<string, string>;
  delta: Record<string, number | string>;

  screenshot: {
    filename: string;
    relativePath: string;
    dataUrl: string | null;
    captureViewport: { w: number; h: number };
    capturedAt: string;
  } | null;

  note: string;

  context: {
    url: string;
    locale: string | null;
    viewport: { w: number; h: number };
    userAgent: string;
    branch?: string;
    commitHash?: string;
  };

  createdAt: string;
  updatedAt: string;
  synced: null | { to: string; mode: string; syncedAt: string };

  /** Template được dùng nếu có */
  templateId?: string;
}
```

### 9.2 Report (export)

Y nguyên Plan v1, thêm field:

```typescript
interface Report {
  $schema: 'qa-report-v1';
  report: {
    tool: 'omh-qa-extension';
    toolVersion: string;
    profile: {                      // ← MỚI: snapshot profile khi export
      id: string;
      name: string;
      version: string;
    };
    reporter: string | null;
    exportedAt: string;
    scope: { /* … */ };
    syncHints: { /* từ profile.jira */ };
    counts: { /* … */ };
    issues: Issue[];
  };
}
```

### 9.3 Storage layout

```
chrome.storage.local:
  ├── settings:global               { reporterName, lastActiveProfileId }
  ├── profiles                      Profile[] (tất cả profile)
  ├── issues:{origin}               Issue[] (per origin)
  ├── inspector:state               { enabled, tabId, activeProfileId }
  └── counter:{profileId}           number — ID counter per profile
```

---

## 10. Profile manager API

```js
// src/profile/profile-manager.js

class ProfileManager {
  async list() { /* return all profiles */ }
  async get(id) { /* return profile by id */ }
  async create(profile) { /* validate + save */ }
  async update(id, patch) { /* */ }
  async delete(id) { /* */ }
  async duplicate(id, newId) { /* */ }
  async exportToFile(id) { /* download .qa-profile.json */ }
  async importFromFile(file) { /* validate + merge */ }
  async findMatchingProfile(url) {
    // Loop profiles, return first whose urlPatterns match url (glob)
  }
  async setActive(profileId, tabId) { /* */ }
  async getActive(tabId) { /* */ }
  async loadBuiltInProfiles() {
    // Đọc src/profile/built-in/*.json, merge với user profiles (giữ user override)
  }
}
```

---

## 11. Detailed flow

### 11.1 Khởi động extension lần đầu

1. Service worker kiểm tra `profiles` trong storage
2. Nếu trống → load built-in profiles (`home.qa-profile.json`)
3. Lưu vào storage
4. Hiển thị notification: "Welcome! 1 built-in profile loaded. [Settings →]"

### 11.2 User mở tab → match profile

1. `chrome.tabs.onUpdated` listener trong service worker
2. Tab URL → `profileManager.findMatchingProfile(url)`
3. Set badge popup theo state (match / no-match)
4. Lưu `inspector:state.activeProfileId`

### 11.3 User toggle Inspector ON

1. Popup gửi message `INSPECTOR_TOGGLE` xuống content
2. Content script:
   - Đọc active profile từ storage
   - Lookup adapter từ `profile.framework.type` qua AdapterRegistry
   - Add overlay + listeners
3. Cursor crosshair
4. Hover element → tooltip hiển thị: `tag · computed.fontSize · sourceFile:line` (nếu adapter trả được)

### 11.4 User click element

1. Content script preventDefault + stopPropagation
2. Build Issue partial:
   ```js
   const adapter = adapterRegistry.get(profile.framework.type);
   const source  = adapter.extractSource(el, profile);
   const section = adapter.extractSection(el, profile);
   const i18nKey = adapter.extractI18nKey(el, profile);
   const computed = pickComputedStyles(el, profile.computedProps);
   const locale = localeDetector.detect(window.location, document, profile.localeStrategy);
   const page   = pageDetector.detect(window.location, profile.pageDetection);

   const issue = issueBuilder.build({
     profileId: profile.id,
     element: { /* ... */ },
     source: { ...source, adapter: adapter.type },
     section, i18nKey, computed, locale, page,
     context: { /* viewport, UA, ... */ }
   });
   ```
3. Open form modal với data đã prefill
4. Form hiển thị templates từ `profile.issueTemplates`

### 11.5 Save issue

1. Validate
2. Gen ID `ISS-${counter}` per profile (counter:{profileId})
3. Capture screenshot (optional)
4. Save vào `issues:{origin}`
5. Update badge

### 11.6 Export

1. Đọc issues theo origin (hoặc filter)
2. Resolve profile snapshot
3. Build syncHints từ `profile.jira`
4. Build JSON / MD / ZIP
5. Download

### 11.7 Sync to Jira (manual qua Claude)

QA workflow:

```
QA: "Đính kèm qa-report-2026-05-06.json. Sync to Jira theo syncHints."

Claude:
1. Parse JSON
2. Đọc report.syncHints:
   - mode: subtasks
   - parent: ELS-1234
   - labels: [qa, visual-fidelity]
   - severityToPriority: {...}
3. Verify ELS-1234 (jira_get_issue)
4. Loop issues:
   jira_create_issue({
     project: 'ELS',
     issuetype: 'Sub-task',
     parent: 'ELS-1234',
     summary: `[QA] ${issue.section} · ${issue.title}`,
     description: buildADF(issue),  // table expected/actual
     priority: severityToPriority[issue.severity],
     labels: [...defaultLabels, `viewport-${w}`, `locale-${l}`]
   })
5. (Optional) git add/commit screenshots → push
6. Report back: ELS-2001 → ELS-2015
7. Update qa-report.json synced fields, save lại
```

---

## 12. Roadmap & milestones

### Phase 1 — MVP generic (target: 2-3 ngày)

| # | Task | File | Done? |
|---|------|------|-------|
| 1 | Manifest V3 + icon | `manifest.json`, `assets/` | ☐ |
| 2 | Profile schema + validator | `src/profile/profile-validator.js` | ☐ |
| 3 | Profile manager (CRUD) | `src/profile/profile-manager.js` | ☐ |
| 4 | URL matcher (glob) | `src/lib/glob-match.js` | ☐ |
| 5 | Built-in profile: home | `src/profile/built-in/home.qa-profile.json` | ☐ |
| 6 | Adapter interface + registry | `src/adapters/adapter-registry.js` | ☐ |
| 7 | Astro adapter | `src/adapters/adapter-astro.js` | ☐ |
| 8 | Generic adapter | `src/adapters/adapter-generic.js` | ☐ |
| 9 | Locale detector | `src/lib/locale-detector.js` | ☐ |
| 10 | Page detector | `src/lib/page-detector.js` | ☐ |
| 11 | Computed-styles helper | `src/core/computed-styles.js` | ☐ |
| 12 | Vendor unique-selector | `src/core/unique-selector.js` | ☐ |
| 13 | ID generator (per profile) | `src/core/id-generator.js` | ☐ |
| 14 | Inspector engine | `src/core/inspector.js` | ☐ |
| 15 | Form modal in-page | `src/core/form-modal.js` + CSS | ☐ |
| 16 | Issue builder | `src/core/issue-builder.js` | ☐ |
| 17 | Content bootstrap | `src/content/content.js` | ☐ |
| 18 | Background service worker | `src/background/service-worker.js` | ☐ |
| 19 | Popup UI (profile picker + toggle + count) | `src/popup/*` | ☐ |
| 20 | Settings page (profile list + editor + import/export) | `src/settings/*` | ☐ |
| 21 | Exporter JSON | `src/lib/exporter.js` | ☐ |
| 22 | Exporter Markdown | `src/lib/exporter.js` | ☐ |
| 23 | Exporter ZIP (vendor JSZip) | `src/lib/exporter.js` + `jszip.min.js` | ☐ |
| 24 | INSTALL.md | `docs/INSTALL.md` | ☐ |
| 25 | USER_GUIDE.md | `docs/USER_GUIDE.md` | ☐ |
| 26 | PROFILE_GUIDE.md | `docs/PROFILE_GUIDE.md` | ☐ |
| 27 | CLAUDE_PROMPTS.md | `docs/CLAUDE_PROMPTS.md` | ☐ |

### Phase 2 — Polish (~1.5 ngày)

- Side Panel UI thay popup-only
- Edit/delete/duplicate issue
- Filter & search trong sidebar
- Import lại JSON cũ tiếp tục
- "Jump to element" — scroll & highlight
- Issue templates auto-fill nâng cao
- Multi-tab sync
- Nextjs adapter
- Vue adapter
- ADAPTER_GUIDE.md

### Phase 3 — Advanced (optional)

- Figma overlay (paste URL → fetch screenshot via Figma API key)
- Pixel diff canvas-based
- DevTools panel
- Sync ngược: Jira webhook → cập nhật trạng thái issue
- Auto build production source-map (script ở project repo)
- Profile marketplace (share giữa team)

---

## 13. Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `<all_urls>` Chrome cảnh báo bảo mật | low | Internal tool, chấp nhận; document kỹ trong README |
| Profile JSON sai schema → crash | medium | Strict validator (AJV-lite hoặc custom), reject với UX rõ |
| Adapter Astro không hoạt động (prod build) | high | Document yêu cầu dev mode; Phase 3 source-map fallback |
| URL pattern conflict (2 profiles match) | medium | Profile có thứ tự ưu tiên; UI hiển thị conflict warning |
| Storage quota (5MB) bị chiếm bởi screenshots | high | Dataurl xóa sau export ZIP; có cảnh báo "near limit" |
| Selector unique fail trên SPA dynamic | medium | Lưu thêm textContent + section path để re-locate |
| User import profile với code injection | low | Validator chỉ accept whitelist properties; CSP nghiêm |
| Service worker MV3 idle | medium | `chrome.alarms` ping mỗi 25s khi inspector ON |
| Built-in profile thay đổi version → user lost custom | medium | Migration logic: version bump → diff → confirm UX |
| Vendor JSZip 95KB tăng kích thước extension | low | Acceptable; lazy-load khi click "Export ZIP" |

---

## 14. Testing strategy

### 14.1 Manual test cases

#### Generic core
1. Click h1 trên `localhost:4322/` (home OMH) → form mở
2. Click h1 trên `https://example.com/` → form mở (generic adapter)
3. Toggle Inspector → cursor crosshair / normal
4. Save issue → counter +1 trong popup
5. Reload page → issue vẫn còn
6. Switch tab → issue list theo origin

#### Profile
7. Tạo profile mới qua Settings UI → save → match URL
8. Import profile từ file `.qa-profile.json` hợp lệ
9. Import profile sai schema → reject với message
10. Export profile → file tải về mở được
11. URL match nhiều profile → hiển thị conflict warning
12. Profile delete → issues vẫn còn (không bị mất)

#### Adapter
13. Site Astro dev → file:line đúng
14. Site Astro prod (no source-attr) → "n/a" gracefully
15. Site Next.js → adapter generic fallback (Phase 1)
16. Element không có closest section → `section: null`

#### Export
17. Export JSON → schema match `qa-report-v1`
18. Export JSON → có `profile.id` snapshot
19. Export MD → render được trên GitHub preview
20. Export ZIP → giải nén có JSON + MD + screenshots

#### Locale/page
21. URL `/ko/` → `locale: 'ko'`
22. URL `/about/` → `page: 'about'`
23. URL không match pattern → `page: null`, `locale: defaultLocale`

#### Sync (Claude prompt)
24. Đính kèm qa-report.json + sample prompt → Claude tạo Jira subtasks
25. Sync mode `append` → description Jira đúng format

### 14.2 Browser/version

- Chrome 114+ (MV3, Side Panel)
- Edge Chromium 114+
- Brave latest

### 14.3 Test sites

- `localhost:4322` (home OMH dev)
- `https://www.ohmyhotelnco.com` (home OMH prod)
- `https://nextjs.org` (Next.js example)
- `https://vuejs.org` (Vue example)
- `https://example.com` (plain HTML)
- `https://github.com` (complex SPA)

---

## 15. Sample Claude prompts

Sẽ viết đầy đủ vào `docs/CLAUDE_PROMPTS.md`. Sample chính:

### A. Tạo subtasks dưới parent (theo syncHints)

```
Đính kèm: docs/qa/reports/2026-05-06/qa-report.json
+ docs/qa/reports/2026-05-06/screenshots/

Yêu cầu:
1. Đọc report.profile và report.syncHints — config từ profile.
2. Verify syncHints.suggestedParent (jira_get_issue).
3. Với mỗi issue (skip nếu issue.synced != null):
   - jira_create_issue:
     project: report.syncHints.suggestedJiraProject
     type: Sub-task
     parent: report.syncHints.suggestedParent
     summary: "[QA] {section} · {title}"
     description: ADF với:
       - Heading 2: "{id} · {severity}/{type}"
       - Table: Property | Expected | Actual | Delta (từ expected/actual/delta)
       - Blockquote: note
       - Paragraph: Figma link, screenshot URL (GitHub raw)
     priority: từ severityToPriority map
     labels: defaultLabels + ["viewport-{w}", "locale-{l}", "section-{kebab}", type]
4. Sau khi tạo, in summary: ISS-x → ELS-y URL
5. Update qa-report.json: gán synced field + lưu lại
```

### B. Append vào task có sẵn

```
Đính kèm qa-report.json.
Append toàn bộ issues vào description của ELS-1234.
Header: "## QA Report — {date} by {reporter}".
Mỗi issue 1 H3 + table.
```

### C. Tạo task mới mỗi issue (deduplicate)

```
Đính kèm qa-report.json.
Với mỗi issue:
1. Search duplicate: JQL `project = ELS AND labels in (qa) AND summary ~ "{title}"`
2. Nếu có duplicate, comment vào ticket cũ, mark synced với mode='comment'.
3. Nếu không, jira_create_issue (Bug type).
```

### D. Update đã có

```
Issue ISS-005 trong qa-report.json là duplicate của ELS-1900.
Comment vào ELS-1900 + screenshot link.
Mark ISS-005.synced = ELS-1900 (mode: comment).
Save lại qa-report.json.
```

---

## 16. Quyết định mở (cần xác nhận trước khi code)

### 16.1 Build/bundle

- (A) **Vanilla JS, không bundler** — load file trực tiếp
- (B) Vite + CRX plugin
- (C) ESBuild minimal

→ **Đề xuất A** — Phase 1 đơn giản nhất, không phụ thuộc node_modules. Nếu phình to chuyển sang B.

### 16.2 Profile validator

- (A) Custom validator (~100 dòng) — không phụ thuộc lib
- (B) AJV (~200KB) — đầy đủ JSON Schema
- (C) Zod compile-time + runtime — TS

→ **Đề xuất A** — đủ dùng cho Phase 1.

### 16.3 Vendor libraries

| Lib | Version | Size | Vendor / npm? |
|-----|---------|------|---------------|
| `unique-selector` | 0.5.x | ~5KB | Vendor (copy file) |
| `JSZip` | 3.10.x | ~95KB | Vendor (CDN file) |
| Glob match | – | ~2KB | Tự viết |
| URL parser | – | – | Browser native URL |

### 16.4 Distribution

- Phase 1: Load unpacked
- Phase 2: Pack `.crx`, share file ZIP cho QA
- Phase 3: Chrome Web Store private listing

### 16.5 Versioning

- Extension version semver bắt đầu `0.1.0`
- Profile schema version bắt đầu `qa-profile-v1` — bump khi breaking change

---

## 17. Acceptance criteria — Phase 1

Phase 1 done khi:

### Generic core
- [ ] Cài extension Load unpacked không lỗi
- [ ] Inspector ON/OFF hoạt động trên `localhost:4322/`
- [ ] Click element → form mở với computed styles
- [ ] Save issue → counter tăng
- [ ] Reload page → issue vẫn còn
- [ ] Switch tab → list theo origin

### Profile
- [ ] Built-in profile `home-omh` load tự động
- [ ] URL `localhost:4322/` match profile → popup hiển thị "Home OMH"
- [ ] URL `https://example.com/` không match → popup hiển thị "No profile"
- [ ] Settings page hoạt động: list, edit, save, delete, duplicate
- [ ] Import file `.qa-profile.json` hợp lệ → success
- [ ] Import file sai schema → error message rõ
- [ ] Export profile → file tải về mở được

### Adapter
- [ ] Astro adapter detect `data-astro-source-*` → file:line đúng (dev mode)
- [ ] Generic adapter fallback khi Astro không detect được
- [ ] Section/i18n key extract đúng theo `profile.conventions`

### Locale/page
- [ ] URL `/ko/` → `locale: 'ko'` trong issue
- [ ] URL `/about/` match `pageDetection` → `page: 'about'`

### Export
- [ ] Export JSON khớp schema `qa-report-v1`
- [ ] JSON có `profile.id` snapshot + `syncHints` từ profile
- [ ] Export MD render được trên GitHub
- [ ] Export ZIP có JSON + MD + screenshots/*.png

### Sync (manual)
- [ ] Test với Claude prompt A → tạo Jira subtasks ELS-x → ELS-(x+2)
- [ ] qa-report.json sau sync có `synced.to` đúng

### Documentation
- [ ] `INSTALL.md`, `USER_GUIDE.md`, `PROFILE_GUIDE.md`, `CLAUDE_PROMPTS.md` đủ

---

## 18. Mở rộng codebase home để hỗ trợ extension

Trong repo `home/`:

1. **Đảm bảo `data-section`** — đã có ✓
2. **Bật Astro source maps**:
   ```js
   // astro.config.mjs (dev mode)
   export default defineConfig({
     vite: { build: { sourcemap: true } },
   });
   ```
3. **(Optional) Thêm `data-i18n-key` script**:
   - Astro integration plugin scan `tr('home.hero.headline')` → inject `data-i18n-key`
   - Hoặc manual cho component quan trọng
4. **Tạo `docs/qa/`**:
   ```
   docs/qa/
     reports/             ← QA save report ở đây
     README.md            ← Workflow + sample Claude prompts
     home.qa-profile.json ← Mirror copy của profile (cho QA download)
   ```

→ Các thay đổi này thuộc home repo, sẽ commit trong PR riêng (`feat/qa-tooling`).

---

## 19. Câu hỏi user xác nhận trước khi code

### Architecture

1. **Build approach**: Vanilla JS (A) hay Vite (B)? → Đề xuất A
2. **Profile validator**: Custom (A), AJV (B), Zod (C)? → Đề xuất A
3. **Adapter ưu tiên Phase 1**: chỉ Astro + Generic, hay thêm Next/Vue ngay?

### UX

4. **Side Panel** vs popup-only ở Phase 1: thêm Side Panel ngay (~3-4 task) hay Phase 2?
5. **Profile conflict** (2 profile match cùng URL): UI nào — auto pick first / popup chooser / mark warning?
6. **Issue templates** Phase 1: nên có (3 mặc định trong home profile) hay để Phase 2?

### Profile + Distribution

7. **Built-in profile**: đặt trực tiếp trong `src/profile/built-in/` hay load qua `chrome.runtime.getURL('templates/home.qa-profile.json')`?
8. **Distribution**: Load unpacked đủ chưa, hay cần đóng gói `.crx`?
9. **Repo**: extension repo `D:\Github\qa-annotator-extension` cần init git ngay, push GitHub remote nào? (URL?)

### Home repo integration

10. **Branch tích hợp**: tạo nhánh `feat/qa-tooling` trong `home/` cho changes (sourcemap config, docs/qa/, profile mirror) — ok?
11. **Auto inject `data-i18n-key`** vào home repo: viết script ngay (Phase 1) hay defer Phase 2?

### Misc

12. **Icon**: tự tạo placeholder hay user upload?
13. **Phase 1 timeline**: 2-3 ngày OK chứ?

---

## 20. Status

- 2026-05-06 — **Plan v2 written** (generic + profile architecture). Awaiting user verification.
- v1 → v2 changelog:
  - Thêm Layer adapter system + Profile manager
  - Generic core (`<all_urls>` + profile-based)
  - Settings UI quản lý profile
  - Built-in profile `home-omh`
  - Adapter API cho Astro / Next / Vue / Generic
  - Issue templates trong profile
- Next: user verify → start Phase 1 build.
