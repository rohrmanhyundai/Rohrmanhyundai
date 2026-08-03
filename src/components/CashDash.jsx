import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadCashDash, updateCashDash } from '../utils/github';

// ── August 2026 Cash Dash plan (hard-coded — one month's plan) ────────────────
const PLAN = {
  monthKey: '2026-08',
  label: 'August 2026',
  window: 'July 20 – August 31',
  core: 'Core Training must be completed to qualify for any pulls.',
  coreTech: 'Technicians: Core Complete + CP/W Video Utilization above 75%.',
  reputation: {
    note: 'Required for all positions except technicians.',
    mustHit: '30 reviews + 700 score — department qualifies',
    bonus1: '50 reviews + 725 score — +2 pulls per participant',
    bonus2: '80 reviews + 725 score — +2 more pulls per participant',
  },
  advisor: {
    unit: 'Hours sold · excludes internal',
    tiers: [[275, 5], [300, 7], [325, 13], [350, 16], [375, 20], [400, 25], [450, 35]],
  },
  tech: {
    unit: 'Booked hours · includes internal',
    tiers: [[150, 5], [185, 10], [215, 15], [245, 19], [285, 25], [330, 34]],
    warning: 'PTO / Holiday hours do NOT count as hours sold — they are excluded.',
  },
};

const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; };
const hrs = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

// Highest tier reached by `hours` → { pulls, idx }. idx = -1 when below tier 1.
function tierFor(tiers, hours) {
  let pulls = 0, idx = -1;
  tiers.forEach(([q, p], i) => { if (hours >= q) { pulls = p; idx = i; } });
  return { pulls, idx };
}
// The next tier not yet reached (or null if maxed).
function nextTier(tiers, hours) {
  for (const [q, p] of tiers) if (hours < q) return { q, p, need: q - hours };
  return null;
}
// Business days (Mon–Sat) elapsed / total in the current month, for pacing.
function bizDays(today = new Date()) {
  const y = today.getFullYear(), mo = today.getMonth(), dim = new Date(y, mo + 1, 0).getDate();
  let total = 0, elapsed = 0;
  for (let d = 1; d <= dim; d++) { if (new Date(y, mo, d).getDay() !== 0) { total++; if (d <= today.getDate()) elapsed++; } }
  return { total, elapsed };
}

