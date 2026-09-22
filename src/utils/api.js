// The dashboard's backend (worker/ — a Cloudflare Worker). It holds the
// GitHub token and AWS keys, checks logins, and proxies the data writes. The
// browser only ever holds a session: an opaque signed string the worker hands
// back at login, kept in localStorage and sent as a Bearer header.
export const API_URL = (import.meta.env.VITE_API_URL || 'https://rohrman-api.rohrman-api.workers.dev').replace(/\/+$/, '');

const SESSION_KEY = 'rohrmanSession';

export function getSession() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } }
export function setSession(token) { try { if (token) localStorage.setItem(SESSION_KEY, token); else localStorage.removeItem(SESSION_KEY); } catch {} }
export const hasSession = () => !!getSession();

// Fired when the worker says the session is dead (expired, or the password
// changed). App.jsx listens and drops the user back to the login screen.
export const SESSION_EXPIRED_EVENT = 'rohrman:session-expired';
function sessionExpired() {
  if (!getSession()) return;
  setSession('');
  try { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); } catch {}
}

// fetch() against the worker with the session attached. `json` becomes the
// JSON body; anything else passes straight through to fetch.
export async function apiFetch(path, { json, headers, ...init } = {}) {
  const h = { ...(headers || {}) };
  const s = getSession();
  if (s) h.Authorization = `Bearer ${s}`;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: h });
  if (res.status === 401 && s && !path.startsWith('/auth/login')) sessionExpired();
  return res;
}

// Same, but resolves to the parsed JSON and throws the worker's message on error.
export async function apiJson(path, init) {
  const res = await apiFetch(path, init);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || `Server replied ${res.status}.`);
  return body;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
// Each returns the user record from users.json (never any password material)
// plus pwSalt — a marker for the credential just proven/set, which the admin
// vault uses to notice when an admin's password changed.
export async function login(username, password) {
  const r = await apiJson('/auth/login', { method: 'POST', json: { username, password } });
  setSession(r.session);
  return r;
}
export function logout() { setSession(''); }
export async function changePassword(current, password) {
  const r = await apiJson('/auth/change', { method: 'POST', json: { current, password } });
  if (r.session) setSession(r.session);
  return r;
}
export async function resetPassword(username, token, password) {
  const r = await apiJson('/auth/reset', { method: 'POST', json: { username, token, password } });
  setSession(r.session);
  return r;
}
export function forgotPassword(username) { return apiJson('/auth/forgot', { method: 'POST', json: { username } }); }

// ── Managers ─────────────────────────────────────────────────────────────────
export function setPasswordFor(username, password) { return apiJson('/admin/set-password', { method: 'POST', json: { username, password } }); }
export function listCredentials() { return apiJson('/admin/credentials'); }
export function removeCredential(username) { return apiJson(`/admin/credentials/${encodeURIComponent(String(username || '').toUpperCase())}`, { method: 'DELETE' }); }

export async function health() { try { return await apiJson('/health'); } catch { return null; } }
