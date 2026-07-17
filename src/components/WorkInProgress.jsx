/* wip */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadWipData, saveWipData, loadAwaitingData, saveAwaitingData, appendRoArchive, listWipTechs, pollWipData, pollAwaitingData, isRateLimited, rateLimitResetSeconds } from '../utils/github';
import { trackAction } from '../utils/activityTracker';
import TechChat from './TechChat';
import PartsReceived, { canUsePartsReceived } from './PartsReceived';
import UnassignedRow, { unassignedSort } from './UnassignedRow';

function ChipBtn({ active, color, onClick, children }) {
  const colors = {
    green: { on: 'rgba(34,197,94,.25)', border: 'rgba(34,197,94,.5)', text: '#86efac' },
    red:   { on: 'rgba(239,68,68,.25)', border: 'rgba(239,68,68,.5)', text: '#fca5a5' },
  };
  const c = colors[color];
  return (
    <button onClick={onClick} style={{
      background: active ? c.on : 'rgba(255,255,255,.05)',
      border: `1px solid ${active ? c.border : 'rgba(255,255,255,.12)'}`,
      color: active ? c.text : '#64748b',
      borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
      transition: 'all .15s',
    }}>{children}</button>
  );
}

// Run `fn` over `items` with at most `limit` in flight at once. The RO search
// loads one file per tech; firing them all simultaneously trips GitHub's API
// rate limit, which silently drops matches (a found RO randomly "isn't found").
// Throttling to a few at a time keeps every file's results reliable.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const todayISO = () => new Date().toISOString().slice(0, 10); // yyyy-mm-dd for date inputs
const todayUS  = () => new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

const emptyRow = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: todayISO(), vehicle: '', jobDesc: '', etaParts: '', etaCompletion: '', partsArrived: null, partsArrivedDate: '', highPriority: false, advisor: '', notes: '', flag: 'purple',
});

// WIP flag taxonomy — a row's `flag` categorizes it on the tech's board.
// Every row belongs to exactly one flag; missing/unknown flags fall back to WIP.
const FLAGS = [
  { key: 'purple', label: 'WIP',       icon: '🛠️', color: '#a78bfa', border: 'rgba(167,139,250,.4)',  headBorder: 'rgba(167,139,250,.3)',  bg: 'rgba(30,41,59,.85)',    sub: 'General work in progress' },
  { key: 'pink',   label: 'PDI',       icon: '🔎', color: '#f472b6', border: 'rgba(244,114,182,.45)', headBorder: 'rgba(244,114,182,.35)', bg: 'rgba(244,114,182,.08)', sub: 'Pre-delivery inspection' },
  { key: 'green',  label: 'Used Car',  icon: '🚗', color: '#6ee7b7', border: 'rgba(52,211,153,.45)',  headBorder: 'rgba(52,211,153,.3)',   bg: 'rgba(52,211,153,.08)',  sub: "Still on this tech's board" },
];
const FLAG_BY_KEY = Object.fromEntries(FLAGS.map(f => [f.key, f]));
const flagOf = (r) => FLAG_BY_KEY[r && r.flag] ? r.flag : 'purple';

const inpSt = {
  background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8, color: '#f1f5f9', padding: '7px 10px', fontSize: 13,
  outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

// Strip duplicate WIP rows. Keeps the FIRST occurrence of each row id, and also
// dedupes by RO# (after id-dedupe) so the same RO can't appear twice on a tech.
function dedupeWip(rows) {
  const seenIds = new Set();
  const seenRos = new Set();
  const out = [];
  for (const r of rows || []) {
    if (r && r.id && seenIds.has(r.id)) continue;
    const ro = (r && r.ro || '').trim();
    if (ro && seenRos.has(ro)) continue;
    if (r && r.id) seenIds.add(r.id);
    if (ro) seenRos.add(ro);
    out.push(r);
  }
  return out;
}

const emptyAwaiting = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  ro: '', roDate: todayISO(), jobDesc: '', highPriority: false, advisor: '', notes: '', partsArrived: null, partsArrivedDate: '', isNew: true,
});

