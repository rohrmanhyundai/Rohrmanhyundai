import React, { useState, useEffect } from 'react';
import { safe, parsePercentInput, percentEditValue, n } from '../utils/formatters';
import { advisorDailyAverage } from '../utils/calculations';
import { getGithubToken, setGithubToken, saveDashboardToGitHub, saveUsers, saveSharedToken, saveSchedules } from '../utils/github';

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
];
// defaultOff entries start unchecked for new/existing users; others default on
const DEFAULT_PAGES = Object.fromEntries(PAGE_ACCESS.map(p => [p.key, !p.defaultOff]));

export default function AdminPanel({ data, vacations, isOpen, onClose, onDataChange, onRefresh, currentUser, currentRole, users, sharedSaveCode, onSharedSaveCodeChange, onUsersChange, schedules, onSchedulesChange }) {
  const [githubToken, setToken] = useState(getGithubToken());
  const [saving, setSaving] = useState(false);
  const [userSaving, setUserSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState('advisor');
  const [newUserCanEdit, setNewUserCanEdit] = useState(false);
  const [newUserPages, setNewUserPages] = useState({ ...DEFAULT_PAGES });
  const [newUserChatAccess, setNewUserChatAccess] = useState(false);
  const [newUserTechChatAccess, setNewUserTechChatAccess] = useState(false);
  const [openSection, setOpenSection] = useState('github');
  // Controlled local copy of vacations so Remove always targets the right row
  const [vacEdit, setVacEdit] = useState(() => vacations.map(v => ({ ...v })));
  const [vacSyncStatus, setVacSyncStatus] = useState({}); // { idx: 'ok' | 'err:msg' | 'syncing' }

  useEffect(() => {
    setVacEdit(vacations.map(v => ({ ...v })));
  }, [vacations]);

  // Auto-remove expired vacations when the panel opens
  useEffect(() => {
    if (!isOpen || !vacations.length) return;
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

    if (active.length < vacations.length) {
      onDataChange(data, active);
    }
  }, [isOpen]);

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
      syncVacationToSchedule(idx, vac);
    }
  }

  async function syncVacationToSchedule(idx, vac) {
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
      const empSchedule = { ...(schedules[empKey] || {}) };
      days.forEach(d => { empSchedule[d] = 'vacation'; });
      const updated = { ...schedules, [empKey]: empSchedule };
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

  const ROLES = ['admin', 'advisor', 'technician', 'parts', 'parts manager', 'service manager', 'warranty'];

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

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { data, vacations };
      await saveDashboardToGitHub(payload);
      // Local state is already correct from user edits — no re-fetch needed.
      // The TV will pick up the new data on its next 90-second poll via the GitHub API.
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const [tokenSyncing, setTokenSyncing] = useState(false);

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

  function addTechnician() {
    const name = prompt('Technician name:');
    if (!name) return;
    const goal = safe(prompt('Weekly goal:', '47.5'), 47.5);
    const newData = structuredClone(data);
    newData.technicians.push({
      name: name.toUpperCase(), goal, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0,
      total: 0, goal_pct: 0, pacing: 0, certified: '\u2014', trainings_due: '\u2014', excel_training: '\u2014',
    });
    onDataChange(newData, vacations);
  }

  function removeTechnician(idx) {
    if (!confirm(`Remove ${data.technicians[idx].name}?`)) return;
    const newData = structuredClone(data);
    newData.technicians.splice(idx, 1);
    onDataChange(newData, vacations);
  }

  function addAdvisor() {
    const name = prompt('Advisor name:');
    if (!name) return;
    const newData = structuredClone(data);
    newData.advisors.push({
      name: name.toUpperCase(), mtd_hours: 0, daily_avg: 0, hours_per_ro: 0,
      align: 0, tires: 0, valvoline: 0, roh50_hrs_ro: 0, csi: 0, asr: 0, elr: 0, last_month_total: 0,
    });
    newData.advisorTraining.push({
      name: name.toUpperCase(), certified: '\u2014', trainings_due: '\u2014', excel_training: '\u2014',
    });
    onDataChange(newData, vacations);
  }

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
      syncVacationToSchedule(idx, updated);
    }
  }

  function addVacation() {
    const newVac = structuredClone(vacations);
    newVac.push({ name: '', dates: '', dateStart: '', dateEnd: '', status: 'APPROVED' });
    onDataChange(data, newVac);
  }

  function removeVacation(idx) {
    const newVac = structuredClone(vacations);
    newVac.splice(idx, 1);
    onDataChange(data, newVac);
  }

  function handleSaveUser() {
    if (!isAdminOrManager(currentRole)) { alert('Only admin or managers can manage users.'); return; }
    if (!newUserName || !newUserPass) { alert('Enter username and password'); return; }
    const updated = users.find(u => u.username === newUserName)
      ? users.map(u => u.username === newUserName ? { ...u, password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, pages: newUserPages, chatAccess: newUserChatAccess, techChatAccess: newUserTechChatAccess } : u)
      : [...users, { username: newUserName, password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, pages: newUserPages, chatAccess: newUserChatAccess, techChatAccess: newUserTechChatAccess }];
    setUserSaving(true);
    saveUsers(updated, sharedSaveCode || getGithubToken())
      .then(() => { onUsersChange(updated); setSelectedUser(newUserName); })
      .catch(err => alert('Failed to save user: ' + err.message))
      .finally(() => setUserSaving(false));
  }

  function handleDeleteUser() {
    if (!isAdminOrManager(currentRole)) { alert('Only admin or managers can manage users.'); return; }
    if (!selectedUser) { alert('Select a user to delete.'); return; }
    if (selectedUser === 'admin') { alert('Admin cannot be deleted.'); return; }
    const updated = users.filter(u => u.username !== selectedUser);
    setUserSaving(true);
    saveUsers(updated, sharedSaveCode || getGithubToken())
      .then(() => { onUsersChange(updated); setSelectedUser(''); setNewUserName(''); setNewUserPass(''); setNewUserRole('advisor'); })
      .catch(err => alert('Failed to delete user: ' + err.message))
      .finally(() => setUserSaving(false));
  }

  if (!isOpen) return null;

  return (
    <aside className="admin open">
      <div className="admin-topbar">
        <h2>Edit Dashboard</h2>
        <div className="actions">
          <button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="admin-body">
      <div className="small">Training Center, Vacation Approved, advisor pacing, and all edit boxes are rebuilt to behave consistently.</div>

      {/* GitHub Settings */}
      <details className="edit-group" open={openSection === 'github'} onToggle={e => e.target.open ? setOpenSection('github') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('github'); }}>GitHub Settings</summary>
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
      </details>

      {/* Dashboard Settings */}
      <details className="edit-group" open={openSection === 'dashboard'} onToggle={e => e.target.open ? setOpenSection('dashboard') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('dashboard'); }}>Dashboard Settings</summary>
        <div className="group-body">
          <div className="field">
            <label>Dashboard Title</label>
            <input value={data.title || ''} onChange={e => updateField('title', e.target.value)} />
          </div>
        </div>
      </details>

      {/* Goal Gauges */}
      <details className="edit-group" open={openSection === 'gauges'} onToggle={e => e.target.open ? setOpenSection('gauges') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('gauges'); }}>Goal Gauges</summary>
        <div className="group-body">
          <div className="form-grid">
            <div className="field"><label>Gross Profit Goal</label><input value={data.grossGoal ?? 0} onChange={e => updateField('grossGoal', safe(e.target.value, data.grossGoal))} /></div>
            <div className="field"><label>Gross Profit Actual</label><input value={data.grossActual ?? 0} onChange={e => updateField('grossActual', safe(e.target.value, data.grossActual))} /></div>
            <div className="field"><label>Customer Pay Goal</label><input value={data.cpGoal ?? 0} onChange={e => updateField('cpGoal', safe(e.target.value, data.cpGoal))} /></div>
            <div className="field"><label>Customer Pay Actual</label><input value={data.cpActual ?? 0} onChange={e => updateField('cpActual', safe(e.target.value, data.cpActual))} /></div>
            <div className="field"><label>Advisor Monthly Workdays</label><input value={data.advisorMonthlyWorkdays ?? 27} onChange={e => updateField('advisorMonthlyWorkdays', safe(e.target.value, 27))} /></div>
          </div>
        </div>
      </details>

      {/* Advisor Performance */}
      <details className="edit-group" open={openSection === 'advisors'} onToggle={e => e.target.open ? setOpenSection('advisors') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('advisors'); }}>Advisor Performance</summary>
        <div className="group-body">
          <div className="small">Daily Avg is automatic. You can edit MTD Hrs, Hrs/RO, and percentages.</div>
          {data.advisors.map((a, idx) => (
            <div className="form-section" key={a.name}>
              <div className="title" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  {a.name}
                  {a.hidden && <span style={{ marginLeft: 8, fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 6, padding: '2px 7px', verticalAlign: 'middle' }}>Hidden</span>}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="secondary"
                    style={a.hidden ? { color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' } : {}}
                    onClick={() => updateField(`advisors.${idx}.hidden`, !a.hidden)}
                  >
                    {a.hidden ? 'Show on Dashboard' : 'Hide from Dashboard'}
                  </button>
                  <button className="secondary" onClick={() => removeAdvisor(idx)}>Remove</button>
                </div>
              </div>
              <div className="form-grid">
                <div className="field"><label>Daily Avg</label><input value={n(advisorDailyAverage(a, data), 2)} disabled /></div>
                <div className="field"><label>MTD Hrs</label><input defaultValue={a.mtd_hours} onBlur={e => updateField(`advisors.${idx}.mtd_hours`, safe(e.target.value, a.mtd_hours))} /></div>
                <div className="field"><label>Hrs/RO</label><input defaultValue={a.hours_per_ro} onBlur={e => updateField(`advisors.${idx}.hours_per_ro`, safe(e.target.value, a.hours_per_ro))} /></div>
                <div className="field"><label>Alignment %</label><input defaultValue={percentEditValue(a.align)} onBlur={e => updateField(`advisors.${idx}.align`, parsePercentInput(e.target.value, a.align))} /></div>
                <div className="field"><label>Tires %</label><input defaultValue={percentEditValue(a.tires)} onBlur={e => updateField(`advisors.${idx}.tires`, parsePercentInput(e.target.value, a.tires))} /></div>
                <div className="field"><label>Valvoline %</label><input defaultValue={percentEditValue(a.valvoline)} onBlur={e => updateField(`advisors.${idx}.valvoline`, parsePercentInput(e.target.value, a.valvoline))} /></div>
                <div className="field"><label>Roh$50 HRS/RO</label><input defaultValue={a.roh50_hrs_ro ?? ''} onBlur={e => updateField(`advisors.${idx}.roh50_hrs_ro`, safe(e.target.value, 0))} /></div>
                <div className="field"><label>CSI</label><input defaultValue={a.csi} onBlur={e => updateField(`advisors.${idx}.csi`, safe(e.target.value, a.csi))} /></div>
                <div className="field"><label>ASR %</label><input defaultValue={percentEditValue(a.asr)} onBlur={e => updateField(`advisors.${idx}.asr`, parsePercentInput(e.target.value, a.asr))} /></div>
                <div className="field"><label>ELR %</label><input defaultValue={percentEditValue(a.elr)} onBlur={e => updateField(`advisors.${idx}.elr`, parsePercentInput(e.target.value, a.elr))} /></div>
                <div className="field"><label>Last Month Total</label><input defaultValue={a.last_month_total ?? 0} onBlur={e => updateField(`advisors.${idx}.last_month_total`, safe(e.target.value, 0))} /></div>
              </div>
            </div>
          ))}
          <div className="actions"><button onClick={addAdvisor}>Add Advisor</button></div>
        </div>
      </details>

      {/* Training Center */}
      <details className="edit-group" open={openSection === 'training'} onToggle={e => e.target.open ? setOpenSection('training') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('training'); }}>Training Center</summary>
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
      </details>

      {/* Technicians */}
      <details className="edit-group" open={openSection === 'technicians'} onToggle={e => e.target.open ? setOpenSection('technicians') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('technicians'); }}>Technicians</summary>
        <div className="group-body">
          <div className="title">Technician Daily Hours</div>
          {data.technicians.map((t, idx) => (
            <div className="form-section" key={t.name}>
              <div className="title" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                {t.name}
                <button className="secondary" onClick={() => removeTechnician(idx)}>Remove</button>
              </div>
              <div className="form-grid">
                {['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(day => (
                  <div className="field" key={day}><label>{day.charAt(0).toUpperCase() + day.slice(1)}</label><input defaultValue={t[day]} onBlur={e => updateField(`technicians.${idx}.${day}`, safe(e.target.value, t[day]))} /></div>
                ))}
              </div>
            </div>
          ))}
          <div className="actions"><button onClick={addTechnician}>Add Technician</button></div>
        </div>
      </details>

      {/* Approved Vacation */}
      <details className="edit-group" open={openSection === 'vacation'} onToggle={e => e.target.open ? setOpenSection('vacation') : setOpenSection(null)}>
        <summary onClick={e => { e.preventDefault(); toggle('vacation'); }}>Approved Vacation</summary>
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
                    <input
                      value={v.name === '\u2014' ? '' : (v.name || '')}
                      onChange={e => updateVacEdit(idx, 'name', e.target.value)}
                      onBlur={e => commitVacEdit(idx, 'name', e.target.value)}
                      placeholder="e.g. JORDAN"
                    />
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
      </details>

      {/* User Management */}
      {isAdminOrManager(currentRole) && (
        <details className="edit-group" open={openSection === 'users'} onToggle={e => e.target.open ? setOpenSection('users') : setOpenSection(null)}>
          <summary onClick={e => { e.preventDefault(); toggle('users'); }}>User Management</summary>
          <div className="group-body">
            <div className="small">Click a user to load them into the form.</div>
            <div className="user-row-list">
              {users.map(u => {
                const isBuiltinAdmin = u.username === 'admin';
                const hasAdminRole = u.role === 'admin';
                const hasEditAccess = u.canEditDashboard || isAdminOrManager(u.role);

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
                    onClick={() => { setSelectedUser(u.username); setNewUserName(u.username); setNewUserPass(u.password || ''); setNewUserRole(u.role || 'advisor'); setNewUserCanEdit(u.canEditDashboard || false); setNewUserPages({ ...DEFAULT_PAGES, ...(u.pages || {}) }); setNewUserChatAccess(!!u.chatAccess); setNewUserTechChatAccess(!!u.techChatAccess); }}
                  >
                    <div>
                      <div className="user-row-name">{u.username}</div>
                      <div className="user-row-meta">
                        {isBuiltinAdmin ? 'Admin' : (u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'No role assigned')}
                        {hasEditAccess && <span className="user-edit-badge">✎ Can Edit</span>}
                      </div>
                    </div>
                    {!isBuiltinAdmin && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button
                          className="secondary"
                          style={{ fontSize: 10, padding: '3px 8px', color: hasAdminRole ? '#f87171' : '#94a3b8', borderColor: hasAdminRole ? 'rgba(248,113,113,.4)' : undefined }}
                          onClick={quickToggleAdmin}
                          title={hasAdminRole ? 'Remove Admin' : 'Make Admin'}
                        >{hasAdminRole ? 'Admin ✓' : 'Admin'}</button>
                        <button
                          className="secondary"
                          style={{ fontSize: 10, padding: '3px 8px', color: hasEditAccess ? '#3dd6c3' : '#94a3b8', borderColor: hasEditAccess ? 'rgba(61,214,195,.4)' : undefined, opacity: isAdminOrManager(u.role) ? 0.4 : 1 }}
                          onClick={quickToggleEdit}
                          title={isAdminOrManager(u.role) ? 'Managers always have edit access' : hasEditAccess ? 'Remove Edit Access' : 'Grant Edit Access'}
                        >{hasEditAccess ? 'Edit ✓' : 'Edit'}</button>
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
                <button className="secondary" onClick={() => { setSelectedUser(''); setNewUserName(''); setNewUserPass(''); setNewUserRole('advisor'); setNewUserCanEdit(false); setNewUserPages({ ...DEFAULT_PAGES }); setNewUserChatAccess(false); }}>Clear</button>
              </div>
            </div>
            <div className="form-section">
              <div className="title" style={{ marginBottom: 8 }}>Add / Edit User</div>
              <div className="form-grid">
                <div className="field"><label>Username</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} /></div>
                <div className="field"><label>Password</label><input type="password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} /></div>
                <div className="field">
                  <label>Role</label>
                  <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 8, padding: '5px 6px', fontSize: 13 }}>
                    {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <label className="user-edit-toggle">
                <input type="checkbox" checked={newUserCanEdit} onChange={e => setNewUserCanEdit(e.target.checked)} />
                <span>Can Edit Dashboard</span>
                <span className="user-edit-toggle-hint">Allows this user to open and save changes to the Edit Dashboard</span>
              </label>

              {/* Page Access */}
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
                          <input
                            type="checkbox"
                            checked={newUserPages[p.key] !== false}
                            onChange={e => setNewUserPages(prev => ({ ...prev, [p.key]: e.target.checked }))}
                            style={{ accentColor: '#3dd6c3', width: 14, height: 14, flexShrink: 0 }}
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 8 }}>
                  <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setNewUserPages({ ...DEFAULT_PAGES })}>Check All</button>
                  {' '}
                  <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setNewUserPages(Object.fromEntries(PAGE_ACCESS.map(p => [p.key, false])))}>Uncheck All</button>
                </div>
              </div>

              {/* Chat Access */}
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Chat Access</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: newUserChatAccess ? '#e2e8f0' : '#475569' }}>
                  <input
                    type="checkbox"
                    checked={!!newUserChatAccess}
                    onChange={e => setNewUserChatAccess(e.target.checked)}
                    style={{ accentColor: '#3dd6c3', width: 14, height: 14 }}
                  />
                  <span>💬 Allow access to Advisor Team Chat</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: newUserTechChatAccess ? '#e2e8f0' : '#475569', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!newUserTechChatAccess}
                    onChange={e => setNewUserTechChatAccess(e.target.checked)}
                    style={{ accentColor: '#fb923c', width: 14, height: 14 }}
                  />
                  <span>🔧 Allow access to Tech Chat</span>
                </label>
              </div>

              <div className="actions"><button onClick={handleSaveUser} disabled={userSaving}>{userSaving ? 'Saving...' : 'Save User'}</button></div>
            </div>
          </div>
        </details>
      )}

      {/* Work Schedule Editor */}
      {isAdminOrManager(currentRole) && (
        <ScheduleEditor
          schedules={schedules} onSchedulesChange={onSchedulesChange}
          users={users}
        />
      )}

      </div>
    </aside>
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

