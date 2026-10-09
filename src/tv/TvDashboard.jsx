// Shop TV dashboard — /Rohrmanhyundai/dashboard/
//
// A separate page from the main dashboard (its own Vite entry, like the Sales
// Board) built for the Samsung TV: no login, no header, everything on one
// 1920×1080 screen. Technicians get a box each on top with the Sat→Fri pay
// week's daily hours along the bottom; the advisor half underneath is the main
// dashboard's own Training/Vacation tickers, Advisor Performance and gauges.
//
// Everything is read from the public data files on GitHub Pages, so it needs
// no sign-in and never writes anything. It re-reads every 90 seconds and
// reloads itself when an admin presses Force Refresh.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TickerStrip, vacationItemsFor } from '../components/TickerPanel';
import TrainingBadge from './TrainingBadge';
import TvAdvisors from './TvAdvisors';
import Gauges from '../components/Gauges';
import { useTwoWeekEfficiency, MiniGauge } from '../components/techEfficiency';
import { recalcTech, recalcAdvisorSummary, weekDatesOf } from '../utils/calculations';
import { fetchLiveJson } from '../utils/liveData';

// Live from the repo (see utils/liveData) — the site's own /data/ copy lags.
const fetchJson = (path) => fetchLiveJson(path);

const r1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
const ceil1 = (n) => (Math.ceil((Number(n) || 0) * 10 - 1e-9) / 10).toFixed(1);
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };

