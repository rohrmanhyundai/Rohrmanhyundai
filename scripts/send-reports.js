#!/usr/bin/env node
/**
 * Auto Send-to-Reports script
 * Runs nightly at 11pm EST via GitHub Actions.
 * Reads dashboard data and saves performance snapshots for all advisors and techs.
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR  = path.join(__dirname, '..', 'public', 'data');
const DATA_FILE   = path.join(PUBLIC_DIR, 'data.json');
const REPORTS_DIR = path.join(PUBLIC_DIR, 'performance-reports');

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

    const entry = {
      date:      techWeek.weekStart,
      label:     techWeek.label,
      weekStart: techWeek.weekStart,
      weekEnd:   techWeek.weekEnd,
      type:      'tech',
      savedAt:   now.toISOString(),
      autoSaved: true,
      total:     t.total,
      goal:      t.goal,
      goal_pct:  t.goal_pct,
      pacing:    t.pacing,
      mon:       t.mon,
      tue:       t.tue,
      wed:       t.wed,
      thu:       t.thu,
      fri:       t.fri,
      sat:       t.sat,
    };

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
