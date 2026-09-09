// The manager's Employee Applicants code.
//
// Stored as a salted hash, never in the clear: users.json is readable without
// logging in, so a plaintext code there would be no gate at all. Hashing means
// the stored value can't be typed back in.
//
// Being straight about what this is: the code keeps the wrong person out of the
// screen — the shop terminal someone else left open. It does not make the
// underlying data file private. That takes locking down the storage itself.

const ITERATIONS = 150000;

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return bytesToHex(a.buffer);
}

async function derive(code, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return bytesToHex(bits);
}

// Returns what gets stored on the user record.
export async function hashAccessCode(code) {
  const salt = randomSalt();
  return { salt, hash: await derive(code, salt), iterations: ITERATIONS, setAt: new Date().toISOString() };
}

export async function verifyAccessCode(code, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const got = await derive(code, stored.salt);
  // Compare in constant time — not that timing matters much for four digits,
  // but there's no reason to leak it either.
  if (got.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

export const hasAccessCode = (user) => !!(user && user.applicantCode && user.applicantCode.hash);
