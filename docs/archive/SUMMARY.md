# QA Annotator — Extension + Plugin · Tổng kết

> Đơn giản. Hiệu quả. Đủ dùng.
> Last updated: 2026-05-06

---

## 1. Bài toán

QA/QC test website → phát hiện lệch Figma → cần báo cho dev sửa nhanh + chính xác.

**Vấn đề hiện tại:**
- QA chụp màn hình, gõ Slack/Jira tay → mất thời gian, thiếu thông tin
- Dev không biết file/line nào, expected gì → mất thời gian tra
- Setup tooling cho mỗi project lặp lại

---

## 2. Giải pháp: 2 thành phần

```
┌──────────────────┐         ┌──────────────────┐
│  Plugin Claude   │  setup  │  Chrome Extension│
│  (cho Dev)       │ ──────▶ │  (cho QA)         │
│  /qa:init        │ profile │  click + note     │
│  /qa:sync        │ ◀────── │  export ZIP       │
└──────────────────┘  report └──────────────────┘
        │
        ▼
   Jira Cloud
```

**Plugin** = đầu mối cho Dev (auto setup + sync Jira)
**Extension** = công cụ field cho QA (click + note + export)

Liên kết qua **1 file JSON** = `qa-profile.json`

---

## 3. Workflow 1 ngày

```
[Dev — 1 lần đầu setup]
  /qa:init                        → 30 giây, profile sẵn

[QA — mỗi sáng]
  Mở extension, chọn profile      → 5 giây
  Test website
  Click element có vấn đề         → form auto-fill expected/actual
  Note + screenshot
  …(lặp 10–20 lần)…

[QA — cuối ngày]
  Export ZIP                      → tải về

[Dev — sync Jira]
  /qa:sync qa-report.zip          → 30 giây, 15 subtasks tạo xong
```

**Tiết kiệm:** ~1 giờ/ngày so với workflow truyền thống (Slack/Jira tay).

---

## 4. Extension — gói gọn

### Cài 1 lần

```
chrome://extensions → Developer mode → Load unpacked → chọn folder
```

### Tính năng cốt lõi (Phase 1)

| Tính năng | Có | Không (Phase 2+) |
|---|---|---|
| Click element + note | ✅ | – |
| Auto-detect file:line (Astro) | ✅ | – |
| Auto-fill computed styles | ✅ | – |
| Severity + type + screenshot | ✅ | – |
| Export JSON / Markdown / ZIP | ✅ | – |
| Profile import/export | ✅ | – |
| Multi-project (1 ext, N profiles) | ✅ | – |
| Side Panel UI | – | Phase 2 |
| Figma overlay diff | – | Phase 3 |

### Profile = file JSON

Mỗi project = 1 file `qa-profile.json`. Plugin tự generate, QA chỉ import.

```json
{
  "id": "home-omh",
  "name": "Ohmyhotel Co — Homepage",
  "urlPatterns": ["http://localhost:*/*", "https://*.ohmyhotelnco.com/*"],
  "framework": { "type": "astro" },
  "conventions": { "sectionAttribute": "data-section" },
  "localeStrategy": { "type": "url-prefix", "supportedLocales": ["en","ko","vi","ja","zh"] },
  "jira": { "projectKey": "ELS", "defaultParent": "ELS-1234" },
  "figma": { "fileKey": "...optional..." }
}
```

**Quan trọng:** Figma key là **optional**. Không có vẫn dùng được, chỉ mất tính năng auto-compare.

---

## 5. Plugin Claude Code — gói gọn

### Cài

```
.claude/plugins/qa-tooling/  ← commit vào repo
```

### 4 commands chính (Phase 1)

| Command | Vai trò | Khi dùng |
|---|---|---|
| `/qa:init` | Auto-setup profile từ src code | 1× per project |
| `/qa:doctor` | Health check setup | Khi gặp lỗi |
| `/qa:sync` | QA report → Jira tickets | 1×/day |
| `/qa:fix` | Auto-patch code từ report | After QA report |

### Skills bên trong (~7 cái)

