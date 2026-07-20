import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { safe, parsePercentInput, percentEditValue, n } from '../utils/formatters';
import { advisorDailyAverage, currentWeekDates, advisorOffDates } from '../utils/calculations';
import { getGithubToken, setGithubToken, saveDashboardToGitHub, saveUsers, saveSharedToken, saveSchedules, loadGithubFile, saveGithubFile, saveSharedAwsCreds, loadUsers, deleteUserData, setGoalForecastDaily, saveForceRefresh, loadAdvisorGoals, saveAdvisorGoalsMonth } from '../utils/github';
import { ensureMtd } from '../utils/advisorGoals';
import { canonicalAdvisorFirst, reportNamesForAdvisor } from '../utils/advisorAliases';
import { getAwsCreds, setAwsCreds } from '../utils/s3';
import { getOpenAIKey, setOpenAIKey } from '../utils/openai';
import ManagerReports from './ManagerReports';
import { triggerEvent, SYSTEM_CHANNEL, FORCE_REFRESH_EVENT } from '../utils/pusher';
import { trackAction } from '../utils/activityTracker';

const isAdminOrManager = role => role === 'admin' || (role || '').includes('manager');

// ── Vacation → Schedule helpers ────────────────────────────────────────────
const MONTH_ABBRS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function _parseSingleDate(token, defaultYear) {
  token = token.trim().replace(/,\s*$/, '');
  // MM/DD or MM/DD/YYYY
  const md = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (md) return new Date(md[3] ? +md[3] : defaultYear, +md[1] - 1, +md[2]);
  // Month Day [Year] e.g. "May 1" or "May 1 2026" or "May 1, 2026"
  const mdy = token.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
  if (mdy) {
    const mIdx = MONTH_ABBRS.findIndex(m => mdy[1].toLowerCase().startsWith(m));
    if (mIdx >= 0) return new Date(mdy[3] ? +mdy[3] : defaultYear, mIdx, +mdy[2]);
  }
  return null;
}

function parseDateRange(str) {
  if (!str) return null;
  str = str.trim();
  const yr = new Date().getFullYear();

  // "Month Day-Day [, Year]" e.g. "May 1-5" or "May 1-5, 2026"
  const compact = str.match(/^([A-Za-z]+)\.?\s+(\d{1,2})-(\d{1,2})(?:[,\s]+(\d{4}))?$/);
  if (compact) {
    const mIdx = MONTH_ABBRS.findIndex(m => compact[1].toLowerCase().startsWith(m));
    if (mIdx >= 0) {
      const y = compact[4] ? +compact[4] : yr;
      return { start: new Date(y, mIdx, +compact[2]), end: new Date(y, mIdx, +compact[3]) };
    }
  }

  // Split on " - " / " – " / " — "
  const halves = str.split(/\s*[-–—]\s+/);
  if (halves.length >= 2) {
    const start = _parseSingleDate(halves[0], yr);
    if (start) {
      const end = _parseSingleDate(halves.slice(1).join(' - '), start.getFullYear());
      if (end) return { start, end };
    }
  }

  // Single date
  const single = _parseSingleDate(str, yr);
  if (single) return { start: single, end: single };
  return null;
}

