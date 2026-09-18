#!/usr/bin/env node
// Big-Money LOF — nightly AI "Coach's Note" for every advisor in the contest.
//
// Runs in the big-money-coaching workflow, fired by the manager's morning
// "Send to Reports" (see requestBigMoneyCoaching in utils/github.js), so every
// advisor gets a note written from the numbers just entered. Reads the
// dashboard + contest files from the checkout (the API writes that Send to
// Reports made are already on main), asks OpenAI for a short note per advisor,
// and writes them into
// public/data/big-money-lof.json under `coaching` through the Contents API
// (the app writes that file from the browser too, so no git commit here).
//
// Needs: OPENAI_API_KEY and GITHUB_TOKEN. Does nothing unless the contest is
// live today.

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public', 'data');
const REPO = process.env.GITHUB_REPOSITORY || 'rohrmanhyundai/Rohrmanhyundai';
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const API = `https://api.github.com/repos/${REPO}/contents/public/data/big-money-lof.json`;
const GH = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rohrman-dashboard' };
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const readJSON = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const safe = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const todayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Mirrors computeStandings() in src/utils/bigMoney.js (that module pulls in
// browser-side helpers, so the ranking is restated here — keep them in step).
function standings(advisors, data) {
  const g = data.roh50_goals || {};
  const goals = { hrs_ro: g.hrs_ro == null ? 1.2 : safe(g.hrs_ro), add_rate: safe(g.add_rate) };
  const goalsSet = goals.hrs_ro > 0 && goals.add_rate > 0;
  const rows = (advisors || []).filter(a => a && a.name && !a.hidden).map(a => {
    const hrsRo = Math.round(safe(a.roh50_hrs_ro) * 100) / 100, rate = Math.round(safe(a.roh50_add_rate) * 1000) / 1000;
    const hitHrs = goals.hrs_ro > 0 && hrsRo >= goals.hrs_ro, hitRate = goals.add_rate > 0 && rate >= goals.add_rate;
    return { name: firstName(a.name), display: a.name, hrsRo, rate, hitHrs, hitRate, qualified: goalsSet && hitHrs && hitRate, inAvg: !a.exclude_from_avg };
  }).sort((x, y) => (y.qualified - x.qualified) || (y.hrsRo - x.hrsRo) || (y.rate - x.rate) || x.name.localeCompare(y.name));
  rows.forEach((r, i) => { r.rank = i + 1; r.leader = r.qualified && i === 0; });
  const counted = rows.filter(r => r.inAvg), n = counted.length || 1;
  const avgHrs = Math.round(counted.reduce((s, r) => s + r.hrsRo, 0) / n * 100) / 100;
  const avgRate = Math.round(counted.reduce((s, r) => s + r.rate, 0) / n * 1000) / 1000;
  const hitHrs = goals.hrs_ro > 0 && avgHrs >= goals.hrs_ro, hitRate = goals.add_rate > 0 && avgRate >= goals.add_rate;
  return { goals, goalsSet, rows, store: { hrsRo: avgHrs, rate: avgRate, hitHrs, hitRate, hit: goalsSet && hitHrs && hitRate } };
}

async function askOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.6 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
}

async function readContest() {
  const res = await fetch(`${API}?ref=${BRANCH}&_=${Date.now()}`, { headers: GH });
  if (res.status === 404) return { sha: null, file: {} };
  if (!res.ok) throw new Error(`GET big-money-lof.json → ${res.status}`);
  const j = await res.json();
  const text = j.content && j.content.trim() ? Buffer.from(j.content.replace(/\s/g, ''), 'base64').toString('utf8') : '{}';
  return { sha: j.sha, file: JSON.parse(text || '{}') };
}

async function writeContest(mutate) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { sha, file } = await readContest();
    const next = mutate(file);
    const res = await fetch(API, { method: 'PUT', headers: { ...GH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Big-Money LOF coaching ${new Date().toISOString()}`, branch: BRANCH, sha: sha || undefined, content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64') }) });
    if (res.ok) return;
    if (res.status === 409 || res.status === 422) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    throw new Error(`PUT big-money-lof.json → ${res.status}`);
  }
  throw new Error('big-money-lof.json kept changing — gave up');
}

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.log('OPENAI_API_KEY not set — skipping Big-Money coaching.'); return; }
  const { coachPrompt } = await import('../src/utils/bigMoneyCoach.mjs');

  const { file } = await readContest();
  const c = file.contest || {};
  const today = new Date();
  const t = todayKey(today);
  if (!c.start || !c.end || t < c.start || t > c.end) { console.log(`Contest not live today (${t}) — nothing to write.`); return; }

  const payload = readJSON(path.join(PUBLIC, 'data.json'), {});
  const data = payload && payload.data ? payload.data : payload;
  const board = standings(data.advisors || [], data);
  if (!board.goalsSet) { console.log('Both $50 goals are not set — skipping coaching.'); return; }
  const prizes = { full: Number(c.prize) || 1000, reduced: c.reducedPrize != null ? Number(c.reducedPrize) || 0 : 500 };

  const notes = {};
  for (const row of board.rows) {
    const adv = (data.advisors || []).find(a => firstName(a.name) === row.name) || {};
    const entries = readJSON(path.join(PUBLIC, 'performance-reports', `${row.name}.json`), []).filter(e => e && e.type === 'advisor');
    const prompt = coachPrompt({ row, board, contest: c, entries, extras: { align: adv.align, tires: adv.tires, asr: adv.asr, ro_count: adv.ro_count, tickets: adv.lof_tickets, oil_only: adv.lof_oil_only }, prizes, today });
    try {
      const text = await askOpenAI(prompt);
      if (text) { notes[row.name] = { text, generatedAt: new Date().toISOString(), date: t, by: 'auto' }; console.log(`✓ ${row.name}`); }
    } catch (e) { console.warn(`✗ ${row.name}: ${e.message}`); }
  }
  if (!Object.keys(notes).length) { console.log('No notes generated.'); return; }
  await writeContest(f => ({ ...f, coaching: { ...(f.coaching || {}), ...notes } }));
  console.log(`Saved ${Object.keys(notes).length} coach's note(s).`);
})().catch(e => { console.error(e); process.exit(1); });
