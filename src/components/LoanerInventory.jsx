import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';
import { deleteS3ObjectByUrl } from '../utils/s3';
import { useVinDecode, vehicleText } from './LoanerMaintenance';

// ── Loaner Inventory (Service Loaner page tab) ───────────────────────────────
// The loaner fleet. Type a VIN → year / make / model fill in from the decoder →
// add stock #, miles and notes → Add to fleet. Each loaner keeps a notes box
// anyone with the page can edit (who/when last changed is shown). Removing a
// loaner from the fleet asks first. Stored in data/service-loaner/inventory.json.
// 📸 Media shows the check-in / check-out pictures and videos sent from a phone
// (🚙 Rental — LoanerMediaUpload), newest first; managers can delete a set.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const label = { fontSize: 12, fontWeight: 800, color: '#94a3b8' };
const notesStyle = { ...inputStyle, fontWeight: 600, fontSize: 14, lineHeight: 1.45, resize: 'vertical' };

const EMPTY = () => ({ vin: '', stockNo: '', year: '', make: '', model: '', mileage: '', notes: '' });
const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export default function LoanerInventory({ currentUser, io, onMaintenance, isManager }) {
  const { loadLoanerInventory, updateLoanerInventory, loadLoanerMedia, updateLoanerMedia } = io || github;
  const deleteByUrl = io?.deleteS3ObjectByUrl || deleteS3ObjectByUrl;
  const [media, setMedia] = useState([]);           // check-in / out sessions
  const [mediaFor, setMediaFor] = useState(null);   // loaner whose 📸 Media is open
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(EMPTY);
  const [q, setQ] = useState('');
  const [noteEdit, setNoteEdit] = useState(null);   // { id, text } while a loaner's notes are open

  useEffect(() => {
    let alive = true;
    loadLoanerInventory().then(d => { if (alive) { setItems(d.vehicles || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    loadLoanerMedia().then(d => { if (alive) setMedia(d.sessions || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: k === 'vin' ? e.target.value.toUpperCase() : e.target.value }));
  const vin = draft.vin.replace(/\s+/g, '');
  const dec = useVinDecode(vin);
  // A full VIN fills year / make / model from the decoder.
  useEffect(() => {
    const r = dec.res;
    if (!r || r.vin !== vin) return;
    setDraft(d => ({ ...d, year: r.year || d.year, make: r.make || d.make, model: r.model || d.model }));
  }, [dec.res]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupe = vin && items.find(v => v.vin === vin);
  const canAdd = vin.length === 17 && !dupe && !busy;

  async function add() {
    if (!canAdd) return;
    setBusy(true); setStatus('Saving…');
    try {
      const rec = {
        id: `li-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        vin, stockNo: draft.stockNo.trim(), year: draft.year.trim(), make: draft.make.trim().toUpperCase(), model: draft.model.trim().toUpperCase(),
        mileage: draft.mileage.replace(/[^\d]/g, ''), notes: draft.notes.trim(),
        addedAt: new Date().toISOString(), addedBy: currentUser,
      };
      const next = await updateLoanerInventory(cur => {
        if (cur.vehicles.some(v => v.vin === vin)) throw new Error(`${vin} is already in the fleet.`);
        return { ...cur, vehicles: [...cur.vehicles, rec] };
      }, `add ${rec.stockNo || vin}`);
      setItems(next.vehicles);
      setDraft(EMPTY());
      setStatus(`✓ ${rec.stockNo ? `Stock #${rec.stockNo}` : vin} added to the fleet.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function saveNotes() {
    if (!noteEdit || busy) return;
    setBusy(true); setStatus('Saving…');
    try {
      const text = noteEdit.text.trim();
      const next = await updateLoanerInventory(cur => ({
        ...cur,
        vehicles: cur.vehicles.map(v => v.id === noteEdit.id ? { ...v, notes: text, notesAt: new Date().toISOString(), notesBy: currentUser } : v),
      }), 'notes');
      setItems(next.vehicles);
      setNoteEdit(null);
      setStatus('✓ Notes saved.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function remove(v) {
    if (busy || !window.confirm(`Take ${v.stockNo ? `stock #${v.stockNo}` : v.vin} (${vehicleText(v) || 'loaner'}) out of the fleet?`)) return;
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateLoanerInventory(cur => ({ ...cur, vehicles: cur.vehicles.filter(x => x.id !== v.id) }), `remove ${v.stockNo || v.vin}`);
      setItems(next.vehicles);
      setStatus('✓ Removed from the fleet.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  const sessionsOf = (v) => media.filter(m => m.vehicleId === v.id || (!m.vehicleId && m.stockNo && m.stockNo === v.stockNo))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  async function removeSession(m) {
    if (!isManager || busy || !window.confirm(`Delete this ${m.kind === 'in' ? 'check-in' : 'check-out'} set (${(m.files || []).length} file${(m.files || []).length === 1 ? '' : 's'})? This can't be undone.`)) return;
    setBusy(true);
    try {
      const next = await updateLoanerMedia(cur => ({ ...cur, sessions: cur.sessions.filter(x => x.id !== m.id) }), `delete ${m.stockNo}`);
      setMedia(next.sessions);
      for (const f of m.files || []) { try { await deleteByUrl(f.url); } catch {} }
    } catch (e) { window.alert(e.message || 'Delete failed.'); }
    setBusy(false);
  }

  const list = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (v) => !terms.length || terms.every(t => [v.stockNo, v.vin, v.year, v.make, v.model, v.notes].join(' ').toLowerCase().includes(t));
    return items.filter(hit).sort((a, b) => String(a.stockNo || a.vin).localeCompare(String(b.stockNo || b.vin), undefined, { numeric: true }));
  }, [items, q]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>➕ Add a loaner to the fleet</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span style={label}>VIN
              {vin && vin.length !== 17 && <span style={{ color: '#fde68a', marginLeft: 8 }}>{vin.length} characters — should be 17</span>}
              {dec.decoding && <span style={{ color: '#93c5fd', marginLeft: 8 }}>Decoding…</span>}
              {dec.res && (dec.res.ok
                ? <span style={{ color: '#86efac', marginLeft: 8 }}>✓ {vehicleText(dec.res)}</span>
                : <span style={{ color: '#fde68a', marginLeft: 8 }}>Couldn't decode the model — type it in</span>)}
              {dupe && <span style={{ color: '#fca5a5', marginLeft: 8 }}>Already in the fleet{dupe.stockNo ? ` (stock #${dupe.stockNo})` : ''}</span>}
            </span>
            <input autoFocus value={draft.vin} onChange={set('vin')} disabled={busy} maxLength={20} placeholder="Type the VIN — year, make and model fill in" style={{ ...inputStyle, letterSpacing: '.06em' }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Stock #</span><input value={draft.stockNo} onChange={set('stockNo')} disabled={busy} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Current miles</span><input value={draft.mileage} onChange={set('mileage')} disabled={busy} inputMode="numeric" style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Year</span><input value={draft.year} onChange={set('year')} disabled={busy} inputMode="numeric" maxLength={4} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Make</span><input value={draft.make} onChange={set('make')} disabled={busy} placeholder="Hyundai" style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Model</span><input value={draft.model} onChange={set('model')} disabled={busy} placeholder="Kona, Tucson…" style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span style={label}>Notes</span>
            <textarea value={draft.notes} onChange={set('notes')} disabled={busy} rows={3} placeholder="Color, plate, damage, key tag, anything to remember…" style={notesStyle} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button disabled={!canAdd} onClick={add} style={{ ...btn('74,222,128'), fontSize: 14.5, padding: '10px 20px', opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
            {busy ? '⏳ Saving…' : '🚙 Add to fleet'}
          </button>
          {status && <span style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', flex: 1 }}>🚙 Loaner fleet ({items.length})</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search stock #, VIN, model, notes…" style={{ ...inputStyle, maxWidth: 360, flex: '1 1 220px' }} />
        </div>
        {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
          : list.length === 0 ? <div style={{ color: '#94a3b8' }}>{q.trim() ? `No loaner matches “${q}”.` : 'No loaners in the fleet yet — add one above.'}</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(max(300px, calc((100% - 32px) / 3)), 1fr))', gap: 16 }}>
              {list.map(v => {
                const editing = noteEdit && noteEdit.id === v.id;
                return (
                  <div key={v.id} style={{ background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.2)', borderRadius: 14, padding: '20px 22px', display: 'grid', gap: 10, alignContent: 'start' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontWeight: 900, fontSize: 22, color: '#f1f5f9', flex: 1 }}>{v.stockNo ? `Stock #${v.stockNo}` : <span style={{ color: '#64748b' }}>no stock #</span>}</div>
                      {v.mileage && <div style={{ fontSize: 15, color: '#94a3b8', fontWeight: 700 }}>{Number(v.mileage).toLocaleString()} mi</div>}
                    </div>
                    <div style={{ fontSize: 17, color: '#cbd5e1', fontWeight: 800 }}>{vehicleText(v) || '—'}</div>
                    <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14.5, color: '#94a3b8' }}>{v.vin}</div>
                    {editing ? (
                      <>
                        <textarea autoFocus onFocus={e => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }} value={noteEdit.text} onChange={e => setNoteEdit(n => ({ ...n, text: e.target.value }))} disabled={busy} rows={4} placeholder="Notes for this loaner…" style={notesStyle} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button disabled={busy} style={{ ...btn('74,222,128'), fontSize: 14.5, padding: '9px 16px' }} onClick={saveNotes}>💾 Save notes</button>
                          <button disabled={busy} style={{ ...btn('148,163,184', false), fontSize: 14.5, padding: '9px 16px' }} onClick={() => setNoteEdit(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 15.5, color: v.notes ? '#e2e8f0' : '#64748b', whiteSpace: 'pre-wrap', lineHeight: 1.5, background: 'rgba(255,255,255,.03)', borderRadius: 10, padding: '10px 12px', minHeight: 48 }}>
                        {v.notes || 'No notes yet.'}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: '#64748b' }}>
                      Added by {v.addedBy} · {fmtWhen(v.addedAt)}
                      {v.notesAt && <><br />Notes by {v.notesBy} · {fmtWhen(v.notesAt)}</>}
                    </div>
                    {!editing && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                        <button disabled={busy} style={{ ...btn('110,231,249'), fontSize: 14.5, padding: '9px 16px' }} onClick={() => setNoteEdit({ id: v.id, text: v.notes || '' })}>📝 {v.notes ? 'Edit notes' : 'Add notes'}</button>
                        <button disabled={busy} title="Check-in / check-out pictures and videos" style={{ ...btn('192,132,252'), fontSize: 14.5, padding: '9px 16px' }} onClick={() => setMediaFor(v)}>📸 Media ({sessionsOf(v).length})</button>
                        {onMaintenance && <button disabled={busy} title="New maintenance request for this loaner" style={{ ...btn('251,146,60'), fontSize: 14.5, padding: '9px 16px' }} onClick={() => onMaintenance(v)}>🔧 Maintenance</button>}
                        <div style={{ flex: 1 }} />
                        <button disabled={busy} title="Take out of the fleet" style={{ ...btn('248,113,113'), fontSize: 14.5, padding: '9px 16px' }} onClick={() => remove(v)}>🗑 Remove</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {mediaFor && (() => {
        const sessions = sessionsOf(mediaFor);
        return (
          <div onClick={() => setMediaFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ ...card, background: '#0f172a', width: '100%', maxWidth: 1100, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#f1f5f9' }}>📸 {mediaFor.stockNo ? `Stock #${mediaFor.stockNo}` : mediaFor.vin}</div>
                  <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 700 }}>{vehicleText(mediaFor)} · check-in / check-out media</div>
                </div>
                <button style={btn('148,163,184', false)} onClick={() => setMediaFor(null)}>✕</button>
              </div>
              {sessions.length === 0 ? (
                <div style={{ color: '#94a3b8', marginTop: 16, fontSize: 14.5, lineHeight: 1.5 }}>
                  Nothing yet. On a phone, open <b>🚙 Rental</b>, enter stock #{mediaFor.stockNo || '…'}, pick Checking In or Checking Out and take the pictures / videos.
                </div>
              ) : sessions.map(m => (
                <div key={m.id} style={{ marginTop: 16, borderTop: '1px solid rgba(148,163,184,.18)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 900, color: m.kind === 'in' ? '#052e16' : '#422006', background: m.kind === 'in' ? '#4ade80' : '#fde68a' }}>
                      {m.kind === 'in' ? '🅿️ CHECK IN' : '🔑 CHECK OUT'}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>{fmtWhen(m.at)}</span>
                    {(m.customerFirst || m.customerLast) && <span style={{ fontSize: 14, fontWeight: 800, color: '#bfdbfe' }}>👤 {[m.customerFirst, m.customerLast].filter(Boolean).join(' ')}</span>}
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>by {m.by} · {(m.files || []).length} file{(m.files || []).length === 1 ? '' : 's'}</span>
                    <div style={{ flex: 1 }} />
                    {isManager && <button disabled={busy} style={btn('248,113,113')} onClick={() => removeSession(m)}>🗑 Delete</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                    {(m.files || []).map((f, i) => (
                      f.kind === 'video'
                        ? <video key={i} src={f.url} controls playsInline preload="metadata" style={{ width: 300, maxWidth: '100%', height: 200, background: '#000', borderRadius: 10, border: '1px solid rgba(148,163,184,.3)' }} />
                        : <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" title={f.name}>
                            <img src={f.url} alt={f.name} style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 10, border: '1px solid rgba(148,163,184,.3)' }} />
                          </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
