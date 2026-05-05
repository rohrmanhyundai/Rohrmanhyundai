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

  // Skip Saturday and Sunday (ET) — no auto-snapshots on weekends
  const dow = now.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    console.log(`Weekend in ET (dow=${dow}) — skipping auto-send.`);
    return;
  }

  const raw = readJSON(DATA_FILE);
  if (!raw || !raw.data) { console.error('Could not read data.json'); process.exit(1); }

  const { advisors = [], technicians = [] } = raw.data;
  const techWeek  = getTechWeekRange(now);

  // Advisor numbers reflect the previous business day:
  //   Tue–Fri 11pm → yesterday
  //   Mon 11pm     → last Friday
  //   Sat/Sun      → skip (no advisor activity to record)
  const dowAdv = now.getDay(); // 0=Sun … 6=Sat
  let advReportDate = null;
  if (dowAdv >= 2 && dowAdv <= 5) {                  // Tue–Fri
    advReportDate = new Date(now); advReportDate.setDate(now.getDate() - 1);
  } else if (dowAdv === 1) {                         // Mon → last Fri
    advReportDate = new Date(now); advReportDate.setDate(now.getDate() - 3);
  }
  const skipAdvisors = advReportDate === null;
  const today     = skipAdvisors ? toISO(now) : toISO(advReportDate);
  const monthKey  = today.slice(0, 7);
  const advLabel  = skipAdvisors
    ? ''
    : advReportDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

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
  if (skipAdvisors) {
    console.log('Skipping advisor snapshots — no advisor reporting on Sat/Sun.');
  }
  for (const a of skipAdvisors ? [] : advisors) {
    if (!a.name) continue;
    const username  = a.name.toUpperCase();
    const filePath  = path.join(REPORTS_DIR, `${username}.json`);
    const existing  = readJSON(filePath) || [];

    // If a snapshot for this report-date already exists (e.g. the user pushed
    // the numbers manually in the morning), leave it alone — auto-run is just
    // a safety net for forgotten days.
    const alreadySaved = existing.some(e => e.date === today);
    if (alreadySaved) {
      console.log(`  • Advisor ${username}: snapshot for ${today} already exists — skipping auto-save.`);
      continue;
    }

    const entry = {
      date:             today,
      label:            advLabel,
      month:            monthKey,
      type:             'advisor',
      savedAt:          now.toISOString(),
      autoSaved:        true,
      csi:              a.csi,
      hours_per_ro:     a.hours_per_ro,
      roh50_hrs_ro:     a.roh50_hrs_ro,
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

    // Skip if a snapshot for this week was already saved today (manager already pushed it)
    const todayISO = toISO(now);
    const alreadySavedToday = existing.some(e =>
      e.weekStart === techWeek.weekStart &&
      e.savedAt && e.savedAt.slice(0, 10) === todayISO
    );
    if (alreadySavedToday) {
      console.log(`  • Tech ${username}: snapshot for ${techWeek.label} already saved today — skipping auto-save.`);
      continue;
    }

    const { bonus, breakdown } = getBonusHours(username, techWeek.weekStart, techWeek.weekEnd);
    const bonusTotal = bonus.mon + bonus.tue + bonus.wed + bonus.thu + bonus.fri + bonus.sat;

    // Per-day totals after vacation/training/holiday bonus is added.
    const dayTotals = {
      mon: (parseFloat(t.mon) || 0) + bonus.mon,
      tue: (parseFloat(t.tue) || 0) + bonus.tue,
      wed: (parseFloat(t.wed) || 0) + bonus.wed,
      thu: (parseFloat(t.thu) || 0) + bonus.thu,
      fri: (parseFloat(t.fri) || 0) + bonus.fri,
      sat: (parseFloat(t.sat) || 0) + bonus.sat,
    };
    const adjustedTotal = (parseFloat(t.total) || 0) + bonusTotal;
    const goalNum       = parseFloat(t.goal) || 0;

    // Recompute pacing using the same logic as the dashboard's recalcTech,
    // so vacation/training/holiday days count toward the projection.
    const workedSat       = dayTotals.sat > 0;
    const totalWorkdays   = workedSat ? 6 : 5;
    const daysWorked      = ['mon','tue','wed','thu','fri'].filter(d => dayTotals[d] > 0).length
                          + (workedSat ? 1 : 0);
    const adjustedPacing  = daysWorked > 0 ? (adjustedTotal / daysWorked) * totalWorkdays : 0;
    const adjustedGoalPct = goalNum > 0 ? adjustedTotal / goalNum : 0;

    const entry = {
      date:      techWeek.weekStart,
      label:     techWeek.label,
      weekStart: techWeek.weekStart,
      weekEnd:   techWeek.weekEnd,
      type:      'tech',
      savedAt:   now.toISOString(),
      autoSaved: true,
      total:     adjustedTotal,
      goal:      t.goal,
      goal_pct:  adjustedGoalPct,
      pacing:    adjustedPacing,
      mon:       dayTotals.mon,
      tue:       dayTotals.tue,
      wed:       dayTotals.wed,
      thu:       dayTotals.thu,
      fri:       dayTotals.fri,
      sat:       dayTotals.sat,
      mon_ro:    parseFloat(t.mon_ro) || 0,
      tue_ro:    parseFloat(t.tue_ro) || 0,
      wed_ro:    parseFloat(t.wed_ro) || 0,
      thu_ro:    parseFloat(t.thu_ro) || 0,
      fri_ro:    parseFloat(t.fri_ro) || 0,
      sat_ro:    parseFloat(t.sat_ro) || 0,
      total_ro:  (parseFloat(t.mon_ro)||0) + (parseFloat(t.tue_ro)||0) + (parseFloat(t.wed_ro)||0)
              + (parseFloat(t.thu_ro)||0) + (parseFloat(t.fri_ro)||0) + (parseFloat(t.sat_ro)||0),
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
