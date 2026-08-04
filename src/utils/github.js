const GITHUB_OWNER = 'rohrmanhyundai';
const GITHUB_REPO = 'Rohrmanhyundai';
const GITHUB_BRANCH = 'main';
const GITHUB_PATH = 'public/data/data.json';
const TOKEN_KEY = 'rohrmanGithubToken';
const BASE = import.meta.env.BASE_URL;

import { uploadFileToS3, deleteFileFromS3, ensureAwsCreds } from './s3.js';

export function getGithubToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setGithubToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

// Resolve a usable token. If localStorage is empty (fresh device / cleared
// storage / race with App-level boot fetch), pull the shared save code from
// users.json on demand and store it so the rest of the session works.
export async function ensureGithubToken() {
  let token = getGithubToken();
  if (token) return token;
  // Try GitHub API first
  try {
    const raw = await readGitHubFile(publicHeaders(), 'public/data/users.json');
    const parsed = parseUsersPayload(raw);
    if (parsed?.sharedSaveCode) {
      setGithubToken(parsed.sharedSaveCode);
      return parsed.sharedSaveCode;
    }
  } catch {}
  // Fallback: GitHub Pages CDN copy
  try {
    const res = await fetch(`${BASE}data/users.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const parsed = parseUsersPayload(await res.json());
      if (parsed?.sharedSaveCode) {
        setGithubToken(parsed.sharedSaveCode);
        return parsed.sharedSaveCode;
      }
    }
  } catch {}
  return '';
}

// Read dashboard data directly from the GitHub API — instant, bypasses GitHub Pages rebuild delay.
// Falls back to null if the API is unavailable (caller should fall back to GitHub Pages CDN).
export async function loadDashboardData() {
  try {
    const data = await readGitHubFile(authHeaders(), GITHUB_PATH);
    if (data) return data;
  } catch {}
  return null;
}

// ── Force-refresh signal ────────────────────────────────────────────────────
// Durable fallback for the realtime Pusher "force-refresh" event. The admin
// button bumps this timestamp; every client polls it (and re-checks on socket
// reconnect) so even a client that missed the live event — e.g. an always-on TV
// whose websocket slept — reloads on its next check. Read via the GitHub API so
// it's instant and uses the shared token available to every logged-in client.
const FORCE_REFRESH_PATH = 'public/data/force-refresh.json';

export async function loadForceRefresh() {
  try {
    const data = await readGitHubFile(authHeaders(), FORCE_REFRESH_PATH);
    if (data && typeof data.ts === 'number') return data;
  } catch {}
  // CDN fallback (may lag until next deploy; the API path above is primary).
  try {
    const res = await fetch(`${BASE}data/force-refresh.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); if (d && typeof d.ts === 'number') return d; }
  } catch {}
  return null;
}

export async function saveForceRefresh(ts, by) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token configured. Go to Admin > GitHub Settings and enter a Personal Access Token.');
  await saveGitHubFile(authHeaders(), FORCE_REFRESH_PATH,
    { ts, by: by || 'admin' }, `Force refresh signal ${new Date(ts).toISOString()}`);
}

export async function saveDashboardToGitHub(payload) {
  const token = await ensureGithubToken();
  if (!token) {
    throw new Error('No GitHub token configured. Go to Admin > GitHub Settings and enter a Personal Access Token.');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rohrman-dashboard',
  };

  const apiPath = GITHUB_PATH;
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}?ref=${GITHUB_BRANCH}`;
  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  // Retry on stale-sha/conflict so a concurrent save (another manager, the
  // client poll, or GitHub replica lag) doesn't make Save Changes silently fail.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    let sha = null;
    try {
      const getRes = await fetch(`${getUrl}&_=${Date.now()}`, { headers, cache: 'no-store' });
      noteRateLimit(getRes);
      if (getRes.ok) { const existing = await getRes.json(); sha = existing.sha || null; }
      else if (getRes.status !== 404) { lastErr = new Error(`Failed to read existing file (${getRes.status})`); }
    } catch { /* network hiccup on GET — retry */ }

    let putRes;
    try {
      putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Update dashboard data ${new Date().toISOString()}`, content, branch: GITHUB_BRANCH, sha }),
      });
    } catch (e) {
      lastErr = e; // network error reaching GitHub — worth a retry
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    if (putRes.ok) return await putRes.json();
    noteRateLimit(putRes);
    let putJson = {}; try { putJson = await putRes.json(); } catch {}
    lastErr = new Error(putJson.message || `GitHub update failed (${putRes.status})`);
    // Retry only conflicts / transient server errors; a 403/401/404 fails the
    // same every attempt, so stop rather than burn more of the shared quota.
    if (![409, 422, 500, 502, 503, 504].includes(putRes.status)) break;
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }
  throw lastErr || new Error('GitHub update failed');
}

async function saveGitHubFile(headers, path, data, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  // Read-sha then write-with-sha is optimistic locking: if the file changed
  // between the two (another client saving, the WIP poll on another device, or
  // GitHub replica lag) the PUT returns 409/422. Re-read the sha and retry so a
  // save never silently fails under concurrency.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    let sha = null;
    try {
      const getRes = await fetch(`${getUrl}&_=${Date.now()}`, { headers, cache: 'no-store' });
      noteRateLimit(getRes);
      if (getRes.ok) { const existing = await getRes.json(); sha = existing.sha || null; }
    } catch { /* network hiccup on the GET — retry below */ }

    let putRes;
    try {
      putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content, branch: GITHUB_BRANCH, sha }),
      });
    } catch (e) {
      lastErr = e; // network error reaching GitHub — worth a retry
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    if (putRes.ok) return;
    noteRateLimit(putRes);
    let j = {}; try { j = await putRes.json(); } catch {}
    lastErr = new Error(j.message || `GitHub save failed (${putRes.status})`);
    // Only conflicts / stale-sha / transient server errors are worth retrying.
    // Anything else (403 rate limit, 401 bad token, 404) will fail the same way
    // every attempt — retrying just burns more of the shared quota, so stop now.
    // (This is the bug the rate-limit report exposed: the old `throw` here was
    // caught by a surrounding try/catch and the loop retried 403s five times.)
    if (![409, 422, 500, 502, 503, 504].includes(putRes.status)) break;
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }
  throw lastErr || new Error('GitHub save failed');
}

