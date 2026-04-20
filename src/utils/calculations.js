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

export function recalcTech(data) {
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
  const count = data.advisors.length || 1;
  data.advisorSummary.total_hours = data.advisors.reduce((s, a) => s + safe(a.mtd_hours, 0), 0);
  data.advisorSummary.align = data.advisors.reduce((s, a) => s + safe(a.align, 0), 0) / count;
  data.advisorSummary.tires = data.advisors.reduce((s, a) => s + safe(a.tires, 0), 0) / count;
  data.advisorSummary.valvoline = data.advisors.reduce((s, a) => s + safe(a.valvoline, 0), 0) / count;
  data.advisorSummary.csi = data.advisors.reduce((s, a) => s + safe(a.csi, 0), 0) / count;
}

export function buildGaugeData(data) {
  const gpPct = safe(data.grossGoal, 0) > 0 ? safe(data.grossActual, 0) / safe(data.grossGoal, 0) : 0;
  const cpPct = safe(data.cpGoal, 0) > 0 ? safe(data.cpActual, 0) / safe(data.cpGoal, 0) : 0;

  const gauges = [
    { label: 'Pacing Gross Profit Goal', pct: gpPct, main: (gpPct * 100).toFixed(1) + '%', sub: '$' + safe(data.grossActual, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' / $' + safe(data.grossGoal, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { label: 'Pacing Customer Pay Goal', pct: cpPct, main: (cpPct * 100).toFixed(1) + '%', sub: '$' + safe(data.cpActual, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' / $' + safe(data.cpGoal, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) },
  ];

  data.advisors.slice(0, 3).forEach(a => {
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
