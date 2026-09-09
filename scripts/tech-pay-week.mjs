#!/usr/bin/env node
/**
 * Tech pay week snapshot — runs nightly at 11pm ET via GitHub Actions.
 *
 * Keeps the CURRENT week's record up to date for every technician with a pay
 * plan, so a week is never lost if it is never formally closed out. Closing the
 * week out on the Tech Hours board writes the final, adjusted figures and marks
 * the record closed; this job then leaves it alone.
 *
 * The pay math is IMPORTED from the same module the page uses — a second copy
 * here would drift, and two different answers about someone's pay is worse than
 * no history at all.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildWeekRecord, planIsSet } from '../src/utils/techPay.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR  = path.join(__dirname, '..', 'public', 'data');
const DATA_FILE   = path.join(PUBLIC_DIR, 'data.json');
const PLANS_FILE  = path.join(PUBLIC_DIR, 'tech-pay.json');
const HISTORY_DIR = path.join(PUBLIC_DIR, 'tech-pay-history');

// Two years of weeks. Small enough that a browser downloads it without noticing.
const KEEP_WEEKS = 104;

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function main() {
  const raw = readJSON(DATA_FILE, null);
  const data = raw && raw.data ? raw.data : raw;
  if (!data || !Array.isArray(data.technicians)) {
    console.error('Could not read technicians from data.json — nothing snapshotted.');
    process.exit(1);
  }
  const plans = readJSON(PLANS_FILE, {}) || {};

  // The workflow runs `git add` on this directory. If no tech has a pay plan yet
  // it would otherwise not exist, `git add` would fail on the missing path, and
  // the step would take the other nightly snapshots down with it.
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  let written = 0, skipped = 0;
  for (const tech of data.technicians) {
    const name = String(tech.name || '').trim().toUpperCase();
    if (!name) continue;

    // No pay plan means no pay to record. A week of $0.00 in someone's history
    // would read as "you earned nothing", which isn't what it means.
    if (!planIsSet(plans[name])) continue;

    const record = buildWeekRecord(tech, plans[name]);
    const file = path.join(HISTORY_DIR, `${name}.json`);
    const history = readJSON(file, {}) || {};

    // A week the manager has already closed out is final — their adjusted
    // numbers stand, whatever the board says afterwards.
    if (history[record.weekStart] && history[record.weekStart].closed) { skipped++; continue; }

    history[record.weekStart] = { ...history[record.weekStart], ...record };

    const weeks = Object.keys(history).sort();
    for (const w of weeks.slice(0, Math.max(0, weeks.length - KEEP_WEEKS))) delete history[w];

    writeJSON(file, history);
    written++;
  }
  console.log(`Tech pay week snapshot: ${written} updated, ${skipped} already closed.`);
}

main();
