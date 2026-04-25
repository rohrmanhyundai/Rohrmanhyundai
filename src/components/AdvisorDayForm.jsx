import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  saveAdvisorNotes, loadAdvisorNotes,
  loadServiceInvitations, saveServiceInvitations,
  loadUsers, getGithubToken, setGithubToken,
} from '../utils/github';

const EMPTY_ROW = () => ({
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: []
});

// Convert any saved notes format into an array of { author, text } entries
function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

// ── xlsx helpers ──────────────────────────────────────────────────────────────

// Try many column name variations — handles different DMS export formats
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
  return rawRows.map(row => ({
    consultant:     findCol(row, 'Service Consultant Name', 'Service Consultant', 'Consultant', 'SA Name', 'Advisor Name', 'Advisor'),
    customerName:   findCol(row, 'Customer Name', 'Owner Name', 'Customer', 'Name', 'Owner'),
    repairOrder:    findCol(row, 'RO Number', 'R/O Number', 'Repair Order', 'RO#', 'R/O No.', 'RO No', 'Repair Order Number', 'RO'),
    vin:            findCol(row, 'VIN', 'VIN Number', 'Vin'),
    model:          findCol(row, 'Model', 'Model Name', 'Vehicle Model', 'Year Model', 'Make Model', 'Vehicle Description', 'Model Year'),
    serviceDate:    findCol(row, 'Service Date', 'RO Close Date', 'Close Date', 'Repair Order Date', 'RO Date', 'Completed Date', 'In Service Date'),
    invitationDate: findCol(row, 'Invitation Date', 'Survey Date', 'Survey Sent Date', 'Sent Date', 'Delivery Date', 'Email Date'),
    status:         findCol(row, 'Status', 'Survey Status', 'Delivery Status', 'Email Status', 'Survey Delivery Status'),
  }));
}

function matchesAdvisor(consultant, advisorName) {
  if (!consultant || !advisorName) return false;
  // "Jordan Troxel" should match advisor username "JORDAN"
  const firstName = advisorName.trim().split(' ')[0].toLowerCase();
  const cn = consultant.trim().toLowerCase();
  return cn.startsWith(firstName + ' ') || cn === firstName;
}

function isWithin4Months(dateStr) {
  if (!dateStr) return true;
  // Try parsing Excel date serial or ISO string
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 4);
  return d >= cutoff;
}

