// User passwords.
//
// users.json is readable without logging in (public repo), so a password kept
// in the clear there is public. Passwords are stored as a salted PBKDF2 hash —
// the same scheme as the Applicants Code — under `passwordHash`; the legacy
// plaintext `password` field is honoured at login until the record has been
// migrated (either by the admin's "Hash all passwords" button or lazily on a
// successful login).
//
// Password-reset links carry a random token whose SHA-256 is stored on the
// user (`passwordReset.hash`) by the GitHub Action that emails it; the token
// itself is only ever in the email. See scripts/password-reset-request.cjs.

const ITERATIONS = 150000;

const bytesToHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return bytesToHex(a.buffer);
}

async function derive(password, salt, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(bits);
}

const same = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// What gets stored on the user record.
export async function hashPassword(password) {
  const salt = randomSalt();
  return { salt, hash: await derive(password, salt), iterations: ITERATIONS, setAt: new Date().toISOString() };
}

export const isHashed = (user) => !!(user && user.passwordHash && user.passwordHash.hash && user.passwordHash.salt);

// True when `password` matches the user — hashed record or legacy plaintext.
export async function verifyPassword(user, password) {
  if (!user || password == null) return false;
  if (isHashed(user)) {
    const got = await derive(password, user.passwordHash.salt, user.passwordHash.iterations || ITERATIONS);
    return same(got, user.passwordHash.hash);
  }
  return user.password != null && String(user.password) === String(password);
}

// A copy of the user with the password replaced by its hash (and any pending
// reset cleared, since a new password supersedes it).
export async function withPassword(user, password) {
  const out = { ...user, passwordHash: await hashPassword(password) };
  delete out.password;
  delete out.passwordReset;
  return out;
}

// Migrate every legacy plaintext record. Returns [users, changedCount].
export async function hashLegacyPasswords(users) {
  let changed = 0;
  const out = [];
  for (const u of users || []) {
    if (!isHashed(u) && u && u.password != null && String(u.password) !== '') {
      out.push(await withPassword(u, u.password)); changed++;
    } else out.push(u);
  }
  return [out, changed];
}

// ── Reset links ──────────────────────────────────────────────────────────────
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return bytesToHex(buf);
}

// Check a reset token from the emailed link against the user's pending reset.
//   → { ok: true } | { ok: false, reason: 'none' | 'expired' | 'mismatch' }
export async function checkResetToken(user, token) {
  const pr = user && user.passwordReset;
  if (!pr || !pr.hash) return { ok: false, reason: 'none' };
  if (pr.expires && Date.now() > new Date(pr.expires).getTime()) return { ok: false, reason: 'expired' };
  const got = await sha256Hex(token || '');
  return same(got, pr.hash) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

// Minimum strength — keep it simple for a shop floor, but not "1234".
export function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 6) return 'Use at least 6 characters.';
  if (/^(.)\1+$/.test(p)) return 'That is one character repeated — pick something else.';
  return '';
}
