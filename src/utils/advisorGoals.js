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

// Today's pacing number for an advisor's calendar:
//   behind pace  → hours to sell today (and each remaining day) to REACH the goal
//   ahead of pace → hours to sell today to HOLD their current above-goal pace
// Working days = non-Sundays in the month minus `offKeys` (from advisorOffDates).
// `remaining` includes today. Returns null when it can't be computed (no goal,
// or the month's working days are done).
export function dailyPacing({ hoursGoal, mtd, year, month, offKeys, today = new Date() }) {
  const goal = safe(hoursGoal, 0);
  if (goal <= 0) return null;
  const off = offKeys || new Set();
  const pad = (n) => String(n).padStart(2, '0');
  const dim = new Date(year, month + 1, 0).getDate();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  let total = 0, elapsed = 0, remaining = 0;
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === 0) continue;                 // Sunday — never a working day
    const k = `${year}-${pad(month + 1)}-${pad(d)}`;
    if (off.has(k)) continue;                         // scheduled off / holiday / vacation / unscheduled Sat
    total += 1;
    if (k < todayKey) elapsed += 1; else remaining += 1; // remaining includes today
  }
  if (total === 0 || remaining === 0) return null;
  const m = safe(mtd, 0);
  const dailyTarget = goal / total;
  const expectedByNow = dailyTarget * elapsed;        // where they should be through yesterday
  const behind = m < expectedByNow;
  let value;
  if (behind) {
    value = (goal - m) / remaining;                   // catch up to the monthly goal
    if (value < 0) value = 0;
  } else {
    value = elapsed > 0 ? m / elapsed : dailyTarget;  // hold current daily pace
  }
  return { mode: behind ? 'behind' : 'ahead', value, dailyTarget, total, elapsed, remaining };
}
