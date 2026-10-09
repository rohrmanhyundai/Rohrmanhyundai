// Live, no-login reads of the app's data files.
//
// The site's own copy under /data/ is only republished when CODE deploys
// (deploy.yml skips data-only commits), so it can be days behind what the app
// has saved. GitHub's raw file host serves the repo's current main branch to
// anyone (≈5 min CDN cache; the ?v= makes each read a fresh URL), so pages that
// run without a sign-in — the shop TV, the Daily Wrench scorecards — read
// through here and fall back to the site copy only if raw is unreachable.
const RAW = 'https://raw.githubusercontent.com/rohrmanhyundai/Rohrmanhyundai/main/public/data/';
const BASE = import.meta.env.BASE_URL;

export async function fetchLiveJson(path) {
  const bust = `v=${Date.now()}`;
  for (const url of [`${RAW}${path}?${bust}`, `${BASE}data/${path}?${bust}`]) {
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
