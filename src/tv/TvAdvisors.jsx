// Advisor Performance for the shop TV dashboard — the Daily Wrench scorecard
// look (glowing ring per goal, green when hit) with the same goals and the
// same "how many to sell today" math (components/scorecard.jsx). Under goal on
// a sell-able number, the ring shows how many to sell today to be back at
// goal; at goal it shows the number itself.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { n, pct, safe } from '../utils/formatters';
import { advisorDailyAverage, advisorProjectedHours, advisorsForDisplay, advisorMonthStarted } from '../utils/calculations';
import { SC_CSS, Ring, scoreMetrics, sellPlan, todayCounts } from '../components/scorecard';
import { appointmentFacts } from '../utils/dailyWrench.mjs';

const BASE = import.meta.env.BASE_URL;
const firstUp = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Today's appointment list (re-read with the rest of the board), so "to sell
// today" uses each advisor's booked cars like the Daily Wrench does.
function useTodayAppts(tick) {
  const [list, setList] = useState(null);
  const date = isoToday();
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}data/appointments/${date}.json?v=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(j => { if (!cancelled) setList(j); });
    return () => { cancelled = true; };
  }, [date, tick]);
  return list;
}

// Height of the advisor row, so the rings grow with the screen.
function useHeight() {
  const ref = useRef(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}

function AdvisorRow({ a, data, team, today }) {
  const [ref, h] = useHeight();
  const metrics = scoreMetrics(data);
  const val = (x, k) => Number(x && x[k]) || 0;
  const rows = metrics.map(m => {
    const v = val(a, m.key);
    const hit = v >= m.goal - 1e-9;
    const best = team.length > 1 && team.every(o => o === a || val(o, m.key) < v) && v > 0;
    return { ...m, v, hit, best, plan: hit ? null : sellPlan(m, a, today) };
  });
  const hits = rows.filter(r => r.hit).length;
  const share = rows.length ? hits / rows.length : 0;
  const ringCol = share >= 0.75 ? '#4ade80' : share >= 0.45 ? '#facc15' : '#f87171';
  const pace = advisorProjectedHours(a, data);
  const lastMonth = Number(a.last_month_total) || 0;
  // Ring diameter from the row height: label + ring + two short lines fit.
  const ring = Math.max(60, Math.min(150, Math.round((h || 160) * 0.5)));
  const fs = ring / 78; // font scale relative to the Daily Wrench's 78px ring

  return (
    <div className="tvd-adv" ref={ref}>
      <div className="tvd-adv-who">
        <div className="nm">{a.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Ring frac={share} color={ringCol} size={Math.round(ring * 0.9)} stroke={Math.max(6, Math.round(ring / 11))}>
            <div style={{ fontSize: 24 * fs, fontWeight: 1000, color: ringCol, lineHeight: 1 }}>{hits}<span style={{ fontSize: 13 * fs, color: '#94a3b8' }}>/{rows.length}</span></div>
            <div style={{ fontSize: 8 * fs, fontWeight: 900, color: '#94a3b8', letterSpacing: '.06em' }}>GOALS HIT</div>
          </Ring>
          <div style={{ minWidth: 0 }}>
            <div className="k">Daily avg</div>
            <div className="v" style={{ color: '#6ee7f9' }}>{n(advisorDailyAverage(a, data), 2)}</div>
            <div className="k">Pacing</div>
            <div className="v" style={{ color: lastMonth > 0 ? (pace >= lastMonth ? '#4ade80' : '#f87171') : '#f1f5f9' }}>{pace.toFixed(1)}</div>
          </div>
        </div>
        <div className="sub">MTD <b>{n(a.mtd_hours, 1)}</b> · {Number(a.ro_count) || 0} ROs · Last mo <b>{n(lastMonth, 1)}</b></div>
      </div>
      <div className="tvd-adv-tiles">
        {rows.map(r => {
          const col = r.hit ? '#4ade80' : r.v / r.goal >= 0.85 ? '#facc15' : '#f87171';
          const sellCount = r.plan && r.plan.kind === 'count' && r.plan.need > 0;
          return (
            <div key={r.key} className={`sc-tile ${r.hit ? 'hit' : 'miss'}`}>
              {r.best ? <span className="sc-crown" style={{ top: 6, fontSize: 13 * fs }} title="Best on the team">👑</span> : null}
              <div className="lbl" style={{ fontSize: Math.max(11, 11 * fs) }}>{r.label}</div>
              <Ring frac={r.v / r.goal} color={col} size={ring} stroke={Math.max(6, Math.round(ring / 11))}>
                {sellCount ? (
                  <div style={{ lineHeight: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 27 * fs, fontWeight: 1000, color: col }}>{r.plan.need}</div>
                    <div style={{ fontSize: 8.5 * fs, fontWeight: 900, color: '#cbd5e1', letterSpacing: '.06em', marginTop: 2 }}>TO SELL</div>
                  </div>
                ) : <div style={{ fontSize: 17 * fs, fontWeight: 1000, color: col }}>{r.fmt(r.v)}</div>}
              </Ring>
              <div className="tvd-sc-goal" style={{ fontSize: Math.max(12, 12 * fs) }}>
                {sellCount ? <>now {r.fmt(r.v)} · goal {r.fmt(r.goal)}</> : <>goal {r.fmt(r.goal)}</>}
              </div>
              <div className="tvd-sc-gap" style={{ fontSize: Math.max(12, 12.5 * fs), color: r.hit ? '#86efac' : '#fca5a5' }}>
                {r.hit ? '✓ HIT'
                  : sellCount ? `${r.plan.need} today = goal`
                  : `▼ ${r.gap(r.goal - r.v)} to go`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TvAdvisors({ data, tick }) {
  const started = advisorMonthStarted();
  const team = advisorsForDisplay(data).filter(a => !a.hidden);
  const sum = started ? (data.advisorSummary || {}) : {};
  const appts = useTodayAppts(tick);
  const avgs = [
    ['Align', pct(sum.align, 1)], ['Tires', pct(sum.tires, 1)],
    ['Valvoline', pct(sum.valvoline, 1)], ['CSI', Math.round(safe(sum.csi)).toString()],
  ];
  return (
    <section className="card tvd-advs">
      <style>{SC_CSS}</style>
      <div className="tvd-head">
        <div className="title">Advisor Performance</div>
        <div className="note">Snapshot {started ? (data.advisorSummary && data.advisorSummary.date) || '—' : '—'} · ring number = how many to sell today to be back at goal</div>
        <div style={{ flex: 1 }} />
        {avgs.map(([k, v]) => <div className="tvd-avg" key={k}>Shop {k} <b>{v}</b></div>)}
      </div>
      <div className="tvd-adv-list" style={{ gridTemplateRows: `repeat(${Math.max(1, team.length)}, minmax(0, 1fr))` }}>
        {team.map(a => {
          const ap = appts ? appointmentFacts(appts, firstUp(a.name), 0) : null;
          return <AdvisorRow key={a.name} a={a} data={data} team={team} today={todayCounts(a, data, ap)} />;
        })}
      </div>
    </section>
  );
}
