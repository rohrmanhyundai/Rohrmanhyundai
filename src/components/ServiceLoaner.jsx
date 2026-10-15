import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { uploadServiceLoanerToS3, deleteS3ObjectByUrl } from '../utils/s3';
import { readLoanerContract, fieldWarnings, isPdf } from '../utils/serviceLoaner';

// ── Service Loaner ────────────────────────────────────────────────────────────
// Signed loaner contracts (Vehicle Use Agreement face page). Upload Contract:
// pick the scanned PDF → the reader fills customer, RO, loaner VIN/year/make/
// model and date/time out → the advisor checks/corrects them → Save stores the
// PDF in S3 and the fields in data/service-loaner/contracts.json. Contracts:
// searchable list; anyone with the page can open/print, managers can delete.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
// Row actions: one size and shape whether it's a link or a button.
const actionBtn = (rgb) => ({ ...btn(rgb), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 32, minWidth: 82, padding: '0 12px', boxSizing: 'border-box', lineHeight: 1, margin: 0 });
const th = { textAlign: 'left', padding: '9px 10px', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid rgba(148,163,184,.25)', whiteSpace: 'nowrap' };
// App.css clips every td (fixed layout + ellipsis); this table sizes to its
// content so the Open / Print / Delete buttons never get cut off.
const td = { padding: '9px 10px', fontSize: 14, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.1)', verticalAlign: 'middle', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' };

const EMPTY = { firstName: '', lastName: '', ro: '', vin: '', year: '', make: '', model: '', dateOut: '', timeOut: '' };
const FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['ro', 'RO #'], ['vin', 'Loaner VIN'],
  ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['dateOut', 'Date out', 'date'], ['timeOut', 'Time out', 'time'],
];

