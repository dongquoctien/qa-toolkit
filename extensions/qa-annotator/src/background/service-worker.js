// Service worker — owns chrome.storage, captures screenshots, relays messages.
import * as profile from '../profile/profile-manager.js';

const MSG = {
  INSPECTOR_TOGGLE:   'qa/inspector/toggle',
  PROFILE_LIST:       'qa/profile/list',
  PROFILE_SET_ACTIVE: 'qa/profile/set-active',
  PROFILE_GET_ACTIVE: 'qa/profile/get-active',
  PROFILE_IMPORT:     'qa/profile/import',
  PROFILE_DELETE:     'qa/profile/delete',
  CAPTURE_VISIBLE:    'qa/capture/visible',
  EXPORT_REPORT:      'qa/export/report',
  DOWNLOAD_FILE:      'qa/download/file',
  ISSUE_LIST:         'qa/issue/list',
  ISSUE_SAVE:         'qa/issue/save',
  ISSUE_DELETE:       'qa/issue/delete',
  ISSUE_CLEAR:        'qa/issue/clear',
  SETTING_GET:        'qa/setting/get',
  SETTING_SET:        'qa/setting/set',
  SETTING_CHANGED:    'qa/setting/changed',
  FIGMA_TREE_GET:     'qa/figma-tree/get',
  FIGMA_TREE_LIST:    'qa/figma-tree/list',
  FIGMA_TREE_IMPORT:  'qa/figma-tree/import',
  FIGMA_TREE_DELETE:  'qa/figma-tree/delete',
  DRAFT_GET:          'qa/draft/get',
  DRAFT_SAVE:         'qa/draft/save',
  DRAFT_CLEAR:        'qa/draft/clear'
};

const DRAFT_KEY_PREFIX = 'draft:';

const ISSUES_KEY = 'issues';
const SETTINGS_KEY = 'settings';

// Default settings — expanded in v0.2.0 to cover capture preferences, privacy
// redaction, capture-source toggles, issue defaults, integrations, inspector
// behavior. readSettings() does a deep-merge on read so users with the v0.1.x
// flat shape (`{ inspectorColor: '#xxx' }`) still get all the new fields with
// safe defaults — no migration step required.
const DEFAULT_SETTINGS = {
  inspectorColor: '#ec4899',

  mode: 'prod-bug',
  modeChosenAt: null,

  capture: {
    openAnnotationEditor: true,
    pinStyle: 'circle-number',
    pinPrefix: '',
    pinColorMode: 'accent',
    defaultTool: 'pin',
    padding: 80,
    stitchingMaxSlices: 8,
    autoCapture: true,
    pngQuality: 'standard',
    hideSelectorsBeforeCapture: []
  },

  privacy: {
    blurSelectors: [
      'input[type=password]',
      'input[type=email]',
      '[data-pii]'
    ],
    redactPatterns: [],
    rrwebStripStorage: true,
    hashUserIds: false,
    rrwebAllowlistDomains: []
  },

  sources: {
    computed: true,
    source: true,
    consoleErrors: false,
    networkFailures: false,
    a11y: false,
    rrweb: false,
    appState: false,
    perfMetrics: false
  },

  defaults: {
    severity: 'minor',
    type: 'bug',
    requiredFields: ['title', 'severity'],
    titleTemplate: '',
    severityColors: {
      critical: '#ef4444',
      major: '#f97316',
      minor: '#eab308',
      info: '#3b82f6'
    },
    autoTagRules: [],
    severityHotkeys: { 1: 'critical', 2: 'major', 3: 'minor' }
  },

  integrations: {
    jiraProjectKey: '',
    jiraAssignee: '',
    jiraLabels: [],
    jiraParent: '',
    slackWebhook: '',
    githubRepo: '',
    figmaToken: ''
  },

  inspector: {
    thickness: 3,
    style: 'solid',
    showTooltip: true,
    tooltipFields: ['tag', 'classes', 'computed', 'breakpoint'],
    clickThrough: false,
    domainBlocklist: [],
    autoStopAfterPick: true,
    shortcuts: { pick: 'click', multi: 'shift+click', done: 'Enter', stop: 'Escape' }
  },

  advanced: {
    debugLogging: false
  }
};

// Merge a partial settings patch into the current settings object, one level
// deep — same shape as mergeSettings but on the *patch* side. Lets callers
// send `{ capture: { padding: 40 } }` without losing capture.openAnnotationEditor.
function deepShallow(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(patch[k] || {}) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Deep-merge user settings on top of DEFAULT_SETTINGS. Arrays are replaced
// (not concatenated) so when a user clears a list — e.g. `blurSelectors: []` —
// the defaults don't sneak back in.
function mergeSettings(stored) {
  if (!stored || typeof stored !== 'object') return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const [k, v] of Object.entries(stored)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) || typeof v !== 'object') {
      out[k] = v;
    } else {
      // Nested object: shallow-merge per key, so a user who only saved
      // capture.padding doesn't lose the rest of capture.*.
      out[k] = { ...(out[k] || {}), ...v };
    }
  }
  return out;
}
// Figma trees are stored under per-profile keys so we don't load every tree
// when the active profile only needs one. Keys: figmaTree:<profileId>
const FIGMA_TREE_KEY_PREFIX = 'figmaTree:';

