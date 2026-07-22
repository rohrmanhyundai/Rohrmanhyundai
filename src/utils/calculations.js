import { safe } from './formatters';

export function advisorMonthProgress(data) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
  const dim = new Date(y, m + 1, 0).getDate();

  let completed = 0;
  let total = 0;
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(y, m, d).getDay();
    if (dow !== 0) {
      total += 1;
      if (d < today) completed += 1;
    }
  }

  const override = safe(data.advisorMonthlyWorkdays, 0);
  if (override > 0) total = override;

  return { completed: Math.max(1, completed), total: Math.max(1, total) };
}

// True once the current month has at least one completed (non-Sunday) workday
// before today. Numbers are reported a day behind, so on the 1st this is false —
// meaning any advisor MTD still on the dashboard is last month's, not this
// month's, and should read as empty until the first day's numbers come in.
export function advisorMonthStarted() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
  for (let d = 1; d < today; d++) {
    if (new Date(y, m, d).getDay() !== 0) return true;
  }
  return false;
}

// Current-month cumulative fields that should read empty before the month starts.
const MONTH_METRIC_FIELDS = ['mtd_hours', 'daily_avg', 'hours_per_ro', 'align', 'tires', 'valvoline', 'roh50_hrs_ro', 'csi', 'asr', 'elr', 'ro_count', 'coupon_labor', 'total_sales', 'coupon_usage_pct'];

// Advisors for display: before the month has started, zero the current-month
// metrics (keep name + last_month_total) so a new month reads empty instead of
// carrying last month's totals. Self-corrects once the first day is entered.
export function advisorsForDisplay(data) {
  const advisors = (data && data.advisors) || [];
  if (advisorMonthStarted()) return advisors;
  return advisors.map(a => { const c = { ...a }; MONTH_METRIC_FIELDS.forEach(f => { c[f] = 0; }); return c; });
}

export function advisorDailyAverage(advisor, data) {
  const p = advisorMonthProgress(data);
  return p.completed > 0 ? safe(advisor.mtd_hours, 0) / p.completed : 0;
}

export function advisorProjectedHours(advisor, data) {
  const p = advisorMonthProgress(data);
  return advisorDailyAverage(advisor, data) * p.total;
}

export function advisorGoalPct(advisor, data) {
  const projected = advisorProjectedHours(advisor, data);
  const goal = 300;
  return goal > 0 ? projected / goal : 0;
}

// Returns ISO date strings (YYYY-MM-DD) for Mon..Sat of the current week (local time).
export function currentWeekDates() {
  const out = {};
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  // Monday of this week
  const monday = new Date(now);
  const diff = dow === 0 ? -6 : 1 - dow;
  monday.setDate(now.getDate() + diff);
  ['mon','tue','wed','thu','fri','sat'].forEach((k, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out[k] = `${yyyy}-${mm}-${dd}`;
  });
  return out;
}

const OFF_STATUSES = ['holiday', 'vacation', 'training', 'off'];

// Local YYYY-MM-DD (no UTC shift) so it matches the schedule/vacation keys.
function isoLocal(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// The set of dates (YYYY-MM-DD) a given advisor is NOT expected to produce in a
// month, so the Goals / Day-End pace + projection never count time off as a miss.
// A day is "off" when it's:
//   • a company holiday (schedules.__HOLIDAY__),
//   • marked off / vacation / training on the advisor's schedule,
//   • inside an approved vacation range in `vacations`, or
//   • a Saturday the advisor isn't scheduled to work (no shift that day) —
//     Saturdays are a rotating day, so they only count when actually scheduled.
// Sundays are never working days and are excluded upstream.
export function advisorOffDates(name, year, month, schedules, vacations) {
  const set = new Set();
  const first = (name || '').toUpperCase().split(/\s+/)[0];
  if (!first) return set;
  const sched = (schedules && schedules[first]) || {};
  const holidays = (schedules && schedules.__HOLIDAY__) || {};
  const vacs = (vacations || []).filter(v =>
    (v.name || '').toUpperCase().split(/\s+/)[0] === first &&
    String(v.status || '').toLowerCase() !== 'denied' &&
    v.dateStart && v.dateEnd);
  const dim = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === 0) continue; // Sundays aren't working days anyway
    const k = isoLocal(dt);
    const cell = String(sched[k] || '').trim().toLowerCase();
    const isSchedOff = OFF_STATUSES.includes(cell);
    const hasShift = cell !== '' && !isSchedOff; // an actual scheduled work shift
    const isHoliday = !!holidays[k];
    const inVacation = vacs.some(v => k >= v.dateStart && k <= v.dateEnd);
    // Saturday only counts when the advisor is actually scheduled to work it.
    const isUnscheduledSat = dt.getDay() === 6 && !hasShift;
    if (isSchedOff || isHoliday || inVacation || isUnscheduledSat) set.add(k);
  }
  return set;
}

