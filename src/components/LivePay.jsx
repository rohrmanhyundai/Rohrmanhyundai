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
  const csiPotential = tier.csi * hours;                   // CSI bonus if they qualified
  const csiBonus = csiQualifies ? csiPotential : 0;
  const csiMissed = (!csiQualifies && minCsi > 0) ? csiPotential : 0; // money left on the table
  const lead = safe(leadBonus, 0);
  const gross = basePay + csiBonus + lead;
  const adjustment = numAdvisors > 0 ? (safe(servicePolicy, 0) / numAdvisors) * 0.08 : 0;
  const net = gross - adjustment;
  return { hours, elr, csi, minCsi, elrQualifies, naturalTier, tierIdx, tier, basePay, csiQualifies, csiBonus, csiPotential, csiMissed, leadBonus: lead, gross, adjustment, net };
}

const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' };
const CSS = `@keyframes lpPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,146,60,.35),0 12px 34px -14px rgba(249,115,22,.6)}50%{box-shadow:0 0 24px 5px rgba(251,146,60,.32),0 14px 40px -12px rgba(249,115,22,.8)}}`;

export default function LivePay({ data, currentUser, currentRole, leadAdvisor = '', initialAdvisor = '', onFixCsi, onBack, backLabel = '← Back' }) {
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
      <style>{CSS}</style>
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
            {advisors.map(a => {
              const on = selected && selected.name === a.name;
              return (
                <button key={a.name} onClick={() => setSelName(a.name)}
                  style={{
                    background: on ? 'linear-gradient(135deg,#34d399,#0ea5e9)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${on ? 'transparent' : 'rgba(148,163,184,.18)'}`,
                    color: on ? '#04121a' : '#94a3b8',
                    borderRadius: 999, padding: '7px 18px', cursor: 'pointer', fontWeight: 900, fontSize: 13,
                    boxShadow: on ? '0 8px 22px -10px rgba(52,211,153,.9)' : 'none', transition: 'all .15s',
                  }}>{firstWord(a.name)}{lead && firstWord(a.name) === lead ? ' ★' : ''}</button>
              );
            })}
          </div>
        )}

        {!selected ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>
            No pay plan found for your account.
          </div>
        ) : (
          <div style={{ maxWidth: 780, margin: '0 auto' }}>
            {/* Two hero numbers — click to switch the breakdown below */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, marginBottom: 16 }}>
              <HeroCard icon="📅" title="Earned So Far (MTD)" value={money(calc.sofar.net)} sub={`On ${hrs1(calc.sofar.hours)} hrs sold so far`} active={mode === 'sofar'} onClick={() => setMode('sofar')} a1="#38bdf8" a2="#0ea5e9" />
              <HeroCard icon="🚀" title="Pacing Pay (Full Month)" value={money(calc.pacing.net)} sub={`On pace for ${hrs1(calc.pacing.hours)} hrs`} active={mode === 'pacing'} onClick={() => setMode('pacing')} a1="#34d399" a2="#10b981" />
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center' }}>
              Showing the <strong style={{ color: mode === 'pacing' ? '#6ee7b7' : '#7dd3fc' }}>{mode === 'pacing' ? 'PACING (projected full month)' : 'EARNED SO FAR (month-to-date)'}</strong> breakdown — tap a card above to switch.
            </div>

            {/* CSI bonus is being missed — show exactly how much is on the table */}
            {pay.csiMissed > 0 && (
              <div style={{ margin: '0 0 18px', background: 'linear-gradient(120deg, rgba(249,115,22,.22), rgba(244,63,94,.16))', border: '1px solid rgba(251,146,60,.6)', borderRadius: 16, padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', animation: 'lpPulse 2.4s ease-in-out infinite' }}>
                <div style={{ fontSize: 30 }}>💸</div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 900, color: '#fdba74' }}>
                    Leaving {money(pay.csiMissed)} on the table {mode === 'pacing' ? 'on pace this month' : 'so far this month'}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#fecaca', marginTop: 3, lineHeight: 1.45 }}>
                    CSI is <strong>{pay.csi}</strong> — needs <strong>≥ {pay.minCsi}</strong> to unlock the CSI bonus (${pay.tier.csi}/hr). Hit CSI and this gets added to the pay.
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <div style={{ fontSize: 30, fontWeight: 900, color: '#fb923c', whiteSpace: 'nowrap', textShadow: '0 0 22px rgba(251,146,60,.6)' }}>+{money(pay.csiMissed)}</div>
                  {onFixCsi && (
                    <button onClick={() => onFixCsi(selected.name)}
                      style={{ background: 'linear-gradient(135deg,#f97316,#ef4444)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 18px', cursor: 'pointer', fontWeight: 900, fontSize: 13, whiteSpace: 'nowrap', boxShadow: '0 8px 22px -8px rgba(249,115,22,.9)' }}>
                      🔧 Fix CSI Today →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Qualifiers for the active view — each with its own color identity */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
              <QualCard accent="#a78bfa" title={mode === 'pacing' ? 'Projected Hours' : 'CP + Warranty Hours'} value={hrs1(pay.hours)} note={pay.tier.label} />
              <QualCard accent={pay.elrQualifies ? '#34d399' : '#fb7185'} title="ELR (needs ≥ 88%)" value={`${(pay.elr * 100).toFixed(1)}%`} note={pay.elrQualifies ? '✓ Qualifies for tier' : '✗ Below 88% — capped at $4 tier'} />
              <QualCard accent={pay.minCsi > 0 ? (pay.csiQualifies ? '#34d399' : '#fb7185') : '#38bdf8'} title="CSI" value={pay.csi ? pay.csi.toLocaleString('en-US') : '—'} note={pay.minCsi > 0 ? (pay.csiQualifies ? `✓ Meets min ${pay.minCsi}` : `✗ Below min ${pay.minCsi} — missing ${money(pay.csiMissed)}`) : 'No minimum set'}
                onClick={pay.csiMissed > 0 && onFixCsi ? () => onFixCsi(selected.name) : undefined}
                cta={pay.csiMissed > 0 && onFixCsi ? '🔧 Fix CSI Today →' : null} />
            </div>

            {/* Breakdown */}
            <div style={{ background: 'linear-gradient(180deg, rgba(30,41,59,.7), rgba(15,23,42,.55))', border: '1px solid rgba(148,163,184,.2)', borderRadius: 18, overflow: 'hidden', marginBottom: 18, boxShadow: '0 16px 40px -26px rgba(0,0,0,.9)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', background: mode === 'pacing' ? 'linear-gradient(90deg, rgba(52,211,153,.18), transparent)' : 'linear-gradient(90deg, rgba(56,189,248,.18), transparent)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
                <span style={{ width: 4, height: 18, borderRadius: 2, background: mode === 'pacing' ? 'linear-gradient(180deg,#34d399,#10b981)' : 'linear-gradient(180deg,#38bdf8,#0ea5e9)' }} />
                <div style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.05em' }}>{mode === 'pacing' ? 'Pacing Commission Breakdown' : 'Earned-So-Far Breakdown'}</div>
              </div>
              <Row label={`Tier ${pay.tierIdx + 1} — ${pay.tier.label}`} value={`$${pay.tier.total}/hr`} valueColor="#c4b5fd" sub={pay.elrQualifies ? null : 'ELR below 88% — held at the $4 first tier'} />
              <Row label={`Base Commission ($${pay.tier.base}/hr × ${hrs1(pay.hours)} hrs)`} value={money(pay.basePay)} />
              <Row label={`CSI Bonus ($${pay.tier.csi}/hr × ${hrs1(pay.hours)} hrs)`} value={pay.csiQualifies ? money(pay.csiBonus) : `$0.00 (missing ${money(pay.csiMissed)})`} valueColor={pay.csiQualifies ? '#6ee7b7' : '#fb923c'} sub={pay.csiQualifies ? null : `CSI ${pay.csi} is below the ${pay.minCsi} minimum — ${money(pay.csiMissed)} not earned`} subColor="#fca5a5" muted={!pay.csiQualifies} />
              {calc.isLead && (
                <Row label={`⭐ Lead Advisor Bonus ($${LEAD_RATE.toFixed(2)}/hr × ${hrs1(leadHoursForMode)} team hrs)`} value={money(pay.leadBonus)} valueColor="#fcd34d" sub="Paid on the other advisors' hours (not your own)" subColor="#6ee7b7" tint="rgba(251,191,36,.08)" />
              )}
              <Row label="Gross Commission" value={money(pay.gross)} strong />
              <Row label={`Commission Adjustment (${money(servicePolicy)} ÷ ${numAdvisors} advisors × 8%)`} value={`− ${money(pay.adjustment)}`} valueColor="#fca5a5" muted />
              <Row label={mode === 'pacing' ? 'Net Pacing Pay' : 'Net Earned So Far'} value={money(pay.net)} strong net netColor={mode === 'pacing' ? '#34d399' : '#38bdf8'} />
            </div>

            {/* Tier ladder */}
            <div style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'linear-gradient(90deg, rgba(167,139,250,.16), transparent)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
                <span style={{ width: 4, height: 16, borderRadius: 2, background: 'linear-gradient(180deg,#a78bfa,#8b5cf6)' }} />
                <div style={{ fontSize: 12, fontWeight: 900, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '.05em' }}>Commission Tiers</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px', padding: '8px 18px', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                <div>CP + Warranty Hours</div><div style={{ textAlign: 'right' }}>$/hr</div><div style={{ textAlign: 'right' }}>Base</div><div style={{ textAlign: 'right' }}>CSI</div>
              </div>
              {TIERS.map((t, i) => {
                const here = i === pay.tierIdx;
                return (
                  <div key={t.label} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px', padding: '10px 18px', fontSize: 13.5, alignItems: 'center', background: here ? 'linear-gradient(90deg, rgba(52,211,153,.2), rgba(52,211,153,.05))' : 'transparent', borderBottom: '1px solid rgba(148,163,184,.06)', boxShadow: here ? 'inset 3px 0 0 #34d399' : 'none' }}>
                    <div style={{ fontWeight: here ? 900 : 600, color: here ? '#6ee7b7' : '#cbd5e1' }}>{here ? '▶ ' : ''}{t.label}</div>
                    <div style={{ textAlign: 'right', fontWeight: 900, color: here ? '#6ee7b7' : '#a78bfa' }}>${t.total}</div>
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

function HeroCard({ icon, title, value, sub, active, onClick, a1, a2 }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', position: 'relative', overflow: 'hidden',
      background: active ? `linear-gradient(145deg, ${a1}2e, ${a2}14 55%, rgba(2,6,23,.5))` : 'rgba(2,6,23,.4)',
      border: `1px solid ${active ? a1 + '99' : 'rgba(148,163,184,.18)'}`,
      borderRadius: 20, padding: '18px 22px',
      boxShadow: active ? `0 16px 40px -18px ${a1}cc, inset 0 1px 0 ${a1}33` : 'none', transition: 'all .2s',
    }}>
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${a1}${active ? '3a' : '14'}, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <div style={{ ...lbl, color: active ? a1 : '#94a3b8' }}>{title}</div>
      </div>
      <div style={{ fontSize: 38, fontWeight: 900, color: active ? a1 : '#cbd5e1', letterSpacing: '-.02em', marginTop: 5, position: 'relative', textShadow: active ? `0 0 26px ${a1}55` : 'none' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, position: 'relative' }}>{sub}</div>
    </button>
  );
}

function QualCard({ title, value, note, accent = '#38bdf8', onClick, cta }) {
  const clickable = !!onClick;
  return (
    <div onClick={onClick} title={clickable ? 'View your surveys' : undefined} style={{
      position: 'relative', overflow: 'hidden', cursor: clickable ? 'pointer' : 'default',
      background: `linear-gradient(150deg, ${accent}1f, rgba(2,6,23,.5) 60%)`,
      border: `1px solid ${accent}${clickable ? '99' : '55'}`, borderRadius: 14, padding: '13px 16px',
      boxShadow: `0 10px 28px -20px ${accent}, inset 0 1px 0 ${accent}22`,
    }}>
      <div style={{ position: 'absolute', top: -20, right: -20, width: 70, height: 70, borderRadius: '50%', background: `radial-gradient(circle, ${accent}33, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ ...lbl, color: accent, fontSize: 10 }}>{title}</div>
      <div style={{ fontSize: 25, fontWeight: 900, color: accent, marginTop: 3, position: 'relative', textShadow: `0 0 20px ${accent}44` }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3, fontWeight: 600, position: 'relative' }}>{note}</div>
      {cta && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: accent, position: 'relative' }}>{cta}</div>}
    </div>
  );
}

function Row({ label, value, sub, strong, net, netColor, valueColor, subColor, muted, tint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: net ? '13px 18px' : '11px 18px', borderBottom: '1px solid rgba(148,163,184,.07)', background: net ? `linear-gradient(90deg, ${netColor}22, transparent)` : (tint || 'transparent') }}>
      <div>
        <div style={{ fontSize: strong ? 14.5 : 13.5, fontWeight: strong ? 900 : 600, color: muted ? '#94a3b8' : '#e2e8f0' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: subColor || '#fca5a5', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: net ? 20 : (strong ? 18 : 15), fontWeight: strong || net ? 900 : 700, color: net ? netColor : (valueColor || (muted ? '#94a3b8' : '#f1f5f9')), whiteSpace: 'nowrap', textShadow: net ? `0 0 22px ${netColor}55` : 'none' }}>{value}</div>
    </div>
  );
}
