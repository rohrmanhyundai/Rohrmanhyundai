import React, { useState, useMemo } from 'react';
import { safe } from '../utils/formatters';
import { advisorProjectedHours } from '../utils/calculations';

// Commission tiers — $/CP+Warranty hour. Base = 50% (always paid when the tier
// qualifies), CSI = 50% (paid only when the advisor's CSI ≥ their Min CSI).
const TIERS = [
  { label: 'Up to 249 Hours', min: 0,   max: 249,      total: 4,  base: 2,    csi: 2 },
  { label: '250 – 299 Hours', min: 250, max: 299,      total: 5,  base: 2.5,  csi: 2.5 },
  { label: '300 – 349 Hours', min: 300, max: 349,      total: 7,  base: 3.5,  csi: 3.5 },
  { label: '350 – 399 Hours', min: 350, max: 399,      total: 9,  base: 4.5,  csi: 4.5 },
  { label: '400+ Hours',      min: 400, max: Infinity, total: 11, base: 5.5,  csi: 5.5 },
];
const ELR_QUALIFIER = 0.88; // ELR after discount must be ≥ 88% of posted door rate
const LEAD_RATE = 1.5;      // lead advisor earns $1.50/hr on the OTHER advisors' hours

const money = (v) => `$${(Math.round(safe(v, 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs1 = (v) => safe(v, 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
function tierIndexByHours(h) { for (let i = TIERS.length - 1; i >= 0; i--) { if (h >= TIERS[i].min) return i; } return 0; }

// Pure pay computation. `hours` is the CP+Warranty hours basis (month-to-date for
// "so far", projected for "pacing"). `leadBonus` is the lead advisor's team bonus
// for this basis ($0 for non-leads).
export function computeLivePay(a, hours, servicePolicy, numAdvisors, leadBonus) {
  const elr = safe(a && a.elr, 0);        // stored as a fraction, e.g. 0.955
  const csi = safe(a && a.csi, 0);
  const minCsi = safe(a && a.min_csi, 0);
  const elrQualifies = elr >= ELR_QUALIFIER;
  const naturalTier = tierIndexByHours(hours);
  const tierIdx = elrQualifies ? naturalTier : 0; // capped at the $4 tier if ELR fails
  const tier = TIERS[tierIdx];
  const basePay = tier.base * hours;
  const csiQualifies = minCsi > 0 ? csi >= minCsi : true; // no minimum set → no barrier
  const csiBonus = csiQualifies ? tier.csi * hours : 0;
  const lead = safe(leadBonus, 0);
  const gross = basePay + csiBonus + lead;
  const adjustment = numAdvisors > 0 ? (safe(servicePolicy, 0) / numAdvisors) * 0.08 : 0;
  const net = gross - adjustment;
  return { hours, elr, csi, minCsi, elrQualifies, naturalTier, tierIdx, tier, basePay, csiQualifies, csiBonus, leadBonus: lead, gross, adjustment, net };
}

const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8' };

export default function LivePay({ data, currentUser, currentRole, leadAdvisor = '', initialAdvisor = '', onBack, backLabel = '← Back' }) {
  const advisors = (data && data.advisors) || [];
  const servicePolicy = safe(data && data.service_policy, 0);
  const numAdvisors = advisors.length || 1;
  const me = (currentUser || '').toUpperCase();
  const lead = (leadAdvisor || '').toUpperCase();
  // Only a true Admin or Service Manager may view everyone's pay. Anyone with
  // Management Access folded into their role (e.g. Jordan → "advisor manager")
  // or a lead advisor sees only their own.
  const canViewAll = currentRole === 'admin' || currentRole === 'service manager';
  const myRecord = advisors.find(a => firstWord(a.name) === me);

  const selectable = canViewAll ? advisors : (myRecord ? [myRecord] : []);
  const [selName, setSelName] = useState(() => {
    // Open on the advisor the manager was viewing (passed from the Goals page).
    if (canViewAll && initialAdvisor) {
      const focus = advisors.find(a => firstWord(a.name) === firstWord(initialAdvisor));
      if (focus) return focus.name;
    }
    return myRecord ? myRecord.name : (selectable[0] ? selectable[0].name : '');
  });
  const selected = selectable.find(a => a.name === selName) || selectable[0] || null;
  const [mode, setMode] = useState('pacing'); // 'sofar' | 'pacing'

  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const calc = useMemo(() => {
    if (!selected) return null;
    const isLead = !!lead && firstWord(selected.name) === lead;
    // Other advisors' hours drive the lead bonus (never the lead's own hours).
    const others = advisors.filter(a => firstWord(a.name) !== firstWord(selected.name));
    const othersMtd = others.reduce((s, a) => s + safe(a.mtd_hours, 0), 0);
    const othersPace = others.reduce((s, a) => s + advisorProjectedHours(a, data), 0);
    const leadMtd = isLead ? LEAD_RATE * othersMtd : 0;
    const leadPace = isLead ? LEAD_RATE * othersPace : 0;
    const mtdHours = safe(selected.mtd_hours, 0);
    const paceHours = advisorProjectedHours(selected, data);
    return {
      isLead, othersMtd, othersPace,
      sofar: computeLivePay(selected, mtdHours, servicePolicy, numAdvisors, leadMtd),
      pacing: computeLivePay(selected, paceHours, servicePolicy, numAdvisors, leadPace),
    };
  }, [selected, servicePolicy, numAdvisors, advisors, data, lead]);

  const pay = calc ? (mode === 'pacing' ? calc.pacing : calc.sofar) : null;
  const leadHoursForMode = calc ? (mode === 'pacing' ? calc.othersPace : calc.othersMtd) : 0;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">💵 Live Pay</div>
          <div className="adv-sub">{selected ? `${firstWord(selected.name)} · ${monthLabel}` : monthLabel}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        {canViewAll && advisors.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {advisors.map(a => (
              <button key={a.name} onClick={() => setSelName(a.name)}
                style={{
                  background: selected && selected.name === a.name ? 'rgba(52,211,153,.22)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${selected && selected.name === a.name ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: selected && selected.name === a.name ? '#6ee7b7' : '#94a3b8',
                  borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                }}>{firstWord(a.name)}{lead && firstWord(a.name) === lead ? ' ★' : ''}</button>
            ))}
          </div>
        )}

        {!selected ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>
            No pay plan found for your account.
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* Two hero numbers — click to switch the breakdown below */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 18 }}>
              <HeroCard title="Earned So Far (MTD)" value={money(calc.sofar.net)} sub={`On ${hrs1(calc.sofar.hours)} hrs sold so far`} active={mode === 'sofar'} onClick={() => setMode('sofar')} accent="#38bdf8" />
              <HeroCard title="Pacing Pay (Full Month)" value={money(calc.pacing.net)} sub={`On pace for ${hrs1(calc.pacing.hours)} hrs`} active={mode === 'pacing'} onClick={() => setMode('pacing')} accent="#34d399" />
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center' }}>
              Showing the <strong style={{ color: mode === 'pacing' ? '#6ee7b7' : '#7dd3fc' }}>{mode === 'pacing' ? 'PACING (projected full month)' : 'EARNED SO FAR (month-to-date)'}</strong> breakdown — tap a card above to switch.
            </div>

            {/* Qualifiers for the active view */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
              <QualCard title={mode === 'pacing' ? 'Projected Hours' : 'CP + Warranty Hours'} value={hrs1(pay.hours)} note={pay.tier.label} good={null} />
              <QualCard title="ELR (needs ≥ 88%)" value={`${(pay.elr * 100).toFixed(1)}%`} note={pay.elrQualifies ? 'Qualifies for tier' : 'Below 88% — capped at $4 tier'} good={pay.elrQualifies} />
              <QualCard title="CSI" value={pay.csi ? pay.csi.toLocaleString('en-US') : '—'} note={pay.minCsi > 0 ? (pay.csiQualifies ? `Meets min ${pay.minCsi}` : `Below min ${pay.minCsi} — no CSI bonus`) : 'No minimum set'} good={pay.minCsi > 0 ? pay.csiQualifies : null} />
            </div>

            {/* Breakdown */}
            <div style={{ background: 'rgba(30,41,59,.6)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden', marginBottom: 18 }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(148,163,184,.14)', fontSize: 12, fontWeight: 900, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.05em' }}>{mode === 'pacing' ? 'Pacing Commission Breakdown' : 'Earned-So-Far Breakdown'}</div>
              <Row label={`Tier ${pay.tierIdx + 1} — ${pay.tier.label}`} value={`$${pay.tier.total}/hr`} sub={pay.elrQualifies ? null : 'ELR below 88% — held at the $4 first tier'} />
              <Row label={`Base Commission ($${pay.tier.base}/hr × ${hrs1(pay.hours)} hrs)`} value={money(pay.basePay)} />
              <Row label={`CSI Bonus ($${pay.tier.csi}/hr × ${hrs1(pay.hours)} hrs)`} value={pay.csiQualifies ? money(pay.csiBonus) : money(0)} sub={pay.csiQualifies ? null : 'CSI below minimum — bonus not earned'} muted={!pay.csiQualifies} />
              {calc.isLead && (
                <Row label={`Lead Advisor Bonus ($${LEAD_RATE.toFixed(2)}/hr × ${hrs1(leadHoursForMode)} team hrs)`} value={money(pay.leadBonus)} sub="Paid on the other advisors' hours (not your own)" accent />
              )}
              <Row label="Gross Commission" value={money(pay.gross)} strong />
              <Row label={`Commission Adjustment (${money(servicePolicy)} ÷ ${numAdvisors} advisors × 8%)`} value={`− ${money(pay.adjustment)}`} muted />
              <Row label={mode === 'pacing' ? 'Net Pacing Pay' : 'Net Earned So Far'} value={money(pay.net)} strong accent />
            </div>

            {/* Tier ladder */}
            <div style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(148,163,184,.14)', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>Commission Tiers</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px', padding: '8px 18px', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                <div>CP + Warranty Hours</div><div style={{ textAlign: 'right' }}>$/hr</div><div style={{ textAlign: 'right' }}>Base</div><div style={{ textAlign: 'right' }}>CSI</div>
              </div>
              {TIERS.map((t, i) => {
                const here = i === pay.tierIdx;
                return (
                  <div key={t.label} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px', padding: '9px 18px', fontSize: 13.5, alignItems: 'center', background: here ? 'rgba(52,211,153,.12)' : 'transparent', borderBottom: '1px solid rgba(148,163,184,.06)' }}>
                    <div style={{ fontWeight: here ? 900 : 600, color: here ? '#6ee7b7' : '#cbd5e1' }}>{here ? '▶ ' : ''}{t.label}</div>
                    <div style={{ textAlign: 'right', fontWeight: 800, color: here ? '#6ee7b7' : '#e2e8f0' }}>${t.total}</div>
                    <div style={{ textAlign: 'right', color: '#94a3b8' }}>${t.base}</div>
                    <div style={{ textAlign: 'right', color: '#94a3b8' }}>${t.csi}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 14, lineHeight: 1.5 }}>
              Pacing Pay projects the full month from the current daily pace (daily avg × workdays). Final commission is calculated after month close.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HeroCard({ title, value, sub, active, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer',
      background: active ? `linear-gradient(150deg, ${accent}28, rgba(15,23,42,.6))` : 'rgba(2,6,23,.4)',
      border: `1px solid ${active ? accent + '88' : 'rgba(148,163,184,.2)'}`,
      borderRadius: 18, padding: '18px 20px', boxShadow: active ? `0 12px 34px -20px ${accent}` : 'none',
    }}>
      <div style={{ ...lbl, color: active ? accent : '#94a3b8' }}>{title}</div>
      <div style={{ fontSize: 36, fontWeight: 900, color: active ? accent : '#cbd5e1', letterSpacing: '-.02em', marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>
    </button>
  );
}

function QualCard({ title, value, note, good }) {
  const color = good === true ? '#4ade80' : good === false ? '#fb7185' : '#7dd3fc';
  return (
    <div style={{ background: 'rgba(2,6,23,.45)', border: `1px solid ${good === true ? 'rgba(74,222,128,.35)' : good === false ? 'rgba(251,113,133,.35)' : 'rgba(148,163,184,.2)'}`, borderRadius: 14, padding: '13px 16px' }}>
      <div style={lbl}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color, marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: good === true ? '#86efac' : good === false ? '#fca5a5' : '#94a3b8', marginTop: 3, fontWeight: 600 }}>{note}</div>
    </div>
  );
}

function Row({ label, value, sub, strong, accent, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '11px 18px', borderBottom: '1px solid rgba(148,163,184,.07)' }}>
      <div>
        <div style={{ fontSize: strong ? 14.5 : 13.5, fontWeight: strong ? 900 : 600, color: muted ? '#94a3b8' : '#e2e8f0' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: accent ? '#6ee7b7' : '#fca5a5', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: strong ? 18 : 15, fontWeight: strong ? 900 : 700, color: accent ? '#6ee7b7' : muted ? '#94a3b8' : '#f1f5f9', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}
