import React, { useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { uploadServiceLoanerToS3 } from '../utils/s3';
import { readLoanerContractPages, splitPdfPage, planBulk, isPdf } from '../utils/serviceLoaner';

// ── 📚 Bulk Upload (Service Loaner → Contracts) ──────────────────────────────
// One scanned PDF with many contracts, one face page each. Every page is read
// (utils/serviceLoaner readLoanerContractPages), matched to the contracts on
// file (planBulk) and shown for checking: NEW contracts are added, matches are
// UPDATED (blank fields filled in, the page added as the original or — when it
// has a Date IN — the completed/returned copy), the rest skipped. Nothing is
// uploaded or saved until Apply; each page is then stored as its own PDF.

const card = { background: '#0f172a', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const cell = { padding: '8px 10px', fontSize: 13.5, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.12)', verticalAlign: 'top', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' };
const head = { ...cell, fontSize: 11.5, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left' };
const LABEL = { firstName: 'First', lastName: 'Last', ro: 'RO', raNo: 'RA #', vin: 'VIN', year: 'Year', make: 'Make', model: 'Model', dateOut: 'Out date', timeOut: 'Out time', dateIn: 'In date', timeIn: 'In time' };
const md = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };
const RECORD_KEYS = ['firstName', 'lastName', 'ro', 'raNo', 'vin', 'year', 'make', 'model', 'dateOut', 'timeOut', 'dateIn', 'timeIn'];
const newId = () => `sl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function BulkContractUpload({ contracts, currentUser, io, onDone, onClose }) {
  const readPages = io?.readLoanerContractPages || readLoanerContractPages;
  const splitPage = io?.splitPdfPage || splitPdfPage;
  const upload = io?.uploadServiceLoanerToS3 || uploadServiceLoanerToS3;
  const { updateServiceLoaners } = io || github;
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);   // { done, total } while reading
  const [rows, setRows] = useState(null);
  const [off, setOff] = useState({});               // page → true when unticked
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [zoom, setZoom] = useState(null);           // thumb shown large

  async function pick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!isPdf(f)) { setMsg('⚠ Choose the scanned PDF of the contracts.'); return; }
    setFile(f); setRows(null); setOff({}); setMsg('');
    setProgress({ done: 0, total: 0 });
    try {
      const pages = await readPages(f, (done, total) => setProgress({ done, total }));
      setRows(planBulk(pages, contracts));
    } catch (err) {
      setMsg(`❌ ${err.message || 'Could not read that PDF.'}`);
    }
    setProgress(null);
  }

  const counts = useMemo(() => {
    const r = rows || [];
    const on = (x) => !off[x.page];
    return {
      add: r.filter(x => x.action === 'new' && on(x)).length,
      upd: r.filter(x => x.action === 'update' && on(x)).length,
      same: r.filter(x => x.action === 'same').length,
      skip: r.filter(x => x.action === 'skip').length,
    };
  }, [rows, off]);

  async function apply() {
    if (!rows || busy) return;
    const todo = rows.filter(r => (r.action === 'new' || r.action === 'update') && !off[r.page]);
    // A returned copy joined to a new contract only counts if that contract is going in.
    const live = todo.filter(r => !r.joinPage || todo.some(x => x.page === r.joinPage));
    if (!live.length) return;
    setBusy(true);
    const now = new Date().toISOString();
    const base = (file.name || 'contracts.pdf').replace(/\.pdf$/i, '');
    try {
      const store = async (r, kind) => {
        const name = `${base}-p${r.page}${kind === 'completed' ? '-returned' : ''}.pdf`;
        return { url: await upload(await splitPage(file, r.page, name)), name };
      };
      const news = new Map();      // page → new record
      const changes = new Map();   // contract id → changes
      let i = 0;
      for (const r of live) {
        i++;
        setMsg(`⏳ Saving page ${r.page} (${i} of ${live.length})…`);
        const att = r.attach || '';
        const orig = /original|both/.test(att) ? await store(r, 'original') : null;
        const comp = /completed|both/.test(att) ? await store(r, 'completed') : null;
        const files = {
          ...(orig ? { fileUrl: orig.url, fileName: orig.name } : {}),
          ...(comp ? { completedUrl: comp.url, completedFileName: comp.name, completedAt: now, completedBy: currentUser } : {}),
        };
        if (r.action === 'new') {
          news.set(r.page, {
            id: newId(), ...Object.fromEntries(RECORD_KEYS.map(k => [k, r.fields[k] || ''])), notes: '',
            ...files, uploadedAt: now, by: currentUser, bulk: true,
          });
        } else if (r.joinPage) {
          // The other copy of a contract added from this upload: its files, and
          // any boxes it has that the first page didn't (Date IN on the returned one).
          const rec = news.get(r.joinPage);
          Object.assign(rec, files);
          for (const k of RECORD_KEYS) if (!rec[k] && r.fields[k]) rec[k] = r.fields[k];
        } else {
          changes.set(r.target.id, { ...(changes.get(r.target.id) || {}), ...r.fill, ...files, editedAt: now, editedBy: currentUser });
        }
      }
      setMsg('⏳ Saving the contracts…');
      const next = await updateServiceLoaners(cur => ({
        ...cur,
        contracts: [...news.values(), ...cur.contracts.map(c => (changes.has(c.id) ? { ...c, ...changes.get(c.id) } : c))],
      }), `bulk upload (${news.size} new, ${changes.size} updated)`);
      onDone(next.contracts, `✓ Bulk upload: ${news.size} added, ${changes.size} updated.`);
    } catch (err) {
      setMsg(`❌ ${err.message || 'Save failed.'} Nothing was changed on the contracts — try Apply again.`);
      setBusy(false);
    }
  }

  const actionTag = (r) => r.action === 'new' ? <b style={{ color: '#4ade80' }}>NEW</b>
    : r.action === 'update' ? <b style={{ color: '#fbbf24' }}>UPDATE</b>
    : r.action === 'same' ? <span style={{ color: '#94a3b8' }}>same</span>
    : <span style={{ color: '#fca5a5' }}>skip</span>;
  const whatHappens = (r) => {
    if (r.action === 'skip' || r.action === 'same') return r.why;
    const bits = [];
    if (r.action === 'new') bits.push(r.attach === 'both' || r.attach === 'completed+' ? 'Added (already returned — this page is both copies)' : 'Added');
    if (r.joinPage) bits.push(`${r.attach === 'completed' ? 'Returned' : 'Original'} copy for page ${r.joinPage}'s contract`);
    if (r.target) {
      if (r.attach === 'completed') bits.push('Adds the returned (completed) copy');
      if (r.attach === 'original') bits.push('Adds the original copy');
      const f = Object.keys(r.fill || {});
      if (f.length) bits.push(`Fills in: ${f.map(k => LABEL[k] || k).join(', ')}`);
    }
    return bits.join(' · ');
  };

  return (
    <div onClick={() => !busy && !progress && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 1400, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#f1f5f9' }}>📚 Bulk Upload contracts</div>
            <div style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.5 }}>
              One scanned PDF with every contract — one face page per contract. Each page is read, then <b>added</b> as a new contract or <b>updates</b> the one on file
              (blank boxes filled in; a page with a Date IN goes on as the returned copy). Nothing is saved until you click Apply.
            </div>
          </div>
          {!busy && !progress && <button style={btn('148,163,184', false)} onClick={onClose}>✕</button>}
        </div>

        <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={pick} style={{ display: 'none' }} />
        {!rows && !progress && (
          <button onClick={() => fileRef.current?.click()} style={{ ...btn('74,222,128'), fontSize: 15, padding: '14px 24px', marginTop: 16 }}>📄 Choose the contracts PDF</button>
        )}
        {progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: '#93c5fd', fontSize: 15, fontWeight: 800 }}>
              ⏳ Reading {file?.name}{progress.total ? ` — page ${progress.done} of ${progress.total}` : '…'}
            </div>
            <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: progress.total ? `${Math.round(progress.done / progress.total * 100)}%` : '4%', background: '#60a5fa', transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6 }}>About 5–10 seconds a page. Keep this window open.</div>
          </div>
        )}
        {msg && <div style={{ marginTop: 12, fontSize: 14, fontWeight: 800, color: msg.startsWith('❌') || msg.startsWith('⚠') ? '#fca5a5' : '#93c5fd' }}>{msg}</div>}

        {rows && (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, fontSize: 14.5, fontWeight: 800 }}>
              <span style={{ color: '#4ade80' }}>➕ {counts.add} new</span>
              <span style={{ color: '#fbbf24' }}>✏️ {counts.upd} updates</span>
              <span style={{ color: '#94a3b8' }}>✓ {counts.same} already on file</span>
              {counts.skip > 0 && <span style={{ color: '#fca5a5' }}>⤼ {counts.skip} skipped</span>}
              <span style={{ color: '#64748b', fontWeight: 600 }}>{file?.name} · {rows.length} page{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                <thead><tr>
                  <th style={head}></th><th style={head}>Page</th><th style={head}></th><th style={head}>Customer</th><th style={head}>RO / RA</th>
                  <th style={head}>Loaner</th><th style={head}>Out</th><th style={head}>In</th><th style={head}>What happens</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const f = r.fields || {};
                    const can = r.action === 'new' || r.action === 'update';
                    const on = can && !off[r.page];
                    return (
                      <tr key={r.page} style={{ opacity: can ? (on ? 1 : 0.45) : 0.6, background: r.action === 'new' && on ? 'rgba(74,222,128,.05)' : r.action === 'update' && on ? 'rgba(251,191,36,.05)' : undefined }}>
                        <td style={cell}>{can && <input type="checkbox" checked={on} disabled={busy} onChange={e => setOff(o => ({ ...o, [r.page]: !e.target.checked }))} style={{ width: 18, height: 18 }} />}</td>
                        <td style={cell}>{r.thumb ? <img src={r.thumb} alt={`Page ${r.page}`} onClick={() => setZoom(r.thumb)} title="Click to enlarge"
                          style={{ width: 54, height: 70, objectFit: 'cover', objectPosition: 'top', borderRadius: 5, border: '1px solid rgba(148,163,184,.3)', cursor: 'zoom-in', background: '#fff' }} /> : null}
                          <div style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center' }}>p{r.page}</div></td>
                        <td style={cell}>{actionTag(r)}</td>
                        <td style={cell}><b>{[f.firstName, f.lastName].filter(Boolean).join(' ') || '—'}</b></td>
                        <td style={cell}>{f.ro ? `RO ${f.ro}` : <span style={{ color: '#64748b' }}>no RO</span>}<div style={{ fontSize: 12, color: '#94a3b8' }}>{f.raNo ? `RA ${f.raNo}` : ''}</div></td>
                        <td style={cell}>{[f.year, f.make, f.model].filter(Boolean).join(' ') || '—'}<div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#94a3b8' }}>{f.vin}</div></td>
                        <td style={cell}>{md(f.dateOut) || '—'}<div style={{ fontSize: 12, color: '#94a3b8' }}>{f.timeOut}</div></td>
                        <td style={cell}>{f.dateIn ? <span style={{ color: '#86efac' }}>{md(f.dateIn)}<div style={{ fontSize: 12 }}>{f.timeIn}</div></span> : <span style={{ color: '#64748b' }}>—</span>}</td>
                        <td style={{ ...cell, whiteSpace: 'normal', minWidth: 240, fontSize: 12.5, color: r.action === 'skip' ? '#fca5a5' : '#cbd5e1' }}>
                          {whatHappens(r)}{r.target ? <div style={{ color: '#64748b', marginTop: 2 }}>On file: {[r.target.firstName, r.target.lastName].filter(Boolean).join(' ')}{r.target.ro ? ` · RO ${r.target.ro}` : ''}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>
              Untick anything that was read wrong — you can upload that one on its own with 📤 Upload Contract. Contracts already on file keep what's in them; only blank boxes are filled in.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button disabled={busy || !(counts.add + counts.upd)} onClick={apply}
                style={{ ...btn('74,222,128'), fontSize: 15, padding: '11px 22px', opacity: counts.add + counts.upd ? 1 : 0.5 }}>
                {busy ? '⏳ Saving…' : counts.add + counts.upd ? `✓ Apply — add ${counts.add}, update ${counts.upd}` : 'Nothing to change'}
              </button>
              <button disabled={busy} style={{ ...btn('96,165,250'), fontSize: 15, padding: '11px 22px' }} onClick={() => fileRef.current?.click()}>📄 Choose a different PDF</button>
              <button disabled={busy} style={{ ...btn('148,163,184', false), fontSize: 15, padding: '11px 22px' }} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
      {zoom && (
        <div onClick={e => { e.stopPropagation(); setZoom(null); }} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          <img src={zoom} alt="Page" style={{ maxWidth: '100%', maxHeight: '100%', background: '#fff', borderRadius: 6 }} />
        </div>
      )}
    </div>
  );
}
