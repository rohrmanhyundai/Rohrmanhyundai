import React, { useEffect, useMemo, useState } from 'react';
import { loadAppointmentList, loadAdvisorNotes } from '../utils/github';
import { apptTags, ownerOf, shortMD } from '../utils/appointmentList';
import { openDeferredCarePlan } from '../utils/deferredCarePlan';
import { STATUSES, Tag, CopyRo, CustomerComment, DeferredBox, BigMoneyBanner, isLof50, apptClock, ClockChip } from './AdvisorDayForm';

// ── Shop Appointments ─────────────────────────────────────────────────────────
// The Appointment Prep sheet, read-only, for every advisor at once — so techs
// and parts can see what's coming through the door: who's booked when, which
// advisor has them, campaigns and special-order parts to have ready, the
// customer's own words, and the declined work on each car. Pulls the day's DMS
// list plus each advisor's prep sheet (for the status and their notes).
// Who can open it: anyone with Technician Resources or the Parts Hub — the tile lives in both.

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDay = (iso, by) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  do { dt.setDate(dt.getDate() + by); } while (dt.getDay() === 0);   // the shop is closed Sundays
  return isoOf(dt);
};
const startDay = () => { const d = new Date(); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return isoOf(d); };
const statusMeta = (k) => STATUSES.find(s => s.key === k) || STATUSES[0];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sop', label: '📦 Parts in SOP' },
  { key: 'campaign', label: '⚠ Campaigns' },
  { key: 'diag', label: '🔍 Diagnosis' },
  { key: 'waiter', label: '⏱ Waiters' },
  { key: 'deferred', label: '🔧 Declined work' },
];

