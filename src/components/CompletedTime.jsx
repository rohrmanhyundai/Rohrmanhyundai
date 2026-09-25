import React, { useState } from 'react';
import { printCompletionSign, formatSignTime, formatSignDate } from '../utils/completionSign';

// Pick a date + time and print the "Estimated Completion Time" sign that goes
// on the car for the tech. Starts on right now; Done prints straight away.
const pad = n => String(n).padStart(2, '0');
function nowParts() {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function CompletedTime({ onClose }) {
  const [{ date, time }, setVals] = useState(nowParts);
  const ok = !!date && !!time;

  function done() {
    if (!ok) return;
    if (printCompletionSign({ date, time })) onClose();
  }

  // Customer Waiting ignores the fields: ASAP, stamped with right now.
  function waiting() {
    if (printCompletionSign({ ...nowParts(), waiting: true })) onClose();
  }

  const field = {
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, color: '#e2e8f0',
    padding: '12px 14px', fontSize: 18, fontWeight: 700, colorScheme: 'dark',
  };
  const label = { display: 'block', fontSize: 12, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 380, background: '#111827', border: '1px solid rgba(251,146,60,0.5)', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ fontSize: 19, fontWeight: 900, color: '#fb923c', marginBottom: 4 }}>⏰ Completed Time</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18 }}>Prints the estimated completion sign for the car.</div>

        <label style={label}>Date</label>
        <input type="date" value={date} onChange={e => setVals(v => ({ ...v, date: e.target.value }))} style={{ ...field, marginBottom: 14 }} />

        <label style={label}>Time</label>
        <input type="time" value={time} onChange={e => setVals(v => ({ ...v, time: e.target.value }))} style={{ ...field, marginBottom: 14 }} />

        {ok && (
          <div style={{ textAlign: 'center', background: '#000', border: '2px solid #f36f14', borderRadius: 10, padding: '10px 8px', marginBottom: 16 }}>
            <div style={{ color: '#ffe500', fontSize: 30, fontWeight: 900, lineHeight: 1.1 }}>{formatSignTime(time).label}</div>
            <div style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 0.5, marginTop: 2 }}>{formatSignDate(date)}</div>
          </div>
        )}

        <button type="button" onClick={waiting}
          style={{ width: '100%', marginBottom: 10, background: 'linear-gradient(135deg,#facc15,#eab308)', color: '#1a1205', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
          🚨 Customer Waiting — Print ASAP
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="secondary" onClick={onClose} style={{ flex: '0 0 auto' }}>Cancel</button>
          <button type="button" onClick={done} disabled={!ok}
            style={{ flex: 1, background: ok ? 'linear-gradient(135deg,#fb923c,#f36f14)' : 'rgba(255,255,255,0.08)', color: ok ? '#1a0a00' : '#64748b', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 16, fontWeight: 900, cursor: ok ? 'pointer' : 'not-allowed' }}>
            ✓ Done — Print
          </button>
        </div>
      </div>
    </div>
  );
}
