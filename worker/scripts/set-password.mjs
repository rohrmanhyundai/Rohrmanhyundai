#!/usr/bin/env node
// Set (or bootstrap) a user's dashboard password straight into the worker's KV
// store — for the very first admin login, or for a user who's locked out.
//
//   cd worker && npm run set-password -- SHAWN
//
// Prompts for the password (shown as you type), hashes it exactly like the worker
// does, and writes it with wrangler. Needs `npx wrangler login` done first and
// the KV namespace id filled into wrangler.toml.
import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const username = String(process.argv[2] || '').trim().toUpperCase();
if (!username) { console.error('Usage: npm run set-password -- USERNAME'); process.exit(1); }

const ITER = 100000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

// Typed in the clear on purpose — this is the admin's own terminal, and a
// blind double-entry kept mismatching.
const pw = await ask(`New password for ${username} (shown as you type): `);
if (pw.length < 6) { console.error('Use at least 6 characters.'); process.exit(1); }
if (/^(.)\1+$/.test(pw)) { console.error('That is one character repeated — pick something else.'); process.exit(1); }

const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
const hash = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: ITER, hash: 'SHA-256' }, key, 256));
const cred = { salt, hash, iterations: ITER, setAt: new Date().toISOString() };

execFileSync('npx', ['wrangler', 'kv', 'key', 'put', `cred:${username}`, JSON.stringify(cred), '--binding=CREDS', '--remote', '--metadata', JSON.stringify({ setAt: cred.setAt })], { stdio: 'inherit' });
console.log(`✅ Password set for ${username}. Sign in on the dashboard with it.`);
