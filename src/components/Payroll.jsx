import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { loadTechPay, saveTechPayPlan, loadPayrollIndex, loadPayrollWeek, savePayrollWeek } from '../utils/github';
import { parseTechReportHtml } from '../utils/techFlaggedReport';
import { trackPage, trackAction } from '../utils/activityTracker';
import { firstWord, r2, payWeekOf, lastCompletedPayWeek, fmtWeek, payrollPlan, frhFromRow, computePayrollRow, payrollTotals } from '../utils/payroll';

// ── Tech Payroll ──────────────────────────────────────────────────────────────
// Manager Hub → Payroll. The weekly tech pay sheet: upload the Tekion Tech
// Performance .html (the same file used for tech hours), type in school /
// PTO hours and any other bonus, and the sheet does the rest. Admin and
// managers only (App.jsx gates the route). Every saved week goes to history.

const money = (v) => `$${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const h2 = (v) => (Number(v) || 0).toFixed(2);
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const CSS = `
.pr-sheet{width:100%;min-width:1540px;table-layout:auto;border-collapse:separate;border-spacing:0;font-size:12.5px}
.pr-sheet.narrow{min-width:0}
.pr-sheet th{position:sticky;top:0;background:#0f172a;color:#94a3b8;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;padding:8px 6px;border-bottom:1px solid rgba(148,163,184,.25);text-align:right;white-space:nowrap;z-index:1}
.pr-sheet th:first-child,.pr-sheet td:first-child{text-align:left}
.pr-sheet td{padding:6px 6px;border-bottom:1px solid rgba(148,163,184,.1);text-align:right;white-space:nowrap;overflow:visible;text-overflow:clip;color:#e2e8f0;font-size:12.5px;line-height:1.3;font-variant-numeric:tabular-nums}
.pr-sheet tr:hover td{background:rgba(255,255,255,.025)}
.pr-sheet td.name{font-weight:900;color:#f1f5f9}
.pr-sheet td.sub{color:#94a3b8;font-size:11px}
.pr-sheet td.calc{color:#cbd5e1}
.pr-sheet td.money{color:#6ee7b7;font-weight:800}
.pr-sheet td.total{color:#fde047;font-weight:1000;font-size:13.5px}
.pr-sheet td.hit{color:#4ade80;font-weight:900}
.pr-sheet td.miss{color:#475569}
.pr-sheet tfoot td{border-top:2px solid rgba(250,204,21,.4);background:rgba(250,204,21,.06);font-weight:900;color:#fde047;padding:9px 6px}
.pr-in{width:64px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:7px;padding:5px 6px;font-size:12.5px;font-weight:700;color:#e2e8f0;text-align:right;outline:none}
.pr-in:focus{border-color:rgba(110,231,249,.6)}
.pr-in.note{width:150px;text-align:left;font-weight:500}
.pr-pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}
.pr-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:14px 16px}
.pr-label{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
.pr-field{display:flex;flex-direction:column;gap:5px}
.pr-field input,.pr-field select{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:8px 10px;font-size:13.5px;font-weight:700;color:#e2e8f0;outline:none;color-scheme:dark}
`;

const emptyInputs = () => ({ frh: 0, school: '', pto: '', clockHours: '', otherBonus: '', otherNote: '' });

export default function Payroll({ data, currentUser, onBack, onSaveTechFlag }) {
  const techs = useMemo(() => ((data && data.technicians) || []).filter(t => t && t.name), [data]);
  const [tab, setTab] = useState('sheet');            // 'sheet' | 'setup' | 'history'
  const [plans, setPlans] = useState(null);           // tech-pay.json
  const [week, setWeek] = useState(() => lastCompletedPayWeek());
  const [inputs, setInputs] = useState({});           // { NAME: {frh, school, pto, clockHours, otherBonus, otherNote} }
  const [frhDetail, setFrhDetail] = useState({});     // { NAME: {cp,int,war,warX,mult,total} }
  const [reportName, setReportName] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [index, setIndex] = useState({ weeks: {} });
  const [loadedFrom, setLoadedFrom] = useState('');   // 'saved' when a saved week is on screen
  const fileRef = useRef(null);

  useEffect(() => { trackPage('payroll'); }, []);
  useEffect(() => { loadTechPay().then(p => setPlans(p || {})).catch(() => setPlans({})); loadPayrollIndex().then(setIndex).catch(() => {}); }, []);

  const planFor = useCallback((t) => (plans || {})[firstWord(t.name)] || null, [plans]);
  const multOn = (t) => !t || t.warrantyMultiplier !== false;

  // Rows in roster order, computed live from the inputs.
  const rows = useMemo(() => techs.map(t => {
    const key = firstWord(t.name);
    const inp = inputs[key] || emptyInputs();
    const calc = computePayrollRow(planFor(t), inp);
    return { key, name: t.name, tech: t, inp, calc, plan: calc.plan, frhDetail: frhDetail[key] || null };
  }), [techs, inputs, frhDetail, planFor]);
  const totals = useMemo(() => payrollTotals(rows.map(r => r.calc)), [rows]);
  const savedThisWeek = index.weeks && index.weeks[week.key];

  function setInput(key, field, value) {
    setInputs(prev => ({ ...prev, [key]: { ...(prev[key] || emptyInputs()), [field]: value } }));
    setLoadedFrom('');
  }

  // ── Upload the Tekion Tech Performance .html ─────────────────────────────
  async function handleHtml(file) {
    if (!file) return;
    setBusy('parse'); setStatus('Reading report…'); setWarnings([]);
    try {
      const { rows: parsed, warnings: w } = parseTechReportHtml(await file.text());
      const nextInputs = { ...inputs }, nextDetail = { ...frhDetail };
      const matched = [], unmatched = [];
      for (const r of parsed) {
        const key = firstWord(r.name);
        const t = techs.find(x => firstWord(x.name) === key);
        if (!t) { unmatched.push(r.name); continue; }
        const d = frhFromRow(r, multOn(t));
        nextDetail[key] = d;
        nextInputs[key] = { ...(nextInputs[key] || emptyInputs()), frh: d.total };
        matched.push(key);
      }
      // Techs on the roster but not on the report turned nothing this week.
      for (const t of techs) { const k = firstWord(t.name); if (!matched.includes(k)) { nextDetail[k] = { cp: 0, int: 0, war: 0, warX: 0, mult: multOn(t) ? 1.4 : 1, total: 0 }; nextInputs[k] = { ...(nextInputs[k] || emptyInputs()), frh: 0 }; } }
      setInputs(nextInputs); setFrhDetail(nextDetail); setReportName(file.name); setLoadedFrom('');
      const notes = [...(w || [])];
      if (unmatched.length) notes.push(`On the report but not on the tech roster (skipped): ${unmatched.join(', ')}`);
      setWarnings(notes);
      setStatus(`✅ FRH loaded for ${matched.length} tech${matched.length === 1 ? '' : 's'} from ${file.name}`);
      trackAction('payroll-upload', file.name);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  // ── Save / load weeks ────────────────────────────────────────────────────
  async function saveWeek() {
    setBusy('save'); setStatus('Saving week…');
    try {
      const record = {
        key: week.key, start: week.start, end: week.end, savedAt: new Date().toISOString(), by: currentUser || '',
        report: reportName, warnings,
        rows: rows.map(r => ({ name: r.name, key: r.key, plan: r.plan, inputs: r.inp, frhDetail: r.frhDetail, calc: { ...r.calc, plan: undefined } })),
        totals,
      };
      const summary = { start: week.start, end: week.end, savedAt: record.savedAt, by: record.by, total: totals.total, frh: totals.frh, techs: rows.length };
      await savePayrollWeek(week.key, record, summary);
      setIndex(i => ({ ...i, weeks: { ...(i.weeks || {}), [week.key]: summary } }));
      setLoadedFrom('saved');
      setStatus(`✅ Saved payroll for ${fmtWeek(week)} — ${money(totals.total)} total shop.`);
      trackAction('payroll-save-week', week.key);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  async function openWeek(key) {
    setBusy('load'); setStatus('Loading saved week…');
    try {
      const rec = await loadPayrollWeek(key);
      if (!rec) throw new Error('That week could not be loaded.');
      setWeek({ key: rec.key, start: rec.start, end: rec.end });
      const nextInputs = {}, nextDetail = {};
      for (const r of rec.rows || []) { nextInputs[r.key] = { ...emptyInputs(), ...(r.inputs || {}) }; if (r.frhDetail) nextDetail[r.key] = r.frhDetail; }
      setInputs(nextInputs); setFrhDetail(nextDetail); setReportName(rec.report || ''); setWarnings(rec.warnings || []);
      setLoadedFrom('saved'); setTab('sheet');
      setStatus(`📂 Opened saved payroll for ${fmtWeek(rec)} (saved ${new Date(rec.savedAt).toLocaleString()} by ${rec.by || '—'}).`);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  function startFresh(newWeek) {
    setWeek(newWeek); setInputs({}); setFrhDetail({}); setReportName(''); setWarnings([]); setLoadedFrom(''); setStatus('');
  }

  // ── Print ────────────────────────────────────────────────────────────────
  function printSheet() {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const trs = rows.map(r => `<tr>
      <td class="l">${esc(r.name)}</td><td>${r.plan.hybrid ? 'FRH / HRLY' : 'FRH'}</td><td class="${r.plan.bumpEligible ? '' : 'no'}">${r.plan.bumpEligible ? 'YES' : 'NO'}</td>
      <td>${h2(r.calc.frh)}</td><td>${money(r.plan.flatRate)}</td><td>${r.plan.bumpEligible ? money(r.plan.tier1Bump) : ''}</td>
      <td>${r.plan.tier1Hours}</td><td>${r.calc.tier1 ? money(r.plan.tier1Bump) : '$0'}</td><td>${r.plan.tier2Hours}</td><td>${r.calc.tier2 ? money(r.plan.tier2Bump) : '$0'}</td>
      <td><b>${money(r.calc.weeklyRate)}</b></td><td><b>${money(r.calc.frhPay)}</b></td>
      <td>${r.calc.school || ''}</td><td>${r.calc.school ? money(r.calc.schoolPay) : ''}</td>
      <td>${r.calc.pto || ''}</td><td>${r.calc.pto ? money(r.calc.ptoPay) : ''}</td>
      <td>${r.calc.hourlyPay ? money(r.calc.hourlyPay) : ''}</td>
      <td>${r.calc.otherBonus ? money(r.calc.otherBonus) : ''}</td><td><b>${money(r.calc.total)}</b></td></tr>`).join('');
    const frhTrs = rows.map(r => { const d = r.frhDetail || { cp: 0, int: 0, war: 0, warX: 0, mult: 1, total: r.calc.frh }; return `<tr><td class="l">${esc(r.name)}</td><td>${h2(d.cp)}</td><td>${h2(d.int)}</td><td>${h2(d.war)}</td><td>${h2(d.warX)}</td><td><b>${h2(d.total)}</b></td></tr>`; }).join('');
    const notes = rows.filter(r => r.calc.otherBonus || r.calc.otherNote).map(r => `<tr><td class="l">${esc(r.name)}</td><td class="l">${esc(r.calc.otherNote)}</td><td>${money(r.calc.otherBonus)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tech Payroll ${esc(fmtWeek(week))}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0 0 2px}h2{font-size:12px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 5px;text-align:right;white-space:nowrap}th{background:#e5e7eb;font-size:9.5px;text-transform:uppercase}td.l{text-align:left}td.no{background:#fecaca}
tfoot td{font-weight:bold;background:#f3f4f6}.meta{color:#555;margin-bottom:12px}@page{size:letter landscape;margin:.4in}</style></head><body>
<h1>Hyundai — Technician Payroll</h1><div class="meta">Payroll dates <b>${esc(fmtWeek(week))}</b> · ${reportName ? 'Report: ' + esc(reportName) + ' · ' : ''}Printed ${new Date().toLocaleString()}</div>
<table><thead><tr><th>Tech</th><th>Type</th><th>Bump elig.</th><th>FRH turned</th><th>Base rate</th><th>$ / tier</th><th>Tier 1 FRH</th><th>Tier 1</th><th>Tier 2 FRH</th><th>Tier 2</th><th>Wkly rate</th><th>FRH pay</th><th>School hrs</th><th>School $</th><th>Vac/Hol/Sick hrs</th><th>Vac/Hol/Sick $</th><th>Hourly $</th><th>Other bonus</th><th>Total</th></tr></thead>
<tbody>${trs}</tbody><tfoot><tr><td class="l" colspan="3">TOTAL SHOP</td><td>${h2(totals.frh)}</td><td colspan="7"></td><td>${money(totals.frhPay)}</td><td>${totals.school}</td><td>${money(totals.schoolPay)}</td><td>${totals.pto}</td><td>${money(totals.ptoPay)}</td><td>${money(totals.hourlyPay)}</td><td>${money(totals.otherBonus)}</td><td>${money(totals.total)}</td></tr></tfoot></table>
<h2>Flat rate hours calc w/ warranty multiplier</h2>
<table><thead><tr><th>Tech</th><th>CP FRH</th><th>INT FRH</th><th>WAR FRH</th><th>× 1.4</th><th>TTL FRH</th></tr></thead><tbody>${frhTrs}</tbody></table>
${notes ? `<h2>Other payplan notes</h2><table><thead><tr><th>Tech</th><th>Note</th><th>Bonus</th></tr></thead><tbody>${notes}</tbody></table>` : ''}
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print()}catch(e){}},300)})</script></body></html>`;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to print the payroll sheet.'); return; }
    win.document.open(); win.document.write(html); win.document.close();
    trackAction('payroll-print', week.key);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const hasFrh = Object.keys(frhDetail).length > 0;
  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">💰 Payroll</div>
          <div className="adv-sub">Technicians · pay week {fmtWeek(week)}{loadedFrom === 'saved' ? ' · saved' : ''}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 999, padding: 4 }}>
          {[['sheet', '🧾 Pay Sheet'], ['setup', '⚙️ Setup'], ['history', '📂 History']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="secondary"
              style={{ borderRadius: 999, padding: '6px 14px', fontSize: 12.5, background: tab === k ? 'rgba(110,231,249,.18)' : 'transparent', borderColor: tab === k ? 'rgba(110,231,249,.5)' : 'transparent', color: tab === k ? '#67e8f9' : '#94a3b8' }}>
              {label}
            </button>
          ))}
        </div>
        <button className="secondary" onClick={onBack} style={{ marginLeft: 6 }}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 16 }}>

          {tab === 'sheet' && (
            <>
              {/* Week + upload + actions */}
              <div className="pr-card" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
                <div className="pr-field">
                  <span className="pr-label">Pay week (Sat → Fri)</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="date" value={week.start} onChange={e => { if (e.target.value) startFresh(payWeekOf(new Date(e.target.value + 'T00:00:00'))); }}
                      style={{ background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', colorScheme: 'dark' }} />
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>→ {fmtWeek(week).split(' to ')[1]}</span>
                    <button className="secondary" onClick={() => startFresh(lastCompletedPayWeek())} style={{ fontSize: 11.5 }}>Last week</button>
                  </div>
                </div>
                <div className="pr-field" style={{ flex: 1, minWidth: 280 }}>
                  <span className="pr-label">Tech Performance report (.html — same file as Tech Hours)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <input ref={fileRef} type="file" accept=".html,.htm" disabled={!!busy} onChange={e => handleHtml(e.target.files && e.target.files[0])} style={{ fontSize: 12, color: '#cbd5e1' }} />
                    {reportName && <span style={{ fontSize: 11.5, color: '#6ee7b7', fontWeight: 700 }}>📄 {reportName}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="secondary" onClick={printSheet} disabled={!rows.length} style={{ padding: '9px 14px' }}>🖨 Print / PDF</button>
                  <button onClick={saveWeek} disabled={!!busy || !rows.length} style={{ padding: '9px 16px', fontSize: 13.5 }}>
                    {busy === 'save' ? '⏳ Saving…' : savedThisWeek ? '💾 Save again (overwrite)' : '💾 Save week to history'}
                  </button>
                </div>
              </div>
              {status && <div style={{ fontSize: 13, fontWeight: 700, color: status.startsWith('❌') ? '#f87171' : status.startsWith('📂') ? '#7dd3fc' : '#6ee7b7' }}>{status}</div>}
              {warnings.length > 0 && (
                <div style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.35)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#fde68a', lineHeight: 1.5 }}>
                  {warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                </div>
              )}
              {savedThisWeek && loadedFrom !== 'saved' && (
                <div style={{ fontSize: 12.5, color: '#94a3b8' }}>A saved sheet exists for this week ({money(savedThisWeek.total)}, saved {new Date(savedThisWeek.savedAt).toLocaleDateString()}). <button className="secondary" onClick={() => openWeek(week.key)} style={{ fontSize: 11.5, marginLeft: 6 }}>Open it</button></div>
              )}

              {/* The sheet */}
              <div className="pr-card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="pr-sheet">
                  <thead>
                    <tr>
                      <th>Tech</th><th>Type</th><th>Bump</th>
                      <th style={{ color: '#67e8f9' }}>FRH turned</th><th>Base rate</th><th>$ / tier</th>
                      <th>T1 @</th><th>T1</th><th>T2 @</th><th>T2</th>
                      <th style={{ color: '#fde047' }}>Wkly rate</th><th style={{ color: '#6ee7b7' }}>FRH pay</th>
                      <th>School hrs</th><th>School $</th>
                      <th>Vac/Hol/Sick hrs</th><th>Vac/Hol/Sick $</th>
                      <th>Clock hrs</th><th>Hourly $</th>
                      <th>Other bonus</th><th>Note</th>
                      <th style={{ color: '#fde047' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const p = r.plan, c = r.calc;
                      const unset = !(p.flatRate > 0 || (p.hybrid && p.clockRate > 0));
                      return (
                        <tr key={r.key}>
                          <td className="name">{r.name}{unset && <span className="pr-pill" style={{ marginLeft: 6, background: 'rgba(248,113,113,.18)', color: '#fca5a5' }} title="No rate set — open Setup">no rate</span>}</td>
                          <td className="sub">{p.hybrid ? 'FRH / HRLY' : 'FRH'}</td>
                          <td><span className="pr-pill" style={{ background: p.bumpEligible ? 'rgba(74,222,128,.15)' : 'rgba(248,113,113,.15)', color: p.bumpEligible ? '#4ade80' : '#fca5a5' }}>{p.bumpEligible ? 'yes' : 'no'}</span></td>
                          <td style={{ color: '#67e8f9', fontWeight: 900 }} title={r.frhDetail ? `CP ${h2(r.frhDetail.cp)} + INT ${h2(r.frhDetail.int)} + WAR ${h2(r.frhDetail.war)} × ${r.frhDetail.mult}` : 'Upload the report'}>
                            <input className="pr-in" value={r.inp.frh === 0 && !r.frhDetail ? '' : r.inp.frh} placeholder="0.00" onChange={e => setInput(r.key, 'frh', e.target.value)} style={{ color: '#67e8f9' }} />
                          </td>
                          <td className="calc">{money(p.flatRate)}</td>
                          <td className="calc">{p.bumpEligible ? money(p.tier1Bump) : '—'}</td>
                          <td className="sub">{p.bumpEligible ? p.tier1Hours : '—'}</td>
                          <td className={c.tier1 ? 'hit' : 'miss'}>{p.bumpEligible ? (c.tier1 ? `+${money(p.tier1Bump)}` : '$0') : '—'}</td>
                          <td className="sub">{p.bumpEligible ? p.tier2Hours : '—'}</td>
                          <td className={c.tier2 ? 'hit' : 'miss'}>{p.bumpEligible ? (c.tier2 ? `+${money(p.tier2Bump)}` : '$0') : '—'}</td>
                          <td style={{ color: '#fde047', fontWeight: 900 }}>{money(c.weeklyRate)}</td>
                          <td className="money">{money(c.frhPay)}</td>
                          <td><input className="pr-in" value={r.inp.school} placeholder="0" onChange={e => setInput(r.key, 'school', e.target.value)} /></td>
                          <td className="calc">{c.school ? money(c.schoolPay) : ''}</td>
                          <td><input className="pr-in" value={r.inp.pto} placeholder="0" onChange={e => setInput(r.key, 'pto', e.target.value)} /></td>
                          <td className="calc">{c.pto ? money(c.ptoPay) : ''}</td>
                          <td>{p.hybrid && p.clockRate > 0 ? <input className="pr-in" value={r.inp.clockHours} placeholder={String(p.clockHours)} onChange={e => setInput(r.key, 'clockHours', e.target.value)} /> : <span className="sub">—</span>}</td>
                          <td className="calc">{c.hourlyPay ? money(c.hourlyPay) : ''}</td>
                          <td><input className="pr-in" value={r.inp.otherBonus} placeholder="$0" onChange={e => setInput(r.key, 'otherBonus', e.target.value)} /></td>
                          <td><input className="pr-in note" value={r.inp.otherNote} placeholder="e.g. VMPI $15 × FRH" onChange={e => setInput(r.key, 'otherNote', e.target.value)} /></td>
                          <td className="total">{money(c.total)}</td>
                        </tr>
                      );
                    })}
                    {!rows.length && <tr><td colSpan={21} style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>No technicians on the dashboard roster.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>TOTAL SHOP</td>
                      <td>{h2(totals.frh)}</td><td colSpan={7}></td>
                      <td>{money(totals.frhPay)}</td>
                      <td>{totals.school || ''}</td><td>{money(totals.schoolPay)}</td>
                      <td>{totals.pto || ''}</td><td>{money(totals.ptoPay)}</td>
                      <td></td><td>{money(totals.hourlyPay)}</td>
                      <td>{money(totals.otherBonus)}</td><td></td>
                      <td style={{ fontSize: 14 }}>{money(totals.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* FRH breakdown with warranty multiplier */}
              {hasFrh && (
                <div className="pr-card" style={{ padding: 0, overflow: 'auto', maxWidth: 620 }}>
                  <div style={{ padding: '10px 14px 0', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Flat rate hours calc w/ warranty multiplier</div>
                  <table className="pr-sheet narrow">
                    <thead><tr><th>Tech</th><th>CP FRH</th><th>INT FRH</th><th>WAR FRH</th><th>× 1.4</th><th>TTL FRH</th></tr></thead>
                    <tbody>
                      {rows.map(r => { const d = r.frhDetail; if (!d) return null; return (
                        <tr key={r.key}><td className="name">{r.name}</td><td>{h2(d.cp)}</td><td>{h2(d.int)}</td><td>{h2(d.war)}</td><td className={d.mult > 1 ? 'calc' : 'sub'} title={d.mult > 1 ? 'Warranty ×1.4 on' : 'Warranty multiplier off for this tech'}>{h2(d.warX)}{d.mult === 1 && ' (off)'}</td><td style={{ color: '#67e8f9', fontWeight: 900 }}>{h2(d.total)}</td></tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                <b style={{ color: '#94a3b8' }}>How it adds up.</b> FRH turned × weekly rate (base, +tier 1 bump at {rows[0] ? rows[0].plan.tier1Hours : 50} hrs, +tier 2 at {rows[0] ? rows[0].plan.tier2Hours : 60} — every hour that week pays the bumped rate; techs not bump-eligible stay on base).
                School and Vacation/Holiday/Sick hours are typed in and paid at base rate. Hourly $ only applies to FRH / HRLY techs with an hourly rate in Setup. Other bonus is whatever you type, with a note for the record. Rates and tiers come from Setup (shared with Tech Live Pay).
              </div>
            </>
          )}

          {tab === 'setup' && <SetupTab techs={techs} plans={plans} onSaved={(key, plan) => setPlans(p => ({ ...(p || {}), [key]: plan }))} onSaveTechFlag={onSaveTechFlag} />}

          {tab === 'history' && (
            <div className="pr-card">
              <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff', marginBottom: 10 }}>📂 Saved pay weeks</div>
              {Object.keys(index.weeks || {}).length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Nothing saved yet — build a week on the Pay Sheet tab and click Save.</div> : (
                <table className="pr-sheet narrow">
                  <thead><tr><th>Pay week</th><th>Techs</th><th>FRH</th><th>Total shop</th><th>Saved</th><th></th></tr></thead>
                  <tbody>
                    {Object.entries(index.weeks).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, w]) => (
                      <tr key={key}>
                        <td className="name">{fmtWeek(w)}</td><td>{w.techs}</td><td>{h2(w.frh)}</td><td className="total">{money(w.total)}</td>
                        <td className="sub">{new Date(w.savedAt).toLocaleString()} · {w.by || '—'}</td>
                        <td><button className="secondary" disabled={!!busy} onClick={() => openWeek(key)} style={{ fontSize: 11.5 }}>Open</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {status && tab === 'history' && <div style={{ fontSize: 13, fontWeight: 700, marginTop: 10, color: status.startsWith('❌') ? '#f87171' : '#7dd3fc' }}>{status}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Setup: per-tech rates, tiers, pay type ────────────────────────────────────
// Writes the same tech-pay.json plan Tech Live Pay reads, plus the payroll-only
// bumpEligible flag, so the two screens can never disagree on a rate.
function SetupTab({ techs, plans, onSaved, onSaveTechFlag }) {
  const [sel, setSel] = useState(techs[0] ? firstWord(techs[0].name) : '');
  const stored = (plans || {})[sel] || null;
  const [form, setForm] = useState(() => formFrom(stored));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { setForm(formFrom((plans || {})[sel] || null)); setMsg(''); }, [sel, plans]);
  // Warranty ×1.4 lives on the dashboard tech record (undefined = ON), shared
  // with the Tech Hours card — one switch, read by both screens.
  const selTech = techs.find(t => firstWord(t.name) === sel) || null;
  const multOn = !selTech || selTech.warrantyMultiplier !== false;
  const [multBusy, setMultBusy] = useState(false);
  async function toggleMult() {
    if (!selTech || !onSaveTechFlag) return;
    setMultBusy(true); setMsg('');
    try { await onSaveTechFlag(selTech.name, { warrantyMultiplier: !multOn }); setMsg(`✅ Warranty ×1.4 turned ${multOn ? 'OFF' : 'ON'} for ${sel} — saved to the dashboard.`); trackAction('payroll-warranty-mult', `${sel}:${!multOn}`); }
    catch (e) { setMsg('❌ ' + (e?.message || e)); }
    finally { setMultBusy(false); }
  }

  function formFrom(p) {
    const n = payrollPlan(p);
    return { payType: n.hybrid ? 'flat_clock' : 'flat', bumpEligible: n.bumpEligible, flatRate: n.flatRate || '', tier1Hours: n.tier1Hours, tier1Bump: n.tier1Bump ?? 2, tier2Hours: n.tier2Hours, tier2Bump: n.tier2Bump ?? 2, clockRate: n.clockRate || '', clockHours: n.clockHours || 40, clockMode: n.clockMode, eligiblePto: n.eligiblePto };
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const numv = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  async function save() {
    setBusy(true); setMsg('');
    try {
      const plan = { ...(stored || {}), payType: form.payType, bumpEligible: !!form.bumpEligible, flatRate: numv(form.flatRate), tier1Hours: numv(form.tier1Hours), tier1Bump: numv(form.tier1Bump), tier2Hours: numv(form.tier2Hours), tier2Bump: numv(form.tier2Bump), clockRate: numv(form.clockRate), clockHours: numv(form.clockHours), clockMode: form.clockMode, eligiblePto: !!form.eligiblePto };
      delete plan.tier1Rate; delete plan.tier2Rate;
      await saveTechPayPlan(sel, plan);
      onSaved(sel, { ...plan, updated: new Date().toISOString() });
      setMsg(`✅ Saved ${sel}'s pay plan.`);
      trackAction('payroll-setup-save', sel);
    } catch (e) { setMsg('❌ ' + (e?.message || e)); }
    finally { setBusy(false); }
  }

  const preview = computePayrollRow({ ...(stored || {}), ...form, flatRate: numv(form.flatRate), tier1Bump: numv(form.tier1Bump), tier2Bump: numv(form.tier2Bump), clockRate: numv(form.clockRate), clockHours: numv(form.clockHours) }, { frh: 52 });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="pr-card" style={{ padding: 8 }}>
        {techs.map(t => { const k = firstWord(t.name); const p = payrollPlan((plans || {})[k]); const set_ = p.flatRate > 0 || (p.hybrid && p.clockRate > 0); return (
          <button key={k} onClick={() => setSel(k)} className="secondary" style={{ width: '100%', textAlign: 'left', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: sel === k ? 'rgba(110,231,249,.14)' : 'transparent', borderColor: sel === k ? 'rgba(110,231,249,.5)' : 'transparent', color: sel === k ? '#67e8f9' : '#e2e8f0' }}>
            <span style={{ fontWeight: 800 }}>{t.name}</span>
            <span style={{ fontSize: 10.5, color: set_ ? '#4ade80' : '#fca5a5' }}>{set_ ? `${p.hybrid ? 'FRH/HRLY' : 'FRH'} ${money(p.flatRate)}` : 'not set'}{t.warrantyMultiplier === false ? <span style={{ color: '#94a3b8' }}> · no ×1.4</span> : ''}</span>
          </button>
        ); })}
      </div>
      <div className="pr-card">
        <div style={{ fontSize: 17, fontWeight: 1000, color: '#fff', marginBottom: 14 }}>⚙️ {sel} — pay plan</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label className="pr-field"><span className="pr-label">Pay type</span>
            <select value={form.payType} onChange={e => set('payType', e.target.value)}><option value="flat">FRH — flat rate</option><option value="flat_clock">FRH / HRLY — hybrid (hourly + flat rate)</option></select></label>
          <label className="pr-field"><span className="pr-label">Bump eligible?</span>
            <select value={form.bumpEligible ? 'yes' : 'no'} onChange={e => set('bumpEligible', e.target.value === 'yes')}><option value="yes">YES — gets the 50 / 60 hr bumps</option><option value="no">NO — stays on base rate</option></select></label>
          <label className="pr-field"><span className="pr-label">Base rate ($ per FRH)</span><input type="number" step="0.01" value={form.flatRate} placeholder="e.g. 28.00" onChange={e => set('flatRate', e.target.value)} /></label>
          <label className="pr-field"><span className="pr-label">Tier 1 at (FRH)</span><input type="number" step="1" value={form.tier1Hours} onChange={e => set('tier1Hours', e.target.value)} disabled={!form.bumpEligible} /></label>
          <label className="pr-field"><span className="pr-label">Tier 1 bump (+$/FRH)</span><input type="number" step="0.01" value={form.tier1Bump} onChange={e => set('tier1Bump', e.target.value)} disabled={!form.bumpEligible} /></label>
          <label className="pr-field"><span className="pr-label">Tier 2 at (FRH)</span><input type="number" step="1" value={form.tier2Hours} onChange={e => set('tier2Hours', e.target.value)} disabled={!form.bumpEligible} /></label>
          <label className="pr-field"><span className="pr-label">Tier 2 bump (+$/FRH)</span><input type="number" step="0.01" value={form.tier2Bump} onChange={e => set('tier2Bump', e.target.value)} disabled={!form.bumpEligible} /></label>
          {form.payType === 'flat_clock' && (
            <>
              <label className="pr-field"><span className="pr-label">Hourly rate ($/clock hr)</span><input type="number" step="0.01" value={form.clockRate} placeholder="leave blank if paid elsewhere" onChange={e => set('clockRate', e.target.value)} /></label>
              <label className="pr-field"><span className="pr-label">Clock hrs / week (default)</span><input type="number" step="0.5" value={form.clockHours} onChange={e => set('clockHours', e.target.value)} /></label>
            </>
          )}
          <label className="pr-field"><span className="pr-label">Holiday / PTO hours paid?</span>
            <select value={form.eligiblePto ? 'yes' : 'no'} onChange={e => set('eligiblePto', e.target.value === 'yes')}><option value="yes">Yes</option><option value="no">No</option></select></label>
          <div className="pr-field">
            <span className="pr-label">Warranty multiplier</span>
            <button type="button" onClick={toggleMult} disabled={multBusy || !selTech} title="ON: warranty hours count × 1.4 toward FRH turned. OFF: warranty hours count at face value. Same switch as the Tech Hours card — saves immediately."
              style={{ padding: '8px 12px', fontSize: 13, fontWeight: 900, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                       background: multOn ? 'rgba(74,222,128,.16)' : 'rgba(148,163,184,.12)', border: `1px solid ${multOn ? 'rgba(74,222,128,.5)' : 'rgba(148,163,184,.35)'}`, color: multOn ? '#4ade80' : '#94a3b8' }}>
              {multBusy ? '⏳' : multOn ? '⚡ Warranty ×1.4 ON' : '○ Warranty ×1.4 OFF'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(110,231,249,.08)', border: '1px solid rgba(110,231,249,.25)', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
          <b style={{ color: '#67e8f9' }}>Check:</b> at 52 FRH this plan pays <b>{money(preview.weeklyRate)}/hr</b> → <b>{money(preview.frhPay)}</b>{preview.hourlyPay ? <> + hourly {money(preview.hourlyPay)}</> : null}.
          Bumps stack: base {money(numv(form.flatRate))} → {money(numv(form.flatRate) + numv(form.tier1Bump))} at {form.tier1Hours} hrs → {money(numv(form.flatRate) + numv(form.tier1Bump) + numv(form.tier2Bump))} at {form.tier2Hours} hrs.
          {' '}Warranty hours {multOn ? <b style={{ color: '#4ade80' }}>× 1.4</b> : <b style={{ color: '#94a3b8' }}>at face value</b>} — e.g. 10 warranty hrs count as {multOn ? '14.0' : '10.0'} FRH.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <button onClick={save} disabled={busy || !sel} style={{ padding: '9px 18px', fontSize: 13.5 }}>{busy ? '⏳ Saving…' : '💾 Save pay plan'}</button>
          {msg && <span style={{ fontSize: 13, fontWeight: 700, color: msg.startsWith('❌') ? '#f87171' : '#6ee7b7' }}>{msg}</span>}
          <span style={{ fontSize: 11.5, color: '#64748b' }}>Same plan Tech Live Pay uses — saving here updates both.</span>
        </div>
      </div>
    </div>
  );
}
