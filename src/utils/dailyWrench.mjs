// The Daily Wrench — the facts half.
//
// Everything the morning report says about numbers is computed here, in one
// place, from the same files the dashboard reads. The AI is handed these facts
// and writes the words; it is never asked to do arithmetic or to recall a
// figure, because a coaching note that quietly invents an hours number is
// worse than no note at all.
//
// Used by scripts/daily-wrench.cjs (the 9am Action) and importable by the app
// if a screen ever wants the same numbers without the prose.

import { evaluateRo, roAgeOf, prettyRoStatus } from './roSeverity.js';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const first = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const num = (v, fb = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };
const round = (n, p = 1) => Math.round(n * 10 ** p) / 10 ** p;

// ── Open repair orders ───────────────────────────────────────────────────────
// ro-status.json is the DMS open-RO export. roSeverity already encodes which
// ones deserve attention and why (dispatch overdue, stalled, unpaid…), so the
// report reuses it rather than inventing a second opinion.
export function openRoFacts(rows, advisorFirst) {
  const mine = (rows || []).filter(r => !advisorFirst || first(r.advisor) === advisorFirst);
  const scored = mine.map(r => {
    const ev = evaluateRo(r) || {};
    return {
      ro: String(r.ro || ''),
      vehicle: r.vehicle || '',
      tech: r.tech || '',
      age: roAgeOf(r),
      status: prettyRoStatus(r.roStatus),
      cpStatus: prettyRoStatus(r.cpStatus),
      warranty: !!r.warranty,
      severity: ev.sev || 0,
      reason: ev.tag || '',
      advice: ev.msg || '',
    };
  });
  const ages = scored.map(r => r.age).filter(a => Number.isFinite(a));
  const bucket = (lo, hi) => scored.filter(r => Number.isFinite(r.age) && r.age >= lo && (hi == null || r.age <= hi)).length;
  return {
    total: scored.length,
    oldestDays: ages.length ? Math.max(...ages) : 0,
    averageDays: ages.length ? round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0,
    buckets: { today: bucket(0, 0), days1to2: bucket(1, 2), days3to5: bucket(3, 5), days6plus: bucket(6, null) },
    // What the advisor should actually touch first, worst to least.
    attention: scored.filter(r => r.severity > 0).sort((a, b) => b.severity - a.severity || (b.age || 0) - (a.age || 0)).slice(0, 12),
  };
}

