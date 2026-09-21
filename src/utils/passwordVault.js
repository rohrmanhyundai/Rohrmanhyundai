// Admin password vault.
//
// Passwords are hashed for login (utils/password.js) — a hash can't be shown
// back. Admins still need to look a password up for someone, so every password
// is ALSO stored encrypted with a public key that lives in users.json:
//
//   users.json.passwordVault = {
//     kid,                        // id of this keypair
//     publicKey,                  // RSA-OAEP JWK — anyone can encrypt with it
//     privateKeyWrapped: {        // PKCS8 private key, AES-GCM under a key
//       salt, iv, data, iterations   derived (PBKDF2) from the vault passphrase
//     },
//     createdAt, by
//   }
//   user.passwordEnc = { kid, data }   // RSA-OAEP ciphertext of the password
//
// So a user resetting their own password (no passphrase on their device) still
// gets it into the vault, and only someone who knows the vault passphrase can
// unwrap the private key and read it. users.json is public: the passphrase is
// the only secret, and it is never stored anywhere.

const ITER = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function wrapKeyFrom(passphrase, salt, iterations = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapPkcs8(pkcs8, passphrase) {
  const salt = rand(16), iv = rand(12);
  const wrapKey = await wrapKeyFrom(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  return { salt: b64(salt), iv: b64(iv), data: b64(data), iterations: ITER };
}

async function unwrapPkcs8(vault, passphrase) {
  const w = vault.privateKeyWrapped;
  const wrapKey = await wrapKeyFrom(passphrase, unb64(w.salt), w.iterations || ITER);
  try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, wrapKey, unb64(w.data)); }
  catch { throw new Error('That vault passphrase is wrong.'); }
}

export const vaultReady = (vault) => !!(vault && vault.publicKey && vault.privateKeyWrapped && vault.privateKeyWrapped.data);

// Create a brand-new vault from a passphrase.
export async function createVault(passphrase, by) {
  if (!passphrase || String(passphrase).length < 6) throw new Error('Use a vault passphrase of at least 6 characters.');
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  return {
    kid: b64(rand(9)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10),
    publicKey,
    privateKeyWrapped: await wrapPkcs8(pkcs8, passphrase),
    createdAt: new Date().toISOString(), by: by || '',
  };
}

// Encrypt a password for the vault. Returns null when there's no vault yet.
export async function encryptForVault(vault, text) {
  if (!vaultReady(vault)) return null;
  const pub = await crypto.subtle.importKey('jwk', vault.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, enc.encode(String(text)));
  return { kid: vault.kid, data: b64(data) };
}

// Passphrase → private CryptoKey (throws on a wrong passphrase).
export async function unlockVault(vault, passphrase) {
  if (!vaultReady(vault)) throw new Error('No vault has been set up yet.');
  const pkcs8 = await unwrapPkcs8(vault, passphrase);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

export async function decryptWithVault(privateKey, passwordEnc) {
  if (!privateKey || !passwordEnc || !passwordEnc.data) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(passwordEnc.data))); }
  catch { return null; }
}

// Change the passphrase: unwrap with the old one, wrap again with the new one.
export async function rewrapVault(vault, oldPassphrase, newPassphrase) {
  if (!newPassphrase || String(newPassphrase).length < 6) throw new Error('Use a new passphrase of at least 6 characters.');
  const pkcs8 = await unwrapPkcs8(vault, oldPassphrase);
  return { ...vault, privateKeyWrapped: await wrapPkcs8(pkcs8, newPassphrase), rewrappedAt: new Date().toISOString() };
}

// Is this user's stored ciphertext readable by the current vault?
export const inVault = (user, vault) => !!(user && user.passwordEnc && user.passwordEnc.data && vault && user.passwordEnc.kid === vault.kid);
