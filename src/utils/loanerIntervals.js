// ── Loaner maintenance intervals ──────────────────────────────────────────────
// Rules set on Loaner Maintenance → ⚙️ Setup, stored beside the requests in
// data/service-loaner/maintenance.json as `intervals`:
//   [{ id, service, every, warn }]  — e.g. Oil change every 5000 mi, flag 500 mi early.
// Each fleet loaner's miles (Loaner Inventory) are checked against every rule.
// The service was last done at the highest mileage on a DONE request for that
// loaner listing that service (none yet → counted from 0). An OPEN request for
// the same loaner + service means it's already being handled, so it's skipped.

export const SUGGESTED_INTERVALS = [
  { service: 'Oil change', every: 5000, warn: 500 },
  { service: 'Tires', every: 7500, warn: 500 },
];

const num = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
const norm = (s) => String(s || '').trim().toUpperCase().replace(/^#/, '');
const sameLoaner = (r, v) => (r.vin && v.vin && r.vin === v.vin) || (r.loanerNo && v.stockNo && norm(r.loanerNo) === norm(v.stockNo));

// → [{ key, vehicle, rule, miles, lastAt, dueAt, left }] — left < 0 means past due.
// Past due first, then closest to due.
export function dueByMileage(intervals = [], fleet = [], requests = []) {
  const out = [];
  for (const v of fleet) {
    const miles = num(v.mileage);
    if (!miles) continue;
    const mine = requests.filter(r => sameLoaner(r, v));
    for (const rule of intervals) {
      const every = num(rule.every);
      if (!rule.service || !every) continue;
      const has = (r) => (r.services || []).includes(rule.service);
      if (mine.some(r => r.status !== 'done' && has(r))) continue;
      const lastAt = Math.max(0, ...mine.filter(r => r.status === 'done' && has(r)).map(r => num(r.doneMileage || r.mileage)));
      const dueAt = lastAt + every;
      const left = dueAt - miles;
      if (left <= num(rule.warn)) out.push({ key: `${v.id}-${rule.id}`, vehicle: v, rule, miles, lastAt, dueAt, left });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}
