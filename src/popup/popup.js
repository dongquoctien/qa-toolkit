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

  const MODE_LABELS = {
    'prod-bug':        'PROD bug',
    'design-fidelity': 'Design',
    'admin':           'Admin',
    'a11y':            'A11y',
    'i18n':            'i18n',
    'custom':          'Custom'
  };

  // Pull the saved theme color so popup UI (header link, primary button, focus
  // ring, hover accents) matches what the user sees in the inspector overlay.
  // Also surface the active QA mode in the header chip so the user knows which
  // capture sources / modal panels are wired right now.
  async function applyTheme() {
    const settings = await rpc({ type: MSG.SETTING_GET });
    const color = settings?.inspectorColor || '#ec4899';
    document.documentElement.style.setProperty('--qa-accent', color);
    document.documentElement.style.setProperty('--qa-accent-hover', darken(color, 0.10));

    const chip = $('mode-chip');
    if (chip) {
      const mode = settings?.mode || 'custom';
      chip.textContent = MODE_LABELS[mode] || mode;
      chip.dataset.mode = mode;
      // Build hover tooltip listing the auto-attach sources turned on by mode.
      const src = settings?.sources || {};
      const onSources = Object.entries(src).filter(([, v]) => v).map(([k]) => k);
      chip.title = `Active mode: ${MODE_LABELS[mode] || mode}`
        + (onSources.length ? `\nAuto-capture: ${onSources.join(', ')}` : '')
        + '\nClick Settings → QA mode to change';
    }
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

    // Pin summary — total numbered pins across every issue's screenshots.
    let totalPins = 0;
    let totalAnnotated = 0;
    for (const i of issues || []) {
      for (const s of (i.screenshots || [])) {
        const layers = s.annotations?.layers || [];
        if (layers.length) totalAnnotated++;
        for (const l of layers) if (l.type === 'pin') totalPins++;
      }
    }
    const pinEl = $('pin-count');
    if (pinEl) {
      if (totalPins > 0) {
        pinEl.hidden = false;
        pinEl.textContent = `${totalPins} pin${totalPins === 1 ? '' : 's'}`;
        pinEl.title = `${totalPins} numbered pins across ${totalAnnotated} annotated screenshot${totalAnnotated === 1 ? '' : 's'}`;
      } else {
        pinEl.hidden = true;
      }
    }

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

  // Quick capture — manual region drag without picking an element. Popup
  // closes, content script handles the drag → annotate → modal flow.
  $('quick-capture')?.addEventListener('click', async () => {
    const tab = await activeTab();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.MANUAL_CAPTURE_START });
    } catch {
      alert('Content script not loaded on this page (chrome://, web store, or PDF viewer).');
      return;
    }
    window.close();
  });

  // Viewport emulator — squeeze host content into a fixed-width column for
  // mobile/tablet layout testing. Popup stays open so user can toggle widths.
  const viewportSelect = $('viewport');
  const viewportCustom = $('viewport-custom');
  if (viewportSelect) {
    // Restore current state from content script
    (async () => {
      try {
        const tab = await activeTab();
        const state = await chrome.tabs.sendMessage(tab.id, { type: MSG.VIEWPORT_STATE });
        if (state?.active && state.width) {
          const presetValues = ['360', '414', '768', '1024'];
          if (presetValues.includes(String(state.width))) {
            viewportSelect.value = String(state.width);
          } else {
            viewportSelect.value = 'custom';
            viewportCustom.value = state.width;
            viewportCustom.hidden = false;
          }
        }
      } catch {/* no content script — leave default */}
    })();

    async function applyViewport(width) {
      const tab = await activeTab();
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: MSG.VIEWPORT_SET,
          payload: { width: width || 0 }
        });
      } catch {
        alert('Content script not loaded on this page (chrome://, web store, or PDF viewer).');
      }
    }

    viewportSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        viewportCustom.hidden = false;
        viewportCustom.focus();
        return;
      }
      viewportCustom.hidden = true;
      await applyViewport(parseInt(val, 10) || 0);
    });

    viewportCustom.addEventListener('change', async (e) => {
      const w = parseInt(e.target.value, 10);
      if (w >= 200 && w <= 2400) await applyViewport(w);
    });
  }

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