function isDelivered(status) {
  if (!status) return true; // no status column = include all
  return status.trim().toLowerCase() === 'delivered';
}

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, currentRole, canEditDashboard, onBack }) {
  const canUpload = canEditDashboard || currentRole === 'admin' || (currentRole || '').includes('manager');

  // ── Appointment prep state ────────────────────────────────────────────────
  const [rows, setRows]         = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving]     = useState(false);

  // ── Notes modal state ─────────────────────────────────────────────────────
  const [notesOpen, setNotesOpen]         = useState(null);
  const [notesEntries, setNotesEntries]   = useState([]);
  const [newNoteDraft, setNewNoteDraft]   = useState('');

  // ── Service invitation (After Call Report) state ──────────────────────────
  const [afterCallTab, setAfterCallTab]   = useState('report');  // 'report' | 'upload'
  const [siData, setSiData]               = useState([]);
  const [siLoading, setSiLoading]         = useState(true);
  const [siUploading, setSiUploading]     = useState(false);
  const [siUploadStatus, setSiUploadStatus] = useState('');
  const [siFile, setSiFile]               = useState(null);
  const [siParseError, setSiParseError]   = useState('');
  const [siUploadedAt, setSiUploadedAt]   = useState('');

  const notesRef          = useRef(null);
  const rowsRef           = useRef(rows);
  const notesEntriesRef   = useRef(notesEntries);
  const newNoteDraftRef   = useRef(newNoteDraft);
  const siFileInputRef    = useRef(null);
  rowsRef.current         = rows;
  notesEntriesRef.current = notesEntries;
  newNoteDraftRef.current = newNoteDraft;

  // ── Load advisor prep notes ───────────────────────────────────────────────
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
        const meta = data.__meta;
        if (meta?.uploadedAt) setSiUploadedAt(meta.uploadedAt);
        setSiData(data.filter(r => r.consultant !== undefined));
      }
      setSiLoading(false);
    });
  }, []);

  // ── Notes modal outside-click close ──────────────────────────────────────
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
    setNotesOpen(null);
    setNotesEntries([]);
    setNewNoteDraft('');
  }

  function deleteEntry(entryIdx) {
    setNotesEntries(prev => prev.filter((_, i) => i !== entryIdx));
  }

  // ── Appointment prep row helpers ──────────────────────────────────────────
  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function addRow()         { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(idx)   { if (rows.length > 1) setRows(prev => prev.filter((_, i) => i !== idx)); }

  // ── Save ──────────────────────────────────────────────────────────────────
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

    if (!getGithubToken()) {
      let autoFilled = false;
      try {
        const result = await loadUsers();
        const freshCode = result?.sharedSaveCode;
        if (freshCode) { setGithubToken(freshCode); autoFilled = true; }
      } catch {}
      if (!autoFilled) {
        const code = prompt('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):');
        if (!code) throw new Error('No save code entered.');
        setGithubToken(code.trim());
      }
    }

    setSaving(true);
    try {
      // Save prep rows only (after-call is now xlsx-driven)
      await saveAdvisorNotes(advisorName, date, currentRows, []);
    } catch (err) {
      if (/bad credentials|unauthorized|401/i.test(err.message)) setGithubToken('');
      setSaving(false);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  // ── xlsx upload ───────────────────────────────────────────────────────────
  async function handleSiUpload() {
    if (!siFile) return;
    setSiParseError('');

    // Ensure token
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) setGithubToken(shared);
      } catch {}
    }
    if (!getGithubToken()) {
      const code = prompt('Enter save code to upload the report:');
      if (!code) return;
      setGithubToken(code.trim());
    }

    setSiUploading(true);
    setSiUploadStatus('Reading file…');
    try {
      const buf = await siFile.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

      if (raw.length === 0) throw new Error('The file appears empty or has no readable rows.');

      const parsed = parseXlsxRows(raw);
      setSiUploadStatus('Saving to server…');

      // Attach metadata row to track upload time
      const payload = [
        { __meta: true, uploadedAt: new Date().toISOString(), uploadedBy: ownAdvisor, rowCount: parsed.length },
        ...parsed,
      ];

      await saveServiceInvitations(payload);

      setSiData(parsed);
      setSiUploadedAt(new Date().toISOString());
      setSiFile(null);
      if (siFileInputRef.current) siFileInputRef.current.value = '';
      setSiUploadStatus('');
      setAfterCallTab('report');
    } catch (err) {
      setSiParseError('Upload failed: ' + err.message);
      setSiUploadStatus('');
    } finally {
      setSiUploading(false);
    }
  }

  // ── Filtered survey rows ──────────────────────────────────────────────────
  const allDataRows = siData.filter(r => !r.__meta);
  const advisorSurveys = allDataRows.filter(row => {
    if (!matchesAdvisor(row.consultant, advisorName)) return false;
    if (!isDelivered(row.status)) return false;
    const dateToCheck = row.serviceDate || row.invitationDate;
    if (!isWithin4Months(dateToCheck)) return false;
    return true;
  });

  // For admin/manager debug: unique consultant names detected in the xlsx
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
        title={hasOther ? 'Has notes from other advisors' : hasNotes ? 'View / edit notes' : 'Add notes'}
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
            const attemptSave = async () => {
              try {
                await handleSave();
                onBack();
              } catch (err) {
                const isBadToken = /bad credentials|unauthorized|401/i.test(err.message);
                if (isBadToken) {
                  setGithubToken('');
                  let autoRefreshed = false;
                  try {
                    const result = await loadUsers();
                    const freshCode = result?.sharedSaveCode;
                    if (freshCode) {
                      setGithubToken(freshCode);
                      await handleSave();
                      onBack();
                      autoRefreshed = true;
                    }
                  } catch {}
                  if (!autoRefreshed) {
                    const code = prompt('Your save code is invalid or expired.\n\nPlease enter a new save code:');
                    if (code && code.trim()) {
                      setGithubToken(code.trim());
                      try { await handleSave(); onBack(); }
                      catch (err2) { alert('Save failed: ' + err2.message); }
                    }
                  }
                } else {
                  alert('Save failed: ' + err.message);
                }
              }
            };
            attemptSave();
          }}>
            {saving ? 'Saving...' : '← Back to Calendar'}
          </button>
          {advisorName !== ownAdvisor && (
            <span style={{ fontSize: 13, color: 'var(--cyan)', fontWeight: 700 }}>
              Editing: {advisorName}'s Calendar
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="adv-form-wrap">

        {/* ── SECTION 1: Appointment Prep ── */}
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
                <th>CUSTOMER NAME</th>
                <th>APPOINTMENT TIME</th>
                <th>CRITICAL DEFERRED SERVICE</th>
                <th>WAITER / DROP OFF</th>
                <th>TECHNICIAN</th>
                <th className="no-print adv-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}>
                  <td><input className="adv-cell-input" value={row.customerName}
                    onChange={e => updateRow(idx, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                  <td><input className="adv-cell-input" value={row.appointmentTime}
                    onChange={e => updateRow(idx, 'appointmentTime', e.target.value)} placeholder="e.g. 9:00 AM" /></td>
                  <td><input className="adv-cell-input" value={row.criticalDeferredService}
                    onChange={e => updateRow(idx, 'criticalDeferredService', e.target.value)} placeholder="Deferred service notes" /></td>
                  <td className="adv-waiter-cell">
                    <div className="adv-check-pair">
                      <label className="adv-check-label">
                        <input type="checkbox" className="adv-checkbox" checked={row.waiter}
                          onChange={e => updateRow(idx, 'waiter', e.target.checked)} />
                        <span>Waiter</span>
                      </label>
                      <label className="adv-check-label">
                        <input type="checkbox" className="adv-checkbox" checked={row.dropOff}
                          onChange={e => updateRow(idx, 'dropOff', e.target.checked)} />
                        <span>Drop Off</span>
                      </label>
                    </div>
                  </td>
                  <td><input className="adv-cell-input" value={row.technician}
                    onChange={e => updateRow(idx, 'technician', e.target.value)} placeholder="Tech name" /></td>
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

        {/* ── SECTION DIVIDER ── */}
        <div className="adv-section-divider" />

        {/* ── SECTION 2: After Call Report ── */}
        <div className="adv-section">
          <div className="adv-form-header" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              {/* Title + tab buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <h2 className="adv-form-title" style={{ margin: 0 }}>ADVISOR AFTER CALL REPORT</h2>
                {canUpload && (
                  <div className="no-print" style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: 3 }}>
                    <button
                      onClick={() => setAfterCallTab('report')}
                      style={{
                        background: afterCallTab === 'report' ? 'rgba(61,214,195,.2)' : 'transparent',
                        border: afterCallTab === 'report' ? '1px solid rgba(61,214,195,.4)' : '1px solid transparent',
                        color: afterCallTab === 'report' ? '#6ee7f9' : '#64748b',
                        borderRadius: 7, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, transition: 'all .15s',
                      }}
                    >
                      📋 View Report
                    </button>
                    <button
                      onClick={() => setAfterCallTab('upload')}
                      style={{
                        background: afterCallTab === 'upload' ? 'rgba(251,191,36,.18)' : 'transparent',
                        border: afterCallTab === 'upload' ? '1px solid rgba(251,191,36,.45)' : '1px solid transparent',
                        color: afterCallTab === 'upload' ? '#fbbf24' : '#64748b',
                        borderRadius: 7, padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, transition: 'all .15s',
                      }}
                    >
                      📤 Upload Report
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="adv-form-meta">
              <span>Advisor Name: <strong>{advisorName}</strong></span>
              <span>Date: <strong>{displayDate}</strong></span>
            </div>
          </div>

          {/* ── UPLOAD TAB ── */}
          {afterCallTab === 'upload' && canUpload && (
            <div style={{ padding: '28px 0 12px' }}>
              {/* Info card */}
              <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.22)', borderRadius: 14, padding: '18px 22px', marginBottom: 24 }}>
                <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: 6, fontSize: 14 }}>📊 ServiceInvitationList Upload</div>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7 }}>
                  Upload the <strong style={{ color: '#e2e8f0' }}>ServiceInvitationList.xlsx</strong> export from your DMS.<br />
                  The report will automatically show each advisor only their own delivered surveys from the last 4 months.
                </div>
                {siUploadedAt && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
                    Last uploaded: <strong style={{ color: '#94a3b8' }}>{new Date(siUploadedAt).toLocaleString()}</strong>
                  </div>
                )}
              </div>

              {/* File picker row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <input
                  ref={siFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  id="si-file-input"
                  onChange={e => {
                    const f = e.target.files[0];
                    setSiParseError('');
                    if (!f) { setSiFile(null); return; }
                    const ext = (f.name.split('.').pop() || '').toLowerCase();
                    if (!['xlsx', 'xls'].includes(ext)) {
                      setSiParseError('Only Excel files (.xlsx, .xls) are allowed.');
                      setSiFile(null); e.target.value = ''; return;
                    }
                    setSiFile(f);
                  }}
                />
                <label
                  htmlFor="si-file-input"
                  style={{
                    background: siFile ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.05)',
                    border: `1px dashed ${siFile ? 'rgba(34,197,94,.5)' : 'rgba(251,191,36,.4)'}`,
                    color: siFile ? '#86efac' : '#fbbf24', borderRadius: 10,
                    padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap',
                  }}
                >
                  {siFile ? `✔ ${siFile.name}` : '📂 Choose xlsx File'}
                </label>

                <button
                  onClick={handleSiUpload}
                  disabled={siUploading || !siFile}
                  style={{
                    background: 'linear-gradient(135deg,rgba(251,191,36,.3),rgba(245,158,11,.2))',
                    border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24',
                    borderRadius: 10, padding: '10px 24px', cursor: siUploading || !siFile ? 'not-allowed' : 'pointer',
                    fontWeight: 800, fontSize: 14, opacity: siUploading || !siFile ? 0.5 : 1,
                  }}
                >
                  {siUploading ? (siUploadStatus || 'Uploading…') : '⬆ Upload & Apply'}
                </button>
              </div>

              {siParseError && (
                <div style={{ marginTop: 12, color: '#f87171', fontSize: 13, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '8px 14px' }}>
                  {siParseError}
                </div>
              )}
            </div>
          )}

          {/* ── REPORT TAB ── */}
          {afterCallTab === 'report' && (
            <>
              {siLoading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading surveys…</div>
              ) : siData.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <div style={{ color: '#64748b', fontSize: 15 }}>No survey data uploaded yet.</div>
                  {canUpload && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>
                      Use the <button onClick={() => setAfterCallTab('upload')} style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline', padding: 0 }}>📤 Upload Report</button> tab to load your ServiceInvitationList.
                    </div>
                  )}
                </div>
              ) : advisorSurveys.length === 0 ? (
                <div style={{ padding: '28px 0 12px' }}>
                  <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                    <div style={{ color: '#64748b', fontSize: 15 }}>
                      No delivered surveys found for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong> in the last 4 months.
                    </div>
                  </div>

                  {/* Admin: show what consultants ARE in the file */}
                  {canUpload && detectedConsultants.length > 0 && (
                    <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.22)', borderRadius: 14, padding: '18px 22px' }}>
                      <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: 10, fontSize: 13 }}>
                        📊 {allDataRows.length} total rows loaded — Consultants found in the file:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {detectedConsultants.map(name => (
                          <span key={name} style={{ background: 'rgba(110,231,249,.1)', border: '1px solid rgba(110,231,249,.25)', borderRadius: 8, padding: '4px 12px', fontSize: 13, color: '#6ee7f9', fontWeight: 600 }}>
                            {name}
                          </span>
                        ))}
                      </div>
                      <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                        The advisor page name <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong> must match the first name of one of the consultants above.<br />
                        Navigate to that advisor's calendar day to see their surveys.
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Survey count + last uploaded */}
                  <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      Showing <strong style={{ color: '#6ee7f9' }}>{advisorSurveys.length}</strong> delivered survey{advisorSurveys.length !== 1 ? 's' : ''} for <strong style={{ color: '#e2e8f0' }}>{advisorName}</strong> (last 4 months)
                    </span>
                    {siUploadedAt && (
                      <span style={{ fontSize: 12, color: '#475569' }}>
                        Data as of {new Date(siUploadedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <table className="adv-table">
                    <thead>
                      <tr>
                        <th>CUSTOMER NAME</th>
                        <th>REPAIR ORDER</th>
                        <th>VIN</th>
                        <th>MODEL</th>
                        <th>SERVICE DATE</th>
                        <th>INVITATION DATE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advisorSurveys.map((row, idx) => (
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
              )}
            </>
          )}
        </div>

      </div>{/* end adv-form-wrap */}

      {/* ── Notes Modal ── */}
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
              ) : (
                notesEntries.map((entry, i) => (
                  <div key={i} className="adv-notes-entry">
                    <div className="adv-notes-entry-body">
                      {entry.author && (
                        <span className={entry.author !== ownAdvisor ? 'adv-notes-entry-author adv-notes-entry-author--other' : 'adv-notes-entry-author'}>
                          {entry.author}&mdash;&nbsp;
                        </span>
                      )}
                      <span className="adv-notes-entry-text">{entry.text}</span>
                    </div>
                    {(!entry.author || entry.author === ownAdvisor) && (
                      <button className="secondary adv-del-btn adv-notes-entry-del" onClick={() => deleteEntry(i)} title="Remove">×</button>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="adv-notes-add-row">
              <span className="adv-notes-add-who">{ownAdvisor}—</span>
              <textarea
                className="adv-notes-textarea adv-notes-new-input"
                autoFocus
                value={newNoteDraft}
                onChange={e => setNewNoteDraft(e.target.value)}
                placeholder="Type your note here..."
                rows={3}
              />
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