// ── Stalled work and manager notes ───────────────────────────────────────────
// ro-attention.json carries the notes managers leave on an RO ("waiting on back
// order parts"). An RO with a note that is still open is the definition of
// stalled work the advisor owes someone an answer on.
export function stalledFacts(attention, openRos, advisorFirst) {
  const open = new Set((openRos || []).map(r => String(r.ro)));
  const out = [];
  for (const [ro, rec] of Object.entries((attention && attention.ros) || {})) {
    if (advisorFirst && first(rec.advisor) !== advisorFirst) continue;
    if (!open.has(String(ro))) continue;                 // closed since the note — not stalled any more
    const notes = (rec.notes || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const last = notes[0];
    out.push({
      ro: String(ro),
      vehicle: rec.vehicle || '',
      flagged: !!rec.flagged,
      lastNote: last ? last.text : '',
      lastNoteBy: last ? last.by : '',
      daysSinceNote: last && last.at ? Math.floor((Date.now() - last.at) / 86400000) : null,
    });
  }
  return out.sort((a, b) => (b.daysSinceNote || 0) - (a.daysSinceNote || 0)).slice(0, 10);
}

// ── Parts that have landed ───────────────────────────────────────────────────
// The tech WIP boards mark partsArrived when the counter books them in. A job
// with parts sitting on the shelf and no appointment is the cheapest hours an
// advisor will book all day, so it gets its own section.
export function partsFacts(wipByTech, advisorFirst) {
  const ready = [];
  for (const [tech, rows] of Object.entries(wipByTech || {})) {
    for (const r of rows || []) {
      if (!r || !r.partsArrived) continue;
      if (advisorFirst && first(r.advisor) !== advisorFirst) continue;
      ready.push({
        ro: String(r.ro || ''), vehicle: r.vehicle || '', tech,
        job: r.jobDesc || '', note: r.notes || '',
        arrived: r.partsArrivedDate || '', highPriority: !!r.highPriority,
      });
    }
  }
  return ready.slice(0, 12);
}

// Which days this month don't count against an advisor's pace. Mirrors
// advisorOffDates() in utils/calculations.js — that module is Vite-only (it
// imports without file extensions), and the 9am Action runs in plain Node, so
// the rule is restated here. Keep the two in step.
const OFF_STATUSES = ['holiday', 'vacation', 'training', 'off'];
export function offDatesFor(name, year, month, schedules, vacations) {
  const set = new Set();
  const f = first(name);
  if (!f) return set;
  const sched = (schedules && schedules[f]) || {};
  const holidays = (schedules && schedules.__HOLIDAY__) || {};
  const vacs = (vacations || []).filter(v =>
    first(v.name) === f && String(v.status || '').toLowerCase() !== 'denied' && v.dateStart && v.dateEnd);
  const dim = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === 0) continue;
    const k = `${year}-${pad(month + 1)}-${pad(d)}`;
    const cell = String(sched[k] || '').trim().toLowerCase();
    const isSchedOff = OFF_STATUSES.includes(cell);
    const hasShift = cell !== '' && !isSchedOff;
    const inVacation = vacs.some(v => k >= v.dateStart && k <= v.dateEnd);
    const isUnscheduledSat = dt.getDay() === 6 && !hasShift;
    if (isSchedOff || holidays[k] || inVacation || isUnscheduledSat) set.add(k);
  }
  return set;
}

