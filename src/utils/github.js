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

export async function saveAdvisorNotes(advisorName, date, rows) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };

  await saveGitHubFile(headers, `public/data/advisor-notes/${advisorName}/${date}.json`,
    { advisorName, date, rows, savedAt: new Date().toISOString() },
    `Advisor notes: ${advisorName} ${date}`);

  let indexData = { dates: [] };
  try {
    const res = await fetch(`${BASE}data/advisor-notes/${advisorName}/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) indexData = await res.json();
  } catch {}
  if (!indexData.dates.includes(date)) indexData.dates = [date, ...indexData.dates].sort().reverse();
  await saveGitHubFile(headers, `public/data/advisor-notes/${advisorName}/index.json`, indexData, `Notes index: ${advisorName}`);
}

export async function loadAdvisorNotes(advisorName, date) {
  try {
    const res = await fetch(`${BASE}data/advisor-notes/${advisorName}/${date}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function loadUsers() {
  try {
    const res = await fetch(`${BASE}data/users.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function saveUsers(users) {
  const token = getGithubToken();
  if (!token) throw new Error('No GitHub token. Go to Admin > GitHub Settings.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
  await saveGitHubFile(headers, 'public/data/users.json', users, 'Update users');
}

export async function loadAdvisorNoteIndex(advisorName) {
  try {
    const res = await fetch(`${BASE}data/advisor-notes/${advisorName}/index.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.dates || [];
  } catch { return []; }
}
