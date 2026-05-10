// Profile storage layer — runs in the service-worker.
// Public surface: list(), get(id), getActive(), setActive(id), upsert(profile),
// remove(id), matchForUrl(url).
//
// Storage layout in chrome.storage.local:
//   { profiles: { [id]: Profile }, activeProfileId: string | null }

// Validation duplicated from profile-validator.js so the service-worker
// can import this as ESM without pulling in IIFE-only code.
function validate(profile) {
  const errors = [];
  const warnings = [];
  if (!profile || typeof profile !== 'object') return { ok: false, errors: ['profile is not an object'], warnings: [] };
  if (profile.$schema !== 'qa-profile-v1') warnings.push(`unexpected $schema: ${profile.$schema}`);
  for (const k of ['id', 'name', 'urlPatterns']) {
    if (profile[k] == null) errors.push(`missing required field: ${k}`);
  }
  if (profile.urlPatterns && !Array.isArray(profile.urlPatterns)) errors.push('urlPatterns must be an array');
  else if (Array.isArray(profile.urlPatterns) && profile.urlPatterns.length === 0) errors.push('urlPatterns cannot be empty');
  if (!profile.framework || !profile.framework.type) errors.push('framework.type is required');
  return { ok: errors.length === 0, errors, warnings };
}

const KEYS = { profiles: 'profiles', activeProfileId: 'activeProfileId' };

async function readAll() {
  const data = await chrome.storage.local.get([KEYS.profiles, KEYS.activeProfileId]);
  return {
    profiles: data[KEYS.profiles] || {},
    activeProfileId: data[KEYS.activeProfileId] || null
  };
}

async function writeProfiles(profiles) {
  await chrome.storage.local.set({ [KEYS.profiles]: profiles });
}

export async function list() {
  const { profiles } = await readAll();
  return Object.values(profiles).sort((a, b) => a.name.localeCompare(b.name));
}

export async function get(id) {
  const { profiles } = await readAll();
  return profiles[id] || null;
}

export async function getActive() {
  const { profiles, activeProfileId } = await readAll();
  if (!activeProfileId) return null;
  return profiles[activeProfileId] || null;
}

export async function setActive(id) {
  const { profiles } = await readAll();
  if (id && !profiles[id]) throw new Error(`profile not found: ${id}`);
  await chrome.storage.local.set({ [KEYS.activeProfileId]: id || null });
}

export async function upsert(profile) {
  const { ok, errors } = validate(profile);
  if (!ok) throw new Error('invalid profile: ' + errors.join('; '));
  const { profiles } = await readAll();
  profiles[profile.id] = { ...profile, updatedAt: new Date().toISOString() };
  await writeProfiles(profiles);
  return profiles[profile.id];
}

export async function remove(id) {
  const { profiles, activeProfileId } = await readAll();
  delete profiles[id];
  await writeProfiles(profiles);
  if (activeProfileId === id) await chrome.storage.local.set({ [KEYS.activeProfileId]: null });
}

export async function matchForUrl(url) {
  const all = await list();
  // Lazy import to avoid loading glob-match at top of service-worker.
  const compile = (pattern) => new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  );
  const match = (u, patterns) =>
    Array.isArray(patterns) && patterns.some((p) => { try { return compile(p).test(u); } catch { return false; } });
  return all.find((p) => match(url, p.urlPatterns)) || null;
}

export async function ensureSeeded() {
  const { profiles } = await readAll();
  if (Object.keys(profiles).length > 0) return;
  // Seed the empty profile from web_accessible_resources.
  try {
    const res = await fetch(chrome.runtime.getURL('src/profile/built-in/empty.qa-profile.json'));
    const empty = await res.json();
    await upsert(empty);
    await setActive(empty.id);
  } catch (e) {
    console.warn('[QA] failed to seed built-in profile', e);
  }
}