function ScheduleEditor({ schedules = {}, onSchedulesChange, users }) {
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
    { roleLabel: '📅 Advisors',     color: '#3dd6c3', borderColor: 'rgba(61,214,195,.5)',   bg: 'rgba(61,214,195,.08)',   emps: users.filter(u => u.role === 'advisor').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '🔧 Technicians',  color: '#c4b5fd', borderColor: 'rgba(167,139,250,.5)',  bg: 'rgba(167,139,250,.08)', emps: users.filter(u => u.role === 'technician').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '📦 Parts',        color: '#fde68a', borderColor: 'rgba(251,191,36,.5)',   bg: 'rgba(251,191,36,.08)',   emps: users.filter(u => u.role === 'parts' || u.role === 'parts manager').map(u => u.username.toUpperCase()).filter(Boolean) },
    { roleLabel: '👤 Other / Admin',color: '#94a3b8', borderColor: 'rgba(148,163,184,.5)', bg: 'rgba(148,163,184,.08)', emps: users.filter(u => !u.role || (u.role !== 'advisor' && u.role !== 'technician' && u.role !== 'parts' && u.role !== 'parts manager')).map(u => u.username.toUpperCase()).filter(Boolean) },
  ].filter(g => g.emps.length > 0);
  // Map employee name → role color for tab styling
  const empRoleColor = {};
  const empRoleBorder = {};
  users.forEach(u => {
    const nm = u.username.toUpperCase();
    if (u.role === 'advisor')                               { empRoleColor[nm] = '#3dd6c3'; empRoleBorder[nm] = 'rgba(61,214,195,.6)'; }
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
    // Snapshot all employees' shift values for this date
    const shifts = {};
    allEmployees.forEach(emp => {
      const val = schedules[emp]?.[dateStr];
      if (val) shifts[emp] = val;
    });
    setCopiedDay({ dateStr, shifts });
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
    <details className="edit-group">
      <summary>Work Schedule Editor</summary>
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
                {copiedDay.dateStr} copied{editing && editing.dateStr !== copiedDay.dateStr ? ` — paste to ${editing.dateStr}?` : ' — select a day below to paste'}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {Object.keys(copiedDay.shifts).length} employee{Object.keys(copiedDay.shifts).length !== 1 ? 's' : ''}
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
              const isCopied = copiedDay?.dateStr === dateStr;
              const color = isCopied ? 'rgba(110,231,249,0.18)' : isHoliday ? 'rgba(239,68,68,0.18)' : !val ? 'rgba(255,255,255,0.04)' : val === 'vacation' ? 'rgba(245,158,11,0.2)' : val === 'off' ? 'rgba(100,116,139,0.2)' : 'rgba(61,214,195,0.15)';
              const border = isCopied ? 'rgba(110,231,249,0.7)' : isHoliday ? 'rgba(239,68,68,0.55)' : !val ? 'rgba(255,255,255,0.08)' : val === 'vacation' ? 'rgba(245,158,11,0.5)' : val === 'off' ? 'rgba(100,116,139,0.5)' : 'rgba(61,214,195,0.5)';
              return (
                <div key={dateStr} onClick={() => openDay(dateStr)} style={{ minHeight: 44, background: color, border: `1px solid ${border}`, borderRadius: 6, padding: '3px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isCopied ? '#6ee7f9' : isHoliday ? '#ef4444' : '#94a3b8' }}>{day}</span>
                  {isCopied && <span style={{ fontSize: 8, color: '#6ee7f9', fontWeight: 700, lineHeight: 1.2, marginTop: 1 }}>📋 copied</span>}
                  {isHoliday && <span style={{ fontSize: 9, color: '#ef4444', lineHeight: 1.2, marginTop: 2, fontWeight: 700 }}>Holiday</span>}
                  {val && <span style={{ fontSize: 9, color: val === 'vacation' ? '#f59e0b' : val === 'off' ? '#94a3b8' : '#3dd6c3', lineHeight: 1.2, marginTop: 2 }}>
                    {val === 'vacation' ? 'Vac' : val === 'off' ? 'Off' : val.split(' | ')[0].replace(' AM','a').replace(' PM','p')}
                  </span>}
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
  const advisors = users.filter(u => u.role === 'advisor').map(u => u.username.toUpperCase()).filter(Boolean);
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
