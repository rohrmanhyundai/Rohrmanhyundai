/* Technician pay math.
 *
 * Techs are reported by the WEEK on this site (mon..sat, `total`, `pacing`), so
 * a tech's pay week is the week on the Tech Hours board — that is the basis for
 * the 50/60 hour tier bumps. `total` is the flagged figure the tech is paid on
 * (it already carries the warranty multiplier when that tech's switch is on);
 * `total_raw` is the unmultiplied number Cash Dash uses, not a pay number.
 *
 * Shops write these plans differently, so the shape of the plan is a setting
 * rather than an assumption: whether a bump pays every hour or only the hours
 * past the threshold, and whether clock pay stacks on top of flat rate or is a
 * guarantee, are both chosen per tech on the Setup screen.
 */

export const TIER1_HOURS = 50;
export const TIER2_HOURS = 60;

export const DEFAULT_PLAN = {
  payType: 'flat',     // 'flat' = flat rate only | 'flat_clock' = clock + flat rate
  flatRate: 0,         // $ per flagged hour, base tier
  tier1Hours: TIER1_HOURS,
  tier1Bump: 0,        // ADDED to the base rate once the tier is reached, not a replacement
  tier2Hours: TIER2_HOURS,
  tier2Bump: 0,        // ADDED to the TIER 1 rate — bumps stack, they don't both come off the base
  clockRate: 0,        // $ per clock hour
  clockHours: 40,      // clock hours per week
  clockMode: 'add',    // 'add' = paid on top of flat rate | 'greater' = guarantee, paid the greater of the two
  eligiblePto: true,   // false = holiday / PTO / training hours are not paid to this tech
};

const num = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export function normalizePlan(plan) {
  const raw = plan || {};
  const p = { ...DEFAULT_PLAN, ...raw };
  // Read the legacy key off the STORED plan, not the merged one — the merged one
  // always carries a defaulted tier1Bump, which would mask it.
  const bumpOf = (bump, legacy) => Math.max(0, num(bump !== undefined ? bump : legacy));
  return {
    payType: p.payType === 'flat_clock' ? 'flat_clock' : 'flat',
    flatRate: num(p.flatRate),
    tier1Hours: num(p.tier1Hours, TIER1_HOURS),
    // A bump is what the tier ADDS to the base rate — that's how the pay plans
    // are written ("$2 more an hour past 50"). The first version of this screen
    // asked for a replacement rate instead, so a plan saved with tier1Rate reads
    // its number as the bump it was always meant to be.
    tier1Bump: bumpOf(raw.tier1Bump, raw.tier1Rate),
    tier2Hours: num(p.tier2Hours, TIER2_HOURS),
    tier2Bump: bumpOf(raw.tier2Bump, raw.tier2Rate),
    clockRate: num(p.clockRate),
    clockHours: num(p.clockHours),
    clockMode: p.clockMode === 'greater' ? 'greater' : 'add',
    // Default TRUE — a tech with no answer recorded keeps being paid for the
    // hours the schedule fills in, which is what the site did before this flag.
    eligiblePto: p.eligiblePto !== false,
  };
}

// A plan nobody has filled in yet pays nothing — show the setup prompt instead
// of a confident $0.00.
export function planIsSet(plan) {
  const p = normalizePlan(plan);
  return p.flatRate > 0 || (p.payType === 'flat_clock' && p.clockRate > 0);
}

// The ladder, lowest first. Bumps STACK: tier 1 adds to the base, tier 2 adds to
// tier 1. So $31 with bumps of $2 and $2 pays $31 / $33 / $35 — each tier is
// "another two dollars an hour", which is how the plans are written. A blank
// bump just carries the rate below it forward, and since a bump is never
// negative, turning more hours can't drop someone's rate.
export function tiersOf(plan) {
  const p = normalizePlan(plan);
  const t1 = p.flatRate + p.tier1Bump;
  const t2 = t1 + p.tier2Bump;
  return [
    { label: `Up to ${p.tier1Hours} hrs`, min: 0, rate: p.flatRate },
    { label: `${p.tier1Hours} – ${p.tier2Hours} hrs`, min: p.tier1Hours, rate: t1 },
    { label: `${p.tier2Hours}+ hrs`, min: p.tier2Hours, rate: t2 },
  ];
}

export function tierIndexFor(plan, hours) {
  const tiers = tiersOf(plan);
  for (let i = tiers.length - 1; i >= 0; i--) if (hours >= tiers[i].min) return i;
  return 0;
}

/* Pay for one basis of flagged hours (banked = hours turned so far, pacing =
 * projected for the full week). Pure — no React, no data loading. */
