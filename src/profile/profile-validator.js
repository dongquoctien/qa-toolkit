// Tiny JSON validator for qa-profile-v1 — checks required fields only.
// Loaded as classic <script> in the settings page; attaches to self.QA.profileValidator.
(function () {
  function validate(profile) {
    const errors = [];
    const warnings = [];

    if (!profile || typeof profile !== 'object') {
      return { ok: false, errors: ['profile is not an object'], warnings: [] };
    }
    if (profile.$schema !== 'qa-profile-v1') {
      warnings.push(`unexpected $schema: ${profile.$schema} (expected "qa-profile-v1")`);
    }
    for (const k of ['id', 'name', 'urlPatterns']) {
      if (profile[k] == null) errors.push(`missing required field: ${k}`);
    }
    if (profile.urlPatterns && !Array.isArray(profile.urlPatterns)) {
      errors.push('urlPatterns must be an array');
    } else if (Array.isArray(profile.urlPatterns) && profile.urlPatterns.length === 0) {
      errors.push('urlPatterns cannot be empty');
    }
    if (!profile.framework || !profile.framework.type) {
      errors.push('framework.type is required');
    } else if (!['astro','nextjs','vue','react','generic','nuxt'].includes(profile.framework.type)) {
      warnings.push(`unknown framework.type: ${profile.framework.type}`);
    }
    if (profile.localeStrategy && profile.localeStrategy.supportedLocales) {
      const locs = profile.localeStrategy.supportedLocales;
      const dup = locs.filter((x, i) => locs.indexOf(x) !== i);
      if (dup.length) errors.push(`duplicate locales: ${dup.join(',')}`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.profileValidator = { validate };
})();
