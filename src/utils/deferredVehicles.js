// One deferred-service row per vehicle. A car that came in more than once has
// an RO for each visit on the report; only the newest visit's deferred list is
// current, so that's the one worked. The older ROs stay in rows.json — they
// just aren't listed — and follow-ups logged against them (Contacted,
// Appointment…) count for the vehicle's newest RO via `aliasOf`.
//
// Vehicle = VIN; a row with no VIN falls back to its own RO (never merged).

const vehicleKey = (r) => {
  const vin = String((r && r.vin) || '').trim().toUpperCase();
  return vin.length >= 11 ? `vin:${vin}` : `ro:${r && r.ro}`;
};

// Newer = later date, then higher RO number for two visits on the same day.
const isNewer = (a, b) => (a.date !== b.date ? String(a.date || '') > String(b.date || '')
  : String(a.ro).localeCompare(String(b.ro), undefined, { numeric: true }) > 0);

// rows: every stored row. Returns { rows: newest per vehicle, aliasOf: { anyRo: newestRo },
// olderOf: { newestRo: [older rows, newest first] } }.
export function newestPerVehicle(rows) {
  const best = new Map();
  const all = new Map();
  for (const r of rows || []) {
    if (!r || !r.ro) continue;
    const k = vehicleKey(r);
    (all.get(k) || all.set(k, []).get(k)).push(r);
    const cur = best.get(k);
    if (!cur || isNewer(r, cur)) best.set(k, r);
  }
  const aliasOf = {};
  const olderOf = {};
  for (const [k, keep] of best) {
    const group = all.get(k);
    for (const r of group) aliasOf[String(r.ro)] = String(keep.ro);
    if (group.length > 1) {
      olderOf[String(keep.ro)] = group.filter(r => r !== keep).sort((a, b) => (isNewer(a, b) ? -1 : 1));
    }
  }
  return { rows: [...best.values()], aliasOf, olderOf };
}
