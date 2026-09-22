// User passwords.
//
// The password itself is checked by the worker (worker/src/index.js), which
// keeps a salted PBKDF2 hash in Cloudflare KV — nothing in the public
// users.json can be used to log in or to crack a password. What the user
// record here carries is:
//   pwSalt       the salt of the credential the worker holds — a marker that
//                changes whenever the password does, which the admin vault
//                uses to notice an admin's wrapper is out of date;
//   passwordEnc  the password encrypted for the admin vault (passwordVault.js).
//
// Password-reset links carry a random token whose SHA-256 is stored on the
// user (`passwordReset.hash`) by the GitHub Action that emails it; the token
// itself is only ever in the email. See scripts/password-reset-request.cjs.
import { encryptForVault } from './passwordVault';

const bytesToHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// True once the worker holds a password for this user (set through the admin
// panel, a reset link or a login that topped the record up).
export const hasCredential = (user) => !!(user && user.pwSalt);

// A copy of the user record after the worker accepted a new password: the
// pwSalt marker it returned, the vault copy (when there is a vault), and no
// legacy password material or pending reset.
export async function withPassword(user, password, vault = null, pwSalt = '') {
  const out = { ...user };
  if (pwSalt) out.pwSalt = pwSalt;
  delete out.password;
  delete out.passwordHash;
  delete out.passwordReset;
  const encd = await encryptForVault(vault, password);
  if (encd) out.passwordEnc = encd; else delete out.passwordEnc;
  return out;
}

// True when a login just proved the password but the vault copy is missing or
// from an older keypair — the caller can re-save it encrypted.
export const needsVaultCopy = (user, vault) => !!(vault && vault.kid && (!user.passwordEnc || user.passwordEnc.kid !== vault.kid));

// ── Reset links ──────────────────────────────────────────────────────────────
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return bytesToHex(buf);
}

// Check a reset token from the emailed link against the user's pending reset
// (a first look, for the page; the worker checks again when the password is set).
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
