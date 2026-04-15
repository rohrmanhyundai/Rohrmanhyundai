import React, { useState, useEffect } from 'react';
import { safe, parsePercentInput, percentEditValue, n } from '../utils/formatters';
import { advisorDailyAverage } from '../utils/calculations';
import { getGithubToken, setGithubToken, saveDashboardToGitHub } from '../utils/github';

export default function AdminPanel({ data, vacations, isOpen, onClose, onDataChange, currentUser }) {
  const [githubToken, setToken] = useState(getGithubToken());
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState(() => {
    const stored = localStorage.getItem('dashboardUsersV1');
    const parsed = stored ? JSON.parse(stored) : null;
    const list = parsed || [{ username: 'admin', password: 'Hyundai2026' }];
    if (!list.find(u => u.username === 'admin')) {
      list.push({ username: 'admin', password: 'Hyundai2026' });
    }
    return list;
  });
  const [selectedUser, setSelectedUser] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('');

  useEffect(() => {
    localStorage.setItem('dashboardUsersV1', JSON.stringify(users));
  }, [users]);

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
      alert('Dashboard saved to GitHub. Refresh the TV after GitHub Pages republishes.');
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleTokenSave() {
    setGithubToken(githubToken);
    alert('GitHub token saved.');
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
    if (currentUser !== 'admin') { alert('Only admin can manage users.'); return; }
    if (!newUserName || !newUserPass) { alert('Enter username and password'); return; }
    setUsers(prev => {
      const existing = prev.find(u => u.username === newUserName);
      if (existing) {
        return prev.map(u => u.username === newUserName ? { ...u, password: newUserPass } : u);
      }
      return [...prev, { username: newUserName, password: newUserPass }];
    });
    setSelectedUser(newUserName);
  }

  function handleDeleteUser() {
    if (currentUser !== 'admin') { alert('Only admin can manage users.'); return; }
    if (!selectedUser) { alert('Select a user to delete.'); return; }
    if (selectedUser === 'admin') { alert('Admin cannot be deleted.'); return; }
    setUsers(prev => prev.filter(u => u.username !== selectedUser));
    setSelectedUser('');
    setNewUserName('');
    setNewUserPass('');
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
      <details className="edit-group" open>
        <summary>GitHub Settings</summary>
        <div className="group-body">
          <div className="form-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            <div className="small">Enter a GitHub Personal Access Token with repo scope to enable saving.</div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>GitHub Token</label>
              <input type="password" value={githubToken} onChange={e => setToken(e.target.value)} />
            </div>
            <div className="actions"><button onClick={handleTokenSave}>Save Token</button></div>
          </div>
        </div>
      </details>

      {/* Dashboard Settings */}
      <details className="edit-group">
        <summary>Dashboard Settings</summary>
        <div className="group-body">
          <div className="field">
            <label>Dashboard Title</label>
            <input value={data.title || ''} onChange={e => updateField('title', e.target.value)} />
          </div>
        </div>
      </details>

      {/* Goal Gauges */}
      <details className="edit-group">
        <summary>Goal Gauges</summary>
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
      <details className="edit-group">
        <summary>Advisor Performance</summary>
        <div className="group-body">
          <div className="small">Daily Avg is automatic. You can edit MTD Hrs, Hrs/RO, and percentages.</div>
          {data.advisors.map((a, idx) => (
            <div className="form-section" key={a.name}>
              <div className="title" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                {a.name}
                <button className="secondary" onClick={() => removeAdvisor(idx)}>Remove</button>
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
      <details className="edit-group">
        <summary>Training Center</summary>
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
      <details className="edit-group">
        <summary>Technicians</summary>
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
      <details className="edit-group">
        <summary>Approved Vacation</summary>
        <div className="group-body">
          {vacations.map((v, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ flex: 1 }}><label>Name</label><input defaultValue={v.name || ''} onBlur={e => updateField(`vacations.${idx}.name`, e.target.value.trim() || '\u2014')} /></div>
              <div className="field" style={{ flex: 1.4 }}><label>Dates</label><input defaultValue={v.dates || ''} onBlur={e => updateField(`vacations.${idx}.dates`, e.target.value.trim() || '\u2014')} /></div>
              <div className="field" style={{ flex: 1 }}><label>Status</label><input defaultValue={v.status || ''} onBlur={e => updateField(`vacations.${idx}.status`, e.target.value.trim() || '\u2014')} /></div>
              <button className="secondary" style={{ flexShrink: 0, padding: '5px 10px', color: '#ef4444', borderColor: 'rgba(239,68,68,.35)' }} onClick={() => removeVacation(idx)}>Remove</button>
            </div>
          ))}
          <div className="actions"><button onClick={addVacation}>+ Add Vacation</button></div>
        </div>
      </details>

      {/* User Management */}
      {currentUser === 'admin' && (
        <details className="edit-group">
          <summary>User Management</summary>
          <div className="group-body">
            <div className="small">Click a user to load them into the form.</div>
            <div className="user-row-list">
              {users.map(u => (
                <div
                  key={u.username}
                  className={`user-row-item${selectedUser === u.username ? ' selected' : ''}`}
                  onClick={() => { setSelectedUser(u.username); setNewUserName(u.username); setNewUserPass(u.password || ''); }}
                >
                  <div>
                    <div className="user-row-name">{u.username}</div>
                    <div className="user-row-meta">{u.username === 'admin' ? 'Admin account' : 'Standard user'}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-section">
              <div className="small">{selectedUser ? `Selected user: ${selectedUser}` : 'No user selected'}</div>
              <div className="actions">
                <button className="secondary" onClick={handleDeleteUser}>Delete Selected User</button>
                <button className="secondary" onClick={() => { setSelectedUser(''); setNewUserName(''); setNewUserPass(''); }}>Clear Selection</button>
              </div>
            </div>
            <div className="form-section">
              <div className="title">Add / Edit User</div>
              <div className="form-grid">
                <div className="field"><label>Username</label><input value={newUserName} onChange={e => setNewUserName(e.target.value)} /></div>
                <div className="field"><label>Password</label><input value={newUserPass} onChange={e => setNewUserPass(e.target.value)} /></div>
              </div>
              <div className="actions"><button onClick={handleSaveUser}>Save User</button></div>
            </div>
          </div>
        </details>
      )}

      </div>
    </aside>
  );
}
