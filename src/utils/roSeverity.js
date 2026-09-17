// Open-RO aging rules — which ROs deserve a manager's eye and why.
//
// These started life on the Repair Order Process page (since removed) and now
// drive the row colours in the calendar's Open RO Attention panel. Input is one
// row of data/ro-status.json (written by RO Upload): { ro, advisor, vehicle,
// tech, userFlag, warranty, roStatus, cpStatus, roAge, openDate }.

// Normalize a status label to an underscore key: "Ready For Invoice" → READY_FOR_INVOICE.
const normStatus = (s) => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

// Age in days: prefer the report's numeric RO Age, else derive from Open Date.
function ageOf(r) {
  if (r.roAge != null && Number.isFinite(r.roAge)) return r.roAge;
  if (r.openDate) { const d = new Date(r.openDate); if (!isNaN(d.getTime())) return Math.floor((Date.now() - d.getTime()) / 86400000); }
  return null;
}

// "READY_FOR_DISPATCH" → "Ready for dispatch".
const prettyStatus = (v) => {
  const t = String(v || '').trim().replace(/_/g, ' ').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

// Severity drives sort order and row highlight. Highest first.
const SEV = {
  DISPATCH_OVERDUE: 9,   // READY_FOR_DISPATCH older than 1 day
  UNPAID_STALE:     8,   // invoiced, still unpaid past the stale threshold
  OPEN_STALLED:     7,   // open work sitting past the stalled threshold
  WARRANTY:         6,   // READY_FOR_INVOICE + warranty (red) flag, not invoiced
  AWN:              5,   // "Ready for AWN Review" and not INVOICED
  UNPAID:           4,   // invoiced, unpaid past the aging threshold
  OPEN_AGING:       3,   // open work past the aging threshold
  DISPATCH:         2,   // READY_FOR_DISPATCH (needs to get in the shop)
  ACCEPTANCE:       1,   // READY_FOR_INVOICE, no flag (needs acceptance)
  NONE:             0,   // paid / closed / anything else (shown, not highlighted)
};

// An INVOICED RO whose customer-pay line still reads INVOICED has been billed
// but not collected — the money is still out. PAID, CLOSED and NA are settled
// (NA meaning there was no customer-pay portion at all).
const isUnpaid = (r) => normStatus(r.roStatus) === 'INVOICED' && normStatus(r.cpStatus) === 'INVOICED';
const UNPAID_THRESHOLDS = { aging: 3, stale: 7 };

// Statuses that mean the RO still has OPEN WORK — the tech has claimed it but
// lines remain unfinished.
//
// CP Status deliberately plays no part here. It is ONE LINE's state, not the
// RO's: a used-car RO with no customer-pay lines reads CP=COMPLETED while the
// repair is still open (780470 and its neighbours), so treating it as "done"
// would hide live work. Age is the only reliable signal for these.
const OPEN_WORK = new Set(['TECH_ASSIGNED', 'PARTIALLY_ASSIGNED', 'IN_PROGRESS']);

// Days of open work before the page calls it out. Used-car recon (GREEN flag)
// gets a longer leash — a recon unit sitting a few days isn't a customer
// waiting on their car.
const OPEN_THRESHOLDS = {
  customer: { aging: 3, stalled: 7 },
  used:     { aging: 5, stalled: 10 },
};
const isUsedCar = (r) => /green/i.test(String(r.userFlag || ''));

// Apply the manager rules to one RO.
function evaluate(r) {
  const st = normStatus(r.roStatus);
  const warranty = !!r.warranty;
  const age = ageOf(r);
  const invoiced = st === 'INVOICED';
  // "Ready for AWN Review" may sit in the flag or a status column — check all.
  const flagText = `${r.userFlag || ''} ${r.roStatus || ''} ${r.cpStatus || ''}`.toLowerCase();
  const awnReview = flagText.includes('awn') && flagText.includes('review');

  if (st === 'READY_FOR_DISPATCH') {
    if (age != null && age > 1) return { sev: SEV.DISPATCH_OVERDUE, tag: 'Dispatch overdue', color: '#f87171', pulse: 'attn-high-row', msg: 'Get the car into the shop.' };
    return { sev: SEV.DISPATCH, tag: 'Get car in shop', color: '#fbbf24', msg: 'Car needs to get into the shop.' };
  }
  if (awnReview && !invoiced) {
    return { sev: SEV.AWN, tag: 'AWN — needs invoicing', color: '#c084fc', pulse: 'coaching-glow', msg: 'AWN repair needs invoiced.' };
  }
  if (st === 'READY_FOR_INVOICE') {
    if (warranty) return { sev: SEV.WARRANTY, tag: 'Warranty — not invoiced', color: '#fb923c', pulse: 'tire-missing-alert', msg: 'Flagged warranty but not invoiced.' };
    return { sev: SEV.ACCEPTANCE, tag: 'Needs acceptance', color: '#38bdf8', msg: 'Tech finished — accept the RO.' };
  }
  if (OPEN_WORK.has(st)) {
    const used = isUsedCar(r);
    const t = used ? OPEN_THRESHOLDS.used : OPEN_THRESHOLDS.customer;
    const kind = used ? 'Used-car recon' : 'Open work';
    if (age != null && age >= t.stalled) {
      return { sev: SEV.OPEN_STALLED, tag: 'Open work — stalled', color: '#f87171', pulse: 'attn-high-row',
               msg: `${kind} — find out what it's waiting on.` };
    }
    if (age != null && age >= t.aging) {
      return { sev: SEV.OPEN_AGING, tag: 'Open work — aging', color: '#fbbf24',
               msg: kind === 'Used-car recon' ? 'Used-car recon.' : '' };
    }
    // Inside the leash — the tech has it and it's moving.
    return { sev: SEV.NONE, tag: r.roStatus ? String(r.roStatus) : '—', color: '#64748b', msg: '' };
  }
  if (isUnpaid(r)) {
    if (age != null && age >= UNPAID_THRESHOLDS.stale) {
      return { sev: SEV.UNPAID_STALE, tag: 'Invoiced — not paid', color: '#f472b6', pulse: 'attn-high-row',
               msg: 'Billed but never collected — chase the payment.' };
    }
    if (age != null && age >= UNPAID_THRESHOLDS.aging) {
      return { sev: SEV.UNPAID, tag: 'Invoiced — not paid', color: '#f9a8d4', msg: 'Awaiting payment.' };
    }
    return { sev: SEV.NONE, tag: prettyStatus(r.roStatus) || '—', color: '#64748b', msg: '' };
  }
  // INVOICED (with or without flag) and everything else → no alert.
  return { sev: SEV.NONE, tag: r.roStatus ? String(r.roStatus) : '—', color: '#64748b', msg: '' };
}

export { evaluate as evaluateRo, ageOf as roAgeOf, prettyStatus as prettyRoStatus, SEV as RO_SEV };
