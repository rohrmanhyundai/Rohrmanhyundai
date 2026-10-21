import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { deleteS3ObjectByUrl } from '../utils/s3';
import { decodeVin } from '../utils/vinLookup';
import { readFleetPdf, fmtServiceStart } from '../utils/loanerFleetPdf';
import { useVinDecode, vehicleText } from './LoanerMaintenance';
// three.js lives only in this chunk — it downloads when Report damage opens.
const LoanerDamage = lazy(() => import('./damage/LoanerDamage'));

// ── Loaner Inventory (Service Loaner page tab) ───────────────────────────────
// The loaner fleet. Type a VIN → year / make / model fill in from the decoder →
// add stock #, miles and notes → Add to fleet. Each loaner keeps a notes box
// anyone with the page can edit (who/when last changed is shown). Removing a
// loaner from the fleet asks first. Stored in data/service-loaner/inventory.json.
// 📸 Media shows the check-in / check-out pictures and videos sent from a phone
// (🚙 Rental — LoanerMediaUpload), newest first; managers can delete a set.
// 📄 Upload fleet PDF reads the manufacturer's Fleet report (utils/loanerFleetPdf)
// and, matched by VIN, updates year / make / model / odometer / service start /
// unit # on loaners already here and adds the new ones — after a preview.
// Nothing is removed; loaners missing from the PDF are only listed.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const label = { fontSize: 12, fontWeight: 800, color: '#94a3b8' };
const notesStyle = { ...inputStyle, fontWeight: 600, fontSize: 14, lineHeight: 1.45, resize: 'vertical' };

