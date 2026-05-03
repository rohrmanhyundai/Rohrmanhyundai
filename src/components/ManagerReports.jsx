import React, { useState, useEffect } from 'react';
import { loadGithubFile, saveGithubFile, loadUsers, getGithubToken, setGithubToken } from '../utils/github';
import PerformanceReport from './PerformanceReport';

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
  const advisors = (users || []).filter(u => u.role === 'advisor').map(u => u.username.toUpperCase());
  const techs    = (users || []).filter(u => u.role === 'technician').map(u => u.username.toUpperCase());
  const allUsers = [...advisors, ...techs];

  const [selected, setSelected] = useState(allUsers[0] || '');
  const [viewUser, setViewUser] = useState(null);
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
      }
      fields.forEach(f => {
        entry[f.key] = inputToStored(form[f.key], f);
      });
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
        role={advisors.includes(viewUser) ? 'advisor' : 'technician'}
        onBack={() => setViewUser(null)}
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

          {/* Add / Edit form */}
          {showForm && form && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: '#e2e8f0', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
                {editIdx !== null ? '✏️ Edit Entry' : '➕ New Entry'} — {selected}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
                {/* Date */}
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>Date *</div>
                  <input type="date" value={form.date} onChange={e => updateForm('date', e.target.value)} style={inp()} />
                </div>
                {/* Label */}
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>Label (e.g. "Week of May 1" or "April Monthly")</div>
                  <input value={form.label} onChange={e => updateForm('label', e.target.value)} placeholder="Optional label…" style={inp()} />
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
                        {fields.map(f => (
                          <th key={f.key} style={{ minWidth: f.isDay ? 90 : 100, padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {f.label}
                            {f.isDay && e.weekStart
                              ? <span style={{ marginLeft: 5, fontWeight: 400, color: '#64748b', fontSize: 11 }}>{dayDate(f.offset)}</span>
                              : null}
                          </th>
                        ))}
                        <th style={{ minWidth: 130, whiteSpace: 'nowrap', padding: '10px 14px', position: 'sticky', right: 0, zIndex: 2, background: '#0f172a', textAlign: 'center' }}>ACTIONS</th>
                      </tr>
                    ) : (
                      // Subsequent rows: re-render header with that row's dates
                      <tr>
                        <th colSpan={isAdvisor ? 2 : 2} style={{ padding: '6px 14px', background: '#0a1628', borderTop: '1px solid rgba(255,255,255,.06)' }} />
                        {fields.map(f => (
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
                          {fields.map(f => (
                            <td key={f.key} style={{ color: '#cbd5e1', textAlign: 'center', padding: '9px 10px', whiteSpace: 'nowrap' }}>
                              {displayVal(e[f.key], f)}
                            </td>
                          ))}
                          <td style={{ whiteSpace: 'nowrap', padding: '9px 12px', position: 'sticky', right: 0, zIndex: 1, background: '#0d1b2a' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button onClick={() => openEdit(idx)} style={{ background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', color: '#60a5fa', borderRadius: 7, padding: '5px 11px', cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>✏️ Edit</button>
                              <button onClick={() => handleDelete(idx)} disabled={deletingIdx === idx} style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)', color: '#f87171', borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                                {deletingIdx === idx ? '⏳' : '🗑 Del'}
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
    </div>
  );
}
