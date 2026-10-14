// Prep-sheet specials — e.g. "Winter Special": a manager picks what to look for
// and every matching appointment on the prep sheet gets a "🎯 Possible Winter
// Special" tag for the advisor.
//
// public/data/specials.json → { specials: [{ id, name, color, active, from, to,
//   booked: ['lof50', …],         // appointment tags (see apptTags) — ANY of them
//   keywords: ['coolant', …],     // words in the booked services / comments — ANY
//   deferred: ['VVCFL', …],       // deferred op codes on the vehicle — ANY of them
//   note }] }                     // the offer, shown to the advisor
// A special matches when every condition it has is met: booked (tag or keyword)
// AND deferred. A blank condition is skipped; a special with none never matches.
import { apptTags } from './apptMath.mjs';

export const BOOKED_OPTIONS = [
  { key: 'lof50', label: '💵 $50 oil change' },
  { key: 'campaign', label: '⚠ Campaign / recall' },
  { key: 'warranty', label: '🛡 Warranty' },
  { key: 'diag', label: '🔍 Diagnosis' },
  { key: 'tow', label: '🚚 Tow-in' },
  { key: 'prepay', label: '💳 Prepaid' },
];
export const SPECIAL_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#4ade80', '#fb923c', '#f87171'];

const inRange = (s, date) => (!s.from || !date || date >= s.from) && (!s.to || !date || date <= s.to);

// → [{ special, booked: [labels], deferred: [{ code, desc }] }]
export function matchSpecials(appt, specials, date) {
  if (!appt) return [];
  const tags = new Set(apptTags(appt).map(t => t.key));
  const text = [...(appt.services || []), appt.comments || ''].join(' ').toLowerCase();
  const items = (appt.deferred && appt.deferred.items) || [];
  const out = [];
  for (const s of specials || []) {
    if (!s || s.active === false || !inRange(s, date)) continue;
    const bookedKeys = s.booked || [], words = (s.keywords || []).map(w => String(w).trim().toLowerCase()).filter(Boolean);
    const codes = new Set((s.deferred || []).map(c => String(c).toUpperCase()));
    if (!bookedKeys.length && !words.length && !codes.size) continue;
    const hitTags = bookedKeys.filter(k => tags.has(k)).map(k => (BOOKED_OPTIONS.find(o => o.key === k) || { label: k }).label);
    const hitWords = words.filter(w => text.includes(w)).map(w => `"${w}"`);
    if ((bookedKeys.length || words.length) && !hitTags.length && !hitWords.length) continue;
    const hitDeferred = items.filter(i => codes.has(String(i.code || '').toUpperCase()));
    if (codes.size && !hitDeferred.length) continue;
    out.push({ special: s, booked: [...hitTags, ...hitWords], deferred: hitDeferred.map(i => ({ code: i.code, desc: i.desc })) });
  }
  return out;
}
