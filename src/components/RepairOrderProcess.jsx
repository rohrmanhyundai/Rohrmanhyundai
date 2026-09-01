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

// "READY_FOR_DISPATCH" → "Ready for dispatch".
const prettyStatus = (v) => {
  const t = String(v || '').trim().replace(/_/g, ' ').toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

// Severity drives sort order and row highlight. Highest first.
const SEV = {
  DISPATCH_OVERDUE: 9,   // READY_FOR_DISPATCH older than 1 day
  UNPAID_STALE:     8,   // invoiced, still unpaid past the stale threshold
  OPEN_STALLED:     7,   // open work sitting past the stalled threshold
  WARRANTY:         6,   // READY_FOR_INVOICE + warranty (red) flag, not invoiced
  AWN:              5,   // "Ready for AWN Review" and not INVOICED
  UNPAID:           4,   // invoiced, unpaid past the aging threshold
  OPEN_AGING:       3,   // open work past the aging threshold
  DISPATCH:         2,   // READY_FOR_DISPATCH (needs to get in the shop)
  ACCEPTANCE:       1,   // READY_FOR_INVOICE, no flag (needs acceptance)
  NONE:             0,   // paid / closed / anything else (shown, not highlighted)
};

// An INVOICED RO whose customer-pay line still reads INVOICED has been billed
// but not collected — the money is still out. PAID, CLOSED and NA are settled
// (NA meaning there was no customer-pay portion at all).
const isUnpaid = (r) => normStatus(r.roStatus) === 'INVOICED' && normStatus(r.cpStatus) === 'INVOICED';
const UNPAID_THRESHOLDS = { aging: 3, stale: 7 };

// Statuses that mean the RO still has OPEN WORK — the tech has claimed it but
// lines remain unfinished.
//
// CP Status deliberately plays no part here. It is ONE LINE's state, not the
// RO's: a used-car RO with no customer-pay lines reads CP=COMPLETED while the
// repair is still open (780470 and its neighbours), so treating it as "done"
// would hide live work. Age is the only reliable signal for these.
const OPEN_WORK = new Set(['TECH_ASSIGNED', 'PARTIALLY_ASSIGNED', 'IN_PROGRESS']);

// Days of open work before the page calls it out. Used-car recon (GREEN flag)
// gets a longer leash — a recon unit sitting a few days isn't a customer
// waiting on their car.
const OPEN_THRESHOLDS = {
  customer: { aging: 3, stalled: 7 },
  used:     { aging: 5, stalled: 10 },
};
const isUsedCar = (r) => /green/i.test(String(r.userFlag || ''));

// Apply the manager rules to one RO.
function evaluate(r) {
  const st = normStatus(r.roStatus);
  const warranty = !!r.warranty;
  const age = ageOf(r);
  const invoiced = st === 'INVOICED';
  // "Ready for AWN Review" may sit in the flag or a status column — check all.
  const flagText = `${r.userFlag || ''} ${r.roStatus || ''} ${r.cpStatus || ''}`.toLowerCase();
  const awnReview = flagText.includes('awn') && flagText.includes('review');

  if (st === 'READY_FOR_DISPATCH') {
    if (age != null && age > 1) return { sev: SEV.DISPATCH_OVERDUE, tag: 'Dispatch overdue', color: '#f87171', pulse: 'attn-high-row', msg: 'Get the car into the shop.' };
    return { sev: SEV.DISPATCH, tag: 'Get car in shop', color: '#fbbf24', msg: 'Car needs to get into the shop.' };
  }
  if (awnReview && !invoiced) {
    return { sev: SEV.AWN, tag: 'AWN — needs invoicing', color: '#c084fc', pulse: 'coaching-glow', msg: 'AWN repair needs invoiced.' };
  }
  if (st === 'READY_FOR_INVOICE') {
    if (warranty) return { sev: SEV.WARRANTY, tag: 'Warranty — not invoiced', color: '#fb923c', pulse: 'tire-missing-alert', msg: 'Flagged warranty but not invoiced.' };
    return { sev: SEV.ACCEPTANCE, tag: 'Needs acceptance', color: '#38bdf8', msg: 'Tech finished — accept the RO.' };
  }
  if (OPEN_WORK.has(st)) {
    const used = isUsedCar(r);
    const t = used ? OPEN_THRESHOLDS.used : OPEN_THRESHOLDS.customer;
    const kind = used ? 'Used-car recon' : 'Open work';
    if (age != null && age >= t.stalled) {
      return { sev: SEV.OPEN_STALLED, tag: 'Open work — stalled', color: '#f87171', pulse: 'attn-high-row',
               msg: `${kind} — find out what it's waiting on.` };
    }
    if (age != null && age >= t.aging) {
      return { sev: SEV.OPEN_AGING, tag: 'Open work — aging', color: '#fbbf24',
               msg: kind === 'Used-car recon' ? 'Used-car recon.' : '' };
    }
    // Inside the leash — the tech has it and it's moving.
    return { sev: SEV.NONE, tag: r.roStatus ? String(r.roStatus) : '—', color: '#64748b', msg: '' };
  }
  if (isUnpaid(r)) {
    if (age != null && age >= UNPAID_THRESHOLDS.stale) {
      return { sev: SEV.UNPAID_STALE, tag: 'Invoiced — not paid', color: '#f472b6', pulse: 'attn-high-row',
               msg: 'Billed but never collected — chase the payment.' };
    }
    if (age != null && age >= UNPAID_THRESHOLDS.aging) {
      return { sev: SEV.UNPAID, tag: 'Invoiced — not paid', color: '#f9a8d4', msg: 'Awaiting payment.' };
    }
    return { sev: SEV.NONE, tag: prettyStatus(r.roStatus) || '—', color: '#64748b', msg: '' };
  }
  // INVOICED (with or without flag) and everything else → no alert.
  return { sev: SEV.NONE, tag: r.roStatus ? String(r.roStatus) : '—', color: '#64748b', msg: '' };
}

const CATS = [
  { key: 'all',      label: 'All ROs',               color: '#94a3b8', sevs: null },
  { key: 'dispatch-overdue', label: 'Dispatch overdue',      color: '#f87171', sevs: [SEV.DISPATCH_OVERDUE] },
  { key: 'unpaid',   label: 'Invoiced not paid',     color: '#f472b6', sevs: [SEV.UNPAID_STALE, SEV.UNPAID] },
  { key: 'stalled',  label: 'Open work stalled',     color: '#f87171', sevs: [SEV.OPEN_STALLED] },
  { key: 'warranty', label: 'Warranty not invoiced', color: '#fb923c', sevs: [SEV.WARRANTY] },
  { key: 'awn',      label: 'AWN needs invoicing',   color: '#c084fc', sevs: [SEV.AWN] },
  { key: 'aging',    label: 'Open work aging',       color: '#fbbf24', sevs: [SEV.OPEN_AGING] },
  { key: 'dispatch', label: 'Get car in shop',       color: '#fbbf24', sevs: [SEV.DISPATCH] },
  { key: 'accept',   label: 'Needs acceptance',      color: '#38bdf8', sevs: [SEV.ACCEPTANCE] },
];

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function RepairOrderProcess({ onBack, currentRole }) {
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [data, setData] = useState({ updatedAt: null, by: '', rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState('');   // RO # just copied, for the tick

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
    const c = {};
    for (const cat of CATS) {
      c[cat.key] = cat.sevs ? evaluated.filter(({ e }) => cat.sevs.includes(e.sev)).length : evaluated.length;
    }
    return c;
  }, [evaluated]);

  const visible = useMemo(() => {
    const cat = CATS.find(c => c.key === filter);
    if (!cat || !cat.sevs) return evaluated;
    return evaluated.filter(({ e }) => cat.sevs.includes(e.sev));
  }, [evaluated, filter]);

  const cardSt = { background: 'rgba(15,23,42,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, padding: 18, marginBottom: 20 };
  const thSt = { textAlign: 'left', padding: '9px 12px', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.2)', whiteSpace: 'nowrap' };
  const tdSt = { padding: '9px 12px', color: '#cbd5e1', borderBottom: '1px solid rgba(148,163,184,.07)', verticalAlign: 'middle', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip' };

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
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {error && <div style={{ color: '#fca5a5', fontSize: 14, marginBottom: 14, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px' }}>{error}</div>}

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
            {CATS.map(c => {
              const n = counts[c.key];
              const active = String(filter) === String(c.key);
              return (
                <div key={c.key} onClick={() => setFilter(c.key)}
                  style={{ cursor: 'pointer', flex: '1 1 128px', background: active ? `${c.color}22` : 'rgba(15,23,42,.55)', border: `1px solid ${c.color}${active ? 'aa' : '44'}`, borderRadius: 12, padding: '10px 14px' }}>
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
                  <th style={{ ...thSt, width: 92 }}>RO #</th>
                  <th style={{ ...thSt, width: 150 }}>Advisor</th>
                  <th style={{ ...thSt, width: 160 }}>Technician</th>
                  <th style={{ ...thSt, width: 150 }}>RO Status</th>
                  <th style={{ ...thSt, width: 110 }} title="One LINE's status, not the RO's — a used-car RO with no customer-pay lines reads Completed while the repair is still open.">CP Line</th>
                  <th style={{ ...thSt, width: 58, textAlign: 'right' }}>Age</th>
                  <th style={thSt}>What to do</th>
                </tr></thead>
                <tbody>
                  {visible.map(({ r, e, age }, i) => (
                    <tr key={r.ro + i} className={e.pulse || undefined}
                      style={{ background: e.sev >= 1 ? `${e.color}14` : 'transparent' }}>
                      <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                        <span
                          onClick={async () => { if (await copyText(r.ro)) { setCopied(r.ro); setTimeout(() => setCopied(c => (c === r.ro ? '' : c)), 1400); } }}
                          title="Click to copy this RO number"
                          style={{ fontFamily: 'monospace', color: '#6ee7f9', fontWeight: 700, cursor: 'pointer', borderBottom: '1px dashed rgba(110,231,249,.4)' }}
                        >{r.ro}</span>
                        {copied === r.ro && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#4ade80' }}>✓ copied</span>}
                        {r.warranty && <span title="Warranty (red flag)" style={{ marginLeft: 5 }}>🚩</span>}
                      </td>
                      <td style={{ ...tdSt, fontSize: 12.5, wordBreak: 'break-word' }} title={r.advisor || ''}>{r.advisor || '—'}</td>
                      <td style={{ ...tdSt, fontSize: 12.5, wordBreak: 'break-word' }} title={r.tech || ''}>{r.tech || '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, color: e.color, fontSize: 12.5 }}>{prettyStatus(r.roStatus) || '—'}</td>
                      <td style={{ ...tdSt, fontSize: 12, color: '#64748b' }}>{prettyStatus(r.cpStatus) || '—'}</td>
                      <td style={{ ...tdSt, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', color: age != null && age > 1 ? '#f87171' : '#cbd5e1' }}>{age != null ? `${age}d` : '—'}</td>
                      <td style={tdSt}>
                        {e.sev > 0
                          ? <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ background: `${e.color}22`, border: `1px solid ${e.color}88`, color: e.color, borderRadius: 999, padding: '3px 10px', fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap' }}>{e.sev >= 3 ? '⚠️ ' : ''}{e.tag}</span>
                              {e.msg && <span style={{ color: '#94a3b8', fontSize: 12.5 }}>{e.msg}</span>}
                            </div>
                          : <span style={{ color: '#475569' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && <tr><td style={{ ...tdSt, color: '#64748b' }} colSpan={7}>No repair orders in this category.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
