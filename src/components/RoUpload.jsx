import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  loadAwaitingData, saveAwaitingData,
  loadWipData, saveWipData, listWipTechs, loadDashboardData,
} from '../utils/github';

// Columns we read from the dealership's open-RO report.
const FIELDS = [
  { key: 'ro',       label: 'RO #',            required: true,  hints: ['ro#', 'ro #', 'ro', 'repair order', 'ro number'] },
  { key: 'advisor',  label: 'Service Advisor', required: false, hints: ['service advisor', 'advisor', 'writer'] },
  { key: 'vehicle',  label: 'Vehicle',         required: false, hints: ['vehicle', 'veh', 'year make model', 'unit'] },
  { key: 'tech',     label: 'Technician',      required: false, hints: ['technician', 'tech'] },
  { key: 'userFlag', label: 'User Flag',       required: true,  hints: ['user flag', 'flag', 'userflag'] },
];

const norm = (v) => String(v ?? '').trim().toLowerCase();
const roKey = (v) => String(v ?? '').trim().toUpperCase();
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Only purple or green User Flags get added to the website.
function flagAllowed(v) {
  const f = norm(v);
  return f.includes('purple') || f.includes('green');
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(norm);
    const hasRo = cells.some(c => c === 'ro' || c === 'ro#' || c.includes('repair order') || /\bro\b/.test(c));
    if (hasRo && cells.filter(Boolean).length >= 2) return i;
  }
  return -1;
}
function autoMap(headers) {
  const map = {};
  FIELDS.forEach(f => {
    let idx = headers.findIndex(h => f.hints.includes(norm(h)));
    if (idx === -1) idx = headers.findIndex(h => f.hints.some(hint => norm(h).includes(hint)));
    map[f.key] = idx;
  });
  return map;
}

