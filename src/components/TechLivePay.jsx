import React, { useState, useEffect, useMemo } from 'react';
import { safe } from '../utils/formatters';
import { loadTechPay, saveTechPayPlan, loadTechPayHistory } from '../utils/github';
import { computeTechPay, normalizePlan, planIsSet, tiersOf, payBasis, weekBounds, TIER1_HOURS, TIER2_HOURS } from '../utils/techPay';
import { HeroCard, QualCard, Row } from './LivePay';

/* Tech Live Pay — the flat-rate mirror of the advisor page.
 *
 * Techs are reported by the week here, so "banked" is the hours already turned
 * this week and "pacing" is the full week at the current daily pace (the same
 * `pacing` number the Tech Hours board shows). A tech sees only their own; a
 * service manager or admin sees everyone and gets the Setup tab.
 */

const money = (v) => `$${(Math.round(safe(v, 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs1 = (v) => safe(v, 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
const rate = (v) => `$${safe(v, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();

const CSS = `@keyframes tlpPulse{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.3),0 12px 34px -14px rgba(16,185,129,.6)}50%{box-shadow:0 0 24px 5px rgba(52,211,153,.28),0 14px 40px -12px rgba(16,185,129,.8)}}`;

export default function TechLivePay({ data, currentUser, currentRole, onBack, backLabel = '← Back' }) {
  const techs = (data && data.technicians) || [];
  const me = (currentUser || '').toUpperCase();
  // Same rule as the advisor page: only a true Admin or Service Manager sees
  // everyone's pay. Management Access folded into another role does not.
  const canViewAll = currentRole === 'admin' || currentRole === 'service manager';
  const myRecord = techs.find(t => firstWord(t.name) === me);
  const visible = canViewAll ? techs : (myRecord ? [myRecord] : []);

  const [selName, setSelName] = useState(() => (myRecord ? myRecord.name : (visible[0] ? visible[0].name : '')));
  const selected = visible.find(t => t.name === selName) || visible[0] || null;
  const [mode, setMode] = useState('pacing');            // 'banked' | 'pacing'
  const [tab, setTab] = useState('pay');                 // 'pay' | 'setup'

  const [plans, setPlans] = useState(null);              // null = still loading
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    let alive = true;
    loadTechPay()
      .then(p => { if (alive) setPlans(p || {}); })
      .catch(() => { if (alive) { setPlans({}); setLoadErr('Could not load the pay plans.'); } });
    return () => { alive = false; };
  }, []);

  const plan = selected && plans ? normalizePlan(plans[firstWord(selected.name)]) : normalizePlan(null);
  const isSet = selected && plans ? planIsSet(plans[firstWord(selected.name)]) : false;

  const calc = useMemo(() => {
    if (!selected) return null;
    // Holiday / PTO / training hours are stripped out here when the tech isn't
    // eligible for them, so every figure below is already on payable hours.
    const basis = payBasis(selected, plan);
    return {
      basis,
      banked: computeTechPay(plan, basis.banked),
      pacing: computeTechPay(plan, basis.pacing),
    };
  }, [selected, plan]);

  const pay = calc ? (mode === 'pacing' ? calc.pacing : calc.banked) : null;
  const weekLabel = new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔧 Tech Live Pay</div>
          <div className="adv-sub">{selected ? `${firstWord(selected.name)} · week of ${weekLabel}` : `Week of ${weekLabel}`}</div>
        </div>
        <div style={{ flex: 1 }} />
        {canViewAll && (
          <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 999, padding: 4 }}>
            {[['pay', '💵 Live Pay'], ['setup', '⚙️ Pay Setup']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{
                  background: tab === k ? 'linear-gradient(135deg,#34d399,#0ea5e9)' : 'transparent',
                  border: 'none', color: tab === k ? '#04121a' : '#94a3b8',
                  borderRadius: 999, padding: '6px 16px', cursor: 'pointer', fontWeight: 900, fontSize: 13,
                }}>{label}</button>
            ))}
          </div>
        )}
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        {canViewAll && techs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {techs.map(t => {
              const on = selected && selected.name === t.name;
              const has = plans ? planIsSet(plans[firstWord(t.name)]) : true;
              return (
                <button key={t.name} onClick={() => setSelName(t.name)}
                  title={has ? undefined : 'No pay plan set up yet'}
                  style={{
                    background: on ? 'linear-gradient(135deg,#34d399,#0ea5e9)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${on ? 'transparent' : 'rgba(148,163,184,.18)'}`,
                    color: on ? '#04121a' : (has ? '#94a3b8' : '#fb923c'),
                    borderRadius: 999, padding: '7px 18px', cursor: 'pointer', fontWeight: 900, fontSize: 13,
                    boxShadow: on ? '0 8px 22px -10px rgba(52,211,153,.9)' : 'none', transition: 'all .15s',
                  }}>{firstWord(t.name)}{has ? '' : ' •'}</button>
              );
            })}
          </div>
        )}

        {plans === null ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>Loading pay plans…</div>
        ) : !selected ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>
            No technician record found for your account.
          </div>
        ) : tab === 'setup' && canViewAll ? (
          <SetupPanel
            techName={firstWord(selected.name)}
            plan={plan}
            onSaved={(saved) => setPlans(p => ({ ...(p || {}), [firstWord(selected.name)]: saved }))}
          />
        ) : (
          <div style={{ maxWidth: 780, margin: '0 auto' }}>
            {loadErr && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{loadErr}</div>}

            {!isSet ? (
              <div style={{ background: 'rgba(30,41,59,.6)', border: '1px solid rgba(251,146,60,.5)', borderRadius: 16, padding: '22px 24px', color: '#fdba74', fontSize: 14.5, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>No pay plan set up yet</div>
                {canViewAll
                  ? <>Open <strong>⚙️ Pay Setup</strong> above and enter {firstWord(selected.name)}'s flat rate and tier bumps. Until then there's nothing to calculate.</>
                  : <>Your service manager still needs to enter your pay plan. Once it's in, your banked and pacing pay show up here.</>}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, marginBottom: 16 }}>
                  <HeroCard icon="🏦" title="Banked This Week" value={money(calc.banked.gross)} sub={`On ${hrs1(calc.banked.hours)} hrs turned so far`} active={mode === 'banked'} onClick={() => setMode('banked')} a1="#38bdf8" a2="#0ea5e9" />
                  <HeroCard icon="🚀" title="Pacing Pay (Full Week)" value={money(calc.pacing.gross)} sub={`On pace for ${hrs1(calc.pacing.hours)} hrs`} active={mode === 'pacing'} onClick={() => setMode('pacing')} a1="#34d399" a2="#10b981" />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, textAlign: 'center' }}>
                  Showing the <strong style={{ color: mode === 'pacing' ? '#6ee7b7' : '#7dd3fc' }}>{mode === 'pacing' ? 'PACING (projected full week)' : 'BANKED (hours turned so far)'}</strong> breakdown — tap a card above to switch.
                </div>

                {/* The next bump, and exactly what it's worth */}
                {pay.next && pay.toNext > 0 && (
                  <div style={{ margin: '0 0 18px', background: 'linear-gradient(120deg, rgba(52,211,153,.2), rgba(14,165,233,.14))', border: '1px solid rgba(52,211,153,.5)', borderRadius: 16, padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', animation: 'tlpPulse 2.4s ease-in-out infinite' }}>
                    <div style={{ fontSize: 30 }}>📈</div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 900, color: '#6ee7b7' }}>
                        {hrs1(pay.toNext)} more hrs to the {hrs1(pay.next.min)}-hour bump
                      </div>
                      <div style={{ fontSize: 12.5, color: '#bae6fd', marginTop: 3, lineHeight: 1.45 }}>
                        Rate goes {rate(pay.tier.rate)} → <strong>{rate(pay.next.rate)}</strong> per flagged hour
                        {plan.tierMode === 'all' ? ' on every hour this week' : ' on the hours above it'}.
                      </div>
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 900, color: '#34d399', whiteSpace: 'nowrap', textShadow: '0 0 22px rgba(52,211,153,.6)' }}>+{money(pay.nextGain)}</div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
                  <QualCard accent="#a78bfa" title={mode === 'pacing' ? 'Projected Hours' : 'Hours Turned'} value={hrs1(pay.hours)}
                    note={calc.basis.excluded > 0 ? `${pay.tier.label} · ${hrs1(calc.basis.excluded)} PTO hrs not paid` : pay.tier.label} />
                  <QualCard accent="#34d399" title="Effective Flat Rate" value={rate(pay.effRate)} note={plan.tierMode === 'all' ? 'Every hour at the tier rate' : 'Blended across the tiers'} />
                  <QualCard accent={plan.payType === 'flat_clock' ? '#fbbf24' : '#38bdf8'} title="Pay Type"
                    value={plan.payType === 'flat_clock' ? 'Clock + Flat' : 'Flat Rate'}
                    note={plan.payType === 'flat_clock'
                      ? (plan.clockMode === 'greater' ? `Guarantee ${money(pay.clockPotential)}/wk` : `+ ${money(pay.clockPotential)}/wk clock`)
                      : 'Paid on flagged hours only'} />
                </div>

                <div style={{ background: 'linear-gradient(180deg, rgba(30,41,59,.7), rgba(15,23,42,.55))', border: '1px solid rgba(148,163,184,.2)', borderRadius: 18, overflow: 'hidden', marginBottom: 18, boxShadow: '0 16px 40px -26px rgba(0,0,0,.9)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', background: mode === 'pacing' ? 'linear-gradient(90deg, rgba(52,211,153,.18), transparent)' : 'linear-gradient(90deg, rgba(56,189,248,.18), transparent)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
                    <span style={{ width: 4, height: 18, borderRadius: 2, background: mode === 'pacing' ? 'linear-gradient(180deg,#34d399,#10b981)' : 'linear-gradient(180deg,#38bdf8,#0ea5e9)' }} />
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.05em' }}>{mode === 'pacing' ? 'Pacing Pay Breakdown' : 'Banked Pay Breakdown'}</div>
                  </div>
                  {calc.basis.excluded > 0 && (
                    <Row label={`Holiday / PTO / Training (${hrs1(calc.basis.excluded)} hrs)`} value="Not paid"
                      valueColor="#94a3b8" sub="This pay plan is not eligible for those hours, so they're left out below" subColor="#94a3b8" muted />
                  )}
                  {pay.bands.length === 0 && <Row label="Flat Rate Pay" value={money(0)} sub="No hours turned yet this week" subColor="#94a3b8" muted />}
                  {pay.bands.map((b, i) => (
                    <Row key={i} label={`Flat Rate — ${b.label} (${rate(b.rate)}/hr × ${hrs1(b.hours)} hrs)`} value={money(b.amount)} />
                  ))}
                  {plan.payType === 'flat_clock' && plan.clockMode === 'add' && (
                    <Row label={`Clock Pay (${rate(plan.clockRate)}/hr × ${hrs1(plan.clockHours)} clock hrs)`} value={money(pay.clockPay)} valueColor="#fcd34d" tint="rgba(251,191,36,.08)" />
                  )}
                  {plan.payType === 'flat_clock' && plan.clockMode === 'greater' && (
                    <Row label={`Clock Guarantee (${rate(plan.clockRate)}/hr × ${hrs1(plan.clockHours)} clock hrs)`}
                      value={pay.guaranteeApplied ? money(pay.clockPotential) : `${money(pay.clockPotential)} — not used`}
                      valueColor={pay.guaranteeApplied ? '#fcd34d' : '#94a3b8'}
                      sub={pay.guaranteeApplied ? 'Flat rate is below the guarantee, so the guarantee is paid' : 'Flat rate is above the guarantee'}
                      subColor="#94a3b8" muted={!pay.guaranteeApplied} tint={pay.guaranteeApplied ? 'rgba(251,191,36,.08)' : undefined} />
                  )}
                  <Row label={mode === 'pacing' ? 'Pacing Pay (Full Week)' : 'Banked This Week'} value={money(pay.gross)} strong net netColor={mode === 'pacing' ? '#34d399' : '#38bdf8'} />
                </div>

                <div style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'linear-gradient(90deg, rgba(167,139,250,.16), transparent)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
                    <span style={{ width: 4, height: 16, borderRadius: 2, background: 'linear-gradient(180deg,#a78bfa,#8b5cf6)' }} />
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '.05em' }}>Flat Rate Tiers</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', padding: '8px 18px', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                    <div>Flagged Hours (week)</div><div style={{ textAlign: 'right' }}>$/hr</div>
                  </div>
                  {pay.tiers.map((t, i) => {
                    const here = i === pay.tierIdx;
                    return (
                      <div key={t.label} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', padding: '10px 18px', fontSize: 13.5, alignItems: 'center', background: here ? 'linear-gradient(90deg, rgba(52,211,153,.2), rgba(52,211,153,.05))' : 'transparent', borderBottom: '1px solid rgba(148,163,184,.06)', boxShadow: here ? 'inset 3px 0 0 #34d399' : 'none' }}>
                        <div style={{ fontWeight: here ? 900 : 600, color: here ? '#6ee7b7' : '#cbd5e1' }}>{here ? '▶ ' : ''}{t.label}</div>
                        <div style={{ textAlign: 'right', fontWeight: 900, color: here ? '#6ee7b7' : '#a78bfa' }}>{rate(t.rate)}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', marginTop: 14, lineHeight: 1.6 }}>
                  Banked is the hours already turned this week. Pacing projects the full week from the current daily pace
                  (hours ÷ days worked × the week's workdays), the same number the Tech Hours board shows.
                  {plan.tierMode === 'all'
                    ? ' A tier bump lifts every hour that week to the higher rate.'
                    : ' A tier bump applies only to the hours above the threshold.'}
                  {' '}Final pay is calculated by payroll after the week closes.
                  {' '}<strong style={{ color: '#fdba74', fontWeight: 900 }}>
                    These are gross figures — pre-tax and before any payroll deductions.
                  </strong>
                </div>

                <HistoryPanel techName={firstWord(selected.name)} currentWeekStart={weekBounds().start} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- history */

/* Past weeks, newest first. The Tech Hours board is cleared when a week is
 * closed out, so this is the only place a finished week survives. The figures
 * stored are the ones that were true when the week closed — a pay plan edited
 * later doesn't rewrite what someone was already told they earned. */
function HistoryPanel({ techName, currentWeekStart }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    loadTechPayHistory(techName)
      .then(h => {
        if (!alive) return;
        const list = Object.values(h || {})
          .filter(r => r && r.weekStart)
          .sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0));
        setRows(list);
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [techName]);

  const weekLabel = (r) => {
    const fmt = (iso) => {
      const [y, m, d] = String(iso || '').split('-').map(Number);
      if (!y || !m || !d) return iso || '';
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return r.weekEnd ? `${fmt(r.weekStart)} – ${fmt(r.weekEnd)}` : fmt(r.weekStart);
  };

  return (
    <div style={{ marginTop: 18, background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 16, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'linear-gradient(90deg, rgba(56,189,248,.16), transparent)', border: 'none', borderBottom: open ? '1px solid rgba(148,163,184,.14)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: 'linear-gradient(180deg,#38bdf8,#0ea5e9)' }} />
        <div style={{ flex: 1, fontSize: 12, fontWeight: 900, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Weekly History{rows && rows.length ? ` (${rows.length} week${rows.length === 1 ? '' : 's'})` : ''}
        </div>
        <span style={{ color: '#7dd3fc', fontWeight: 900, fontSize: 13 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        rows === null ? (
          <div style={{ padding: '18px', color: '#94a3b8', fontSize: 13.5, fontWeight: 700 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '18px', color: '#94a3b8', fontSize: 13.5, fontWeight: 700, lineHeight: 1.5 }}>
            No finished weeks yet. Each week is stored when it&rsquo;s closed out on the Tech Hours board.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 540 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr .9fr .8fr 1fr .9fr', padding: '8px 18px', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                <div>Week</div>
                <div style={{ textAlign: 'right' }}>Hours Paid</div>
                <div style={{ textAlign: 'right' }}>Rate</div>
                <div style={{ textAlign: 'right' }}>Pay</div>
                <div style={{ textAlign: 'right' }}>Status</div>
              </div>
              {rows.map(r => {
                const live = r.weekStart === currentWeekStart && !r.closed;
                return (
                  <div key={r.weekStart} style={{ display: 'grid', gridTemplateColumns: '1.5fr .9fr .8fr 1fr .9fr', padding: '10px 18px', fontSize: 13.5, alignItems: 'center', borderBottom: '1px solid rgba(148,163,184,.06)', background: live ? 'rgba(52,211,153,.06)' : 'transparent' }}>
                    <div style={{ fontWeight: 800, color: '#cbd5e1' }}>
                      {weekLabel(r)}
                      {r.ptoHours > 0 && !r.ptoPaid && (
                        <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                          {hrs1(r.ptoHours)} PTO hrs not paid
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', color: '#cbd5e1', fontWeight: 700 }}>{hrs1(r.hours)}</div>
                    <div style={{ textAlign: 'right', color: '#a78bfa', fontWeight: 800 }}>{rate(r.rate)}</div>
                    <div style={{ textAlign: 'right', color: '#38bdf8', fontWeight: 900 }}>{money(r.pay)}</div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 800, color: r.closed ? '#6ee7b7' : '#fbbf24' }}>
                      {r.closed ? 'Final' : 'In progress'}
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: '12px 18px', fontSize: 12.5, fontWeight: 700, color: '#64748b', lineHeight: 1.5 }}>
                A week marked Final was closed out and adjusted by a manager — those are the figures that stand.
                All amounts are gross, before tax and deductions.
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

const inputStyle = {
  width: '100%', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.28)',
  borderRadius: 10, padding: '10px 12px', color: '#e2e8f0', fontSize: 15, fontWeight: 700,
};
const labelStyle = { fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 };

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={labelStyle}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

function Choice({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            style={{
              flex: '1 1 180px', textAlign: 'left',
              background: on ? 'linear-gradient(135deg,rgba(52,211,153,.28),rgba(14,165,233,.18))' : 'rgba(255,255,255,.04)',
              border: `1px solid ${on ? 'rgba(52,211,153,.7)' : 'rgba(148,163,184,.2)'}`,
              color: on ? '#e2e8f0' : '#94a3b8', borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
            }}>
            <div style={{ fontWeight: 900, fontSize: 13.5 }}>{on ? '✓ ' : ''}{o.label}</div>
            {o.note && <div style={{ fontSize: 11.5, color: on ? '#94a3b8' : '#64748b', marginTop: 2, lineHeight: 1.4 }}>{o.note}</div>}
          </button>
        );
      })}
    </div>
  );
}

function SetupPanel({ techName, plan, onSaved }) {
  const [form, setForm] = useState(plan);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Switching techs while the Setup tab is open must load that tech's plan.
  useEffect(() => { setForm(plan); setMsg(''); }, [techName]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const numField = (k) => ({
    value: form[k] === 0 && k !== 'tier1Hours' && k !== 'tier2Hours' && k !== 'clockHours' ? '' : form[k],
    onChange: e => set(k, e.target.value === '' ? 0 : parseFloat(e.target.value) || 0),
  });

  async function save() {
    setSaving(true); setMsg('');
    try {
      const clean = normalizePlan(form);
      await saveTechPayPlan(techName, clean);
      onSaved(clean);
      setMsg('Saved.');
    } catch (e) {
      setMsg(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const preview = computeTechPay(form, 50);
  const ladder = tiersOf(form);

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <div style={{ background: 'linear-gradient(180deg, rgba(30,41,59,.7), rgba(15,23,42,.55))', border: '1px solid rgba(148,163,184,.2)', borderRadius: 18, padding: '20px 24px' }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#e2e8f0', marginBottom: 4 }}>Pay Setup — {techName}</div>
        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 20 }}>
          Everything here is per technician and per week, matching the Tech Hours board.
        </div>

        <Field label="Pay Type">
          <Choice value={form.payType} onChange={v => set('payType', v)} options={[
            { value: 'flat', label: 'Flat rate only', note: 'Paid on flagged hours' },
            { value: 'flat_clock', label: 'Clock + flat rate', note: 'Also paid for clock hours' },
          ]} />
        </Field>

        <Field label="Base Flat Rate ($ per flagged hour)">
          <input type="number" step="0.01" min="0" placeholder="0.00" style={inputStyle} {...numField('flatRate')} />
        </Field>

        <div style={{ height: 1, background: 'rgba(148,163,184,.14)', margin: '4px 0 18px' }} />
        <div style={{ fontSize: 12, fontWeight: 900, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Tier Bumps</div>

        <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12, lineHeight: 1.45 }}>
          Bumps <strong>stack</strong>: tier 1 adds to the base rate, tier 2 adds to tier 1. A $31.00 base with
          bumps of 2 and 2 pays $31.00, then $33.00, then $35.00. Leave a bump blank and that tier carries the
          rate below it forward.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          <Field label={`Tier 1 — hours (default ${TIER1_HOURS})`}>
            <input type="number" step="0.5" min="0" style={inputStyle} {...numField('tier1Hours')} />
          </Field>
          <Field label="Tier 1 bump (+$/hr on base)" hint={`Pays ${rate(ladder[1].rate)}/hr past ${hrs1(form.tier1Hours)} hrs`}>
            <input type="number" step="0.01" min="0" placeholder="0.00" style={inputStyle} {...numField('tier1Bump')} />
          </Field>
          <Field label={`Tier 2 — hours (default ${TIER2_HOURS})`}>
            <input type="number" step="0.5" min="0" style={inputStyle} {...numField('tier2Hours')} />
          </Field>
          <Field label="Tier 2 bump (+$/hr on tier 1)" hint={`Pays ${rate(ladder[2].rate)}/hr past ${hrs1(form.tier2Hours)} hrs`}>
            <input type="number" step="0.01" min="0" placeholder="0.00" style={inputStyle} {...numField('tier2Bump')} />
          </Field>
        </div>

        <Field label="Holiday / PTO / training hours"
          hint="The dashboard fills 8 hours into a day the calendar marks off. Switch this off and those hours are left out of this tech's pay — and out of the pace, so a holiday week isn't projected across days they were never going to work.">
          <Choice value={form.eligiblePto === false ? 'no' : 'yes'} onChange={v => set('eligiblePto', v === 'yes')} options={[
            { value: 'yes', label: 'Eligible — paid', note: 'Filled hours count toward pay' },
            { value: 'no', label: 'Not eligible', note: 'Filled hours are excluded from pay' },
          ]} />
        </Field>

        <Field label="How a bump is applied" hint="Shops write this both ways — pick the one on this tech's pay plan.">
          <Choice value={form.tierMode} onChange={v => set('tierMode', v)} options={[
            { value: 'all', label: 'All hours at the new rate', note: 'Hitting the tier lifts every hour that week' },
            { value: 'above', label: 'Only hours above the tier', note: 'Each band of hours paid at its own rate' },
          ]} />
        </Field>

        {form.payType === 'flat_clock' && (
          <>
            <div style={{ height: 1, background: 'rgba(148,163,184,.14)', margin: '4px 0 18px' }} />
            <div style={{ fontSize: 12, fontWeight: 900, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Clock Pay</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
              <Field label="Clock rate ($/hr)">
                <input type="number" step="0.01" min="0" placeholder="0.00" style={inputStyle} {...numField('clockRate')} />
              </Field>
              <Field label="Clock hours per week">
                <input type="number" step="0.5" min="0" style={inputStyle} {...numField('clockHours')} />
              </Field>
            </div>
            <Field label="How clock pay combines with flat rate">
              <Choice value={form.clockMode} onChange={v => set('clockMode', v)} options={[
                { value: 'add', label: 'Added to flat rate', note: 'Clock pay plus flat rate pay' },
                { value: 'greater', label: 'Guarantee (greater of)', note: 'Paid whichever is higher, not both' },
              ]} />
            </Field>
          </>
        )}

        <div style={{ background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px', marginBottom: 18 }}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>Check figure</div>
          <div style={{ fontSize: 14, color: '#cbd5e1' }}>
            A 50-hour week on this plan pays <strong style={{ color: '#6ee7b7', fontSize: 17 }}>{money(preview.gross)}</strong>
            {' '}({rate(preview.effRate)}/hr effective)
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={save} disabled={saving}
            style={{ background: 'linear-gradient(135deg,#34d399,#0ea5e9)', border: 'none', color: '#04121a', borderRadius: 12, padding: '11px 26px', cursor: saving ? 'default' : 'pointer', fontWeight: 900, fontSize: 14.5, opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : `Save ${techName}'s Plan`}
          </button>
          {msg && <span style={{ fontSize: 13, fontWeight: 700, color: msg === 'Saved.' ? '#6ee7b7' : '#fca5a5' }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
