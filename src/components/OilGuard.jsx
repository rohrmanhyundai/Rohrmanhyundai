// Oil Guard 3X — look up a VIN and see how many prepaid oil changes are left.
//
// Look up (everyone): VIN (or its last 6+ characters) → oil changes left, each
// package bought and each oil change used, with the RO and date.
// Settings (managers): upload the DMS "Schedule 3029 — Schedule Summary with
// Detail" PDF (full history; replaces the last upload) and work the list of
// problems the reader found. Fixes are remembered across uploads.
// The counting rules live in utils/oilGuard.js.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import { loadPdfJs } from '../utils/pdfText';
import { parseLines, analyseAll, cleanVin, prettyDate, PER_PACKAGE } from '../utils/oilGuard';

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '11px 14px', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', outline: 'none', letterSpacing: '.06em' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });

// PDF → text lines, rebuilt from each item's position (items on the same
// baseline are one line, left to right).
export async function pdfToLines(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const items = (await page.getTextContent()).items.filter(i => i.str && i.str.trim());
    const rows = [];
    for (const it of items) {
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' '));
  }
  return lines;
}

// ── Call-back list ───────────────────────────────────────────────────────────
// Customers whose LAST Oil Guard visit (a package bought or an oil change) fell
// in the chosen range and who still have oil changes left — they haven't been
// back since. Name / phone / vehicle come from the Deferred Services data where
// the VIN matches; the rest are looked up in the DMS by VIN or RO.
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoDay(d); };
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || ''); };

// "hyundai" / "TOM PIERCE" → "Hyundai" / "Tom Pierce". Mixed-case text (a
// name someone typed properly, "iPhone"-style models) is left alone.
const tidy = (s) => {
  const t = String(s || '').trim();
  if (!t || (t !== t.toLowerCase() && t !== t.toUpperCase())) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
};

function customerIndex(deferred) {
  const by = {};
  for (const r of Object.values((deferred && deferred.byRo) || {})) {
    const v = String(r.vin || '').toUpperCase();
    if (!v) continue;
    if (!by[v] || String(r.date || '') > String(by[v].date || '')) by[v] = r;   // newest wins
  }
  return by;
}

export function callBackRows(analysed, from, to, people = {}) {
  const rows = [];
  for (const a of Object.values(analysed)) {
    if (!(a.left > 0)) continue;
    const visits = a.events.filter(e => e.kind === 'use' || e.kind === 'package' || e.kind === 'credit');
    if (!visits.length) continue;
    const last = visits[visits.length - 1];
    if ((from && last.date < from) || (to && last.date > to)) continue;
    const c = people[a.vin] || {};
    const vehicle = [c.year, tidy(c.make), c.model].filter(Boolean).join(' ') || c.vehicle || '';
    rows.push({ vin: a.vin, left: a.left, lastDate: last.date, lastRo: last.ro, lastKind: last.kind,
      customer: tidy(c.customer), phone: fmtPhone(c.phone), email: c.email || '', vehicle });
  }
  return rows.sort((x, y) => x.lastDate.localeCompare(y.lastDate));
}