export default function RoUpload({ onBack, currentUser }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // Site state for comparison: [{ ro, where }]  where = tech name or 'Cars Awaiting'
  const [siteRos, setSiteRos] = useState(null); // null = not loaded yet
  const [siteLoading, setSiteLoading] = useState(false);
  const [descs, setDescs] = useState({}); // RO# (upper) -> description typed before saving
  const setDesc = (ro, v) => setDescs(d => ({ ...d, [roKey(ro)]: v }));
  const [copiedRo, setCopiedRo] = useState('');
  const [excluded, setExcluded] = useState({}); // RO# (upper) -> true: dropped from the add list
  const [removingRo, setRemovingRo] = useState('');

  function copyRo(ro) {
    const v = String(ro || '').trim();
    if (!v) return;
    try { navigator.clipboard?.writeText(v); } catch {}
    setCopiedRo(v);
    setTimeout(() => setCopiedRo(c => (c === v ? '' : c)), 1200);
  }

  async function handleFile(file) {
    if (!file) return;
    setError(''); setStatus(''); setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!rows || rows.length === 0) throw new Error('The file appears to be empty.');
      const hi = findHeaderRow(rows);
      if (hi === -1) throw new Error('Could not find a header row with an "RO" / "Repair Order" column.');
      const hdr = (rows[hi] || []).map(h => String(h ?? '').trim());
      const body = rows.slice(hi + 1).filter(r => (r || []).some(c => String(c ?? '').trim() !== ''));
      setHeaders(hdr);
      setDataRows(body);
      setMapping(autoMap(hdr));
      // Kick off the site scan so we can flag duplicates + stale ROs.
      loadSiteRos();
    } catch (e) {
      setError(e.message || 'Could not read the file.');
      setHeaders([]); setDataRows([]); setMapping({});
    } finally {
      setBusy(false);
    }
  }

  // One-time scan of every WIP file + Cars Awaiting so we know what's already on
  // the site. (One-shot on this page — not a poll — so the API load is fine.)
  async function loadSiteRos() {
    setSiteLoading(true);
    try {
      let techs = [];
      try { techs = await listWipTechs(); } catch { techs = []; }
      if (!techs || techs.length === 0) {
        try { const d = await loadDashboardData(); techs = (d?.data?.technicians || []).map(t => t.name).filter(Boolean); } catch {}
      }
      const out = [];
      await Promise.all((techs || []).map(async t => {
        try {
          const rows = await loadWipData(t);
          (rows || []).forEach(r => { if (r.ro) out.push({ ro: roKey(r.ro), where: t }); });
        } catch {}
      }));
      try {
        const aw = await loadAwaitingData();
        (aw || []).forEach(r => { if (r.ro) out.push({ ro: roKey(r.ro), where: 'Cars Awaiting' }); });
      } catch {}
      setSiteRos(out);
    } finally {
      setSiteLoading(false);
    }
  }

  // All RO#s present anywhere in the file (any flag) — used for the stale check.
  const allFileRoSet = useMemo(() => {
    const idx = mapping.ro;
    if (idx == null || idx < 0) return new Set();
    return new Set(dataRows.map(r => roKey(r[idx])).filter(Boolean));
  }, [dataRows, mapping]);

  // Parsed rows that pass the purple/green flag filter.
  const flagged = useMemo(() => {
    if (mapping.ro == null || mapping.ro < 0) return [];
    return dataRows.map(r => {
      const val = (k) => { const i = mapping[k]; return (i != null && i >= 0) ? String(r[i] ?? '').trim() : ''; };
      return { ro: val('ro'), advisor: val('advisor'), vehicle: val('vehicle'), tech: val('tech'), userFlag: val('userFlag') };
    }).filter(o => o.ro && flagAllowed(o.userFlag));
  }, [dataRows, mapping]);

  // Categorize against the site.
  const { toAdd, dupCount } = useMemo(() => {
    const site = new Set((siteRos || []).map(s => s.ro));
    const add = [], seen = new Set();
    let dup = 0;
    for (const o of flagged) {
      const k = roKey(o.ro);
      if (seen.has(k)) continue; // de-dupe within the file
      seen.add(k);
      if (site.has(k)) dup++;
      else if (!excluded[k]) add.push(o);
    }
    return { toAdd: add, dupCount: dup };
  }, [flagged, siteRos, excluded]);

  // ROs on the site but not anywhere in the uploaded file → candidates to remove.
  const stale = useMemo(() => {
    if (!siteRos || allFileRoSet.size === 0) return [];
    const seen = new Set();
    const out = [];
    for (const s of siteRos) {
      if (allFileRoSet.has(s.ro)) continue;
      if (seen.has(s.ro)) continue;
      seen.add(s.ro);
      out.push(s);
    }
    return out;
  }, [siteRos, allFileRoSet]);

  // Delete a single stale RO from wherever it lives on the site.
  async function removeStale(s) {
    if (!window.confirm(`Remove RO ${s.ro} from ${s.where === 'Cars Awaiting' ? 'Cars Awaiting' : s.where + "'s WIP"}?`)) return;
    setRemovingRo(s.ro); setError('');
    try {
      if (s.where === 'Cars Awaiting') {
        const ex = await loadAwaitingData();
        await saveAwaitingData((ex || []).filter(r => roKey(r.ro) !== s.ro));
      } else {
        const ex = await loadWipData(s.where);
        await saveWipData(s.where, (ex || []).filter(r => roKey(r.ro) !== s.ro));
      }
      setSiteRos(prev => (prev || []).filter(x => !(x.ro === s.ro && x.where === s.where)));
    } catch (e) { setError(e.message || 'Remove failed.'); }
    finally { setRemovingRo(''); }
  }

  // Delete every stale RO (grouped by location so each file saves once).
  async function removeAllStale() {
    if (stale.length === 0) return;
    if (!window.confirm(`Remove all ${stale.length} repair orders that aren't in your file?`)) return;
    setBusy(true); setError(''); setStatus('Removing…');
    try {
      const byLoc = new Map();
      stale.forEach(s => { if (!byLoc.has(s.where)) byLoc.set(s.where, new Set()); byLoc.get(s.where).add(s.ro); });
      for (const [where, set] of byLoc.entries()) {
        if (where === 'Cars Awaiting') {
          const ex = await loadAwaitingData();
          await saveAwaitingData((ex || []).filter(r => !set.has(roKey(r.ro))));
        } else {
          const ex = await loadWipData(where);
          await saveWipData(where, (ex || []).filter(r => !set.has(roKey(r.ro))));
        }
      }
      setStatus(`✅ Removed ${stale.length} repair order${stale.length === 1 ? '' : 's'} from the site.`);
      await loadSiteRos();
    } catch (e) { setError(e.message || 'Remove failed.'); setStatus(''); }
    finally { setBusy(false); }
  }

  function reset() {
    setFileName(''); setHeaders([]); setDataRows([]); setMapping({}); setError(''); setStatus(''); setSiteRos(null); setDescs({}); setExcluded({});
    if (fileRef.current) fileRef.current.value = '';
  }

  // SAVE: write the new ROs to the right destination. Tech present → that tech's
  // WIP; no tech → Cars Awaiting. Groups writes so each file is saved once.
  async function handleSave() {
    if (toAdd.length === 0) return;
    if (!window.confirm(`Save ${toAdd.length} new repair order${toAdd.length === 1 ? '' : 's'} to the website?`)) return;
    setBusy(true); setStatus('Saving…'); setError('');
    try {
      // Resolve real WIP filenames so the Technician column matches existing tabs.
      let techFiles = [];
      try { techFiles = await listWipTechs(); } catch {}
      const matchTech = (name) => {
        const n = roKey(name);
        if (!n) return '';
        return (techFiles || []).find(t => roKey(t) === n) || name.trim();
      };

      const byTech = new Map(); // techFile -> [ro objects]
      const awaiting = [];
      for (const o of toAdd) {
        if (o.tech && o.tech.trim()) {
          const tf = matchTech(o.tech);
          if (!byTech.has(tf)) byTech.set(tf, []);
          byTech.get(tf).push(o);
        } else {
          awaiting.push(o);
        }
      }

      let added = 0;
      // WIP per tech
      for (const [tech, list] of byTech.entries()) {
        const existing = await loadWipData(tech);
        const have = new Set((existing || []).map(r => roKey(r.ro)));
        const additions = list.filter(o => !have.has(roKey(o.ro))).map(o => ({
          id: genId(), ro: o.ro.trim(), roDate: todayISO(), vehicle: o.vehicle || '',
          jobDesc: (descs[roKey(o.ro)] || '').trim(), etaParts: '', etaCompletion: '', partsArrived: null, partsArrivedDate: '',
          highPriority: false, advisor: o.advisor || '', notes: '',
        }));
        if (additions.length) {
          await saveWipData(tech, [...(existing || []), ...additions]);
          added += additions.length;
        }
      }
      // Cars Awaiting for no-tech ROs
      if (awaiting.length) {
        const existing = await loadAwaitingData();
        const have = new Set((existing || []).map(r => roKey(r.ro)));
        const additions = awaiting.filter(o => !have.has(roKey(o.ro))).map(o => ({
          id: genId(), ro: o.ro.trim(), roDate: todayISO(), vehicle: o.vehicle || '',
          jobDesc: (descs[roKey(o.ro)] || '').trim(), highPriority: false, advisor: o.advisor || '', notes: '',
          partsArrived: null, partsArrivedDate: '', isNew: true,
        }));
        if (additions.length) {
          await saveAwaitingData([...(existing || []), ...additions]);
          added += additions.length;
        }
      }
      setStatus(`✅ Saved ${added} repair order${added === 1 ? '' : 's'} to the website.`);
      await loadSiteRos(); // refresh comparison so the lists update
    } catch (e) {
      setError(e.message || 'Save failed.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  const inpSel = { background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%' };
  const cardSt = { background: 'rgba(15,23,42,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, padding: 18, marginBottom: 20 };
  const thSt = { textAlign: 'left', padding: '9px 12px', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.2)' };
  const tdSt = { padding: '7px 12px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,.07)' };
  const ready = headers.length > 0 && (mapping.ro ?? -1) >= 0 && (mapping.userFlag ?? -1) >= 0;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">📤 RO Upload</div>
          <div className="adv-sub">Bulk-add purple/green flagged ROs from an open-RO report · managers only</div>
        </div>
        <div style={{ flex: 1 }} />
        {(headers.length > 0 || fileName) && <button className="secondary" onClick={reset} style={{ marginRight: 10 }}>↺ Start Over</button>}
        <button className="secondary" onClick={onBack}>← Advisor Calendar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
        <div style={{ maxWidth: 1150, margin: '0 auto' }}>

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            style={{ border: '2px dashed rgba(52,211,153,.4)', borderRadius: 16, padding: '34px 24px', textAlign: 'center', cursor: 'pointer', background: 'rgba(52,211,153,.05)', marginBottom: 22 }}
          >
            <div style={{ fontSize: 38, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 800, color: '#6ee7b7', fontSize: 16 }}>{fileName || 'Click to choose an .xlsx file (or drag it here)'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Open Repair Order report. Only RO# rows with a <strong>purple</strong> or <strong>green</strong> User Flag will be added.</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {busy && <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 14 }}>⏳ Working…</div>}
          {error && <div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 14, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px' }}>{error}</div>}
          {status && <div style={{ color: status.startsWith('✅') ? '#6ee7b7' : '#fbbf24', fontSize: 14, marginBottom: 14, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: '10px 14px' }}>{status}</div>}

          {headers.length > 0 && (
            <>
              {/* Column mapping */}
              <div style={cardSt}>
                <div style={{ fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>Match the columns</div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Auto-detected from your headers — fix any that are wrong. RO # and User Flag are required.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
                  {FIELDS.map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: f.required ? '#6ee7b7' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>{f.label}{f.required ? ' *' : ''}</label>
                      <select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: parseInt(e.target.value, 10) }))} style={{ ...inpSel, marginTop: 4 }}>
                        <option value={-1}>— not mapped —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {!ready && <div style={{ color: '#fbbf24', fontSize: 13, marginBottom: 16 }}>Map both <strong>RO #</strong> and <strong>User Flag</strong> to continue.</div>}

              {ready && (
                <>
                  {/* Summary chips */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                    <Chip color="#6ee7b7" label="New to add" value={toAdd.length} />
                    <Chip color="#fbbf24" label="Duplicates (skipped)" value={dupCount} />
                    <Chip color="#fca5a5" label="On site, not in file" value={siteRos ? stale.length : '…'} />
                    <Chip color="#94a3b8" label="Flagged in file" value={flagged.length} />
                  </div>
                  {siteLoading && <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>Scanning the site for duplicates & stale ROs…</div>}

                  {/* Save */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <button onClick={handleSave} disabled={busy || toAdd.length === 0}
                      style={{ background: toAdd.length ? 'rgba(52,211,153,.22)' : 'rgba(255,255,255,.05)', border: `1px solid ${toAdd.length ? 'rgba(52,211,153,.55)' : 'rgba(255,255,255,.1)'}`, color: toAdd.length ? '#6ee7b7' : '#475569', borderRadius: 10, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: toAdd.length ? 'pointer' : 'default' }}>
                      💾 Save {toAdd.length} to WIP
                    </button>
                  </div>

                  {/* To add */}
                  <div style={{ fontWeight: 800, color: '#6ee7b7', marginBottom: 8 }}>New repair orders to add ({toAdd.length})</div>
                  <div style={{ ...cardSt, padding: 0, overflow: 'auto', maxHeight: 420 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                        <th style={thSt}>RO #</th><th style={thSt}>Advisor</th><th style={thSt}>Vehicle</th><th style={thSt}>Technician</th><th style={thSt}>Destination</th><th style={thSt}>Flag</th><th style={{ ...thSt, minWidth: 240 }}>Description</th><th style={thSt}></th>
                      </tr></thead>
                      <tbody>
                        {toAdd.map((o, i) => (
                          <tr key={i}>
                            <td style={tdSt}>
                              <span onClick={() => copyRo(o.ro)} title="Click to copy RO#"
                                style={{ color: copiedRo === String(o.ro).trim() ? '#4ade80' : '#6ee7f9', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'all' }}>
                                {copiedRo === String(o.ro).trim() ? '✓ Copied' : `📋 ${o.ro}`}
                              </span>
                            </td>
                            <td style={tdSt}>{o.advisor || '—'}</td>
                            <td style={tdSt}>{o.vehicle || '—'}</td>
                            <td style={tdSt}>{o.tech || '—'}</td>
                            <td style={{ ...tdSt, color: o.tech ? '#c4b5fd' : '#fbbf24' }}>{o.tech ? `${o.tech}'s WIP` : 'Cars Awaiting'}</td>
                            <td style={{ ...tdSt, color: norm(o.userFlag).includes('purple') ? '#c084fc' : '#4ade80', fontWeight: 700 }}>{o.userFlag}</td>
                            <td style={tdSt}>
                              <input
                                value={descs[roKey(o.ro)] || ''}
                                onChange={e => setDesc(o.ro, e.target.value)}
                                placeholder="Add description…"
                                style={{ ...inpSel, padding: '5px 8px', minWidth: 220 }}
                              />
                            </td>
                            <td style={{ ...tdSt, textAlign: 'center' }}>
                              <button onClick={() => setExcluded(x => ({ ...x, [roKey(o.ro)]: true }))} title="Don't add this RO"
                                style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#fca5a5', borderRadius: 7, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕</button>
                            </td>
                          </tr>
                        ))}
                        {toAdd.length === 0 && <tr><td style={{ ...tdSt, color: '#64748b' }} colSpan={8}>Nothing new to add{Object.keys(excluded).length ? ' (some were removed below)' : ' — all flagged ROs are already on the site'}.</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {Object.keys(excluded).length > 0 && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 18 }}>
                      {Object.keys(excluded).length} RO{Object.keys(excluded).length === 1 ? '' : 's'} removed from the add list.{' '}
                      <span onClick={() => setExcluded({})} style={{ color: '#6ee7b7', cursor: 'pointer', fontWeight: 700 }}>Restore all</span>
                    </div>
                  )}

                  {/* Stale */}
                  {siteRos && stale.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ fontWeight: 800, color: '#fca5a5' }}>On the site but NOT in your file — review & remove ({stale.length})</div>
                        <button onClick={removeAllStale} disabled={busy}
                          style={{ background: 'rgba(239,68,68,.16)', border: '1px solid rgba(239,68,68,.45)', color: '#fca5a5', borderRadius: 9, padding: '7px 16px', fontWeight: 800, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
                          🗑 Remove all {stale.length}
                        </button>
                      </div>
                      <div style={{ ...cardSt, padding: 0, overflow: 'auto', maxHeight: 320 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}><th style={thSt}>RO #</th><th style={thSt}>Where it lives</th><th style={thSt}></th></tr></thead>
                          <tbody>
                            {stale.map((s, i) => (
                              <tr key={i}><td style={tdSt}>
                                <span onClick={() => copyRo(s.ro)} title="Click to copy RO#"
                                  style={{ color: copiedRo === String(s.ro).trim() ? '#4ade80' : '#6ee7f9', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'all' }}>
                                  {copiedRo === String(s.ro).trim() ? '✓ Copied' : `📋 ${s.ro}`}
                                </span>
                              </td><td style={tdSt}>{s.where === 'Cars Awaiting' ? 'Cars Awaiting' : `${s.where}'s WIP`}</td>
                              <td style={{ ...tdSt, textAlign: 'center' }}>
                                <button onClick={() => removeStale(s)} disabled={removingRo === s.ro}
                                  style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#fca5a5', borderRadius: 7, padding: '3px 12px', fontSize: 12, fontWeight: 700, cursor: removingRo === s.ro ? 'wait' : 'pointer' }}>
                                  {removingRo === s.ro ? '⏳' : '🗑 Remove'}
                                </button>
                              </td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 8, marginBottom: 24 }}>These aren't on your latest report — likely closed. Remove takes them off the site right away (WIP or Cars Awaiting).</div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ color, label, value }) {
  return (
    <div style={{ background: 'rgba(15,23,42,.55)', border: `1px solid ${color}55`, borderRadius: 12, padding: '12px 18px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div>
    </div>
  );
}
