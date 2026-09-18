// Big-Money LOF coaching — the math behind "Your Game Plan" and the prompt for
// the AI "Coach's Note". Pure functions, no imports, so the contest page (Vite)
// and the nightly GitHub Action (Node) share one copy.
//
// The contest numbers, in Shawn's words: the "$50 add-on" is any ADDITIONAL
// customer-pay labor line of 0.1 hrs or more on a repair order that has the
// $50 oil change. So:
//   $50 Add Rate %     = share of $50-oil-change ROs that got an add-on line
//   $50 Add'l Hrs/RO   = add-on labor hours per $50-oil-change RO
// Both are month-to-date on the dashboard, which is what the contest judges.

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const pct = (v) => (Number(v || 0) * 100).toFixed(1) + '%';
const num2 = (v) => Number(v || 0).toFixed(2);

// Business days (Mon–Sat) strictly before `today` in its month = completed
// days the MTD figures cover (the dashboard is reported a day behind), and the
// business days from `today` through `end` (inclusive) still to be worked.
export function contestDays(today, end) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let done = 0;
  for (let d = 1; d < t.getDate(); d++) if (new Date(t.getFullYear(), t.getMonth(), d).getDay() !== 0) done++;
  const monthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  let last = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : monthEnd;
  if (last > monthEnd) last = monthEnd;   // MTD figures reset at month end
  let left = 0;
  for (let d = new Date(t); d <= last; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) left++;
  return { done: Math.max(1, done), left };
}

// The rate you must run for the REST of the window to land the month-to-date
// figure on goal. Because MTD = (done·current + left·needed)/(done+left), the
// number of oil changes cancels out — we never need to know how many LOFs a
// day the advisor writes.
//   → { needed, reachable } ; needed is the per-remaining-day average required
export function neededPace(current, goal, done, left) {
  if (!(goal > 0)) return { needed: 0, reachable: true };
  if (left <= 0) return { needed: current >= goal ? 0 : Infinity, reachable: current >= goal };
  const needed = (goal * (done + left) - current * done) / left;
  return { needed: Math.max(0, needed), reachable: needed <= 1.0 || goal > 1 }; // rates can't exceed 100%
}

// Store average if this advisor's number were exactly on goal (everyone else
// as-is). Rows = standings rows with inAvg flags.
export function storeIfOnGoal(rows, name, key, goal) {
  const counted = (rows || []).filter(r => r.inAvg !== false);
  if (!counted.length) return 0;
  const sum = counted.reduce((s, r) => s + (r.name === name ? goal : Number(r[key] || 0)), 0);
  return sum / counted.length;
}

// Snapshot history → last-7-days movement on a field (MTD values, so we report
// "a week ago vs now", not daily sales).
export function weekTrend(entries, key) {
  const sorted = [...(entries || [])].filter(e => e && e.date && e[key] != null && e[key] !== '').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (sorted.length < 2) return null;
  const now = Number(sorted[0][key]);
  const weekAgo = sorted.find(e => new Date(sorted[0].date) - new Date(e.date) >= 6 * 86400000) || sorted[sorted.length - 1];
  const then = Number(weekAgo[key]);
  return { now, then, thenDate: weekAgo.date, delta: now - then };
}