export default function ShopAppointments({ onBack, backLabel = '← Back' }) {
  const [date, setDate] = useState(startDay);
  const [list, setList] = useState(null);
  const [notesByAppt, setNotesByAppt] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [advisor, setAdvisor] = useState('ALL');
  const [q, setQ] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setClockNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setNotesByAppt({});
    loadAppointmentList(date).then(async l => {
      if (!alive) return;
      setList(l);
      // Each advisor's prep sheet for the day → status, their plan and notes.
      const owners = [...new Set((l.appts || []).map(a => ownerOf(a, l.claims)).filter(Boolean))];
      const sheets = await Promise.all(owners.map(o => loadAdvisorNotes(o, date).catch(() => null)));
      const byAppt = {};
      for (const sh of sheets) for (const r of (sh && sh.rows) || []) if (r.apptNo) byAppt[r.apptNo] = r;
      if (alive) setNotesByAppt(byAppt);
    }).catch(() => { if (alive) setList(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date]);

  const rows = useMemo(() => (list && list.appts ? list.appts : []).map(a => ({
    a, owner: ownerOf(a, list.claims) || 'OPEN', tags: apptTags(a), prep: notesByAppt[a.apptNo] || null,
  })), [list, notesByAppt]);
  const advisors = [...new Set(rows.map(r => r.owner))].sort();
  const count = (fn) => rows.filter(fn).length;
  const has = (r, k) => r.tags.some(t => t.key === k);
  const shown = rows.filter(r => {
    if (advisor !== 'ALL' && r.owner !== advisor) return false;
    if (filter === 'waiter' && r.a.transport !== 'WAIT') return false;
    if (filter === 'deferred' && !r.a.deferred) return false;
    if (['sop', 'campaign', 'diag'].includes(filter) && !has(r, filter)) return false;
    if (q.trim()) {
      const hay = [r.a.customer, r.a.vehicle, (r.a.services || []).join(' '), r.owner, r.a.apptNo, r.a.deferred && r.a.deferred.ro].join(' ').toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const [y, m, d] = date.split('-').map(Number);
  const pretty = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const chip = (on) => ({
    borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${on ? 'rgba(110,231,249,.65)' : 'rgba(148,163,184,.25)'}`,
    background: on ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', color: on ? '#67e8f9' : '#cbd5e1',
  });

  return (
    <div className="adv-page adv-form-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📅 Shop Appointments</div>
          <div className="adv-sub">Every advisor's book · view only</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="secondary adv-nav-btn" onClick={() => setDate(dd => shiftDay(dd, -1))}>‹</button>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#e0f2fe', minWidth: 230, textAlign: 'center' }}>{pretty}</div>
          <button className="secondary adv-nav-btn" onClick={() => setDate(dd => shiftDay(dd, 1))}>›</button>
          {date !== startDay() && <button className="secondary" onClick={() => setDate(startDay())}>Today</button>}
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div className="adv-form-wrap">
        {loading ? (
          <div style={{ color: '#94a3b8', padding: 30, textAlign: 'center' }}>Loading…</div>
        ) : !rows.length ? (
          <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center', fontSize: 14.5 }}>
            No DMS appointment list uploaded for {shortMD(date)} yet.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              {FILTERS.map(f => {
                const n = f.key === 'all' ? rows.length : f.key === 'waiter' ? count(r => r.a.transport === 'WAIT')
                  : f.key === 'deferred' ? count(r => r.a.deferred) : count(r => has(r, f.key));
                if (f.key !== 'all' && !n) return null;
                return <button key={f.key} style={chip(filter === f.key)} onClick={() => setFilter(f.key)}>{f.label} · {n}</button>;
              })}
              <div style={{ flex: 1 }} />
              <select value={advisor} onChange={e => setAdvisor(e.target.value)}
                style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,.35)', color: '#e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontWeight: 700 }}>
                <option value="ALL">All advisors</option>
                {advisors.map(a => <option key={a} value={a}>{a === 'OPEN' ? 'Unassigned (open pool)' : a}</option>)}
              </select>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Customer, vehicle, RO…"
                style={{ background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '7px 11px', color: '#e2e8f0', fontSize: 13, minWidth: 220 }} />
            </div>

            <table className="adv-table adv-prep-table" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 92 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: 90 }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '27%' }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ padding: '10px 8px' }}>STATUS</th><th style={{ padding: '10px 8px' }}>TIME</th><th>CUSTOMER</th>
                  <th style={{ padding: '10px 8px' }}>ADVISOR</th><th>VEHICLE / SERVICES</th><th>DECLINED WORK</th><th>ADVISOR NOTES</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ a, owner, tags, prep }) => {
                  const st = statusMeta(prep && prep.status);
                  const clock = prep && prep.status === 'done' ? null : apptClock(date, a.time, clockNow);
                  const notes = (prep && Array.isArray(prep.notes)) ? prep.notes.filter(n => n && (n.text || n.body)) : [];
                  return (
                    <tr key={a.apptNo} className={[isLof50(a) && a.deferred ? 'bml-hot-row' : '', clock ? `appt-clock-${clock.phase}` : ''].filter(Boolean).join(' ')} style={prep && prep.status === 'done' ? { opacity: .55 } : undefined}>
                      <td>
                        <span style={{ display: 'inline-block', width: '100%', textAlign: 'center', background: st.bg, border: `1px solid ${st.line}`, color: st.fg, borderRadius: 999, padding: '4px 4px', fontSize: 11, fontWeight: 800 }}>{st.label}</span>
                      </td>
                      <td style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                        {a.time}
                        {a.transport === 'WAIT' && <div style={{ marginTop: 4, width: 'fit-content', fontSize: 9.5, fontWeight: 900, color: '#fdba74', border: '1px solid rgba(249,115,22,.6)', borderRadius: 999, padding: '0 6px' }}>WAITER</div>}
                        <ClockChip clock={clock} />
                      </td>
                      <td>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{a.customer}</div>
                        <div style={{ fontSize: 11, color: '#7a92b8' }}>Appt #{a.apptNo}</div>
                        <CustomerComment text={a.comments} />
                      </td>
                      <td style={{ fontSize: 13, fontWeight: 900, color: owner === 'OPEN' ? '#fbbf24' : '#6ee7f9' }}>{owner === 'OPEN' ? 'Open pool' : owner}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0' }}>{a.vehicle}</div>
                        {isLof50(a) && <BigMoneyBanner deferred={a.deferred} compact />}
                        {a.deferred && <div><CopyRo ro={a.deferred.ro} /></div>}
                        {(a.services || []).map((s, i) => <div key={i} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.35 }}>{s}</div>)}
                        <div>{tags.filter(t => t.key !== 'lof50' && t.key !== 'comment').map(t => <Tag key={t.key} t={t} />)}</div>
                      </td>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        {a.deferred ? <DeferredBox d={a.deferred} compact
                          onPrint={() => openDeferredCarePlan({ customer: a.customer, vehicle: a.vehicle, advisor: owner === 'OPEN' ? '' : owner, deferred: a.deferred })} /> : <span style={{ fontSize: 12, color: '#64748b' }}>None on file</span>}
                        {prep && prep.criticalDeferredService ? (
                          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}><b style={{ color: '#fdba74' }}>Advisor's plan:</b> {prep.criticalDeferredService}</div>
                        ) : null}
                      </td>
                      <td style={{ overflowWrap: 'anywhere' }}>
                        {notes.length ? notes.map((n, i) => (
                          <div key={i} style={{ background: 'rgba(56,189,248,.08)', border: '1px solid rgba(56,189,248,.3)', borderRadius: 9, padding: '5px 9px', marginBottom: 5 }}>
                            {n.author && <div style={{ fontSize: 10.5, fontWeight: 800, color: '#7dd3fc' }}>{n.author}</div>}
                            <div style={{ fontSize: 12.5, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{n.text || n.body}</div>
                          </div>
                        )) : <span style={{ fontSize: 12, color: '#64748b' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shown.length && <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Nothing matches that filter.</div>}
          </>
        )}
      </div>
    </div>
  );
}
