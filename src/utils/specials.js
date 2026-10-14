// Prep-sheet specials — e.g. "Winter Special": a manager picks what to look for
// and every matching appointment on the prep sheet gets a "🎯 Possible Winter
// Special" tag for the advisor.
//
// public/data/specials.json → { specials: [{ id, name, color, active, from, to,
//   booked: ['lof50', …],         // appointment tags (see apptTags) — ANY of them
//   keywords: ['coolant', …],     // words in the booked services / comments — ANY
//   deferred: ['VVCFL', …],       // deferred op codes on the vehicle — ANY of them
//   minAge: 3, minMiles: 36000,   // vehicle rule — "also tag these cars"
//   note }] }                     // the offer, shown to the advisor
// A special matches when every condition it has is met: booked (tag or keyword)
// AND deferred. A blank condition is skipped; a special with none never matches.
// The vehicle rule is an extra way in (OR): a car at least minAge years old
// (model year vs the appointment year) and over minMiles also gets the tag.
// Miles come from the appointment when the DMS export has them; unknown miles
// don't rule a car out when there's an age rule (age-only until miles exist).
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
// Model year from "2019 Hyundai Tucson".
const yearOf = (v) => { const m = String(v || '').match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };
function vehicleHit(s, appt, date) {
  const minAge = Number(s.minAge) || 0, minMiles = Number(s.minMiles) || 0;
  if (!minAge && !minMiles) return null;
  const year = yearOf(appt.vehicle);
  const nowYear = date ? Number(String(date).slice(0, 4)) : new Date().getFullYear();
  const age = year ? nowYear - year : null;
  const miles = Number(appt.mileage) || null;
  if (minAge && (age == null || age < minAge)) return null;
  if (minMiles && (miles != null ? miles < minMiles : !minAge)) return null;   // miles-only rule needs known miles
  return [age != null ? `${year} (${age} yr${age === 1 ? '' : 's'} old)` : null, miles != null ? `${miles.toLocaleString()} mi` : null].filter(Boolean).join(' · ');
}

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
    const veh = vehicleHit(s, appt, date);
    const hasRules = bookedKeys.length || words.length || codes.size;
    if (!hasRules && !veh) continue;
    const hitTags = bookedKeys.filter(k => tags.has(k)).map(k => (BOOKED_OPTIONS.find(o => o.key === k) || { label: k }).label);
    const hitWords = words.filter(w => text.includes(w)).map(w => `"${w}"`);
    const hitDeferred = items.filter(i => codes.has(String(i.code || '').toUpperCase()));
    const rulesOk = hasRules
      && (!(bookedKeys.length || words.length) || hitTags.length || hitWords.length)
      && (!codes.size || hitDeferred.length);
    if (!rulesOk && !veh) continue;
    out.push({
      special: s,
      booked: rulesOk ? [...hitTags, ...hitWords] : [],
      deferred: rulesOk ? hitDeferred.map(i => ({ code: i.code, desc: i.desc })) : [],
      vehicle: veh || '',
    });
  }
  return out;
}
