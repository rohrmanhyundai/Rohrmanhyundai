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

  // Load schedules for vacation detection
  const schedules = readJSON(SCHEDULES_FILE) || {};

  /**
   * Returns an object { mon, tue, wed, thu, fri, sat } where each key
   * holds the vacation bonus hours (8) for that day in the given week,
   * based on schedules.json entries with value "vacation".
   */
  function getVacationHours(techName, weekStart, weekEnd) {
    const techSchedule = schedules[techName.toUpperCase()] || schedules[techName] || {};
    const DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']; // 0=Sun offset below
    const bonus = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    // Iterate each date in the week (Sat–Fri)
    const start = new Date(weekStart + 'T00:00:00');
    const end   = new Date(weekEnd   + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      if (techSchedule[iso] === 'vacation') {
        const dow = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
        if (dow === 6) bonus.sat += 8;
        else if (dow === 1) bonus.mon += 8;
        else if (dow === 2) bonus.tue += 8;
        else if (dow === 3) bonus.wed += 8;
        else if (dow === 4) bonus.thu += 8;
        else if (dow === 5) bonus.fri += 8;
        // Sunday is not a typical work day — skip
      }
    }
    return bonus;
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

    const vac = getVacationHours(username, techWeek.weekStart, techWeek.weekEnd);
    const vacTotal = vac.mon + vac.tue + vac.wed + vac.thu + vac.fri + vac.sat;

    const entry = {
      date:      techWeek.weekStart,
      label:     techWeek.label,
      weekStart: techWeek.weekStart,
      weekEnd:   techWeek.weekEnd,
      type:      'tech',
      savedAt:   now.toISOString(),
      autoSaved: true,
      total:     (parseFloat(t.total) || 0) + vacTotal,
      goal:      t.goal,
      goal_pct:  t.goal_pct,
      pacing:    t.pacing,
      mon:       (parseFloat(t.mon) || 0) + vac.mon,
      tue:       (parseFloat(t.tue) || 0) + vac.tue,
      wed:       (parseFloat(t.wed) || 0) + vac.wed,
      thu:       (parseFloat(t.thu) || 0) + vac.thu,
      fri:       (parseFloat(t.fri) || 0) + vac.fri,
      sat:       (parseFloat(t.sat) || 0) + vac.sat,
    };
    if (vacTotal > 0) {
      entry.vacationHours = vacTotal;
      console.log(`    🏖 ${username}: +${vacTotal}h vacation added (${JSON.stringify(vac)})`);
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
