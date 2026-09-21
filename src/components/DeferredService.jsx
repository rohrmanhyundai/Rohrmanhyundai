import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as github from '../utils/github';
import { parseDeferredPdf, mergeRows } from '../utils/deferredReport';
import { trackPage, trackAction } from '../utils/activityTracker';

// ── Deferred Service ──────────────────────────────────────────────────────────
// Opened from the Appointment Prep Calendar. The manager uploads the dealer's
// "Deferred Services" PDF (Settings tab — managers only); every RO on it is
// stored keyed by RO number, so later uploads add to the list and refresh any
// RO that appears again. Advisors filter by op code, advisor, date and text,
// see a short preview list (customer + previous RO), and click a row for the
// full line from the report. Settings is also where the manager gives each op
// code a plain-English description, which the filter chips then show.

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '—'); };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const CSS = `
.ds-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:14px 16px}
.ds-label{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
.ds-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:800;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:rgba(255,255,255,.04);color:#cbd5e1;white-space:nowrap;transition:all .12s}
.ds-chip:hover{border-color:rgba(110,231,249,.5);color:#e2e8f0}
.ds-chip.on{background:rgba(110,231,249,.18);border-color:rgba(110,231,249,.65);color:#67e8f9}
.ds-chip .n{font-size:10px;font-weight:900;color:#64748b;background:rgba(2,6,23,.5);border-radius:999px;padding:1px 6px}
.ds-chip.on .n{color:#a5f3fc}
.ds-in{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:9px;padding:8px 11px;font-size:13.5px;color:#e2e8f0;outline:none;color-scheme:dark}
.ds-in:focus{border-color:rgba(110,231,249,.6)}
.ds-row{display:grid;grid-template-columns:1fr 110px 130px 90px 24px;gap:10px;align-items:center;padding:11px 14px;border-radius:12px;border:1px solid rgba(148,163,184,.14);background:rgba(2,6,23,.4);cursor:pointer;transition:background .12s,border-color .12s}
.ds-row:hover{background:rgba(110,231,249,.06);border-color:rgba(110,231,249,.35)}
.ds-row.open{border-color:rgba(110,231,249,.6);background:rgba(110,231,249,.09)}
.ds-detail{border:1px solid rgba(110,231,249,.35);border-top:none;border-radius:0 0 12px 12px;background:rgba(2,6,23,.55);padding:14px 16px;margin-top:-6px;margin-bottom:4px}
.ds-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 18px}
.ds-kv .k{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.08em}
.ds-kv .v{font-size:13.5px;color:#f1f5f9;font-weight:600;margin-top:2px;word-break:break-word}
.ds-code{display:inline-block;border-radius:7px;padding:3px 8px;font-size:12px;font-weight:800;background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.35);color:#e9d5ff;margin:3px 4px 0 0}
.ds-code small{font-weight:600;color:#c4b5fd;margin-left:5px}
.ds-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
.ds-table th{font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:8px;border-bottom:1px solid rgba(148,163,184,.2)}
.ds-table td{padding:7px 8px;border-bottom:1px solid rgba(148,163,184,.1);overflow:visible;text-overflow:clip;white-space:normal;color:#e2e8f0;font-size:13px}
@media(max-width:720px){.ds-row{grid-template-columns:1fr 90px 24px}.ds-row .ds-hide{display:none}}
`;

const CODE_LABEL = (code, codes) => (codes && codes[code] && codes[code].description) ? codes[code].description : code;

