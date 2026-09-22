#!/usr/bin/env node
// One-time cutover helper: remove everything from public/data/users.json that
// the worker now owns — the shared GitHub token, the AWS keys and every
// per-user password hash (or legacy plaintext). Run once the worker is live,
// then commit the result.
//
//   node scripts/strip-users-secrets.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../public/data/users.json', import.meta.url);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const users = Array.isArray(raw) ? raw : raw.users || [];
let hashes = 0, plain = 0;
const cleaned = users.map(u => {
  const o = { ...u };
  if (o.passwordHash) { delete o.passwordHash; hashes++; }
  if (o.password != null) { delete o.password; plain++; }
  return o;
});
const out = { users: cleaned };
if (!Array.isArray(raw) && raw.passwordVault) out.passwordVault = raw.passwordVault;
const dropped = Array.isArray(raw) ? [] : ['sharedSaveCode', 'awsAccessKeyId', 'awsSecretAccessKey'].filter(k => raw[k]);
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(`users.json: removed ${hashes} password hash${hashes === 1 ? '' : 'es'}, ${plain} plaintext password${plain === 1 ? '' : 's'}, top-level ${dropped.join(', ') || 'nothing'}.`);
