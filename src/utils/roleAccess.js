// ── Role access templates ─────────────────────────────────────────────────────
// public/data/role-access.json: { updatedAt, by, roles: { [role]: { [pageKey]: bool } } }
//
// Set on Edit Dashboard → User Management → 🧩 Role Setup. A user follows their
// role's template unless their record says customPages: true (someone ticked
// their own boxes). Until the file is saved, everyone keeps their own `pages`
// map exactly as before. Admins and managers always have full access anyway.

export const ROLE_ACCESS_PATH = 'data/role-access.json';

export function resolvePages(user, roleCfg) {
  if (!user) return null;
  const tpl = roleCfg && roleCfg.roles && roleCfg.roles[String(user.role || '').toLowerCase()];
  if (tpl && !user.customPages) return tpl;
  return user.pages || null;
}

// Two page maps grant the same access (missing key = on, unless default-off).
export function samePages(a, b, pageKeys, defaultOff = new Set()) {
  const on = (m, k) => (defaultOff.has(k) ? !!(m && m[k] === true) : !(m && m[k] === false));
  return pageKeys.every(k => on(a, k) === on(b, k));
}