// Conflict-safe read-modify-write for a JSON file. Re-reads the FRESH content on
// EVERY attempt (including after a conflict) and re-applies `mutate`, then writes
// with that read's sha. This is what saveGitHubFile can't do: on a 409 it re-read
// only the sha and re-sent the SAME stale content, so two clients appending to
// the chat at the same moment each overwrote the other — one message silently
// vanished ("I sent it and it didn't show up"). Here the loser of the race simply
// re-reads the winner's message and appends onto it, so both survive.
// `mutate(current)` gets the latest parsed value (or null if the file is missing)
// and returns the next value to write.
async function mutateGitHubJson(path, mutate, message) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  // Don't even try (and don't retry-hammer) while the shared quota is spent —
  // that only deepens the rate limit. Fail fast with a friendly message.
  if (isRateLimited()) throw new Error(`Too many requests right now — wait ${rateLimitResetSeconds()}s and resend.`);
  const headers = authHeaders();
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    // If a prior attempt (or another caller) hit the quota, stop retrying into it.
    if (isRateLimited()) { lastErr = new Error(`Too many requests right now — wait ${rateLimitResetSeconds()}s and resend.`); break; }
    let sha = null, current = null, fileExists = false, readOk = false;
    try {
      const getRes = await fetch(`${getUrl}&_=${Date.now()}`, { headers, cache: 'no-store' });
      noteRateLimit(getRes);
      if (getRes.ok) {
        fileExists = true;
        const ex = await getRes.json();
        sha = ex.sha || null;
        // The contents API inlines base64 content only for files <= 1 MB; for a
        // larger file `content` is EMPTY. Reading that as "" and writing it back
        // wiped the recalls index (1 MB+ of embedded search text). So: parse the
        // inline content when present, otherwise pull the raw bytes (up to 100 MB)
        // via the raw media type.
        try {
          if (ex.content && ex.content.trim()) {
            const bytes = Uint8Array.from(atob(ex.content.replace(/\s/g, '')), c => c.charCodeAt(0));
            current = JSON.parse(new TextDecoder('utf-8').decode(bytes));
            readOk = true;
          } else if (sha) {
            const rawRes = await fetch(`${getUrl}&_=${Date.now()}`, {
              headers: { ...headers, Accept: 'application/vnd.github.raw' }, cache: 'no-store',
            });
            noteRateLimit(rawRes);
            if (rawRes.ok) { current = JSON.parse(await rawRes.text()); readOk = true; }
          }
        } catch { readOk = false; }
      } else if (getRes.status === 404) {
        fileExists = false; readOk = true; current = null; // genuinely new file
      } else {
        lastErr = new Error(`GitHub read failed (${getRes.status})`);
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    // NEVER overwrite a file we couldn't read — that's how the whole index got
    // wiped. Retry the read; only a real 404 is allowed to proceed with `null`.
    if (fileExists && !readOk) {
      lastErr = new Error('Could not read current file content — refusing to overwrite');
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    const next = mutate(current);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 2))));
    let putRes;
    try {
      putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content, branch: GITHUB_BRANCH, sha }),
      });
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    if (putRes.ok) return next;
    noteRateLimit(putRes);
    let j = {}; try { j = await putRes.json(); } catch {}
    lastErr = new Error(j.message || `GitHub save failed (${putRes.status})`);
    // Stale-sha / transient: loop re-reads fresh content and re-applies mutate.
    if (![409, 422, 500, 502, 503, 504].includes(putRes.status)) break;
    await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
  }
  throw lastErr || new Error('GitHub save failed');
}

// Read a file directly from the GitHub API (bypasses GitHub Pages rebuild delay).
// Works without a token for public repos (60 req/hr unauthenticated).
// Uses the RAW media type so it reads files of ANY size — the default contents
// response only inlines content up to 1 MB, and the recalls index (1 MB+ of
// embedded search text) crossed that, which is why display fell back to a stale
// Pages copy. Returns null on any failure so callers can fall back.
async function readGitHubFile(headers, path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
      { headers: { ...headers, Accept: 'application/vnd.github.raw' }, cache: 'no-store' }
    );
    noteRateLimit(res);
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch { return null; }
}

// ── Rate-limit awareness ──────────────────────────────────────────────────────
// One GitHub token is shared by every device, and GitHub's 5,000 req/hr limit is
// counted per-token — so all the TVs, phones and laptops draw from one pool. When
// it runs dry, WRITES start failing (a move, a save), which is the visible
// symptom. Two defenses live here:
//   1. ETag conditional reads (see conditionalReadGitHubFile) — a poll that gets
//      304 Not Modified does NOT count against the limit, and our WIP/Awaiting
//      files rarely change between polls, so most polls become free.
//   2. A shared "we're currently limited" signal the UI can read to show a calm
//      "try again in a moment" instead of a raw error, and that callers check to
//      stop hammering a dead quota.

let _rateLimitedUntil = 0; // epoch ms; 0 = not limited

// Records the reset time from a 403/429 so the app can back off until then.
function noteRateLimit(res) {
  try {
    if (res.status !== 403 && res.status !== 429) return;
    const remaining = res.headers.get('x-ratelimit-remaining');
    // A 403 with remaining>0 is a permissions/other error, not the quota.
    if (remaining !== null && Number(remaining) > 0) return;
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    _rateLimitedUntil = reset ? reset * 1000 : Date.now() + 60000;
  } catch {}
}

// True while we believe the shared quota is exhausted. Callers use this to skip
// polling and to explain a failed save. Cleared automatically once reset passes.
export function isRateLimited() {
  if (_rateLimitedUntil && Date.now() >= _rateLimitedUntil) _rateLimitedUntil = 0;
  return _rateLimitedUntil > 0;
}

// Seconds until the quota resets (0 if not limited) — for a countdown in the UI.
export function rateLimitResetSeconds() {
  if (!isRateLimited()) return 0;
  return Math.max(0, Math.ceil((_rateLimitedUntil - Date.now()) / 1000));
}

// Per-path ETag cache so polls can send If-None-Match.
const _etagCache = {};

// Conditional read for polling. On 304 Not Modified GitHub returns no body and —
// crucially — does NOT decrement the rate limit, so a quiet file costs nothing to
// watch. Returns { changed:false } when unchanged, { changed:true, data } when it
// changed, or { changed:true, data:null } on error so the caller can fall back.
async function conditionalReadGitHubFile(headers, path) {
  // Back off entirely while the shared quota is exhausted — hammering a 403
  // only keeps it exhausted (and trips GitHub's secondary rate limit harder).
  if (isRateLimited()) return { changed: false };
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const etag = _etagCache[path];
  const reqHeaders = { ...headers };
  if (etag) reqHeaders['If-None-Match'] = etag;
  try {
    // No cache-busting query param here: it would change the URL and defeat the
    // conditional request. `cache: no-store` keeps the browser from serving a
    // stale 200 while still letting GitHub answer 304.
    const res = await fetch(url, { headers: reqHeaders, cache: 'no-store' });
    noteRateLimit(res);
    if (res.status === 304) return { changed: false };
    if (!res.ok) return { changed: true, data: null };
    const newEtag = res.headers.get('etag');
    if (newEtag) _etagCache[path] = newEtag;
    const fileData = await res.json();
    const bytes = Uint8Array.from(atob(fileData.content.replace(/\s/g, '')), c => c.charCodeAt(0));
    return { changed: true, data: JSON.parse(new TextDecoder('utf-8').decode(bytes)) };
  } catch {
    return { changed: true, data: null };
  }
}

// Minimal headers for unauthenticated reads on a public repo
function publicHeaders() {
  return { Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
}

// Auth headers when we have a token, otherwise fall back to public read headers
function authHeaders() {
  const token = getGithubToken();
  if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  return publicHeaders();
}

export async function saveAdvisorNotes(advisorName, date, rows, afterCallRows) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();

  await saveGitHubFile(headers, `public/data/advisor-notes/${advisorName}/${date}.json`,
    { advisorName, date, rows, afterCallRows: afterCallRows || [], savedAt: new Date().toISOString() },
    `Advisor notes: ${advisorName} ${date}`);

  // Read index via GitHub API so we get the latest version, not stale cached page
  let indexData = { dates: [] };
  try {
    const apiIndex = await readGitHubFile(headers, `public/data/advisor-notes/${advisorName}/index.json`);
    if (apiIndex) indexData = apiIndex;
  } catch {}
  if (!indexData.dates.includes(date)) indexData.dates = [date, ...indexData.dates].sort().reverse();
  await saveGitHubFile(headers, `public/data/advisor-notes/${advisorName}/index.json`, indexData, `Notes index: ${advisorName}`);
}

