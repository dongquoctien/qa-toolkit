// Pick an adapter for a given profile + element.
// Prefers the profile-declared framework, falls back to generic.
(function () {
  function get(profile) {
    const all = self.QA.adapters || {};
    const declared = profile?.framework?.type;
    if (declared && all[declared]) return all[declared];
    return all.generic;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.adapterRegistry = { get };
})();
