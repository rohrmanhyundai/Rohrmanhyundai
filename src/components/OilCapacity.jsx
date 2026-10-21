import React, { useEffect, useMemo, useState } from 'react';
import * as github from '../utils/github';
import { decodeVin, validateVin } from '../utils/vinLookup';
import { loadPdfJs } from '../utils/pdfText';
import { printFluidSheet } from '../utils/fluidPrint';
import { readFluidSpecPdf, missingFields, vehiclesFor, yearsIn, modelsFor, coversYear, engineYearOk, engineMatches, isEngineOil } from '../utils/fluidSpecs';

// ── 🛢 Oil Capacity ───────────────────────────────────────────────────────────
// Engine oil (and every other fluid) capacity, spec and part number — by VIN
// (NHTSA decode: year, model, engine size, hybrid) or by year → model. ⚙️
// Settings: upload a spec-sheet PDF, check / fill in what it's missing (year,
// make, model are often only in the file name), then save; edit or delete what
// is already on file. Data: data/fluid-specs.json (utils/fluidSpecs).

const card = { background: 'rgba(15,23,42,.6)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 20px' };
const inputStyle = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#e2e8f0', padding: '10px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', colorScheme: 'dark' };
const cell = { ...inputStyle, padding: '6px 8px', fontSize: 13, fontWeight: 600, borderRadius: 7 };
const btn = (rgb, on = true) => ({ background: on ? `rgba(${rgb},.18)` : 'rgba(255,255,255,.04)', border: `1px solid rgba(${rgb},.5)`, color: `rgb(${rgb})`, borderRadius: 10, padding: '9px 14px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' });
const label = { fontSize: 12, fontWeight: 900, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 };
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid rgba(148,163,184,.25)' };
const td = { padding: '9px 10px', fontSize: 13.5, color: '#e2e8f0', borderBottom: '1px solid rgba(148,163,184,.1)', verticalAlign: 'top', overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal' };
const years = (v) => (v.yearFrom && v.yearTo && v.yearTo !== v.yearFrom ? `${v.yearFrom}–${v.yearTo}` : `${v.yearFrom || '?'}`);
const title = (v) => `${v.model || 'Unknown model'}${v.code ? ` (${v.code})` : ''}`;
const newId = () => `fs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMPTY_FLUID = () => ({ fluid: '', engine: '', volume: '', spec: '', partNumber: '', note: '' });
const KIND_LABEL = { HEV: 'Hybrid', PHEV: 'Plug-in hybrid', EV: 'Electric', FCV: 'Fuel cell' };

export default function OilCapacity({ currentUser, onBack, backLabel = '← Back', initialTab, io }) {
  const { loadFluidSpecs, updateFluidSpecs } = io || github;
  const [tab, setTab] = useState(initialTab === 'settings' ? 'settings' : 'lookup');   // lookup | settings
  const [data, setData] = useState(null);
  const [vin, setVin] = useState('');
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState(null);
  const [year, setYear] = useState('');
  const [model, setModel] = useState('');
  // Settings
  const [drafts, setDrafts] = useState(null);    // [{ ...vehicle, _key, id? }] being checked before Save
  const [reading, setReading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadFluidSpecs().then(setData).catch(() => setData({ vehicles: [] })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const vehicles = data ? data.vehicles : [];

  const clean = vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  useEffect(() => {
    if (clean.length !== 17) { setDecoded(null); return undefined; }
    if (!validateVin(clean).ok) { setDecoded({ ok: false, error: "That VIN doesn't check out — look for a typo." }); return undefined; }
    let alive = true;
    setDecoding(true);
    decodeVin(clean).then(d => { if (!alive) return; setDecoded(d); if (d.year) setYear(String(d.year)); setModel(''); })
      .finally(() => alive && setDecoding(false));
    return () => { alive = false; };
  }, [clean]);

  const allYears = useMemo(() => yearsIn(vehicles), [vehicles]);
  const models = useMemo(() => (year ? modelsFor(vehicles, Number(year)) : []), [vehicles, year]);
  const fromVin = decoded && decoded.ok && !model;
  const lookupYear = fromVin ? Number(decoded.year) : Number(year);
  const results = useMemo(() => {
    if (fromVin) {
      const m = vehiclesFor(vehicles, { year: decoded.year, model: decoded.model, kind: decoded.kind });
      return m.some(v => v.score > 0) ? m.filter(v => v.score >= 0) : m;
    }
    if (year && model) return vehicles.filter(v => v.model === model && coversYear(v, Number(year)));
    return [];
  }, [vehicles, fromVin, decoded, year, model]);

  // ── Settings: upload → review → save ──
  async function pickPdf(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setReading(true); setMsg('📄 Reading the spec sheet — this takes a few seconds…'); setDrafts(null);
    try {
      const found = await readFluidSpecPdf(f, loadPdfJs);
      setDrafts(found.map(v => ({ ...v, _key: newId(), source: { fileName: f.name, uploadedAt: new Date().toISOString(), by: currentUser } })));
      setMsg(`Found ${found.length} vehicle section${found.length === 1 ? '' : 's'} in ${f.name}. Check everything — fill in anything marked red — then Save.`);
    } catch (err) {
      setMsg(`❌ ${err.message || 'Could not read that file.'}`);
    }
    setReading(false);
  }
  const addByHand = () => { setMsg(''); setDrafts([{ _key: newId(), make: 'HYUNDAI', model: '', code: '', yearFrom: null, yearTo: null, fluids: [EMPTY_FLUID()], source: { fileName: '', uploadedAt: new Date().toISOString(), by: currentUser } }]); };
  const editExisting = (v) => { setMsg(''); setDrafts([{ ...JSON.parse(JSON.stringify(v)), _key: newId() }]); window.scrollTo?.(0, 0); };
  const setDraft = (key, fn) => setDrafts(ds => ds.map(d => (d._key === key ? fn(d) : d)));
  const allReady = drafts && drafts.length > 0 && drafts.every(d => !missingFields(d).length && d.fluids.some(f => f.fluid && f.volume));

  async function saveDrafts() {
    if (!allReady || busy) return;
    setBusy(true); setMsg('Saving…');
    try {
      const clean = drafts.map(({ _key, score, ...v }) => ({
        ...v, id: v.id || newId(), make: v.make.trim().toUpperCase(), model: v.model.trim().toUpperCase(), code: (v.code || '').trim(),
        fluids: v.fluids.filter(f => f.fluid || f.volume).map(f => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, String(x || '').trim()]))),
      }));
      // Same id (edit) or same make + model + code + years (a re-upload) replaces what's there.
      const same = (a, b) => a.id === b.id || (a.make === b.make && a.model === b.model && (a.code || '') === (b.code || '') && a.yearFrom === b.yearFrom && a.yearTo === b.yearTo);
      const next = await updateFluidSpecs(cur => ({
        ...cur, updatedAt: new Date().toISOString(),
        vehicles: [...cur.vehicles.filter(v => !clean.some(c => same(c, v))), ...clean],
      }), `save ${clean.map(c => `${c.model} ${c.yearFrom}`).join(', ')}`);
      setData(next); setDrafts(null);
      setMsg(`✅ Saved ${clean.length} vehicle${clean.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setMsg(`❌ ${err.message || 'Save failed.'}`);
    }
    setBusy(false);
  }
  async function remove(v) {
    if (!window.confirm(`Delete ${title(v)} ${years(v)} from Oil Capacity?`)) return;
    setBusy(true);
    try {
      const next = await updateFluidSpecs(cur => ({ ...cur, updatedAt: new Date().toISOString(), vehicles: cur.vehicles.filter(x => x.id !== v.id) }), `delete ${v.model} ${v.yearFrom}`);
      setData(next); setMsg(`✓ Deleted ${title(v)} ${years(v)}.`);
    } catch (err) { setMsg(`❌ ${err.message || 'Delete failed.'}`); }
    setBusy(false);
  }

  // ── Look-up card for one vehicle ──
  const vehicleCard = (v, i) => {
    const rows = v.fluids.filter(f => engineYearOk(f.engine, lookupYear));
    const oil = rows.filter(isEngineOil), other = rows.filter(f => !isEngineOil(f));
    const disp = fromVin ? decoded.displacement : null;
    const top = fromVin && results.length > 1 && i === 0 && v.score > results[1].score;
    return (
      <div key={v.id} style={{ ...card, borderColor: top ? 'rgba(74,222,128,.55)' : 'rgba(148,163,184,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#f1f5f9' }}>{v.make} {title(v)}</div>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8' }}>{years(v)}</span>
          {top && <span style={{ fontSize: 11, fontWeight: 900, padding: '3px 9px', borderRadius: 999, color: '#052e16', background: '#4ade80' }}>✓ BEST MATCH</span>}
          <button onClick={() => printFluidSheet(v, { year: lookupYear, vin: fromVin ? clean : '', decoded: fromVin ? decoded : null, by: currentUser })}
            title="Print this sheet — or pick “Save as PDF” in the print dialog"
            style={{ ...btn('148,163,184', false), marginLeft: 'auto', padding: '6px 12px', fontSize: 12.5 }}>🖨 Print / Save PDF</button>
        </div>
        {oil.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginTop: 14 }}>
            {oil.map((f, j) => {
              const mine = engineMatches(f.engine, disp);
              return (
                <div key={j} style={{ borderRadius: 14, padding: '12px 14px', background: mine ? 'linear-gradient(135deg,rgba(74,222,128,.2),rgba(34,197,94,.08))' : 'linear-gradient(135deg,rgba(251,191,36,.14),rgba(245,158,11,.05))', border: `1px solid ${mine ? 'rgba(74,222,128,.6)' : 'rgba(251,191,36,.45)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.07em', color: mine ? '#86efac' : '#fcd34d' }}>🛢 ENGINE OIL{f.engine ? ` · ${f.engine}` : ''}</span>
                    {mine && <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 900, color: '#052e16', background: '#4ade80', borderRadius: 999, padding: '1px 7px' }}>YOUR ENGINE</span>}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginTop: 4, lineHeight: 1.15 }}>{f.volume || '—'}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0', marginTop: 4 }}>{f.spec}</div>
                  {f.partNumber && <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 3 }}>P/N <span style={{ fontFamily: /^\d/.test(f.partNumber) ? 'ui-monospace, Menlo, monospace' : 'inherit', fontWeight: 800 }}>{f.partNumber}</span></div>}
                  {f.note && <div style={{ fontSize: 12, color: '#fde68a', marginTop: 5, lineHeight: 1.4 }}>📝 {f.note}</div>}
                </div>
              );
            })}
          </div>
        )}
        {other.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead><tr><th style={th}>Fluid</th><th style={th}>Engine</th><th style={th}>Capacity</th><th style={th}>Spec</th><th style={th}>Part #</th></tr></thead>
              <tbody>
                {other.map((f, j) => (
                  <tr key={j}>
                    <td style={{ ...td, fontWeight: 800 }}>{f.fluid}{f.note && <div style={{ fontSize: 11.5, color: '#fde68a', fontWeight: 600, marginTop: 2 }}>📝 {f.note}</div>}</td>
                    <td style={{ ...td, color: engineMatches(f.engine, disp) ? '#86efac' : '#94a3b8' }}>{f.engine || 'All'}</td>
                    <td style={{ ...td, fontWeight: 800, whiteSpace: 'nowrap' }}>{f.volume}</td>
                    <td style={td}>{f.spec}</td>
                    <td style={{ ...td, fontFamily: /^\d/.test(f.partNumber) ? 'ui-monospace, Menlo, monospace' : 'inherit', fontSize: 12.5 }}>{f.partNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {v.source && v.source.fileName && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 10 }}>From {v.source.fileName}</div>}
      </div>
    );
  };

  // ── Review / edit card for one draft ──
  const draftCard = (d) => {
    const miss = missingFields(d);
    const need = { make: !String(d.make || '').trim(), model: !String(d.model || '').trim(), yearFrom: !d.yearFrom, yearTo: !d.yearTo || (d.yearFrom && d.yearTo < d.yearFrom) };
    const red = (on) => (on ? { borderColor: 'rgba(248,113,113,.85)', boxShadow: '0 0 0 2px rgba(248,113,113,.2)' } : null);
    const setF = (k) => (e) => {
      const val = e.target.value;
      setDraft(d._key, x => ({ ...x, [k]: k === 'yearFrom' || k === 'yearTo' ? (parseInt(val, 10) || null) : val }));
    };
    const setRow = (j, k) => (e) => { const val = e.target.value; setDraft(d._key, x => ({ ...x, fluids: x.fluids.map((f, n) => (n === j ? { ...f, [k]: val } : f)) })); };
    return (
      <div key={d._key} style={{ ...card, borderColor: miss.length ? 'rgba(248,113,113,.5)' : 'rgba(74,222,128,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 900, color: '#f1f5f9' }}>{d.id ? '✏️ Editing' : '🆕 New'} · {title(d)} {d.yearFrom ? years(d) : ''}</div>
          {miss.length > 0 ? <span style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5' }}>Needs: {miss.join(', ')}</span> : <span style={{ fontSize: 12, fontWeight: 900, color: '#86efac' }}>✓ Ready</span>}
          <button disabled={busy} title="Leave this one out" onClick={() => setDrafts(ds => ds.filter(x => x._key !== d._key))} style={{ ...btn('248,113,113', false), padding: '5px 10px' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 0.8fr 0.8fr', gap: 8 }}>
          {[['make', 'Make'], ['model', 'Model'], ['code', 'Code (optional)'], ['yearFrom', 'Year from'], ['yearTo', 'Year to']].map(([k, l]) => (
            <label key={k} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: need[k] ? '#fca5a5' : '#94a3b8' }}>{l}</span>
              <input value={d[k] == null ? '' : d[k]} onChange={setF(k)} inputMode={k.startsWith('year') ? 'numeric' : undefined} disabled={busy}
                placeholder={k === 'model' ? 'e.g. PALISADE' : k.startsWith('year') ? 'e.g. 2026' : ''}
                style={{ ...inputStyle, ...red(need[k]) }} />
            </label>
          ))}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', minWidth: 760 }}>
            <thead><tr><th style={th}>Fluid</th><th style={th}>Engine</th><th style={th}>Capacity</th><th style={th}>Spec</th><th style={th}>Part #</th><th style={th}>Note</th><th style={th} /></tr></thead>
            <tbody>
              {d.fluids.map((f, j) => (
                <tr key={j}>
                  {['fluid', 'engine', 'volume', 'spec', 'partNumber', 'note'].map(k => (
                    <td key={k} style={{ ...td, padding: 4 }}>
                      <input value={f[k] || ''} onChange={setRow(j, k)} disabled={busy} placeholder={k === 'engine' ? 'All' : ''} style={{ ...cell, ...(k === 'fluid' || k === 'volume' ? red(!f[k]) : null) }} />
                    </td>
                  ))}
                  <td style={{ ...td, padding: 4 }}>
                    <button disabled={busy} title="Remove this line" onClick={() => setDraft(d._key, x => ({ ...x, fluids: x.fluids.filter((_, n) => n !== j) }))} style={{ ...btn('248,113,113', false), padding: '4px 8px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button disabled={busy} onClick={() => setDraft(d._key, x => ({ ...x, fluids: [...x.fluids, EMPTY_FLUID()] }))} style={{ ...btn('96,165,250'), marginTop: 8, padding: '6px 12px' }}>＋ Add a line</button>
      </div>
    );
  };

  const tabBtn = (k, l) => <button onClick={() => setTab(k)} style={{ ...btn(k === 'settings' ? '196,181,253' : '251,191,36', tab === k), fontSize: 14, padding: '9px 18px' }}>{l}</button>;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🛢 Oil Capacity</div>
          <div className="adv-sub">Engine oil and fluid capacities, specs and part numbers</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 24px 0', flexShrink: 0 }}>
        {tabBtn('lookup', '🔎 Look up')}
        {tabBtn('settings', '⚙️ Settings')}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 50px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 18 }}>
          {tab === 'lookup' ? (
            <>
              <div style={{ ...card, display: 'grid', gap: 18 }}>
                <div>
                  <div style={label}>1 · VIN</div>
                  <input value={vin} onChange={e => { setVin(e.target.value.toUpperCase()); setModel(''); }} maxLength={20} placeholder="Type the 17-character VIN"
                    autoCapitalize="characters" autoCorrect="off" style={{ ...inputStyle, fontSize: 16, fontWeight: 800, letterSpacing: '.08em', fontFamily: 'ui-monospace, Menlo, monospace' }} />
                  <div style={{ fontSize: 13, fontWeight: 800, marginTop: 8, minHeight: 18 }}>
                    {clean.length > 0 && clean.length !== 17 && <span style={{ color: '#fde68a' }}>{clean.length} of 17 characters</span>}
                    {decoding && <span style={{ color: '#93c5fd' }}>Decoding the VIN…</span>}
                    {decoded && !decoding && (decoded.ok
                      ? <span style={{ color: '#86efac' }}>✓ {decoded.year} {decoded.make} {decoded.model}{decoded.trim ? ` ${decoded.trim}` : ''}{KIND_LABEL[decoded.kind] ? ` · ${KIND_LABEL[decoded.kind]}` : ''}{decoded.displacement ? ` · ${decoded.displacement}L` : ''}</span>
                      : <span style={{ color: '#fde68a' }}>{decoded.error || "Couldn't decode that VIN"}{decoded.year ? ` — it's a ${decoded.year}; pick the model below.` : ' — pick the year and model below.'}</span>)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#64748b', fontSize: 12, fontWeight: 900, letterSpacing: '.1em' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />OR<div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,.2)' }} />
                </div>
                <div>
                  <div style={label}>2 · Year and model</div>
                  <select value={year} onChange={e => { setYear(e.target.value); setModel(''); setVin(''); setDecoded(null); }} style={{ ...inputStyle, maxWidth: 220, fontSize: 16, fontWeight: 800 }}>
                    <option value="">Pick the year…</option>
                    {allYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {year && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {models.map(m => <button key={m} onClick={() => { setModel(m); setVin(''); setDecoded(null); }} style={{ ...btn('251,191,36', model === m), padding: '8px 12px' }}>{m}</button>)}
                      {!models.length && <span style={{ color: '#94a3b8', fontSize: 13 }}>Nothing on file for {year} yet — add it on ⚙️ Settings.</span>}
                    </div>
                  )}
                </div>
                {(vin || year) && <button onClick={() => { setVin(''); setDecoded(null); setYear(''); setModel(''); }} style={{ ...btn('148,163,184', false), justifySelf: 'start' }}>↺ Start over</button>}
              </div>
              {results.length > 0 && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ ...label, marginBottom: 0 }}>{fromVin ? `${decoded.year} ${decoded.model}` : `${year} ${model}`}{results.length > 1 ? ` · ${results.length} matches` : ''}</div>
                  {results.map(vehicleCard)}
                </div>
              )}
              {fromVin && !results.length && !decoding && (
                <div style={{ ...card, color: '#fde68a', fontWeight: 800 }}>Nothing on file for a {decoded.year} {decoded.model} yet — upload its spec sheet on ⚙️ Settings.</div>
              )}
              {data && !vehicles.length && <div style={{ ...card, color: '#94a3b8' }}>No spec sheets on file yet — add one on ⚙️ Settings.</div>}
            </>
          ) : (
            <>
              <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#e2e8f0' }}>📄 Add a spec sheet</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.45 }}>Upload the PDF (owner's-manual capacity page or HMA fluid-spec article). It's read automatically — you check it and fill in anything missing before it's saved.</div>
                </div>
                <label style={{ ...btn('251,191,36'), opacity: reading || busy ? 0.6 : 1 }}>
                  {reading ? '⏳ Reading…' : '📤 Upload PDF'}
                  <input type="file" accept="application/pdf,.pdf,image/*" onChange={pickPdf} disabled={reading || busy} style={{ display: 'none' }} />
                </label>
                <button disabled={reading || busy} onClick={addByHand} style={btn('148,163,184', false)}>✍️ Add by hand</button>
              </div>
              {msg && <div style={{ fontSize: 13.5, fontWeight: 800, color: msg.startsWith('❌') ? '#fca5a5' : msg.startsWith('✅') || msg.startsWith('✓') ? '#86efac' : '#fde68a' }}>{msg}</div>}

              {drafts && drafts.length > 0 && (
                <>
                  {drafts.map(draftCard)}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button disabled={!allReady || busy} onClick={saveDrafts} style={{ ...btn('74,222,128'), fontSize: 15, padding: '11px 22px', opacity: allReady ? 1 : 0.55 }}>
                      {busy ? 'Saving…' : `✓ Save ${drafts.length} vehicle${drafts.length === 1 ? '' : 's'}`}
                    </button>
                    <button disabled={busy} onClick={() => { setDrafts(null); setMsg(''); }} style={btn('148,163,184', false)}>Cancel</button>
                    {!allReady && <span style={{ fontSize: 12.5, color: '#fca5a5', fontWeight: 800 }}>Fill in everything marked red first.</span>}
                  </div>
                </>
              )}

              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#e2e8f0', marginBottom: 10 }}>On file · {vehicles.length}</div>
                {!vehicles.length ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Nothing yet.</div> : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {[...vehicles].sort((a, b) => a.model.localeCompare(b.model) || b.yearFrom - a.yearFrom).map(v => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(148,163,184,.12)', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <span style={{ fontWeight: 900, color: '#f1f5f9' }}>{v.make} {title(v)}</span>
                          <span style={{ color: '#fcd34d', fontWeight: 800, marginLeft: 8 }}>{years(v)}</span>
                          <div style={{ fontSize: 11.5, color: '#64748b' }}>{v.fluids.length} lines{v.source && v.source.fileName ? ` · ${v.source.fileName}` : ''}{v.source && v.source.by ? ` · ${v.source.by}` : ''}</div>
                        </div>
                        <button disabled={busy || reading} onClick={() => editExisting(v)} style={{ ...btn('96,165,250'), padding: '5px 11px', fontSize: 12.5 }}>✏️ Edit</button>
                        <button disabled={busy || reading} onClick={() => remove(v)} style={{ ...btn('248,113,113', false), padding: '5px 11px', fontSize: 12.5 }}>🗑</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