function getWorkingDays(start, end) {
  const days = [];
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const fin = new Date(end);   fin.setHours(23, 59, 59, 0);
  while (cur <= fin) {
    if (cur.getDay() !== 0) { // skip Sunday
      days.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function matchEmployeeName(name, users) {
  if (!name || name === '—') return null;
  const up = name.trim().toUpperCase();
  // Exact username match
  let u = users.find(u => u.username.toUpperCase() === up);
  if (u) return u.username.toUpperCase();
  // First word of name matches username
  const first = up.split(/\s+/)[0];
  u = users.find(u => u.username.toUpperCase() === first);
  if (u) return u.username.toUpperCase();
  // Username starts with name's first word
  u = users.find(u => u.username.toUpperCase().startsWith(first));
  if (u) return u.username.toUpperCase();
  return null;
}

const PAGE_ACCESS = [
  { key: 'advisorCalendar',    label: '📅 Advisor Calendar',        group: 'Advisor' },
  { key: 'advisorRankBoard',   label: '🏆 Advisor Rank Board',      group: 'Advisor' },
  { key: 'surveyReports',      label: '📊 Survey Reports',          group: 'Advisor', defaultOff: true },
  { key: 'advisorSchedule',    label: '📅 Advisor Schedule',        group: 'Shared' },
  { key: 'techSchedule',       label: '🔧 Tech Schedule',           group: 'Shared' },
  { key: 'documentLibrary',    label: '📁 Document Library',        group: 'Shared' },
  { key: 'aftermarketWarranty',label: '🛡 After Market Warranty',   group: 'Warranty' },
  { key: 'originalOwner',      label: '📋 Original Owner Affidavit', group: 'Warranty' },
  { key: 'workInProgress',     label: '🔧 Work in Progress',         group: 'Tech' },
  { key: 'chargeAccountList', label: '💳 Charge Account List',      group: 'Manager', defaultOff: true },
  { key: 'partsHub',           label: '📦 Parts Hub',               group: 'Parts' },
  { key: 'tireQuote',          label: '🛞 Tire Quote',              group: 'Shared' },
  { key: 'atDiagWorksheet',   label: '⚙️ AT Diag Worksheet',       group: 'Tech' },
  { key: 'usedCarHub',         label: '🚗 Used Car Hub',            group: 'Used Cars' },
];
// defaultOff entries start unchecked for new/existing users; others default on
const DEFAULT_PAGES = Object.fromEntries(PAGE_ACCESS.map(p => [p.key, !p.defaultOff]));

export default function AdminPanel({ data, vacations, isOpen, onClose, onDataChange, onRefresh, currentUser, currentRole, users, sharedSaveCode, onSharedSaveCodeChange, onUsersChange, schedules, onSchedulesChange }) {
  const [githubToken, setToken] = useState(getGithubToken());
  const [openAIKey, setOpenAIKeyState] = useState(getOpenAIKey());
  const [awsKeyId, setAwsKeyIdState] = useState(getAwsCreds().accessKeyId);
  const [awsSecret, setAwsSecretState] = useState(getAwsCreds().secretAccessKey);
  const [awsSaving, setAwsSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  // "Daily Total Labor" — typed in the (service) Goal Gauges; on Save it's
  // written into today's Service Goal Forecast daily entry. Parts is entirely
  // separate and is entered on the Parts Goal Forecast page itself.
  const [dailyLabor, setDailyLabor] = useState('');
  const [dailyLaborMsg, setDailyLaborMsg] = useState('');
  const [reconcileMsg, setReconcileMsg] = useState('');
  const [addingAdvisor, setAddingAdvisor] = useState(false);
  const [addingTech, setAddingTech] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [forceRefreshState, setForceRefreshState] = useState('idle'); // idle | sending | sent | error

  // Fire a force-refresh: persist a timestamp (durable fallback that clients
  // poll) AND broadcast the realtime Pusher event — both with the SAME ts so a
  // healthy client reloads exactly once. The stored signal is what guarantees an
  // always-on TV that missed the live event still reloads on its next check.
  async function sendForceRefresh() {
    if (forceRefreshState === 'sending') return;
    if (!window.confirm('Force refresh ALL logged-in users now?\n\nEvery open browser will reload within a few seconds (a TV may take up to ~1 min). Any unsaved input on their screen could be lost.')) return;
    setForceRefreshState('sending');
    const ts = Date.now();
    const by = currentUser || 'admin';
    let durableOk = false;
    try { await saveForceRefresh(ts, by); durableOk = true; } catch (e) { console.warn('force-refresh persist failed:', e); }
    try { await triggerEvent(SYSTEM_CHANNEL, FORCE_REFRESH_EVENT, { ts, by }); } catch (e) { console.warn('force-refresh broadcast failed:', e); }
    if (durableOk) {
      setForceRefreshState('sent');
      setTimeout(() => setForceRefreshState('idle'), 4000);
    } else {
      setForceRefreshState('error');
      alert('Force refresh could not be saved to the server. The live signal was attempted, but offline TVs may not catch up. Check the GitHub token in Admin > GitHub Settings.');
      setTimeout(() => setForceRefreshState('idle'), 4000);
    }
  }
  const advisorXlsxInputRef = useRef(null);
  const [advisorXlsxStatus, setAdvisorXlsxStatus] = useState('');
  const [advisorXlsxBusy, setAdvisorXlsxBusy] = useState(false);
  // Technician "Flagged Hours" report upload (Technician Performance .xlsx).
  const techXlsxInputRef = useRef(null);
  const [techXlsxBusy, setTechXlsxBusy] = useState(false);
  const [techUpload, setTechUpload] = useState(null); // { day, dateLabel, rows:[{idx,name,hours,matched,matchedName}], unmatched:[] }
  const [techUploadErr, setTechUploadErr] = useState('');
  const [techUploadMsg, setTechUploadMsg] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserLast, setNewUserLast] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState('advisor');
  const [newUserCanEdit, setNewUserCanEdit] = useState(false);
  const [newUserManagementAccess, setNewUserManagementAccess] = useState(false);
  const [newUserPages, setNewUserPages] = useState({ ...DEFAULT_PAGES });
  const [newUserChatAccess, setNewUserChatAccess] = useState(false);
  const [newUserTechChatAccess, setNewUserTechChatAccess] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  // Controlled local copy of vacations so Remove always targets the right row
  const [vacEdit, setVacEdit] = useState(() => vacations.map(v => ({ ...v })));
  const [vacSyncStatus, setVacSyncStatus] = useState({}); // { idx: 'ok' | 'err:msg' | 'syncing' }

  useEffect(() => {
    setVacEdit(vacations.map(v => ({ ...v })));
  }, [vacations]);

  // Auto-remove expired vacations AND reconcile stale schedule 'vacation' marks when the panel opens
  useEffect(() => {
    if (!isOpen) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const active = vacations.filter(v => {
      // Only auto-remove APPROVED entries whose end date has passed
      if ((v.status || '').toUpperCase() !== 'APPROVED') return true;
      // Use dateEnd picker value first
      if (v.dateEnd) {
        const end = new Date(v.dateEnd + 'T00:00:00');
        return end >= today; // keep if end date is today or future
      }
      // Fall back to dateStart
      if (v.dateStart) {
        const start = new Date(v.dateStart + 'T00:00:00');
        return start >= today;
      }
      // Fall back to parsing the text dates field
      const range = parseDateRange(v.dates);
      if (range) return range.end >= today;
      return true; // can't determine — keep it
    });

    // Reconcile schedule against the (post-expire) vacation list for every employee
    // who currently has any 'vacation' marks OR a vacation row. This wipes stale
    // marks left over from old ranges that pre-date the sync fix.
    const empKeys = new Set();
    for (const [emp, days] of Object.entries(schedules || {})) {
      if (emp === '__HOLIDAY__') continue;
      if (days && Object.values(days).includes('vacation')) empKeys.add(emp);
    }
    for (const v of active) {
      const k = matchEmployeeName(v.name, users);
      if (k) empKeys.add(k);
    }
    let newSchedules = schedules;
    for (const k of empKeys) {
      newSchedules = rebuildEmpSchedule(k, active, newSchedules);
    }
    const scheduleChanged = JSON.stringify(newSchedules) !== JSON.stringify(schedules);
    const vacChanged = active.length < vacations.length;

    if (vacChanged) onDataChange(data, active);
    if (scheduleChanged) {
      saveSchedules(newSchedules)
        .then(() => onSchedulesChange(newSchedules))
        .catch(() => {});
    }
  }, [isOpen]);

  // Collect the vacation days (working days only) for one employee across all approved vacation rows
  function getEmpVacationDaysFromList(empKey, vacList) {
    const days = new Set();
    for (const v of (vacList || [])) {
      if ((v.status || '').toUpperCase() !== 'APPROVED') continue;
      if (matchEmployeeName(v.name, users) !== empKey) continue;
      let range;
      if (v.dateStart) {
        const s = new Date(v.dateStart + 'T00:00:00');
        const e = v.dateEnd ? new Date(v.dateEnd + 'T00:00:00') : s;
        range = { start: s, end: e };
      } else {
        range = parseDateRange(v.dates);
      }
      if (!range) continue;
      getWorkingDays(range.start, range.end).forEach(d => days.add(d));
    }
    return days;
  }

  // Strip all 'vacation' marks for an employee, then re-apply from current approved vacation rows
  function rebuildEmpSchedule(empKey, vacList, schedulesIn) {
    const emp = { ...(schedulesIn[empKey] || {}) };
    for (const [date, val] of Object.entries(emp)) {
      if (val === 'vacation') delete emp[date];
    }
    getEmpVacationDaysFromList(empKey, vacList).forEach(d => { emp[d] = 'vacation'; });
    return { ...schedulesIn, [empKey]: emp };
  }

  function updateVacEdit(idx, field, value) {
    setVacEdit(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  }

  function commitVacEdit(idx, field, value) {
    const trimmed = value.trim() || '\u2014';
    updateVacEdit(idx, field, trimmed);
    updateField(`vacations.${idx}.${field}`, trimmed);
    // Auto-sync to work schedule whenever status is set to APPROVED
    if (field === 'status' && trimmed.toUpperCase() === 'APPROVED') {
      const vac = { ...vacEdit[idx], [field]: trimmed };
      const newList = vacEdit.map((v, i) => i === idx ? vac : v);
      syncVacationToSchedule(idx, vac, newList);
    }
  }

  async function syncVacationToSchedule(idx, vac, vacList) {
    const list = vacList || vacations.map((v, i) => i === idx ? vac : v);
    const empKey = matchEmployeeName(vac.name, users);
    if (!empKey) {
      setVacSyncStatus(s => ({ ...s, [idx]: 'err:No matching employee found for "' + vac.name + '"' }));
      return;
    }
    // Use picker ISO dates when available; fall back to parsing the text dates field
    let range;
    if (vac.dateStart) {
      const s = new Date(vac.dateStart + 'T00:00:00');
      const e = vac.dateEnd ? new Date(vac.dateEnd + 'T00:00:00') : s;
      range = { start: s, end: e };
    } else {
      range = parseDateRange(vac.dates);
    }
    if (!range) {
      setVacSyncStatus(s => ({ ...s, [idx]: 'err:Could not parse dates. Please use the date pickers.' }));
      return;
    }
    const days = getWorkingDays(range.start, range.end);
    if (days.length === 0) {
      setVacSyncStatus(s => ({ ...s, [idx]: 'err:No working days found in that range' }));
      return;
    }
    setVacSyncStatus(s => ({ ...s, [idx]: 'syncing' }));
    try {
      // Rebuild from the full vacation list so old/removed days are cleared
      const updated = rebuildEmpSchedule(empKey, list, schedules);
      await saveSchedules(updated);
      onSchedulesChange(updated);
      setVacSyncStatus(s => ({ ...s, [idx]: `ok:${days.length} day${days.length !== 1 ? 's' : ''} marked vacation for ${empKey}` }));
      setTimeout(() => setVacSyncStatus(s => { const n = { ...s }; delete n[idx]; return n; }), 5000);
    } catch (err) {
      setVacSyncStatus(s => ({ ...s, [idx]: 'err:' + err.message }));
    }
  }

  function toggle(name) {
    setOpenSection(prev => prev === name ? null : name);
  }

  const ROLES = ['admin', 'advisor', 'lead advisor', 'technician', 'parts', 'parts manager', 'service manager', 'used car manager', 'warranty'];

  function updateField(path, value) {
    const newData = structuredClone(data);
    const newVacations = structuredClone(vacations);
    const keys = path.split('.');

    if (keys[0] === 'vacations') {
      const idx = parseInt(keys[1]);
      const field = keys[2];
      newVacations[idx][field] = value;
      onDataChange(newData, newVacations);
      return;
    }

    let obj = newData;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    onDataChange(newData, newVacations);
  }

  // ── Advisor Performance Report .PDF parsing ───────────────────────────────
  // Loads PDF.js from CDN on first use (same pattern as ChargeAccountList).
  const advisorPdfJsRef = useRef(null);
  function loadAdvisorPdfJs() {
    if (advisorPdfJsRef.current) return advisorPdfJsRef.current;
    advisorPdfJsRef.current = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
      document.head.appendChild(script);
    });
    return advisorPdfJsRef.current;
  }

  // Parse a PDF advisor performance report and merge Alignment / Valvoline /
  // Tires / ASR penetration % values onto matching advisors.
  //
  // The dealership's report (Bob Rohrman Hyundai SA Totals) uses VERTICAL
  // (rotated) column headers, which makes x-coordinate column matching
  // unreliable. Instead this parser:
  //
  //   1. Extracts every page's text into y-grouped lines.
  //   2. Validates the report format by locating a header line that mentions
  //      all four target labels (Alignment PEN, Tire PEN, Valvoline PEN,
  //      % of ASR sold).
  //   3. For each remaining line, finds the LAST occurrence of any known
  //      advisor first name (dealer name appears at the start of each row, so
  //      "last" avoids accidental matches there), then extracts the trailing
  //      list of numeric tokens.
  //   4. Maps numeric token positions to metrics by fixed index — these are
  //      the column positions in this DMS report format:
  //         index 9  → % OF ASR SOLD
  //         index 11 → ALIGNMENT PEN%
  //         index 13 → TIRE PEN%
  //         index 14 → VALVOLINE PEN %
  //
  async function handleAdvisorPdf(file) {
    if (!file) return;
    trackAction('upload-advisor-pdf', file.name);
    setAdvisorXlsxBusy(true);
    setAdvisorXlsxStatus('Reading PDF…');
    try {
      const pdfjs = await loadAdvisorPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

      // Build a list of advisor first names (lowercased) from the dashboard so
      // we can spot them in PDF text lines.
      const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
      const advisorMap = new Map(); // firstName → advisor object
      for (const a of (data.advisors || [])) {
        const fn = firstWord(a.name);
        if (fn) advisorMap.set(fn, a);
      }
      if (advisorMap.size === 0) throw new Error('No advisors on the dashboard to match against.');

      // Collect text lines from every page (y-grouped, items in left-to-right order).
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
        Object.entries(byY)
          .sort(([a], [b]) => Number(b) - Number(a))
          .forEach(([, items]) => {
            items.sort((a, b) => a.x - b.x);
            // Insert a space at every lowercase→uppercase transition because
            // the SA Totals report runs "GenesisDAVID RILEY" together with no
            // separator; without this fix \bDAVID\b wouldn't match.
            const line = items.map(i => i.text).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
            if (line) allLines.push(line);
          });
      }

      // Validate format: find at least one line that names all four metrics.
      const headerLine = allLines.find(L => {
        const u = L.toUpperCase();
        return u.includes('ALIGNMENT PEN')
            && u.includes('VALVOLINE PEN')
            && u.includes('TIRE PEN')
            && u.includes('ASR SOLD');
      });
      if (!headerLine) {
        throw new Error('This PDF doesn\'t look like the expected SA Totals report (missing Alignment PEN%, Tire PEN%, Valvoline PEN %, or % of ASR sold).');
      }

      // Right-indexed (from the END of the row) so a PDF.js token split inside
      // earlier counts/percentages doesn't shift the upsell columns. SA Totals
      // tail layout is:
      //   ...  ASR% INSP% ALIGN% BATTERY% TIRE% VALV% TOP-GUN RANK
      //         ↑8    ↑7    ↑6      ↑5    ↑4    ↑3     ↑2    ↑1
      const FROM_END_ASR       = 8;
      const FROM_END_ALIGNMENT = 6;
      const FROM_END_TIRE      = 4;
      const FROM_END_VALVOLINE = 3;
      const fromEnd = (arr, n) => (arr.length >= n ? arr[arr.length - n] : undefined);

      // Build one combined regex for all advisor first names so we can find the
      // last occurrence on a row in one pass.
      const firstNames = Array.from(advisorMap.keys());
      // Include any report aliases (e.g. Isaiah is printed as "CAIDEN") so the
      // regex also finds the alias on the row; it's mapped back below.
      for (const rosterFn of Array.from(advisorMap.keys())) {
        for (const alias of reportNamesForAdvisor(rosterFn)) {
          const al = alias.toLowerCase();
          if (al !== rosterFn && !firstNames.includes(al)) firstNames.push(al);
        }
      }
      const namesRe = new RegExp(`\\b(${firstNames.map(n => n.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})\\b`, 'gi');
      // Numeric token: optional thousands commas, optional decimals, optional trailing %.
      const numRe = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
      const parsePct = (raw) => {
        const v = String(raw || '').replace(/[, $]/g, '').replace('%', '').trim();
        if (!v) return null;
        const f = parseFloat(v);
        if (isNaN(f)) return null;
        return f > 1 ? f / 100 : f;
      };

      const newData = structuredClone(data);
      const newAdvisors = newData.advisors;
      let updated = 0;
      const skipped = [];
      const updatedNames = [];

      try { console.log('[advisor-pdf] header line:', headerLine); } catch {}
      try { console.log('[advisor-pdf] firstNames known:', firstNames); } catch {}
      try { console.log('[advisor-pdf] total lines extracted:', allLines.length); } catch {}

      for (const line of allLines) {
        if (line === headerLine) continue;
        // Skip totals / summary rows.
        if (/\b(total|grand|average|all dealers|number of)\b/i.test(line)) continue;

        // Find every advisor first-name match on the line. We'll pick the one
        // whose tail yields the most numerics — handles cases where the dealer
        // name happens to contain a name token.
        namesRe.lastIndex = 0;
        const matches = [];
        let m;
        while ((m = namesRe.exec(line)) !== null) {
          matches.push({ name: m[1].toLowerCase(), end: m.index + m[0].length });
        }
        if (matches.length === 0) continue;

        let bestMatch = null, bestNums = null;
        for (const mm of matches) {
          const after = line.slice(mm.end);
          const nums = after.match(numRe) || [];
          if (!bestMatch || nums.length > bestNums.length) {
            bestMatch = mm; bestNums = nums;
          }
        }
        if (!bestMatch || !bestNums || bestNums.length < FROM_END_ASR) continue;

        // Map a report alias (e.g. "caiden") back to the roster first name
        // ("isaiah") before looking the advisor up.
        const matchedFn = canonicalAdvisorFirst(bestMatch.name).toLowerCase();
        const nums = bestNums;

        const adv = advisorMap.get(matchedFn);
        const idx = newAdvisors.findIndex(a => firstWord(a.name) === matchedFn);
        if (idx === -1) { skipped.push(adv?.name || matchedFn); continue; }
        const target = newAdvisors[idx];

        try {
          console.log(`[advisor-pdf] ${target.name} line:`, line);
          console.log(`[advisor-pdf] ${target.name} after-name:`, line.slice(bestMatch.end));
          console.log(`[advisor-pdf] ${target.name} ${nums.length} numerics:`, nums);
          console.log(`[advisor-pdf] ${target.name} → asr=${fromEnd(nums, FROM_END_ASR)} align=${fromEnd(nums, FROM_END_ALIGNMENT)} tire=${fromEnd(nums, FROM_END_TIRE)} valv=${fromEnd(nums, FROM_END_VALVOLINE)}`);
        } catch {}

        let touched = false;
        const apply = (key, fromEndN) => {
          const v = parsePct(fromEnd(nums, fromEndN));
          if (v === null) return;
          target[key] = Math.round(v * 10000) / 10000;
          touched = true;
        };
        apply('asr',       FROM_END_ASR);
        apply('align',     FROM_END_ALIGNMENT);
        apply('tires',     FROM_END_TIRE);
        apply('valvoline', FROM_END_VALVOLINE);

        if (touched) { updated++; updatedNames.push(target.name); }
      }

      if (updated === 0) {
        throw new Error('Found the report but couldn\'t match any advisors. Check that the advisor first names on the dashboard match the report.');
      }

      // Stamp every advisor with a fresh upload-bump so the editor's input
      // `key`s remount and pick up the new values even when an existing field
      // happened to already equal the parsed value (which would otherwise
      // leave the key string unchanged → no remount).
      const bumpStamp = Date.now();
      for (const a of newAdvisors) a._lastImport = bumpStamp;

      try {
        console.log('[advisor-pdf] DAVID after parse:', newAdvisors.find(a => firstWord(a.name) === 'david'));
        console.log('[advisor-pdf] all advisors after parse:', newAdvisors.map(a => ({ name: a.name, align: a.align, tires: a.tires, valvoline: a.valvoline, asr: a.asr })));
      } catch {}

      onDataChange(newData, structuredClone(vacations));
      const parts = [`✅ Updated ${updated} advisor${updated === 1 ? '' : 's'} from PDF`];
      if (updatedNames.length) parts.push(`(${updatedNames.join(', ')})`);
      if (skipped.length)      parts.push(`· skipped: ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);
      setAdvisorXlsxStatus(parts.join(' '));
      setTimeout(() => setAdvisorXlsxStatus(''), 30000);
    } catch (err) {
      setAdvisorXlsxStatus('❌ ' + (err.message || err));
    } finally {
      setAdvisorXlsxBusy(false);
      if (advisorXlsxInputRef.current) advisorXlsxInputRef.current.value = '';
    }
  }

  // Parse an uploaded .xlsx Advisor Performance Report and merge its numbers
  // into the on-screen advisor list. Columns we look for (header text matched
  // case-insensitively, anywhere on the row):
  //   Advisor Name → matched first-word against advisor.name on the dashboard.
  //   Bill hours   → MTD Hrs (mtd_hours)
  //   RO count     → MTD ROs (ro_count)
  //   ELR(%)       → ELR % — value is a "92" style percent, so divided by 100.
  //   Coupon Labor → coupon_labor (new field, editor-only)
  async function handleAdvisorXlsx(file) {
    if (!file) return;
    trackAction('upload-advisor-xlsx', file.name);
    setAdvisorXlsxBusy(true);
    setAdvisorXlsxStatus('Reading file…');
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!rows || rows.length === 0) throw new Error('The file appears empty.');

      // Find the header row — the first row that mentions an advisor name column.
      const norm = (v) => String(v ?? '').trim().toLowerCase();
      let headerIdx = -1;
      for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const cells = (rows[i] || []).map(norm);
        const hasName = cells.some(c => c.includes('advisor') || c === 'name');
        const hasMetric = cells.some(c => c.includes('bill') || c.includes('ro count') || c.includes('elr') || c.includes('coupon'));
        if (hasName && hasMetric) { headerIdx = i; break; }
      }
      if (headerIdx === -1) throw new Error('Could not find a header row containing "Advisor", "Bill", "RO Count", "ELR", or "Coupon Labor". Make sure the report has those column headings.');

      const headerCells = (rows[headerIdx] || []).map(norm);
      // Look up a column by (1) exact header equality, then (2) whole-word match.
      // Plain substring is intentionally avoided — it caused 'ros' to match
      // 'gross' / 'gross sales', putting dollar totals into MTD ROs.
      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = (needle) => new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}([^a-z0-9]|$)`);
      const findCol = (...needles) => {
        for (let i = 0; i < headerCells.length; i++) {
          if (needles.some(n => headerCells[i] === n)) return i; // exact equality first
        }
        for (let i = 0; i < headerCells.length; i++) {
          if (needles.some(n => wordRegex(n).test(headerCells[i]))) return i; // whole-word
        }
        return -1;
      };
      const colName    = findCol('advisor name', 'advisor', 'name');
      const colHours   = findCol('bill hours', 'bill hour', 'bill hrs', 'billed hours', 'billed hrs');
      const colROs     = findCol('ro count', '# ros', "ro's", 'ros');
      // ELR: tightly matched so the ELR ($) column (dollar value) doesn't
      // accidentally land in the percentage field. The dealership's report
      // ships "ELR (%)" with a space — compare with whitespace stripped so
      // any of "ELR(%)", "ELR (%)", "ELR  (%)", "ELR%" all hit, but
      // "ELR ($)" never does.
      const stripWs = (s) => String(s || '').replace(/\s+/g, '');
      const colELR = (() => {
        const want = ['elr(%)', 'elr%'];
        const stripped = headerCells.map(stripWs);
        for (let i = 0; i < stripped.length; i++) {
          if (want.includes(stripped[i])) return i;
        }
        return -1;
      })();
      const colCoupon  = findCol('coupon labor', 'coupon');
      const colTotalSales = findCol('total sales');
      try { console.log('[advisor-xlsx] header columns:', headerCells); } catch {}
      try { console.log('[advisor-xlsx] picked col indices →', { colName, colHours, colROs, colELR, colCoupon, colTotalSales, elrHeader: colELR >= 0 ? headerCells[colELR] : null }); } catch {}

      if (colName === -1) throw new Error('Could not locate the Advisor Name column in the report header.');

      const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
      const advisors = (data.advisors || []);
      const newData = structuredClone(data);
      const newAdvisors = newData.advisors;

      let updated = 0;
      const skipped = []; // names found in the report but no matching dashboard advisor
      const updatedNames = [];

      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const reportName = String(row[colName] ?? '').trim();
        if (!reportName) continue;
        // Apply report aliases (e.g. "CAIDEN HENSON" → "ISAIAH") before matching.
        const firstReport = canonicalAdvisorFirst(reportName).toLowerCase();
        if (!firstReport) continue;
        // Skip totals / footer rows that don't look like a person.
        if (/^(total|grand|average|avg|summary)/i.test(reportName)) continue;

        const matchIdx = newAdvisors.findIndex(a => firstWord(a.name) === firstReport);
        if (matchIdx === -1) { skipped.push(reportName); continue; }
        const adv = newAdvisors[matchIdx];

        const num = (cell) => {
          const v = String(cell ?? '').replace(/[, $%]/g, '').trim();
          if (!v) return null;
          const f = parseFloat(v);
          return isNaN(f) ? null : f;
        };

        let touched = false;
        if (colHours !== -1) {
          const v = num(row[colHours]);
          if (v !== null) { adv.mtd_hours = v; touched = true; }
        }
        if (colROs !== -1) {
          const v = num(row[colROs]);
          // RO counts are whole numbers — if the matched cell looks like a dollar
          // total (decimal, or > 5000) we likely grabbed the wrong column. Skip
          // it rather than overwriting MTD ROs with a bogus value.
          if (v !== null && Number.isInteger(v) && v < 5000) { adv.ro_count = v; touched = true; }
        }
        if (colELR !== -1) {
          const v = num(row[colELR]);
          // Sanity guard: real ELR % should sit roughly between 60-110. If we
          // see a raw value above 200 we likely matched the wrong column —
          // skip rather than write a nonsense 157.3%-style figure.
          if (v !== null && v <= 200) { adv.elr = Math.round((v / 100) * 10000) / 10000; touched = true; }
        }
        if (colCoupon !== -1) {
          const v = num(row[colCoupon]);
          if (v !== null) { adv.coupon_labor = v; touched = true; }
        }
        if (colTotalSales !== -1) {
          const v = num(row[colTotalSales]);
          if (v !== null) { adv.total_sales = v; touched = true; }
        }
        // Re-derive Hrs/RO any time MTD Hrs or RO count changed (matches manual editor behavior).
        const hrs = parseFloat(adv.mtd_hours) || 0;
        const ros = parseFloat(adv.ro_count) || 0;
        if (ros > 0) adv.hours_per_ro = Math.round((hrs / ros) * 100) / 100;
        // Coupon usage % = Coupon Labor ÷ Total Sales. Normal range 5-7%.
        const sales = parseFloat(adv.total_sales) || 0;
        const couponLabor = parseFloat(adv.coupon_labor) || 0;
        if (sales > 0) adv.coupon_usage_pct = Math.round((couponLabor / sales) * 10000) / 10000;

        if (touched) { updated++; updatedNames.push(adv.name); }
      }

      const bumpStamp = Date.now();
      for (const a of newAdvisors) a._lastImport = bumpStamp;
      onDataChange(newData, structuredClone(vacations));
      const parts = [`✅ Updated ${updated} advisor${updated === 1 ? '' : 's'}`];
      if (updatedNames.length) parts.push(`(${updatedNames.join(', ')})`);
      // Surface which column was matched for each field, so column-name
      // mismatches surface without opening dev tools.
      const colTag = (label, idx) => `${label}=${idx >= 0 ? `"${headerCells[idx]}"` : 'NOT FOUND'}`;
      parts.push(`· Columns matched: ${colTag('MTD Hrs', colHours)}, ${colTag('MTD ROs', colROs)}, ${colTag('ELR', colELR)}, ${colTag('Coupon', colCoupon)}`);
      if (skipped.length)      parts.push(`· skipped ${skipped.length} not on dashboard: ${skipped.join(', ')}`);
      setAdvisorXlsxStatus(parts.join(' '));
      setTimeout(() => setAdvisorXlsxStatus(''), 30000);
    } catch (err) {
      setAdvisorXlsxStatus('❌ ' + (err.message || err));
    } finally {
      setAdvisorXlsxBusy(false);
      if (advisorXlsxInputRef.current) advisorXlsxInputRef.current.value = '';
    }
  }

  // Update an advisor field and, when MTD Hrs or MTD ROs changes, auto-derive
  // Hrs/RO = MTD Hrs / MTD ROs so the user doesn't have to do the math.
  function updateAdvisorWithDerived(idx, field, value) {
    const newData = structuredClone(data);
    const adv = newData.advisors[idx];
    adv[field] = value;
    if (field === 'mtd_hours' || field === 'ro_count') {
      const hrs = parseFloat(adv.mtd_hours) || 0;
      const ros = parseFloat(adv.ro_count) || 0;
      if (ros > 0) adv.hours_per_ro = Math.round((hrs / ros) * 100) / 100;
    }
    onDataChange(newData, structuredClone(vacations));
  }

  // Sets a technician's day-hrs AND records a per-date override flag so the
  // schedule-driven auto-fill (Holiday/Vacation/Training → 8.0) won't overwrite
  // a manually entered value (e.g., 0 for a new employee with no PTO yet).
  function overrideTechHours(idx, day, value) {
    const newData = structuredClone(data);
    const tech = newData.technicians[idx];
    tech[day] = value;
    const date = currentWeekDates()[day];
    tech.hoursOverride = { ...(tech.hoursOverride || {}), [date]: true };
    onDataChange(newData, structuredClone(vacations));
  }

  // ── Technician "Flagged Hours" report upload ───────────────────────────────
  // Reads the "Technician Performance" summary sheet of the dealer's Technician
  // Report (.xlsx): Technician Name + Flagged Hours per tech. Fills one weekday
  // column for every technician on this page — a tech that isn't in the report
  // did no billable work that day, so their hours are set to 0.
  const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

  async function handleTechXlsx(file) {
    if (!file) return;
    setTechXlsxBusy(true); setTechUploadErr(''); setTechUpload(null); setTechUploadMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

      // 1) Locate the per-tech summary: a sheet with "Technician Name" + "Flagged Hours".
      let report = null; // { name(upper) -> flaggedHours }
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
        const hdrIdx = aoa.findIndex(r => (r || []).some(c => norm(c) === 'technician name') && (r || []).some(c => norm(c) === 'flagged hours'));
        if (hdrIdx === -1) continue;
        const hdr = (aoa[hdrIdx] || []).map(norm);
        const iName = hdr.indexOf('technician name');
        const iFlag = hdr.indexOf('flagged hours');
        const map = {};
        for (let r = hdrIdx + 1; r < aoa.length; r++) {
          const row = aoa[r] || [];
          const nm = String(row[iName] == null ? '' : row[iName]).trim();
          if (!nm || norm(nm) === 'total') continue;
          const v = parseFloat(String(row[iFlag]).replace(/[, ]/g, ''));
          map[nm.toUpperCase()] = isNaN(v) ? 0 : v;
        }
        if (Object.keys(map).length) { report = map; break; }
      }
      if (!report) throw new Error('Could not find a "Technician Name" + "Flagged Hours" sheet. Make sure this is the Technician Performance report.');

      // 2) Work out which weekday the report is for. Prefer the report's own
      //    "Flag Date" (e.g. "Wed Jul 8 2026"); fall back to yesterday (skip Sun).
      let day = null, dateLabel = '';
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
        const hdrIdx = aoa.findIndex(r => (r || []).some(c => norm(c) === 'flag date'));
        if (hdrIdx === -1) continue;
        const iDate = (aoa[hdrIdx] || []).map(norm).indexOf('flag date');
        for (let r = hdrIdx + 1; r < aoa.length; r++) {
          const val = String((aoa[r] || [])[iDate] || '').trim(); // "Wed Jul 8 2026"
          const wd = val.slice(0, 3).toLowerCase();
          if (['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(wd)) {
            day = wd; dateLabel = val.replace(/^[A-Za-z]{3}\s+/, ''); break;
          }
        }
        if (day) break;
      }
      if (!day) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        while (y.getDay() === 0) y.setDate(y.getDate() - 1);
        day = DOW_KEYS[y.getDay()];
        dateLabel = y.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }

      // 3) Match every technician on this page to a report row by first OR last
      //    name token (e.g. "GAVIN WEST" → page tech "WEST"). Each report row is
      //    used at most once. Unused report rows are surfaced as a warning.
      const firstTok = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
      const lastTok = (s) => { const p = String(s || '').trim().split(/\s+/); return (p[p.length - 1] || '').toUpperCase(); };
      const entries = Object.keys(report).map(full => ({ full, first: firstTok(full), last: lastTok(full), used: false }));
      const rows = (data.technicians || []).map((t, idx) => {
        const page = String(t.name || '').trim().toUpperCase();
        let e = entries.find(en => !en.used && en.first === page) || entries.find(en => !en.used && en.last === page);
        if (e) { e.used = true; return { idx, name: t.name, hours: report[e.full], matched: true, matchedName: e.full }; }
        return { idx, name: t.name, hours: 0, matched: false, matchedName: '' };
      });
      const unmatched = entries.filter(e => !e.used).map(e => e.full);
      setTechUpload({ day, dateLabel, rows, unmatched });
    } catch (err) {
      setTechUploadErr(err.message || String(err));
    } finally {
      setTechXlsxBusy(false);
      if (techXlsxInputRef.current) techXlsxInputRef.current.value = '';
    }
  }

  // Write the previewed flagged hours into the chosen weekday column for every
  // technician (matched value, or 0 when absent from the report).
  function applyTechUpload() {
    if (!techUpload) return;
    const { day, rows, dateLabel } = techUpload;
    const date = currentWeekDates()[day];
    const stamp = Date.now();
    const newData = structuredClone(data);
    for (const r of rows) {
      const tech = newData.technicians[r.idx];
      if (!tech) continue;
      tech[day] = r.hours;
      tech.hoursOverride = { ...(tech.hoursOverride || {}), [date]: true };
      tech._hrsStamp = stamp; // bump so the uncontrolled inputs remount & repaint
    }
    onDataChange(newData, structuredClone(vacations));
    const filled = rows.filter(r => r.matched).length;
    setTechUploadMsg(`✅ Set ${DAY_LABELS[day]} (${dateLabel}) flagged hours for ${rows.length} tech${rows.length === 1 ? '' : 's'} (${filled} from report, ${rows.length - filled} set to 0). Click Save Changes to push it live.`);
    setTechUpload(null);
  }

  // ── Morning cross-check ────────────────────────────────────────────────────
  // The manager's MTD Hrs + HRS/RO on this page are authoritative and reported a
  // day behind (numbers entered on the 8th are for the 7th). Push each advisor's
  // figure into their Goals/Forecasting as the PREVIOUS working day's month-to-date
  // total — silently overwriting whatever the advisor self-reported (they may have
  // left early or typed it wrong). Runs on Save Changes.
  async function reconcileAdvisorGoals() {
    const dk = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mkOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const corrected = [];
    for (const a of (data.advisors || [])) {
      const name = String(a.name || '').trim();
      if (!name) continue;
      const hrs = safe(a.mtd_hours, 0);
      // Skip blanks/zero — never clobber an advisor's data with an unset 0.
      if (a.mtd_hours === '' || a.mtd_hours == null || hrs <= 0) continue;
      const key = name.split(/\s+/)[0].toUpperCase();     // goals file key = first name
      const ros = parseFloat(a.ro_count) || 0;
      const hrsRo = a.hours_per_ro != null && a.hours_per_ro !== ''
        ? safe(a.hours_per_ro, 0)
        : (ros > 0 ? Math.round((hrs / ros) * 100) / 100 : 0);
      // Previous working day for THIS advisor: step back from today, skipping
      // Sundays and their scheduled off / holiday / vacation days.
      const target = new Date(); target.setDate(target.getDate() - 1);
      for (let i = 0; i < 21; i++) {
        const off = advisorOffDates(key, target.getFullYear(), target.getMonth(), schedules, vacations);
        if (target.getDay() !== 0 && !off.has(dk(target))) break;
        target.setDate(target.getDate() - 1);
      }
      const mk = mkOf(target), dayKey = dk(target);
      try {
        let all = {};
        try { all = await loadAdvisorGoals(key); } catch {}
        const bucket = ensureMtd((all && all[mk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} });
        const days = { ...(bucket.days || {}) };
        const before = days[dayKey] ? days[dayKey].hours : null;
        // Silent overwrite — no "corrected" flag or reason surfaced to the advisor.
        days[dayKey] = { ...(days[dayKey] || {}), hours: Math.round(hrs * 100) / 100, hrsRo: hrsRo };
        await saveAdvisorGoalsMonth(key, mk, { ...bucket, hoursGoal: safe(bucket.hoursGoal, 0), hrsRoGoal: safe(bucket.hrsRoGoal, 0), days, entryMode: 'mtd' });
        const changed = before == null || Math.abs(safe(before, 0) - hrs) > 0.01;
        corrected.push(`${key} ${target.getMonth() + 1}/${target.getDate()} → ${Math.round(hrs * 100) / 100}${changed ? '' : ' (unchanged)'}`);
      } catch (e) { console.warn('reconcile failed for', key, e); }
    }
    return corrected;
  }

  async function handleSave() {
    trackAction('save-dashboard');
    setSaving(true);
    setReconcileMsg('');
    try {
      const payload = { data, vacations };
      await saveDashboardToGitHub(payload);
      // Cross-check: reconcile each advisor's previous working day to these numbers.
      try {
        const corrected = await reconcileAdvisorGoals();
        if (corrected.length) setReconcileMsg(`✓ Synced previous-day hours to Goals/Forecasting: ${corrected.join(' · ')}`);
      } catch (e) { console.warn('advisor goals reconcile failed', e); }
      // Local state is already correct from user edits — no re-fetch needed.
      // The TV will pick up the new data on its next 90-second poll via the GitHub API.

      // If a "Daily Total Labor" amount was entered, drop it into today's SERVICE
      // Goal Forecast daily entry on the server (the per-department file, so it
      // shows on every device). Parts is separate and entered on its own page.
      if (String(dailyLabor).trim() !== '') {
        try {
          // Numbers entered today are for the PREVIOUS business day (reporting is
          // a day behind). Step back one day, skipping Sunday (a non-working day).
          const target = new Date();
          target.setDate(target.getDate() - 1);
          while (target.getDay() === 0) target.setDate(target.getDate() - 1);
          const mk = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
          const dayKey = `${mk}-${String(target.getDate()).padStart(2, '0')}`;
          await setGoalForecastDaily('service', mk, dayKey, safe(dailyLabor, 0));
          // Keep the local cache in sync so the page reflects it immediately.
          try {
            const key = `goalForecast-${mk}`;
            const saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
            const actuals = { ...(saved.actuals || {}), [dayKey]: safe(dailyLabor, 0) };
            localStorage.setItem(key, JSON.stringify({ ...saved, actuals }));
          } catch {}
          setDailyLaborMsg(`Added ${'$' + Math.round(safe(dailyLabor, 0)).toLocaleString('en-US')} to the Service Goal Forecast for ${target.getMonth() + 1}/${target.getDate()}.`);
          setDailyLabor('');
        } catch { /* ignore */ }
      }
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const [tokenSyncing, setTokenSyncing] = useState(false);

  // ── Send to Reports ───────────────────────────────────────────────────────
  const [sendingReports, setSendingReports] = useState(false);
  const [reportStatus,   setReportStatus]   = useState('');

  // Week runs Sat–Fri. Numbers are entered a day behind:
  // Monday click → finalizing PREVIOUS week (Sat–Fri that just ended)
  // Tue–Sun click → current week in progress
  function getTechWeekRange(now = new Date()) {
    const dow = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
    let weekStart, weekEnd;
    if (dow === 6 || dow === 0 || dow === 1) {
      // Sat/Sun/Mon → previous completed week (still finalizing numbers)
      const daysSinceFri = (dow - 5 + 7) % 7 || 7;
      weekEnd   = new Date(now); weekEnd.setDate(now.getDate() - daysSinceFri);   // last Fri
      weekStart = new Date(weekEnd); weekStart.setDate(weekEnd.getDate() - 6);   // Sat before
    } else {
      // Tue–Fri → current week in progress: find most recent Sat
      const daysSinceSat = (dow - 6 + 7) % 7;
      weekStart = new Date(now); weekStart.setDate(now.getDate() - daysSinceSat);
      weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    }
    const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isoDate = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dy=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dy}`; };
    return {
      label:     `Week of ${fmt(weekStart)} – ${fmt(weekEnd)}`,
      weekKey:   isoDate(weekStart), // use Sat date as unique key for the week
      weekStart: isoDate(weekStart),
      weekEnd:   isoDate(weekEnd),
    };
  }

  async function sendToReports() {
    trackAction('send-to-reports');
    setSendingReports(true);
    setReportStatus('⏳ Sending snapshots…');
    const _n = new Date(); const today = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
    const techWeek = getTechWeekRange();
    // Advisor numbers are reported a day behind, so the daily snapshot dates to
    // the previous business day (skip Sunday). On the 1st this lands on the last
    // day of the prior month (e.g. July 1 send → June 30).
    const _ad = new Date(); _ad.setDate(_ad.getDate() - 1);
    while (_ad.getDay() === 0) _ad.setDate(_ad.getDate() - 1);
    const advDate     = `${_ad.getFullYear()}-${String(_ad.getMonth()+1).padStart(2,'0')}-${String(_ad.getDate()).padStart(2,'0')}`;
    const advMonthKey = `${_ad.getFullYear()}-${String(_ad.getMonth()+1).padStart(2,'0')}`;
    const advLabel    = _ad.toLocaleDateString(undefined, { month: 'long', year: 'numeric', day: 'numeric' });

    try {
      // ── Advisors: daily snapshot per day, grouped by month ──────────────────
      for (const a of (data.advisors || [])) {
        const username = a.name.toUpperCase();
        const existing = await loadGithubFile(`data/performance-reports/${username}.json`);
        const entries  = Array.isArray(existing) ? existing : [];
        const entry = {
          date: advDate, label: advLabel, month: advMonthKey,
          type: 'advisor', savedAt: new Date().toISOString(),
          csi: a.csi, hours_per_ro: a.hours_per_ro, roh50_hrs_ro: a.roh50_hrs_ro,
          mtd_hours: a.mtd_hours,
          daily_avg: a.daily_avg, align: a.align, tires: a.tires,
          valvoline: a.valvoline, asr: a.asr, elr: a.elr,
          last_month_total: a.last_month_total,
          ro_count: parseFloat(a.ro_count) || 0,
          coupon_labor: parseFloat(a.coupon_labor) || 0,
          total_sales: parseFloat(a.total_sales) || 0,
          coupon_usage_pct: (parseFloat(a.total_sales) || 0) > 0
            ? (parseFloat(a.coupon_labor) || 0) / parseFloat(a.total_sales)
            : (parseFloat(a.coupon_usage_pct) || 0),
        };
        // Replace existing entry for same date OR same label (catches UTC-shifted duplicate dates)
        const updated = [entry, ...entries.filter(e => e.date !== advDate && e.label !== advLabel)];
        updated.sort((a, b) => new Date(b.date) - new Date(a.date));
        await saveGithubFile(`data/performance-reports/${username}.json`, updated, `Advisor daily snapshot for ${username} on ${advDate}`);
      }

      // ── Technicians: one entry per week (keyed by week start date) ──────────
      for (const t of (data.technicians || [])) {
        const username = t.name.toUpperCase();
        const existing = await loadGithubFile(`data/performance-reports/${username}.json`);
        const entries  = Array.isArray(existing) ? existing : [];

        // Calculate bonus hours (vacation + training + holiday) for this tech this week
        const BONUS_TYPES = new Set(['vacation', 'training', 'holiday']);
        const techSched   = (schedules || {})[username] || {};
        const globalHols  = (schedules || {})['__HOLIDAY__'] || {};
        // Also build vacation date set from data.json vacations list (catches unsynced vacations)
        const techVacDates = new Set();
        for (const v of (vacations || [])) {
          if (!v.name || v.name.toUpperCase() !== username) continue;
          if (!v.dateStart || !v.dateEnd) continue;
          const vs = new Date(v.dateStart + 'T00:00:00');
          const ve = new Date(v.dateEnd   + 'T00:00:00');
          for (let dv = new Date(vs); dv <= ve; dv.setDate(dv.getDate() + 1)) {
            techVacDates.add(`${dv.getFullYear()}-${String(dv.getMonth()+1).padStart(2,'0')}-${String(dv.getDate()).padStart(2,'0')}`);
          }
        }
        const bonus       = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
        const breakdown   = { vacation: 0, training: 0, holiday: 0 };
        const wStart = new Date(techWeek.weekStart + 'T00:00:00');
        const wEnd   = new Date(techWeek.weekEnd   + 'T00:00:00');
        for (let d = new Date(wStart); d <= wEnd; d.setDate(d.getDate() + 1)) {
          const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          let val = null;
          if (globalHols[iso] === 'holiday')         val = 'holiday';
          else if (BONUS_TYPES.has(techSched[iso]))   val = techSched[iso];
          else if (techVacDates.has(iso))             val = 'vacation';
          if (!val) continue;
          const dow = d.getDay();
          let dk = null;
          if      (dow === 6) dk = 'sat';
          else if (dow === 1) dk = 'mon';
          else if (dow === 2) dk = 'tue';
          else if (dow === 3) dk = 'wed';
          else if (dow === 4) dk = 'thu';
          else if (dow === 5) dk = 'fri';
          if (!dk) continue;
          bonus[dk]      += 8;
          breakdown[val] += 8;
        }
        const bonusTotal = bonus.mon + bonus.tue + bonus.wed + bonus.thu + bonus.fri + bonus.sat;

        // total includes bonus (vacation/training/holiday) hours, so goal_pct
        // must be recomputed off that same total — otherwise it stays stuck on
        // the pre-bonus ratio and the gauges/averages read wrong.
        const totalWithBonus = (parseFloat(t.total) || 0) + bonusTotal;
        const goalNum = parseFloat(t.goal) || 0;
        const entry = {
          date: techWeek.weekStart, label: techWeek.label,
          weekStart: techWeek.weekStart, weekEnd: techWeek.weekEnd,
          type: 'tech', savedAt: new Date().toISOString(),
          total:   totalWithBonus,
          goal:    t.goal,
          goal_pct: goalNum > 0 ? totalWithBonus / goalNum : (parseFloat(t.goal_pct) || 0),
          pacing:  t.pacing,
          mon:     (parseFloat(t.mon) || 0) + bonus.mon,
          tue:     (parseFloat(t.tue) || 0) + bonus.tue,
          wed:     (parseFloat(t.wed) || 0) + bonus.wed,
          thu:     (parseFloat(t.thu) || 0) + bonus.thu,
          fri:     (parseFloat(t.fri) || 0) + bonus.fri,
          sat:     (parseFloat(t.sat) || 0) + bonus.sat,
          mon_ro:  parseFloat(t.mon_ro) || 0,
          tue_ro:  parseFloat(t.tue_ro) || 0,
          wed_ro:  parseFloat(t.wed_ro) || 0,
          thu_ro:  parseFloat(t.thu_ro) || 0,
          fri_ro:  parseFloat(t.fri_ro) || 0,
          sat_ro:  parseFloat(t.sat_ro) || 0,
          total_ro: (parseFloat(t.mon_ro)||0) + (parseFloat(t.tue_ro)||0) + (parseFloat(t.wed_ro)||0)
                  + (parseFloat(t.thu_ro)||0) + (parseFloat(t.fri_ro)||0) + (parseFloat(t.sat_ro)||0),
          ...(breakdown.vacation > 0 ? { vacationHours: breakdown.vacation } : {}),
          ...(breakdown.training > 0 ? { trainingHours: breakdown.training } : {}),
          ...(breakdown.holiday  > 0 ? { holidayHours:  breakdown.holiday  } : {}),
        };
        // Protect previously-captured PTO: an expired vacation is auto-removed
        // from the schedule + calendar after its week ends, so re-sending would
        // recompute 0 bonus and wipe it. If a prior snapshot for this same week
        // recorded more PTO than we found now, carry the higher hours forward.
        const overlap = entries.find(e => (e.weekStart && e.weekEnd)
          ? !(e.weekEnd < techWeek.weekStart || e.weekStart > techWeek.weekEnd)
          : e.date === techWeek.weekStart);
        if (overlap) {
          const ptoOf = (x) => (parseFloat(x.vacationHours)||0) + (parseFloat(x.trainingHours)||0) + (parseFloat(x.holidayHours)||0);
          if (ptoOf(overlap) > ptoOf(entry)) {
            for (const dk of ['mon','tue','wed','thu','fri','sat']) entry[dk] = Math.max(parseFloat(entry[dk])||0, parseFloat(overlap[dk])||0);
            entry.total  = Math.max(parseFloat(entry.total)||0,  parseFloat(overlap.total)||0);
            entry.pacing = Math.max(parseFloat(entry.pacing)||0, parseFloat(overlap.pacing)||0);
            if (parseFloat(overlap.vacationHours) > 0) entry.vacationHours = parseFloat(overlap.vacationHours);
            if (parseFloat(overlap.trainingHours) > 0) entry.trainingHours = parseFloat(overlap.trainingHours);
            if (parseFloat(overlap.holidayHours)  > 0) entry.holidayHours  = parseFloat(overlap.holidayHours);
            entry.goal_pct = goalNum > 0 ? entry.total / goalNum : entry.goal_pct;
          }
        }

        // Replace any existing entry whose week overlaps with this one (handles key shifts from timezone fixes)
        const updated = [entry, ...entries.filter(e => {
          if (!e.weekStart || !e.weekEnd) return e.date !== techWeek.weekStart; // legacy fallback
          return e.weekEnd < techWeek.weekStart || e.weekStart > techWeek.weekEnd; // keep non-overlapping weeks only
        })];
        updated.sort((a, b) => new Date(b.date) - new Date(a.date));
        await saveGithubFile(`data/performance-reports/${username}.json`, updated, `Tech weekly snapshot for ${username} – ${techWeek.label}`);
      }

      const total = (data.advisors || []).length + (data.technicians || []).length;
      setReportStatus(`✅ Sent! ${(data.advisors||[]).length} advisors (${advLabel}) · ${(data.technicians||[]).length} techs (${techWeek.label})`);
      setTimeout(() => setReportStatus(''), 7000);
    } catch (e) {
      setReportStatus(`❌ ${e.message}`);
    } finally {
      setSendingReports(false);
    }
  }

  async function handleTokenSave() {
    if (!githubToken) { alert('Enter a token first.'); return; }
    setGithubToken(githubToken);
    setTokenSyncing(true);
    try {
      await saveSharedToken(githubToken);
      if (onSharedSaveCodeChange) onSharedSaveCodeChange(githubToken);
      alert('Token saved and synced to all advisors. They will get it automatically on their next page load.');
    } catch (err) {
      alert('Token saved locally, but could not sync to GitHub: ' + err.message + '\n\nAdvisors may still need to enter it manually.');
    } finally {
      setTokenSyncing(false);
    }
  }

  function addTechnician() { setAddingTech(true); }

  function pickTechnician(username) {
    const name = (username || '').toUpperCase();
    if (!name) return;
    if (data.technicians.some(t => (t.name || '').toUpperCase() === name)) { setAddingTech(false); return; }
    const newData = structuredClone(data);
    newData.technicians.push({
      name, goal: 47.5, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0,
      total: 0, goal_pct: 0, pacing: 0, certified: '\u2014', trainings_due: '\u2014', excel_training: '\u2014',
    });
    onDataChange(newData, vacations);
    setAddingTech(false);
  }

  // Users with the technician role who aren't already in the technician list.
  const availableTechUsers = (users || [])
    .filter(u => (u.role || '').toLowerCase() === 'technician')
    .filter(u => !data.technicians.some(t => (t.name || '').toUpperCase() === (u.username || '').toUpperCase()));

  function removeTechnician(idx) {
    if (!confirm(`Remove ${data.technicians[idx].name}?`)) return;
    const newData = structuredClone(data);
    newData.technicians.splice(idx, 1);
    onDataChange(newData, vacations);
  }

  function addAdvisor() { setAddingAdvisor(true); }

  // Push a fresh advisor + training row onto a dashboard data object (mutates it).
  // Shared by the manual "Add Advisor" picker and the auto-add on user save so the
  // two paths can never drift apart. No-op if the advisor is already on the roster.
  function addAdvisorToRoster(newData, name) {
    const upper = (name || '').toUpperCase();
    if (!upper) return false;
    if ((newData.advisors || []).some(a => (a.name || '').toUpperCase() === upper)) return false;
    (newData.advisors ||= []).push({
      name: upper, mtd_hours: 0, daily_avg: 0, hours_per_ro: 0,
      align: 0, tires: 0, valvoline: 0, roh50_hrs_ro: 0, csi: 0, asr: 0, elr: 0, last_month_total: 0, ro_count: 0,
    });
    (newData.advisorTraining ||= []).push({
      name: upper, certified: '\u2014', trainings_due: '\u2014', excel_training: '\u2014',
    });
    return true;
  }

  function pickAdvisor(username) {
    if (!(username || '').trim()) return;
    const newData = structuredClone(data);
    if (addAdvisorToRoster(newData, username)) onDataChange(newData, vacations);
    setAddingAdvisor(false);
  }

  // Users with the advisor role who aren't already in the advisor list.
  const availableAdvisorUsers = (users || [])
    .filter(u => (u.role || '').toLowerCase() === 'advisor')
    .filter(u => !data.advisors.some(a => (a.name || '').toUpperCase() === (u.username || '').toUpperCase()));

  function removeAdvisor(idx) {
    if (!confirm(`Remove ${data.advisors[idx].name}?`)) return;
    const newData = structuredClone(data);
    newData.advisors.splice(idx, 1);
    if (newData.advisorTraining[idx]) newData.advisorTraining.splice(idx, 1);
    onDataChange(newData, vacations);
  }

  // Build a human-readable date range string from ISO date strings (for ticker / display)
  function fmtVacDateRange(start, end) {
    if (!start) return '';
    const fmt = iso => {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    if (!end || end === start) return fmt(start);
    // Same month+year → "Apr 13–14, 2026"; otherwise "Apr 13 – May 2, 2026"
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end   + 'T00:00:00');
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return `${s.toLocaleDateString('en-US',{month:'short'})} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${fmt(start)} – ${fmt(end)}`;
  }

  function commitVacDate(idx, field, isoValue) {
    // field is 'dateStart' or 'dateEnd'
    const updated = { ...vacEdit[idx], [field]: isoValue };
    // Rebuild the dates display string any time either picker changes
    const displayStr = fmtVacDateRange(
      field === 'dateStart' ? isoValue : (updated.dateStart || ''),
      field === 'dateEnd'   ? isoValue : (updated.dateEnd   || '')
    ) || '\u2014';
    updated.dates = displayStr;
    // Push both fields to local state and to the saved data in one shot
    setVacEdit(prev => prev.map((v, i) => i === idx ? updated : v));
    const newData = structuredClone(data);
    const newVac  = structuredClone(vacations);
    newVac[idx] = { ...newVac[idx], [field]: isoValue, dates: displayStr };
    onDataChange(newData, newVac);
    // Auto-sync if status is already APPROVED and we have both dates
    if ((updated.status || '').toUpperCase() === 'APPROVED' && updated.dateStart && updated.dateEnd) {
      syncVacationToSchedule(idx, updated, newVac);
    }
  }

  function addVacation() {
    const newVac = structuredClone(vacations);
    newVac.push({ name: '', dates: '', dateStart: '', dateEnd: '', status: 'APPROVED' });
    onDataChange(data, newVac);
  }

  function removeVacation(idx) {
    const removed = vacations[idx];
    const newVac = structuredClone(vacations);
    newVac.splice(idx, 1);
    onDataChange(data, newVac);
    // Strip the removed row's days from the work schedule
    const empKey = removed ? matchEmployeeName(removed.name, users) : null;
    if (empKey) {
      const updated = rebuildEmpSchedule(empKey, newVac, schedules);
      saveSchedules(updated)
        .then(() => onSchedulesChange(updated))
        .catch(() => {});
    }
  }

  function handleSaveUser() {
    if (!isAdminOrManager(currentRole)) { alert('Only admin or managers can manage users.'); return; }
    if (!newUserName || !newUserPass) { alert('Enter username and password'); return; }
    const updated = users.find(u => u.username === newUserName)
      ? users.map(u => u.username === newUserName ? { ...u, lastName: newUserLast.trim(), password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, managementAccess: newUserManagementAccess, pages: newUserPages, chatAccess: newUserChatAccess, techChatAccess: newUserTechChatAccess } : u)
      : [...users, { username: newUserName, lastName: newUserLast.trim(), password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, managementAccess: newUserManagementAccess, pages: newUserPages, chatAccess: newUserChatAccess, techChatAccess: newUserTechChatAccess }];
    // An advisor-role user must also live on the dashboard roster (data.advisors)
    // or they never render on the dashboard. Saving the user alone only writes
    // users.json, so auto-add them to the roster + training table and persist the
    // dashboard in the same action. "lead advisor" counts too (Jordan).
    const wantsRoster = (newUserRole || '').toLowerCase().includes('advisor');
    const rosterData = wantsRoster ? structuredClone(data) : null;
    const addedToRoster = rosterData ? addAdvisorToRoster(rosterData, newUserName) : false;

    setUserSaving(true);
    saveUsers(updated, sharedSaveCode || getGithubToken())
      .then(() => { onUsersChange(updated); setSelectedUser(newUserName); })
      .then(() => {
        if (!addedToRoster) return;
        onDataChange(rosterData, vacations);
        return saveDashboardToGitHub({ data: rosterData, vacations });
      })
      .catch(err => alert('Failed to save user: ' + err.message))
      .finally(() => setUserSaving(false));
  }

  function handleDeleteUser() {
    if (!isAdminOrManager(currentRole)) { alert('Only admin or managers can manage users.'); return; }
    if (!selectedUser) { alert('Select a user to delete.'); return; }
    if (selectedUser === 'admin') { alert('Admin cannot be deleted.'); return; }
    const deletedUser = users.find(u => u.username === selectedUser);
    const deletedRole = deletedUser?.role || '';
    if (!window.confirm(
      `Remove ${selectedUser}?\n\n` +
      `This deletes their activity, advisor notes, work-in-progress, schedule, ` +
      `coaching reports, and survey reviews.\n\n` +
      `Their PERFORMANCE REPORTS are kept and moved to the "Previous Employees" ` +
      `tab in Manager → Performance Reports. Group chat history is also kept.\n\n` +
      `This cannot be undone.`
    )) return;
    const updated = users.filter(u => u.username !== selectedUser);

    // Also drop them from the dashboard roster (data.json) + vacations, matched
    // by first name (the dashboard stores names like "PARKER", users store the
    // login username). Otherwise they keep showing on the dashboard / edit view.
    const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();
    const delFirst = firstWord(selectedUser);
    const newData = structuredClone(data);
    newData.advisors    = (newData.advisors    || []).filter(a => firstWord(a.name) !== delFirst);
    newData.technicians = (newData.technicians || []).filter(t => firstWord(t.name) !== delFirst);
    const newVacations  = (vacations || []).filter(v => firstWord(v.name) !== delFirst);

    setUserSaving(true);
    // Remove from the user list first, then purge their per-user data (keeping
    // performance reports + chat), then drop them from the dashboard data. If a
    // later step fails the user is still removed — we surface the error but
    // don't roll back the user-list change.
    saveUsers(updated, sharedSaveCode || getGithubToken())
      .then(() => deleteUserData(selectedUser, deletedRole).catch(err => {
        alert('User removed, but some of their data could not be cleaned up: ' + err.message);
      }))
      .then(() => saveDashboardToGitHub({ data: newData, vacations: newVacations }))
      .then(() => {
        onDataChange(newData, newVacations);
        onUsersChange(updated);
        setSelectedUser(''); setNewUserName(''); setNewUserLast(''); setNewUserPass(''); setNewUserRole('advisor');
      })
      .catch(err => alert('Failed to delete user: ' + err.message))
      .finally(() => setUserSaving(false));
  }

  if (!isOpen) return null;

  // ── Card definitions ──────────────────────────────────────────────────────────
  const ADMIN_CARDS = [
    { id: 'github',     icon: '🔑', label: 'GitHub Settings',      desc: 'Sync your access token to all advisor devices',       color: '#6366f1', bg: 'rgba(99,102,241,.15)',  border: 'rgba(99,102,241,.35)'  },
    { id: 'aws',        icon: '☁️', label: 'AWS Settings',         desc: 'AWS keys for the Document Library (synced to all devices)', color: '#f59e0b', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.35)'  },
    { id: 'openai',     icon: '🤖', label: 'OpenAI Settings',       desc: 'Configure AI for performance review reports',         color: '#4ade80', bg: 'rgba(74,222,128,.12)',  border: 'rgba(74,222,128,.35)'  },
    { id: 'dashboard',  icon: '⚙️', label: 'Dashboard Settings',    desc: 'Set the dashboard title and display options',         color: '#94a3b8', bg: 'rgba(148,163,184,.12)', border: 'rgba(148,163,184,.3)'  },
    { id: 'gauges',     icon: '🎯', label: 'Goal Gauges',           desc: 'Set gross profit and customer pay targets',           color: '#fbbf24', bg: 'rgba(251,191,36,.12)',  border: 'rgba(251,191,36,.35)'  },
    { id: 'advisors',   icon: '📊', label: 'Advisor Performance',   desc: 'Edit advisor hours, rates, and percentages',          color: '#fb923c', bg: 'rgba(251,146,60,.12)',  border: 'rgba(251,146,60,.35)'  },
    { id: 'training',   icon: '🎓', label: 'Training Center',       desc: 'Update tech and advisor certification status',        color: '#2dd4bf', bg: 'rgba(45,212,191,.12)',  border: 'rgba(45,212,191,.35)'  },
    { id: 'technicians',icon: '🔧', label: 'Technicians',           desc: 'Manage technician daily hours and shift schedules',   color: '#f97316', bg: 'rgba(249,115,22,.12)',  border: 'rgba(249,115,22,.35)'  },
    { id: 'vacation',   icon: '🏖️', label: 'Approved Vacation',     desc: 'Track and sync approved vacation dates',              color: '#60a5fa', bg: 'rgba(96,165,250,.12)',  border: 'rgba(96,165,250,.35)'  },
    ...(isAdminOrManager(currentRole) ? [
      { id: 'users',    icon: '👥', label: 'User Management',       desc: 'Add, edit, and manage user accounts and access',      color: '#c084fc', bg: 'rgba(192,132,252,.12)', border: 'rgba(192,132,252,.35)' },
      { id: 'schedule', icon: '📅', label: 'Work Schedule Editor',  desc: 'Edit the service advisor work schedule',              color: '#34d399', bg: 'rgba(52,211,153,.12)',  border: 'rgba(52,211,153,.35)'  },
    ] : []),
    ...(currentRole === 'admin' ? [
      { id: 'forceRefresh', icon: '🔄', label: 'Force Refresh All Users', desc: 'Push newly deployed features live by reloading every logged-in browser', color: '#f87171', bg: 'rgba(239,68,68,.12)', border: 'rgba(239,68,68,.4)' },
    ] : []),
  ];

  const activeCard = ADMIN_CARDS.find(c => c.id === openSection);

  // ── Section body renderer ─────────────────────────────────────────────────────
  function renderSectionBody() {
    if (openSection === 'github') return (
      <div className="group-body">
        <div className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          <div className="small">Enter a GitHub Personal Access Token with repo scope. Saving here automatically syncs it to all advisor devices — they will never need to enter a save code manually.</div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>GitHub Token</label>
            <input type="password" value={githubToken} onChange={e => setToken(e.target.value)} />
          </div>
          <div className="actions"><button onClick={handleTokenSave} disabled={tokenSyncing}>{tokenSyncing ? 'Syncing to all advisors...' : 'Save Token & Sync to All Advisors'}</button></div>
        </div>
      </div>
    );

    if (openSection === 'aws') return (
      <div className="group-body">
        <div className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          <div className="small">Enter your AWS S3 credentials. Saving here syncs them to all devices so any user can upload/delete documents in the Document Library — they will never need to enter them manually.</div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>AWS Access Key ID</label>
            <input type="password" value={awsKeyId} onChange={e => setAwsKeyIdState(e.target.value)} placeholder="AKIA..." />
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>AWS Secret Access Key</label>
            <input type="password" value={awsSecret} onChange={e => setAwsSecretState(e.target.value)} />
          </div>
          <div className="actions">
            <button onClick={async () => {
              if (!awsKeyId.trim() || !awsSecret.trim()) { alert('Both Access Key ID and Secret Access Key are required.'); return; }
              setAwsSaving(true);
              try {
                setAwsCreds(awsKeyId.trim(), awsSecret.trim());
                await saveSharedAwsCreds(awsKeyId.trim(), awsSecret.trim());
                alert('AWS credentials saved and synced to all devices.');
              } catch (err) { alert('Save failed: ' + err.message); }
              finally { setAwsSaving(false); }
            }} disabled={awsSaving}>{awsSaving ? 'Syncing to all devices...' : 'Save AWS Keys & Sync to All Devices'}</button>
          </div>
        </div>
      </div>
    );

    if (openSection === 'openai') return (
      <div className="group-body">
        <div className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          <div className="small">Enter your OpenAI API key to enable AI-generated performance review reports in Employee Reviews. The key is stored locally on this device only.</div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>OpenAI API Key</label>
            <input type="password" value={openAIKey} onChange={e => setOpenAIKeyState(e.target.value)} placeholder="sk-..." />
          </div>
          <div className="actions">
            <button onClick={() => { setOpenAIKey(openAIKey); alert('OpenAI API key saved!'); }}>Save OpenAI Key</button>
            {openAIKey && <button className="secondary" style={{ marginLeft: 8 }} onClick={() => { setOpenAIKeyState(''); setOpenAIKey(''); }}>Clear Key</button>}
          </div>
        </div>
      </div>
    );

    if (openSection === 'dashboard') return (
      <div className="group-body">
        <div className="field">
          <label>Dashboard Title</label>
          <input value={data.title || ''} onChange={e => updateField('title', e.target.value)} />
        </div>

        {currentRole === 'admin' && (
          <div style={{ marginTop: 20, padding: 14, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 10 }}>
            <div style={{ fontWeight: 800, color: '#fca5a5', fontSize: 13, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 6 }}>
              🔄 Force Refresh All Users
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
              Pushes a signal to every logged-in browser to reload the page so newly-deployed features go live immediately. Admin only.
            </div>
            <button
              disabled={forceRefreshState === 'sending'}
              onClick={sendForceRefresh}
              style={{
                background: forceRefreshState === 'sent' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.18)',
                border: `1px solid ${forceRefreshState === 'sent' ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)'}`,
                color: forceRefreshState === 'sent' ? '#86efac' : '#fca5a5',
                fontWeight: 800, padding: '8px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              }}
            >
              {forceRefreshState === 'sending' ? '⏳ Sending…' : forceRefreshState === 'sent' ? '✅ Refresh signal sent' : '🔄 Force Refresh All Users'}
            </button>
          </div>
        )}
      </div>
    );

    if (openSection === 'gauges') return (
      <div className="group-body">
        <div className="form-grid">
          <div className="field"><label>Gross Profit Goal</label><input value={data.grossGoal ?? 0} onChange={e => updateField('grossGoal', e.target.value)} onBlur={e => updateField('grossGoal', safe(e.target.value, 0))} /></div>
          <div className="field"><label>Gross Profit Actual</label><input value={data.grossActual ?? 0} onChange={e => updateField('grossActual', e.target.value)} onBlur={e => updateField('grossActual', safe(e.target.value, 0))} /></div>
          <div className="field"><label>Customer Pay Goal</label><input value={data.cpGoal ?? 0} onChange={e => updateField('cpGoal', e.target.value)} onBlur={e => updateField('cpGoal', safe(e.target.value, 0))} /></div>
          <div className="field"><label>Customer Pay Actual</label><input value={data.cpActual ?? 0} onChange={e => updateField('cpActual', e.target.value)} onBlur={e => updateField('cpActual', safe(e.target.value, 0))} /></div>
          <div className="field"><label>Advisor Monthly Workdays</label><input value={data.advisorMonthlyWorkdays ?? 27} onChange={e => updateField('advisorMonthlyWorkdays', e.target.value)} onBlur={e => updateField('advisorMonthlyWorkdays', safe(e.target.value, 27))} /></div>
          <div className="field">
            <label>Daily Total Labor</label>
            <input
              value={dailyLabor}
              placeholder="Labor $ for yesterday — adds to Goal Forecast"
              onChange={e => { setDailyLabor(e.target.value); setDailyLaborMsg(''); }}
            />
          </div>
        </div>
        {dailyLaborMsg && <div style={{ marginTop: 10, fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>{dailyLaborMsg}</div>}
        <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
          Enter the total labor dollars, then click <em>Save Changes</em> — it's written into the Goal Forecast for the <strong>previous business day</strong> (today's entry posts to yesterday).
        </div>
      </div>
    );

    if (openSection === 'advisors') return (
      <div className="group-body">
        {/* Bulk import from the dealership's Advisor Performance Report (.xlsx or .pdf) */}
        <div style={{ background: 'rgba(96,165,250,.08)', border: '1px solid rgba(96,165,250,.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 18 }}>📥</div>
            <div style={{ fontWeight: 800, color: '#bfdbfe', fontSize: 13, letterSpacing: .3 }}>Upload Advisor Performance Report (.xlsx or .pdf)</div>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
            <strong>XLSX</strong> fills MTD Hrs (Bill Hours), MTD ROs (RO Count), ELR %, Coupon Labor.
            &nbsp;·&nbsp;
            <strong>PDF</strong> fills Alignment % (Alignment PEN %), Valvoline % (Valvoline PEN %), Tires % (Tires PEN %), ASR % (% of ASR sold).
            <br />Both match by the report's advisor first name. Click <em>Save Changes</em> after to push it live.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              ref={advisorXlsxInputRef}
              type="file"
              accept=".xlsx,.xls,.pdf"
              disabled={advisorXlsxBusy}
              onChange={e => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const ext = (f.name || '').toLowerCase().split('.').pop();
                if (ext === 'pdf')        handleAdvisorPdf(f);
                else if (ext === 'xlsx' || ext === 'xls') handleAdvisorXlsx(f);
                else { setAdvisorXlsxStatus('❌ Unsupported file type. Use .xlsx or .pdf.'); if (advisorXlsxInputRef.current) advisorXlsxInputRef.current.value = ''; }
              }}
              style={{ fontSize: 12, color: '#cbd5e1' }}
            />
            {advisorXlsxBusy && <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>⏳ Reading…</span>}
            {advisorXlsxStatus && (
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: advisorXlsxStatus.startsWith('❌') ? '#f87171' : advisorXlsxStatus.startsWith('✅') ? '#4ade80' : '#fbbf24',
              }}>{advisorXlsxStatus}</span>
            )}
          </div>
        </div>

        <div className="small">Daily Avg is automatic. You can edit MTD Hrs, Hrs/RO, and percentages.</div>
        <div className="small" style={{ color: '#7dd3fc', marginTop: 2 }}>On <em>Save Changes</em>, each advisor's MTD Hrs &amp; Hrs/RO are written to their Goals/Forecasting for the previous working day (a day behind), overwriting their entry.</div>
        {reconcileMsg && <div style={{ marginTop: 8, fontSize: 12.5, color: '#6ee7b7', fontWeight: 700, lineHeight: 1.4 }}>{reconcileMsg}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 4px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: .6 }} title="Monthly Service Policy dollars. Live Pay subtracts (Service Policy ÷ # of advisors × 8%) from each advisor's commission as the Individual Commission Adjustment.">Service Policy $ (monthly)</label>
          <input type="number" inputMode="decimal" defaultValue={data.service_policy ?? ''} placeholder="e.g. 4200"
            onBlur={e => updateField('service_policy', safe(e.target.value, 0))}
            style={{ background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700, color: '#e2e8f0', width: 140, outline: 'none' }} />
          <span style={{ fontSize: 11, color: '#64748b' }}>Live Pay adjustment = (this ÷ {(data.advisors || []).length || 1} advisors) × 8%</span>
        </div>
        {data.advisors.map((a, idx) => (
          <div className="form-section" key={a.name}>
            <div className="title" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {a.name}
                {a.hidden && <span style={{ marginLeft: 8, fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 6, padding: '2px 7px', verticalAlign: 'middle' }}>Hidden</span>}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="secondary" style={a.hidden ? { color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' } : {}} onClick={() => updateField(`advisors.${idx}.hidden`, !a.hidden)}>
                  {a.hidden ? 'Show on Dashboard' : 'Hide from Dashboard'}
                </button>
                <button className="secondary" onClick={() => removeAdvisor(idx)}>Remove</button>
              </div>
            </div>
            <div className="form-grid">
              <div className="field"><label>Daily Avg</label><input value={n(advisorDailyAverage(a, data), 2)} disabled /></div>
              <div className="field"><label>MTD Hrs</label><input key={`mtdh-${a._lastImport || 0}-${a.mtd_hours}`} defaultValue={a.mtd_hours} onBlur={e => updateAdvisorWithDerived(idx, 'mtd_hours', safe(e.target.value, a.mtd_hours))} /></div>
              <div className="field"><label title="Auto-calculated from MTD Hrs ÷ MTD ROs. You can still override it manually.">Hrs/RO <span style={{ color: '#64748b', fontWeight: 500, fontSize: 10, marginLeft: 4 }}>(auto)</span></label><input key={`hpr-${a._lastImport || 0}-${a.hours_per_ro}`} defaultValue={a.hours_per_ro} onBlur={e => updateField(`advisors.${idx}.hours_per_ro`, safe(e.target.value, a.hours_per_ro))} /></div>
              <div className="field"><label>Alignment %</label><input key={`aln-${a._lastImport || 0}-${a.align}`} defaultValue={percentEditValue(a.align)} onBlur={e => updateField(`advisors.${idx}.align`, parsePercentInput(e.target.value, a.align))} /></div>
              <div className="field"><label>Tires %</label><input key={`tir-${a._lastImport || 0}-${a.tires}`} defaultValue={percentEditValue(a.tires)} onBlur={e => updateField(`advisors.${idx}.tires`, parsePercentInput(e.target.value, a.tires))} /></div>
              <div className="field"><label>Valvoline %</label><input key={`vlv-${a._lastImport || 0}-${a.valvoline}`} defaultValue={percentEditValue(a.valvoline)} onBlur={e => updateField(`advisors.${idx}.valvoline`, parsePercentInput(e.target.value, a.valvoline))} /></div>
              <div className="field"><label>Roh$50 HRS/RO</label><input defaultValue={a.roh50_hrs_ro ?? ''} onBlur={e => updateField(`advisors.${idx}.roh50_hrs_ro`, safe(e.target.value, 0))} /></div>
              <div className="field"><label>CSI</label><input defaultValue={a.csi} onBlur={e => updateField(`advisors.${idx}.csi`, safe(e.target.value, a.csi))} /></div>
              <div className="field"><label title="Live Pay CSI bonus qualifier. If the advisor's CSI is below this number they don't earn the CSI bonus portion of commission. Leave blank/0 for no minimum.">Min CSI <span style={{ color: '#64748b', fontWeight: 500, fontSize: 10, marginLeft: 4 }}>(Live Pay)</span></label><input defaultValue={a.min_csi ?? ''} onBlur={e => updateField(`advisors.${idx}.min_csi`, safe(e.target.value, 0))} /></div>
              <div className="field"><label>ASR %</label><input key={`asr-${a._lastImport || 0}-${a.asr}`} defaultValue={percentEditValue(a.asr)} onBlur={e => updateField(`advisors.${idx}.asr`, parsePercentInput(e.target.value, a.asr))} /></div>
              <div className="field"><label>ELR %</label><input key={`elr-${a._lastImport || 0}-${a.elr}`} defaultValue={percentEditValue(a.elr)} onBlur={e => updateField(`advisors.${idx}.elr`, parsePercentInput(e.target.value, a.elr))} /></div>
                <div className="field"><label>Last Month Total</label><input defaultValue={a.last_month_total ?? 0} onBlur={e => updateField(`advisors.${idx}.last_month_total`, safe(e.target.value, 0))} /></div>
              <div className="field"><label title="Running month-to-date total. Overwrite this with the new monthly total each day — do not add daily counts.">MTD ROs<span style={{ color: '#64748b', fontWeight: 500, marginLeft: 4 }}>(month-to-date)</span></label><input key={`roc-${a._lastImport || 0}-${a.ro_count}`} defaultValue={a.ro_count ?? ''} onBlur={e => updateAdvisorWithDerived(idx, 'ro_count', safe(e.target.value, 0))} /></div>
              <div className="field"><label title="Coupon Labor pulled from the advisor performance report.">Coupon Labor</label><input key={`cpl-${a._lastImport || 0}-${a.coupon_labor ?? ''}`} defaultValue={a.coupon_labor ?? ''} onBlur={e => updateField(`advisors.${idx}.coupon_labor`, safe(e.target.value, 0))} /></div>
              <div className="field"><label title="Labor Sales from the advisor performance report. Used to compute Coupon Usage % (Coupon Labor ÷ Labor Sales).">Labor Sales</label><input key={`tsl-${a._lastImport || 0}-${a.total_sales ?? ''}`} defaultValue={a.total_sales ?? ''} onBlur={e => updateField(`advisors.${idx}.total_sales`, safe(e.target.value, 0))} /></div>
              <div className="field"><label title="Auto-calculated from Coupon Labor ÷ Labor Sales. Healthy range is roughly 5–7%.">Coupon Usage % <span style={{ color: '#64748b', fontWeight: 500, fontSize: 10, marginLeft: 4 }}>(auto)</span></label><input key={`cup-${a._lastImport || 0}-${a.coupon_usage_pct ?? ''}`} defaultValue={percentEditValue(a.coupon_usage_pct)} disabled /></div>
              </div>
            </div>
          ))}
          <div className="actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={addAdvisor}>Add Advisor</button>
            <button onClick={sendToReports} disabled={sendingReports} style={{ background: 'rgba(61,214,195,.18)', border: '1px solid rgba(61,214,195,.4)', color: '#3dd6c3', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              {sendingReports ? '⏳ Sending…' : '📊 Send to Reports'}
            </button>
            {reportStatus && <span style={{ fontSize: 13, fontWeight: 700, color: reportStatus.startsWith('✅') ? '#4ade80' : reportStatus.startsWith('❌') ? '#f87171' : '#fbbf24' }}>{reportStatus}</span>}
          </div>

          {addingAdvisor && (
            <div onClick={() => setAddingAdvisor(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#0f172a', border: '1px solid rgba(96,165,250,.3)', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontWeight: 900, fontSize: 16, color: '#bfdbfe' }}>Add Advisor</span>
                  <button onClick={() => setAddingAdvisor(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Pick a user with the <strong>advisor</strong> role:</div>
                {availableAdvisorUsers.length === 0 ? (
                  <div style={{ color: '#fbbf24', fontSize: 13, padding: '8px 0' }}>
                    No advisor-role users available. Add them under <strong>Users</strong> (set role to “advisor”) first.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                    {availableAdvisorUsers.map(u => (
                      <button key={u.username} onClick={() => pickAdvisor(u.username)}
                        style={{ textAlign: 'left', background: 'rgba(96,165,250,.12)', border: '1px solid rgba(96,165,250,.35)', color: '#e2e8f0', borderRadius: 10, padding: '10px 14px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                        {u.username.toUpperCase()}{u.lastName ? <span style={{ color: '#94a3b8', fontWeight: 600 }}> {u.lastName}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
    );

    if (openSection === 'training') return (
      <div className="group-body">
        <div className="title" style={{ marginBottom: 6 }}>Technicians</div>
        {data.technicians.map((t, idx) => (
          <div className="training-edit-grid" key={t.name}>
            <div className="field"><label>{t.name} Certified</label><input defaultValue={t.certified || ''} onBlur={e => updateField(`technicians.${idx}.certified`, e.target.value.trim() || '\u2014')} /></div>
            <div className="field"><label>Training Due</label><input defaultValue={t.trainings_due || ''} onBlur={e => updateField(`technicians.${idx}.trainings_due`, e.target.value.trim() || '\u2014')} /></div>
            <div className="field"><label>Excel Training</label><input defaultValue={t.excel_training || t.excel || ''} onBlur={e => updateField(`technicians.${idx}.excel_training`, e.target.value.trim() || '\u2014')} /></div>
          </div>
        ))}
        <div className="form-section">
          <div className="title" style={{ marginBottom: 6 }}>Advisors</div>
          {(data.advisorTraining || []).map((a, idx) => (
            <div className="training-edit-grid" key={a.name}>
              <div className="field"><label>{a.name} Certified</label><input defaultValue={a.certified || ''} onBlur={e => updateField(`advisorTraining.${idx}.certified`, e.target.value.trim() || '\u2014')} /></div>
              <div className="field"><label>Training Due</label><input defaultValue={a.trainings_due || ''} onBlur={e => updateField(`advisorTraining.${idx}.trainings_due`, e.target.value.trim() || '\u2014')} /></div>
              <div className="field"><label>Excel Training</label><input defaultValue={a.excel_training || a.excel || ''} onBlur={e => updateField(`advisorTraining.${idx}.excel_training`, e.target.value.trim() || '\u2014')} /></div>
            </div>
          ))}
        </div>
      </div>
    );

    if (openSection === 'technicians') return (
      <div className="group-body">
        {/* Upload the dealer's Technician Performance report to auto-fill one
            day's flagged hours for every tech. */}
        <div style={{ border: '1px solid rgba(96,165,250,.28)', background: 'rgba(96,165,250,.07)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontWeight: 800, color: '#bfdbfe', fontSize: 13, letterSpacing: .3 }}>📥 Upload Flagged Hours Report (.xlsx)</div>
          <div className="small" style={{ color: '#94a3b8', margin: '4px 0 8px' }}>
            Reads <strong>Technician Name</strong> + <strong>Flagged Hours</strong> from the report and fills that day's hours for each tech. A tech not on the report is set to <strong>0</strong> for the day. Review before applying, then <em>Save Changes</em>.
          </div>
          <input ref={techXlsxInputRef} type="file" accept=".xlsx,.xls" disabled={techXlsxBusy}
            onChange={e => { const f = e.target.files && e.target.files[0]; if (f) handleTechXlsx(f); }} />
          {techXlsxBusy && <span style={{ marginLeft: 10, fontSize: 12, color: '#93c5fd' }}>Reading…</span>}
          {techUploadErr && <div style={{ marginTop: 8, fontSize: 12, color: '#fca5a5' }}>❌ {techUploadErr}</div>}
          {techUploadMsg && <div style={{ marginTop: 8, fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>{techUploadMsg}</div>}
        </div>
        <div className="title">Technician Daily Hours</div>
        {data.technicians.map((t, idx) => (
          <div className="form-section" key={t.name}>
            <div className="title" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              {t.name}
              <button className="secondary" onClick={() => removeTechnician(idx)}>Remove</button>
            </div>
            <div className="form-grid" style={{ marginBottom: 8 }}>
              <div className="field"><label>Weekly Goal (hrs)</label><input defaultValue={t.goal ?? ''} onBlur={e => updateField(`technicians.${idx}.goal`, safe(e.target.value, t.goal))} /></div>
            </div>
            <div className="form-grid">
              {['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(day => (
                <div className="field" key={day}><label>{day.charAt(0).toUpperCase() + day.slice(1)} Hrs</label><input key={`${day}-${t._hrsStamp || 0}-${t[day]}`} defaultValue={t[day]} onBlur={e => overrideTechHours(idx, day, safe(e.target.value, t[day]))} /></div>
              ))}
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              {['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(day => {
                const roKey = `${day}_ro`;
                return (
                  <div className="field" key={roKey}>
                    <label style={{ color: '#94a3b8' }}>{day.charAt(0).toUpperCase() + day.slice(1)} ROs</label>
                    <input defaultValue={t[roKey] ?? ''} onBlur={e => updateField(`technicians.${idx}.${roKey}`, safe(e.target.value, 0))} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={addTechnician}>Add Technician</button>
          <button onClick={sendToReports} disabled={sendingReports} style={{ background: 'rgba(61,214,195,.18)', border: '1px solid rgba(61,214,195,.4)', color: '#3dd6c3', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {sendingReports ? '⏳ Sending…' : '📊 Send to Reports'}
          </button>
          {reportStatus && <span style={{ fontSize: 13, fontWeight: 700, color: reportStatus.startsWith('✅') ? '#4ade80' : reportStatus.startsWith('❌') ? '#f87171' : '#fbbf24' }}>{reportStatus}</span>}
        </div>

        {techUpload && (
          <div onClick={() => setTechUpload(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '6vh 16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '86vh', overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(96,165,250,.3)', borderRadius: 14, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 900, fontSize: 16, color: '#bfdbfe' }}>Flagged Hours Import</span>
                <button onClick={() => setTechUpload(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Apply to</span>
                <select value={techUpload.day} onChange={e => setTechUpload({ ...techUpload, day: e.target.value })}
                  style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: '5px 8px', fontWeight: 700, fontSize: 13 }}>
                  {['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                </select>
                {techUpload.dateLabel && <span style={{ color: '#64748b', fontSize: 12 }}>· report date {techUpload.dateLabel}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 12 }}>
                {techUpload.rows.map(r => (
                  <div key={r.idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '5px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                    <span style={{ color: '#e2e8f0' }}>{r.name}{r.matched && r.matchedName.toUpperCase() !== String(r.name).toUpperCase() ? <span style={{ color: '#64748b', fontSize: 11 }}> ({r.matchedName})</span> : null}</span>
                    <span style={{ color: r.matched ? '#6ee7b7' : '#64748b', fontWeight: 700 }}>{r.hours.toFixed(1)} hrs{!r.matched ? ' · not in report' : ''}</span>
                  </div>
                ))}
              </div>
              {techUpload.unmatched.length > 0 && (
                <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 12 }}>
                  ⚠ {techUpload.unmatched.length} report name{techUpload.unmatched.length === 1 ? '' : 's'} not matched to any tech on this page: {techUpload.unmatched.join(', ')}. Add them under Technicians if needed.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="secondary" onClick={() => setTechUpload(null)}>Cancel</button>
                <button onClick={applyTechUpload} style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>✓ Apply to {DAY_LABELS[techUpload.day]}</button>
              </div>
            </div>
          </div>
        )}

        {addingTech && (
          <div onClick={() => setAddingTech(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#0f172a', border: '1px solid rgba(249,115,22,.3)', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontWeight: 900, fontSize: 16, color: '#fdba74' }}>Add Technician</span>
                <button onClick={() => setAddingTech(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Pick a user with the <strong>technician</strong> role:</div>
              {availableTechUsers.length === 0 ? (
                <div style={{ color: '#fbbf24', fontSize: 13, padding: '8px 0' }}>
                  No technician-role users available. Add them under <strong>Users</strong> (set role to “technician”) first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                  {availableTechUsers.map(u => (
                    <button key={u.username} onClick={() => pickTechnician(u.username)}
                      style={{ textAlign: 'left', background: 'rgba(249,115,22,.12)', border: '1px solid rgba(249,115,22,.35)', color: '#e2e8f0', borderRadius: 10, padding: '10px 14px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                      {u.username.toUpperCase()}{u.lastName ? <span style={{ color: '#94a3b8', fontWeight: 600 }}> {u.lastName}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );

    if (openSection === 'vacation') return (
      <div className="group-body">
        <div className="small" style={{ marginBottom: 12 }}>
          Pick start &amp; end dates — approved vacations are automatically synced to the Work Schedule. Use 📅 to manually re-sync.
        </div>
          {vacEdit.map((v, idx) => {
            const isApproved = (v.status || '').toUpperCase() === 'APPROVED';
            const syncState = vacSyncStatus[idx];
            const isSyncing = syncState === 'syncing';
            const isOk  = syncState?.startsWith('ok:');
            const isErr = syncState?.startsWith('err:');
            // If old text-only entry (no dateStart), show current dates as a read note
            const hasPickerDates = !!v.dateStart;
            const oldDatesNote = !hasPickerDates && v.dates && v.dates !== '—' ? v.dates : null;
            return (
              <div key={idx} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                {/* Row 1: Name + Status + buttons */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                  <div className="field" style={{ flex: 2 }}>
                    <label>Employee Name</label>
                    {(() => {
                      const roleLabel = r => {
                        const x = (r || '').toLowerCase();
                        if (x === 'admin') return 'Admin';
                        if (x === 'advisor') return 'Advisor';
                        if (x === 'technician') return 'Technician';
                        if (x === 'parts manager') return 'Parts Manager';
                        if (x === 'parts') return 'Parts';
                        if (x === 'service manager') return 'Service Manager';
                        if (x === 'used car manager') return 'Used Car Manager';
                        if (x === 'warranty') return 'Warranty';
                        return r ? r.replace(/\b\w/g, c => c.toUpperCase()) : 'User';
                      };
                      const employees = [
                        ...((data.advisors || []).map(a => ({ name: (a.name || '').toUpperCase(), role: 'Advisor' }))),
                        ...((data.technicians || []).map(t => ({ name: (t.name || '').toUpperCase(), role: 'Technician' }))),
                        ...((users || []).map(u => ({ name: (u.username || '').toUpperCase(), role: roleLabel(u.role) }))),
                      ].filter(e => e.name);
                      // Sort alphabetically; remove duplicates by name
                      const seen = new Set();
                      const unique = employees
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .filter(e => { if (seen.has(e.name)) return false; seen.add(e.name); return true; });
                      const current = (v.name === '\u2014' ? '' : (v.name || '')).toUpperCase();
                      const isCustom = current && !unique.some(e => e.name === current);
                      return (
                        <select
                          value={current}
                          onChange={e => commitVacEdit(idx, 'name', e.target.value)}
                          style={{
                            background: '#0f172a',
                            border: `1px solid ${current ? 'rgba(96,165,250,.4)' : 'rgba(255,255,255,.15)'}`,
                            color: current ? '#e2e8f0' : '#94a3b8',
                            borderRadius: 6, padding: '6px 8px', fontSize: 13, width: '100%', cursor: 'pointer',
                          }}
                        >
                          <option value="">Select an employee</option>
                          {unique.map(e => (
                            <option key={e.name} value={e.name}>{`${e.name} ${e.role}`}</option>
                          ))}
                          {isCustom && <option value={current}>{`${current} (custom)`}</option>}
                        </select>
                      );
                    })()}
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Status</label>
                    <select
                      value={(v.status === '\u2014' || !v.status) ? 'APPROVED' : v.status}
                      onChange={e => commitVacEdit(idx, 'status', e.target.value)}
                      style={{
                        background: '#0f172a', border: `1px solid ${isApproved ? 'rgba(34,197,94,.5)' : 'rgba(255,255,255,.15)'}`,
                        color: isApproved ? '#86efac' : '#e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 13, width: '100%', cursor: 'pointer',
                      }}
                    >
                      <option value="APPROVED">✅ APPROVED</option>
                      <option value="PENDING">⏳ PENDING</option>
                      <option value="DENIED">❌ DENIED</option>
                    </select>
                  </div>
                  {isApproved && (
                    <button
                      title="Manually sync vacation days to the Work Schedule"
                      disabled={isSyncing}
                      onClick={() => syncVacationToSchedule(idx, v)}
                      style={{ flexShrink: 0, padding: '6px 12px', background: 'rgba(34,197,94,.15)', borderColor: 'rgba(34,197,94,.4)', color: '#86efac', fontWeight: 700, fontSize: 13 }}
                    >
                      {isSyncing ? '⏳' : '📅 Sync'}
                    </button>
                  )}
                  <button className="secondary" style={{ flexShrink: 0, padding: '6px 10px', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }} onClick={() => removeVacation(idx)}>✕</button>
                </div>

                {/* Row 2: Date pickers */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Start Date</label>
                    <input
                      type="date"
                      value={v.dateStart || ''}
                      onChange={e => commitVacDate(idx, 'dateStart', e.target.value)}
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                  <div style={{ paddingBottom: 8, color: '#475569', fontWeight: 700 }}>→</div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>End Date</label>
                    <input
                      type="date"
                      value={v.dateEnd || ''}
                      min={v.dateStart || ''}
                      onChange={e => commitVacDate(idx, 'dateEnd', e.target.value)}
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                  {v.dateStart && (
                    <div style={{ paddingBottom: 8, fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {fmtVacDateRange(v.dateStart, v.dateEnd)}
                    </div>
                  )}
                  {oldDatesNote && !v.dateStart && (
                    <div style={{ paddingBottom: 8, fontSize: 11, color: '#f59e0b', whiteSpace: 'nowrap' }}>
                      ⚠ Old: "{oldDatesNote}" — pick dates above to enable sync
                    </div>
                  )}
                </div>

                {/* Sync status */}
                {syncState && (
                  <div style={{ marginTop: 6, fontSize: 11, color: isOk ? '#86efac' : isErr ? '#fca5a5' : '#94a3b8' }}>
                    {isSyncing && '⏳ Syncing to Work Schedule…'}
                    {isOk  && `✅ ${syncState.slice(3)}`}
                    {isErr && `⚠️ ${syncState.slice(4)}`}
                  </div>
                )}
              </div>
            );
          })}
          <div className="actions"><button onClick={addVacation}>+ Add Vacation</button></div>
        </div>
    );

    if (openSection === 'users') return (
      <div className="group-body">
        <div className="small">Click a user to load them into the form.</div>
        <div className="user-row-list">
          {users.map(u => {
            const isBuiltinAdmin = u.username === 'admin';
            const hasAdminRole = u.role === 'admin';
            const hasEditAccess = u.canEditDashboard || isAdminOrManager(u.role) || u.managementAccess;

            async function quickToggleAdmin(e) {
              e.stopPropagation();
              if (isBuiltinAdmin) return;
              const newRole = hasAdminRole ? 'advisor' : 'admin';
              const updated = users.map(x => x.username === u.username ? { ...x, role: newRole, canEditDashboard: newRole === 'admin' ? true : x.canEditDashboard } : x);
              setUserSaving(true);
              try { await saveUsers(updated, sharedSaveCode); onUsersChange(updated); } catch (err) { alert('Save failed: ' + err.message); } finally { setUserSaving(false); }
            }

            async function quickToggleEdit(e) {
              e.stopPropagation();
              if (isAdminOrManager(u.role)) return;
              const updated = users.map(x => x.username === u.username ? { ...x, canEditDashboard: !x.canEditDashboard } : x);
              setUserSaving(true);
              try { await saveUsers(updated, sharedSaveCode); onUsersChange(updated); } catch (err) { alert('Save failed: ' + err.message); } finally { setUserSaving(false); }
            }

            return (
              <div
                key={u.username}
                className={`user-row-item${selectedUser === u.username ? ' selected' : ''}`}
                onClick={() => { setSelectedUser(u.username); setNewUserName(u.username); setNewUserLast(u.lastName || ''); setNewUserPass(u.password || ''); setNewUserRole(u.role || 'advisor'); setNewUserCanEdit(u.canEditDashboard || false); setNewUserManagementAccess(!!u.managementAccess); setNewUserPages({ ...DEFAULT_PAGES, ...(u.pages || {}) }); setNewUserChatAccess(!!u.chatAccess); setNewUserTechChatAccess(!!u.techChatAccess); }}
              >
                <div>
                  <div className="user-row-name">{u.username}</div>
                  <div className="user-row-meta">
                    {isBuiltinAdmin ? 'Admin' : (u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'No role assigned')}
                    {u.managementAccess && !isAdminOrManager(u.role) && <span className="user-edit-badge">🛠 Mgmt Access</span>}
                    {hasEditAccess && <span className="user-edit-badge">✎ Can Edit</span>}
                  </div>
                </div>
                {!isBuiltinAdmin && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button className="secondary" style={{ fontSize: 10, padding: '3px 8px', color: hasAdminRole ? '#f87171' : '#94a3b8', borderColor: hasAdminRole ? 'rgba(248,113,113,.4)' : undefined }} onClick={quickToggleAdmin} title={hasAdminRole ? 'Remove Admin' : 'Make Admin'}>{hasAdminRole ? 'Admin ✓' : 'Admin'}</button>
                    <button className="secondary" style={{ fontSize: 10, padding: '3px 8px', color: hasEditAccess ? '#3dd6c3' : '#94a3b8', borderColor: hasEditAccess ? 'rgba(61,214,195,.4)' : undefined, opacity: isAdminOrManager(u.role) ? 0.4 : 1 }} onClick={quickToggleEdit} title={isAdminOrManager(u.role) ? 'Managers always have edit access' : hasEditAccess ? 'Remove Edit Access' : 'Grant Edit Access'}>{hasEditAccess ? 'Edit ✓' : 'Edit'}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="form-section">
          <div className="small">{selectedUser ? `Editing: ${selectedUser}` : 'No user selected'}</div>
          <div className="actions">
            <button className="secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }} onClick={handleDeleteUser}>Delete Selected User</button>
            <button className="secondary" onClick={() => { setSelectedUser(''); setNewUserName(''); setNewUserLast(''); setNewUserPass(''); setNewUserRole('advisor'); setNewUserCanEdit(false); setNewUserManagementAccess(false); setNewUserPages({ ...DEFAULT_PAGES }); setNewUserChatAccess(false); }}>Clear</button>
          </div>
        </div>
        <div className="form-section">
          <div className="title" style={{ marginBottom: 8 }}>Add / Edit User</div>
          <div className="form-grid">
            <div className="field"><label>Username</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} /></div>
            <div className="field"><label title="Used only for display — login is by username only.">Last Name <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 4 }}>(optional, only the first letter is shown)</span></label><input value={newUserLast} onChange={e => setNewUserLast(e.target.value)} placeholder="e.g. Laughner" /></div>
            <div className="field"><label>Password</label><input type="password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} /></div>
            <div className="field">
              <label>Role</label>
              <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 8, padding: '5px 6px', fontSize: 13 }}>
                {ROLES.map(r => <option key={r} value={r}>{r.replace(/\b\w/g, c => c.toUpperCase())}</option>)}
              </select>
            </div>
          </div>
          <label className="user-edit-toggle">
            <input type="checkbox" checked={newUserCanEdit} onChange={e => setNewUserCanEdit(e.target.checked)} />
            <span>Can Edit Dashboard</span>
            <span className="user-edit-toggle-hint">Allows this user to open and save changes to the Edit Dashboard</span>
          </label>
          <label className="user-edit-toggle">
            <input type="checkbox" checked={newUserManagementAccess} onChange={e => setNewUserManagementAccess(e.target.checked)} />
            <span>Management Access</span>
            <span className="user-edit-toggle-hint">Grants full manager access (Manager Hub + all manager features) on top of the user's role — for an advisor who also manages, e.g. a lead advisor. They keep appearing in all advisor areas.</span>
          </label>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Page Access
              <span style={{ fontWeight: 400, fontSize: 11, color: '#475569', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>— admins &amp; managers always have full access</span>
            </div>
            {['Advisor', 'Shared', 'Warranty', 'Tech', 'Manager', 'Parts'].map(group => (
              <div key={group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>{group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                  {PAGE_ACCESS.filter(p => p.group === group).map(p => (
                    <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: newUserPages[p.key] !== false ? '#e2e8f0' : '#475569', userSelect: 'none' }}>
                      <input type="checkbox" checked={newUserPages[p.key] !== false} onChange={e => setNewUserPages(prev => ({ ...prev, [p.key]: e.target.checked }))} style={{ accentColor: '#3dd6c3', width: 14, height: 14, flexShrink: 0 }} />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setNewUserPages({ ...DEFAULT_PAGES })}>Check All</button>
              {' '}
              <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setNewUserPages(Object.fromEntries(PAGE_ACCESS.map(p => [p.key, false])))}>Uncheck All</button>
            </div>
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Chat Access</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: newUserChatAccess ? '#e2e8f0' : '#475569' }}>
              <input type="checkbox" checked={!!newUserChatAccess} onChange={e => setNewUserChatAccess(e.target.checked)} style={{ accentColor: '#3dd6c3', width: 14, height: 14 }} />
              <span>💬 Allow access to Advisor Team Chat</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: newUserTechChatAccess ? '#e2e8f0' : '#475569', marginTop: 8 }}>
              <input type="checkbox" checked={!!newUserTechChatAccess} onChange={e => setNewUserTechChatAccess(e.target.checked)} style={{ accentColor: '#fb923c', width: 14, height: 14 }} />
              <span>🔧 Allow access to Tech Chat</span>
            </label>
          </div>
          <div className="actions"><button onClick={handleSaveUser} disabled={userSaving}>{userSaving ? 'Saving...' : 'Save User'}</button></div>
        </div>
      </div>
    );

    if (openSection === 'schedule') return (
      <div style={{ margin: '0 -8px' }}>
        <ScheduleEditor schedules={schedules} onSchedulesChange={onSchedulesChange} users={users} vacations={vacations} embedded={true} />
      </div>
    );

    if (openSection === 'mgr-reports') return (
      <div style={{ margin: '0 -8px' }}>
        <ManagerReports users={users} onBack={() => setOpenSection(null)} />
      </div>
    );

    return null;
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b1120', zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', height: 60, borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {openSection && (
            <button
              onClick={() => setOpenSection(null)}
              style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              ← Back
            </button>
          )}
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#e2e8f0', lineHeight: 1.2 }}>
              {activeCard ? `${activeCard.icon} ${activeCard.label}` : '⚙️ Edit Dashboard'}
            </div>
            {activeCard && <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{activeCard.desc}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {reportStatus && (
            <span style={{ fontSize: 12, fontWeight: 700, color: reportStatus.startsWith('✅') ? '#4ade80' : reportStatus.startsWith('❌') ? '#f87171' : '#fbbf24', maxWidth: 420, textAlign: 'right' }}>
              {reportStatus}
            </span>
          )}
          <button
            onClick={sendToReports}
            disabled={sendingReports}
            title={`Techs: ${getTechWeekRange().label} · Advisors: today's daily snapshot`}
            style={{ background: 'rgba(61,214,195,.18)', border: '1px solid rgba(61,214,195,.4)', color: '#3dd6c3', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
            {sendingReports ? '⏳ Sending…' : '📊 Send to Reports'}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.4)', color: '#60a5fa', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

        {!openSection ? (
          /* ── Card grid ── */
          <div>
            <div style={{ maxWidth: 860, margin: '0 auto' }}>
              <div style={{ marginBottom: 28, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 28 }}>🏢</span>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: '#e2e8f0' }}>Bob Rohrman Hyundai — Manager Portal</div>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>Select a category below to edit dashboard settings</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {ADMIN_CARDS.map(card => (
                  <button
                    key={card.id}
                    onClick={async () => {
                      if (card.id === 'forceRefresh') {
                        await sendForceRefresh();
                        return;
                      }
                      setOpenSection(card.id);
                    }}
                    style={{
                      background: card.bg,
                      border: `1px solid ${card.border}`,
                      borderRadius: 16,
                      padding: '24px 22px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'transform .15s, box-shadow .15s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 30px ${card.border}`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                  >
                    <div style={{ fontSize: 36 }}>{card.icon}</div>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: card.id === 'forceRefresh' && forceRefreshState === 'sent' ? '#86efac' : card.color, marginBottom: 5 }}>
                        {card.id === 'forceRefresh' && forceRefreshState === 'sending' ? '⏳ Sending refresh signal…'
                          : card.id === 'forceRefresh' && forceRefreshState === 'sent' ? '✅ Refresh signal sent'
                          : card.label}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>{card.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Section detail ── */
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            {renderSectionBody()}
          </div>
        )}

      </div>
    </div>
  );
}

const SCHED_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const HOLIDAY_KEY = '__HOLIDAY__';
const DRUM_HOURS = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const DRUM_MINS  = ['00','15','30','45'];
const DRUM_AMPM  = ['AM','PM'];
const ITEM_H = 28;

function DrumPicker({ items, selected, onChange, width = 37 }) {
  const ref = React.useRef(null);
  const programmatic = React.useRef(false);
  const snapTimer = React.useRef(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.indexOf(String(selected));
    if (idx < 0) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) > ITEM_H * 0.6) {
      programmatic.current = true;
      el.scrollTop = target;
      setTimeout(() => { programmatic.current = false; }, 80);
    }
  }, [selected, items]);

  function handleScroll() {
    if (programmatic.current) return;
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el || programmatic.current) return;
      const idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
      const target = idx * ITEM_H;
      // Only set scrollTop if it needs correcting. Setting to the same value
      // fires no scroll event, so no loop and no blocking of the next gesture.
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
      if (items[idx] !== selected) onChange(items[idx]);
    }, 120);
  }

  return (
    <div style={{ position: 'relative', width, height: ITEM_H * 5, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: ITEM_H * 2, left: 3, right: 3, height: ITEM_H, background: 'rgba(255,255,255,0.09)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.13)', pointerEvents: 'none', zIndex: 1 }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 2, background: 'linear-gradient(to bottom,rgba(13,18,36,0.96),transparent)', pointerEvents: 'none', zIndex: 2 }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 2, background: 'linear-gradient(to top,rgba(13,18,36,0.96),transparent)', pointerEvents: 'none', zIndex: 2 }} />
      <div
        ref={ref}
        onScroll={handleScroll}
        style={{ height: '100%', overflowY: 'scroll', scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch', paddingTop: ITEM_H * 2, paddingBottom: ITEM_H * 2, boxSizing: 'border-box' }}
      >
        {items.map(item => (
          <div
            key={item}
            onClick={() => {
              const idx = items.indexOf(item);
              if (ref.current) ref.current.scrollTop = idx * ITEM_H;
              onChange(item);
            }}
            style={{ height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: item === selected ? '#e2e8f0' : 'rgba(255,255,255,0.18)', cursor: 'pointer', userSelect: 'none' }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseShiftTime(val) {
  if (!val || val === 'vacation' || val === 'off') return null;
  const nearest = v => DRUM_MINS.reduce((a, b) => Math.abs(parseInt(b) - parseInt(v)) < Math.abs(parseInt(a) - parseInt(v)) ? b : a);
  const m = val.match(/(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  const lm = val.match(/Lunch\s+(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  return {
    sh: m[1], sm: nearest(m[2]), sa: m[3].toUpperCase(),
    eh: m[4], em: nearest(m[5]), ea: m[6].toUpperCase(),
    lunch: lm ? { lh: lm[1], lm: nearest(lm[2]), la: lm[3].toUpperCase(), leh: lm[4], lem: nearest(lm[5]), lea: lm[6].toUpperCase() } : null,
  };
}

function ScheduleEditor({ schedules = {}, onSchedulesChange, users, vacations = [], embedded = false }) {
  // Build a quick lookup of approved / pending vacation date ranges per employee name (UPPERCASE).
  const vacByEmployee = React.useMemo(() => {
    const map = {};
    (vacations || []).forEach(v => {
      if (!v || !v.dateStart) return;
      const key = (v.name || '').toUpperCase();
      if (!key) return;
      const status = (v.status || '').toUpperCase();
      (map[key] = map[key] || []).push({
        start: v.dateStart,
        end: v.dateEnd || v.dateStart,
        approved: status === 'APPROVED',
      });
    });
    return map;
  }, [vacations]);
  function vacationFor(employeeName, dateStr) {
    const list = vacByEmployee[(employeeName || '').toUpperCase()];
    if (!list) return null;
    for (const r of list) {
      if (dateStr >= r.start && dateStr <= r.end) return r;
    }
    return null;
  }
  const today = new Date();
  const [schedYear, setSchedYear] = React.useState(today.getFullYear());
  const [schedMonth, setSchedMonth] = React.useState(today.getMonth());
  const [schedEmployee, setSchedEmployee] = React.useState('');
  const [editing, setEditing] = React.useState(null);
  const [startH, setStartH] = React.useState('8');
  const [startM, setStartM] = React.useState('00');
  const [startAP, setStartAP] = React.useState('AM');
  const [endH, setEndH]   = React.useState('5');
  const [endM, setEndM]   = React.useState('00');
  const [endAP, setEndAP] = React.useState('PM');
  const [includeLunch, setIncludeLunch] = React.useState(true);
  const [lunchH, setLunchH]   = React.useState('12');
  const [lunchM, setLunchM]   = React.useState('00');
  const [lunchAP, setLunchAP] = React.useState('PM');
  const [lunchEH, setLunchEH]   = React.useState('1');
  const [lunchEM, setLunchEM]   = React.useState('00');
  const [lunchEAP, setLunchEAP] = React.useState('PM');
  const [saving, setSaving] = React.useState(false);
  const [copiedDay, setCopiedDay] = React.useState(null); // { dateStr, shifts: { EMP: value, ... } }

  // Build employee list with role info, grouped by role for display
  const allEmployees = users.map(u => u.username.toUpperCase()).filter(Boolean);
  const employeesByRole = [
    { roleLabel: '📅 Advisors',     color: '#3dd6c3', borderColor: 'rgba(61,214,195,.5)',   bg: 'rgba(61,214,195,.08)',   emps: users.filter(u => u.role === 'advisor' || u.role === 'lead advisor').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '🔧 Technicians',  color: '#c4b5fd', borderColor: 'rgba(167,139,250,.5)',  bg: 'rgba(167,139,250,.08)', emps: users.filter(u => u.role === 'technician').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '📦 Parts',        color: '#fde68a', borderColor: 'rgba(251,191,36,.5)',   bg: 'rgba(251,191,36,.08)',   emps: users.filter(u => u.role === 'parts' || u.role === 'parts manager').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '👤 Other / Admin',color: '#94a3b8', borderColor: 'rgba(148,163,184,.5)', bg: 'rgba(148,163,184,.08)', emps: users.filter(u => !u.role || (u.role !== 'advisor' && u.role !== 'lead advisor' && u.role !== 'technician' && u.role !== 'parts' && u.role !== 'parts manager')).map(u => u.username.toUpperCase()).filter(Boolean) },
  ].filter(g => g.emps.length > 0);
  // Map employee name → role color for tab styling
  const empRoleColor = {};
  const empRoleBorder = {};
  users.forEach(u => {
    const nm = u.username.toUpperCase();
    if (u.role === 'advisor' || u.role === 'lead advisor')  { empRoleColor[nm] = '#3dd6c3'; empRoleBorder[nm] = 'rgba(61,214,195,.6)'; }
    else if (u.role === 'technician')                       { empRoleColor[nm] = '#c4b5fd'; empRoleBorder[nm] = 'rgba(167,139,250,.6)'; }
    else if (u.role === 'parts' || u.role === 'parts manager') { empRoleColor[nm] = '#fde68a'; empRoleBorder[nm] = 'rgba(251,191,36,.6)'; }
    else                                                     { empRoleColor[nm] = '#94a3b8'; empRoleBorder[nm] = 'rgba(148,163,184,.5)'; }
  });

  const shiftBase = `${startH}:${startM} ${startAP} - ${endH}:${endM} ${endAP}`;
  const lunchStr = `${lunchH}:${lunchM} ${lunchAP} - ${lunchEH}:${lunchEM} ${lunchEAP}`;
  const timeShift = includeLunch ? `${shiftBase} | Lunch ${lunchStr}` : shiftBase;

  function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function getFirstDow(y, m) { return new Date(y, m, 1).getDay(); }

  function prevMonth() {
    if (schedMonth === 0) { setSchedMonth(11); setSchedYear(y => y - 1); }
    else setSchedMonth(m => m - 1);
  }
  function nextMonth() {
    if (schedMonth === 11) { setSchedMonth(0); setSchedYear(y => y + 1); }
    else setSchedMonth(m => m + 1);
  }

  function openDay(dateStr) {
    if (schedules[HOLIDAY_KEY]?.[dateStr] === 'holiday') {
      setEditing({ dateStr, isHoliday: true });
      return;
    }
    const current = schedEmployee ? schedules[schedEmployee]?.[dateStr] || '' : '';
    const parsed = parseShiftTime(current);
    if (parsed) {
      setStartH(parsed.sh); setStartM(parsed.sm); setStartAP(parsed.sa);
      setEndH(parsed.eh); setEndM(parsed.em); setEndAP(parsed.ea);
      if (parsed.lunch) {
        setIncludeLunch(true);
        setLunchH(parsed.lunch.lh); setLunchM(parsed.lunch.lm); setLunchAP(parsed.lunch.la);
        setLunchEH(parsed.lunch.leh); setLunchEM(parsed.lunch.lem); setLunchEAP(parsed.lunch.lea);
      } else {
        setIncludeLunch(false);
      }
    } else {
      setStartH('8'); setStartM('00'); setStartAP('AM');
      setEndH('5'); setEndM('00'); setEndAP('PM');
      setIncludeLunch(true);
      setLunchH('12'); setLunchM('00'); setLunchAP('PM');
      setLunchEH('1'); setLunchEM('00'); setLunchEAP('PM');
    }
    setEditing({ dateStr, isHoliday: false, current });
  }

  async function applyHoliday() {
    const updated = { ...schedules, [HOLIDAY_KEY]: { ...(schedules[HOLIDAY_KEY] || {}), [editing.dateStr]: 'holiday' } };
    setSaving(true);
    try { await saveSchedules(updated); onSchedulesChange(updated); setEditing(null); }
    catch (err) { alert('Save failed: ' + err.message); }
    finally { setSaving(false); }
  }

  async function clearHoliday() {
    const updated = { ...schedules, [HOLIDAY_KEY]: { ...(schedules[HOLIDAY_KEY] || {}) } };
    delete updated[HOLIDAY_KEY][editing.dateStr];
    setSaving(true);
    try { await saveSchedules(updated); onSchedulesChange(updated); setEditing(null); }
    catch (err) { alert('Save failed: ' + err.message); }
    finally { setSaving(false); }
  }

  function copyDay(dateStr) {
    // Only copy the currently-selected employee's shift
    const shifts = {};
    if (schedEmployee) {
      const val = schedules[schedEmployee]?.[dateStr];
      if (val) shifts[schedEmployee] = val;
    }
    setCopiedDay({ dateStr, shifts, singleEmployee: schedEmployee });
  }

  async function pasteCopiedDay(targetDateStr) {
    if (!copiedDay) return;
    setSaving(true);
    try {
      let updated = { ...schedules };
      Object.entries(copiedDay.shifts).forEach(([emp, val]) => {
        updated = { ...updated, [emp]: { ...(updated[emp] || {}), [targetDateStr]: val } };
      });
      // Also clear employees that had no shift on the source day (optional: skip this for safety)
      await saveSchedules(updated);
      onSchedulesChange(updated);
      setEditing(null);
    } catch (err) { alert('Paste failed: ' + err.message); }
    finally { setSaving(false); }
  }

  async function applyShift(value) {
    if (!schedEmployee) { alert('Select an employee first.'); return; }
    const updated = { ...schedules, [schedEmployee]: { ...(schedules[schedEmployee] || {}), [editing.dateStr]: value } };
    if (!value) delete updated[schedEmployee][editing.dateStr];
    setSaving(true);
    try {
      await saveSchedules(updated);
      onSchedulesChange(updated);
      setEditing(null);
    } catch (err) { alert('Save failed: ' + err.message); }
    finally { setSaving(false); }
  }

  const totalDays = getDaysInMonth(schedYear, schedMonth);
  const firstDow = getFirstDow(schedYear, schedMonth);
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  return (
    <details className="edit-group" open={embedded || undefined}>
      <summary style={embedded ? { display: 'none' } : {}}>Work Schedule Editor</summary>
      <div className="group-body">
        <div className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>

          {/* Employee tabs — grouped by role */}
          <div style={{ marginBottom: 14 }}>
            {employeesByRole.map(group => (
              <div key={group.roleLabel} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  {group.roleLabel} — shifts appear in the {group.roleLabel.includes('Tech') ? 'Tech Schedule' : group.roleLabel.includes('Advisor') ? 'Advisor Schedule' : 'Work Schedule'} view
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {group.emps.map(name => {
                    const isActive = schedEmployee === name;
                    return (
                      <button
                        key={name}
                        onClick={() => { setSchedEmployee(name); setEditing(null); }}
                        style={{
                          padding: '5px 14px', fontSize: 12, fontWeight: 700, borderRadius: 20,
                          background: isActive ? group.bg : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${isActive ? group.borderColor : 'rgba(255,255,255,0.12)'}`,
                          color: isActive ? group.color : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 8px' }}>
            <button className="secondary" onClick={prevMonth} style={{ padding: '4px 12px' }}>‹</button>
            <span style={{ fontWeight: 700, color: '#6ee7f9', flex: 1, textAlign: 'center' }}>{SCHED_MONTHS[schedMonth]} {schedYear}</span>
            <button className="secondary" onClick={nextMonth} style={{ padding: '4px 12px' }}>›</button>
          </div>

          {/* Copy-day banner */}
          {copiedDay && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(110,231,249,.1)', border: '1px solid rgba(110,231,249,.35)', borderRadius: 8, padding: '7px 12px', marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>📋</span>
              <span style={{ color: '#6ee7f9', fontWeight: 700, fontSize: 13, flex: 1 }}>
                {copiedDay.singleEmployee || 'Shift'} — {copiedDay.dateStr} copied{editing && editing.dateStr !== copiedDay.dateStr ? ` — paste to ${editing.dateStr}?` : ' — select a day below to paste'}
              </span>
              <button
                onClick={() => editing && editing.dateStr !== copiedDay.dateStr && pasteCopiedDay(editing.dateStr)}
                disabled={saving || !editing || editing.dateStr === copiedDay.dateStr}
                style={{
                  background: 'rgba(110,231,249,.2)',
                  borderColor: 'rgba(110,231,249,.45)',
                  color: '#6ee7f9',
                  fontWeight: 700, padding: '4px 14px', fontSize: 13,
                  opacity: (!editing || editing.dateStr === copiedDay.dateStr) ? 0.4 : 1,
                  cursor: (editing && editing.dateStr !== copiedDay.dateStr) ? 'pointer' : 'default',
                }}
              >
                {saving ? 'Pasting…' : '📥 Paste Shifts'}
              </button>
              <button onClick={() => setCopiedDay(null)} className="secondary" style={{ padding: '2px 10px', fontSize: 12 }}>✕ Clear</button>
            </div>
          )}

          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 12 }}>
            {dayNames.map(d => (
              <div key={d} style={{ textAlign: 'center', color: '#7a92b8', fontSize: 11, fontWeight: 700, padding: '2px 0' }}>{d}</div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} />;
              const dateStr = `${schedYear}-${String(schedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isHoliday = schedules[HOLIDAY_KEY]?.[dateStr] === 'holiday';
              const val = !isHoliday && schedEmployee ? schedules[schedEmployee]?.[dateStr] : null;
              const vacReq = !isHoliday && !val && schedEmployee ? vacationFor(schedEmployee, dateStr) : null;
              const isCopied = copiedDay?.dateStr === dateStr;
              const isActive = editing?.dateStr === dateStr;
              const vacBg = vacReq ? (vacReq.approved ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.08)') : null;
              const vacBorder = vacReq ? (vacReq.approved ? 'rgba(245,158,11,0.45)' : 'rgba(245,158,11,0.3)') : null;
              const color = isActive ? 'rgba(59,130,246,0.28)' : isCopied ? 'rgba(110,231,249,0.18)' : isHoliday ? 'rgba(239,68,68,0.18)' : val === 'vacation' ? 'rgba(245,158,11,0.2)' : val === 'off' ? 'rgba(100,116,139,0.2)' : val === 'training' ? 'rgba(139,92,246,0.2)' : val ? 'rgba(61,214,195,0.15)' : vacBg ? vacBg : 'rgba(255,255,255,0.04)';
              const border = isActive ? 'rgba(96,165,250,0.9)' : isCopied ? 'rgba(110,231,249,0.7)' : isHoliday ? 'rgba(239,68,68,0.55)' : val === 'vacation' ? 'rgba(245,158,11,0.5)' : val === 'off' ? 'rgba(100,116,139,0.5)' : val === 'training' ? 'rgba(139,92,246,0.5)' : val ? 'rgba(61,214,195,0.5)' : vacBorder ? vacBorder : 'rgba(255,255,255,0.08)';
              return (
                <div key={dateStr} onClick={() => openDay(dateStr)} style={{ minHeight: 44, background: color, border: `${isActive ? '2px' : '1px'} solid ${border}`, borderRadius: 6, padding: '3px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#93c5fd' : isCopied ? '#6ee7f9' : isHoliday ? '#ef4444' : '#94a3b8' }}>{day}</span>
                  {isCopied && <span style={{ fontSize: 8, color: '#6ee7f9', fontWeight: 700, lineHeight: 1.2, marginTop: 1 }}>📋 copied</span>}
                  {isHoliday && <span style={{ fontSize: 9, color: '#ef4444', lineHeight: 1.2, marginTop: 2, fontWeight: 700 }}>Holiday</span>}
                  {val && <span style={{ fontSize: 9, color: val === 'vacation' ? '#f59e0b' : val === 'off' ? '#94a3b8' : val === 'training' ? '#a78bfa' : '#3dd6c3', lineHeight: 1.2, marginTop: 2 }}>
                    {val === 'vacation' ? 'Vac' : val === 'off' ? 'Off' : val === 'training' ? '🎓 Training' : val.split(' | ')[0].replace(' AM','a').replace(' PM','p')}
                  </span>}
                  {vacReq && !val && !isHoliday && (
                    <span style={{ fontSize: 9, color: '#f59e0b', lineHeight: 1.2, marginTop: 2, fontWeight: 700, fontStyle: vacReq.approved ? 'normal' : 'italic' }}>
                      🌴 {vacReq.approved ? 'PTO' : 'PTO?'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Day editor */}
          {editing && (
            <div style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${editing.isHoliday ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, padding: 16, marginTop: 8 }}>
              <div style={{ fontWeight: 700, color: editing.isHoliday ? '#ef4444' : '#6ee7f9', marginBottom: 12 }}>
                {editing.isHoliday ? '🎉 Holiday' : schedEmployee} — {editing.dateStr}
              </div>

              {editing.isHoliday ? (
                <>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>This day is marked as a company holiday. No employee shifts can be added.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={clearHoliday} disabled={saving} style={{ background: 'rgba(239,68,68,0.18)', borderColor: 'rgba(239,68,68,0.5)', color: '#ef4444' }}>{saving ? 'Removing…' : '🗑 Remove from Schedule'}</button>
                    <button onClick={() => setEditing(null)} className="secondary">Close</button>
                  </div>
                </>
              ) : (
                <>
                  {/* Shift drum picker */}
                  <div style={{ fontSize: 11, color: '#7a92b8', fontWeight: 700, textAlign: 'center', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>Shift Hours</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, background: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: '6px 10px', marginBottom: 10 }}>
                    <DrumPicker items={DRUM_HOURS} selected={startH} onChange={setStartH} width={54} />
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                    <DrumPicker items={DRUM_MINS} selected={startM} onChange={setStartM} width={32} />
                    <DrumPicker items={DRUM_AMPM} selected={startAP} onChange={setStartAP} width={58} />
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, fontWeight: 700, margin: '0 6px', alignSelf: 'center' }}>—</span>
                    <DrumPicker items={DRUM_HOURS} selected={endH} onChange={setEndH} width={54} />
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                    <DrumPicker items={DRUM_MINS} selected={endM} onChange={setEndM} width={32} />
                    <DrumPicker items={DRUM_AMPM} selected={endAP} onChange={setEndAP} width={58} />
                  </div>

                  {/* Lunch toggle + picker */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={includeLunch} onChange={e => setIncludeLunch(e.target.checked)} style={{ accentColor: '#3dd6c3', width: 15, height: 15 }} />
                      <span style={{ fontSize: 11, color: '#7a92b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Lunch Break</span>
                    </label>
                  </div>
                  {includeLunch && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, background: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: '6px 10px', marginBottom: 10 }}>
                      <DrumPicker items={DRUM_HOURS} selected={lunchH} onChange={setLunchH} width={54} />
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                      <DrumPicker items={DRUM_MINS} selected={lunchM} onChange={setLunchM} width={32} />
                      <DrumPicker items={DRUM_AMPM} selected={lunchAP} onChange={setLunchAP} width={58} />
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, fontWeight: 700, margin: '0 6px', alignSelf: 'center' }}>—</span>
                      <DrumPicker items={DRUM_HOURS} selected={lunchEH} onChange={setLunchEH} width={54} />
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                      <DrumPicker items={DRUM_MINS} selected={lunchEM} onChange={setLunchEM} width={32} />
                      <DrumPicker items={DRUM_AMPM} selected={lunchEAP} onChange={setLunchEAP} width={58} />
                    </div>
                  )}

                  <div style={{ textAlign: 'center', color: '#3dd6c3', fontWeight: 700, fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
                    {shiftBase}
                    {includeLunch && <><br /><span style={{ color: '#f59e0b', fontSize: 12 }}>Lunch: {lunchStr}</span></>}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => applyShift(timeShift)} disabled={saving}>{saving ? 'Saving…' : 'Save Shift'}</button>
                    <button onClick={() => applyShift('vacation')} disabled={saving} style={{ background: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.5)', color: '#f59e0b' }}>🌴 Vacation</button>
                    <button onClick={() => applyShift('off')} disabled={saving} style={{ background: 'rgba(100,116,139,0.2)', borderColor: 'rgba(100,116,139,0.4)', color: '#94a3b8' }}>Off</button>
                    <button onClick={applyHoliday} disabled={saving} style={{ background: 'rgba(239,68,68,0.18)', borderColor: 'rgba(239,68,68,0.5)', color: '#ef4444' }}>🎉 Holiday</button>
                    <button onClick={() => applyShift('training')} disabled={saving} style={{ background: 'rgba(139,92,246,0.2)', borderColor: 'rgba(139,92,246,0.5)', color: '#a78bfa' }}>🎓 Training</button>
                    <button onClick={() => applyShift('')} disabled={saving} className="secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }}>Clear Day</button>
                    <button
                      onClick={() => copyDay(editing.dateStr)}
                      style={{ background: 'rgba(110,231,249,.12)', borderColor: 'rgba(110,231,249,.3)', color: '#6ee7f9' }}
                      title="Copy all employees' shifts for this day"
                    >
                      📋 Copy Day
                    </button>
                    <button onClick={() => setEditing(null)} className="secondary">Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Live schedule overview ── */}
          <ScheduleOverview
            schedules={schedules}
            users={users}
            year={schedYear}
            month={schedMonth}
            activeEmployee={schedEmployee}
            activeDate={editing?.dateStr}
            onClickDay={dateStr => openDay(dateStr)}
          />
        </div>
      </div>
    </details>
  );
}

// ── Compact month overview shown below the editor ──────────────────────────
const SCHED_DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function fmtShiftShort(val) {
  if (!val) return null;
  if (val === 'vacation') return { label: 'Vac', color: '#f59e0b' };
  if (val === 'off')      return { label: 'Off', color: '#64748b' };
  // "8:00 AM - 5:00 PM | Lunch 12:00 PM - 1:00 PM"
  const m = val.match(/(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return { label: val.slice(0, 8), color: '#3dd6c3' };
  const fmt = (h, ap) => `${h}${ap.toLowerCase()}`;
  return { label: `${fmt(m[1], m[3])}-${fmt(m[4], m[6])}`, color: '#3dd6c3' };
}

function ScheduleOverview({ schedules, users, year, month, activeEmployee, activeDate, onClickDay }) {
  const advisors = users.filter(u => u.role === 'advisor' || u.role === 'lead advisor').map(u => u.username.toUpperCase()).filter(Boolean);
  const techs    = users.filter(u => u.role === 'technician').map(u => u.username.toUpperCase()).filter(Boolean);

  if (advisors.length === 0 && techs.length === 0) return null;

  const totalDays = new Date(year, month + 1, 0).getDate();
  const HOLIDAY_KEY = '__HOLIDAY__';

  // Build day rows: Mon–Sat only
  const dayRows = [];
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0) continue; // skip Sunday
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isHoliday = schedules[HOLIDAY_KEY]?.[dateStr] === 'holiday';
    dayRows.push({ d, dow, dateStr, isHoliday });
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  function OverviewTable({ label, color, emps }) {
    if (emps.length === 0) return null;
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'left', color: '#475569', fontWeight: 700, padding: '3px 4px', borderBottom: '1px solid rgba(255,255,255,.08)', whiteSpace: 'nowrap' }}>Day</th>
                {emps.map(name => (
                  <th key={name} style={{
                    padding: '3px 4px', textAlign: 'center', whiteSpace: 'nowrap',
                    color: name === activeEmployee ? color : '#64748b',
                    fontWeight: name === activeEmployee ? 900 : 600,
                    borderBottom: '1px solid rgba(255,255,255,.08)',
                    background: name === activeEmployee ? `rgba(${color === '#3dd6c3' ? '61,214,195' : '167,139,250'},.07)` : 'transparent',
                  }}>
                    {name.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dayRows.map(({ d, dow, dateStr, isHoliday }) => {
                const isToday   = dateStr === todayStr;
                const isActive  = dateStr === activeDate;
                const rowBg     = isActive  ? 'rgba(110,231,249,.1)'   :
                                  isToday   ? 'rgba(61,214,195,.06)'    :
                                  isHoliday ? 'rgba(239,68,68,.07)'     : 'transparent';
                return (
                  <tr
                    key={dateStr}
                    onClick={() => onClickDay(dateStr)}
                    style={{ background: rowBg, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = isActive ? 'rgba(110,231,249,.14)' : 'rgba(255,255,255,.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}
                  >
                    <td style={{ padding: '3px 4px', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                      <span style={{ color: isToday ? '#3dd6c3' : isHoliday ? '#ef4444' : '#64748b', fontWeight: isToday ? 900 : 600 }}>
                        {SCHED_DAYS_SHORT[dow]} {d}
                      </span>
                      {isHoliday && <span style={{ color: '#ef4444', marginLeft: 2 }}>🎉</span>}
                    </td>
                    {isHoliday ? (
                      <td colSpan={emps.length} style={{ padding: '3px 4px', textAlign: 'center', color: '#ef4444', fontSize: 9, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,.04)' }}>Holiday</td>
                    ) : (
                      emps.map(name => {
                        const val = schedules[name]?.[dateStr];
                        const fmt = fmtShiftShort(val);
                        const isMe = name === activeEmployee;
                        return (
                          <td key={name} style={{
                            padding: '2px 4px', textAlign: 'center',
                            borderBottom: '1px solid rgba(255,255,255,.04)',
                            background: isMe ? `rgba(${color === '#3dd6c3' ? '61,214,195' : '167,139,250'},.05)` : 'transparent',
                          }}>
                            {fmt ? (
                              <span style={{ color: fmt.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt.label}</span>
                            ) : (
                              <span style={{ color: 'rgba(255,255,255,.1)' }}>—</span>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
        📊 Current Month Overview — click any row to edit that day
      </div>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <OverviewTable label="📅 Advisor Schedule" color="#3dd6c3" emps={advisors} />
        <OverviewTable label="🔧 Tech Schedule"    color="#c4b5fd" emps={techs} />
      </div>
    </div>
  );
}