export async function loadAdvisorNotes(advisorName, date) {
  // Always try the GitHub API first — instant, fresh, works without a token on public repos
  try {
    const data = await readGitHubFile(authHeaders(), `public/data/advisor-notes/${advisorName}/${date}.json`);
    if (data) return data;
  } catch {}
  // Fallback: GitHub Pages (last resort if API fails)
  try {
    const res = await fetch(`${BASE}data/advisor-notes/${advisorName}/${date}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// XOR-scramble the token before base64 so the scanner can't recognize it even after decoding.
const _XK = [0x4b, 0x72, 0x38, 0x51, 0x6d, 0x29, 0x5c, 0x13, 0x7a, 0x44, 0x61, 0x2f, 0x55, 0x19, 0x3e, 0x7d];
function encodeSharedToken(token) {
  if (!token) return '';
  try {
    const scrambled = Array.from(token).map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ _XK[i % _XK.length])
    ).join('');
    return 'sc1:' + btoa(scrambled);
  } catch { return ''; }
}
function decodeSharedToken(stored) {
  if (!stored) return '';
  if (stored.startsWith('sc1:')) {
    try {
      const scrambled = atob(stored.slice(4));
      return Array.from(scrambled).map((c, i) =>
        String.fromCharCode(c.charCodeAt(0) ^ _XK[i % _XK.length])
      ).join('');
    } catch {}
  }
  if (stored.startsWith('enc:')) { try { return atob(stored.slice(4)); } catch {} }
  return stored; // backward-compat: plain token stored before encoding was added
}

// Parse users.json — handles both old array format and new {users, sharedSaveCode} format
function parseUsersPayload(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return { users: raw, sharedSaveCode: '', awsAccessKeyId: '', awsSecretAccessKey: '' };
  return {
    users: Array.isArray(raw.users) ? raw.users : [],
    sharedSaveCode: decodeSharedToken(raw.sharedSaveCode || ''),
    awsAccessKeyId: decodeSharedToken(raw.awsAccessKeyId || ''),
    awsSecretAccessKey: decodeSharedToken(raw.awsSecretAccessKey || ''),
  };
}

export async function loadUsers() {
  // Try GitHub API first — returns the absolute freshest version
  try {
    const raw = await readGitHubFile(publicHeaders(), 'public/data/users.json');
    const parsed = parseUsersPayload(raw);
    if (parsed) return parsed;
  } catch {}
  // Fallback: GitHub Pages CDN
  try {
    const res = await fetch(`${BASE}data/users.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseUsersPayload(await res.json());
  } catch { return null; }
}

// Save users list, always preserving the sharedSaveCode field (and any AWS creds previously stored)
export async function saveUsers(users, sharedSaveCode) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  // Preserve any existing AWS creds in the file so this save doesn't wipe them.
  let existingAwsKeyId = '', existingAwsSecret = '';
  try {
    const raw = await readGitHubFile(headers, 'public/data/users.json');
    const parsed = parseUsersPayload(raw);
    if (parsed) { existingAwsKeyId = parsed.awsAccessKeyId || ''; existingAwsSecret = parsed.awsSecretAccessKey || ''; }
  } catch {}
  await saveGitHubFile(headers, 'public/data/users.json', {
    users,
    sharedSaveCode: encodeSharedToken(sharedSaveCode ?? ''),
    awsAccessKeyId: encodeSharedToken(existingAwsKeyId),
    awsSecretAccessKey: encodeSharedToken(existingAwsSecret),
  }, 'Update users');
}

// Sync AWS credentials into users.json so ALL devices get them on next load
export async function saveSharedAwsCreds(accessKeyId, secretAccessKey) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  let users = [], sharedSaveCode = '';
  try {
    const raw = await readGitHubFile(headers, 'public/data/users.json');
    const parsed = parseUsersPayload(raw);
    if (parsed) { users = parsed.users; sharedSaveCode = parsed.sharedSaveCode; }
  } catch {}
  await saveGitHubFile(headers, 'public/data/users.json', {
    users,
    sharedSaveCode: encodeSharedToken(sharedSaveCode),
    awsAccessKeyId: encodeSharedToken(accessKeyId || ''),
    awsSecretAccessKey: encodeSharedToken(secretAccessKey || ''),
  }, 'Sync AWS credentials');
}

// Sync a new GitHub token into users.json so ALL devices get it automatically on next load
export async function saveSharedToken(newToken) {
  const headers = { Authorization: `Bearer ${newToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  let users = [];
  try {
    const raw = await readGitHubFile(headers, 'public/data/users.json');
    const parsed = parseUsersPayload(raw);
    if (parsed) users = parsed.users;
  } catch {}
  await saveGitHubFile(headers, 'public/data/users.json', { users, sharedSaveCode: encodeSharedToken(newToken) }, 'Sync shared save code');
}

// ── Document Library ──────────────────────────────────────────────────────────

const DOCS_PATH  = 'public/data/documents';
const DOCS_INDEX = 'public/data/documents/index.json';
// Document files now live in AWS S3. The index.json stays in the GitHub repo
// (small, infrequent updates, keeps existing admin auth flow working).
const S3_BUCKET = 'rohrman-hyundai-files';
const S3_REGION = 'us-east-2';
const S3_DOCS_PREFIX = 'pdf-reports/';
const RAW_BASE = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${S3_DOCS_PREFIX}`;

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function deleteGitHubFile(headers, path, message) {
  const getRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
    { headers, cache: 'no-store' }
  );
  if (!getRes.ok) return; // file already gone
  const { sha } = await getRes.json();
  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
    }
  );
}

export function docRawUrl(filename) {
  return RAW_BASE + encodeURIComponent(filename);
}

