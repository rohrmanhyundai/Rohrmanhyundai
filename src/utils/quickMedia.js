import * as github from './github';
import { deleteS3ObjectByUrl } from './s3';

// ── Loaner quick media: 72-hour shelf life ────────────────────────────────────
// Pictures / videos sent from the phone's 📤 Add media live on Service Loaner →
// 📸 Media for 72 hours. There's no server timer, so whoever opens that tab or
// sends new media sweeps anything older: its files come out of S3 and its entry
// out of quick-media.json. The page also hides anything past 72h straight away.

export const QUICK_MEDIA_TTL_MS = 72 * 60 * 60 * 1000;
export const isExpired = (item, now = Date.now()) => now - new Date(item.at).getTime() >= QUICK_MEDIA_TTL_MS;
export const expiresIn = (item, now = Date.now()) => new Date(item.at).getTime() + QUICK_MEDIA_TTL_MS - now;

// Delete expired uploads. Returns the store as it stands afterwards.
export async function pruneQuickMedia(io) {
  const { loadQuickMedia, updateQuickMedia } = io || github;
  const deleteByUrl = io?.deleteS3ObjectByUrl || deleteS3ObjectByUrl;
  const cur = await loadQuickMedia();
  const old = (cur.items || []).filter(i => isExpired(i));
  if (!old.length) return cur;
  for (const i of old) for (const f of i.files || []) { try { await deleteByUrl(f.url); } catch {} }
  const ids = new Set(old.map(i => i.id));
  return updateQuickMedia(c => ({ ...c, items: c.items.filter(i => !ids.has(i.id)) }), `expire ${old.length}`);
}
