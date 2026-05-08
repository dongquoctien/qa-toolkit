// Build qa-report-v1 JSON, Markdown, and ZIP from saved issues + active profile.
(function () {
  function buildReport({ profile, issues, scopeUrl }) {
    const date = new Date().toISOString().slice(0, 10);
    const reporter = null;
    const counts = countBy(issues, (i) => i.severity);

    // Aggregate viewport coverage across the session so the report header
    // tells AI/dev readers which screens were tested at a glance.
    const viewportSet = new Map();
    for (const i of issues) {
      const ctx = i.context || {};
      const v = ctx.viewport;
      if (!v) continue;
      const key = `${v.w}x${v.h}@${v.dpr || 1}`;
      const entry = viewportSet.get(key) || {
        w: v.w, h: v.h, dpr: v.dpr || 1,
        orientation: v.orientation,
        breakpoint: ctx.breakpoint?.label || null,
        count: 0
      };
      entry.count++;
      viewportSet.set(key, entry);
    }
    const viewportsTested = [...viewportSet.values()].sort((a, b) => a.w - b.w);

    return {
      $schema: 'qa-report-v1',
      report: {
        tool: 'qa-annotator-extension',
        toolVersion: '0.1.0',
        profile: profile ? {
          id: profile.id,
          name: profile.name,
          version: profile.version || '1.0.0'
        } : null,
        reporter,
        exportedAt: new Date().toISOString(),
        scope: {
          url: scopeUrl || null,
          date,
          locale: issues[0]?.context?.locale || null,
          // First-issue snapshot kept for back-compat; viewportsTested is the canonical list.
          viewport: issues[0]?.context?.viewport || null,
          viewportsTested
        },
        syncHints: profile?.jira ? {
          suggestedJiraProject: profile.jira.projectKey,
          suggestedParent: profile.jira.defaultParent,
          defaultMode: profile.jira.defaultMode,
          defaultLabels: profile.jira.defaultLabels
        } : null,
        counts: {
          total: issues.length,
          ...counts
        },
        issues
      }
    };
  }

  function countBy(arr, fn) {
    const out = {};
    for (const item of arr) {
      const k = fn(item);
      if (!k) continue;
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  // ============ panel renderers (Markdown) ============
  // Each function returns a string[] (lines, no trailing blank). Empty
  // panels return [] so toMarkdown can skip them silently.

  function renderPanelsMarkdown(issue) {
    const panels = issue.panels || {};
    const lines = [];
    // Order: runtime → design → app-state → a11y → i18n → pin-notes
    const renderers = [
      ['runtime-context', renderRuntimePanel],
      ['design-fidelity', renderDesignPanel],
      ['app-state',       renderAppStatePanel],
      ['a11y-findings',   renderA11yPanel],
      ['i18n-findings',   renderI18nPanel],
      ['pin-notes',       renderPinNotesPanel]
    ];
    for (const [id, fn] of renderers) {
      if (!panels[id] && id !== 'runtime-context' && id !== 'a11y-findings' && id !== 'pin-notes') continue;
      const block = fn(issue, panels[id]);
      if (block && block.length) {
        if (lines.length) lines.push('');
        lines.push(...block);
      }
    }
    return lines;
  }

  function renderRuntimePanel(issue, data) {
    const lines = [];
    const d = data || {};
    const rc = issue.runtimeContext || {};
    const steps = (d.reproSteps || []).filter(Boolean);
    if (steps.length) {
      lines.push('**Steps to reproduce:**');
      steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    if (d.expected) lines.push('', `**Expected:** ${d.expected}`);
    if (d.actual)   lines.push(`**Actual:** ${d.actual}`);
    if ((rc.console || []).length) {
      lines.push('', `**Console (${rc.console.length}):**`);
      rc.console.slice(0, 10).forEach((c) => {
        lines.push(`- \`${(c.level || '').toUpperCase()}\` ${oneLine(c.message)}`);
      });
      if (rc.console.length > 10) lines.push(`- … +${rc.console.length - 10} more`);
    }
    if ((rc.network || []).length) {
      lines.push('', `**Network failures (${rc.network.length}):**`);
      rc.network.slice(0, 10).forEach((n) => {
        lines.push(`- ${n.method || ''} ${n.url} → **${n.status || 'ERR'}** (${n.durationMs || 0}ms)`);
      });
    }
    if (rc.env?.userAgent) {
      lines.push('', `**Env:** ${oneLine(rc.env.userAgent)} · viewport ${rc.env.viewport?.w || '?'}×${rc.env.viewport?.h || '?'}@${rc.env.viewport?.dpr || 1}x · lang ${rc.env.language || ''}`);
    }
    return lines;
  }

  function renderDesignPanel(_issue, data) {
    if (!data) return [];
    const lines = [];
    if (data.mismatchCategory) lines.push(`**Mismatch category:** ${data.mismatchCategory}`);
    if (data.notes)            lines.push(`**Implementation notes:** ${oneLine(data.notes)}`);
    return lines;
  }

  function renderAppStatePanel(_issue, data) {
    if (!data) return [];
    const lines = [];
    if (data.role)             lines.push(`**User role:** ${data.role}`);
    if (data.tenantId)         lines.push(`**Tenant / account ID:** ${data.tenantId}`);
    if (data.actionAttempted)  lines.push(`**Action attempted:** ${oneLine(data.actionAttempted)}`);
    const auto = data.auto || {};
    if (auto.route)            lines.push(`**Route:** \`${auto.route}\``);
    if (auto.openModal)        lines.push(`**Open modal:** \`${auto.openModal}\``);
    if (auto.tableState)       lines.push(`**Table state:** \`${auto.tableState}\``);
    if (data.formPayload) {
      lines.push('**Form payload:**');
      lines.push('```json');
      lines.push(data.formPayload);
      lines.push('```');
    }
    return lines.length ? ['### App state', ...lines] : [];
  }

  function renderA11yPanel(issue, data) {
    const findings = issue.a11yFindings || {};
    const violations = findings.violations || [];
    const contrast = findings.contrast;
    const d = data || {};
    if (!violations.length && !contrast && !d.fixSuggestion) return [];
    const lines = ['### Accessibility'];
    if (contrast) {
      lines.push(`**Contrast:** ${contrast.ratio}:1 (need ≥ ${contrast.threshold}:1) — ${contrast.fail ? '**fails AA**' : 'passes AA'} · fg \`${contrast.fg}\` / bg \`${contrast.bg}\``);
    }
    if (violations.length) {
      lines.push('', `**Violations (${violations.length}):**`);
      violations.forEach((v) => {
        const wcag = (v.wcag || []).length ? ` · ${v.wcag.join(' ')}` : '';
        lines.push(`- \`${v.id}\` (${v.impact || 'minor'})${wcag} — ${oneLine(v.help || v.description || '')}`);
        if (v.helpUrl) lines.push(`  - [docs](${v.helpUrl})`);
        if (v.selectors?.[0]) lines.push(`  - target: \`${v.selectors[0]}\``);
      });
    }
    if (d.affectedUserGroup)   lines.push('', `**Affected user group:** ${d.affectedUserGroup}`);
    if (d.fixSuggestion)       lines.push(`**Fix suggestion:** ${oneLine(d.fixSuggestion)}`);
    return lines;
  }

  function renderI18nPanel(_issue, data) {
    if (!data) return [];
    const lines = ['### Localization'];
    const fields = [
      ['Locale',        data.locale],
      ['Direction',     data.direction],
      ['i18n key',      data.i18nKey ? `\`${data.i18nKey}\`` : null],
      ['Bug category',  data.bugCategory],
      ['Type',          data.linguisticOrTechnical]
    ].filter(([, v]) => v);
    fields.forEach(([k, v]) => lines.push(`- **${k}:** ${v}`));
    if (data.sourceString)   lines.push('', `**Source string:** ${oneLine(data.sourceString)}`);
    if (data.renderedString) lines.push(`**Rendered string:** ${oneLine(data.renderedString)}`);
    if (data.notes)          lines.push('', `**Notes:** ${oneLine(data.notes)}`);
    return lines.length > 1 ? lines : [];
  }

  function renderPinNotesPanel(issue, _data) {
    const shots = Array.isArray(issue.screenshots) ? issue.screenshots : (issue.screenshot ? [issue.screenshot] : []);
    const groups = shots.map((s, idx) => {
      const layers = s?.annotations?.layers || [];
      const pins = layers.filter((l) => l.type === 'pin' && (l.note || '').trim());
      return { idx, pins };
    }).filter((g) => g.pins.length > 0);
    if (!groups.length) return [];
    const lines = ['**Pin notes:**'];
    groups.forEach((g) => {
      g.pins.forEach((p) => {
        lines.push(`- 📍 ${p.n}${groups.length > 1 ? ` (shot ${g.idx + 1})` : ''} — ${oneLine(p.note)}`);
      });
    });
    return lines;
  }

  function oneLine(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function toMarkdown(report) {
    const r = report.report;
    const lines = [];
    lines.push(`# QA Report — ${r.profile?.name || 'unknown profile'}`);
    lines.push('');
    lines.push(`- **Date:** ${r.scope.date}`);
    lines.push(`- **URL:** ${r.scope.url || '—'}`);
    lines.push(`- **Locale:** ${r.scope.locale || '—'}`);
    lines.push(`- **Total issues:** ${r.counts.total}`);

    if (Array.isArray(r.scope.viewportsTested) && r.scope.viewportsTested.length > 0) {
      const list = r.scope.viewportsTested
        .map((v) => `${v.w}×${v.h}${v.breakpoint ? ` (${v.breakpoint})` : ''}${v.dpr !== 1 ? ` @${v.dpr}x` : ''}${v.count > 1 ? ` ×${v.count}` : ''}`)
        .join(', ');
      lines.push(`- **Viewports tested:** ${list}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    for (const i of r.issues) {
      const ctx = i.context || {};
      const vp = ctx.viewport || {};
      const viewportSuffix = vp.w ? `  ·  ${vp.w}×${vp.h}${ctx.breakpoint?.label ? ` (${ctx.breakpoint.label})` : ''}` : '';
      lines.push(`## ${i.id} — ${i.title || '(no title)'}${viewportSuffix}`);
      lines.push('');
      lines.push(`- **Severity:** ${i.severity} · **Type:** ${i.type}`);
      lines.push(`- **Section:** ${i.section || '—'} · **Page:** ${i.page || '—'}`);

      // Selectors — list ALL picked elements, not just the primary
      const elementsList = (Array.isArray(i.elements) && i.elements.length > 0)
        ? i.elements
        : (i.element ? [i.element] : []);
      if (elementsList.length === 1) {
        lines.push(`- **Selector:** \`${elementsList[0].selector}\``);
      } else if (elementsList.length > 1) {
        lines.push(`- **Selectors:** ${elementsList.length} elements`);
        elementsList.forEach((el, idx) => {
          lines.push(`  ${idx + 1}. \`${el.selector}\``);
        });
      }

      if (i.source?.file) lines.push(`- **Source:** \`${i.source.file}:${i.source.line ?? '?'}\` (${i.source.adapter})`);

      const exp = i.expected || {};
      if (exp.figmaLink) {
        const anchor = exp.figmaBreadcrumb || exp.figmaNodeName || 'Open in Figma';
        lines.push(`- **Figma:** [${anchor}](${exp.figmaLink})`);
      }
      // Viewport / device line (separate from heading suffix so it shows full detail)
      if (vp.w) {
        const tw = ctx.breakpoint?.all?.tailwind;
        const dprStr = vp.dpr !== 1 ? ` @${vp.dpr}x` : '';
        const orientStr = vp.orientation ? ` ${vp.orientation}` : '';
        const devStr = ctx.device?.platform ? `, ${ctx.device.platform}${ctx.device.isMobile ? ' (mobile)' : ''}` : '';
        lines.push(`- **Viewport:** ${vp.w}×${vp.h}${tw ? ` · ${tw}` : ''}${dprStr}${orientStr}${devStr}`);
      }
      lines.push('');
      if (Object.keys(i.expected || {}).length) {
        lines.push('**Expected:**');
        lines.push('```');
        for (const [k, v] of Object.entries(i.expected)) lines.push(`${k}: ${v}`);
        lines.push('```');
      }
      // Per-element overrides — render only non-null entries.
      if (Array.isArray(i.expectedPerElement) && i.expectedPerElement.some((o) => o && Object.keys(o).length)) {
        i.expectedPerElement.forEach((ovr, idx) => {
          if (!ovr || Object.keys(ovr).length === 0) return;
          lines.push('');
          lines.push(`**Expected — (${idx + 1}) overrides:**`);
          lines.push('```');
          for (const [k, v] of Object.entries(ovr)) lines.push(`${k}: ${v}`);
          lines.push('```');
        });
      }
      // Actual (computed) — group identical, list per-element when different.
      const perEl = Array.isArray(i.computedPerElement) ? i.computedPerElement : null;
      if (perEl && perEl.length > 1) {
        if (i.computedAllIdentical) {
          const groupLabel = perEl.map((_, idx) => `(${idx + 1})`).join('') + ' — identical';
          lines.push(`**Actual (computed) ${groupLabel}:**`);
          lines.push('```');
          for (const [k, v] of Object.entries(perEl[0])) lines.push(`${camelToKebab(k)}: ${v}`);
          lines.push('```');
        } else {
          lines.push('**Actual (computed) — per element:**');
          perEl.forEach((rec, idx) => {
            const sel = elementsList[idx]?.selector || '?';
            lines.push('');
            lines.push(`(${idx + 1}) \`${sel}\``);
            lines.push('```');
            for (const [k, v] of Object.entries(rec)) lines.push(`${camelToKebab(k)}: ${v}`);
            lines.push('```');
          });
        }
      } else if (Object.keys(i.actual || i.computed || {}).length) {
        const rec = i.actual && Object.keys(i.actual).length ? i.actual : i.computed;
        lines.push('**Actual (computed):**');
        lines.push('```');
        for (const [k, v] of Object.entries(rec)) lines.push(`${camelToKebab(k)}: ${v}`);
        lines.push('```');
      }
      if (i.note) {
        lines.push('**Note:**');
        lines.push('');
        lines.push(i.note);
      }

      // Mode-aware panel data (v0.3.0). Each panel knows how to render itself
      // as Markdown via renderPanelMarkdown — empty/skipped panels produce
      // nothing so the report stays compact when only common fields filled.
      const panelLines = renderPanelsMarkdown(i);
      if (panelLines.length) {
        lines.push('');
        lines.push(...panelLines);
      }

      const shots = (Array.isArray(i.screenshots) && i.screenshots.length > 0)
        ? i.screenshots
        : (i.screenshot ? [i.screenshot] : []);
      for (const s of shots) {
        lines.push('');
        lines.push(`![${i.id}](${s.relativePath})`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    return lines.join('\n');
  }

  async function toJsonBlob(input) {
    const report = buildReport(input);
    return new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  }

  async function toMarkdownBlob(input) {
    const report = buildReport(input);
    return new Blob([toMarkdown(report)], { type: 'text/markdown' });
  }

  async function toZipBlob(input) {
    const report = buildReport(input);
    const entries = [
      { path: 'qa-report.json', data: JSON.stringify(report, null, 2) },
      { path: 'qa-report.md',   data: toMarkdown(report) }
    ];
    for (const i of report.report.issues) {
      const shots = (Array.isArray(i.screenshots) && i.screenshots.length > 0)
        ? i.screenshots
        : (i.screenshot ? [i.screenshot] : []);
      for (const s of shots) {
        if (s && s.dataUrl) {
          const bytes = dataUrlToBytes(s.dataUrl);
          entries.push({ path: s.relativePath, data: bytes });
        }
      }
    }
    return await QA.zipStore.buildZip(entries);
  }

  function camelToKebab(s) { return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.exporter = { buildReport, toMarkdown, toJsonBlob, toMarkdownBlob, toZipBlob };
})();
