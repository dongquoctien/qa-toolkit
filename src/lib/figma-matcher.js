// Figma matcher — given a picked DOM element + an active tree, return the
// nearest enclosing Figma frame's nodeId + breadcrumb so the issue modal
// can prefill `expected.figmaLink`.
//
// Tree shape (compressed by the service-worker before storage):
//   tree.fileKey, tree.fileSlug, tree.crawledAt
//   tree.pages = [{ name, viewports: [{ viewport, viewportWidth, rootNodeId, sections }] }]
//   tree.nodes = { [id]: { n, t, p, d, b, v, x? } }   -- 1-char keys
//
// Strategy (hierarchy-first):
//   1. Pick a viewport variant matching the live `breakpoint.generic` /
//      `viewport.w`. Restrict candidates to nodes with `v === <viewport>`.
//   2. If `pageName` resolves to a tree page, restrict candidates to the
//      descendants of that page-root.
//   3. If `sectionName` resolves to a top-level section under that page,
//      restrict candidates to that section's subtree.
//   4. Among remaining candidates, find the SMALLEST node whose bbox
//      CONTAINS the projected element rect (with tolerance). This is the
//      nearest enclosing frame.
//   5. Tie-break by text similarity, then by deeper depth.
//   6. If nothing contains the rect (e.g., live page taller than Figma),
//      fall back to the section root, then page root.
(function () {
  // --- public API ---------------------------------------------------------

  /**
   * Match a DOM pick against a stored Figma tree.
   *
   * @param {object} tree - compressed tree from chrome.storage.local
   * @param {object} input
   * @param {string|null} input.pageName    e.g. "about-us" (from issue.page)
   * @param {string|null} input.sectionName e.g. "HeroSection" (from issue.section)
   * @param {object} input.rect             { x, y, w, h } in viewport CSS px
   * @param {string|null} input.text        element textContent (truncated)
   * @param {object} input.viewport         { w, h } live viewport CSS px
   * @returns {object|null} { nodeId, breadcrumb, score, viewport } or null
   */
  function match(tree, input) {
    if (!tree || !tree.nodes) return null;
    const { pageName, sectionName, rect, text, viewport } = input || {};
    if (!rect || rect.w <= 0 || rect.h <= 0) return null;

    // 1. Pick the viewport variant — tree pages may have desktop/tablet/mobile
    const page = pickPage(tree, pageName);
    const variant = pickViewportVariant(page, viewport);
    if (!variant) return null;

    // Project the live element rect into Figma coordinates relative to the viewport root.
    //
    // Horizontal: live and Figma are usually different widths (e.g. live=2560, figma=1920).
    //   But responsive web layouts at supersize widths typically just add side padding —
    //   the inner content remains at its design width. Scale X by ratio anyway, but this
    //   is mostly a wash on width-bounded text rects.
    //
    // Vertical: DON'T scale Y. The page's document height is determined by content stack,
    //   not viewport width. A 2560-wide browser doesn't compress sections vertically.
    //   Scaling Y broke matching for users on >1920 monitors (would project below the
    //   actual section). Verified 2026-05-07 against the about-us project.
    const scaleX = (variant.viewportWidth && viewport.w)
      ? (variant.viewportWidth / viewport.w)
      : 1;
    const scaleY = 1;
    const projected = {
      x: (rect.x + (input.scrollX || 0)) * scaleX,
      y: (rect.y + (input.scrollY || 0)) * scaleY,
      w: rect.w * scaleX,
      h: rect.h * scaleY
    };

    // 2. Restrict candidate set
    const rootId = variant.rootNodeId;
    const sectionRootId = pickSectionRoot(tree, variant, sectionName);
    const candidateIds = collectDescendants(
      tree.nodes,
      sectionRootId || rootId,
      variant.viewport
    );

    if (candidateIds.length === 0) return null;

    // 3. Find smallest containing node
    const TOLERANCE = 8; // px
    const containing = candidateIds
      .map((id) => ({ id, n: tree.nodes[id] }))
      .filter(({ n }) => n && n.b && contains(n.b, projected, TOLERANCE))
      .sort((a, b) => {
        const areaA = a.n.b.w * a.n.b.h;
        const areaB = b.n.b.w * b.n.b.h;
        return areaA - areaB; // smallest first
      });

    let pickedId = null;
    let score = 0;

    if (containing.length > 0) {
      // Smallest containing frame — best.
      const best = containing[0];
      pickedId = best.id;
      // Score = inverse log of area (smaller = higher), capped at 1.
      const area = best.n.b.w * best.n.b.h;
      const projArea = projected.w * projected.h;
      score = Math.min(1, projArea / Math.max(area, 1));
      // Text bonus from Figma side
      if (text && best.n.x && fuzzyMatch(best.n.x, text)) score = Math.min(1, score + 0.15);
      // Src-code text confirmation: picked text appears in sectionIndex
      const idx2 = sectionName ? tree.sectionIndex?.[sectionName] : null;
      if (text && idx2?.texts?.length) {
        const lc = text.toLowerCase().trim();
        if (idx2.texts.some((s) => lc === s.toLowerCase().trim() || lc.includes(s.toLowerCase().trim()))) {
          score = Math.min(1, score + 0.10);
        }
      }
    } else {
      // Fallback — section root, then page root
      pickedId = sectionRootId || rootId || null;
      score = 0.3;
    }

    if (!pickedId) return null;

    return {
      nodeId: pickedId,
      breadcrumb: buildBreadcrumb(tree.nodes, pickedId),
      score,
      viewport: variant.viewport,
      pageName: page?.name || null
    };
  }

  /**
   * Build a Figma deeplink from tree + nodeId.
   * Substitutes both `:` and `-` forms — Figma URLs use hyphen.
   */
  function buildLink(tree, nodeId, linkTemplate) {
    if (!tree || !nodeId) return null;
    const tpl = linkTemplate || (tree.fileSlug
      ? 'https://www.figma.com/design/{fileKey}/{fileSlug}?node-id={nodeId}'
      : 'https://www.figma.com/design/{fileKey}?node-id={nodeId}');
    return tpl
      .replace('{fileKey}', tree.fileKey || '')
      .replace('{fileSlug}', tree.fileSlug || '')
      .replace('{nodeId}', nodeId.replace(':', '-'));
  }

  // --- helpers ------------------------------------------------------------

  function pickPage(tree, pageName) {
    if (!Array.isArray(tree.pages)) return null;
    if (pageName) {
      return tree.pages.find((p) => p.name === pageName) || tree.pages[0] || null;
    }
    return tree.pages[0] || null;
  }

  function pickViewportVariant(page, liveVp) {
    if (!page || !Array.isArray(page.viewports) || page.viewports.length === 0) return null;
    const w = liveVp?.w || 1280;
    // PRIORITY 1: explicit range on the variant (`minWidth` / `maxWidth`). When
    // the tree author wants e.g. "tablet covers 768..1279, laptop covers
    // 1280..1919, desktop covers 1920+", they encode it on each variant. This
    // is the right answer — pick the bucket the live width falls into.
    const inRange = page.viewports.find((v) => {
      const min = (v.minWidth ?? 0);
      const max = (v.maxWidth == null ? Infinity : v.maxWidth);
      return w >= min && w <= max;
    });
    if (inRange) return inRange;
    // FALLBACK (legacy trees without ranges): pick the LARGEST variant whose
    // viewportWidth <= live width — i.e. the design that fits inside the live
    // viewport. Else fall back to the smallest variant.
    const sorted = [...page.viewports].sort((a, b) => (a.viewportWidth || 0) - (b.viewportWidth || 0));
    const le = [...sorted].reverse().find((v) => (v.viewportWidth || 0) <= w);
    return le || sorted[0] || null;
  }

  function pickSectionRoot(tree, variant, sectionName) {
    if (!sectionName || !variant) return null;

    // PRIORITY 1: src code annotation (highest confidence).
    // Plugin's qa-figma-crawl scanned `// figma:` comments and data-figma-node-id
    // attrs in section files. If the node it pointed at exists in the tree, use it.
    const idx = tree.sectionIndex?.[sectionName];
    if (idx?.figmaNodeId && tree.nodes[idx.figmaNodeId]) {
      return idx.figmaNodeId;
    }

    // PRIORITY 2: matching Figma layer name to data-section attr.
    const sectionIds = variant.sections || [];
    for (const id of sectionIds) {
      const n = tree.nodes[id];
      if (!n || !n.n) continue;
      if (n.n === sectionName) return id;
      const a = n.n.replace(/Section$/i, '').toLowerCase();
      const b = (sectionName || '').replace(/Section$/i, '').toLowerCase();
      if (a && a === b) return id;
    }

    // PRIORITY 3: text content match. If sectionIndex.texts contains the
    // hovered element's text, find which section subtree contains a Figma
    // text node carrying that string — that's our section.
    if (idx?.texts?.length) {
      // Scan all top-level sections for a text node matching any indexed string.
      for (const id of sectionIds) {
        if (subtreeHasMatchingText(tree.nodes, id, idx.texts, variant.viewport)) return id;
      }
    }

    return null;
  }

  function subtreeHasMatchingText(nodes, rootId, needles, viewport) {
    // Cheap walk: scan all nodes that look like descendants of rootId. We don't
    // need a full descendant collection — early-return on first hit.
    const lc = needles.map((s) => s.toLowerCase().trim()).filter(Boolean);
    if (lc.length === 0) return false;
    const root = nodes[rootId];
    if (!root) return false;
    for (const [, n] of Object.entries(nodes)) {
      if (!n.x || (viewport && n.v !== viewport)) continue;
      // Is this node inside rootId? Walk up parent chain.
      let cur = n;
      let safety = 12;
      while (cur && safety-- > 0) {
        if (cur === root) {
          const t = (n.x || '').toLowerCase().trim();
          if (lc.some((needle) => t === needle || t.includes(needle) || needle.includes(t))) return true;
          break;
        }
        cur = cur.p ? nodes[cur.p] : null;
      }
    }
    return false;
  }

  function collectDescendants(nodes, rootId, viewport) {
    if (!rootId || !nodes[rootId]) return [];
    // Build child index lazily — each call is fast enough on trees of a few thousand nodes.
    const children = new Map();
    for (const [id, n] of Object.entries(nodes)) {
      if (!n) continue;
      if (viewport && n.v && n.v !== viewport) continue;
      const p = n.p;
      if (!p) continue;
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(id);
    }
    const out = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      out.push(id);
      const kids = children.get(id);
      if (kids) for (const k of kids) stack.push(k);
    }
    return out;
  }

  function contains(parent, child, tol) {
    return (
      parent.x - tol <= child.x &&
      parent.y - tol <= child.y &&
      parent.x + parent.w + tol >= child.x + child.w &&
      parent.y + parent.h + tol >= child.y + child.h
    );
  }

  // Figma's get_metadata XML returns layer names with HTML entities (`&amp;`,
  // `&#39;`, etc). Decode for display.
  function decodeEntities(s) {
    if (!s) return s;
    return s
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function fuzzyMatch(a, b) {
    if (!a || !b) return false;
    const A = a.toLowerCase().trim();
    const B = b.toLowerCase().trim();
    if (!A || !B) return false;
    if (A === B) return true;
    if (A.includes(B) || B.includes(A)) return true;
    // First-N-chars match — handy for truncated DOM textContent
    const N = Math.min(A.length, B.length, 30);
    return A.slice(0, N) === B.slice(0, N);
  }

  // Returns a string like:
  //   "1920_home > section 3 > Frame 1000003792 > Frame 45 (• Built for Asia's Hotels...)"
  // The summary suffix only appears on the LEAF node and only when the
  // summary is non-empty AND meaningfully different from the layer name.
  // Ancestors stay terse so the breadcrumb doesn't blow up.
  function buildBreadcrumb(nodes, id) {
    const out = [];
    let cur = id;
    let depth = 0;
    let safety = 12;
    const SUMMARY_PREVIEW_CHARS = 80;
    while (cur && safety-- > 0) {
      const n = nodes[cur];
      if (!n) break;
      let label = n.n || '?';
      // Append summary only on the leaf (depth === 0 in the unshift order means
      // it'll be the LAST element after all unshifts). For TEXT nodes the layer
      // name already IS the text so don't duplicate.
      const isLeaf = depth === 0;
      if (isLeaf && n.t !== 'TEXT' && n.s) {
        const decoded = decodeEntities(n.s);
        const preview = decoded.length > SUMMARY_PREVIEW_CHARS
          ? decoded.slice(0, SUMMARY_PREVIEW_CHARS) + '…'
          : decoded;
        label += ` (• ${preview})`;
      }
      out.unshift(label);
      cur = n.p;
      depth++;
    }
    return out.join(' > ');
  }

  // --- attach to global ---------------------------------------------------
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.figmaMatcher = { match, buildLink };
})();
