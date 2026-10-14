// ⚙️ Specials — managers build prep-sheet specials (utils/specials.js):
// a name, what the car is booked for, which deferred work to look for, and
// the offer the advisor sees. Saved to data/specials.json right away.
import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';
import { BOOKED_OPTIONS, SPECIAL_COLORS } from '../utils/specials';

const uid = () => `sp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const inp = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#e2e8f0', padding: '7px 10px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const lbl = { fontSize: 10.5, fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 };
const chip = (on, color = '110,231,249') => ({
  background: on ? `rgba(${color},.2)` : 'rgba(255,255,255,.04)', border: `1px solid ${on ? `rgba(${color},.6)` : 'rgba(148,163,184,.25)'}`,
  color: on ? `rgb(${color})` : '#cbd5e1', borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
});
const blank = () => ({ id: uid(), name: '', color: SPECIAL_COLORS[0], active: true, from: '', to: '', booked: [], keywords: [], deferred: [], minAge: '', minMiles: '', note: '' });

export default function SpecialsSettings({ currentUser, onClose, onSaved, io }) {
  const { loadSpecials, updateSpecials, loadDeferredCodes } = io || github;
  const [list, setList] = useState(null);
  const [codes, setCodes] = useState({});
  const [edit, setEdit] = useState(null);       // the special being edited (a copy)
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([loadSpecials(), loadDeferredCodes ? loadDeferredCodes().catch(() => ({})) : {}])
      .then(([s, c]) => { setList((s && s.specials) || []); setCodes(c || {}); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deferred services to pick from: one chip per description (several op codes
  // can be the same service), from the Deferred Service op-code list.
  const services = useMemo(() => {
    const by = {};
    for (const [code, v] of Object.entries(codes || {})) {
      const label = (v && v.description) || code;
      (by[label] ||= { label, codes: [] }).codes.push(code);
    }
    return Object.values(by).sort((a, b) => a.label.localeCompare(b.label));
  }, [codes]);
  const shown = services.filter(s => !q.trim() || `${s.label} ${s.codes.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function save(next) {
    setBusy(true); setMsg('');
    try {
      const res = await updateSpecials(cur => ({ ...cur, specials: next, updatedAt: new Date().toISOString(), by: currentUser }));
      setList((res && res.specials) || next);
      onSaved && onSaved((res && res.specials) || next);
      setMsg('✅ Saved — the prep sheet picks it up right away.');
      return true;
    } catch (e) { setMsg('❌ ' + (e.message || e)); return false; }
    finally { setBusy(false); }
  }
  const saveEdit = async () => {
    if (!edit.name.trim()) { setMsg('❌ Give the special a name.'); return; }
    if (!edit.booked.length && !edit.keywords.length && !edit.deferred.length && !Number(edit.minAge) && !Number(edit.minMiles)) { setMsg('❌ Pick at least one thing to look for.'); return; }
    const next = list.some(s => s.id === edit.id) ? list.map(s => (s.id === edit.id ? edit : s)) : [...list, edit];
    if (await save(next)) setEdit(null);
  };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const svcOn = (svc) => svc.codes.every(c => edit.deferred.includes(c));
  const describe = (s) => {
    const booked = [...(s.booked || []).map(k => (BOOKED_OPTIONS.find(o => o.key === k) || { label: k }).label), ...(s.keywords || []).map(w => `"${w}"`)];
    const def = [...new Set((s.deferred || []).map(c => (codes[c] && codes[c].description) || c))];
    const veh = [Number(s.minAge) ? `${s.minAge}+ yrs old` : null, Number(s.minMiles) ? `over ${Number(s.minMiles).toLocaleString()} mi` : null].filter(Boolean).join(' and ');
    return [[booked.length ? `Booked: ${booked.join(' or ')}` : null, def.length ? `Deferred: ${def.join(' or ')}` : null].filter(Boolean).join('  +  '), veh ? `Or any car ${veh}` : null].filter(Boolean).join('   ·   ');
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860, background: 'linear-gradient(180deg,#141c2e,#0d1424)', border: '1px solid rgba(110,231,249,.3)', borderRadius: 18, boxShadow: '0 30px 80px -30px rgba(0,0,0,.9)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', borderBottom: '1px solid rgba(110,231,249,.2)' }}>
          <span style={{ fontSize: 22 }}>🎯</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Specials</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Tag appointments on the prep sheet as a possible special — e.g. booked for a $50 oil change with deferred coolant service.</div>
          </div>
          <button className="secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {msg && <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: msg.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{msg}</div>}
          {list == null ? <div style={{ color: '#94a3b8' }}>Loading…</div> : edit ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 240px' }}><div style={lbl}>Name — shows as "Possible …"</div>
                  <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Winter Special" style={{ ...inp, width: '100%' }} /></div>
                <div style={{ flex: '1 1 140px' }}><div style={lbl}>From (optional)</div>
                  <input type="date" value={edit.from} onChange={e => setEdit({ ...edit, from: e.target.value })} style={{ ...inp, width: '100%', colorScheme: 'dark' }} /></div>
                <div style={{ flex: '1 1 140px' }}><div style={lbl}>To (optional)</div>
                  <input type="date" value={edit.to} onChange={e => setEdit({ ...edit, to: e.target.value })} style={{ ...inp, width: '100%', colorScheme: 'dark' }} /></div>
              </div>
              <div><div style={lbl}>Color</div>
                <div style={{ display: 'flex', gap: 8 }}>{SPECIAL_COLORS.map(c => (
                  <button key={c} onClick={() => setEdit({ ...edit, color: c })} title={c}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: edit.color === c ? '3px solid #fff' : '2px solid rgba(255,255,255,.2)', cursor: 'pointer' }} />
                ))}</div>
              </div>
              <div>
                <div style={lbl}>1 · Booked for (any of these) — optional</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {BOOKED_OPTIONS.map(o => <button key={o.key} style={chip(edit.booked.includes(o.key))} onClick={() => setEdit({ ...edit, booked: toggle(edit.booked, o.key) })}>{o.label}</button>)}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>…or a word in the appointment:</span>
                  {edit.keywords.map(w => <button key={w} style={chip(true, '251,191,36')} onClick={() => setEdit({ ...edit, keywords: edit.keywords.filter(x => x !== w) })}>"{w}" ✕</button>)}
                  <input value={kw} onChange={e => setKw(e.target.value)} placeholder="e.g. tire rotation"
                    onKeyDown={e => { if (e.key === 'Enter' && kw.trim()) { setEdit({ ...edit, keywords: [...new Set([...edit.keywords, kw.trim()])] }); setKw(''); } }}
                    style={{ ...inp, width: 180, padding: '5px 9px', fontSize: 12.5 }} />
                  <span style={{ fontSize: 11, color: '#64748b' }}>Enter to add</span>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ ...lbl, marginBottom: 0 }}>2 · Has deferred work (any of these) — optional</div>
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a service…" style={{ ...inp, width: 200, padding: '5px 9px', fontSize: 12.5 }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {shown.map(svc => (
                    <button key={svc.label} style={chip(svcOn(svc), '74,222,128')} title={svc.codes.join(', ')}
                      onClick={() => setEdit({ ...edit, deferred: svcOn(svc) ? edit.deferred.filter(c => !svc.codes.includes(c)) : [...new Set([...edit.deferred, ...svc.codes])] })}>
                      {svcOn(svc) ? '☑' : '☐'} {svc.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={lbl}>3 · Or any vehicle that's… (also tagged) — optional</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: '#cbd5e1', fontWeight: 700 }}>
                  at least <input value={edit.minAge ?? ''} onChange={e => setEdit({ ...edit, minAge: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="3"
                    style={{ ...inp, width: 60, padding: '5px 8px', textAlign: 'center' }} /> years old
                  <span style={{ color: '#64748b' }}>and</span>
                  over <input value={edit.minMiles ?? ''} onChange={e => setEdit({ ...edit, minMiles: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="36000"
                    style={{ ...inp, width: 96, padding: '5px 8px', textAlign: 'center' }} /> miles
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
                  Age is from the model year. Miles are used when the DMS appointment export includes them — it doesn't today, so for now the age decides.
                </div>
              </div>
              <div><div style={lbl}>Offer for the advisor (optional)</div>
                <textarea value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} rows={2}
                  placeholder="Coolant service $99 with today's oil change — through Dec 31." style={{ ...inp, width: '100%', resize: 'vertical' }} /></div>
              <label style={{ fontSize: 13, color: '#cbd5e1', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
                <input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Turned on
              </label>
              <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Tags an appointment when <b>both</b> filled-in parts match (1 and 2) — leave one blank to match on the other alone — <b>or</b> when the car meets part 3.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={saveEdit} style={{ ...chip(true, '74,222,128'), padding: '8px 18px', fontSize: 13.5 }}>{busy ? '⏳ Saving…' : '✓ Save special'}</button>
                <button className="secondary" onClick={() => { setEdit(null); setMsg(''); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {list.length === 0 && <div style={{ color: '#94a3b8', marginBottom: 12 }}>No specials yet.</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {list.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${s.color}66`, opacity: s.active === false ? 0.55 : 1, flexWrap: 'wrap' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: s.color }} />
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 900, color: '#f1f5f9' }}>🎯 Possible {s.name}{s.active === false ? ' (off)' : ''}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{describe(s)}{s.from || s.to ? ` · ${s.from || '…'} → ${s.to || '…'}` : ''}</div>
                      {s.note && <div style={{ fontSize: 12, color: '#fde68a', marginTop: 2 }}>💬 {s.note}</div>}
                    </div>
                    <button className="secondary" onClick={() => { setEdit({ ...blank(), ...s, booked: s.booked || [], keywords: s.keywords || [], deferred: s.deferred || [] }); setMsg(''); }}>Edit</button>
                    <button className="secondary" disabled={busy} onClick={() => save(list.map(x => (x.id === s.id ? { ...x, active: x.active === false } : x)))}>{s.active === false ? 'Turn on' : 'Turn off'}</button>
                    <button className="secondary" disabled={busy} style={{ color: '#fca5a5' }} onClick={() => { if (window.confirm(`Delete "${s.name}"?`)) save(list.filter(x => x.id !== s.id)); }}>Delete</button>
                  </div>
                ))}
              </div>
              <button onClick={() => { setEdit(blank()); setMsg(''); }} style={{ ...chip(true), padding: '8px 16px', fontSize: 13.5, marginTop: 14 }}>＋ New special</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
