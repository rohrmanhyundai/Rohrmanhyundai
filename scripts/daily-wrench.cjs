#!/usr/bin/env node
// The Daily Wrench — writes the morning briefings.
//
// Runs in the daily-wrench workflow: on a schedule at 9am Eastern, or early
// when a manager presses "Generate report" (a repository_dispatch from the
// browser). A manager run before 9am replaces that day's report and the 9am
// run then stands down, so nobody gets two different reports in one morning.
//
// One file per day, public/data/daily-wrench/YYYY-MM-DD.json:
//   { date, generatedAt, by, model, advisors: { DAVID: {…} }, manager: {…} }
// plus an index.json so the page can list history without walking the folder.
//
// The numbers come from src/utils/dailyWrench.mjs and are computed here, in
// code. OpenAI is only asked for the words.
//
// Needs: OPENAI_API_KEY, GITHUB_TOKEN.

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public', 'data');
const REPO = process.env.GITHUB_REPOSITORY || 'rohrmanhyundai/Rohrmanhyundai';
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const GH = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
const DIR = 'public/data/daily-wrench';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const REASON = process.env.WRENCH_REASON || '';           // dispatch payload: who asked and why
const TRIGGER = process.env.WRENCH_TRIGGER || 'schedule'; // 'schedule' | 'manual'
const REQUESTED_BY = process.env.WRENCH_BY || '';

const readJSON = (p, fb) => { try { return JSON.parse(fs.readFileSync(path.join(PUBLIC, p), 'utf8')); } catch { return fb; } };
const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const api = (file) => `https://api.github.com/repos/${REPO}/contents/${DIR}/${file}`;

// Eastern-time pieces, so "9am" means 9am on the drive lane whatever the
// runner's clock is set to and whether or not daylight saving is on.
function easternParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'long' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24, weekday: p.weekday };
}

async function getFile(file) {
  const res = await fetch(`${api(file)}?ref=${BRANCH}&_=${Date.now()}`, { headers: GH });
  if (res.status === 404) return { sha: null, json: null };
  if (!res.ok) throw new Error(`GET ${file} → ${res.status}`);
  const j = await res.json();
  const text = j.content && j.content.trim() ? Buffer.from(j.content.replace(/\s/g, ''), 'base64').toString('utf8') : '';
  return { sha: j.sha, json: text ? JSON.parse(text) : null };
}

