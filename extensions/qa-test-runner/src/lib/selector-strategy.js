// SelectorStrategy — hybrid resolver to identify "the same element" across
// dev / stg / prod when the DOM may have drifted (class hashes change, attrs
// reorder, framework rewrites markup).
//
// Strategy order (first hit wins):
//   1. selector  — the qa-annotator-style unique CSS selector. Cheapest.
//   2. testid    — [data-testid="..."], [data-test="..."], [data-qa="..."].
//   3. role+name — accessible role + accessible name (text or aria-label).
//   4. text      — visible text match within an enclosing role.
//   5. css-relax — same css path but with class:nth-of-type fallback.
//
// Each step in a recorded sequence carries ALL fingerprints when captured:
//   {
//     selector: '.btn-primary > span',
//     testid: 'submit-btn',
//     role: 'button',
//     name: 'Submit booking',
//     text: 'Submit booking'
//   }
// At replay, resolve() walks the list, returns { element, hitVia, drifted }.
// `drifted: true` warns the caller that the primary selector failed and a
// fallback matched — useful signal for "DOM drift between dev and prod".
//
// Placeholder until v0.1.0.
(function () {
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.selectorStrategy = {
    capture(_element) {
      // TODO: snapshot every fingerprint up-front so replay has options.
      return null;
    },
    resolve(_fingerprint, _root = document) {
      // TODO: walk fingerprints in priority order, return first hit + drift flag.
      return { element: null, hitVia: null, drifted: false };
    }
  };
})();
