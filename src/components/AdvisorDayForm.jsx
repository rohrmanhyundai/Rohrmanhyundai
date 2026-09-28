import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  saveAdvisorNotes, loadAdvisorNotes,
  loadUsers, getGithubToken, setGithubToken,
  loadAppointmentList, updateAppointmentList, loadServicePricing,
} from '../utils/github';
import { uploadAppointmentFile, shortMD, apptTags, ownerOf, hoursByOpCode, sellToGoal } from '../utils/appointmentList';
import { firstNameUpper } from '../utils/advisorAliases';

// Appointment prep for one calendar day. The After Call Report used to live at
// the bottom of this page; it is now its own page (AfterCallReport.jsx), reached
// from the "After Call Reviews" button, since a tech's surveys have nothing to
// do with whichever day was clicked to get here.
//
// This is a working list, not a form that gets filled in once: it autosaves,
// it sorts itself by appointment time, and each row carries a status the
// advisor taps forward as the car moves through the day.

const genRowId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const EMPTY_ROW = () => ({
  id: genRowId(),
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: [], status: 'scheduled',
});

const STATUSES = [
  { key: 'scheduled', label: 'Scheduled', fg: '#94a3b8', bg: 'rgba(148,163,184,.14)', line: 'rgba(148,163,184,.45)' },
  { key: 'arrived',   label: 'Arrived',   fg: '#fbbf24', bg: 'rgba(251,191,36,.16)',  line: 'rgba(251,191,36,.55)' },
  { key: 'in-shop',   label: 'In Shop',   fg: '#38bdf8', bg: 'rgba(56,189,248,.16)',  line: 'rgba(56,189,248,.55)' },
  { key: 'done',      label: 'Done',      fg: '#4ade80', bg: 'rgba(74,222,128,.16)',  line: 'rgba(74,222,128,.55)' },
];
const statusMeta = (key) => STATUSES.find(s => s.key === key) || STATUSES[0];
const nextStatus = (key) => {
  const i = STATUSES.findIndex(s => s.key === key);
  return STATUSES[(i < 0 ? 0 : i + 1) % STATUSES.length].key;
};

// Appointment time is free text and always has been ("9", "9:00", "9:00 AM",
// "0900", "1:30pm"). Anything we can't read sorts to the bottom rather than
// being reordered on a guess.
function timeToMinutes(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  const ampm = (m[3] || '').replace(/\./g, '');
  if (ampm.startsWith('p') && h < 12) h += 12;
  if (ampm.startsWith('a') && h === 12) h = 0;
  // No am/pm on a shop schedule: 1–6 means afternoon, 7–12 means morning.
  if (!ampm && h >= 1 && h <= 6) h += 12;
  return h * 60 + min;
}

