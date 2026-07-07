import { safe } from './formatters';

// The advisor daily grid stores each day's MONTH-TO-DATE running totals — advisors
// type their DMS month total each day, and the page derives "hours closed that day"
// as the delta from the previous entered day. Older buckets stored each day's OWN
// production; ensureMtd converts a legacy bucket to running totals exactly ONCE and
// stamps entryMode:'mtd' so it's never converted again. Hours become a cumulative
// sum (lossless — the daily deltas recover the original numbers); hrs/RO becomes the
// running average of the entered daily ratios, which keeps the month-average display
// identical to before. Idempotent and pure. Shared by AdvisorGoals (display/edit) and
// AdminPanel (the morning cross-check that reconciles the previous day).
export function ensureMtd(bucket) {
  const base = (bucket && typeof bucket === 'object') ? bucket : {};
  if (base.entryMode === 'mtd') return base;
  const days = base.days || {};
  const keys = Object.keys(days)
    .filter(k => days[k] && (days[k].hours != null || days[k].hrsRo != null))
    .sort(); // 'YYYY-MM-DD' sorts chronologically
  let cum = 0, roSum = 0, roCount = 0;
  const newDays = { ...days };
  for (const k of keys) {
    const rec = days[k] || {};
    cum = Math.round((cum + safe(rec.hours, 0)) * 100) / 100; // avoid float drift (80.39999…)
    let mtdRo = safe(rec.hrsRo, 0);
    if (rec.hrsRo != null && rec.hrsRo !== '') { roSum += safe(rec.hrsRo, 0); roCount += 1; mtdRo = Math.round((roSum / roCount) * 100) / 100; }
    newDays[k] = { ...rec, hours: cum, hrsRo: mtdRo };
  }
  return { ...base, days: newDays, entryMode: 'mtd' };
}
