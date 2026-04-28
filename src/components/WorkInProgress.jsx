/* wip */
import React, { useState, useEffect, useCallback } from 'react';
import { loadWipData, saveWipData } from '../utils/github';

function ChipBtn({ active, color, onClick, children }) {
  const colors = {
    green: { on: 'rgba(34,197,94,.25)', border: 'rgba(34,197,94,.5)', text: '#86efac' },
    red:   { on: 'rgba(239,68,68,.25)', border: 'rgba(239,68,68,.5)', text: '#fca5a5' },
  };
  const c = colors[color];
  return (
    <button onClick={onClick} style={{
      background: active ? c.on : 'rgba(255,255,255,.05)',
      border: `1px solid ${active ? c.border : 'rgba(255,255,255,.12)'}`,
      color: active ? c.text : '#64748b',
      borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
      transition: 'all .15s',
    }}>{children}</button>
  );
}

const emptyRow = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: '', jobDesc: '', etaParts: '', etaCompletion: '', partsArrived: null,
});

const inpSt = {
  background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8, color: '#f1f5f9', padding: '7px 10px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

export default function WorkInProgress({ currentUser, currentRole, techList, onBack, backLabel }) {
  const canSeeTabs = currentRole === 'admin' || currentRole === 'advisor' || currentRole === 'warranty' || (currentRole || '').includes('manager');
  const [activeTech, setActiveTech] = useState(
    canSeeTabs ? (techList[0] || currentUser) : currentUser
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRow, setSavingRow] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (tech) => {
    setLoading(true);
    setError('');
    try {
      const data = await loadWipData(tech);
      setRows(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeTech); }, [activeTech, load]);

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function saveRow(id) {
    setSavingRow(id);
    setError('');
    try {
      await saveWipData(activeTech, rows);
    } catch (e) { setError(e.message); }
    finally { setSavingRow(null); }
  }

  async function deleteRow(id) {
    setDeletingRow(id);
    setError('');
    try {
      const updated = rows.filter(r => r.id !== id);
      await saveWipData(activeTech, updated);
      setRows(updated);
    } catch (e) { setError(e.message); }
    finally { setDeletingRow(null); }
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow()]);
  }

  async function handleBack() {
    setSaving(true);
    try { await saveWipData(activeTech, rows); } catch {}
    setSaving(false);
    onBack();
  }

  const labelSt = { fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 };
  const backText = backLabel || '← Technician Resources';

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔧 Work in Progress</div>
          <div className="adv-sub">{activeTech}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={handleBack} disabled={saving}>
          {saving ? '⏳ Saving…' : backText}
        </button>
      </div>

      {/* Tech tabs (manager/advisor/admin/warranty only) */}
      {canSeeTabs && techList.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 20px 0', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,.06)', paddingBottom: 10 }}>
          {techList.map(name => (
            <button
              key={name}
              onClick={() => setActiveTech(name)}
              style={{
                background: activeTech === name ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${activeTech === name ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)'}`,
                color: activeTech === name ? '#c4b5fd' : '#64748b',
                borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                transition: 'all .15s',
              }}
            >{name}</button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>{error}</div>}

        {loading ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
        ) : (
          <>
            {rows.length === 0 && (
              <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0', fontSize: 14 }}>No work in progress. Click "Add Row" to get started.</div>
            )}

            {rows.map((row, idx) => (
              <div key={row.id} style={{
                background: 'rgba(30,41,59,.85)', border: '1px solid rgba(99,132,165,.25)',
                borderRadius: 14, padding: '16px 20px', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ROW {idx + 1}</span>
                </div>

                {/* Fields grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px 16px', marginBottom: 14 }}>
                  <div>
                    <div style={labelSt}>Repair Order #</div>
                    <input style={inpSt} value={row.ro} onChange={e => updateRow(row.id, 'ro', e.target.value)} placeholder="RO#" />
                  </div>
                  <div>
                    <div style={labelSt}>RO Date</div>
                    <input style={inpSt} type="date" value={row.roDate} onChange={e => updateRow(row.id, 'roDate', e.target.value)} />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={labelSt}>Job Description</div>
                    <input style={inpSt} value={row.jobDesc} onChange={e => updateRow(row.id, 'jobDesc', e.target.value)} placeholder="Describe the job…" />
                  </div>
                  <div>
                    <div style={labelSt}>ETA on Parts</div>
                    <input style={inpSt} value={row.etaParts} onChange={e => updateRow(row.id, 'etaParts', e.target.value)} placeholder="e.g. May 2" />
                  </div>
                  <div>
                    <div style={labelSt}>ETA on Completion</div>
                    <input style={inpSt} value={row.etaCompletion} onChange={e => updateRow(row.id, 'etaCompletion', e.target.value)} placeholder="e.g. May 3" />
                  </div>
                  <div>
                    <div style={labelSt}>Parts Arrived</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <ChipBtn active={row.partsArrived === true}  color="green" onClick={() => updateRow(row.id, 'partsArrived', row.partsArrived === true ? null : true)}>✓ Yes</ChipBtn>
                      <ChipBtn active={row.partsArrived === false} color="red"   onClick={() => updateRow(row.id, 'partsArrived', row.partsArrived === false ? null : false)}>✗ No</ChipBtn>
                    </div>
                  </div>
                </div>

                {/* Row actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => deleteRow(row.id)}
                    disabled={deletingRow === row.id}
                    style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#f87171', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: deletingRow === row.id ? 0.5 : 1 }}
                  >{deletingRow === row.id ? '⏳' : '🗑 Delete Row'}</button>
                  <button
                    onClick={() => saveRow(row.id)}
                    disabled={savingRow === row.id}
                    style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: savingRow === row.id ? 0.5 : 1 }}
                  >{savingRow === row.id ? '⏳ Saving…' : '💾 Save Row'}</button>
                </div>
              </div>
            ))}

            <button
              onClick={addRow}
              style={{ background: 'rgba(167,139,250,.15)', border: '1px solid rgba(167,139,250,.35)', color: '#c4b5fd', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14, marginTop: 4 }}
            >+ Add Row</button>
          </>
        )}
      </div>
    </div>
  );
}
