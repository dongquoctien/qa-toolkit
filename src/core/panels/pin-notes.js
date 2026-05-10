// Pin notes panel — universal across every QA mode.
//
// Surface every numbered pin laid down in the annotation editor as a textarea
// row, grouped by screenshot. The author writes one short note per pin
// describing what they marked. On save we write each note back into the
// matching layer's `note` field — same shape the editor produces, so the
// modal/editor round-trip is lossless.
//
// Why a separate panel and not inline in the editor: the editor is a busy
// canvas tool; a master list of pins-with-notes makes it easy to fix a typo
// or fill in notes you skipped during draw. Settings page reuse means a QA
// can re-edit notes long after the original session.
(function () {
  const PANEL_ID = 'pin-notes';

  function listPinsByShot(issue) {
    const shots = Array.isArray(issue.screenshots) ? issue.screenshots : (issue.screenshot ? [issue.screenshot] : []);
    return shots.map((shot, shotIdx) => {
      const layers = shot?.annotations?.layers || [];
      const pins = [];
      layers.forEach((layer, layerIdx) => {
        if (layer.type === 'pin') {
          pins.push({
            shotIdx,
            layerIdx,
            n: layer.n,
            note: layer.note || '',
            color: layer.color || '#ec4899',
            x: layer.x, y: layer.y
          });
        }
      });
      return { shotIdx, shot, pins };
    });
  }

  function isAvailable(issue) {
    const shots = listPinsByShot(issue);
    return shots.some((s) => s.pins.length > 0);
  }

  function render(issue) {
    const groups = listPinsByShot(issue);
    const totalPins = groups.reduce((n, g) => n + g.pins.length, 0);
    if (totalPins === 0) {
      return `
        <div class="qa-panel-empty">
          No numbered pins on any screenshot yet. Add some via the annotation editor (✎ icon on each thumbnail).
        </div>
      `;
    }
    const blocks = groups
      .filter((g) => g.pins.length > 0)
      .map((g) => {
        const thumb = g.shot?.dataUrl ? `<img class="qa-pinnote-thumb" src="${escapeAttr(g.shot.dataUrl)}" alt="Screenshot ${g.shotIdx + 1}" />` : '';
        const rows = g.pins.map((p) => `
          <div class="qa-pinnote-row" data-shot-idx="${g.shotIdx}" data-layer-idx="${p.layerIdx}">
            <span class="qa-pinnote-num" style="background:${escapeAttr(p.color)}">${escapeHtml(String(p.n))}</span>
            <textarea class="qa-pinnote-text" rows="1" placeholder="What does pin ${escapeHtml(String(p.n))} mark?">${escapeHtml(p.note)}</textarea>
          </div>
        `).join('');
        return `
          <div class="qa-pinnote-group">
            <div class="qa-pinnote-head">
              ${thumb}
              <span class="qa-pinnote-shot-label">Screenshot ${g.shotIdx + 1} · ${g.pins.length} pin${g.pins.length === 1 ? '' : 's'}</span>
            </div>
            <div class="qa-pinnote-rows">${rows}</div>
          </div>
        `;
      })
      .join('');
    return `<div class="qa-pinnote-list">${blocks}</div>`;
  }

  // No mount-time logic needed — textareas are plain DOM. Auto-resize would
  // be nice but not Sprint 2 scope.
  function mount(panelEl, issue, onChange) {
    const onInput = () => { if (onChange) onChange(); };
    panelEl.addEventListener('input', onInput);
    return () => panelEl.removeEventListener('input', onInput);
  }

  // Read every textarea back and patch the corresponding layer's `note`.
  // Returns a small descriptor object — the actual write to issue.screenshots
  // happens inside form-modal's harvest. We mutate via `issue.screenshots[i]`
  // because that's the live array the modal saves.
  function harvest(panelEl, issue) {
    const shots = Array.isArray(issue.screenshots) ? issue.screenshots : (issue.screenshot ? [issue.screenshot] : []);
    const written = [];
    panelEl.querySelectorAll('.qa-pinnote-row').forEach((row) => {
      const shotIdx = Number(row.dataset.shotIdx);
      const layerIdx = Number(row.dataset.layerIdx);
      const text = row.querySelector('.qa-pinnote-text')?.value || '';
      const shot = shots[shotIdx];
      const layer = shot?.annotations?.layers?.[layerIdx];
      if (!layer || layer.type !== 'pin') return;
      layer.note = text;
      written.push({ shotIdx, n: layer.n, note: text });
    });
    return { entries: written, count: written.length };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'Pin notes',
    modes: ['prod-bug', 'design-fidelity', 'admin', 'a11y', 'i18n', 'custom'],
    defaultCollapsed: false,
    isAvailable,
    render,
    mount,
    harvest
  };

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  if (target.QA.panelRegistry?.register) {
    target.QA.panelRegistry.register(panel);
  } else {
    // Registry hasn't loaded yet (manifest order issue). Stash + retry on next
    // tick so panel still registers. This keeps the load order soft.
    target.QA.panels = target.QA.panels || {};
    target.QA.panels[PANEL_ID] = panel;
  }
})();
