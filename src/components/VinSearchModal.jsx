import React, { useMemo, useState } from 'react';
import { decodeVin, findBulletinsForVehicle, knownModels, yearFromVin } from '../utils/vinLookup';

// ── Search by VIN ─────────────────────────────────────────────────────────────
// Decode the VIN on the car, then show what's open on that exact vehicle. The
// tech picks Recalls or TSBs — they're different jobs and different conversations
// with the customer, so the results are never mixed together.
export default function VinSearchModal({ tsbs = [], recalls = [], onOpen, onClose }) {
  const [vin, setVin] = useState('');
  const [busy, setBusy] = useState(false);
  const [vehicle, setVehicle] = useState(null);   // { year, model, electrified, ... }
  const [error, setError] = useState('');
  const [needModel, setNeedModel] = useState(false);
  const [kind, setKind] = useState('');           // '' until they choose | 'recalls' | 'tsbs'

  const models = useMemo(() => knownModels([...recalls, ...tsbs]), [recalls, tsbs]);

  async function runDecode() {
    setError(''); setVehicle(null); setKind(''); setNeedModel(false);
    setBusy(true);
    try {
      const r = await decodeVin(vin);
      if (r.ok) {
        setVehicle({ year: r.year, model: r.model, electrified: r.electrified, make: r.make, trim: r.trim, elecLabel: r.electrificationLabel, source: 'nhtsa' });
      } else if (r.year) {
        // Decoder unreachable — we still know the year from the VIN itself, so
        // let them pick the model rather than dead-ending.
        setError(r.error);
        setNeedModel(true);
        setVehicle({ year: r.year, model: '', electrified: false, source: 'offline' });
      } else {
        setError(r.error);
      }
    } finally { setBusy(false); }
  }

  const results = useMemo(() => {
    if (!vehicle || !vehicle.model || !kind) return null;
    return findBulletinsForVehicle(kind === 'recalls' ? recalls : tsbs, vehicle);
  }, [vehicle, kind, recalls, tsbs]);

  const reset = () => { setVehicle(null); setKind(''); setError(''); setNeedModel(false); };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={modal}>
        <div style={head}>
          <span style={{ fontWeight: 900, fontSize: 18, color: '#6ee7f9' }}>🚗 Search by VIN</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.5)', borderRadius: 8, padding: '8px 14px', marginBottom: 14, color: '#fca5a5', fontWeight: 800, fontSize: 12.5, textAlign: 'center' }}>
          ⚠️ ALWAYS CONFIRM AGAINST THE BULLETIN AND WEBDCS BEFORE PERFORMING WORK
        </div>

        {/* ── VIN entry ── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            autoFocus
            value={vin}
            onChange={e => setVin(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) runDecode(); }}
            placeholder="Enter the 17-character VIN"
            maxLength={17}
            style={{ ...input, fontFamily: 'monospace', letterSpacing: 1.5 }}
          />
          <button onClick={runDecode} disabled={busy || vin.trim().length < 17} style={{ ...goBtn, opacity: busy || vin.trim().length < 17 ? 0.5 : 1 }}>
            {busy ? '⏳ Decoding…' : 'Decode'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
          {vin.trim().length > 0 && vin.trim().length < 17
            ? `${17 - vin.trim().length} more character${17 - vin.trim().length === 1 ? '' : ''} to go`
            : 'The year and model are read from the VIN, then matched against each bulletin’s Applicable Vehicles.'}
        </div>

        {error && (
          <div style={{ marginTop: 12, background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#fbbf24' }}>
            {error}{needModel ? ' Pick the model below to carry on.' : ''}
          </div>
        )}

        {/* ── Decoded vehicle ── */}
        {vehicle && (
          <div style={{ marginTop: 14, background: 'rgba(110,231,249,.07)', border: '1px solid rgba(110,231,249,.28)', borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', letterSpacing: .5 }}>VEHICLE</span>
              <span style={{ fontWeight: 900, fontSize: 17, color: '#e2e8f0' }}>
                {vehicle.year || '????'} {vehicle.make || 'Hyundai'} {vehicle.model || '—'}
              </span>
              {vehicle.elecLabel && <span style={chip('#86efac', 'rgba(74,222,128,.16)', 'rgba(74,222,128,.45)')}>{vehicle.elecLabel}</span>}
              {vehicle.trim && <span style={chip('#93c5fd', 'rgba(96,165,250,.14)', 'rgba(96,165,250,.4)')}>{vehicle.trim}</span>}
              <button onClick={reset} style={{ ...secBtn, marginLeft: 'auto' }}>↺ New VIN</button>
            </div>

            {needModel && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                  Model year <strong style={{ color: '#e2e8f0' }}>{vehicle.year}</strong> came from the VIN. Choose the model:
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={vehicle.model} onChange={e => { setVehicle(v => ({ ...v, model: e.target.value })); setKind(''); }} style={{ ...input, maxWidth: 260 }}>
                    <option value="">— pick a model —</option>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!vehicle.electrified} onChange={e => { setVehicle(v => ({ ...v, electrified: e.target.checked })); setKind(''); }} />
                    Hybrid / EV
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Recall or TSB ── */}
        {vehicle && vehicle.model && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 8 }}>What are you looking for?</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setKind('recalls')} style={kind === 'recalls' ? pickBtnOn('#fbbf24', 'rgba(251,191,36,.28)') : pickBtn}>
                📢 Recalls &amp; Campaigns
              </button>
              <button onClick={() => setKind('tsbs')} style={kind === 'tsbs' ? pickBtnOn('#93c5fd', 'rgba(96,165,250,.28)') : pickBtn}>
                🔧 TSBs
              </button>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {results && (
          <div style={{ marginTop: 16, maxHeight: 380, overflowY: 'auto' }}>
            <Group
              title={`${results.matched.length} ${kind === 'recalls' ? 'recall' : 'TSB'}${results.matched.length === 1 ? '' : 's'} for this vehicle`}
              color="#4ade80" rows={results.matched} onOpen={onOpen} showYears
              empty={`No ${kind === 'recalls' ? 'recalls' : 'TSBs'} list this vehicle. Check the two groups below before telling the customer it's clear.`}
            />
            {results.checkYear.length > 0 && (
              <Group title={`${results.checkYear.length} where the model matches but the years weren’t readable`}
                color="#fbbf24" rows={results.checkYear} onOpen={onOpen} />
            )}
            {results.unreadable.length > 0 && (
              <Group title={`${results.unreadable.length} with no readable vehicle list — verify manually`}
                color="#94a3b8" rows={results.unreadable} onOpen={onOpen} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, color, rows, onOpen, empty, showYears }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
        <span style={{ color, fontWeight: 800, fontSize: 13 }}>{open ? '▾' : '▸'} {title}</span>
      </button>
      {open && (rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', padding: '8px 4px 4px' }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
          {rows.map(({ item, entries }) => (
            <button key={item.id} onClick={() => onOpen(item)} style={{ ...rowBtn, borderColor: `${color}55` }}>
              <span style={{ fontWeight: 800, color: '#e2e8f0', flex: 1 }}>{item.label}</span>
              {showYears && entries?.length > 0 && (
                <span style={{ fontSize: 11, color, whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {entries[0].from}–{entries[0].to} {entries[0].name}
                </span>
              )}
              <span style={{ marginLeft: 10, fontSize: 11, color: '#475569' }}>open →</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 1000, overflowY: 'auto' };
const modal = { width: '100%', maxWidth: 760, background: '#0f172a', border: '1px solid rgba(110,231,249,.25)', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.5)' };
const head = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 };
const input = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(110,231,249,.3)', borderRadius: 10, color: '#e2e8f0', fontSize: 15, outline: 'none' };
const goBtn = { background: 'linear-gradient(135deg,#22c55e,#4ade80)', border: 'none', color: '#06280f', borderRadius: 10, padding: '0 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' };
const secBtn = { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', color: '#cbd5e1', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const rowBtn = { display: 'flex', alignItems: 'center', textAlign: 'left', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '11px 14px', cursor: 'pointer' };
const pickBtn = { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', color: '#94a3b8', borderRadius: 12, padding: '11px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const pickBtnOn = (color, bg) => ({ background: bg, border: `1px solid ${color}`, color, borderRadius: 12, padding: '11px 22px', fontWeight: 900, fontSize: 14, cursor: 'pointer' });
const xBtn = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
const chip = (color, bg, border) => ({ fontSize: 11, fontWeight: 800, color, background: bg, border: `1px solid ${border}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' });
