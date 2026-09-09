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
  tierMode: 'all',     // 'all' = every hour at the bumped rate | 'above' = only the hours past the threshold
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
    tierMode: p.tierMode === 'above' ? 'above' : 'all',
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

  // How the flat-rate dollars are built, spelled out so the breakdown can show
  // the same arithmetic the tech would do on paper.
  let bands = [];
  if (p.tierMode === 'above') {
    // Marginal: each band of hours is paid at its own rate.
    const edges = [0, p.tier1Hours, p.tier2Hours, Infinity];
    for (let i = 0; i < 3; i++) {
      const band = Math.max(0, Math.min(hours, edges[i + 1]) - edges[i]);
      if (band > 0) bands.push({ label: tiers[i].label, hours: band, rate: tiers[i].rate, amount: band * tiers[i].rate });
    }
  } else {
    // Retroactive: hitting the tier lifts every hour to the higher rate.
    if (hours > 0) bands.push({ label: tier.label, hours, rate: tier.rate, amount: hours * tier.rate });
  }
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
  const dates = weekDates();
  return WEEK_DAYS.filter(d => {
    if (!(num(t[d]) > 0)) return false;
    const raw = t[`${d}_raw`];
    if (raw !== undefined && raw !== null && raw !== '') return false;
    return !overrides[dates[d]];
  });
}

// Mon..Sat of the current week as YYYY-MM-DD, local — the same keys the
// schedule and hoursOverride use.
export function weekDates() {
  const out = {};
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
  WEEK_DAYS.forEach((k, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out[k] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  return out;
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

// The Monday that starts the current week, and the Saturday that ends it.
export function weekBounds() {
  const d = weekDates();
  return { start: d.mon, end: d.sat };
}

// Monday..Saturday for the week containing a given YYYY-MM-DD.
export function weekBoundsOf(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return weekBounds();
  const day = new Date(y, m - 1, d);
  const dow = day.getDay();
  const monday = new Date(day);
  monday.setDate(day.getDate() + (dow === 0 ? -6 : 1 - dow));
  const sat = new Date(monday);
  sat.setDate(monday.getDate() + 5);
  const iso2 = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { start: iso2(monday), end: iso2(sat) };
}

/* Which week the Tech Hours board is actually holding.
 *
 * Not necessarily this one: a manager closing out on Monday morning is closing
 * LAST week, and filing it under today's Monday would put it in the wrong week
 * and overwrite the new one. Every real figure stamps its date in hoursOverride,
 * so the latest stamped date says which week the numbers belong to. With no
 * stamps at all — a board of nothing but schedule fills — this week is right.
 */
export function boardWeekBounds(technicians) {
  let latest = '';
  for (const t of technicians || []) {
    for (const d of Object.keys((t && t.hoursOverride) || {})) {
      if (d > latest) latest = d;
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
  const pay = computeTechPay(p, basis.banked);
  const { start, end } = extra.weekStart ? weekBoundsOf(extra.weekStart) : weekBounds();
  const days = {};
  for (const d of WEEK_DAYS) days[d] = round2(num(t[d]));
  return {
    weekStart: start,
    weekEnd: end,
    days,
    hours: round2(basis.banked),
    boardHours: round2(num(t.total)),
    ptoHours: round2(basis.ptoHours),
    ptoPaid: p.eligiblePto,
    rate: round2(pay.effRate),
    tier: pay.tier.label,
    pay: round2(pay.gross),
    payType: p.payType,
    closed: false,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

const round2 = (n) => Math.round((num(n)) * 100) / 100;