```
qa-detect-stack          ← framework, locales, sections
qa-detect-design-source  ← Figma / Storybook / tokens / none
qa-mcp-doctor            ← check MCPs (atlassian, figma, chrome)
qa-validate-profile      ← schema check + warnings
qa-generate-profile      ← compose JSON
qa-sync-jira             ← MCP create/update tickets
qa-fix-issues            ← auto-patch source
```

### `/qa:init` — auto-detect mọi thứ

```
Dev gõ: /qa:init

Plugin tự đọc:
✓ package.json     → Astro 5.18.1
✓ src/i18n/*.json  → 5 locales (en/ko/vi/ja/zh)
✓ src/components/  → 16 sections
✓ git remote       → github.com/ohmyhotelco/home
✓ git branch       → infer Jira project "ELS"
✓ .claude/homepage-plugin.json → Figma file key (nếu có)

Plugin hỏi 2 câu (chỉ khi không tự detect được):
? Jira parent ticket: ELS-1234
? Figma file key (optional): _

Plugin tạo:
✓ docs/qa/qa-profile.json
✓ docs/qa/README.md
✓ docs/qa/reports/.gitkeep
```

### `/qa:sync` — đẩy report lên Jira

```
QA giải nén qa-report.zip vào docs/qa/reports/2026-05-06/

Dev gõ: /qa:sync

Plugin:
1. Đọc qa-report.json mới nhất
2. (Optional) git commit screenshots → push để có URL public
3. Loop issues:
   - mcp__mcp-atlassian__jira_create_issue (Sub-task dưới ELS-1234)
   - Description ADF: table expected/actual + Figma link + screenshot
4. Update report với Jira keys
5. Print summary

→ ELS-2001 → ELS-2015 (15 subtasks)
```

---

## 6. 3 trường hợp design source

Plugin tự nhận biết và xử lý:

| Mode | Có gì | Tính năng |
|---|---|---|
| **Figma** | `.claude/homepage-plugin.json` có fileKey | Full visual diff, auto expected |
| **Storybook/Tokens** | `.storybook/` hoặc `design-tokens.json` | Compare với tokens, story snapshots |
| **Empty** | Không có gì | QA gõ expected tay (giống QA truyền thống) |

→ **Không có Figma vẫn dùng được**, chỉ mất 60-70% value visual diff.

---

## 7. Cấu trúc repo

```
qa-annotator-extension/
│
├── extension/                    ← Chrome extension
│   ├── manifest.json
│   ├── src/
│   │   ├── core/                 ← inspector, modal, builder (vanilla JS)
│   │   ├── adapters/             ← Astro, Generic
│   │   ├── profile/              ← manager, validator
│   │   ├── content/, popup/, settings/, background/
│   │   └── lib/                  ← exporter, glob-match
│   ├── assets/                   ← icons
│   └── docs/                     ← INSTALL, USER_GUIDE
│
├── plugin/                       ← Claude Code plugin
│   ├── plugin.json
│   ├── commands/                 ← qa-init.md, qa-sync.md, ...
│   ├── skills/                   ← qa-detect-stack, qa-sync-jira, ...
│   ├── templates/                ← empty profile, README template
│   └── scripts/                  ← node helpers
│
├── shared/                       ← schema dùng chung
│   ├── qa-profile-v1.schema.json
│   └── qa-report-v1.schema.json
│
├── README.md                     ← overview repo
├── SUMMARY.md                    ← file này
├── PLAN.md                       ← extension chi tiết
├── PLUGIN_PLAN.md                ← plugin chi tiết
└── FLOWCHARTS.md                 ← visual flow
```

---

## 8. Schema dùng chung

### `qa-profile.json` — output plugin → input extension

Đã định nghĩa ở `PLAN.md`. Field bắt buộc tối thiểu:

```json
{
  "$schema": "qa-profile-v1",
  "id": "home-omh",
  "name": "...",
  "urlPatterns": ["..."],
  "framework": { "type": "astro" }
}
```

### `qa-report.json` — output extension → input plugin

