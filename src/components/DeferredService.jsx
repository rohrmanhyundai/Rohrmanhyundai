import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as github from '../utils/github';
import { parseDeferredPdf, mergeRows } from '../utils/deferredReport';
import { trackPage, trackAction } from '../utils/activityTracker';

// ── Deferred Service ──────────────────────────────────────────────────────────
// Opened from the Appointment Prep Calendar. The manager uploads the dealer's
// "Deferred Services" PDF (Settings tab — managers only); every RO on it is
// stored keyed by RO number, so later uploads add to the list and refresh any
// RO that appears again. Advisors filter by op code, advisor, date and text,
// see a short preview list (customer + previous RO), and click a row for the
// full line from the report. Settings is also where the manager gives each op
// code a plain-English description, which the filter chips then show.

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '—'); };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const CSS = `
.ds-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:14px 16px}
.ds-label{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
.ds-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:800;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:rgba(255,255,255,.04);color:#cbd5e1;white-space:nowrap;transition:all .12s}
.ds-chip:hover{border-color:rgba(110,231,249,.5);color:#e2e8f0}
.ds-chip.on{background:rgba(110,231,249,.18);border-color:rgba(110,231,249,.65);color:#67e8f9}
.ds-chip .n{font-size:10px;font-weight:900;color:#64748b;background:rgba(2,6,23,.5);border-radius:999px;padding:1px 6px}
.ds-chip.on .n{color:#a5f3fc}
.ds-in{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.3);border-radius:9px;padding:8px 11px;font-size:13.5px;color:#e2e8f0;outline:none;color-scheme:dark}
.ds-in:focus{border-color:rgba(110,231,249,.6)}
.ds-row{display:grid;grid-template-columns:1fr 110px 130px 90px 24px;gap:10px;align-items:center;padding:11px 14px;border-radius:12px;border:1px solid rgba(148,163,184,.14);background:rgba(2,6,23,.4);cursor:pointer;transition:background .12s,border-color .12s}
.ds-row:hover{background:rgba(110,231,249,.06);border-color:rgba(110,231,249,.35)}
.ds-row.open{border-color:rgba(110,231,249,.6);background:rgba(110,231,249,.09)}
.ds-detail{border:1px solid rgba(110,231,249,.35);border-top:none;border-radius:0 0 12px 12px;background:rgba(2,6,23,.55);padding:14px 16px;margin-top:-6px;margin-bottom:4px}
.ds-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 18px}
.ds-kv .k{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.08em}
.ds-kv .v{font-size:13.5px;color:#f1f5f9;font-weight:600;margin-top:2px;word-break:break-word}
.ds-code{display:inline-block;border-radius:7px;padding:3px 8px;font-size:12px;font-weight:800;background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.35);color:#e9d5ff;margin:3px 4px 0 0}
.ds-code small{font-weight:600;color:#c4b5fd;margin-left:5px}
.ds-pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:800;border:1px solid;white-space:nowrap}
.ds-tab{border-radius:999px;padding:7px 16px;font-size:13px;font-weight:900;cursor:pointer;border:1px solid rgba(148,163,184,.25);background:rgba(255,255,255,.04);color:#cbd5e1;white-space:nowrap}
.ds-tab.on{background:rgba(110,231,249,.18);border-color:rgba(110,231,249,.65);color:#67e8f9}
.ds-tab .n{font-size:10px;font-weight:900;color:#64748b;background:rgba(2,6,23,.5);border-radius:999px;padding:1px 6px;margin-left:5px}
.ds-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
.ds-table th{font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:8px;border-bottom:1px solid rgba(148,163,184,.2)}
.ds-table td{padding:7px 8px;border-bottom:1px solid rgba(148,163,184,.1);overflow:visible;text-overflow:clip;white-space:normal;color:#e2e8f0;font-size:13px}
@media(max-width:720px){.ds-row{grid-template-columns:1fr 90px 24px}.ds-row .ds-hide{display:none}}
`;

const CODE_LABEL = (code, codes) => (codes && codes[code] && codes[code].description) ? codes[code].description : code;

