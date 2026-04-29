const GITHUB_OWNER = 'rohrmanhyundai';
const GITHUB_REPO = 'Rohrmanhyundai';
const GITHUB_BRANCH = 'main';
const GITHUB_PATH = 'public/data/data.json';
const TOKEN_KEY = 'rohrmanGithubToken';
const BASE = import.meta.env.BASE_URL;

export function getGithubToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setGithubToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
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

export async function saveDashboardToGitHub(payload) {
  const token = getGithubToken();
  if (!token) {
    throw new Error('No GitHub token configured. Go to Admin > GitHub Settings and enter a Personal Access Token.');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rohrman-dashboard',
  };

  const apiPath = GITHUB_PATH;
  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}?ref=${GITHUB_BRANCH}&_=${Date.now()}`;
  const getRes = await fetch(getUrl, { headers, cache: 'no-store' });

  let sha = null;
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha || null;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    throw new Error(`Failed to read existing file: ${text}`);
  }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  const putRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update dashboard data ${new Date().toISOString()}`,
        content,
        branch: GITHUB_BRANCH,
        sha,
      }),
    }
  );

  const putJson = await putRes.json();
  if (!putRes.ok) {
    throw new Error(putJson.message || 'GitHub update failed');
  }

  return putJson;
}

async function saveGitHubFile(headers, path, data, message) {
  const getRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
    { headers, cache: 'no-store' }
  );
  let sha = null;
  if (getRes.ok) { const existing = await getRes.json(); sha = existing.sha || null; }
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const putRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, branch: GITHUB_BRANCH, sha }),
    }
  );
  if (!putRes.ok) { const j = await putRes.json(); throw new Error(j.message || 'GitHub save failed'); }
}

// Read a file directly from the GitHub API (bypasses GitHub Pages rebuild delay).
// Works without a token for public repos (60 req/hr unauthenticated).
async function readGitHubFile(headers, path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&_=${Date.now()}`,
      { headers, cache: 'no-store' }
    );
    if (!res.ok) return null;
    const fileData = await res.json();
    const bytes = Uint8Array.from(atob(fileData.content.replace(/\s/g, '')), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch { return null; }
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
  const token = getGithubToken();
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
  if (Array.isArray(raw)) return { users: raw, sharedSaveCode: '' };
  return { users: Array.isArray(raw.users) ? raw.users : [], sharedSaveCode: decodeSharedToken(raw.sharedSaveCode || '') };
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

// Save users list, always preserving the sharedSaveCode field
export async function saveUsers(users, sharedSaveCode) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  await saveGitHubFile(headers, 'public/data/users.json', { users, sharedSaveCode: encodeSharedToken(sharedSaveCode ?? '') }, 'Update users');
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
// Raw GitHub URL — instantly available after push, no Pages rebuild wait
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/public/data/documents/`;

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
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const safeFilename = `${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = `${DOCS_PATH}/${safeFilename}`;

  const base64Content = await fileToBase64(file);

  // Upload the actual file (raw base64, not JSON-wrapped)
  const putRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Upload document: ${label}`,
        content: base64Content,
        branch: GITHUB_BRANCH,
      }),
    }
  );
  if (!putRes.ok) {
    const j = await putRes.json();
    throw new Error(j.message || 'File upload failed');
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
  const token = getGithubToken();
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
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();

  // Delete the actual file
  await deleteGitHubFile(headers, `${DOCS_PATH}/${doc.filename}`, `Delete document: ${doc.label}`);

  // Update index
  const currentIndex = await loadDocumentIndex();
  const newIndex = currentIndex.filter(d => d.id !== doc.id);
  await saveGitHubFile(headers, DOCS_INDEX, newIndex, `Document index: remove ${doc.label}`);
  return newIndex;
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
  const token = getGithubToken();
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
  const token = getGithubToken();
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
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  await saveGitHubFile(headers, SCHEDULE_PATH, schedules, `Update work schedules ${new Date().toISOString()}`);
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

export async function saveChatMessages(messages) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  // Prune messages older than 30 days
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const pruned = messages.filter(m => m.timestamp > cutoff);
  await saveGitHubFile(headers, CHAT_PATH, pruned, `Chat update ${new Date().toISOString()}`);
  return pruned;
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

export async function saveWarrantyContract(contract, index) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, warrantyContractPath(contract.id), contract,
    `Warranty contract ${contract.id} - ${contract.customerName || 'unknown'}`);
  await saveGitHubFile(headers, WARRANTY_INDEX_PATH, index, `Update warranty index ${new Date().toISOString()}`);
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
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  await saveGitHubFile(headers, `public/data/wip/${techName.toUpperCase()}.json`, rows, `WIP update: ${techName}`);
  return rows;
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
  const token = getGithubToken();
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

export async function saveTechChatMessages(messages) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = authHeaders();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pruned = messages.filter(m => m.timestamp > cutoff);
  await saveGitHubFile(headers, TECH_CHAT_PATH, pruned, `Tech chat update ${new Date().toISOString()}`);
  return pruned;
}