function sortRows(rows) {
  return rows
    .map((r, i) => ({ r, i, t: timeToMinutes(r.appointmentTime) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;   // keep entry order
      if (a.t === null) return 1;                            // blanks last
      if (b.t === null) return -1;
      return a.t !== b.t ? a.t - b.t : a.i - b.i;
    })
    .map(x => x.r);
}

function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

const SAVE_IDLE_MS = 4000; // quiet period before an autosave fires

// ── DMS appointments → prep rows ─────────────────────────────────────────────
// A row that came from the DMS carries its appointment number; the DMS owns
// customer / time / vehicle / services, the advisor owns everything else
// (status, tech, deferred, notes), and a re-upload only refreshes the DMS half.
const dmsFields = (a) => ({
  apptNo: a.apptNo, customerName: a.customer, appointmentTime: a.time,
  vehicle: a.vehicle, services: a.services || [], comments: a.comments || '', transport: a.transport || '',
  deferred: a.deferred || null,
});
const isBlankRow = (r) => !r.apptNo
  && !(r.customerName || '').trim() && !(r.appointmentTime || '').trim()
  && !(r.criticalDeferredService || '').trim() && !(r.technician || '').trim()
  && !(r.vehicle || '').trim() && parseNotesField(r.notes).length === 0;

function mergeAppointments(rows, list, advisorName) {
  if (!list || !Array.isArray(list.appts) || list.appts.length === 0) return rows;
  const me = firstNameUpper(advisorName);
  const byNo = new Map(list.appts.map(a => [a.apptNo, a]));
  const mine = list.appts.filter(a => ownerOf(a, list.claims) === me);
  const mineNos = new Set(mine.map(a => a.apptNo));
  // Drop rows that now belong to someone else (returned to the pool, or
  // reassigned in the DMS). Rows whose appointment vanished from the list stay,
  // flagged on screen, so nothing typed on them is lost to a cancellation.
  let out = rows
    .filter(r => !r.apptNo || !byNo.has(r.apptNo) || mineNos.has(r.apptNo))
    .map(r => (r.apptNo && byNo.has(r.apptNo) ? { ...r, ...dmsFields(byNo.get(r.apptNo)) } : r));
  const have = new Set(out.map(r => r.apptNo).filter(Boolean));
  const added = mine.filter(a => !have.has(a.apptNo)).map(a => ({
    ...EMPTY_ROW(), ...dmsFields(a),
    waiter: a.transport === 'WAIT', dropOff: !!a.transport && a.transport !== 'WAIT',
  }));
  if (added.length) out = [...out.filter(r => !isBlankRow(r)), ...added];
  if (out.length === 0) out = [EMPTY_ROW()];
  const sorted = sortRows(out);
  return JSON.stringify(sorted) === JSON.stringify(rows) ? rows : sorted;
}

function Tag({ t }) {
  return (
    <span title={t.title || ''} style={{
      display: 'inline-block', fontSize: 11, fontWeight: 800, color: t.color,
      background: 'rgba(2,6,23,.45)', border: `1px solid ${t.color}66`,
      borderRadius: 999, padding: '2px 8px', marginRight: 4, marginTop: 4, whiteSpace: 'nowrap',
    }}>{t.label}</span>
  );
}

const money = (v) => (v == null ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const shortDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };

// The deferred work waiting on this customer's car — the reason to call it out
// at write-up. Matched from the Deferred Service report at upload time.
// "Sell these to hit the goal" strip inside the deferred box.
function GoalPlan({ plan }) {
  if (!plan) return null;
  const n = plan.pick.length;
  const ok = plan.reached;
  return (
    <div style={{
      margin: '6px 0 5px', padding: '6px 9px', borderRadius: 7,
      background: ok ? 'rgba(34,197,94,.13)' : 'rgba(250,204,21,.10)',
      border: `1px solid ${ok ? 'rgba(74,222,128,.5)' : 'rgba(250,204,21,.45)'}`,
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 900, color: ok ? '#86efac' : '#fde047' }}>
        🎯 {ok
          ? `Sell ${n} ${n === 1 ? 'service' : 'services'} → this RO hits the ${plan.goal} hrs/RO goal`
          : `Sell ${plan.all && n > 1 ? `all ${n}` : n === 1 ? 'it' : n} → ${plan.sum} hrs, ${plan.short} short of the ${plan.goal} hrs/RO goal`}
      </div>
      <div style={{ fontSize: 11.5, color: '#e2e8f0', marginTop: 2, lineHeight: 1.4 }}>
        {plan.pick.map((x, i) => (
          <span key={i}>{i > 0 && ' + '}{x.label} <span style={{ color: '#94a3b8' }}>({x.est ? '≈' : ''}{x.h} hr)</span></span>
        ))}
        {n > 1 && <span style={{ fontWeight: 800 }}> = {plan.sum} hrs</span>}
      </div>
    </div>
  );
}

function DeferredBox({ d, compact, plan }) {
  if (!d) return null;
  const months = d.date ? Math.max(0, Math.round((Date.now() - new Date(d.date + 'T00:00:00').getTime()) / (30.4 * 86400000))) : null;
  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(249,115,22,.14), rgba(234,88,12,.07))',
      border: '1px solid rgba(251,146,60,.5)', borderLeft: '4px solid #f97316',
      borderRadius: 9, padding: compact ? '7px 10px' : '8px 11px', margin: '4px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#fdba74', letterSpacing: '.04em' }}>🔧 DEFERRED WORK</span>
        {d.amount != null && <span style={{ fontSize: 15, fontWeight: 900, color: '#fed7aa' }}>{money(d.amount)}</span>}
        {d.hours != null && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fdba74' }}>{d.hours} hrs</span>}
      </div>
      <ul style={{ margin: '5px 0 4px', paddingLeft: 18, fontSize: 12.5, color: '#f1f5f9', lineHeight: 1.45 }}>
        {(d.items || []).map(i => (
          <li key={i.code}>{i.desc || i.code}{i.count > 1 ? ` ×${i.count}` : ''}{i.desc && <span style={{ color: '#94a3b8', fontSize: 10.5 }}> · {i.code}</span>}</li>
        ))}
      </ul>
      <GoalPlan plan={plan} />
      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        RO {d.ro}{d.date ? ` · ${shortDate(d.date)}` : ''}{months ? ` (${months} mo ago)` : ''}{d.advisor ? ` · ${d.advisor}` : ''}
      </div>
    </div>
  );
}

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack, currentRole, advisorList = [], hrsRoGoal = 0 }) {
  // Menu hours for deferred lists uploaded before per-service hours were stored.
  const [menuHours, setMenuHours] = useState({});
  useEffect(() => { loadServicePricing().then(p => setMenuHours(hoursByOpCode(p))).catch(() => {}); }, []);
  const planFor = (d) => (d ? sellToGoal(d, menuHours, hrsRoGoal) : null);
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const viewingOwn = firstNameUpper(advisorName) === firstNameUpper(ownAdvisor);
  // Advisors move appointments onto their own sheet; a manager can place one on
  // whichever advisor's sheet they're looking at.
  const canClaim = viewingOwn || isManager;

  // ── DMS appointment list for this day ─────────────────────────────────────
  const [apptList, setApptList]   = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [claimingNo, setClaimingNo] = useState('');
  const fileRef = useRef(null);
  // ── Appointment prep ──────────────────────────────────────────────────────
  const [rows, setRows]     = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | dirty | saving | saved | error
  const [saveError, setSaveError] = useState('');

  // ── Row notes: a thread shown right in the row; one composer open at a time
  const [noteRowId, setNoteRowId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const rowsRef          = useRef(rows);
  const noteRowIdRef     = useRef(noteRowId);
  const noteDraftRef     = useRef(noteDraft);
  const loadedRef        = useRef(false);   // don't autosave the initial load
  const lastSavedRef     = useRef('');      // serialized rows as last written
  const saveTimerRef     = useRef(null);
  rowsRef.current        = rows;
  noteRowIdRef.current   = noteRowId;
  noteDraftRef.current   = noteDraft;

  // ── Load prep notes ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    Promise.all([
      loadAdvisorNotes(advisorName, date).catch(() => null),
      loadAppointmentList(date).catch(() => null),
    ]).then(([data, list]) => {
      if (cancelled) return;
      let base = rowsRef.current;
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        base = sortRows(data.rows.map(r => ({
          ...EMPTY_ROW(), ...r,
          id: r.id || genRowId(),
          status: r.status || 'scheduled',
          notes: parseNotesField(r.notes),
        })));
        lastSavedRef.current = JSON.stringify(base);
      }
      setApptList(list);
      // Any new DMS appointments land as rows here; the autosave then writes them.
      setRows(mergeAppointments(base, list, advisorName));
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [advisorName, date]);

  // Pick up claims / re-uploads made on other screens when this tab comes back.
  async function refreshList() {
    try {
      const list = await loadAppointmentList(date);
      setApptList(list);
      if (loadedRef.current) setRows(prev => mergeAppointments(prev, list, advisorName));
    } catch {}
  }
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshList(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorName, date]);

  // ── Upload the DMS Appointment List ───────────────────────────────────────
  // Each day in the file replaces that day's list. Claims on appointments that
  // are still listed are kept, so re-uploading later in the day is safe.
  async function handleUpload(file) {
    if (!file) return;
    setUploadMsg(''); setUploadBusy(true);
    try {
      const { dates, byDate, saved, defCount, autoCount } = await uploadAppointmentFile(file, { advisorList, by: ownAdvisor });
      if (saved[date]) {
        setApptList(saved[date]);
        setRows(prev => mergeAppointments(prev, saved[date], advisorName));
      }
      const here = byDate[date];
      setUploadMsg(here
        ? `✓ ${here.length} appointments loaded for ${shortMD(date)}`
          + (defCount ? ` · ${defCount} with deferred work` : '')
          + (autoCount ? ` · ${autoCount} auto-assigned to the deferred advisor` : '')
          + (dates.length > 1 ? ` · also saved ${dates.filter(d => d !== date).map(shortMD).join(', ')}` : '')
        : `✓ Saved appointments for ${dates.map(shortMD).join(', ')} — open that day on the calendar to see them.`);
    } catch (e) {
      setUploadMsg('⚠️ ' + (e.message || 'Upload failed'));
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Open pool: move an "Any Service Advisor" appointment onto this sheet ──
  async function claimAppt(a) {
    const target = firstNameUpper(advisorName);
    setClaimingNo(a.apptNo);
    try {
      const next = await updateAppointmentList(date, (cur) => {
        const live = cur.appts.find(x => x.apptNo === a.apptNo);
        if (!live) throw new Error('That appointment is no longer on the list.');
        const owner = ownerOf(live, cur.claims);
        if (owner && owner !== target) throw new Error(`${owner} already took ${live.customer}.`);
        return { ...cur, claims: { ...cur.claims, [a.apptNo]: { advisor: target, by: ownAdvisor, at: new Date().toISOString() } } };
      }, `Appointment ${a.apptNo} → ${target}`);
      setApptList(next);
      setRows(prev => mergeAppointments(prev, next, advisorName));
    } catch (e) {
      alert(e.message || 'Could not move that appointment.');
      refreshList();
    } finally { setClaimingNo(''); }
  }

  async function returnToPool(row) {
    if (!window.confirm(`Put ${row.customerName || 'this appointment'} back in the open pool?\n\nAnything typed on this row (tech, notes, status) goes with it.`)) return;
    const target = firstNameUpper(advisorName);
    setClaimingNo(row.apptNo);
    try {
      const next = await updateAppointmentList(date, (cur) => {
        const claims = { ...cur.claims };
        // Left as a blank "released" claim so the next upload's deferred
        // auto-assign doesn't put it straight back.
        if (claims[row.apptNo] && claims[row.apptNo].advisor === target) {
          claims[row.apptNo] = { advisor: '', released: true, by: ownAdvisor, at: new Date().toISOString() };
        }
        return { ...cur, claims };
      }, `Appointment ${row.apptNo} back to pool`);
      setApptList(next);
      setRows(prev => mergeAppointments(prev, next, advisorName));
    } catch (e) {
      alert(e.message || 'Could not return that appointment.');
    } finally { setClaimingNo(''); }
  }

  // ── Autosave ──────────────────────────────────────────────────────────────
  // The page used to save only when you pressed Back, so a closed tab — or an
  // admin's "Force Refresh All Users", which reloads every browser — threw the
  // day away. Now it writes itself after a short quiet period.
  async function persist(currentRows) {
    const payload = JSON.stringify(currentRows);
    if (payload === lastSavedRef.current) return true;
    // Never prompt from an autosave: if this device has no save code yet, hold
    // the changes and let the Back button ask for it.
    if (!getGithubToken()) { setSaveState('dirty'); return false; }
    setSaveState('saving');
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
      lastSavedRef.current = payload;
      setSaveState('saved');
      setSaveError('');
      return true;
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message || '')) setGithubToken('');
      setSaveState('error');
      setSaveError(err.message || 'Save failed');
      return false;
    }
  }

  useEffect(() => {
    if (!loadedRef.current) return;
    if (JSON.stringify(rows) === lastSavedRef.current) return;
    setSaveState(s => (s === 'saving' ? s : 'dirty'));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { persist(rowsRef.current); }, SAVE_IDLE_MS);
    return () => clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Last-ditch flush when the tab is hidden or closed. keepalive lets the
  // request outlive the page; it's best effort on top of the idle save.
  useEffect(() => {
    const flush = () => {
      if (JSON.stringify(rowsRef.current) !== lastSavedRef.current) persist(rowsRef.current);
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorName, date]);

  // Notes append to the row's thread and ride the normal autosave.
  const withNote = (list, id, text) => list.map(r => (r.id === id
    ? { ...r, notes: [...parseNotesField(r.notes), { author: ownAdvisor, text, at: Date.now() }] }
    : r));
  function openComposer(id) { setNoteRowId(id); setNoteDraft(''); }
  function closeComposer()  { setNoteRowId(null); setNoteDraft(''); }
  function addNote(id) {
    const text = noteDraft.trim();
    if (!text) return;
    setRows(prev => withNote(prev, id, text));
    closeComposer();
  }
  function deleteNote(id, idx) {
    if (!window.confirm('Delete this note?')) return;
    setRows(prev => prev.map(r => (r.id === id ? { ...r, notes: parseNotesField(r.notes).filter((_, j) => j !== idx) } : r)));
  }

  // ── Prep row helpers ──────────────────────────────────────────────────────
  // Rows are addressed by id, never by index — the list reorders itself.
  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  // Re-sort on blur rather than on every keystroke, so a row can't jump out
  // from under the cursor while its time is being typed.
  function resort() { setRows(prev => sortRows(prev)); }
  function addRow()      { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(id) { if (rows.length > 1) setRows(prev => prev.filter(r => r.id !== id)); }
  function advanceStatus(id) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: nextStatus(r.status) } : r));
  }

  // ── Ensure token ──────────────────────────────────────────────────────────
  // A signed-in device can always save; a missing session means the login
  // expired and App has already sent the user back to the login screen.
  async function ensureToken() {
    if (!getGithubToken()) { alert('Your sign-in has expired — please log in again.'); return false; }
    return true;
  }

  // ── Save prep notes ───────────────────────────────────────────────────────
  async function handleSave() {
    clearTimeout(saveTimerRef.current);
    let currentRows = rowsRef.current;
    // A note typed but not added yet still gets saved on the way out.
    if (noteRowIdRef.current !== null && noteDraftRef.current.trim()) {
      currentRows = withNote(currentRows, noteRowIdRef.current, noteDraftRef.current.trim());
      setRows(currentRows);
      closeComposer();
    }
    if (JSON.stringify(currentRows) === lastSavedRef.current) return;
    if (!await ensureToken('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):')) return;
    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
      lastSavedRef.current = JSON.stringify(currentRows);
      setSaveState('saved');
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message)) setGithubToken('');
      setSaving(false); throw err;
    } finally { setSaving(false); }
  }

  // ── Display helpers ───────────────────────────────────────────────────────
  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const rosterSet = useMemo(() => new Set((advisorList || []).map(firstNameUpper)), [advisorList]);
  const apptByNo = useMemo(() => new Map((apptList?.appts || []).map(a => [a.apptNo, a])), [apptList]);
  const pool = useMemo(
    () => sortRows((apptList?.appts || []).filter(a => !ownerOf(a, apptList.claims))
      .map(a => ({ ...a, appointmentTime: a.time }))),
    [apptList],
  );
  const uploadedLabel = apptList?.uploadedAt
    ? `DMS list uploaded ${new Date(apptList.uploadedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${apptList.uploadedBy ? ` by ${apptList.uploadedBy}` : ''}`
    : '';

  const tally = useMemo(() => {
    const filled = rows.filter(r => (r.customerName || '').trim() || (r.appointmentTime || '').trim());
    const by = k => filled.filter(r => (r.status || 'scheduled') === k).length;
    return {
      total: filled.length,
      scheduled: by('scheduled'), arrived: by('arrived'),
      inShop: by('in-shop'), done: by('done'),
      waiters: filled.filter(r => r.waiter && (r.status || 'scheduled') !== 'done').length,
    };
  }, [rows]);

  const saveLabel = saveState === 'saving' ? '⏳ Saving…'
    : saveState === 'saved' ? '✓ Saved'
    : saveState === 'error' ? `⚠️ Not saved — ${saveError}`
    : saveState === 'dirty' ? '● Unsaved changes'
    : '';
  const saveColor = saveState === 'saved' ? '#4ade80'
    : saveState === 'error' ? '#fca5a5'
    : saveState === 'dirty' ? '#fbbf24' : '#7a92b8';

  const noteWhen = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  // Notes column: every note stays on screen (and on the printout), styled like
  // the Open RO Attention threads. Click the cell / "+ Add note" to write one.
  function renderNotesCell(row) {
    const notes = parseNotesField(row.notes);
    const composing = noteRowId === row.id;
    return (
      <td style={{ verticalAlign: 'top', overflowWrap: 'anywhere', cursor: composing ? 'default' : 'pointer' }}
        onClick={() => { if (!composing) openComposer(row.id); }}>
        {notes.length > 0 && (
          <div style={{ display: 'grid', gap: 5, margin: '2px 0 4px' }}>
            {notes.map((n, i) => {
              const mine = !n.author || n.author === ownAdvisor;
              return (
                <div key={i} style={{ position: 'relative', background: mine ? 'rgba(56,189,248,.08)' : 'rgba(251,191,36,.08)', border: `1px solid ${mine ? 'rgba(56,189,248,.3)' : 'rgba(251,191,36,.3)'}`, borderRadius: 9, padding: '5px 22px 5px 9px' }}>
                  {(n.author || n.at) && (
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: mine ? '#7dd3fc' : '#fcd34d' }}>
                      {n.author ? (n.author === ownAdvisor ? 'You' : n.author) : ''}
                      {n.at && <span style={{ color: '#64748b', fontWeight: 600 }}> · {noteWhen(n.at)}</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 12.5, lineHeight: 1.4, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{n.text || n.body}</div>
                  {mine && (
                    <button className="no-print" title="Delete note" onClick={e => { e.stopPropagation(); deleteNote(row.id, i); }}
                      style={{ position: 'absolute', top: 3, right: 4, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: 2, lineHeight: 1 }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {composing ? (
          <div className="no-print" onClick={e => e.stopPropagation()}>
            <textarea autoFocus rows={2} value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(row.id); }
                if (e.key === 'Escape') closeComposer();
              }}
              placeholder="Add a note… (Enter to save)"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(56,189,248,.4)', borderRadius: 8, color: '#e2e8f0', padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
              <button onClick={() => addNote(row.id)} disabled={!noteDraft.trim()}
                style={{ background: 'rgba(56,189,248,.15)', border: '1px solid rgba(56,189,248,.45)', color: noteDraft.trim() ? '#7dd3fc' : '#64748b', borderRadius: 8, padding: '4px 11px', fontSize: 12, fontWeight: 800, cursor: noteDraft.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                Add note
              </button>
              <button className="secondary" onClick={closeComposer} style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="no-print" style={{ fontSize: 12, fontWeight: 700, color: notes.length ? '#64748b' : 'rgba(149,169,198,.55)', padding: '3px 2px' }}>
            + Add note
          </div>
        )}
      </td>
    );
  }

  const pill = (n, label, color) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, color: '#cbd5e1',
    }}>
      <strong style={{ color, fontSize: 14 }}>{n}</strong> {label}
    </span>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="adv-page adv-form-page">

      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="secondary" disabled={saving} onClick={async () => {
            try {
              await handleSave(); onBack();
            } catch (err) {
              const isBad = /bad credentials|unauthorized|401|sign in again/i.test(err.message);
              alert(isBad ? 'Your sign-in has expired — log in again and your notes will be here to save.' : 'Save failed: ' + err.message);
            }
          }}>
            {saving ? 'Saving...' : '← Back to Calendar'}
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>Editing: {advisorName}'s Calendar</span>
          )}
          {saveLabel && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: saveColor }}>{saveLabel}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => handleUpload(e.target.files && e.target.files[0])} />
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploadBusy}
            title="Upload the Appointment List export from the DMS"
            style={{ background: 'linear-gradient(180deg,rgba(52,211,153,.28),rgba(16,185,129,.18))', borderColor: 'rgba(52,211,153,.5)' }}>
            {uploadBusy ? '⏳ Uploading…' : '📤 Upload DMS Appointments'}
          </button>
          <button className="secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="adv-form-wrap">

        {/* ── Appointment Prep ── */}
        <div className="adv-section">
          <div className="adv-form-header">
            <h2 className="adv-form-title">ADVISOR NEXT DAY APPOINTMENT PREPARATION</h2>
            <div className="adv-form-meta">
              <span>Advisor Name: <strong>{advisorName}</strong></span>
              <span>Date: <strong>{displayDate}</strong></span>
            </div>
            {(uploadMsg || uploadedLabel) && (
              <div className="no-print" style={{ textAlign: 'center', marginTop: 6, fontSize: 12.5, fontWeight: 700,
                color: uploadMsg.startsWith('⚠') ? '#fca5a5' : uploadMsg ? '#4ade80' : '#7a92b8' }}>
                {uploadMsg || uploadedLabel}
              </div>
            )}
          </div>

          {/* Where the day stands, at a glance */}
          {tally.total > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', margin: '0 0 16px' }}>
              {pill(tally.total, tally.total === 1 ? 'appointment' : 'appointments', '#e2e8f0')}
              {tally.scheduled > 0 && pill(tally.scheduled, 'not here yet', '#94a3b8')}
              {tally.arrived > 0 && pill(tally.arrived, 'arrived', '#fbbf24')}
              {tally.inShop > 0 && pill(tally.inShop, 'in shop', '#38bdf8')}
              {tally.done > 0 && pill(tally.done, 'done', '#4ade80')}
              {tally.waiters > 0 && pill(tally.waiters, 'waiters left', '#f97316')}
            </div>
          )}

          {/* Fixed layout: Status and Time stay narrow and the room goes to
              Vehicle / Services and Deferred, which wrap instead of clipping. */}
          <table className="adv-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 96 }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: 84 }} />
              <col style={{ width: '27%' }} />
              <col style={{ width: '28%' }} />
              <col />
              <col className="no-print" style={{ width: 56 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ padding: '10px 8px' }}>STATUS</th>
                <th>CUSTOMER</th><th style={{ padding: '10px 8px' }}>TIME</th><th>VEHICLE / SERVICES</th><th>CRITICAL DEFERRED SERVICE</th>
                <th>NOTES</th><th className="no-print" style={{ padding: 0 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const st = statusMeta(row.status);
                const isDone = row.status === 'done';
                return (
                  <tr key={row.id}
                      className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}
                      style={isDone ? { opacity: 0.5 } : undefined}>
                    <td>
                      <button
                        onClick={() => advanceStatus(row.id)}
                        title="Tap to move it forward"
                        style={{
                          width: '100%', background: st.bg, border: `1px solid ${st.line}`,
                          color: st.fg, borderRadius: 999, padding: '4px 4px',
                          fontSize: 11, fontWeight: 800, cursor: 'pointer',
                          whiteSpace: 'nowrap', fontFamily: 'inherit',
                        }}>
                        {st.label}
                      </button>
                    </td>
                    {row.apptNo ? (<>
                      <td>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', padding: '4px 2px 0' }}>{row.customerName}</div>
                        <div style={{ fontSize: 11, color: '#7a92b8', padding: '0 2px 4px' }}>
                          Appt #{row.apptNo}
                          {apptList && !apptByNo.has(row.apptNo) && <span style={{ color: '#fca5a5', fontWeight: 800 }}> · ⚠ not on latest DMS list</span>}
                          {apptByNo.get(row.apptNo) && !apptByNo.get(row.apptNo).advisor && (
                            apptList.claims[row.apptNo]?.by === 'AUTO'
                              ? <span style={{ color: '#fdba74' }}> · auto-assigned (your deferred work)</span>
                              : <span style={{ color: '#fbbf24' }}> · from open pool</span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                        {row.appointmentTime}
                        {row.transport === 'WAIT' && (
                          <div style={{ marginTop: 3, display: 'inline-block', fontSize: 9.5, fontWeight: 900, color: '#fdba74', border: '1px solid rgba(249,115,22,.6)', borderRadius: 999, padding: '0 6px' }}>WAITER</div>
                        )}
                      </td>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0' }}>{row.vehicle}</div>
                        {(row.services || []).map((s, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.35 }}>{s}</div>
                        ))}
                        <div>{apptTags(apptByNo.get(row.apptNo) || { services: row.services, comments: row.comments, vehicle: row.vehicle }).map(t => <Tag key={t.key} t={t} />)}</div>
                      </td>
                    </>) : (<>
                      <td><input className="adv-cell-input" value={row.customerName} onChange={e => updateRow(row.id, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                      <td><input className="adv-cell-input" value={row.appointmentTime} onChange={e => updateRow(row.id, 'appointmentTime', e.target.value)} onBlur={resort} placeholder="e.g. 9:00 AM" /></td>
                      <td><input className="adv-cell-input" value={row.vehicle || ''} onChange={e => updateRow(row.id, 'vehicle', e.target.value)} placeholder="Vehicle / reason for visit" /></td>
                    </>)}
                    <td style={{ overflowWrap: 'anywhere', verticalAlign: row.deferred ? 'top' : undefined }}>
                      <DeferredBox d={row.deferred} plan={planFor(row.deferred)} />
                      <input className="adv-cell-input" value={row.criticalDeferredService} onChange={e => updateRow(row.id, 'criticalDeferredService', e.target.value)} placeholder={row.deferred ? 'Your plan for the deferred work…' : 'Deferred service notes'} />
                    </td>
                    {renderNotesCell(row)}
                    <td className="no-print" style={{ padding: '6px 2px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        {row.apptNo && apptByNo.get(row.apptNo) && !apptByNo.get(row.apptNo).advisor ? (
                          <button className="secondary adv-del-btn" title="Put back in the open pool"
                            onClick={() => returnToPool(row)} disabled={!canClaim || claimingNo === row.apptNo}>↩</button>
                        ) : row.apptNo && apptByNo.has(row.apptNo) ? (
                          <button className="secondary adv-del-btn" disabled title="Assigned to this advisor in the DMS">×</button>
                        ) : (
                          <button className="secondary adv-del-btn" onClick={() => removeRow(row.id)} disabled={rows.length <= 1}>×</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="no-print" style={{ marginTop: 14 }}>
            <button onClick={addRow}>+ Add Row</button>
          </div>
        </div>

        {/* ── Open pool: DMS "Any Service Advisor" appointments ── */}
        {pool.length > 0 && (
          <div className="adv-section no-print" style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#fbbf24', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                Open Appointments — Any Service Advisor ({pool.length})
              </h3>
              <span style={{ fontSize: 12.5, color: '#7a92b8' }}>
                {pool.filter(a => a.transport === 'WAIT').length} waiters
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 12 }}>
              Not assigned to anyone in the DMS. Move one up and it goes onto {viewingOwn ? 'your' : `${advisorName}'s`} prep sheet and drops off everyone else's list.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {pool.map(a => (
                <div key={a.apptNo} style={{
                  background: 'rgba(255,255,255,.03)', border: '1px solid rgba(251,191,36,.28)', borderLeft: '4px solid #fbbf24',
                  borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#fde68a', whiteSpace: 'nowrap' }}>{a.time}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: '#e2e8f0', flex: 1, minWidth: 0 }}>{a.customer}</span>
                    {a.transport === 'WAIT' && (
                      <span style={{ fontSize: 10.5, fontWeight: 900, color: '#fdba74', border: '1px solid rgba(249,115,22,.6)', borderRadius: 999, padding: '1px 7px' }}>WAITER</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{a.vehicle}</div>
                  {(a.services || []).map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.35 }}>{s}</div>
                  ))}
                  <div>{apptTags(a).map(t => <Tag key={t.key} t={t} />)}</div>
                  {a.deferred ? <DeferredBox d={a.deferred} compact plan={planFor(a.deferred)} /> : (
                    <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, marginTop: 2 }}>✓ No deferred work on file for this vehicle</div>
                  )}
                  {a.deferred && a.deferred.advisor && !rosterSet.has(a.deferred.advisor) && (
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Deferred by {a.deferred.advisorFull || a.deferred.advisor} — not on the current advisor roster, so it wasn't auto-assigned.</div>
                  )}
                  <button onClick={() => claimAppt(a)} disabled={!canClaim || !!claimingNo}
                    title={canClaim ? '' : 'Only this advisor or a manager can move appointments here'}
                    style={{ marginTop: 6, alignSelf: 'flex-start', background: 'linear-gradient(180deg,rgba(251,191,36,.3),rgba(245,158,11,.2))', borderColor: 'rgba(251,191,36,.55)', color: '#fef3c7', fontWeight: 800 }}>
                    {claimingNo === a.apptNo ? '⏳ Moving…' : `⬆ Move to ${viewingOwn ? 'my' : `${advisorName}'s`} calendar`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