chrome.runtime.onInstalled.addListener(async () => {
  await profile.ensureSeeded();
});
chrome.runtime.onStartup.addListener(async () => {
  await profile.ensureSeeded();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case MSG.PROFILE_LIST:       return sendResponse(await profile.list());
        case MSG.PROFILE_GET_ACTIVE: return sendResponse(await profile.getActive());
        case MSG.PROFILE_SET_ACTIVE: {
          await profile.setActive(message.payload);
          const active = await profile.getActive();
          await broadcastActiveProfile(active);
          return sendResponse({ ok: true });
        }
        case MSG.PROFILE_IMPORT: {
          const saved = await profile.upsert(message.payload);
          if (message.makeActive) await profile.setActive(saved.id);
          await broadcastActiveProfile(await profile.getActive());
          return sendResponse({ ok: true, profile: saved });
        }
        case MSG.PROFILE_DELETE: {
          await profile.remove(message.payload);
          // Cascade: drop the figma tree that belongs to this profile, if any.
          await chrome.storage.local.remove(FIGMA_TREE_KEY_PREFIX + message.payload);
          return sendResponse({ ok: true });
        }
        case MSG.CAPTURE_VISIBLE: {
          const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          return sendResponse({ dataUrl });
        }
        case MSG.ISSUE_LIST:   return sendResponse(await readIssues());
        case MSG.ISSUE_SAVE: {
          const list = await readIssues();
          const idx = list.findIndex((i) => i.id === message.payload.id);
          if (idx >= 0) list[idx] = message.payload; else list.push(message.payload);
          await chrome.storage.local.set({ [ISSUES_KEY]: list });
          return sendResponse({ ok: true });
        }
        case MSG.ISSUE_DELETE: {
          const list = await readIssues();
          await chrome.storage.local.set({ [ISSUES_KEY]: list.filter((i) => i.id !== message.payload) });
          return sendResponse({ ok: true });
        }
        case MSG.ISSUE_CLEAR: {
          await chrome.storage.local.set({ [ISSUES_KEY]: [] });
          return sendResponse({ ok: true });
        }
        case MSG.DOWNLOAD_FILE: {
          // payload: { filename, dataUrl }
          const { filename, dataUrl } = message.payload;
          const id = await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
          return sendResponse({ ok: true, id });
        }
        case MSG.SETTING_GET: return sendResponse(await readSettings());
        case MSG.SETTING_SET: {
          // Deep-merge so a partial payload like `{ capture: { padding: 40 } }`
          // doesn't wipe sibling keys under capture.*.
          const merged = mergeSettings({ ...(await readSettings()), ...deepShallow(message.payload || {}) });
          await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
          await broadcastSettings(merged);
          return sendResponse({ ok: true, settings: merged });
        }
        case MSG.FIGMA_TREE_GET: {
          // payload: profileId. Returns compressed tree or null.
          const profileId = message.payload;
          if (!profileId) return sendResponse(null);
          const key = FIGMA_TREE_KEY_PREFIX + profileId;
          const data = await chrome.storage.local.get([key]);
          return sendResponse(data[key] || null);
        }
        case MSG.FIGMA_TREE_LIST: {
          // Returns metadata only (no full nodes object) for all stored trees.
          const all = await chrome.storage.local.get(null);
          const out = [];
          for (const [k, v] of Object.entries(all)) {
            if (!k.startsWith(FIGMA_TREE_KEY_PREFIX) || !v) continue;
            out.push({
              profileId:  k.slice(FIGMA_TREE_KEY_PREFIX.length),
              fileKey:    v.fileKey,
              fileSlug:   v.fileSlug,
              crawledAt:  v.crawledAt,
              nodeCount:  Object.keys(v.nodes || {}).length,
              pageCount:  (v.pages || []).length,
              sizeBytes:  JSON.stringify(v).length
            });
          }
          return sendResponse(out);
        }
        case MSG.FIGMA_TREE_IMPORT: {
          // payload: { profileId, tree, replace? }
          const { profileId, tree } = message.payload || {};
          if (!profileId)            return sendResponse({ error: 'profileId required' });
          if (!tree || typeof tree !== 'object') return sendResponse({ error: 'tree must be an object' });
          if (tree.$schema !== 'qa-figma-tree-v1') return sendResponse({ error: `unexpected $schema: ${tree.$schema}` });
          if (!tree.fileKey)         return sendResponse({ error: 'tree.fileKey required' });
          if (!tree.nodes || typeof tree.nodes !== 'object') return sendResponse({ error: 'tree.nodes required' });

          const compressed = compressTree(tree);
          const key = FIGMA_TREE_KEY_PREFIX + profileId;
          try {
            await chrome.storage.local.set({ [key]: compressed });
          } catch (e) {
            return sendResponse({ error: 'storage write failed: ' + (e?.message || e) });
          }
          return sendResponse({
            ok: true,
            stats: {
              profileId,
              nodeCount: Object.keys(compressed.nodes).length,
              sizeBytes: JSON.stringify(compressed).length
            }
          });
        }
        case MSG.FIGMA_TREE_DELETE: {
          const profileId = message.payload;
          await chrome.storage.local.remove(FIGMA_TREE_KEY_PREFIX + profileId);
          return sendResponse({ ok: true });
        }
        case MSG.DRAFT_GET: {
          const issueId = message.payload;
          if (!issueId) return sendResponse(null);
          const data = await chrome.storage.local.get(DRAFT_KEY_PREFIX + issueId);
          return sendResponse(data[DRAFT_KEY_PREFIX + issueId] || null);
        }
        case MSG.DRAFT_SAVE: {
          const { issueId, snapshot } = message.payload || {};
          if (!issueId) return sendResponse({ error: 'missing issueId' });
          await chrome.storage.local.set({
            [DRAFT_KEY_PREFIX + issueId]: { snapshot, savedAt: Date.now() }
          });
          return sendResponse({ ok: true });
        }
        case MSG.DRAFT_CLEAR: {
          const issueId = message.payload;
          if (!issueId) return sendResponse({ ok: true });
          await chrome.storage.local.remove(DRAFT_KEY_PREFIX + issueId);
          return sendResponse({ ok: true });
        }
        default:
          return sendResponse({ error: 'unknown message: ' + message?.type });
      }
    } catch (e) {
      console.warn('[QA bg]', e);
      sendResponse({ error: String(e?.message || e) });
    }
  })();
  return true;
});

