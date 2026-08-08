import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadRoStatusReport } from '../utils/github';

// Normalize a status label to an underscore key: "Ready For Invoice" → READY_FOR_INVOICE.
const normStatus = (s) => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

// Age in days: prefer the report's numeric RO Age, else derive from Open Date.
function ageOf(r) {
  if (r.roAge != null && Number.isFinite(r.roAge)) return r.roAge;
  if (r.openDate) { const d = new Date(r.openDate); if (!isNaN(d.getTime())) return Math.floor((Date.now() - d.getTime()) / 86400000); }
  return null;
}

// Apply the manager rules to one RO. sev drives sort order + highlight.
//  5 urgent  — READY_FOR_DISPATCH older than 1 day
//  4 high    — READY_FOR_INVOICE + warranty (red) flag, not invoiced
//  3 high    — flag "Ready for AWN Review" and not INVOICED
//  2 warn    — READY_FOR_DISPATCH (needs to get in the shop)
//  1 info    — READY_FOR_INVOICE, no flag (tech done, needs acceptance)
//  0 none    — INVOICED / anything else (shown, not highlighted)
function evaluate(r) {
  const st = normStatus(r.roStatus);
  const warranty = !!r.warranty;
  const age = ageOf(r);
  const invoiced = st === 'INVOICED';
  // "Ready for AWN Review" may sit in the flag or a status column — check all.
  const flagText = `${r.userFlag || ''} ${r.roStatus || ''} ${r.cpStatus || ''}`.toLowerCase();
  const awnReview = flagText.includes('awn') && flagText.includes('review');

  if (st === 'READY_FOR_DISPATCH') {
    if (age != null && age > 1) return { sev: 5, tag: 'Dispatch overdue', color: '#f87171', pulse: 'attn-high-row', msg: `Car needs to get into the shop — ${age} days old.` };
    return { sev: 2, tag: 'Get car in shop', color: '#fbbf24', msg: 'Car needs to get into the shop.' };
  }
  if (awnReview && !invoiced) {
    return { sev: 3, tag: 'AWN — needs invoicing', color: '#c084fc', pulse: 'coaching-glow', msg: 'Ready for AWN repair needs invoiced.' };
  }
  if (st === 'READY_FOR_INVOICE') {
    if (warranty) return { sev: 4, tag: 'Warranty — not invoiced', color: '#fb923c', pulse: 'tire-missing-alert', msg: 'Check repair order — flagged warranty but not invoiced.' };
    return { sev: 1, tag: 'Needs acceptance', color: '#38bdf8', msg: 'Tech has completed car repair — needs acceptance.' };
  }
  // INVOICED (with or without flag) and everything else → no alert.
  return { sev: 0, tag: r.roStatus ? String(r.roStatus) : '—', color: '#64748b', msg: '' };
}

const CATS = [
  { key: 'all',  label: 'All ROs',            color: '#94a3b8' },
  { key: 5,      label: 'Dispatch overdue',   color: '#f87171' },
  { key: 4,      label: 'Warranty not invoiced', color: '#fb923c' },
  { key: 3,      label: 'AWN needs invoicing', color: '#c084fc' },
  { key: 2,      label: 'Get car in shop',    color: '#fbbf24' },
  { key: 1,      label: 'Needs acceptance',   color: '#38bdf8' },
];