// ── Hours: where they are and what today has to look like ────────────────────
// Mirrors the pacing the Advisor Forecast page shows: month goal, MTD, the
// working days left (Sundays and scheduled days off excluded) and therefore the
// hours today has to carry.
export function hoursFacts({ goals, offKeys, today = new Date() }) {
  const mk = monthKey(today);
  const bucket = (goals && goals[mk]) || {};
  const days = bucket.days || {};
  const goal = num(bucket.hoursGoal, 0);
  const tk = dayKey(today);

  // The grid stores a month-to-date running total per day, so MTD is the latest
  // entry on or before today, not a sum of the rows.
  const keys = Object.keys(days).filter(k => k <= tk).sort();
  const mtd = keys.length ? num(days[keys[keys.length - 1]].hours, 0) : 0;
  const lastEntryDay = keys.length ? keys[keys.length - 1] : null;
  const prevKey = keys.length > 1 ? keys[keys.length - 2] : null;
  const yesterdayHours = lastEntryDay && prevKey ? round(mtd - num(days[prevKey].hours, 0)) : null;
  const yesterdayHrsRo = lastEntryDay ? num(days[lastEntryDay].hrsRo, 0) : null;

  const off = offKeys || new Set();
  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  let total = 0, elapsed = 0, remaining = 0;
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(today.getFullYear(), today.getMonth(), d);
    if (dt.getDay() === 0) continue;
    const k = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(d)}`;
    if (off.has(k)) continue;
    total += 1;
    if (k < tk) elapsed += 1; else remaining += 1;
  }
  if (!goal || !total) return { goal, mtd, hasGoal: false };

  const dailyTarget = goal / total;
  const expectedByNow = dailyTarget * elapsed;
  const remainingHours = Math.max(0, goal - mtd);
  return {
    hasGoal: true,
    goal: round(goal),
    mtd: round(mtd),
    hrsRoGoal: num(bucket.hrsRoGoal, 0) || null,
    yesterdayHours,
    yesterdayHrsRo: yesterdayHrsRo ? round(yesterdayHrsRo, 2) : null,
    workingDaysTotal: total,
    workingDaysElapsed: elapsed,
    workingDaysLeft: remaining,
    dailyTarget: round(dailyTarget),
    expectedByNow: round(expectedByNow),
    aheadBy: round(mtd - expectedByNow),
    onPace: mtd >= expectedByNow,
    // What today actually has to produce to finish the month on goal.
    neededToday: round(remaining > 0 ? remainingHours / remaining : 0),
    percentOfGoal: goal > 0 ? Math.round((mtd / goal) * 100) : 0,
  };
}

// ── Big-Money LOF standing ───────────────────────────────────────────────────
export function contestFacts(bigMoney, advisorFirst) {
  const contest = (bigMoney && bigMoney.contest) || {};
  const latest = (bigMoney && bigMoney.latest) || {};
  const standings = latest.standings || [];
  const tk = dayKey();
  const live = !!(contest.start && contest.end && tk >= contest.start && tk <= contest.end);
  if (!live || !standings.length) return { live: false };

  const board = standings.map(r => ({ name: r.name, hrsRo: r.hrsRo, rate: r.rate, qualified: !!r.qualified, rank: r.rank }));
  const me = advisorFirst ? board.find(r => r.name === advisorFirst) : null;
  const goals = latest.goals || {};
  const leader = board[0] || null;
  return {
    live: true,
    asOf: latest.date || null,
    endsOn: contest.end,
    daysLeft: Math.max(0, Math.ceil((new Date(contest.end + 'T23:59:59') - new Date()) / 86400000)),
    prize: num(contest.prize, 0),
    reducedPrize: num(contest.reducedPrize, 0),
    goals: { hrsRo: num(goals.hrs_ro, 0), addRate: num(goals.add_rate, 0) },
    board,
    me: me ? {
      ...me,
      hrsRoGap: round(num(goals.hrs_ro, 0) - me.hrsRo, 2),
      rateGap: round(num(goals.add_rate, 0) - me.rate, 3),
      behindLeaderHrsRo: leader ? round(leader.hrsRo - me.hrsRo, 2) : 0,
    } : null,
  };
}

// ── Wins ─────────────────────────────────────────────────────────────────────
// Something real and recent to open on. Only things that actually happened —
// an empty list is fine and the writer is told to say so plainly.
export function winFacts({ hours, contest, advisor, openRos }) {
  const wins = [];
  if (hours.hasGoal && hours.onPace) wins.push({ kind: 'pace', detail: `${hours.aheadBy} hours ahead of pace with ${hours.workingDaysLeft} working days left` });
  if (hours.yesterdayHours != null && hours.hasGoal && hours.yesterdayHours >= hours.dailyTarget) {
    wins.push({ kind: 'yesterday', detail: `Booked ${hours.yesterdayHours} hours yesterday against a ${hours.dailyTarget} daily target` });
  }
  if (hours.yesterdayHrsRo && hours.hrsRoGoal && hours.yesterdayHrsRo >= hours.hrsRoGoal) {
    wins.push({ kind: 'hrsRo', detail: `Hours per RO ${hours.yesterdayHrsRo} on the last reported day, goal ${hours.hrsRoGoal}` });
  }
  if (contest.live && contest.me) {
    if (contest.me.qualified) wins.push({ kind: 'contest', detail: `Qualified in Big-Money LOF at #${contest.me.rank}` });
    else if (contest.me.rank === 1) wins.push({ kind: 'contest', detail: 'Leading the Big-Money board even though the goals are not both hit yet' });
  }
  if (advisor) {
    const pairs = [['align', 'Alignment', 10], ['tires', 'Tires', 15], ['valvoline', 'Valvoline', 25]];
    for (const [k, label, goal] of pairs) {
      const v = num(advisor[k], 0) * (num(advisor[k], 0) <= 1 ? 100 : 1);
      if (v >= goal) wins.push({ kind: 'penetration', detail: `${label} at ${round(v)}% against a ${goal}% goal` });
    }
  }
  if (openRos.total && !openRos.buckets.days6plus) wins.push({ kind: 'clean', detail: 'Nothing on the open RO list older than five days' });
  return wins.slice(0, 5);
}