export function computeTechPay(plan, flagHours) {
  const p = normalizePlan(plan);
  const hours = Math.max(0, num(flagHours));
  const tiers = tiersOf(plan);
  const tierIdx = tierIndexFor(plan, hours);
  const tier = tiers[tierIdx];

  // Reaching a tier lifts EVERY hour that week to that tier's rate. Spelled out
  // as a band so the breakdown can show the same arithmetic a tech would do on
  // paper. A tech below the first tier is simply on the base rate.
  const bands = hours > 0
    ? [{ label: tier.label, hours, rate: tier.rate, amount: hours * tier.rate }]
    : [];
  const flatPay = bands.reduce((s, b) => s + b.amount, 0);
  const effRate = hours > 0 ? flatPay / hours : tier.rate;

  const clockPotential = p.payType === 'flat_clock' ? p.clockRate * p.clockHours : 0;
  let clockPay = 0;
  let guaranteeApplied = false;
  let gross;
  if (p.payType !== 'flat_clock') {
    gross = flatPay;
  } else if (p.clockMode === 'greater') {
    guaranteeApplied = clockPotential > flatPay;
    gross = Math.max(flatPay, clockPotential);
    clockPay = guaranteeApplied ? clockPotential : 0;
  } else {
    clockPay = clockPotential;
    gross = flatPay + clockPay;
  }

  // How far to the next bump — the number a tech actually wants on the screen.
  const next = tiers[tierIdx + 1] || null;
  const toNext = next ? Math.max(0, next.min - hours) : 0;
  const nextGain = next ? computeTechPay(plan, next.min).gross - gross : 0;

  return {
    plan: p, hours, tiers, tierIdx, tier, bands, flatPay, effRate,
    clockPay, clockPotential, guaranteeApplied, gross,
    next, toNext, nextGain: nextGain > 0 ? nextGain : 0,
  };
}

/* ------------------------------------------- holiday / PTO / training hours */

export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* Which of a tech's week days are schedule-filled time off.
 *
 * When the calendar marks a day holiday / vacation / training and the tech has
 * no hours on it, the dashboard drops 8.0 hours in (applyScheduleHours). Those
 * hours are recognisable by what they LACK rather than by re-reading the
 * schedule: every real figure — typed by hand or matched off the hours report —
 * writes both a `<day>_raw` value and a hoursOverride stamp for that date, and
 * the fill writes neither. So hours with no raw and no override are the fill,
 * which also means this works anywhere, with no schedules file to load.
 */
export function ptoDaysOf(tech) {
  const t = tech || {};
  const overrides = t.hoursOverride || {};
  // The week THIS tech's board holds — on a Saturday or Monday before close-out
  // that is still last week, and today's calendar week would match nothing.
  const dates = weekDatesOf(boardWeekBounds([t]).start);
  return WEEK_DAYS.filter(d => {
    if (!(num(t[d]) > 0)) return false;
    const raw = t[`${d}_raw`];
    if (raw !== undefined && raw !== null && raw !== '') return false;
    return !overrides[dates[d]];
  });
}

/* The tech work week runs Saturday to Friday: Saturday opens it, Friday closes
 * it, and that is the week payroll pays. The board's day columns keep their
 * Mon..Sat order, but the Sat column is the Saturday BEFORE the Mon..Fri beside
 * it. These are the same keys the schedule and hoursOverride use. */
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAY_OFFSET = { sat: 0, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6 };   // days after the opening Saturday

// The Saturday that opened the week containing a local Date.
function saturdayOf(date) {
  const sat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));   // Sat→0, Sun→1, … Fri→6
  return sat;
}

const parseIso = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

// Day column → YYYY-MM-DD for the Sat–Fri week containing `iso`.
export function weekDatesOf(iso) {
  const sat = saturdayOf(parseIso(iso) || new Date());
  const out = {};
  for (const k of WEEK_DAYS) {
    const d = new Date(sat);
    d.setDate(sat.getDate() + DAY_OFFSET[k]);
    out[k] = isoOf(d);
  }
  return out;
}

// Day column → YYYY-MM-DD for the week containing today.
export function weekDates() {
  return weekDatesOf(isoOf(new Date()));
}

/* The hours a tech is actually paid on, banked and projected.
 *
 * Eligible (the default) is exactly what the Tech Hours board shows. Not
 * eligible strips the filled hours out and re-paces over the days that are left
 * — projecting a holiday week across five days the tech was never going to work
 * would quietly inflate the number.
 */
