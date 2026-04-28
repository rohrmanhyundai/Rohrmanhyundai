import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  saveAdvisorNotes, loadAdvisorNotes,
  loadServiceInvitations, saveServiceInvitations,
  loadCompletedReviews, saveCompletedReviews,
  loadUsers, getGithubToken, setGithubToken,
} from '../utils/github';

const EMPTY_ROW = () => ({
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: []
});

function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

// ── xlsx helpers ──────────────────────────────────────────────────────────────
function findCol(row, ...candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const match = keys.find(k => k.trim().toLowerCase() === c.trim().toLowerCase());
    if (match !== undefined) {
      const val = row[match];
      if (val !== null && val !== undefined && String(val).trim() !== '') return String(val).trim();
    }
  }
  return '';
}

function parseXlsxRows(rawRows) {
  return rawRows.map(row => {
    const firstName = findCol(row, 'Customer First Name', 'First Name', 'Owner First Name');
    const lastName  = findCol(row, 'Customer Last Name',  'Last Name',  'Owner Last Name');
    const fullName  = [firstName, lastName].filter(Boolean).join(' ').trim()
                   || findCol(row, 'Customer Name', 'Owner Name', 'Customer', 'Name', 'Owner', 'Contact Name');
    return {
      consultant:     findCol(row, 'Service Consultant Name', 'Service Consultant', 'Consultant', 'SA Name', 'Advisor Name', 'Advisor'),
      customerName:   fullName,
      repairOrder:    findCol(row, 'RO Number', 'R/O Number', 'Repair Order', 'RO#', 'R/O No.', 'RO No', 'Repair Order Number', 'RO'),
      vin:            findCol(row, 'VIN', 'VIN Number', 'Vin'),
      model:          findCol(row, 'Model', 'Model Name', 'Vehicle Model', 'Year Model', 'Make Model', 'Vehicle Description', 'Model Year'),
      serviceDate:    findCol(row, 'Service Date', 'RO Close Date', 'Close Date', 'Repair Order Date', 'RO Date', 'Completed Date', 'In Service Date'),
      invitationDate: findCol(row, 'Invitation Date', 'Survey Date', 'Survey Sent Date', 'Sent Date', 'Delivery Date', 'Email Date'),
      status:         findCol(row, 'Status', 'Survey Status', 'Delivery Status', 'Email Status', 'Survey Delivery Status'),
    };
  });
}

function matchesAdvisor(consultant, advisorName) {
  if (!consultant || !advisorName) return false;
  const firstName = advisorName.trim().split(' ')[0].toLowerCase();
  const cn = consultant.trim().toLowerCase();
  return cn.startsWith(firstName + ' ') || cn === firstName;
}

function isWithin4Months(dateStr) {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 4);
  return d >= cutoff;
}

function isDelivered(status) {
  if (!status) return true;
  return status.trim().toLowerCase() === 'delivered';
}

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseDateVal(val) {
  if (!val) return 0;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children, color = 'cyan' }) {
  const colors = {
    cyan:   { bg: 'rgba(61,214,195,.2)',   border: 'rgba(61,214,195,.4)',   text: '#6ee7f9' },
    amber:  { bg: 'rgba(251,191,36,.18)',  border: 'rgba(251,191,36,.45)', text: '#fbbf24' },
    green:  { bg: 'rgba(34,197,94,.18)',   border: 'rgba(34,197,94,.45)',  text: '#86efac' },
    purple: { bg: 'rgba(167,139,250,.18)', border: 'rgba(167,139,250,.45)',text: '#c4b5fd' },
  };
  const c = colors[color] || colors.cyan;
  return (
    <button onClick={onClick} style={{
      background: active ? c.bg : 'transparent',
      border: active ? `1px solid ${c.border}` : '1px solid transparent',
      color: active ? c.text : '#64748b',
      borderRadius: 7, padding: '5px 14px', cursor: 'pointer',
      fontWeight: 700, fontSize: 12, transition: 'all .15s', whiteSpace: 'nowrap',
    }}>
      {children}
    </button>
  );
}

