# QA Plugin for Claude Code · Plan

> **Vấn đề:** Extension setup ban đầu (profile config, conventions, Figma key, Jira mapping) tốn thời gian.
> **Giải pháp:** Claude Code plugin tự auto-detect mọi thứ từ src code + Figma + git, sinh profile + reports + Jira tickets.
>
> **Repo plugin:** `D:\Github\qa-annotator-extension\plugin` (hoặc tách riêng)
> **Last updated:** 2026-05-06

---

## 1. Tại sao plugin Claude Code?

### So sánh với Extension thuần

| Việc | Chrome Extension | Claude Code Plugin |
|---|---|---|
| Đọc src code dự án | ❌ Không có file system | ✅ Read/Glob/Grep tools |
| Auto-detect framework (Astro/Next/...) | Manual config | ✅ Đọc `package.json` |
| Auto-detect Figma file key | Manual paste | ✅ Đọc `.claude/homepage-plugin.json` / `figma.config.json` |
| Auto-detect i18n keys & locales | Manual | ✅ Glob `src/i18n/*.json` |
| Auto-detect sections & components | Manual | ✅ Grep `data-section=` |
| Auto-detect Jira project | Manual | ✅ Đọc git remote, branch name pattern |
| Tạo/cập nhật Jira | HTTP API | ✅ MCP Atlassian tools (đã connect) |
| Lấy Figma screenshots | Cần Figma API key | ✅ MCP Figma tools (đã connect) |
| Run dev server | ❌ | ✅ Bash tool |
| Capture rendered screenshots | ❌ | ✅ MCP chrome-devtools |
| Visual diff (rendered vs Figma) | Không | ✅ Vision capability native |
| Commit reports vào repo | Không | ✅ Bash git |
| Generate code fixes | Không | ✅ Edit/Write tools |

### Workflow mới với plugin

```
Cũ (Extension thuần):
1. QA cài extension                      [10 min]
2. QA fill profile manually              [30 min config + Figma key + Jira ...]
3. QA test website + click + note       [3 hours]
4. QA export, gửi Claude prompt         [10 min compose prompt]
5. Claude tạo Jira                       [5 min]
   Total: ~4 hours per session

Mới (Plugin + Extension):
1. QA chạy /qa:init trong dự án          [< 30s — auto detect tất cả]
2. QA cài extension + import profile     [< 1 min]
3. QA test website + click + note        [3 hours]
4. QA chạy /qa:sync                      [< 30s — claude tự đọc reports + Jira]
   Total: ~3 hours, save ~1 hour overhead
```

---

## 2. Tổng quan plugin

### 2.1 Tên & namespace

```
Plugin name: qa-tooling
Slash commands: /qa:*
Skills: qa-*
```

### 2.2 Cấu trúc plugin

```
qa-tooling-plugin/
├── plugin.json                       ← manifest
├── README.md
│
├── commands/                          ← slash commands
│   ├── qa-init.md                     ← /qa:init
│   ├── qa-doctor.md                   ← /qa:doctor
│   ├── qa-profile.md                  ← /qa:profile
│   ├── qa-sync.md                     ← /qa:sync
│   ├── qa-fix.md                      ← /qa:fix
│   ├── qa-review.md                   ← /qa:review
│   ├── qa-screenshot.md               ← /qa:screenshot
│   └── qa-report.md                   ← /qa:report
│
├── skills/                            ← reusable agents/skills
│   ├── qa-detect-stack/
│   │   └── SKILL.md
│   ├── qa-generate-profile/
│   │   └── SKILL.md
│   ├── qa-sync-jira/
│   │   └── SKILL.md
│   ├── qa-figma-diff/
│   │   └── SKILL.md
│   ├── qa-inject-attributes/
│   │   └── SKILL.md
│   └── qa-fix-issues/
│       └── SKILL.md
│
├── templates/
│   ├── empty.qa-profile.json
│   ├── README-qa.md
│   └── claude-prompts.md
│
├── scripts/                           ← node scripts plugin chạy qua Bash
│   ├── detect-stack.mjs
│   ├── generate-profile.mjs
│   ├── inject-i18n-keys.mjs
│   └── validate-profile.mjs
│
└── docs/
    ├── INSTALL.md
    └── COMMAND_REFERENCE.md
```

### 2.3 Quan hệ với extension

