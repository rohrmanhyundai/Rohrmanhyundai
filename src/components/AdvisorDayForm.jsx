import React, { useState, useEffect } from 'react';
import { saveAdvisorNotes, loadAdvisorNotes } from '../utils/github';

const EMPTY_ROW = () => ({ customerName: '', appointmentTime: '', criticalDeferredService: '', waiter: false, technician: '' });

export default function AdvisorDayForm({ advisorName, date, onBack }) {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    loadAdvisorNotes(advisorName, date).then(data => {
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        setRows(data.rows);
      }
    });
  }, [advisorName, date]);

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function addRow() {
    setRows(prev => [...prev, EMPTY_ROW()]);
  }

  function removeRow(idx) {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus('');
    try {
      await saveAdvisorNotes(advisorName, date, rows);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  const [y, m, d] = date.split('-');
  const displayDate = new Date(+y, +m - 1, +d).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="adv-page adv-form-page">
      {/* Top bar — hidden when printing */}
      <div className="adv-topbar no-print">
        <button className="secondary" onClick={onBack}>← Back to Calendar</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={() => window.print()}>Print</button>
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : 'Save to GitHub'}
          </button>
        </div>
      </div>

      {/* Printable form area */}
      <div className="adv-form-wrap">
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
              <th>WAITER</th>
              <th>TECHNICIAN</th>
              <th className="no-print adv-del-col"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    className="adv-cell-input"
                    value={row.customerName}
                    onChange={e => updateRow(idx, 'customerName', e.target.value)}
                    placeholder="Customer name"
                  />
                </td>
                <td>
                  <input
                    className="adv-cell-input"
                    value={row.appointmentTime}
                    onChange={e => updateRow(idx, 'appointmentTime', e.target.value)}
                    placeholder="e.g. 9:00 AM"
                  />
                </td>
                <td>
                  <input
                    className="adv-cell-input"
                    value={row.criticalDeferredService}
                    onChange={e => updateRow(idx, 'criticalDeferredService', e.target.value)}
                    placeholder="Deferred service notes"
                  />
                </td>
                <td className="adv-waiter-cell">
                  <input
                    type="checkbox"
                    className="adv-checkbox"
                    checked={row.waiter}
                    onChange={e => updateRow(idx, 'waiter', e.target.checked)}
                  />
                </td>
                <td>
                  <input
                    className="adv-cell-input"
                    value={row.technician}
                    onChange={e => updateRow(idx, 'technician', e.target.value)}
                    placeholder="Tech name"
                  />
                </td>
                <td className="no-print adv-del-col">
                  <button
                    className="secondary adv-del-btn"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length <= 1}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="no-print" style={{ marginTop: 14 }}>
          <button onClick={addRow}>+ Add Row</button>
        </div>
      </div>
    </div>
  );
}