// ── The game plan ─────────────────────────────────────────────────────────────
// row      : this advisor's standings row {name, display, hrsRo, rate, hitHrs, hitRate, qualified, leader, rank, inAvg}
// board    : { rows, goals:{hrs_ro, add_rate}, store:{hrsRo, rate, hit,...} }
// contest  : { start, end } ISO dates
// entries  : this advisor's daily snapshot history
// extras   : { align, tires, asr, ro_count, tickets, oil_only } from the dashboard record (optional)
//            tickets = $50 oil-change ROs MTD, oil_only = those with no add-on
export function gamePlan({ row, board, contest, entries = [], extras = {}, today = new Date() }) {
  const goals = board.goals || {};
  const end = contest && contest.end ? new Date(contest.end + 'T00:00:00') : null;
  const { done, left } = contestDays(today, end);
  const rateNeed = neededPace(row.rate, goals.add_rate, done, left);
  const hrsNeed  = neededPace(row.hrsRo, goals.hrs_ro, done, left);
  // With the add-on board's ticket counts the pace becomes a countable number
  // of add-ons: tickets/day so far × days left = oil changes still to write.
  const tickets = Number(extras.tickets) > 0 ? Number(extras.tickets) : null;
  const oilOnly = tickets != null && extras.oil_only != null ? Number(extras.oil_only) : null;
  const lofPerDay = tickets != null ? tickets / done : null;
  const lofLeft = lofPerDay != null ? Math.round(lofPerDay * left) : null;
  const addOnsNeeded = lofLeft != null && rateNeed.reachable && goals.add_rate > 0 ? Math.ceil(rateNeed.needed * lofLeft) : null;
  const addOnsPerDay = addOnsNeeded != null && left > 0 ? Math.ceil(addOnsNeeded / left) : null;
  const leader = (board.rows || []).find(r => r.leader) || null;
  const storeRateIf = storeIfOnGoal(board.rows, row.name, 'rate', goals.add_rate);
  const storeHrsIf  = storeIfOnGoal(board.rows, row.name, 'hrsRo', goals.hrs_ro);
  const rateTrend = weekTrend(entries, 'roh50_add_rate');
  const hrsTrend  = weekTrend(entries, 'roh50_hrs_ro');

  const lines = [];   // { icon, title, text, tone: 'good'|'push'|'info' }

  // 1. The gap, as the pace they need from here.
  if (goals.add_rate > 0) {
    if (row.hitRate) lines.push({ icon: '✅', tone: 'good', title: `Add rate ${pct(row.rate)} — on goal`,
      text: `Keep the add-on on at least ${pct(goals.add_rate)} of your $50 oil changes through ${left} more working day${left === 1 ? '' : 's'} and it holds.` });
    else if (left <= 0) lines.push({ icon: '⏱️', tone: 'push', title: `Add rate ${pct(row.rate)} vs ${pct(goals.add_rate)} goal`, text: 'The window is closed — this one is banked.' });
    else if (!rateNeed.reachable) lines.push({ icon: '🎯', tone: 'push', title: `Add rate ${pct(row.rate)} vs ${pct(goals.add_rate)} goal`,
      text: `With ${left} working day${left === 1 ? '' : 's'} left the month-to-date can't reach ${pct(goals.add_rate)} even at 100% — but every add-on still lifts the store average, and that's what unlocks the full prize for whoever wins.` });
    else lines.push({ icon: '🎯', tone: 'push', title: `Add rate ${pct(row.rate)} → ${pct(goals.add_rate)} goal`,
      text: addOnsNeeded != null
        ? `You're writing about ${lofPerDay.toFixed(1)} $50 oil changes a day, so roughly ${lofLeft} more this window. You need the add-on on ${addOnsNeeded} of them — about ${addOnsPerDay} a day (${pct(rateNeed.needed)} of them). One extra customer-pay line of 0.1 hr or more is all it takes to count.`
        : `From here you need the add-on on about ${pct(rateNeed.needed)} of your $50 oil changes for the remaining ${left} working day${left === 1 ? '' : 's'}. One extra customer-pay line of 0.1 hr or more is all it takes to count.` });
  }
  if (goals.hrs_ro > 0) {
    if (row.hitHrs) lines.push({ icon: '✅', tone: 'good', title: `Add'l hrs/RO ${num2(row.hrsRo)} — on goal`,
      text: `That's the number that decides the winner. Protect it: keep each add-on worth its labor (rotation + brake inspection, filters, alignment check).` });
    else if (left > 0) lines.push({ icon: '🔧', tone: 'push', title: `Add'l hrs/RO ${num2(row.hrsRo)} → ${num2(goals.hrs_ro)} goal`,
      text: `You need to average about ${num2(hrsNeed.needed)} add-on hours per $50 oil change over the remaining ${left} day${left === 1 ? '' : 's'}. ${hrsNeed.needed > 1 ? 'That means bigger lines — pair services rather than one small item.' : 'Bundle: a rotation with a brake inspection, or two filters, gets you there in one conversation.'}` });
  }

  // 2. What kind of problem it is.
  if (goals.add_rate > 0 && goals.hrs_ro > 0) {
    if (!row.hitRate && row.hitHrs) lines.push({ icon: '📣', tone: 'info', title: 'You sell big — now sell more often',
      text: 'When you add on, the hours are there. The miss is consistency: build the add-on into every $50 oil change write-up before the customer leaves the lane.' });
    else if (row.hitRate && !row.hitHrs) lines.push({ icon: '📦', tone: 'info', title: "You're consistent — make each add-on bigger",
      text: 'You get the yes; the lines are small. Present a pair (rotation + brake inspection, cabin + engine filter, alignment check with tires) so the average add-on carries more labor.' });
    else if (!row.hitRate && !row.hitHrs) lines.push({ icon: '🚀', tone: 'info', title: 'Rate first, hours follow',
      text: 'Start simple: one recommended customer-pay line of 0.1+ hr on every $50 oil change. Once that habit is automatic, upgrade the recommendation.' });
    else lines.push({ icon: '🏁', tone: 'good', title: 'Qualified — now it\'s about the hrs/RO race',
      text: leader && leader.name !== row.name ? `${leader.display} leads at ${num2(leader.hrsRo)}; you're ${num2(Math.max(0, leader.hrsRo - row.hrsRo))} behind. Bigger add-ons, not more of them, close that gap.` : 'You\'re leading. Don\'t let a busy day go by without the add-on.' });
  }

  // 2b. The oil-only tickets are the whole story in one number.
  if (oilOnly != null && oilOnly > 0 && !row.hitRate) lines.push({ icon: '🛢️', tone: 'push', title: `${oilOnly} of ${tickets} oil changes left with nothing added`,
    text: `Each of those was a customer already in the lane, already paying — and one 0.1-hr line short of counting. ${goals.add_rate > 0 ? `At goal you'd have no more than ${Math.floor(tickets * (1 - goals.add_rate))} oil-only tickets on ${tickets}.` : ''}` });

  // 3. Where the add-on lines can come from (their own upsell numbers).
  const ideas = [];
  if (extras.align != null && extras.align < 0.10) ideas.push(`alignment checks (you're at ${pct(extras.align)} vs 10%)`);
  if (extras.tires != null && extras.tires < 0.15) ideas.push(`tire rotation / tires (${pct(extras.tires)} vs 15%)`);
  if (extras.asr != null && extras.asr < 0.21) ideas.push(`ASR items you're already inspecting (${pct(extras.asr)} vs 21%)`);
  if (ideas.length) lines.push({ icon: '💡', tone: 'info', title: 'Easy add-on lines you\'re leaving on the table', text: `Your own numbers point at ${ideas.join(', ')}. Each is a natural 0.1+ hr customer-pay line on a $50 oil change.` });

  // 4. Trend.
  if (rateTrend && Math.abs(rateTrend.delta) >= 0.005) lines.push({ icon: rateTrend.delta > 0 ? '📈' : '📉', tone: rateTrend.delta > 0 ? 'good' : 'push',
    title: `Add rate ${rateTrend.delta > 0 ? 'up' : 'down'} ${pct(Math.abs(rateTrend.delta))} since ${rateTrend.thenDate}`, text: rateTrend.delta > 0 ? 'Whatever you changed this week is working — keep doing it.' : 'The month-to-date slipped this week. Reset tomorrow: add-on on the first $50 oil change of the day.' });
  else if (hrsTrend && Math.abs(hrsTrend.delta) >= 0.02) lines.push({ icon: hrsTrend.delta > 0 ? '📈' : '📉', tone: hrsTrend.delta > 0 ? 'good' : 'push',
    title: `Add'l hrs/RO ${hrsTrend.delta > 0 ? 'up' : 'down'} ${num2(Math.abs(hrsTrend.delta))} since ${hrsTrend.thenDate}`, text: hrsTrend.delta > 0 ? 'Bigger add-ons are landing. Nice.' : 'Add-ons got smaller this week — go back to pairing services.' });

  // 5. Team.
  if (goals.add_rate > 0 && !row.hitRate && board.store && !board.store.hitRate) lines.push({ icon: '🤝', tone: 'info', title: 'What you do moves the whole store',
    text: `If you get to ${pct(goals.add_rate)}, the store add rate goes from ${pct(board.store.rate)} to ${pct(storeRateIf)}${storeRateIf >= goals.add_rate ? ' — over goal, and that unlocks the full prize' : ''}.` });
  else if (goals.hrs_ro > 0 && !row.hitHrs && board.store && !board.store.hitHrs) lines.push({ icon: '🤝', tone: 'info', title: 'What you do moves the whole store',
    text: `At ${num2(goals.hrs_ro)} add'l hrs/RO you'd lift the store from ${num2(board.store.hrsRo)} to ${num2(storeHrsIf)}.` });

  return { done, left, rateNeed, hrsNeed, leader, storeRateIf, storeHrsIf, rateTrend, hrsTrend, tickets, oilOnly, lofPerDay, lofLeft, addOnsNeeded, addOnsPerDay, lines };
}

// ── Prompt for the AI Coach's Note ────────────────────────────────────────────
export function coachPrompt({ row, board, contest, entries = [], extras = {}, prizes = {}, today = new Date() }) {
  const plan = gamePlan({ row, board, contest, entries, extras, today });
  const goals = board.goals || {};
  const recent = [...(entries || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 21)
    .map(e => `  ${e.date}  addRate=${e.roh50_add_rate != null ? pct(e.roh50_add_rate) : '—'}  addlHrs/RO=${e.roh50_hrs_ro != null ? num2(e.roh50_hrs_ro) : '—'}  tickets=${e.lof_tickets ?? '—'}  oilOnly=${e.lof_oil_only ?? '—'}  ROs=${e.ro_count ?? '?'}  hrs/RO=${e.hours_per_ro != null ? num2(e.hours_per_ro) : '—'}  align=${e.align != null ? pct(e.align) : '—'}  tires=${e.tires != null ? pct(e.tires) : '—'}  asr=${e.asr != null ? pct(e.asr) : '—'}`)
    .join('\n');
  const standings = (board.rows || []).map(r => `  #${r.rank} ${r.display}: addRate=${pct(r.rate)} addlHrs/RO=${num2(r.hrsRo)} ${r.leader ? '(LEADER)' : r.qualified ? '(qualified)' : ''}`).join('\n');
  const first = String(row.display || row.name || '').trim();
  const name = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();

  return `You are a sharp, encouraging service manager at a Hyundai dealership writing a short daily coaching note to service advisor ${name} for the "Big-Money LOF" contest.

WHAT THE CONTEST MEASURES (use these definitions exactly):
- The "$50 add-on" = any ADDITIONAL customer-pay labor line of 0.1 hours or more on a repair order that has the $50 oil change.
- "$50 Add Rate %" = share of $50-oil-change ROs that got an add-on line. Goal: ${goals.add_rate > 0 ? pct(goals.add_rate) : 'not set'}.
- "$50 Add'l Hrs/RO" = add-on labor hours per $50-oil-change RO. Goal: ${goals.hrs_ro > 0 ? num2(goals.hrs_ro) : 'not set'}.
- Both are month-to-date. Rules: meet BOTH goals to qualify; highest Add'l Hrs/RO among the qualified wins; ties go to the higher add rate. The winner gets ${prizes.full ? '$' + prizes.full : 'the full prize'} only if the STORE AVERAGE is on goal for both numbers — otherwise ${prizes.reduced != null ? '$' + prizes.reduced : 'a reduced prize'}. So every advisor's numbers matter to everyone.

WHERE ${name.toUpperCase()} STANDS TODAY (${today.toISOString().slice(0, 10)}):
- Add rate ${pct(row.rate)} (${row.hitRate ? 'ON goal' : 'under goal'}), add'l hrs/RO ${num2(row.hrsRo)} (${row.hitHrs ? 'ON goal' : 'under goal'}), rank #${row.rank} of ${(board.rows || []).length}${row.leader ? ' — LEADING' : row.qualified ? ' — qualified' : ' — not yet qualified'}.
- Working days completed this month: ${plan.done}. Working days left in the contest: ${plan.left}.
- To land on goal from here: add-on needed on about ${goals.add_rate > 0 ? pct(Math.min(1, plan.rateNeed.needed)) : '—'} of remaining $50 oil changes; about ${goals.hrs_ro > 0 ? num2(plan.hrsNeed.needed) : '—'} add-on hrs per $50 oil change for the rest of the window.
- Store average: add rate ${board.store ? pct(board.store.rate) : '—'} (${board.store && board.store.hitRate ? 'on goal' : 'under goal'}), add'l hrs/RO ${board.store ? num2(board.store.hrsRo) : '—'} (${board.store && board.store.hitHrs ? 'on goal' : 'under goal'}). If ${name} hit the add-rate goal the store would be at ${pct(plan.storeRateIf)}.
- Add-on board: ${plan.tickets != null ? `${plan.tickets} $50 oil-change tickets MTD, ${plan.oilOnly ?? '?'} of them oil-only (no add-on) — about ${plan.lofPerDay.toFixed(1)} oil changes a day, so roughly ${plan.lofLeft} more in the window; ${plan.addOnsNeeded != null ? `needs the add-on on ${plan.addOnsNeeded} of those (~${plan.addOnsPerDay} a day)` : 'the rate goal is out of reach this month even at 100%'}` : 'ticket counts not uploaded yet'}.
- Other upsell numbers: alignment ${extras.align != null ? pct(extras.align) : '—'} (goal 10%), tires ${extras.tires != null ? pct(extras.tires) : '—'} (goal 15%), ASR ${extras.asr != null ? pct(extras.asr) : '—'} (goal 21%), MTD ROs ${extras.ro_count ?? '—'}.

STANDINGS:
${standings}

RECENT DAILY SNAPSHOTS (month-to-date values, newest first; "—" = not captured that day):
${recent || '  (none yet)'}

Write the note in this exact Markdown shape, under 140 words total, second person, energetic but honest, no fluff, no generic sales advice — every line must reference one of the numbers above or the add-on definition:

**Today's read:** one sentence on where ${name} stands and the trend.
- 💪 one specific thing that's working (cite a number)
- 🎯 the single biggest lever right now, with the exact pace needed — when ticket counts are available say it as a count ("add-on on 3 more oil changes a day"), not just a percentage
- 🤝 how it moves the store average / the money
**This week's challenge:** one concrete, countable action (e.g. "add-on on the first $50 oil change every morning", "pair the rotation with a brake inspection on 3 LOFs a day").`;
}