export default function DeferredService({ currentUser, currentRole, onBack, io }) {
  // Storage functions — swappable (tests pass an in-memory version).
  const { loadDeferredRows, updateDeferredRows, loadDeferredCodes, updateDeferredCodes } = io || github;
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const me = firstWord(currentUser);
  const [tab, setTab] = useState('list');            // 'list' | 'settings'
  const [store, setStore] = useState(null);          // rows.json
  const [codes, setCodes] = useState({});            // codes.json
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  // Filters
  const [selCodes, setSelCodes] = useState(new Set());
  const [selAdvisors, setSelAdvisors] = useState(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [openRo, setOpenRo] = useState('');
  const [showAllCodes, setShowAllCodes] = useState(false);

  useEffect(() => { trackPage('deferred-service'); }, []);
  useEffect(() => {
    Promise.all([loadDeferredRows(), loadDeferredCodes()])
      .then(([r, c]) => { setStore(r); setCodes(c || {}); })
      .catch(() => { setStore({ byRo: {}, uploads: [] }); })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => Object.values((store && store.byRo) || {}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.ro).localeCompare(String(a.ro)))), [store]);

  // Counts for the chips (over everything, so a chip never disappears while you're using it)
  const codeCounts = useMemo(() => { const m = {}; rows.forEach(r => (r.codes || []).forEach(c => { m[c] = (m[c] || 0) + 1; })); return m; }, [rows]);
  const advisorCounts = useMemo(() => { const m = {}; rows.forEach(r => { const a = r.advisor || '—'; m[a] = (m[a] || 0) + 1; }); return m; }, [rows]);
  const allCodes = useMemo(() => Object.keys(codeCounts).sort((a, b) => codeCounts[b] - codeCounts[a] || a.localeCompare(b)), [codeCounts]);
  // Op codes that share a description are the same service (the DMS has
  // several codes for one job), so the filter works on SERVICES: one chip per
  // description, covering every code that carries it. A code with no
  // description is its own service. Counts are ROs with any code in the group.
  const services = useMemo(() => {
    const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const groups = new Map();   // key → { key, label, codes:Set }
    for (const c of allCodes) {
      const desc = codes[c] && codes[c].description ? codes[c].description.trim() : '';
      const key = desc ? `d:${norm(desc)}` : `c:${c}`;
      if (!groups.has(key)) groups.set(key, { key, label: desc || c, codes: new Set(), described: !!desc });
      groups.get(key).codes.add(c);
    }
    const list = [...groups.values()];
    for (const g of list) g.count = rows.filter(r => (r.codes || []).some(c => g.codes.has(c))).length;
    return list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [allCodes, codes, rows]);
  const serviceOfCode = useMemo(() => { const m = {}; services.forEach(g => g.codes.forEach(c => { m[c] = g; })); return m; }, [services]);
  const allAdvisors = useMemo(() => Object.keys(advisorCounts).sort(), [advisorCounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (selCodes.size && !(r.codes || []).some(c => serviceOfCode[c] && selCodes.has(serviceOfCode[c].key))) return false;
      if (selAdvisors.size && !selAdvisors.has(r.advisor || '—')) return false;
      if (from && (!r.date || r.date < from)) return false;
      if (to && (!r.date || r.date > to)) return false;
      if (needle) {
        const hay = [r.customer, r.ro, r.phone, r.email, r.vin, r.vehicle, r.advisor, (r.codes || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, selCodes, selAdvisors, from, to, q, serviceOfCode]);

  const toggle = (set, setter, key) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); setter(n); setOpenRo(''); };
  const clearAll = () => { setSelCodes(new Set()); setSelAdvisors(new Set()); setFrom(''); setTo(''); setQ(''); setOpenRo(''); };
  const anyFilter = selCodes.size || selAdvisors.size || from || to || q.trim();

  // ── Upload (managers) ───────────────────────────────────────────────────
  async function handlePdf(file) {
    if (!file) return;
    setBusy('parse'); setStatus('📄 Reading the PDF…');
    try {
      const { rows: parsed, lastUpdate, warnings } = await parseDeferredPdf(file);
      const at = new Date().toISOString();
      let result = null;
      await updateDeferredRows(cur => {
        const { byRo, added, updated } = mergeRows(cur.byRo, parsed, at);
        result = { added, updated };
        const uploads = [{ at, by: currentUser || '', file: file.name, lastUpdate, rows: parsed.length }, ...(cur.uploads || [])].slice(0, 50);
        return { ...cur, byRo, uploads, updatedAt: at };
      });
      const fresh = await loadDeferredRows();
      setStore(fresh);
      setStatus(`✅ ${parsed.length} ROs read from ${file.name} — ${result.added} new, ${result.updated} refreshed${lastUpdate ? ` · report last updated ${fmtDate(lastUpdate)}` : ''}${warnings.length ? ` · ⚠️ ${warnings.length} line${warnings.length === 1 ? '' : 's'} skipped` : ''}`);
      trackAction('deferred-upload', file.name);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  // ── Op-code descriptions (managers) ─────────────────────────────────────
  const [draftCodes, setDraftCodes] = useState(null);   // { CODE: description } while editing
  useEffect(() => { if (tab === 'settings') setDraftCodes(Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, (v && v.description) || '']))); }, [tab, codes]);
  async function saveCodes() {
    setBusy('codes'); setStatus('');
    try {
      const at = new Date().toISOString();
      await updateDeferredCodes(cur => {
        const out = { ...cur };
        for (const [code, desc] of Object.entries(draftCodes || {})) {
          const d = String(desc || '').trim();
          if (!d) { delete out[code]; continue; }
          if (!out[code] || out[code].description !== d) out[code] = { description: d, updatedAt: at, by: currentUser || '' };
        }
        return out;
      });
      setCodes(await loadDeferredCodes());
      setStatus('✅ Op-code descriptions saved.');
      trackAction('deferred-codes-save');
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  const uploads = (store && store.uploads) || [];
  const visibleServices = showAllCodes ? services : services.slice(0, 18);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔧 Deferred Service</div>
          <div className="adv-sub">{rows.length ? `${rows.length} repair orders with deferred work` : 'Declined & deferred work from the DMS report'}{uploads[0] ? ` · last upload ${new Date(uploads[0].at).toLocaleDateString()}` : ''}</div>
        </div>
        <div style={{ flex: 1 }} />
        {isManager && (
          <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 999, padding: 4 }}>
            {[['list', '🔍 Deferred Work'], ['settings', '⚙️ Settings']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className="secondary"
                style={{ borderRadius: 999, padding: '6px 14px', fontSize: 12.5, background: tab === k ? 'rgba(110,231,249,.18)' : 'transparent', borderColor: tab === k ? 'rgba(110,231,249,.5)' : 'transparent', color: tab === k ? '#67e8f9' : '#94a3b8' }}>
                {label}
              </button>
            ))}
          </div>
        )}
        <button className="secondary" onClick={onBack} style={{ marginLeft: 6 }}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>

          {tab === 'list' && (
            <>
              {/* Filters */}
              <div className="ds-card" style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="ds-in" style={{ flex: 1, minWidth: 220 }} placeholder="🔍 Search customer, RO #, phone, VIN, vehicle…" value={q} onChange={e => { setQ(e.target.value); setOpenRo(''); }} />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="ds-label">Date</span>
                    <input type="date" className="ds-in" value={from} onChange={e => { setFrom(e.target.value); setOpenRo(''); }} style={{ padding: '6px 9px' }} />
                    <span style={{ color: '#64748b' }}>→</span>
                    <input type="date" className="ds-in" value={to} onChange={e => { setTo(e.target.value); setOpenRo(''); }} style={{ padding: '6px 9px' }} />
                    {[['30d', 30], ['60d', 60], ['90d', 90]].map(([l, n]) => (
                      <button key={l} className={`ds-chip${from === daysAgo(n) && !to ? ' on' : ''}`} onClick={() => { setFrom(daysAgo(n)); setTo(''); setOpenRo(''); }}>{l}</button>
                    ))}
                  </div>
                  {anyFilter ? <button className="secondary" onClick={clearAll} style={{ fontSize: 12 }}>✕ Clear</button> : null}
                </div>

                <div>
                  <div className="ds-label" style={{ marginBottom: 6 }}>Service type <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· click to filter, click again to remove</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {visibleServices.map(g => (
                      <button key={g.key} className={`ds-chip${selCodes.has(g.key) ? ' on' : ''}`} onClick={() => toggle(selCodes, setSelCodes, g.key)}
                        title={g.described ? `Op code${g.codes.size === 1 ? '' : 's'}: ${[...g.codes].join(', ')}` : 'No description yet — set one in Settings'}>
                        {g.label} <span className="n">{g.count}</span>
                      </button>
                    ))}
                    {services.length > 18 && <button className="ds-chip" onClick={() => setShowAllCodes(v => !v)} style={{ color: '#67e8f9' }}>{showAllCodes ? 'Show fewer' : `+${services.length - 18} more`}</button>}
                    {!allCodes.length && !loading && <span style={{ fontSize: 12.5, color: '#64748b' }}>No report uploaded yet.</span>}
                  </div>
                </div>

                <div>
                  <div className="ds-label" style={{ marginBottom: 6 }}>Advisor</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {allAdvisors.map(a => (
                      <button key={a} className={`ds-chip${selAdvisors.has(a) ? ' on' : ''}`} onClick={() => toggle(selAdvisors, setSelAdvisors, a)}>
                        {a}{firstWord(a) === me ? ' (me)' : ''} <span className="n">{advisorCounts[a]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview list */}
              <div className="ds-card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff' }}>{anyFilter ? 'Matches' : 'All deferred work'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{loading ? 'Loading…' : `${filtered.length} of ${rows.length} repair orders`}{selCodes.size ? ` · ${services.filter(g => selCodes.has(g.key)).map(g => g.label).join(', ')}` : ''}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>Click a customer for the full line from the report</div>
                </div>
                <div className="ds-row" style={{ background: 'transparent', border: 'none', cursor: 'default', padding: '0 14px 6px' }}>
                  <div className="ds-label">Customer</div><div className="ds-label ds-hide">Previous RO</div><div className="ds-label ds-hide">Advisor</div><div className="ds-label">Date</div><div />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {filtered.slice(0, 300).map(r => {
                    const open = openRo === r.ro;
                    return (
                      <div key={r.ro}>
                        <div className={`ds-row${open ? ' open' : ''}`} onClick={() => setOpenRo(open ? '' : r.ro)}>
                          <div>
                            <div style={{ fontSize: 14.5, fontWeight: 900, color: '#f1f5f9' }}>{r.customer || <span style={{ color: '#64748b', fontStyle: 'italic' }}>No name on report</span>}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{r.vehicle} · {(r.codes || []).length} deferred item{(r.codes || []).length === 1 ? '' : 's'}</div>
                          </div>
                          <div className="ds-hide" style={{ fontSize: 14, fontWeight: 800, color: '#67e8f9' }}>RO {r.ro}</div>
                          <div className="ds-hide" style={{ fontSize: 12.5, color: '#cbd5e1' }}>{r.advisor}</div>
                          <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>{fmtDate(r.date)}</div>
                          <div style={{ color: '#94a3b8' }}>{open ? '▾' : '▸'}</div>
                        </div>
                        {open && (
                          <div className="ds-detail">
                            <div className="ds-kv">
                              <div><div className="k">Customer</div><div className="v">{r.customer || '—'}</div></div>
                              <div><div className="k">Previous RO</div><div className="v">{r.ro}</div></div>
                              <div><div className="k">RO date</div><div className="v">{fmtDate(r.date)}</div></div>
                              <div><div className="k">Advisor</div><div className="v">{r.advisor || '—'}</div></div>
                              <div><div className="k">Phone</div><div className="v"><a href={`tel:${r.phone}`} style={{ color: '#67e8f9', textDecoration: 'none' }}>{fmtPhone(r.phone)}</a></div></div>
                              <div><div className="k">Email</div><div className="v">{r.email || '—'}</div></div>
                              <div><div className="k">Vehicle</div><div className="v">{r.vehicle || '—'}</div></div>
                              <div><div className="k">VIN</div><div className="v" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.vin || '—'}</div></div>
                              <div><div className="k">Hours</div><div className="v">{r.hours == null ? '—' : r.hours.toFixed(1)}</div></div>
                              <div><div className="k">Labor & parts</div><div className="v" style={{ color: '#6ee7b7' }}>{money(r.amount)}</div></div>
                              {r.uploadedAt && <div><div className="k">From upload</div><div className="v" style={{ color: '#94a3b8', fontWeight: 500 }}>{new Date(r.uploadedAt).toLocaleDateString()}</div></div>}
                            </div>
                            <div className="k ds-label" style={{ marginTop: 12 }}>Deferred op codes</div>
                            <div>
                              {(r.codes || []).map((c, i) => (
                                <span key={i} className="ds-code" style={serviceOfCode[c] && selCodes.has(serviceOfCode[c].key) ? { background: 'rgba(110,231,249,.18)', borderColor: 'rgba(110,231,249,.6)', color: '#a5f3fc' } : {}}>
                                  {c}{codes[c] && codes[c].description ? <small>{codes[c].description}</small> : null}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!loading && !filtered.length && <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>{rows.length ? 'Nothing matches those filters.' : (isManager ? 'Upload the Deferred Services PDF under Settings to get started.' : 'No deferred-service report has been uploaded yet.')}</div>}
                  {filtered.length > 300 && <div style={{ color: '#94a3b8', textAlign: 'center', fontSize: 12, padding: 8 }}>Showing the first 300 — narrow the filters to see the rest.</div>}
                </div>
              </div>
            </>
          )}

          {tab === 'settings' && isManager && (
            <>
              <div className="ds-card">
                <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff', marginBottom: 6 }}>📥 Upload Deferred Services report (.pdf)</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 10 }}>
                  The DMS "Deferred Services" PDF. Every repair order on it is added to the list; an RO that's already here is refreshed with the newer line. Upload as often as you like — nothing is thrown away.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept=".pdf,application/pdf" disabled={!!busy} onChange={e => handlePdf(e.target.files && e.target.files[0])} style={{ fontSize: 12, color: '#cbd5e1' }} />
                  {busy === 'parse' && <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>⏳ Reading…</span>}
                </div>
                {status && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: status.startsWith('❌') ? '#f87171' : '#6ee7b7' }}>{status}</div>}
                {uploads.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="ds-label" style={{ marginBottom: 6 }}>Upload history</div>
                    <table className="ds-table"><thead><tr><th>When</th><th>By</th><th>File</th><th>Report updated</th><th>ROs</th></tr></thead>
                      <tbody>{uploads.slice(0, 10).map((u, i) => <tr key={i}><td>{new Date(u.at).toLocaleString()}</td><td>{u.by}</td><td>{u.file}</td><td>{fmtDate(u.lastUpdate)}</td><td>{u.rows}</td></tr>)}</tbody></table>
                  </div>
                )}
              </div>

              <div className="ds-card">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff' }}>🏷️ Deferred op codes</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{allCodes.length} codes seen on the reports · give each a description advisors will recognise. Codes with the <b>same description</b> are treated as one service (one filter chip).</div>
                  <div style={{ flex: 1 }} />
                  <button onClick={saveCodes} disabled={!!busy || !draftCodes} style={{ fontSize: 13 }}>{busy === 'codes' ? '⏳ Saving…' : '💾 Save descriptions'}</button>
                </div>
                {!allCodes.length ? <div style={{ fontSize: 12.5, color: '#64748b' }}>Codes appear here after the first upload.</div> : (
                  <table className="ds-table">
                    <thead><tr><th style={{ width: 150 }}>Op code</th><th style={{ width: 70 }}>ROs</th><th>Description shown to advisors</th></tr></thead>
                    <tbody>
                      {allCodes.map(c => (
                        <tr key={c}>
                          <td style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800, color: '#e9d5ff' }}>{c}</td>
                          <td style={{ color: '#94a3b8' }}>{codeCounts[c]}</td>
                          <td>
                            <input className="ds-in" style={{ width: '100%', padding: '6px 9px' }} placeholder="e.g. Cabin air filter" value={(draftCodes && draftCodes[c]) || ''} onChange={e => setDraftCodes(d => ({ ...(d || {}), [c]: e.target.value }))} />
                            {serviceOfCode[c] && serviceOfCode[c].codes.size > 1 && (
                              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>Same service as {[...serviceOfCode[c].codes].filter(x => x !== c).join(', ')} — shown as one filter chip.</div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {Object.keys(codes).filter(c => !codeCounts[c]).map(c => (
                        <tr key={c} style={{ opacity: .6 }}>
                          <td style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800, color: '#c4b5fd' }}>{c}</td>
                          <td style={{ color: '#64748b' }}>0</td>
                          <td><input className="ds-in" style={{ width: '100%', padding: '6px 9px' }} value={(draftCodes && draftCodes[c]) || ''} onChange={e => setDraftCodes(d => ({ ...(d || {}), [c]: e.target.value }))} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
