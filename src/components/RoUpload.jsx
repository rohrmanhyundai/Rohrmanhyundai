import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  loadAwaitingData, saveAwaitingData,
  loadWipData, saveWipData, listWipTechs, loadDashboardData,
  saveMissingNotes,
} from '../utils/github';
import { canonicalAdvisorFirst } from '../utils/advisorAliases';

// Columns we read from the dealership's open-RO report.
const FIELDS = [
  { key: 'ro',       label: 'RO #',            required: true,  hints: ['ro#', 'ro #', 'ro', 'repair order', 'ro number'] },
  { key: 'advisor',  label: 'Service Advisor', required: false, hints: ['service advisor', 'advisor', 'writer'] },
  { key: 'vehicle',  label: 'Vehicle',         required: false, hints: ['vehicle', 'veh', 'year make model', 'unit'] },
  { key: 'tech',     label: 'Technician',      required: false, hints: ['technician', 'tech'] },
  { key: 'userFlag', label: 'User Flag',       required: true,  hints: ['user flag', 'flag', 'userflag'] },
  { key: 'internalNotes', label: 'Internal Notes', required: false, hints: ['internal notes', 'internal note', 'internal'] },
];

// "FIRST LAST" → "FIRST" (uppercased), to key the list by advisor first name.
const firstNameKey = (name) => roKey(name).split(/\s+/)[0] || '';

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