// ── One advisor's pack ───────────────────────────────────────────────────────
export function advisorPack({ name, roStatus, attention, wipByTech, goals, offKeys, bigMoney, advisorRow, today = new Date() }) {
  const f = first(name);
  const rows = (roStatus && roStatus.rows) || [];
  const mine = rows.filter(r => first(r.advisor) === f);
  const openRos = openRoFacts(rows, f);
  const hours = hoursFacts({ goals, offKeys, today });
  const contest = contestFacts(bigMoney, f);
  return {
    advisor: f,
    date: dayKey(today),
    openRos,
    stalled: stalledFacts(attention, mine, f),
    partsReady: partsFacts(wipByTech, f),
    hours,
    contest,
    wins: winFacts({ hours, contest, advisor: advisorRow, openRos }),
    penetration: advisorRow ? {
      hrsRo: num(advisorRow.hours_per_ro, 0),
      align: num(advisorRow.align, 0), tires: num(advisorRow.tires, 0), valvoline: num(advisorRow.valvoline, 0),
      asr: num(advisorRow.asr, 0), csi: num(advisorRow.csi, 0), roCount: num(advisorRow.ro_count, 0),
    } : null,
  };
}

// ── The shop pack a manager gets ─────────────────────────────────────────────
// Everything an advisor sees, but across the floor, plus the money forecast and
// the technician side — the full picture in one place.
export function managerPack({ roStatus, attention, wipByTech, bigMoney, data, forecast, advisorPacks, today = new Date() }) {
  const rows = (roStatus && roStatus.rows) || [];
  const shopOpen = openRoFacts(rows, null);
  const mk = monthKey(today);
  const fc = (forecast && forecast[mk]) || {};
  const actuals = fc.actuals || {};
  const tk = dayKey(today);
  const earned = Object.entries(actuals).filter(([k]) => k <= tk).reduce((s, [, v]) => s + num(v, 0), 0);
  const goal = num(fc.forecast, 0);

  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  let totalDays = 0, leftDays = 0;
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(today.getFullYear(), today.getMonth(), d);
    if (dt.getDay() === 0) continue;
    totalDays += 1;
    if (`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(d)}` >= tk) leftDays += 1;
  }

  const techs = (data && data.technicians || []).filter(t => t && t.name && !t.hidden).map(t => ({
    name: t.name, goal: num(t.goal, 0), total: num(t.total, 0),
    pct: num(t.goal, 0) > 0 ? Math.round((num(t.total, 0) / num(t.goal, 0)) * 100) : 0,
    pacing: num(t.pacing, 0),
  }));

  return {
    date: tk,
    shopOpenRos: shopOpen,
    stalledShopWide: stalledFacts(attention, rows, null),
    partsReadyShopWide: partsFacts(wipByTech, null).length,
    money: {
      forecast: round(goal), earned: round(earned),
      remaining: round(Math.max(0, goal - earned)),
      percentOfForecast: goal > 0 ? Math.round((earned / goal) * 100) : 0,
      workingDaysLeft: leftDays, workingDaysTotal: totalDays,
      neededPerDay: leftDays > 0 ? round(Math.max(0, goal - earned) / leftDays) : 0,
      lastYear: round(num(fc.lastYear, 0)),
    },
    technicians: {
      list: techs,
      hoursTotal: round(techs.reduce((s, t) => s + t.total, 0)),
      goalTotal: round(techs.reduce((s, t) => s + t.goal, 0)),
      behind: techs.filter(t => t.pct < 50).map(t => t.name),
    },
    contest: contestFacts(bigMoney, null),
    advisors: (advisorPacks || []).map(p => ({
      advisor: p.advisor,
      openRos: p.openRos.total, oldestDays: p.openRos.oldestDays, needsAttention: p.openRos.attention.length,
      stalled: p.stalled.length, partsReady: p.partsReady.length,
      hours: p.hours.hasGoal ? { mtd: p.hours.mtd, goal: p.hours.goal, onPace: p.hours.onPace, aheadBy: p.hours.aheadBy, neededToday: p.hours.neededToday, percentOfGoal: p.hours.percentOfGoal } : null,
      contestRank: p.contest.live && p.contest.me ? p.contest.me.rank : null,
      qualified: p.contest.live && p.contest.me ? p.contest.me.qualified : null,
    })),
  };
}