```
┌─────────────────────────────────────────────┐
│  Claude Code Plugin (qa-tooling)             │
│  - Slash commands cho dev/QA                 │
│  - Auto-generate profile từ src              │
│  - Sync Jira qua MCP                         │
│  - Visual diff Figma                         │
└────────────────┬────────────────────────────┘
                 │ generate
                 ▼
┌─────────────────────────────────────────────┐
│  qa-profile.json                             │
│  (output của plugin, input của extension)    │
└────────────────┬────────────────────────────┘
                 │ import
                 ▼
┌─────────────────────────────────────────────┐
│  Chrome Extension (QA Annotator)             │
│  - Click + note + export                     │
└────────────────┬────────────────────────────┘
                 │ export ZIP
                 ▼
┌─────────────────────────────────────────────┐
│  qa-report.json + screenshots/               │
│  (output extension, input plugin)            │
└────────────────┬────────────────────────────┘
                 │ /qa:sync
                 ▼
┌─────────────────────────────────────────────┐
│  Claude Plugin → MCP Atlassian → Jira        │
└─────────────────────────────────────────────┘
```

**Plugin = đầu mối**: dev khởi tạo + sync kết quả. Extension = công cụ field cho QA.

---

## 3. Slash commands đề xuất

### 3.1 `/qa:init`

**Mục đích:** Bootstrap QA tooling cho dự án hiện tại — auto-detect mọi thứ.

**Input:** Không cần argument (hoặc optional `--target home`)

**Output:**
- `docs/qa/qa-profile.json` — profile cho extension
- `docs/qa/README.md` — hướng dẫn QA
- `docs/qa/reports/.gitkeep` — folder reports
- `.gitignore` updated (ignore `*.zip` tạm)

**Steps Claude làm:**
1. Đọc `package.json` → detect framework (`astro`, `next`, `vue`, `react`)
2. Đọc `astro.config.mjs` / `next.config.js` → detect locales, base URL, build output
3. Đọc `.claude/homepage-plugin.json` (nếu có) → lấy `figmaFileKey`
4. Đọc `src/i18n/*.json` → list locales + sample i18n keys
5. Glob `src/components/**/*.astro` → tìm `data-section=` → list sections
6. Đọc `git remote get-url origin` → infer GitHub raw base
7. Đọc `git config user.email` → reporter name
8. Hỏi user (nếu thiếu):
   - Jira project key (default: từ branch name pattern `ELS-*` → `ELS`)
   - Default parent ticket (optional)
9. Build profile JSON với tất cả info
10. Validate + write file
11. Print summary + next steps

**Sample output:**
```
✓ Detected stack:
  - Framework: Astro 5.18.1
  - Locales:   en, ko, vi, ja, zh
  - Sections:  16 (HeroSection, RecognitionSection, ...)
  - Figma:     bdRmMjKyxMegvVhGtH2Zwv (from .claude/homepage-plugin.json)
  - Git:       github.com/ohmyhotelco/home (branch: implement-home-page)

✓ Generated:
  - docs/qa/qa-profile.json (1.2KB)
  - docs/qa/README.md
  - docs/qa/reports/

? Jira project key (auto-detected ELS): _
? Default parent ticket (optional): ELS-1234

✓ Profile saved.

Next steps:
  1. Install Chrome extension → Settings → Import → docs/qa/qa-profile.json
  2. Test website with extension
  3. Run /qa:sync to create Jira tickets from QA reports
```

---

### 3.2 `/qa:doctor`

**Mục đích:** Health check — kiểm tra setup có gì thiếu/sai.

**Output:** Checklist với pass/fail/warn.

**Checks:**
- ✓ Plugin config (`docs/qa/qa-profile.json` exists, valid schema)
- ✓ Astro source maps enabled (`astro.config.mjs` → `vite.build.sourcemap`)
- ✓ `data-section` attributes có trong source
- ⚠ `data-i18n-key` thiếu — gợi ý chạy `/qa:inject-i18n`
- ✓ MCP Atlassian connected (test `jira_search` query trống)
- ✓ MCP Figma connected (test `get_metadata` ngắn)
- ✓ Reports folder exists, có `.gitkeep`
- ⚠ `.gitignore` chưa có `*.zip` exclude

---

### 3.3 `/qa:profile`

**Mục đích:** Quản lý profile — view/edit/export.

