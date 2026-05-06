// Compose a partial Issue from one or more picked elements + active profile + adapter.
// Single-pick: pass [el]. Multi-pick: pass [el1, el2, ...].
//
// The form fills in severity/type/title/note/expected; this builder seeds
// everything we can derive automatically. For multi-pick, computed/source/
// section/i18n are taken from the FIRST element (the most representative);
// the full elements[] array is preserved for screenshot framing and reporting.
(function () {
  function buildPartial(elements, ctx) {
    const els = Array.isArray(elements) ? elements : [elements];
    const primary = els[0];
    const { profile, adapter, existingIds } = ctx;
    const conv = profile.conventions || {};

    const sectionEl = conv.sectionAttribute ? primary.closest(`[${conv.sectionAttribute}]`) : null;
    const componentEl = conv.componentAttribute ? primary.closest(`[${conv.componentAttribute}]`) : null;
    const i18nEl = conv.i18nKeyAttribute ? primary.closest(`[${conv.i18nKeyAttribute}]`) : null;

    const computedProps = profile.computedProps || QA.computedStyles.DEFAULT_PROPS;
    // Per-element computed values; computed (singular) keeps the primary for back-compat.
    const computedPerElement = els.map((el) => QA.computedStyles.readComputed(el, computedProps));
    const computed = computedPerElement[0];
    const computedAllIdentical = els.length > 1 && computedPerElement.every((c) => recordsEqual(c, computed));

    const dataAttrs = [conv.sectionAttribute, conv.componentAttribute, conv.pageAttribute, conv.i18nKeyAttribute].filter(Boolean);
    const elementsInfo = els.map((el, i) => ({
      ...describeElement(el, dataAttrs),
      computed: computedPerElement[i]
    }));

    const source = adapter && adapter.extractSource ? adapter.extractSource(primary, profile) : null;

    const url = location.href;
    const locale = QA.localeDetector.detectLocale(url, profile.localeStrategy);
    const page = QA.localeDetector.detectPage(url, profile.pageDetection);
    const env = QA.viewportDetector.snapshot();

    // Figma auto-fill — null when no tree is loaded for this profile.
    let expectedFigma = {};
    if (ctx.figmaTree && QA.figmaMatcher) {
      const sectionName = sectionEl ? sectionEl.getAttribute(conv.sectionAttribute) : null;
      const matched = QA.figmaMatcher.match(ctx.figmaTree, {
        pageName: page,
        sectionName,
        rect: {
          x: Math.round(elementsInfo[0].rect.x),
          y: Math.round(elementsInfo[0].rect.y),
          w: Math.round(elementsInfo[0].rect.w),
          h: Math.round(elementsInfo[0].rect.h)
        },
        text: elementsInfo[0].textContent || '',
        viewport: env.viewport,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
      if (matched) {
        const link = QA.figmaMatcher.buildLink(ctx.figmaTree, matched.nodeId, profile.figma?.linkTemplate);
        expectedFigma = {
          figmaNodeId: matched.nodeId,
          figmaLink: link,
          figmaBreadcrumb: matched.breadcrumb,
          figmaScore: matched.score,
          figmaViewport: matched.viewport,
          figmaAutoMatched: true
        };
      }
    }

    const id = QA.idGen.nextId(existingIds);

    return {
      id,
      profileId: profile.id,
      severity: profile.issueTemplates?.defaultSeverity || 'minor',
      type: profile.issueTemplates?.defaultType || 'visual',
      title: '',

      page,
      section: sectionEl ? sectionEl.getAttribute(conv.sectionAttribute) : null,
      component: componentEl ? componentEl.getAttribute(conv.componentAttribute) : null,

      // Primary element (back-compat for consumers that read issue.element)
      element: elementsInfo[0],
      // Full list (length 1 for single-pick)
      elements: elementsInfo,

      source: source || { file: null, line: null, column: null, adapter: 'generic' },
      computed,                            // primary element's computed values (back-compat)
      computedPerElement,                  // [computed_for_el_0, computed_for_el_1, ...]
      computedAllIdentical,                // true when length > 1 and every entry equals primary

      expected: { ...expectedFigma },
      actual: { ...computed },
      delta: {},

      screenshot: null,
      note: '',

      context: {
        url,
        locale,
        // Rich snapshot — readers should prefer these fields over the legacy viewport block.
        viewport: env.viewport,
        document: env.document,
        breakpoint: env.breakpoint,
        device: env.device,
        // Compact human-readable labels (handy in Markdown / Jira)
        viewportLabel: QA.viewportDetector.formatChip(env)
      },

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      synced: null
    };
  }

  function describeElement(el, dataAttrs) {
    const rect = el.getBoundingClientRect();
    return {
      selector: QA.uniqueSelector.buildSelector(el, { dataAttrs }),
      tagName: el.tagName.toLowerCase(),
      textContent: (el.textContent || '').trim().slice(0, 200),
      attributes: collectAttrs(el),
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      i18nKey: el.closest('[data-i18n-key]')?.getAttribute('data-i18n-key') || null
    };
  }

  function recordsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
  }

  function collectAttrs(el) {
    const out = {};
    for (const a of el.attributes) {
      if (a.value.length > 240) continue;
      if (a.name.startsWith('on')) continue;
      out[a.name] = a.value;
    }
    return out;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.issueBuilder = { buildPartial };
})();
