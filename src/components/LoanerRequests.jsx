import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';

// ── Loaner Request (Service Loaner page tab) ─────────────────────────────────
// A month calendar (same look as the Advisor Calendar) shows every loaner
// request on its day. Click a day to request a loaner for it: customer
// first/last name, the VIN of the customer's own car, the advisor asking, and
// the time. The full list sits under the calendar — upcoming first, past ones
// folded away. Stored in data/service-loaner/requests.json. The person who made
// a request (or a manager) can cancel it.

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
  const [view, setView] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [formOpen, setFormOpen] = useState(false);

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
      setFormOpen(false);
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

  // ── Calendar (Mon–Sat, like the Advisor Calendar — the shop is closed Sundays) ──
  const today = todayIso();
  const byDate = useMemo(() => {
    const m = {};
    for (const r of requests) (m[r.date] ||= []).push(r);
    for (const k in m) m[k].sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return m;
  }, [requests]);
  const { y, m } = view;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < (firstDay === 0 ? 0 : firstDay - 1); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) if (new Date(y, m, d).getDay() !== 0) cells.push(d);
  const shift = (n) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function openDay(dateStr) {
    if (dateStr < today) return;
    setStatus('');
    setDraft(d => ({ ...d, date: dateStr }));
    setFormOpen(true);
  }
  const dayList = formOpen && draft.date ? (byDate[draft.date] || []) : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="apt-prep-bg loaner-cal" style={{ background: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px 0', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#dbe8ff' }}>🙋 Click a day to request a loaner</div>
          <div className="adv-cal-nav">
            <button className="secondary adv-nav-btn" onClick={() => shift(-1)}>‹</button>
            <span className="adv-cal-month">{MONTHS[m]} {y}</span>
            <button className="secondary adv-nav-btn" onClick={() => shift(1)}>›</button>
          </div>
          <button className="secondary" style={{ visibility: y === new Date().getFullYear() && m === new Date().getMonth() ? 'hidden' : 'visible' }}
            onClick={() => { const d = new Date(); setView({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</button>
        </div>
        <div className="adv-cal-wrap" style={{ overflow: 'visible' }}>
          <div className="adv-cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="adv-cal-dayname">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="adv-cal-day adv-cal-empty" />;
              const ds = iso(d);
              const isToday = ds === today;
              const isPast = ds < today;
              const list = byDate[ds] || [];
              const cls = 'adv-cal-day' + (isPast && !isToday ? ' adv-cal-day--past' : '') + (isToday ? ' adv-today' : '');
              return (
                <div key={ds} className={cls} onClick={() => openDay(ds)}
                  title={isPast ? (list.length ? `${list.length} loaner request${list.length === 1 ? '' : 's'}` : '') : 'Click to request a loaner for this day'}
                  style={isPast ? { cursor: 'default' } : undefined}>
                  <span className="adv-day-num">{d}</span>
                  {isToday && <span className="adv-today-chip">TODAY</span>}
                  {list.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2, alignItems: 'stretch', width: '100%' }}>
                      {list.slice(0, 4).map(r => (
                        <span key={r.id} title={`${fmtTime(r.time)} — ${r.firstName} ${r.lastName} (${r.advisor})${r.notes ? ` · ${r.notes}` : ''}`}
                          style={{ fontSize: 10.5, fontWeight: 800, color: '#bfdbfe', background: 'rgba(59,130,246,.28)', border: '1px solid rgba(147,197,253,.55)',
                            borderRadius: 5, padding: '2px 6px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          🚙 {fmtTime(r.time)} {r.lastName} · {r.advisor}
                        </span>
                      ))}
                      {list.length > 4 && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#dbe8ff' }}>+{list.length - 4} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {status && !formOpen && <div style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</div>}

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', marginBottom: 10 }}>📋 Loaner requests ({upcoming.length} upcoming)</div>
        {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
          : upcoming.length === 0 ? <div style={{ color: '#94a3b8' }}>No upcoming loaner requests — click a day on the calendar to add one.</div>
          : table(upcoming, false)}
        {past.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button style={btn('148,163,184', showPast)} onClick={() => setShowPast(v => !v)}>{showPast ? '▾' : '▸'} Past requests ({past.length})</button>
            {showPast && <div style={{ marginTop: 10 }}>{table(past, true)}</div>}
          </div>
        )}
      </div>

      {formOpen && (
        <div onClick={() => !busy && setFormOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, background: '#0f172a', width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 18, fontWeight: 900, color: '#f1f5f9' }}>🙋 Request a loaner — {fmtDate(draft.date)}</div>
              <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setFormOpen(false)}>✕</button>
            </div>
            {dayList.length > 0 && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(59,130,246,.1)', border: '1px solid rgba(147,197,253,.3)', fontSize: 12.5, color: '#bfdbfe', lineHeight: 1.6 }}>
                <b>Already requested this day:</b>
                {dayList.map(r => <div key={r.id}>🚙 {fmtTime(r.time)} — {r.firstName} {r.lastName} ({r.advisor})</div>)}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Customer first name</span><input autoFocus value={draft.firstName} onChange={set('firstName')} disabled={busy} style={inputStyle} /></label>
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
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Date loaner needed</span><input type="date" min={today} value={draft.date} onChange={set('date')} disabled={busy} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4 }}><span style={label}>Time</span><input type="time" value={draft.time} onChange={set('time')} disabled={busy} style={inputStyle} /></label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><span style={label}>Notes (optional)</span><input value={draft.notes} onChange={set('notes')} disabled={busy} placeholder="How many days, special needs…" style={{ ...inputStyle, fontWeight: 600 }} /></label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <button disabled={busy || missing.length > 0} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={submit}>
                {busy ? 'Saving…' : '✓ Request loaner'}
              </button>
              <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setFormOpen(false)}>Cancel</button>
              {missing.length > 0 && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Still need: {missing.join(', ')}</span>}
              {status.startsWith('❌') && <span style={{ fontSize: 13.5, fontWeight: 800, color: '#fca5a5' }}>{status}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
