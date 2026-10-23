// Live, no-login reads of the app's data files.
//
// The site's own copy under /data/ is only republished when CODE deploys
// (deploy.yml skips data-only commits), so it can be days behind what the app
// has saved. GitHub's raw file host serves the repo's current main branch to
// anyone (≈5 min CDN cache; the ?v= makes each read a fresh URL), so pages that
// run without a sign-in — the shop TV, the Daily Wrench scorecards — read
// through here and fall back to the site copy only if raw is unreachable.
const REPO = 'rohrmanhyundai/Rohrmanhyundai';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/public/data/`;
const BASE = import.meta.env.BASE_URL;

// `fresh` (the shop TV): ask GitHub for the newest commit first and read that
// exact version — a commit's files are never stale, so a save shows on the
// next refresh instead of up to ~5 min later from raw's cached "main". One
// lookup is shared by every file read in the same refresh (≈40/hr per TV,
// inside GitHub's 60/hr no-login allowance); if GitHub says no (rate limit,
// network), it quietly falls back to raw "main" as before.
let shaCache = { at: 0, p: null };
function latestSha() {
  if (shaCache.p && Date.now() - shaCache.at < 45 * 1000) return shaCache.p;
  shaCache = { at: Date.now(), p: null };
  shaCache.p = fetch(`https://api.github.com/repos/${REPO}/commits/main?_=${Date.now()}`, {
    headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store',
  }).then(r => (r.ok ? r.text() : null)).then(t => (/^[0-9a-f]{40}$/.test(String(t || '').trim()) ? String(t).trim() : null)).catch(() => null);
  return shaCache.p;
}

export async function fetchLiveJson(path, { fresh = false } = {}) {
  const bust = `v=${Date.now()}`;
  const sha = fresh ? await latestSha() : null;
  const urls = [`${RAW}${path}?${bust}`, `${BASE}data/${path}?${bust}`];
  if (sha) urls.unshift(`https://raw.githubusercontent.com/${REPO}/${sha}/public/data/${path}`);
  for (const url of urls) {
    try {
      // A TV on a filtered network can leave a request hanging forever, which
      // would sit on "Loading…" — give each source 8s, then try the next.
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
      let res;
      try { res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }); }
      finally { if (timer) clearTimeout(timer); }
      if (res.ok) return await res.json();
      if (res.status === 404) return null;   // file really isn't there
    } catch { /* try the next source */ }
  }
  return null;
}

// Fallback read for signed-in pages when the GitHub API read fails (shared
// token rate-limited, worker hiccup). Returns a fetch Response like before,
// but tries raw "main" first — the site's own /data/ copy can be days old, and
// falling straight to it is what left dashboards stuck on yesterday's numbers
// while the TV (which reads raw) was right.
export async function fetchDataFile(path) {
  const bust = `v=${Date.now()}`;
  try {
    const res = await fetch(`${RAW}${path}?${bust}`, { cache: 'no-store' });
    if (res.ok || res.status === 404) return res;
  } catch { /* fall through to the site copy */ }
  return fetch(`${BASE}data/${path}?${bust}`, { cache: 'no-store' });
}
