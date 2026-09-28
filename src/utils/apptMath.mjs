// Pure prep-sheet math — no imports, so the Daily Wrench script (Node, 9am)
// can use it as well as the app. appointmentList.js re-exports all of it.

// Who an appointment belongs to: its DMS advisor, else whoever claimed it,
// else nobody ('' = still in the open pool).
export function ownerOf(appt, claims) {
  if (appt.advisor) return appt.advisor;
  return (claims && claims[appt.apptNo] && claims[appt.apptNo].advisor) || '';
}

// Prep flags read out of the services / vehicle text.
export function apptTags(a) {
  const text = [...(a.services || []), a.comments || ''].join('\n');
  const tags = [];
  const add = (key, label, color, title) => tags.push({ key, label, color, title });
  const campaigns = text.match(/\(\d{2}-\d{2}-\d{3}[A-Z]?\)/g);
  if (campaigns) add('campaign', `⚠ Campaign ${campaigns.map(c => c.slice(1, -1)).join(', ')}`, '#f87171', 'Recall / campaign — confirm parts are here');
  if (/parts?\s+in\b|\bsop\b/i.test(text)) add('sop', '📦 Parts in SOP', '#fbbf24', 'Special-order parts — make sure they\'re actually on the shelf');
  if (/customer states|check and advise|\bcel\b|light[s]? on|noise|will not|won'?t|not working|leak/i.test(text)) add('diag', '🔍 Diagnosis', '#c4b5fd', 'Customer concern — plan diag time and set expectations');
  if (/warranty/i.test(text)) add('warranty', '🛡 Warranty', '#6ee7f9');
  if (/\$\s?50 oil/i.test(text)) add('lof50', '💵 $50 LOF', '#4ade80', 'Online $50 oil change special');
  if (/\btow/i.test(text)) add('tow', '🚚 Tow-in', '#fb923c');
  if (/pre[\s-]?pa(y|id)/i.test(text)) add('prepay', '💳 Prepaid', '#4ade80');
  if (/\bother\b/i.test(a.vehicle || '') || (a.vehicle && !/hyundai|genesis/i.test(a.vehicle))) add('nonhyundai', '🚙 Non-Hyundai', '#94a3b8');
  if (a.comments) add('comment', '💬 Customer comment', '#93c5fd', a.comments);
  return tags;
}

// Fewest deferred services (biggest first) that get this RO to the Add'l
// Hrs/RO goal. See appointmentList.js → "Sell to goal" for where hours come from.
export function sellToGoal(d, hoursByCode, goal) {
  if (!d || !(goal > 0)) return null;
  const inst = [];
  for (const i of d.items || []) {
    for (let k = 0; k < (i.count || 1); k++) {
      // Hours worked out at upload win; older uploads fall back to the menu.
      const h = i.h > 0 ? i.h : (hoursByCode || {})[String(i.code).toUpperCase()];
      inst.push({ code: i.code, label: i.desc || i.code, vague: !i.desc, h: h > 0 ? h : null, est: !!(i.h > 0 && i.est) });
    }
  }
  const unknown = inst.filter(x => x.h == null);
  if (unknown.length && d.hours > 0) {
    const known = inst.reduce((s, x) => s + (x.h || 0), 0);
    const each = Math.max(0, d.hours - known) / unknown.length;
    if (each > 0) unknown.forEach(x => { x.h = each; x.est = true; });
  }
  const usable = inst.filter(x => x.h > 0)
    .sort((a, b) => (a.vague - b.vague) || (b.h - a.h));
  if (!usable.length) return null;
  const pick = [];
  let sum = 0;
  for (const x of usable) {
    if (sum >= goal - 1e-9) break;
    pick.push(x); sum += x.h;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  // Per service line: its hours (each) and how many of it are in the pick.
  const perItem = {};
  for (const x of inst) if (x.h > 0) perItem[x.code] = { h: r1(x.h), est: x.est, picked: 0 };
  for (const x of pick) perItem[x.code].picked++;
  return {
    goal, reached: sum >= goal - 1e-9, sum: r1(sum), perItem,
    pick: pick.map(x => ({ ...x, h: r1(x.h) })), est: pick.some(x => x.est),
    short: r1(Math.max(0, goal - sum)), all: pick.length === usable.length,
  };
}
