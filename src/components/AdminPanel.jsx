import React, { useState, useEffect } from 'react';
import { safe, parsePercentInput, percentEditValue, n } from '../utils/formatters';
import { advisorDailyAverage } from '../utils/calculations';
import { getGithubToken, setGithubToken, saveDashboardToGitHub, saveUsers, saveSharedToken, saveSchedules } from '../utils/github';

const isAdminOrManager = role => role === 'admin' || (role || '').includes('manager');

const PAGE_ACCESS = [
  { key: 'advisorCalendar',    label: '📅 Advisor Calendar' },
  { key: 'documentLibrary',    label: '📁 Document Library' },
  { key: 'advisorRankBoard',   label: '🏆 Advisor Rank Board' },
  { key: 'advisorSchedule',    label: '📅 Advisor Schedule' },
  { key: 'techSchedule',       label: '🔧 Tech Schedule' },
  { key: 'aftermarketWarranty',label: '🛡 After Market Warranty' },
];
const DEFAULT_PAGES = Object.fromEntries(PAGE_ACCESS.map(p => [p.key, true]));

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
  const [openSection, setOpenSection] = useState('github');
  // Controlled local copy of vacations so Remove always targets the right row
  const [vacEdit, setVacEdit] = useState(() => vacations.map(v => ({ ...v })));

  useEffect(() => {
    setVacEdit(vacations.map(v => ({ ...v })));
  }, [vacations]);

  function updateVacEdit(idx, field, value) {
    setVacEdit(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  }

  function commitVacEdit(idx, field, value) {
    const trimmed = value.trim() || '\u2014';
    updateVacEdit(idx, field, trimmed);
    updateField(`vacations.${idx}.${field}`, trimmed);
  }

  function toggle(name) {
    setOpenSection(prev => prev === name ? null : name);
  }

  const ROLES = ['admin', 'advisor', 'technician', 'parts', 'parts manager', 'service manager'];

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

  function addVacation() {
    const newVac = structuredClone(vacations);
    newVac.push({ name: '', dates: '', status: 'APPROVED' });
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
      ? users.map(u => u.username === newUserName ? { ...u, password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, pages: newUserPages } : u)
      : [...users, { username: newUserName, password: newUserPass, role: newUserRole, canEditDashboard: newUserCanEdit, pages: newUserPages }];
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
          {vacEdit.map((v, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Name</label>
                <input
                  value={v.name === '\u2014' ? '' : (v.name || '')}
                  onChange={e => updateVacEdit(idx, 'name', e.target.value)}
                  onBlur={e => commitVacEdit(idx, 'name', e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1.4 }}>
                <label>Dates</label>
                <input
                  value={v.dates === '\u2014' ? '' : (v.dates || '')}
                  onChange={e => updateVacEdit(idx, 'dates', e.target.value)}
                  onBlur={e => commitVacEdit(idx, 'dates', e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Status</label>
                <input
                  value={v.status === '\u2014' ? '' : (v.status || '')}
                  onChange={e => updateVacEdit(idx, 'status', e.target.value)}
                  onBlur={e => commitVacEdit(idx, 'status', e.target.value)}
                />
              </div>
              <button className="secondary" style={{ flexShrink: 0, padding: '5px 10px', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }} onClick={() => removeVacation(idx)}>Remove</button>
            </div>
          ))}
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
              {users.map(u => (
                <div
                  key={u.username}
                  className={`user-row-item${selectedUser === u.username ? ' selected' : ''}`}
                  onClick={() => { setSelectedUser(u.username); setNewUserName(u.username); setNewUserPass(u.password || ''); setNewUserRole(u.role || 'advisor'); setNewUserCanEdit(u.canEditDashboard || false); setNewUserPages({ ...DEFAULT_PAGES, ...(u.pages || {}) }); }}
                >
                  <div>
                    <div className="user-row-name">{u.username}</div>
                    <div className="user-row-meta">
                      {u.username === 'admin' ? 'Admin' : (u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : 'No role assigned')}
                      {(u.canEditDashboard || isAdminOrManager(u.role)) && <span className="user-edit-badge">✎ Can Edit</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-section">
              <div className="small">{selectedUser ? `Editing: ${selectedUser}` : 'No user selected'}</div>
              <div className="actions">
                <button className="secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }} onClick={handleDeleteUser}>Delete Selected User</button>
                <button className="secondary" onClick={() => { setSelectedUser(''); setNewUserName(''); setNewUserPass(''); setNewUserRole('advisor'); setNewUserCanEdit(false); setNewUserPages({ ...DEFAULT_PAGES }); }}>Clear</button>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                  {PAGE_ACCESS.map(p => (
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
                <div style={{ marginTop: 8 }}>
                  <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setNewUserPages({ ...DEFAULT_PAGES })}>Check All</button>
                  {' '}
                  <button className="secondary" style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setNewUserPages(Object.fromEntries(PAGE_ACCESS.map(p => [p.key, false])))}>Uncheck All</button>
                </div>
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
const ITEM_H = 44;

function DrumPicker({ items, selected, onChange, width = 58 }) {
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
            style={{ height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: item === selected ? '#e2e8f0' : 'rgba(255,255,255,0.18)', cursor: 'pointer', userSelect: 'none' }}
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

  const allEmployees = users.map(u => u.username.toUpperCase()).filter(Boolean);
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

          {/* Employee tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {allEmployees.map(name => (
              <button
                key={name}
                onClick={() => { setSchedEmployee(name); setEditing(null); }}
                style={{
                  padding: '5px 14px', fontSize: 12, fontWeight: 700, borderRadius: 20,
                  background: schedEmployee === name ? 'linear-gradient(135deg,rgba(61,214,195,.35),rgba(110,231,249,.25))' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${schedEmployee === name ? 'rgba(61,214,195,.6)' : 'rgba(255,255,255,0.12)'}`,
                  color: schedEmployee === name ? '#6ee7f9' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 8px' }}>
            <button className="secondary" onClick={prevMonth} style={{ padding: '4px 12px' }}>‹</button>
            <span style={{ fontWeight: 700, color: '#6ee7f9', flex: 1, textAlign: 'center' }}>{SCHED_MONTHS[schedMonth]} {schedYear}</span>
            <button className="secondary" onClick={nextMonth} style={{ padding: '4px 12px' }}>›</button>
          </div>

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
              const color = isHoliday ? 'rgba(239,68,68,0.18)' : !val ? 'rgba(255,255,255,0.04)' : val === 'vacation' ? 'rgba(245,158,11,0.2)' : val === 'off' ? 'rgba(100,116,139,0.2)' : 'rgba(61,214,195,0.15)';
              const border = isHoliday ? 'rgba(239,68,68,0.55)' : !val ? 'rgba(255,255,255,0.08)' : val === 'vacation' ? 'rgba(245,158,11,0.5)' : val === 'off' ? 'rgba(100,116,139,0.5)' : 'rgba(61,214,195,0.5)';
              return (
                <div key={dateStr} onClick={() => openDay(dateStr)} style={{ minHeight: 44, background: color, border: `1px solid ${border}`, borderRadius: 6, padding: '3px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isHoliday ? '#ef4444' : '#94a3b8' }}>{day}</span>
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
                    <DrumPicker items={DRUM_MINS} selected={startM} onChange={setStartM} width={52} />
                    <DrumPicker items={DRUM_AMPM} selected={startAP} onChange={setStartAP} width={58} />
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, fontWeight: 700, margin: '0 6px', alignSelf: 'center' }}>—</span>
                    <DrumPicker items={DRUM_HOURS} selected={endH} onChange={setEndH} width={54} />
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                    <DrumPicker items={DRUM_MINS} selected={endM} onChange={setEndM} width={52} />
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
                      <DrumPicker items={DRUM_MINS} selected={lunchM} onChange={setLunchM} width={52} />
                      <DrumPicker items={DRUM_AMPM} selected={lunchAP} onChange={setLunchAP} width={58} />
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, fontWeight: 700, margin: '0 6px', alignSelf: 'center' }}>—</span>
                      <DrumPicker items={DRUM_HOURS} selected={lunchEH} onChange={setLunchEH} width={54} />
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 24, fontWeight: 700, lineHeight: 1, alignSelf: 'center', padding: '0 2px' }}>:</span>
                      <DrumPicker items={DRUM_MINS} selected={lunchEM} onChange={setLunchEM} width={52} />
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
                    <button onClick={() => setEditing(null)} className="secondary">Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