export default function RepairOrderProcess({ onBack, currentRole }) {
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [data, setData] = useState({ updatedAt: null, by: '', rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    setError('');
    try { setData(await loadRoStatusReport()); }
    catch (e) { if (!silent) setError(e?.message || 'Could not load the RO status report.'); }
    finally { if (!silent) setLoading(false); }
  }, []);

  // Load on mount, then auto-refresh so a new RO upload appears without a manual
  // refresh — poll periodically and whenever the tab regains focus.
  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60000);
    const onWake = () => { if (!document.hidden) load(true); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(id); window.removeEventListener('focus', onWake); document.removeEventListener('visibilitychange', onWake); };
  }, [load]);

  // Evaluate + sort: most urgent first, then oldest.
  const evaluated = useMemo(() => {
    return (data.rows || []).map(r => ({ r, e: evaluate(r), age: ageOf(r) }))
      .sort((a, b) => (b.e.sev - a.e.sev) || ((b.age ?? -1) - (a.age ?? -1)));
  }, [data]);

  const counts = useMemo(() => {
    const c = { all: evaluated.length, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    evaluated.forEach(({ e }) => { if (c[e.sev] != null) c[e.sev] += 1; });
    return c;
  }, [evaluated]);

  const visible = useMemo(() => {
    if (filter === 'all') return evaluated;
    return evaluated.filter(({ e }) => String(e.sev) === String(filter));
  }, [evaluated, filter]);

  const cardSt = { background: 'rgba(15,23,42,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, padding: 18, marginBottom: 20 };
  const thSt = { textAlign: 'left', padding: '9px 12px', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.2)', whiteSpace: 'nowrap' };
  const tdSt = { padding: '9px 12px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,.07)', verticalAlign: 'middle' };

  if (!isManager) {
    return (
      <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="adv-title">🧰 Repair Order Process</div>
          <div style={{ flex: 1 }} />
          <button className="secondary" onClick={onBack}>← Back</button>
        </div>
        <div style={{ padding: 40, color: '#fca5a5' }}>This page is available to managers only.</div>
      </div>
    );
  }

  const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🧰 Repair Order Process</div>
          <div className="adv-sub">Live RO status · auto-updates on each RO upload · managers only{updated ? ` · updated ${updated}${data.by ? ` by ${data.by}` : ''}` : ''}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={() => load()} disabled={loading} style={{ marginRight: 10 }}>{loading ? '⏳' : '↻ Refresh'}</button>
        <button className="secondary" onClick={onBack}>← Advisor Calendar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px 48px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          {error && <div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 14, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px' }}>{error}</div>}

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            {CATS.map(c => {
              const n = c.key === 'all' ? counts.all : counts[c.key];
              const active = String(filter) === String(c.key);
              return (
                <div key={c.key} onClick={() => setFilter(c.key)}
                  style={{ cursor: 'pointer', background: active ? `${c.color}22` : 'rgba(15,23,42,.55)', border: `1px solid ${c.color}${active ? 'aa' : '44'}`, borderRadius: 12, padding: '10px 16px', minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: c.color }}>{n ?? 0}</div>
                </div>
              );
            })}
          </div>

          {loading ? (
            <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Loading repair orders…</div>
          ) : evaluated.length === 0 ? (
            <div style={{ ...cardSt, textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: 42, marginBottom: 12 }}>🗂️</div>
              <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 17, marginBottom: 6 }}>No RO status report yet</div>
              <div style={{ color: '#64748b', fontSize: 13.5, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
                Upload an open-RO report from <strong style={{ color: '#6ee7b7' }}>RO Upload</strong> with an <strong style={{ color: '#93c5fd' }}>RO Status</strong> column mapped. This page refreshes automatically each time you do.
              </div>
            </div>
          ) : (
            <div style={{ ...cardSt, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ position: 'sticky', top: 0, background: '#0f172a', zIndex: 1 }}>
                  <th style={thSt}>RO #</th><th style={thSt}>Advisor</th><th style={thSt}>Technician</th>
                  <th style={thSt}>RO Status</th><th style={thSt}>CP Status</th><th style={thSt}>Warranty</th>
                  <th style={thSt}>Age</th><th style={{ ...thSt, minWidth: 260 }}>What to do</th>
                </tr></thead>
                <tbody>
                  {visible.map(({ r, e, age }, i) => (
                    <tr key={r.ro + i} className={e.pulse || undefined}
                      style={{ background: e.sev >= 1 ? `${e.color}14` : 'transparent' }}>
                      <td style={{ ...tdSt, fontFamily: 'monospace', color: '#6ee7f9', fontWeight: 700 }}>{r.ro}</td>
                      <td style={tdSt}>{r.advisor || '—'}</td>
                      <td style={tdSt}>{r.tech || '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: e.color }}>{r.roStatus || '—'}</td>
                      <td style={tdSt}>{r.cpStatus || '—'}</td>
                      <td style={{ ...tdSt, textAlign: 'center' }}>{r.warranty ? <span title="Warranty (red flag)" style={{ color: '#f87171', fontWeight: 800 }}>🚩</span> : <span style={{ color: '#475569' }}>—</span>}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: age != null && age > 1 ? '#f87171' : '#cbd5e1' }}>{age != null ? `${age}d` : '—'}</td>
                      <td style={tdSt}>
                        {e.msg
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ background: `${e.color}22`, border: `1px solid ${e.color}88`, color: e.color, borderRadius: 999, padding: '3px 10px', fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap' }}>{e.sev >= 3 ? '⚠️ ' : ''}{e.tag}</span>
                              <span style={{ color: '#e2e8f0' }}>{e.msg}</span>
                            </span>
                          : <span style={{ color: '#475569' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && <tr><td style={{ ...tdSt, color: '#64748b' }} colSpan={8}>No repair orders in this category.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
