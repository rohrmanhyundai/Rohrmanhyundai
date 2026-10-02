// Contest-to-date $50 add-on numbers for one advisor. Pure — shared by
// bigMoney.js (browser) and scripts/big-money-coaching.cjs (Node).
//
// The add-on board is month-to-date, but the contest runs across months. When
// the board resets, last month's final numbers are banked on the advisor in
// roh50_hist[YYYY-MM] (see applyAddOnRows in addOnReport.js). Here every month
// inside the contest window is added back together, weighted by tickets:
//   add rate   = all add-on tickets ÷ all tickets
//   hrs/ticket = all add-on hours  ÷ all tickets
// With nothing banked (or no ticket counts) it's just the current numbers.
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function contestAddOn(a, contest) {
  const cur = { hrsRo: num(a && a.roh50_hrs_ro), rate: num(a && a.roh50_add_rate), tickets: num(a && a.lof_tickets) };
  const hist = (a && a.roh50_hist) || {};
  if (!contest || !contest.start || !contest.end || !Object.keys(hist).length) return { ...cur, months: 1 };
  const lo = contest.start.slice(0, 7), hi = contest.end.slice(0, 7);
  const parts = Object.entries(hist)
    .filter(([m]) => m >= lo && m <= hi && m !== a.roh50_month)
    .map(([, v]) => ({ hrsRo: num(v.hrsRo), rate: num(v.rate), tickets: num(v.tickets) }));
  if (!parts.length) return { ...cur, months: 1 };
  if (!a.roh50_month || (a.roh50_month >= lo && a.roh50_month <= hi)) parts.push(cur);
  const T = parts.reduce((s, p) => s + p.tickets, 0);
  if (T <= 0) return { ...cur, months: 1 };
  return {
    hrsRo: parts.reduce((s, p) => s + p.hrsRo * p.tickets, 0) / T,
    rate: parts.reduce((s, p) => s + p.rate * p.tickets, 0) / T,
    tickets: T,
    months: parts.length,
  };
}
