import React, { useState, useEffect, useRef } from 'react';
import { saveAdvisorNotes, loadAdvisorNotes, getGithubToken, setGithubToken } from '../utils/github';

const EMPTY_ROW = () => ({
  customerName: '', appointmentTime: '', criticalDeferredService: '',
  waiter: false, dropOff: false, technician: '', notes: []
});

const EMPTY_AFTER_CALL_ROW = () => ({
  customerName: '', phoneNumber: '', repairOrderNumber: '',
  servicePerformed: { maintenance: false, diagnosticRepair: false, warranty: false, customerPay: false },
  customerFeedback: { good: false, poor: false },
  notes: []
});

const SERVICE_TYPES = [
  ['maintenance',     'Maintenance'],
  ['diagnosticRepair','Diagnostic/Repair'],
  ['warranty',        'Warranty'],
  ['customerPay',     'Customer Pay'],
];

// Convert any saved notes format into an array of { author, text } entries
function parseNotesField(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes.filter(e => e && e.text);
  const m = String(notes).match(/^\[([^\]]+)\]\n([\s\S]*)$/);
  if (m) return [{ author: m[1], text: m[2] }];
  if (String(notes).trim()) return [{ author: null, body: String(notes).trim() }];
  return [];
}

export default function AdvisorDayForm({ advisorName, ownAdvisor, date, onBack }) {
  const [rows, setRows]               = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [afterCallRows, setAfterCallRows] = useState(() => Array.from({ length: 5 }, EMPTY_AFTER_CALL_ROW));
  const [saving, setSaving]           = useState(false);

  // notesOpen = { table: 'prep'|'after', idx } or null
  const [notesOpen, setNotesOpen]     = useState(null);
  const [notesEntries, setNotesEntries] = useState([]);
  const [newNoteDraft, setNewNoteDraft] = useState('');

  const notesRef          = useRef(null);
  const rowsRef           = useRef(rows);
  const afterCallRowsRef  = useRef(afterCallRows);
  const notesEntriesRef   = useRef(notesEntries);
  const newNoteDraftRef   = useRef(newNoteDraft);
  rowsRef.current         = rows;
  afterCallRowsRef.current = afterCallRows;
  notesEntriesRef.current = notesEntries;
  newNoteDraftRef.current = newNoteDraft;

  // Load saved data
  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (!data) return;
      if (Array.isArray(data.rows) && data.rows.length > 0)
        setRows(data.rows.map(r => ({ ...EMPTY_ROW(), ...r, notes: parseNotesField(r.notes) })));
      if (Array.isArray(data.afterCallRows) && data.afterCallRows.length > 0)
        setAfterCallRows(data.afterCallRows.map(r => ({ ...EMPTY_AFTER_CALL_ROW(), ...r, notes: parseNotesField(r.notes) })));
    });
  }, [advisorName, date]);

  // Close notes modal on outside click
  useEffect(() => {
    function handleClick(e) {
      if (notesOpen !== null && notesRef.current && !notesRef.current.contains(e.target)) commitNotes();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notesOpen, notesEntries, newNoteDraft]);

  function openNotes(table, idx) {
    const row = table === 'prep' ? rows[idx] : afterCallRows[idx];
    setNotesEntries(parseNotesField(row.notes));
    setNewNoteDraft('');
    setNotesOpen({ table, idx });
  }

  function commitNotes() {
    if (notesOpen !== null) {
      const { table, idx } = notesOpen;
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      if (table === 'prep')
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, notes: entries } : r));
      else
        setAfterCallRows(prev => prev.map((r, i) => i === idx ? { ...r, notes: entries } : r));
    }
    setNotesOpen(null);
    setNotesEntries([]);
    setNewNoteDraft('');
  }

  function deleteEntry(entryIdx) {
    setNotesEntries(prev => prev.filter((_, i) => i !== entryIdx));
  }

  // Appointment prep row helpers
  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function addRow()         { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(idx)   { if (rows.length > 1) setRows(prev => prev.filter((_, i) => i !== idx)); }

  // After-call row helpers
  function updateAfterCallRow(idx, field, value) {
    setAfterCallRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function addAfterCallRow()       { setAfterCallRows(prev => [...prev, EMPTY_AFTER_CALL_ROW()]); }
  function removeAfterCallRow(idx) { if (afterCallRows.length > 1) setAfterCallRows(prev => prev.filter((_, i) => i !== idx)); }

  async function handleSave() {
    let currentRows = rowsRef.current;
    let currentAfterCallRows = afterCallRowsRef.current;

    if (notesOpen !== null) {
      const { table, idx } = notesOpen;
      const entries = [...notesEntriesRef.current];
      const draft = newNoteDraftRef.current.trim();
      if (draft) entries.push({ author: ownAdvisor, text: draft });
      if (table === 'prep') {
        currentRows = rowsRef.current.map((r, i) => i === idx ? { ...r, notes: entries } : r);
        setRows(currentRows);
      } else {
        currentAfterCallRows = afterCallRowsRef.current.map((r, i) => i === idx ? { ...r, notes: entries } : r);
        setAfterCallRows(currentAfterCallRows);
      }
      setNotesOpen(null);
      setNotesEntries([]);
      setNewNoteDraft('');
    }

    if (!getGithubToken()) {
      const code = prompt('This device needs a one-time save code.\n\nEnter the save code (ask your admin for it):');
      if (!code) throw new Error('No save code entered.');
      setGithubToken(code.trim());
    }

    setSaving(true);
    try {
      await saveAdvisorNotes(advisorName, date, currentRows, currentAfterCallRows);
    } catch (err) {
      setSaving(false);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Shared notes button renderer
  function NotesBtn({ table, idx, row }) {
    const entries = parseNotesField(row.notes);
    const hasNotes = entries.length > 0;
    const hasOther = entries.some(e => e.author && e.author !== ownAdvisor);
    return (
      <button
        className={`secondary adv-notes-btn${hasNotes ? ' adv-notes-btn--active' : ''}${hasOther ? ' adv-notes-btn--other' : ''}`}
        onClick={() => openNotes(table, idx)}
        title={hasOther ? 'Has notes from other advisors' : hasNotes ? 'View / edit notes' : 'Add notes'}
      >
        Notes{hasNotes ? ` (${entries.length})` : ''}
      </button>
    );
  }

  const openModalRow = notesOpen
    ? (notesOpen.table === 'prep' ? rows[notesOpen.idx] : afterCallRows[notesOpen.idx])
    : null;

  return (
    <div className="adv-page adv-form-page">
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="secondary" disabled={saving} onClick={async () => {
            try { await handleSave(); onBack(); }
            catch (err) { alert('Save failed: ' + err.message); }
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

      {/* Printable form area */}
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
                      <NotesBtn table="prep" idx={idx} row={row} />
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
          <div className="adv-form-header">
            <h2 className="adv-form-title">ADVISOR AFTER CALL REPORT</h2>
            <div className="adv-form-meta">
              <span>Advisor Name: <strong>{advisorName}</strong></span>
              <span>Date: <strong>{displayDate}</strong></span>
            </div>
          </div>

          <table className="adv-table">
            <thead>
              <tr>
                <th>CUSTOMER NAME</th>
                <th>PHONE NUMBER</th>
                <th>REPAIR ORDER #</th>
                <th>SERVICE PERFORMED</th>
                <th>CUSTOMER FEEDBACK</th>
                <th className="no-print adv-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {afterCallRows.map((row, idx) => (
                <tr key={idx} className={parseNotesField(row.notes).length > 0 ? 'adv-row-has-notes' : ''}>
                  <td><input className="adv-cell-input" value={row.customerName}
                    onChange={e => updateAfterCallRow(idx, 'customerName', e.target.value)} placeholder="Customer name" /></td>
                  <td><input className="adv-cell-input" value={row.phoneNumber}
                    onChange={e => updateAfterCallRow(idx, 'phoneNumber', e.target.value)} placeholder="Phone number" /></td>
                  <td><input className="adv-cell-input" value={row.repairOrderNumber}
                    onChange={e => updateAfterCallRow(idx, 'repairOrderNumber', e.target.value)} placeholder="RO #" /></td>
                  <td>
                    <div className="adv-chip-group">
                      {SERVICE_TYPES.map(([key, label]) => (
                        <button key={key}
                          className={`adv-chip${row.servicePerformed[key] ? ' adv-chip--on' : ''}`}
                          onClick={() => updateAfterCallRow(idx, 'servicePerformed', { ...row.servicePerformed, [key]: !row.servicePerformed[key] })}
                        >{label}</button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="adv-chip-group">
                      <button
                        className={`adv-chip${row.customerFeedback.good ? ' adv-chip--good' : ''}`}
                        onClick={() => updateAfterCallRow(idx, 'customerFeedback', { good: !row.customerFeedback.good, poor: false })}
                      >Good</button>
                      <button
                        className={`adv-chip${row.customerFeedback.poor ? ' adv-chip--poor' : ''}`}
                        onClick={() => updateAfterCallRow(idx, 'customerFeedback', { poor: !row.customerFeedback.poor, good: false })}
                      >Poor</button>
                    </div>
                  </td>
                  <td className="no-print adv-action-col">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <NotesBtn table="after" idx={idx} row={row} />
                      <button className="secondary adv-del-btn" onClick={() => removeAfterCallRow(idx)} disabled={afterCallRows.length <= 1}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="no-print" style={{ marginTop: 14 }}>
            <button onClick={addAfterCallRow}>+ Add Row</button>
          </div>
        </div>

      </div>{/* end adv-form-wrap */}

      {/* ── Shared Notes Modal ── */}
      {notesOpen !== null && (
        <div className="adv-notes-overlay no-print">
          <div className="adv-notes-modal" ref={notesRef}>
            <div className="adv-notes-modal-header">
              <span>Notes — {openModalRow?.customerName || `Row ${notesOpen.idx + 1}`}</span>
              <button className="secondary adv-del-btn" onClick={commitNotes}>×</button>
            </div>

            {/* Existing entries */}
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

            {/* New note input */}
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
