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

  await loadColor();
  await refresh();
  await refreshTrees();
})();
