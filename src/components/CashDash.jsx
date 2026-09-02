import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadCashDash, updateCashDash, loadGithubFile } from '../utils/github';
import CashDashUpload from './CashDashUpload';

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
    warning: 'PTO / Vacation / Holiday time does NOT count toward hours — must be SOLD hours.',
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

// Season state, stored alongside the month buckets in cash-dash.json so turning
// the board off never deletes a thing — next year's run just flips it back.
//   active — hours track live figures, managers can edit
//   frozen — the month's final numbers, locked, still visible to everyone
//   off    — hidden from staff; managers keep the tile so they can turn it back on
export const SEASON = { ACTIVE: 'active', FROZEN: 'frozen', OFF: 'off' };
export const seasonOf = (cashDashFile) => {
  const st = cashDashFile && cashDashFile.season && cashDashFile.season.status;
  return st === SEASON.FROZEN || st === SEASON.OFF ? st : SEASON.ACTIVE;
};

export default function CashDash({ currentUser, currentRole, advisors = [], technicians = [], onBack, onSeasonChange }) {
  const me = firstName(currentUser);
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');

  const [techHours, setTechHours] = useState({}); // { NAME: hours } manual override for PLAN.monthKey
  const [advHours, setAdvHours] = useState({});   // { NAME: hours } manual override for advisors
  const [autoTech, setAutoTech] = useState({});    // { NAME: hours } auto-summed from the daily posts
  const [repCount, setRepCount] = useState('');    // Reputation.com survey/review count
  const [repScore, setRepScore] = useState('');    // Reputation.com score
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [season, setSeason] = useState(SEASON.ACTIVE);
  const [seasonBusy, setSeasonBusy] = useState('');
  // Frozen and off are both read-only: the month is done, so nothing recalculates.
  const readOnly = season !== SEASON.ACTIVE;

  const refresh = useCallback(async () => {
    try {
      const all = await loadCashDash();
      setSeason(seasonOf(all));
      const b = (all && all[PLAN.monthKey]) || {};
      setTechHours(b.techHours || {});
      setAdvHours(b.advHours || {});
      setRepCount(b.repCount != null ? b.repCount : '');
      setRepScore(b.repScore != null ? b.repScore : '');
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Auto-fill each tech's month-to-date booked hours from their daily posts:
  // sum the weekly snapshots (performance-reports) whose week falls in the plan
  // month. Managers can still override a value by typing.
  const techKey = useMemo(() => (technicians || []).map(t => firstName(t.name)).filter(Boolean).sort().join(','), [technicians]);
  useEffect(() => {
    const names = techKey ? techKey.split(',') : [];
    if (!names.length || readOnly) { setAutoTech({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(names.map(async n => {
        try {
          const rep = await loadGithubFile(`data/performance-reports/${n}.json`);
          const arr = Array.isArray(rep) ? rep : [];
          const sum = arr
            .filter(s => s && s.type === 'tech' && String(s.weekStart || s.date || '').slice(0, 7) === PLAN.monthKey)
            // Cash Dash pays on raw hours — warranty, customer pay and internal
            // at face value, with no warranty multiplier. Older snapshots (and
            // hand-entered weeks) have no total_raw, so fall back to total.
            .reduce((a, s) => a + num(s.total_raw != null ? s.total_raw : s.total), 0);
          return [n, Math.round(sum * 10) / 10];
        } catch { return [n, 0]; }
      }));
      if (!cancelled) setAutoTech(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [techKey, readOnly]);

  async function saveRep(field, val) {
    if (readOnly) return;
    if (field === 'count') setRepCount(val); else setRepScore(val);
    try {
      await updateCashDash(cur => {
        const bucket = { techHours: {}, ...(cur[PLAN.monthKey] || {}) };
        if (field === 'count') bucket.repCount = num(val); else bucket.repScore = num(val);
        bucket.updatedAt = Date.now();
        return { ...cur, [PLAN.monthKey]: bucket };
      });
    } catch {}
  }

  const pace = useMemo(() => (readOnly ? { total: 1, elapsed: 1 } : bizDays()), [readOnly]);

  // Rosters. Advisors carry mtd_hours (hours sold); techs pull from techHours.
  const advisorRows = useMemo(() => (advisors || [])
    .filter(a => a && a.name)
    .map(a => {
      const k = firstName(a.name);
      const override = advHours[k];
      const hasOverride = override != null && String(override).trim() !== '';
      // Once frozen, the advisor's live MTD hours belong to a NEW month — following
      // them would quietly rewrite the finished board. Only the captured figure counts.
      const auto = readOnly ? 0 : num(a.mtd_hours);
      const hours = hasOverride ? num(override) : auto;        // override wins, else the advisor's MTD hours
      const raw = hasOverride ? override : (auto ? String(auto) : '');
      return { name: k, display: a.name, role: 'advisor', hours, raw, auto, overridden: hasOverride };
    })
    .sort((x, y) => x.name.localeCompare(y.name)), [advisors, advHours, readOnly]);
  const techRows = useMemo(() => (technicians || [])
    .filter(t => t && t.name)
    .map(t => {
      const k = firstName(t.name);
      const override = techHours[k];
      const hasOverride = override != null && String(override).trim() !== '';
      const auto = readOnly ? 0 : num(autoTech[k]);
      const hours = hasOverride ? num(override) : auto;         // override wins, else auto from posts
      const raw = hasOverride ? override : (auto ? String(auto) : '');
      return { name: k, display: t.name, role: 'tech', hours, raw, auto, overridden: hasOverride };
    })
    .sort((x, y) => x.name.localeCompare(y.name)), [technicians, techHours, autoTech, readOnly]);

  // Who is the logged-in user (for the self view)?
  const selfRow = useMemo(() => advisorRows.find(r => r.name === me) || techRows.find(r => r.name === me) || null,
    [advisorRows, techRows, me]);

  const [selected, setSelected] = useState(null); // manager-drilldown target
  const target = selected || (!isManager ? selfRow : null);

  async function setTech(name, val) {
    if (readOnly) return;
    const key = firstName(name);
    const empty = String(val).trim() === '';
    setTechHours(prev => { const n = { ...prev }; if (empty) delete n[key]; else n[key] = val; return n; }); // optimistic
    setSaving(key);
    try {
      await updateCashDash(cur => {
        const bucket = { techHours: {}, ...(cur[PLAN.monthKey] || {}) };
        const th = { ...(bucket.techHours || {}) };
        if (empty) delete th[key]; else th[key] = num(val);     // blank clears the override → back to auto
        bucket.techHours = th; bucket.updatedAt = Date.now();
        return { ...cur, [PLAN.monthKey]: bucket };
      });
    } catch {} finally { setSaving(''); }
  }

  async function setAdv(name, val) {
    if (readOnly) return;
    const key = firstName(name);
    const empty = String(val).trim() === '';
    setAdvHours(prev => { const n = { ...prev }; if (empty) delete n[key]; else n[key] = val; return n; }); // optimistic
    setSaving(key);
    try {
      await updateCashDash(cur => {
        const bucket = { techHours: {}, advHours: {}, ...(cur[PLAN.monthKey] || {}) };
        const ah = { ...(bucket.advHours || {}) };
        if (empty) delete ah[key]; else ah[key] = num(val);     // blank clears the override → back to MTD hours
        bucket.advHours = ah; bucket.updatedAt = Date.now();
        return { ...cur, [PLAN.monthKey]: bucket };
      });
    } catch {} finally { setSaving(''); }
  }

  // Move the season between active / frozen / off.
  //
  // Freezing CAPTURES the month's final hours into the manual overrides. It reads
  // each advisor's last snapshot for the plan month rather than their live
  // mtd_hours, which by now has rolled into the next month — capturing what is
  // on screen would bank the wrong figures. A manager's existing typed override
  // always wins over the captured value.
  async function changeSeason(next) {
    if (next === season || seasonBusy) return;
    if (next === SEASON.OFF && !window.confirm('Turn Cash Dash off?\n\nStaff stop seeing it. Nothing is deleted — every hour and pull stays saved, and you can turn it back on any time.')) return;
    setSeasonBusy(next);
    try {
      let advFinal = null, techFinal = null;
      if (next === SEASON.FROZEN) {
        advFinal = {};
        await Promise.all((advisors || []).map(async a => {
          const k = firstName(a.name);
          if (!k) return;
          try {
            const rep = await loadGithubFile(`data/performance-reports/${k}.json`);
            const inMonth = (Array.isArray(rep) ? rep : [])
              .filter(e => String(e.month || e.date || '').slice(0, 7) === PLAN.monthKey)
              .sort((x, y) => new Date(y.date) - new Date(x.date));
            const v = inMonth.length ? num(inMonth[0].mtd_hours) : 0;
            if (v) advFinal[k] = v;
          } catch {}
        }));
        techFinal = { ...autoTech };
      }
      await updateCashDash(cur => {
        const out = { ...(cur || {}) };
        if (advFinal || techFinal) {
          const bucket = { techHours: {}, advHours: {}, ...(out[PLAN.monthKey] || {}) };
          const ah = { ...(bucket.advHours || {}) }, th = { ...(bucket.techHours || {}) };
          const captured = { adv: [], tech: [] };
          for (const [k, v] of Object.entries(advFinal || {})) if (ah[k] == null) { ah[k] = v; captured.adv.push(k); }
          for (const [k, v] of Object.entries(techFinal || {})) if (th[k] == null && v) { th[k] = v; captured.tech.push(k); }
          bucket.advHours = ah; bucket.techHours = th;
          bucket.captured = captured;      // so re-activating can undo exactly these
          bucket.updatedAt = Date.now();
          out[PLAN.monthKey] = bucket;
        }
        if (next === SEASON.ACTIVE) {
          // Re-opening drops the captured figures so the board tracks live again;
          // anything typed by hand is left alone.
          const bucket = { ...(out[PLAN.monthKey] || {}) };
          const cap = bucket.captured || { adv: [], tech: [] };
          const ah = { ...(bucket.advHours || {}) }, th = { ...(bucket.techHours || {}) };
          (cap.adv || []).forEach(k => delete ah[k]);
          (cap.tech || []).forEach(k => delete th[k]);
          bucket.advHours = ah; bucket.techHours = th;
          delete bucket.captured;
          out[PLAN.monthKey] = bucket;
        }
        out.season = { status: next, updatedAt: Date.now(), by: currentUser || '' };
        return out;
      });
      setSeason(next);
      await refresh();
      onSeasonChange && onSeasonChange(next);
    } catch (e) {
      alert('Could not change the season: ' + (e?.message || e));
    } finally {
      setSeasonBusy('');
    }
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

          {/* Where the season stands, and (for managers) how to move it */}
          {season !== SEASON.ACTIVE && (
            <div style={{ background: season === SEASON.OFF ? 'rgba(148,163,184,.1)' : 'rgba(251,191,36,.1)',
                          border: `1px solid ${season === SEASON.OFF ? 'rgba(148,163,184,.35)' : 'rgba(251,191,36,.4)'}`,
                          borderRadius: 14, padding: '14px 18px' }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: season === SEASON.OFF ? '#cbd5e1' : '#fde68a', marginBottom: 4 }}>
                {season === SEASON.OFF ? '🚫 Cash Dash is turned off' : `🔒 ${PLAN.label} is closed out`}
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
                {season === SEASON.OFF
                  ? 'Staff no longer see this page. Every hour, pull and entry is still saved — turn it back on any time.'
                  : 'These are the final numbers. Hours have stopped updating and nothing can be edited, so the board stays exactly as the month ended.'}
              </div>
            </div>
          )}

          {isManager && (
            <div style={{ background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.22)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Season</div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Turning it off hides the page from staff — it never deletes anything.</div>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { k: SEASON.ACTIVE, label: 'Active',  hint: 'Hours keep updating, managers can edit', color: '#6ee7b7' },
                  { k: SEASON.FROZEN, label: 'Frozen',  hint: 'Final numbers, locked, everyone can still view', color: '#fbbf24' },
                  { k: SEASON.OFF,    label: 'Off',     hint: 'Hidden from staff, nothing deleted', color: '#94a3b8' },
                ].map(o => {
                  const on = season === o.k;
                  return (
                    <button key={o.k} onClick={() => changeSeason(o.k)} disabled={!!seasonBusy} title={o.hint}
                      style={{ background: on ? `${o.color}26` : 'rgba(255,255,255,.04)', border: `1px solid ${on ? o.color : 'rgba(255,255,255,.12)'}`,
                               color: on ? o.color : '#94a3b8', borderRadius: 9, padding: '7px 15px', fontWeight: 800, fontSize: 12.5,
                               cursor: seasonBusy ? 'wait' : 'pointer' }}>
                      {seasonBusy === o.k ? '⏳' : on ? '● ' : ''}{o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manager: bulk-set every tech's month booked hours from the report */}
          {isManager && !readOnly && (
            <CashDashUpload technicians={technicians} monthKey={PLAN.monthKey} monthLabel={PLAN.label}
              currentUser={currentUser} onApplied={refresh} />
          )}

          {/* Plan chart — styled reproduction of the qualify/earn-pulls board */}
          <PlanChart />

          {/* Reputation.com department progress — manager enters the count daily */}
          <RepProgress count={num(repCount)} score={num(repScore)} rawCount={repCount} rawScore={repScore} canEdit={isManager && !readOnly} onEdit={saveRep} />

          {target ? (
            <PersonView row={target} tiers={plan(target.role).tiers} unit={plan(target.role).unit}
              warning={target.role === 'tech' ? PLAN.tech.warning : ''} pace={pace} final={readOnly} />
          ) : isManager ? (
            <>
              <Roster title="Service Advisors" unit={PLAN.advisor.unit} rows={advisorRows} tiers={PLAN.advisor.tiers}
                pace={pace} final={readOnly} editable={!readOnly} editNote="auto-filled from hours sold — type to override" saving={saving}
                onEdit={setAdv} onOpen={setSelected} loading={loading} />
              <Roster title="Technicians" unit={PLAN.tech.unit} rows={techRows} tiers={PLAN.tech.tiers} pace={pace} final={readOnly}
                editable={!readOnly} editNote="auto-filled from daily posts — type to override" saving={saving}
                onEdit={setTech} onOpen={setSelected} warning={PLAN.tech.warning} loading={loading} />
            </>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>You’re not part of the {PLAN.label} Cash Dash.</div>
          )}

          {/* Shareable customer review flyer — download to send/print */}
          <ReviewFlyer />
        </div>
      </div>
    </div>
  );
}

// Customer review flyer — anyone can preview and download it to share/print.
// The image lives at public/review-flyer.jpg (served at BASE_URL/review-flyer.jpg).
function ReviewFlyer() {
  const src = `${import.meta.env.BASE_URL}review-flyer.jpg`;
  const [ok, setOk] = useState(true);
  return (
    <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9', marginBottom: 4 }}>📄 Customer Review Flyer</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 14 }}>Download to text, email, or print for customers — Google &amp; Facebook review QR codes.</div>
      {ok ? (
        <img src={src} alt="Customer review flyer" onError={() => setOk(false)}
          onClick={() => window.open(src, '_blank')}
          style={{ maxWidth: 700, width: '100%', borderRadius: 10, border: '1px solid rgba(148,163,184,.25)', cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,.5)' }} />
      ) : (
        <div style={{ color: '#64748b', fontSize: 13, padding: '16px 0', border: '1px dashed rgba(148,163,184,.3)', borderRadius: 10 }}>
          Flyer image not added yet — save it in the site’s <code style={{ color: '#93c5fd' }}>public/review-flyer.jpg</code>.
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <a href={src} download="Bob-Rohrman-Hyundai-Review-Flyer.jpg"
          style={{ display: 'inline-block', background: 'linear-gradient(180deg,#3b82f6,#2563eb)', border: '1px solid rgba(96,165,250,.6)', color: '#fff', borderRadius: 10, padding: '10px 24px', fontWeight: 900, fontSize: 14, textDecoration: 'none' }}>
          ⬇ Download to Share
        </a>
      </div>
    </section>
  );
}

// ── Reputation.com department progress (managers enter the daily count) ───────
function RepProgress({ count, score, rawCount, rawScore, canEdit, onEdit }) {
  const tiers = [
    { label: 'Must Hit', reviews: 30, scoreReq: 700, reward: 'Department qualifies' },
    { label: 'Bonus 1', reviews: 50, scoreReq: 725, reward: '+2 pulls per participant' },
    { label: 'Bonus 2', reviews: 80, scoreReq: 725, reward: '+2 more pulls per participant' },
  ];
  const inp = { width: 110, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(251,191,36,.45)', borderRadius: 8, color: '#fde68a', padding: '7px 11px', fontSize: 20, fontWeight: 900, textAlign: 'center', outline: 'none' };
  return (
    <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#fde68a' }}>⭐ Reputation.com — Department Progress</div>
        <div style={{ flex: 1 }} />
        {canEdit ? (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8' }}>
              Survey count
              <input value={rawCount} onChange={e => onEdit('count', e.target.value)} inputMode="decimal" placeholder="0" style={inp} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8' }}>
              Score
              <input value={rawScore} onChange={e => onEdit('score', e.target.value)} inputMode="decimal" placeholder="0" style={{ ...inp, color: '#93c5fd', borderColor: 'rgba(96,165,250,.45)' }} />
            </label>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 22 }}>
            <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>Reviews</div><div style={{ fontSize: 24, fontWeight: 900, color: '#fde68a' }}>{count}</div></div>
            <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>Score</div><div style={{ fontSize: 24, fontWeight: 900, color: '#93c5fd' }}>{score || '—'}</div></div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {tiers.map(t => {
          const rMet = count >= t.reviews, sMet = score >= t.scoreReq, met = rMet && sMet;
          return (
            <div key={t.label} style={{ flex: '1 1 200px', minWidth: 190, background: met ? 'rgba(52,211,153,.12)' : 'rgba(2,6,23,.4)', border: `1px solid ${met ? 'rgba(52,211,153,.5)' : 'rgba(148,163,184,.2)'}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: met ? '#6ee7b7' : '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t.label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12.5, fontWeight: 900, color: met ? '#6ee7b7' : '#64748b' }}>{met ? '✓ MET' : ''}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 6 }}>
                <span style={{ color: rMet ? '#6ee7b7' : '#fca5a5', fontWeight: 700 }}>{count}/{t.reviews} reviews</span>
                {' · '}
                <span style={{ color: sMet ? '#6ee7b7' : '#fca5a5', fontWeight: 700 }}>{score || 0}/{t.scoreReq} score</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>{t.reward}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 10 }}>Applies to all positions except technicians.{canEdit ? ' Update the survey count daily.' : ''}</div>
    </section>
  );
}

// ── Styled reproduction of the qualify/earn-pulls board (advisors + techs) ────
function PlanChart() {
  const cream = '#f4efdd', dark = '#1f1e1c', gold = '#e6b93f', ink = '#1a1a1a';
  const tierTable = (title, unit, headerBg, tiers, warning) => (
    <div style={{ flex: '1 1 300px', minWidth: 260, background: cream, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,.15)' }}>
      <div style={{ background: '#111', color: '#fff', textAlign: 'center', fontWeight: 900, fontSize: 15, letterSpacing: 1, padding: '12px' }}>{title}</div>
      <div style={{ background: '#fff', textAlign: 'center', fontStyle: 'italic', fontSize: 12, color: '#555', padding: '7px' }}>{unit}</div>
      <div style={{ display: 'flex', background: headerBg, color: ink, fontWeight: 800, fontSize: 11, letterSpacing: .5, textTransform: 'uppercase', padding: '8px 16px' }}>
        <div style={{ flex: 1 }}>Qualifier</div><div>Pulls</div>
      </div>
      {tiers.map(([q, p], i) => (
        <div key={q} style={{ display: 'flex', padding: '11px 16px', background: i % 2 ? '#fff' : '#faf6e8', color: ink, fontWeight: 800, fontSize: 15.5 }}>
          <div style={{ flex: 1 }}>{q}{i === tiers.length - 1 ? '+' : ''}</div><div>{p}</div>
        </div>
      ))}
      {warning && <div style={{ background: '#7f1d1d', color: '#fecaca', fontSize: 11.5, fontWeight: 800, padding: '10px 14px', textAlign: 'center', letterSpacing: .3 }}>⚠️ {warning}</div>}
    </div>
  );
  return (
    <section style={{ background: cream, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 44px rgba(0,0,0,.55)' }}>
      <div style={{ background: '#111', padding: '14px 22px' }}>
        <div style={{ color: gold, fontWeight: 900, fontSize: 18, letterSpacing: 1.5 }}>HOW TO QUALIFY + EARN PULLS</div>
      </div>
      {/* Reputation.com row */}
      <div style={{ background: dark, margin: 14, borderRadius: 10, padding: '16px 20px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 200, flex: '1 1 200px' }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>REPUTATION.COM</div>
          <div style={{ color: gold, fontWeight: 800, fontSize: 12, marginTop: 3, letterSpacing: .5 }}>JULY 20 – AUGUST 31</div>
          <div style={{ color: '#cbd5e1', fontSize: 11.5, marginTop: 5 }}>Required for all positions except technicians.</div>
        </div>
        {[['MUST HIT', '30 REVIEWS + 700 SCORE', 'Department qualifies'], ['BONUS 1', '50 REVIEWS + 725 SCORE', '+2 pulls per participant'], ['BONUS 2', '80 REVIEWS + 725 SCORE', '+2 more pulls per participant']].map(([h, a, b]) => (
          <div key={h} style={{ borderLeft: `3px solid ${gold}`, paddingLeft: 12, minWidth: 150, flex: '1 1 150px' }}>
            <div style={{ color: gold, fontWeight: 800, fontSize: 11, letterSpacing: .5 }}>{h}</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13, marginTop: 4 }}>{a}</div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{b}</div>
          </div>
        ))}
      </div>
      {/* Core certification + the two tier tables */}
      <div style={{ display: 'flex', gap: 14, padding: '0 14px 16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 210, background: dark, borderRadius: 10, padding: 20 }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: 1 }}>CORE <span style={{ color: gold }}>CERTIFICATION</span></div>
          <div style={{ color: '#e2e8f0', fontSize: 14, marginTop: 14, fontWeight: 600, lineHeight: 1.4 }}>Core Training must be completed to qualify for any pulls.</div>
          <div style={{ height: 3, width: 60, background: gold, margin: '14px 0' }} />
          <div style={{ color: gold, fontWeight: 800, fontSize: 13 }}>TECHNICIANS</div>
          <div style={{ color: '#e2e8f0', fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>Core Complete + CP/W Video Utilization above 75%</div>
        </div>
        {tierTable('SERVICE ADVISORS', 'Hours sold · excludes internal', '#e08a1e', PLAN.advisor.tiers)}
        {tierTable('TECHNICIANS', 'Booked hours · includes internal', '#e8c14a', PLAN.tech.tiers, PLAN.tech.warning)}
      </div>
    </section>
  );
}

// ── One person's Cash Dash: actual, locked pulls, pacing, tier ladder ─────────
function PersonView({ row, tiers, unit, warning, pace, final }) {
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
        <Stat label={final ? 'Final month total' : 'Pacing (proj. month-end)'} value={hrs(projected)} accent="#38bdf8" sub={final ? `→ ${projTier.pulls} pulls earned` : `→ ${projTier.pulls} pulls at this pace`} />
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
function Roster({ title, unit, rows, tiers, pace, editable, editNote, saving, onEdit, onOpen, warning, loading, final }) {
  return (
    <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '13px 18px', background: 'rgba(148,163,184,.08)', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{unit}{editable && editNote ? ` · ${editNote}` : ''}</div>
      </div>
      {warning && <div style={{ padding: '9px 18px', background: 'rgba(248,113,113,.1)', color: '#fca5a5', fontSize: 12, fontWeight: 700 }}>⚠️ {warning}</div>}
      <div style={{ display: 'flex', padding: '8px 18px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>
        <div style={{ flex: 1 }}>Name</div><div style={{ width: 120, textAlign: 'right' }}>{final ? 'Final hours' : 'Hours (MTD)'}</div>
        {/* A finished month has nothing to pace — the projection would just repeat the actuals. */}
        {!final && <div style={{ width: 100, textAlign: 'right' }}>Pacing</div>}
        <div style={{ width: 95, textAlign: 'right' }}>{final ? 'Pulls earned' : 'Locked Pulls'}</div>
        {!final && <div style={{ width: 90, textAlign: 'right' }}>Proj. Pulls</div>}
        <div style={{ width: 60 }} />
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
              <div style={{ width: 120, textAlign: 'right' }}>
                {editable
                  ? <input value={r.raw != null ? r.raw : ''} onChange={e => onEdit(r.name, e.target.value)} inputMode="decimal" placeholder="0" title={r.overridden ? `Overridden (auto: ${hrs(r.auto)})` : 'Auto — clear to restore'}
                      style={{ width: 90, background: 'rgba(2,6,23,.55)', border: `1px solid ${r.overridden ? 'rgba(251,191,36,.5)' : 'rgba(148,163,184,.3)'}`, borderRadius: 8, color: r.overridden ? '#fde68a' : '#f1f5f9', padding: '5px 9px', fontSize: 14, fontWeight: 800, textAlign: 'right', outline: 'none' }} />
                  : <span style={{ fontSize: 15, fontWeight: 800, color: '#6ee7b7' }}>{hrs(r.hours)}</span>}
              </div>
              {!final && <div style={{ width: 100, textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#c4b5fd' }}>{hrs(projected)}</div>}
              <div style={{ width: 95, textAlign: 'right', fontSize: 15, fontWeight: 900, color: locked.pulls > 0 ? '#6ee7b7' : '#64748b' }}>{locked.pulls}</div>
              {!final && <div style={{ width: 90, textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>{proj.pulls}</div>}
              <div style={{ width: 60, textAlign: 'right' }}>
                <button onClick={() => onOpen(r)} style={{ background: 'rgba(96,165,250,.16)', border: '1px solid rgba(96,165,250,.4)', color: '#93c5fd', borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>View</button>
              </div>
            </div>
          );
        })}
    </section>
  );
}