const fmtDate = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : '';
};
const fmtTime = (t) => {
  const m = String(t || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

// Print the stored PDF without leaving the page; if the bucket won't hand the
// bytes over (CORS), open it in a tab where the browser's own Print works.
async function printContract(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const blobUrl = URL.createObjectURL(await res.blob());
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = blobUrl;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank', 'noopener'); }
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(blobUrl); }, 60000);
    };
    document.body.appendChild(frame);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export default function ServiceLoaner({ currentUser, currentRole, onBack, backLabel = '← Back', initialTab, io }) {
  const { loadServiceLoaners, updateServiceLoaners } = io || github;
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [tab, setTab] = useState(initialTab === 'upload' ? 'upload' : 'list');
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');       // local preview of the chosen file
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadServiceLoaners().then(d => { if (alive) { setContracts(d.contracts || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  async function onFile(f) {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = '';
    setStatus('');
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
    setDraft({ ...EMPTY });
    setReading(true);
    try {
      setDraft(await readLoanerContract(f));
    } catch (e) {
      setStatus(`⚠ ${e.message || 'Could not read the contract.'} Fill the fields in by hand.`);
    }
    setReading(false);
  }

  function cancelUpload() {
    setFile(null); setFileUrl(''); setDraft(null); setStatus('');
  }

  async function save() {
    if (!file || !draft) return;
    setBusy(true); setStatus('Saving…');
    try {
      const url = await uploadServiceLoanerToS3(file);
      const rec = {
        id: `sl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        ...draft,
        vin: draft.vin.trim().toUpperCase(),
        fileUrl: url, fileName: file.name || 'contract.pdf',
        uploadedAt: new Date().toISOString(), by: currentUser,
      };
      const next = await updateServiceLoaners(cur => ({ ...cur, contracts: [rec, ...cur.contracts] }),
        `upload RO ${rec.ro || '(none)'}`);
      setContracts(next.contracts);
      cancelUpload();
      setStatus(`✓ Saved ${rec.firstName} ${rec.lastName}'s contract.`);
      setTab('list');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function remove(c) {
    if (!isManager) return;
    if (!window.confirm(`Delete the loaner contract for ${c.firstName} ${c.lastName}${c.ro ? ` (RO ${c.ro})` : ''}? This can't be undone.`)) return;
    setBusy(true); setStatus('');
    try {
      const next = await updateServiceLoaners(cur => ({ ...cur, contracts: cur.contracts.filter(x => x.id !== c.id) }),
        `delete RO ${c.ro || '(none)'}`);
      setContracts(next.contracts);
      try { await deleteS3ObjectByUrl(c.fileUrl); } catch {}
      setStatus('✓ Contract deleted.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Delete failed.'}`);
    }
    setBusy(false);
  }

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = [...contracts].sort((a, b) =>
      `${b.dateOut || ''}${b.timeOut || ''}${b.uploadedAt || ''}`.localeCompare(`${a.dateOut || ''}${a.timeOut || ''}${a.uploadedAt || ''}`));
    if (!terms.length) return list;
    return list.filter(c => {
      const hay = [c.firstName, c.lastName, c.ro, c.vin, c.year, c.make, c.model, fmtDate(c.dateOut), c.by].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [contracts, q]);

  const warnings = draft && !reading ? fieldWarnings(draft) : [];
  const dupe = draft && draft.ro ? contracts.find(c => c.ro && c.ro === draft.ro) : null;

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ ...btn(k === 'upload' ? '74,222,128' : '110,231,249', tab === k), fontSize: 14, padding: '9px 18px' }}>{label}</button>
  );

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="adv-title">🚙 Service Loaner</div>
          <div className="adv-sub">Signed loaner contracts — upload, look up, view and print</div>
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {tabBtn('list', `📋 Contracts (${contracts.length})`)}
        {tabBtn('upload', '📤 Upload Contract')}
        {status && <span style={{ fontSize: 13.5, fontWeight: 800, marginLeft: 8, color: status.startsWith('❌') ? '#fca5a5' : status.startsWith('⚠') ? '#fde68a' : '#86efac' }}>{status}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 40px 40px' }}>
        <div style={{ maxWidth: 1300, margin: '0 auto' }}>
          {tab === 'upload' ? (
            !draft ? (
              <div style={card}>
                <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Upload a signed loaner contract</div>
                <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                  Scan the signed <b>Vehicle Use Agreement</b> to PDF and choose it here. The customer, RO, loaner VIN, year, make, model and
                  date/time out are read for you — check them before saving.
                </div>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/*" style={{ display: 'none' }} onChange={e => onFile(e.target.files && e.target.files[0])} />
                <button style={{ ...btn('74,222,128'), fontSize: 15, padding: '11px 22px', marginTop: 14 }} onClick={() => fileRef.current && fileRef.current.click()}>📤 Choose contract PDF</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) 1fr', gap: 16, alignItems: 'start' }}>
                <div style={card}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', marginBottom: 2 }}>{reading ? '🔎 Reading the contract…' : 'Check the fields'}</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 12, wordBreak: 'break-all' }}>{file && file.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {FIELDS.map(([k, label, type]) => (
                      <label key={k} style={{ display: 'grid', gap: 4, gridColumn: k === 'vin' || k === 'model' ? '1 / -1' : undefined }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>{label}</span>
                        <input type={type || 'text'} value={draft[k] || ''} disabled={reading || busy}
                          onChange={e => setDraft(d => ({ ...d, [k]: k === 'vin' ? e.target.value.toUpperCase() : e.target.value }))}
                          style={{ ...inputStyle, letterSpacing: k === 'vin' ? '.06em' : 0, colorScheme: 'dark' }} />
                      </label>
                    ))}
                  </div>
                  {warnings.length > 0 && (
                    <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 10, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', color: '#fde68a', fontSize: 13 }}>
                      <b>Check:</b> {warnings.join(' · ')}
                    </div>
                  )}
                  {dupe && (
                    <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.35)', color: '#fca5a5', fontSize: 13 }}>
                      RO {dupe.ro} already has a contract on file ({dupe.firstName} {dupe.lastName}, uploaded {new Date(dupe.uploadedAt).toLocaleDateString()}).
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button disabled={reading || busy || !draft.firstName && !draft.lastName} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={save}>
                      {busy ? 'Saving…' : '✓ Save contract'}
                    </button>
                    <button disabled={busy} style={btn('148,163,184', false)} onClick={cancelUpload}>Cancel</button>
                  </div>
                </div>
                <div style={{ ...card, padding: 8, height: 'calc(100vh - 230px)', minHeight: 480 }}>
                  {file && isPdf(file)
                    ? <iframe title="Contract preview" src={fileUrl} style={{ width: '100%', height: '100%', border: 0, borderRadius: 10, background: '#fff' }} />
                    : <img alt="Contract preview" src={fileUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                </div>
              </div>
            )
          ) : (
            <div style={card}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search name, RO, VIN, model…"
                style={{ ...inputStyle, maxWidth: 460, marginBottom: 14 }} />
              {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
                : contracts.length === 0 ? <div style={{ color: '#94a3b8' }}>No loaner contracts yet — add one on the Upload Contract tab.</div>
                : shown.length === 0 ? <div style={{ color: '#94a3b8' }}>Nothing matches “{q}”.</div>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                      <thead><tr>
                        <th style={th}>Customer</th><th style={th}>RO #</th><th style={th}>Loaner VIN</th><th style={th}>Year</th>
                        <th style={th}>Make</th><th style={th}>Model</th><th style={th}>Out</th><th style={th}>Uploaded</th><th style={th}></th>
                      </tr></thead>
                      <tbody>
                        {shown.map(c => (
                          <tr key={c.id}>
                            <td style={{ ...td, fontWeight: 800 }}>{c.firstName} {c.lastName}</td>
                            <td style={td}>{c.ro || <span style={{ color: '#64748b' }}>—</span>}</td>
                            <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, whiteSpace: 'nowrap' }}>{c.vin}</td>
                            <td style={td}>{c.year}</td>
                            <td style={td}>{c.make}</td>
                            <td style={td}>{c.model}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(c.dateOut)} {fmtTime(c.timeOut)}</td>
                            <td style={{ ...td, fontSize: 12.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>{c.by}<br />{c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString() : ''}</td>
                            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                <a href={c.fileUrl} target="_blank" rel="noopener noreferrer" style={{ ...actionBtn('110,231,249'), textDecoration: 'none' }}>📄 Open</a>
                                <button style={actionBtn('196,181,253')} onClick={() => printContract(c.fileUrl)}>🖨 Print</button>
                                {isManager && <button disabled={busy} title="Delete contract" style={actionBtn('248,113,113')} onClick={() => remove(c)}>🗑 Delete</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
