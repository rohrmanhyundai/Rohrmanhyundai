import React, { useMemo, useState } from 'react';

// ── ⛔ Black List (Service Loaner tab) ────────────────────────────────────────
// Customers not to give a loaner to again. Added from a contract (⛔ Black List
// button — ServiceLoaner) or by hand here; every entry needs a reason. Anyone
// with the page can remove an entry (after an "are you sure"). Contracts for a
// listed customer show a ⛔ flag (utils/serviceLoaner blacklistHit). The list
// itself is loaded and saved by ServiceLoaner so both views share it.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const label = { fontSize: 12, fontWeight: 800, color: '#94a3b8' };
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');
const fmtDate = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };

export default function LoanerBlacklist({ entries, loading, busy, onAdd, onRemove, onSaveNotes, onOpenContract }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ firstName: '', lastName: '', phone: '', notes: '' });
  const [noteEdit, setNoteEdit] = useState(null);   // { id, text }

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...(entries || [])]
      .filter(e => !terms.length || terms.every(t => [e.firstName, e.lastName, e.phone, e.notes, e.listedBy, e.contract?.raNo, e.contract?.ro, e.contract?.vehicle].join(' ').toLowerCase().includes(t)))
      .sort((a, b) => String(b.listedAt).localeCompare(String(a.listedAt)));
  }, [entries, q]);

  const canAdd = (draft.firstName.trim() || draft.lastName.trim()) && draft.notes.trim() && !busy;
  async function add() {
    if (!canAdd) return;
    const who = [draft.firstName, draft.lastName].map(s => s.trim()).filter(Boolean).join(' ');
    if (!window.confirm(`⚠️ Put ${who} on the loaner BLACK LIST?\n\nReason: ${draft.notes.trim()}\n\nEveryone will see them flagged on future loaner contracts.`)) return;
    const ok = await onAdd({ firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), phone: draft.phone.trim(), notes: draft.notes.trim(), source: 'manual' });
    if (ok) { setDraft({ firstName: '', lastName: '', phone: '', notes: '' }); setAdding(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, borderColor: 'rgba(248,113,113,.3)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fca5a5' }}>⛔ Loaner Black List ({(entries || []).length})</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>Customers not to give a loaner to. Add them from a contract (⛔ Black List button) or by hand here.</div>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search name, phone, notes…" style={{ ...inputStyle, maxWidth: 320, flex: '1 1 220px' }} />
          {!adding && <button disabled={busy} style={{ ...btn('248,113,113'), fontSize: 14, padding: '9px 18px' }} onClick={() => setAdding(true)}>➕ Add to black list</button>}
        </div>

        {adding && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.18)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>First name</span><input autoFocus value={draft.firstName} onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Last name</span><input value={draft.lastName} onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Phone (optional)</span><input value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} inputMode="tel" style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span style={label}>Why are they black listed? <span style={{ color: '#fca5a5' }}>*required</span></span>
                <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={3} placeholder="e.g. Returned the loaner with a broken windshield — insurance would not cover it"
                  style={{ ...inputStyle, fontWeight: 600, fontSize: 14, lineHeight: 1.45, resize: 'vertical' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button disabled={!canAdd} onClick={add} style={{ ...btn('248,113,113'), fontSize: 14, padding: '9px 18px', opacity: canAdd ? 1 : 0.5 }}>⛔ Add to black list</button>
              <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setAdding(false)}>Cancel</button>
              {!draft.notes.trim() && <span style={{ fontSize: 12.5, color: '#94a3b8', alignSelf: 'center' }}>Add the reason first.</span>}
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
          : !shown.length ? <div style={{ color: '#94a3b8' }}>{q.trim() ? `No one on the list matches “${q}”.` : 'No one is on the black list. 👍'}</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: 12 }}>
              {shown.map(e => {
                const editing = noteEdit && noteEdit.id === e.id;
                const c = e.contract;
                return (
                  <div key={e.id} style={{ background: 'rgba(127,29,29,.12)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 12, padding: '14px 16px', display: 'grid', gap: 7, alignContent: 'start' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#fecaca', flex: 1 }}>⛔ {[e.firstName, e.lastName].filter(Boolean).join(' ')}</div>
                      <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 700 }}>Listed {fmtDay(e.listedAt)}</div>
                    </div>
                    {e.phone && <div style={{ fontSize: 14, color: '#e2e8f0' }}>📞 {e.phone}</div>}
                    {c && (
                      <div style={{ fontSize: 13, color: '#cbd5e1' }}>
                        📋 {[c.raNo && `RA ${c.raNo}`, c.ro && `RO ${c.ro}`, c.vehicle, c.dateOut && `out ${fmtDate(c.dateOut)}`].filter(Boolean).join(' · ')}
                        {onOpenContract && c.id && <button style={{ ...btn('110,231,249'), padding: '2px 8px', marginLeft: 8, fontSize: 11.5 }} onClick={() => onOpenContract(c.id)}>Open contract</button>}
                      </div>
                    )}
                    {editing ? (
                      <>
                        <textarea autoFocus value={noteEdit.text} onChange={ev => setNoteEdit(n => ({ ...n, text: ev.target.value }))} rows={3}
                          style={{ ...inputStyle, fontWeight: 600, fontSize: 14, lineHeight: 1.45, resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button disabled={busy || !noteEdit.text.trim()} style={btn('74,222,128')} onClick={async () => { if (await onSaveNotes(e.id, noteEdit.text.trim())) setNoteEdit(null); }}>💾 Save</button>
                          <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setNoteEdit(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14, color: '#fde68a', whiteSpace: 'pre-wrap', lineHeight: 1.45, background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '8px 10px' }}>📝 {e.notes}</div>
                    )}
                    <div style={{ fontSize: 12, color: '#64748b' }}>by {e.listedBy}{e.source === 'contract' ? ' · from a contract' : ' · added by hand'}{e.notesBy ? ` · notes edited by ${e.notesBy} ${fmtDay(e.notesAt)}` : ''}</div>
                    {!editing && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button disabled={busy} style={btn('110,231,249')} onClick={() => setNoteEdit({ id: e.id, text: e.notes || '' })}>📝 Edit notes</button>
                        <div style={{ flex: 1 }} />
                        <button disabled={busy} style={btn('248,113,113')} onClick={() => {
                          const who = [e.firstName, e.lastName].filter(Boolean).join(' ');
                          if (window.confirm(`⚠️ Are you sure you want to take ${who} OFF the black list?\n\nThey will no longer be flagged on loaner contracts.`)) onRemove(e.id);
                        }}>🗑 Remove from list</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
