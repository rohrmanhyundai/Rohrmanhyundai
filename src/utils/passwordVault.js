// Admin password vault — lets an admin see a user's password even though
// logins are verified against a hash (which can't be shown back).
//
// Every password that gets set is ALSO stored encrypted with an RSA public key
// kept in users.json (user.passwordEnc = { kid, data }). The matching private
// key is stored beside it, wrapped once per admin under a key derived from
// that admin's own login password:
//
//   users.json.passwordVault = {
//     kid, publicKey (JWK),
//     wrappers: { SHAWN: { salt, iv, data, iterations, pwSalt }, ADMIN: {…} },
//     createdAt, by
//   }
//
// So when an admin logs in, their password unwraps the private key for that
// session and every "Show password" just works — nothing extra to remember.
// The first admin to log in creates the vault; an admin holding the key
// wraps it for the other admins automatically (their passwords are in the
// vault too), and re-wraps whenever an admin's password changes (pwSalt is
// the user's pwSalt marker — the salt of the credential the worker holds —
// that the wrapper was made against).
// users.json is public: without an admin's login password the vault is just
// ciphertext.

const ITER = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const up = (s) => String(s || '').trim().toUpperCase();

async function wrapKeyFrom(secret, salt, iterations = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrapPkcs8(pkcs8, secret, pwSalt) {
  const salt = rand(16), iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKeyFrom(secret, salt), pkcs8);
  return { salt: b64(salt), iv: b64(iv), data: b64(data), iterations: ITER, pwSalt: pwSalt || '', at: new Date().toISOString() };
}
async function unwrapPkcs8(w, secret) {
  const key = await wrapKeyFrom(secret, unb64(w.salt), w.iterations || ITER);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, key, unb64(w.data));
}
const importPriv = (pkcs8) => crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);

export const vaultReady = (vault) => !!(vault && vault.publicKey && vault.kid);
export const hasWrapper = (vault, username) => !!(vault && vault.wrappers && vault.wrappers[up(username)]);
export const inVault = (user, vault) => !!(user && user.passwordEnc && user.passwordEnc.data && vault && user.passwordEnc.kid === vault.kid);

// Encrypt a password for the vault. Null when there's no vault yet.
export async function encryptForVault(vault, text) {
  if (!vaultReady(vault)) return null;
  const pub = await crypto.subtle.importKey('jwk', vault.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  return { kid: vault.kid, data: b64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, enc.encode(String(text)))) };
}

export async function decryptWithVault(access, passwordEnc) {
  if (!access || !access.privateKey || !passwordEnc || !passwordEnc.data) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, access.privateKey, unb64(passwordEnc.data))); }
  catch { return null; }
}

// Create a new vault, wrapped for the admin who is creating it.
export async function createVaultFor(username, password, pwSalt) {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const vault = {
    kid: b64(rand(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10),
    publicKey,
    wrappers: { [up(username)]: await wrapPkcs8(pkcs8, password, pwSalt) },
    createdAt: new Date().toISOString(), by: up(username),
  };
  return { vault, access: { privateKey: await importPriv(pkcs8), pkcs8 } };
}

// An admin's login password → vault access for this session. Null if this
// admin has no wrapper yet (another admin's session will add one).
export async function unlockVaultAs(vault, username, password) {
  const w = vault && vault.wrappers && vault.wrappers[up(username)];
  if (!w) return null;
  try { const pkcs8 = await unwrapPkcs8(w, password); return { privateKey: await importPriv(pkcs8), pkcs8 }; }
  catch { return null; }
}

// With the key in hand, make sure every admin has a current wrapper: one made
// against the password they log in with now. Their password comes out of
// the vault itself. Returns the updated vault, or null if nothing changed.
export async function repairWrappers(vault, access, users) {
  if (!vaultReady(vault) || !access || !access.pkcs8) return null;
  const wrappers = { ...(vault.wrappers || {}) };
  let changed = false;
  for (const u of users || []) {
    if (String(u.role || '').toLowerCase() !== 'admin') continue;
    const name = up(u.username);
    const salt = u.pwSalt || '';
    if (!salt) continue;                                    // no password set on the worker yet
    const cur = wrappers[name];
    if (cur && cur.pwSalt === salt) continue;              // already current
    if (!inVault(u, vault)) continue;                      // don't know their password yet
    const pw = await decryptWithVault(access, u.passwordEnc);
    if (pw == null) continue;
    wrappers[name] = await wrapPkcs8(access.pkcs8, pw, salt);
    changed = true;
  }
  return changed ? { ...vault, wrappers } : null;
}
