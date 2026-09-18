#!/usr/bin/env node
// Password reset — server half. Runs inside the password-reset GitHub Action.
//
// Given a username (from the repository_dispatch payload), find the user in
// public/data/users.json, mint a random token, store ONLY its SHA-256 on the
// record with a one-hour expiry, and email the link with nodemailer over Gmail.
//
// The email is sent from here, not a later workflow step: this repo is public,
// so its Action logs are public too, and a reset link that appeared in a log or
// a step output would let anyone reset the password. The token is masked in the
// log and never written to the repo.
//
// A user that doesn't exist or has no email is not an error — the workflow just
// ends quietly, so the request can't be used to probe which usernames are real.

const crypto = require('crypto');
const nodemailer = require('nodemailer');

// The file is edited through the Contents API rather than a git commit + push:
// the app writes users.json from the browser all day, and a rebase conflict on
// the same file would strand the workflow. GET → modify → PUT with the sha,
// retried on a 409, is exactly what the app does.
const REPO = process.env.GITHUB_REPOSITORY || 'rohrmanhyundai/Rohrmanhyundai';
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const API = `https://api.github.com/repos/${REPO}/contents/public/data/users.json`;
const HEADERS = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
const SITE = process.env.SITE_URL || 'https://rohrmanhyundai.github.io/Rohrmanhyundai/';
const TTL_MIN = 60;

async function readUsers() {
  const res = await fetch(`${API}?ref=${BRANCH}&_=${Date.now()}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET users.json → ${res.status}`);
  const j = await res.json();
  const text = j.content && j.content.trim()
    ? Buffer.from(j.content.replace(/\s/g, ''), 'base64').toString('utf8')
    : await (await fetch(`${API}?ref=${BRANCH}&_=${Date.now()}`, { headers: { ...HEADERS, Accept: 'application/vnd.github.raw' } })).text();
  return { sha: j.sha, raw: JSON.parse(text) };
}

async function writeUsers(raw, sha) {
  const res = await fetch(API, {
    method: 'PUT', headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Password reset requested', branch: BRANCH, sha,
      content: Buffer.from(JSON.stringify(raw, null, 2) + '\n').toString('base64') }),
  });
  return res.status;
}

(async () => {
const wanted = String(process.env.RESET_USERNAME || '').trim().toUpperCase();
if (!wanted) { console.log('No username in payload — nothing to do.'); return; }
if (!process.env.MAIL_USERNAME || !process.env.MAIL_APP_PASSWORD) throw new Error('MAIL_USERNAME / MAIL_APP_PASSWORD secrets are not set on the repository.');

let user = null, email = '', token = '';
for (let attempt = 0; attempt < 6; attempt++) {
  const { sha, raw } = await readUsers();
  const users = Array.isArray(raw) ? raw : (raw.users || []);
  user = users.find(u => String(u.username || '').trim().toUpperCase() === wanted);
  if (!user) { console.log(`No user matches "${wanted}" — nothing sent.`); return; }
  email = String(user.email || '').trim();
  if (!email || !email.includes('@')) { console.log(`User ${user.username} has no email on file — nothing sent.`); return; }

  token = crypto.randomBytes(32).toString('hex');
  console.log(`::add-mask::${token}`);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + TTL_MIN * 60 * 1000).toISOString();
  user.passwordReset = { hash, expires, requestedAt: new Date().toISOString() };

  const status = await writeUsers(raw, sha);
  if (status === 200 || status === 201) break;
  if (status === 409 || status === 422) { console.log(`users.json changed under us (${status}) — retrying`); await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
  throw new Error(`PUT users.json → ${status}`);
}

const link = `${SITE}${SITE.includes('?') ? '&' : '?'}reset=${token}&u=${encodeURIComponent(user.username)}`;
const first = String(user.username || '').trim();
const display = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;background:#0f172a;color:#e2e8f0;border-radius:16px">
  <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9;font-weight:800">Rohrman Hyundai · Service</div>
  <h1 style="margin:10px 0 6px;font-size:24px;color:#fff">Reset your password</h1>
  <p style="font-size:15px;line-height:1.6;color:#cbd5e1">Hi ${esc(display)} — someone (hopefully you) asked to reset the password for the dashboard user <b style="color:#fff">${esc(user.username)}</b>.</p>
  <p style="margin:22px 0"><a href="${link}" style="display:inline-block;background:#f59e0b;color:#422006;font-weight:900;font-size:15px;padding:13px 22px;border-radius:10px;text-decoration:none">Choose a new password →</a></p>
  <p style="font-size:13px;line-height:1.6;color:#94a3b8">This link works for <b>${TTL_MIN} minutes</b> and only once. If you didn't ask for this, you can ignore it — your password stays the same.</p>
  <p style="font-size:12px;color:#64748b;word-break:break-all">If the button doesn't work, paste this into your browser:<br>${link}</p>
</div>`;

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_APP_PASSWORD },
});
await transport.sendMail({
  from: `Rohrman Hyundai Dashboard <${process.env.MAIL_USERNAME}>`,
  to: email,
  subject: 'Reset your Rohrman Hyundai dashboard password',
  text: `Hi ${display} — open this link to choose a new password for dashboard user ${user.username}:\n\n${link}\n\nIt works for ${TTL_MIN} minutes and only once. If you didn't ask for this, ignore it.`,
  html,
});
console.log(`Reset email sent for ${user.username} → ${email.replace(/^(.).*@/, '$1***@')} (expires in ${TTL_MIN} min).`);
})().catch(e => { console.error(e); process.exit(1); });
