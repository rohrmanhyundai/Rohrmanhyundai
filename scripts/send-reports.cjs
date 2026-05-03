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
  // Use local date components (not UTC) so 11pm ET doesn't roll into the next UTC day
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

function fmtLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Week runs Sat–Fri.
 *   Sat / Sun / Mon → previous completed week (numbers still being finalized)
 *   Tue – Fri       → current week in progress
 */
function getTechWeekRange(now) {
  const dow = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  let weekStart, weekEnd;
  if (dow === 6 || dow === 0 || dow === 1) {
    // Sat/Sun/Mon: report on the week that just ended (last Fri back to Sat)
    const daysSinceFri = (dow - 5 + 7) % 7 || 7;
    weekEnd   = new Date(now); weekEnd.setDate(now.getDate() - daysSinceFri);   // last Fri
    weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 6);   // Sat before
  } else {
    // Tue–Fri: current week in progress (find most recent Sat)
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
  const techWeek  = getTechWeekRange(now);

  // Advisor reporting follows the same Sat/Sun/Mon → previous-completed-week rule
  // as techs: snapshots stay dated to last Friday until Tuesday, so weekend runs
  // don't roll into the next week and don't pile up duplicate rows.
  const dowAdv     = now.getDay();
  const advReportDate = (dowAdv === 6 || dowAdv === 0 || dowAdv === 1)
    ? new Date(techWeek.weekEnd + 'T12:00:00')
    : now;
  const today     = toISO(advReportDate);
  const monthKey  = today.slice(0, 7);
  const advLabel  = advReportDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

  // Load schedules for vacation/training/holiday detection
  const schedules = readJSON(SCHEDULES_FILE) || {};
  const holidays  = schedules['__HOLIDAY__'] || {}; // { "2026-05-25": "holiday", ... }

  // Build a set of vacation dates per tech from data.json vacations list (fallback source)
  // so that vacations entered in the Approved Vacation panel but not yet synced still count
  const vacationDatesByTech = {}; // { "GAVEN": Set(["2026-05-04", ...]), ... }
  for (const v of (raw.data.vacations || raw.vacations || [])) {
    if (!v.name || !v.dateStart || !v.dateEnd) continue;
    const name = v.name.toUpperCase();
    if (!vacationDatesByTech[name]) vacationDatesByTech[name] = new Set();
    const s = new Date(v.dateStart + 'T00:00:00');
    const e = new Date(v.dateEnd   + 'T00:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      vacationDatesByTech[name].add(toISO(d));
    }
  }

  // Values in schedules.json that count as 8h for reporting
  const BONUS_TYPES = new Set(['vacation', 'training', 'holiday']);

  /**
   * Returns { bonus: { mon,tue,wed,thu,fri,sat }, breakdown: { vacation, training, holiday } }
   * for a tech over a given week. Checks:
   *   1. Global __HOLIDAY__ dates
   *   2. Tech's schedules.json entries ("vacation" / "training")
   *   3. data.json vacations list (fallback — catches vacations not yet synced to calendar)
   */
  function getBonusHours(techName, weekStart, weekEnd) {
    const techSchedule  = schedules[techName.toUpperCase()] || schedules[techName] || {};
    const techVacDates  = vacationDatesByTech[techName.toUpperCase()] || new Set();
    const bonus     = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    const breakdown = { vacation: 0, training: 0, holiday: 0 };

    const start = new Date(weekStart + 'T00:00:00');
    const end   = new Date(weekEnd   + 'T00:00:00');

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      // Priority: global holiday → schedule entry → data.json vacation list
      let val = null;
      if (holidays[iso] === 'holiday')      val = 'holiday';
      else if (BONUS_TYPES.has(techSchedule[iso])) val = techSchedule[iso];
      else if (techVacDates.has(iso))       val = 'vacation';
      if (!val) continue;

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

    // Replace existing entry for same date OR same label (catches UTC-shifted duplicate dates)
    const updated = [entry, ...existing.filter(e => e.date !== today && e.label !== advLabel)];
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

    // Replace any existing entry whose week overlaps with this one (handles date key shifts)
    const updated = [entry, ...existing.filter(e => {
      if (!e.weekStart || !e.weekEnd) return e.date !== techWeek.weekStart;
      return e.weekEnd < techWeek.weekStart || e.weekStart > techWeek.weekEnd;
    })];
    updated.sort((a, b) => new Date(b.date) - new Date(a.date));
    writeJSON(filePath, updated);
    console.log(`  ✓ Tech ${username}: saved ${techWeek.label}`);
    saved++;
  }

  console.log(`\nDone. ${saved} employee snapshots saved.`);
}

main();
