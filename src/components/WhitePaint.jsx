import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as github from '../utils/github';
import {
  readPaintPdf, planImport, newId, isPdf,
  cleanVin, fmtPhone, fmtDate, todayIso, tidyName,
} from '../utils/whitePaint';

// ── White Paint ───────────────────────────────────────────────────────────────
// Waiting list of customers whose white paint needs redoing. The top row is the
// next customer up for paint. Anyone with the page can view and add (new adds
// go to the bottom). Managers can reorder, edit, mark painted (moves to the
// Painted history), remove, and import the paint list PDF — a re-upload merges
// by VIN (see utils/whitePaint planImport).
// Stored in data/white-paint/list.json → { queue: [...], done: [...] }.

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '7px 13px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' });
const actionBtn = (rgb) => ({ ...btn(rgb), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 32, padding: '0 11px', boxSizing: 'border-box', lineHeight: 1, margin: 0, whiteSpace: 'nowrap' });
const th = { textAlign: 'left', padding: '9px 10px', fontSize: 12, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid rgba(148,163,184,.25)', whiteSpace: 'nowrap' };
// App.css clips every td (fixed layout + ellipsis); these tables size to content.
const td = { padding: '9px 10px', fontSize: 14, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.1)', verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' };
const mono = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, letterSpacing: '.03em' };
const muted = <span style={{ color: '#64748b' }}>—</span>;

const EMPTY = () => ({ firstName: '', lastName: '', vin: '', phone: '', dateAdded: todayIso(), notes: '' });
const FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['vin', 'VIN'], ['phone', 'Phone number', 'tel'], ['dateAdded', 'Date put on list', 'date'],
];

function formWarnings(d, queue, selfId) {
  const w = [];
  const vin = cleanVin(d.vin);
  if (vin && vin.length !== 17) w.push(`VIN is ${vin.length} characters (should be 17)`);
  const twin = queue.find(e => e.id !== selfId && vin && cleanVin(e.vin) === vin);
  if (twin) w.push(`${twin.firstName} ${twin.lastName} is already on the list with this VIN`);
  return w;
}