**Sub-commands:**
- `/qa:profile show` — print current profile JSON
- `/qa:profile validate` — validate against schema
- `/qa:profile export` — copy to clipboard (cho QA paste vào extension)
- `/qa:profile update` — interactive edit field nào đó (Jira project, Figma key, locales)
- `/qa:profile add-page <name> <pattern>` — thêm page detection rule
- `/qa:profile sync-from-figma` — fetch Figma file → update component-map

---

### 3.4 `/qa:sync`

**Mục đích:** Đọc QA report ZIP/JSON → tạo/update Jira tickets.

**Input:**
```
/qa:sync <report-path-or-zip> [--mode subtasks|append|create] [--parent ELS-1234]
```

**Defaults:** Đọc từ `docs/qa/reports/{latest}/qa-report.json`, dùng `syncHints` trong report.

**Steps:**
1. Đọc report JSON
2. Validate schema
3. Áp dụng `syncHints` (hoặc CLI override)
4. (Optional) Commit screenshots vào repo, push để có raw GitHub URL
5. MCP Atlassian:
   - Verify parent
   - Loop issues, skip nếu `synced != null`
   - Build ADF description
   - Create issue (subtask/task) hoặc update (append/comment)
6. Update qa-report.json với synced fields
7. Save back vào file
8. Print summary + Jira links

**Sample output:**
```
Reading: docs/qa/reports/2026-05-06/qa-report.json
Profile: home-omh
Mode:    subtasks (from syncHints)
Parent:  ELS-1234

✓ Verified parent: "Implement Home Page V2-EN"
✓ Committed 15 screenshots → pushed to github.com/.../home

Creating Jira subtasks...
[1/15] ISS-001 H2 size mismatch              → ELS-2001
[2/15] ISS-002 Card shadow too light         → ELS-2002
...
[15/15] ISS-015 ...                          → ELS-2015

✓ Updated report: 15 issues marked synced
✓ Done.

View tasks: https://....atlassian.net/browse/ELS-1234
```

---

### 3.5 `/qa:fix`

**Mục đích:** Đọc QA report → tự sửa code các issue có thể auto-fix.

**Logic:** Filter issues có `expected.fontSize` (hoặc property cụ thể) khác `actual.*` → patch source file/line.

**Safety:**
- Hiển thị diff trước khi apply
- Không tự commit — chỉ stage changes
- Skip issues `severity: critical` (cần human review)
- Skip issues `type: visual` mà không có expected field cụ thể

**Sample:**
```
/qa:fix docs/qa/reports/2026-05-06/qa-report.json

Analyzing 15 issues...
- 8 issues auto-fixable (visual property mismatch)
- 5 issues need human review (content/i18n)
- 2 issues critical → skip

Auto-fix candidates:
[1] ISS-001 RecognitionSection.astro:83 — fontSize 36 → 48
[2] ISS-003 AwardCard.astro:39           — boxShadow blur 16 → 24
...

? Apply all? [y/N/select]
```

---

### 3.6 `/qa:review`

**Mục đích:** Mở Jira ticket → đọc QA notes → run visual diff với Figma → đề xuất sửa.

**Workflow:**
```
/qa:review ELS-2001

→ MCP jira_get_issue(ELS-2001) → đọc description
→ Parse: file=RecognitionSection.astro:83, expected fontSize 48px
→ MCP figma_get_screenshot(node-id 3882:39705)
→ MCP chrome-devtools navigate + take_screenshot
→ Visual compare (vision)
→ Đề xuất: edit file, commit, comment back vào Jira
```

---

### 3.7 `/qa:screenshot`

**Mục đích:** Capture screenshot từng section từng viewport, lưu vào `docs/design-system/screenshots/rendered/`.

**Input:**
```
/qa:screenshot <page> [--viewports 360,768,1280,1920] [--sections all]
```

**Steps:**
1. Đọc profile để biết URL pattern + sections
2. Chạy dev server (`npm run dev`)
3. Mở chrome-devtools, navigate
4. Loop viewports × sections:
   - Resize page
   - Scroll to section
   - take_screenshot
   - Save với naming convention `{section}-{viewport}.png`
5. Update `component-map.json` với screenshotRef

**Use case:** Sau khi fix code, capture lại screenshots để compare với Figma.

---

### 3.8 `/qa:report`

**Mục đích:** Generate human-readable report từ qa-report.json.

**Output formats:**
- Markdown (default — nhân viên đọc)
- HTML (có embed screenshots)
- PDF (cho stakeholder)
- Slack message (có embed link)