export default function DeferredService({ currentUser, currentRole, advisors = [], onBack, io }) {
  // Storage functions — swappable (tests pass an in-memory version).
  const { loadDeferredRows, updateDeferredRows, loadDeferredCodes, updateDeferredCodes, loadDeferredActivity, updateDeferredActivity } = io || github;
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const me = firstWord(currentUser);
  const [tab, setTab] = useState('list');            // 'list' | 'settings'
  const [view, setView] = useState('all');           // 'all' | ADVISOR — the tab strip
  const [activity, setActivity] = useState({ entries: {} });
  const [action, setAction] = useState(null);        // { ro, type:'contacted'|'appointment' } — open form
  const [note, setNote] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [onlyUncontacted, setOnlyUncontacted] = useState(false);
  const [store, setStore] = useState(null);          // rows.json
  const [codes, setCodes] = useState({});            // codes.json
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  // Filters
  const [selCodes, setSelCodes] = useState(new Set());
  const [selAdvisors, setSelAdvisors] = useState(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [openRo, setOpenRo] = useState('');
  const [showAllCodes, setShowAllCodes] = useState(false);
  const [onlyValvoline, setOnlyValvoline] = useState(false);

  useEffect(() => { trackPage('deferred-service'); }, []);
  useEffect(() => {
    Promise.all([loadDeferredRows(), loadDeferredCodes(), loadDeferredActivity()])
      .then(([r, c, a]) => { setStore(r); setCodes(c || {}); setActivity(a && a.entries ? a : { entries: {} }); })
      .catch(() => { setStore({ byRo: {}, uploads: [] }); })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => Object.values((store && store.byRo) || {}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.ro).localeCompare(String(a.ro)))), [store]);

  // Counts for the chips (over everything, so a chip never disappears while you're using it)
  const codeCounts = useMemo(() => { const m = {}; rows.forEach(r => (r.codes || []).forEach(c => { m[c] = (m[c] || 0) + 1; })); return m; }, [rows]);
  const advisorCounts = useMemo(() => { const m = {}; rows.forEach(r => { const a = r.advisor || '—'; m[a] = (m[a] || 0) + 1; }); return m; }, [rows]);
  const allCodes = useMemo(() => Object.keys(codeCounts).sort((a, b) => codeCounts[b] - codeCounts[a] || a.localeCompare(b)), [codeCounts]);
  // Op codes that share a description are the same service (the DMS has
  // several codes for one job), so the filter works on SERVICES: one chip per
  // description, covering every code that carries it. A code with no
  // description is its own service. Counts are ROs with any code in the group.
  const services = useMemo(() => {
    const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const groups = new Map();   // key → { key, label, codes:Set }
    for (const c of allCodes) {
      const desc = codes[c] && codes[c].description ? codes[c].description.trim() : '';
      const key = desc ? `d:${norm(desc)}` : `c:${c}`;
      if (!groups.has(key)) groups.set(key, { key, label: desc || c, codes: new Set(), described: !!desc, valvoline: false });
      groups.get(key).codes.add(c);
      if (codes[c] && codes[c].valvoline) groups.get(key).valvoline = true;
    }
    const list = [...groups.values()];
    for (const g of list) g.count = rows.filter(r => (r.codes || []).some(c => g.codes.has(c))).length;
    return list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [allCodes, codes, rows]);
  const serviceOfCode = useMemo(() => { const m = {}; services.forEach(g => g.codes.forEach(c => { m[c] = g; })); return m; }, [services]);
  const allAdvisors = useMemo(() => Object.keys(advisorCounts).sort(), [advisorCounts]);

  // Follow-up entries grouped by RO (newest first) and by the advisor who logged them.
  const entries = useMemo(() => Object.values(activity.entries || {}).sort((a, b) => (a.at < b.at ? 1 : -1)), [activity]);
  const byRoActivity = useMemo(() => { const m = {}; entries.forEach(e => { (m[e.ro] ||= []).push(e); }); return m; }, [entries]);
  const byAdvisorActivity = useMemo(() => { const m = {}; entries.forEach(e => { (m[firstWord(e.by)] ||= []).push(e); }); return m; }, [entries]);
  const tabAdvisors = useMemo(() => {
    const set = new Set((advisors || []).map(firstWord));
    Object.keys(byAdvisorActivity).forEach(a => set.add(a));
    return [...set].filter(Boolean).sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b)));
  }, [advisors, byAdvisorActivity, me]);
  const latestOf = (ro, type) => (byRoActivity[ro] || []).find(e => e.type === type) || null;
  const nextAppt = (ro) => { const t = isoToday(); const a = (byRoActivity[ro] || []).filter(e => e.type === 'appointment' && e.date >= t).sort((x, y) => (x.date < y.date ? -1 : 1)); return a[0] || latestOf(ro, 'appointment'); };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (selCodes.size && !(r.codes || []).some(c => serviceOfCode[c] && selCodes.has(serviceOfCode[c].key))) return false;
      if (onlyValvoline && !(r.codes || []).some(c => serviceOfCode[c] && serviceOfCode[c].valvoline)) return false;
      if (onlyUncontacted && (byRoActivity[r.ro] || []).length) return false;
      if (selAdvisors.size && !selAdvisors.has(r.advisor || '—')) return false;
      if (from && (!r.date || r.date < from)) return false;
      if (to && (!r.date || r.date > to)) return false;
      if (needle) {
        const hay = [r.customer, r.ro, r.phone, r.email, r.vin, r.vehicle, r.advisor, (r.codes || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, selCodes, selAdvisors, from, to, q, serviceOfCode, onlyValvoline, onlyUncontacted, byRoActivity]);

  const toggle = (set, setter, key) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); setter(n); setOpenRo(''); };
  const clearAll = () => { setSelCodes(new Set()); setSelAdvisors(new Set()); setFrom(''); setTo(''); setQ(''); setOpenRo(''); setOnlyValvoline(false); setOnlyUncontacted(false); };
  const anyFilter = selCodes.size || selAdvisors.size || from || to || q.trim() || onlyValvoline || onlyUncontacted;
  const uncontactedCount = useMemo(() => rows.filter(r => !(byRoActivity[r.ro] || []).length).length, [rows, byRoActivity]);

  // ── Follow-up actions ───────────────────────────────────────────────────
  function openAction(ro, type) {
    setAction({ ro, type }); setNote(''); setApptDate(''); setApptTime('');
  }
  async function saveAction() {
    if (!action) return;
    if (action.type === 'appointment' && !apptDate) { setStatus('❌ Pick the appointment date.'); return; }
    setBusy('action'); setStatus('');
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ro: action.ro, type: action.type, by: (currentUser || '').toUpperCase(), at: new Date().toISOString(),
      note: note.trim(), ...(action.type === 'appointment' ? { date: apptDate, time: apptTime } : {}),
    };
    try {
      await updateDeferredActivity(cur => ({ ...cur, entries: { ...(cur.entries || {}), [entry.id]: entry } }),
        `Deferred follow-up: ${entry.type} RO ${entry.ro} by ${entry.by}`);
      setActivity(a => ({ ...a, entries: { ...(a.entries || {}), [entry.id]: entry } }));
      setAction(null);
      trackAction(`deferred-${entry.type}`, entry.ro);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }
  async function deleteEntry(entry) {
    if (!isManager) return;
    if (!window.confirm(`Delete this ${entry.type === 'appointment' ? 'appointment' : 'contact'} entry for RO ${entry.ro} (logged by ${entry.by})?`)) return;
    setBusy('delete');
    try {
      await updateDeferredActivity(cur => { const e = { ...(cur.entries || {}) }; delete e[entry.id]; return { ...cur, entries: e }; }, `Deferred follow-up removed: ${entry.id}`);
      setActivity(a => { const e = { ...(a.entries || {}) }; delete e[entry.id]; return { ...a, entries: e }; });
      trackAction('deferred-entry-delete', entry.id);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }
  const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtApptDate = (d, t) => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); const ds = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); return t ? `${ds} · ${fmtTime(t)}` : ds; };
  const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`; };
  const rowByRo = useMemo(() => { const m = {}; rows.forEach(r => { m[r.ro] = r; }); return m; }, [rows]);
  const valvolineCount = useMemo(() => rows.filter(r => (r.codes || []).some(c => serviceOfCode[c] && serviceOfCode[c].valvoline)).length, [rows, serviceOfCode]);
  const hasValvoline = services.some(g => g.valvoline);

  // ── Upload (managers) ───────────────────────────────────────────────────
  async function handlePdf(file) {
    if (!file) return;
    setBusy('parse'); setStatus('📄 Reading the PDF…');
    try {
      const { rows: parsed, lastUpdate, warnings } = await parseDeferredPdf(file);
      const at = new Date().toISOString();
      let result = null;
      await updateDeferredRows(cur => {
        const { byRo, added, updated } = mergeRows(cur.byRo, parsed, at);
        result = { added, updated };
        const uploads = [{ at, by: currentUser || '', file: file.name, lastUpdate, rows: parsed.length }, ...(cur.uploads || [])].slice(0, 50);
        return { ...cur, byRo, uploads, updatedAt: at };
      });
      const fresh = await loadDeferredRows();
      setStore(fresh);
      setStatus(`✅ ${parsed.length} ROs read from ${file.name} — ${result.added} new, ${result.updated} refreshed${lastUpdate ? ` · report last updated ${fmtDate(lastUpdate)}` : ''}${warnings.length ? ` · ⚠️ ${warnings.length} line${warnings.length === 1 ? '' : 's'} skipped` : ''}`);
      trackAction('deferred-upload', file.name);
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  // ── Op-code descriptions (managers) ─────────────────────────────────────
  const [draftCodes, setDraftCodes] = useState(null);   // { CODE: description } while editing
  const [draftValv, setDraftValv] = useState(null);     // { CODE: true } while editing
  useEffect(() => { if (tab === 'settings') { setDraftCodes(Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, (v && v.description) || '']))); setDraftValv(Object.fromEntries(Object.entries(codes).filter(([, v]) => v && v.valvoline).map(([k]) => [k, true]))); } }, [tab, codes]);
  async function saveCodes() {
    setBusy('codes'); setStatus('');
    try {
      const at = new Date().toISOString();
      await updateDeferredCodes(cur => {
        const out = { ...cur };
        const allKeys = new Set([...Object.keys(draftCodes || {}), ...Object.keys(draftValv || {}), ...Object.keys(out)]);
        for (const code of allKeys) {
          const d = String((draftCodes || {})[code] || '').trim();
          const v = !!(draftValv || {})[code];
          if (!d && !v) { delete out[code]; continue; }
          const prev = out[code] || {};
          if (prev.description !== d || !!prev.valvoline !== v) out[code] = { ...prev, description: d, valvoline: v, updatedAt: at, by: currentUser || '' };
        }
        return out;
      });
      setCodes(await loadDeferredCodes());
      setStatus('✅ Op-code descriptions saved.');
      trackAction('deferred-codes-save');
    } catch (e) { setStatus('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  const uploads = (store && store.uploads) || [];

  const renderBadges = (ro) => {
    const c = latestOf(ro, 'contacted'), a = nextAppt(ro);
    if (!c && !a) return null;
    return (
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
        {c && <span className="ds-pill" style={{ background: 'rgba(74,222,128,.14)', borderColor: 'rgba(74,222,128,.4)', color: '#4ade80' }}>📞 {fmtWhen(c.at)} · {firstWord(c.by)}</span>}
        {a && <span className="ds-pill" style={{ background: 'rgba(250,204,21,.14)', borderColor: 'rgba(250,204,21,.45)', color: '#fde047' }}>📅 {fmtApptDate(a.date, a.time)} · {firstWord(a.by)}</span>}
      </div>
    );
  };
  const renderEntry = (e, showCustomer) => {
    const r = rowByRo[e.ro];
    const appt = e.type === 'appointment';
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, alignItems: 'start', padding: '10px 12px', borderRadius: 10, background: 'rgba(2,6,23,.4)', border: `1px solid ${appt ? 'rgba(250,204,21,.3)' : 'rgba(74,222,128,.3)'}` }}>
        <div style={{ fontSize: 18 }}>{appt ? '📅' : '📞'}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: appt ? '#fde047' : '#4ade80' }}>
            {appt ? `Appointment ${fmtApptDate(e.date, e.time)}` : 'Contacted customer'}
            <span style={{ fontWeight: 600, color: '#94a3b8', marginLeft: 8, fontSize: 11.5 }}>logged {fmtWhen(e.at)} by {firstWord(e.by)}</span>
          </div>
          {showCustomer && r && <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 2 }}><b style={{ color: '#f1f5f9' }}>{r.customer || 'No name'}</b> · RO {r.ro} · {r.vehicle} · <span style={{ color: '#67e8f9' }}>{fmtPhone(r.phone)}</span></div>}
          {showCustomer && !r && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>RO {e.ro}</div>}
          {e.note && <div style={{ fontSize: 13, color: '#e2e8f0', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{e.note}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {showCustomer && r && <button className="secondary" onClick={() => { setView('all'); setQ(r.ro); setOpenRo(r.ro); }} style={{ fontSize: 11, padding: '3px 8px' }}>Open</button>}
          {isManager && <button className="secondary" disabled={!!busy} onClick={() => deleteEntry(e)} title="Delete this entry (managers)" style={{ fontSize: 11, padding: '3px 8px', color: '#fca5a5', borderColor: 'rgba(248,113,113,.4)' }}>🗑</button>}
        </div>
      </div>
    );
  };
  const renderActionForm = (ro) => {
    if (!action || action.ro !== ro) return null;
    const appt = action.type === 'appointment';
    return (
      <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: appt ? 'rgba(250,204,21,.08)' : 'rgba(74,222,128,.08)', border: `1px solid ${appt ? 'rgba(250,204,21,.4)' : 'rgba(74,222,128,.4)'}` }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: appt ? '#fde047' : '#4ade80', marginBottom: 8 }}>
          {appt ? '📅 Appointment set' : '📞 Contacted customer'} <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: 11.5 }}>· {new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {(currentUser || '').toUpperCase()}</span>
        </div>
        {appt && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ display: 'grid', gap: 3 }}><span className="ds-label">Appointment date</span><input type="date" className="ds-in" value={apptDate} min={isoToday()} autoFocus onChange={e => setApptDate(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 3 }}><span className="ds-label">Time <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(optional)</span></span><input type="time" className="ds-in" value={apptTime} onChange={e => setApptTime(e.target.value)} /></label>
          </div>
        )}
        <textarea className="ds-in" rows={3} autoFocus={!appt} placeholder={appt ? 'Notes about the appointment — what they\'re coming in for, anything to prep…' : 'What did the customer say?'} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="secondary" onClick={() => setAction(null)} style={{ fontSize: 12 }}>Cancel</button>
          <button onClick={saveAction} disabled={busy === 'action' || (appt && !apptDate)} style={{ fontSize: 12.5 }}>{busy === 'action' ? '⏳ Saving…' : 'Save'}</button>
        </div>
      </div>
    );
  };
  const visibleServices = showAllCodes ? services : services.slice(0, 18);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔧 Deferred Service</div>
          <div className="adv-sub">{rows.length ? `${rows.length} repair orders with deferred work` : 'Declined & deferred work from the DMS report'}{uploads[0] ? ` · last upload ${new Date(uploads[0].at).toLocaleDateString()}` : ''}</div>
        </div>
        <div style={{ flex: 1 }} />
        {isManager && (
          <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 999, padding: 4 }}>
            {[['list', '🔍 Deferred Work'], ['settings', '⚙️ Settings']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className="secondary"
                style={{ borderRadius: 999, padding: '6px 14px', fontSize: 12.5, background: tab === k ? 'rgba(110,231,249,.18)' : 'transparent', borderColor: tab === k ? 'rgba(110,231,249,.5)' : 'transparent', color: tab === k ? '#67e8f9' : '#94a3b8' }}>
                {label}
              </button>
            ))}
          </div>
        )}
        <button className="secondary" onClick={onBack} style={{ marginLeft: 6 }}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>

          {tab === 'list' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className={`ds-tab${view === 'all' ? ' on' : ''}`} onClick={() => setView('all')}>All deferred work</button>
              {tabAdvisors.map(a => (
                <button key={a} className={`ds-tab${view === a ? ' on' : ''}`} onClick={() => { setView(a); setOpenRo(''); setAction(null); }}>
                  {a}{a === me ? ' (me)' : ''}<span className="n">{(byAdvisorActivity[a] || []).length}</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'list' && view !== 'all' && (
            <div className="ds-card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff' }}>{view}{view === me ? ' — my follow-ups' : "'s follow-ups"}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{(byAdvisorActivity[view] || []).length} entr{(byAdvisorActivity[view] || []).length === 1 ? 'y' : 'ies'} · {(byAdvisorActivity[view] || []).filter(e => e.type === 'appointment').length} appointments · newest first</div>
                {isManager && <div style={{ fontSize: 11.5, color: '#64748b' }}>🗑 removes an entry (managers only)</div>}
              </div>
              {status && <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>{status}</div>}
              <div style={{ display: 'grid', gap: 6 }}>
                {(byAdvisorActivity[view] || []).map(e => <React.Fragment key={e.id}>{renderEntry(e, true)}</React.Fragment>)}
                {!(byAdvisorActivity[view] || []).length && <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 20 }}>Nothing logged yet. Open a customer under All deferred work and use 📞 Contacted customer or 📅 Appointment set.</div>}
              </div>
            </div>
          )}

          {tab === 'list' && view === 'all' && (
            <>
              {/* Filters */}
              <div className="ds-card" style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="ds-in" style={{ flex: 1, minWidth: 220 }} placeholder="🔍 Search customer, RO #, phone, VIN, vehicle…" value={q} onChange={e => { setQ(e.target.value); setOpenRo(''); }} />
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="ds-label">Date</span>
                    <input type="date" className="ds-in" value={from} onChange={e => { setFrom(e.target.value); setOpenRo(''); }} style={{ padding: '6px 9px' }} />
                    <span style={{ color: '#64748b' }}>→</span>
                    <input type="date" className="ds-in" value={to} onChange={e => { setTo(e.target.value); setOpenRo(''); }} style={{ padding: '6px 9px' }} />
                    {[['30d', 30], ['60d', 60], ['90d', 90]].map(([l, n]) => (
                      <button key={l} className={`ds-chip${from === daysAgo(n) && !to ? ' on' : ''}`} onClick={() => { setFrom(daysAgo(n)); setTo(''); setOpenRo(''); }}>{l}</button>
                    ))}
                  </div>
                  {anyFilter ? <button className="secondary" onClick={clearAll} style={{ fontSize: 12 }}>✕ Clear</button> : null}
                </div>

                <div>
                  <div className="ds-label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span>Service type <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· click to filter, click again to remove</span></span>
                    <button className={`ds-chip${onlyUncontacted ? ' on' : ''}`} onClick={() => { setOnlyUncontacted(v => !v); setOpenRo(''); }} title="Only customers nobody has contacted yet">
                      ☎️ Not yet contacted <span className="n">{uncontactedCount}</span>
                    </button>
                    {hasValvoline && (
                      <button className={`ds-chip${onlyValvoline ? ' on' : ''}`} onClick={() => { setOnlyValvoline(v => !v); setOpenRo(''); }}
                        style={onlyValvoline ? { background: 'rgba(239,68,68,.2)', borderColor: 'rgba(239,68,68,.7)', color: '#fca5a5' } : { borderColor: 'rgba(239,68,68,.4)', color: '#fca5a5' }} title="Only Valvoline services">
                        🛢️ Valvoline only <span className="n">{valvolineCount}</span>
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {visibleServices.map(g => (
                      <button key={g.key} className={`ds-chip${selCodes.has(g.key) ? ' on' : ''}`} onClick={() => toggle(selCodes, setSelCodes, g.key)}
                        title={g.described ? `Op code${g.codes.size === 1 ? '' : 's'}: ${[...g.codes].join(', ')}` : 'No description yet — set one in Settings'}>
                        {g.valvoline && <span style={{ color: '#f87171', fontSize: 11 }} title="Valvoline service">🛢️</span>}{g.label} <span className="n">{g.count}</span>
                      </button>
                    ))}
                    {services.length > 18 && <button className="ds-chip" onClick={() => setShowAllCodes(v => !v)} style={{ color: '#67e8f9' }}>{showAllCodes ? 'Show fewer' : `+${services.length - 18} more`}</button>}
                    {!allCodes.length && !loading && <span style={{ fontSize: 12.5, color: '#64748b' }}>No report uploaded yet.</span>}
                  </div>
                </div>

                <div>
                  <div className="ds-label" style={{ marginBottom: 6 }}>Advisor</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {allAdvisors.map(a => (
                      <button key={a} className={`ds-chip${selAdvisors.has(a) ? ' on' : ''}`} onClick={() => toggle(selAdvisors, setSelAdvisors, a)}>
                        {a}{firstWord(a) === me ? ' (me)' : ''} <span className="n">{advisorCounts[a]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview list */}
              <div className="ds-card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff' }}>{anyFilter ? 'Matches' : 'All deferred work'}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{loading ? 'Loading…' : `${filtered.length} of ${rows.length} repair orders`}{selCodes.size ? ` · ${services.filter(g => selCodes.has(g.key)).map(g => g.label).join(', ')}` : ''}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>Click a customer for the full line from the report</div>
                </div>
                <div className="ds-row" style={{ background: 'transparent', border: 'none', cursor: 'default', padding: '0 14px 6px' }}>
                  <div className="ds-label">Customer</div><div className="ds-label ds-hide">Previous RO</div><div className="ds-label ds-hide">Advisor</div><div className="ds-label">Date</div><div />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {filtered.slice(0, 300).map(r => {
                    const open = openRo === r.ro;
                    return (
                      <div key={r.ro}>
                        <div className={`ds-row${open ? ' open' : ''}`} onClick={() => setOpenRo(open ? '' : r.ro)}>
                          <div>
                            <div style={{ fontSize: 14.5, fontWeight: 900, color: '#f1f5f9' }}>{r.customer || <span style={{ color: '#64748b', fontStyle: 'italic' }}>No name on report</span>}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{r.vehicle} · {(r.codes || []).length} deferred item{(r.codes || []).length === 1 ? '' : 's'}</div>
                            {renderBadges(r.ro)}
                          </div>
                          <div className="ds-hide" style={{ fontSize: 14, fontWeight: 800, color: '#67e8f9' }}>RO {r.ro}</div>
                          <div className="ds-hide" style={{ fontSize: 12.5, color: '#cbd5e1' }}>{r.advisor}</div>
                          <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>{fmtDate(r.date)}</div>
                          <div style={{ color: '#94a3b8' }}>{open ? '▾' : '▸'}</div>
                        </div>
                        {open && (
                          <div className="ds-detail">
                            <div className="ds-kv">
                              <div><div className="k">Customer</div><div className="v">{r.customer || '—'}</div></div>
                              <div><div className="k">Previous RO</div><div className="v">{r.ro}</div></div>
                              <div><div className="k">RO date</div><div className="v">{fmtDate(r.date)}</div></div>
                              <div><div className="k">Advisor</div><div className="v">{r.advisor || '—'}</div></div>
                              <div><div className="k">Phone</div><div className="v"><a href={`tel:${r.phone}`} style={{ color: '#67e8f9', textDecoration: 'none' }}>{fmtPhone(r.phone)}</a></div></div>
                              <div><div className="k">Email</div><div className="v">{r.email || '—'}</div></div>
                              <div><div className="k">Vehicle</div><div className="v">{r.vehicle || '—'}</div></div>
                              <div><div className="k">VIN</div><div className="v" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.vin || '—'}</div></div>
                              <div><div className="k">Hours</div><div className="v">{r.hours == null ? '—' : r.hours.toFixed(1)}</div></div>
                              <div><div className="k">Labor & parts</div><div className="v" style={{ color: '#6ee7b7' }}>{money(r.amount)}</div></div>
                              {r.uploadedAt && <div><div className="k">From upload</div><div className="v" style={{ color: '#94a3b8', fontWeight: 500 }}>{new Date(r.uploadedAt).toLocaleDateString()}</div></div>}
                            </div>
                            <div className="k ds-label" style={{ marginTop: 12 }}>Deferred op codes</div>
                            <div>
                              {(r.codes || []).map((c, i) => (
                                <span key={i} className="ds-code" style={serviceOfCode[c] && selCodes.has(serviceOfCode[c].key) ? { background: 'rgba(110,231,249,.18)', borderColor: 'rgba(110,231,249,.6)', color: '#a5f3fc' } : {}}>
                                  {c}{codes[c] && codes[c].description ? <small>{codes[c].description}</small> : null}
                                </span>
                              ))}
                            </div>

                            {/* Follow-up: log a call or an appointment against this RO */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                              <button onClick={() => openAction(r.ro, 'contacted')} style={{ background: 'linear-gradient(180deg,rgba(74,222,128,.28),rgba(22,163,74,.2))', borderColor: 'rgba(74,222,128,.5)', color: '#bbf7d0', fontSize: 13 }}>📞 Contacted customer</button>
                              <button onClick={() => openAction(r.ro, 'appointment')} style={{ background: 'linear-gradient(180deg,rgba(250,204,21,.28),rgba(245,158,11,.2))', borderColor: 'rgba(250,204,21,.5)', color: '#fef3c7', fontSize: 13 }}>📅 Appointment set</button>
                              {status && status.startsWith('❌') && <span style={{ fontSize: 12.5, color: '#f87171', fontWeight: 700, alignSelf: 'center' }}>{status}</span>}
                            </div>
                            {renderActionForm(r.ro)}
                            {(byRoActivity[r.ro] || []).length > 0 && (
                              <div style={{ marginTop: 12 }}>
                                <div className="ds-label" style={{ marginBottom: 6 }}>Follow-up history</div>
                                <div style={{ display: 'grid', gap: 6 }}>{(byRoActivity[r.ro] || []).map(e => <React.Fragment key={e.id}>{renderEntry(e, false)}</React.Fragment>)}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!loading && !filtered.length && <div style={{ color: '#64748b', textAlign: 'center', padding: 24, fontSize: 13 }}>{rows.length ? 'Nothing matches those filters.' : (isManager ? 'Upload the Deferred Services PDF under Settings to get started.' : 'No deferred-service report has been uploaded yet.')}</div>}
                  {filtered.length > 300 && <div style={{ color: '#94a3b8', textAlign: 'center', fontSize: 12, padding: 8 }}>Showing the first 300 — narrow the filters to see the rest.</div>}
                </div>
              </div>
            </>
          )}

          {tab === 'settings' && isManager && (
            <>
              <div className="ds-card">
                <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff', marginBottom: 6 }}>📥 Upload Deferred Services report (.pdf)</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 10 }}>
                  The DMS "Deferred Services" PDF. Every repair order on it is added to the list; an RO that's already here is refreshed with the newer line. Upload as often as you like — nothing is thrown away.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept=".pdf,application/pdf" disabled={!!busy} onChange={e => handlePdf(e.target.files && e.target.files[0])} style={{ fontSize: 12, color: '#cbd5e1' }} />
                  {busy === 'parse' && <span style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700 }}>⏳ Reading…</span>}
                </div>
                {status && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: status.startsWith('❌') ? '#f87171' : '#6ee7b7' }}>{status}</div>}
                {uploads.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="ds-label" style={{ marginBottom: 6 }}>Upload history</div>
                    <table className="ds-table"><thead><tr><th>When</th><th>By</th><th>File</th><th>Report updated</th><th>ROs</th></tr></thead>
                      <tbody>{uploads.slice(0, 10).map((u, i) => <tr key={i}><td>{new Date(u.at).toLocaleString()}</td><td>{u.by}</td><td>{u.file}</td><td>{fmtDate(u.lastUpdate)}</td><td>{u.rows}</td></tr>)}</tbody></table>
                  </div>
                )}
              </div>

              <div className="ds-card">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff' }}>🏷️ Deferred op codes</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{allCodes.length} codes seen on the reports · give each a description advisors will recognise. Codes with the <b>same description</b> are treated as one service (one filter chip).</div>
                  <div style={{ flex: 1 }} />
                  <button onClick={saveCodes} disabled={!!busy || !draftCodes} style={{ fontSize: 13 }}>{busy === 'codes' ? '⏳ Saving…' : '💾 Save'}</button>
                </div>
                {!allCodes.length ? <div style={{ fontSize: 12.5, color: '#64748b' }}>Codes appear here after the first upload.</div> : (
                  <table className="ds-table">
                    <thead><tr><th style={{ width: 150 }}>Op code</th><th style={{ width: 70 }}>ROs</th><th>Description shown to advisors</th><th style={{ width: 130 }}>Valvoline</th></tr></thead>
                    <tbody>
                      {allCodes.map(c => (
                        <tr key={c}>
                          <td style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800, color: '#e9d5ff' }}>{c}</td>
                          <td style={{ color: '#94a3b8' }}>{codeCounts[c]}</td>
                          <td>
                            <input className="ds-in" style={{ width: '100%', padding: '6px 9px' }} placeholder="e.g. Cabin air filter" value={(draftCodes && draftCodes[c]) || ''} onChange={e => setDraftCodes(d => ({ ...(d || {}), [c]: e.target.value }))} />
                            {serviceOfCode[c] && serviceOfCode[c].codes.size > 1 && (
                              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>Same service as {[...serviceOfCode[c].codes].filter(x => x !== c).join(', ')} — shown as one filter chip.</div>
                            )}
                          </td>
                          <td>
                            <button className="ds-chip" onClick={() => setDraftValv(d => { const n = { ...(d || {}) }; if (n[c]) delete n[c]; else n[c] = true; return n; })}
                              style={(draftValv || {})[c] ? { background: 'rgba(239,68,68,.2)', borderColor: 'rgba(239,68,68,.7)', color: '#fca5a5' } : {}} title="Mark this op code as a Valvoline service">
                              {(draftValv || {})[c] ? '🛢️ Valvoline' : 'Valvoline'}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {Object.keys(codes).filter(c => !codeCounts[c]).map(c => (
                        <tr key={c} style={{ opacity: .6 }}>
                          <td style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 800, color: '#c4b5fd' }}>{c}</td>
                          <td style={{ color: '#64748b' }}>0</td>
                          <td><input className="ds-in" style={{ width: '100%', padding: '6px 9px' }} value={(draftCodes && draftCodes[c]) || ''} onChange={e => setDraftCodes(d => ({ ...(d || {}), [c]: e.target.value }))} /></td>
                          <td>{(draftValv || {})[c] ? <span style={{ color: '#fca5a5', fontSize: 12 }}>🛢️ Valvoline</span> : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
