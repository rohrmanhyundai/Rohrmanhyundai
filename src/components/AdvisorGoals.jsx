import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { safe } from '../utils/formatters';
import { canonicalAdvisorFirst, firstNameUpper } from '../utils/advisorAliases';
import { advisorOffDates } from '../utils/calculations';
import { loadAdvisorGoals, saveAdvisorGoalsMonth, loadMissingNotes, loadCompletedReviews } from '../utils/github';
import { ensureMtd } from '../utils/advisorGoals';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const num = (n, dec = 1) => safe(n, 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Non-Sunday working dates for a month.
function workingDates(year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) {
    if (new Date(year, month, d).getDay() !== 0) out.push(new Date(year, month, d));
  }
  return out;
}

const dKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Derive everything for one month bucket. `offDates` is the set of YYYY-MM-DD
// the advisor was scheduled off / on vacation / a holiday — those days are left
// out of the working-day math so time off is never a negative reflection.
function computeMetrics(mkStr, bucket, totalDaysOverride, completedOverride, offDates, todayKey) {
  bucket = ensureMtd(bucket); // stored hours/hrsRo are month-to-date running totals
  const [y, m] = String(mkStr).split('-').map(Number);
  const off = offDates instanceof Set ? offDates : new Set(offDates || []);
  const allDates = workingDates(y, (m || 1) - 1);
  const hoursGoal = safe(bucket && bucket.hoursGoal, 0);
  const hrsRoGoal = safe(bucket && bucket.hrsRoGoal, 0);
  const days = (bucket && bucket.days) || {};
  // A day only counts as "off" if it's scheduled off AND has no logged hours —
  // if the advisor actually produced that day, it counts like any working day.
  const dayIsOff = (k) => off.has(k) && !Object.prototype.hasOwnProperty.call(days, k);
  const workDates = allDates.filter(dt => !dayIsOff(dKey(dt)));
  const totalDays = totalDaysOverride || workDates.length;
  let workNum = 0;
  // Walk days in date order tracking the previous entered day's MTD total so we
  // can derive each day's own production (closed = today's MTD − prior MTD) and
  // the latest MTD figure (the true month-to-date total / ratio).
  let prevMtd = 0, lastMtd = 0, lastHrsRo = 0;
  const rows = allDates.map(dt => {
    const k = dKey(dt);
    const isOff = dayIsOff(k);
    if (!isOff) workNum += 1;
    const has = Object.prototype.hasOwnProperty.call(days, k);
    const rec = has ? days[k] : null;
    const hours = has ? safe(rec.hours, 0) : null;   // MTD total as of this day
    const hrsRo = has ? safe(rec.hrsRo, 0) : null;   // MTD hrs/RO as of this day
    let closed = null;                               // hours produced this day
    if (has) {
      closed = safe(hours, 0) - prevMtd;
      prevMtd = safe(hours, 0);
      lastMtd = safe(hours, 0);
      lastHrsRo = safe(hrsRo, 0);
    }
    // A past working day with no entry is a missed report; a backfilled one is
    // corrected. Both persist in the month's grid.
    const missed = !isOff && !has && !!todayKey && k < todayKey;
    return { k, dt, dayNum: workNum, off: isOff, has, hours, hrsRo, closed, missed, late: !!(rec && rec.late), missedReason: rec ? (rec.missedReason || '') : '', cumHours: has ? safe(hours, 0) : null, goalCum: (hoursGoal / Math.max(totalDays, 1)) * workNum };
  });
  const enteredDays = rows.filter(r => r.has).length;
  const completedDays = completedOverride != null ? completedOverride : enteredDays;
  const actualHours = lastMtd; // MTD total = the latest entered day's running total
  const dailyHoursTarget = hoursGoal / Math.max(totalDays, 1);
  const expectedHours = dailyHoursTarget * completedDays;
  const runRate = completedDays > 0 ? actualHours / completedDays : 0;
  const projectedHours = runRate * totalDays;
  const avgHrsRo = lastHrsRo; // latest entered MTD hrs/RO = the current month ratio
  const offDaysCount = rows.filter(r => r.off).length;
  const missedDaysCount = rows.filter(r => r.missed).length;
  const correctedDaysCount = rows.filter(r => r.late).length;
  const label = new Date(y, (m || 1) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { label, dates: workDates, totalDays, hoursGoal, hrsRoGoal, days, rows, enteredDays, completedDays, actualHours, dailyHoursTarget, expectedHours, projectedHours, avgHrsRo, offDaysCount, missedDaysCount, correctedDaysCount };
}

// ── Goal-vs-Actual line chart (dotted goal, solid actual, gradient fill) ──────
function GoalChart({ title, unit, goalPts, actualPts, areaPts, maxVal, xLabels, x, y, lastLabel, accent = '#34d399', accent2 = '#6ee7f9' }) {
  const gid = (unit || 'c').replace(/\W/g, '');
  return (
    <div style={{ marginTop: 18, background: `linear-gradient(160deg, ${accent}1f, rgba(15,23,42,.6) 55%)`, border: `1px solid ${accent}40`, borderRadius: 18, padding: '18px 22px', boxShadow: `0 12px 34px -16px ${accent}80` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ width: 4, height: 18, borderRadius: 3, background: `linear-gradient(${accent},${accent2})` }} />
        <div style={{ fontSize: 14, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}><span style={{ width: 22, borderTop: `3px solid ${accent}`, display: 'inline-block' }} />Actual</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}><span style={{ width: 22, borderTop: `3px dashed ${accent2}`, display: 'inline-block' }} />Goal</span>
      </div>
      <svg viewBox="0 0 1000 320" width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.38" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
          <filter id={`glow-${gid}`} x="-20%" y="-40%" width="140%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={accent} floodOpacity="0.55" />
          </filter>
        </defs>
        {[0, 1, 2, 3, 4].map(i => {
          const tv = (maxVal / 4) * i;
          return (
            <g key={i}>
              <line x1={70} y1={y(tv)} x2={980} y2={y(tv)} stroke="rgba(148,163,184,.12)" />
              <text x={60} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="#64748b">{num(tv, unit === 'hrs/ro' ? 2 : 0)}</text>
            </g>
          );
        })}
        {xLabels.map(r => <text key={r.k} x={x(r.dayNum)} y={296} textAnchor="middle" fontSize="11" fill="#64748b">{r.dt.getMonth() + 1}/{r.dt.getDate()}</text>)}
        {areaPts && <polygon points={areaPts} fill={`url(#fill-${gid})`} />}
        {goalPts && <polyline points={goalPts} fill="none" stroke={accent2} strokeWidth="2.5" strokeDasharray="7 6" opacity="0.95" />}
        {actualPts && <polyline points={actualPts} fill="none" stroke={accent} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" filter={`url(#glow-${gid})`} />}
        {lastLabel && (
          <g>
            <circle cx={lastLabel.x} cy={lastLabel.y} r="6" fill={accent} stroke="#04121a" strokeWidth="2.5" />
            <rect x={lastLabel.x - 30} y={lastLabel.y - 34} width="60" height="20" rx="10" fill={accent} />
            <text x={lastLabel.x} y={lastLabel.y - 20} textAnchor="middle" fontSize="12.5" fontWeight="900" fill="#04121a">{lastLabel.text}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

const cardSt = { flex: 1, minWidth: 150, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px' };
const lblSt = { fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' };
const inpSt = { background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700, color: '#e2e8f0', width: 110, textAlign: 'right', outline: 'none' };

// Vivid, themed summary card: gradient wash, colored border + glow, accent label.
function StatCard({ accent, icon, label, sub, subColor, children }) {
  return (
    <div style={{
      flex: 1, minWidth: 168, borderRadius: 16, padding: '15px 17px', position: 'relative', overflow: 'hidden',
      background: `linear-gradient(150deg, ${accent}26, ${accent}0a 55%, rgba(2,6,23,.55))`,
      border: `1px solid ${accent}55`, boxShadow: `0 10px 30px -14px ${accent}99, inset 0 1px 0 ${accent}26`,
    }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${accent}3a, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <div style={{ ...lblSt, color: accent }}>{label}</div>
      </div>
      <div style={{ position: 'relative' }}>{children}</div>
      {sub != null && <div style={{ fontSize: 11, color: subColor || '#94a3b8', marginTop: 4, fontWeight: 600, position: 'relative' }}>{sub}</div>}
    </div>
  );
}
const bigVal = (color) => ({ fontSize: 25, fontWeight: 900, color, marginTop: 5, letterSpacing: '-.01em', textShadow: `0 0 22px ${color}55` });

export default function AdvisorGoals({ currentUser, currentRole, advisors = [], schedules = {}, vacations = [], onBack, backLabel = '← Appointment Prep Calendar', onLivePay }) {
  const me = (currentUser || '').toUpperCase();
  const isAdmin = currentRole === 'admin' || (currentRole || '').includes('manager');
  const canEditGoals = isAdmin || currentRole === 'lead advisor';
  const roster = advisors.length ? advisors : (me ? [me] : []);
  const now = new Date();
  const mk = monthKey(now);
  const todayKey = dKey(now);
  const curLabel = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // From the 25th onward, let advisors open NEXT month to prep its goals early.
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nmk = monthKey(nextDate);
  const nextLabel = nextDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const showNext = now.getDate() >= 25;

  const [selected, setSelected] = useState(roster.includes(me) ? me : (roster[0] || me));
  const [view, setView] = useState('current'); // current | next | history
  const [histSel, setHistSel] = useState(null);
  const [allMonths, setAllMonths] = useState({});
  const [gridOpen, setGridOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  // Day End Reporting form (always for the logged-in advisor, "me").
  const [deOpenRo, setDeOpenRo] = useState('');
  const [deInvoiced, setDeInvoiced] = useState(null);
  const [deCust, setDeCust] = useState(null);
  const [deNotes, setDeNotes] = useState(null);
  const [deAfterCall, setDeAfterCall] = useState(null); // "did you complete after call reviews?"
  const [deReviews, setDeReviews] = useState({ total: 0, contacted: 0, voicemail: 0 }); // today's after-call review summary
  const [deHours, setDeHours] = useState('');
  const [deHrsRo, setDeHrsRo] = useState('');
  const [deSaving, setDeSaving] = useState(false);
  const [deMsg, setDeMsg] = useState('');
  const [dayEndOpen, setDayEndOpen] = useState(false);
  const [deStep, setDeStep] = useState(0);
  const [deAgree, setDeAgree] = useState(false);
  const [deNoNotes, setDeNoNotes] = useState([]); // ROs missing internal notes
  const [deNoNotesAt, setDeNoNotesAt] = useState('');
  const [deNoNotesFor, setDeNoNotesFor] = useState(''); // advisor the list is for
  const [deCopiedRo, setDeCopiedRo] = useState('');
  // Mandatory backfill: unreported prior working days this month that must be
  // completed (with a reason) before today's report can be submitted.
  const [deMissed, setDeMissed] = useState([]); // [{ k, label, full, hours, hrsRo, reason }]
  const [deMissedSaving, setDeMissedSaving] = useState(false);
  const [deMissedErr, setDeMissedErr] = useState('');
  // Gate must be verified BEFORE today's form can show. While this is true the
  // modal shows a "checking…" screen — never the current-day questions — so a
  // slow/failed load can't let the advisor slip past the mandatory missed days.
  const [deMissedLoading, setDeMissedLoading] = useState(false);
  const [deMissedLoadErr, setDeMissedLoadErr] = useState('');
  // After the advisor backfills their missed days, offer a choice: report the
  // current day now, or come back later (e.g. they fixed the miss mid-day and
  // the current day isn't over yet). Set true only right after a missed-day save.
  const [deChoice, setDeChoice] = useState(false);
  // True when today already has a saved report — resubmitting overwrites that date.
  const [deAlreadyReported, setDeAlreadyReported] = useState(false);
  function copyRo(ro) {
    const v = String(ro || '').trim();
    try { navigator.clipboard?.writeText(v); } catch {}
    setDeCopiedRo(v);
    setTimeout(() => setDeCopiedRo(c => (c === v ? '' : c)), 1200);
  }
  // Daily reporting is mandatory: find this advisor's unreported prior working
  // days this month (excluding days off / holiday / vacation) so they must be
  // completed before today's report. Runs BEHIND a loading screen so the
  // current-day form never shows until this resolves. On failure we surface a
  // retry instead of falling through — a network blip can't skip the gate.
  function loadMissedDays() {
    // Managers only view other advisors; the mandatory gate is for the person
    // logged in and reporting for themselves.
    if (!roster.includes(me)) { setDeMissed([]); setDeMissedLoading(false); return; }
    setDeMissedLoading(true);
    setDeMissedLoadErr('');
    loadAdvisorGoals(me).then(all => {
      const days = ensureMtd((all && all[mk]) || {}).days || {};
      const off = advisorOffDates(me, now.getFullYear(), now.getMonth(), schedules, vacations);
      const report = new Date(); while (report.getDay() === 0) report.setDate(report.getDate() - 1);
      const reportKey = dKey(report);
      const missed = workingDates(now.getFullYear(), now.getMonth())
        .filter(d => {
          const k = dKey(d);
          return k < reportKey && !off.has(k) && !Object.prototype.hasOwnProperty.call(days, k);
        })
        .map(d => ({
          k: dKey(d),
          label: `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
          full: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
          hours: '', hrsRo: '', reason: '',
        }));
      setDeMissed(missed);
      setDeMissedLoading(false);
      // If today was already reported, prefill the popup with the saved values so a
      // second report of the day is a quick edit that OVERWRITES the date (advisors
      // can report as many times as they like — the latest numbers win).
      const todayRec = days[reportKey];
      if (todayRec) {
        if (todayRec.hours != null) setDeHours(String(todayRec.hours));
        if (todayRec.hrsRo != null) setDeHrsRo(String(todayRec.hrsRo));
        if (todayRec.openRoCount != null) setDeOpenRo(String(todayRec.openRoCount));
        if (todayRec.invoiced != null) setDeInvoiced(todayRec.invoiced);
        if (todayRec.customersUpdated != null) setDeCust(todayRec.customersUpdated);
        if (todayRec.notesUpdated != null) setDeNotes(todayRec.notesUpdated);
        if (todayRec.afterCallReviews != null) setDeAfterCall(todayRec.afterCallReviews);
        setDeAlreadyReported(true);
      } else {
        setDeAlreadyReported(false);
      }
    }).catch(() => {
      // Don't fall through to today's form — enforce the gate by requiring a retry.
      setDeMissedLoadErr('Could not verify your reporting history. Check your connection and try again.');
      setDeMissedLoading(false);
    });
  }
  function openDayEnd() {
    setDeOpenRo(''); setDeInvoiced(null); setDeCust(null); setDeNotes(null); setDeAfterCall(null); setDeHours(''); setDeHrsRo('');
    setDeAgree(false); setDeMsg(''); setDeStep(0); setDayEndOpen(true);
    setDeNoNotes([]); setDeNoNotesAt(''); setDeCopiedRo(''); setDeReviews({ total: 0, contacted: 0, voicemail: 0 });
    setDeMissed([]); setDeMissedErr(''); setDeChoice(false); setDeAlreadyReported(false);
    loadMissedDays();
    // ROs missing internal notes (from the latest open-RO upload) for the advisor
    // being viewed — so an advisor sees their own and a manager previewing an
    // advisor sees that advisor's. Shown at the "updated notes?" question.
    const who = (selected || me || '').toUpperCase();
    setDeNoNotesFor(who);
    loadMissingNotes().then(d => {
      const list = (d && d.advisors && d.advisors[who]) || [];
      setDeNoNotes(Array.isArray(list) ? list : []);
      setDeNoNotesAt(d && d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
    }).catch(() => {});
    // Today's completed after-call reviews for this advisor, so the "did you
    // complete after call reviews?" question can show how many were contacted.
    const todayKey = dKey(new Date());
    loadCompletedReviews(who).then(list => {
      const todays = (Array.isArray(list) ? list : [])
        .filter(r => r && !r.managerDeleted && r.submittedAt && dKey(new Date(r.submittedAt)) === todayKey);
      setDeReviews({
        total: todays.length,
        contacted: todays.filter(r => r.contacted === 'yes').length,
        voicemail: todays.filter(r => r.contacted === 'voicemail').length,
      });
    }).catch(() => {});
  }

  const canEditDaysFor = (adv) => isAdmin || me === (adv || '').toUpperCase();
  const isMine = me === (selected || '').toUpperCase();

  // ── Manager-only: upload an Advisor Performance Report (.xlsx) to fill a day's
  // Hours (Bill Hrs) and HRS/RO (Hrs / RO) for every advisor in the report. ────
  const uploadInputRef = useRef(null);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [uploadRows, setUploadRows] = useState(null); // [{ name, firstName, hours, hrsRo, advisor }]
  const [uploadDate, setUploadDate] = useState('');
  const [uploadErr, setUploadErr] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');

  async function handleXlsx(file) {
    if (!file) return;
    setXlsxBusy(true); setUploadErr(''); setUploadRows(null); setUploadMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
      // Read the per-advisor "All" totals out of one sheet (prefer "Summary").
      const parseSheet = (name) => {
        const ws = wb.Sheets[name];
        if (!ws) return null;
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        if (!aoa.length) return null;
        const hdr = (aoa[0] || []).map(norm);
        const ci = (label) => hdr.indexOf(norm(label));
        const iName = ci('Name'), iPay = ci('Pay Type'), iHrs = ci('Bill Hrs'), iRo = ci('Hrs / RO');
        if (iName < 0 || iHrs < 0) return null;
        const out = [];
        for (let r = 1; r < aoa.length; r++) {
          const row = aoa[r] || [];
          const nm = String(row[iName] == null ? '' : row[iName]).trim();
          if (!nm || norm(nm) === 'total') continue;       // skip blanks + shop "Total" rows
          if (iPay >= 0 && norm(row[iPay]) !== 'all') continue; // only the per-advisor "All" total
          const hours = parseFloat(row[iHrs]);
          const hrsRo = iRo >= 0 ? parseFloat(row[iRo]) : NaN;
          out.push({ name: nm, hours: isNaN(hours) ? 0 : hours, hrsRo: isNaN(hrsRo) ? 0 : hrsRo });
        }
        return out.length ? out : null;
      };
      let parsed = parseSheet('Summary');
      if (!parsed) { for (const n of wb.SheetNames) { parsed = parseSheet(n); if (parsed) break; } }
      if (!parsed) { setUploadErr('Couldn’t find a sheet with Name, Bill Hrs and Hrs / RO columns. Make sure this is the Advisor Performance Report export.'); return; }
      // Match each report name to a roster advisor by first name.
      const matched = parsed.map(r => {
        // Apply report aliases (e.g. "CAIDEN" → "ISAIAH") before roster match.
        const firstName = canonicalAdvisorFirst(r.name);
        const advisor = roster.find(a => firstNameUpper(a) === firstName) || null;
        return { ...r, firstName, advisor };
      });
      setUploadRows(matched);
      // Advisor numbers are reported a day behind, so default to the previous
      // business day (yesterday, skipping Sunday). On the 1st this lands on the
      // last day of the prior month, which is the intended report date.
      const t = new Date();
      t.setDate(t.getDate() - 1);
      while (t.getDay() === 0) t.setDate(t.getDate() - 1);
      setUploadDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
    } catch (e) {
      setUploadErr('Could not read the file: ' + (e.message || e));
    } finally {
      setXlsxBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  async function applyUpload() {
    const toApply = (uploadRows || []).filter(r => r.advisor);
    if (!uploadDate) { setUploadErr('Pick the date this report is for.'); return; }
    if (!toApply.length) { setUploadErr('None of the report’s advisors matched the roster on this page.'); return; }
    setXlsxBusy(true); setUploadErr('');
    const dmk = uploadDate.slice(0, 7);
    try {
      let selectedAll = null;
      for (const r of toApply) {
        const all = await loadAdvisorGoals(r.advisor);
        const b = ensureMtd((all && all[dmk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} });
        // The report's totals are the month-to-date figures for uploadDate.
        const days = { ...(b.days || {}), [uploadDate]: { ...(b.days && b.days[uploadDate]), hours: safe(r.hours, 0), hrsRo: safe(r.hrsRo, 0) } };
        // saveAdvisorGoalsMonth returns the full merged file it just wrote.
        const written = await saveAdvisorGoalsMonth(r.advisor, dmk, { hoursGoal: safe(b.hoursGoal, 0), hrsRoGoal: safe(b.hrsRoGoal, 0), days, entryMode: 'mtd' });
        if ((r.advisor || '').toUpperCase() === (selected || '').toUpperCase()) selectedAll = written;
      }
      // Reflect the on-screen advisor's update from what we just wrote — don't
      // re-read from GitHub, which can briefly serve a stale copy right after a
      // write and leave the grid looking empty.
      if (selectedAll) {
        setAllMonths(selectedAll);
        const nb = ensureMtd(selectedAll[mk] || { hoursGoal: 0, hrsRoGoal: 0, days: {} });
        const norm = { hoursGoal: safe(nb.hoursGoal, 0), hrsRoGoal: safe(nb.hrsRoGoal, 0), days: nb.days || {}, entryMode: 'mtd' };
        bucketRef.current = norm;
        setBucket(norm);
        setGridOpen(true); // make sure the daily grid is visible so the fill shows
      }
      setUploadRows(null);
      setUploadMsg(`✓ Updated ${toApply.length} advisor${toApply.length === 1 ? '' : 's'} for ${uploadDate}.${dmk !== mk ? ' (Switch to that month to see it.)' : ''}`);
      setTimeout(() => setUploadMsg(''), 6000);
    } catch (e) {
      setUploadErr('Save failed: ' + (e.message || e));
    } finally {
      setXlsxBusy(false);
    }
  }

  // Which month is being edited/viewed. From the 25th, "next" is selectable so
  // next month's goals can be prepped early; it starts at 0 days completed.
  const isNext = showNext && view === 'next';
  const activeMk = isNext ? nmk : mk;

  const saveTimer = useRef(null);
  const bucketRef = useRef({ hoursGoal: 0, hrsRoGoal: 0, days: {} });
  const [bucket, setBucket] = useState({ hoursGoal: 0, hrsRoGoal: 0, days: {} });

  // Days the viewed advisor is off in the active month — company holidays, their
  // scheduled days off, vacation, or training. Excluded from the pace/projection
  // math so time off is never a negative reflection. A day they actually logged
  // hours still counts as worked.
  const activeOffDates = useMemo(() => {
    const [yy, mm] = String(activeMk).split('-').map(Number);
    return advisorOffDates(selected, yy, (mm || 1) - 1, schedules, vacations);
  }, [selected, activeMk, schedules, vacations]);

  // Elapsed working days so far (current month only; next month preps from zero).
  // Days off that weren't worked are dropped from the pace base.
  const activeCompletedDays = useMemo(() => {
    if (isNext) return 0;
    const [yy, mm] = String(activeMk).split('-').map(Number);
    return workingDates(yy, (mm || 1) - 1).filter(dt => {
      const k = dKey(dt);
      if (k >= todayKey) return false; // not yet elapsed (numbers are reported a day behind)
      return !(activeOffDates.has(k) && !(bucket.days && bucket.days[k]));
    }).length;
  }, [isNext, activeMk, activeOffDates, bucket, todayKey]);

  // Switching advisor resets back to the current month.
  useEffect(() => { setView('current'); setHistSel(null); }, [selected]);

  // Load the active month's bucket (current or, when prepping, next month).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAdvisorGoals(selected).then(all => {
      if (cancelled) return;
      setAllMonths(all || {});
      const raw = (all && all[activeMk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} };
      const conv = ensureMtd(raw);
      const norm = { hoursGoal: safe(conv.hoursGoal, 0), hrsRoGoal: safe(conv.hrsRoGoal, 0), days: conv.days || {}, entryMode: 'mtd' };
      bucketRef.current = norm;
      setBucket(norm);
      setLoading(false);
      // One-time legacy→MTD conversion: persist it so every viewer/export sees the
      // running totals. Idempotent (entryMode guard), only when there's data to convert.
      if (raw.entryMode !== 'mtd' && Object.keys(raw.days || {}).length > 0) {
        saveAdvisorGoalsMonth(selected, activeMk, norm).then(a => { if (!cancelled) setAllMonths(a || {}); }).catch(() => {});
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, activeMk, refresh]);

  // Submit the Day End Report into MY own goals file for today (skips Sunday).
  async function submitDayEnd() {
    setDeSaving(true); setDeMsg('');
    try {
      const d = new Date();
      while (d.getDay() === 0) d.setDate(d.getDate() - 1);
      const tmk = monthKey(d);
      const tkey = dKey(d);
      let all = {};
      try { all = await loadAdvisorGoals(me); } catch {}
      const b = ensureMtd((all && all[tmk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} });
      const days = { ...(b.days || {}) };
      days[tkey] = {
        ...(days[tkey] || {}),
        hours: safe(deHours, 0),  // month-to-date total the advisor entered today
        hrsRo: safe(deHrsRo, 0),  // month-to-date hrs/RO
        openRoCount: safe(deOpenRo, 0),
        invoiced: deInvoiced,
        customersUpdated: deCust,
        notesUpdated: deNotes,
        afterCallReviews: deAfterCall,
        afterCallContacted: deReviews.contacted,
        agreed: deAgree,
        agreedBy: me,
        submittedAt: Date.now(),
      };
      const merged = { ...b, days, entryMode: 'mtd' };
      const all2 = await saveAdvisorGoalsMonth(me, tmk, merged);
      setAllMonths(all2 || {});
      // Reflect immediately in the on-screen forecast (don't wait for a reload).
      setSelected(me);
      if (tmk === mk) {
        const norm = { hoursGoal: safe(merged.hoursGoal, 0), hrsRoGoal: safe(merged.hrsRoGoal, 0), days: merged.days || {}, entryMode: 'mtd' };
        bucketRef.current = norm;
        setBucket(norm);
      }
      setDeMsg(`✓ Day-end report saved for ${d.getMonth() + 1}/${d.getDate()}. Month-to-date total set to ${num(safe(deHours, 0), 1)} hrs at ${num(safe(deHrsRo, 0), 2)} hrs/RO.`);
      setDeOpenRo(''); setDeInvoiced(null); setDeCust(null); setDeNotes(null); setDeAfterCall(null); setDeHours(''); setDeHrsRo(''); setDeAgree(false);
      setDayEndOpen(false);
      setView('current'); setGridOpen(true);
    } catch (e) {
      setDeMsg('Save failed: ' + (e.message || e));
    } finally {
      setDeSaving(false);
    }
  }

  // Save all missed prior days (hours + Hrs/RO + reason required) into MY goals
  // for the current month, then clear the gate so today's report can proceed.
  async function saveMissedDays() {
    setDeMissedErr('');
    const incomplete = deMissed.some(m =>
      String(m.hours).trim() === '' || String(m.hrsRo).trim() === '' || String(m.reason).trim() === '');
    if (incomplete) { setDeMissedErr('Enter hours, Hrs/RO, and a reason for every missed day.'); return; }
    setDeMissedSaving(true);
    try {
      let all = {};
      try { all = await loadAdvisorGoals(me); } catch {}
      const b = ensureMtd((all && all[mk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} });
      const days = { ...(b.days || {}) };
      for (const m of deMissed) {
        days[m.k] = {
          ...(days[m.k] || {}),
          hours: safe(m.hours, 0),  // month-to-date total as of that missed day
          hrsRo: safe(m.hrsRo, 0),
          missedReason: String(m.reason).trim(),
          late: true,
          agreedBy: me,
          submittedAt: Date.now(),
        };
      }
      const merged = { ...b, days, entryMode: 'mtd' };
      const all2 = await saveAdvisorGoalsMonth(me, mk, merged);
      setAllMonths(all2 || {});
      if (selected === me && mk === activeMk) {
        const norm = { hoursGoal: safe(merged.hoursGoal, 0), hrsRoGoal: safe(merged.hrsRoGoal, 0), days: merged.days || {}, entryMode: 'mtd' };
        bucketRef.current = norm; setBucket(norm);
      }
      setDeMissed([]);       // gate cleared
      setDeChoice(true);     // → offer "report today now" or "later"
    } catch (e) {
      setDeMissedErr('Save failed: ' + (e.message || e));
    } finally {
      setDeMissedSaving(false);
    }
  }

  // Debounced, conflict-aware save: reload the latest bucket and only overwrite
  // the parts this user is allowed to change (goals for lead, days for owner).
  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Snapshot the bucket AND the month it belongs to now, so switching months
    // before the debounce fires can't write one month's edits into another.
    const mine = bucketRef.current;
    const saveMk = activeMk;
    saveTimer.current = setTimeout(async () => {
      let latest = {};
      try { const all = await loadAdvisorGoals(selected); latest = (all && all[saveMk]) || {}; } catch {}
      const merged = {
        hoursGoal: canEditGoals ? safe(mine.hoursGoal, 0) : safe(latest.hoursGoal, 0),
        hrsRoGoal: canEditGoals ? safe(mine.hrsRoGoal, 0) : safe(latest.hrsRoGoal, 0),
        days: canEditDaysFor(selected) ? mine.days : ensureMtd(latest).days,
        entryMode: 'mtd',
      };
      saveAdvisorGoalsMonth(selected, saveMk, merged).then(all => setAllMonths(all || {})).catch(() => {});
    }, 800);
  }

  function setGoal(field, val) {
    const next = { ...bucketRef.current, [field]: val };
    bucketRef.current = next; setBucket(next); scheduleSave();
  }
  function setDay(dateKey, field, val) {
    const days = { ...(bucketRef.current.days || {}) };
    const cur = { ...(days[dateKey] || {}) };
    if (val === '' || val == null) { delete cur[field]; }
    else cur[field] = safe(val, 0);
    if (Object.keys(cur).length === 0) delete days[dateKey]; else days[dateKey] = cur;
    const next = { ...bucketRef.current, days };
    bucketRef.current = next; setBucket(next); scheduleSave();
  }

  const M = useMemo(() => computeMetrics(activeMk, bucket, null, activeCompletedDays, activeOffDates, isNext ? null : todayKey), [activeMk, bucket, activeCompletedDays, activeOffDates, isNext, todayKey]);

  // Chart geometry helpers.
  function makeCharts(metrics) {
    const W = 1000, padL = 70, padR = 20, padT = 16, padB = 40, plotW = W - padL - padR, plotH = 320 - padT - padB;
    const n = Math.max(metrics.totalDays, 1);
    const x = (dayNum) => padL + (plotW * (dayNum - 1)) / Math.max(n - 1, 1);
    // HOURS cumulative
    const maxH = Math.max(metrics.hoursGoal, metrics.actualHours, metrics.dailyHoursTarget * n, 1) * 1.1;
    const yH = (v) => padT + plotH - (plotH * Math.max(v, 0)) / maxH;
    // Goal line + axis labels span working days only — off days aren't plotted.
    const workRows = metrics.rows.filter(r => !r.off);
    const hoursGoalPts = workRows.map(r => `${x(r.dayNum).toFixed(1)},${yH(r.goalCum).toFixed(1)}`).join(' ');
    const entered = metrics.rows.filter(r => r.has);
    const hoursActualPts = entered.map(r => `${x(r.dayNum).toFixed(1)},${yH(r.cumHours).toFixed(1)}`).join(' ');
    const lastH = entered.length ? entered[entered.length - 1] : null;
    // HRS/RO daily. A hrs/RO ratio realistically sits within a few of the goal,
    // so ignore data-entry outliers (e.g. a stray "84") when scaling — otherwise
    // one bad number stretches the axis and flattens the goal line at the bottom.
    // Outlier points are still plotted, just clamped to the top of the plot.
    const roVals = metrics.rows.filter(r => r.has).map(r => safe(r.hrsRo, 0));
    const roCap = Math.max((metrics.hrsRoGoal || 1.5) * 4, 5);
    const roScale = roVals.filter(v => v <= roCap);
    const maxR = Math.max(metrics.hrsRoGoal, ...(roScale.length ? roScale : roVals), 1) * 1.25;
    const yR = (v) => padT + plotH - (plotH * Math.min(Math.max(v, 0), maxR)) / maxR;
    const roGoalPts = workRows.map(r => `${x(r.dayNum).toFixed(1)},${yR(metrics.hrsRoGoal).toFixed(1)}`).join(' ');
    const roActualPts = entered.map(r => `${x(r.dayNum).toFixed(1)},${yR(safe(r.hrsRo, 0)).toFixed(1)}`).join(' ');
    const lastR = entered.length ? entered[entered.length - 1] : null;
    const xLabels = workRows.filter((r, i) => i % 5 === 0 || i === workRows.length - 1);
    const area = (pts, y0) => (entered.length ? `${x(entered[0].dayNum).toFixed(1)},${y0.toFixed(1)} ${pts} ${x(entered[entered.length - 1].dayNum).toFixed(1)},${y0.toFixed(1)}` : '');
    const yH0 = padT + plotH, yR0 = padT + plotH;
    return {
      hours: { goalPts: hoursGoalPts, actualPts: hoursActualPts, areaPts: area(hoursActualPts, yH0), maxVal: maxH, x, y: yH, xLabels, lastLabel: lastH && { x: x(lastH.dayNum), y: yH(lastH.cumHours), text: num(lastH.cumHours, 1) } },
      ro: { goalPts: roGoalPts, actualPts: roActualPts, areaPts: area(roActualPts, yR0), maxVal: maxR, x, y: yR, xLabels, lastLabel: lastR && { x: x(lastR.dayNum), y: yR(safe(lastR.hrsRo, 0)), text: num(safe(lastR.hrsRo, 0), 2) } },
    };
  }

  const charts = makeCharts(M);

  const renderDetail = (metrics, ch, editable) => (
    <>
      {/* Goals + summary */}
      {(() => {
        const aheadPace = metrics.actualHours >= metrics.expectedHours;
        const aheadGoal = metrics.projectedHours >= metrics.hoursGoal;
        const aheadRo = metrics.avgHrsRo >= metrics.hrsRoGoal;
        const POS = '#34d399', NEG = '#fb7185';
        return (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard accent="#34d399" icon="🎯" label="Hours Goal" sub={`${num(metrics.dailyHoursTarget, 1)}/day · ${metrics.totalDays} days${metrics.offDaysCount ? ` · ${metrics.offDaysCount} off` : ''}`}>
              {editable.goals
                ? <input type="number" inputMode="decimal" style={{ ...inpSt, color: '#6ee7b7', width: 120, marginTop: 5, borderColor: '#34d39966' }} value={metrics.hoursGoal || ''} placeholder="0" onChange={e => setGoal('hoursGoal', e.target.value)} />
                : <div style={bigVal('#6ee7b7')}>{num(metrics.hoursGoal, 1)}</div>}
            </StatCard>
            <StatCard accent="#38bdf8" icon="⚙️" label="Hrs/RO Goal" sub="target ratio">
              {editable.goals
                ? <input type="number" inputMode="decimal" style={{ ...inpSt, color: '#93c5fd', width: 120, marginTop: 5, borderColor: '#38bdf866' }} value={metrics.hrsRoGoal || ''} placeholder="0" onChange={e => setGoal('hrsRoGoal', e.target.value)} />
                : <div style={bigVal('#7dd3fc')}>{num(metrics.hrsRoGoal, 2)}</div>}
            </StatCard>
            <StatCard accent="#a78bfa" icon="🔥" label="Hours Actual (MTD)"
              sub={`${aheadPace ? '▲' : '▼'} ${num(Math.abs(metrics.actualHours - metrics.expectedHours), 1)} vs pace`} subColor={aheadPace ? POS : NEG}>
              <div style={bigVal('#c4b5fd')}>{num(metrics.actualHours, 1)}</div>
            </StatCard>
            <StatCard accent="#fbbf24" icon="📈" label="Projected Hours"
              sub={metrics.hoursGoal > 0 ? `${aheadGoal ? '▲' : '▼'} ${num(Math.abs(metrics.projectedHours - metrics.hoursGoal), 1)} vs goal` : ''} subColor={aheadGoal ? POS : NEG}>
              <div style={bigVal(aheadGoal ? POS : NEG)}>{num(metrics.projectedHours, 1)}</div>
            </StatCard>
            <StatCard accent="#f472b6" icon="💎" label="Avg Hrs/RO"
              sub={metrics.hrsRoGoal > 0 ? `goal ${num(metrics.hrsRoGoal, 2)}` : ''} subColor={aheadRo ? POS : NEG}>
              <div style={bigVal(aheadRo ? POS : NEG)}>{num(metrics.avgHrsRo, 2)}</div>
            </StatCard>
          </div>
        );
      })()}

      {/* Daily entry */}
      <div style={{ background: 'linear-gradient(160deg, rgba(56,189,248,.10), rgba(15,23,42,.55) 60%)', border: '1px solid rgba(56,189,248,.28)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 30px -18px rgba(56,189,248,.7)' }}>
        <div onClick={() => setGridOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ fontSize: 13, color: gridOpen ? '#38bdf8' : '#94a3b8', transform: gridOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
          <span style={{ fontSize: 14 }}>📅</span>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>Daily Entry — {metrics.label}</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: '#64748b' }}>{editable.days ? (gridOpen ? 'Click to hide' : 'Click to add your hours') : (gridOpen ? 'Click to hide' : 'Click to view')}</div>
        </div>
        {/* Persistent monthly reporting-status banner: warns while any day is
            still missed, then flips to a corrected note once all are backfilled. */}
        {metrics.missedDaysCount > 0 ? (
          <div style={{ margin: '0 20px 4px', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>
            ⚠️ {metrics.missedDaysCount} day{metrics.missedDaysCount === 1 ? '' : 's'} missed this month — daily reporting is mandatory. Complete {metrics.missedDaysCount === 1 ? 'it' : 'them'} in Day End Reporting.
          </div>
        ) : metrics.correctedDaysCount > 0 ? (
          <div style={{ margin: '0 20px 4px', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 10, padding: '10px 14px', color: '#fcd34d', fontSize: 13, fontWeight: 700 }}>
            ⚠️ {metrics.correctedDaysCount} missed day{metrics.correctedDaysCount === 1 ? ' was' : 's were'} corrected this month.
          </div>
        ) : null}
        {gridOpen && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 150px 150px 150px', padding: '12px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderTop: '1px solid rgba(148,163,184,.15)', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>Day</div><div>Date</div>
              <div style={{ textAlign: 'right' }}>MTD Hours</div>
              <div style={{ textAlign: 'right' }}>MTD Hrs/RO</div>
              <div style={{ textAlign: 'right' }}>Hours Closed</div>
            </div>
            {metrics.rows.map(r => r.off ? (
              // Scheduled off / holiday / vacation — shown for context but not
              // counted toward pace, projection, or the goal line.
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 150px 150px 150px', padding: '8px 20px', alignItems: 'center', fontSize: 14, borderBottom: '1px solid rgba(148,163,184,.06)', background: 'rgba(148,163,184,.05)' }}>
                <div style={{ color: '#475569', fontWeight: 700 }}>—</div>
                <div style={{ color: '#64748b' }}>{DOW[r.dt.getDay()]} {r.dt.getMonth() + 1}/{r.dt.getDate()}</div>
                <div style={{ gridColumn: 'span 3', textAlign: 'right' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', color: '#94a3b8', background: 'rgba(148,163,184,.14)', border: '1px solid rgba(148,163,184,.25)', borderRadius: 999, padding: '3px 12px' }}>OFF — NOT COUNTED</span>
                </div>
              </div>
            ) : (
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 150px 150px 150px', padding: '8px 20px', alignItems: 'center', fontSize: 14, borderBottom: '1px solid rgba(148,163,184,.06)' }}>
                <div style={{ color: '#64748b', fontWeight: 700 }}>{r.dayNum}</div>
                <div style={{ color: '#cbd5e1' }}>
                  {DOW[r.dt.getDay()]} {r.dt.getMonth() + 1}/{r.dt.getDate()}
                  {r.missed && <span title="Reporting missed — must be completed in Day End Reporting" style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: '#fca5a5', background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 999, padding: '2px 8px', cursor: 'help' }}>⚠️ MISSED</span>}
                  {r.late && <span title={r.missedReason ? `Day was corrected — reason: ${r.missedReason}` : 'Day was corrected'} style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: '#fcd34d', background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 999, padding: '2px 8px', cursor: 'help' }}>⚠️ CORRECTED</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {editable.days
                    ? <input type="number" inputMode="decimal" style={{ ...inpSt, width: 120, color: r.has ? '#6ee7b7' : '#e2e8f0' }} value={r.has ? r.hours : ''} placeholder="—" onChange={e => setDay(r.k, 'hours', e.target.value)} />
                    : <span style={{ color: r.has ? '#6ee7b7' : '#475569', fontWeight: 700 }}>{r.has ? num(r.hours, 1) : '—'}</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {editable.days
                    ? <input type="number" inputMode="decimal" style={{ ...inpSt, width: 120, color: r.has ? '#93c5fd' : '#e2e8f0' }} value={r.has && r.hrsRo != null ? r.hrsRo : ''} placeholder="—" onChange={e => setDay(r.k, 'hrsRo', e.target.value)} />
                    : <span style={{ color: r.has ? '#93c5fd' : '#475569', fontWeight: 700 }}>{r.has && r.hrsRo != null ? num(r.hrsRo, 2) : '—'}</span>}
                </div>
                <div style={{ textAlign: 'right', fontWeight: 800, color: r.has ? (r.closed >= 0 ? '#34d399' : '#fb7185') : '#475569' }}
                  title="Hours closed this day = today's month-to-date total − the previous entered day's total">
                  {r.has ? `${r.closed >= 0 ? '' : '−'}${num(Math.abs(r.closed), 1)}` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GoalChart title={`Hours — ${metrics.label}`} unit="hours" accent="#34d399" accent2="#38bdf8" {...ch.hours} />
      <GoalChart title={`Hrs/RO — ${metrics.label}`} unit="hrs/ro" accent="#f472b6" accent2="#a78bfa" {...ch.ro} />
    </>
  );

  // History list / detail
  const renderHistory = () => {
    const pastKeys = Object.keys(allMonths || {}).filter(k => k < mk).sort().reverse();
    if (histSel) {
      const [hy, hmo] = String(histSel).split('-').map(Number);
      // Past months: don't flag "missed" (mandatory reporting is forward-looking);
      // corrected days still show via their stored flag.
      const hm = computeMetrics(histSel, allMonths[histSel], null, null, advisorOffDates(selected, hy, (hmo || 1) - 1, schedules, vacations), null);
      const hc = makeCharts(hm);
      return (
        <div>
          <button className="secondary" onClick={() => setHistSel(null)} style={{ marginBottom: 16 }}>← All months</button>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0', marginBottom: 16 }}>{hm.label}</div>
          {renderDetail(hm, hc, { goals: false, days: false })}
        </div>
      );
    }
    if (!pastKeys.length) return <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No completed months yet.</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pastKeys.map(k => {
          const [py, pmo] = String(k).split('-').map(Number);
          const hm = computeMetrics(k, allMonths[k], null, null, advisorOffDates(selected, py, (pmo || 1) - 1, schedules, vacations), null);
          return (
            <div key={k} onClick={() => { setGridOpen(false); setHistSel(k); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', minWidth: 150 }}>{hm.label}</div>
              <div><div style={lblSt}>Hours</div><div style={{ fontSize: 17, fontWeight: 800, color: '#6ee7b7' }}>{num(hm.actualHours, 1)} / {num(hm.hoursGoal, 1)}</div></div>
              <div><div style={lblSt}>Avg Hrs/RO</div><div style={{ fontSize: 17, fontWeight: 800, color: '#93c5fd' }}>{num(hm.avgHrsRo, 2)} / {num(hm.hrsRoGoal, 2)}</div></div>
              <div style={{ flex: 1 }} />
              <div style={{ color: '#6ee7f9', fontSize: 13, fontWeight: 700 }}>View →</div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Day End Reporting form ────────────────────────────────────────────────
  const YesNo = ({ value, onChange }) => (
    <div style={{ display: 'flex', gap: 8 }}>
      {[['yes', 'Yes', '#4ade80', 'rgba(74,222,128,'], ['no', 'No', '#f87171', 'rgba(248,113,113,']].map(([v, lbl, col, rgb]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ background: value === v ? `${rgb}.22)` : 'rgba(255,255,255,.05)', border: `1px solid ${value === v ? `${rgb}.6)` : 'rgba(255,255,255,.12)'}`, color: value === v ? col : '#94a3b8', borderRadius: 8, padding: '8px 22px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>{lbl}</button>
      ))}
    </div>
  );
  // Day End Reporting popup — one question per step.
  const DE_STEPS = [
    { key: 'openRo', kind: 'num', q: 'Open Repair Order Count', placeholder: 'e.g. 12', get: () => deOpenRo, set: setDeOpenRo, color: '#e2e8f0' },
    { key: 'invoiced', kind: 'yn', q: 'Are all available repair orders invoiced?', get: () => deInvoiced, set: setDeInvoiced },
    { key: 'cust', kind: 'yn', q: 'Are all customers updated on status?', get: () => deCust, set: setDeCust },
    { key: 'notes', kind: 'yn', q: 'Do all repair orders have new and updated notes?', get: () => deNotes, set: setDeNotes },
    { key: 'afterCall', kind: 'yn', q: 'Did you complete after call reviews?', get: () => deAfterCall, set: setDeAfterCall },
    { key: 'hours', kind: 'num', q: 'Total Hours for the Month (MTD)', sub: 'Your month-to-date total from the DMS — the page figures today’s hours', placeholder: 'e.g. 82.5', get: () => deHours, set: setDeHours, color: '#6ee7b7' },
    { key: 'hrsro', kind: 'num', q: 'Month Hrs/RO (MTD)', sub: 'Your month-to-date hrs/RO from the DMS', placeholder: 'e.g. 1.3', get: () => deHrsRo, set: setDeHrsRo, color: '#93c5fd' },
    { key: 'agree', kind: 'agree', q: 'Confirm & Submit' },
  ];

  // The attestation statement the advisor must agree to before submitting.
  const AGREE_TEXT = `I certify that the information in this day-end report is accurate and complete to the best of my knowledge. I have reviewed all of my open repair orders, invoiced everything available, updated every customer on their status, and ensured each repair order has current notes as of the end of my business day.`;

  // Shared modal shell for the pre-report gate screens (loading / error).
  function renderGateShell(children) {
    return (
      <div onClick={() => setDayEndOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 18, width: '100%', maxWidth: 460, boxShadow: '0 18px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80' }}>📋 Day End Reporting</div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setDayEndOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
          {children}
        </div>
      </div>
    );
  }

  // Shown while we verify whether the advisor has unreported prior days. Blocks
  // the current-day form until the check completes.
  function renderMissedLoading() {
    return renderGateShell(
      <div style={{ padding: '40px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>⏳ Checking your reporting history…</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 8 }}>Making sure every prior day is reported before today.</div>
      </div>
    );
  }

  // Shown when the missed-day check fails. Requires a retry — never falls through
  // to today's report, so a bad connection can't bypass the mandatory gate.
  function renderMissedLoadError() {
    return renderGateShell(
      <div style={{ padding: '30px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fca5a5' }}>⚠️ {deMissedLoadErr}</div>
        <button onClick={loadMissedDays}
          style={{ marginTop: 18, background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '9px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
          ↻ Try again
        </button>
      </div>
    );
  }

  // Shown right after missed days are backfilled: let the advisor report the
  // current day now, or come back later (their missed-day pin is already cleared,
  // so closing here doesn't re-flag them).
  function renderAfterMissedChoice() {
    return renderGateShell(
      <div style={{ padding: '26px 22px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#4ade80' }}>Missed days saved</div>
        <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 8, lineHeight: 1.5 }}>
          You're caught up. Do you want to complete <strong style={{ color: '#e2e8f0' }}>today's</strong> end-of-day report now, or come back later once your day is done?
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
          <button onClick={() => { setDeChoice(false); setDeStep(0); }}
            style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
            📋 Report Current Day
          </button>
          <button onClick={() => { setDeChoice(false); setDayEndOpen(false); }}
            style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.15)', color: '#cbd5e1', borderRadius: 8, padding: '10px 22px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
            ⏳ I'll Report Later
          </button>
        </div>
      </div>
    );
  }

  // Mandatory missed-day gate — shown before today's report when the advisor has
  // unreported prior working days this month.
  function renderMissedGate() {
    return (
      <div onClick={() => setDayEndOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 18, width: '100%', maxWidth: 520, maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 18px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80' }}>📋 Day End Reporting</div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setDayEndOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ padding: '16px 20px 0' }}>
            <div style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 12, padding: '12px 14px', color: '#fca5a5', fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>
              ⚠️ Daily reporting is mandatory. You missed {deMissed.length} day{deMissed.length === 1 ? '' : 's'} — <strong style={{ color: '#fecaca' }}>{deMissed.map(m => m.full || m.label).join(', ')}</strong>. You must complete {deMissed.length === 1 ? 'it' : 'them'} before you can report today.
            </div>
          </div>
          <div style={{ padding: '14px 20px', overflowY: 'auto' }}>
            {deMissed.map((m, i) => (
              <div key={m.k} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.09)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#f87171', background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 999, padding: '2px 9px' }}>Missed day {deMissed.length > 1 ? `${i + 1} of ${deMissed.length}` : ''}</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 900, color: '#f8fafc', marginBottom: 10, letterSpacing: '-.01em' }}>📅 {m.full || m.label}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ flex: '1 1 120px' }}>
                    <div style={lblSt}>Total Hours (MTD as of this day)</div>
                    <input type="number" inputMode="decimal" value={m.hours} placeholder="e.g. 62.0"
                      onChange={e => setDeMissed(list => list.map((x, ix) => ix === i ? { ...x, hours: e.target.value } : x))}
                      style={{ ...inpSt, width: '100%', color: '#6ee7b7', textAlign: 'left', boxSizing: 'border-box' }} />
                  </label>
                  <label style={{ flex: '1 1 120px' }}>
                    <div style={lblSt}>Month Hrs/RO</div>
                    <input type="number" inputMode="decimal" value={m.hrsRo} placeholder="e.g. 1.3"
                      onChange={e => setDeMissed(list => list.map((x, ix) => ix === i ? { ...x, hrsRo: e.target.value } : x))}
                      style={{ ...inpSt, width: '100%', color: '#93c5fd', textAlign: 'left', boxSizing: 'border-box' }} />
                  </label>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={lblSt}>Reason this day-end report was missed <span style={{ color: '#f87171' }}>*</span></div>
                  <textarea value={m.reason} rows={2} placeholder="Required — explain why this day wasn't reported…"
                    onChange={e => setDeMissed(list => list.map((x, ix) => ix === i ? { ...x, reason: e.target.value } : x))}
                    style={{ ...inpSt, width: '100%', color: '#e2e8f0', textAlign: 'left', boxSizing: 'border-box', resize: 'vertical', fontWeight: 600, lineHeight: 1.4 }} />
                </div>
              </div>
            ))}
            {deMissedErr && <div style={{ fontSize: 13, color: '#f87171', marginTop: 4 }}>{deMissedErr}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 18px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ flex: 1 }} />
            <button onClick={saveMissedDays} disabled={deMissedSaving}
              style={{ background: deMissedSaving ? 'rgba(255,255,255,.06)' : 'rgba(74,222,128,.2)', border: `1px solid ${deMissedSaving ? 'rgba(255,255,255,.12)' : 'rgba(74,222,128,.45)'}`, color: deMissedSaving ? '#64748b' : '#4ade80', borderRadius: 8, padding: '9px 22px', cursor: deMissedSaving ? 'default' : 'pointer', fontWeight: 800, fontSize: 14 }}>
              {deMissedSaving ? '⏳ Saving…' : 'Save missed days & continue →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderDayEndModal() {
    if (!dayEndOpen) return null;
    // Verify the mandatory missed-day gate FIRST. The current-day questions must
    // never appear until we've confirmed there are no unreported prior days.
    if (deMissedLoading) return renderMissedLoading();
    if (deMissedLoadErr) return renderMissedLoadError();
    if (deMissed.length > 0) return renderMissedGate();
    if (deChoice) return renderAfterMissedChoice();
    const step = DE_STEPS[deStep];
    const val = step.get ? step.get() : null;
    const answered = step.kind === 'yn' ? !!val : step.kind === 'agree' ? deAgree : String(val ?? '').trim() !== '';
    const isLast = deStep === DE_STEPS.length - 1;
    const goNext = () => { if (answered && !isLast) setDeStep(s => s + 1); };
    return (
      <div onClick={() => setDayEndOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 18, width: '100%', maxWidth: 460, boxShadow: '0 18px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}>
          {/* Header + progress */}
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80' }}>📋 Day End Reporting</div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: '#64748b' }}>{deStep + 1} of {DE_STEPS.length}</div>
              <button onClick={() => setDayEndOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ marginTop: 10, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 999 }}>
              <div style={{ width: `${((deStep + 1) / DE_STEPS.length) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#34d399,#6ee7b7)', borderRadius: 999, transition: 'width .2s' }} />
            </div>
          </div>

          {deAlreadyReported && (
            <div style={{ margin: '12px 20px 0', background: 'rgba(56,189,248,.1)', border: '1px solid rgba(56,189,248,.35)', borderRadius: 10, padding: '9px 13px', color: '#7dd3fc', fontSize: 12.5, fontWeight: 700, lineHeight: 1.4 }}>
              ↻ You already reported today — your saved numbers are filled in below. Updating and submitting will overwrite today's totals.
            </div>
          )}
          {/* Question */}
          <div style={{ padding: '26px 22px 8px', minHeight: 150 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.35 }}>{step.q}</div>
            {step.sub && <div style={{ fontSize: 12, color: step.color || '#6ee7b7', fontWeight: 700, marginTop: 4 }}>→ {step.sub}</div>}
            {step.key === 'notes' && deNoNotes.length > 0 && (
              <div style={{ marginTop: 14, background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.35)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#c4b5fd', marginBottom: 8 }}>
                  ⚠️ {deNoNotes.length} {deNoNotesFor === me ? 'of your' : `of ${deNoNotesFor}’s`} RO{deNoNotes.length === 1 ? '' : 's'} had no internal notes{deNoNotesAt ? ` (as of ${deNoNotesAt})` : ''} — click to copy:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                  {deNoNotes.map((o, i) => {
                    const v = String(o.ro || '').trim();
                    const copied = deCopiedRo === v;
                    return (
                      <button key={i} type="button" onClick={() => copyRo(o.ro)} title={o.vehicle ? `${v} · ${o.vehicle}` : `Copy ${v}`}
                        style={{ background: copied ? 'rgba(74,222,128,.2)' : 'rgba(2,6,23,.5)', border: `1px solid ${copied ? 'rgba(74,222,128,.5)' : 'rgba(148,163,184,.3)'}`, color: copied ? '#6ee7b7' : '#e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                        {copied ? '✓ Copied' : v}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {step.key === 'notes' && deNoNotes.length === 0 && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: '#64748b' }}>✓ No ROs flagged without notes for {deNoNotesFor === me ? 'you' : deNoNotesFor}{deNoNotesAt ? ` (as of ${deNoNotesAt})` : ''}.</div>
            )}
            {step.key === 'afterCall' && (
              deReviews.total > 0 ? (
                <div style={{ marginTop: 14, background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.35)', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: '#6ee7b7', marginBottom: 6 }}>
                    📞 {deReviews.contacted} of {deReviews.total} customer{deReviews.total === 1 ? '' : 's'} contacted in {deNoNotesFor === me ? 'your' : `${deNoNotesFor}’s`} after-call reviews today
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {deReviews.contacted} contacted · {deReviews.voicemail} voicemail · {deReviews.total} review{deReviews.total === 1 ? '' : 's'} completed today
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14, fontSize: 12.5, color: '#64748b' }}>No after-call reviews recorded today yet for {deNoNotesFor === me ? 'you' : deNoNotesFor}.</div>
              )
            )}
            <div style={{ marginTop: 20 }}>
              {step.kind === 'agree' ? (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: '#cbd5e1', background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, padding: '14px 16px' }}>{AGREE_TEXT}</div>
                  <button type="button" onClick={() => setDeAgree(a => !a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 14, background: deAgree ? 'rgba(74,222,128,.14)' : 'rgba(255,255,255,.04)', border: `1px solid ${deAgree ? 'rgba(74,222,128,.5)' : 'rgba(255,255,255,.14)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: deAgree ? '#4ade80' : 'transparent', border: `2px solid ${deAgree ? '#4ade80' : 'rgba(148,163,184,.6)'}`, color: '#04201d', fontWeight: 900, fontSize: 14 }}>{deAgree ? '✓' : ''}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: deAgree ? '#4ade80' : '#cbd5e1' }}>I agree — {me}</span>
                  </button>
                </>
              ) : step.kind === 'yn' ? (
                <YesNo value={val} onChange={(v) => { step.set(v); setTimeout(() => setDeStep(s => Math.min(s + 1, DE_STEPS.length - 1)), 150); }} />
              ) : (
                <input autoFocus type="number" inputMode="decimal" value={val}
                  placeholder={step.placeholder}
                  onChange={e => step.set(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') goNext(); }}
                  style={{ background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '12px 14px', fontSize: 20, fontWeight: 800, color: step.color || '#e2e8f0', width: '100%', boxSizing: 'border-box', outline: 'none' }} />
              )}
            </div>
            {deMsg && deMsg.startsWith('Save failed') && <div style={{ marginTop: 14, fontSize: 13, color: '#f87171' }}>{deMsg}</div>}
          </div>

          {/* Footer nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 18px' }}>
            <button onClick={() => setDeStep(s => Math.max(s - 1, 0))} disabled={deStep === 0}
              style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: deStep === 0 ? '#475569' : '#cbd5e1', borderRadius: 8, padding: '9px 16px', cursor: deStep === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 13 }}>← Back</button>
            <div style={{ flex: 1 }} />
            {isLast ? (
              <button onClick={submitDayEnd} disabled={deSaving || !answered}
                style={{ background: answered && !deSaving ? 'rgba(74,222,128,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${answered && !deSaving ? 'rgba(74,222,128,.45)' : 'rgba(255,255,255,.12)'}`, color: answered && !deSaving ? '#4ade80' : '#64748b', borderRadius: 8, padding: '9px 22px', cursor: answered && !deSaving ? 'pointer' : 'default', fontWeight: 800, fontSize: 14 }}>{deSaving ? '⏳ Saving…' : '✓ Submit'}</button>
            ) : (
              <button onClick={goNext} disabled={!answered}
                style={{ background: answered ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.06)', border: `1px solid ${answered ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.12)'}`, color: answered ? '#6ee7f9' : '#64748b', borderRadius: 8, padding: '9px 22px', cursor: answered ? 'pointer' : 'default', fontWeight: 800, fontSize: 14 }}>Next →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Upload preview + date picker modal ───────────────────────────────────
  const renderUploadModal = () => {
    if (!uploadRows && !uploadErr) return null;
    const matched = (uploadRows || []).filter(r => r.advisor);
    const unmatched = (uploadRows || []).filter(r => !r.advisor);
    return (
      <div onClick={() => { setUploadRows(null); setUploadErr(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '6vh 16px' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,.6)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#6ee7b7' }}>📊 Upload Advisor Report</div>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setUploadRows(null); setUploadErr(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ padding: 20, overflowY: 'auto' }}>
            {uploadErr ? (
              <div style={{ color: '#fca5a5', fontSize: 13, lineHeight: 1.5 }}>{uploadErr}</div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ ...lblSt, marginBottom: 6 }}>Date this report is for <span style={{ color: '#64748b', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>(defaults to yesterday — you report a day behind)</span></div>
                  <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)}
                    style={{ ...inpSt, width: 190, textAlign: 'left', colorScheme: 'dark' }} />
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Hours &amp; HRS/RO below are written to this date for each advisor (overwrites that day).</div>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
                  Matched <strong style={{ color: '#e2e8f0' }}>{matched.length}</strong> advisor{matched.length === 1 ? '' : 's'}{unmatched.length ? ` · ${unmatched.length} not on this roster` : ''}.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                  {matched.map(r => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                      <span style={{ color: '#cbd5e1', flex: 1 }}>{r.advisor} <span style={{ color: '#64748b', fontSize: 11 }}>({r.name})</span></span>
                      <span style={{ color: '#6ee7b7', fontWeight: 700, minWidth: 84, textAlign: 'right' }}>{num(r.hours, 1)} hrs</span>
                      <span style={{ color: '#93c5fd', fontWeight: 700, minWidth: 84, textAlign: 'right' }}>{num(r.hrsRo, 2)} hrs/RO</span>
                    </div>
                  ))}
                  {unmatched.map(r => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 10px', background: 'rgba(255,255,255,.02)', borderRadius: 6, opacity: .6 }}>
                      <span style={{ color: '#94a3b8', flex: 1 }}>{r.name} <span style={{ color: '#f59e0b', fontSize: 11 }}>— no match, skipped</span></span>
                      <span style={{ color: '#64748b', fontWeight: 700, minWidth: 84, textAlign: 'right' }}>{num(r.hours, 1)} hrs</span>
                      <span style={{ color: '#64748b', fontWeight: 700, minWidth: 84, textAlign: 'right' }}>{num(r.hrsRo, 2)} hrs/RO</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button className="secondary" onClick={() => setUploadRows(null)}>Cancel</button>
                  <button onClick={applyUpload} disabled={xlsxBusy || !matched.length || !uploadDate}
                    style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: (xlsxBusy || !matched.length || !uploadDate) ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13, opacity: (xlsxBusy || !matched.length || !uploadDate) ? .5 : 1 }}>
                    {xlsxBusy ? '⏳ Saving…' : `✓ Apply to ${matched.length} advisor${matched.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {renderDayEndModal()}
      {renderUploadModal()}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🎯 Goals / Forecasting</div>
          <div className="adv-sub">{selected}{isMine ? ' (Mine)' : ''} · {M.label}</div>
        </div>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <>
            <input ref={uploadInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={e => handleXlsx(e.target.files && e.target.files[0])} />
            <button className="secondary" onClick={() => uploadInputRef.current && uploadInputRef.current.click()} disabled={xlsxBusy} style={{ marginRight: 10 }}>
              {xlsxBusy ? '⏳ Reading…' : '📊 Upload Advisor Report'}
            </button>
          </>
        )}
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      {/* Advisor roster — click to view anyone (read-only unless yours / you're lead) */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', flexWrap: 'wrap' }}>
        {roster.map(a => (
          <button key={a} onClick={() => { setSelected(a); setGridOpen(false); }}
            style={{ background: selected === a ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)', border: `1px solid ${selected === a ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)'}`, color: selected === a ? '#c4b5fd' : '#94a3b8', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            {a}{me === a ? ' (You)' : ''}
          </button>
        ))}
      </div>

      {/* Month / History tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          { k: 'current', label: curLabel },
          ...(showNext ? [{ k: 'next', label: `🗓 ${nextLabel} · Prep`, prep: true }] : []),
          { k: 'history', label: '🗂 History' },
        ].map(t => (
          <button key={t.k} onClick={() => { setView(t.k); setHistSel(null); }}
            style={t.prep
              ? { background: view === t.k ? 'rgba(251,191,36,.22)' : 'rgba(251,191,36,.08)', border: `1px solid ${view === t.k ? 'rgba(251,191,36,.6)' : 'rgba(251,191,36,.3)'}`, color: view === t.k ? '#fcd34d' : '#fbbf24', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }
              : { background: view === t.k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${view === t.k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: view === t.k ? '#6ee7f9' : '#94a3b8', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>{t.label}</button>
        ))}
        {(roster.includes(me) || isAdmin) && (
          <button onClick={openDayEnd}
            style={{ background: 'rgba(74,222,128,.16)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>📋 Day End Reporting</button>
        )}
        {onLivePay && (
          <button onClick={() => onLivePay(selected)}
            style={{ background: 'rgba(52,211,153,.16)', border: '1px solid rgba(52,211,153,.45)', color: '#6ee7b7', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>💵 Live Pay</button>
        )}
        {!isMine && view === 'current' && <div style={{ alignSelf: 'center', fontSize: 12, color: '#fbbf24', fontWeight: 700, marginLeft: 6 }}>👁 Viewing {selected} — {canEditGoals ? 'you can set goals' : 'read-only'}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {deMsg && deMsg.startsWith('✓') && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.35)' }}>{deMsg}</div>
          )}
          {uploadMsg && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.35)' }}>{uploadMsg}</div>
          )}
          {isNext && (
            <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#fcd34d', background: 'linear-gradient(150deg, rgba(251,191,36,.16), rgba(251,191,36,.05))', border: '1px solid rgba(251,191,36,.4)' }}>
              🗓 Prepping <strong>{nextLabel}</strong> — set next month’s goals here ahead of time.{canEditGoals ? '' : ' (Read-only — a lead advisor or manager sets the goals.)'}
            </div>
          )}
          {loading ? <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
            : view === 'history' ? renderHistory()
              : renderDetail(M, charts, { goals: canEditGoals, days: canEditDaysFor(selected) })}
        </div>
      </div>
    </div>
  );
}
