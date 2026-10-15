import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';

// ── Loaner Request (Service Loaner page tab) ─────────────────────────────────
// Any user asks for a loaner: customer first/last name, the VIN of the
// customer's own car, the advisor asking, and the date/time the loaner is
// needed. Requests are kept in data/service-loaner/requests.json and listed
// below the form — upcoming first, past ones greyed underneath. The person who
// made a request (or a manager) can cancel it.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const th = { textAlign: 'left', padding: '9px 10px', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid rgba(148,163,184,.25)', whiteSpace: 'nowrap' };
// App.css clips every td (fixed layout + ellipsis); this table sizes to content.
const td = { padding: '9px 10px', fontSize: 14, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.1)', verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' };
const label = { fontSize: 12, fontWeight: 800, color: '#94a3b8' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY = () => ({ firstName: '', lastName: '', vin: '', advisor: '', date: '', time: '', notes: '' });
const fmtDate = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${dt.toLocaleDateString('en-US', { weekday: 'short' })} ${Number(m[2])}/${Number(m[3])}/${m[1]}`;
};
const fmtTime = (t) => {
  const m = String(t || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const nameCase = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-/'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
};

export default function LoanerRequests({ currentUser, isManager, advisors = [], io }) {
  const { loadLoanerRequests, updateLoanerRequests } = io || github;
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(() => ({ ...EMPTY(), advisor: advisors.includes(currentUser) ? currentUser : '' }));
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLoanerRequests().then(d => { if (alive) { setRequests(d.requests || []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: k === 'vin' ? e.target.value.toUpperCase() : e.target.value }));
  const vin = draft.vin.replace(/\s+/g, '');
  const missing = [
    !draft.firstName.trim() && 'first name', !draft.lastName.trim() && 'last name', !vin && 'VIN',
    !draft.advisor && 'advisor', !draft.date && 'date', !draft.time && 'time',
  ].filter(Boolean);

  async function submit() {
    if (missing.length || busy) return;
    const rec = {
      id: `lr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      firstName: nameCase(draft.firstName), lastName: nameCase(draft.lastName), vin,
      advisor: draft.advisor, date: draft.date, time: draft.time, notes: draft.notes.trim(),
      requestedAt: new Date().toISOString(), requestedBy: currentUser,
    };
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateLoanerRequests(cur => ({ ...cur, requests: [...cur.requests, rec] }), `${rec.firstName} ${rec.lastName} ${rec.date}`);
      setRequests(next.requests);
      setDraft(d => ({ ...EMPTY(), advisor: d.advisor }));
      setStatus(`✓ Loaner requested for ${rec.firstName} ${rec.lastName} — ${fmtDate(rec.date)} ${fmtTime(rec.time)}.`);
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
    }
    setBusy(false);
  }

  async function cancel(r) {
    if (!window.confirm(`Cancel the loaner request for ${r.firstName} ${r.lastName} on ${fmtDate(r.date)} ${fmtTime(r.time)}?`)) return;
    setBusy(true); setStatus('');
    try {
      const next = await updateLoanerRequests(cur => ({ ...cur, requests: cur.requests.filter(x => x.id !== r.id) }), `cancel ${r.firstName} ${r.lastName}`);
      setRequests(next.requests);
      setStatus('✓ Request cancelled.');
    } catch (e) {
      setStatus(`❌ ${e.message || 'Cancel failed.'}`);
    }
    setBusy(false);
  }

  const { upcoming, past } = useMemo(() => {
    const key = r => `${r.date || ''} ${r.time || ''}`;
    const sorted = [...requests].sort((a, b) => key(a).localeCompare(key(b)));
    const today = todayIso();
    return { upcoming: sorted.filter(r => (r.date || '') >= today), past: sorted.filter(r => (r.date || '') < today).reverse() };
  }, [requests]);

  const row = (r, old) => (
    <tr key={r.id} style={old ? { opacity: 0.55 } : undefined}>
      <td style={{ ...td, fontWeight: 900, color: old ? '#94a3b8' : '#fde68a' }}>{fmtDate(r.date)}<span style={{ color: '#e2e8f0', marginLeft: 8 }}>{fmtTime(r.time)}</span></td>
      <td style={{ ...td, fontWeight: 800 }}>
        {r.firstName} {r.lastName}
        {r.notes && <div title={r.notes} style={{ fontSize: 12, fontWeight: 600, color: '#fde68a', marginTop: 3, maxWidth: 320, whiteSpace: 'normal' }}>📝 {r.notes}</div>}
      </td>
      <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}>{r.vin}</td>
      <td style={{ ...td, fontWeight: 800, color: '#93c5fd' }}>{r.advisor}</td>
      <td style={{ ...td, fontSize: 12.5, color: '#94a3b8' }}>{r.requestedBy}<br />{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : ''}</td>
      <td style={{ ...td, textAlign: 'right' }}>
        {(isManager || r.requestedBy === currentUser) && (
          <button disabled={busy} style={btn('248,113,113')} onClick={() => cancel(r)}>✕ Cancel</button>
        )}
      </td>
    </tr>
  );
  const table = (rows, old) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead><tr>
          <th style={th}>Loaner needed</th><th style={th}>Customer</th><th style={th}>Customer VIN</th>
          <th style={th}>Advisor</th><th style={th}>Requested by</th><th style={th}></th>
        </tr></thead>
        <tbody>{rows.map(r => row(r, old))}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, maxWidth: 820 }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>🙋 Request a loaner</div>
        <div style={{ fontSize: 13.5, color: '#94a3b8', margin: '4px 0 14px' }}>Customer, their car's VIN, the advisor asking, and when the loaner is needed.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Customer first name</span><input value={draft.firstName} onChange={set('firstName')} disabled={busy} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Customer last name</span><input value={draft.lastName} onChange={set('lastName')} disabled={busy} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span style={label}>VIN on the customer's car{vin && vin.length !== 17 && <span style={{ color: '#fde68a', marginLeft: 8 }}>{vin.length} characters — should be 17</span>}</span>
            <input value={draft.vin} onChange={set('vin')} disabled={busy} maxLength={20} style={{ ...inputStyle, letterSpacing: '.06em' }} />
          </label>
        </div>
        <div style={{ ...label, margin: '14px 0 6px' }}>Advisor requesting the loaner</div>
        {advisors.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>No advisors found.</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {advisors.map(a => (
              <button key={a} type="button" disabled={busy} onClick={() => setDraft(d => ({ ...d, advisor: a }))}
                style={{ ...btn('96,165,250', draft.advisor === a), fontSize: 13.5, padding: '8px 14px', ...(draft.advisor === a ? { boxShadow: '0 0 0 2px rgba(96,165,250,.6)' } : null) }}>
                {draft.advisor === a ? '✓ ' : ''}{a}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Date loaner needed</span><input type="date" min={todayIso()} value={draft.date} onChange={set('date')} disabled={busy} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4 }}><span style={label}>Time</span><input type="time" value={draft.time} onChange={set('time')} disabled={busy} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><span style={label}>Notes (optional)</span><input value={draft.notes} onChange={set('notes')} disabled={busy} placeholder="How many days, special needs…" style={{ ...inputStyle, fontWeight: 600 }} /></label>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={busy || missing.length > 0} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={submit}>
            {busy ? 'Saving…' : '✓ Request loaner'}
          </button>
          {missing.length > 0 && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Still need: {missing.join(', ')}</span>}
          {status && <span style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', marginBottom: 10 }}>📋 Loaner requests ({upcoming.length} upcoming)</div>
        {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
          : upcoming.length === 0 ? <div style={{ color: '#94a3b8' }}>No upcoming loaner requests.</div>
          : table(upcoming, false)}
        {past.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button style={btn('148,163,184', showPast)} onClick={() => setShowPast(v => !v)}>{showPast ? '▾' : '▸'} Past requests ({past.length})</button>
            {showPast && <div style={{ marginTop: 10 }}>{table(past, true)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