// ── Prompts ──────────────────────────────────────────────────────────────────
// The model returns JSON, not prose, so the page can lay it out properly and a
// missing section never leaves a half-written sentence on screen.
const VOICE = `You are the service manager's right hand at a Hyundai dealership, writing one
advisor's morning briefing. You have been doing this job for twenty years: you
are direct, you never pad, and you talk the way a good manager talks on the
drive lane — plain words, specific numbers, no corporate filler and no
cheerleading that isn't earned.

Hard rules:
- Use ONLY the numbers in the data given. Never estimate, never invent an RO
  number, a customer, an hours figure or a rank. If something isn't there, say
  nothing about it.
- Be specific. "RO 780924 has sat six days waiting on a CEL diagnosis" beats
  "some ROs are aging".
- Coach, don't scold. Name the one or two things that would actually move the
  day, and say why they matter in money or hours.
- Wins are only wins if the data shows them. If there are none, skip the
  praise entirely rather than manufacturing it.
- No markdown, no emoji, no headings inside the text fields. Plain sentences.`;

export function advisorPrompt(pack, { advisorDisplay, weekday } = {}) {
  return `${VOICE}

Write ${advisorDisplay || pack.advisor}'s briefing for ${weekday || 'today'}, ${pack.date}.

DATA (JSON):
${JSON.stringify(pack, null, 1)}

Return ONLY a JSON object, no code fence, shaped exactly like this:
{
  "headline": "six to ten words that set the tone for the day",
  "opening": "two or three sentences: where they stand this morning and what today has to look like",
  "wins": [{"title": "short", "detail": "one sentence, with the number"}],
  "focus": [{"title": "short action", "detail": "one or two sentences saying exactly what to do and why it pays"}],
  "watchlist": [{"ro": "RO number", "what": "what is wrong or waiting", "action": "the next move"}],
  "contest": "two sentences on their Big-Money standing and the gap to close, or empty string if no contest is live",
  "closing": "one sentence to send them out the door"
}
At most three wins, three focus items and five watchlist rows. Skip any array that the data doesn't support by returning it empty.`;
}

export function managerPrompt(pack, { weekday } = {}) {
  return `${VOICE}

You are writing the SERVICE MANAGER's own morning report for ${weekday || 'today'}, ${pack.date}.
This one is the whole floor, not one advisor: the money forecast, where the
month lands if nothing changes, which advisors need a push and which repair
orders are costing the shop hours right now.

DATA (JSON):
${JSON.stringify(pack, null, 1)}

Return ONLY a JSON object, no code fence, shaped exactly like this:
{
  "headline": "six to ten words on the state of the shop",
  "opening": "three or four sentences: the month's money position, pace, and what today has to produce",
  "forecast": "two or three sentences on the gross forecast — earned, remaining, per day needed, and whether that is realistic given the days left",
  "wins": [{"title": "short", "detail": "one sentence with the number"}],
  "advisorNotes": [{"advisor": "FIRSTNAME", "note": "one or two sentences: where they are and the one thing to push them on today"}],
  "watchlist": [{"ro": "RO number", "what": "what is wrong", "action": "who needs to do what"}],
  "technicians": "two sentences on tech hours and pacing, or empty string if there is nothing to say",
  "closing": "one sentence on the priority for the day"
}
Cover every advisor in the data in advisorNotes. At most three wins and six watchlist rows.`;
}
