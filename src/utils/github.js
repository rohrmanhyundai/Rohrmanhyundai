const GITHUB_OWNER = 'rohrmanhyundai';
const GITHUB_REPO = 'Rohrmanhyundai';
const GITHUB_BRANCH = 'main';
const GITHUB_PATH = 'public/data/data.json';
const TOKEN_KEY = 'rohrmanGithubToken';

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

  const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const getRes = await fetch(getUrl, { headers });

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
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_PATH)}`,
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