async function putFile(file, mutate, message) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { sha, json } = await getFile(file);
    const next = mutate(json);
    const res = await fetch(api(file), {
      method: 'PUT', headers: { ...GH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, branch: BRANCH, sha: sha || undefined, content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64') }),
    });
    if (res.ok) return;
    if (res.status === 409 || res.status === 422) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    throw new Error(`PUT ${file} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`${file} kept changing — gave up`);
}

// Ask for the words. The model is told to answer with JSON; anything that
// isn't parseable is dropped rather than shown half-rendered.
async function askOpenAI(prompt, maxTokens) {
  const body = { model: MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } };
  // The gpt-5 family takes max_completion_tokens and fixes temperature at 1.
  if (/^gpt-5|^gpt-6/.test(MODEL)) body.max_completion_tokens = maxTokens;
  else { body.max_tokens = maxTokens; body.temperature = 0.7; }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
  if (!text) throw new Error('OpenAI returned an empty message');
  try { return JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim()); }
  catch { throw new Error(`OpenAI did not return JSON: ${text.slice(0, 200)}`); }
}

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.log('OPENAI_API_KEY not set — skipping.'); return; }
  const W = await import('../src/utils/dailyWrench.mjs');

  const et = easternParts();
  const today = et.date;
  const manual = TRIGGER === 'manual';

  // The schedule fires twice (13:00 and 14:00 UTC) so one of them is 9am
  // Eastern year round; the other one stands down here.
  if (!manual && et.hour !== 9) { console.log(`Scheduled run at ${et.hour}:00 Eastern — not 9am, nothing to do.`); return; }

  const existing = await getFile(`${today}.json`);
  if (!manual && existing.json && existing.json.advisors && Object.keys(existing.json.advisors).length) {
    console.log(`${today} already has a report (generated ${existing.json.generatedAt} by ${existing.json.by}) — standing down.`);
    return;
  }

  // ── Inputs ────────────────────────────────────────────────────────────────
  const payload = readJSON('data.json', {});
  const data = payload && payload.data ? payload.data : payload;
  const vacations = (payload && payload.vacations) || [];
  const roStatus = readJSON('ro-status.json', { rows: [] });
  const attention = readJSON('ro-attention.json', { ros: {} });
  const schedules = readJSON('schedules.json', {});
  const bigMoney = readJSON('big-money-lof.json', {});
  const forecast = readJSON('goal-forecast/service.json', {});
  const users = (readJSON('users.json', { users: [] }).users) || [];

  const wipByTech = {};
  try {
    for (const f of fs.readdirSync(path.join(PUBLIC, 'wip'))) {
      if (f.endsWith('.json')) wipByTech[f.replace(/\.json$/, '')] = readJSON(`wip/${f}`, []);
    }
  } catch { /* no WIP boards yet */ }

  const now = new Date();
  const advisors = (data.advisors || []).filter(a => a && a.name && !a.hidden);
  if (!advisors.length) { console.log('No advisors on the roster — nothing to write.'); return; }

  // ── One pack + one briefing per advisor ───────────────────────────────────
  const out = { date: today, generatedAt: new Date().toISOString(), by: manual ? (REQUESTED_BY || 'manager') : 'auto', trigger: TRIGGER, model: MODEL, reason: REASON, advisors: {}, manager: null };
  const packs = [];

  for (const a of advisors) {
    const name = firstName(a.name);
    const goals = readJSON(`advisor-goals/${name}.json`, {});
    const offKeys = W.offDatesFor(name, now.getFullYear(), now.getMonth(), schedules, vacations);
    const pack = W.advisorPack({ name, roStatus, attention, wipByTech, goals, offKeys, bigMoney, advisorRow: a, today: now });
    packs.push(pack);

    const user = users.find(u => firstName(u.username) === name);
    const display = user ? user.username : name;
    try {
      const report = await askOpenAI(W.advisorPrompt(pack, { advisorDisplay: display, weekday: et.weekday }), 1400);
      out.advisors[name] = { ...report, facts: pack };
      console.log(`✓ ${name}`);
    } catch (e) {
      // A failed write-up shouldn't cost them the numbers — the page renders
      // the facts on their own and says the words are missing.
      out.advisors[name] = { error: e.message, facts: pack };
      console.warn(`✗ ${name}: ${e.message}`);
    }
  }

  // ── The manager's own, deeper report ──────────────────────────────────────
  const mPack = W.managerPack({ roStatus, attention, wipByTech, bigMoney, data, forecast, advisorPacks: packs, today: now });
  try {
    const report = await askOpenAI(W.managerPrompt(mPack, { weekday: et.weekday }), 2200);
    out.manager = { ...report, facts: mPack };
    console.log('✓ manager report');
  } catch (e) {
    out.manager = { error: e.message, facts: mPack };
    console.warn(`✗ manager report: ${e.message}`);
  }

  await putFile(`${today}.json`, () => out, `Daily Wrench ${today}${manual ? ` (early, ${REQUESTED_BY || 'manager'})` : ''}`);
  await putFile('index.json', (cur) => {
    const days = (cur && cur.days) || {};
    days[today] = { generatedAt: out.generatedAt, by: out.by, trigger: out.trigger, advisors: Object.keys(out.advisors), hasManager: !!(out.manager && !out.manager.error) };
    // Two months of history is plenty to look back on and keeps the file small.
    const keep = Object.keys(days).sort().slice(-62);
    return { updatedAt: new Date().toISOString(), days: Object.fromEntries(keep.map(k => [k, days[k]])) };
  }, `Daily Wrench index ${today}`);

  console.log(`Daily Wrench for ${today}: ${Object.keys(out.advisors).length} advisor report(s)${out.manager && !out.manager.error ? ' + manager report' : ''}.`);
})().catch(e => { console.error(e); process.exit(1); });
