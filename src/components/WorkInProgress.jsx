/* wip */
import React, { useState, useEffect, useCallback } from 'react';
import { loadWipData, saveWipData, loadAwaitingData, saveAwaitingData } from '../utils/github';
import TechChat from './TechChat';

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

const emptyAwaiting = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: '', jobDesc: '', highPriority: false,
});

export default function WorkInProgress({ currentUser, currentRole, techList, onBack, backLabel, chatUsers }) {
  const canSeeTabs = currentRole === 'admin' || currentRole === 'advisor' || currentRole === 'warranty' || currentRole === 'parts' || (currentRole || '').includes('manager');
  const isManager        = currentRole === 'admin' || (currentRole || '').includes('manager');
  const isTech           = currentRole === 'technician';
  const isManagerOrAdvisor = isManager || currentRole === 'advisor';
  const canDeleteAwaiting  = isManagerOrAdvisor;
  const canAssignAwaiting  = isManagerOrAdvisor;
  const [activeTech, setActiveTech] = useState(
    canSeeTabs ? (techList[0] || currentUser) : currentUser
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRow, setSavingRow] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);
  const [error, setError] = useState('');
  const [searchRO, setSearchRO] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [showTechPicker, setShowTechPicker] = useState(false);
  const [creatingForTech, setCreatingForTech] = useState(null);

  // Cars Awaiting Technician
  const [awaiting, setAwaiting] = useState([]);
  const [awaitingLoading, setAwaitingLoading] = useState(true);
  const [awaitingPickerId, setAwaitingPickerId] = useState(null); // id of row showing assign picker
  const [reassignPickerId, setReassignPickerId] = useState(null); // id of WIP row showing reassign picker
  const [movingId, setMovingId] = useState(null);
  const [awaitingSavingId, setAwaitingSavingId] = useState(null);

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

  async function handleSearch() {
    const q = searchRO.trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    setSearchResults(null);
    try {
      const all = await Promise.all(
        techList.map(async tech => {
          const data = await loadWipData(tech);
          const matches = data.filter(r => (r.ro || '').toLowerCase().includes(q.toLowerCase()));
          return matches.map(r => ({ ...r, techName: tech }));
        })
      );
      setSearchResults(all.flat());
    } catch (e) { setError(e.message); }
    finally { setSearching(false); }
  }

  function clearSearch() { setSearchRO(''); setSearchResults(null); setShowTechPicker(false); setCreatingForTech(null); }

  // Load awaiting on mount
  useEffect(() => {
    loadAwaitingData().then(d => { setAwaiting(d); setAwaitingLoading(false); }).catch(() => setAwaitingLoading(false));
  }, []);

  function updateAwaiting(id, field, value) {
    setAwaiting(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function saveAwaiting(rows) {
    try { await saveAwaitingData(rows); } catch (e) { setError(e.message); }
  }

  async function addAwaitingRow() {
    const updated = [...awaiting, emptyAwaiting()];
    setAwaiting(updated);
    await saveAwaiting(updated);
  }

  async function deleteAwaitingRow(id) {
    const updated = awaiting.filter(r => r.id !== id);
    setAwaiting(updated);
    await saveAwaiting(updated);
  }

  async function saveAwaitingRow(id) {
    setAwaitingSavingId(id);
    try {
      await saveAwaitingData(awaiting);
    } catch (e) {
      setError(e.message);
    } finally {
      setAwaitingSavingId(null);
    }
  }

  // Move from awaiting → tech's WIP
  async function claimAwaiting(awaitingRow, tech) {
    setMovingId(awaitingRow.id);
    try {
      const existing = await loadWipData(tech);
      const newWipRow = { ...emptyRow(), ro: awaitingRow.ro, roDate: awaitingRow.roDate, jobDesc: awaitingRow.jobDesc };
      await saveWipData(tech, [...existing, newWipRow]);
      const updatedAwaiting = awaiting.filter(r => r.id !== awaitingRow.id);
      setAwaiting(updatedAwaiting);
      await saveAwaitingData(updatedAwaiting);
      setActiveTech(tech);
      const data = await loadWipData(tech);
      setRows(data);
      setAwaitingPickerId(null);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  // Reassign existing WIP row to different tech (managers only)
  async function reassignRow(wipRow, newTech) {
    setMovingId(wipRow.id);
    try {
      // Remove from current tech
      const current = rows.filter(r => r.id !== wipRow.id);
      await saveWipData(activeTech, current);
      setRows(current);
      // Add to new tech
      const existing = await loadWipData(newTech);
      await saveWipData(newTech, [...existing, { ...wipRow }]);
      setReassignPickerId(null);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  async function createForTech(tech) {
    setCreatingForTech(tech);
    try {
      const existing = await loadWipData(tech);
      const newRow = { ...emptyRow(), ro: searchRO.trim() };
      const updated = [...existing, newRow];
      await saveWipData(tech, updated);
      setActiveTech(tech);
      setRows(updated);
      clearSearch();
    } catch (e) { setError(e.message); }
    finally { setCreatingForTech(null); }
  }

  const labelSt = { fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 };
  const backText = backLabel || '← Technician Resources';

  const hasChatAccess = chatUsers && chatUsers.map(u => u.toUpperCase()).includes(currentUser.toUpperCase());

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

      {/* Tech tabs + RO search (manager/advisor/admin/warranty only) */}
      {canSeeTabs && techList.length > 0 && (
        <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          {/* Tabs row */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 20px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
            {techList.map(name => (
              <button
                key={name}
                onClick={() => { setActiveTech(name); clearSearch(); }}
                style={{
                  background: activeTech === name && !searchResults ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${activeTech === name && !searchResults ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: activeTech === name && !searchResults ? '#c4b5fd' : '#64748b',
                  borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  transition: 'all .15s',
                }}
              >{name}</button>
            ))}
            {/* RO Search */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={searchRO}
                onChange={e => setSearchRO(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search RO#…"
                style={{
                  background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)',
                  borderRadius: 8, color: '#f1f5f9', padding: '6px 12px', fontSize: 13,
                  outline: 'none', fontFamily: 'inherit', width: 160,
                }}
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              >{searching ? '⏳' : '🔍 Search'}</button>
              {searchResults !== null && (
                <button onClick={clearSearch} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>✕ Clear</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content + Chat */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>{error}</div>}

        {/* Search results panel */}
        {searchResults !== null && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
              {searchResults.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ color: '#94a3b8' }}>No results found for RO# &ldquo;{searchRO}&rdquo;</span>
                  {!showTechPicker && (
                    <button
                      onClick={() => setShowTechPicker(true)}
                      style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                    >+ Create</button>
                  )}
                </div>
              ) : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for RO# "${searchRO}"`}
            </div>
            {showTechPicker && searchResults.length === 0 && (
              <div style={{ background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.25)', borderRadius: 14, padding: '16px 20px', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Select Technician</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {techList.map(tech => (
                    <button
                      key={tech}
                      onClick={() => createForTech(tech)}
                      disabled={!!creatingForTech}
                      style={{ background: creatingForTech === tech ? 'rgba(74,222,128,.35)' : 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, transition: 'all .15s' }}
                    >{creatingForTech === tech ? '⏳ Adding…' : tech}</button>
                  ))}
                </div>
              </div>
            )}
            {searchResults.map((r, idx) => (
              <div
                key={r.id + idx}
                onClick={() => { setActiveTech(r.techName); clearSearch(); }}
                style={{ background: 'rgba(61,214,195,.07)', border: '1px solid rgba(61,214,195,.25)', borderRadius: 14, padding: '14px 18px', marginBottom: 10, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(61,214,195,.15)'; e.currentTarget.style.borderColor = 'rgba(61,214,195,.5)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(61,214,195,.07)'; e.currentTarget.style.borderColor = 'rgba(61,214,195,.25)'; }}
              >
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase' }}>Tech: {r.techName}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6ee7f9' }}>RO# {r.ro}</span>
                  {r.roDate && <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.roDate}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>Click to view →</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px 16px' }}>
                  {r.jobDesc && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Job: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.jobDesc}</span></div>}
                  {r.etaParts && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Parts: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaParts}</span></div>}
                  {r.etaCompletion && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Completion: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaCompletion}</span></div>}
                  <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Parts Arrived: </span><span style={{ fontSize: 13, color: r.partsArrived === true ? '#86efac' : r.partsArrived === false ? '#fca5a5' : '#475569' }}>{r.partsArrived === true ? '✓ Yes' : r.partsArrived === false ? '✗ No' : '—'}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
        ) : searchResults !== null ? null : (
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
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isManager && (
                      <>
                        <button
                          onClick={() => setReassignPickerId(reassignPickerId === row.id ? null : row.id)}
                          style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.35)', color: '#fbbf24', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}
                        >🔀 Assign Different Tech</button>
                        {reassignPickerId === row.id && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {techList.filter(t => t !== activeTech).map(tech => (
                              <button key={tech}
                                onClick={() => reassignRow(row, tech)}
                                disabled={movingId === row.id}
                                style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.45)', color: '#fbbf24', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                              >{movingId === row.id ? '⏳' : tech}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
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

            {/* ── Cars Awaiting Technician ── */}
            <div style={{ marginTop: 36, paddingTop: 24, borderTop: '2px solid rgba(251,191,36,.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1 }}>🚗 Cars Awaiting Technician</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Unassigned repair orders — claim or assign to a tech</div>
                </div>
                {!isTech && (
                  <button
                    onClick={addAwaitingRow}
                    style={{ marginLeft: 'auto', background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.35)', color: '#fbbf24', borderRadius: 9, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                  >+ Add</button>
                )}
              </div>

              {awaitingLoading ? (
                <div style={{ color: '#475569', fontSize: 13, padding: '16px 0' }}>Loading…</div>
              ) : awaiting.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No cars awaiting — click + Add to create one.</div>
              ) : awaiting.map(aw => (
                <div key={aw.id} style={{ background: aw.highPriority ? 'rgba(239,68,68,.08)' : 'rgba(251,191,36,.06)', border: `1px solid ${aw.highPriority ? 'rgba(239,68,68,.5)' : 'rgba(251,191,36,.22)'}`, borderRadius: 14, padding: '16px 20px', marginBottom: 12, transition: 'all .2s' }}>
                  {aw.highPriority && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '6px 12px' }}>
                      <span style={{ fontSize: 16 }}>🚨</span>
                      <span style={{ fontWeight: 900, fontSize: 12, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: 1 }}>High Priority</span>
                    </div>
                  )}
                  {/* Fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px 16px', marginBottom: 14 }}>
                    <div>
                      <div style={labelSt}>Repair Order #</div>
                      <input style={inpSt} value={aw.ro} onChange={e => updateAwaiting(aw.id, 'ro', e.target.value)} placeholder="RO#" />
                    </div>
                    <div>
                      <div style={labelSt}>RO Date</div>
                      <input style={inpSt} type="date" value={aw.roDate} onChange={e => updateAwaiting(aw.id, 'roDate', e.target.value)} />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <div style={labelSt}>Job Description</div>
                      <input style={inpSt} value={aw.jobDesc} onChange={e => updateAwaiting(aw.id, 'jobDesc', e.target.value)} placeholder="Describe the job…" />
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => { updateAwaiting(aw.id, 'highPriority', !aw.highPriority); }}
                      style={{ background: aw.highPriority ? 'rgba(239,68,68,.28)' : 'rgba(255,255,255,.06)', border: `1px solid ${aw.highPriority ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`, color: aw.highPriority ? '#fca5a5' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12, transition: 'all .15s' }}
                    >{aw.highPriority ? '🚨 HIGH PRIORITY' : '⚡ High Priority'}</button>
                    <button
                      onClick={() => saveAwaitingRow(aw.id)}
                      disabled={awaitingSavingId === aw.id}
                      style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, opacity: awaitingSavingId === aw.id ? 0.6 : 1 }}
                    >{awaitingSavingId === aw.id ? '⏳ Saving…' : '💾 Save'}</button>

                    {/* Claim It — techs only (claims for themselves) */}
                    {isTech && (
                      <button
                        onClick={() => claimAwaiting(aw, currentUser)}
                        disabled={movingId === aw.id}
                        style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                      >{movingId === aw.id ? '⏳ Moving…' : '✋ Claim It'}</button>
                    )}

                    {/* Assign Tech — non-techs only */}
                    {canAssignAwaiting && (
                      <>
                        <button
                          onClick={() => setAwaitingPickerId(awaitingPickerId === aw.id ? null : aw.id)}
                          style={{ background: 'rgba(167,139,250,.2)', border: '1px solid rgba(167,139,250,.45)', color: '#c4b5fd', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                        >👤 Assign Tech</button>
                        {awaitingPickerId === aw.id && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>→</span>
                            {techList.map(tech => (
                              <button key={tech}
                                onClick={() => claimAwaiting(aw, tech)}
                                disabled={movingId === aw.id}
                                style={{ background: 'rgba(167,139,250,.2)', border: '1px solid rgba(167,139,250,.4)', color: '#c4b5fd', borderRadius: 7, padding: '5px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                              >{movingId === aw.id ? '⏳' : tech}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Delete — managers, advisors, warranty only */}
                    {canDeleteAwaiting && (
                      <button
                        onClick={() => deleteAwaitingRow(aw.id)}
                        style={{ marginLeft: 'auto', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#f87171', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                      >🗑 Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {/* Tech Chat panel */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.06)', padding: 12, display: 'flex', flexDirection: 'column' }}>
        <TechChat currentUser={currentUser} currentRole={currentRole} hasChatAccess={hasChatAccess} />
      </div>
      </div>
    </div>
  );
}