export function payBasis(tech, plan) {
  const p = normalizePlan(plan);
  const t = tech || {};
  const total = num(t.total);
  const ptoDays = ptoDaysOf(t);
  const ptoHours = ptoDays.reduce((s, d) => s + num(t[d]), 0);

  if (p.eligiblePto) {
    return { banked: total, pacing: num(t.pacing) || total, ptoHours, ptoDays, excluded: 0 };
  }

  const banked = Math.max(0, total - ptoHours);
  const workedSat = num(t.sat) > 0 && !ptoDays.includes('sat');
  const span = workedSat ? WEEK_DAYS : WEEK_DAYS.slice(0, 5);
  const payableDays = span.filter(d => !ptoDays.includes(d));
  const daysWorked = payableDays.filter(d => num(t[d]) > 0).length;
  const pacing = daysWorked > 0 ? (banked / daysWorked) * payableDays.length : 0;
  return { banked, pacing, ptoHours, ptoDays, excluded: ptoHours };
}

/* ------------------------------------------------------------ week records */

// The Saturday that opens the current week, and the Friday that closes it.
export function weekBounds() {
  const d = weekDates();
  return { start: d.sat, end: d.fri };
}

// Saturday..Friday for the week containing a given YYYY-MM-DD.
export function weekBoundsOf(iso) {
  if (!parseIso(iso)) return weekBounds();
  const d = weekDatesOf(iso);
  return { start: d.sat, end: d.fri };
}

// The Sat–Fri week `n` weeks after (or, negative, before) the one containing `iso`.
export function shiftWeek(iso, n) {
  const d = parseIso(iso) || new Date();
  d.setDate(d.getDate() + 7 * n);
  return weekBoundsOf(isoOf(d));
}

/* Which week the Tech Hours board is actually holding.
 *
 * Not necessarily this one: a manager closing out on Saturday or Monday is
 * closing the week that ended Friday, and filing it under today's week would
 * put it in the wrong week and overwrite the new one. Every real figure stamps its date in hoursOverride,
 * so the latest stamped date says which week the numbers belong to. With no
 * stamps at all — a board of nothing but schedule fills — this week is right.
 */
export function boardWeekBounds(technicians) {
  // A stamp after today can't be a real day's hours — older uploads stamped a
  // late report into the coming week — so it doesn't get to name the week.
  const today = isoOf(new Date());
  let latest = '';
  for (const t of technicians || []) {
    for (const d of Object.keys((t && t.hoursOverride) || {})) {
      if (d > latest && d <= today) latest = d;
    }
  }
  return latest ? weekBoundsOf(latest) : weekBounds();
}

/* One technician's week, ready to store. Built in one place so the close-out
 * screen, the nightly job and the history list can never tell three different
 * stories about the same week. `hours` is what the tech is PAID on — holiday /
 * PTO / training hours are already out of it when they aren't eligible — while
 * `boardHours` is the raw Tech Hours total, kept so a week can be reconciled
 * against the board later. */
export function buildWeekRecord(tech, plan, extra = {}) {
  const p = normalizePlan(plan);
  const t = tech || {};
  const basis = payBasis(t, p);
  // At close-out a manager can type the week's final hours. Blank means the
  // week's own number is right — an override of 0 is a real answer, so this
  // tests for a number rather than for truthiness.
  // Pulled out of `extra` so the raw input never lands in the stored record —
  // what it MEANT is already captured in hours / overridden / adjustment.
  const { overrideHours: override, ...rest } = extra;
  const overridden = override !== undefined && override !== null && override !== '' && Number.isFinite(num(override, NaN));
  const hours = Math.max(0, overridden ? num(override) : basis.banked);
  const pay = computeTechPay(p, hours);
  const { start, end } = rest.weekStart ? weekBoundsOf(rest.weekStart) : weekBounds();
  const days = {};
  for (const d of WEEK_DAYS) days[d] = round2(num(t[d]));
  return {
    weekStart: start,
    weekEnd: end,
    days,
    hours: round2(hours),               // what the tech is paid on
    payableHours: round2(basis.banked), // the week's own number, before any override
    overridden,                         // true when a manager typed the final hours
    adjustment: round2(hours - basis.banked),   // the difference, for reconciling later
    boardHours: round2(num(t.total)),   // what the Tech Hours board said
    ptoHours: round2(basis.ptoHours),
    ptoPaid: p.eligiblePto,
    rate: round2(pay.effRate),
    tier: pay.tier.label,
    pay: round2(pay.gross),
    payType: p.payType,
    closed: false,
    updatedAt: new Date().toISOString(),
    ...rest,
  };
}

// The payable hours a week would be stored with, before any adjustment — the
// number the close-out screen shows next to the adjustment box.
export function payableHoursOf(tech, plan) {
  return round2(payBasis(tech, plan).banked);
}

const round2 = (n) => Math.round((num(n)) * 100) / 100;
