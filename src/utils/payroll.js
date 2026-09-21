// Technician payroll — the weekly pay sheet.
//
// One row per tech for a Sat–Fri pay week, reproducing the shop's spreadsheet:
//
//   FRH turned × weekly rate      weekly rate = base, +$2 at 50 hrs, +$2 at 60
//                                 (every hour that week pays the bumped rate;
//                                  techs marked not bump-eligible stay on base)
//   + school hours × base rate    typed in by hand
//   + vacation/holiday/sick × base   typed in by hand (8 hrs a day)
//   + hourly pay                  hybrid techs only: clock hours × hourly rate
//   + other bonus                 typed in by hand, with a note (e.g. VMPI $15/FRH)
//   = total
//
// FRH turned comes from the uploaded Tekion Tech Performance .html (Pay Type
// View): customer pay + internal + warranty × 1.4 for techs with the warranty
// multiplier switched on. The rate/tier plan is the same one Tech Live Pay
// uses (tech-pay.json), plus a payroll-only "bump eligible" flag.

import { normalizePlan } from './techPay';
import { isWarrantyPayType, WARRANTY_MULTIPLIER } from './techFlaggedReport';

export const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
export const r2 = (v) => Math.round(num(v) * 100) / 100;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Pay week (Saturday → Friday) ──────────────────────────────────────────────
export function payWeekOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sat = new Date(d); sat.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
  return { key: isoOf(sat), start: isoOf(sat), end: isoOf(fri) };
}
// The most recent COMPLETED pay week — the one payroll is normally run for.
export function lastCompletedPayWeek(today = new Date()) {
  const cur = payWeekOf(today);
  const prev = new Date(cur.start + 'T00:00:00'); prev.setDate(prev.getDate() - 1);
  return payWeekOf(prev);
}
export function fmtWeek(week) {
  const f = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${y}`; };
  return `${f(week.start)} to ${f(week.end)}`;
}

// ── Plan (payroll view of the shared tech-pay plan) ───────────────────────────
export function payrollPlan(stored) {
  const p = normalizePlan(stored);
  const raw = stored || {};
  return {
    ...p,
    hybrid: p.payType === 'flat_clock',              // "FRH / HRLY" on the sheet
    bumpEligible: raw.bumpEligible !== false,        // payroll-only flag; default yes
    perTier: num(raw.perTier, p.tier1Bump || 2),     // display only — the bumps themselves live in tier1Bump/tier2Bump
  };
}

// ── FRH from the report ───────────────────────────────────────────────────────
// parseTechReportHtml row → { cp, int, war, warX, total } for one tech.
export function frhFromRow(row, multiplierOn = true) {
  let cp = 0, int = 0, war = 0;
  for (const p of (row && row.payTypes) || []) {
    const h = num(p.hours);
    if (isWarrantyPayType(p.type)) war += h;
    else if (/intern/i.test(String(p.type || ''))) int += h;
    else cp += h;
  }
  if (row && !row.detailed) cp = num(row.total);   // collapsed row: flat total, no split
  const warX = multiplierOn ? war * WARRANTY_MULTIPLIER : war;
  return { cp: r2(cp), int: r2(int), war: r2(war), warX: r2(warX), mult: multiplierOn ? WARRANTY_MULTIPLIER : 1, total: r2(cp + int + warX) };
}

// ── One payroll row ───────────────────────────────────────────────────────────
// inputs: { frh, school, pto, clockHours, otherBonus, otherNote }
export function computePayrollRow(storedPlan, inputs = {}) {
  const p = payrollPlan(storedPlan);
  const frh = Math.max(0, num(inputs.frh));
  const school = Math.max(0, num(inputs.school));
  const pto = Math.max(0, num(inputs.pto));
  const otherBonus = num(inputs.otherBonus);
  const clockHours = inputs.clockHours != null && inputs.clockHours !== '' ? Math.max(0, num(inputs.clockHours)) : p.clockHours;

  const tier1 = p.bumpEligible && p.tier1Hours > 0 && frh >= p.tier1Hours;
  const tier2 = p.bumpEligible && p.tier2Hours > 0 && frh >= p.tier2Hours;
  const weeklyRate = r2(p.flatRate + (tier1 ? p.tier1Bump : 0) + (tier2 ? p.tier2Bump : 0));

  const frhPay = r2(frh * weeklyRate);
  const schoolPay = r2(school * p.flatRate);
  const ptoPay = r2(pto * p.flatRate);
  const hourlyPay = p.hybrid && p.clockRate > 0 ? r2(clockHours * p.clockRate) : 0;
  const total = r2(frhPay + schoolPay + ptoPay + hourlyPay + otherBonus);

  return {
    plan: p, frh, school, pto, clockHours, otherBonus, otherNote: String(inputs.otherNote || ''),
    tier1, tier2, weeklyRate, frhPay, schoolPay, ptoPay, hourlyPay, total,
  };
}

export function payrollTotals(rows) {
  const sum = (k) => r2(rows.reduce((s, r) => s + num(r[k]), 0));
  return { frh: sum('frh'), frhPay: sum('frhPay'), school: sum('school'), schoolPay: sum('schoolPay'), pto: sum('pto'), ptoPay: sum('ptoPay'), hourlyPay: sum('hourlyPay'), otherBonus: sum('otherBonus'), total: sum('total') };
}
