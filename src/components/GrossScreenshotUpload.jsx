import React, { useEffect, useRef, useState } from 'react';
import { parseGrossScreenshot, buildScreenshotImport, defaultThroughKey } from '../utils/grossScreenshot';

// Two screenshot boxes — Service gross board and Parts gross board. AI reads LAF
// Hyundai off each; the preview shows what lands on the Goal Forecast, and Apply
// hands the built import to the caller (`onApply(result)` → message string), so
// the Goal Forecast page and Morning Reporting each save it their own way.

const money = (v) => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SLOTS = [
  { dept: 'service', icon: '🔧', label: 'Service screenshot', rgb: '56,189,248' },
  { dept: 'parts',   icon: '📦', label: 'Parts screenshot',   rgb: '52,211,153' },
];

function Slot({ slot, shot, busy, onFile }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const color = shot ? '74,222,128' : over ? slot.rgb : '148,163,184';
  return (
    <div onClick={() => !busy && ref.current && ref.current.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f && !busy) onFile(f); }}
      style={{ flex: '1 1 220px', cursor: busy ? 'wait' : 'pointer', border: `2px dashed rgba(${color},.55)`, background: `rgba(${color},${over ? '.12' : '.05'})`, borderRadius: 14, padding: '18px 16px', textAlign: 'center' }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
      <div style={{ fontSize: 14.5, fontWeight: 900, color: shot ? '#86efac' : '#e2e8f0' }}>
        {busy ? '⏳ AI is reading…' : shot ? `✓ ${slot.icon} ${slot.label}` : `${slot.icon} ${slot.label}`}
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
        {shot ? `LAF Hyundai gross ${money(shot.total.gross)} MTD · click to replace` : 'Paste (⌘/Ctrl + V), drop, or click · LAF Hyundai opened up'}
      </div>
    </div>
  );
}

export default function GrossScreenshotUpload({ onApply, onDone }) {
  const [shots, setShots] = useState({ service: null, parts: null });
  const [busy, setBusy] = useState({ service: false, parts: false });
  const [throughKey, setThroughKey] = useState(defaultThroughKey());
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [applying, setApplying] = useState(false);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  async function readInto(dept, file) {
    setBusy(b => ({ ...b, [dept]: true })); setMsg('');
    try {
      const shot = await parseGrossScreenshot(file);
      // The two boards look the same — trust what's ON the screenshot over which
      // box it was dropped in.
      const target = shot.dept || dept;
      setShots(s => ({ ...s, [target]: shot }));
      if (target !== dept) setMsg(`ℹ️ That looked like the ${target === 'parts' ? 'Parts' : 'Service'} board, so it went in the ${target === 'parts' ? 'Parts' : 'Service'} box.`);
    } catch (e) { setMsg('❌ ' + (e.message || e)); }
    finally { setBusy(b => ({ ...b, [dept]: false })); }
  }

  // Paste fills the first empty box (the reader moves it if it guessed wrong).
  useEffect(() => {
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.kind === 'file' && /^image\//.test(i.type));
      const f = item && item.getAsFile();
      if (!f) return;
      e.preventDefault();
      const s = shotsRef.current;
      const dept = !s.service ? 'service' : !s.parts ? 'parts' : 'service';
      readInto(dept, new File([f], f.name || `pasted-${Date.now()}.png`, { type: f.type }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    if (!shots.service && !shots.parts) { setPreview(null); return; }
    let cancelled = false;
    buildScreenshotImport(shots, throughKey).then(p => { if (!cancelled) setPreview(p); }).catch(e => { if (!cancelled) setMsg('❌ ' + (e.message || e)); });
    return () => { cancelled = true; };
  }, [shots, throughKey]);

  async function apply() {
    if (!preview) return;
    setApplying(true); setMsg('⏳ Saving to Goal Forecast…');
    try {
      const out = await onApply(preview);
      setMsg(out || '✅ Saved to Goal Forecast.');
      setShots({ service: null, parts: null });
      setPreview(null);
      if (onDone) onDone();
    } catch (e) { setMsg('❌ ' + (e.message || e)); }
    finally { setApplying(false); }
  }

  const dayLabel = new Date(throughKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {SLOTS.map(s => <Slot key={s.dept} slot={s} shot={shots[s.dept]} busy={busy[s.dept]} onFile={(f) => readInto(s.dept, f)} />)}
      </div>
      {preview && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(56,189,248,.07)', border: '1px solid rgba(56,189,248,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: '#7dd3fc' }}>Board MTD runs through</div>
            <input type="date" value={throughKey} onChange={e => e.target.value && setThroughKey(e.target.value)}
              style={{ background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.35)', color: '#e2e8f0', borderRadius: 8, padding: '4px 8px', colorScheme: 'dark' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '4px 18px', fontSize: 12.5, marginTop: 10, color: '#cbd5e1', width: 'fit-content' }}>
            <span /><strong style={{ color: '#94a3b8' }}>MTD gross</strong><strong style={{ color: '#94a3b8' }}>Already entered</strong><strong style={{ color: '#94a3b8' }}>→ {dayLabel}</strong>
            {SLOTS.filter(s => preview.depts[s.dept]).map(s => {
              const d = preview.depts[s.dept];
              return (
                <React.Fragment key={s.dept}>
                  <span>{s.icon} {s.dept === 'parts' ? 'Parts' : 'Service'}</span>
                  <strong>{money(d.mtd)}</strong>
                  <span>{money(d.prior)}</span>
                  <strong style={{ color: d.day < 0 ? '#f87171' : '#4ade80' }}>{money(d.day)}</strong>
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
            {SLOTS.filter(s => preview.depts[s.dept]).map(s => {
              const d = preview.depts[s.dept];
              return <div key={s.dept}>{s.icon} Last year {money(d.lastYear)}{d.oldLastYear && Math.abs(d.oldLastYear - (d.lastYear || 0)) > 1 ? ` (was ${money(d.oldLastYear)})` : ''} · gross breakdown updated</div>;
            })}
            {preview.depts.service && <div>🎯 Gauges: gross {money(preview.gaugePatch.grossActual)}{preview.gaugePatch.cpActual ? ` · customer pay ${money(preview.gaugePatch.cpActual)}` : ''}</div>}
            {Object.values(preview.depts).some(d => d.later) && <div style={{ color: '#fbbf24' }}>⚠️ Days after {dayLabel} are already entered — check the date.</div>}
            {Object.values(preview.depts).some(d => d.day < 0) && <div style={{ color: '#f87171' }}>⚠️ A negative day means the days already entered add up to more than the board's MTD — check the date.</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={applying} onClick={apply}
              style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
              {applying ? '⏳ Saving…' : '✓ OK — Apply'}
            </button>
            <button disabled={applying} onClick={() => { setShots({ service: null, parts: null }); setMsg(''); }}
              style={{ background: 'transparent', border: '1px solid rgba(148,163,184,.35)', color: '#cbd5e1', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Clear</button>
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cbd5e1', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
