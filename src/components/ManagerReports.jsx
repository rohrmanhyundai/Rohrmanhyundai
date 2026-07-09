import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { loadGithubFile, saveGithubFile, loadUsers, getGithubToken, setGithubToken, loadDashboardData, loadSchedules, loadWipData, loadAwaitingData, loadCoaching, saveCoaching, loadCoachingViews, loadFormerEmployees } from '../utils/github';
import { generateTechCoaching, generateAdvisorCoaching, getOpenAIKey } from '../utils/openai';
import PerformanceReport, { CoachingReportBody } from './PerformanceReport';
import { trackAction } from '../utils/activityTracker';
import { canonicalAdvisorFirst } from '../utils/advisorAliases';

// ── Shared helpers reused by the historical backfill uploader ────────────────
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();

// Parses an advisor performance .xlsx and returns { firstName → fields }. The
// fields cover MTD Hrs, MTD ROs, ELR %, Coupon Labor, Total Sales — same set
// the live editor importer uses.
async function parseAdvisorXlsxFile(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (!rows.length) throw new Error('XLSX appears empty.');

  const norm = (v) => String(v ?? '').trim().toLowerCase();
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.some(c => c.includes('advisor') || c === 'name')
        && cells.some(c => c.includes('bill') || c.includes('ro count') || c.includes('elr') || c.includes('coupon'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) throw new Error('Could not find header row in XLSX.');
  const headerCells = (rows[headerIdx] || []).map(norm);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = (n) => new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`);
  const findCol = (...needles) => {
    for (let i = 0; i < headerCells.length; i++) if (needles.some(n => headerCells[i] === n)) return i;
    for (let i = 0; i < headerCells.length; i++) if (needles.some(n => wordRegex(n).test(headerCells[i]))) return i;
    return -1;
  };
  const stripWs = (s) => String(s || '').replace(/\s+/g, '');
  const colELR = (() => {
    const want = ['elr(%)', 'elr%'];
    const stripped = headerCells.map(stripWs);
    for (let i = 0; i < stripped.length; i++) if (want.includes(stripped[i])) return i;
    return -1;
  })();

  const colName    = findCol('advisor name', 'advisor', 'name');
  const colHours   = findCol('bill hours', 'bill hour', 'bill hrs', 'billed hours', 'billed hrs');
  const colROs     = findCol('ro count', '# ros', "ro's", 'ros');
  const colCoupon  = findCol('coupon labor', 'coupon');
  const colTotalSales = findCol('total sales');

  if (colName === -1) throw new Error('No Advisor Name column found in XLSX.');

  const num = (cell) => {
    const v = String(cell ?? '').replace(/[, $%]/g, '').trim();
    if (!v) return null;
    const f = parseFloat(v);
    return isNaN(f) ? null : f;
  };

  const out = {};
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[colName] ?? '').trim();
    if (!name) continue;
    if (/^(total|grand|average|avg|summary)/i.test(name)) continue;
    const fn = firstWord(name);
    if (!fn) continue;
    const fields = out[fn] || (out[fn] = { reportName: name });
    if (colHours !== -1) { const v = num(row[colHours]); if (v !== null) fields.mtd_hours = v; }
    if (colROs !== -1)   { const v = num(row[colROs]);   if (v !== null && Number.isInteger(v) && v < 5000) fields.ro_count = v; }
    if (colELR !== -1)   { const v = num(row[colELR]);   if (v !== null && v <= 200) fields.elr = Math.round((v / 100) * 10000) / 10000; }
    if (colCoupon !== -1)     { const v = num(row[colCoupon]);     if (v !== null) fields.coupon_labor = v; }
    if (colTotalSales !== -1) { const v = num(row[colTotalSales]); if (v !== null) fields.total_sales = v; }
  }
  // Derive coupon usage % per row.
  for (const fn of Object.keys(out)) {
    const f = out[fn];
    const sales = parseFloat(f.total_sales) || 0;
    const coupon = parseFloat(f.coupon_labor) || 0;
    if (sales > 0) f.coupon_usage_pct = Math.round((coupon / sales) * 10000) / 10000;
    const hrs = parseFloat(f.mtd_hours) || 0;
    const ros = parseFloat(f.ro_count) || 0;
    if (ros > 0) f.hours_per_ro = Math.round((hrs / ros) * 100) / 100;
  }
  return out;
}

// PDF.js lazy loader (same CDN pattern as everywhere else in the app).
let pdfjsP = null;
function loadPdfJs() {
  if (pdfjsP) return pdfjsP;
  pdfjsP = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
    document.head.appendChild(s);
  });
  return pdfjsP;
}

// Parses an SA Totals advisor performance .pdf and returns { firstName → fields }.
// Only Alignment / Tires / Valvoline / ASR penetration % land here.
async function parseAdvisorPdfFile(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = {};
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (byY[y] = byY[y] || []).push({ x: it.transform[4], text: it.str });
    }
    Object.entries(byY).sort(([a], [b]) => Number(b) - Number(a)).forEach(([, items]) => {
      items.sort((a, b) => a.x - b.x);
      const line = items.map(i => i.text).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (line) allLines.push(line);
    });
  }
  const headerLine = allLines.find(L => {
    const u = L.toUpperCase();
    return u.includes('ALIGNMENT PEN') && u.includes('VALVOLINE PEN') && u.includes('TIRE PEN') && u.includes('ASR SOLD');
  });
  if (!headerLine) throw new Error('PDF format unexpected — missing Alignment / Tire / Valvoline / ASR headers.');

  // Right-indexed positions (from the end of the numeric sequence): the
  // SA Totals tail is ... ASR% INSP% ALIGN% BATTERY% TIRE% VALV% TOP-GUN RANK
  // A leading-cell split by PDF.js (e.g. "13.60%" → "13" + "60%") would
  // shift left-indexed positions; counting from the end keeps the upsell
  // columns stable as long as the final cells are intact.
  const FROM_END_ASR = 8, FROM_END_ALIGNMENT = 6, FROM_END_TIRE = 4, FROM_END_VALVOLINE = 3;
  const fromEnd = (arr, n) => (arr.length >= n ? arr[arr.length - n] : undefined);
  const numRe = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
  const parsePct = (raw) => {
    const v = String(raw || '').replace(/[, $]/g, '').replace('%', '').trim();
    if (!v) return null;
    const f = parseFloat(v);
    if (isNaN(f)) return null;
    return f > 1 ? f / 100 : f;
  };

  const out = {};
  for (const line of allLines) {
    if (line === headerLine) continue;
    if (/\b(total|grand|average|all dealers|number of)\b/i.test(line)) continue;
    const nums = (line.match(numRe) || []);
    if (nums.length < FROM_END_ASR) continue;
    // Pull a likely advisor name: contiguous uppercase letters (length ≥ 3) on the line.
    const nameMatch = line.match(/\b([A-Z][A-Z'\-]{2,})\b(?:\s+[A-Z][A-Z'\-]{1,})?/);
    if (!nameMatch) continue;
    const name = nameMatch[0].trim();
    const fn = firstWord(name);
    if (!fn) continue;
    // Slice numerics after the matched name to keep header / date noise out.
    const after = line.slice(line.indexOf(nameMatch[0]) + nameMatch[0].length);
    const tailNums = (after.match(numRe) || []);
    if (tailNums.length < FROM_END_ASR) continue;
    const fields = out[fn] || (out[fn] = { reportName: name });
    const apply = (key, n) => {
      const v = parsePct(fromEnd(tailNums, n));
      if (v !== null) fields[key] = Math.round(v * 10000) / 10000;
    };
    apply('asr',       FROM_END_ASR);
    apply('align',     FROM_END_ALIGNMENT);
    apply('tires',     FROM_END_TIRE);
    apply('valvoline', FROM_END_VALVOLINE);
  }
  return out;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${String(+y).slice(2)}`;
}

function weekOfYear(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date  = new Date(y, m - 1, d);
  const jan1  = new Date(y, 0, 1);
  const dayOfYear = Math.floor((date - jan1) / 86400000) + 1;
  return Math.ceil(dayOfYear / 7);
}

const ADVISOR_FIELDS = [
  { key: 'csi',             label: 'CSI',      type: 'number', decimals: 0 },
  { key: 'ro_count',        label: 'MTD ROs',  type: 'number', decimals: 0 },
  { key: 'hours_per_ro',    label: 'Hrs/RO',   type: 'number', decimals: 2 },
  { key: 'roh50_hrs_ro',    label: 'Roh$50/RO',type: 'number', decimals: 2 },
  { key: 'mtd_hours',       label: 'MTD Hrs',  type: 'number', decimals: 1 },
  { key: 'daily_avg',       label: 'Daily Avg',type: 'number', decimals: 2 },
  { key: 'align',           label: 'Align',    type: 'pct',    decimals: 3 },
  { key: 'tires',           label: 'Tires',    type: 'pct',    decimals: 4 },
  { key: 'valvoline',       label: 'Valvoline',type: 'pct',    decimals: 4 },
  { key: 'asr',             label: 'ASR',      type: 'pct',    decimals: 4 },
  { key: 'elr',             label: 'ELR',      type: 'number', decimals: 2 },
  { key: 'last_month_total',label: 'Last Mo.', type: 'number', decimals: 1 },
];

const TECH_FIELDS = [
  { key: 'total',    label: 'Total Hrs', type: 'number', decimals: 1 },
  { key: 'goal',     label: 'Goal Hrs',  type: 'number', decimals: 1 },
  { key: 'goal_pct', label: 'Goal %',    type: 'pct',    decimals: 4 },
  { key: 'pacing',   label: 'Pacing',    type: 'number', decimals: 1 },
  { key: 'sat',      label: 'SAT',       type: 'number', decimals: 1, isDay: true, offset: 0 },
  { key: 'mon',      label: 'MON',       type: 'number', decimals: 1, isDay: true, offset: 2 },
  { key: 'tue',      label: 'TUE',       type: 'number', decimals: 1, isDay: true, offset: 3 },
  { key: 'wed',      label: 'WED',       type: 'number', decimals: 1, isDay: true, offset: 4 },
  { key: 'thu',      label: 'THU',       type: 'number', decimals: 1, isDay: true, offset: 5 },
  { key: 'fri',      label: 'FRI',       type: 'number', decimals: 1, isDay: true, offset: 6 },
  { key: 'sat_ro',   label: 'SAT ROs',   type: 'number', decimals: 0, hideInTable: true },
  { key: 'mon_ro',   label: 'MON ROs',   type: 'number', decimals: 0, hideInTable: true },
  { key: 'tue_ro',   label: 'TUE ROs',   type: 'number', decimals: 0, hideInTable: true },
  { key: 'wed_ro',   label: 'WED ROs',   type: 'number', decimals: 0, hideInTable: true },
  { key: 'thu_ro',   label: 'THU ROs',   type: 'number', decimals: 0, hideInTable: true },
  { key: 'fri_ro',   label: 'FRI ROs',   type: 'number', decimals: 0, hideInTable: true },
];

function displayVal(val, field) {
  if (val === '' || val === null || val === undefined) return '—';
  if (field.type === 'pct') return (parseFloat(val) * 100).toFixed(1) + '%';
  return parseFloat(val).toFixed(field.decimals);
}

function inputToStored(raw, field) {
  const n = parseFloat(raw);
  if (isNaN(n)) return '';
  return field.type === 'pct' ? n / 100 : n;
}

function storedToInput(val, field) {
  if (val === '' || val === null || val === undefined) return '';
  if (field.type === 'pct') return (parseFloat(val) * 100).toFixed(2);
  return String(val);
}

const inp = (extra = {}) => ({
  background: 'rgba(255,255,255,.07)',
  border: '1px solid rgba(255,255,255,.15)',
  borderRadius: 8,
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  ...extra,
});

function blankEntry(fields) {
  const e = { date: new Date().toISOString().split('T')[0], label: '' };
  fields.forEach(f => { e[f.key] = ''; });
  return e;
}

export default function ManagerReports({ users, onBack }) {
  const advisors = (users || []).filter(u => u.role === 'advisor' || u.role === 'lead advisor').map(u => u.username.toUpperCase());
  const techs    = (users || []).filter(u => u.role === 'technician').map(u => u.username.toUpperCase());
  const allUsers = [...advisors, ...techs];

  const [selected, setSelected] = useState(allUsers[0] || '');
  const [viewUser, setViewUser] = useState(null);
  // Former employees (deleted users whose performance reports we keep). Shown
  // under the "Previous Employees" tab so managers can still pull their history.
  const [formerEmployees, setFormerEmployees] = useState([]); // [{ username, role, deletedAt }]

  // Resolve a user's role whether they're current (advisors/techs) or former.
  const roleOf = (u) => {
    if (advisors.includes(u)) return 'advisor';
    if (techs.includes(u)) return 'technician';
    const f = formerEmployees.find(fe => (fe.username || '').toUpperCase() === u);
    return (f && (f.role || '').includes('tech')) ? 'technician' : 'advisor';
  };
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiPickerOpen, setAiPickerOpen] = useState(false);
  const [aiPickerSelected, setAiPickerSelected] = useState(() => new Set());
  const [aiPickerMode, setAiPickerMode] = useState('tech'); // 'tech' | 'advisor'
  // Historical-backfill upload modal state.
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState('');
  const [backfillDate, setBackfillDate] = useState(() => {
    const d = new Date(); d.setDate(0); // last day of previous month
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [backfillXlsxFile, setBackfillXlsxFile] = useState(null);
  const [backfillPdfFile, setBackfillPdfFile] = useState(null);
  const backfillXlsxRef = useRef(null);
  const backfillPdfRef = useRef(null);
  // Coaching reports viewer modal — lets the manager browse every AI report
  // they've generated, grouped by user, without opening each report screen.
  const [coachingViewerOpen, setCoachingViewerOpen] = useState(false);
  const [coachingViewerLoading, setCoachingViewerLoading] = useState(false);
  const [coachingViewerData, setCoachingViewerData] = useState({}); // username → reports[]
  const [coachingViewerSelected, setCoachingViewerSelected] = useState(null); // username currently expanded
  const [coachingViewsMap, setCoachingViewsMap] = useState({}); // username → { reportId: ISOTimestamp }
  const [techGoals, setTechGoals] = useState({}); // { TECHNAME: weeklyGoalHrs }
  const [schedules, setSchedules] = useState({}); // { TECHNAME: { "2026-05-04": "vacation" }, __HOLIDAY__: {...} }
  const [vacationDates, setVacationDates] = useState({}); // { TECHNAME: Set("2026-05-04") }

  useEffect(() => {
    loadFormerEmployees()
      .then(list => setFormerEmployees(Array.isArray(list) ? list : []))
      .catch(() => setFormerEmployees([]));
  }, []);

  useEffect(() => {
    loadDashboardData()
      .then(d => {
        const map = {};
        for (const t of (d?.data?.technicians || [])) {
          if (t.name) map[t.name.toUpperCase()] = parseFloat(t.goal) || 0;
        }
        setTechGoals(map);
        // Build vacation date set per tech from data.vacations as a fallback
        const vacMap = {};
        for (const v of (d?.data?.vacations || [])) {
          if (!v.name || !v.dateStart || !v.dateEnd) continue;
          const name = v.name.toUpperCase();
          if (!vacMap[name]) vacMap[name] = new Set();
          const s = new Date(v.dateStart + 'T00:00:00');
          const e = new Date(v.dateEnd   + 'T00:00:00');
          for (let dv = new Date(s); dv <= e; dv.setDate(dv.getDate() + 1)) {
            vacMap[name].add(isoLocal(dv));
          }
        }
        setVacationDates(vacMap);
      })
      .catch(() => {});
    loadSchedules().then(s => setSchedules(s || {})).catch(() => {});
  }, []);

  // Returns 8 if the tech has vacation/training/holiday on `iso`, else 0
  function bonusHoursFor(techName, iso) {
    const BONUS = new Set(['vacation', 'training', 'holiday']);
    const techSched = schedules[techName] || schedules[(techName || '').toUpperCase()] || {};
    const holidays  = schedules['__HOLIDAY__'] || {};
    const vacSet    = vacationDates[(techName || '').toUpperCase()] || new Set();
    if (holidays[iso] === 'holiday') return 8;
    if (BONUS.has(techSched[iso])) return 8;
    if (vacSet.has(iso)) return 8;
    return 0;
  }

  // Find the Saturday (week start) for a given Wk number, using the same
  // numbering as weekOfYear: ceil(dayOfYear / 7).
  function saturdayForWeek(weekNum, year) {
    for (let day = 7 * (weekNum - 1) + 1; day <= 7 * weekNum + 6; day++) {
      const d = new Date(year, 0, day);
      if (d.getFullYear() !== year && day > 7 * weekNum) break;
      if (d.getDay() === 6) return d;
    }
    return null;
  }
  function fmtRange(sat) {
    const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Week of ${fmt(sat)} – ${fmt(fri)}`;
  }
  function isoLocal(d) {
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dy=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dy}`;
  }
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [status, setStatus]     = useState('');
  const [editIdx, setEditIdx]   = useState(null); // null = new, number = editing existing
  const [form, setForm]         = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingIdx, setDeletingIdx] = useState(null);

  const isAdvisor = advisors.includes(selected);
  const fields    = isAdvisor ? ADVISOR_FIELDS : TECH_FIELDS;

  async function ensureToken() {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        if (result?.sharedSaveCode) { setGithubToken(result.sharedSaveCode); return true; }
      } catch {}
      const code = prompt('Enter save code:');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setShowForm(false);
    setForm(null);
    loadGithubFile(`data/performance-reports/${selected}.json`)
      .then(d => setEntries(Array.isArray(d) ? d.sort((a, b) => new Date(b.date) - new Date(a.date)) : []))
      .finally(() => setLoading(false));
  }, [selected]);

  function openNew() {
    setEditIdx(null);
    setForm(blankEntry(fields));
    setShowForm(true);
  }

  function openEdit(idx) {
    const e = entries[idx];
    const f = { ...blankEntry(fields), ...e };
    // convert stored pct values to display format for inputs
    fields.forEach(field => {
      f[field.key] = storedToInput(e[field.key], field);
    });
    f.date = e.date ? e.date.split('T')[0] : '';
    setEditIdx(idx);
    setForm(f);
    setShowForm(true);
  }

  function updateForm(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form) return;
    if (!await ensureToken()) return;
    setSaving(true); setStatus('⏳ Saving…');
    try {
      // Build cleaned entry
      const entry = { date: form.date, label: form.label || '' };
      // For advisors, tag the month so the report can group by month
      if (isAdvisor && form.date) {
        entry.month = form.date.slice(0, 7);
        entry.type  = 'advisor';
      } else {
        entry.type = 'tech';
        // Tech entries are weekly: derive weekStart/weekEnd from form.date (Saturday)
        if (form.date) {
          const sat = new Date(form.date + 'T00:00:00');
          const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
          entry.weekStart = isoLocal(sat);
          entry.weekEnd   = isoLocal(fri);
        }
      }
      fields.forEach(f => {
        entry[f.key] = inputToStored(form[f.key], f);
      });
      // For tech entries, auto-compute total/goal_pct/pacing from the day fields
      if (!isAdvisor) {
        const num = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? 0 : parseFloat(v);
        const sat = num(entry.sat), mon = num(entry.mon), tue = num(entry.tue),
              wed = num(entry.wed), thu = num(entry.thu), fri = num(entry.fri);
        const total = sat + mon + tue + wed + thu + fri;
        entry.total = total;
        const goalNum = num(entry.goal);
        entry.goal_pct = goalNum > 0 ? total / goalNum : 0;
        const workedSat     = sat > 0;
        const totalWorkdays = workedSat ? 6 : 5;
        const daysWorked    = [mon, tue, wed, thu, fri].filter(v => v > 0).length + (workedSat ? 1 : 0);
        entry.pacing = daysWorked > 0 ? (total / daysWorked) * totalWorkdays : 0;
        // RO counts: keep what user entered (already handled by fields loop) and total
        const sumROs = ['sat_ro','mon_ro','tue_ro','wed_ro','thu_ro','fri_ro']
          .reduce((s, k) => s + num(entry[k]), 0);
        entry.total_ro = sumROs;
      }
      entry.savedAt = new Date().toISOString();

      let updated;
      if (editIdx !== null) {
        updated = [...entries];
        updated[editIdx] = entry;
      } else {
        updated = [entry, ...entries];
      }
      // Sort newest first for storage
      updated.sort((a, b) => new Date(b.date) - new Date(a.date));
      await saveGithubFile(`data/performance-reports/${selected}.json`, updated, `Performance report snapshot for ${selected}`);
      setEntries(updated);
      setShowForm(false);
      setForm(null);
      setStatus('✅ Saved!');
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openAiPicker(mode = 'tech') {
    if (!getOpenAIKey()) {
      alert('No OpenAI API key set. Go to Admin Settings → OpenAI Settings.');
      return;
    }
    const role = mode === 'advisor' ? 'advisor' : 'technician';
    const names = (users || []).filter(u => u.role === role).map(u => u.username.toUpperCase());
    if (names.length === 0) { alert(`No ${role}s found.`); return; }
    setAiPickerMode(mode);
    setAiPickerSelected(new Set(names));
    setAiPickerOpen(true);
  }

  async function openCoachingViewer() {
    trackAction('view-ai-reports');
    setCoachingViewerOpen(true);
    setCoachingViewerSelected(null);
    setCoachingViewerLoading(true);
    setCoachingViewerData({});
    setCoachingViewsMap({});
    try {
      const everyone = [...advisors, ...techs];
      const [results, views] = await Promise.all([
        Promise.all(
          everyone.map(async u => {
            const reports = await loadCoaching(u).catch(() => []);
            return [u, Array.isArray(reports) ? reports : []];
          })
        ),
        loadCoachingViews().catch(() => ({})),
      ]);
      const map = {};
      for (const [u, reports] of results) {
        if (reports.length > 0) map[u] = reports;
      }
      setCoachingViewerData(map);
      setCoachingViewsMap(views || {});
      // Auto-select the most recently generated report.
      let newestUser = null, newestTs = 0;
      for (const [u, reports] of Object.entries(map)) {
        for (const r of reports) {
          const t = r.generatedAt ? new Date(r.generatedAt).getTime() : 0;
          if (t > newestTs) { newestTs = t; newestUser = u; }
        }
      }
      if (newestUser) setCoachingViewerSelected(newestUser);
    } finally {
      setCoachingViewerLoading(false);
    }
  }

  async function applyBackfill() {
    if (!backfillXlsxFile && !backfillPdfFile) {
      setBackfillStatus('❌ Pick at least one file (.xlsx and/or .pdf).');
      return;
    }
    if (!backfillDate) { setBackfillStatus('❌ Pick the report date.'); return; }
    if (!await ensureToken()) return;
    setBackfillBusy(true);
    setBackfillStatus('⏳ Parsing files…');
    try {
      const merged = {}; // firstName → { fields, reportName }
      if (backfillXlsxFile) {
        const x = await parseAdvisorXlsxFile(backfillXlsxFile);
        for (const fn of Object.keys(x)) merged[fn] = { ...(merged[fn] || {}), ...x[fn] };
      }
      if (backfillPdfFile) {
        const p = await parseAdvisorPdfFile(backfillPdfFile);
        for (const fn of Object.keys(p)) merged[fn] = { ...(merged[fn] || {}), ...p[fn] };
      }

      // Resolve report first names to known advisor usernames.
      const advisorFn = (advisors || []).map(a => ({ name: a, fn: firstWord(a) }));
      const month = backfillDate.slice(0, 7);
      const today = backfillDate;
      const labelDate = (() => {
        const [y, m, d] = backfillDate.split('-').map(n => parseInt(n, 10));
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', year: 'numeric', day: 'numeric' });
      })();

      let updated = 0;
      const skipped = [];
      const updatedNames = [];

      for (const fn of Object.keys(merged)) {
        // Map report aliases (e.g. "caiden" → "isaiah") before matching roster.
        const canonFn = canonicalAdvisorFirst(fn).toLowerCase();
        const match = advisorFn.find(a => a.fn === canonFn);
        if (!match) { skipped.push(merged[fn].reportName || fn); continue; }
        const username = match.name;
        setBackfillStatus(`⏳ Writing snapshot for ${username}…`);
        const existing = await loadGithubFile(`data/performance-reports/${username}.json`).then(d => Array.isArray(d) ? d : []).catch(() => []);
        const f = merged[fn];
        // Build an entry that mirrors the live Send-to-Reports payload shape.
        const entry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          date: today,
          label: labelDate,
          month,
          type: 'advisor',
          savedAt: new Date().toISOString(),
          mtd_hours:        f.mtd_hours        ?? null,
          ro_count:         f.ro_count         ?? null,
          hours_per_ro:     f.hours_per_ro     ?? null,
          align:            f.align            ?? null,
          tires:            f.tires            ?? null,
          valvoline:        f.valvoline        ?? null,
          asr:              f.asr              ?? null,
          elr:              f.elr              ?? null,
          coupon_labor:     f.coupon_labor     ?? null,
          total_sales:      f.total_sales      ?? null,
          coupon_usage_pct: f.coupon_usage_pct ?? null,
        };
        // Replace any existing entry for the same date, then sort newest-first.
        const next = [entry, ...existing.filter(e => e.date !== today)];
        next.sort((a, b) => new Date(b.date) - new Date(a.date));
        await saveGithubFile(`data/performance-reports/${username}.json`, next, `Backfill advisor snapshot for ${username} on ${today}`);
        updated++;
        updatedNames.push(username);
      }

      const parts = [`✅ Backfilled ${updated} advisor${updated === 1 ? '' : 's'} for ${labelDate}`];
      if (updatedNames.length) parts.push(`(${updatedNames.join(', ')})`);
      if (skipped.length)      parts.push(`· skipped (not on dashboard): ${skipped.join(', ')}`);
      setBackfillStatus(parts.join(' '));
      // Reset file refs but keep the modal open so the user can see the summary.
      setBackfillXlsxFile(null);
      setBackfillPdfFile(null);
      if (backfillXlsxRef.current) backfillXlsxRef.current.value = '';
      if (backfillPdfRef.current)  backfillPdfRef.current.value = '';
    } catch (err) {
      setBackfillStatus('❌ ' + (err.message || err));
    } finally {
      setBackfillBusy(false);
    }
  }

  async function handleGenerateAdvisorAI(advisorNamesIn) {
    const advisorNames = Array.isArray(advisorNamesIn) ? advisorNamesIn : [];
    if (advisorNames.length === 0) { alert('Pick at least one advisor.'); return; }
    if (!await ensureToken()) return;
    trackAction('generate-advisor-ai-report', advisorNames.join(','));

    setGeneratingAI(true);
    setStatus(`⏳ Generating coaching reports… (0/${advisorNames.length})`);
    let done = 0, failed = 0;
    try {
      // Load shop-wide WIP once so we can slice it by advisor.
      const allTechs = (users || []).filter(u => u.role === 'technician').map(u => u.username.toUpperCase());
      const wipByTech = await Promise.all(allTechs.map(t => loadWipData(t).then(rows => (rows || []).map(r => ({ ...r, tech: t }))).catch(() => [])));
      const allWip = wipByTech.flat();
      for (const adv of advisorNames) {
        try {
          setStatus(`⏳ Generating coaching reports… ${adv} (${done}/${advisorNames.length})`);
          const entries = await loadGithubFile(`data/performance-reports/${adv}.json`).then(d => Array.isArray(d) ? d : []);
          const dailyEntries = entries.filter(e => (e.type || 'advisor') === 'advisor');
          const wipForAdvisor = allWip.filter(j => (j.advisor || '').toUpperCase() === adv);
          const reportText = await generateAdvisorCoaching({ advisorName: adv, dailyEntries, wipForAdvisor });
          const now = new Date();
          const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            generatedAt: now.toISOString(),
            weekLabel: '',
            report: reportText,
          };
          await saveCoaching(adv, [entry]);
          done++;
        } catch (err) {
          failed++;
          console.error(`Coaching failed for ${adv}:`, err);
        }
      }
      setStatus(failed === 0 ? `✅ Generated ${done} report${done === 1 ? '' : 's'}!` : `⚠️ Done — ${done} ok, ${failed} failed`);
      setTimeout(() => setStatus(''), 6000);
    } finally {
      setGeneratingAI(false);
    }
  }

  async function handleGenerateAI(techNamesIn) {
    const techNames = Array.isArray(techNamesIn) ? techNamesIn : [];
    if (techNames.length === 0) { alert('Pick at least one tech.'); return; }
    if (!await ensureToken()) return;
    trackAction('generate-tech-ai-report', techNames.join(','));

    setGeneratingAI(true);
    setStatus(`⏳ Generating AI reports… (0/${techNames.length})`);
    let done = 0, failed = 0;
    try {
      // Need awaiting list once
      const awaiting = await loadAwaitingData().catch(() => []);
      for (const tech of techNames) {
        try {
          setStatus(`⏳ Generating AI reports… ${tech} (${done}/${techNames.length})`);
          const [entries, wip] = await Promise.all([
            loadGithubFile(`data/performance-reports/${tech}.json`).then(d => Array.isArray(d) ? d : []),
            loadWipData(tech).catch(() => []),
          ]);
          const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
          const goalHrs = techGoals[tech] || sorted[0]?.goal || null;
          const reportText = await generateTechCoaching({
            techName: tech, weeklyEntries: sorted, wip, awaiting, goalHrs,
          });
          const now = new Date();
          const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            generatedAt: now.toISOString(),
            weekLabel: sorted[0]?.label || sorted[0]?.weekStart || '',
            weekStart: sorted[0]?.weekStart || '',
            weekEnd:   sorted[0]?.weekEnd   || '',
            report:    reportText,
          };
          // Replace any previous AI reports for this tech with just the new one.
          await saveCoaching(tech, [entry]);
          done++;
        } catch (err) {
          failed++;
          console.error(`Coaching failed for ${tech}:`, err);
        }
      }
      setStatus(failed === 0 ? `✅ Generated ${done} report${done === 1 ? '' : 's'}!` : `⚠️ Done — ${done} ok, ${failed} failed`);
      setTimeout(() => setStatus(''), 6000);
    } finally {
      setGeneratingAI(false);
    }
  }

  async function handleDelete(idx) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    if (!await ensureToken()) return;
    setDeletingIdx(idx);
    try {
      const updated = entries.filter((_, i) => i !== idx);
      await saveGithubFile(`data/performance-reports/${selected}.json`, updated, `Delete report entry for ${selected}`);
      setEntries(updated);
      setStatus('✅ Deleted.');
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setDeletingIdx(null);
    }
  }

  if (viewUser) {
    return (
      <PerformanceReport
        currentUser={viewUser}
        role={roleOf(viewUser)}
        onBack={() => setViewUser(null)}
        canDelete={true}
      />
    );
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📊 Manager — Performance Reports</div>
          <div className="adv-sub">View, add, and edit employee performance snapshots</div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* Employee selector */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Edit Entry</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allUsers.map(u => (
                  <button key={u} onClick={() => setSelected(u)} style={{
                    background: selected === u ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
                    border: `1px solid ${selected === u ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
                    color: selected === u ? '#6ee7f9' : '#64748b',
                    borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
                  }}>
                    {u}
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: .6 }}>{advisors.includes(u) ? 'ADV' : 'TECH'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {status && <span style={{ fontSize: 13, fontWeight: 700, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#fbbf24' }}>{status}</span>}
              <button onClick={openNew} style={{ background: 'rgba(61,214,195,.15)', border: '1px solid rgba(61,214,195,.35)', color: '#3dd6c3', borderRadius: 10, padding: '9px 20px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                + Add Entry
              </button>
              <button
                onClick={() => openAiPicker('tech')}
                disabled={generatingAI}
                style={{ background: 'rgba(168,85,247,.18)', border: '1px solid rgba(168,85,247,.4)', color: '#c4b5fd', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13, cursor: generatingAI ? 'not-allowed' : 'pointer', opacity: generatingAI ? 0.6 : 1 }}
              >
                {generatingAI ? '⏳ Generating…' : '🤖 Tech Coaching Report'}
              </button>
              <button
                onClick={() => openAiPicker('advisor')}
                disabled={generatingAI}
                style={{ background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.4)', color: '#93c5fd', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13, cursor: generatingAI ? 'not-allowed' : 'pointer', opacity: generatingAI ? 0.6 : 1 }}
              >
                {generatingAI ? '⏳ Generating…' : '🤖 Advisor Coaching Report'}
              </button>
              <button
                onClick={() => { setBackfillStatus(''); setBackfillOpen(true); }}
                style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.45)', color: '#fbbf24', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
              >
                📥 Upload Historical Report
              </button>
              <button
                onClick={openCoachingViewer}
                style={{ background: 'rgba(45,212,191,.18)', border: '1px solid rgba(45,212,191,.45)', color: '#5eead4', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
              >
                📂 View AI Reports
              </button>
            </div>
          </div>

          {/* View Reports selector */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>View Reports</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allUsers.map(u => (
                <button key={u} onClick={() => setViewUser(u)} style={{
                  background: 'rgba(96,165,250,.12)',
                  border: '1px solid rgba(96,165,250,.3)',
                  color: '#93c5fd',
                  borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
                }}>
                  {u}
                  <span style={{ marginLeft: 6, fontSize: 10, opacity: .6 }}>{advisors.includes(u) ? 'ADV' : 'TECH'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Previous Employees — deleted users whose performance reports we kept.
              Managers/admins only (this whole screen is already manager-gated). */}
          {formerEmployees.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Previous Employees <span style={{ opacity: .6, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· performance history kept after removal</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {formerEmployees.map(f => {
                  const u = (f.username || '').toUpperCase();
                  const gone = f.deletedAt ? new Date(f.deletedAt).toLocaleDateString() : '';
                  return (
                    <button key={u} onClick={() => setViewUser(u)} style={{
                      background: 'rgba(148,163,184,.10)',
                      border: '1px solid rgba(148,163,184,.3)',
                      color: '#cbd5e1',
                      borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
                    }}>
                      {u}
                      <span style={{ marginLeft: 6, fontSize: 10, opacity: .6 }}>{roleOf(u) === 'advisor' ? 'ADV' : 'TECH'}</span>
                      {gone && <span style={{ marginLeft: 6, fontSize: 9, opacity: .5 }}>removed {gone}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add / Edit form */}
          {showForm && form && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
                {editIdx !== null ? '✏️ Edit Entry' : '➕ New Entry'} — {selected}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
                {/* Date */}
                <div style={!isAdvisor ? { gridColumn: 'span 2' } : undefined}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>
                    {isAdvisor ? 'Date *' : 'Week Range *'}
                  </div>
                  {isAdvisor ? (
                    <input type="date" value={form.date} onChange={e => updateForm('date', e.target.value)} style={inp()} />
                  ) : (() => {
                    const fmt = d => `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
                    let rangeText = '— use Label field to apply a week —';
                    if (form.date) {
                      const sat = new Date(form.date + 'T00:00:00');
                      const fri = new Date(sat); fri.setDate(sat.getDate() + 6);
                      rangeText = `${fmt(sat)} – ${fmt(fri)}`;
                    }
                    return (
                      <div style={{ ...inp(), display: 'flex', alignItems: 'center', color: form.date ? '#e2e8f0' : '#475569', minHeight: 36 }}>
                        {rangeText}
                      </div>
                    );
                  })()}
                </div>
                {/* Label */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>
                    Label {!isAdvisor && <span style={{ color: '#475569', textTransform: 'none', fontWeight: 500 }}>— type a week number (e.g. 16) and click Apply</span>}
                  </div>
                  {(() => {
                    const wkMatch = !isAdvisor && (form.label || '').match(/^\s*(?:wk|week)?\s*0*(\d{1,2})\s*$/i);
                    const wkNum = wkMatch ? parseInt(wkMatch[1], 10) : null;
                    const showApply = wkNum !== null && wkNum >= 1 && wkNum <= 53;
                    const applyWeek = () => {
                      const year = form.date ? parseInt(form.date.slice(0, 4), 10) : new Date().getFullYear();
                      const sat = saturdayForWeek(wkNum, year);
                      if (!sat) return;
                      const goal = techGoals[selected];
                      // Pre-fill 8.0 for any vacation/training/holiday days that week
                      const dayKeys = [
                        { key: 'sat', off: 0 }, { key: 'mon', off: 2 }, { key: 'tue', off: 3 },
                        { key: 'wed', off: 4 }, { key: 'thu', off: 5 }, { key: 'fri', off: 6 },
                      ];
                      const bonusByKey = {};
                      for (const { key, off } of dayKeys) {
                        const d = new Date(sat); d.setDate(sat.getDate() + off);
                        if (bonusHoursFor(selected, isoLocal(d)) > 0) bonusByKey[key] = '8';
                      }
                      setForm(prev => ({
                        ...prev,
                        date: isoLocal(sat),
                        label: `Wk ${wkNum}`,
                        goal: goal ? String(goal) : prev.goal,
                        ...bonusByKey,
                      }));
                    };
                    return (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={form.label}
                          onChange={e => updateForm('label', e.target.value)}
                          onKeyDown={e => { if (showApply && e.key === 'Enter') { e.preventDefault(); applyWeek(); } }}
                          placeholder={isAdvisor ? 'Optional label…' : 'Type week # (e.g. 16) or custom label…'}
                          style={{ ...inp(), flex: 1 }}
                        />
                        {showApply && (
                          <button type="button" onClick={applyWeek} style={{
                            background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)',
                            color: '#3dd6c3', borderRadius: 8, padding: '0 14px', fontWeight: 800, fontSize: 12,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>Apply Wk {wkNum}</button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {/* Metric fields */}
                {fields.map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>
                      {f.label}{f.type === 'pct' ? ' (%)' : ''}
                    </div>
                    <input
                      type="number" step="any"
                      value={form[f.key]}
                      onChange={e => updateForm(f.key, e.target.value)}
                      placeholder="0"
                      style={inp()}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleSave} disabled={saving} style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 10, padding: '9px 24px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  {saving ? '⏳ Saving…' : '💾 Save Entry'}
                </button>
                <button onClick={() => { setShowForm(false); setForm(null); }} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 10, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Entries table */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>⏳ Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <div style={{ color: '#64748b', fontSize: 15 }}>No report entries yet for <strong style={{ color: '#e2e8f0' }}>{selected}</strong>.</div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>Click "+ Add Entry" or use "Send to Reports" in the Edit Dashboard.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
              <table className="adv-table" style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
                <tbody>
                  {entries.map((e, idx) => {
                    // Compute actual date for each day column from this row's weekStart
                    const dayDate = (offset) => {
                      if (!e.weekStart) return '';
                      const d = new Date(e.weekStart + 'T00:00:00');
                      d.setDate(d.getDate() + offset);
                      return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                    };

                    // Build per-row header row for tech entries (shows day + date in th)
                    const headerRow = idx === 0 ? (
                      <tr>
                        <th style={{ width: 210, minWidth: 210, whiteSpace: 'nowrap', padding: '10px 14px', position: 'sticky', left: 0, zIndex: 2, background: '#0f172a' }}>DATE</th>
                        <th style={{ minWidth: 90, whiteSpace: 'nowrap', padding: '10px 10px', textAlign: 'center' }}>WEEK</th>
                        {fields.filter(f => !f.hideInTable).map(f => (
                          <th key={f.key} style={{ minWidth: f.isDay ? 90 : 100, padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {f.label}
                            {f.isDay && e.weekStart
                              ? <span style={{ marginLeft: 5, fontWeight: 400, color: '#64748b', fontSize: 11 }}>{dayDate(f.offset)}</span>
                              : null}
                          </th>
                        ))}
                        <th style={{ minWidth: 80, whiteSpace: 'nowrap', padding: '10px 8px', position: 'sticky', right: 0, zIndex: 2, background: '#0f172a', textAlign: 'center', boxShadow: '-6px 0 8px -4px rgba(0,0,0,0.5)' }}>ACTIONS</th>
                      </tr>
                    ) : (
                      // Subsequent rows: re-render header with that row's dates
                      <tr>
                        <th colSpan={isAdvisor ? 2 : 2} style={{ padding: '6px 14px', background: '#0a1628', borderTop: '1px solid rgba(255,255,255,.06)' }} />
                        {fields.filter(f => !f.hideInTable).map(f => (
                          <th key={f.key} style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap', background: '#0a1628', borderTop: '1px solid rgba(255,255,255,.06)', fontWeight: 400, color: '#475569', fontSize: 11 }}>
                            {f.isDay && e.weekStart ? dayDate(f.offset) : ''}
                          </th>
                        ))}
                        <th style={{ background: '#0a1628', borderTop: '1px solid rgba(255,255,255,.06)', position: 'sticky', right: 0, zIndex: 2 }} />
                      </tr>
                    );

                    return (
                      <React.Fragment key={idx}>
                        {headerRow}
                        <tr style={{ background: idx % 2 === 0 ? '' : 'rgba(255,255,255,.01)' }}>
                          <td style={{ whiteSpace: 'nowrap', color: '#94a3b8', padding: '9px 14px', position: 'sticky', left: 0, zIndex: 1, background: '#0d1b2a', width: 210, minWidth: 210 }}>
                            {e.weekStart && e.weekEnd
                              ? <>{fmtShort(e.weekStart)} – {fmtShort(e.weekEnd)}</>
                              : fmtDate(e.date)}
                            {e.autoSaved && <span style={{ marginLeft: 5, fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', verticalAlign: 'middle' }}>auto</span>}
                          </td>
                          <td style={{ color: '#6ee7f9', fontWeight: 700, fontSize: 12, textAlign: 'center', padding: '9px 10px', whiteSpace: 'nowrap' }}>
                            Wk {weekOfYear(isAdvisor ? e.date : e.weekStart)}
                          </td>
                          {fields.filter(f => !f.hideInTable).map(f => (
                            <td key={f.key} style={{ color: '#cbd5e1', textAlign: 'center', padding: '9px 10px', whiteSpace: 'nowrap' }}>
                              {displayVal(e[f.key], f)}
                            </td>
                          ))}
                          <td style={{ whiteSpace: 'nowrap', padding: '9px 8px', position: 'sticky', right: 0, zIndex: 1, background: '#0d1b2a', boxShadow: '-6px 0 8px -4px rgba(0,0,0,0.5)' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button onClick={() => openEdit(idx)} title="Edit" style={{ background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', color: '#60a5fa', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✏️</button>
                              <button onClick={() => handleDelete(idx)} disabled={deletingIdx === idx} title="Delete" style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)', color: '#f87171', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>
                                {deletingIdx === idx ? '⏳' : '🗑'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>

      {coachingViewerOpen && (() => {
        const entries = Object.entries(coachingViewerData);
        const advisorList = entries.filter(([u]) => advisors.includes(u)).sort();
        const techList    = entries.filter(([u]) => techs.includes(u)).sort();
        const selectedReports = coachingViewerSelected ? (coachingViewerData[coachingViewerSelected] || []) : [];
        return (
          <div
            onClick={() => setCoachingViewerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.78)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 1100, height: '85vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg, #0f172a, #0b1426)', border: '1px solid rgba(45,212,191,.4)', borderRadius: 18, boxShadow: '0 24px 80px rgba(45,212,191,.18)', overflow: 'hidden' }}
            >
              <div style={{ height: 4, background: 'linear-gradient(90deg, #5eead4, rgba(45,212,191,.4), transparent)', flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px 8px', flexShrink: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#a7f3d0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  📂 AI Coaching Reports
                </div>
                <button
                  onClick={() => setCoachingViewerOpen(false)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
                >✕</button>
              </div>

              {coachingViewerLoading ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: 60, flex: 1 }}>⏳ Loading coaching reports…</div>
              ) : entries.length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: 60, flex: 1 }}>
                  No coaching reports generated yet. Use the Tech or Advisor Coaching Report buttons above to create some.
                </div>
              ) : (
                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                  {/* Left sidebar — user list */}
                  <div style={{ width: 240, borderRight: '1px solid rgba(255,255,255,.06)', overflowY: 'auto', padding: '8px 0', flexShrink: 0 }}>
                    {advisorList.length > 0 && (
                      <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 1 }}>Advisors</div>
                    )}
                    {(() => {
                      const renderRow = ([u, reports]) => {
                        const newest = reports[0]?.generatedAt ? new Date(reports[0].generatedAt).toLocaleDateString() : '';
                        const isSel = coachingViewerSelected === u;
                        const userViews = coachingViewsMap[u] || {};
                        const unread = reports.filter(r => !r.id || !userViews[r.id]).length;
                        return (
                          <button
                            key={u}
                            onClick={() => setCoachingViewerSelected(u)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              background: isSel ? 'rgba(45,212,191,.16)' : 'transparent',
                              border: 'none', borderLeft: `3px solid ${isSel ? '#5eead4' : 'transparent'}`,
                              color: isSel ? '#a7f3d0' : '#cbd5e1',
                              padding: '8px 14px', fontWeight: 800, fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{u}</span>
                              <span style={{ fontSize: 9, color: '#64748b' }}>{reports.length}</span>
                              {unread > 0 && (
                                <span title={`${unread} report${unread === 1 ? '' : 's'} not yet viewed by ${u}`} style={{ marginLeft: 'auto', background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.45)', color: '#fbbf24', borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 900 }}>
                                  {unread} UNREAD
                                </span>
                              )}
                            </div>
                            {newest && <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>{newest}</div>}
                          </button>
                        );
                      };
                      return (
                        <>
                          {advisorList.map(renderRow)}
                          {techList.length > 0 && (
                            <div style={{ padding: '12px 14px 4px', fontSize: 10, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1 }}>Technicians</div>
                          )}
                          {techList.map(renderRow)}
                        </>
                      );
                    })()}
                  </div>

                  {/* Right pane — report content */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 24px' }}>
                    {!coachingViewerSelected ? (
                      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 80 }}>Select someone on the left to view their reports.</div>
                    ) : selectedReports.length === 0 ? (
                      <div style={{ color: '#64748b', textAlign: 'center', paddingTop: 80 }}>No reports for {coachingViewerSelected}.</div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 900, fontSize: 18, color: '#e2e8f0', marginBottom: 4 }}>{coachingViewerSelected}</div>
                        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 18 }}>
                          {selectedReports.length} report{selectedReports.length === 1 ? '' : 's'}
                        </div>
                        {selectedReports.map((r, i) => {
                          const userViews = coachingViewsMap[coachingViewerSelected] || {};
                          const viewedAt = r.id ? userViews[r.id] : null;
                          return (
                            <div key={r.id || i} style={{ marginBottom: i < selectedReports.length - 1 ? 24 : 0, paddingBottom: i < selectedReports.length - 1 ? 24 : 0, borderBottom: i < selectedReports.length - 1 ? '1px solid rgba(168,85,247,.18)' : 'none' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                                <div style={{ fontWeight: 900, fontSize: 13, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 1 }}>
                                  {r.weekLabel || (r.weekStart && r.weekEnd ? `Week of ${r.weekStart} – ${r.weekEnd}` : 'Latest report')}
                                </div>
                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                  Generated {new Date(r.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>

                              {/* Read receipt — surfaces when the recipient actually opened the report */}
                              <div style={{ marginBottom: 12 }}>
                                {viewedAt ? (
                                  <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'rgba(34,197,94,.14)', border: '1px solid rgba(34,197,94,.45)',
                                    color: '#86efac', borderRadius: 999, padding: '3px 10px',
                                    fontWeight: 800, fontSize: 11, letterSpacing: .3,
                                  }}>
                                    ✓ Viewed by {coachingViewerSelected} · {new Date(viewedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                ) : (
                                  <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.4)',
                                    color: '#fbbf24', borderRadius: 999, padding: '3px 10px',
                                    fontWeight: 800, fontSize: 11, letterSpacing: .3,
                                  }}>
                                    ⏳ Not viewed yet
                                  </div>
                                )}
                              </div>

                              <CoachingReportBody text={r.report} />
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {backfillOpen && (
        <div
          onClick={() => !backfillBusy && setBackfillOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 540, background: 'linear-gradient(160deg, #0f172a, #0b1426)', border: '1px solid rgba(251,191,36,.45)', borderRadius: 18, boxShadow: '0 24px 80px rgba(251,191,36,.2)', overflow: 'hidden' }}
          >
            <div style={{ height: 4, background: 'linear-gradient(90deg, #fbbf24, rgba(251,191,36,.4), transparent)' }} />
            <div style={{ padding: '18px 22px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#fde68a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  📥 Upload Historical Report
                </div>
                <button
                  onClick={() => !backfillBusy && setBackfillOpen(false)}
                  disabled={backfillBusy}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 18, cursor: backfillBusy ? 'not-allowed' : 'pointer' }}
                >✕</button>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 1.5 }}>
                Backfill historical advisor numbers from a past month's report. Pick the report date and one or both files — the importer writes a snapshot entry per advisor at that date so the Daily Breakdown and Trending Report fill in retroactively. Existing entry for the same date is replaced.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>Report Date</label>
                  <input
                    type="date"
                    value={backfillDate}
                    onChange={e => setBackfillDate(e.target.value)}
                    disabled={backfillBusy}
                    style={{ background: 'rgba(0,0,0,.22)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, width: '100%' }}
                  />
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Tip: pick the last day of the month the report covers.</div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>Advisor Performance Report (.xlsx)</label>
                  <input
                    ref={backfillXlsxRef}
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={backfillBusy}
                    onChange={e => setBackfillXlsxFile((e.target.files && e.target.files[0]) || null)}
                    style={{ fontSize: 12, color: '#cbd5e1' }}
                  />
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Fills MTD Hrs, MTD ROs, ELR %, Coupon Labor, Total Sales.</div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 4 }}>SA Totals Report (.pdf)</label>
                  <input
                    ref={backfillPdfRef}
                    type="file"
                    accept=".pdf"
                    disabled={backfillBusy}
                    onChange={e => setBackfillPdfFile((e.target.files && e.target.files[0]) || null)}
                    style={{ fontSize: 12, color: '#cbd5e1' }}
                  />
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Fills Alignment %, Tires %, Valvoline %, ASR %.</div>
                </div>

                {backfillStatus && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: backfillStatus.startsWith('✅') ? '#4ade80' : backfillStatus.startsWith('❌') ? '#f87171' : '#fbbf24', lineHeight: 1.5 }}>
                    {backfillStatus}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                  <button
                    onClick={() => setBackfillOpen(false)}
                    disabled={backfillBusy}
                    style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', color: '#cbd5e1', borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: backfillBusy ? 'not-allowed' : 'pointer' }}
                  >Close</button>
                  <button
                    onClick={applyBackfill}
                    disabled={backfillBusy || (!backfillXlsxFile && !backfillPdfFile) || !backfillDate}
                    style={{
                      background: backfillBusy ? 'rgba(251,191,36,.08)' : 'rgba(251,191,36,.25)',
                      border: '1px solid rgba(251,191,36,.55)',
                      color: '#fde68a', borderRadius: 10, padding: '8px 20px', fontWeight: 800, fontSize: 13,
                      cursor: (backfillBusy || (!backfillXlsxFile && !backfillPdfFile) || !backfillDate) ? 'not-allowed' : 'pointer',
                      opacity: (!backfillXlsxFile && !backfillPdfFile) || !backfillDate ? .5 : 1,
                    }}
                  >
                    {backfillBusy ? '⏳ Saving…' : 'Apply Backfill'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {aiPickerOpen && (() => {
        const role = aiPickerMode === 'advisor' ? 'advisor' : 'technician';
        const roleLabelPlural = aiPickerMode === 'advisor' ? 'advisors' : 'techs';
        const allTechs = (users || []).filter(u => u.role === role).map(u => u.username.toUpperCase()).sort();
        const allSelected = allTechs.length > 0 && allTechs.every(t => aiPickerSelected.has(t));
        const toggle = (t) => {
          const next = new Set(aiPickerSelected);
          if (next.has(t)) next.delete(t); else next.add(t);
          setAiPickerSelected(next);
        };
        const accent = aiPickerMode === 'advisor' ? '#60a5fa' : '#a855f7';
        const accentRgba = (a) => aiPickerMode === 'advisor' ? `rgba(96,165,250,${a})` : `rgba(168,85,247,${a})`;
        return (
          <div
            onClick={() => !generatingAI && setAiPickerOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(6px)',
              zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 520, background: 'linear-gradient(160deg, #0f172a, #0b1426)',
                border: `1px solid ${accentRgba(.4)}`, borderRadius: 18,
                boxShadow: `0 24px 80px ${accentRgba(.25)}`, overflow: 'hidden',
              }}
            >
              <div style={{ height: 4, background: `linear-gradient(90deg, ${accent}, ${accentRgba(.4)}, transparent)` }} />
              <div style={{ padding: '18px 22px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, color: aiPickerMode === 'advisor' ? '#bfdbfe' : '#e9d5ff', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🤖 Generate {aiPickerMode === 'advisor' ? 'Advisor' : 'Tech'} Coaching Reports
                  </div>
                  <button
                    onClick={() => !generatingAI && setAiPickerOpen(false)}
                    disabled={generatingAI}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 18, cursor: generatingAI ? 'not-allowed' : 'pointer' }}
                  >✕</button>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
                  Pick which {roleLabelPlural} to generate a coaching report for. Each one calls OpenAI separately.
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button
                    onClick={() => setAiPickerSelected(new Set(allTechs))}
                    disabled={generatingAI}
                    style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', color: '#cbd5e1', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                  >Select All</button>
                  <button
                    onClick={() => setAiPickerSelected(new Set())}
                    disabled={generatingAI}
                    style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', color: '#cbd5e1', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                  >Clear</button>
                  <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', alignSelf: 'center', fontWeight: 700 }}>
                    {aiPickerSelected.size} of {allTechs.length} selected
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, maxHeight: 320, overflowY: 'auto', padding: 4, background: 'rgba(0,0,0,.18)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 10 }}>
                  {allTechs.map(t => {
                    const checked = aiPickerSelected.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => !generatingAI && toggle(t)}
                        disabled={generatingAI}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                          background: checked ? accentRgba(.18) : 'rgba(255,255,255,.03)',
                          border: `1px solid ${checked ? accentRgba(.55) : 'rgba(255,255,255,.08)'}`,
                          color: checked ? (aiPickerMode === 'advisor' ? '#bfdbfe' : '#e9d5ff') : '#94a3b8',
                          borderRadius: 8, padding: '8px 10px', fontWeight: 800, fontSize: 12,
                          cursor: generatingAI ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <span style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: checked ? accent : 'transparent',
                          border: `1.5px solid ${checked ? accent : 'rgba(148,163,184,.4)'}`,
                          color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: '14px', textAlign: 'center',
                        }}>{checked ? '✓' : ''}</span>
                        {t}
                      </button>
                    );
                  })}
                </div>

                {status && (
                  <div style={{ marginTop: 12, fontSize: 12, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                    {status}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setAiPickerOpen(false)}
                    disabled={generatingAI}
                    style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', color: '#cbd5e1', borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: generatingAI ? 'not-allowed' : 'pointer' }}
                  >Cancel</button>
                  <button
                    onClick={async () => {
                      const list = Array.from(aiPickerSelected);
                      if (aiPickerMode === 'advisor') {
                        await handleGenerateAdvisorAI(list);
                      } else {
                        await handleGenerateAI(list);
                      }
                      setAiPickerOpen(false);
                    }}
                    disabled={generatingAI || aiPickerSelected.size === 0}
                    style={{
                      background: aiPickerSelected.size === 0 ? accentRgba(.08) : accentRgba(.25),
                      border: `1px solid ${accentRgba(.55)}`,
                      color: aiPickerMode === 'advisor' ? '#bfdbfe' : '#e9d5ff', borderRadius: 10, padding: '8px 20px', fontWeight: 800, fontSize: 13,
                      cursor: (generatingAI || aiPickerSelected.size === 0) ? 'not-allowed' : 'pointer',
                      opacity: aiPickerSelected.size === 0 ? 0.5 : 1,
                    }}
                  >
                    {generatingAI ? '⏳ Generating…' : `Generate (${aiPickerSelected.size})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
