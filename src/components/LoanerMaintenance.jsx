import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { uploadLoanerMaintenancePhotoToS3, deleteS3ObjectByUrl } from '../utils/s3';
import { decodeVin, validateVin } from '../utils/vinLookup';

// ── Loaner Maintenance (Service Loaner page tab) ─────────────────────────────
// Anyone can put in a request for a loaner that needs maintenance or service:
// stock #, VIN, year/model, miles, Urgent (out of service) or Routine, what it
// needs (checkboxes + description) and phone photos. Open requests list urgent
// first, then oldest. Anyone can mark one Done (optional note) or reopen it;
// managers/admin can delete. Stored in data/service-loaner/maintenance.json,
// photos in S3 under warranty-media/loaner-maintenance/.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const th = { textAlign: 'left', padding: '9px 10px', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid rgba(148,163,184,.25)', whiteSpace: 'nowrap' };
// App.css clips every td (fixed layout + ellipsis); this table sizes to content.
const td = { padding: '10px 10px', fontSize: 14, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.1)', verticalAlign: 'top', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' };
const label = { fontSize: 12, fontWeight: 800, color: '#94a3b8' };

export const SERVICES = ['Oil change', 'Tires', 'Brakes', 'Detail / clean', 'Damage / body', 'Warning light', 'Recall', 'Other'];
const EMPTY = () => ({ loanerNo: '', vin: '', year: '', make: '', model: '', mileage: '', priority: 'routine', services: [], description: '' });
const MAX_PHOTOS = 6;

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};
const daysOpen = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
// VIN → { year, make, model } via NHTSA (utils/vinLookup). One lookup per VIN
// per visit; null while it's out, { ok:false } when it can't be decoded.
const vinCache = {};
export function useVinDecode(raw) {
  const v = validateVin(String(raw || '').replace(/\s+/g, ''));
  const vin = v.ok ? v.vin : '';
  const [res, setRes] = useState(vin ? vinCache[vin] || null : null);
  useEffect(() => {
    if (!vin) { setRes(null); return; }
    if (vinCache[vin]) { setRes(vinCache[vin]); return; }
    let alive = true;
    setRes(null);
    decodeVin(vin).then(r => {
      const out = r.ok
        ? { ok: true, vin, year: String(r.year || ''), make: (r.make || '').toUpperCase(), model: [r.model, r.trim].filter(Boolean).join(' ').toUpperCase() }
        : { ok: false, vin, year: r.year ? String(r.year) : '', make: '', model: '', error: r.error };
      vinCache[vin] = out;
      if (alive) setRes(out);
    });
    return () => { alive = false; };
  }, [vin]);
  return { vin, decoding: !!vin && !res, res };
}
export const vehicleText = (r) => [r.year, r.make, r.model].filter(Boolean).join(' ');

const isImage = (p) => /^image\//.test(p.type || '') || /\.(jpe?g|png|gif|webp|heic)$/i.test(p.url || '');