// Whole days between a YYYY-MM-DD date and today (local), or null.
const daysSince = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const now = new Date();
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
};
const shortDate = (iso) => { const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ''; };
const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();

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
  const [fleetImport, setFleetImport] = useState(null); // { reading } | { file, rows: [{ pdf, existing, next, changes }], missing } | { error }
  const pdfRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(EMPTY);
  const [q, setQ] = useState('');
  const [noteEdit, setNoteEdit] = useState(null);   // { id, text } while a loaner's notes are open
  const [contracts, setContracts] = useState([]);   // Service Loaner contracts — an open one means the car is out
  const [where, setWhere] = useState('all');        // all | lot | out
  const [damage, setDamage] = useState([]);         // damage reports (data/service-loaner/damage.json)
  const [damageFor, setDamageFor] = useState(null); // loaner whose 🚨 Report damage page is open

  useEffect(() => {
    let alive = true;
    loadLoanerInventory().then(d => { if (alive) { setItems(d.vehicles || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    loadLoanerMedia().then(d => { if (alive) setMedia(d.sessions || []); }).catch(() => {});
    ((io || github).loadServiceLoaners)().then(d => { if (alive) setContracts(d.contracts || []); }).catch(() => {});
    ((io || github).loadLoanerDamage)().then(d => { if (alive) setDamage(d.reports || []); }).catch(() => {});
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

  // ── Fleet PDF import ──
  const FIELDS = [['unitNo', 'Unit #'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['mileage', 'Odometer'], ['serviceStart', 'Service start']];
  async function pickFleetPdf(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setFleetImport({ reading: true, name: file.name });
    try {
      const pdfRows = await readFleetPdf(file);
      if (!pdfRows.length) throw new Error("Couldn't find any loaners in that PDF — is it the Fleet report?");
      // The PDF's model is the most specific ("SANTA FE HYBRID SE AWD"), but its
      // column wraps mid-word ("CALLIGRAP / HY"). Two pieces that make a word the
      // VIN decoder knows are joined back up; no PDF model → the decoder's.
      const decoded = await Promise.all(pdfRows.map(r => decodeVin(r.vin).catch(() => ({ ok: false }))));
      const rows = pdfRows.map((pdf, i) => {
        const d = decoded[i];
        const decModel = d && d.ok ? [d.model, d.trim].filter(Boolean).join(' ').toUpperCase() : '';
        const known = new Set(decModel.split(/\s+/).filter(Boolean));
        const toks = pdf.model.split(/\s+/).filter(Boolean);
        for (let j = 0; j < toks.length - 1; j++) if (!known.has(toks[j]) && known.has(toks[j] + toks[j + 1])) toks.splice(j, 2, toks[j] + toks[j + 1]);
        const fromPdf = { ...pdf, model: toks.join(' ') || decModel,
          make: pdf.make || (d && d.ok ? String(d.make || '').toUpperCase() : ''), year: pdf.year || (d && d.year ? String(d.year) : '') };
        const existing = items.find(v => v.vin === pdf.vin) || null;
        const changes = existing ? FIELDS.filter(([k]) => fromPdf[k] && String(existing[k] || '') !== String(fromPdf[k])).map(([k, label]) => ({ k, label, from: existing[k] || '', to: fromPdf[k] })) : [];
        return { pdf: fromPdf, existing, changes };
      });
      const inPdf = new Set(pdfRows.map(r => r.vin));
      setFleetImport({ name: file.name, rows, missing: items.filter(v => !inPdf.has(v.vin)) });
    } catch (err) {
      setFleetImport({ error: err.message || 'Could not read that PDF.', name: file.name });
    }
  }
  async function applyFleetImport() {
    if (!fleetImport || !fleetImport.rows || busy) return;
    setBusy(true); setStatus('Saving…');
    const now = new Date().toISOString();
    const byVin = new Map(fleetImport.rows.map(r => [r.pdf.vin, r.pdf]));
    try {
      const next = await updateLoanerInventory(cur => {
        const seen = new Set();
        const vehicles = cur.vehicles.map(v => {
          const p = byVin.get(v.vin);
          if (!p) return v;
          seen.add(v.vin);
          const upd = { ...v };
          for (const [k] of FIELDS) if (p[k]) upd[k] = p[k];
          return { ...upd, fleetSyncedAt: now };
        });
        for (const p of byVin.values()) {
          if (seen.has(p.vin)) continue;
          vehicles.push({
            id: `li-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            vin: p.vin, stockNo: '', unitNo: p.unitNo || '', year: p.year || '', make: p.make || '', model: p.model || '',
            mileage: p.mileage || '', serviceStart: p.serviceStart || '', notes: '',
            addedAt: now, addedBy: `${currentUser} (fleet PDF)`, fleetSyncedAt: now,
          });
        }
        return { ...cur, vehicles };
      }, `fleet PDF (${byVin.size})`);
      setItems(next.vehicles);
      const added = fleetImport.rows.filter(r => !r.existing).length;
      const updated = fleetImport.rows.filter(r => r.existing && r.changes.length).length;
      setFleetImport(null);
      setStatus(`✓ Fleet PDF: ${added} added, ${updated} updated.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }
  async function setStock(v) {
    const val = window.prompt(`Stock # for ${vehicleText(v) || v.vin}:`, v.stockNo || '');
    if (val === null || busy) return;
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateLoanerInventory(cur => ({ ...cur, vehicles: cur.vehicles.map(x => x.id === v.id ? { ...x, stockNo: val.trim().toUpperCase() } : x) }), `stock ${v.vin}`);
      setItems(next.vehicles);
      setStatus('✓ Stock # saved.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  const sessionsOf = (v) => media.filter(m => m.vehicleId === v.id || (!m.vehicleId && m.stockNo && m.stockNo === v.stockNo))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // One box per rental: the same customer's CHECK OUT then CHECK IN sets go
  // together; a different customer (or a new check-out after a check-in) starts
  // the next box. Newest rental first.
  const rentalsOf = (v) => {
    const who = (m) => [m.customerFirst, m.customerLast].filter(Boolean).join(' ').trim().toUpperCase();
    const groups = [];
    let cur = null;
    for (const m of [...sessionsOf(v)].reverse()) {          // oldest first
      const name = who(m);
      if (!cur || (name && cur.name && name !== cur.name) || (m.kind !== 'in' && cur.ins.length)) {
        cur = { id: m.id, name, outs: [], ins: [] };
        groups.push(cur);
      }
      if (!cur.name) cur.name = name;
      (m.kind === 'in' ? cur.ins : cur.outs).push(m);
    }
    return groups.reverse();
  };
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

  // A loaner is out while it has a contract with no completed (returned) copy —
  // matched by VIN, or by unit # when the contract's VIN is missing.
  const outBy = useMemo(() => {
    const m = {};
    for (const c of contracts) {
      if (c.completedUrl) continue;
      const vin = String(c.vin || '').trim().toUpperCase();
      const v = items.find(x => (vin && x.vin === vin) || (!vin && c.unitNo && x.unitNo && x.unitNo === c.unitNo));
      if (v && (!m[v.id] || String(c.dateOut) > String(m[v.id].dateOut))) m[v.id] = c;
    }
    return m;
  }, [contracts, items]);
  const outCount = items.filter(v => outBy[v.id]).length;
  const openDamage = (v) => damage.filter(r => r.status !== 'repaired' && (r.vehicleId === v.id || (r.vin && r.vin === v.vin))).length;

  const list = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (v) => !terms.length || terms.every(t => [v.stockNo, v.unitNo, v.vin, v.year, v.make, v.model, v.notes].join(' ').toLowerCase().includes(t));
    const place = (v) => where === 'all' || (where === 'out') === !!outBy[v.id];
    return items.filter(v => hit(v) && place(v)).sort((a, b) => String(a.stockNo || a.vin).localeCompare(String(b.stockNo || b.vin), undefined, { numeric: true }));
  }, [items, q, where, outBy]);

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
          <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9' }}>🚙 Loaner fleet ({items.length})</div>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {[['all', `All · ${items.length}`, '148,163,184'], ['lot', `🅿️ On the lot · ${items.length - outCount}`, '74,222,128'], ['out', `🚗 Out on loan · ${outCount}`, '251,146,60']].map(([k, txt, rgb]) => (
              <button key={k} onClick={() => setWhere(k)} style={{ ...btn(rgb, where === k), borderRadius: 999, padding: '5px 12px' }}>{txt}</button>
            ))}
          </div>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" onChange={pickFleetPdf} style={{ display: 'none' }} />
          <button disabled={busy} title="Upload the Fleet report PDF — adds new loaners and updates the ones already here" onClick={() => pdfRef.current?.click()}
            style={{ ...btn('251,191,36'), fontSize: 14, padding: '9px 16px' }}>📄 Upload fleet PDF</button>
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
                      <div style={{ fontWeight: 900, fontSize: 22, color: '#f1f5f9', flex: 1 }}>
                        {v.stockNo ? `Stock #${v.stockNo}` : <span style={{ color: '#fbbf24' }}>no stock #</span>}
                        <button disabled={busy} title="Set the stock #" onClick={() => setStock(v)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: 0, opacity: 0.7 }}>✏️</button>
                      </div>
                      {v.mileage && <div style={{ fontSize: 15, color: '#94a3b8', fontWeight: 700 }}>{Number(v.mileage).toLocaleString()} mi</div>}
                    </div>
                    <div style={{ fontSize: 17, color: '#cbd5e1', fontWeight: 800 }}>{vehicleText(v) || '—'}</div>
                    <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14.5, color: '#94a3b8' }}>{v.vin}{v.unitNo ? <span style={{ fontFamily: 'inherit', marginLeft: 10, color: '#64748b' }}>Unit {v.unitNo}</span> : null}</div>
                    {v.serviceStart && <div style={{ fontSize: 14, color: '#a5b4fc', fontWeight: 700 }}>🗓 In service since {fmtServiceStart(v.serviceStart)}</div>}
                    {(() => {
                      const c = outBy[v.id];
                      if (!c) return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.45)' }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: '#4ade80' }}>🅿️ On the lot</span>
                          <span style={{ fontSize: 12.5, color: '#86efac' }}>— available</span>
                        </div>
                      );
                      const days = daysSince(c.dateOut);
                      const late = daysSince(c.dueDate);
                      const who = [c.firstName, c.lastName].filter(Boolean).join(' ');
                      return (
                        <div style={{ padding: '9px 12px', borderRadius: 10, background: 'rgba(251,146,60,.1)', border: '1px solid rgba(251,146,60,.5)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 15, fontWeight: 900, color: '#fb923c' }}>🚗 Out on loan</span>
                            {days != null && <span style={{ fontSize: 12.5, fontWeight: 900, color: '#fdba74' }}>· {days} day{days === 1 ? '' : 's'}</span>}
                            {late > 0 && <span style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5' }}>⏰ {late}d past due</span>}
                          </div>
                          <div style={{ fontSize: 13, color: '#fed7aa', marginTop: 3 }}>
                            {who || 'Customer'}{c.advisor ? ` · 👤 ${firstName(c.advisor)}` : ''}{c.dateOut ? ` · out ${shortDate(c.dateOut)}` : ''}{c.raNo ? ` · RA ${c.raNo}` : ''}
                          </div>
                        </div>
                      );
                    })()}
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
                        <button disabled={busy} title="Spin the car in 3D and click a panel to report damage" style={{ ...btn('248,113,113'), fontSize: 14.5, padding: '9px 16px', position: 'relative' }} onClick={() => setDamageFor(v)}>
                          🚨 Report damage
                          {openDamage(v) > 0 && <span style={{ position: 'absolute', top: -8, right: -8, minWidth: 20, height: 20, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 11.5, fontWeight: 900, lineHeight: '20px', textAlign: 'center', border: '2px solid #0b1120', boxShadow: '0 0 10px rgba(239,68,68,.7)' }}>{openDamage(v)}</span>}
                        </button>
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

      {fleetImport && (
        <div onClick={() => !busy && !fleetImport.reading && setFleetImport(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, background: '#0f172a', width: '100%', maxWidth: 1200, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#f1f5f9' }}>📄 Fleet PDF</div>
                <div style={{ fontSize: 13.5, color: '#94a3b8' }}>{fleetImport.name}</div>
              </div>
              {!fleetImport.reading && <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setFleetImport(null)}>✕</button>}
            </div>
            {fleetImport.reading ? <div style={{ color: '#93c5fd', marginTop: 16, fontSize: 15, fontWeight: 700 }}>⏳ Reading the PDF and decoding VINs…</div>
              : fleetImport.error ? <div style={{ color: '#fca5a5', marginTop: 16, fontSize: 15, fontWeight: 700 }}>⚠ {fleetImport.error}</div>
              : (() => {
                const added = fleetImport.rows.filter(r => !r.existing);
                const updated = fleetImport.rows.filter(r => r.existing && r.changes.length);
                const same = fleetImport.rows.filter(r => r.existing && !r.changes.length);
                const cell = { padding: '8px 10px', fontSize: 13.5, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.12)', verticalAlign: 'top', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' };
                const head = { ...cell, fontSize: 11.5, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left' };
                return (
                  <>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, fontSize: 14.5, fontWeight: 800 }}>
                      <span style={{ color: '#4ade80' }}>➕ {added.length} new</span>
                      <span style={{ color: '#fbbf24' }}>✏️ {updated.length} updated</span>
                      <span style={{ color: '#94a3b8' }}>✓ {same.length} unchanged</span>
                    </div>
                    <div style={{ overflowX: 'auto', marginTop: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                        <thead><tr>
                          <th style={head}></th><th style={head}>Stock / Unit</th><th style={head}>VIN</th><th style={head}>Vehicle</th>
                          <th style={head}>Odometer</th><th style={head}>Service start</th><th style={head}>Changes</th>
                        </tr></thead>
                        <tbody>
                          {fleetImport.rows.map(r => (
                            <tr key={r.pdf.vin} style={!r.existing ? { background: 'rgba(74,222,128,.06)' } : r.changes.length ? { background: 'rgba(251,191,36,.05)' } : { opacity: 0.6 }}>
                              <td style={cell}>{!r.existing ? <b style={{ color: '#4ade80' }}>NEW</b> : r.changes.length ? <b style={{ color: '#fbbf24' }}>UPDATE</b> : <span style={{ color: '#94a3b8' }}>same</span>}</td>
                              <td style={cell}>{r.existing && r.existing.stockNo ? <b>#{r.existing.stockNo}</b> : <span style={{ color: '#64748b' }}>—</span>}<div style={{ fontSize: 12, color: '#94a3b8' }}>Unit {r.pdf.unitNo || '—'}</div></td>
                              <td style={{ ...cell, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}>{r.pdf.vin}</td>
                              <td style={cell}>{vehicleText(r.pdf)}</td>
                              <td style={cell}>{r.pdf.mileage ? Number(r.pdf.mileage).toLocaleString() : '—'}</td>
                              <td style={cell}>{fmtServiceStart(r.pdf.serviceStart) || '—'}</td>
                              <td style={{ ...cell, whiteSpace: 'normal', minWidth: 220, fontSize: 12.5, color: '#cbd5e1' }}>
                                {r.changes.map(c => <div key={c.k}><b>{c.label}:</b> {c.k === 'serviceStart' ? (fmtServiceStart(c.from) || '—') : (c.from || '—')} → <span style={{ color: '#fde68a' }}>{c.k === 'serviceStart' ? fmtServiceStart(c.to) : c.to}</span></div>)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {fleetImport.missing.length > 0 && (
                      <div style={{ marginTop: 12, fontSize: 13.5, color: '#fde68a', lineHeight: 1.5 }}>
                        ⚠ {fleetImport.missing.length} loaner{fleetImport.missing.length === 1 ? ' is' : 's are'} in the fleet here but not in this PDF — left as they are:{' '}
                        {fleetImport.missing.map(v => v.stockNo ? `#${v.stockNo}` : v.vin).join(', ')}. Remove any that are gone with 🗑 on its card.
                      </div>
                    )}
                    {added.length > 0 && <div style={{ marginTop: 8, fontSize: 13, color: '#94a3b8' }}>New loaners come in without a stock # — set it with ✏️ on the card.</div>}
                    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                      <button disabled={busy || (!added.length && !updated.length)} onClick={applyFleetImport}
                        style={{ ...btn('74,222,128'), fontSize: 15, padding: '11px 22px', opacity: added.length || updated.length ? 1 : 0.5 }}>
                        {busy ? '⏳ Saving…' : added.length || updated.length ? `✓ Apply — add ${added.length}, update ${updated.length}` : 'Nothing to change'}
                      </button>
                      <button disabled={busy} style={{ ...btn('148,163,184', false), fontSize: 15, padding: '11px 22px' }} onClick={() => setFleetImport(null)}>Cancel</button>
                    </div>
                  </>
                );
              })()}
          </div>
        </div>
      )}

      {damageFor && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: '#050913', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>Loading the 3D car…</div>}>
          <LoanerDamage vehicle={damageFor} currentUser={currentUser} io={io} onClose={() => setDamageFor(null)} onChanged={setDamage} />
        </Suspense>
      )}
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
              ) : rentalsOf(mediaFor).map(g => {
                const first = (g.outs[0] || g.ins[0]);
                const set = (m) => (
                  <div key={m.id} style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0' }}>{fmtWhen(m.at)}</span>
                      <span style={{ fontSize: 12.5, color: '#94a3b8' }}>by {m.by} · {(m.files || []).length} file{(m.files || []).length === 1 ? '' : 's'}</span>
                      <div style={{ flex: 1 }} />
                      {isManager && <button disabled={busy} title="Delete this set" style={{ ...btn('248,113,113'), padding: '4px 9px' }} onClick={() => removeSession(m)}>🗑</button>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {(m.files || []).map((f, i) => (
                        f.kind === 'video'
                          ? <video key={i} src={f.url} controls playsInline preload="metadata" style={{ width: 260, maxWidth: '100%', height: 170, background: '#000', borderRadius: 10, border: '1px solid rgba(148,163,184,.3)' }} />
                          : <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" title={f.name}>
                              <img src={f.url} alt={f.name} style={{ width: 170, height: 170, objectFit: 'cover', borderRadius: 10, border: '1px solid rgba(148,163,184,.3)' }} />
                            </a>
                      ))}
                    </div>
                  </div>
                );
                const side = (kind, list) => (
                  <div style={{ flex: '1 1 320px', minWidth: 0, background: 'rgba(2,6,23,.35)', border: `1px solid rgba(${kind === 'in' ? '74,222,128' : '251,191,36'},.3)`, borderRadius: 12, padding: '10px 12px' }}>
                    <span style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12.5, fontWeight: 900, color: kind === 'in' ? '#052e16' : '#422006', background: kind === 'in' ? '#4ade80' : '#fde68a' }}>
                      {kind === 'in' ? '🅿️ CHECK IN' : '🔑 CHECK OUT'}
                    </span>
                    {list.length ? list.map(set)
                      : <div style={{ fontSize: 13, color: '#64748b', marginTop: 10 }}>{kind === 'in' ? 'Not checked in yet.' : 'No check-out media.'}</div>}
                  </div>
                );
                return (
                  <div key={g.id} style={{ marginTop: 16, border: '1px solid rgba(148,163,184,.22)', borderRadius: 14, padding: '12px 14px', background: 'rgba(255,255,255,.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: '#bfdbfe' }}>👤 {g.name || 'Customer not entered'}</span>
                      <span style={{ fontSize: 13, color: '#94a3b8' }}>{first ? fmtWhen(first.at).split(' ')[0] : ''}{g.ins.length ? ` → ${fmtWhen(g.ins[g.ins.length - 1].at).split(' ')[0]}` : ''}</span>
                      <span style={{ fontSize: 12, fontWeight: 900, color: g.ins.length ? '#86efac' : '#fbbf24' }}>{g.ins.length ? '✓ Returned' : '🚗 Out'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {side('out', g.outs)}
                      {side('in', g.ins)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
