// Settings page — list profiles, import, delete, set active.
(async function () {
  const MSG = QA.MSG;
  const $ = (id) => document.getElementById(id);

  function rpc(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function refresh() {
    const [profiles, active] = await Promise.all([
      rpc({ type: MSG.PROFILE_LIST }),
      rpc({ type: MSG.PROFILE_GET_ACTIVE })
    ]);
    $('active-info').textContent = active ? `Active profile: ${active.id} — ${active.name}` : 'No active profile';
    const tbody = document.querySelector('#profiles tbody');
    tbody.innerHTML = '';
    for (const p of profiles) {
      const tr = document.createElement('tr');
      const isActive = active && active.id === p.id;
      tr.innerHTML = `
        <td><code>${escapeHtml(p.id)}</code>${isActive ? ' <span class="tag">active</span>' : ''}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.framework?.type || 'generic')} ${p.framework?.version ? '<span class="tag">' + escapeHtml(p.framework.version) + '</span>' : ''}</td>
        <td>${(p.localeStrategy?.supportedLocales || []).map((l) => `<span class="tag">${escapeHtml(l)}</span>`).join(' ')}</td>
        <td>${p.jira?.projectKey ? escapeHtml(p.jira.projectKey) : '—'}${p.jira?.defaultParent ? ` / ${escapeHtml(p.jira.defaultParent)}` : ''}</td>
        <td class="actions">
          <button data-act="activate" data-id="${escapeAttr(p.id)}">Set active</button>
          <button data-act="delete" data-id="${escapeAttr(p.id)}" class="danger">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  document.querySelector('#profiles').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (btn.dataset.act === 'activate') await rpc({ type: MSG.PROFILE_SET_ACTIVE, payload: id });
    else if (btn.dataset.act === 'delete') {
      if (!confirm(`Delete profile ${id}?`)) return;
      await rpc({ type: MSG.PROFILE_DELETE, payload: id });
    }
    await refresh();
  });

  $('paste-toggle').addEventListener('click', () => {
    $('paste').classList.toggle('show');
    $('paste').focus();
  });

  $('import').addEventListener('click', async () => {
    let raw = $('paste').value.trim();
    if (!raw) {
      const f = $('file').files?.[0];
      if (!f) { reportImport({ ok: false, errors: ['No file or pasted JSON'] }); return; }
      raw = await f.text();
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { reportImport({ ok: false, errors: ['JSON parse: ' + e.message] }); return; }

    const v = QA.profileValidator.validate(parsed);
    if (!v.ok) { reportImport(v); return; }

    const r = await rpc({
      type: MSG.PROFILE_IMPORT,
      payload: parsed,
      makeActive: $('make-active').checked
    });
    if (r?.error) { reportImport({ ok: false, errors: [r.error] }); return; }
    reportImport({ ok: true, errors: [], warnings: v.warnings, profile: r.profile });
    $('paste').value = '';
    $('file').value = '';
    await refresh();
  });

  function reportImport(result) {
    const lines = [];
    if (result.ok) lines.push('✓ Imported.');
    if (result.errors?.length) lines.push('Errors:\n  - ' + result.errors.join('\n  - '));
    if (result.warnings?.length) lines.push('Warnings:\n  - ' + result.warnings.join('\n  - '));
    if (result.profile) lines.push(`Saved as: ${result.profile.id} (${result.profile.name})`);
    $('import-result').textContent = lines.join('\n\n');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  // ============== Theme color picker ==============
  const PRESETS = ['#ec4899', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6'];

  function applyTheme(color) {
    document.documentElement.style.setProperty('--qa-accent', color);
    document.documentElement.style.setProperty('--qa-accent-hover', darken(color, 0.10));
    $('color-preview').style.setProperty('--c', color);
  }

  function darken(hex, amt) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.round(((n >> 16) & 0xFF) * (1 - amt)));
    const g = Math.max(0, Math.round(((n >> 8) & 0xFF) * (1 - amt)));
    const b = Math.max(0, Math.round((n & 0xFF) * (1 - amt)));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  async function loadColor() {
    const settings = await rpc({ type: MSG.SETTING_GET });
    const color = (settings?.inspectorColor || '#ec4899').toLowerCase();
    applyTheme(color);
    $('custom-color').value = color;
    markActiveSwatch(color);
  }

  function markActiveSwatch(color) {
    for (const sw of document.querySelectorAll('#swatches .swatch')) {
      const matches = (sw.dataset.color || '').toLowerCase() === color;
      sw.classList.toggle('active', matches);
    }
  }

  async function saveColor(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    applyTheme(color);
    markActiveSwatch(color.toLowerCase());
    $('custom-color').value = color;
    const r = await rpc({ type: MSG.SETTING_SET, payload: { inspectorColor: color } });
    $('color-status').textContent = r?.ok
      ? `✓ Saved. Open tabs will pick up the new color immediately.`
      : `Failed to save: ${r?.error || 'unknown'}`;
  }

  document.querySelector('#swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    saveColor(sw.dataset.color);
  });

  $('custom-color').addEventListener('input', (e) => applyTheme(e.target.value));
  $('custom-color').addEventListener('change', (e) => saveColor(e.target.value));

  // ============== Figma tree import ==============
  async function refreshTrees() {
    const [profiles, trees] = await Promise.all([
      rpc({ type: MSG.PROFILE_LIST }),
      rpc({ type: MSG.FIGMA_TREE_LIST })
    ]);

    // Profile dropdown for import
    const sel = $('tree-profile-select');
    sel.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.id})`;
      if (!p.figma?.fileKey) {
        opt.disabled = true;
        opt.textContent += ' — no figma.fileKey';
      }
      sel.appendChild(opt);
    }

    // Trees table
    const tbody = document.querySelector('#trees tbody');
    tbody.innerHTML = '';
    if (!trees || trees.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" class="muted" style="text-align:center;padding:16px">No Figma trees imported yet.</td>';
      tbody.appendChild(tr);
      return;
    }
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    for (const t of trees) {
      const p = byId[t.profileId];
      const profLabel = p ? `${p.name} <code>${escapeHtml(t.profileId)}</code>` : `<code>${escapeHtml(t.profileId)}</code> <span class="tag">orphan</span>`;
      const figmaLabel = t.fileKey + (t.fileSlug ? ` / ${t.fileSlug}` : '');
      const ageDays = Math.round((Date.now() - new Date(t.crawledAt).getTime()) / 86400000);
      const ageStr = isFinite(ageDays) ? `${t.crawledAt?.slice(0,10) || '?'} (${ageDays}d ago)` : '—';
      const sizeStr = (t.sizeBytes / 1024).toFixed(1) + ' KB';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${profLabel}</td>
        <td><code>${escapeHtml(figmaLabel)}</code></td>
        <td>${escapeHtml(ageStr)}</td>
        <td>${t.nodeCount}</td>
        <td>${escapeHtml(sizeStr)}</td>
        <td class="actions">
          <button data-act="tree-delete" data-id="${escapeAttr(t.profileId)}" class="danger">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  document.querySelector('#trees').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'tree-delete') {
      const id = btn.getAttribute('data-id');
      if (!confirm(`Delete Figma tree for profile ${id}?`)) return;
      await rpc({ type: MSG.FIGMA_TREE_DELETE, payload: id });
      await refreshTrees();
    }
  });

  $('tree-import').addEventListener('click', async () => {
    const profileId = $('tree-profile-select').value;
    const file = $('tree-file').files?.[0];
    const setStatus = (txt, ok = true) => {
      const el = $('tree-status');
      el.textContent = txt;
      el.style.color = ok ? '' : '#c0392b';
    };

    if (!profileId) { setStatus('Pick a profile first.', false); return; }
    if (!file)      { setStatus('Choose a qa-figma-tree.json file.', false); return; }

    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (e) { setStatus('Invalid JSON: ' + e.message, false); return; }

    // Basic sanity checks before sending across the wire
    if (parsed.$schema !== 'qa-figma-tree-v1') {
      setStatus(`Wrong $schema: ${parsed.$schema} (expected qa-figma-tree-v1)`, false);
      return;
    }
    const profiles = await rpc({ type: MSG.PROFILE_LIST });
    const target = profiles.find((p) => p.id === profileId);
    if (target?.figma?.fileKey && parsed.fileKey !== target.figma.fileKey) {
      if (!confirm(`Tree fileKey "${parsed.fileKey}" does not match profile fileKey "${target.figma.fileKey}". Import anyway?`)) {
        setStatus('Import cancelled.', false);
        return;
      }
    }

    setStatus('Importing…');
    const r = await rpc({
      type: MSG.FIGMA_TREE_IMPORT,
      payload: { profileId, tree: parsed }
    });
    if (r?.error) {
      setStatus('Failed: ' + r.error, false);
      return;
    }
    setStatus(`✓ Imported ${r.stats.nodeCount} nodes (${(r.stats.sizeBytes / 1024).toFixed(1)} KB).`);
    $('tree-file').value = '';
    await refreshTrees();
  });

  // ============== Saved issues ==============
  async function refreshIssues() {
    const issues = await rpc({ type: MSG.ISSUE_LIST }) || [];
    const tbody = document.querySelector('#issues tbody');
    tbody.innerHTML = '';
    if (issues.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8" class="muted" style="text-align:center;padding:16px">No saved issues yet.</td>';
      tbody.appendChild(tr);
      return;
    }
    for (const i of issues) {
      const ctx = i.context || {};
      const vp = ctx.viewport || {};
      const bp = ctx.breakpoint || {};
      const vpStr = vp.w ? `${vp.w}×${vp.h}${bp.label ? ` (${bp.label})` : ''}` : '—';
      const pageSec = [i.page, i.section].filter(Boolean).join(' · ') || '—';
      const savedAt = (i.updatedAt || i.createdAt || '').slice(0, 10) || '—';

      // Annotation summary — pins + other layers across all screenshots.
      let pinTotal = 0, annotTotal = 0, shotsAnnot = 0;
      for (const s of (i.screenshots || [])) {
        const layers = s?.annotations?.layers || [];
        if (layers.length) shotsAnnot++;
        for (const l of layers) {
          if (l.type === 'pin') pinTotal++; else annotTotal++;
        }
      }
      const annotCell = (pinTotal + annotTotal) > 0
        ? `${pinTotal > 0 ? `<span class="tag" title="${pinTotal} numbered pins">📍 ${pinTotal}</span>` : ''}${annotTotal > 0 ? ` <span class="tag" title="${annotTotal} other shapes (rect/arrow/text/blur)">✦ ${annotTotal}</span>` : ''}<small class="muted" style="margin-left:4px">${shotsAnnot}/${(i.screenshots || []).length} shot${(i.screenshots || []).length === 1 ? '' : 's'}</small>`
        : (i.screenshots || []).length > 0
            ? `<span class="muted">— <small>${(i.screenshots || []).length} raw</small></span>`
            : '<span class="muted">—</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(i.id)}</code></td>
        <td>${escapeHtml(i.title || '(no title)')}</td>
        <td><span class="tag">${escapeHtml(i.severity || '—')}</span></td>
        <td>${escapeHtml(pageSec)}</td>
        <td><code>${escapeHtml(vpStr)}</code></td>
        <td>${annotCell}</td>
        <td>${escapeHtml(savedAt)}</td>
        <td class="actions">
          <button data-act="issue-edit" data-id="${escapeAttr(i.id)}">Edit</button>
          <button data-act="issue-delete" data-id="${escapeAttr(i.id)}" class="danger">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  document.querySelector('#issues').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (btn.dataset.act === 'issue-edit') {
      const issues = await rpc({ type: MSG.ISSUE_LIST }) || [];
      const issue = issues.find((x) => x.id === id);
      if (!issue) { alert('Issue not found.'); return; }
      const result = await QA.formModal.open(issue, {
        // No source DOM element here — Recapture would be meaningless.
        disableRecapture: true,
        // Pass live settings so the annotation editor uses the right pin
        // style / color / default tool when re-editing on the settings page.
        settings: _liveSettings,
        onPasteFromClipboard: async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              for (const t of item.types) {
                if (t.startsWith('image/')) {
                  const blob = await item.getType(t);
                  const dataUrl = await blobToDataUrl(blob);
                  return makeShot(issue.id, dataUrl, 'paste');
                }
              }
            }
          } catch (err) {
            alert('Could not read clipboard. Browser may need permission, or there is no image.\n\nDetails: ' + (err?.message || err));
          }
          return null;
        },
        onUploadFile: async (file) => {
          if (!file || !file.type.startsWith('image/')) return null;
          const dataUrl = await blobToDataUrl(file);
          return makeShot(issue.id, dataUrl, 'upload');
        }
      });
      if (result) {
        await rpc({ type: MSG.ISSUE_SAVE, payload: result });
        await refreshIssues();
      }
    } else if (btn.dataset.act === 'issue-delete') {
      if (!confirm(`Delete issue ${id}?`)) return;
      await rpc({ type: MSG.ISSUE_DELETE, payload: id });
      await refreshIssues();
    }
  });

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function makeShot(id, dataUrl, sourceLabel) {
    const idx = Date.now() % 100000;
    return {
      filename: `${id}-${sourceLabel}-${idx}.png`,
      relativePath: `screenshots/${id}-${sourceLabel}-${idx}.png`,
      dataUrl,
      source: sourceLabel,
      capturedAt: new Date().toISOString()
    };
  }

  // ============== Import report (ZIP or JSON) ==============
  $('report-import').addEventListener('click', async () => {
    const file = $('report-file').files?.[0];
    const setStatus = (txt, ok = true) => {
      const el = $('report-status');
      el.textContent = txt;
      el.style.color = ok ? '' : '#c0392b';
    };

    if (!file) { setStatus('Choose a .zip or .json file first.', false); return; }
    setStatus('Importing…');

    try {
      const result = await importReportFile(file);
      setStatus(`✓ ${result.imported} imported, ${result.skipped} skipped${result.shotsAttached ? `, ${result.shotsAttached} screenshots` : ''}.`);
      $('report-file').value = '';
      await refreshIssues();
    } catch (e) {
      setStatus('Failed: ' + (e?.message || e), false);
    }
  });

  // Returns { imported, skipped, shotsAttached } and writes via MSG.ISSUE_SAVE.
  // Skip-duplicates policy: any incoming issue whose ID matches an existing
  // saved issue is left alone. This is the safest default per spec.
  async function importReportFile(file) {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
    let report;
    let screenshotsByPath = {}; // path -> dataUrl

    if (isZip) {
      const entries = await QA.zipStore.parseZip(file);
      const reportEntry = entries.find((e) => e.path === 'qa-report.json');
      if (!reportEntry) throw new Error('zip is missing qa-report.json');
      report = JSON.parse(new TextDecoder('utf-8').decode(reportEntry.data));
      // Convert each PNG entry into a dataUrl keyed by its path so we can
      // re-attach to issue.screenshots[].relativePath references.
      for (const e of entries) {
        if (!/\.(png|jpe?g|gif|webp)$/i.test(e.path)) continue;
        const ext = (e.path.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'gif' ? 'image/gif'
                   : ext === 'webp' ? 'image/webp'
                   : 'image/png';
        screenshotsByPath[e.path] = await bytesToDataUrl(e.data, mime);
      }
    } else {
      const text = await file.text();
      report = JSON.parse(text);
    }

    if (report?.$schema !== 'qa-report-v1' || !report.report?.issues) {
      throw new Error(`unexpected report shape (got $schema=${report?.$schema})`);
    }

    const existing = await rpc({ type: MSG.ISSUE_LIST }) || [];
    const existingIds = new Set(existing.map((i) => i.id));

    let imported = 0, skipped = 0, shotsAttached = 0;
    for (const issue of report.report.issues) {
      if (!issue?.id) { skipped++; continue; }
      if (existingIds.has(issue.id)) { skipped++; continue; }

      // Re-attach screenshot dataUrls from the ZIP. JSON-only imports keep
      // whatever the report had (which is usually nothing — exporter strips
      // dataUrls from MD/JSON-without-zip). Either way we don't fail.
      const shots = Array.isArray(issue.screenshots) ? issue.screenshots : (issue.screenshot ? [issue.screenshot] : []);
      const rebuilt = shots.map((s) => {
        if (!s) return null;
        if (s.dataUrl) return s;
        const lookupPath = s.relativePath || s.path || s.filename;
        if (lookupPath && screenshotsByPath[lookupPath]) {
          shotsAttached++;
          return { ...s, dataUrl: screenshotsByPath[lookupPath] };
        }
        // Try with screenshots/ prefix or basename fallback
        const basename = (lookupPath || '').split('/').pop();
        const guess = basename ? screenshotsByPath[`screenshots/${basename}`] : null;
        if (guess) { shotsAttached++; return { ...s, dataUrl: guess }; }
        return s;
      }).filter(Boolean);
      issue.screenshots = rebuilt;
      issue.screenshot = rebuilt[0] || null;

      await rpc({ type: MSG.ISSUE_SAVE, payload: issue });
      imported++;
    }
    return { imported, skipped, shotsAttached };
  }

  // Convert a Uint8Array of binary image bytes into a data URL.
  // Uses FileReader so very large PNGs do not blow the call stack the way
  // String.fromCharCode(...bytes) would.
  function bytesToDataUrl(bytes, mime) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([bytes], { type: mime });
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ============== Settings — generic binding for [data-setting] elements ==============
  // Each element with data-setting="capture.padding" reads/writes that path on
  // chrome.storage.local["settings"]. Type coercion is automatic from input type
  // and an optional data-shape attribute ("csv-list" | "json").
  let _liveSettings = null;

  function getPath(obj, path) {
    return path.split('.').reduce((cur, k) => (cur == null ? cur : cur[k]), obj);
  }
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function readFieldValue(el) {
    const shape = el.getAttribute('data-shape');
    if (shape === 'csv-list') {
      return el.value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (shape === 'json') {
      const raw = el.value.trim();
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    }
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? null : Number(el.value);
    if (el.tagName === 'SELECT') {
      const v = el.value;
      if (v === 'true')  return true;
      if (v === 'false') return false;
      const n = Number(v);
      return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : v;
    }
    return el.value;
  }

  function writeFieldValue(el, value) {
    const shape = el.getAttribute('data-shape');
    if (shape === 'csv-list') {
      el.value = Array.isArray(value) ? value.join(', ') : (value || '');
      return;
    }
    if (shape === 'json') {
      el.value = value == null ? '' : JSON.stringify(value);
      return;
    }
    if (el.type === 'checkbox') { el.checked = !!value; return; }
    if (el.tagName === 'SELECT') { el.value = String(value); return; }
    el.value = value == null ? '' : String(value);
  }

  function bindFieldHandlers() {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
      el.addEventListener(evt, async () => {
        const path = el.getAttribute('data-setting');
        const value = readFieldValue(el);
        const patch = {};
        setPath(patch, path, value);
        // For nested keys we need to send the object root, not the nested key.
        // setPath builds patch.capture.padding = 40; but the SETTING_SET handler
        // does deepShallow at the root level, so this works.
        const r = await rpc({ type: MSG.SETTING_SET, payload: patch });
        if (r?.settings) _liveSettings = r.settings;
      });
    });
  }

  function applySettingsToFields(settings) {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const path = el.getAttribute('data-setting');
      const v = getPath(settings, path);
      if (v !== undefined) writeFieldValue(el, v);
    });
  }

  // ============== Mode picker ==============
  // Each mode declares (a) capture-source presets, (b) which cards are "primary"
  // (highlighted + expanded), (c) a short helper-banner sentence so the user
  // knows why some cards are hidden.
  const MODES = {
    'prod-bug': {
      label: 'PROD bug capture',
      hint: 'Showing the cards most useful for live-site bugs: Capture · Privacy · Sources · Defaults · Inspector · Integrations.',
      sources: { computed: true, source: true, consoleErrors: true, networkFailures: true, a11y: false },
      primary: ['capture', 'privacy', 'sources']
    },
    'design-fidelity': {
      label: 'Design fidelity',
      hint: 'Showing the cards most useful for Figma comparison: Figma tree · Capture · Sources · Integrations.',
      sources: { computed: true, source: true, consoleErrors: false, networkFailures: false, a11y: false },
      primary: ['figma', 'capture']
    },
    admin: {
      label: 'Admin / CMS',
      hint: 'Showing the cards most useful for admin systems: Privacy is highlighted because admin pages often render real customer data.',
      sources: { computed: true, source: true, consoleErrors: true, networkFailures: true, a11y: false, appState: true },
      primary: ['privacy', 'capture', 'sources']
    },
    a11y: {
      label: 'Accessibility audit',
      hint: 'Showing the cards most useful for a11y audits: Capture · Sources (axe-core) · Defaults · Inspector.',
      sources: { computed: true, source: true, a11y: true },
      primary: ['sources']
    },
    i18n: {
      label: 'Localization (i18n / RTL)',
      hint: 'Showing the cards most useful for localization QA. Pseudolocale + RTL toggles ship in Sprint 2.',
      sources: { computed: true, source: true },
      primary: ['capture', 'defaults']
    },
    custom: {
      label: 'Custom',
      hint: 'Showing every card. Use this when you want to fine-tune each toggle yourself.',
      sources: {}, // user picks
      primary: []
    }
  };

  // Lookup by section heading ("Capture preferences" → "capture") so we don't
  // have to add ids to every card.
  const CARD_KEYS = {
    'Capture preferences': 'capture',
    'Privacy & redaction': 'privacy',
    'Capture sources': 'sources',
    'Issue defaults': 'defaults',
    'Integrations': 'integrations',
    'Inspector behavior': 'inspector',
    'Figma frame tree': 'figma'
  };

  function bindModePicker() {
    const grid = document.querySelector('#mode-grid');
    if (!grid) return;
    grid.addEventListener('change', async (e) => {
      const radio = e.target.closest('input[name=qa-mode]');
      if (!radio) return;
      const mode = radio.value;
      const def = MODES[mode] || {};
      const next = {
        mode,
        modeChosenAt: new Date().toISOString(),
        ...(def.sources ? { sources: def.sources } : {})
      };
      const r = await rpc({ type: MSG.SETTING_SET, payload: next });
      if (r?.settings) {
        _liveSettings = r.settings;
        applySettingsToFields(r.settings);
        markActiveMode(mode);
        applyModeVisibility(mode);
      }
    });
  }

  function markActiveMode(mode) {
    document.querySelectorAll('.mode-tile').forEach((tile) => {
      const radio = tile.querySelector('input[name=qa-mode]');
      const checked = radio && radio.value === mode;
      if (radio) radio.checked = checked;
      tile.classList.toggle('checked', !!checked);
    });
    const badge = document.querySelector('#mode-badge');
    if (badge) {
      if (mode) {
        const def = MODES[mode];
        badge.textContent = def?.label || mode;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  }

  // ============== Mode-scoped UI visibility ==============
  // Every element with `data-modes="prod-bug,custom"` is shown only when the
  // active mode appears in that list. Cards listed in MODES[mode].primary get
  // the .qa-mode-primary highlight + start expanded. Other matching cards are
  // shown but collapsed by default — user can click the header to expand. The
  // mode picker, theme color, profiles and saved-issues cards have no
  // data-modes attribute and are always visible.
  function applyModeVisibility(mode) {
    const def = MODES[mode] || MODES.custom;
    const primarySet = new Set(def.primary || []);

    document.querySelectorAll('[data-modes]').forEach((el) => {
      const allow = (el.getAttribute('data-modes') || '').split(',').map((s) => s.trim());
      const visible = allow.includes(mode);
      el.classList.toggle('qa-mode-hidden', !visible);
    });

    document.querySelectorAll('section.card').forEach((card) => {
      const h2 = card.querySelector(':scope > h2');
      const heading = h2 ? h2.firstChild?.textContent?.trim() : '';
      const key = CARD_KEYS[heading];
      const isPrimary = key && primarySet.has(key);
      card.classList.toggle('qa-mode-primary', !!isPrimary);

      // Custom mode = expand everything. Otherwise: primary cards expanded,
      // non-primary mode-conditional cards collapsed.
      if (mode === 'custom') {
        card.classList.remove('qa-collapsed');
      } else if (card.hasAttribute('data-modes') && !card.classList.contains('qa-mode-hidden')) {
        if (isPrimary) card.classList.remove('qa-collapsed');
        else card.classList.add('qa-collapsed');
      }
    });

    // Hint banner
    const hint = document.getElementById('mode-hint');
    if (hint) {
      if (mode === 'custom' || !def.hint) {
        hint.classList.remove('show');
        hint.textContent = '';
      } else {
        hint.innerHTML = `<strong>${def.label}</strong> — ${def.hint} <a id="mode-show-all">Show all cards</a>`;
        hint.classList.add('show');
        const showAll = document.getElementById('mode-show-all');
        if (showAll) {
          showAll.addEventListener('click', () => {
            document.querySelectorAll('[data-modes].qa-mode-hidden').forEach((el) => el.classList.remove('qa-mode-hidden'));
            document.querySelectorAll('section.card.qa-collapsed').forEach((c) => c.classList.remove('qa-collapsed'));
            hint.classList.remove('show');
          });
        }
      }
    }
    // Notify the sidebar so the TOC re-renders with the new visible set.
    document.dispatchEvent(new CustomEvent('qa:mode-visibility-changed'));
  }

  // Click card heading to toggle collapse — works on every card except
  // mode-card (which has its own cursor:default rule).
  function bindCardCollapse() {
    document.querySelectorAll('section.card').forEach((card) => {
      if (card.id === 'mode-card') return;
      const h2 = card.querySelector(':scope > h2');
      if (!h2) return;
      h2.addEventListener('click', () => card.classList.toggle('qa-collapsed'));
    });
  }

  // ============== Advanced — export / import / reset / storage usage ==============
  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindAdvanced() {
    const exportBtn = $('settings-export');
    const importBtn = $('settings-import');
    const importFile = $('settings-import-file');
    const resetBtn = $('settings-reset');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const s = await rpc({ type: MSG.SETTING_GET });
        downloadJson('qa-annotator-settings.json', s);
      });
    }
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const f = importFile.files?.[0];
        if (!f) return;
        try {
          const parsed = JSON.parse(await f.text());
          await rpc({ type: MSG.SETTING_SET, payload: parsed });
          await loadAllSettings();
          alert('✓ Settings imported.');
        } catch (e) {
          alert('Import failed: ' + (e?.message || e));
        }
        importFile.value = '';
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset all settings to defaults? Theme color is preserved.')) return;
        // Send a payload that clears the user-saved object. The service-worker's
        // mergeSettings() will fill DEFAULTS for any missing key.
        const current = await rpc({ type: MSG.SETTING_GET });
        const reset = { inspectorColor: current?.inspectorColor || '#ec4899' };
        await chrome.storage.local.set({ settings: reset });
        await loadAllSettings();
        alert('✓ Settings reset.');
      });
    }
    refreshStorageUsage();
  }

  async function refreshStorageUsage() {
    const usage = $('storage-usage');
    const ver = $('settings-version');
    try {
      const all = await chrome.storage.local.get(null);
      const bytes = JSON.stringify(all).length;
      if (usage) usage.textContent = `Storage: ~${(bytes / 1024).toFixed(1)} KB used (chrome.storage.local).`;
    } catch {
      if (usage) usage.textContent = 'Storage usage unavailable.';
    }
    try {
      const m = chrome.runtime.getManifest();
      if (ver) ver.textContent = `Extension v${m.version} · min Chrome ${m.minimum_chrome_version}`;
    } catch {}
  }

  async function loadAllSettings() {
    const settings = await rpc({ type: MSG.SETTING_GET });
    _liveSettings = settings;
    applySettingsToFields(settings);
    markActiveMode(settings?.mode);
    applyModeVisibility(settings?.mode || 'custom');
    refreshFormBuilder();
  }

  // ============== QA issue form builder per mode ==============
  // Tabs across the top — one per QA mode. Each tab shows a table of common
  // form fields + registered panels. 3-state segmented pill per row:
  //   Hidden | Optional | Required
  // Toolbar: "Copy from <mode>" + "Reset to defaults".
  let _activeFormTab = 'prod-bug';

  function refreshFormBuilder() {
    const table = document.getElementById('form-builder-table');
    if (!table) return;
    const fc = self.QA?.formConfig;
    const reg = self.QA?.panelRegistry;
    if (!fc) {
      table.innerHTML = '<p class="muted">Form config module not loaded.</p>';
      return;
    }
    const config = fc.getEffectiveFormConfig(_activeFormTab, _liveSettings || {});

    // Common fields — flat list, label only (no field id), 🔒 for locked.
    const commonRows = fc.COMMON_FIELDS.map((f) => {
      const state = config.fields?.[f.id] || 'optional';
      const effectiveState = f.always ? 'required' : state;
      const lockBadge = f.always ? '<span class="fb-lock" title="Core field — always required">🔒</span>' : '';
      return `
        <div class="fb-row" data-row-type="field" data-row-id="${escapeAttr(f.id)}">
          <div class="fb-name">
            <span>${escapeHtml(f.label)}</span>
            ${lockBadge}
          </div>
          <div class="fb-state">${pillHtml(effectiveState, f.always)}</div>
        </div>
      `;
    }).join('');

    // Panels — keep "default in" chip (user finds value in seeing which mode
    // ships this panel by default, especially when on a custom tab).
    const panels = reg?.listPanelIds?.() || [];
    const panelRows = panels.map((p) => {
      const pcfg = config.panels?.[p.id] || { state: 'optional', fields: {} };
      const modeChips = (p.modes || []).map((m) => `<span class="fb-mode-chip">${escapeHtml(m)}</span>`).join('');
      return `
        <div class="fb-row" data-row-type="panel" data-row-id="${escapeAttr(p.id)}">
          <div class="fb-name">
            <span>📦 ${escapeHtml(p.title)}</span>
            ${modeChips ? `<span class="fb-default-in">default in: ${modeChips}</span>` : ''}
          </div>
          <div class="fb-state">${pillHtml(pcfg.state, false)}</div>
        </div>
      `;
    }).join('');

    table.innerHTML = `
      <div class="fb-section">
        <h4 class="fb-section-title">Common fields</h4>
        <div class="fb-list">${commonRows}</div>
      </div>
      ${panelRows ? `
      <div class="fb-section">
        <h4 class="fb-section-title">Mode panels</h4>
        <div class="fb-list">${panelRows}</div>
      </div>` : ''}
    `;

    // Update tabs visually.
    document.querySelectorAll('#form-builder-tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === _activeFormTab);
    });
  }

  // Save feedback — light flash + small toast next to the toolbar so the user
  // sees their click registered. Keeps the optimistic UI fast (no spinner).
  let _toastTimer = null;
  function showSaveToast() {
    let toast = document.getElementById('form-builder-toast');
    if (!toast) {
      toast = document.createElement('span');
      toast.id = 'form-builder-toast';
      toast.className = 'form-builder-toast';
      document.getElementById('form-builder-toolbar')?.appendChild(toast);
    }
    toast.textContent = '✓ Saved';
    toast.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  function pillHtml(state, locked) {
    // Locked pill (core fields like Title / Severity) shows only a single
    // "Required" badge — no need to render 3 disabled buttons that imply the
    // user might be able to change them.
    if (locked) {
      return `<span class="fb-pill fb-pill-locked" data-state="required">Required</span>`;
    }
    const states = [
      { id: 'hidden',   label: 'Hidden' },
      { id: 'optional', label: 'Optional' },
      { id: 'required', label: 'Required' }
    ];
    return `
      <div class="fb-pill" data-state="${escapeAttr(state)}" role="radiogroup">
        ${states.map((s) => `
          <button type="button" class="fb-pill-btn ${state === s.id ? 'is-active' : ''}" data-state="${escapeAttr(s.id)}">${escapeHtml(s.label)}</button>
        `).join('')}
      </div>
    `;
  }

  // Persist a single field / panel state change for the active tab.
  async function persistFormBuilder(rowType, rowId, newState) {
    const fc = self.QA?.formConfig;
    if (!fc) return;
    // Build patch — only the changed cell, deep-merged via SETTING_SET.
    const patch = { modeForms: {} };
    patch.modeForms[_activeFormTab] = {};
    if (rowType === 'field') {
      patch.modeForms[_activeFormTab].fields = { [rowId]: newState };
    } else if (rowType === 'panel') {
      patch.modeForms[_activeFormTab].panels = { [rowId]: { state: newState } };
    }
    const r = await rpc({ type: MSG.SETTING_SET, payload: patch });
    if (r?.settings) _liveSettings = r.settings;
  }

  function bindFormBuilder() {
    const root = document.getElementById('form-builder');
    if (!root) return;
    // Tabs.
    document.getElementById('form-builder-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      _activeFormTab = btn.dataset.tab;
      refreshFormBuilder();
    });
    // Pill clicks (delegated).
    root.addEventListener('click', async (e) => {
      const pillBtn = e.target.closest('.fb-pill-btn');
      if (!pillBtn || pillBtn.disabled) return;
      const row = pillBtn.closest('.fb-row');
      if (!row) return;
      const rowType = row.dataset.rowType;
      const rowId = row.dataset.rowId;
      const newState = pillBtn.dataset.state;
      // Optimistic: update UI immediately + toggle data-state on parent pill
      // so the colored background animates correctly via CSS.
      const pill = pillBtn.closest('.fb-pill');
      if (pill) pill.dataset.state = newState;
      row.querySelectorAll('.fb-pill-btn').forEach((b) => b.classList.toggle('is-active', b === pillBtn));
      await persistFormBuilder(rowType, rowId, newState);
      showSaveToast();
    });
    // Copy-from button.
    document.getElementById('form-builder-copy-apply')?.addEventListener('click', async () => {
      const sel = document.getElementById('form-builder-copy-from');
      const sourceMode = sel?.value;
      if (!sourceMode || sourceMode === _activeFormTab) {
        alert('Pick a different source mode.');
        return;
      }
      if (!confirm(`Copy form config from "${sourceMode}" to "${_activeFormTab}"? This overwrites current settings for ${_activeFormTab}.`)) return;
      const fc = self.QA?.formConfig;
      const sourceConfig = fc.getEffectiveFormConfig(sourceMode, _liveSettings || {});
      const patch = { modeForms: { [_activeFormTab]: sourceConfig } };
      const r = await rpc({ type: MSG.SETTING_SET, payload: patch });
      if (r?.settings) _liveSettings = r.settings;
      refreshFormBuilder();
    });
    // Reset button (now a text link — prevent default so URL doesn't change).
    document.getElementById('form-builder-reset')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!confirm(`Reset "${_activeFormTab}" form to default config?`)) return;
      // Clear the user override by setting modeForms[mode] = null. The
      // service-worker mergeSettings is a top-level shallow merge, so we
      // need to fetch full settings, drop the key, write back.
      const cur = await rpc({ type: MSG.SETTING_GET });
      const next = { ...(cur || {}) };
      next.modeForms = { ...(cur?.modeForms || {}) };
      delete next.modeForms[_activeFormTab];
      // Force-write whole settings object via the service-worker API.
      await chrome.storage.local.set({ settings: next });
      _liveSettings = next;
      // Broadcast to content scripts so live tabs refresh too.
      try { await rpc({ type: MSG.SETTING_SET, payload: {} }); } catch {}
      refreshFormBuilder();
    });
  }

  // ── Sidebar TOC + search (v0.6.0) ─────────────────────────────────
  // Build a left-rail TOC from every visible .card on the page. Each h2 text
  // becomes the entry label; the section gets an auto-generated id so anchors
  // work. Search filters the TOC entries AND hides cards whose label/h2/p
  // text doesn't match — keeping the page focused while typing.
  function slugify(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  }
  function buildSidebar() {
    const toc = document.getElementById('settings-toc');
    if (!toc) return;
    const cards = Array.from(document.querySelectorAll('.settings-main .card'));
    const seen = new Set();
    toc.innerHTML = cards.map((card) => {
      const h2 = card.querySelector('h2');
      const text = (h2?.textContent || '').replace(/\s+/g, ' ').trim();
      let id = card.id || slugify(text);
      let dedup = id;
      let n = 2;
      while (seen.has(dedup)) dedup = `${id}-${n++}`;
      seen.add(dedup);
      if (!card.id) card.id = dedup;
      // Hide non-visible cards from the TOC entirely (mode filter wins).
      const hidden = card.classList.contains('qa-mode-hidden');
      return `<a href="#${card.id}" class="settings-toc-link${hidden ? ' is-hidden' : ''}" data-card-id="${card.id}">${escapeHtml(text || card.id)}</a>`;
    }).join('');

    // Smooth scroll on click. Default anchor jump works but jumps abruptly.
    toc.addEventListener('click', (e) => {
      const link = e.target.closest('a.settings-toc-link');
      if (!link) return;
      const target = document.getElementById(link.dataset.cardId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${link.dataset.cardId}`);
      }
    });

    // Scroll spy — mark the topmost-visible card's TOC entry active.
    const linksByCard = new Map(
      Array.from(toc.querySelectorAll('a.settings-toc-link')).map((a) => [a.dataset.cardId, a])
    );
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length === 0) return;
      for (const [, a] of linksByCard) a.classList.remove('is-active');
      const id = visible[0].target.id;
      linksByCard.get(id)?.classList.add('is-active');
    }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });
    for (const card of cards) io.observe(card);
  }

  function bindSearch() {
    const input = document.getElementById('settings-search');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => applySearch(input.value), 100);
    });
  }
  function applySearch(query) {
    const q = String(query || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.settings-main .card');
    const tocLinks = document.querySelectorAll('#settings-toc a.settings-toc-link');
    if (!q) {
      // Clear filter: restore mode-driven visibility (already on each card).
      cards.forEach((c) => c.classList.remove('search-hidden'));
      tocLinks.forEach((a) => a.classList.remove('search-hidden'));
      return;
    }
    cards.forEach((card) => {
      const haystack = (card.textContent || '').toLowerCase();
      const matched = haystack.includes(q);
      card.classList.toggle('search-hidden', !matched);
    });
    tocLinks.forEach((a) => {
      const card = document.getElementById(a.dataset.cardId);
      a.classList.toggle('search-hidden', card?.classList.contains('search-hidden'));
    });
  }

  buildSidebar();
  bindSearch();
  // Re-build sidebar after mode picker toggles card visibility — the mode
  // filter sets display:none on cards, and we want the TOC to mirror that.
  document.addEventListener('qa:mode-visibility-changed', () => buildSidebar());

  bindFieldHandlers();
  bindModePicker();
  bindCardCollapse();
  bindAdvanced();
  bindFormBuilder();
  await loadColor();
  await loadAllSettings();
  await refresh();
  await refreshIssues();
  await refreshTrees();
  // Initial sidebar pass after async loads — some cards may have been hidden
  // by mode filter applied during binding.
  buildSidebar();
})();