export default function LoanerMaintenance({ currentUser, isManager, io, prefill }) {
  const { loadLoanerMaintenance, updateLoanerMaintenance } = io || github;
  const loadFleet = (io || github).loadLoanerInventory;
  const [fleet, setFleet] = useState([]);          // Loaner Inventory — fills stock # ⇄ VIN in the form
  useEffect(() => { loadFleet().then(d => setFleet(d.vehicles || [])).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const uploadPhoto = io?.uploadLoanerMaintenancePhotoToS3 || uploadLoanerMaintenancePhotoToS3;
  const deleteByUrl = io?.deleteS3ObjectByUrl || deleteS3ObjectByUrl;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // `prefill` (from Loaner Inventory's 🔧 button) opens the form on that loaner.
  const [formOpen, setFormOpen] = useState(!!prefill);
  const [draft, setDraft] = useState(() => prefill ? { ...EMPTY(), ...prefill } : EMPTY());
  const [files, setFiles] = useState([]);           // [{ file, url (preview) }]
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadLoanerMaintenance().then(d => { if (alive) { setItems(d.requests || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => () => files.forEach(f => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: k === 'vin' ? e.target.value.toUpperCase() : e.target.value }));
  const toggleService = (s) => setDraft(d => ({ ...d, services: d.services.includes(s) ? d.services.filter(x => x !== s) : [...d.services, s] }));
  const vin = draft.vin.replace(/\s+/g, '');
  const formVin = useVinDecode(formOpen ? vin : '');
  const searchVin = useVinDecode(q);
  // A full VIN in the form fills year / make / model from the decoder.
  useEffect(() => {
    const r = formVin.res;
    if (!r || r.vin !== vin) return;
    if (fleet.some(v => v.vin === vin)) return;   // a fleet loaner: Loaner Inventory's details win (below)
    setDraft(d => ({ ...d, year: r.year || d.year, make: r.make || d.make, model: r.model || d.model }));
  }, [formVin.res]); // eslint-disable-line react-hooks/exhaustive-deps
  // The loaner from Loaner Inventory: a full VIN fills its stock #, and a stock
  // # (or unit #) fills its VIN — plus miles and the fleet's model, when blank.
  const normS = (x) => String(x || '').trim().toUpperCase().replace(/^#/, '');
  const fleetHit = !formOpen ? null
    : (vin.length === 17 && fleet.find(v => v.vin === vin))
      || (draft.loanerNo.trim() && fleet.find(v => normS(v.stockNo) === normS(draft.loanerNo) || normS(v.unitNo) === normS(draft.loanerNo)))
      || null;
  useEffect(() => {
    const v = fleetHit;
    if (!v) return;
    setDraft(d => ({
      ...d,
      loanerNo: d.loanerNo.trim() ? d.loanerNo : (v.stockNo || ''),
      vin: d.vin.replace(/\s+/g, '') ? d.vin : (v.vin || ''),
      year: v.year || d.year, make: v.make || d.make, model: v.model || d.model,
      mileage: d.mileage || v.mileage || '',
    }));
  }, [fleetHit && fleetHit.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = [
    !draft.loanerNo.trim() && !vin && 'stock # or VIN',
    !draft.services.length && !draft.description.trim() && 'what it needs',
  ].filter(Boolean);

  function addFiles(list) {
    const all = Array.from(list || []);           // copy first — clearing the input empties the live FileList
    if (fileRef.current) fileRef.current.value = '';
    const picked = all.filter(f => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|heic|webp|mov|mp4)$/i.test(f.name));
    setFiles(cur => [...cur, ...picked.map(file => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
  }
  function dropFile(i) {
    setFiles(cur => { URL.revokeObjectURL(cur[i].url); return cur.filter((_, j) => j !== i); });
  }
  function closeForm() {
    files.forEach(f => URL.revokeObjectURL(f.url));
    setFiles([]); setDraft(EMPTY()); setFormOpen(false);
  }

  async function submit() {
    if (missing.length || busy) return;
    setBusy(true); setStatus(files.length ? `Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…` : 'Saving…');
    try {
      const photos = [];
      for (const f of files) photos.push({ url: await uploadPhoto(f.file), name: f.file.name || 'photo', type: f.file.type || '' });
      const rec = {
        id: `lm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        loanerNo: draft.loanerNo.trim(), vin, year: draft.year.trim(), make: draft.make.trim().toUpperCase(), model: draft.model.trim().toUpperCase(),
        mileage: draft.mileage.replace(/[^\d]/g, ''), priority: draft.priority,
        services: draft.services, description: draft.description.trim(), photos,
        status: 'open', requestedAt: new Date().toISOString(), requestedBy: currentUser,
      };
      setStatus('Saving…');
      const next = await updateLoanerMaintenance(cur => ({ ...cur, requests: [...cur.requests, rec] }), `request ${rec.loanerNo || rec.vin}`);
      setItems(next.requests);
      closeForm();
      setStatus(`✓ Maintenance request saved for loaner ${rec.loanerNo || rec.vin}.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function change(r, mutateOne, what, okMsg) {
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateLoanerMaintenance(cur => ({ ...cur, requests: cur.requests.map(x => x.id === r.id ? mutateOne(x) : x) }), what);
      setItems(next.requests);
      setStatus(okMsg);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }
  const markDone = (r) => {
    const note = window.prompt(`Mark loaner ${r.loanerNo || r.vin} done?\n\nOptional note (what was done, RO #…):`, '');
    if (note === null) return;
    change(r, x => ({ ...x, status: 'done', doneAt: new Date().toISOString(), doneBy: currentUser, doneNote: note.trim() }),
      `done ${r.loanerNo || r.vin}`, `✓ Loaner ${r.loanerNo || r.vin} marked done.`);
  };
  const reopen = (r) => {
    if (!window.confirm(`Reopen the request for loaner ${r.loanerNo || r.vin}?`)) return;
    change(r, ({ doneAt, doneBy, doneNote, ...x }) => ({ ...x, status: 'open' }), `reopen ${r.loanerNo || r.vin}`, '✓ Request reopened.');
  };
  async function remove(r) {
    if (!isManager || !window.confirm(`Delete the maintenance request for loaner ${r.loanerNo || r.vin}? This can't be undone.`)) return;
    setBusy(true); setStatus('');
    try {
      const next = await updateLoanerMaintenance(cur => ({ ...cur, requests: cur.requests.filter(x => x.id !== r.id) }), `delete ${r.loanerNo || r.vin}`);
      setItems(next.requests);
      for (const p of r.photos || []) { try { await deleteByUrl(p.url); } catch {} }
      setStatus('✓ Request deleted.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Delete failed.'}`);
    }
    setBusy(false);
  }

  const { open, done } = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (r) => !terms.length || terms.every(t => [r.loanerNo, r.vin, r.year, r.make, r.model, r.description, (r.services || []).join(' '), r.requestedBy, r.doneNote].join(' ').toLowerCase().includes(t));
    const list = items.filter(hit);
    return {
      open: list.filter(r => r.status !== 'done').sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || String(a.requestedAt).localeCompare(String(b.requestedAt))),
      done: list.filter(r => r.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))),
    };
  }, [items, q]);
  const openCount = items.filter(r => r.status !== 'done').length;
  const urgentCount = items.filter(r => r.status !== 'done' && r.priority === 'urgent').length;

  const row = (r, isDone) => (
    <tr key={r.id} style={!isDone && r.priority === 'urgent' ? { background: 'rgba(248,113,113,.07)' } : isDone ? { opacity: 0.7 } : undefined}>
      <td style={td}>
        {isDone
          ? <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 900, color: '#052e16', background: '#4ade80' }}>✓ DONE</span>
          : r.priority === 'urgent'
            ? <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 900, color: '#450a0a', background: '#fca5a5' }}>🚫 URGENT</span>
            : <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 900, color: '#422006', background: '#fde68a' }}>ROUTINE</span>}
        {!isDone && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 5 }}>{daysOpen(r.requestedAt) === 0 ? 'today' : `${daysOpen(r.requestedAt)}d open`}</div>}
      </td>
      <td style={td}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{r.loanerNo ? `Stock #${r.loanerNo}` : <span style={{ color: '#64748b' }}>no stock #</span>}</div>
        <div style={{ fontSize: 13, color: '#cbd5e1' }}>{vehicleText(r)}</div>
        {r.vin && <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#94a3b8' }}>{r.vin}</div>}
      </td>
      <td style={td}>{r.mileage ? Number(r.mileage).toLocaleString() : <span style={{ color: '#64748b' }}>—</span>}</td>
      <td style={{ ...td, whiteSpace: 'normal', minWidth: 240, maxWidth: 420 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(r.services || []).map(s => <span key={s} style={{ fontSize: 11.5, fontWeight: 800, color: '#bfdbfe', background: 'rgba(59,130,246,.18)', border: '1px solid rgba(147,197,253,.4)', borderRadius: 6, padding: '2px 7px' }}>{s}</span>)}
        </div>
        {r.description && <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 5, lineHeight: 1.4 }}>{r.description}</div>}
        {isDone && r.doneNote && <div style={{ fontSize: 12.5, color: '#86efac', marginTop: 5 }}>✓ {r.doneNote}</div>}
      </td>
      <td style={td}>
        {(r.photos || []).length ? (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 170 }}>
            {r.photos.map((p, i) => (
              <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" title={p.name}>
                {isImage(p)
                  ? <img src={p.url} alt={p.name} style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 7, border: '1px solid rgba(148,163,184,.3)' }} />
                  : <span style={{ display: 'inline-flex', width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: '1px solid rgba(148,163,184,.3)', fontSize: 20 }}>🎬</span>}
              </a>
            ))}
          </div>
        ) : <span style={{ color: '#64748b' }}>—</span>}
      </td>
      <td style={{ ...td, fontSize: 12.5, color: '#94a3b8' }}>
        {r.requestedBy}<br />{fmtWhen(r.requestedAt)}
        {isDone && <div style={{ color: '#86efac', marginTop: 4 }}>Done: {r.doneBy}<br />{fmtWhen(r.doneAt)}</div>}
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {isDone
            ? <button disabled={busy} style={btn('110,231,249')} onClick={() => reopen(r)}>↩ Reopen</button>
            : <button disabled={busy} style={btn('74,222,128')} onClick={() => markDone(r)}>✓ Done</button>}
          {isManager && <button disabled={busy} title="Delete request" style={btn('248,113,113')} onClick={() => remove(r)}>🗑</button>}
        </div>
      </td>
    </tr>
  );
  const table = (rows, isDone) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead><tr>
          <th style={th}>{isDone ? 'Status' : 'Priority'}</th><th style={th}>Loaner</th><th style={th}>Miles</th>
          <th style={th}>Service needed</th><th style={th}>Photos</th><th style={th}>Requested</th><th style={th}></th>
        </tr></thead>
        <tbody>{rows.map(r => row(r, isDone))}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => { setStatus(''); setFormOpen(true); }} style={{ ...btn('74,222,128'), fontSize: 14.5, padding: '10px 20px' }}>🔧 New maintenance request</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search stock #, VIN, model, service…" style={{ ...inputStyle, maxWidth: 420, flex: '1 1 240px' }} />
        {searchVin.vin && (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13.5, fontWeight: 800, color: '#bfdbfe', background: 'rgba(59,130,246,.14)', border: '1px solid rgba(147,197,253,.4)', borderRadius: 10, padding: '7px 12px' }}>
            🚗 {searchVin.decoding ? 'Decoding VIN…' : searchVin.res.ok ? vehicleText(searchVin.res) : `${searchVin.res.year ? searchVin.res.year + ' · ' : ''}couldn't decode the model`}
            <button disabled={busy} style={btn('74,222,128')}
              onClick={() => { setStatus(''); setDraft({ ...EMPTY(), vin: searchVin.vin }); setFormOpen(true); }}>🔧 New request for this VIN</button>
          </span>
        )}
        {status && !formOpen && <span style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', marginBottom: 10 }}>
          🔧 Loaners needing service ({openCount} open{urgentCount ? <span style={{ color: '#fca5a5' }}> · {urgentCount} urgent</span> : ''})
        </div>
        {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
          : open.length === 0 ? <div style={{ color: '#94a3b8' }}>{q.trim() ? `Nothing open matches “${q}”.` : 'No loaners waiting on maintenance. 👍'}</div>
          : table(open, false)}
        {done.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button style={btn('148,163,184', showDone)} onClick={() => setShowDone(v => !v)}>{showDone ? '▾' : '▸'} Done ({done.length})</button>
            {showDone && <div style={{ marginTop: 10 }}>{table(done, true)}</div>}
          </div>
        )}
      </div>

      {formOpen && (
        <div onClick={() => !busy && closeForm()}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, background: '#0f172a', width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 18, fontWeight: 900, color: '#f1f5f9' }}>🔧 Loaner maintenance request</div>
              <button disabled={busy} style={btn('148,163,184', false)} onClick={closeForm}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Stock #
                {fleetHit ? <span style={{ color: '#86efac', marginLeft: 8 }}>✓ from Loaner Inventory</span>
                  : vin.length === 17 && fleet.length ? <span style={{ color: '#fde68a', marginLeft: 8 }}>not in Loaner Inventory — type it</span> : null}
              </span><input autoFocus value={draft.loanerNo} onChange={set('loanerNo')} disabled={busy} placeholder="or type the VIN below" style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Current miles</span><input value={draft.mileage} onChange={set('mileage')} disabled={busy} inputMode="numeric" style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span style={label}>Loaner VIN
                  {vin && vin.length !== 17 && <span style={{ color: '#fde68a', marginLeft: 8 }}>{vin.length} characters — should be 17</span>}
                  {formVin.decoding && <span style={{ color: '#93c5fd', marginLeft: 8 }}>Decoding…</span>}
                  {formVin.res && (formVin.res.ok
                    ? <span style={{ color: '#86efac', marginLeft: 8 }}>✓ {vehicleText(formVin.res)}</span>
                    : <span style={{ color: '#fde68a', marginLeft: 8 }}>Couldn't decode the model — type it in</span>)}
                </span>
                <input value={draft.vin} onChange={set('vin')} disabled={busy} maxLength={20} placeholder="Type the VIN — year, make and model fill in" style={{ ...inputStyle, letterSpacing: '.06em' }} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Year</span><input value={draft.year} onChange={set('year')} disabled={busy} inputMode="numeric" maxLength={4} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Make</span><input value={draft.make} onChange={set('make')} disabled={busy} placeholder="Hyundai" style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Model</span><input value={draft.model} onChange={set('model')} disabled={busy} placeholder="Kona, Tucson…" style={inputStyle} /></label>
            </div>

            <div style={{ ...label, margin: '14px 0 6px' }}>Priority</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={() => setDraft(d => ({ ...d, priority: 'urgent' }))} style={{ ...btn('248,113,113', draft.priority === 'urgent'), fontSize: 13.5, padding: '8px 14px' }}>{draft.priority === 'urgent' ? '✓ ' : ''}🚫 Urgent — out of service</button>
              <button type="button" disabled={busy} onClick={() => setDraft(d => ({ ...d, priority: 'routine' }))} style={{ ...btn('251,191,36', draft.priority === 'routine'), fontSize: 13.5, padding: '8px 14px' }}>{draft.priority === 'routine' ? '✓ ' : ''}Routine — still driveable</button>
            </div>

            <div style={{ ...label, margin: '14px 0 6px' }}>Service needed</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SERVICES.map(s => {
                const on = draft.services.includes(s);
                return <button key={s} type="button" disabled={busy} onClick={() => toggleService(s)} style={{ ...btn('96,165,250', on), fontSize: 13, padding: '7px 12px' }}>{on ? '☑' : '☐'} {s}</button>;
              })}
            </div>
            <label style={{ display: 'grid', gap: 4, marginTop: 12 }}>
              <span style={label}>Describe the problem</span>
              <textarea value={draft.description} onChange={set('description')} disabled={busy} rows={3} placeholder="Tire pressure light on, scrape on rear bumper, due for oil…"
                style={{ ...inputStyle, fontWeight: 600, fontSize: 14, lineHeight: 1.45, resize: 'vertical' }} />
            </label>

            <div style={{ ...label, margin: '14px 0 6px' }}>Photos (optional, up to {MAX_PHOTOS})</div>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {files.map((f, i) => (
                <div key={f.url} style={{ position: 'relative' }}>
                  {/^video\//.test(f.file.type)
                    ? <span style={{ display: 'inline-flex', width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: '1px solid rgba(148,163,184,.3)', fontSize: 26 }}>🎬</span>
                    : <img src={f.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 9, border: '1px solid rgba(148,163,184,.3)' }} />}
                  <button type="button" disabled={busy} onClick={() => dropFile(i)} title="Remove"
                    style={{ position: 'absolute', top: -7, right: -7, width: 22, height: 22, borderRadius: 999, border: 0, background: '#ef4444', color: '#fff', fontWeight: 900, cursor: 'pointer', lineHeight: '22px', padding: 0 }}>×</button>
                </div>
              ))}
              {files.length < MAX_PHOTOS && (
                <button type="button" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} style={{ ...btn('196,181,253'), fontSize: 13, padding: '9px 14px' }}>📷 Add photos</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button disabled={busy || missing.length > 0} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={submit}>
                {busy ? (status || 'Saving…') : '✓ Submit request'}
              </button>
              <button disabled={busy} style={btn('148,163,184', false)} onClick={closeForm}>Cancel</button>
              {missing.length > 0 && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Still need: {missing.join(', ')}</span>}
              {status.startsWith('❌') && <span style={{ fontSize: 13.5, fontWeight: 800, color: '#fca5a5' }}>{status}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
