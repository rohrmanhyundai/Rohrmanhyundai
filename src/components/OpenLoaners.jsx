import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadServiceLoaners, loadLoanerMaintenance } from '../utils/github';
import { canonicalAdvisorFirst, firstNameUpper } from '../utils/advisorAliases';

/* Open Loaners — the right-hand column of the Appointment Prep Calendar
 * (took the Open RO Attention panel's spot).
 *
 * Top: any open loaner maintenance requests (urgent first) so the advisor
 * knows which loaners are down before promising one. Below: every loaner
 * contract still out (no completed/returned copy yet), longest out first, with
 * the advisor, date out and how many days it's been out. "Mine" narrows the
 * list to the advisor whose calendar is being viewed. Read-only — clicking a
 * card opens the Service Loaner page on the matching tab.
 */

const PANEL_BG = 'linear-gradient(180deg,#17181a 0%,#25272a 52%,#3a3d42 100%)';

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};
const fmtDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${Number(m[2])}/${Number(m[3])}`;
};
const fmtTime = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const vehicle = (r) => [r.year, r.make, r.model].filter(Boolean).join(' ');
// Days-out colour: fresh → green, a few days → amber, a week+ → red.
// Maintenance order + look: urgent (down), on lot & ready, routine.
const RANK = { urgent: 0, ready: 1 };
const MAINT_LOOK = {
  urgent: { tag: '🚫 DOWN', fg: '#450a0a', bg: '#fca5a5', card: 'rgba(248,113,113,.1)', edge: 'rgba(248,113,113,.45)', text: '#fecaca' },
  ready: { tag: '🅿️ ON LOT', fg: '#082f49', bg: '#7dd3fc', card: 'rgba(56,189,248,.08)', edge: 'rgba(56,189,248,.4)', text: '#bae6fd' },
  routine: { tag: 'ROUTINE', fg: '#422006', bg: '#fde68a', card: 'rgba(251,191,36,.07)', edge: 'rgba(251,191,36,.35)', text: '#fde68a' },
};
const ageColor = (n) => n >= 7 ? '#f87171' : n >= 3 ? '#fbbf24' : '#4ade80';

export default function OpenLoaners({ viewingAdvisor, refreshKey = 0, onOpenLoaner }) {
  const advFirst = firstNameUpper(viewingAdvisor);
  const [contracts, setContracts] = useState([]);
  const [maint, setMaint] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');   // all | mine
  const [loadedAt, setLoadedAt] = useState(0);
  const lastLoad = useRef(0);

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    setErr('');
    try {
      const [c, m] = await Promise.all([loadServiceLoaners(), loadLoanerMaintenance()]);
      setContracts((c && c.contracts) || []);
      setMaint((m && m.requests) || []);
      lastLoad.current = Date.now();
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load, refreshKey]);
  // Same freshness rule as the rest of the calendar (shared token is rate-limit
  // sensitive): re-read on window focus, at most every 30s — no polling.
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastLoad.current > 30000) load(true); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = dayNum(isoDay(new Date()));
  const out = useMemo(() => contracts
    .filter(c => !c.completedUrl)
    .map(c => {
      const outDay = dayNum(c.dateOut);
      const dueDay = dayNum(c.dueDate);
      return {
        c,
        adv: canonicalAdvisorFirst(c.advisor),
        days: outDay == null ? null : Math.max(0, today - outDay),
        overdue: dueDay != null && dueDay < today ? today - dueDay : 0,
      };
    })
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1)), [contracts, today]);
  const mine = out.filter(x => x.adv === advFirst);
  const shown = filter === 'mine' ? mine : out;

  const openMaint = useMemo(() => maint
    .filter(r => r.status !== 'done')
    .sort((a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || String(a.requestedAt).localeCompare(String(b.requestedAt))), [maint]);
  const urgentCount = openMaint.filter(r => r.priority === 'urgent').length;

  const chip = (on, color = '#7dd3fc') => ({
    background: on ? `${color}2b` : 'rgba(255,255,255,.05)', border: `1px solid ${on ? color + '80' : 'rgba(255,255,255,.12)'}`,
    color: on ? color : '#94a3b8', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  });
  const clickable = onOpenLoaner ? { cursor: 'pointer' } : null;
  const sectionTitle = { fontSize: 10.5, fontWeight: 900, letterSpacing: '.07em', textTransform: 'uppercase', margin: '2px 2px 0' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: PANEL_BG, border: '1px solid rgba(255,255,255,.08)', borderRadius: 18, overflow: 'hidden', height: '100%', color: '#e2e8f0', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🚙</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.15 }}>Open Loaners</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>
            {out.length} out{openMaint.length ? ` · ${openMaint.length} need service` : ''}
            {loadedAt ? <><br />as of {new Date(loadedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</> : null}
          </div>
        </div>
        <button onClick={() => load(false)} title="Refresh" disabled={loading}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 15, padding: 2, fontFamily: 'inherit' }}>↻</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', alignItems: 'center' }}>
        <button onClick={() => setFilter('all')} style={chip(filter === 'all')}>All · {out.length}</button>
        {advFirst && <button onClick={() => setFilter('mine')} style={chip(filter === 'mine', '#a5b4fc')}>{advFirst} · {mine.length}</button>}
      </div>

      {err && <div style={{ margin: '8px 12px 0', padding: '7px 10px', borderRadius: 8, background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', color: '#fca5a5', fontSize: 11.5, fontWeight: 700 }}>⚠️ {err}</div>}

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ color: '#64748b', fontSize: 12.5, padding: '10px 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {/* Maintenance — on top so nobody hands out a loaner that's down */}
            {openMaint.length > 0 && (
              <>
                <div style={{ ...sectionTitle, color: urgentCount ? '#fca5a5' : '#fcd34d' }}>
                  🔧 Needs service · {openMaint.length}{urgentCount ? ` (${urgentCount} urgent)` : ''}
                </div>
                {openMaint.map(r => {
                  const look = MAINT_LOOK[r.priority] || MAINT_LOOK.routine;
                  const what = [...(r.services || []), r.description].filter(Boolean).join(' · ');
                  return (
                    <div key={r.id} onClick={onOpenLoaner ? () => onOpenLoaner('maintenance') : undefined} title={what}
                      style={{ ...clickable, background: look.card, border: `1px solid ${look.edge}`, borderRadius: 11, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9.5, fontWeight: 900, color: look.fg, background: look.bg, flexShrink: 0 }}>{look.tag}</span>
                        <span style={{ fontWeight: 900, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.loanerNo ? `#${r.loanerNo}` : (r.vin || '').slice(-8)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vehicle(r) || '—'}</div>
                      {what && <div style={{ fontSize: 11, color: look.text, marginTop: 2, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{what}</div>}
                    </div>
                  );
                })}
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '4px 0' }} />
              </>
            )}

            {/* Loaners out */}
            <div style={{ ...sectionTitle, color: '#93c5fd' }}>🚙 Loaners out · {shown.length}</div>
            {shown.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 12.5, padding: '6px 4px', lineHeight: 1.5 }}>
                {filter === 'mine' ? `No loaners out for ${advFirst}.` : 'No loaners out right now. 👍'}
              </div>
            ) : shown.map(({ c, adv, days, overdue }) => {
              const own = adv === advFirst;
              const col = days == null ? '#94a3b8' : ageColor(days);
              return (
                <div key={c.id} onClick={onOpenLoaner ? () => onOpenLoaner('list') : undefined}
                  title={[c.raNo && `RA ${c.raNo}`, c.ro && `RO ${c.ro}`, c.phone, c.notes].filter(Boolean).join(' · ')}
                  style={{ ...clickable, background: own ? 'rgba(99,102,241,.1)' : 'rgba(255,255,255,.04)', border: `1px solid ${own ? 'rgba(165,180,252,.4)' : 'rgba(255,255,255,.09)'}`, borderLeft: `3px solid ${col}`, borderRadius: 11, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: own ? '#c7d2fe' : '#93c5fd', marginTop: 1 }}>👤 {adv || 'No advisor'}</div>
                    </div>
                    <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 42, padding: '3px 6px', borderRadius: 9, background: `${col}22`, border: `1px solid ${col}66` }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: col, lineHeight: 1 }}>{days ?? '?'}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 900, color: col, letterSpacing: '.05em' }}>{days === 1 ? 'DAY' : 'DAYS'}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {vehicle(c) || '—'}{c.unitNo ? ` · ${c.unitNo}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Out {fmtDate(c.dateOut) || '—'}{c.timeOut ? ` ${fmtTime(c.timeOut)}` : ''}
                  </div>
                  {overdue > 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 900, color: '#fca5a5', marginTop: 3 }}>⏰ {overdue}d past due ({fmtDate(c.dueDate)})</div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