export default function WhitePaint({ currentUser, currentRole, onBack, backLabel = '← Back', initialTab, io }) {
  const { loadWhitePaint, updateWhitePaint } = io || github;
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [tab, setTab] = useState(initialTab === 'import' && isManager ? 'import' : initialTab === 'add' ? 'add' : 'list');
  const [store, setStore] = useState({ queue: [], done: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState('');           // `${id}:vin` / `${id}:phone` just copied
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState(null);       // { id, ...fields }
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);             // parsed PDF rows
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadWhitePaint().then(d => { if (alive) { setStore(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const queue = store.queue || [];
  const done = store.done || [];

  async function write(mutate, what, okMsg) {
    setBusy(true); setStatus('Saving…');
    try {
      const next = await updateWhitePaint(mutate, what);
      setStore(next);
      setStatus(okMsg);
      setBusy(false);
      return true;
    } catch (e) {
      setStatus(`❌ ${e.message || 'Save failed.'}`);
      setBusy(false);
      return false;
    }
  }

  const clean = (d) => ({
    firstName: tidyName(d.firstName), lastName: tidyName(d.lastName), vin: cleanVin(d.vin),
    phone: fmtPhone(d.phone), dateAdded: d.dateAdded || '', notes: (d.notes || '').trim(),
  });

  // ── Add (anyone) ──
  async function add() {
    const rec = { id: newId(), ...clean(draft), source: 'manual', addedAt: new Date().toISOString(), addedBy: currentUser };
    const ok = await write(cur => {
      if (rec.vin && cur.queue.some(e => cleanVin(e.vin) === rec.vin)) throw new Error('That VIN is already on the list.');
      return { ...cur, queue: [...cur.queue, rec] };
    }, `add ${rec.firstName} ${rec.lastName}`, `✓ ${rec.firstName} ${rec.lastName} added to the bottom of the list.`);
    if (ok) { setDraft(EMPTY()); setTab('list'); }
  }

  // ── Manager actions ──
  async function move(id, dir) {
    if (!isManager) return;
    await write(cur => {
      const qq = [...cur.queue];
      const i = qq.findIndex(e => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= qq.length) return cur;
      [qq[i], qq[j]] = [qq[j], qq[i]];
      return { ...cur, queue: qq };
    }, 'reorder', '✓ Order updated.');
  }

  async function saveEdit() {
    if (!editing) return;
    const changes = { ...clean(editing), updatedAt: new Date().toISOString(), updatedBy: currentUser };
    const place = parseInt(editing.place, 10);
    const moving = isManager && place > 0 && place !== editing.pos;
    const ok = await write(cur => {
      const qq = cur.queue.map(e => e.id === editing.id ? { ...e, ...changes } : e);
      if (moving) {
        // Place in line (managers): take them out and drop them in at that spot.
        const i = qq.findIndex(e => e.id === editing.id);
        if (i >= 0) {
          const [rec] = qq.splice(i, 1);
          qq.splice(Math.min(Math.max(place, 1), qq.length + 1) - 1, 0, rec);
        }
      }
      return { ...cur, queue: qq };
    }, `edit ${changes.firstName} ${changes.lastName}`,
      `✓ Updated ${changes.firstName} ${changes.lastName}${moving ? ` — now #${Math.min(place, queue.length)} in line` : ''}.`);
    if (ok) setEditing(null);
  }

  async function markPainted(e) {
    if (!isManager || !window.confirm(`Mark ${e.firstName} ${e.lastName} as painted and take them off the waiting list?`)) return;
    const stamp = { paintedAt: new Date().toISOString(), paintedBy: currentUser };
    await write(cur => {
      const hit = cur.queue.find(x => x.id === e.id);
      if (!hit) return cur;
      return { ...cur, queue: cur.queue.filter(x => x.id !== e.id), done: [{ ...hit, ...stamp }, ...cur.done] };
    }, `painted ${e.firstName} ${e.lastName}`, `✓ ${e.firstName} ${e.lastName} moved to Painted.`);
  }

  async function restore(e) {
    if (!isManager || !window.confirm(`Put ${e.firstName} ${e.lastName} back on the waiting list (at the bottom)?`)) return;
    await write(cur => {
      const hit = cur.done.find(x => x.id === e.id);
      if (!hit) return cur;
      const { paintedAt, paintedBy, ...rest } = hit;
      return { ...cur, done: cur.done.filter(x => x.id !== e.id), queue: [...cur.queue, rest] };
    }, `restore ${e.firstName} ${e.lastName}`, `✓ ${e.firstName} ${e.lastName} is back on the list.`);
  }

  async function remove(e, from) {
    if (!isManager || !window.confirm(`Remove ${e.firstName} ${e.lastName} completely? This can't be undone.\n\n(Use ✓ Painted instead if their car was painted.)`)) return;
    await write(cur => ({ ...cur, [from]: cur[from].filter(x => x.id !== e.id) }),
      `remove ${e.firstName} ${e.lastName}`, `✓ ${e.firstName} ${e.lastName} removed.`);
  }

  // ── Import (managers) ──
  async function onFile(f) {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    setStatus(''); setRows(null); setFile(f);
    if (!isPdf(f)) { setStatus('⚠ Choose the paint list PDF.'); return; }
    setReading(true);
    try { setRows(await readPaintPdf(f)); }
    catch (e) { setStatus(`⚠ ${e.message || 'Could not read the PDF.'}`); }
    setReading(false);
  }
  const preview = useMemo(() => rows ? planImport(rows, store, currentUser).report : null, [rows, store, currentUser]);

  async function applyImport() {
    if (!rows) return;
    let rep = null;
    const ok = await write(cur => {
      const { queue: qq, report } = planImport(rows, cur, currentUser);
      rep = report;
      return { ...cur, queue: qq, importedAt: new Date().toISOString(), importedBy: currentUser, importFile: file?.name || '' };
    }, `import ${file?.name || 'PDF'}`, '');
    if (ok && rep) {
      setStatus(`✓ Imported — ${rep.added.length} added, ${rep.updated.length} updated, ${rep.unchanged} unchanged.`);
      setRows(null); setFile(null); setTab('list');
    }
  }

  const match = (list) => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return list;
    return list.filter(e => {
      const hay = [e.firstName, e.lastName, e.vin, e.phone, String(e.phone || '').replace(/\D/g, ''), fmtDate(e.dateAdded), e.notes].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  };
  const shownQueue = useMemo(() => match(queue.map((e, i) => ({ ...e, pos: i + 1 }))), [queue, q]);
  const shownDone = useMemo(() => match(done), [done, q]);

  const fieldGrid = (d, set) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
      {FIELDS.map(([k, label, type]) => (
        <label key={k} style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>{label}</span>
          <input type={type || 'text'} value={d[k] || ''} disabled={busy}
            onChange={e => set(x => ({ ...x, [k]: k === 'vin' ? e.target.value.toUpperCase() : e.target.value }))}
            style={{ ...inputStyle, ...(k === 'vin' ? { letterSpacing: '.06em' } : null), colorScheme: 'dark' }} />
        </label>
      ))}
      <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>Notes (optional)</span>
        <input value={d.notes || ''} disabled={busy} onChange={e => set(x => ({ ...x, notes: e.target.value }))}
          placeholder="Estimate given, best time to call…" style={{ ...inputStyle, fontWeight: 600 }} />
      </label>
    </div>
  );
  const warnBox = (w) => w.length > 0 && (
    <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 10, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', color: '#fde68a', fontSize: 13 }}>
      <b>Check:</b> {w.join(' · ')}
    </div>
  );

  const tabBtn = (k, label, rgb = '110,231,249') => (
    <button onClick={() => { setTab(k); setEditing(null); }} style={{ ...btn(rgb, tab === k), fontSize: 14, padding: '9px 18px' }}>{label}</button>
  );

  const nameCell = (e) => (
    <>
      {e.notes && <div title={e.notes} style={{ fontSize: 12, fontWeight: 600, color: '#fde68a', marginTop: 3, maxWidth: 320, whiteSpace: 'normal' }}>📝 {e.notes}</div>}
    </>
  );

  // Click a VIN or phone to copy it for pasting into the DMS.
  async function copy(text, key) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? '' : c)), 1500);
  }
  const copyCell = (e, field, text, extra) => {
    if (!text) return muted;
    const key = `${e.id}:${field}`;
    const on = copied === key;
    return (
      <span role="button" tabIndex={0} title="Click to copy" onClick={() => copy(text, key)}
        onKeyDown={ev => { if (ev.key === 'Enter') copy(text, key); }}
        style={{ cursor: 'copy', padding: '3px 6px', margin: '-3px -6px', borderRadius: 6, background: on ? 'rgba(74,222,128,.15)' : 'transparent', ...extra }}>
        {text}{on && <span style={{ marginLeft: 6, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 900, color: '#86efac', letterSpacing: 0 }}>✓ Copied</span>}
      </span>
    );
  };

  const queueTable = (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
      <thead><tr>
        <th style={th}>#</th><th style={th}>First name</th><th style={th}>Last name</th><th style={th}>VIN</th>
        <th style={th}>Phone number</th><th style={th}>Date put on list</th>{isManager && <th style={th}></th>}
      </tr></thead>
      <tbody>
        {shownQueue.map(e => {
          const next = e.pos === 1;
          return (
            <tr key={e.id} style={next ? { background: 'rgba(74,222,128,.07)' } : undefined}>
              <td style={{ ...td, fontWeight: 900, color: next ? '#86efac' : '#94a3b8' }}>
                {e.pos}{next && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 900, color: '#052e16', background: '#86efac' }}>NEXT UP</span>}
              </td>
              <td style={{ ...td, fontWeight: 800 }}>{e.firstName || muted}{nameCell(e)}</td>
              <td style={{ ...td, fontWeight: 800 }}>{e.lastName || muted}</td>
              <td style={{ ...td, ...mono }}>{copyCell(e, 'vin', e.vin)}</td>
              <td style={td}>{copyCell(e, 'phone', e.phone ? fmtPhone(e.phone) : '', { color: '#7dd3fc' })}</td>
              <td style={td}>{fmtDate(e.dateAdded) || muted}</td>
              {isManager && (
                <td style={{ ...td, textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button disabled={busy || !!q.trim() || e.pos === 1} title="Move up" style={actionBtn('148,163,184')} onClick={() => move(e.id, -1)}>▲</button>
                    <button disabled={busy || !!q.trim() || e.pos === queue.length} title="Move down" style={actionBtn('148,163,184')} onClick={() => move(e.id, 1)}>▼</button>
                    <button disabled={busy} style={actionBtn('251,191,36')} onClick={() => { setStatus(''); setEditing({ ...e, place: String(e.pos) }); }}>✏️ Edit</button>
                    <button disabled={busy} title="Mark painted — moves them to the Painted tab" style={{ ...actionBtn('148,163,184'), background: 'rgba(255,255,255,.04)', color: '#cbd5e1' }} onClick={() => markPainted(e)}>🎨 Mark painted</button>
                    <button disabled={busy} title="Remove from the list" style={actionBtn('248,113,113')} onClick={() => remove(e, 'queue')}>🗑</button>
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const doneTable = (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
      <thead><tr>
        <th style={th}>First name</th><th style={th}>Last name</th><th style={th}>VIN</th><th style={th}>Phone number</th>
        <th style={th}>Date put on list</th><th style={th}>Painted</th>{isManager && <th style={th}></th>}
      </tr></thead>
      <tbody>
        {shownDone.map(e => (
          <tr key={e.id}>
            <td style={{ ...td, fontWeight: 800 }}>{e.firstName || muted}{nameCell(e)}</td>
            <td style={{ ...td, fontWeight: 800 }}>{e.lastName || muted}</td>
            <td style={{ ...td, ...mono }}>{copyCell(e, 'vin', e.vin)}</td>
            <td style={td}>{copyCell(e, 'phone', e.phone ? fmtPhone(e.phone) : '', { color: '#7dd3fc' })}</td>
            <td style={td}>{fmtDate(e.dateAdded) || muted}</td>
            <td style={{ ...td, color: '#86efac', fontWeight: 800 }}>✓ {new Date(e.paintedAt).toLocaleDateString()}<span style={{ color: '#94a3b8', fontWeight: 600, fontSize: 12.5 }}> · {e.paintedBy}</span></td>
            {isManager && (
              <td style={{ ...td, textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button disabled={busy} style={actionBtn('110,231,249')} onClick={() => restore(e)}>↩ Back on list</button>
                  <button disabled={busy} title="Delete" style={actionBtn('248,113,113')} onClick={() => remove(e, 'done')}>🗑</button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const addWarnings = formWarnings(draft, queue, null);
  const editWarnings = editing ? formWarnings(editing, queue, editing.id) : [];
  const dupVin = (d, selfId) => { const v = cleanVin(d.vin); return !!v && queue.some(e => e.id !== selfId && cleanVin(e.vin) === v); };

  const list = (items) => (items || []).map(r => `${r.firstName} ${r.lastName}`.trim()).join(', ');

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="adv-title">🎨 White Paint</div>
          <div className="adv-sub">Waiting list for white paint repairs — the top customer is next up</div>
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {tabBtn('list', `📋 Waiting list (${queue.length})`)}
        {tabBtn('add', '➕ Add customer', '74,222,128')}
        {tabBtn('done', `✓ Painted (${done.length})`, '134,239,172')}
        {isManager && tabBtn('import', '📤 Import PDF', '196,181,253')}
        {status && <span style={{ fontSize: 13.5, fontWeight: 800, marginLeft: 8, color: status.startsWith('❌') ? '#fca5a5' : status.startsWith('⚠') ? '#fde68a' : '#86efac' }}>{status}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 40px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          {editing ? (
            <div style={{ ...card, maxWidth: 760 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', marginBottom: 12 }}>✏️ Edit {editing.firstName} {editing.lastName}</div>
              {fieldGrid(editing, setEditing)}
              {isManager && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(110,231,249,.06)', border: '1px solid rgba(110,231,249,.25)' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#7dd3fc', whiteSpace: 'nowrap' }}>Place in line</span>
                  <input type="number" min={1} max={queue.length} value={editing.place ?? ''} disabled={busy}
                    onChange={e => setEditing(x => ({ ...x, place: e.target.value }))}
                    style={{ ...inputStyle, width: 90, textAlign: 'center', colorScheme: 'dark' }} />
                  <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
                    of {queue.length} · now #{editing.pos}{editing.pos === 1 ? ' (next up)' : ''} · 1 = next up for paint
                  </span>
                </label>
              )}
              {warnBox(editWarnings)}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button disabled={busy || (!String(editing.firstName || "").trim() && !String(editing.lastName || "").trim()) || dupVin(editing, editing.id)} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={saveEdit}>
                  {busy ? 'Saving…' : '✓ Save changes'}
                </button>
                <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : tab === 'add' ? (
            <div style={{ ...card, maxWidth: 760 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Add a customer to the waiting list</div>
              <div style={{ fontSize: 13.5, color: '#94a3b8', margin: '4px 0 14px' }}>They go to the bottom of the list ({queue.length + 1} in line).</div>
              {fieldGrid(draft, setDraft)}
              {warnBox(addWarnings)}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button disabled={busy || !draft.firstName.trim() || !draft.lastName.trim() || dupVin(draft, null)} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={add}>
                  {busy ? 'Saving…' : '✓ Save'}
                </button>
                <button disabled={busy} style={btn('148,163,184', false)} onClick={() => setDraft(EMPTY())}>Clear</button>
              </div>
            </div>
          ) : tab === 'import' && isManager ? (
            <div style={card}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Import the white paint list PDF</div>
              <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                Customers are matched by <b>VIN</b> (name + phone when there's no VIN). A match keeps its place in line and gets its name, phone and date
                refreshed; anyone new is added to the bottom in the PDF's order. Nobody already on the list is removed, and customers marked painted aren't added back.
              </div>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => onFile(e.target.files && e.target.files[0])} />
              <button disabled={reading || busy} style={{ ...btn('196,181,253'), fontSize: 15, padding: '11px 22px', marginTop: 14 }} onClick={() => fileRef.current && fileRef.current.click()}>
                {reading ? '🔎 Reading…' : '📤 Choose paint list PDF'}
              </button>
              {preview && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.18)' }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9' }}>{file?.name}: {rows.length} customer rows</div>
                  <div style={{ display: 'grid', gap: 6, marginTop: 10, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.45 }}>
                    <div><b style={{ color: '#86efac' }}>➕ {preview.added.length} new</b>{preview.added.length > 0 && <> — {list(preview.added)}</>}</div>
                    <div><b style={{ color: '#7dd3fc' }}>✏️ {preview.updated.length} updated</b>{preview.updated.length > 0 && <> — {list(preview.updated)}</>}</div>
                    <div><b style={{ color: '#94a3b8' }}>{preview.unchanged} already on the list, unchanged</b></div>
                    {preview.painted.length > 0 && <div><b style={{ color: '#86efac' }}>✓ {preview.painted.length} already painted, left off</b> — {list(preview.painted)}</div>}
                    {preview.dupes.length > 0 && (
                      <div style={{ padding: '9px 12px', borderRadius: 10, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)', color: '#fde68a' }}>
                        <b>{preview.dupes.length} repeat VIN rows skipped</b> (the first row in the PDF is kept):
                        <div style={{ marginTop: 4 }}>
                          {preview.dupes.map((d, i) => (
                            <div key={i}>{d.row.firstName} {d.row.lastName} <span style={mono}>{d.row.vin || fmtPhone(d.row.phone)}</span> → kept {d.kept.firstName} {d.kept.lastName}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button disabled={busy || (!preview.added.length && !preview.updated.length)} style={{ ...btn('74,222,128'), fontSize: 14, padding: '9px 18px' }} onClick={applyImport}>
                      {busy ? 'Saving…' : '✓ Apply import'}
                    </button>
                    <button disabled={busy} style={btn('148,163,184', false)} onClick={() => { setRows(null); setFile(null); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={card}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 Search name, VIN, phone…"
                style={{ ...inputStyle, maxWidth: 460, marginBottom: 14 }} />
              {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
                : tab === 'done'
                  ? (done.length === 0 ? <div style={{ color: '#94a3b8' }}>Nobody marked painted yet.</div>
                    : shownDone.length === 0 ? <div style={{ color: '#94a3b8' }}>Nothing matches “{q}”.</div>
                    : <div style={{ overflowX: 'auto' }}>{doneTable}</div>)
                  : (queue.length === 0 ? <div style={{ color: '#94a3b8' }}>The waiting list is empty — add a customer{isManager ? ' or import the paint list PDF' : ''}.</div>
                    : shownQueue.length === 0 ? <div style={{ color: '#94a3b8' }}>Nothing matches “{q}”.</div>
                    : <div style={{ overflowX: 'auto' }}>{queueTable}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
