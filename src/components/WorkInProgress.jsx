/* wip */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const todayISO = () => new Date().toISOString().slice(0, 10); // yyyy-mm-dd for date inputs
const todayUS  = () => new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

const emptyRow = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: todayISO(), jobDesc: '', etaParts: '', etaCompletion: '', partsArrived: null, partsArrivedDate: '', highPriority: false, advisor: '', notes: '',
});

const inpSt = {
  background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8, color: '#f1f5f9', padding: '7px 10px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

// Strip duplicate WIP rows. Keeps the FIRST occurrence of each row id, and also
// dedupes by RO# (after id-dedupe) so the same RO can't appear twice on a tech.
function dedupeWip(rows) {
  const seenIds = new Set();
  const seenRos = new Set();
  const out = [];
  for (const r of rows || []) {
    if (r && r.id && seenIds.has(r.id)) continue;
    const ro = (r && r.ro || '').trim();
    if (ro && seenRos.has(ro)) continue;
    if (r && r.id) seenIds.add(r.id);
    if (ro) seenRos.add(ro);
    out.push(r);
  }
  return out;
}

const emptyAwaiting = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: todayISO(), jobDesc: '', highPriority: false, advisor: '', isNew: true,
});

export default function WorkInProgress({ currentUser, currentRole, techList, advisorList = [], onBack, backLabel, chatUsers, initialJob = null, onInitialJobConsumed }) {
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
  const [workCompleteConfirmId, setWorkCompleteConfirmId] = useState(null);
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
  const [claimConfirm, setClaimConfirm] = useState(null); // { aw, tech } pending confirmation
  const [advisorPickerId, setAdvisorPickerId] = useState(null);   // WIP row id
  const [awAdvisorPickerId, setAwAdvisorPickerId] = useState(null); // Awaiting row id

  const load = useCallback(async (tech) => {
    setLoading(true);
    setError('');
    // Clear rows immediately so any in-flight auto-save can't pick up the
    // OUTGOING tech's rows and write them under the INCOMING tech's name.
    setRows([]);
    try {
      const raw = await loadWipData(tech);
      const data = dedupeWip(raw);
      setRows(data);
      // If we found and removed duplicates, persist the cleaned list back so
      // every viewer stops seeing the dupes.
      if (Array.isArray(raw) && data.length !== raw.length) {
        saveWipData(tech, data).catch(() => {});
      }
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

  // Toggle Parts Arrived with auto date stamp
  function togglePartsArrived(id, value) {
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? {
        ...r,
        partsArrived: value,
        partsArrivedDate: value === true ? today : '',
      } : r);
      saveWipData(activeTech, updated).catch(e => setError(e.message));
      return updated;
    });
  }

  // Silent auto-save for single-click toggles (no loading state shown)
  function updateRowAndSave(id, field, value) {
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      saveWipData(activeTech, updated).catch(e => setError(e.message));
      return updated;
    });
  }

  function updateAwaitingAndSave(id, field, value) {
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      saveAwaitingData(updated).catch(e => setError(e.message));
      return updated;
    });
  }

  async function saveRow(id) {
    // Don't save if we're between tabs (prevents writing one tech's rows under
    // another tech's filename during a tab switch).
    if (loading) return;
    setSavingRow(id);
    setError('');
    try {
      await saveWipData(activeTech, dedupeWip(rows));
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
    setRows(prev => [emptyRow(), ...prev]);
  }

  async function handleBack() {
    setSaving(true);
    try { await saveWipData(activeTech, rows); } catch {}
    setSaving(false);
    onBack();
  }

  async function handleSearch(explicitQuery) {
    const q = (typeof explicitQuery === 'string' ? explicitQuery : searchRO).trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    setSearchResults(null);
    try {
      // Search all tech WIP lists
      const wipResults = await Promise.all(
        techList.map(async tech => {
          const data = await loadWipData(tech);
          return data
            .filter(r => (r.ro || '').toLowerCase().includes(q.toLowerCase()))
            .map(r => ({ ...r, techName: tech, _source: 'wip' }));
        })
      );
      // Also search Cars Awaiting
      const awaitingMatches = awaiting
        .filter(r => (r.ro || '').toLowerCase().includes(q.toLowerCase()))
        .map(r => ({ ...r, techName: 'Cars Awaiting', _source: 'awaiting' }));

      setSearchResults([...wipResults.flat(), ...awaitingMatches]);
    } catch (e) { setError(e.message); }
    finally { setSearching(false); }
  }

  function clearSearch() { setSearchRO(''); setSearchResults(null); setShowTechPicker(false); setCreatingForTech(null); }

  // Load awaiting on mount
  useEffect(() => {
    loadAwaitingData().then(d => { setAwaiting(d); setAwaitingLoading(false); }).catch(() => setAwaitingLoading(false));
  }, []);

  // Highlighted RO (set when user clicks "View / Edit" from Advisor Calendar)
  const [highlightRO, setHighlightRO] = useState('');
  const highlightedRowRef = useRef(null);

  // If launched targeting a specific RO, jump straight to the right tab/section
  // and highlight the row instead of going through the search results UI.
  useEffect(() => {
    if (!initialJob || !initialJob.ro) return;
    const ro = initialJob.ro;
    if (initialJob.source === 'wip' && initialJob.tech && techList.includes(initialJob.tech)) {
      setActiveTech(initialJob.tech);
      setSearchResults(null);
      setSearchRO('');
    } else if (initialJob.source === 'awaiting') {
      setSearchResults(null);
      setSearchRO('');
    } else {
      // Fallback: prefill search and run it once awaiting data is ready.
      if (awaitingLoading) return;
      setSearchRO(ro);
      handleSearch(ro);
      onInitialJobConsumed && onInitialJobConsumed();
      return;
    }
    setHighlightRO(ro);
    onInitialJobConsumed && onInitialJobConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob, awaitingLoading]);

  // Scroll the highlighted row into view once it renders.
  useEffect(() => {
    if (!highlightRO) return;
    const t = setTimeout(() => {
      if (highlightedRowRef.current) {
        highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    const clear = setTimeout(() => setHighlightRO(''), 4000);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [highlightRO, rows, awaiting]);

  function updateAwaiting(id, field, value) {
    setAwaiting(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function saveAwaiting(rows) {
    try { await saveAwaitingData(rows); } catch (e) { setError(e.message); }
  }

  async function addAwaitingRow() {
    const updated = [emptyAwaiting(), ...awaiting];
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
      // Clear isNew flag so row moves into sorted order after save
      const committed = awaiting.map(r => r.id === id ? { ...r, isNew: false } : r);
      await saveAwaitingData(committed);
      setAwaiting(committed);
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
      const newWipRow = { ...emptyRow(), ro: awaitingRow.ro, roDate: awaitingRow.roDate, jobDesc: awaitingRow.jobDesc, highPriority: !!awaitingRow.highPriority, advisor: awaitingRow.advisor || '' };
      const deduped = dedupeWip([...existing, newWipRow]);
      await saveWipData(tech, deduped);
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
      // Remove from current tech (also strip any duplicates by id or RO)
      const current = dedupeWip(rows.filter(r => r.id !== wipRow.id && (r.ro || '') !== (wipRow.ro || '')));
      await saveWipData(activeTech, current);
      setRows(current);
      // Add to new tech (drop any pre-existing copies of this row by id or RO before appending)
      const existing = await loadWipData(newTech);
      const filteredExisting = existing.filter(r => r.id !== wipRow.id && (r.ro || '') !== (wipRow.ro || ''));
      await saveWipData(newTech, dedupeWip([...filteredExisting, { ...wipRow }]));
      setReassignPickerId(null);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  async function createForTech(tech) {
    setCreatingForTech(tech);
    try {
      const existing = await loadWipData(tech);
      const ro = searchRO.trim();
      // Don't create a second row for the same RO on the same tech
      if (existing.some(r => (r.ro || '').trim() === ro)) {
        setActiveTech(tech);
        setRows(existing);
        clearSearch();
        return;
      }
      const newRow = { ...emptyRow(), ro };
      const updated = dedupeWip([...existing, newRow]);
      await saveWipData(tech, updated);
      setActiveTech(tech);
      setRows(updated);
      clearSearch();
    } catch (e) { setError(e.message); }
    finally { setCreatingForTech(null); }
  }

  // Multi-step "Add to Awaiting" wizard: step 0=idle, 1=pick advisor, 2=job desc
  const [awaitingWizardStep, setAwaitingWizardStep] = useState(0);
  const [awaitingWizardAdvisor, setAwaitingWizardAdvisor] = useState('');
  const [awaitingWizardJobDesc, setAwaitingWizardJobDesc] = useState('');
  const [creatingForAwaiting, setCreatingForAwaiting] = useState(false);

  function cancelAwaitingWizard() {
    setAwaitingWizardStep(0);
    setAwaitingWizardAdvisor('');
    setAwaitingWizardJobDesc('');
  }

  async function createForAwaiting() {
    setCreatingForAwaiting(true);
    try {
      const fresh = { ...emptyAwaiting(), ro: searchRO.trim(), advisor: awaitingWizardAdvisor, jobDesc: awaitingWizardJobDesc, isNew: false };
      const updated = [fresh, ...awaiting];
      await saveAwaitingData(updated);
      setAwaiting(updated);
      cancelAwaitingWizard();
      clearSearch();
    } catch (e) { setError(e.message); }
    finally { setCreatingForAwaiting(false); }
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
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                {/* Assign to Tech */}
                <div style={{ flex: 1, minWidth: 260, background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.25)', borderRadius: 14, padding: '16px 20px' }}>
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
                {/* Cars Awaiting Technician wizard */}
                <div style={{ flex: 1, minWidth: 260, background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.5 }}>🚗 Cars Awaiting Technician</div>
                    {awaitingWizardStep > 0 && (
                      <button onClick={cancelAwaitingWizard} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✕ Cancel</button>
                    )}
                  </div>

                  {awaitingWizardStep === 0 && (
                    <>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Not assigned to a tech yet? Add it to the waiting list.</div>
                      <button
                        onClick={() => setAwaitingWizardStep(1)}
                        style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 8, padding: '8px 22px', cursor: 'pointer', fontWeight: 900, fontSize: 13, alignSelf: 'flex-start' }}
                      >+ Add to Awaiting</button>
                    </>
                  )}

                  {awaitingWizardStep === 1 && (
                    <>
                      <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>Step 1 of 2 — Select Advisor</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {advisorList.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>No advisors found.</span>}
                        {advisorList.map(adv => (
                          <button key={adv}
                            onClick={() => { setAwaitingWizardAdvisor(adv); setAwaitingWizardStep(2); }}
                            style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                          >{adv}</button>
                        ))}
                      </div>
                    </>
                  )}

                  {awaitingWizardStep === 2 && (
                    <>
                      <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>Step 2 of 2 — Job Description</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Advisor: <strong style={{ color: '#fbbf24' }}>{awaitingWizardAdvisor}</strong></div>
                      <input
                        value={awaitingWizardJobDesc}
                        onChange={e => setAwaitingWizardJobDesc(e.target.value)}
                        placeholder="Describe the job…"
                        style={{ ...inpSt }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setAwaitingWizardStep(1)} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>← Back</button>
                        <button
                          onClick={createForAwaiting}
                          disabled={!awaitingWizardJobDesc.trim() || creatingForAwaiting}
                          style={{ background: awaitingWizardJobDesc.trim() ? 'rgba(74,222,128,.25)' : 'rgba(255,255,255,.04)', border: `1px solid ${awaitingWizardJobDesc.trim() ? 'rgba(74,222,128,.5)' : 'rgba(255,255,255,.1)'}`, color: awaitingWizardJobDesc.trim() ? '#4ade80' : '#475569', borderRadius: 8, padding: '7px 20px', cursor: awaitingWizardJobDesc.trim() ? 'pointer' : 'not-allowed', fontWeight: 900, fontSize: 13 }}
                        >{creatingForAwaiting ? '⏳ Creating…' : '✅ Create & Add to Awaiting'}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {searchResults.map((r, idx) => {
              const isAwaiting = r._source === 'awaiting';
              return (
              <div
                key={r.id + idx}
                onClick={() => { if (!isAwaiting) setActiveTech(r.techName); clearSearch(); }}
                style={{ background: isAwaiting ? 'rgba(251,191,36,.07)' : 'rgba(61,214,195,.07)', border: `1px solid ${isAwaiting ? 'rgba(251,191,36,.3)' : 'rgba(61,214,195,.25)'}`, borderRadius: 14, padding: '14px 18px', marginBottom: 10, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = isAwaiting ? 'rgba(251,191,36,.15)' : 'rgba(61,214,195,.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isAwaiting ? 'rgba(251,191,36,.07)' : 'rgba(61,214,195,.07)'; }}
              >
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isAwaiting ? '#fbbf24' : '#3dd6c3', textTransform: 'uppercase' }}>
                    {isAwaiting ? '⏳ Cars Awaiting' : `Tech: ${r.techName}`}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6ee7f9' }}>RO# {r.ro}</span>
                  {r.roDate && <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.roDate}</span>}
                  {r.highPriority && <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>🔴 HIGH PRIORITY</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{isAwaiting ? 'In Cars Awaiting' : 'Click to view →'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px 16px' }}>
                  {r.jobDesc && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Job: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.jobDesc}</span></div>}
                  {r.etaParts && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Parts: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaParts}</span></div>}
                  {r.etaCompletion && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Completion: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaCompletion}</span></div>}
                  <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Parts Arrived: </span><span style={{ fontSize: 13, color: r.partsArrived === true ? '#86efac' : r.partsArrived === false ? '#fca5a5' : '#475569' }}>{r.partsArrived === true ? '✓ Yes' : r.partsArrived === false ? '✗ No' : '—'}</span></div>
                </div>
              </div>
            );})}

          </div>
        )}

        {loading ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
        ) : searchResults !== null ? null : (
          <>
            {rows.length === 0 && (
              <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0', fontSize: 14 }}>No work in progress. Click "Add Row" to get started.</div>
            )}

            {[...rows].sort((a, b) => (b.highPriority ? 1 : 0) - (a.highPriority ? 1 : 0)).map((row, idx) => {
              const isHighlighted = highlightRO && (row.ro || '').trim() === highlightRO.trim();
              return (
              <div key={row.id} ref={isHighlighted ? highlightedRowRef : null} style={{
                background: isHighlighted ? 'rgba(96,165,250,.14)' : (row.highPriority ? 'rgba(239,68,68,.08)' : 'rgba(30,41,59,.85)'),
                border: `${isHighlighted ? 2 : 1}px solid ${isHighlighted ? 'rgba(96,165,250,.7)' : (row.highPriority ? 'rgba(239,68,68,.5)' : 'rgba(99,132,165,.25)')}`,
                boxShadow: isHighlighted ? '0 0 0 4px rgba(96,165,250,.18)' : 'none',
                borderRadius: 14, padding: '16px 20px', marginBottom: 14, transition: 'all .2s',
              }}>
                {row.highPriority && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: '#fca5a5', letterSpacing: 1 }}>🚨 HIGH PRIORITY</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ROW {idx + 1}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isManagerOrAdvisor && (
                      <button
                        onClick={() => updateRowAndSave(row.id, 'highPriority', !row.highPriority)}
                        style={{ background: row.highPriority ? 'rgba(239,68,68,.28)' : 'rgba(255,255,255,.06)', border: `1px solid ${row.highPriority ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`, color: row.highPriority ? '#fca5a5' : '#64748b', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 11, transition: 'all .15s' }}
                      >{row.highPriority ? '🚨 HIGH PRIORITY' : '⚡ High Priority'}</button>
                    )}
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
                      <ChipBtn active={row.partsArrived === true}  color="green" onClick={() => togglePartsArrived(row.id, row.partsArrived === true ? null : true)}>✓ Yes</ChipBtn>
                      <ChipBtn active={row.partsArrived === false} color="red"   onClick={() => togglePartsArrived(row.id, row.partsArrived === false ? null : false)}>✗ No</ChipBtn>
                    </div>
                    {row.partsArrived === true && row.partsArrivedDate && (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#86efac', fontWeight: 700 }}>📅 {row.partsArrivedDate}</div>
                    )}
                  </div>
                  <div>
                    <div style={labelSt}>Advisor</div>
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setAdvisorPickerId(advisorPickerId === row.id ? null : row.id)}
                        style={{ background: row.advisor ? 'rgba(139,92,246,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${row.advisor ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.15)'}`, color: row.advisor ? '#c4b5fd' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, width: '100%', textAlign: 'left' }}
                      >👤 {row.advisor || 'Select Advisor'}</button>
                      {advisorPickerId === row.id && (
                        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 10, padding: 8, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                          {row.advisor && (
                            <button onClick={() => { updateRowAndSave(row.id, 'advisor', ''); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(239,68,68,.1)', border: 'none', color: '#f87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 4 }}>✕ Clear</button>
                          )}
                          {advisorList.map(adv => (
                            <button key={adv} onClick={() => { updateRowAndSave(row.id, 'advisor', adv); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: row.advisor === adv ? 'rgba(139,92,246,.25)' : 'transparent', border: 'none', color: row.advisor === adv ? '#c4b5fd' : '#cbd5e1', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13, fontWeight: row.advisor === adv ? 800 : 400 }}>{adv}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: 14 }}>
                  <div style={labelSt}>Notes</div>
                  <textarea
                    value={row.notes || ''}
                    onChange={e => updateRow(row.id, 'notes', e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.blur();
                        saveRow(row.id);
                      }
                    }}
                    placeholder="Add notes here… (Enter to save, Shift+Enter for new line)"
                    rows={2}
                    style={{ ...inpSt, resize: 'vertical', lineHeight: 1.5 }}
                  />
                </div>

                {/* Row actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => isTech ? setWorkCompleteConfirmId(row.id) : deleteRow(row.id)}
                    disabled={deletingRow === row.id}
                    style={{ background: isTech ? 'rgba(74,222,128,.12)' : 'rgba(239,68,68,.12)', border: `1px solid ${isTech ? 'rgba(74,222,128,.4)' : 'rgba(239,68,68,.35)'}`, color: isTech ? '#4ade80' : '#f87171', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: deletingRow === row.id ? 0.5 : 1 }}
                  >{deletingRow === row.id ? '⏳' : isTech ? '✅ Work Completed' : '🗑 Delete Row'}</button>
                  <button
                    onClick={() => saveRow(row.id)}
                    disabled={savingRow === row.id}
                    style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: savingRow === row.id ? 0.5 : 1 }}
                  >{savingRow === row.id ? '⏳ Saving…' : '💾 Save Row'}</button>
                </div>
              </div>
              );
            })}

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
              ) : [...awaiting].sort((a, b) => {
                  // 1. Unsaved new rows always on top
                  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
                  // 2. High priority next
                  if (a.highPriority !== b.highPriority) return a.highPriority ? -1 : 1;
                  // 3. Newest date first
                  return new Date(b.roDate || 0) - new Date(a.roDate || 0);
                }).map(aw => {
                const isHighlighted = highlightRO && (aw.ro || '').trim() === highlightRO.trim();
                return (
                <div key={aw.id} ref={isHighlighted ? highlightedRowRef : null} style={{ background: isHighlighted ? 'rgba(96,165,250,.14)' : (aw.highPriority ? 'rgba(239,68,68,.08)' : 'rgba(251,191,36,.06)'), border: `${isHighlighted ? 2 : 1}px solid ${isHighlighted ? 'rgba(96,165,250,.7)' : (aw.highPriority ? 'rgba(239,68,68,.5)' : 'rgba(251,191,36,.22)')}`, boxShadow: isHighlighted ? '0 0 0 4px rgba(96,165,250,.18)' : 'none', borderRadius: 14, padding: '16px 20px', marginBottom: 12, transition: 'all .2s' }}>

                  {/* High priority banner */}
                  {aw.highPriority && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '6px 12px' }}>
                      <span style={{ fontSize: 16 }}>🚨</span>
                      <span style={{ fontWeight: 900, fontSize: 12, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: 1 }}>High Priority</span>
                    </div>
                  )}

                  {isTech ? (
                    /* ── TECH VIEW: read-only + Claim It only ── */
                    <>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                        <div><div style={labelSt}>Repair Order #</div><div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>{aw.ro || '—'}</div></div>
                        <div><div style={labelSt}>RO Date</div><div style={{ fontSize: 14, color: '#94a3b8' }}>{aw.roDate || '—'}</div></div>
                        <div style={{ flex: 1 }}><div style={labelSt}>Job Description</div><div style={{ fontSize: 14, color: '#e2e8f0' }}>{aw.jobDesc || '—'}</div></div>
                        {aw.advisor && <div><div style={labelSt}>Advisor</div><div style={{ fontSize: 14, color: '#c4b5fd', fontWeight: 700 }}>👤 {aw.advisor}</div></div>}
                      </div>
                      <button
                        onClick={() => setClaimConfirm({ aw, tech: currentUser })}
                        disabled={movingId === aw.id}
                        style={{ background: 'rgba(74,222,128,.25)', border: '1px solid rgba(74,222,128,.55)', color: '#4ade80', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 900, fontSize: 13 }}
                      >{movingId === aw.id ? '⏳ Moving…' : '✋ Claim It'}</button>
                    </>
                  ) : (
                    /* ── MANAGER / ADVISOR VIEW: editable + all controls ── */
                    <>
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
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          onClick={() => { updateAwaitingAndSave(aw.id, 'highPriority', !aw.highPriority); }}
                          style={{ background: aw.highPriority ? 'rgba(239,68,68,.28)' : 'rgba(255,255,255,.06)', border: `1px solid ${aw.highPriority ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`, color: aw.highPriority ? '#fca5a5' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12, transition: 'all .15s' }}
                        >{aw.highPriority ? '🚨 HIGH PRIORITY' : '⚡ High Priority'}</button>
                        {/* Advisor picker */}
                        <div style={{ position: 'relative' }}>
                          <button
                            onClick={() => setAwAdvisorPickerId(awAdvisorPickerId === aw.id ? null : aw.id)}
                            style={{ background: aw.advisor ? 'rgba(139,92,246,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${aw.advisor ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.15)'}`, color: aw.advisor ? '#c4b5fd' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                          >👤 {aw.advisor || 'Select Advisor'}</button>
                          {awAdvisorPickerId === aw.id && (
                            <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 10, padding: 8, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                              {aw.advisor && (
                                <button onClick={() => { updateAwaitingAndSave(aw.id, 'advisor', ''); setAwAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(239,68,68,.1)', border: 'none', color: '#f87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 4 }}>✕ Clear</button>
                              )}
                              {advisorList.map(adv => (
                                <button key={adv} onClick={() => { updateAwaitingAndSave(aw.id, 'advisor', adv); setAwAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: aw.advisor === adv ? 'rgba(139,92,246,.25)' : 'transparent', border: 'none', color: aw.advisor === adv ? '#c4b5fd' : '#cbd5e1', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13, fontWeight: aw.advisor === adv ? 800 : 400 }}>{adv}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => saveAwaitingRow(aw.id)}
                          disabled={awaitingSavingId === aw.id}
                          style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, opacity: awaitingSavingId === aw.id ? 0.6 : 1 }}
                        >{awaitingSavingId === aw.id ? '⏳ Saving…' : '💾 Save'}</button>
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
                        {canDeleteAwaiting && (
                          <button
                            onClick={() => deleteAwaitingRow(aw.id)}
                            style={{ marginLeft: 'auto', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#f87171', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                          >🗑 Delete</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {/* Tech Chat panel */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.06)', padding: 12, display: 'flex', flexDirection: 'column' }}>
        <TechChat currentUser={currentUser} currentRole={currentRole} hasChatAccess={hasChatAccess} />
      </div>
      </div>
      {/* Claim Confirmation Modal */}
      {claimConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#1e293b', border: '2px solid rgba(251,191,36,.4)', borderRadius: 20, padding: '36px 40px', maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: '#fbbf24', marginBottom: 10 }}>Before You Claim This Job</div>
            <div style={{ color: '#cbd5e1', fontSize: 15, marginBottom: 8 }}>
              RO <strong style={{ color: '#f1f5f9' }}>#{claimConfirm.aw.ro || '—'}</strong>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 28 }}>
              Do you have the repair order in hand?
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button
                onClick={() => { claimAwaiting(claimConfirm.aw, claimConfirm.tech); setClaimConfirm(null); }}
                style={{ background: 'rgba(74,222,128,.25)', border: '2px solid rgba(74,222,128,.6)', color: '#4ade80', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >✅ Yes, Claim It</button>
              <button
                onClick={() => setClaimConfirm(null)}
                style={{ background: 'rgba(239,68,68,.18)', border: '2px solid rgba(239,68,68,.45)', color: '#f87171', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >❌ No</button>
            </div>
          </div>
        </div>
      )}
      {/* Work Completed Confirmation Modal */}
      {workCompleteConfirmId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#1e293b', border: '2px solid rgba(74,222,128,.4)', borderRadius: 20, padding: '36px 40px', maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: '#4ade80', marginBottom: 12 }}>Work Completed?</div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 28 }}>
              Are you sure this job is finished? This will remove it from your work list.
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button
                onClick={() => { deleteRow(workCompleteConfirmId); setWorkCompleteConfirmId(null); }}
                style={{ background: 'rgba(74,222,128,.25)', border: '2px solid rgba(74,222,128,.6)', color: '#4ade80', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >✅ Yes, Done</button>
              <button
                onClick={() => setWorkCompleteConfirmId(null)}
                style={{ background: 'rgba(239,68,68,.18)', border: '2px solid rgba(239,68,68,.45)', color: '#f87171', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >❌ Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
