// ── Role access templates ─────────────────────────────────────────────────────
// public/data/role-access.json: { updatedAt, by, roles: { [role]: { [pageKey]: bool } } }
//
// Set on Edit Dashboard → User Management → 🧩 Role Setup. A user gets their
// role's boxes, with any SPECIAL boxes set just for them on top
// (user.pageOverrides = { pageKey: bool }). A special box only covers that one
// page: tick a new box in the role and everyone in it gets it, except anyone
// with their own setting for that exact box. Until the file is saved, everyone
// keeps their own `pages` map exactly as before. Admins and managers always
// have full access anyway.

export const ROLE_ACCESS_PATH = 'data/role-access.json';

export function resolvePages(user, roleCfg) {
  if (!user) return null;
  const tpl = roleCfg && roleCfg.roles && roleCfg.roles[String(user.role || '').toLowerCase()];
  if (tpl) return { ...tpl, ...(user.pageOverrides || {}) };
  return user.pages || null;
}

// Is a page on in this map? Missing = on, except default-off pages.
export const pageOn = (m, k, defaultOff = new Set()) => (defaultOff.has(k) ? !!(m && m[k] === true) : !(m && m[k] === false));

// The special boxes: where `pages` differs from the role template.
export function overridesFrom(pages, tpl, pageKeys, defaultOff = new Set()) {
  const out = {};
  for (const k of pageKeys) {
    const mine = pageOn(pages, k, defaultOff);
    if (mine !== pageOn(tpl, k, defaultOff)) out[k] = mine;
  }
  return out;
}