async function callBackPdf(rows, from, to, stamp, leftOnly = 0) {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 36;
  const cols = [
    ['Customer', 150], ['Phone', 92], ['Vehicle', 150], ['VIN', 128], ['Last visit', 62], ['Last RO', 58], ['Left', 32], ['Called / notes', 0],
  ];
  const fixed = cols.reduce((s, c) => s + c[1], 0);
  cols[cols.length - 1][1] = W - 2 * M - fixed;
  const range = `${from ? prettyDate(from) : 'start'} – ${to ? prettyDate(to) : 'today'}`;
  let y = 0, page = 0;
  const head = () => {
    page += 1;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(15, 23, 42);
    pdf.text('Oil Guard — call-back list', M, M + 4);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(100, 116, 139);
    pdf.text(`Last visit ${range} · ${leftOnly ? `${leftOnly} oil change${leftOnly === 1 ? '' : 's'} left` : 'oil changes still left'} · ${rows.length} customer${rows.length === 1 ? '' : 's'}${stamp ? ` · report as of ${stamp}` : ''}`, M, M + 19);
    pdf.text(`Page ${page}`, W - M, M + 4, { align: 'right' });
    y = M + 38;
    pdf.setFillColor(226, 232, 240); pdf.rect(M, y - 11, W - 2 * M, 16, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(30, 41, 59);
    let x = M + 4; for (const [k, w] of cols) { pdf.text(k.toUpperCase(), x, y); x += w; }
    y += 16;
  };
  head();
  pdf.setFontSize(9.5);
  rows.forEach((r, i) => {
    if (y > H - M - 10) { pdf.addPage(); head(); pdf.setFontSize(9.5); }
    if (i % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y - 11, W - 2 * M, 16, 'F'); }
    const cells = [r.customer || '—', r.phone || '—', r.vehicle || '—', r.vin, prettyDate(r.lastDate), r.lastRo || '', String(r.left), ''];
    let x = M + 4;
    cells.forEach((c, k) => {
      pdf.setFont('helvetica', k === 0 || k === 6 ? 'bold' : 'normal'); pdf.setTextColor(15, 23, 42);
      const w = cols[k][1] - 6;
      const t = pdf.splitTextToSize(String(c), w)[0] || '';
      pdf.text(t, x, y); x += cols[k][1];
    });
    pdf.setDrawColor(226, 232, 240); pdf.line(M, y + 5, W - M, y + 5);
    y += 16;
  });
  pdf.save(`oil-guard-call-back-${from || 'start'}-to-${to || 'today'}${leftOnly ? `-${leftOnly}-left` : ''}.pdf`);
}

