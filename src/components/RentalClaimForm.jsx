// 📄 Rental Claim Form (Warranty Hub) — Hyundai's RCF 3/20/2018.
// ➕ Create new form asks every question on the paper form, in its order, and
// shows the finished form beside it as you type (the same PDF that prints).
// 💾 Save keeps it on the site (data/rental-claims/claims.json); 📋 Saved forms
// lists them — open one to edit, or print / download it again.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { CLAIM_QUESTIONS, DELAY_QUESTIONS, rentalClaimBlobUrl, rentalClaimPdfBytes, rentalClaimFileName, fmtDate } from '../utils/rentalClaimPdf';
import { loadPdfJs } from '../utils/pdfText';

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const input = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' });
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 };
const newId = () => `rc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ALL_KEYS = ['customer', ...CLAIM_QUESTIONS.flatMap(q => (q.pair ? [q.key, q.pair] : [q.key])), ...DELAY_QUESTIONS.map(q => q.key)];
const blank = () => Object.fromEntries(ALL_KEYS.map(k => [k, '']));

// Print a PDF without leaving the page (hidden frame); falls back to a new tab.
async function printClaim(c) {
  const url = await rentalClaimBlobUrl(c);
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => {
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch { window.open(url, '_blank'); }
    setTimeout(() => f.remove(), 60000);
  };
  document.body.appendChild(f);
}
async function downloadClaim(c) {
  const a = document.createElement('a');
  a.href = await rentalClaimBlobUrl(c);
  a.download = rentalClaimFileName(c);
  document.body.appendChild(a); a.click(); a.remove();
}

export default function RentalClaimForm({ currentUser, onBack, backLabel = '← Warranty Hub', io }) {
  const { loadRentalClaims, updateRentalClaims } = io || github;
  const [tab, setTab] = useState('list');          // 'list' | 'form'
  const [claims, setClaims] = useState(null);      // null = loading
  const [q, setQ] = useState('');
  const [form, setForm] = useState(blank());
  const [editingId, setEditingId] = useState(null); // null = a new form
  const [delay, setDelay] = useState(false);       // "If delay in pick up" section open
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const canvasRef = useRef(null);
  const savedRef = useRef(JSON.stringify(blank()));

  useEffect(() => { loadRentalClaims().then(d => setClaims(d.claims || [])).catch(() => setClaims([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview: the real PDF, drawn onto a canvas a moment after typing
  // stops (a PDF inside a frame doesn't show on every phone / browser).
  useEffect(() => {
    if (tab !== 'form') return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const pdfjs = await loadPdfJs();
        const pdf = await pdfjs.getDocument({ data: await rentalClaimPdfBytes(form) }).promise;
        const page = await pdf.getPage(1);
        const cv = canvasRef.current;
        if (!alive || !cv) return;
        // Each draw gets its own canvas (pdf.js won't start a second render on
        // one that's still busy), then the finished page is copied across.
        const vp = page.getViewport({ scale: 2 });
        const off = document.createElement('canvas');
        off.width = vp.width; off.height = vp.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
        if (!alive) return;
        cv.width = off.width; cv.height = off.height;
        cv.getContext('2d').drawImage(off, 0, 0);
      } catch { /* preview only — Print / Download still work */ }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [form, tab]);

  const dirty = JSON.stringify(form) !== savedRef.current;
  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setStatus(''); };

  function startNew() {
    if (tab === 'form' && dirty && !window.confirm('Start a new form? What you typed on this one has not been saved.')) return;
    const b = blank();
    setForm(b); savedRef.current = JSON.stringify(b); setEditingId(null); setDelay(false); setStatus(''); setTab('form');
  }
  function openClaim(c) {
    const f = { ...blank(), ...Object.fromEntries(ALL_KEYS.map(k => [k, c[k] || ''])) };
    setForm(f); savedRef.current = JSON.stringify(f); setEditingId(c.id);
    setDelay(DELAY_QUESTIONS.some(x => f[x.key])); setStatus(''); setTab('form');
  }
  function backToList() {
    if (dirty && !window.confirm('Leave without saving? Your changes will be lost.')) return;
    setTab('list'); setStatus('');
  }

  async function save() {
    if (!String(form.ro || '').trim()) { setStatus('❌ Enter the R.O. Number first.'); return; }
    setBusy(true); setStatus('💾 Saving…');
    const now = new Date().toISOString();
    const id = editingId || newId();
    const clean = Object.fromEntries(ALL_KEYS.map(k => [k, String(form[k] || '').trim()]));
    try {
      const next = await updateRentalClaims(cur => {
        const have = cur.claims.find(c => c.id === id);
        const rec = have
          ? { ...have, ...clean, updatedAt: now, updatedBy: currentUser }
          : { id, ...clean, createdAt: now, createdBy: currentUser, updatedAt: now, updatedBy: currentUser };
        return { ...cur, claims: have ? cur.claims.map(c => (c.id === id ? rec : c)) : [rec, ...cur.claims] };
      }, `${editingId ? 'edit' : 'new'} RO ${clean.ro}`);
      setClaims(next.claims);
      setEditingId(id);
      setForm(clean); savedRef.current = JSON.stringify(clean);
      setStatus(`✅ Saved — RO ${clean.ro} is on the site. Print or download it any time.`);
    } catch (e) { setStatus(`❌ ${e.message || 'Save failed.'} Try again.`); }
    setBusy(false);
  }

  async function remove(c) {
    if (!window.confirm(`Delete the rental claim form for RO ${c.ro}${c.customer ? ` (${c.customer})` : ''}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const next = await updateRentalClaims(cur => ({ ...cur, claims: cur.claims.filter(x => x.id !== c.id) }), `delete RO ${c.ro}`);
      setClaims(next.claims);
    } catch (e) { window.alert(e.message || 'Delete failed.'); }
    setBusy(false);
  }

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (claims || [])
      .filter(c => !terms.length || terms.every(t => [c.ro, c.customer, c.createdBy].join(' ').toLowerCase().includes(t)))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [claims, q]);

  const field = (qq) => (
    <div key={qq.key}>
      <label style={lbl}>{qq.label}</label>
      {qq.pair ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="date" value={form[qq.key]} onChange={set(qq.key)} style={input} />
          <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: 13 }}>through</span>
          <input type="date" value={form[qq.pair]} onChange={set(qq.pair)} style={input} />
        </div>
      ) : (
        <input type={qq.type} value={form[qq.key]} onChange={set(qq.key)} style={{ ...input, ...(qq.key === 'managerSign' ? { fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif' } : null) }}
          placeholder={qq.key === 'ro' ? 'e.g. 781724' : ''} inputMode={qq.key === 'ro' ? 'numeric' : undefined} />
      )}
    </div>
  );
  const tabBtn = (k, label, onClick) => (
    <button onClick={onClick} style={{ background: tab === k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${tab === k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: tab === k ? '#6ee7f9' : '#94a3b8', borderRadius: 9, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13.5 }}>{label}</button>
  );

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="adv-title">📄 Rental Claim Form</div>
          <div className="adv-sub">Hyundai rental claim (RCF 3/20/2018) — fill in, save, print or download</div>
        </div>
        <button className="secondary" onClick={() => { if (tab === 'form' && dirty && !window.confirm('Leave without saving? Your changes will be lost.')) return; onBack(); }}>{backLabel}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {tabBtn('list', `📋 Saved forms${claims ? ` (${claims.length})` : ''}`, () => (tab === 'form' ? backToList() : null))}
        {tabBtn('form', editingId ? `✏️ Editing RO ${form.ro || ''}` : '➕ Create new form', () => (tab === 'form' ? null : startNew()))}
        {tab === 'form' && editingId && <button style={btn('74,222,128')} onClick={startNew}>➕ New form</button>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 40px 40px' }}>
        {tab === 'list' ? (
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search RO # or customer…" style={{ ...input, maxWidth: 360 }} />
              <div style={{ flex: 1 }} />
              <button style={{ ...btn('74,222,128'), fontSize: 14.5, padding: '10px 20px' }} onClick={startNew}>➕ Create new form</button>
            </div>
            {claims === null ? <div style={{ color: '#94a3b8' }}>Loading…</div>
              : !shown.length ? (
                <div style={{ ...card, textAlign: 'center', color: '#94a3b8', padding: '40px 20px', fontSize: 14.5 }}>
                  {claims.length ? `No forms match “${q}”.` : <>No rental claim forms yet. Click <b style={{ color: '#86efac' }}>➕ Create new form</b> to make the first one.</>}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {shown.map(c => (
                    <div key={c.id} onClick={() => openClaim(c)} title="Open to edit"
                      style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', cursor: 'pointer' }}>
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>RO {c.ro}{c.customer && <span style={{ color: '#93c5fd', fontWeight: 800 }}> · {c.customer}</span>}</div>
                        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3 }}>
                          {c.arrived ? `Arrived ${fmtDate(c.arrived)}` : 'Arrival not entered'}{c.pickedUp ? ` → picked up ${fmtDate(c.pickedUp)}` : ''}
                          {' · '}{c.updatedBy || c.createdBy} {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                        <button style={btn('110,231,249')} onClick={() => openClaim(c)}>✏️ Edit</button>
                        <button style={btn('192,132,252')} onClick={() => printClaim(c)}>🖨 Print</button>
                        <button style={btn('74,222,128')} onClick={() => downloadClaim(c)}>⬇ Download</button>
                        <button disabled={busy} style={btn('248,113,113', false)} onClick={() => remove(c)}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: 1400, margin: '0 auto' }}>
            {/* Questions — same order as the paper form */}
            <div style={{ flex: '1 1 420px', minWidth: 0, display: 'grid', gap: 14 }}>
              <div style={{ ...card, display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: '#6ee7f9' }}>Answer what applies — leave the rest blank</div>
                <div>
                  <label style={lbl}>Customer <span style={{ color: '#64748b', fontWeight: 700 }}>(for the saved list only — not printed)</span></label>
                  <input value={form.customer} onChange={set('customer')} style={input} placeholder="Customer name" />
                </div>
                {CLAIM_QUESTIONS.map(field)}
              </div>
              <div style={{ ...card, display: 'grid', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14.5, fontWeight: 900, color: '#fde68a' }}>
                  <input type="checkbox" checked={delay} onChange={e => setDelay(e.target.checked)} style={{ width: 18, height: 18 }} />
                  Was there a delay in pick up?
                </label>
                {delay && DELAY_QUESTIONS.map(field)}
              </div>
              <div style={{ position: 'sticky', bottom: 0, ...card, background: 'rgba(15,23,42,.96)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy} style={{ ...btn('74,222,128'), fontSize: 15, padding: '11px 22px' }} onClick={save}>{busy ? '⏳ Saving…' : editingId ? '💾 Save changes' : '💾 Save form'}</button>
                <button style={btn('192,132,252')} onClick={() => printClaim(form)}>🖨 Print</button>
                <button style={btn('110,231,249')} onClick={() => downloadClaim(form)}>⬇ Download PDF</button>
                {dirty && !busy && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fbbf24' }}>● Not saved yet</span>}
                {status && <span style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
              </div>
            </div>
            {/* The form itself, live */}
            <div style={{ flex: '1 1 520px', minWidth: 0, position: 'sticky', top: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 6 }}>PREVIEW — THIS IS WHAT PRINTS</div>
              <canvas ref={canvasRef} style={{ display: 'block', width: '100%', maxWidth: 'calc((100vh - 200px) * 8.5 / 11)', aspectRatio: '8.5 / 11', background: '#fff', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
