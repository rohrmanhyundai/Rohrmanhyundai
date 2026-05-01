import React, { useState, useEffect } from 'react';
import { loadGithubFile, saveGithubFile } from '../utils/github';

const EMPTY_SP = { id: '', name: '', title: '', units_new: 0, units_used: 0, gross: 0, fi_products: 0, csi: 0, goal: 0 };

function inp(extra = {}) {
  return {
    background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13,
    outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', ...extra
  };
}

const section = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '22px 26px', marginBottom: 20 };
const sectionHead = { fontWeight: 900, fontSize: 13, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,.07)' };
const fieldLabel = { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 5 };

export default function SalesAdmin({ currentUser }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editIdx, setEditIdx] = useState(null);  // which salesperson is being edited

  useEffect(() => {
    loadGithubFile('data/sales/dashboard.json')
      .then(d => setData(d || defaultData()))
      .catch(() => setData(defaultData()))
      .finally(() => setLoading(false));
  }, []);

  function defaultData() {
    return {
      title: '',
      salespeople: [],
      goals: { units_goal: 0, individual_goal: 0, gross_goal: 0, fi_goal: 0 },
      team: { units_today: 0, appointments: 0, pending_deliveries: 0, trade_ins: 0, test_drives: 0 },
      extras: { incentives: [], hot_models: [], quote: '', quote_author: '' },
    };
  }

  function update(path, val) {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = val;
      return next;
    });
  }

  function updateSP(idx, field, val) {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.salespeople[idx][field] = val;
      return next;
    });
  }

  function addSalesperson() {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const id = `sp_${Date.now()}`;
      next.salespeople.push({ ...EMPTY_SP, id });
      return next;
    });
    setEditIdx((data?.salespeople?.length) || 0);
  }

  function removeSP(idx) {
    if (!window.confirm('Remove this salesperson?')) return;
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.salespeople.splice(idx, 1);
      return next;
    });
    setEditIdx(null);
  }

  function updateListItem(listPath, idx, val) {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = listPath.split('.');
      let obj = next;
      for (const p of parts) obj = obj[p];
      obj[idx] = val;
      return next;
    });
  }

  function addListItem(listPath, val = '') {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = listPath.split('.');
      let obj = next;
      for (const p of parts) obj = obj[p];
      obj.push(val);
      return next;
    });
  }

  function removeListItem(listPath, idx) {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = listPath.split('.');
      let obj = next;
      for (const p of parts) obj = obj[p];
      obj.splice(idx, 1);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true); setStatus('');
    try {
      await saveGithubFile('data/sales/dashboard.json', data, `Sales board update by ${currentUser.username}`);
      setStatus('✅ Saved successfully!');
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally { setSaving(false); }
  }

  if (loading) return <div style={{ padding: 40, color: '#64748b', textAlign: 'center' }}>⏳ Loading…</div>;

  const sp = data.salespeople || [];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960, margin: '0 auto', overflowY: 'auto', height: 'calc(100vh - 52px)' }}>

      {/* Top actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div style={{ fontWeight: 900, fontSize: 20, color: '#e2e8f0' }}>⚙️ Sales Board Admin</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {status && <span style={{ fontSize: 13, fontWeight: 700, color: status.startsWith('✅') ? '#4ade80' : '#f87171' }}>{status}</span>}
          <button onClick={handleSave} disabled={saving} style={{ background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', color: '#60a5fa', borderRadius: 10, padding: '10px 24px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            {saving ? '⏳ Saving…' : '💾 Save All Changes'}
          </button>
        </div>
      </div>

      {/* Board Title */}
      <div style={section}>
        <div style={sectionHead}>📋 Board Title</div>
        <div>
          <label style={fieldLabel}>Title (shown at the top of the board)</label>
          <input style={inp()} value={data.title || ''} onChange={e => update('title', e.target.value)} placeholder={`${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} Sales Performance`} />
        </div>
      </div>

      {/* Team Goals */}
      <div style={section}>
        <div style={sectionHead}>🎯 Team Goals</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
          <div><label style={fieldLabel}>Team Units Goal</label><input style={inp()} type="number" value={data.goals.units_goal || ''} onChange={e => update('goals.units_goal', +e.target.value)} /></div>
          <div><label style={fieldLabel}>Individual Unit Goal</label><input style={inp()} type="number" value={data.goals.individual_goal || ''} onChange={e => update('goals.individual_goal', +e.target.value)} /></div>
          <div><label style={fieldLabel}>Gross Profit Goal ($)</label><input style={inp()} type="number" value={data.goals.gross_goal || ''} onChange={e => update('goals.gross_goal', +e.target.value)} /></div>
          <div><label style={fieldLabel}>F&I Products Goal</label><input style={inp()} type="number" value={data.goals.fi_goal || ''} onChange={e => update('goals.fi_goal', +e.target.value)} /></div>
        </div>
      </div>

      {/* Today's Team Numbers */}
      <div style={section}>
        <div style={sectionHead}>📅 Today's Numbers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {[
            ['Units Today', 'team.units_today'],
            ['Appointments', 'team.appointments'],
            ['Pending Deliveries', 'team.pending_deliveries'],
            ['Trade-Ins', 'team.trade_ins'],
            ['Test Drives', 'team.test_drives'],
          ].map(([label, path]) => (
            <div key={path}>
              <label style={fieldLabel}>{label}</label>
              <input style={inp()} type="number" value={(data.team?.[path.split('.')[1]]) ?? ''} onChange={e => update(path, +e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* Salespeople */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...Object.fromEntries(Object.entries(sectionHead).map(([k,v]) => [k,v])) }}>
          <span>👤 Salespeople</span>
          <button onClick={addSalesperson} style={{ background: 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.35)', color: '#4ade80', borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Add</button>
        </div>

        {sp.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#334155', fontSize: 14 }}>No salespeople yet — click + Add to start.</div>
        )}

        {sp.map((person, idx) => {
          const isOpen = editIdx === idx;
          const total = (person.units_new || 0) + (person.units_used || 0);
          return (
            <div key={person.id || idx} style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
              {/* Collapsed header */}
              <div
                onClick={() => setEditIdx(isOpen ? null : idx)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>{person.name || '(No Name)'}</div>
                  {person.title && <div style={{ fontSize: 12, color: '#475569' }}>{person.title}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
                  <span style={{ color: '#60a5fa' }}>{total} units</span>
                  <span style={{ color: '#4ade80' }}>${(person.gross || 0).toLocaleString()}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded editor */}
              {isOpen && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, marginBottom: 12 }}>
                    <div><label style={fieldLabel}>Name</label><input style={inp()} value={person.name || ''} onChange={e => updateSP(idx, 'name', e.target.value)} /></div>
                    <div><label style={fieldLabel}>Title / Position</label><input style={inp()} value={person.title || ''} onChange={e => updateSP(idx, 'title', e.target.value)} placeholder="e.g. Sales Consultant" /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
                    <div><label style={fieldLabel}>New Units</label><input style={inp()} type="number" value={person.units_new || ''} onChange={e => updateSP(idx, 'units_new', +e.target.value)} /></div>
                    <div><label style={fieldLabel}>Used Units</label><input style={inp()} type="number" value={person.units_used || ''} onChange={e => updateSP(idx, 'units_used', +e.target.value)} /></div>
                    <div><label style={fieldLabel}>Gross Profit</label><input style={inp()} type="number" value={person.gross || ''} onChange={e => updateSP(idx, 'gross', +e.target.value)} /></div>
                    <div><label style={fieldLabel}>F&I Products</label><input style={inp()} type="number" value={person.fi_products || ''} onChange={e => updateSP(idx, 'fi_products', +e.target.value)} /></div>
                    <div><label style={fieldLabel}>CSI %</label><input style={inp()} type="number" value={person.csi || ''} onChange={e => updateSP(idx, 'csi', +e.target.value)} /></div>
                    <div><label style={fieldLabel}>Personal Goal</label><input style={inp()} type="number" value={person.goal || ''} onChange={e => updateSP(idx, 'goal', +e.target.value)} /></div>
                  </div>
                  <button onClick={() => removeSP(idx)} style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 7, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Remove {person.name || 'Salesperson'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Incentives */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...Object.fromEntries(Object.entries(sectionHead).map(([k,v]) => [k,v])) }}>
          <span>💵 Incentives</span>
          <button onClick={() => addListItem('extras.incentives', '')} style={{ background: 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.35)', color: '#4ade80', borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Add</button>
        </div>
        {(data.extras.incentives || []).map((inc, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={inp({ flex: 1 })} value={inc} onChange={e => updateListItem('extras.incentives', i, e.target.value)} placeholder="e.g. $500 bonus for 15 units" />
            <button onClick={() => removeListItem('extras.incentives', i)} style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 7, padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}>✕</button>
          </div>
        ))}
      </div>

      {/* Hot Models */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...Object.fromEntries(Object.entries(sectionHead).map(([k,v]) => [k,v])) }}>
          <span>🔥 Hot Models</span>
          <button onClick={() => addListItem('extras.hot_models', '')} style={{ background: 'rgba(251,146,60,.12)', border: '1px solid rgba(251,146,60,.35)', color: '#fb923c', borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Add</button>
        </div>
        {(data.extras.hot_models || []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={inp({ flex: 1 })} value={m} onChange={e => updateListItem('extras.hot_models', i, e.target.value)} placeholder="e.g. 2026 Tucson Hybrid" />
            <button onClick={() => removeListItem('extras.hot_models', i)} style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 7, padding: '5px 10px', fontSize: 13, cursor: 'pointer' }}>✕</button>
          </div>
        ))}
      </div>

      {/* Quote of the Week */}
      <div style={section}>
        <div style={sectionHead}>💬 Quote of the Week</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 12 }}>
          <div>
            <label style={fieldLabel}>Quote</label>
            <textarea style={{ ...inp(), resize: 'vertical', minHeight: 70 }} value={data.extras.quote || ''} onChange={e => update('extras.quote', e.target.value)} placeholder="Enter an inspirational quote…" />
          </div>
          <div>
            <label style={fieldLabel}>Author</label>
            <input style={inp()} value={data.extras.quote_author || ''} onChange={e => update('extras.quote_author', e.target.value)} placeholder="e.g. Zig Ziglar" />
          </div>
        </div>
      </div>

      {/* Save button at bottom */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
        {status && <span style={{ fontSize: 13, fontWeight: 700, color: status.startsWith('✅') ? '#4ade80' : '#f87171' }}>{status}</span>}
        <button onClick={handleSave} disabled={saving} style={{ background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', color: '#60a5fa', borderRadius: 10, padding: '12px 32px', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
          {saving ? '⏳ Saving…' : '💾 Save All Changes'}
        </button>
      </div>
    </div>
  );
}