```json
{
  "$schema": "qa-report-v1",
  "report": {
    "profile": { "id": "home-omh", "version": "1.0.0" },
    "scope": { "url": "...", "viewport": "1280x800", "locale": "en" },
    "syncHints": { "suggestedJiraProject": "ELS", "suggestedParent": "ELS-1234" },
    "issues": [
      {
        "id": "ISS-001",
        "severity": "major",
        "type": "visual",
        "element": { "selector": "...", "rect": {...} },
        "source": { "file": "...", "line": 83 },
        "expected": { "fontSize": "48px", "figmaLink": "..." },
        "actual": { "fontSize": "36px" },
        "screenshot": { "filename": "iss-001.png" },
        "note": "..."
      }
    ]
  }
}
```

---

## 9. Roadmap đơn giản

### Phase 1 — MVP (2-3 ngày)

**Plugin:**
- [ ] `/qa:init` — auto-detect + generate profile
- [ ] `/qa:doctor` — health check
- [ ] `/qa:sync` — QA report → Jira via MCP
- [ ] 7 skills

**Extension:**
- [ ] Manifest V3 + popup + content script
- [ ] Inspector mode (click + highlight)
- [ ] Form modal (auto-fill + manual fields)
- [ ] Profile manager (import/export)
- [ ] Astro adapter + Generic adapter
- [ ] Export JSON / MD / ZIP (vendor JSZip)
- [ ] Built-in profile cho home

**Schema:**
- [ ] `qa-profile-v1.schema.json`
- [ ] `qa-report-v1.schema.json`

**Docs:**
- [ ] INSTALL.md (cài extension + plugin)
- [ ] USER_GUIDE.md (QA workflow)
- [ ] PROFILE_GUIDE.md (custom profile cho project mới)

### Phase 2 — Polish (~1.5 ngày)

- Side Panel UI
- Edit/delete/duplicate issue
- `/qa:fix` auto-patch
- `/qa:review` Jira + Figma diff
- Next.js + Vue adapters
- Issue templates

### Phase 3 — Advanced (sau)

- Figma overlay (paste URL → side-by-side)
- Pixel diff canvas-based
- Pre-commit hooks
- Marketplace publish

---

## 10. Câu hỏi để bắt đầu

Chỉ 5 câu chốt:

1. **Build trước**: Plugin (1) hay Extension (2) hay song song (3)?
   → Đề xuất **(1)** Plugin trước vì extension cần profile.

2. **Schema shared**: file `shared/*.schema.json` để cả 2 dự án ref → OK?
   → Đề xuất **YES**.

3. **Plugin location**: trong repo extension (folder `plugin/`) hay tách riêng?
   → Đề xuất **trong repo** để 1 nơi quản lý.

4. **Phase 1 scope** đủ chưa (4 commands + 7 skills + extension MVP)?
   → Đề xuất **đủ**, polish sau.

5. **Init git + push GitHub remote** bây giờ chưa?
   → Đợi user xác nhận remote URL.

---

## 11. Tóm tắt quyết định kiến trúc

| Quyết định | Lý do |
|---|---|
| 2 thành phần (Plugin + Extension) | Tách concern: Plugin = setup/sync, Extension = field tool |
| Profile JSON shared | 1 schema, 2 consumer, dễ verify |
| Generic core + Adapter | Extension dùng được mọi project |
| Auto-detect trong `/qa:init` | Giảm setup từ 30 phút → 30 giây |
| Sync Jira qua Claude + MCP | Không tự build HTTP client, không cần token trong extension |
| Vanilla JS (không bundler) | Phase 1 đơn giản, không phụ thuộc node_modules nặng |
| Figma optional | Không có vẫn dùng được structural QA |
| Extension = Manifest V3 | Future-proof |
| Distribution = Load unpacked | Internal team đủ dùng |

---

## 12. Status

- 2026-05-06 — **Plan đầy đủ** trong:
  - `SUMMARY.md` (file này — đọc đầu tiên)
  - `PLAN.md` (extension chi tiết)
  - `PLUGIN_PLAN.md` (plugin chi tiết)
  - `FLOWCHARTS.md` (visual flow)
- Awaiting: user verify + trả lời 5 câu hỏi mục 10 → bắt đầu code Phase 1.