```
/qa:report docs/qa/reports/2026-05-06/qa-report.json --format md > report.md
/qa:report docs/qa/reports/2026-05-06/qa-report.json --format slack
```

---

## 4. Skills (reusable agents)

Skills khác commands ở chỗ:
- **Command** = entry point user gõ
- **Skill** = unit of work tái sử dụng giữa commands

### 4.1 `qa-detect-stack`

Detect framework, locales, conventions của project hiện tại.

**Inputs:** `projectRoot` path
**Outputs:**
```json
{
  "framework": { "type": "astro", "version": "5.18.1" },
  "locales": ["en","ko","vi","ja","zh"],
  "defaultLocale": "en",
  "sections": [...],
  "components": [...],
  "i18nFiles": [...],
  "figmaFileKey": "...",
  "githubRemote": "github.com/...",
  "branch": "...",
  "conventions": { "sectionAttribute": "data-section", ... }
}
```

**Used by:** `/qa:init`, `/qa:doctor`

### 4.2 `qa-generate-profile`

Build qa-profile.json từ stack info + user input.

**Inputs:** Stack info object, user answers (Jira project, parent)
**Outputs:** Validated profile JSON

**Used by:** `/qa:init`

### 4.3 `qa-sync-jira`

Loop qua issues của report → MCP create/update tickets.

**Inputs:** Report JSON, mode, profile (cho default config)
**Outputs:**
- List tickets created
- Updated report với synced fields

**Used by:** `/qa:sync`

### 4.4 `qa-figma-diff`

Compare rendered screenshot với Figma node screenshot.

**Inputs:** Figma nodeId, page URL, viewport
**Outputs:**
- Side-by-side image
- Vision-based diff analysis (font size, color, spacing mismatches)
- Suggested fixes

**Used by:** `/qa:review`

### 4.5 `qa-inject-attributes`

Auto-inject `data-i18n-key` vào Astro components.

**Inputs:** projectRoot, i18nNamespace
**Outputs:**
- List of files modified
- Diff per file

**Behavior:**
- Glob `src/components/**/*.astro`
- Tìm pattern `{t('key.path')}` → wrap parent text với `data-i18n-key="key.path"`
- Skip nếu đã có

**Used by:** `/qa:doctor` (suggest), standalone command `/qa:inject-i18n`

### 4.6 `qa-fix-issues`

Auto-patch source file dựa vào expected/actual delta.

**Inputs:** Report JSON
**Outputs:** Diff per file, list of issues fixed/skipped

**Used by:** `/qa:fix`

---

## 5. Plugin manifest

```json
{
  "$schema": "claude-plugin-v1",
  "name": "qa-tooling",
  "displayName": "QA Tooling",
  "version": "0.1.0",
  "description": "QA/QC workflow automation: profile generation, Jira sync, Figma diff, auto-fix",
  "author": "OMH Co",
  "license": "MIT",

  "requirements": {
    "claudeCode": ">=1.0.0",
    "mcps": [
      "mcp-atlassian",
      "figma",
      "chrome-devtools"
    ]
  },

  "commands": [
    "commands/qa-init.md",
    "commands/qa-doctor.md",
    "commands/qa-profile.md",
    "commands/qa-sync.md",
    "commands/qa-fix.md",
    "commands/qa-review.md",
    "commands/qa-screenshot.md",
    "commands/qa-report.md"
  ],

  "skills": [
    "skills/qa-detect-stack",
    "skills/qa-generate-profile",
    "skills/qa-sync-jira",
    "skills/qa-figma-diff",
    "skills/qa-inject-attributes",
    "skills/qa-fix-issues"
  ],

  "config": {
    "defaultReportsDir": "docs/qa/reports",
    "defaultProfilePath": "docs/qa/qa-profile.json",
    "screenshotsDir": "docs/design-system/screenshots/rendered"
  }
}
```

---

## 6. Workflow tổng hợp

### 6.1 Dev onboards QA tooling vào dự án mới

```
┌─────────────────────────────────────┐
│ Dev mở terminal Claude Code         │
│ trong dự án                         │
└──────────────┬──────────────────────┘
               │
               ▼
   /qa:init
               │
               ▼
┌─────────────────────────────────────┐
│ Plugin auto-detect:                 │
│ - Astro 5.18.1                       │
│ - 5 locales                          │
│ - 16 sections                        │
│ - Figma key                          │
│ - Git remote                         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Hỏi user:                            │
│ - Jira project (auto: ELS)          │
│ - Default parent ELS-1234           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Generate:                            │
│ - docs/qa/qa-profile.json           │
│ - docs/qa/README.md                 │
│ - .gitignore patterns               │
└──────────────┬──────────────────────┘
               │
               ▼
        commit + done.
```

