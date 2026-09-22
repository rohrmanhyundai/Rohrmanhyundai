// Rohrman dashboard API (Cloudflare Worker).
//
// The dashboard is a static site on GitHub Pages that keeps its data as JSON
// in this public repo. It used to carry a shared GitHub token and the AWS keys
// inside users.json, which anyone could read. This worker is the only thing
// that holds those now:
//
//   POST /auth/login            { username, password } → { session, user, pwSalt }
//   GET  /auth/me                                        → { user }
//   POST /auth/change           { current, password }   → { pwSalt }
//   POST /auth/reset            { username, token, password } → { session, user, pwSalt }
//   POST /auth/forgot           { username }            → fires the password-reset workflow
//   GET  /admin/credentials                              → { USERNAME: { setAt } }   managers
//   POST /admin/set-password    { username, password }  → { pwSalt }                managers
//   DELETE /admin/credentials/:username                                             admins
//   *    /gh/contents/…, POST /gh/dispatches             GitHub contents API, session required;
//                                                        writes only under public/data/
//   PUT  /s3/object?key=…       raw body               → { url }                    session
//   DELETE /s3/object?key=…
//   POST /pusher/trigger        { channel, event, data } → publishes with the app secret; session
//
// Credentials live in KV as cred:<USERNAME> = { salt, hash, iterations, setAt }
// (PBKDF2-SHA256, 100k iterations — the most Workers allow per call). A session
// is an HMAC-signed payload { u, pwv, exp }; pwv is the credential's setAt, so
// changing or removing a password ends every session that was opened on it.
import { AwsClient } from 'aws4fetch';

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const up = (s) => String(s || '').trim().toUpperCase();
const randomHex = (n = 16) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a.buffer); };
const same = (a, b) => { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

const PBKDF2_ITER = 100000;                 // Workers refuse more per deriveBits call
const SESSION_MS = 30 * 24 * 3600 * 1000;   // a device stays signed in for 30 days
const isManagerRole = (role) => { const r = String(role || '').toLowerCase(); return r === 'admin' || r.includes('manager'); };
const isAdminRole = (role) => String(role || '').toLowerCase() === 'admin';
// Where the app is allowed to write. Everything else in the repo is code —
// letting a session write src/ would let anyone logged in ship a new build.
const WRITABLE_PREFIX = 'public/data/';
const DISPATCH_EVENTS = new Set(['password-reset', 'big-money-coaching']);
const S3_PREFIXES = ['pdf-reports/', 'tire-photos/', 'additional-time/', 'registrations/', 'tire-promos/', 'applicant-resumes/'];
const S3_MAX_BYTES = 25 * 1024 * 1024;
const PUSHER_CHANNELS = new Set(['rohrman-advisor-chat', 'rohrman-tech-chat', 'rohrman-system', 'rohrman-global-msg']);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ── Responses / CORS ─────────────────────────────────────────────────────────
function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,If-None-Match,X-Content-Disposition',
    'Access-Control-Expose-Headers': 'ETag,X-RateLimit-Remaining,X-RateLimit-Reset,X-RateLimit-Limit',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function readJson(request) { try { return await request.json(); } catch { throw new HttpError(400, 'Expected a JSON body.'); } }

// ── Passwords ────────────────────────────────────────────────────────────────
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' }, key, 256));
}
async function makeCredential(password) {
  const salt = randomHex();
  return { salt, hash: await derive(password, salt, PBKDF2_ITER), iterations: PBKDF2_ITER, setAt: new Date().toISOString() };
}
async function checkCredential(cred, password) {
  if (!cred || !cred.hash || !cred.salt || password == null) return false;
  return same(await derive(password, cred.salt, cred.iterations || PBKDF2_ITER), cred.hash);
}
function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 6) return 'Use at least 6 characters.';
  if (/^(.)\1+$/.test(p)) return 'That is one character repeated — pick something else.';
  if (p.length > 200) return 'That password is too long.';
  return '';
}