export default function CashDash({ currentUser, currentRole, advisors = [], technicians = [], onBack }) {
  const me = firstName(currentUser);
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');

  const [techHours, setTechHours] = useState({}); // { NAME: hours } for PLAN.monthKey
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  const refresh = useCallback(async () => {
    try { const all = await loadCashDash(); setTechHours(((all && all[PLAN.monthKey]) || {}).techHours || {}); }
    catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const pace = useMemo(() => bizDays(), []);

  // Rosters. Advisors carry mtd_hours (hours sold); techs pull from techHours.
  const advisorRows = useMemo(() => (advisors || [])
    .filter(a => a && a.name)
    .map(a => ({ name: firstName(a.name), display: a.name, role: 'advisor', hours: num(a.mtd_hours) }))
    .sort((x, y) => x.name.localeCompare(y.name)), [advisors]);
  const techRows = useMemo(() => (technicians || [])
    .filter(t => t && t.name)
    .map(t => ({ name: firstName(t.name), display: t.name, role: 'tech', hours: num(techHours[firstName(t.name)]) }))
    .sort((x, y) => x.name.localeCompare(y.name)), [technicians, techHours]);

  // Who is the logged-in user (for the self view)?
  const selfRow = useMemo(() => advisorRows.find(r => r.name === me) || techRows.find(r => r.name === me) || null,
    [advisorRows, techRows, me]);

  const [selected, setSelected] = useState(null); // manager-drilldown target
  const target = selected || (!isManager ? selfRow : null);

  async function setTech(name, val) {
    const key = firstName(name);
    setTechHours(prev => ({ ...prev, [key]: val })); // optimistic
    setSaving(key);
    try {
      await updateCashDash(cur => {
        const bucket = { techHours: {}, ...(cur[PLAN.monthKey] || {}) };
        bucket.techHours = { ...bucket.techHours, [key]: num(val) };
        bucket.updatedAt = Date.now();
        return { ...cur, [PLAN.monthKey]: bucket };
      });
    } catch {} finally { setSaving(''); }
  }

  const plan = (role) => role === 'tech' ? PLAN.tech : PLAN.advisor;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">💰 Cash Dash</div>
          <div className="adv-sub">{PLAN.label} · {PLAN.window}</div>
        </div>
        <div style={{ flex: 1 }} />
        {selected && isManager && <button className="secondary" onClick={() => setSelected(null)} style={{ marginRight: 10 }}>← All</button>}
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 20 }}>

          {/* Qualify banner */}
          <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 16, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fde68a', marginBottom: 10 }}>How to qualify + earn pulls</div>
            <div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
              <div>🎓 <strong style={{ color: '#e2e8f0' }}>Core:</strong> {PLAN.core} <span style={{ color: '#94a3b8' }}>({PLAN.coreTech})</span></div>
              <div>⭐ <strong style={{ color: '#e2e8f0' }}>Reputation.com</strong> ({PLAN.reputation.note}): {PLAN.reputation.mustHit}. <span style={{ color: '#94a3b8' }}>Bonus 1 — {PLAN.reputation.bonus1}; Bonus 2 — {PLAN.reputation.bonus2}.</span></div>
            </div>
          </section>

          {target ? (
            <PersonView row={target} tiers={plan(target.role).tiers} unit={plan(target.role).unit}
              warning={target.role === 'tech' ? PLAN.tech.warning : ''} pace={pace} />
          ) : isManager ? (
            <>
              <Roster title="Service Advisors" unit={PLAN.advisor.unit} rows={advisorRows} tiers={PLAN.advisor.tiers}
                pace={pace} onOpen={setSelected} />
              <Roster title="Technicians" unit={PLAN.tech.unit} rows={techRows} tiers={PLAN.tech.tiers} pace={pace}
                editable saving={saving} onEdit={setTech} onOpen={setSelected} warning={PLAN.tech.warning} loading={loading} />
            </>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>You’re not part of the {PLAN.label} Cash Dash.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One person's Cash Dash: actual, locked pulls, pacing, tier ladder ─────────
function PersonView({ row, tiers, unit, warning, pace }) {
  const actual = row.hours;
  const locked = tierFor(tiers, actual);
  const projected = pace.elapsed > 0 ? actual * (pace.total / pace.elapsed) : actual;
  const projTier = tierFor(tiers, projected);
  const nxt = nextTier(tiers, actual);

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9' }}>{row.display} <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>· {unit}</span></div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="Hours sold (MTD)" value={hrs(actual)} accent="#6ee7b7" />
        <Stat label="Locked pulls" value={locked.pulls} accent="#fbbf24" sub={locked.idx < 0 ? `${nxt ? hrs(nxt.need) : 0} hrs to first tier` : 'earned so far'} big />
        <Stat label="Pacing (proj. month-end)" value={hrs(projected)} accent="#38bdf8" sub={`→ ${projTier.pulls} pulls at this pace`} />
        <Stat label="Next tier" value={nxt ? hrs(nxt.q) : 'MAX'} accent="#c4b5fd" sub={nxt ? `${hrs(nxt.need)} more hrs → ${nxt.p} pulls` : 'top tier reached'} />
      </div>

      {warning && (
        <div style={{ background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 12, padding: '11px 14px', color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>
          ⚠️ {warning}
        </div>
      )}

      {/* Tier ladder */}
      <div style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '10px 18px', background: 'rgba(251,191,36,.14)', fontSize: 11, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase', color: '#fde68a' }}>
          <div style={{ flex: 1 }}>Qualifier (hours)</div><div style={{ width: 90, textAlign: 'right' }}>Pulls</div><div style={{ width: 120, textAlign: 'right' }}>Status</div>
        </div>
        {tiers.map(([q, p], i) => {
          const hit = actual >= q;
          const onPace = !hit && projected >= q;
          return (
            <div key={q} style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid rgba(148,163,184,.1)',
              background: hit ? 'rgba(52,211,153,.12)' : onPace ? 'rgba(251,191,36,.08)' : 'transparent' }}>
              <div style={{ flex: 1, fontSize: 15.5, fontWeight: 800, color: hit ? '#6ee7b7' : '#e2e8f0' }}>{hrs(q)}{i === tiers.length - 1 ? '+' : ''}</div>
              <div style={{ width: 90, textAlign: 'right', fontSize: 15.5, fontWeight: 900, color: hit ? '#6ee7b7' : onPace ? '#fbbf24' : '#94a3b8' }}>{p}</div>
              <div style={{ width: 120, textAlign: 'right', fontSize: 12, fontWeight: 800 }}>
                {hit ? <span style={{ color: '#6ee7b7' }}>🔒 Locked</span> : onPace ? <span style={{ color: '#fbbf24' }}>On pace</span> : <span style={{ color: '#64748b' }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value, accent, sub, big }) {
  return (
    <div style={{ flex: 1, minWidth: 170, background: `linear-gradient(150deg, ${accent}22, ${accent}0a 55%, rgba(2,6,23,.55))`, border: `1px solid ${accent}55`, borderRadius: 16, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: accent, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 34 : 26, fontWeight: 900, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

// ── Manager overview list for one role ────────────────────────────────────────
function Roster({ title, unit, rows, tiers, pace, editable, saving, onEdit, onOpen, warning, loading }) {
  return (
    <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '13px 18px', background: 'rgba(148,163,184,.08)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{unit}{editable ? ' · enter each tech’s month-to-date booked hours' : ''}</div>
      </div>
      {warning && <div style={{ padding: '9px 18px', background: 'rgba(248,113,113,.1)', color: '#fca5a5', fontSize: 12, fontWeight: 700 }}>⚠️ {warning}</div>}
      <div style={{ display: 'flex', padding: '8px 18px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>
        <div style={{ flex: 1 }}>Name</div><div style={{ width: 130, textAlign: 'right' }}>Hours</div><div style={{ width: 90, textAlign: 'right' }}>Locked</div><div style={{ width: 110, textAlign: 'right' }}>Proj. pulls</div><div style={{ width: 60 }} />
      </div>
      {loading ? <div style={{ padding: '18px', color: '#64748b', fontSize: 13 }}>Loading…</div>
        : rows.length === 0 ? <div style={{ padding: '18px', color: '#64748b', fontSize: 13 }}>No one on this roster.</div>
        : rows.map(r => {
          const locked = tierFor(tiers, r.hours);
          const projected = pace.elapsed > 0 ? r.hours * (pace.total / pace.elapsed) : r.hours;
          const proj = tierFor(tiers, projected);
          return (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid rgba(148,163,184,.1)' }}>
              <div style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: '#e2e8f0' }}>{r.display}</div>
              <div style={{ width: 130, textAlign: 'right' }}>
                {editable
                  ? <input value={r.hours || ''} onChange={e => onEdit(r.name, e.target.value)} inputMode="decimal" placeholder="0"
                      style={{ width: 96, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#f1f5f9', padding: '5px 9px', fontSize: 14, fontWeight: 800, textAlign: 'right', outline: 'none' }} />
                  : <span style={{ fontSize: 15, fontWeight: 800, color: '#6ee7b7' }}>{hrs(r.hours)}</span>}
              </div>
              <div style={{ width: 90, textAlign: 'right', fontSize: 15, fontWeight: 900, color: locked.pulls > 0 ? '#6ee7b7' : '#64748b' }}>{locked.pulls}</div>
              <div style={{ width: 110, textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>{proj.pulls}</div>
              <div style={{ width: 60, textAlign: 'right' }}>
                <button onClick={() => onOpen(r)} style={{ background: 'rgba(96,165,250,.16)', border: '1px solid rgba(96,165,250,.4)', color: '#93c5fd', borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>View</button>
              </div>
            </div>
          );
        })}
    </section>
  );
}