### 6.2 QA test website hằng ngày

```
QA mở extension → Import qa-profile.json (lần đầu)
       │
       ▼
QA test → click + note 15 issues
       │
       ▼
QA Export ZIP
       │
       ▼
QA giải nén vào docs/qa/reports/2026-05-06/
       │
       ▼
QA terminal Claude Code (hoặc gửi cho dev):
       │
       ▼
   /qa:sync
       │
       ▼
┌─────────────────────────────────────┐
│ Plugin:                              │
│ 1. Đọc latest report                │
│ 2. Commit screenshots                │
│ 3. MCP create 15 subtasks           │
│ 4. Update report synced fields      │
│ 5. Print summary                    │
└──────────────┬──────────────────────┘
               │
               ▼
QA verify Jira → done.
```

### 6.3 Dev fix issues từ Jira

```
Dev nhận Jira ELS-2001
       │
       ▼
   /qa:review ELS-2001
       │
       ▼
┌─────────────────────────────────────┐
│ Plugin:                              │
│ 1. MCP đọc Jira ticket              │
│ 2. Parse expected/actual/file:line  │
│ 3. MCP Figma get_screenshot         │
│ 4. chrome-devtools take_screenshot  │
│ 5. Vision diff                       │
│ 6. Suggest fix code                 │
└──────────────┬──────────────────────┘
               │
               ▼
Dev review diff → apply
       │
       ▼
Dev commit + push
       │
       ▼
Plugin tự động (qua hook hoặc /qa:close):
       │
       ▼
┌─────────────────────────────────────┐
│ MCP jira_add_comment(ELS-2001):     │
│ "Fixed in commit abc123"             │
│                                       │
│ MCP jira_transition_issue(           │
│   ELS-2001, 'In Review' )            │
└─────────────────────────────────────┘
```

---

## 7. Profile auto-detection algorithm

Đây là core value của plugin. Steps chi tiết:

### Step 1 — Framework detection

```js
function detectFramework(projectRoot) {
  const pkg = readJSON(`${projectRoot}/package.json`);
  if (pkg.dependencies?.astro) return { type: 'astro', version: pkg.dependencies.astro };
  if (pkg.dependencies?.next)  return { type: 'nextjs', version: pkg.dependencies.next };
  if (pkg.dependencies?.vue)   return { type: 'vue', version: pkg.dependencies.vue };
  // ...
  return { type: 'generic' };
}
```

### Step 2 — Locale detection

```js
function detectLocales(projectRoot) {
  // Glob src/i18n/*.json → ['en.json', 'ko.json', ...]
  const files = glob(`${projectRoot}/src/i18n/*.json`);
  const locales = files.map(f => basename(f, '.json'));

  // Detect default từ astro.config.mjs hoặc i18n config
  const config = readFile(`${projectRoot}/astro.config.mjs`);
  const defaultLocale = config.match(/defaultLocale:\s*['"](\w+)['"]/)?.[1] || 'en';

  return { locales, defaultLocale };
}
```

### Step 3 — Section detection

```js
async function detectSections(projectRoot) {
  // Grep all data-section= occurrences
  const matches = await grep('data-section="', `${projectRoot}/src/components/**/*.astro`);

  return matches.map(m => ({
    name: m.match.replace('data-section="', '').replace('"', ''),
    file: m.file,
    line: m.line
  }));
}
```

### Step 4 — Figma key detection

```js
function detectFigmaKey(projectRoot) {
  // Check .claude/homepage-plugin.json
  const hpConfig = tryRead(`${projectRoot}/.claude/homepage-plugin.json`);
  if (hpConfig?.figmaFileKey) return hpConfig.figmaFileKey;

  // Check figma.config.json
  const fig = tryRead(`${projectRoot}/figma.config.json`);
  if (fig?.fileKey) return fig.fileKey;

  // Ask user
  return null;
}
```

### Step 5 — Git remote detection

