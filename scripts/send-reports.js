#!/usr/bin/env node
/**
 * Auto Send-to-Reports script
 * Runs nightly at 11pm EST via GitHub Actions.
 * Reads dashboard data and saves performance snapshots for all advisors and techs.
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR     = path.join(__dirname, '..', 'public', 'data');
const DATA_FILE      = path.join(PUBLIC_DIR, 'data.json');
const SCHEDULES_FILE = path.join(PUBLIC_DIR, 'schedules.json');
const REPORTS_DIR    = path.join(PUBLIC_DIR, 'performance-reports');

// ── Helpers ────────────────────────────────────────────────────────────────────
function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function toISO(d) {
  return d.toISOString().split('T')[0];
}

function fmtLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Week runs Sat–Fri. Numbers entered day-behind:
 *   Monday  → previous week (Sat–Fri that just ended)
 *   Tue–Sun → current week in progress
 */
function getTechWeekRange(now) {
  const dow = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  let weekStart, weekEnd;
  if (dow === 1) {
    // Monday: previous week
    weekEnd   = new Date(now); weekEnd.setDate(now.getDate() - 3);   // Fri
    weekStart = new Date(now); weekStart.setDate(now.getDate() - 9); // Sat
  } else {
    // Tue–Sun: current week
    const daysSinceSat = (dow - 6 + 7) % 7;
    weekStart = new Date(now); weekStart.setDate(now.getDate() - daysSinceSat);
    weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  }
  return {
    label:     `Week of ${fmtLabel(weekStart)} – ${fmtLabel(weekEnd)}`,
    weekStart: toISO(weekStart),
    weekEnd:   toISO(weekEnd),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  // Run in EST (UTC-5) — GitHub Actions passes TZ=America/New_York
  const now = new Date();
  console.log(`Running at ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET)`);

  const raw = readJSON(DATA_FILE);
  if (!raw || !raw.data) { console.error('Could not read data.json'); process.exit(1); }

  const { advisors = [], technicians = [] } = raw.data;
  const today     = toISO(now);
  const monthKey  = today.slice(0, 7);
  const advLabel  = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const techWeek  = getTechWeekRange(now);

  // Load schedules for vacation/training/holiday detection
  const schedules = readJSON(SCHEDULES_FILE) || {};
  const holidays  = schedules['__HOLIDAY__'] || {}; // { "2026-05-25": "holiday", ... }

  // Values in schedules.json that count as 8h for reporting
  const BONUS_TYPES = new Set(['vacation', 'training', 'holiday']);

  /**
   * Returns { bonus: { mon,tue,wed,thu,fri,sat }, breakdown: { vacation, training, holiday } }
   * for a tech over a given week. Checks tech's own schedule + global holidays.
   */
  function getBonusHours(techName, weekStart, weekEnd) {
    const techSchedule = schedules[techName.toUpperCase()] || schedules[techName] || {};
    const bonus     = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    const breakdown = { vacation: 0, training: 0, holiday: 0 };

    const start = new Date(weekStart + 'T00:00:00');
    const end   = new Date(weekEnd   + 'T00:00:00');

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      // Holiday takes priority; then tech's own schedule
      const val = holidays[iso] === 'holiday' ? 'holiday' : techSchedule[iso];
      if (!BONUS_TYPES.has(val)) continue;

      const dow = d.getDay();
      let dayKey = null;
      if      (dow === 6) dayKey = 'sat';
      else if (dow === 1) dayKey = 'mon';
      else if (dow === 2) dayKey = 'tue';
      else if (dow === 3) dayKey = 'wed';
      else if (dow === 4) dayKey = 'thu';
      else if (dow === 5) dayKey = 'fri';
      if (!dayKey) continue; // skip Sunday

      bonus[dayKey]   += 8;
      breakdown[val]  += 8;
    }
    return { bonus, breakdown };
  }

  let saved = 0;

  // ── Advisors ──────────────────────────────────────────────────────────────
  for (const a of advisors) {
    if (!a.name) continue;
    const username  = a.name.toUpperCase();
    const filePath  = path.join(REPORTS_DIR, `${username}.json`);
    const existing  = readJSON(filePath) || [];

    const entry = {
      date:             today,
      label:            advLabel,
      month:            monthKey,
      type:             'advisor',
      savedAt:          now.toISOString(),
      autoSaved:        true,
      csi:              a.csi,
      hours_per_ro:     a.hours_per_ro,
      mtd_hours:        a.mtd_hours,
      daily_avg:        a.daily_avg,
      align:            a.align,
      tires:            a.tires,
      valvoline:        a.valvoline,
      asr:              a.asr,
      elr:              a.elr,
      last_month_total: a.last_month_total,
    };

    // Replace same-day entry if it exists, otherwise prepend
    const updated = [entry, ...existing.filter(e => e.date !== today)];
    updated.sort((a, b) => new Date(b.date) - new Date(a.date));
    writeJSON(filePath, updated);
    console.log(`  ✓ Advisor ${username}: saved ${today}`);
    saved++;
  }

  // ── Technicians ──────────────────────────────────────────────────────────
  for (const t of technicians) {
    if (!t.name) continue;
    const username = t.name.toUpperCase();
    const filePath = path.join(REPORTS_DIR, `${username}.json`);
    const existing = readJSON(filePath) || [];

    const { bonus, breakdown } = getBonusHours(username, techWeek.weekStart, techWeek.weekEnd);
    const bonusTotal = bonus.mon + bonus.tue + bonus.wed + bonus.thu + bonus.fri + bonus.sat;

    const entry = {
      date:      techWeek.weekStart,
      label:     techWeek.label,
      weekStart: techWeek.weekStart,
      weekEnd:   techWeek.weekEnd,
      type:      'tech',
      savedAt:   now.toISOString(),
      autoSaved: true,
      total:     (parseFloat(t.total) || 0) + bonusTotal,
      goal:      t.goal,
      goal_pct:  t.goal_pct,
      pacing:    t.pacing,
      mon:       (parseFloat(t.mon) || 0) + bonus.mon,
      tue:       (parseFloat(t.tue) || 0) + bonus.tue,
      wed:       (parseFloat(t.wed) || 0) + bonus.wed,
      thu:       (parseFloat(t.thu) || 0) + bonus.thu,
      fri:       (parseFloat(t.fri) || 0) + bonus.fri,
      sat:       (parseFloat(t.sat) || 0) + bonus.sat,
    };
    if (bonusTotal > 0) {
      if (breakdown.vacation > 0) entry.vacationHours = breakdown.vacation;
      if (breakdown.training > 0) entry.trainingHours = breakdown.training;
      if (breakdown.holiday  > 0) entry.holidayHours  = breakdown.holiday;
      console.log(`    🏖 ${username}: +${bonusTotal}h bonus (vac:${breakdown.vacation} train:${breakdown.training} hol:${breakdown.holiday})`);
    }

    // Replace same-week entry (keyed by weekStart), otherwise prepend
    const updated = [entry, ...existing.filter(e => e.date !== techWeek.weekStart)];
    updated.sort((a, b) => new Date(b.date) - new Date(a.date));
    writeJSON(filePath, updated);
    console.log(`  ✓ Tech ${username}: saved ${techWeek.label}`);
    saved++;
  }

  console.log(`\nDone. ${saved} employee snapshots saved.`);
}

main();