// KV credential access, with a short in-isolate cache so the session check on
// every proxied request doesn't turn into a KV read each time.
const credCache = new Map();   // USERNAME → { cred, at }
const CRED_TTL = 5 * 60 * 1000;
async function getCred(env, username) {
  const name = up(username);
  const hit = credCache.get(name);
  if (hit && Date.now() - hit.at < CRED_TTL) return hit.cred;
  const cred = await env.CREDS.get(`cred:${name}`, { type: 'json', cacheTtl: 300 });
  credCache.set(name, { cred, at: Date.now() });
  return cred;
}
async function putCred(env, username, cred) {
  await env.CREDS.put(`cred:${up(username)}`, JSON.stringify(cred), { metadata: { setAt: cred.setAt } });
  credCache.set(up(username), { cred, at: Date.now() });
}
async function deleteCred(env, username) {
  await env.CREDS.delete(`cred:${up(username)}`);
  credCache.delete(up(username));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
async function hmacKey(env) {
  if (!env.SESSION_SECRET) throw new HttpError(500, 'SESSION_SECRET is not set on the worker.');
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function issueSession(env, username, cred) {
  const body = b64u(enc.encode(JSON.stringify({ u: up(username), pwv: cred.setAt, iat: Date.now(), exp: Date.now() + SESSION_MS, n: randomHex(6) })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
  return `v1.${body}.${sig}`;
}
// The session on this request, or null. Checks the signature, the expiry and
// that the credential it was opened on is still the current one.
async function readSession(env, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+v1\.([\w-]+)\.([\w-]+)$/);
  if (!m) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(m[2]), enc.encode(m[1])); } catch { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(dec.decode(unb64u(m[1]))); } catch { return null; }
  if (!p || !p.u || !p.exp || Date.now() > p.exp) return null;
  const cred = await getCred(env, p.u);
  if (!cred || cred.setAt !== p.pwv) return null;
  return p;
}
async function requireSession(env, request) {
  const s = await readSession(env, request);
  if (!s) throw new HttpError(401, 'Please sign in again.');
  return s;
}

// ── Login attempt throttle (per isolate — enough to blunt a brute force) ─────
const attempts = new Map();   // key → { n, until }
function throttle(key, max, windowMs) {
  const now = Date.now();
  const cur = attempts.get(key);
  if (cur && now < cur.until) {
    if (cur.n >= max) throw new HttpError(429, 'Too many attempts — wait a few minutes and try again.');
    cur.n++;
  } else attempts.set(key, { n: 1, until: now + windowMs });
  if (attempts.size > 5000) attempts.clear();
}

// ── GitHub ───────────────────────────────────────────────────────────────────
// Without a token (local dev) reads still work — the repo is public — and
// writes fail the way GitHub says they should.
const ghHeaders = (env, extra = {}) => ({ ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}), 'User-Agent': 'rohrman-api', 'X-GitHub-Api-Version': '2022-11-28', ...extra });
const repoUrl = (env, tail) => `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${tail}`;
async function readRepoJson(env, path) {
  const res = await fetch(repoUrl(env, `contents/${path}?ref=${env.GITHUB_BRANCH}&_=${Date.now()}`), { headers: ghHeaders(env, { Accept: 'application/vnd.github.raw' }) });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}
// The user's record from users.json — the roster is still the source of truth
// for who exists and what role they hold; KV only holds the password.
async function findUser(env, username) {
  const d = await readRepoJson(env, 'public/data/users.json');
  const list = Array.isArray(d) ? d : (d && Array.isArray(d.users) ? d.users : []);
  return list.find(u => up(u && u.username) === up(username)) || null;
}
// What the browser gets back about a user: everything the public file already
// says, minus any password material that may still be sitting on the record.
function publicUser(u) { const o = { ...u }; delete o.password; delete o.passwordHash; return o; }

