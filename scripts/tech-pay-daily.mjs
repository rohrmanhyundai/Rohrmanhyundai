#!/usr/bin/env node
/**
 * Tech pay daily snapshot — runs nightly at 11pm ET via GitHub Actions.
 *
 * Records where each technician stood at the end of the day: the hours turned,
 * the rate they were on, and what that was worth. The Tech Hours board is reset
 * at the start of every week, so without this a tech has no way to look back at
 * a week that has already been cleared.
 *
 * The pay math is IMPORTED from the same module the page uses — a second copy
 * here would drift, and two different answers about someone's pay is worse than
 * no history at all.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeTechPay, normalizePlan, planIsSet } from '../src/utils/techPay.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR  = path.join(__dirname, '..', 'public', 'data');
const DATA_FILE   = path.join(PUBLIC_DIR, 'data.json');
const PLANS_FILE  = path.join(PUBLIC_DIR, 'tech-pay.json');
const HISTORY_DIR = path.join(PUBLIC_DIR, 'tech-pay-history');

// Roughly thirteen months, so a tech can look back over a full year and the
// file a browser downloads stays small.
const KEEP_DAYS = 400;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// Local date parts — at 11pm ET a UTC date would already be tomorrow.
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function main() {
  const raw = readJSON(DATA_FILE, null);
  const data = raw && raw.data ? raw.data : raw;
  if (!data || !Array.isArray(data.technicians)) {
    console.error('Could not read technicians from data.json — nothing snapshotted.');
    process.exit(1);
  }
  const plans = readJSON(PLANS_FILE, {}) || {};

  // The nightly workflow runs `git add` on this directory. If no tech has a pay
  // plan yet it would otherwise not exist, `git add` would fail on the missing
  // path, and the step would take the other snapshots down with it.
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const now = new Date();
  const today = localISO(now);
  const dayKey = DAY_KEYS[now.getDay()];
  const cutoff = localISO(new Date(now.getTime() - KEEP_DAYS * 86400000));

  let written = 0;
  for (const tech of data.technicians) {
    const name = String(tech.name || '').trim().toUpperCase();
    if (!name) continue;

    // No pay plan means no pay to record. A row of $0.00 in someone's history
    // would read as "you earned nothing", which isn't what it means.
    if (!planIsSet(plans[name])) continue;

    const plan = normalizePlan(plans[name]);
    const weekHours = Number(tech.total) || 0;
    const dayHours = Number(tech[dayKey]) || 0;
    const paceHours = Number(tech.pacing) || weekHours;
    const banked = computeTechPay(plan, weekHours);
    const pacing = computeTechPay(plan, paceHours);

    // The rate and the dollars are stored, not just the hours: a pay plan edited
    // next month must not rewrite what someone was already told they earned.
    const entry = {
      date: today,
      dayHours: round2(dayHours),
      weekHours: round2(weekHours),
      paceHours: round2(paceHours),
      rate: round2(banked.effRate),
      tier: banked.tier.label,
      banked: round2(banked.gross),
      pacing: round2(pacing.gross),
      payType: plan.payType,
      capturedAt: now.toISOString(),
    };

    const file = path.join(HISTORY_DIR, `${name}.json`);
    const history = readJSON(file, {}) || {};
    history[today] = entry;

    for (const d of Object.keys(history)) if (d < cutoff) delete history[d];

    writeJSON(file, history);
    written++;
  }
  console.log(`Tech pay snapshot for ${today}: ${written} technician(s).`);
}

main();