// Pay week runs Saturday → Friday.
const WEEK = [['sat', 'Sat'], ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri']];

async function loadAll() {
  const [payload, schedules, former, usersFile, bigMoney] = await Promise.all([
    fetchJson('data.json'), fetchJson('schedules.json'), fetchJson('former-employees.json'),
    fetchJson('users.json'), fetchJson('big-money-lof.json'),
  ]);
  if (!payload || !payload.data) return null;
  const d = payload.data;
  // Same roster rule as the main dashboard: anyone in the former-employees
  // registry is off the board unless they have a live user account again.
  const gone = new Set((Array.isArray(former) ? former : []).map(f => firstWord(f.username)));
  const active = new Set(((usersFile && usersFile.users) || []).map(u => firstWord(u.username)));
  if (gone.size) {
    const out = (name) => gone.has(firstWord(name)) && !active.has(firstWord(name));
    d.technicians = (d.technicians || []).filter(t => !out(t.name));
    d.advisors = (d.advisors || []).filter(a => !out(a.name));
    d.advisorTraining = (d.advisorTraining || []).filter(a => !out(a.name));
  }
  d.techTotals = d.techTotals || {};
  recalcTech(d, schedules || {});
  recalcAdvisorSummary(d);
  const vacations = Array.isArray(payload.vacations) ? payload.vacations : (d.vacations || []);
  return { data: d, vacations, bigMoney: bigMoney && typeof bigMoney === 'object' ? bigMoney : {} };
}

function TechBox({ t, eff, dates, today }) {
  // Rounded to the tenth the box shows, so "needs" is goal minus what's on screen.
  const goal = Number(t.goal) || 0, total = Math.round((Number(t.total) || 0) * 10) / 10;
  const need = Math.max(0, goal - total);
  const met = goal > 0 && need <= 0;
  const pct = goal > 0 ? total / goal : 0;
  const col = met ? '#4ade80' : pct >= 0.5 ? '#fde047' : '#fca5a5';
  const pace = Number(t.pacing) || 0, paceOk = pace >= goal;
  return (
    // Met the goal, or pacing to it: the same green glow as a hit scorecard tile.
    <div className={`tvd-tech${met || (goal > 0 && paceOk) ? ' glow' : ''}`} style={{ borderColor: `${col}66` }}>
      <div className="tvd-tech-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tvd-tech-name">{t.name} <TrainingBadge p={t} /></div>
          <div className="tvd-tech-total" style={{ color: col }}>
            {r1(total)}<span> / {r1(goal)} hrs</span>
          </div>
        </div>
        <div className="tvd-eff" title={eff ? `Average goal % over the last ${eff.weeks} completed week${eff.weeks === 1 ? '' : 's'}` : 'No completed weeks on file yet'}>
          <MiniGauge pct={eff ? eff.pct : null} />
          <div>2-wk efficiency</div>
        </div>
      </div>
      <div className="tvd-bar"><div style={{ width: `${Math.min(100, pct * 100)}%`, background: col }} /></div>
      <div className="tvd-tech-line">
        <span style={{ color: met ? '#86efac' : '#fecaca' }}>
          {met ? `✓ Goal met · +${r1(total - goal)}` : `Needs ${ceil1(need)} hrs`}
        </span>
        {goal > 0 && (
          <span style={{ color: '#94a3b8' }}>
            {' · '}📈 Pacing <span style={{ color: paceOk ? '#4ade80' : '#fbbf24' }}>{r1(pace)}</span>
            <span style={{ color: paceOk ? '#86efac' : '#fca5a5' }}> ({paceOk ? '+' : '−'}{r1(Math.abs(pace - goal))})</span>
          </span>
        )}
      </div>
      <div className="tvd-days">
        {WEEK.map(([k, label]) => {
          const v = Number(t[k]) || 0;
          const iso = dates[k];
          const isToday = iso === today;
          const future = iso > today && v === 0;
          return (
            <div key={k} className={`tvd-day${isToday ? ' today' : ''}`}>
              <div className="lbl">{label} <span>{shortDate(iso)}</span></div>
              <div className="val" style={{ color: future ? '#475569' : v > 0 ? '#f1f5f9' : '#64748b' }}>{future ? '—' : r1(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TechPanel({ data, vacations }) {
  const techs = (data.technicians || []).filter(t => t && t.name && !t.hidden);
  const eff = useTwoWeekEfficiency(techs.map(t => t.name));
  const dates = weekDatesOf(new Date());
  const today = isoToday();
  const tt = data.techTotals || {};
  const goalSum = techs.reduce((s, t) => s + (Number(t.goal) || 0), 0);
  const cols = Math.max(1, Math.ceil(techs.length / 2));
  return (
    <section className="card tvd-techs">
      <div className="tvd-head">
        <div className="title">Technician Production</div>
        <div className="note">Week of {shortDate(dates.sat)} – {shortDate(dates.fri)} · Sat → Fri</div>
        {/* Vacation Approved rides in the header — a touch slower than the
            main dashboard's 55 px/s so it's easy to read from across the shop. */}
        <div className="tvd-vac"><TickerStrip label="🏖 Vacation" items={vacationItemsFor(data, vacations)} speed={42} inline /></div>
        <div className="chip">Shop {r1(tt.week_total)} / {r1(goalSum)} hrs</div>
        <div className="chip chip--pacing">Shop Pacing {r1(tt.shop_pacing)} hrs</div>
      </div>
      <div className="tvd-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {techs.map(t => <TechBox key={t.name} t={t} eff={eff[t.name]} dates={dates} today={today} />)}
      </div>
    </section>
  );
}

export default function TvDashboard() {
  const [state, setState] = useState(null);
  const [tick, setTick] = useState(0);
  const stageRef = useRef(null);

  const refresh = useCallback(() => { loadAll().then(s => { if (s) { setState(s); setTick(t => t + 1); } }); }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 90 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // Force Refresh from Edit Dashboard reloads this page too (cache-busted, so a
  // new deploy actually reaches the TV). First read is the baseline.
  useEffect(() => {
    let seen = null;
    const check = async () => {
      const rec = await fetchJson('force-refresh.json');
      const ts = rec && rec.ts;
      if (!ts) return;
      if (seen == null) { seen = ts; return; }
      if (ts > seen) {
        const u = new URL(window.location.href);
        u.searchParams.set('_v', String(ts));
        window.location.replace(u.toString());
      }
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Design is 1920×1080 and always fills the whole window edge to edge: a
  // 16:9 TV gets it exactly; a taller window stretches the rows (extra height
  // split between the tech boxes and the advisor panels), a wider one
  // stretches the columns. No bars, no scrolling.
  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / 1920, vh / 1080);
    const w = Math.round(vw / scale), h = Math.round(vh / scale);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.setProperty('--stage-extra-h', `${h - 1080}px`);
    el.classList.toggle('stage--stretched', h > 1080);
    el.style.transform = `scale(${scale})`;
  }, []);
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  const setStage = useCallback((el) => { stageRef.current = el; if (el) fit(); }, [fit]);

  // Full-screen button for a computer preview: shows when the mouse moves,
  // hides after a few seconds so it never sits on the TV picture.
  const [showFs, setShowFs] = useState(false);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    let t;
    const wake = () => { setShowFs(true); clearTimeout(t); t = setTimeout(() => setShowFs(false), 3000); };
    const onFs = () => { setIsFs(!!document.fullscreenElement); setTimeout(fit, 50); };
    window.addEventListener('mousemove', wake);
    document.addEventListener('fullscreenchange', onFs);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); document.removeEventListener('fullscreenchange', onFs); };
  }, [fit]);
  const toggleFs = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch { /* not supported */ }
  };

  return (
    <div className="viewport">
      {document.fullscreenEnabled && (
        <button onClick={toggleFs} className={`tvd-fs${showFs ? ' on' : ''}`} title="Full screen (Esc to exit)">
          {isFs ? '⤡ Exit full screen' : '⛶ Full screen'}
        </button>
      )}
      <div className="stage" ref={setStage}>
        {state ? (
          <div className="tvdash">
            <TechPanel data={state.data} vacations={state.vacations} />
            <TvAdvisors data={state.data} tick={tick} />
            <Gauges data={state.data} bigMoney={state.bigMoney} animated />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 28, fontWeight: 800 }}>
            Loading dashboard…
          </div>
        )}
      </div>
    </div>
  );
}