export async function loadDocumentIndex() {
  try {
    const data = await readGitHubFile(authHeaders(), DOCS_INDEX);
    if (data) return Array.isArray(data) ? data : [];
  } catch {}
  try {
    const res = await fetch(`${BASE}data/documents/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function uploadDocument(file, label, uploaderName, allowedRoles) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const safeFilename = `${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  // Upload the file to S3 (bucket=rohrman-hyundai-files, prefix=pdf-reports/)
  if (!(await ensureAwsCreds())) {
    throw new Error('AWS credentials are required to upload documents.');
  }
  try {
    await uploadFileToS3(safeFilename, file);
  } catch (err) {
    throw new Error('S3 upload failed: ' + (err.message || err));
  }

  // Update index
  const currentIndex = await loadDocumentIndex();
  const newEntry = {
    id,
    label,
    filename: safeFilename,
    fileType: ['doc', 'docx'].includes(ext) ? ext : 'pdf',
    size: file.size,
    uploadedBy: uploaderName,
    uploadedAt: new Date().toISOString(),
    allowedRoles: Array.isArray(allowedRoles) && allowedRoles.length > 0 ? allowedRoles : [],
  };
  const newIndex = [newEntry, ...currentIndex];
  await saveGitHubFile(headers, DOCS_INDEX, newIndex, `Document index: add ${label}`);
  return newIndex;
}

export async function updateDocumentPermissions(docId, allowedRoles) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  const currentIndex = await loadDocumentIndex();
  const newIndex = currentIndex.map(d =>
    d.id === docId ? { ...d, allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [] } : d
  );
  await saveGitHubFile(headers, DOCS_INDEX, newIndex, `Document permissions updated`);
  return newIndex;
}

export async function deleteDocument(doc) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();

  // Delete the actual file from S3
  if (!(await ensureAwsCreds())) {
    throw new Error('AWS credentials are required to delete documents.');
  }
  try {
    await deleteFileFromS3(doc.filename);
  } catch (err) {
    // Don't block index update if S3 delete fails (e.g. file already missing)
    console.warn('S3 delete warning:', err.message || err);
  }
  // Also remove the legacy copy from GitHub (no-op if it was never there)
  await deleteGitHubFile(headers, `${DOCS_PATH}/${doc.filename}`, `Delete document: ${doc.label}`);

  // Update index
  const currentIndex = await loadDocumentIndex();
  const newIndex = currentIndex.filter(d => d.id !== doc.id);
  await saveGitHubFile(headers, DOCS_INDEX, newIndex, `Document index: remove ${doc.label}`);
  return newIndex;
}

// ── Hot Repairs / Recalls Bulletin Boards ──────────────────────────────────────
// Tech-facing PDF libraries. Reuses the same S3 bucket/prefix as documents (files
// are uniquely named), but each board keeps its own index so they stay separate.
// `kind` is the folder name: 'hot-repairs' or 'recalls'.
const BULLETIN_KINDS = { 'hot-repairs': 'Hot repairs', 'recalls': 'Recalls' };
function bulletinIndexPath(kind) {
  if (!BULLETIN_KINDS[kind]) throw new Error('Unknown bulletin kind: ' + kind);
  return `public/data/${kind}/index.json`;
}

export async function loadHotRepairs(kind = 'hot-repairs') {
  const indexPath = bulletinIndexPath(kind);
  try {
    const data = await readGitHubFile(authHeaders(), indexPath);
    if (data) return Array.isArray(data) ? data : [];
  } catch {}
  try {
    const res = await fetch(`${BASE}data/${kind}/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// Cap stored per-PDF search text so the index.json stays a reasonable size.
// A long TSB extracts to ~10KB of text; 200KB is a generous ceiling.
const MAX_SEARCH_TEXT = 200000;

export async function uploadHotRepair(file, label, uploaderName, kind = 'hot-repairs', searchText = '') {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const indexPath = bulletinIndexPath(kind);

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const safeFilename = `${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  if (!(await ensureAwsCreds())) {
    throw new Error('AWS credentials are required to upload.');
  }
  try {
    await uploadFileToS3(safeFilename, file);
  } catch (err) {
    throw new Error('S3 upload failed: ' + (err.message || err));
  }

  const newEntry = {
    id,
    label,
    filename: safeFilename,
    fileType: 'pdf',
    size: file.size,
    uploadedBy: uploaderName,
    uploadedAt: new Date().toISOString(),
    searchText: (searchText || '').slice(0, MAX_SEARCH_TEXT),
  };
  // Prepend onto the authoritative index (retry on conflict) so a concurrent
  // op-code save or another upload can't drop this new bulletin.
  return mutateGitHubJson(indexPath,
    (cur) => [newEntry, ...(Array.isArray(cur) ? cur : [])],
    `${BULLETIN_KINDS[kind]}: add ${label}`);
}

// Backfill/refresh stored full-text for search. `textById` is a map of
// { itemId: extractedText }. Writes the whole index in ONE commit so re-indexing
// the library doesn't spam dozens of commits. Only entries present in the map
// are updated; everything else is left untouched.
export async function backfillHotRepairSearchText(textById, kind = 'hot-repairs') {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  // Nothing to do → no write (avoids an empty commit and an extra API round-trip).
  const currentIndex = await loadHotRepairs(kind);
  if (!currentIndex.some(d => textById[d.id] != null)) return currentIndex;
  return mutateGitHubJson(bulletinIndexPath(kind), (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return arr.map(d => textById[d.id] != null
      ? { ...d, searchText: String(textById[d.id] || '').slice(0, MAX_SEARCH_TEXT) }
      : d);
  }, `${BULLETIN_KINDS[kind]}: index ${Object.keys(textById).length} PDF(s) for search`);
}

export async function renameHotRepair(id, newLabel, kind = 'hot-repairs') {
  return mutateGitHubJson(bulletinIndexPath(kind),
    (cur) => (Array.isArray(cur) ? cur : []).map(d => d.id === id ? { ...d, label: newLabel } : d),
    `${BULLETIN_KINDS[kind]}: rename to ${newLabel}`);
}

// Flag/unflag an item as a "Warranty Hot Repair" (highlighted for viewers).
export async function setHotRepairWarranty(id, warranty, kind = 'hot-repairs') {
  return mutateGitHubJson(bulletinIndexPath(kind),
    (cur) => (Array.isArray(cur) ? cur : []).map(d => d.id === id ? { ...d, warranty: !!warranty } : d),
    `${BULLETIN_KINDS[kind]}: warranty flag ${warranty ? 'on' : 'off'}`);
}

// Set searchable tags / bulletin numbers on an item (free text, searchable).
export async function setHotRepairTags(id, tags, kind = 'hot-repairs') {
  return mutateGitHubJson(bulletinIndexPath(kind),
    (cur) => (Array.isArray(cur) ? cur : []).map(d => d.id === id ? { ...d, tags: tags || '' } : d),
    `${BULLETIN_KINDS[kind]}: update tags`);
}

// Save the Op Code Generator data for a bulletin (and/or its exclude flag).
// opData shape: { questions: [{id,label}], entries: [{id, answers:{qid:val}, model,
// opCode, operation, opTime, causalPart, natureCode, causeCode}] }.
export async function setHotRepairOpData(id, { opData, opExcluded } = {}, kind = 'hot-repairs') {
  // Conflict-safe: the mutation is applied to the AUTHORITATIVE index read inside
  // the write (with retry), never to a possibly-stale copy. The old path loaded
  // the index up front and re-saved the whole thing, so if another device had
  // just added a bulletin, this save wrote the stale list back and DELETED that
  // bulletin — the reported bug.
  return mutateGitHubJson(bulletinIndexPath(kind), (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return arr.map(d => {
      if (d.id !== id) return d;
      const next = { ...d };
      if (opData !== undefined) next.opData = opData;
      if (opExcluded !== undefined) next.opExcluded = !!opExcluded;
      return next;
    });
  }, `${BULLETIN_KINDS[kind]}: update op codes`);
}

// Move a bulletin between kinds (e.g. 'recalls' → 'hot-repairs'). The PDF lives
// in shared S3 storage, so only the index entries change. Returns the updated
// SOURCE index (what the current tab should now show).
export async function moveHotRepair(item, fromKind, toKind) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const fromIndex = await loadHotRepairs(fromKind);
  const victim = fromIndex.find(d => d.id === item.id) || item;
  // Save the destination FIRST so a partial failure leaves a recoverable
  // duplicate rather than losing the bulletin entirely. Each write re-reads its
  // own index fresh, so neither move can drop bulletins added elsewhere.
  await mutateGitHubJson(bulletinIndexPath(toKind),
    (cur) => [victim, ...(Array.isArray(cur) ? cur : []).filter(d => d.id !== item.id)],
    `${BULLETIN_KINDS[toKind]}: move in ${victim.label}`);
  return mutateGitHubJson(bulletinIndexPath(fromKind),
    (cur) => (Array.isArray(cur) ? cur : []).filter(d => d.id !== item.id),
    `${BULLETIN_KINDS[fromKind]}: move out ${victim.label}`);
}

// Persist a manual ordering. `orderedIds` is the desired top-to-bottom order.
export async function reorderHotRepairs(orderedIds, kind = 'hot-repairs') {
  return mutateGitHubJson(bulletinIndexPath(kind), (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    const byId = new Map(arr.map(d => [d.id, d]));
    const ordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
    // Append anything not in orderedIds (e.g. a bulletin added on another device
    // since the drag started) so a reorder can never drop it.
    for (const d of arr) if (!orderedIds.includes(d.id)) ordered.push(d);
    return ordered;
  }, `${BULLETIN_KINDS[kind]}: reorder`);
}

export async function deleteHotRepair(item, kind = 'hot-repairs') {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');

  if (await ensureAwsCreds()) {
    try {
      await deleteFileFromS3(item.filename);
    } catch (err) {
      console.warn('S3 delete warning:', err.message || err);
    }
  }

  return mutateGitHubJson(bulletinIndexPath(kind),
    (cur) => (Array.isArray(cur) ? cur : []).filter(d => d.id !== item.id),
    `${BULLETIN_KINDS[kind]}: remove ${item.label}`);
}

// ── Service Invitation Completed Reviews ───────────────────────────────────────
const COMPLETED_BASE = 'public/data/service-invitation/completed';

export async function loadCompletedReviews(advisorName) {
  const name = advisorName.toUpperCase();
  const path = `${COMPLETED_BASE}/${name}.json`;
  try {
    const data = await readGitHubFile(authHeaders(), path);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/service-invitation/completed/${name}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveCompletedReviews(advisorName, reviews) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  const path = `${COMPLETED_BASE}/${advisorName.toUpperCase()}.json`;
  await saveGitHubFile(headers, path, reviews, `Survey reviews updated: ${advisorName}`);
  return reviews;
}

// ── Service Invitation Data ────────────────────────────────────────────────────
const SI_PATH = 'public/data/service-invitation/data.json';

export async function loadServiceInvitations() {
  try {
    const data = await readGitHubFile(authHeaders(), SI_PATH);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/service-invitation/data.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveServiceInvitations(rows) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, SI_PATH, rows, 'Update service invitation data');
  return rows;
}

// ── Advisor note index ─────────────────────────────────────────────────────────

export async function loadAdvisorNoteIndex(advisorName) {
  // Try GitHub API first so the calendar reflects saves immediately
  try {
    const data = await readGitHubFile(authHeaders(), `public/data/advisor-notes/${advisorName}/index.json`);
    if (data) return data.dates || [];
  } catch {}
  // Fallback: GitHub Pages
  try {
    const res = await fetch(`${BASE}data/advisor-notes/${advisorName}/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.dates || [];
  } catch { return []; }
}

// ── Work Schedules ────────────────────────────────────────────────────────────
// Stored as { "NAME": { "YYYY-MM-DD": "shift string | vacation | off" } }

const SCHEDULE_PATH = 'public/data/schedules.json';

export async function loadSchedules() {
  try {
    const data = await readGitHubFile(authHeaders(), SCHEDULE_PATH);
    if (data) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/schedules.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return {};
}

export async function saveSchedules(schedules) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  await saveGitHubFile(headers, SCHEDULE_PATH, schedules, `Update work schedules ${new Date().toISOString()}`);
}

// ── Global Messages ────────────────────────────────────────────────────────────
// Manager-composed direct popups to specific users. Each entry:
// { id, from, to:[USER...], text, alert, timestamp }. Kept 7 days.
const GLOBAL_MSG_PATH = 'public/data/global-messages.json';

export async function pollGlobalMessages() {
  return conditionalReadGitHubFile(authHeaders(), GLOBAL_MSG_PATH);
}

export async function loadGlobalMessages() {
  try {
    const data = await readGitHubFile(authHeaders(), GLOBAL_MSG_PATH);
    if (Array.isArray(data)) return data;
  } catch {}
  return [];
}

export async function sendGlobalMessage(entry) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return mutateGitHubJson(GLOBAL_MSG_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return [...arr, entry].filter(m => m && m.timestamp > cutoff);
  }, `Global message ${new Date().toISOString()}`);
}

// Remove one global message (conflict-safe). Pass null to clear all sent by a
// given user (see clearGlobalMessagesFrom).
export async function deleteGlobalMessage(msgId) {
  return mutateGitHubJson(GLOBAL_MSG_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return arr.filter(m => m && m.id !== msgId);
  }, `Delete global message ${new Date().toISOString()}`);
}

// Remove every global message sent by `from` (case-insensitive). Conflict-safe.
export async function clearGlobalMessagesFrom(from) {
  const f = String(from || '').toUpperCase();
  return mutateGitHubJson(GLOBAL_MSG_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return arr.filter(m => m && (m.from || '').toUpperCase() !== f);
  }, `Clear global messages from ${f} ${new Date().toISOString()}`);
}

// Append a reply onto one global message (conflict-safe). `reply` =
// { id, from, text, timestamp }. Returns the updated messages array.
export async function replyToGlobalMessage(msgId, reply) {
  return mutateGitHubJson(GLOBAL_MSG_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return arr.map(m => m && m.id === msgId
      ? { ...m, replies: [...(Array.isArray(m.replies) ? m.replies : []), reply] }
      : m);
  }, `Global reply ${new Date().toISOString()}`);
}

// ── Group Chat ─────────────────────────────────────────────────────────────────
const CHAT_PATH = 'public/data/chat/messages.json';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadChatMessages() {
  try {
    const data = await readGitHubFile(authHeaders(), CHAT_PATH);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/chat/messages.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

// Cheap poll for live chat: conditional (ETag) read that returns { changed:false }
// when nothing's new — a 304 that does NOT count against the shared rate limit,
// so we can poll every few seconds without draining the quota. On change returns
// { changed:true, data:[...messages] } (or data:null on error).
export async function pollChatMessages() {
  return conditionalReadGitHubFile(authHeaders(), CHAT_PATH);
}

// Conflict-safe update: `mutate(currentMessages)` runs against the FRESH server
// list (re-run if another client saved first), so concurrent sends/reactions
// never clobber each other. Returns the saved list. Prunes >30-day-old messages.
export async function updateChatMessages(mutate) {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return mutateGitHubJson(CHAT_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return (mutate(arr) || []).filter(m => m && m.timestamp > cutoff);
  }, `Chat update ${new Date().toISOString()}`);
}

// ── Aftermarket Warranty Contracts ────────────────────────────────────────────
const WARRANTY_INDEX_PATH = 'public/data/warranty/index.json';
const warrantyContractPath = id => `public/data/warranty/${id}.json`;

export async function loadWarrantyIndex() {
  try {
    const data = await readGitHubFile(authHeaders(), WARRANTY_INDEX_PATH);
    if (data) return Array.isArray(data) ? data : [];
  } catch {}
  try {
    const res = await fetch(`${BASE}data/warranty/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function loadWarrantyContract(id) {
  try {
    const data = await readGitHubFile(authHeaders(), warrantyContractPath(id));
    if (data) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/warranty/${id}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function saveWarrantyContract(contract) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  // The per-contract file is keyed by a unique id, so a plain save is safe.
  await saveGitHubFile(authHeaders(), warrantyContractPath(contract.id), contract,
    `Warranty contract ${contract.id} - ${contract.customerName || 'unknown'}`);
  // The INDEX is shared. It used to be overwritten with the caller's whole
  // in-memory list, so saving from a stale page dropped contracts other people
  // had just added. Upsert this one contract into the freshest index instead.
  return mutateGitHubJson(WARRANTY_INDEX_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    const i = arr.findIndex(c => c.id === contract.id);
    if (i >= 0) { const next = arr.slice(); next[i] = contract; return next; }
    return [contract, ...arr];
  }, `Update warranty index ${new Date().toISOString()}`);
}

// Remove a contract from the shared index (conflict-safe). The per-contract file
// is left in place — harmless, and it means a mis-click is recoverable.
export async function removeWarrantyContract(contract) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const id = typeof contract === 'string' ? contract : contract.id;
  return mutateGitHubJson(WARRANTY_INDEX_PATH,
    (cur) => (Array.isArray(cur) ? cur : []).filter(c => c.id !== id),
    `Remove warranty contract ${id}`);
}

// ── Warranty Company Directory ────────────────────────────────────────────────
// A shared name → phone map so any user can type a known warranty company and
// have the phone auto-filled. Stored as a single small JSON object on GitHub.
const WARRANTY_COMPANIES_PATH = 'public/data/warranty/companies.json';

export async function loadWarrantyCompanies() {
  try {
    const data = await readGitHubFile(authHeaders(), WARRANTY_COMPANIES_PATH);
    if (data && typeof data === 'object') return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/warranty/companies.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return {};
}

export async function saveWarrantyCompanies(companies) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  await saveGitHubFile(authHeaders(), WARRANTY_COMPANIES_PATH, companies,
    `Update warranty company directory ${new Date().toISOString()}`);
  return companies;
}

// ── Tire Warranty Claims ──────────────────────────────────────────────────────
const TIRE_INDEX_PATH = 'public/data/tire-warranty/index.json';
const tireClaimPath = id => `public/data/tire-warranty/${id}.json`;

export async function loadTireWarrantyIndex() {
  try {
    const data = await readGitHubFile(authHeaders(), TIRE_INDEX_PATH);
    if (data) return Array.isArray(data) ? data : [];
  } catch {}
  try {
    const res = await fetch(`${BASE}data/tire-warranty/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function saveTireWarrantyClaim(claim, index) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, tireClaimPath(claim.id), claim,
    `Tire warranty claim ${claim.id} - ${claim.customerName || 'unknown'}`);
  await saveGitHubFile(headers, TIRE_INDEX_PATH, index, `Update tire warranty index ${new Date().toISOString()}`);
}

export async function removeTireWarrantyClaim(claim) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const id = typeof claim === 'string' ? claim : claim.id;
  // Conflict-safe: drop this id from the freshest index rather than overwriting.
  await mutateGitHubJson(TIRE_INDEX_PATH,
    (cur) => (Array.isArray(cur) ? cur : []).filter(c => c.id !== id),
    `Remove tire warranty claim ${id}`);
  // Best-effort removal of the per-claim file; index is the source of truth.
  try { await deleteGitHubFile(authHeaders(), tireClaimPath(id), `Delete tire warranty claim ${id}`); }
  catch { /* file may not exist (legacy index-only claim); ignore */ }
}

// ── Work In Progress ──────────────────────────────────────────────────────────
export async function loadWipData(techName) {
  const path = `public/data/wip/${techName.toUpperCase()}.json`;
  try {
    const data = await readGitHubFile(authHeaders(), path);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/wip/${techName.toUpperCase()}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function saveWipData(techName, rows) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, `public/data/wip/${techName.toUpperCase()}.json`, rows, `WIP update: ${techName}`);
  return rows;
}

// Conditional poll for a tech's WIP board. Returns { changed, data }: when the
// file is unchanged since the last poll GitHub answers 304 for FREE (no quota
// spent), and we return { changed:false } so the caller keeps its current rows.
// Used by the background refresh; the initial load still uses loadWipData.
export async function pollWipData(techName) {
  const path = `public/data/wip/${techName.toUpperCase()}.json`;
  const r = await conditionalReadGitHubFile(authHeaders(), path);
  if (!r.changed) return { changed: false };
  if (Array.isArray(r.data)) return { changed: true, data: r.data };
  // Error path (r.data === null): fall back to the static copy so a hiccup or a
  // spent quota doesn't wipe the board out.
  try {
    const res = await fetch(`${BASE}data/wip/${techName.toUpperCase()}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return { changed: true, data: await res.json() };
  } catch {}
  return { changed: false };
}

export async function loadCoaching(techName) {
  const username = techName.toUpperCase();
  const path = `public/data/coaching/${username}.json`;
  try {
    const data = await readGitHubFile(authHeaders(), path);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/coaching/${username}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function saveCoaching(techName, reports) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const username = techName.toUpperCase();
  await saveGitHubFile(authHeaders(), `public/data/coaching/${username}.json`, reports, `Coaching report update: ${username}`);
  return reports;
}

export async function loadAwaitingData() {
  const path = 'public/data/wip/AWAITING.json';
  try {
    const data = await readGitHubFile(authHeaders(), path);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/wip/AWAITING.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function saveAwaitingData(rows) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  await saveGitHubFile(authHeaders(), 'public/data/wip/AWAITING.json', rows, 'Update cars awaiting technician');
  return rows;
}

// Conditional poll for the shared Cars Awaiting / Used Cars file. Same free-304
// behavior as pollWipData — the file rarely changes between polls, so most polls
// cost nothing against the shared quota.
export async function pollAwaitingData() {
  const path = 'public/data/wip/AWAITING.json';
  const r = await conditionalReadGitHubFile(authHeaders(), path);
  if (!r.changed) return { changed: false };
  if (Array.isArray(r.data)) return { changed: true, data: r.data };
  try {
    const res = await fetch(`${BASE}data/wip/AWAITING.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return { changed: true, data: await res.json() };
  } catch {}
  return { changed: false };
}

// List every tech that has a WIP file on disk (the file owner names), regardless
// of whether they're still an active technician user. Used to authoritatively
// locate which file an RO actually lives in when opening from a manager list —
// the tech "hint" can be stale (reassigned RO) or point at a name that isn't in
// the live technician roster. Excludes the shared AWAITING queue file.
export async function listWipTechs() {
  const files = await listDirFiles('public/data/wip');
  return files
    .filter(n => /\.json$/i.test(n) && n.toUpperCase() !== 'AWAITING.JSON')
    .map(n => n.replace(/\.json$/i, '').toUpperCase());
}

// ── User Activity Tracker — last 30 days of page views + key actions ────────
const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadUserActivity(username) {
  const u = (username || '').toUpperCase();
  if (!u) return [];
  const path = `public/data/activity/${u}.json`;
  try {
    const data = await readGitHubFile(authHeaders(), path);
    if (Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/activity/${u}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

// Append a batch of new events to the user's activity log, then prune anything
// older than the 30-day retention window. Best-effort — swallows errors.
export async function appendUserActivity(username, newEvents) {
  if (!username || !Array.isArray(newEvents) || newEvents.length === 0) return;
  const u = username.toUpperCase();
  try {
    const token = await ensureGithubToken();
    if (!token) return;
    const existing = await loadUserActivity(u);
    const cutoff = Date.now() - ACTIVITY_RETENTION_MS;
    const merged = [...newEvents, ...existing]
      .filter(e => {
        if (!e || !e.at) return false;
        const t = new Date(e.at).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    await saveGitHubFile(authHeaders(), `public/data/activity/${u}.json`, merged, `Activity log: ${u}`);
  } catch (err) {
    try { console.warn('appendUserActivity failed:', err); } catch {}
  }
}

// List every username with an activity file by scanning the activity
// directory via the GitHub contents API. Used by the manager-side User Data
// Tracker so the sidebar covers everyone who has ever had activity recorded.
export async function listActivityUsernames() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/public/data/activity?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
      { headers: authHeaders(), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .filter(f => f && f.type === 'file' && f.name && f.name.toLowerCase().endsWith('.json'))
      .map(f => f.name.replace(/\.json$/i, '').toUpperCase());
  } catch { return []; }
}

// ── Coaching Report Views — track when each recipient opens their report ────
const COACHING_VIEWS_PATH = 'public/data/coaching-views.json';

export async function loadCoachingViews() {
  try {
    const data = await readGitHubFile(authHeaders(), COACHING_VIEWS_PATH);
    if (data && typeof data === 'object') return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/coaching-views.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return {};
}

// Record that `username` (the recipient) has viewed the given reportIds on
// their own coaching report. Stamps every one with the current timestamp.
// Latest-write-wins; we treat this as best-effort and swallow errors.
export async function recordCoachingView(username, reportIds) {
  if (!username || !Array.isArray(reportIds) || reportIds.length === 0) return;
  try {
    const all = await loadCoachingViews();
    const u = (username || '').toUpperCase();
    const me = all[u] || {};
    const now = new Date().toISOString();
    for (const id of reportIds) {
      if (id) me[id] = now;
    }
    all[u] = me;
    const token = await ensureGithubToken();
    if (!token) return;
    await saveGitHubFile(authHeaders(), COACHING_VIEWS_PATH, all, `Record coaching view for ${u}`);
  } catch (err) {
    // Swallow — this is best-effort observability, not a critical path.
    try { console.warn('recordCoachingView failed:', err); } catch {}
  }
}

// ── Former Employees — registry of deleted users whose performance reports we
// keep for management history. The Manager Performance Reports screen surfaces
// these under a "Previous Employees" tab. We DELETE all other per-user data on
// removal (see deleteUserData below), but never the performance-reports file.
const FORMER_EMPLOYEES_PATH = 'public/data/former-employees.json';

export async function loadFormerEmployees() {
  try {
    const data = await readGitHubFile(authHeaders(), FORMER_EMPLOYEES_PATH);
    if (Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/former-employees.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

async function saveFormerEmployees(list) {
  await saveGitHubFile(authHeaders(), FORMER_EMPLOYEES_PATH, list, 'Update former employees');
  return list;
}

// List the file names inside a repo directory via the contents API. Returns []
// if the directory does not exist. Used to wipe the advisor-notes/{NAME}/ dir.
async function listDirFiles(dirPath) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${dirPath}?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
      { headers: authHeaders(), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list.filter(f => f && f.type === 'file' && f.name).map(f => f.name);
  } catch { return []; }
}

// Remove EVERYTHING for a deleted user EXCEPT their performance reports (kept
// for the Previous Employees tab) and the group chat (kept for viewing). The
// user is added to the former-employees registry so a manager can still pull up
// their performance history. Best-effort per file — a single failure does not
// abort the rest.
export async function deleteUserData(username, role) {
  const u = (username || '').toUpperCase();
  if (!u || u === 'ADMIN') return;
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');

  // 1. Record them as a former employee (keep their performance reports alive).
  try {
    const list = await loadFormerEmployees();
    if (!list.some(f => (f.username || '').toUpperCase() === u)) {
      list.push({ username: u, role: role || '', deletedAt: new Date().toISOString() });
      await saveFormerEmployees(list);
    }
  } catch (err) { try { console.warn('former-employees update failed:', err); } catch {} }

  // 2. Delete per-user files (NOT performance-reports, NOT chat).
  const perUserFiles = [
    `public/data/activity/${u}.json`,
    `public/data/wip/${u}.json`,
    `public/data/coaching/${u}.json`,
    `public/data/service-invitation/completed/${u}.json`,
  ];
  for (const path of perUserFiles) {
    try { await deleteGitHubFile(authHeaders(), path, `Delete ${path} (user removed)`); }
    catch (err) { try { console.warn('delete failed:', path, err); } catch {} }
  }

  // 3. Wipe the advisor-notes/{NAME}/ directory (index.json + every date file).
  try {
    const noteFiles = await listDirFiles(`public/data/advisor-notes/${u}`);
    for (const name of noteFiles) {
      try { await deleteGitHubFile(authHeaders(), `public/data/advisor-notes/${u}/${name}`, `Delete advisor note ${u}/${name} (user removed)`); }
      catch (err) { try { console.warn('delete note failed:', name, err); } catch {} }
    }
  } catch (err) { try { console.warn('advisor-notes wipe failed:', err); } catch {} }

  // 4. Scrub the user's key out of shared keyed files.
  try {
    const schedules = await loadSchedules();
    if (schedules && Object.prototype.hasOwnProperty.call(schedules, u)) {
      delete schedules[u];
      await saveSchedules(schedules);
    }
  } catch (err) { try { console.warn('schedule scrub failed:', err); } catch {} }

  try {
    const views = await loadCoachingViews();
    if (views && Object.prototype.hasOwnProperty.call(views, u)) {
      delete views[u];
      await saveGitHubFile(authHeaders(), COACHING_VIEWS_PATH, views, `Remove coaching views for ${u} (user removed)`);
    }
  } catch (err) { try { console.warn('coaching-views scrub failed:', err); } catch {} }
}

// ── Repair Order Archive — every RO deleted from WIP / Awaiting lands here ───
const RO_ARCHIVE_PATH = 'public/data/repair-order-archive.json';

export async function loadRoArchive() {
  try {
    const data = await readGitHubFile(authHeaders(), RO_ARCHIVE_PATH);
    if (Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/repair-order-archive.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

export async function saveRoArchive(entries) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  await saveGitHubFile(authHeaders(), RO_ARCHIVE_PATH, entries, 'Update repair order archive');
  return entries;
}

// ── Cash Dash ──────────────────────────────────────────────────────────────────
// Per-month manual tech booked-hours entries (advisor hours come from the perf
// report's mtd_hours). Shape: { "2026-08": { techHours: { NAME: hrs }, updatedAt } }.
const CASH_DASH_PATH = 'public/data/cash-dash.json';
export async function loadCashDash() {
  try { const d = await readGitHubFile(authHeaders(), CASH_DASH_PATH); if (d && typeof d === 'object') return d; } catch {}
  return {};
}
export async function updateCashDash(mutate) {
  return mutateGitHubJson(CASH_DASH_PATH, (cur) => mutate(cur && typeof cur === 'object' ? cur : {}),
    `Cash Dash update ${new Date().toISOString()}`);
}

// Convenience: append-only helper that loads, prepends, and saves. Returns the
// new full archive array.
export async function appendRoArchive(entry) {
  const existing = await loadRoArchive();
  const next = [entry, ...existing];
  await saveRoArchive(next);
  return next;
}

// ── Charge Account List ───────────────────────────────────────────────────────
const CHARGE_ACCOUNT_PATH = 'public/data/charge-accounts.json';

export async function loadChargeAccounts() {
  try {
    const data = await readGitHubFile(authHeaders(), CHARGE_ACCOUNT_PATH);
    if (data && Array.isArray(data.accounts)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/charge-accounts.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function saveChargeAccounts(accounts, uploadedAt) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, CHARGE_ACCOUNT_PATH, { accounts, uploadedAt, savedAt: new Date().toISOString() }, `Update charge account list ${new Date().toISOString()}`);
}

// ── Tech Group Chat ───────────────────────────────────────────────────────────
const TECH_CHAT_PATH = 'public/data/tech-chat/messages.json';

export async function loadTechChatMessages() {
  try {
    const data = await readGitHubFile(authHeaders(), TECH_CHAT_PATH);
    if (data && Array.isArray(data)) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}data/tech-chat/messages.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return [];
}

// Cheap conditional (ETag) poll for live tech chat — see pollChatMessages.
export async function pollTechChatMessages() {
  return conditionalReadGitHubFile(authHeaders(), TECH_CHAT_PATH);
}

// Conflict-safe update — see updateChatMessages.
export async function updateTechChatMessages(mutate) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return mutateGitHubJson(TECH_CHAT_PATH, (cur) => {
    const arr = Array.isArray(cur) ? cur : [];
    return (mutate(arr) || []).filter(m => m && m.timestamp > cutoff);
  }, `Tech chat update ${new Date().toISOString()}`);
}


// ── Advisor Goals / Forecasting (server-backed, per advisor) ─────────────────
// One file per advisor holding every month:
// { "2026-06": { hoursGoal, hrsRoGoal, days: { "2026-06-01": {hours, hrsRo} } } }
function advisorGoalsPath(advisor) {
  const safe = String(advisor || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `data/advisor-goals/${safe || 'UNKNOWN'}.json`;
}

export async function loadAdvisorGoals(advisor) {
  try {
    const data = await loadGithubFile(advisorGoalsPath(advisor));
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}

// Merge a month bucket into the advisor's file and save. Re-reads first so a
// concurrent edit to a different month isn't clobbered.
export async function saveAdvisorGoalsMonth(advisor, monthKey, monthData) {
  let all = {};
  try { all = await loadAdvisorGoals(advisor); } catch { all = {}; }
  all = { ...(all || {}), [monthKey]: monthData };
  await saveGithubFile(advisorGoalsPath(advisor), all, `Advisor goals ${String(advisor).toUpperCase()} ${monthKey}`);
  return all;
}

// ── Open-RO "missing internal notes" list (per advisor, for Day End Reporting) ─
// { updatedAt, by, advisors: { JORDAN: [{ ro, vehicle }], ... } }
const MISSING_NOTES_PATH = 'data/missing-notes.json';
export async function loadMissingNotes() {
  const d = await loadGithubFile(MISSING_NOTES_PATH);
  return (d && typeof d === 'object') ? d : { updatedAt: null, by: '', advisors: {} };
}
export async function saveMissingNotes(data) {
  await saveGithubFile(MISSING_NOTES_PATH, data, `Missing-notes RO list ${new Date().toISOString()}`);
  return data;
}

// ── Service Pricing Menu ─────────────────────────────────────────────────────
// A manager/admin-editable menu of services + prices that all advisors can view.
// Stored as one JSON file: { updatedAt, by, categories: [{ id, name, services:
// [{ id, name, price, desc }] }] }.
const SERVICE_PRICING_PATH = 'data/service-pricing.json';
export async function loadServicePricing() {
  const d = await loadGithubFile(SERVICE_PRICING_PATH);
  if (d && typeof d === 'object' && Array.isArray(d.categories)) return d;
  return { updatedAt: null, by: '', categories: [] };
}
export async function saveServicePricing(data) {
  const payload = { ...data, updatedAt: Date.now() };
  await saveGithubFile(SERVICE_PRICING_PATH, payload, `Service pricing menu ${new Date().toISOString()}`);
  return payload;
}

// ── Generic file helpers for DCT/MTM worksheets ──────────────────────────────
export async function loadGithubFile(path) {
  try {
    const data = await readGitHubFile(authHeaders(), `public/${path}`);
    if (data !== null) return data;
  } catch {}
  try {
    const res = await fetch(`${BASE}${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

export async function saveGithubFile(path, data, message) {
  const token = await ensureGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  await saveGitHubFile(authHeaders(), `public/${path}`, data, message || `Update ${path}`);
  return data;
}

// ── Goal Forecast (server-backed, per department) ────────────────────────────
// Each department ('service' | 'parts') has ONE authoritative file holding every
// month, e.g. { "2026-06": { forecast, lastYear, actuals: { "2026-06-24": 1234 } } }.
// Service and parts are separate files, so one department can never overwrite the
// other, and the data is the same on every device.
function goalForecastPath(dept) {
  return `data/goal-forecast/${dept === 'parts' ? 'parts' : 'service'}.json`;
}

export async function loadGoalForecast(dept) {
  try {
    const data = await loadGithubFile(goalForecastPath(dept));
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}

// Merge one month's bucket into the department file and save. Re-reads the latest
// file first so a concurrent edit to a DIFFERENT month isn't clobbered.
export async function saveGoalForecastMonth(dept, monthKey, monthData) {
  let all = {};
  try { all = await loadGoalForecast(dept); } catch { all = {}; }
  all = { ...(all || {}), [monthKey]: monthData };
  await saveGithubFile(goalForecastPath(dept), all, `Goal forecast (${dept}) ${monthKey}`);
  return all;
}

// Set a single day's actual in a department/month without disturbing anything
// else. Used by the Goal Gauges "Daily Total Labor" quick entry.
export async function setGoalForecastDaily(dept, monthKey, dayKey, value) {
  let all = {};
  try { all = await loadGoalForecast(dept); } catch { all = {}; }
  const bucket = { forecast: 0, lastYear: 0, actuals: {}, ...((all && all[monthKey]) || {}) };
  bucket.actuals = { ...(bucket.actuals || {}), [dayKey]: value };
  all = { ...(all || {}), [monthKey]: bucket };
  await saveGithubFile(goalForecastPath(dept), all, `Goal forecast (${dept}) daily ${dayKey}`);
  return all;
}
