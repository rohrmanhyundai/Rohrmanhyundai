import React, { useEffect, useState } from 'react';
import * as github from '../utils/github';
import { deleteS3ObjectByUrl } from '../utils/s3';
import { pruneQuickMedia, isExpired, expiresIn } from '../utils/quickMedia';

// ── Service Loaner → 📸 Media ─────────────────────────────────────────────────
// Everything sent from the phone's 📤 Add media, newest first: view, download or
// delete each picture / video, or a whole upload. Kept 72 hours — opening this
// tab sweeps anything older (utils/quickMedia).

const card = { background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '16px 18px' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 9, padding: '6px 11px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' });
const fmtWhen = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
const fmtLeft = (ms) => { const h = Math.max(0, Math.floor(ms / 3600000)); return h >= 1 ? `${h}h left` : `${Math.max(1, Math.round(ms / 60000))}m left`; };
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);

async function download(f, item) {
  const ext = (f.name.split('.').pop() || (f.kind === 'video' ? 'mov' : 'jpg')).toLowerCase();
  const name = `loaner-media-${new Date(item.at).toISOString().slice(0, 10)}-${f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9-]+/g, '') || 'file'}.${ext}`;
  try {
    const res = await fetch(f.url, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch {
    window.open(f.url, '_blank', 'noopener');
  }
}

export default function QuickMediaPanel({ io, onCount }) {
  const { updateQuickMedia } = io || github;
  const deleteByUrl = io?.deleteS3ObjectByUrl || deleteS3ObjectByUrl;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);   // { f, item } in the viewer
  const [, tick] = useState(0);

  const apply = (d) => { const list = (d.items || []).filter(i => !isExpired(i)); setItems(list); onCount && onCount(list.length); };
  useEffect(() => {
    let alive = true;
    pruneQuickMedia(io).then(d => { if (alive) { apply(d); setLoading(false); } })
      .catch(() => { (io || github).loadQuickMedia().then(d => alive && apply(d)).finally(() => alive && setLoading(false)); });
    const t = setInterval(() => tick(n => n + 1), 60000);   // keep "Xh left" honest
    return () => { alive = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function removeFile(item, f) {
    const last = (item.files || []).length === 1;
    if (!window.confirm(last ? 'Delete this file? It is the only one in this upload, so the upload goes too.' : 'Delete this file? This can\'t be undone.')) return;
    setBusy(true); setStatus('Deleting…');
    try {
      const next = await updateQuickMedia(cur => ({ ...cur, items: cur.items
        .map(i => (i.id === item.id ? { ...i, files: i.files.filter(x => x.url !== f.url) } : i))
        .filter(i => i.files.length) }), 'delete file');
      try { await deleteByUrl(f.url); } catch {}
      apply(next); setView(null);
      setStatus('✓ Deleted.');
    } catch (e) { setStatus(`❌ ${e.message || 'Delete failed.'}`); }
    setBusy(false);
  }
  async function removeItem(item) {
    if (!window.confirm(`Delete this whole upload (${item.files.length} file${item.files.length === 1 ? '' : 's'})? This can't be undone.`)) return;
    setBusy(true); setStatus('Deleting…');
    try {
      const next = await updateQuickMedia(cur => ({ ...cur, items: cur.items.filter(i => i.id !== item.id) }), 'delete upload');
      for (const f of item.files || []) { try { await deleteByUrl(f.url); } catch {} }
      apply(next);
      setStatus('✓ Upload deleted.');
    } catch (e) { setStatus(`❌ ${e.message || 'Delete failed.'}`); }
    setBusy(false);
  }

  const sorted = [...items].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.5)', color: '#fde68a' }}>
        <span style={{ fontSize: 22 }}>⏳</span>
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>
          <strong>Media here is only kept for 72 hours.</strong> After that it's deleted automatically — download anything you need to keep.
          <div style={{ fontSize: 12.5, color: '#fcd34d', opacity: 0.85 }}>Sent from the phone's 🚙 Rental page → 📤 Add media.</div>
        </div>
        {status && <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: status.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{status}</span>}
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Loading…</div>
        : !sorted.length ? <div style={{ ...card, color: '#94a3b8', textAlign: 'center', padding: 30 }}>No media right now. Pictures and videos sent from the phone show up here.</div>
        : sorted.map(item => {
          const left = expiresIn(item);
          return (
            <div key={item.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9', whiteSpace: 'pre-wrap' }}>{item.note || <span style={{ color: '#64748b', fontWeight: 700 }}>No note</span>}</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{item.by} · {fmtWhen(item.at)} · {item.files.length} file{item.files.length === 1 ? '' : 's'}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 999, color: left < 12 * 3600000 ? '#fecaca' : '#fde68a', background: left < 12 * 3600000 ? 'rgba(248,113,113,.15)' : 'rgba(251,191,36,.12)', border: `1px solid ${left < 12 * 3600000 ? 'rgba(248,113,113,.5)' : 'rgba(251,191,36,.4)'}` }}>
                  ⏳ {fmtLeft(left)}
                </span>
                <button disabled={busy} onClick={() => removeItem(item)} style={btn('248,113,113', false)}>🗑 Delete all</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
                {item.files.map(f => (
                  <div key={f.url} style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.2)' }}>
                    <button onClick={() => setView({ f, item })} style={{ all: 'unset', display: 'block', width: '100%', aspectRatio: '4 / 3', cursor: 'pointer', position: 'relative', background: '#000' }}>
                      {f.kind === 'video'
                        ? <video src={f.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={f.url} alt={f.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {f.kind === 'video' && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, textShadow: '0 2px 8px #000' }}>▶</span>}
                    </button>
                    <div style={{ display: 'flex', gap: 6, padding: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#64748b', flex: 1 }}>{fmtSize(f.size)}</span>
                      <button title="View" onClick={() => setView({ f, item })} style={{ ...btn('110,231,249'), padding: '4px 8px' }}>👁</button>
                      <button title="Download" onClick={() => download(f, item)} style={{ ...btn('74,222,128'), padding: '4px 8px' }}>⬇</button>
                      <button title="Delete" disabled={busy} onClick={() => removeFile(item, f)} style={{ ...btn('248,113,113', false), padding: '4px 8px' }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      {view && (
        <div onClick={() => setView(null)} style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(2,6,23,.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '78vh', display: 'flex' }}>
            {view.f.kind === 'video'
              ? <video src={view.f.url} controls autoPlay playsInline style={{ maxWidth: '92vw', maxHeight: '78vh', borderRadius: 12 }} />
              : <img src={view.f.url} alt={view.f.name} style={{ maxWidth: '92vw', maxHeight: '78vh', borderRadius: 12, objectFit: 'contain' }} />}
          </div>
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            {view.item.note && <span style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 14, marginRight: 8 }}>{view.item.note}</span>}
            <button onClick={() => download(view.f, view.item)} style={btn('74,222,128')}>⬇ Download</button>
            <button disabled={busy} onClick={() => removeFile(view.item, view.f)} style={btn('248,113,113')}>🗑 Delete</button>
            <button onClick={() => setView(null)} style={btn('148,163,184', false)}>✕ Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