async function readIssues() {
  const data = await chrome.storage.local.get([ISSUES_KEY]);
  return data[ISSUES_KEY] || [];
}

async function readSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY]);
  return mergeSettings(data[SETTINGS_KEY]);
}

// Strip fields the matcher can rebuild on demand. Saves ~40% storage.
//   - _doc                    pure documentation, never read at runtime
//   - nodes[*].breadcrumb     can be rebuilt by walking parentId chain
//   - nodes[*].pageName       can be inferred from the tree.pages[] index
//   - nodes with bbox.w === 0 or h === 0 (degenerate, never matches)
// Accepts both canonical long-form (`name`, `type`, `parentId`, `depth`, `bbox`,
// `viewport`, `text`, `summary`) — what the plugin spec emits — AND already-
// compressed short-form (`n`, `t`, `p`, `d`, `b`, `v`, `x`, `s`) so re-importing
// a previously-compressed tree doesn't strip every field.
function compressTree(tree) {
  const out = {
    $schema: tree.$schema,
    fileKey: tree.fileKey,
    fileSlug: tree.fileSlug || null,
    crawledAt: tree.crawledAt,
    crawledBy: tree.crawledBy || 'unknown',
    pages: tree.pages || [],
    nodes: {},
    sectionIndex: tree.sectionIndex || null,
    stats: tree.stats || null
  };
  for (const [id, raw] of Object.entries(tree.nodes || {})) {
    if (!raw) continue;
    const name     = raw.name     ?? raw.n;
    const type     = raw.type     ?? raw.t;
    const parentId = raw.parentId ?? raw.p ?? null;
    const depth    = raw.depth    ?? raw.d ?? null;
    const bbox     = raw.bbox     ?? raw.b ?? null;
    const viewport = raw.viewport ?? raw.v ?? null;
    const text     = raw.text     ?? raw.x;
    const summary  = raw.summary  ?? raw.s;

    if (bbox && (bbox.w === 0 || bbox.h === 0)) continue;

    const slim = { n: name, t: type, p: parentId, d: depth, b: bbox, v: viewport };
    if (text)    slim.x = text;
    if (summary) slim.s = summary;
    out.nodes[id] = slim;
  }
  return out;
}

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    try { await chrome.tabs.sendMessage(t.id, { type: MSG.SETTING_CHANGED, payload: settings }); }
    catch { /* ignore */ }
  }
}

async function broadcastActiveProfile(active) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    try { await chrome.tabs.sendMessage(t.id, { type: 'qa/profile/active-changed', payload: active }); }
    catch { /* tab may not have content script — ignore */ }
  }
}
