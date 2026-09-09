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
  tier1Rate: 0,        // base rate is used when this is 0 (tier not set up)
  tier2Hours: TIER2_HOURS,
  tier2Rate: 0,
  tierMode: 'all',     // 'all' = every hour at the bumped rate | 'above' = only the hours past the threshold
  clockRate: 0,        // $ per clock hour
  clockHours: 40,      // clock hours per week
  clockMode: 'add',    // 'add' = paid on top of flat rate | 'greater' = guarantee, paid the greater of the two
};

const num = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export function normalizePlan(plan) {
  const p = { ...DEFAULT_PLAN, ...(plan || {}) };
  return {
    payType: p.payType === 'flat_clock' ? 'flat_clock' : 'flat',
    flatRate: num(p.flatRate),
    tier1Hours: num(p.tier1Hours, TIER1_HOURS),
    tier1Rate: num(p.tier1Rate),
    tier2Hours: num(p.tier2Hours, TIER2_HOURS),
    tier2Rate: num(p.tier2Rate),
    tierMode: p.tierMode === 'above' ? 'above' : 'all',
    clockRate: num(p.clockRate),
    clockHours: num(p.clockHours),
    clockMode: p.clockMode === 'greater' ? 'greater' : 'add',
  };
}

// A plan nobody has filled in yet pays nothing — show the setup prompt instead
// of a confident $0.00.
export function planIsSet(plan) {
  const p = normalizePlan(plan);
  return p.flatRate > 0 || (p.payType === 'flat_clock' && p.clockRate > 0);
}

// The ladder, lowest first. A tier with no rate entered falls back to the rate
// below it, so a half-filled plan never pays less than the base.
export function tiersOf(plan) {
  const p = normalizePlan(plan);
  const t1 = p.tier1Rate > 0 ? p.tier1Rate : p.flatRate;
  const t2 = p.tier2Rate > 0 ? p.tier2Rate : t1;
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