```js
function detectGit(projectRoot) {
  const remote = exec('git remote get-url origin', { cwd: projectRoot });
  // git@github.com:org/repo.git → github.com/org/repo
  const match = remote.match(/[:/]([^/]+\/[^/.]+)(\.git)?$/);
  const repoPath = match?.[1];

  const branch = exec('git branch --show-current', { cwd: projectRoot });
  const userEmail = exec('git config user.email', { cwd: projectRoot });

  return {
    repo: repoPath,
    githubRawBase: `https://github.com/${repoPath}/raw/{branch}/docs/qa/reports/{date}/screenshots/`,
    branch,
    reporter: userEmail
  };
}
```

### Step 6 — Jira project detection

```js
function detectJiraProject(projectRoot) {
  // Check branch name pattern
  const branch = exec('git branch --show-current');
  const match = branch.match(/^([A-Z]+)-\d+/);
  if (match) return match[1];

  // Check recent commit messages
  const commits = exec('git log --oneline -50');
  const projectMatches = commits.match(/\b([A-Z]{2,5})-\d+\b/g);
  if (projectMatches) {
    const counts = countOccurrences(projectMatches);
    return mostCommon(counts);
  }

  // Ask user
  return null;
}
```

### Step 7 — Compose profile

```js
function buildProfile(stackInfo, userAnswers) {
  return {
    $schema: 'qa-profile-v1',
    id: slugify(stackInfo.repo) + '-' + new Date().toISOString().slice(0,10),
    name: `${repoName} (${framework.type})`,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    urlPatterns: [
      'http://localhost:*/*',
      `https://*.${stackInfo.domain}/*`
    ],
    framework: stackInfo.framework,
    conventions: detectConventions(stackInfo),
    localeStrategy: { type: 'url-prefix', supportedLocales: stackInfo.locales },
    pageDetection: buildPageRules(stackInfo.routes),
    jira: {
      projectKey: userAnswers.jiraProject,
      defaultParent: userAnswers.jiraParent,
      defaultMode: 'subtasks',
      defaultLabels: ['qa', 'visual-fidelity'],
      severityToPriority: DEFAULT_SEVERITY_MAP
    },
    figma: {
      fileKey: stackInfo.figmaKey,
      linkTemplate: 'https://figma.com/design/{fileKey}?node-id={nodeId}'
    },
    screenshots: { githubRawBase: stackInfo.githubRawBase, branch: stackInfo.branch },
    issueTemplates: DEFAULT_TEMPLATES
  };
}
```

---

## 8. Roadmap

### Phase 1 — Plugin MVP (target: 1-2 ngày)

| # | Task | Output |
|---|------|--------|
| 1 | plugin.json manifest | – |
| 2 | `/qa:init` command | docs/qa/qa-profile.json + README |
| 3 | Skill: qa-detect-stack | – |
| 4 | Skill: qa-generate-profile | – |
| 5 | `/qa:doctor` command | health check report |
| 6 | `/qa:profile` command (show/validate/export) | – |
| 7 | `/qa:sync` command | Jira tickets created |
| 8 | Skill: qa-sync-jira | – |
| 9 | INSTALL.md + COMMAND_REFERENCE.md | – |

### Phase 2 — Polish (~1.5 ngày)

- `/qa:fix` command + skill
- `/qa:screenshot` command (chrome-devtools integration)
- `/qa:review` command + skill (Figma diff)
- Skill: qa-inject-attributes (auto inject data-i18n-key)
- `/qa:report` (markdown/html/slack format)
- Plugin tests

### Phase 3 — Advanced

- Hook integration (pre-commit hook chạy `/qa:doctor`)
- Auto-watch reports folder → trigger `/qa:sync` on new file
- Multi-project: `/qa:list-projects`, `/qa:switch-project`
- Plugin marketplace (Claude Code plugin registry)

---

## 9. Bảng tóm tắt commands

| Command | Vai trò | Frequency | Time saved |
|---|---|---|---|
| `/qa:init` | Setup lần đầu | 1× per project | ~30 min |
| `/qa:doctor` | Debug setup | Khi gặp lỗi | ~15 min |
| `/qa:profile` | Quản lý profile | Khi cần update | ~5 min |
| `/qa:sync` | QA → Jira | 1×/day | ~10 min |
| `/qa:fix` | Auto-fix code | After QA report | ~30 min/issue |
| `/qa:review` | Dev review Jira | Per ticket | ~20 min/ticket |
| `/qa:screenshot` | Capture cho Figma diff | Sau khi sửa code | ~10 min |
| `/qa:report` | Generate human report | Per release | ~20 min |

---

## 10. So sánh "Extension only" vs "Extension + Plugin"

```
            Extension only           Extension + Plugin
            ─────────────            ──────────────────

