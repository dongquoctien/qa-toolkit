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