export default function WorkInProgress({ currentUser, currentRole, jobRole, techList, advisorList = [], onBack, backLabel, chatUsers, initialJob = null, onInitialJobConsumed }) {
  const canSeeTabs = currentRole === 'admin' || currentRole === 'advisor' || currentRole === 'lead advisor' || currentRole === 'warranty' || currentRole === 'parts' || (currentRole || '').includes('manager');
  const isManager        = currentRole === 'admin' || (currentRole || '').includes('manager');
  // What a tech DOES on a job (mark work complete) follows their job title, not
  // their view permissions — a tech with Management Access is still the one
  // turning the wrench. `currentRole` fallback covers callers that pass no jobRole.
  const isTech           = (jobRole || currentRole) === 'technician';
  const isManagerOrAdvisor = isManager || currentRole === 'advisor' || currentRole === 'lead advisor';
  const canDeleteAwaiting  = isManagerOrAdvisor;
  const canAssignAwaiting  = isManagerOrAdvisor;
  const [activeTech, setActiveTech] = useState(
    canSeeTabs ? (techList[0] || currentUser) : currentUser
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRow, setSavingRow] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);
  const [workCompleteConfirmId, setWorkCompleteConfirmId] = useState(null);
  const [error, setError] = useState('');
  // >0 while the shared GitHub quota is exhausted — drives a calm "busy" banner
  // instead of the raw rate-limit error, and counts down to reset.
  const [rateLimitedSec, setRateLimitedSec] = useState(0);
  const [searchRO, setSearchRO] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  const [showPartsReceived, setShowPartsReceived] = useState(false);
  const [techChatRefresh, setTechChatRefresh] = useState(0);
  const [showTechPicker, setShowTechPicker] = useState(false);
  const [creatingForTech, setCreatingForTech] = useState(null);
  const [techWizardAdvisor, setTechWizardAdvisor] = useState('');

  // Cars Awaiting Technician
  const [awaiting, setAwaiting] = useState([]);
  const [awaitingLoading, setAwaitingLoading] = useState(true);
  const [awaitingPickerId, setAwaitingPickerId] = useState(null); // id of row showing assign picker
  const [reassignPickerId, setReassignPickerId] = useState(null); // id of WIP row showing reassign picker
  const [movingId, setMovingId] = useState(null);
  const [awaitingSavingId, setAwaitingSavingId] = useState(null);
  const [claimConfirm, setClaimConfirm] = useState(null); // { aw, tech } pending confirmation
  const [advisorPickerId, setAdvisorPickerId] = useState(null);   // WIP row id
  const [awAdvisorPickerId, setAwAdvisorPickerId] = useState(null); // Awaiting row id
  const [copiedKey, setCopiedKey] = useState(null);
  const copyRoNum = (ro, key) => {
    if (!ro) return;
    const done = () => { setCopiedKey(key); setTimeout(() => setCopiedKey(k => k === key ? null : k), 1200); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ro).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = ro; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch {}
      document.body.removeChild(ta);
    }
  };
  const CopyRoBtn = ({ ro, k }) => (
    <button
      type="button"
      onClick={() => copyRoNum(ro, k)}
      title={ro ? 'Copy RO #' : ''}
      disabled={!ro}
      style={{
        marginLeft: 6, fontSize: 10, fontWeight: 800, cursor: ro ? 'pointer' : 'default',
        background: copiedKey === k ? 'rgba(74,222,128,.18)' : 'rgba(110,231,249,.12)',
        border: `1px solid ${copiedKey === k ? 'rgba(74,222,128,.5)' : 'rgba(110,231,249,.35)'}`,
        color: copiedKey === k ? '#4ade80' : '#6ee7f9',
        borderRadius: 5, padding: '1px 7px',
      }}
    >{copiedKey === k ? '✓ Copied' : '📋 Copy'}</button>
  );

  // Tracks which tech the current `rows` state was loaded for. Every save MUST
  // verify rowsTechRef.current === target tech. If not, abort — the state is
  // mid-transition and saving would write one tech's rows under another tech's
  // filename (which is exactly how CORY.json kept getting clobbered).
  const rowsTechRef = useRef(null);

  // Background-refresh bookkeeping. Polled refresh skips any row whose id is in
  // these sets so a user who's typed-but-not-saved doesn't lose their input.
  const dirtyRowsRef = useRef(new Set());
  const dirtyAwaitingRef = useRef(new Set());
  const rootRef = useRef(null);
  const loadSeqRef = useRef(0); // guards against out-of-order WIP file loads

  const load = useCallback(async (tech) => {
    // Each load gets a sequence number. Two loads can be in flight at once (e.g.
    // the initial tab's file is still loading when a View/Edit jump switches to
    // another tech). Only the NEWEST load may apply its result — otherwise a
    // slower earlier load can resolve last and overwrite the rows with the wrong
    // tech's data, leaving the user on the right tab but the wrong list (which is
    // exactly why View/Edit "wouldn't take you to the RO").
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError('');
    // Mark rows as belonging to no tech and clear them, so any save fired
    // during the load is short-circuited by the ref check.
    rowsTechRef.current = null;
    dirtyRowsRef.current = new Set();
    setRows([]);
    try {
      const raw = await loadWipData(tech);
      if (seq !== loadSeqRef.current) return; // superseded by a newer load
      const data = dedupeWip(raw);
      rowsTechRef.current = tech;
      setRows(data);
      // If we found and removed duplicates, persist the cleaned list back so
      // every viewer stops seeing the dupes.
      if (Array.isArray(raw) && data.length !== raw.length) {
        saveWipData(tech, data).catch(() => {});
      }
    } catch (e) {
      if (seq === loadSeqRef.current) setError(e.message);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  // Wraps any save targeted at `tech`. Aborts if rowsTechRef doesn't match,
  // which means a tab switch is mid-flight and `rows` doesn't belong to `tech`.
  function safeSaveWipData(tech, data) {
    if (rowsTechRef.current !== tech) {
      console.warn('[WIP] aborted cross-tech save', { target: tech, current: rowsTechRef.current });
      return Promise.resolve();
    }
    if (!Array.isArray(data)) return Promise.resolve();
    return saveWipData(tech, dedupeWip(data));
  }

  useEffect(() => { load(activeTech); }, [activeTech, load]);

  // ── Background refresh ─────────────────────────────────────────────────────
  // Polls the WIP file for the active tech and the Cars Awaiting list every
  // few seconds so changes from other users show up automatically. Skipped
  // entirely while the user has a field focused or has unsaved typing in a row,
  // so it never disrupts what the user is doing.
  useEffect(() => {
    function isUserTyping() {
      const ae = document.activeElement;
      if (!ae || !rootRef.current) return false;
      if (!rootRef.current.contains(ae)) return false;
      const tag = (ae.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable;
    }

    const intervalId = setInterval(async () => {
      // Skip if any blocking operation is running.
      if (loading || saving || savingRow || deletingRow || awaitingSavingId || movingId) return;
      if (isUserTyping()) return;
      // Don't poll while a search-results screen is open.
      if (searchResults !== null) return;
      // Quota is spent — don't add to the pile. The next poll after reset resumes
      // automatically. (The banner is driven by the 1s sync effect below.)
      if (isRateLimited()) return;

      const targetTech = activeTech;

      // Refresh WIP rows for the active tech. Conditional (ETag) request: an
      // unchanged file answers 304 for free, and { changed:false } means keep
      // what we have — no re-render, no quota spent.
      try {
        const res = await pollWipData(targetTech);
        // Bail if user switched tabs or started typing while we waited
        if (rowsTechRef.current !== targetTech) return;
        if (isUserTyping()) return;
        if (res.changed) {
          const fresh = dedupeWip(res.data);
          setRows(prev => {
            const dirty = dirtyRowsRef.current;
            if (dirty.size === 0) return fresh;
            const localById = new Map(prev.map(r => [r.id, r]));
            const merged = fresh.map(r => (dirty.has(r.id) && localById.has(r.id)) ? localById.get(r.id) : r);
            // Preserve any locally-added rows that aren't on the server yet
            for (const r of prev) {
              if (dirty.has(r.id) && !fresh.some(f => f.id === r.id)) merged.unshift(r);
            }
            return merged;
          });
        }
      } catch {}

      // Refresh Cars Awaiting — same conditional poll.
      try {
        const res = await pollAwaitingData();
        if (isUserTyping()) return;
        if (res.changed) {
          const freshAw = res.data;
          setAwaiting(prev => {
            const dirty = dirtyAwaitingRef.current;
            if (dirty.size === 0) return freshAw;
            const localById = new Map(prev.map(r => [r.id, r]));
            const merged = freshAw.map(r => (dirty.has(r.id) && localById.has(r.id)) ? localById.get(r.id) : r);
            for (const r of prev) {
              if (dirty.has(r.id) && !freshAw.some(f => f.id === r.id)) merged.unshift(r);
            }
            return merged;
          });
        }
      } catch {}

    }, 10000); // 10s — but a 304 costs nothing, so this is essentially free

    return () => clearInterval(intervalId);
  }, [activeTech, loading, saving, savingRow, deletingRow, awaitingSavingId, movingId, searchResults]);

  // Mirror the shared rate-limit state into the banner once a second. Centralized
  // here so it lights up within a second no matter WHAT tripped the limit — a
  // background poll or a failed move — without touching every catch site. Reading
  // is local-only (no network), so a 1s tick is free.
  useEffect(() => {
    const id = setInterval(() => {
      setRateLimitedSec(prev => {
        const next = rateLimitResetSeconds();
        return next === prev ? prev : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  function updateRow(id, field, value) {
    dirtyRowsRef.current.add(id);
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  // Toggle Parts Arrived with auto date stamp
  function togglePartsArrived(id, value) {
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? {
        ...r,
        partsArrived: value,
        partsArrivedDate: value === true ? today : '',
      } : r);
      safeSaveWipData(activeTech, updated).catch(e => setError(e.message));
      const victim = prev.find(r => r.id === id);
      trackAction(value === true ? 'mark-parts-arrived' : value === false ? 'mark-parts-pending' : 'undo-parts-arrived', `RO ${victim?.ro || '?'}`);
      return updated;
    });
  }

  // Silent auto-save for single-click toggles (no loading state shown)
  function updateRowAndSave(id, field, value) {
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      safeSaveWipData(activeTech, updated).catch(e => setError(e.message));
      return updated;
    });
  }

  function updateAwaitingAndSave(id, field, value) {
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      saveAwaitingData(updated).catch(e => setError(e.message));
      return updated;
    });
  }

  // Toggle Parts Arrived on a Cars-Awaiting row with an auto date stamp, mirroring
  // the WIP behavior so the parts dept can mark parts in before a tech claims it.
  function toggleAwaitingPartsArrived(id, value) {
    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === id ? {
        ...r,
        partsArrived: value,
        partsArrivedDate: value === true ? today : '',
      } : r);
      saveAwaitingData(updated).catch(e => setError(e.message));
      const victim = prev.find(r => r.id === id);
      trackAction(value === true ? 'awaiting-mark-parts-arrived' : value === false ? 'awaiting-mark-parts-pending' : 'awaiting-undo-parts-arrived', `RO ${victim?.ro || '?'}`);
      return updated;
    });
  }

  // Move an unassigned RO between "Cars Awaiting Technician" and "Used Cars".
  // Both sections read the same awaiting file — `usedCar` is the only thing that
  // decides which one a row sits in — so this is a flag flip, not a file move,
  // and it's reversible with the button on the other side.
  function setAwaitingUsedCar(aw, value) {
    setMovingId(aw.id);
    setAwaiting(prev => {
      const updated = prev.map(r => r.id === aw.id ? { ...r, usedCar: value } : r);
      saveAwaitingData(updated)
        .catch(e => setError(e.message))
        .finally(() => setMovingId(null));
      return updated;
    });
    trackAction(value ? 'awaiting-move-to-used-cars' : 'awaiting-move-to-cars-awaiting', `RO ${aw.ro || '?'}`);
  }

  async function saveRow(id) {
    // Don't save if we're between tabs (prevents writing one tech's rows under
    // another tech's filename during a tab switch).
    if (loading) return;
    if (rowsTechRef.current !== activeTech) return;
    setSavingRow(id);
    setError('');
    try {
      await safeSaveWipData(activeTech, rows);
      dirtyRowsRef.current.delete(id);
    } catch (e) { setError(e.message); }
    finally { setSavingRow(null); }
  }

  async function deleteRow(id) {
    if (rowsTechRef.current !== activeTech) return;
    setDeletingRow(id);
    setError('');
    try {
      const victim = rows.find(r => r.id === id);
      trackAction('delete-wip-row', `RO ${victim?.ro || '?'} tech ${activeTech || '?'}`);
      const updated = rows.filter(r => r.id !== id);
      await safeSaveWipData(activeTech, updated);
      setRows(updated);
      dirtyRowsRef.current.delete(id);
      // Fire-and-forget archive append — never block the UI on the archive.
      if (victim) {
        try {
          await appendRoArchive({
            ...victim,
            _archiveId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            _archivedAt: new Date().toISOString(),
            _archivedBy: (currentUser || '').toUpperCase(),
            _source: 'wip',
            _sourceTech: activeTech,
          });
        } catch (archErr) { console.warn('RO archive append failed:', archErr); }
      }
    } catch (e) { setError(e.message); }
    finally { setDeletingRow(null); }
  }

  async function addRow() {
    // Guard against adding to the wrong tech mid tab-switch.
    if (rowsTechRef.current !== activeTech) return;
    const fresh = emptyRow();
    // Persist the new row to disk immediately (mirrors addAwaitingRow). Marking it
    // dirty alone is not enough: switching tabs resets dirtyRowsRef and a refresh
    // discards in-memory rows, so an unsaved add silently disappears. Writing now
    // means the row survives tab switches, polls, and reloads before the user fills
    // it in and clicks Save.
    dirtyRowsRef.current.add(fresh.id);
    const updated = [fresh, ...rows];
    setRows(updated);
    try { await safeSaveWipData(activeTech, updated); } catch (e) { setError(e.message); }
  }

  async function handleBack() {
    setSaving(true);
    try { await safeSaveWipData(activeTech, rows); } catch {}
    setSaving(false);
    onBack();
  }

  // Build and open a clean, modern printable sheet of the active tech's WIP list.
  // Renders into a fresh window with its own light-theme stylesheet so the print
  // never inherits the app's dark UI, then fires the browser print dialog.
  function printWip() {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Match the on-screen order: high priority first, otherwise stable.
    const ordered = [...rows].sort((a, b) => (b.highPriority ? 1 : 0) - (a.highPriority ? 1 : 0));

    const printedOn = new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });

    const partsCell = (r) => {
      if (r.partsArrived === true) return `<span class="pill pill-green">Parts Here${r.partsArrivedDate ? ` &middot; ${esc(r.partsArrivedDate)}` : ''}</span>`;
      if (r.partsArrived === false) return `<span class="pill pill-red">Not In</span>`;
      return `<span class="muted">—</span>`;
    };

    const rowsHtml = ordered.map((r, i) => `
      <div class="card${r.highPriority ? ' card-hi' : ''}">
        <div class="card-head">
          <div class="ro-block">
            <span class="ro-num">RO# ${esc(r.ro || '—')}</span>
            ${r.highPriority ? '<span class="pill pill-hi">HIGH PRIORITY</span>' : ''}
          </div>
          <div class="row-index">#${i + 1}</div>
        </div>
        <div class="grid">
          <div class="field"><div class="flabel">RO Date</div><div class="fval">${esc(r.roDate || '—')}</div></div>
          <div class="field"><div class="flabel">Vehicle</div><div class="fval">${esc(r.vehicle || '—')}</div></div>
          <div class="field"><div class="flabel">Advisor</div><div class="fval">${esc(r.advisor || '—')}</div></div>
          <div class="field"><div class="flabel">Parts Arrived</div><div class="fval">${partsCell(r)}</div></div>
          <div class="field"><div class="flabel">ETA Parts</div><div class="fval">${esc(r.etaParts || '—')}</div></div>
          <div class="field"><div class="flabel">ETA Completion</div><div class="fval">${esc(r.etaCompletion || '—')}</div></div>
        </div>
        <div class="field field-wide"><div class="flabel">Job Description</div><div class="fval">${esc(r.jobDesc || '—')}</div></div>
        ${r.notes ? `<div class="field field-wide"><div class="flabel">Notes</div><div class="fval notes">${esc(r.notes)}</div></div>` : ''}
      </div>
    `).join('');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>WIP — ${esc(activeTech)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a; background: #fff; padding: 28px 32px; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .head { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #0ea5b7; padding-bottom: 14px; margin-bottom: 22px; }
  .head h1 { font-size: 22px; margin: 0; letter-spacing: -.01em; }
  .head .sub { font-size: 13px; color: #64748b; margin-top: 4px; }
  .head .tech { font-size: 28px; font-weight: 800; color: #0ea5b7; letter-spacing: -.02em; }
  .head .meta { text-align: right; font-size: 12px; color: #64748b; }
  .count { font-size: 12px; color: #475569; margin-bottom: 16px; font-weight: 600; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; page-break-inside: avoid; }
  .card-hi { border-color: #fca5a5; background: #fff5f5; }
  .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .ro-block { display: flex; align-items: center; gap: 10px; }
  .ro-num { font-size: 17px; font-weight: 800; color: #0f172a; }
  .row-index { font-size: 12px; font-weight: 700; color: #94a3b8; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 20px; margin-bottom: 8px; }
  .field { min-width: 0; }
  .field-wide { margin-top: 6px; }
  .flabel { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; font-weight: 700; margin-bottom: 2px; }
  .fval { font-size: 13px; color: #1e293b; word-wrap: break-word; }
  .fval.notes { white-space: pre-wrap; line-height: 1.5; }
  .muted { color: #cbd5e1; }
  .pill { display: inline-block; font-size: 10px; font-weight: 800; padding: 2px 9px; border-radius: 999px; }
  .pill-green { background: #dcfce7; color: #15803d; }
  .pill-red { background: #fee2e2; color: #b91c1c; }
  .pill-hi { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .empty { text-align: center; color: #94a3b8; padding: 60px 0; font-size: 15px; }
  .foot { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @page { margin: 0.5in; }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>Work in Progress</h1>
      <div class="sub">Rohrman Hyundai &middot; Service</div>
    </div>
    <div class="meta">
      <div class="tech">${esc(activeTech)}</div>
      <div>Printed ${esc(printedOn)}</div>
    </div>
  </div>
  <div class="count">${ordered.length} open repair order${ordered.length === 1 ? '' : 's'}</div>
  ${ordered.length ? rowsHtml : '<div class="empty">No work in progress for this technician.</div>'}
  <div class="foot">Rohrman Hyundai Service — Work in Progress — ${esc(activeTech)}</div>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { setError('Pop-up blocked — allow pop-ups to print.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Give the new document a tick to lay out before invoking print.
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 350);
  }

  // Map a tech name to the exact casing used in the tab roster (techList) so a
  // jump always lands on a real, selected tab. WIP files are stored uppercase
  // (listWipTechs returns UPPERCASE) while techList may be mixed-case; without
  // this, setActiveTech('JACOB') leaves the 'Jacob' tab unselected and the row
  // can fail to surface. Falls back to the trimmed name for off-roster techs.
  const canonTech = useCallback((name) => {
    const nm = String(name || '').trim();
    if (!nm) return nm;
    const lower = nm.toLowerCase();
    return (techList || []).find(t => String(t).trim().toLowerCase() === lower) || nm;
  }, [techList]);

  async function handleSearch(explicitQuery) {
    const q = (typeof explicitQuery === 'string' ? explicitQuery : searchRO).trim();
    if (!q) { setSearchResults(null); return; }
    setSearching(true);
    setSearchResults(null);
    try {
      // Search EVERY WIP file on disk — not just the live technician roster — so
      // ROs owned by a renamed/reassigned/off-roster tech are still found. This
      // is the same authoritative scan set the direct-open navigation uses.
      let owners = [];
      try { owners = await listWipTechs(); } catch { owners = []; }
      const seenTech = new Set();
      const scanSet = [];
      for (const t of [...owners, ...(techList || [])]) {
        const name = String(t || '').trim();
        if (!name) continue;
        const key = name.toUpperCase();
        if (seenTech.has(key)) continue;
        seenTech.add(key);
        scanSet.push(name);
      }

      // Throttle the per-tech loads (see mapLimit) so a wide roster doesn't trip
      // the GitHub rate limit and silently drop matches.
      const wipResults = await mapLimit(scanSet, 4, async tech => {
        try {
          const data = await loadWipData(tech);
          return (data || [])
            .filter(r => (r.ro || '').toLowerCase().includes(q.toLowerCase()))
            .map(r => ({ ...r, techName: tech, _source: 'wip' }));
        } catch { return []; }
      });
      // Also search Cars Awaiting. Used-car rows are excluded: they render on the
      // Used Car Hub, so a hit here would scroll to a row that isn't on this page.
      const awaitingMatches = awaiting
        .filter(r => !r.usedCar && (r.ro || '').toLowerCase().includes(q.toLowerCase()))
        .map(r => ({ ...r, techName: 'Cars Awaiting', _source: 'awaiting' }));

      const allMatches = [...wipResults.flat(), ...awaitingMatches];

      // A full RO# is almost always a single, unique match — jump straight to it
      // instead of making the user click through a one-item results list.
      if (allMatches.length === 1) {
        const r = allMatches[0];
        if (r._source !== 'awaiting') setActiveTech(canonTech(r.techName));
        setHighlightRO(r.ro || '');
        clearSearch();
        return;
      }

      setSearchResults(allMatches);
    } catch (e) { setError(e.message); }
    finally { setSearching(false); }
  }

  function clearSearch() { setSearchRO(''); setSearchResults(null); setShowTechPicker(false); setCreatingForTech(null); setTechWizardAdvisor(''); }

  // Load awaiting on mount
  useEffect(() => {
    loadAwaitingData().then(d => { setAwaiting(d); setAwaitingLoading(false); }).catch(() => setAwaitingLoading(false));
  }, []);

  // Highlighted RO (set when user clicks "View / Edit" from Advisor Calendar)
  const [highlightRO, setHighlightRO] = useState('');
  const highlightedRowRef = useRef(null);
  // Tracks the job we're currently navigating to. The async owner-scan checks
  // this after each await so a NEW job (or unmount) supersedes an in-flight
  // scan — but the scan is NOT cancelled merely because the parent clears
  // initialJob (the "consume"), which would otherwise abort it prematurely.
  const activeJobKeyRef = useRef('');

  // If launched targeting a specific RO, jump straight to the right tab/section
  // and highlight the row instead of going through the search results UI.
  useEffect(() => {
    // When the parent clears the job (consume), reset the per-job guard so the
    // very next click — even on the same RO — navigates again.
    if (!initialJob || !initialJob.ro) { activeJobKeyRef.current = ''; return; }
    const ro = initialJob.ro.trim();

    // Case-insensitive tech-list lookup so e.g. "Jacob"/"JACOB"/"jacob" all match.
    const matchListTech = (t) => {
      if (!t) return null;
      const tl = String(t).trim().toLowerCase();
      return (techList || []).find(n => String(n).trim().toLowerCase() === tl) || null;
    };

    // Process each distinct job exactly once so an awaitingLoading flip (the
    // effect's other dependency) doesn't re-run the jump while it's in flight.
    const jobKey = `${initialJob.source || ''}|${initialJob.tech || ''}|${ro}`;
    if (activeJobKeyRef.current === jobKey) return;
    activeJobKeyRef.current = jobKey;

    const consume = () => { onInitialJobConsumed && onInitialJobConsumed(); };
    const stillCurrent = () => activeJobKeyRef.current === jobKey;
    const roLower = ro.toLowerCase();

    // Cars Awaiting: the RO lives in the awaiting list, not a tech tab. Just
    // highlight it — the scroll effect (which depends on `awaiting`) scrolls to
    // it once that list loads. Don't run handleSearch here: right after
    // navigation the awaiting state often hasn't loaded yet, so it would find
    // nothing and strand the user on an empty search-results screen.
    if (initialJob.source === 'awaiting') {
      setSearchResults(null);
      setSearchRO('');
      setHighlightRO(ro);
      consume();
      return;
    }

    const hint = initialJob.tech
      ? (matchListTech(initialJob.tech) || String(initialJob.tech).trim())
      : '';
    setSearchResults(null);
    // Keep the RO in the search field: if we fall back to handleSearch and it
    // finds no match, it shows the "create this RO" wizard, whose createForTech()
    // reads searchRO for the new row's number.
    setSearchRO(ro);
    setHighlightRO(ro);

    if (!hint) {
      // No tech hint (e.g. typing a brand-new RO to create) — use the
      // authoritative resolver, which also surfaces the create wizard.
      handleSearch(ro);
      consume();
      return;
    }

    // We have a tech hint and the RO almost certainly lives in that tech's file
    // (the calendar built its result by loading that very file). TRUST it: jump
    // to the tab and load that file DIRECTLY — no dependency on listWipTechs(),
    // whose full-directory scan can rate-limit or lag and was making View/Edit
    // intermittently fail to land on the RO. Only if the RO genuinely isn't in
    // the hinted file do we fall back to the broad search.
    setActiveTech(hint);
    (async () => {
      try {
        const data = await loadWipData(hint);
        if (!stillCurrent()) return;
        if ((data || []).some(r => (r.ro || '').toLowerCase().includes(roLower))) {
          // Already on the right tab; the highlight/scroll effect handles the rest.
          consume();
          return;
        }
      } catch { /* fall through to authoritative search */ }
      if (!stillCurrent()) return;
      handleSearch(ro);
      consume();
    })();

    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob, awaitingLoading]);

  // Scroll the highlighted row into view once it renders. The target row may not
  // exist on the first effect run (rows for the active tech are fetched async
  // after activeTech changes), so retry a few times before giving up. Only start
  // the 10s clear timer once the row has actually been scrolled to.
  useEffect(() => {
    if (!highlightRO) return;
    let cancelled = false;
    let clearTimer = null;
    let attempts = 0;
    function tryScroll() {
      if (cancelled) return;
      if (highlightedRowRef.current) {
        try { highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        clearTimer = setTimeout(() => { if (!cancelled) setHighlightRO(''); }, 10000);
        return;
      }
      if (attempts++ < 60) {
        setTimeout(tryScroll, 200); // retry for up to ~12s while a slow tab loads
      } else {
        // Give up scrolling but clear the highlight after a beat anyway.
        clearTimer = setTimeout(() => { if (!cancelled) setHighlightRO(''); }, 6000);
      }
    }
    const t = setTimeout(tryScroll, 100);
    return () => { cancelled = true; clearTimeout(t); if (clearTimer) clearTimeout(clearTimer); };
  }, [highlightRO, rows, awaiting]);

  // When a non-manager (advisor) opens a flagged RO, lower the "Needs Attention"
  // flag right here in the WIP page — not just in the calendar. Clearing it in
  // the calendar alone is racy: the advisor's later edit/save of the row writes
  // the (still-loaded) row back to disk with flagged:true, resurrecting it. By
  // clearing it in this component's own state, any subsequent save keeps it down.
  const clearedFlagRoRef = useRef('');
  useEffect(() => {
    if (!highlightRO || isManager) return;
    const roLower = highlightRO.trim().toLowerCase();
    if (!roLower) return;
    if (clearedFlagRoRef.current === roLower) return;

    // WIP row for the active tech.
    const wipRow = rows.find(r => (r.ro || '').toLowerCase().includes(roLower) && r.flagged);
    if (wipRow) {
      clearedFlagRoRef.current = roLower;
      const updated = rows.map(r => r.id === wipRow.id ? { ...r, flagged: false } : r);
      setRows(updated);
      safeSaveWipData(activeTech, updated);
      return;
    }

    // Otherwise it may live in Cars Awaiting.
    const awRow = awaiting.find(r => (r.ro || '').toLowerCase().includes(roLower) && r.flagged);
    if (awRow) {
      clearedFlagRoRef.current = roLower;
      const updated = awaiting.map(r => r.id === awRow.id ? { ...r, flagged: false } : r);
      setAwaiting(updated);
      saveAwaitingData(updated).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRO, rows, awaiting, isManager, activeTech]);

  function updateAwaiting(id, field, value) {
    dirtyAwaitingRef.current.add(id);
    setAwaiting(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function saveAwaiting(rows) {
    try { await saveAwaitingData(rows); } catch (e) { setError(e.message); }
  }

  // `usedCar` decides which of the two unassigned sections the new row lands in.
  async function addAwaitingRow(usedCar = false) {
    const fresh = { ...emptyAwaiting(), usedCar };
    dirtyAwaitingRef.current.add(fresh.id);
    const updated = [fresh, ...awaiting];
    setAwaiting(updated);
    await saveAwaiting(updated);
  }

  async function deleteAwaitingRow(id) {
    const victim = awaiting.find(r => r.id === id);
    trackAction('delete-awaiting-row', `RO ${victim?.ro || '?'}`);
    const updated = awaiting.filter(r => r.id !== id);
    setAwaiting(updated);
    await saveAwaiting(updated);
    dirtyAwaitingRef.current.delete(id);
    if (victim) {
      try {
        await appendRoArchive({
          ...victim,
          _archiveId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          _archivedAt: new Date().toISOString(),
          _archivedBy: (currentUser || '').toUpperCase(),
          _source: 'awaiting',
          _sourceTech: '',
        });
      } catch (archErr) { console.warn('RO archive append failed:', archErr); }
    }
  }

  async function saveAwaitingRow(id) {
    setAwaitingSavingId(id);
    try {
      // Clear isNew flag so row moves into sorted order after save
      const committed = awaiting.map(r => r.id === id ? { ...r, isNew: false } : r);
      await saveAwaitingData(committed);
      setAwaiting(committed);
      dirtyAwaitingRef.current.delete(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setAwaitingSavingId(null);
    }
  }

  // Move from awaiting → tech's WIP
  async function claimAwaiting(awaitingRow, tech) {
    setMovingId(awaitingRow.id);
    try {
      const existing = await loadWipData(tech);
      const newWipRow = { ...emptyRow(), ro: awaitingRow.ro, roDate: awaitingRow.roDate, jobDesc: awaitingRow.jobDesc, highPriority: !!awaitingRow.highPriority, advisor: awaitingRow.advisor || '', notes: awaitingRow.notes || '', partsArrived: awaitingRow.partsArrived ?? null, partsArrivedDate: awaitingRow.partsArrivedDate || '' };
      const deduped = dedupeWip([...existing, newWipRow]);
      await saveWipData(tech, deduped);
      const updatedAwaiting = awaiting.filter(r => r.id !== awaitingRow.id);
      setAwaiting(updatedAwaiting);
      await saveAwaitingData(updatedAwaiting);
      setActiveTech(tech);
      const data = await loadWipData(tech);
      setRows(data);
      setAwaitingPickerId(null);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  // Move a WIP row back to Cars Awaiting Technician (the inverse of "Claim It").
  // Removes the row from the current tech's WIP file and re-adds it as an
  // awaiting entry with the same RO / date / job desc / advisor / priority.
  async function moveToAwaiting(wipRow) {
    if (rowsTechRef.current !== activeTech) return;
    if (!window.confirm(`Move RO #${wipRow.ro || '(blank)'} back to Cars Awaiting Technician?`)) return;
    setMovingId(wipRow.id);
    try {
      // 1. Remove from this tech's WIP
      const remaining = dedupeWip(rows.filter(r => r.id !== wipRow.id));
      await safeSaveWipData(activeTech, remaining);
      setRows(remaining);
      // 2. Add to awaiting (avoid duplicating an existing awaiting row by id or RO)
      const existingAwaiting = await loadAwaitingData();
      const filteredAwaiting = (existingAwaiting || []).filter(r =>
        r.id !== wipRow.id && (r.ro || '') !== (wipRow.ro || '')
      );
      const awRow = {
        ...emptyAwaiting(),
        id: wipRow.id,
        ro: wipRow.ro || '',
        roDate: wipRow.roDate || todayISO(),
        jobDesc: wipRow.jobDesc || '',
        highPriority: !!wipRow.highPriority,
        advisor: wipRow.advisor || '',
        notes: wipRow.notes || '',
        partsArrived: wipRow.partsArrived ?? null,
        partsArrivedDate: wipRow.partsArrivedDate || '',
        isNew: false,
      };
      const updatedAwaiting = [awRow, ...filteredAwaiting];
      await saveAwaitingData(updatedAwaiting);
      setAwaiting(updatedAwaiting);
    } catch (e) {
      setError(e.message || 'Failed to move row.');
    } finally {
      setMovingId(null);
    }
  }

  // Set a WIP row's flag (WIP / PDI / Used Car). The row STAYS on this tech's
  // board — the flag just decides which section it sits in. `usedCar` is kept in
  // sync with the green flag for the Cars Awaiting filter and any legacy checks.
  async function setFlag(wipRow, flagKey) {
    if (rowsTechRef.current !== activeTech) return;
    if (flagOf(wipRow) === flagKey) return; // no-op if already that flag
    setMovingId(wipRow.id);
    try {
      const updated = dedupeWip(rows.map(r =>
        r.id === wipRow.id ? { ...r, flag: flagKey, usedCar: flagKey === 'green' } : r
      ));
      await safeSaveWipData(activeTech, updated);
      setRows(updated);
    } catch (e) {
      setError(e.message || 'Failed to update flag.');
    } finally {
      setMovingId(null);
    }
  }

  // Reassign existing WIP row to different tech (managers only)
  async function reassignRow(wipRow, newTech) {
    if (rowsTechRef.current !== activeTech) return;
    setMovingId(wipRow.id);
    try {
      // Remove from current tech (also strip any duplicates by id or RO)
      const current = dedupeWip(rows.filter(r => r.id !== wipRow.id && (r.ro || '') !== (wipRow.ro || '')));
      await safeSaveWipData(activeTech, current);
      setRows(current);
      // Add to new tech (drop any pre-existing copies of this row by id or RO before appending)
      const existing = await loadWipData(newTech);
      const filteredExisting = existing.filter(r => r.id !== wipRow.id && (r.ro || '') !== (wipRow.ro || ''));
      // Direct save — newTech isn't the currently-loaded tech, so safeSave's ref check would block this.
      await saveWipData(newTech, dedupeWip([...filteredExisting, { ...wipRow }]));
      setReassignPickerId(null);
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  }

  async function createForTech(tech) {
    setCreatingForTech(tech);
    try {
      const existing = await loadWipData(tech);
      const ro = searchRO.trim();
      // Don't create a second row for the same RO on the same tech
      if (existing.some(r => (r.ro || '').trim() === ro)) {
        setActiveTech(tech);
        setRows(existing);
        clearSearch();
        return;
      }
      const newRow = { ...emptyRow(), ro, advisor: techWizardAdvisor || '' };
      const updated = dedupeWip([...existing, newRow]);
      await saveWipData(tech, updated);
      setActiveTech(tech);
      setRows(updated);
      clearSearch();
    } catch (e) { setError(e.message); }
    finally { setCreatingForTech(null); }
  }

  // Multi-step "Add to Awaiting" wizard: step 0=idle, 1=pick advisor, 2=job desc
  const [awaitingWizardStep, setAwaitingWizardStep] = useState(0);
  const [awaitingWizardAdvisor, setAwaitingWizardAdvisor] = useState('');
  const [awaitingWizardJobDesc, setAwaitingWizardJobDesc] = useState('');
  const [creatingForAwaiting, setCreatingForAwaiting] = useState(false);

  function cancelAwaitingWizard() {
    setAwaitingWizardStep(0);
    setAwaitingWizardAdvisor('');
    setAwaitingWizardJobDesc('');
  }

  async function createForAwaiting() {
    setCreatingForAwaiting(true);
    try {
      const fresh = { ...emptyAwaiting(), ro: searchRO.trim(), advisor: awaitingWizardAdvisor, jobDesc: awaitingWizardJobDesc, isNew: false };
      const updated = [fresh, ...awaiting];
      await saveAwaitingData(updated);
      setAwaiting(updated);
      cancelAwaitingWizard();
      clearSearch();
    } catch (e) { setError(e.message); }
    finally { setCreatingForAwaiting(false); }
  }

  const labelSt = { fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 };
  const backText = backLabel || '← Technician Resources';

  const hasChatAccess = chatUsers && chatUsers.map(u => u.toUpperCase()).includes(currentUser.toUpperCase());

  // Rows tagged `usedCar` belong to the used-car team and render on the Used Car
  // Hub, not here — this list is the unassigned pool techs claim from.
  const visibleAwaiting = awaiting.filter(r => !r.usedCar);

  return (
    <div ref={rootRef} className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {showPartsReceived && (
        <PartsReceived currentUser={currentUser} onPosted={() => setTechChatRefresh(n => n + 1)} onClose={() => setShowPartsReceived(false)} />
      )}
      {/* Topbar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔧 Work in Progress</div>
          <div className="adv-sub">{activeTech}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={printWip}
          disabled={loading || searchResults !== null}
          title={`Print ${activeTech}'s Work in Progress`}
          style={{
            background: 'rgba(110,231,249,.14)', border: '1px solid rgba(110,231,249,.4)',
            color: '#6ee7f9', borderRadius: 8, padding: '7px 16px', cursor: (loading || searchResults !== null) ? 'not-allowed' : 'pointer',
            fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', opacity: (loading || searchResults !== null) ? 0.5 : 1,
          }}
        >🖨️ Print WIP</button>
        <button className="secondary" onClick={handleBack} disabled={saving}>
          {saving ? '⏳ Saving…' : backText}
        </button>
      </div>

      {/* Tech tabs + RO search (manager/advisor/admin/warranty only) */}
      {canSeeTabs && techList.length > 0 && (
        <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          {/* Tabs row */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 20px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
            {techList.map(name => (
              <button
                key={name}
                onClick={() => { setActiveTech(name); clearSearch(); }}
                style={{
                  background: activeTech === name && !searchResults ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${activeTech === name && !searchResults ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: activeTech === name && !searchResults ? '#c4b5fd' : '#64748b',
                  borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  transition: 'all .15s',
                }}
              >{name}</button>
            ))}
            {/* RO Search */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {canUsePartsReceived(currentRole) && (
                <button
                  onClick={() => setShowPartsReceived(true)}
                  style={{ background: 'rgba(110,231,183,.18)', border: '1px solid rgba(110,231,183,.45)', color: '#6ee7b7', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}
                >📦 Parts Received</button>
              )}
              <input
                value={searchRO}
                onChange={e => setSearchRO(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search RO#…"
                style={{
                  background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)',
                  borderRadius: 8, color: '#f1f5f9', padding: '6px 12px', fontSize: 13,
                  outline: 'none', fontFamily: 'inherit', width: 160,
                }}
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              >{searching ? '⏳' : '🔍 Search'}</button>
              {searchResults !== null && (
                <button onClick={clearSearch} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>✕ Clear</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content + Chat */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {rateLimitedSec > 0 && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>
            ⏳ Syncing is busy right now — the dashboard hit GitHub's shared limit. Changes will save automatically in about {rateLimitedSec < 60 ? `${rateLimitedSec}s` : `${Math.ceil(rateLimitedSec / 60)} min`}. You can keep working; nothing is lost.
          </div>
        )}
        {error && !(rateLimitedSec > 0 && /rate limit/i.test(error)) && <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>{error}</div>}

        {/* Search results panel */}
        {searchResults !== null && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
              {searchResults.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ color: '#94a3b8' }}>No results found for RO# &ldquo;{searchRO}&rdquo;</span>
                  {!showTechPicker && (
                    <button
                      onClick={() => setShowTechPicker(true)}
                      style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                    >+ Create</button>
                  )}
                </div>
              ) : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for RO# "${searchRO}"`}
            </div>
            {showTechPicker && searchResults.length === 0 && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                {/* Assign to Tech */}
                <div style={{ flex: 1, minWidth: 260, background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.25)', borderRadius: 14, padding: '16px 20px' }}>
                  {!techWizardAdvisor ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Step 1 of 2 — Select Advisor</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {advisorList.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>No advisors found.</span>}
                        {advisorList.map(adv => (
                          <button key={adv}
                            onClick={() => setTechWizardAdvisor(adv)}
                            style={{ background: 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                          >{adv}</button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 0.5 }}>Step 2 of 2 — Select Technician</div>
                        <button onClick={() => setTechWizardAdvisor('')} disabled={!!creatingForTech} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>← Change advisor</button>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>Advisor: <strong style={{ color: '#4ade80' }}>{techWizardAdvisor}</strong></div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {techList.map(tech => (
                          <button
                            key={tech}
                            onClick={() => createForTech(tech)}
                            disabled={!!creatingForTech}
                            style={{ background: creatingForTech === tech ? 'rgba(74,222,128,.35)' : 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, transition: 'all .15s' }}
                          >{creatingForTech === tech ? '⏳ Adding…' : tech}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {/* Cars Awaiting Technician wizard */}
                <div style={{ flex: 1, minWidth: 260, background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.5 }}>🚗 Cars Awaiting Technician</div>
                    {awaitingWizardStep > 0 && (
                      <button onClick={cancelAwaitingWizard} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✕ Cancel</button>
                    )}
                  </div>

                  {awaitingWizardStep === 0 && (
                    <>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Not assigned to a tech yet? Add it to the waiting list.</div>
                      <button
                        onClick={() => setAwaitingWizardStep(1)}
                        style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 8, padding: '8px 22px', cursor: 'pointer', fontWeight: 900, fontSize: 13, alignSelf: 'flex-start' }}
                      >+ Add to Awaiting</button>
                    </>
                  )}

                  {awaitingWizardStep === 1 && (
                    <>
                      <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>Step 1 of 2 — Select Advisor</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {advisorList.length === 0 && <span style={{ fontSize: 12, color: '#64748b' }}>No advisors found.</span>}
                        {advisorList.map(adv => (
                          <button key={adv}
                            onClick={() => { setAwaitingWizardAdvisor(adv); setAwaitingWizardStep(2); }}
                            style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                          >{adv}</button>
                        ))}
                      </div>
                    </>
                  )}

                  {awaitingWizardStep === 2 && (
                    <>
                      <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>Step 2 of 2 — Job Description</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Advisor: <strong style={{ color: '#fbbf24' }}>{awaitingWizardAdvisor}</strong></div>
                      <input
                        value={awaitingWizardJobDesc}
                        onChange={e => setAwaitingWizardJobDesc(e.target.value)}
                        placeholder="Describe the job…"
                        style={{ ...inpSt }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setAwaitingWizardStep(1)} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)', color: '#94a3b8', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>← Back</button>
                        <button
                          onClick={createForAwaiting}
                          disabled={!awaitingWizardJobDesc.trim() || creatingForAwaiting}
                          style={{ background: awaitingWizardJobDesc.trim() ? 'rgba(74,222,128,.25)' : 'rgba(255,255,255,.04)', border: `1px solid ${awaitingWizardJobDesc.trim() ? 'rgba(74,222,128,.5)' : 'rgba(255,255,255,.1)'}`, color: awaitingWizardJobDesc.trim() ? '#4ade80' : '#475569', borderRadius: 8, padding: '7px 20px', cursor: awaitingWizardJobDesc.trim() ? 'pointer' : 'not-allowed', fontWeight: 900, fontSize: 13 }}
                        >{creatingForAwaiting ? '⏳ Creating…' : '✅ Create & Add to Awaiting'}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {searchResults.map((r, idx) => {
              const isAwaiting = r._source === 'awaiting';
              return (
              <div
                key={r.id + idx}
                onClick={() => { if (!isAwaiting) setActiveTech(canonTech(r.techName)); setHighlightRO(r.ro || ''); clearSearch(); }}
                style={{ background: isAwaiting ? 'rgba(251,191,36,.07)' : 'rgba(61,214,195,.07)', border: `1px solid ${isAwaiting ? 'rgba(251,191,36,.3)' : 'rgba(61,214,195,.25)'}`, borderRadius: 14, padding: '14px 18px', marginBottom: 10, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = isAwaiting ? 'rgba(251,191,36,.15)' : 'rgba(61,214,195,.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isAwaiting ? 'rgba(251,191,36,.07)' : 'rgba(61,214,195,.07)'; }}
              >
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isAwaiting ? '#fbbf24' : '#3dd6c3', textTransform: 'uppercase' }}>
                    {isAwaiting ? '⏳ Cars Awaiting' : `Tech: ${r.techName}`}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#6ee7f9' }}>RO# {r.ro}</span>
                  {r.roDate && <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.roDate}</span>}
                  {r.highPriority && <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>🔴 HIGH PRIORITY</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{isAwaiting ? 'In Cars Awaiting' : 'Click to view →'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px 16px' }}>
                  {r.jobDesc && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Job: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.jobDesc}</span></div>}
                  {r.etaParts && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Parts: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaParts}</span></div>}
                  {r.etaCompletion && <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>ETA Completion: </span><span style={{ fontSize: 13, color: '#e2e8f0' }}>{r.etaCompletion}</span></div>}
                  {r.partsArrived === true ? (
                    <div className="parts-here-badge" style={{ padding: '6px 10px', fontSize: 11 }}>
                      <span className="pha-icon" style={{ fontSize: 16 }}>📦</span>
                      <span>Parts Here</span>
                      {r.partsArrivedDate && <span className="pha-date">📅 {r.partsArrivedDate}</span>}
                    </div>
                  ) : (
                    <div><span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Parts Arrived: </span><span style={{ fontSize: 13, color: r.partsArrived === false ? '#fca5a5' : '#475569' }}>{r.partsArrived === false ? '✗ No' : '—'}</span></div>
                  )}
                </div>
              </div>
            );})}

          </div>
        )}

        {loading ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
        ) : searchResults !== null ? null : (
          <>
            {rows.length === 0 && (
              <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0', fontSize: 14 }}>No work in progress. Click "Add Row" to get started.</div>
            )}

            {(() => {
              // Group this tech's rows into flag sections (WIP → PDI → Used
              // Cars). Every row is one of the three; they all stay on the tech's
              // board — the flag just decides which section it sits in.
              const byPriority = (a, b) => (b.highPriority ? 1 : 0) - (a.highPriority ? 1 : 0);
              const ordered = FLAGS.flatMap(g => {
                const gr = rows.filter(r => flagOf(r) === g.key).sort(byPriority);
                return gr.map((row, i) => ({ row, group: g, groupIdx: i, groupCount: gr.length }));
              });
              return ordered.map(({ row, group, groupIdx }, idx) => {
              const isHighlighted = !!highlightRO && (row.ro || '').trim().toLowerCase().includes(highlightRO.trim().toLowerCase());
              const isFirstOfGroup = groupIdx === 0;
              return (
              <React.Fragment key={row.id}>
              {isFirstOfGroup && (
                <div style={{ marginTop: idx === 0 ? 4 : 30, marginBottom: 14, paddingTop: idx === 0 ? 0 : 18, borderTop: idx === 0 ? 'none' : `2px solid ${group.headBorder}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: group.color, textTransform: 'uppercase', letterSpacing: 1 }}>{group.icon} {group.label}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{group.sub}</span>
                </div>
              )}
              <div ref={isHighlighted ? highlightedRowRef : null} style={{
                background: isHighlighted ? 'rgba(96,165,250,.14)' : (row.highPriority ? 'rgba(239,68,68,.08)' : group.bg),
                border: `${isHighlighted ? 2 : 1}px solid ${isHighlighted ? 'rgba(96,165,250,.7)' : (row.highPriority ? 'rgba(239,68,68,.5)' : group.border)}`,
                boxShadow: isHighlighted ? '0 0 0 4px rgba(96,165,250,.18)' : 'none',
                borderRadius: 14, padding: '16px 20px', marginBottom: 14, transition: 'all .2s',
              }}>
                {row.highPriority && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: '#fca5a5', letterSpacing: 1 }}>🚨 HIGH PRIORITY</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: group.color }}>{group.icon} {group.label} · ROW {groupIdx + 1}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isManagerOrAdvisor && (
                      <button
                        onClick={() => updateRowAndSave(row.id, 'highPriority', !row.highPriority)}
                        style={{ background: row.highPriority ? 'rgba(239,68,68,.28)' : 'rgba(255,255,255,.06)', border: `1px solid ${row.highPriority ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`, color: row.highPriority ? '#fca5a5' : '#64748b', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 11, transition: 'all .15s' }}
                      >{row.highPriority ? '🚨 HIGH PRIORITY' : '⚡ High Priority'}</button>
                    )}
                    {isManagerOrAdvisor && (
                      <button
                        onClick={() => moveToAwaiting(row)}
                        disabled={movingId === row.id}
                        title="Send this RO back to the Cars Awaiting Technician list"
                        style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.35)', color: '#fbbf24', borderRadius: 7, padding: '4px 12px', cursor: movingId === row.id ? 'wait' : 'pointer', fontWeight: 700, fontSize: 11, opacity: movingId === row.id ? 0.6 : 1 }}
                      >{movingId === row.id ? '⏳' : '↩ Move to Cars Awaiting'}</button>
                    )}
                    {isManagerOrAdvisor && (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Flag this RO">
                        {FLAGS.map(f => {
                          const active = flagOf(row) === f.key;
                          return (
                            <button key={f.key}
                              onClick={() => setFlag(row, f.key)}
                              disabled={movingId === row.id}
                              title={`Flag as ${f.label} — ${f.sub}`}
                              style={{ background: active ? `${f.color}2b` : 'rgba(255,255,255,.05)', border: `1px solid ${active ? f.border : 'rgba(255,255,255,.12)'}`, color: active ? f.color : '#64748b', borderRadius: 7, padding: '4px 10px', cursor: movingId === row.id ? 'wait' : 'pointer', fontWeight: active ? 800 : 600, fontSize: 11, opacity: movingId === row.id ? 0.6 : 1 }}
                            >{f.icon} {f.label}</button>
                          );
                        })}
                      </div>
                    )}
                    {isManager && (
                      <>
                        <button
                          onClick={() => setReassignPickerId(reassignPickerId === row.id ? null : row.id)}
                          style={{ background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.35)', color: '#fbbf24', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 11 }}
                        >🔀 Assign Different Tech</button>
                        {reassignPickerId === row.id && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {techList.filter(t => t !== activeTech).map(tech => (
                              <button key={tech}
                                onClick={() => reassignRow(row, tech)}
                                disabled={movingId === row.id}
                                style={{ background: 'rgba(251,191,36,.2)', border: '1px solid rgba(251,191,36,.45)', color: '#fbbf24', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                              >{movingId === row.id ? '⏳' : tech}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Fields grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px 16px', marginBottom: 14 }}>
                  <div>
                    <div style={{ ...labelSt, display: 'flex', alignItems: 'center' }}>Repair Order #<CopyRoBtn ro={row.ro} k={`wip-${row.id}`} /></div>
                    <input style={inpSt} value={row.ro} onChange={e => updateRow(row.id, 'ro', e.target.value)} placeholder="RO#" />
                  </div>
                  <div>
                    <div style={labelSt}>RO Date</div>
                    <input style={inpSt} type="date" value={row.roDate} onChange={e => updateRow(row.id, 'roDate', e.target.value)} />
                  </div>
                  <div>
                    <div style={labelSt}>Vehicle</div>
                    <input style={inpSt} value={row.vehicle || ''} onChange={e => updateRow(row.id, 'vehicle', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); saveRow(row.id); } }} placeholder="Year Make Model" />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div style={labelSt}>Job Description</div>
                    <input style={inpSt} value={row.jobDesc} onChange={e => updateRow(row.id, 'jobDesc', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); saveRow(row.id); } }} placeholder="Describe the job…" />
                  </div>
                  <div>
                    <div style={labelSt}>ETA on Parts</div>
                    <input style={inpSt} value={row.etaParts} onChange={e => updateRow(row.id, 'etaParts', e.target.value)} placeholder="e.g. May 2" />
                  </div>
                  <div>
                    <div style={labelSt}>ETA on Completion</div>
                    <input style={inpSt} value={row.etaCompletion} onChange={e => updateRow(row.id, 'etaCompletion', e.target.value)} placeholder="e.g. May 3" />
                  </div>
                  <div>
                    <div style={labelSt}>Parts Arrived</div>
                    {row.partsArrived === true ? (
                      <div className="parts-here-badge" style={{ marginTop: 2 }}>
                        <span className="pha-icon">📦</span>
                        <span>Parts Here</span>
                        {row.partsArrivedDate && <span className="pha-date">📅 {row.partsArrivedDate}</span>}
                        <button
                          className="pha-undo"
                          onClick={() => {
                            if (window.confirm('Undo "Parts Here"?\n\nThis will clear the parts-arrived status and remove the arrival date. Only do this if it was marked by mistake.')) {
                              togglePartsArrived(row.id, null);
                            }
                          }}
                          title="Mark parts as not arrived"
                        >Undo</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <ChipBtn active={row.partsArrived === true}  color="green" onClick={() => togglePartsArrived(row.id, row.partsArrived === true ? null : true)}>✓ Yes</ChipBtn>
                        <ChipBtn active={row.partsArrived === false} color="red"   onClick={() => togglePartsArrived(row.id, row.partsArrived === false ? null : false)}>✗ No</ChipBtn>
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={labelSt}>Advisor</div>
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setAdvisorPickerId(advisorPickerId === row.id ? null : row.id)}
                        style={{ background: row.advisor ? 'rgba(139,92,246,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${row.advisor ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.15)'}`, color: row.advisor ? '#c4b5fd' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, width: '100%', textAlign: 'left' }}
                      >👤 {row.advisor || 'Select Advisor'}</button>
                      {advisorPickerId === row.id && (
                        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 10, padding: 8, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                          {row.advisor && (
                            <button onClick={() => { updateRowAndSave(row.id, 'advisor', ''); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(239,68,68,.1)', border: 'none', color: '#f87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 4 }}>✕ Clear</button>
                          )}
                          {advisorList.map(adv => (
                            <button key={adv} onClick={() => { updateRowAndSave(row.id, 'advisor', adv); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: row.advisor === adv ? 'rgba(139,92,246,.25)' : 'transparent', border: 'none', color: row.advisor === adv ? '#c4b5fd' : '#cbd5e1', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13, fontWeight: row.advisor === adv ? 800 : 400 }}>{adv}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: 14 }}>
                  <div style={labelSt}>Notes</div>
                  <textarea
                    value={row.notes || ''}
                    onChange={e => updateRow(row.id, 'notes', e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.blur();
                        saveRow(row.id);
                      }
                    }}
                    placeholder="Add notes here… (Enter to save, Shift+Enter for new line)"
                    rows={2}
                    style={{ ...inpSt, resize: 'vertical', lineHeight: 1.5 }}
                  />
                </div>

                {/* Row actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => isTech ? setWorkCompleteConfirmId(row.id) : deleteRow(row.id)}
                    disabled={deletingRow === row.id}
                    style={{ background: isTech ? 'rgba(74,222,128,.12)' : 'rgba(239,68,68,.12)', border: `1px solid ${isTech ? 'rgba(74,222,128,.4)' : 'rgba(239,68,68,.35)'}`, color: isTech ? '#4ade80' : '#f87171', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: deletingRow === row.id ? 0.5 : 1 }}
                  >{deletingRow === row.id ? '⏳' : isTech ? '✅ Work Completed' : '🗑 Delete Row'}</button>
                  <button
                    onClick={() => saveRow(row.id)}
                    disabled={savingRow === row.id}
                    style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: savingRow === row.id ? 0.5 : 1 }}
                  >{savingRow === row.id ? '⏳ Saving…' : '💾 Save Row'}</button>
                </div>
              </div>
              </React.Fragment>
              );
              });
            })()}

            <button
              onClick={addRow}
              style={{ background: 'rgba(167,139,250,.15)', border: '1px solid rgba(167,139,250,.35)', color: '#c4b5fd', borderRadius: 10, padding: '10px 24px', cursor: 'pointer', fontWeight: 800, fontSize: 14, marginTop: 4 }}
            >+ Add Row</button>

            {/* ── Cars Awaiting Technician ──
                The unassigned pool techs claim from. Rows tagged `usedCar` are NOT
                here — they're the used-car team's queue and live on the Used Car
                Hub, reachable from the header. The move button sends a row there;
                the Hub has the button that sends it back. */}
            <div style={{ marginTop: 36, paddingTop: 24, borderTop: '2px solid rgba(251,191,36,.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 1 }}>🚛 Cars Awaiting Technician</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Unassigned repair orders — claim or assign to a tech</div>
                </div>
                {!isTech && (
                  <button
                    onClick={() => addAwaitingRow(false)}
                    style={{ marginLeft: 'auto', background: 'rgba(251,191,36,.15)', border: '1px solid rgba(251,191,36,.35)', color: '#fbbf24', borderRadius: 9, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                  >+ Add</button>
                )}
              </div>

              {awaitingLoading ? (
                <div style={{ color: '#475569', fontSize: 13, padding: '16px 0' }}>Loading…</div>
              ) : visibleAwaiting.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No cars awaiting — click + Add to create one.</div>
              ) : [...visibleAwaiting].sort(unassignedSort).map(aw => {
                const isHighlighted = !!highlightRO && (aw.ro || '').trim().toLowerCase().includes(highlightRO.trim().toLowerCase());
                return (
                  <UnassignedRow
                    key={aw.id}
                    aw={aw}
                    isTech={isTech}
                    canAssign={canAssignAwaiting}
                    canDelete={canDeleteAwaiting}
                    techList={techList}
                    advisorList={advisorList}
                    movingId={movingId}
                    savingId={awaitingSavingId}
                    advisorPickerId={awAdvisorPickerId}
                    setAdvisorPickerId={setAwAdvisorPickerId}
                    techPickerId={awaitingPickerId}
                    setTechPickerId={setAwaitingPickerId}
                    isHighlighted={isHighlighted}
                    rowRef={isHighlighted ? highlightedRowRef : null}
                    rowBg="rgba(251,191,36,.06)"
                    rowBorder="rgba(251,191,36,.22)"
                    onUpdate={updateAwaiting}
                    onSave={saveAwaitingRow}
                    onTogglePartsArrived={toggleAwaitingPartsArrived}
                    onUpdateAndSave={updateAwaitingAndSave}
                    onClaim={claimAwaiting}
                    onClaimIt={(row) => setClaimConfirm({ aw: row, tech: currentUser })}
                    onDelete={deleteAwaitingRow}
                    onMove={(row) => setAwaitingUsedCar(row, true)}
                    moveLabel="🚗 Move to Used Cars"
                    moveTitle="Move this RO to the Used Car Hub"
                    moveAccent="#6ee7b7"
                    moveBg="rgba(52,211,153,.18)"
                    moveBorder="rgba(52,211,153,.45)"
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
      {/* Tech Chat panel */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.06)', padding: 12, display: 'flex', flexDirection: 'column' }}>
        <TechChat currentUser={currentUser} currentRole={currentRole} hasChatAccess={hasChatAccess} refreshKey={techChatRefresh} />
      </div>
      </div>
      {/* Claim Confirmation Modal */}
      {claimConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#1e293b', border: '2px solid rgba(251,191,36,.4)', borderRadius: 20, padding: '36px 40px', maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: '#fbbf24', marginBottom: 10 }}>Before You Claim This Job</div>
            <div style={{ color: '#cbd5e1', fontSize: 15, marginBottom: 8 }}>
              RO <strong style={{ color: '#f1f5f9' }}>#{claimConfirm.aw.ro || '—'}</strong>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 28 }}>
              Do you have the repair order in hand?
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button
                onClick={() => { claimAwaiting(claimConfirm.aw, claimConfirm.tech); setClaimConfirm(null); }}
                style={{ background: 'rgba(74,222,128,.25)', border: '2px solid rgba(74,222,128,.6)', color: '#4ade80', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >✅ Yes, Claim It</button>
              <button
                onClick={() => setClaimConfirm(null)}
                style={{ background: 'rgba(239,68,68,.18)', border: '2px solid rgba(239,68,68,.45)', color: '#f87171', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >❌ No</button>
            </div>
          </div>
        </div>
      )}
      {/* Work Completed Confirmation Modal */}
      {workCompleteConfirmId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#1e293b', border: '2px solid rgba(74,222,128,.4)', borderRadius: 20, padding: '36px 40px', maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: '#4ade80', marginBottom: 12 }}>Work Completed?</div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 28 }}>
              Are you sure this job is finished? This will remove it from your work list.
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
              <button
                onClick={() => { deleteRow(workCompleteConfirmId); setWorkCompleteConfirmId(null); }}
                style={{ background: 'rgba(74,222,128,.25)', border: '2px solid rgba(74,222,128,.6)', color: '#4ade80', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >✅ Yes, Done</button>
              <button
                onClick={() => setWorkCompleteConfirmId(null)}
                style={{ background: 'rgba(239,68,68,.18)', border: '2px solid rgba(239,68,68,.45)', color: '#f87171', borderRadius: 10, padding: '12px 32px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}
              >❌ Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