Setup       Manual config            /qa:init (auto)
            30+ min                  < 30s

Daily QA    Click → note → export    [Same]
            ZIP                      ZIP

Sync Jira   QA copy ZIP, mở claude,  /qa:sync
            paste prompt manually    < 30s
            ~10 min

Fix code    Read Jira → manual fix   /qa:fix or /qa:review
            ~30 min/issue            < 5 min/issue

Onboard     Mỗi QA học extension     /qa:init xong là QA
new dev     + cách tạo profile       chỉ cần install ext
            ~1 giờ                   ~5 min
```

---

## 11. Câu hỏi cần xác nhận trước khi build

### Plugin scope
1. **Phase 1 build commands nào?**
   - (A) Tối thiểu: `/qa:init`, `/qa:doctor`, `/qa:sync` — đủ workflow cơ bản
   - (B) + `/qa:profile` `/qa:fix` `/qa:review` — đầy đủ value
   - (C) All commands ngay → Phase 1 dài hơn

   → Đề xuất **(A)** Phase 1, B Phase 2.

### Plugin packaging
2. **Plugin location**:
   - (A) Trong repo `qa-annotator-extension` (folder `plugin/`)
   - (B) Repo riêng `qa-tooling-plugin`
   - (C) Trong repo `home/.claude/plugins/qa-tooling/` (project-level plugin)

   → Đề xuất **(A)** để đi cùng extension. Hoặc (C) nếu chỉ dùng cho home.

### Profile schema
3. **Profile schema có giống extension không?**
   - Đồng nhất 1 schema → plugin generate, extension consume
   → **YES** — schema `qa-profile-v1` shared.

### Auto-detect độ sâu
4. **`/qa:init` có nên hỏi user không?**
   - (A) Hoàn toàn auto, không hỏi (dùng default cho thông tin missing)
   - (B) Hỏi 2-3 câu critical (Jira project, parent ticket)
   - (C) Interactive wizard đầy đủ (~10 câu hỏi)

   → Đề xuất **(B)** — balance giữa speed và accuracy.

### Build approach
5. **Plugin viết bằng**:
   - (A) Markdown commands chỉ chứa instructions Claude tự làm (không có script)
   - (B) Markdown + Node scripts (chạy qua Bash)
   - (C) Pure programmatic plugin (cần plugin SDK)

   → Đề xuất **(B)** — Markdown chính + scripts khi cần (validate, glob).

### MCP requirements
6. **Bắt buộc có MCP nào?**
   - mcp-atlassian (cho `/qa:sync`)
   - figma (cho `/qa:review`, `/qa:screenshot`)
   - chrome-devtools (cho `/qa:screenshot`)
   - github (optional cho `/qa:report --format slack`)

   → Plugin tự `/qa:doctor` check MCP availability + suggest install.

### Distribution
7. **Cách share plugin cho team**:
   - (A) Commit vào `.claude/plugins/` của repo home
   - (B) Repo Github qa-tooling-plugin → team clone
   - (C) Plugin marketplace của Claude Code (cần submit)

   → Đề xuất **(A) + (B)**: commit vào home cho project hiện tại; tách (B) khi muốn dùng cho project khác.

### Integration với extension
8. **Quan hệ plugin ↔ extension**:
   - (A) Plugin tạo profile → user import manual vào extension
   - (B) Plugin chạy local server → extension fetch profile từ `localhost:port`
   - (C) Plugin commit profile vào repo → extension đọc qua `web_accessible_resources`

   → Đề xuất **(A)** đơn giản cho MVP, (C) Phase 2 nếu muốn auto sync.

### Hỏi thêm
9. **Tên plugin**: `qa-tooling` (generic) hay `omh-qa-plugin` (specific)?
10. **Có muốn hook `pre-commit` chạy /qa:doctor không** (nhắc dev nếu chưa setup)?
11. **Báo cáo output**: bao nhiêu chi tiết — short summary hay verbose?

---

## 12. Status

- 2026-05-06 — **Plugin plan v1 written**.
- Liên quan:
  - `PLAN.md` (extension v2 — generic + profile)
  - `FLOWCHARTS.md` (extension visual)
  - `PLUGIN_PLAN.md` (plugin — file này)
- Next: user verify → build Plugin Phase 1 + Extension Phase 1 song song hoặc tuần tự.