// ── Action chip button ────────────────────────────────────────────────────────
function ChipBtn({ active, onClick, color, children }) {
  const palette = {
    green:  { on: 'rgba(34,197,94,.25)',  border: 'rgba(34,197,94,.5)',  text: '#86efac' },
    red:    { on: 'rgba(239,68,68,.25)',  border: 'rgba(239,68,68,.5)',  text: '#fca5a5' },
    amber:  { on: 'rgba(251,191,36,.25)', border: 'rgba(251,191,36,.5)', text: '#fde68a' },
    blue:   { on: 'rgba(96,165,250,.25)', border: 'rgba(96,165,250,.5)', text: '#93c5fd' },
  };
  const p = palette[color] || palette.green;
  return (
    <button onClick={onClick} style={{
      background: active ? p.on : 'rgba(255,255,255,.05)',
      border: `1px solid ${active ? p.border : 'rgba(255,255,255,.1)'}`,
      color: active ? p.text : '#475569',
      borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
      fontWeight: active ? 700 : 500, fontSize: 13, transition: 'all .15s',
    }}>
      {children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdvisorDayForm({ advisorName, ownAdvisor, date, currentRole, canEditDashboard, onBack }) {
  const canUpload = canEditDashboard || currentRole === 'admin' || (currentRole || '').includes('manager');

  // ── Appointment prep ──────────────────────────────────────────────────────
  const [rows, setRows]     = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);

  // ── Notes modal ───────────────────────────────────────────────────────────
  const [notesOpen, setNotesOpen]       = useState(null);
  const [notesEntries, setNotesEntries] = useState([]);
  const [newNoteDraft, setNewNoteDraft] = useState('');

  // ── After call tabs ───────────────────────────────────────────────────────
  const [afterCallTab, setAfterCallTab] = useState('report'); // 'report'|'complete'|'uploads'|'upload'

  // ── Service invitation data ───────────────────────────────────────────────
  const [siData, setSiData]               = useState([]);
  const [siLoading, setSiLoading]         = useState(true);
  const [siUploading, setSiUploading]     = useState(false);
  const [siUploadStatus, setSiUploadStatus] = useState('');
  const [siFile, setSiFile]               = useState(null);
  const [siParseError, setSiParseError]   = useState('');
  const [siUploadedAt, setSiUploadedAt]   = useState('');
  const [siRawColumns, setSiRawColumns]   = useState([]);

  // ── Completed reviews ─────────────────────────────────────────────────────
  const [completedReviews, setCompletedReviews] = useState([]);
  const [reviewDrafts, setReviewDrafts]         = useState({}); // keyed by repairOrder
  const [submittingRO, setSubmittingRO]         = useState(null);

  const notesRef         = useRef(null);
  const rowsRef          = useRef(rows);
  const notesEntriesRef  = useRef(notesEntries);
  const newNoteDraftRef  = useRef(newNoteDraft);
  const siFileInputRef   = useRef(null);
  rowsRef.current        = rows;
  notesEntriesRef.current = notesEntries;
  newNoteDraftRef.current = newNoteDraft;

  // ── Load prep notes ───────────────────────────────────────────────────────
  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (!data) return;
      if (Array.isArray(data.rows) && data.rows.length > 0)
        setRows(data.rows.map(r => ({ ...EMPTY_ROW(), ...r, notes: parseNotesField(r.notes) })));
    });
  }, [advisorName, date]);

  // ── Load service invitation data ──────────────────────────────────────────
  useEffect(() => {
    loadServiceInvitations().then(data => {
      if (data && Array.isArray(data)) {
        const meta = data.find(r => r.__meta);
        if (meta?.uploadedAt) setSiUploadedAt(meta.uploadedAt);
        if (meta?.rawColumns) setSiRawColumns(meta.rawColumns);
        setSiData(data.filter(r => !r.__meta && r.consultant !== undefined));
      }
      setSiLoading(false);
    });
  }, []);

  // ── Load completed reviews ────────────────────────────────────────────────
  useEffect(() => {
    loadCompletedReviews(advisorName).then(data => {
      setCompletedReviews(Array.isArray(data) ? data : []);
    });
  }, [advisorName]);

  // ── Notes modal close on outside click ───────────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (notesOpen !== null && notesRef.current && !notesRef.current.contains(e.target)) commitNotes();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notesOpen, notesEntries, newNoteDraft]);

  function openNotes(idx) {
    setNotesEntries(parseNotesField(rows[idx].notes));
    setNewNoteDraft('');
    setNotesOpen(idx);
  }

  function commitNotes() {
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      setRows(prev => prev.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r));
    }
    setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
  }

  function deleteEntry(i) { setNotesEntries(prev => prev.filter((_, j) => j !== i)); }

  // ── Prep row helpers ──────────────────────────────────────────────────────
  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function addRow()       { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(idx) { if (rows.length > 1) setRows(prev => prev.filter((_, i) => i !== idx)); }

  // ── Ensure token ──────────────────────────────────────────────────────────
  async function ensureToken(prompt_msg) {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) { setGithubToken(shared); return true; }
      } catch {}
      const code = prompt(prompt_msg || 'Enter save code:');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  // ── Save prep notes ───────────────────────────────────────────────────────
  async function handleSave() {
    let currentRows = rowsRef.current;
    if (notesOpen !== null) {
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      currentRows = rowsRef.current.map((r, i) => i === notesOpen ? { ...r, notes: entries } : r);
      setRows(currentRows);
      setNotesOpen(null); setNotesEntries([]); setNewNoteDraft('');
    }
    if (!await ensureToken('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):')) return;
    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, []);
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message)) setGithubToken('');
      setSaving(false); throw err;
    } finally { setSaving(false); }
  }

  // ── xlsx upload ───────────────────────────────────────────────────────────
  async function handleSiUpload() {
    if (!siFile) return;
    setSiParseError('');
    if (!await ensureToken('Enter save code to upload the report:')) return;
    setSiUploading(true);
    setSiUploadStatus('Reading file…');
    try {
      const buf = await siFile.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      if (raw.length === 0) throw new Error('The file appears empty or has no readable rows.');
      const rawColumns = Object.keys(raw[0]);
      const parsed = parseXlsxRows(raw);
      setSiUploadStatus('Saving to server…');
      const payload = [
        { __meta: true, uploadedAt: new Date().toISOString(), uploadedBy: ownAdvisor, rowCount: parsed.length, rawColumns },
        ...parsed,
      ];
      await saveServiceInvitations(payload);
      setSiData(parsed);
      setSiRawColumns(rawColumns);
      setSiUploadedAt(new Date().toISOString());
      setSiFile(null);
      if (siFileInputRef.current) siFileInputRef.current.value = '';
      setSiUploadStatus('');
      setAfterCallTab('report');
    } catch (err) {
      setSiParseError('Upload failed: ' + err.message);
      setSiUploadStatus('');
    } finally { setSiUploading(false); }
  }

  // ── Review draft helpers ──────────────────────────────────────────────────
  function updateDraft(ro, field, value) {
    setReviewDrafts(prev => ({
      ...prev,
      [ro]: { contacted: null, satisfied: null, phone: '', notes: '', ...prev[ro], [field]: value },
    }));
  }

  // ── Submit a completed review ─────────────────────────────────────────────
  async function handleSubmitReview(survey) {
    const draft = reviewDrafts[survey.repairOrder] || {};
    if (!draft.contacted || !draft.satisfied || !draft.phone) return;
    setSubmittingRO(survey.repairOrder);
    try {
      if (!await ensureToken('Enter save code to submit this review:')) { setSubmittingRO(null); return; }
      const entry = {
        ...survey,
        contacted:   draft.contacted,
        satisfied:   draft.satisfied,
        phone:       draft.phone || '',
        notes:       draft.notes || '',
        submittedAt: new Date().toISOString(),
        submittedBy: ownAdvisor,
      };
      const newCompleted = [...completedReviews, entry];
      await saveCompletedReviews(advisorName, newCompleted);
      setCompletedReviews(newCompleted);
      setReviewDrafts(prev => { const d = { ...prev }; delete d[survey.repairOrder]; return d; });
    } catch (err) {
      alert('Submit failed: ' + err.message);
    } finally { setSubmittingRO(null); }
  }

  // ── Computed survey lists ─────────────────────────────────────────────────
  const completedROs  = new Set(completedReviews.map(r => r.repairOrder));
  const allDataRows   = siData.filter(r => !r.__meta);

  const advisorSurveys = allDataRows.filter(row =>
    matchesAdvisor(row.consultant, advisorName) &&
    isDelivered(row.status) &&
    isWithin4Months(row.serviceDate || row.invitationDate)
  );

  // Pending = not yet submitted, sorted newest first
  const pendingSurveys = advisorSurveys
    .filter(s => !completedROs.has(s.repairOrder))
    .sort((a, b) => parseDateVal(b.serviceDate) - parseDateVal(a.serviceDate));

  // Survey Uploads = completed reviews sorted newest first, excluding manager-deleted
  const sortedCompleted = [...completedReviews]
    .filter(r => !r.managerDeleted)
    .sort((a, b) => parseDateVal(b.submittedAt) - parseDateVal(a.submittedAt));

  const detectedConsultants = [...new Set(allDataRows.map(r => r.consultant).filter(Boolean))].sort();

  // ── Display helpers ───────────────────────────────────────────────────────
  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const openModalRow = notesOpen !== null ? rows[notesOpen] : null;

  function NotesBtn({ idx, row }) {
    const entries = parseNotesField(row.notes);
    const hasNotes = entries.length > 0;
    const hasOther = entries.some(e => e.author && e.author !== ownAdvisor);
    return (
      <button
        className={`secondary adv-notes-btn${hasNotes ? ' adv-notes-btn--active' : ''}${hasOther ? ' adv-notes-btn--other' : ''}`}
        onClick={() => openNotes(idx)}
      >
        Notes{hasNotes ? ` (${entries.length})` : ''}
      </button>
    );
  }

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
              const isBad = /bad credentials|unauthorized|401/i.test(err.message);
              if (isBad) {
                setGithubToken('');
                let ok = false;
                try {
                  const r = await loadUsers();
                  if (r?.sharedSaveCode) { setGithubToken(r.sharedSaveCode); await handleSave(); onBack(); ok = true; }
                } catch {}
                if (!ok) {
                  const c = prompt('Save code expired. Enter a new one:');
                  if (c) { setGithubToken(c.trim()); try { await handleSave(); onBack(); } catch (e2) { alert('Save failed: ' + e2.message); } }
                }
              } else { alert('Save failed: ' + err.message); }
            }
          }}>
            {saving ? 'Saving...' : '← Back to Calendar'}
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>Editing: {advisorName}'s Calendar</span>
          )}
        </div>
        <button className="secondary" onClick={() => window.print()}>Print</button>
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
          </div>
          <table className="adv-table">
            <thead>
              <tr>
                <th>CUSTOMER NAME</th><th>APPOINTMENT TIME</th><th>CRITICAL DEFERRED SERVICE</th>
                <th>WAITER / DROP OFF</th><th>TECHNICIAN</th><th className="no-print adv-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}>
                  <td><input className="adv-cell-input" value={row.customerName} onChange={e => updateRow(idx, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                  <td><input className="adv-cell-input" value={row.appointmentTime} onChange={e => updateRow(idx, 'appointmentTime', e.target.value)} placeholder="e.g. 9:00 AM" /></td>
                  <td><input className="adv-cell-input" value={row.criticalDeferredService} onChange={e => updateRow(idx, 'criticalDeferredService', e.target.value)} placeholder="Deferred service notes" /></td>
                  <td className="adv-waiter-cell">
                    <div className="adv-check-pair">
                      <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.waiter} onChange={e => updateRow(idx, 'waiter', e.target.checked)} /><span>Waiter</span></label>
                      <label className="adv-check-label"><input type="checkbox" className="adv-checkbox" checked={row.dropOff} onChange={e => updateRow(idx, 'dropOff', e.target.checked)} /><span>Drop Off</span></label>
                    </div>
                  </td>
                  <td><input className="adv-cell-input" value={row.technician} onChange={e => updateRow(idx, 'technician', e.target.value)} placeholder="Tech name" /></td>
                  <td className="no-print adv-action-col">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <NotesBtn idx={idx} row={row} />
                      <button className="secondary adv-del-btn" onClick={() => removeRow(idx)} disabled={rows.length <= 1}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="no-print" style={{ marginTop: 14 }}>
            <button onClick={addRow}>+ Add Row</button>
          </div>
        </div>

        <div className="adv-section-divider" />

        {/* ── After Call Report ── */}
        <div className="adv-section">
          <div className="adv-form-header" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 className="adv-form-title" style={{ margin: 0 }}>ADVISOR AFTER CALL REPORT</h2>
                <div className="no-print" style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: 3 }}>
                  <TabBtn active={afterCallTab === 'report'}   onClick={() => setAfterCallTab('report')}   color="cyan">📋 View Report</TabBtn>
                  <TabBtn active={afterCallTab === 'complete'} onClick={() => setAfterCallTab('complete')} color="green">✅ Complete Review</TabBtn>
                  {canUpload && <TabBtn active={afterCallTab === 'uploads'}  onClick={() => setAfterCallTab('uploads')}  color="purple">📁 Survey Uploads{sortedCompleted.length > 0 ? ` (${sortedCompleted.length})` : ''}</TabBtn>}
                  {canUpload && <TabBtn active={afterCallTab === 'upload'} onClick={() => setAfterCallTab('upload')} color="amber">📤 Upload Report</TabBtn>}
                </div>
              </div>
            </div>
            <div className="adv-form-meta">
              <span>Advisor Name: <strong>{advisorName}</strong></span>
              <span>Date: <strong>{displayDate}</strong></span>
            </div>
          </div>

          {/* ── VIEW REPORT TAB ── */}
          {afterCallTab === 'report' && (
            siLoading ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>Loading surveys…</div>
            ) : siData.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                <div style={{ color: '#64748b', fontSize: 15 }}>No survey data uploaded yet.</div>
                {canUpload && <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>Use <button onClick={() => setAfterCallTab('upload')} style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0 }}>📤 Upload Report</button> to load your ServiceInvitationList.</div>}
              </div>
            ) : pendingSurveys.length === 0 ? (
              <div style={{ padding: '28px 0 12px' }}>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ color: '#64748b', fontSize: 15 }}>No pending surveys for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong> in the last 4 months.</div>
                  {canUpload && sortedCompleted.length > 0 && <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>{sortedCompleted.length} survey{sortedCompleted.length !== 1 ? 's' : ''} already completed — see <button onClick={() => setAfterCallTab('uploads')} style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0 }}>📁 Survey Uploads</button>.</div>}
                </div>
                {canUpload && detectedConsultants.length > 0 && (
                  <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.22)', borderRadius: 14, padding: '16px 20px' }}>
                    <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: 13, marginBottom: 8 }}>Consultants found in uploaded file:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {detectedConsultants.map(n => <span key={n} style={{ background: 'rgba(110,231,249,.1)', border: '1px solid rgba(110,231,249,.25)', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#6ee7f9', fontWeight: 600 }}>{n}</span>)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>Showing <strong style={{ color: '#6ee7f9' }}>{pendingSurveys.length}</strong> pending survey{pendingSurveys.length !== 1 ? 's' : ''} for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong> (last 4 months, newest first)</span>
                  {siUploadedAt && <span style={{ fontSize: 12, color: '#475569' }}>Data as of {new Date(siUploadedAt).toLocaleDateString()}</span>}
                </div>
                <table className="adv-table">
                  <thead><tr><th>CUSTOMER NAME</th><th>REPAIR ORDER</th><th>VIN</th><th>MODEL</th><th>SERVICE DATE</th><th>INVITATION DATE</th></tr></thead>
                  <tbody>
                    {pendingSurveys.map((row, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.customerName || '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#6ee7f9' }}>{row.repairOrder || '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{row.vin || '—'}</td>
                        <td style={{ color: '#cbd5e1' }}>{row.model || '—'}</td>
                        <td style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(row.serviceDate)}</td>
                        <td style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(row.invitationDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          )}

          {/* ── COMPLETE REVIEW TAB ── */}
          {afterCallTab === 'complete' && (
            siLoading ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>Loading surveys…</div>
            ) : pendingSurveys.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                <div style={{ color: '#64748b', fontSize: 15 }}>No pending surveys to review for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong>.</div>
                {canUpload && sortedCompleted.length > 0 && <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>All done! See <button onClick={() => setAfterCallTab('uploads')} style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0 }}>📁 Survey Uploads</button> for completed reviews.</div>}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
                  <strong style={{ color: '#6ee7f9' }}>{pendingSurveys.length}</strong> survey{pendingSurveys.length !== 1 ? 's' : ''} pending review — answer all questions to unlock Submit.
                </div>
                {pendingSurveys.map(survey => {
                  const draft = reviewDrafts[survey.repairOrder] || {};
                  const canSubmit = !!(draft.contacted && draft.satisfied && draft.phone && draft.phone.trim());
                  const isSubmitting = submittingRO === survey.repairOrder;

                  return (
                    <div key={survey.repairOrder} style={{
                      background: canSubmit ? 'rgba(34,197,94,.08)' : 'rgba(30,41,59,.85)',
                      border: `1px solid ${canSubmit ? 'rgba(34,197,94,.35)' : 'rgba(99,132,165,.25)'}`,
                      borderRadius: 14, padding: '18px 20px',
                      transition: 'background .2s, border-color .2s',
                    }}>
                      {/* Survey info */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '4px 20px', marginBottom: 16 }}>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Customer</div><div style={{ fontWeight: 800, color: '#f1f5f9', fontSize: 14 }}>{survey.customerName || '—'}</div></div>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>RO #</div><div style={{ fontFamily: 'monospace', color: '#6ee7f9', fontSize: 13, fontWeight: 700 }}>{survey.repairOrder || '—'}</div></div>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Model</div><div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{survey.model || '—'}</div></div>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Service Date</div><div style={{ color: '#cbd5e1', fontSize: 13 }}>{fmtDate(survey.serviceDate)}</div></div>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Invitation Date</div><div style={{ color: '#cbd5e1', fontSize: 13 }}>{fmtDate(survey.invitationDate)}</div></div>
                        <div><div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>VIN</div><div style={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: 11 }}>{survey.vin || '—'}</div></div>
                      </div>

                      {/* Divider */}
                      <div style={{ height: 1, background: 'rgba(255,255,255,.06)', marginBottom: 16 }} />

                      {/* Action row */}
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                        {/* Contacted */}
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                            Contacted {draft.contacted && <span style={{ color: '#86efac' }}>✓</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <ChipBtn active={draft.contacted === 'yes'}       color="green" onClick={() => updateDraft(survey.repairOrder, 'contacted', draft.contacted === 'yes' ? null : 'yes')}>✓ Yes</ChipBtn>
                            <ChipBtn active={draft.contacted === 'voicemail'} color="amber" onClick={() => updateDraft(survey.repairOrder, 'contacted', draft.contacted === 'voicemail' ? null : 'voicemail')}>📞 Voicemail</ChipBtn>
                          </div>
                        </div>

                        {/* Customer Satisfied */}
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                            Customer Satisfied {draft.satisfied && <span style={{ color: '#86efac' }}>✓</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <ChipBtn active={draft.satisfied === 'yes'} color="green" onClick={() => updateDraft(survey.repairOrder, 'satisfied', draft.satisfied === 'yes' ? null : 'yes')}>✓ Yes</ChipBtn>
                            <ChipBtn active={draft.satisfied === 'no'}  color="red"   onClick={() => updateDraft(survey.repairOrder, 'satisfied', draft.satisfied === 'no'  ? null : 'no')}>✗ No</ChipBtn>
                          </div>
                        </div>

                        {/* Phone Number */}
                        <div style={{ minWidth: 150 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                            Phone Number {draft.phone && draft.phone.trim() && <span style={{ color: '#86efac' }}>✓</span>}
                          </div>
                          <input
                            type="tel"
                            value={draft.phone || ''}
                            onChange={e => updateDraft(survey.repairOrder, 'phone', e.target.value)}
                            placeholder="(555) 555-5555"
                            style={{
                              width: '100%', background: 'rgba(255,255,255,.05)',
                              border: `1px solid ${draft.phone && draft.phone.trim() ? 'rgba(34,197,94,.4)' : 'rgba(255,255,255,.1)'}`,
                              borderRadius: 8, color: '#e2e8f0', fontSize: 13,
                              padding: '8px 10px', fontFamily: 'inherit', boxSizing: 'border-box',
                            }}
                          />
                        </div>

                        {/* Notes */}
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Notes</div>
                          <textarea
                            value={draft.notes || ''}
                            onChange={e => updateDraft(survey.repairOrder, 'notes', e.target.value)}
                            placeholder="Add notes here…"
                            rows={2}
                            style={{
                              width: '100%', background: 'rgba(255,255,255,.05)',
                              border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
                              color: '#e2e8f0', fontSize: 13, padding: '8px 10px',
                              resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                            }}
                          />
                        </div>

                        {/* Submit */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                          {canSubmit && (
                            <button
                              onClick={() => handleSubmitReview(survey)}
                              disabled={isSubmitting}
                              style={{
                                background: 'linear-gradient(135deg,rgba(34,197,94,.35),rgba(16,185,129,.25))',
                                border: '1px solid rgba(34,197,94,.5)', color: '#86efac',
                                borderRadius: 10, padding: '10px 22px', cursor: isSubmitting ? 'wait' : 'pointer',
                                fontWeight: 800, fontSize: 14, transition: 'all .15s',
                                boxShadow: '0 4px 16px rgba(34,197,94,.2)',
                              }}
                            >
                              {isSubmitting ? '⏳ Submitting…' : '✅ Submit'}
                            </button>
                          )}
                          {!canSubmit && (
                            <div style={{ fontSize: 11, color: '#334155', fontStyle: 'italic', paddingBottom: 6 }}>
                              {!draft.contacted ? 'Select Contacted' : !draft.satisfied ? 'Select Customer Satisfied' : 'Enter Phone Number'} to unlock submit
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── SURVEY UPLOADS TAB ── */}
          {afterCallTab === 'uploads' && (
            sortedCompleted.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📁</div>
                <div style={{ color: '#64748b', fontSize: 15 }}>No completed reviews yet for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong>.</div>
                <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>Submit reviews in the <button onClick={() => setAfterCallTab('complete')} style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0 }}>✅ Complete Review</button> tab.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                  <strong style={{ color: '#c4b5fd' }}>{sortedCompleted.length}</strong> completed review{sortedCompleted.length !== 1 ? 's' : ''} for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="adv-table" style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th>CUSTOMER NAME</th>
                        <th>REPAIR ORDER</th>
                        <th>MODEL</th>
                        <th>SERVICE DATE</th>
                        <th>PHONE</th>
                        <th>CONTACTED</th>
                        <th>SATISFIED</th>
                        <th>NOTES</th>
                        <th>SUBMITTED</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCompleted.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.customerName || '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#6ee7f9' }}>{row.repairOrder || '—'}</td>
                          <td style={{ color: '#cbd5e1' }}>{row.model || '—'}</td>
                          <td style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(row.serviceDate)}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#6ee7f9', whiteSpace: 'nowrap' }}>{row.phone || '—'}</td>
                          <td>
                            <span style={{
                              background: row.contacted === 'yes' ? 'rgba(34,197,94,.15)' : 'rgba(251,191,36,.15)',
                              color: row.contacted === 'yes' ? '#86efac' : '#fde68a',
                              border: `1px solid ${row.contacted === 'yes' ? 'rgba(34,197,94,.35)' : 'rgba(251,191,36,.35)'}`,
                              borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
                            }}>
                              {row.contacted === 'yes' ? '✓ Yes' : '📞 Voicemail'}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              background: row.satisfied === 'yes' ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
                              color: row.satisfied === 'yes' ? '#86efac' : '#fca5a5',
                              border: `1px solid ${row.satisfied === 'yes' ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)'}`,
                              borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
                            }}>
                              {row.satisfied === 'yes' ? '✓ Yes' : '✗ No'}
                            </span>
                          </td>
                          <td style={{ color: '#94a3b8', fontSize: 13, maxWidth: 200 }}>{row.notes || <span style={{ color: '#334155' }}>—</span>}</td>
                          <td style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>{row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}

          {/* ── UPLOAD REPORT TAB ── */}
          {afterCallTab === 'upload' && canUpload && (
            <div style={{ padding: '28px 0 12px' }}>
              <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.22)', borderRadius: 14, padding: '18px 22px', marginBottom: 24 }}>
                <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: 6, fontSize: 14 }}>📊 ServiceInvitationList Upload</div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>
                  Upload the <strong style={{ color: '#e2e8f0' }}>ServiceInvitationList.xlsx</strong> export from your DMS.<br />
                  Each advisor will only see their own delivered surveys from the last 4 months. Previously submitted reviews are excluded permanently.
                </div>
                {siUploadedAt && <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Last uploaded: <strong style={{ color: '#94a3b8' }}>{new Date(siUploadedAt).toLocaleString()}</strong></div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <input ref={siFileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} id="si-file-input"
                  onChange={e => {
                    const f = e.target.files[0];
                    setSiParseError('');
                    if (!f) { setSiFile(null); return; }
                    const ext = (f.name.split('.').pop() || '').toLowerCase();
                    if (!['xlsx', 'xls'].includes(ext)) { setSiParseError('Only Excel files (.xlsx, .xls) are allowed.'); setSiFile(null); e.target.value = ''; return; }
                    setSiFile(f);
                  }}
                />
                <label htmlFor="si-file-input" style={{ background: siFile ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.05)', border: `1px dashed ${siFile ? 'rgba(34,197,94,.5)' : 'rgba(251,191,36,.4)'}`, color: siFile ? '#86efac' : '#fbbf24', borderRadius: 10, padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                  {siFile ? `✔ ${siFile.name}` : '📂 Choose xlsx File'}
                </label>
                <button onClick={handleSiUpload} disabled={siUploading || !siFile}
                  style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.3),rgba(245,158,11,.2))', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 10, padding: '10px 24px', cursor: siUploading || !siFile ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 14, opacity: siUploading || !siFile ? 0.5 : 1 }}>
                  {siUploading ? (siUploadStatus || 'Uploading…') : '⬆ Upload & Apply'}
                </button>
              </div>
              {siParseError && <div style={{ marginTop: 12, color: '#f87171', fontSize: 13, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '8px 14px' }}>{siParseError}</div>}
            </div>
          )}

        </div>
      </div>

      {/* ── Notes Modal (Appointment Prep) ── */}
      {notesOpen !== null && (
        <div className="adv-notes-overlay no-print">
          <div className="adv-notes-modal" ref={notesRef}>
            <div className="adv-notes-modal-header">
              <span>Notes — {openModalRow?.customerName || `Row ${notesOpen + 1}`}</span>
              <button className="secondary adv-del-btn" onClick={commitNotes}>×</button>
            </div>
            <div className="adv-notes-entries">
              {notesEntries.length === 0 ? (
                <div className="adv-notes-empty">No notes yet — add one below.</div>
              ) : notesEntries.map((entry, i) => (
                <div key={i} className="adv-notes-entry">
                  <div className="adv-notes-entry-body">
                    {entry.author && <span className={entry.author !== ownAdvisor ? 'adv-notes-entry-author adv-notes-entry-author--other' : 'adv-notes-entry-author'}>{entry.author}&mdash;&nbsp;</span>}
                    <span className="adv-notes-entry-text">{entry.text}</span>
                  </div>
                  {(!entry.author || entry.author === ownAdvisor) && (
                    <button className="secondary adv-del-btn adv-notes-entry-del" onClick={() => deleteEntry(i)}>×</button>
                  )}
                </div>
              ))}
            </div>
            <div className="adv-notes-add-row">
              <span className="adv-notes-add-who">{ownAdvisor}—</span>
              <textarea className="adv-notes-textarea adv-notes-new-input" autoFocus value={newNoteDraft} onChange={e => setNewNoteDraft(e.target.value)} placeholder="Type your note here..." rows={3} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={commitNotes}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
