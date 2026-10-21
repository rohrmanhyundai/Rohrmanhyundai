import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';
import { decodeVin, validateVin } from '../utils/vinLookup';
import { loadPdfJs } from '../utils/pdfText';
import { readBatteryGuidePdf, matchVehicle, yearsIn, modelsFor, coversYear } from '../utils/batteryGuide';
import VinScanner from './VinScanner';

// ── 🔋 Battery ────────────────────────────────────────────────────────────────
// Find the Hyundai battery part number two ways: type / scan a VIN (decoded by
// NHTSA → year, model, engine size, hybrid/EV) or pick the year and model.
// Shows the factory battery and the replacement P/N from the Hyundai Battery
// Guide. Managers upload a newer guide PDF to refresh the list; it's stored in
// data/battery-guide.json (utils/batteryGuide reads the PDF).

const GUIDE_PATH = 'data/battery-guide.json';
const card = { background: 'rgba(15,23,42,.6)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '11px 14px', fontSize: 16, fontWeight: 800, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 10, padding: '9px 14px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' });
const label = { fontSize: 12, fontWeight: 900, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 };
const yearRange = (r) => `${r.yearFrom}${r.yearTo == null ? '+' : r.yearTo === r.yearFrom ? '' : `–${r.yearTo}`}`;
const KIND_LABEL = { ICE: 'Gas', HEV: 'Hybrid', PHEV: 'Plug-in hybrid', EV: 'Electric', FCV: 'Fuel cell' };

export default function BatteryGuide({ currentUser, isManager, onBack, backLabel = '← Back', io }) {
  const load = io?.loadGithubFile || github.loadGithubFile;
  const save = io?.saveGithubFile || github.saveGithubFile;
  const [guide, setGuide] = useState(null);      // { updatedAt, by, fileName, rows }
  const [err, setErr] = useState('');
  const [vin, setVin] = useState('');
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState(null);  // decodeVin result
  const [scanning, setScanning] = useState(false);
  const [year, setYear] = useState('');
  const [model, setModel] = useState('');
  const [copied, setCopied] = useState('');
  const [upload, setUpload] = useState(null);    // { fileName, rows, added, removed } awaiting Save
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState('');

  useEffect(() => {
    load(GUIDE_PATH).then(d => setGuide(d && Array.isArray(d.rows) ? d : { rows: [] })).catch(() => setErr('Could not load the battery guide.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = guide ? guide.rows : [];

  // VIN → decode as soon as it's 17 characters.
  const clean = vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  useEffect(() => {
    if (clean.length !== 17) { setDecoded(null); return undefined; }
    if (!validateVin(clean).ok) { setDecoded({ ok: false, error: "That VIN doesn't check out — look for a typo." }); return undefined; }
    let alive = true;
    setDecoding(true);
    decodeVin(clean).then(d => {
      if (!alive) return;
      setDecoded(d);
      if (d.year) setYear(String(d.year));
      setModel('');
    }).finally(() => alive && setDecoding(false));
    return () => { alive = false; };
  }, [clean]);

  // Results: from the VIN (ranked) or from the year + model pickers.
  const years = useMemo(() => yearsIn(rows), [rows]);
  const models = useMemo(() => (year ? modelsFor(rows, Number(year)) : []), [rows, year]);
  const fromVin = decoded && decoded.ok && !model;
  const results = useMemo(() => {
    if (fromVin) {
      // Drop rows that clearly don't fit (e.g. an EV row for a gas VIN) when a better one exists.
      const m = matchVehicle(rows, { year: decoded.year, model: decoded.model, kind: decoded.kind, displacement: decoded.displacement });
      return m.some(r => r.score > 0) ? m.filter(r => r.score >= 0) : m;
    }
    if (year && model) return rows.filter(r => r.model === model && coversYear(r, Number(year)));
    return [];
  }, [rows, fromVin, decoded, year, model]);
  const best = fromVin && results.length > 1 && results[0].score > results[1].score ? results[0] : null;

  function copy(pn) {
    try { navigator.clipboard?.writeText(pn); } catch {}
    setCopied(pn);
    setTimeout(() => setCopied(c => (c === pn ? '' : c)), 1400);
  }
  function reset() { setVin(''); setDecoded(null); setYear(''); setModel(''); }

  // ── Manager: new guide PDF ──
  async function pickPdf(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setUpBusy(true); setUpMsg('📄 Reading the guide…'); setUpload(null);
    try {
      const next = await readBatteryGuidePdf(f, loadPdfJs);
      const key = (r) => `${r.model}|${r.code}|${r.yearText}|${r.engine}`;
      const old = new Set(rows.map(key)), now = new Set(next.map(key));
      setUpload({ fileName: f.name, rows: next, added: next.filter(r => !old.has(key(r))), removed: rows.filter(r => !now.has(key(r))) });
      setUpMsg('');
    } catch (e2) {
      setUpMsg(`❌ ${e2.message || 'Could not read that PDF.'}`);
    }
    setUpBusy(false);
  }
  async function saveUpload() {
    setUpBusy(true); setUpMsg('Saving…');
    try {
      const data = { updatedAt: new Date().toISOString(), by: currentUser, fileName: upload.fileName, rows: upload.rows };
      await save(GUIDE_PATH, data, `Battery guide from ${upload.fileName}`);
      setGuide(data); setUpload(null);
      setUpMsg(`✅ Battery guide updated — ${data.rows.length} rows.`);
    } catch (e) {
      setUpMsg(`❌ ${e.message || 'Save failed.'}`);
    }
    setUpBusy(false);
  }

  const resultCard = (r, i) => {
    const top = best && i === 0;
    const lithium = !r.pn;
    return (
      <div key={`${r.model}-${r.code}-${r.yearText}-${r.engine}-${i}`} style={{ ...card, padding: '16px 18px', borderColor: top ? 'rgba(74,222,128,.6)' : lithium ? 'rgba(251,191,36,.5)' : 'rgba(148,163,184,.22)', boxShadow: top ? '0 0 22px rgba(74,222,128,.18)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>{r.model}</div>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>{r.code} · {yearRange(r)} · {r.engine || 'All'}</span>
          {top && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, padding: '3px 9px', borderRadius: 999, color: '#052e16', background: '#4ade80' }}>✓ BEST MATCH{r.why.length ? ` · ${r.why.join(', ')}` : ''}</span>}
          {fromVin && !top && results.length > 1 && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>also possible</span>}
        </div>
        {lithium ? (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.45)', color: '#fde68a', fontWeight: 800, fontSize: 14.5 }}>
            ⚡ {r.note || 'No replacement part number in the guide.'}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={() => copy(r.pn)} title="Copy the part number"
              style={{ flex: '1 1 240px', textAlign: 'left', cursor: 'pointer', borderRadius: 14, padding: '12px 16px', background: 'linear-gradient(135deg,rgba(74,222,128,.18),rgba(34,197,94,.08))', border: '1px solid rgba(74,222,128,.55)', color: '#e2e8f0', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em', color: '#86efac' }}>REPLACEMENT BATTERY P/N</div>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '.03em', color: '#f0fdf4', fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2 }}>{r.pn}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#bbf7d0', marginTop: 2 }}>
                {r.replCca ? `${r.replCca} CCA` : ''}{r.replRc ? ` · ${r.replRc} RC` : ''}
                <span style={{ marginLeft: 10, color: copied === r.pn ? '#4ade80' : '#64748b' }}>{copied === r.pn ? '✓ copied' : '📋 click to copy'}</span>
              </div>
            </button>
            <div style={{ flex: '0 1 220px', borderRadius: 14, padding: '12px 16px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(148,163,184,.2)' }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.08em', color: '#94a3b8' }}>FACTORY INSTALLED</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#e2e8f0', marginTop: 4 }}>{r.type || '—'}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#94a3b8', marginTop: 2 }}>{r.cca ? `${r.cca} CCA` : ''}{r.rc ? ` · ${r.rc} RC` : ''}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {scanning && <VinScanner onCancel={() => setScanning(false)} onScan={(v) => { setScanning(false); setModel(''); setVin(v); }} />}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔋 Battery</div>
          <div className="adv-sub">Hyundai factory &amp; replacement battery part numbers</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 24px 50px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 18 }}>
          {err && <div style={{ color: '#fca5a5', fontWeight: 800 }}>{err}</div>}

          {/* Find it */}
          <div style={{ ...card, display: 'grid', gap: 18 }}>
            <div>
              <div style={label}>1 · VIN</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={vin} onChange={e => { setVin(e.target.value.toUpperCase()); setModel(''); }} maxLength={20} placeholder="Type or scan the 17-character VIN"
                  autoCapitalize="characters" autoCorrect="off" style={{ ...inputStyle, letterSpacing: '.08em', fontFamily: 'ui-monospace, Menlo, monospace' }} />
                <button onClick={() => setScanning(true)} style={{ ...btn('74,222,128'), whiteSpace: 'nowrap' }}>📷 Scan</button>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, marginTop: 8, minHeight: 18 }}>
                {clean.length > 0 && clean.length !== 17 && <span style={{ color: '#fde68a' }}>{clean.length} of 17 characters</span>}
                {decoding && <span style={{ color: '#93c5fd' }}>Decoding the VIN…</span>}
                {decoded && !decoding && (decoded.ok
                  ? <span style={{ color: '#86efac' }}>✓ {decoded.year} {decoded.make} {decoded.model}{decoded.trim ? ` ${decoded.trim}` : ''}
                      {decoded.kind && decoded.kind !== 'ICE' ? ` · ${KIND_LABEL[decoded.kind]}` : ''}{decoded.displacement ? ` · ${decoded.displacement}L` : ''}</span>
                  : <span style={{ color: '#fde68a' }}>{decoded.error || "Couldn't decode that VIN"}{decoded.year ? ` — it's a ${decoded.year}; pick the model below.` : ' — pick the year and model below.'}</span>)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#64748b', fontSize: 12, fontWeight: 900, letterSpacing: '.1em' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />OR<div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />
            </div>

            <div>
              <div style={label}>2 · Year and model</div>
              <select value={year} onChange={e => { setYear(e.target.value); setModel(''); setVin(''); setDecoded(null); }} style={{ ...inputStyle, maxWidth: 220 }}>
                <option value="">Pick the year…</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {year && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {models.map(m => (
                    <button key={m} onClick={() => { setModel(m); setVin(''); setDecoded(null); }} style={{ ...btn('96,165,250', model === m), padding: '8px 12px' }}>{m}</button>
                  ))}
                  {!models.length && <span style={{ color: '#94a3b8', fontSize: 13 }}>No models in the guide for {year}.</span>}
                </div>
              )}
            </div>
            {(vin || year) && <button onClick={reset} style={{ ...btn('148,163,184', false), justifySelf: 'start' }}>↺ Start over</button>}
          </div>

          {/* Answer */}
          {results.length > 0 && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ ...label, marginBottom: 0 }}>
                {fromVin ? `Battery for ${decoded.year} ${decoded.model}` : `Battery for ${year} ${model}`}{results.length > 1 ? ` · ${results.length} options` : ''}
              </div>
              {results.map(resultCard)}
            </div>
          )}
          {fromVin && !results.length && !decoding && (
            <div style={{ ...card, color: '#fde68a', fontWeight: 800 }}>
              The guide has no {decoded.year} {decoded.model}. Pick the year and model above to look nearby.
            </div>
          )}
          <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
            Since 8/15/2020, 00275-20001 / 24001 / 28001 supersede 00275-20000 / 24000 / 28000. Check WebDCS for the latest ordering notes.
          </div>

          {/* Update the guide */}
          <div style={{ ...card, borderStyle: 'dashed' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#e2e8f0' }}>📄 Battery guide</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
                  {guide ? `${rows.length} rows${guide.fileName ? ` · ${guide.fileName}` : ''}${guide.updatedAt ? ` · updated ${new Date(guide.updatedAt).toLocaleDateString()}${guide.by ? ` by ${guide.by}` : ''}` : ''}` : 'Loading…'}
                </div>
              </div>
              {isManager
                ? <label style={{ ...btn('251,191,36'), opacity: upBusy ? 0.6 : 1 }}>
                    📤 Upload new guide (.pdf)
                    <input type="file" accept="application/pdf,.pdf" onChange={pickPdf} disabled={upBusy} style={{ display: 'none' }} />
                  </label>
                : <span style={{ fontSize: 12, color: '#64748b' }}>A manager uploads new guides.</span>}
            </div>
            {upMsg && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800, color: upMsg.startsWith('❌') ? '#fca5a5' : upMsg.startsWith('✅') ? '#86efac' : '#fde68a' }}>{upMsg}</div>}
            {upload && (
              <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.4)' }}>
                <div style={{ fontWeight: 900, color: '#fde68a' }}>Read {upload.rows.length} rows from {upload.fileName}</div>
                <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>
                  {upload.added.length ? <div>➕ New / changed: {upload.added.slice(0, 8).map(r => `${r.model} ${yearRange(r)}${r.engine && r.engine !== 'All' ? ` ${r.engine}` : ''}`).join(' · ')}{upload.added.length > 8 ? ` +${upload.added.length - 8} more` : ''}</div> : <div>No new rows.</div>}
                  {upload.removed.length > 0 && <div style={{ color: '#fca5a5' }}>➖ No longer in the guide: {upload.removed.slice(0, 8).map(r => `${r.model} ${yearRange(r)}`).join(' · ')}{upload.removed.length > 8 ? ` +${upload.removed.length - 8} more` : ''}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button disabled={upBusy} onClick={saveUpload} style={btn('74,222,128')}>✓ Save — replace the guide</button>
                  <button disabled={upBusy} onClick={() => setUpload(null)} style={btn('148,163,184', false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

