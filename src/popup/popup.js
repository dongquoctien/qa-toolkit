// Popup: pick active profile, start/stop inspector, export.
(async function () {
  const MSG = QA.MSG;

  const $ = (id) => document.getElementById(id);

  function rpc(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function activeTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t;
  }

  // Pull the saved theme color so popup UI (header link, primary button, focus
  // ring, hover accents) matches what the user sees in the inspector overlay.
  async function applyTheme() {
    const settings = await rpc({ type: MSG.SETTING_GET });
    const color = settings?.inspectorColor || '#ec4899';
    document.documentElement.style.setProperty('--qa-accent', color);
    document.documentElement.style.setProperty('--qa-accent-hover', darken(color, 0.10));
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
  await applyTheme();

  async function refresh() {
    const profiles = await rpc({ type: MSG.PROFILE_LIST });
    const active   = await rpc({ type: MSG.PROFILE_GET_ACTIVE });
    const issues   = await rpc({ type: MSG.ISSUE_LIST });

    const sel = $('profile');
    sel.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.framework?.type || 'generic'})`;
      if (active && active.id === p.id) opt.selected = true;
      sel.appendChild(opt);
    }
    if (profiles.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = '(none — import via Settings)';
      opt.disabled = true; opt.selected = true;
      sel.appendChild(opt);
    }

    $('count').textContent = String(issues?.length || 0);
    $('active-info').textContent = active ? `Active: ${active.id}` : 'No active profile';

    // Inspector state from content
    try {
      const tab = await activeTab();
      const state = await chrome.tabs.sendMessage(tab.id, { type: MSG.INSPECTOR_STATE });
      $('toggle').textContent = state?.active ? 'Stop Inspector' : 'Start Inspector';
    } catch {
      $('toggle').textContent = 'Start Inspector';
    }
  }

  $('profile').addEventListener('change', async (e) => {
    await rpc({ type: MSG.PROFILE_SET_ACTIVE, payload: e.target.value });
    await refresh();
  });

  $('toggle').addEventListener('click', async () => {
    const tab = await activeTab();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.INSPECTOR_TOGGLE });
    } catch {
      alert('Content script not loaded on this page (chrome://, web store, or PDF viewer).');
    }
    window.close();
  });

  $('export-json').addEventListener('click', async () => {
    await doExport('json');
  });
  $('export-md').addEventListener('click', async () => {
    await doExport('md');
  });
  $('export-zip').addEventListener('click', async () => {
    await doExport('zip');
  });

  async function doExport(format) {
    const profileObj = await rpc({ type: MSG.PROFILE_GET_ACTIVE });
    const issues = await rpc({ type: MSG.ISSUE_LIST }) || [];
    if (!issues.length) { alert('No issues to export.'); return; }
    const tab = await activeTab();
    const date = new Date().toISOString().slice(0, 10);
    const baseName = `qa-report-${(profileObj?.id || 'unknown')}-${date}`;
    const exporter = QA.exporter;

    if (format === 'json') {
      const blob = await exporter.toJsonBlob({ profile: profileObj, issues, scopeUrl: tab.url });
      await downloadBlob(`${baseName}.json`, blob);
    } else if (format === 'md') {
      const blob = await exporter.toMarkdownBlob({ profile: profileObj, issues, scopeUrl: tab.url });
      await downloadBlob(`${baseName}.md`, blob);
    } else if (format === 'zip') {
      const blob = await exporter.toZipBlob({ profile: profileObj, issues, scopeUrl: tab.url });
      await downloadBlob(`${baseName}.zip`, blob);
    }
  }

  async function downloadBlob(filename, blob) {
    // chrome.downloads can't accept blob: URLs reliably from popup scope; use anchor.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete all saved issues?')) return;
    await rpc({ type: MSG.ISSUE_CLEAR });
    await refresh();
  });
  $('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await refresh();
})();
