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

// Only purple (WIP), green (Used Car) or pink (PDI) User Flags get added.
function flagAllowed(v) {
  const f = norm(v);
  return f.includes('purple') || f.includes('green') || f.includes('pink');
}

// Flag color → '' | 'green' | 'purple' | 'pink'.
function flagColor(v) {
  const f = norm(v);
  if (f.includes('green')) return 'green';
  if (f.includes('pink')) return 'pink';
  if (f.includes('purple')) return 'purple';
  return '';
}
// Auto description by flag: green = Used Car Inspection, pink = PDI. Purple
// (plain WIP) gets NO auto description — the advisor fills it in themselves.
function autoDescForFlag(v) {
  const c = flagColor(v);
  return c === 'green' ? 'USED CAR INSPECTION' : c === 'pink' ? 'PDI' : '';
}
// Display color for the flag label in the tables.
function flagTextColor(v) {
  const c = flagColor(v);
  return c === 'green' ? '#4ade80' : c === 'pink' ? '#f472b6' : c === 'purple' ? '#c084fc' : '#94a3b8';
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
  const [notesMap, setNotesMap] = useState({}); // RO# (upper) -> notes typed before saving
  const setNote = (ro, v) => setNotesMap(n => ({ ...n, [roKey(ro)]: v }));
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
          (rows || []).forEach(r => { if (r.ro) out.push({ ro: roKey(r.ro), where: t, advisor: r.advisor || '' }); });
        } catch {}
      }));
      try {
        const aw = await loadAwaitingData();
        (aw || []).forEach(r => { if (r.ro) out.push({ ro: roKey(r.ro), where: 'Cars Awaiting', advisor: r.advisor || '' }); });
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

  // Categorize against the site. A duplicate (RO# already on site) is split into
  // a CLEAN duplicate — the report's tech + advisor already match what's on the
  // site, so nothing to do — and a MISMATCH — the report assigns a different
  // technician and/or advisor, so the on-site record is out of date and gets
  // fixed (moved to the right tech's WIP and/or the advisor corrected).
  const { toAdd, dupList, mismatches } = useMemo(() => {
    const site = new Map(); // ro -> { where, advisor }
    (siteRos || []).forEach(s => { if (isValidPlace(s.where) && !site.has(s.ro)) site.set(s.ro, s); });
    const add = [], dups = [], mism = [];
    for (const o of flaggedUnique) {
      const k = roKey(o.ro);
      const s = site.get(k);
      if (s) {
        // The report names the tech/advisor of record. Only treat as a mismatch
        // when the report actually specifies one that differs — a blank tech or
        // advisor in the report doesn't yank an existing assignment.
        const reportTab   = resolveTech(o.tech);                 // '' if no WIP tab matches
        const techMismatch = !!reportTab && roKey(reportTab) !== roKey(s.where);
        const reportAdv   = canonicalAdvisorFirst(o.advisor);    // '' if blank
        const siteAdv     = canonicalAdvisorFirst(s.advisor);
        const advMismatch = !!reportAdv && reportAdv !== siteAdv;
        if (techMismatch || advMismatch) {
          mism.push({
            ro: k, roDisplay: o.ro, from: s.where, toTab: reportTab,
            techMismatch, advMismatch,
            reportTech: o.tech || '', reportAdvisor: o.advisor || '',
            reportAdvFirst: reportAdv, siteAdvFirst: siteAdv,
          });
        } else {
          dups.push({ ...o, where: s.where });
        }
      } else if (!excluded[k]) add.push(o);
    }
    return { toAdd: add, dupList: dups, mismatches: mism };
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

  // Correct duplicate ROs whose tech/advisor on the site differs from the report.
  // Loads each affected file once, applies every fix in memory, then saves each
  // file a single time (keeps the API load down). Moving a tech-mismatched RO
  // preserves the existing record's data — description, parts, ETAs — it just
  // relocates it and/or updates the advisor. Advisor-only fixes edit in place.
  const [fixingRo, setFixingRo] = useState('');
  async function applyFixes(list, label) {
    if (!list || list.length === 0) return;
    const cache = new Map(); // location -> mutable records array ('Cars Awaiting' is a key)
    const load = async (loc) => {
      if (!cache.has(loc)) {
        const recs = loc === 'Cars Awaiting' ? await loadAwaitingData() : await loadWipData(loc);
        cache.set(loc, [...(recs || [])]);
      }
      return cache.get(loc);
    };
    const save = (loc, recs) => (loc === 'Cars Awaiting' ? saveAwaitingData(recs) : saveWipData(loc, recs));
    const dirty = new Set();
    let fixed = 0;
    for (const m of list) {
      const fromRecs = await load(m.from);
      const idx = fromRecs.findIndex(r => roKey(r.ro) === m.ro);
      if (idx === -1) continue; // already gone / moved
      const rec = fromRecs[idx];
      if (m.techMismatch && m.toTab) {
        // Move to the report's tech WIP, carrying an advisor correction along.
        fromRecs.splice(idx, 1);
        dirty.add(m.from);
        const destRecs = await load(m.toTab);
        if (!destRecs.some(r => roKey(r.ro) === m.ro)) {
          const moved = { ...rec, advisor: m.advMismatch ? m.reportAdvisor : rec.advisor };
          delete moved.isNew; // Cars-Awaiting-only flag; meaningless in a WIP
          destRecs.push(moved);
          dirty.add(m.toTab);
        }
        fixed++;
      } else if (m.advMismatch) {
        rec.advisor = m.reportAdvisor;
        dirty.add(m.from);
        fixed++;
      }
    }
    for (const loc of dirty) await save(loc, cache.get(loc));
    return fixed;
  }

  async function fixMismatch(m) {
    setFixingRo(m.ro); setError('');
    try {
      await applyFixes([m]);
      await loadSiteRos();
    } catch (e) { setError(e.message || 'Fix failed.'); }
    finally { setFixingRo(''); }
  }

  async function fixAllMismatches() {
    if (mismatches.length === 0) return;
    if (!window.confirm(
      `Fix ${mismatches.length} RO${mismatches.length === 1 ? '' : 's'} whose tech/advisor differs from your report?\n\n` +
      `ROs assigned to a different technician get moved to the correct tech's WIP; ` +
      `mismatched advisors are corrected to match the report. The RO's description, ` +
      `parts, and ETA info are kept.`
    )) return;
    setBusy(true); setError(''); setStatus('Fixing…');
    try {
      const fixed = await applyFixes(mismatches);
      setStatus(`✅ Fixed ${fixed} repair order${fixed === 1 ? '' : 's'} (tech/advisor corrected).`);
      await loadSiteRos();
    } catch (e) { setError(e.message || 'Fix failed.'); setStatus(''); }
    finally { setBusy(false); }
  }

  function reset() {
    setFileName(''); setHeaders([]); setDataRows([]); setMapping({}); setError(''); setStatus(''); setSiteRos(null); setDescs({}); setNotesMap({}); setExcluded({});
    if (fileRef.current) fileRef.current.value = '';
  }

  // SAVE: write the new ROs to the right destination. Tech present → that tech's
  // WIP; no tech → Cars Awaiting. Groups writes so each file is saved once.
  async function handleSave(skipConfirm) {
    if (toAdd.length === 0) return;
    if (!skipConfirm && !window.confirm(`Save ${toAdd.length} new repair order${toAdd.length === 1 ? '' : 's'} to the website?`)) return;
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
          jobDesc: (descs[roKey(o.ro)] || '').trim() || autoDescForFlag(o.userFlag),
          notes: (notesMap[roKey(o.ro)] || '').trim(),
          flag: flagColor(o.userFlag), usedCar: flagColor(o.userFlag) === 'green',
          etaParts: '', etaCompletion: '', partsArrived: null, partsArrivedDate: '',
          highPriority: false, advisor: o.advisor || '',
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
          jobDesc: (descs[roKey(o.ro)] || '').trim() || autoDescForFlag(o.userFlag),
          notes: (notesMap[roKey(o.ro)] || '').trim(),
          flag: flagColor(o.userFlag), usedCar: flagColor(o.userFlag) === 'green',
          highPriority: false, advisor: o.advisor || '',
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

  // One button for the page: save flagged ROs to WIP AND the missing-notes list
  // for Day End Reporting in a single click. Runs whichever has anything to save.
  const hasNotesToSave = notesMapped && missingTotal > 0;
  const canSaveAll = toAdd.length > 0 || hasNotesToSave;
  async function handleSaveAll() {
    if (!canSaveAll) return;
    const parts = [];
    if (toAdd.length > 0) parts.push(`${toAdd.length} new RO${toAdd.length === 1 ? '' : 's'} to WIP`);
    if (hasNotesToSave) parts.push(`${missingTotal} missing-note RO${missingTotal === 1 ? '' : 's'} for Day End Reporting`);
    if (!window.confirm(`Save ${parts.join(' and ')}?`)) return;
    if (toAdd.length > 0) await handleSave(true);   // skip its own confirm
    if (hasNotesToSave) await saveMissingNotesList();
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
          <div className="adv-sub">Bulk-add purple/pink/green flagged ROs from an open-RO report · managers only</div>
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
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Open Repair Order report. Only RO# rows with a <strong>purple</strong> (WIP), <strong>pink</strong> (PDI) or <strong>green</strong> (Used Car) User Flag will be added.</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
          </div>

          {/* How to flag in Tekion — so anyone uploading knows which color does what. */}
          <div style={{ ...cardSt, marginBottom: 22 }}>
            <div style={{ fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>How to flag an RO in Tekion</div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 14, lineHeight: 1.6 }}>
              On the Repair Order in Tekion, set the <strong style={{ color: '#cbd5e1' }}>User Flag</strong> to one of these colors.
              Only ROs with one of these three flags are picked up from the report — every other row is ignored.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {[
                { color: 'purple', hex: '#c084fc', name: 'Purple', dest: 'Work in Progress (WIP)', desc: 'The RO is in the shop and being worked.' },
                { color: 'pink',   hex: '#f472b6', name: 'Pink',   dest: 'PDI',                     desc: 'Pre-delivery inspection.' },
                { color: 'green',  hex: '#4ade80', name: 'Green',  dest: 'Used Car',                desc: 'Used-car inspection / recon.' },
              ].map(f => (
                <div key={f.color} style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', gap: 12, alignItems: 'flex-start', background: `${f.hex}14`, border: `1px solid ${f.hex}44`, borderRadius: 12, padding: '12px 14px' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: f.hex, boxShadow: `0 0 10px ${f.hex}88`, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 13.5, color: f.hex }}>{f.name} <span style={{ color: '#64748b', fontWeight: 600 }}>→</span> <span style={{ color: '#e2e8f0' }}>{f.dest}</span></div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3, lineHeight: 1.5 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
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
                  <span style={{ fontSize: 11, color: '#64748b' }}>Saved with the button below</span>
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
                    <Chip color="#f59e0b" label="Tech/advisor mismatch" value={siteRos ? mismatches.length : '…'} onClick={() => setModal('mismatch')} />
                    <Chip color="#fca5a5" label="On site, not flagged" value={siteRos ? stale.length : '…'} onClick={() => setModal('stale')} />
                    <Chip color="#94a3b8" label="Flagged in file" value={flaggedUnique.length} onClick={() => setModal('flagged')} />
                  </div>
                  {siteLoading && <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>Scanning the site for duplicates & stale ROs…</div>}

                  {/* Save — one button: WIP + Day End Reporting */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    {notesSaved && <span style={{ fontSize: 13, fontWeight: 700, color: notesSaved.startsWith('✅') ? '#6ee7b7' : '#fca5a5' }}>{notesSaved}</span>}
                    <button onClick={handleSaveAll} disabled={busy || notesSaving || !canSaveAll}
                      style={{ background: canSaveAll ? 'rgba(52,211,153,.22)' : 'rgba(255,255,255,.05)', border: `1px solid ${canSaveAll ? 'rgba(52,211,153,.55)' : 'rgba(255,255,255,.1)'}`, color: canSaveAll ? '#6ee7b7' : '#475569', borderRadius: 10, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: canSaveAll ? 'pointer' : 'default' }}>
                      {busy || notesSaving ? '⏳ Saving…' : `💾 Save to WIP${hasNotesToSave ? ` + ${missingTotal} for Day End` : ''}`}
                    </button>
                  </div>

                  {/* To add */}
                  <div style={{ fontWeight: 800, color: '#6ee7b7', marginBottom: 8 }}>New repair orders to add ({toAdd.length})</div>
                  <div style={{ ...cardSt, padding: 0, overflow: 'auto', maxHeight: 420 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                        <th style={thSt}>RO #</th><th style={thSt}>Advisor</th><th style={thSt}>Vehicle</th><th style={thSt}>Technician</th><th style={thSt}>Destination</th><th style={thSt}>Flag</th><th style={{ ...thSt, minWidth: 220 }}>Description</th><th style={{ ...thSt, minWidth: 220 }}>Notes (optional)</th><th style={thSt}></th>
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
                            <td style={{ ...tdSt, color: flagTextColor(o.userFlag), fontWeight: 700 }}>{o.userFlag}</td>
                            <td style={tdSt}>
                              <input
                                value={descs[roKey(o.ro)] != null ? descs[roKey(o.ro)] : autoDescForFlag(o.userFlag)}
                                onChange={e => setDesc(o.ro, e.target.value)}
                                placeholder="Add description…"
                                style={{ ...inpSel, padding: '5px 8px', minWidth: 200 }}
                              />
                            </td>
                            <td style={tdSt}>
                              <input
                                value={notesMap[roKey(o.ro)] || ''}
                                onChange={e => setNote(o.ro, e.target.value)}
                                placeholder="Add notes…"
                                style={{ ...inpSel, padding: '5px 8px', minWidth: 200 }}
                              />
                            </td>
                            <td style={{ ...tdSt, textAlign: 'center' }}>
                              <button onClick={() => setExcluded(x => ({ ...x, [roKey(o.ro)]: true }))} title="Don't add this RO"
                                style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#fca5a5', borderRadius: 7, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕</button>
                            </td>
                          </tr>
                        ))}
                        {toAdd.length === 0 && <tr><td style={{ ...tdSt, color: '#64748b' }} colSpan={9}>Nothing new to add{Object.keys(excluded).length ? ' (some were removed below)' : ' — all flagged ROs are already on the site'}.</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {Object.keys(excluded).length > 0 && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 18 }}>
                      {Object.keys(excluded).length} RO{Object.keys(excluded).length === 1 ? '' : 's'} removed from the add list.{' '}
                      <span onClick={() => setExcluded({})} style={{ color: '#6ee7b7', cursor: 'pointer', fontWeight: 700 }}>Restore all</span>
                    </div>
                  )}

                  {/* Tech / advisor mismatches on duplicate ROs */}
                  {siteRos && mismatches.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ fontWeight: 800, color: '#f59e0b' }}>Already on site but tech/advisor differs from your report — verify & fix ({mismatches.length})</div>
                        <button onClick={fixAllMismatches} disabled={busy}
                          style={{ background: 'rgba(245,158,11,.16)', border: '1px solid rgba(245,158,11,.5)', color: '#fbbf24', borderRadius: 9, padding: '7px 16px', fontWeight: 800, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
                          🔧 Fix all {mismatches.length}
                        </button>
                      </div>
                      <div style={{ ...cardSt, padding: 0, overflow: 'auto', maxHeight: 340 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                            <th style={thSt}>RO #</th><th style={thSt}>Advisor (report → site)</th><th style={thSt}>Technician (fix)</th><th style={thSt}></th>
                          </tr></thead>
                          <tbody>
                            {mismatches.map((m, i) => (
                              <tr key={i}>
                                <td style={tdSt}>
                                  <span onClick={() => copyRo(m.roDisplay)} title="Click to copy RO#"
                                    style={{ color: copiedRo === String(m.roDisplay).trim() ? '#4ade80' : '#6ee7f9', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'all' }}>
                                    {copiedRo === String(m.roDisplay).trim() ? '✓ Copied' : `📋 ${m.roDisplay}`}
                                  </span>
                                </td>
                                <td style={tdSt}>
                                  {m.advMismatch
                                    ? <span><span style={{ color: '#fbbf24', fontWeight: 700 }}>{m.reportAdvFirst || '—'}</span> <span style={{ color: '#64748b' }}>→ was {m.siteAdvFirst || '—'}</span></span>
                                    : <span style={{ color: '#64748b' }}>{m.siteAdvFirst || '—'} (unchanged)</span>}
                                </td>
                                <td style={tdSt}>
                                  {m.techMismatch
                                    ? <span><span style={{ color: '#94a3b8' }}>{m.from === 'Cars Awaiting' ? 'Cars Awaiting' : `${m.from}'s WIP`}</span> <span style={{ color: '#c4b5fd', fontWeight: 700 }}>→ {m.toTab}'s WIP</span></span>
                                    : <span style={{ color: '#64748b' }}>{m.from === 'Cars Awaiting' ? 'Cars Awaiting' : `${m.from}'s WIP`} (unchanged)</span>}
                                </td>
                                <td style={{ ...tdSt, textAlign: 'center' }}>
                                  <button onClick={() => fixMismatch(m)} disabled={fixingRo === m.ro || busy}
                                    style={{ background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: '#fbbf24', borderRadius: 7, padding: '3px 12px', fontSize: 12, fontWeight: 700, cursor: fixingRo === m.ro ? 'wait' : 'pointer' }}>
                                    {fixingRo === m.ro ? '⏳' : '🔧 Fix'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 8, marginBottom: 24 }}>These ROs are already on the site, but your report lists a different technician and/or advisor. Fixing moves the RO to the correct tech's WIP and/or corrects the advisor — the description, parts, and ETA info are kept.</div>
                    </>
                  )}

                  {/* Stale */}
                  {siteRos && stale.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ fontWeight: 800, color: '#fca5a5' }}>On the site but NOT purple/pink/green in your report — review & remove ({stale.length})</div>
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
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 8, marginBottom: 24 }}>These are on the site but aren't flagged purple/pink/green in your report (closed, or no longer flagged), so they shouldn't be here. Remove takes them off the site right away (WIP or Cars Awaiting).</div>
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
          new:      { title: 'New repair orders to add', color: '#6ee7b7', rows: toAdd },
          dup:      { title: 'Duplicates already on the site (skipped)', color: '#fbbf24', rows: dupList },
          mismatch: { title: 'On site but tech/advisor differs from your report', color: '#f59e0b', rows: mismatches },
          stale:    { title: 'On the site but not flagged purple/pink/green', color: '#fca5a5', rows: stale },
          flagged:  { title: 'All purple/pink/green flagged ROs in the file', color: '#94a3b8', rows: flaggedUnique },
        }[modal];
        if (!cfg) return null;
        const isStale = modal === 'stale';
        const isMismatch = modal === 'mismatch';
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
                    {isStale ? <th style={thSt}>Where it lives</th>
                     : isMismatch ? <><th style={thSt}>Advisor (report → site)</th><th style={thSt}>Technician (fix)</th></>
                     : <>
                      <th style={thSt}>Advisor</th><th style={thSt}>Vehicle</th><th style={thSt}>Technician</th>
                      {modal === 'dup' && <th style={thSt}>On site at</th>}
                      <th style={thSt}>Flag</th>
                    </>}
                  </tr></thead>
                  <tbody>
                    {cfg.rows.map((o, i) => (
                      <tr key={i}>
                        <td style={tdSt}>
                          <span onClick={() => copyRo(isMismatch ? o.roDisplay : o.ro)} title="Click to copy RO#" style={{ color: copiedRo === String(isMismatch ? o.roDisplay : o.ro).trim() ? '#4ade80' : '#6ee7f9', fontFamily: 'monospace', cursor: 'pointer', userSelect: 'all' }}>
                            {copiedRo === String(isMismatch ? o.roDisplay : o.ro).trim() ? '✓ Copied' : `📋 ${isMismatch ? o.roDisplay : o.ro}`}
                          </span>
                        </td>
                        {isStale ? <td style={tdSt}>{o.where === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.where}'s WIP`}</td>
                         : isMismatch ? <>
                          <td style={tdSt}>{o.advMismatch ? <span><span style={{ color: '#fbbf24', fontWeight: 700 }}>{o.reportAdvFirst || '—'}</span> <span style={{ color: '#64748b' }}>→ was {o.siteAdvFirst || '—'}</span></span> : <span style={{ color: '#64748b' }}>{o.siteAdvFirst || '—'} (unchanged)</span>}</td>
                          <td style={tdSt}>{o.techMismatch ? <span><span style={{ color: '#94a3b8' }}>{o.from === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.from}'s WIP`}</span> <span style={{ color: '#c4b5fd', fontWeight: 700 }}>→ {o.toTab}'s WIP</span></span> : <span style={{ color: '#64748b' }}>{o.from === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.from}'s WIP`} (unchanged)</span>}</td>
                         </>
                         : <>
                          <td style={tdSt}>{o.advisor || '—'}</td>
                          <td style={tdSt}>{o.vehicle || '—'}</td>
                          <td style={tdSt}>{o.tech || '—'}</td>
                          {modal === 'dup' && <td style={tdSt}>{o.where === 'Cars Awaiting' ? 'Cars Awaiting' : `${o.where}'s WIP`}</td>}
                          <td style={{ ...tdSt, color: flagTextColor(o.userFlag), fontWeight: 700 }}>{o.userFlag}</td>
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