async function proxyGithub(request, env, subpath, search) {
  const method = request.method;
  if (subpath === 'dispatches') {
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = await readJson(request);
    if (!DISPATCH_EVENTS.has(body && body.event_type)) throw new HttpError(403, 'That workflow cannot be triggered from here.');
    const res = await fetch(repoUrl(env, 'dispatches'), { method: 'POST', headers: ghHeaders(env, { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify({ event_type: body.event_type, client_payload: body.client_payload || {} }) });
    return new Response(res.body, { status: res.status, headers: passthroughHeaders(res) });
  }
  if (!subpath.startsWith('contents/')) throw new HttpError(403, 'Only the contents API is available.');
  const path = decodeURIComponent(subpath.slice('contents/'.length));
  if (path.includes('..')) throw new HttpError(400, 'Bad path.');
  let body;
  if (method === 'GET') {
    body = undefined;
  } else if (method === 'PUT' || method === 'DELETE') {
    if (!path.startsWith(WRITABLE_PREFIX)) throw new HttpError(403, `Writes are limited to ${WRITABLE_PREFIX}.`);
    const b = await readJson(request);
    if (b.branch && b.branch !== env.GITHUB_BRANCH) throw new HttpError(403, 'Wrong branch.');
    body = JSON.stringify({ message: String(b.message || 'Update'), content: b.content, sha: b.sha, branch: env.GITHUB_BRANCH });
  } else throw new HttpError(405, 'Method not allowed.');
  const fwd = {};
  for (const h of ['accept', 'if-none-match']) { const v = request.headers.get(h); if (v) fwd[h] = v; }
  if (body !== undefined) fwd['content-type'] = 'application/json';
  const res = await fetch(repoUrl(env, `contents/${path}${search}`), { method, headers: ghHeaders(env, fwd), body });
  return new Response(res.body, { status: res.status, headers: passthroughHeaders(res) });
}
function passthroughHeaders(res) {
  const out = {};
  for (const h of ['content-type', 'etag', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) { const v = res.headers.get(h); if (v) out[h] = v; }
  return out;
}
async function repositoryDispatch(env, eventType, payload) {
  const res = await fetch(repoUrl(env, 'dispatches'), { method: 'POST', headers: ghHeaders(env, { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify({ event_type: eventType, client_payload: payload }) });
  if (res.status !== 204) throw new HttpError(502, `GitHub replied ${res.status}.`);
}

// ── S3 ───────────────────────────────────────────────────────────────────────
function s3(env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new HttpError(500, 'AWS keys are not set on the worker.');
  return new AwsClient({ accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, service: 's3', region: env.S3_REGION });
}
function s3Key(env, url) {
  const key = url.searchParams.get('key') || '';
  if (!S3_PREFIXES.some(p => key.startsWith(p)) || key.includes('..') || key.endsWith('/')) throw new HttpError(403, 'That S3 location is not allowed.');
  return key;
}
const s3Url = (env, key) => `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;

// ── Pusher ───────────────────────────────────────────────────────────────────
// Pusher's REST API wants an HMAC of the request made with the app secret,
// plus an MD5 of the body (Workers' WebCrypto has MD5 for exactly this kind
// of legacy protocol).
async function pusherTrigger(env, channel, event, data) {
  if (!env.PUSHER_APP_ID || !env.PUSHER_KEY || !env.PUSHER_SECRET) throw new HttpError(500, 'Pusher is not configured on the worker.');
  const body = JSON.stringify({ name: event, channel, data: JSON.stringify(data == null ? {} : data) });
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyMd5 = hex(await crypto.subtle.digest('MD5', enc.encode(body)));
  const qs = `auth_key=${env.PUSHER_KEY}&auth_timestamp=${ts}&auth_version=1.0&body_md5=${bodyMd5}`;
  const toSign = ['POST', `/apps/${env.PUSHER_APP_ID}/events`, qs].join('\n');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PUSHER_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(toSign)));
  const res = await fetch(`https://api-${env.PUSHER_CLUSTER}.pusher.com/apps/${env.PUSHER_APP_ID}/events?${qs}&auth_signature=${sig}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new HttpError(502, `Pusher replied ${res.status}.`);
}

// ── Router ───────────────────────────────────────────────────────────────────
async function route(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (p === '/health') {
    const out = { ok: true, github: !!env.GITHUB_TOKEN, aws: !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY), pusher: !!env.PUSHER_SECRET, sessions: !!env.SESSION_SECRET };
    // ?check=s3 makes a signed, harmless request to the bucket so a wrong or
    // mistyped key shows up here (403) instead of only when someone uploads.
    // Signed in only: it spends a real S3 call and reports key lengths.
    if (url.searchParams.get('check') === 's3' && out.aws && await readSession(env, request)) {
      try {
        const res = await s3(env).fetch(`https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/?list-type=2&max-keys=1`, { method: 'GET' });
        out.s3Status = res.status;
        out.s3Ok = res.ok;
        if (!res.ok) { const t = await res.text(); const m = t.match(/<Code>([^<]+)<\/Code>/); out.s3Error = m ? m[1] : `HTTP ${res.status}`; }
      } catch (e) { out.s3Ok = false; out.s3Error = String(e && e.message || e); }
      // Lengths only — never the values. An AWS key id is 20 chars, a secret 40,
      // so a mixed-up paste shows up here immediately.
      out.keyIdLen = String(env.AWS_ACCESS_KEY_ID || '').length;
      out.secretLen = String(env.AWS_SECRET_ACCESS_KEY || '').length;
    }
    return json(out);
  }

  // ── auth ──
  if (p === '/auth/login' && method === 'POST') {
    const { username, password } = await readJson(request);
    const ip = request.headers.get('CF-Connecting-IP') || 'ip';
    throttle(`ip:${ip}`, 30, 10 * 60 * 1000);
    throttle(`user:${up(username)}`, 10, 10 * 60 * 1000);
    const cred = await getCred(env, username);
    if (!(await checkCredential(cred, password))) {
      const user = cred ? null : await findUser(env, username);
      // A real user with no password yet gets told so — they need a manager
      // to set one or a reset link, not to keep guessing.
      if (user && !cred) throw new HttpError(403, 'No password is set for this user yet. Ask a manager to set one, or use "Forgot?" to email yourself a reset link.');
      throw new HttpError(401, 'Login failed.');
    }
    const user = await findUser(env, username);
    if (!user) throw new HttpError(401, 'Login failed.');
    return json({ session: await issueSession(env, username, cred), user: publicUser(user), pwSalt: cred.salt });
  }
  if (p === '/auth/me' && method === 'GET') {
    const s = await requireSession(env, request);
    const user = await findUser(env, s.u);
    if (!user) throw new HttpError(401, 'Please sign in again.');
    return json({ user: publicUser(user) });
  }
  if (p === '/auth/change' && method === 'POST') {
    const s = await requireSession(env, request);
    const { current, password } = await readJson(request);
    const problem = passwordProblem(password); if (problem) throw new HttpError(400, problem);
    if (!(await checkCredential(await getCred(env, s.u), current))) throw new HttpError(403, 'Current password is wrong.');
    const cred = await makeCredential(password);
    await putCred(env, s.u, cred);
    return json({ pwSalt: cred.salt, session: await issueSession(env, s.u, cred) });
  }
  if (p === '/auth/reset' && method === 'POST') {
    const { username, token, password } = await readJson(request);
    throttle(`reset:${up(username)}`, 10, 10 * 60 * 1000);
    const problem = passwordProblem(password); if (problem) throw new HttpError(400, problem);
    const user = await findUser(env, username);
    const pr = user && user.passwordReset;
    if (!pr || !pr.hash) throw new HttpError(403, 'This reset link is no longer valid.');
    if (pr.expires && Date.now() > new Date(pr.expires).getTime()) throw new HttpError(403, 'This reset link has expired.');
    if (!same(hex(await crypto.subtle.digest('SHA-256', enc.encode(String(token || '')))), pr.hash)) throw new HttpError(403, 'This reset link is no longer valid.');
    // Single use: remember the link's hash so a second visit is refused even
    // before the browser has cleared passwordReset off the user record.
    if (await env.CREDS.get(`reset-used:${pr.hash}`)) throw new HttpError(403, 'This reset link has already been used.');
    const cred = await makeCredential(password);
    await putCred(env, username, cred);
    await env.CREDS.put(`reset-used:${pr.hash}`, '1', { expirationTtl: 30 * 24 * 3600 });
    return json({ session: await issueSession(env, username, cred), user: publicUser(user), pwSalt: cred.salt });
  }
  if (p === '/auth/forgot' && method === 'POST') {
    const { username } = await readJson(request);
    const ip = request.headers.get('CF-Connecting-IP') || 'ip';
    throttle(`forgot:${ip}`, 5, 10 * 60 * 1000);
    if (!String(username || '').trim()) throw new HttpError(400, 'Enter your username.');
    // Whether the name matched (or has an email) is never revealed here.
    await repositoryDispatch(env, 'password-reset', { username: String(username).trim() });
    return json({ ok: true });
  }

  // ── admin (managers set passwords; only admins remove one) ──
  if (p.startsWith('/admin/')) {
    const s = await requireSession(env, request);
    const me = await findUser(env, s.u);
    if (!me || !isManagerRole(me.role)) throw new HttpError(403, 'Managers only.');
    if (p === '/admin/credentials' && method === 'GET') {
      const out = {};
      let cursor;
      do {
        const page = await env.CREDS.list({ prefix: 'cred:', cursor });
        for (const k of page.keys) out[k.name.slice(5)] = { setAt: (k.metadata && k.metadata.setAt) || null };
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return json(out);
    }
    if (p === '/admin/set-password' && method === 'POST') {
      const { username, password } = await readJson(request);
      const problem = passwordProblem(password); if (problem) throw new HttpError(400, problem);
      const target = await findUser(env, username);
      if (!target) throw new HttpError(404, 'That user is not on the user list — save the user first.');
      // A manager can't take over an admin's login; an admin can set anyone's.
      if (isAdminRole(target.role) && !isAdminRole(me.role)) throw new HttpError(403, 'Only an admin can set an admin\'s password.');
      const cred = await makeCredential(password);
      await putCred(env, username, cred);
      return json({ pwSalt: cred.salt });
    }
    const m = p.match(/^\/admin\/credentials\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (!isAdminRole(me.role)) throw new HttpError(403, 'Admins only.');
      await deleteCred(env, decodeURIComponent(m[1]));
      return json({ ok: true });
    }
    throw new HttpError(404, 'Not found.');
  }

  // ── GitHub contents proxy ──
  if (p.startsWith('/gh/')) {
    await requireSession(env, request);
    return proxyGithub(request, env, p.slice(4), url.search);
  }

  // ── S3 ──
  if (p === '/s3/object') {
    await requireSession(env, request);
    const key = s3Key(env, url);
    if (method === 'PUT') {
      const len = Number(request.headers.get('content-length') || 0);
      if (len > S3_MAX_BYTES) throw new HttpError(413, 'File is too large (25 MB max).');
      const body = await request.arrayBuffer();
      if (body.byteLength > S3_MAX_BYTES) throw new HttpError(413, 'File is too large (25 MB max).');
      const res = await s3(env).fetch(s3Url(env, key), { method: 'PUT', body, headers: { 'Content-Type': request.headers.get('content-type') || 'application/octet-stream', 'Content-Disposition': request.headers.get('x-content-disposition') || 'inline' } });
      if (!res.ok) throw new HttpError(502, `S3 upload failed (${res.status}).`);
      return json({ url: s3Url(env, key), key });
    }
    if (method === 'DELETE') {
      const res = await s3(env).fetch(s3Url(env, key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new HttpError(502, `S3 delete failed (${res.status}).`);
      return json({ ok: true });
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  if (p === '/pusher/trigger' && method === 'POST') {
    await requireSession(env, request);
    const { channel, event, data } = await readJson(request);
    if (!PUSHER_CHANNELS.has(channel) || typeof event !== 'string' || !event) throw new HttpError(403, 'That channel is not allowed.');
    await pusherTrigger(env, channel, event, data);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    let res;
    try {
      res = await route(request, env, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res = json({ error: e instanceof HttpError ? e.message : 'Something went wrong on the server.' }, status);
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