// If a tech's calendar marks a day as Holiday/Vacation/Training (or a shop-wide
// __HOLIDAY__ is set for that date), inject 8.0 hours into that day on the
// dashboard when no hours have been entered.
export function applyScheduleHours(data, schedules) {
  if (!schedules || !data?.technicians) return;
  const dates = currentWeekDates();
  const shopHolidays = schedules.__HOLIDAY__ || {};
  data.technicians.forEach(t => {
    const sched = schedules[(t.name || '').toUpperCase()] || {};
    const overrides = t.hoursOverride || {};
    ['mon','tue','wed','thu','fri','sat'].forEach(day => {
      const date = dates[day];
      if (overrides[date]) return; // user manually entered a value for this date
      const raw = String(sched[date] || '').trim().toLowerCase();
      const isShopHoliday = !!shopHolidays[date];
      const isOff = isShopHoliday || OFF_STATUSES.includes(raw);
      if (isOff && safe(t[day], 0) === 0) {
        t[day] = 8;
      }
    });
  });
}

export function recalcTech(data, schedules) {
  applyScheduleHours(data, schedules);
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let totalGoal = 0, weekTotal = 0;
  const totals = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };

  data.technicians.forEach(t => {
    t.total = 0;
    days.forEach(k => {
      t[k] = safe(t[k], 0);
      t.total += t[k];
      totals[k] += t[k];
    });
    t.goal = safe(t.goal, 0);
    totalGoal += t.goal;
    weekTotal += t.total;
    t.goal_pct = t.goal > 0 ? t.total / t.goal : 0;

    // Count days this tech actually has hours entered — avoids calendar-day
    // edge cases that caused pacing to show 0 or wildly inflated numbers.
    const workedSat = t.sat > 0;
    const totalWorkdays = workedSat ? 6 : 5;
    const daysWorked = ['mon','tue','wed','thu','fri'].filter(d => t[d] > 0).length
                     + (workedSat ? 1 : 0);
    t.pacing = daysWorked > 0 ? (t.total / daysWorked) * totalWorkdays : 0;
  });

  Object.assign(data.techTotals, totals);
  data.techTotals.week_total = weekTotal;
  data.techTotals.week_pct = totalGoal > 0 ? weekTotal / totalGoal : 0;
  data.techTotals.shop_pacing = data.technicians.reduce((s, t) => s + safe(t.pacing, 0), 0);
}

export function recalcAdvisorSummary(data) {
  // A new hire who isn't selling yet still belongs on the dashboard, but their
  // zeros would drag every shop average down and make the whole team look like
  // it's missing goal. Advisors flagged "Don't apply to dashboard" are left out
  // of the AVERAGES — out of the total AND the divisor, so the remaining
  // advisors average against their own count.
  //
  // Hours stay a full sum of everyone: a sum isn't distorted by a zero, and the
  // shop's hours should reflect every hour actually produced.
  const counted = data.advisors.filter(a => !a.exclude_from_avg);
  const count = counted.length || 1;
  data.advisorSummary.total_hours = data.advisors.reduce((s, a) => s + safe(a.mtd_hours, 0), 0);
  data.advisorSummary.align = counted.reduce((s, a) => s + safe(a.align, 0), 0) / count;
  data.advisorSummary.tires = counted.reduce((s, a) => s + safe(a.tires, 0), 0) / count;
  data.advisorSummary.valvoline = counted.reduce((s, a) => s + safe(a.valvoline, 0), 0) / count;
  data.advisorSummary.csi = counted.reduce((s, a) => s + safe(a.csi, 0), 0) / count;
}

export function buildGaugeData(data) {
  const gpPct = safe(data.grossGoal, 0) > 0 ? safe(data.grossActual, 0) / safe(data.grossGoal, 0) : 0;
  const cpPct = safe(data.cpGoal, 0) > 0 ? safe(data.cpActual, 0) / safe(data.cpGoal, 0) : 0;

  const gauges = [
    { label: 'Pacing Gross Profit Goal', pct: gpPct, main: (gpPct * 100).toFixed(1) + '%', sub: '$' + safe(data.grossActual, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' / $' + safe(data.grossGoal, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { label: 'Pacing Customer Pay Goal', pct: cpPct, main: (cpPct * 100).toFixed(1) + '%', sub: '$' + safe(data.cpActual, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' / $' + safe(data.cpGoal, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) },
  ];

  advisorsForDisplay(data).filter(a => !a.hidden).slice(0, 3).forEach(a => {
    const progress = advisorMonthProgress(data);
    const dailyAvg = advisorDailyAverage(a, data);
    const projected = advisorProjectedHours(a, data);
    const goalHours = 300;
    const p = advisorGoalPct(a, data);
    gauges.push({
      label: a.name + ' Projected Hours',
      pct: p,
      main: projected.toFixed(1) + ' hrs',
      sub: dailyAvg.toFixed(1) + ' daily avg \u00d7 ' + progress.total.toFixed(0) + ' workdays \u2022 goal ' + goalHours.toFixed(1) + ' hrs',
    });
  });

  return gauges;
}