function CallBack({ analysed, stamp, loadDeferredRows }) {
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(monthsAgo(3));
  const [people, setPeople] = useState(null);
  const [making, setMaking] = useState(false);
  const [leftOnly, setLeftOnly] = useState(0);   // 0 = everyone, else exactly this many left
  useEffect(() => {
    let cancelled = false;
    loadDeferredRows().then(d => { if (!cancelled) setPeople(customerIndex(d)); }).catch(() => { if (!cancelled) setPeople({}); });
    return () => { cancelled = true; };
  }, [loadDeferredRows]);
  const rows = useMemo(() => callBackRows(analysed, from, to, people || {}).filter(r => !leftOnly || r.left === leftOnly), [analysed, from, to, people, leftOnly]);
  const named = rows.filter(r => r.customer || r.phone).length;
  const preset = (a, b) => { setFrom(monthsAgo(a)); setTo(b == null ? isoDay(new Date()) : monthsAgo(b)); };
  const dateIn = { ...inputStyle, fontSize: 14, padding: '7px 10px', letterSpacing: 0, colorScheme: 'dark' };
  return (
    <div style={card}>
      <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>📞 Call-back list</div>
      <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
        Customers whose <b>last</b> Oil Guard visit was in this range and who still have oil changes left — they haven't been back since.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 800 }}>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateIn} /></label>
        <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 800 }}>To <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateIn} /></label>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>Quick:</span>
        <button style={btn('110,231,249', false)} onClick={() => preset(6, 3)}>3–6 mo ago</button>
        <button style={btn('110,231,249', false)} onClick={() => preset(12, 6)}>6–12 mo ago</button>
        <button style={btn('110,231,249', false)} onClick={() => preset(24, 12)}>Over a year</button>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 800, marginLeft: 6 }}>Show:</span>
        {[[0, 'All'], [2, '2 left'], [1, '1 left']].map(([n, label]) => (
          <button key={n} style={btn('74,222,128', leftOnly === n)} onClick={() => setLeftOnly(n)}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button disabled={!rows.length || making} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 16px' }}
          onClick={async () => { setMaking(true); try { await callBackPdf(rows, from, to, stamp, leftOnly); } finally { setMaking(false); } }}>
          {making ? '⏳ Making…' : '📄 Create .pdf'}
        </button>
      </div>
      <div style={{ fontSize: 13.5, color: '#cbd5e1', fontWeight: 800, marginTop: 12 }}>
        {people == null ? 'Loading customer names…' : `${rows.length} customer${rows.length === 1 ? '' : 's'} · ${rows.reduce((s, r) => s + r.left, 0)} oil changes waiting${rows.length ? ` · ${named} with a name/phone on file` : ''}`}
      </div>
      {rows.length > 0 && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          {/* auto layout: the app-wide table rule is fixed-width columns, which cut names and VINs short */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, tableLayout: 'auto' }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {['Customer', 'Phone', 'Vehicle', 'VIN', 'Last visit', 'Last RO', 'Left'].map(h => <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(148,163,184,.2)' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.vin} style={{ borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                  <td style={{ padding: '7px 8px', fontWeight: 800, color: r.customer ? '#f1f5f9' : '#64748b' }}>{r.customer || '— look up in DMS'}</td>
                  <td style={{ padding: '7px 8px', color: '#cbd5e1', whiteSpace: 'nowrap' }}>{r.phone ? <a href={`tel:${r.phone.replace(/\D/g, '')}`} style={{ color: '#7dd3fc' }}>{r.phone}</a> : '—'}</td>
                  <td style={{ padding: '7px 8px', color: '#cbd5e1' }}>{r.vehicle || '—'}</td>
                  <td style={{ padding: '4px 8px' }}><CopyText value={r.vin} mono title="Click to copy the VIN" /></td>
                  <td style={{ padding: '7px 8px', color: '#cbd5e1', whiteSpace: 'nowrap' }}>{prettyDate(r.lastDate)}</td>
                  <td style={{ padding: '4px 8px' }}>{r.lastRo ? <CopyRo ro={r.lastRo} /> : '—'}</td>
                  <td style={{ padding: '7px 8px', fontWeight: 1000, color: '#4ade80', fontSize: 16 }}>{r.left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeftBadge({ left }) {
  const col = left > 0 ? '#4ade80' : left === 0 ? '#94a3b8' : '#f87171';
  return (
    <div style={{ textAlign: 'center', minWidth: 150 }}>
      <div style={{ fontSize: 64, fontWeight: 1000, color: col, lineHeight: 1, textShadow: left > 0 ? '0 0 24px rgba(74,222,128,.45)' : 'none' }}>{left}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color: '#94a3b8', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 4 }}>
        oil change{left === 1 ? '' : 's'} left
      </div>
    </div>
  );
}

// Click an RO number (or a VIN) to copy it, for pasting into the DMS search.
function CopyText({ value, children, title, width, mono }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); }
    catch {
      // Older browsers / non-https: fall back to a hidden textarea.
      const t = document.createElement('textarea'); t.value = String(value); document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {} document.body.removeChild(t);
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <button type="button" onClick={copy} title={title || 'Click to copy'}
      style={{ width, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: mono ? 'ui-monospace,monospace' : 'inherit', fontSize: mono ? 12.5 : 'inherit', background: done ? 'rgba(74,222,128,.15)' : 'transparent', border: `1px solid ${done ? 'rgba(74,222,128,.5)' : 'transparent'}`,
        borderRadius: 7, padding: '2px 6px', margin: '-3px 0', color: done ? '#86efac' : '#94a3b8', fontWeight: 800, cursor: 'copy' }}
      onMouseEnter={e => { if (!done) e.currentTarget.style.borderColor = 'rgba(110,231,249,.45)'; }}
      onMouseLeave={e => { if (!done) e.currentTarget.style.borderColor = 'transparent'; }}>
      {done ? '✓ Copied' : <>{children || value} <span style={{ fontSize: 11, opacity: .7 }}>⧉</span></>}
    </button>
  );
}
const CopyRo = ({ ro }) => <CopyText value={ro} width={110} title="Click to copy the RO number">RO {ro}</CopyText>;

function VinResult({ a }) {
  const dots = (pkgNo) => {
    const used = a.events.filter(e => e.kind === 'use' && e.pkgNo === pkgNo).length;
    return Array.from({ length: PER_PACKAGE }, (_, i) => (
      <span key={i} title={i < used ? 'Used' : 'Available'} style={{ width: 16, height: 16, borderRadius: '50%', display: 'inline-block', background: i < used ? 'rgba(148,163,184,.25)' : '#4ade80', boxShadow: i < used ? 'none' : '0 0 8px rgba(74,222,128,.7)', border: '1px solid rgba(148,163,184,.35)' }} />
    ));
  };
  const open = a.issues.filter(i => !i.resolved && !i.minor);
  return (
    <div style={{ ...card, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <LeftBadge left={a.left} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 22, fontWeight: 1000, color: '#f1f5f9', letterSpacing: '.06em' }}>{a.vin}</div>
          <div style={{ fontSize: 14, color: '#94a3b8', fontWeight: 700, marginTop: 4 }}>
            {a.packages} package{a.packages === 1 ? '' : 's'} bought · {a.used} oil change{a.used === 1 ? '' : 's'} used
            {a.adjust ? ` · ${a.adjust > 0 ? '+' : ''}${a.adjust} adjusted by a manager` : ''}
          </div>
          {a.note && <div style={{ fontSize: 13, color: '#fde68a', marginTop: 6 }}>📝 {a.note}</div>}
          {open.length > 0 && <div style={{ fontSize: 13, color: '#fca5a5', fontWeight: 800, marginTop: 6 }}>⚠️ A manager is checking this one — {open[0].title.toLowerCase()}.</div>}
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'grid', gap: 6 }}>
        {a.events.filter(e => e.kind !== 'ignore').map(e => (
          <div key={e.key + e.kind} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 10, flexWrap: 'wrap',
            background: e.kind === 'package' || e.kind === 'credit' ? 'rgba(74,222,128,.08)' : 'rgba(255,255,255,.03)',
            border: `1px solid ${e.kind === 'package' || e.kind === 'credit' ? 'rgba(74,222,128,.3)' : 'rgba(148,163,184,.14)'}` }}>
            <span style={{ width: 82, fontWeight: 800, color: '#cbd5e1' }}>{prettyDate(e.date)}</span>
            {e.ro ? <CopyRo ro={e.ro} /> : <span style={{ width: 110 }} />}
            {e.kind === 'package' ? (
              <span style={{ fontWeight: 900, color: '#86efac' }}>💳 Package {e.pkgNo} bought — ${Math.abs(e.amount).toFixed(2)} <span style={{ marginLeft: 8 }}>{dots(e.pkgNo)}</span></span>
            ) : e.kind === 'credit' ? (
              <span style={{ fontWeight: 900, color: '#86efac' }}>➕ {e.credit} oil change{e.credit === 1 ? '' : 's'} added{e.text ? ` (${e.text})` : ''}</span>
            ) : e.kind === 'use' ? (
              <span style={{ fontWeight: 800, color: '#e2e8f0' }}>
                🛢 Oil change {e.nth > PER_PACKAGE || !e.pkgNo ? '(no package)' : `${e.nth} of ${PER_PACKAGE}`}
                {e.misbilled && <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 12.5 }}> · {e.misbilled}</span>}
              </span>
            ) : <span style={{ color: '#fca5a5', fontWeight: 700 }}>Unread line — {e.text || e.unparsed}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueRow({ vin, issue, onFix, busy }) {
  const [n, setN] = useState(issue.suggestCredit || 1);
  const [adj, setAdj] = useState(1);
  const [note, setNote] = useState('');
  const save = (key, fix) => onFix(key, { ...fix, note: note.trim() || undefined });
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: issue.resolved ? 'rgba(74,222,128,.06)' : issue.minor ? 'rgba(251,191,36,.06)' : 'rgba(248,113,113,.07)',
      border: `1px solid ${issue.resolved ? 'rgba(74,222,128,.3)' : issue.minor ? 'rgba(251,191,36,.3)' : 'rgba(248,113,113,.35)'}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 1000, color: '#f1f5f9', letterSpacing: '.04em' }}>{vin}</span>
        <span style={{ fontWeight: 800, color: issue.resolved ? '#86efac' : issue.minor ? '#fbbf24' : '#fca5a5' }}>{issue.resolved ? '✓ ' : ''}{issue.title}</span>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>{issue.detail}</div>
      {issue.resolved ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {issue.fixedBy && <span style={{ fontSize: 12.5, color: '#86efac', fontWeight: 800 }}>{issue.fixedBy}</span>}
          {issue.note && <span style={{ fontSize: 12.5, color: '#fde68a' }}>📝 {issue.note}</span>}
          <button disabled={busy} style={btn('148,163,184', false)} onClick={() => onFix(issue.undoKey, null)}>↩ Undo fix</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
          {issue.fixes.includes('package') && <button disabled={busy} style={btn('74,222,128')} onClick={() => save(issue.lineKey, { as: 'package' })}>Count as a package (+{PER_PACKAGE})</button>}
          {issue.fixes.includes('use') && <button disabled={busy} style={btn('125,211,252')} onClick={() => save(issue.lineKey, { as: 'use' })}>Count as an oil change (−1)</button>}
          {issue.fixes.includes('credit') && (
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <button disabled={busy} style={btn('74,222,128')} onClick={() => save(issue.lineKey, { as: 'credit', n: Number(n) || 0 })}>Add</button>
              <input type="number" min="1" max="9" value={n} onChange={e => setN(e.target.value)} style={{ ...inputStyle, width: 58, padding: '5px 8px', fontSize: 14 }} />
              <span style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 700 }}>oil changes (transfer in)</span>
            </span>
          )}
          {issue.fixes.includes('ignore') && <button disabled={busy} style={btn('148,163,184')} onClick={() => save(issue.lineKey, { as: 'ignore' })}>Ignore this line</button>}
          {issue.fixes.includes('adjust') && (
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
              <button disabled={busy} style={btn('192,132,252')} onClick={() => save(`${vin}|*`, { adjust: Number(adj) || 0 })}>Adjust left by</button>
              <input type="number" min="-9" max="9" value={adj} onChange={e => setAdj(e.target.value)} style={{ ...inputStyle, width: 62, padding: '5px 8px', fontSize: 14 }} />
            </span>
          )}
          {issue.fixes.includes('reviewed') && <button disabled={busy} style={btn('251,191,36')} onClick={() => save(issue.id, { reviewed: true })}>✓ Mark reviewed — leave as is</button>}
          <input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ ...inputStyle, fontSize: 13, padding: '6px 10px', letterSpacing: 0, fontWeight: 600, flex: 1, minWidth: 160 }} />
        </div>
      )}
    </div>
  );
}

export default function OilGuard({ currentUser, currentRole, onBack, initialTab, io }) {
  // Storage — swappable so it can be exercised without touching live data.
  const { loadOilGuard, saveOilGuard, loadOilGuardFixes, updateOilGuardFixes, loadDeferredRows } = io || github;
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [tab, setTab] = useState(initialTab === 'settings' && isManager ? 'settings' : 'lookup');
  const [store, setStore] = useState(null);
  const [fixes, setFixes] = useState({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // { store, analysed }
  const [showFixed, setShowFixed] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOilGuard(), loadOilGuardFixes()]).then(([s, f]) => {
      if (cancelled) return;
      setStore(s); setFixes((f && f.fixes) || {}); setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const analysed = useMemo(() => analyseAll(store, fixes), [store, fixes]);

  // Search: full VIN, or the last 6+ characters (what's on the key tag / RO).
  const term = cleanVin(q);
  const matches = useMemo(() => {
    if (term.length < 6) return [];
    return Object.keys(analysed).filter(v => v === term || v.endsWith(term) || (term.length >= 8 && v.includes(term))).slice(0, 12);
  }, [term, analysed]);
  const shown = picked && analysed[picked] ? analysed[picked] : matches.length === 1 ? analysed[matches[0]] : null;

  async function onPdf(file) {
    if (!file) return;
    setBusy(true); setStatus('📄 Reading the PDF…'); setPreview(null);
    try {
      const lines = await pdfToLines(file);
      const parsed = parseLines(lines);
      if (!parsed.blocks.length) throw new Error('No VINs found — is this the Schedule 3029 Summary with Detail report?');
      const next = { uploadedAt: new Date().toISOString(), by: currentUser, fileName: file.name, reportStamp: parsed.reportStamp, blocks: parsed.blocks, stray: parsed.stray };
      setPreview({ store: next, analysed: analyseAll(next, fixes) });
      setStatus('');
    } catch (e) {
      setStatus('❌ ' + (e.message || e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function savePreview() {
    if (!preview) return;
    setBusy(true); setStatus('💾 Saving…');
    try {
      await saveOilGuard(preview.store);
      setStore(preview.store); setPreview(null);
      setStatus(`✅ Saved — ${preview.store.blocks.length} VINs from ${preview.store.fileName}.`);
    } catch (e) { setStatus('❌ ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  async function applyFix(key, fix) {
    setBusy(true);
    try {
      const res = await updateOilGuardFixes(cur => {
        const f = { ...(cur.fixes || {}) };
        if (fix) f[key] = { ...fix, by: currentUser, at: new Date().toISOString() }; else delete f[key];
        return { ...cur, fixes: f };
      });
      const next = (res && res.fixes) || (() => { const f = { ...fixes }; if (fix) f[key] = fix; else delete f[key]; return f; })();
      setFixes(next);
    } catch (e) { setStatus('❌ ' + (e.message || e)); }
    finally { setBusy(false); }
  }

  const src = preview ? preview.analysed : analysed;
  const issueList = Object.values(src).flatMap(a => a.issues.map(i => ({ vin: a.vin, issue: i })))
    .filter(x => (showFixed || !x.issue.resolved) && (showMinor || !x.issue.minor || x.issue.resolved && showFixed));
  const counts = Object.values(src).reduce((c, a) => {
    a.issues.forEach(i => { if (!i.resolved) { if (i.minor) c.minor++; else c.open++; } else c.fixed++; });
    c.packages += a.packages; c.used += a.used; c.left += Math.max(0, a.left); return c;
  }, { open: 0, minor: 0, fixed: 0, packages: 0, used: 0, left: 0 });

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ background: tab === k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${tab === k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: tab === k ? '#6ee7f9' : '#94a3b8', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>{label}</button>
  );

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="adv-title">🛢 Oil Guard</div>
          <div className="adv-sub">Prepaid oil changes — {PER_PACKAGE} per package{store && store.reportStamp ? ` · report as of ${store.reportStamp}` : ''}</div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0 }}>
        {tabBtn('lookup', '🔎 Look up a VIN')}
        {tabBtn('callback', '📞 Call-back list')}
        {isManager && tabBtn('settings', `⚙️ Settings${counts.open && !preview ? ` · ${counts.open} to fix` : ''}`)}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 40px 40px' }}>
        <div style={{ maxWidth: tab === 'callback' ? 1400 : 980, margin: '0 auto' }}>
          {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div> : tab === 'callback' ? (
            store ? <CallBack analysed={analysed} stamp={store.reportStamp} loadDeferredRows={loadDeferredRows} />
              : <div style={{ ...card, color: '#fbbf24', fontWeight: 700 }}>No Oil Guard report uploaded yet.</div>
          ) : tab === 'lookup' ? (
            <>
              {!store ? (
                <div style={{ ...card, color: '#fbbf24', fontWeight: 700 }}>No Oil Guard report uploaded yet.{isManager ? ' Upload one on the Settings tab.' : ' Ask a manager to upload it.'}</div>
              ) : (
                <>
                  <form onSubmit={e => { e.preventDefault(); setPicked(matches.length === 1 ? matches[0] : ''); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <input autoFocus value={q} onChange={e => { setQ(e.target.value); setPicked(''); }} placeholder="VIN — or its last 6 characters"
                      style={{ ...inputStyle, flex: 1, minWidth: 260, textTransform: 'uppercase' }} />
                    <button type="submit" style={{ ...btn('110,231,249'), fontSize: 15, padding: '10px 22px' }}>Search</button>
                  </form>
                  {term.length > 0 && term.length < 6 && <div style={{ color: '#94a3b8', marginTop: 10, fontSize: 13 }}>Type at least 6 characters of the VIN.</div>}
                  {term.length >= 6 && matches.length === 0 && (
                    <div style={{ ...card, marginTop: 16, color: '#cbd5e1' }}>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>No Oil Guard on file for {term}.</div>
                      <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4 }}>This vehicle hasn't bought an Oil Guard package (as of the last report).</div>
                    </div>
                  )}
                  {matches.length > 1 && !picked && (
                    <div style={{ ...card, marginTop: 16 }}>
                      <div style={{ fontWeight: 800, color: '#cbd5e1', marginBottom: 8 }}>{matches.length} VINs match — pick one:</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {matches.map(v => <button key={v} style={btn('110,231,249')} onClick={() => setPicked(v)}>{v} · {analysed[v].left} left</button>)}
                      </div>
                    </div>
                  )}
                  {shown && <VinResult a={shown} />}
                </>
              )}
            </>
          ) : (
            <>
              <div style={card}>
                <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Upload the Oil Guard report</div>
                <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                  DMS → Schedule <b>3029 OIL GUARD 3X</b> → <b>Schedule Summary with Detail</b>, saved as PDF. Upload the full history each time — it replaces
                  the last upload, and every fix below is kept and re-applied.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => onPdf(e.target.files && e.target.files[0])} />
                  <button disabled={busy} style={{ ...btn('110,231,249'), fontSize: 14, padding: '9px 18px' }} onClick={() => fileRef.current && fileRef.current.click()}>📤 Choose PDF</button>
                  {store && !preview && <span style={{ fontSize: 13, color: '#94a3b8' }}>Last upload: <b style={{ color: '#cbd5e1' }}>{store.fileName}</b> · {store.blocks.length} VINs · {new Date(store.uploadedAt).toLocaleString()} by {store.by}</span>}
                  {status && <span style={{ fontSize: 13.5, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
                </div>
                {preview && (
                  <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(110,231,249,.07)', border: '1px solid rgba(110,231,249,.3)' }}>
                    <div style={{ fontWeight: 900, color: '#6ee7f9' }}>Read {preview.store.blocks.length} VINs from {preview.store.fileName}{preview.store.reportStamp ? ` (as of ${preview.store.reportStamp})` : ''}</div>
                    <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 4 }}>
                      {counts.packages} packages · {counts.used} oil changes used · {counts.left} still owed to customers ·{' '}
                      <b style={{ color: counts.open ? '#fca5a5' : '#86efac' }}>{counts.open} problem{counts.open === 1 ? '' : 's'} to fix</b>
                      {counts.minor ? ` · ${counts.minor} billing slip${counts.minor === 1 ? '' : 's'}` : ''}
                      {preview.store.stray && preview.store.stray.length ? ` · ${preview.store.stray.length} line(s) with no VIN above them were skipped` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button disabled={busy} style={{ ...btn('74,222,128'), fontSize: 14, padding: '8px 18px' }} onClick={savePreview}>✓ Save — replace the current report</button>
                      <button disabled={busy} style={btn('148,163,184', false)} onClick={() => { setPreview(null); setStatus(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ ...card, marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9', flex: 1 }}>
                    Problems found {preview ? 'in this upload' : ''} — <span style={{ color: counts.open ? '#fca5a5' : '#86efac' }}>{counts.open} to fix</span>
                  </div>
                  <label style={{ fontSize: 13, color: '#94a3b8', display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} /> Billing slips ({counts.minor})</label>
                  <label style={{ fontSize: 13, color: '#94a3b8', display: 'inline-flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showFixed} onChange={e => setShowFixed(e.target.checked)} /> Fixed ({counts.fixed})</label>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                  Billing slips (wrong OG number) don't change the count — they're just worth knowing. Fixes are saved right away and kept for future uploads.
                  {preview ? ' Fixes made here apply once you save the upload.' : ''}
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  {issueList.length === 0
                    ? <div style={{ color: '#86efac', fontWeight: 800 }}>✓ Nothing to fix.</div>
                    : issueList.map(({ vin, issue }) => <IssueRow key={issue.id} vin={vin} issue={issue} onFix={applyFix} busy={busy} />)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
