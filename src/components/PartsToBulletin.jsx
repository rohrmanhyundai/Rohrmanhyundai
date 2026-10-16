import React, { useMemo, useState } from 'react';
import { findBulletinsForPart, BASE_LEN } from '../utils/partsToBulletin';
import { norm } from '../utils/pdfText';
import ApplicableVehicles from './ApplicableVehicles';

// ── Parts to Bulletin ─────────────────────────────────────────────────────────
// Part number in, bulletins out: every TSB and recall whose Warranty table lists
// it as the Causal Part, then the same part family (first 5 characters), then
// bulletins that only mention it somewhere else. Matching rules live in
// utils/partsToBulletin.js.
//
// `items` is both libraries pooled, each tagged with _kind. The search itself is
// the body; PartsToBulletinModal wraps it for the TSB page's button.
export function PartsToBulletinSearch({ items = [], loading = false, onOpen }) {
  const [part, setPart] = useState('');
  const res = useMemo(() => findBulletinsForPart(items, part), [items, part]);
  const q = norm(part);
  const base = q.slice(0, BASE_LEN).toUpperCase();
  const total = res.exact.length + res.family.length + res.mentioned.length;

  return (
    <div>
      <div className="confirm-warn-glow" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.5)', borderRadius: 8, padding: '8px 14px', marginBottom: 14, color: '#fca5a5', fontWeight: 800, fontSize: 12.5, textAlign: 'center' }}>
        ⚠️ ALWAYS CONFIRM AGAINST THE BULLETIN AND WEBDCS BEFORE PERFORMING WORK
      </div>
      <div style={{ position: 'relative' }}>
        <input
          autoFocus
          value={part}
          onChange={e => setPart(e.target.value.toUpperCase())}
          placeholder="Part number — e.g. 96641-K2100, 25600-2S000, or just 96641"
          style={{ ...input, fontFamily: 'monospace', letterSpacing: 1, paddingRight: 36 }}
        />
        {part && <button onClick={() => setPart('')} title="Clear" style={{ ...xBtn, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 16 }}>✕</button>}
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
        {loading ? '⏳ Loading the TSB and recall libraries…'
          : q.length === 0 ? `Searches the Causal Part column of every TSB and recall (${items.length} bulletins). Dashes, spaces and case don't matter.`
            : q.length < BASE_LEN ? `Type at least ${BASE_LEN} characters — the part base (e.g. 96641).`
              : `${total} bulletin${total === 1 ? '' : 's'} found`}
      </div>

      {!loading && q.length >= BASE_LEN && (
        <div style={{ marginTop: 16 }}>
          {total === 0 ? (
            <div style={{ fontSize: 13, color: '#64748b', padding: '8px 4px' }}>No TSB or recall lists this part.</div>
          ) : (
            // Part numbers get superseded, so the bulletin for the car in the bay
            // can carry a different number than the one typed — every listed
            // bulletin is worth a look, not just the exact match.
            <div className="confirm-warn-glow" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.5)', borderRadius: 8, padding: '9px 14px', marginBottom: 14, color: '#fca5a5', fontWeight: 800, fontSize: 12.5, textAlign: 'center', lineHeight: 1.5 }}>
              ⚠️ TECH: PLEASE REVIEW EVERY BULLETIN LISTED BELOW — THE PART NUMBER MAY HAVE CHANGED (SUPERSEDED)
            </div>
          )}
          {res.exact.length > 0 && (
            <Group
              title={q.length === BASE_LEN
                ? `Causal part starts with ${base} — ${res.exact.length}`
                : `Causal part ${part.trim()} — ${res.exact.length}`}
              color="#4ade80" hits={res.exact} onOpen={onOpen}
            />
          )}
          {q.length > BASE_LEN && res.family.length > 0 && (
            <Group title={`Same part family (${base}-…), different suffix — ${res.family.length}`}
              color="#fbbf24" hits={res.family} onOpen={onOpen} />
          )}
          {res.mentioned.length > 0 && (
            <Group title={`Also mentioned in the bulletin (not the causal part) — ${res.mentioned.length}`}
              color="#94a3b8" hits={res.mentioned} onOpen={onOpen} dim startClosed={res.exact.length + res.family.length > 0} />
          )}
        </div>
      )}
    </div>
  );
}

export default function PartsToBulletinModal({ items, loading, hidden = false, onOpen, onClose }) {
  return (
    // visibility (not display:none) so the results keep their place while a
    // bulletin is open over the top — same as Search by VIN.
    <div onClick={onClose} style={hidden ? { ...overlay, visibility: 'hidden', pointerEvents: 'none' } : overlay}>
      <div onClick={e => e.stopPropagation()} style={modal}>
        <div style={head}>
          <span style={{ fontWeight: 900, fontSize: 18, color: '#6ee7f9' }}>🔩 Parts to Bulletin</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>
        <PartsToBulletinSearch items={items} loading={loading} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Group({ title, color, hits, onOpen, empty, dim, startClosed }) {
  const [open, setOpen] = useState(!startClosed);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
        <span style={{ color, fontWeight: 800, fontSize: 13 }}>{open ? '▾' : '▸'} {title}</span>
      </button>
      {open && (hits.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', padding: '8px 4px 4px' }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {hits.map(h => <Hit key={h.kind + h.item.id} hit={h} color={color} dim={dim} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  );
}

function Hit({ hit, color, dim, onOpen }) {
  const { item, kind, number, subject, rows } = hit;
  const isRecall = kind === 'recalls';
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${color}55`, borderRadius: 10, padding: '11px 14px', opacity: dim ? 0.85 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={isRecall ? chip('#fcd34d', 'rgba(251,191,36,.14)', 'rgba(251,191,36,.45)') : chip('#93c5fd', 'rgba(96,165,250,.14)', 'rgba(96,165,250,.45)')}>
          {isRecall ? '📢 Recall' : '🔧 TSB'}
        </span>
        {number && <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#e2e8f0', fontSize: 14 }}>{number}</span>}
        <button onClick={() => onOpen(item)} style={{ ...openBtn, marginLeft: 'auto' }}>📄 Open PDF</button>
      </div>
      <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 700, marginTop: 6 }}>{subject}</div>
      <ApplicableVehicles item={item} />
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ tableLayout: 'auto', width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>{['Model', 'Op Code', 'Op Time', 'Causal Part'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{r.model || '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 800, color: '#bfdbfe' }}>{r.opCode || '—'}</td>
                  <td style={td}>{r.opTime || '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 800, color }}>{r.causalPart || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && !dim && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          Listed in the Warranty table, but its row couldn't be read cleanly — open the PDF for the op code.
        </div>
      )}
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 1000, overflowY: 'auto' };
const modal = { width: '100%', maxWidth: 820, background: '#0f172a', border: '1px solid rgba(110,231,249,.25)', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.5)' };
const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 };
const input = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(110,231,249,.3)', borderRadius: 10, color: '#e2e8f0', fontSize: 15, outline: 'none' };
const xBtn = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
const openBtn = { background: 'rgba(110,231,249,.12)', border: '1px solid rgba(110,231,249,.4)', color: '#6ee7f9', borderRadius: 8, padding: '5px 12px', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };
const th = { textAlign: 'left', padding: '5px 8px', color: '#64748b', fontSize: 11, fontWeight: 800, borderBottom: '1px solid rgba(255,255,255,.1)', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', color: '#e2e8f0', borderBottom: '1px solid rgba(255,255,255,.05)', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', verticalAlign: 'top' };
const chip = (color, bg, border) => ({ fontSize: 11, fontWeight: 800, color, background: bg, border: `1px solid ${border}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' });
