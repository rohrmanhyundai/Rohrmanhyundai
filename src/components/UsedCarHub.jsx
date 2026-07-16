import React, { useState, useEffect, useRef } from 'react';
import { loadAwaitingData, saveAwaitingData, loadWipData, saveWipData, appendRoArchive } from '../utils/github';
import { trackAction } from '../utils/activityTracker';
import UnassignedRow, { unassignedSort } from './UnassignedRow';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

const emptyUsedCar = () => ({
  id: newId(),
  ro: '', roDate: todayISO(), jobDesc: '', highPriority: false, advisor: '', notes: '',
  partsArrived: null, partsArrivedDate: '', isNew: true, usedCar: true,
});

const emptyWipRow = () => ({
  id: newId(),
  ro: '', roDate: todayISO(), vehicle: '', jobDesc: '', etaParts: '', etaCompletion: '',
  partsArrived: null, partsArrivedDate: '', highPriority: false, advisor: '', notes: '', flag: 'purple',
});

// The used-car team's queue.
//
// Used cars live in the SAME shared file as "Cars Awaiting Technician" on the Work
// in Progress page — a row's `usedCar` flag is the only thing that decides which of
// the two it belongs to. That keeps a car's RO, notes, parts status and advisor
// intact when it moves, and makes the move reversible from either side: the WIP
// page has "🚗 Move to Used Cars", this page has "↩ Move to Cars Awaiting".
//
// Rows render through the same <UnassignedRow> the WIP page uses, so the two can't
// drift apart.
export default function UsedCarHub({ currentUser, currentUserDisplay, currentRole, jobRole, techList = [], advisorList = [], onBack }) {
  // `jobRole` answers what someone IS (a tech gets the read-only view), `currentRole`
  // answers what they may DO — a tech with Management Access keeps the tech view of
  // his own board but still edits here. See effectiveRole() in App.jsx.
  const isTech    = (jobRole || currentRole) === 'technician';
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const canManage = isManager || currentRole === 'advisor' || currentRole === 'lead advisor';

  // The whole shared file is held here — writes must preserve the Cars Awaiting
  // rows we don't display, so we always save the full list, never just used cars.
  const [awaiting, setAwaiting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movingId, setMovingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [advisorPickerId, setAdvisorPickerId] = useState(null);
  const [techPickerId, setTechPickerId] = useState(null);

  // Rows the user is mid-edit on, so a background refresh can't clobber typing.
  const dirtyRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    loadAwaitingData()
      .then(d => { if (!cancelled) { setAwaiting(d || []); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const usedCars = awaiting.filter(r => r.usedCar);

  async function persist(rows) {
    try { await saveAwaitingData(rows); }
    catch (e) { setError(e.message); }
  }

  function updateRow(id, field, value) {
    dirtyRef.current.add(id);
    setAwaiting(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  function updateAndSave(id, field, value) {
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      persist(updated);
      return updated;
    });
  }

  function togglePartsArrived(id, value) {
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === id ? {
        ...r, partsArrived: value, partsArrivedDate: value === true ? today : '',
      } : r);
      persist(updated);
      const victim = prev.find(r => r.id === id);
      trackAction(value === true ? 'usedcar-mark-parts-arrived' : value === false ? 'usedcar-mark-parts-pending' : 'usedcar-undo-parts-arrived', `RO ${victim?.ro || '?'}`);
      return updated;
    });
  }

  async function saveRow(id) {
    setSavingId(id);
    try {
      const committed = awaiting.map(r => r.id === id ? { ...r, isNew: false } : r);
      await saveAwaitingData(committed);
      setAwaiting(committed);
      dirtyRef.current.delete(id);
    } catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }

  async function addRow() {
    const fresh = emptyUsedCar();
    dirtyRef.current.add(fresh.id);
    const updated = [fresh, ...awaiting];
    setAwaiting(updated);
    await persist(updated);
  }

  // Back to the unassigned tech pool on the WIP page. A flag flip, not a file
  // move — the row keeps everything and the WIP page's button sends it back here.
  function moveToAwaiting(row) {
    setMovingId(row.id);
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === row.id ? { ...r, usedCar: false } : r);
      saveAwaitingData(updated)
        .catch(e => setError(e.message))
        .finally(() => setMovingId(null));
      return updated;
    });
    trackAction('usedcar-move-to-cars-awaiting', `RO ${row.ro || '?'}`);
  }

  // Assign straight to a tech's WIP board, same as claiming from Cars Awaiting.
  async function claim(row, tech) {
    setMovingId(row.id);
    try {
      const existing = await loadWipData(tech);
      const wipRow = {
        ...emptyWipRow(),
        ro: row.ro, roDate: row.roDate, jobDesc: row.jobDesc,
        highPriority: !!row.highPriority, advisor: row.advisor || '', notes: row.notes || '',
        partsArrived: row.partsArrived ?? null, partsArrivedDate: row.partsArrivedDate || '',
        flag: 'green', usedCar: true, // it's a used car — file it under that tech's Used Car section
      };
      // Drop any copy of this RO already on the tech's board before appending.
      const deduped = [...existing.filter(r => (r.ro || '') !== (row.ro || '')), wipRow];
      await saveWipData(tech, deduped);
      const updated = awaiting.filter(r => r.id !== row.id);
      setAwaiting(updated);
      await saveAwaitingData(updated);
      setTechPickerId(null);
      trackAction('usedcar-assign-tech', `RO ${row.ro || '?'} → ${tech}`);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  async function deleteRow(id) {
    const victim = awaiting.find(r => r.id === id);
    if (!window.confirm(`Delete RO #${victim?.ro || '(blank)'} from Used Cars?`)) return;
    trackAction('delete-usedcar-row', `RO ${victim?.ro || '?'}`);
    const updated = awaiting.filter(r => r.id !== id);
    setAwaiting(updated);
    await persist(updated);
    dirtyRef.current.delete(id);
    if (victim) {
      try {
        await appendRoArchive({
          ...victim,
          _archiveId: newId(),
          _archivedAt: new Date().toISOString(),
          _archivedBy: (currentUser || '').toUpperCase(),
          _source: 'used-cars',
          _sourceTech: '',
        });
      } catch (archErr) { console.warn('RO archive append failed:', archErr); }
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🚗 Used Car Hub</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Dashboard</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {error && (
            <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.4)', color: '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, fontWeight: 700 }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: 1 }}>🚗 Used Cars</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Used-car repair orders — assign one to a tech, or move it back to the tech pool anytime
              </div>
            </div>
            {!isTech && (
              <button
                onClick={addRow}
                style={{ marginLeft: 'auto', background: 'rgba(52,211,153,.15)', border: '1px solid rgba(52,211,153,.35)', color: '#6ee7b7', borderRadius: 9, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
              >+ Add</button>
            )}
          </div>

          {loading ? (
            <div style={{ color: '#475569', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Loading…</div>
          ) : usedCars.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🚗</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#94a3b8', marginBottom: 8 }}>No Used Cars</div>
              <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6 }}>
                Move one here with “🚗 Move to Used Cars” on a Cars Awaiting Technician row
                in Work in Progress{!isTech && ', or click + Add'}.
              </div>
            </div>
          ) : [...usedCars].sort(unassignedSort).map(row => (
            <UnassignedRow
              key={row.id}
              aw={row}
              isTech={isTech}
              canAssign={canManage}
              canDelete={canManage}
              techList={techList}
              advisorList={advisorList}
              movingId={movingId}
              savingId={savingId}
              advisorPickerId={advisorPickerId}
              setAdvisorPickerId={setAdvisorPickerId}
              techPickerId={techPickerId}
              setTechPickerId={setTechPickerId}
              rowBg="rgba(52,211,153,.06)"
              rowBorder="rgba(52,211,153,.22)"
              onUpdate={updateRow}
              onSave={saveRow}
              onTogglePartsArrived={togglePartsArrived}
              onUpdateAndSave={updateAndSave}
              onClaim={claim}
              onDelete={deleteRow}
              onMove={moveToAwaiting}
              moveLabel="↩ Move to Cars Awaiting"
              moveTitle="Move this RO back to the unassigned tech pool"
              moveAccent="#fbbf24"
              moveBg="rgba(251,191,36,.18)"
              moveBorder="rgba(251,191,36,.45)"
            />
          ))}

        </div>
      </div>
    </div>
  );
}