export default function RoUpload({ onBack, currentUser, techList = [] }) {
  // Resolve a report's technician name (often a full "FIRST LAST") to the WIP
  // tab username (usually just "FIRST"). Returns '' if no tech tab matches, in
  // which case the RO goes to Cars Awaiting.
  function resolveTech(name) {
    const rn = roKey(name);
    if (!rn) return '';
    const first = rn.split(/\s+/)[0];
    const cands = techList || [];
    return cands.find(c => roKey(c) === rn)                        // exact full match
        || cands.find(c => roKey(c) === first)                     // username == first name
        || cands.find(c => rn.startsWith(roKey(c) + ' '))          // "JACOB KUNTZ" starts with "JACOB "
        || cands.find(c => roKey(c).startsWith(first))             // username begins with first token
        || '';
  }
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
  const [modal, setModal] = useState(''); // '', 'new', 'dup', 'stale', 'flagged'

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

  // Parsed rows that pass the purple/green flag filter.
  const flagged = useMemo(() => {
    if (mapping.ro == null || mapping.ro < 0) return [];
    return dataRows.map(r => {
      const val = (k) => { const i = mapping[k]; return (i != null && i >= 0) ? String(r[i] ?? '').trim() : ''; };
      return { ro: val('ro'), advisor: val('advisor'), vehicle: val('vehicle'), tech: val('tech'), userFlag: val('userFlag') };
    }).filter(o => o.ro && flagAllowed(o.userFlag));
  }, [dataRows, mapping]);

  // ROs whose Internal Notes (col J) are blank, grouped by advisor first name.
  // Needs the Internal Notes column mapped (otherwise we can't tell).
  const notesMapped = mapping.internalNotes != null && mapping.internalNotes >= 0;
  const missingByAdvisor = useMemo(() => {
    if (!notesMapped || mapping.ro == null || mapping.ro < 0) return {};
    const out = {}, seen = {};
    for (const r of dataRows) {
      const val = (k) => { const i = mapping[k]; return (i != null && i >= 0) ? String(r[i] ?? '').trim() : ''; };
      const ro = val('ro');
      if (!ro) continue;
      if (val('internalNotes') !== '') continue; // has notes → not missing
      const adv = canonicalAdvisorFirst(val('advisor')) || 'UNASSIGNED';
      if (!seen[adv]) seen[adv] = new Set();
      const k = roKey(ro);
      if (seen[adv].has(k)) continue;
      seen[adv].add(k);
      (out[adv] = out[adv] || []).push({ ro: ro.trim(), vehicle: val('vehicle') });
    }
    return out;
  }, [dataRows, mapping, notesMapped]);
  const missingAdvKeys = useMemo(() => Object.keys(missingByAdvisor).sort(), [missingByAdvisor]);
  const missingTotal = useMemo(() => missingAdvKeys.reduce((s, a) => s + missingByAdvisor[a].length, 0), [missingByAdvisor, missingAdvKeys]);

  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState('');
  async function saveMissingNotesList() {
    setNotesSaving(true); setNotesSaved('');
    try {
      await saveMissingNotes({ updatedAt: new Date().toISOString(), by: currentUser || '', advisors: missingByAdvisor });
      setNotesSaved(`✅ Saved ${missingTotal} RO${missingTotal === 1 ? '' : 's'} across ${missingAdvKeys.length} advisor${missingAdvKeys.length === 1 ? '' : 's'} for Day End Reporting.`);
    } catch (e) {
      setNotesSaved('Save failed: ' + (e.message || e));
    } finally {
      setNotesSaving(false);
    }
  }

  // Deduped list of all green/purple flagged ROs in the file.
  const flaggedUnique = useMemo(() => {
    const seen = new Set(), out = [];
    for (const o of flagged) { const k = roKey(o.ro); if (seen.has(k)) continue; seen.add(k); out.push(o); }
    return out;
  }, [flagged]);

  // A "valid place" is a real WIP tab (techList username) or Cars Awaiting.
  // ROs sitting only in an orphan/mis-named file don't count as truly on-site,
  // so they'll be re-added to the correct WIP.
  const techSet = useMemo(() => new Set((techList || []).map(roKey)), [techList]);
  const isValidPlace = (where) => where === 'Cars Awaiting' || techSet.has(roKey(where));

  // Categorize against the site.
  const { toAdd, dupList } = useMemo(() => {
    const validWhere = new Map();
    (siteRos || []).forEach(s => { if (isValidPlace(s.where) && !validWhere.has(s.ro)) validWhere.set(s.ro, s.where); });
    const add = [], dups = [];
    for (const o of flaggedUnique) {
      const k = roKey(o.ro);
      if (validWhere.has(k)) dups.push({ ...o, where: validWhere.get(k) });
      else if (!excluded[k]) add.push(o);
    }
    return { toAdd: add, dupList: dups };
  }, [flaggedUnique, siteRos, excluded, techSet]);
  const dupCount = dupList.length;

  // The set of RO#s that SHOULD be on the site = the green/purple flagged ones.
  const flaggedRoSet = useMemo(() => new Set(flagged.map(o => roKey(o.ro))), [flagged]);

  // ROs on the site that are NOT in the green/purple flagged set → candidates to
  // remove. This covers both ROs missing from the report entirely AND ROs in the
  // report whose User Flag isn't purple/green (those don't belong on the site).
  const stale = useMemo(() => {
    // Only meaningful once a file with a mapped User Flag has been read.
    if (!siteRos || dataRows.length === 0 || (mapping.userFlag ?? -1) < 0 || (mapping.ro ?? -1) < 0) return [];
    const seen = new Set();
    const out = [];
    for (const s of siteRos) {
      if (flaggedRoSet.has(s.ro)) continue;
      if (seen.has(s.ro)) continue;
      seen.add(s.ro);
      out.push(s);
    }
    return out;
  }, [siteRos, flaggedRoSet, dataRows, mapping]);

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
      const byTech = new Map(); // tech username -> [ro objects]
      const awaiting = [];
      for (const o of toAdd) {
        const tab = resolveTech(o.tech); // '' if the tech name doesn't match any WIP tab
        if (tab) {
          if (!byTech.has(tab)) byTech.set(tab, []);
          byTech.get(tab).push(o);
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

              {/* ROs missing internal notes → surfaced in each advisor's Day End Reporting */}
              <div style={{ ...cardSt, border: '1px solid rgba(167,139,250,.4)', background: 'linear-gradient(150deg,rgba(167,139,250,.12),rgba(2,6,23,.45))', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ fontWeight: 800, color: '#c4b5fd' }}>📝 ROs missing internal notes</div>
                  <div style={{ flex: 1 }} />
                  {notesMapped && (
                    <button onClick={saveMissingNotesList} disabled={notesSaving || missingTotal === 0}
                      style={{ background: missingTotal ? 'rgba(167,139,250,.22)' : 'rgba(255,255,255,.05)', border: `1px solid ${missingTotal ? 'rgba(167,139,250,.55)' : 'rgba(255,255,255,.1)'}`, color: missingTotal ? '#c4b5fd' : '#475569', borderRadius: 10, padding: '8px 18px', fontWeight: 800, fontSize: 13, cursor: missingTotal ? 'pointer' : 'default' }}>
                      {notesSaving ? '⏳ Saving…' : '💾 Save for Day End Reporting'}
                    </button>
                  )}
                </div>
                {!notesMapped ? (
                  <div style={{ fontSize: 12.5, color: '#fbbf24' }}>Map the <strong>Internal Notes</strong> column above to detect ROs without notes.</div>
                ) : missingTotal === 0 ? (
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>Every RO in this report has internal notes. 🎉</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                      <strong style={{ color: '#e2e8f0' }}>{missingTotal}</strong> RO{missingTotal === 1 ? '' : 's'} with blank notes across <strong style={{ color: '#e2e8f0' }}>{missingAdvKeys.length}</strong> advisor{missingAdvKeys.length === 1 ? '' : 's'}. Save to show each advisor their list when they close the day.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {missingAdvKeys.map(adv => (
                        <div key={adv} style={{ background: 'rgba(2,6,23,.4)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 10, padding: '8px 14px', minWidth: 140 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: adv === 'UNASSIGNED' ? '#f59e0b' : '#c4b5fd' }}>{adv === 'UNASSIGNED' ? 'Unassigned' : adv}</div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0' }}>{missingByAdvisor[adv].length}</div>
                        </div>
                      ))}
                    </div>
                    {notesSaved && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: notesSaved.startsWith('✅') ? '#6ee7b7' : '#fca5a5' }}>{notesSaved}</div>}
                  </>
                )}
              </div>

              {!ready && <div style={{ color: '#fbbf24', fontSize: 13, marginBottom: 16 }}>Map both <strong>RO #</strong> and <strong>User Flag</strong> to continue.</div>}

              {ready && (
                <>
                  {/* Summary chips */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                    <Chip color="#6ee7b7" label="New to add" value={toAdd.length} onClick={() => setModal('new')} />
                    <Chip color="#fbbf24" label="Duplicates (skipped)" value={dupCount} onClick={() => setModal('dup')} />
                    <Chip color="#fca5a5" label="On site, not flagged" value={siteRos ? stale.length : '…'} onClick={() => setModal('stale')} />
                    <Chip color="#94a3b8" label="Flagged in file" value={flaggedUnique.length} onClick={() => setModal('flagged')} />
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
                            <td style={{ ...tdSt, color: resolveTech(o.tech) ? '#c4b5fd' : '#fbbf24' }}>{resolveTech(o.tech) ? `${resolveTech(o.tech)}'s WIP` : 'Cars Awaiting'}</td>
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
                        <div style={{ fontWeight: 800, color: '#fca5a5' }}>On the site but NOT purple/green in your report — review & remove ({stale.length})</div>
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
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 8, marginBottom: 24 }}>These are on the site but aren't flagged purple/green in your report (closed, or no longer flagged), so they shouldn't be here. Remove takes them off the site right away (WIP or Cars Awaiting).</div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {modal && (() => {
        const cfg = {
          new:     { title: 'New repair orders to add', color: '#6ee7b7', rows: toAdd },
          dup:     { title: 'Duplicates already on the site (skipped)', color: '#fbbf24', rows: dupList },
          stale:   { title: 'On the site but not flagged purple/green', color: '#fca5a5', rows: stale },
          flagged: { title: 'All purple/green flagged ROs in the file', color: '#94a3b8', rows: flaggedUnique },
        }[modal];
        if (!cfg) return null;
        const isStale = modal === 'stale';
        return (
          <div onClick={() => setModal('')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 880, maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: '#0f172a', border: `1px solid ${cfg.color}55`, borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
                <span style={{ fontWeight: 900, fontSize: 16, color: cfg.color }}>{cfg.title} ({cfg.rows.length})</span>
                <button onClick={() => setModal('')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ overflow: 'auto', padding: '4px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                    <th style={thSt}>RO #</th>
                    {isStale ? <th style={thSt}>Where it lives</th> : <>
                      <th style={thSt}>Advisor</th><th style={thSt}>Vehicle</th><th style={thSt}>Technician</th>
                      {modal === 'dup' && <th style={thSt}>On site at</th>}
                      <th style={thSt}>Flag</th>
                    </>}
                  </tr></thead>
                  <tbody>
                    {cfg.rows.map((o, i) => (
                      <tr key={i}>
                        <td style={tdSt}>
                          <span onClick={() => copyRo(o.ro)} title="Click to copy RO#" style={{ color: copiedRo === String(o.ro).trim() ? '#4ade80' : '#6ee7f9', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'all' }}>
                            {copiedRo === String(o.ro).trim() ? '✓ Copied' : `📋 ${o.ro}`}
                          </span>
                        </td>
                        {isStale ? <td style={tdSt}>{o.where === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.where}'s WIP`}</td> : <>
                          <td style={tdSt}>{o.advisor || '—'}</td>
                          <td style={tdSt}>{o.vehicle || '—'}</td>
                          <td style={tdSt}>{o.tech || '—'}</td>
                          {modal === 'dup' && <td style={tdSt}>{o.where === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.where}'s WIP`}</td>}
                          <td style={{ ...tdSt, color: norm(o.userFlag).includes('purple') ? '#c084fc' : '#4ade80', fontWeight: 700 }}>{o.userFlag}</td>
                        </>}
                      </tr>
                    ))}
                    {cfg.rows.length === 0 && <tr><td style={{ ...tdSt, color: '#64748b' }} colSpan={6}>None.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Chip({ color, label, value, onClick }) {
  return (
    <div onClick={onClick} title={onClick ? 'Click to view these ROs' : ''}
      style={{ background: 'rgba(15,23,42,.55)', border: `1px solid ${color}55`, borderRadius: 12, padding: '12px 18px', minWidth: 130, cursor: onClick ? 'pointer' : 'default', transition: 'background .12s' }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'rgba(30,41,59,.85)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,23,42,.55)'; }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color }}>{value}</div>
      {onClick && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>click to view</div>}
    </div>
  );
}
