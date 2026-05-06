// Issue ID generator — counts existing issues to avoid collisions across sessions.
(function () {
  function nextId(existingIds) {
    let max = 0;
    for (const id of existingIds || []) {
      const m = /^ISS-(\d+)$/.exec(id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `ISS-${String(max + 1).padStart(3, '0')}`;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.idGen = { nextId };
})();
