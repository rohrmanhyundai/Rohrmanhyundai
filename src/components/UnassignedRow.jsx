import React, { useState } from 'react';

// One unassigned repair order — a row that belongs to no tech yet.
//
// The same row renders in two places: "Cars Awaiting Technician" on the Work in
// Progress page, and the Used Car Hub. Both read the same shared awaiting file;
// a row's `usedCar` flag is the only thing that decides which page it appears on,
// and the move button flips it. Keeping one component means the two can't drift.
//
// This is presentational — every action is a handler passed in by the page, since
// the WIP page and the Hub persist and refresh differently.

export const inpSt = {
  background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8, color: '#f1f5f9', padding: '7px 10px', fontSize: 13,
  width: '100%', boxSizing: 'border-box',
};

export const labelSt = {
  fontSize: 11, color: '#94a3b8', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4,
};

export function ChipBtn({ active, color, onClick, children }) {
  const colors = {
    green: { on: 'rgba(34,197,94,.25)', border: 'rgba(34,197,94,.5)', text: '#86efac' },
    red:   { on: 'rgba(239,68,68,.25)', border: 'rgba(239,68,68,.5)', text: '#fca5a5' },
  };
  const c = colors[color];
  return (
    <button onClick={onClick} style={{
      background: active ? c.on : 'rgba(255,255,255,.05)',
      border: `1px solid ${active ? c.border : 'rgba(255,255,255,.12)'}`,
      color: active ? c.text : '#64748b',
      borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
      transition: 'all .15s',
    }}>{children}</button>
  );
}

// Owns its own "copied!" state so callers don't have to track a key per button.
export function CopyRoBtn({ ro }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!ro) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(ro).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = ro; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch {}
      document.body.removeChild(ta);
    }
  };
  return (
    <button
      type="button" onClick={copy} disabled={!ro} title={ro ? 'Copy RO #' : ''}
      style={{
        marginLeft: 6, fontSize: 10, fontWeight: 800, cursor: ro ? 'pointer' : 'default',
        background: copied ? 'rgba(74,222,128,.18)' : 'rgba(110,231,249,.12)',
        border: `1px solid ${copied ? 'rgba(74,222,128,.5)' : 'rgba(110,231,249,.35)'}`,
        color: copied ? '#4ade80' : '#6ee7f9',
        borderRadius: 6, padding: '1px 6px', opacity: ro ? 1 : 0.35,
      }}
    >{copied ? '✓ Copied' : '📋 Copy'}</button>
  );
}

// Unsaved new rows on top, then high priority, then newest RO date.
export const unassignedSort = (a, b) => {
  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
  if (a.highPriority !== b.highPriority) return a.highPriority ? -1 : 1;
  return new Date(b.roDate || 0) - new Date(a.roDate || 0);
};

export default function UnassignedRow({
  aw, isTech, canAssign, canDelete,
  techList = [], advisorList = [],
  movingId, savingId,
  advisorPickerId, setAdvisorPickerId,
  techPickerId, setTechPickerId,
  isHighlighted, rowRef,
  rowBg, rowBorder,
  onUpdate, onSave, onTogglePartsArrived, onUpdateAndSave,
  onClaim, onClaimIt, onDelete, onMove,
  moveLabel, moveTitle, moveAccent, moveBg, moveBorder,
}) {
  const moving = movingId === aw.id;

  return (
    <div ref={rowRef} style={{
      background: isHighlighted ? 'rgba(96,165,250,.14)' : (aw.highPriority ? 'rgba(239,68,68,.08)' : rowBg),
      border: `${isHighlighted ? 2 : 1}px solid ${isHighlighted ? 'rgba(96,165,250,.7)' : (aw.highPriority ? 'rgba(239,68,68,.5)' : rowBorder)}`,
      boxShadow: isHighlighted ? '0 0 0 4px rgba(96,165,250,.18)' : 'none',
      borderRadius: 14, padding: '16px 20px', marginBottom: 12, transition: 'all .2s',
    }}>
      {aw.highPriority && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '6px 12px' }}>
          <span style={{ fontSize: 16 }}>🚨</span>
          <span style={{ fontWeight: 900, fontSize: 12, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: 1 }}>High Priority</span>
        </div>
      )}

      {isTech ? (
        /* ── TECH VIEW: read-only + Claim It only ── */
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
            <div><div style={{ ...labelSt, display: 'flex', alignItems: 'center' }}>Repair Order #<CopyRoBtn ro={aw.ro} /></div><div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>{aw.ro || '—'}</div></div>
            <div><div style={labelSt}>RO Date</div><div style={{ fontSize: 14, color: '#94a3b8' }}>{aw.roDate || '—'}</div></div>
            <div style={{ flex: 1 }}><div style={labelSt}>Job Description</div><div style={{ fontSize: 14, color: '#e2e8f0' }}>{aw.jobDesc || '—'}</div></div>
            {aw.advisor && <div><div style={labelSt}>Advisor</div><div style={{ fontSize: 14, color: '#c4b5fd', fontWeight: 700 }}>👤 {aw.advisor}</div></div>}
            {aw.partsArrived === true && (
              <div className="parts-here-badge" style={{ marginTop: 2 }}>
                <span className="pha-icon">📦</span>
                <span>Parts Here</span>
                {aw.partsArrivedDate && <span className="pha-date">📅 {aw.partsArrivedDate}</span>}
              </div>
            )}
          </div>
          {aw.notes && (
            <div style={{ marginBottom: 14 }}>
              <div style={labelSt}>Notes</div>
              <div style={{ fontSize: 14, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{aw.notes}</div>
            </div>
          )}
          {onClaimIt && (
            <button
              onClick={() => onClaimIt(aw)}
              disabled={moving}
              style={{ background: 'rgba(74,222,128,.25)', border: '1px solid rgba(74,222,128,.55)', color: '#4ade80', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 900, fontSize: 13 }}
            >{moving ? '⏳ Moving…' : '✋ Claim It'}</button>
          )}
        </>
      ) : (
        /* ── MANAGER / ADVISOR VIEW: editable + all controls ── */
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px 16px', marginBottom: 14 }}>
            <div>
              <div style={{ ...labelSt, display: 'flex', alignItems: 'center' }}>Repair Order #<CopyRoBtn ro={aw.ro} /></div>
              <input style={inpSt} value={aw.ro} onChange={e => onUpdate(aw.id, 'ro', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); onSave(aw.id); } }} placeholder="RO#" />
            </div>
            <div>
              <div style={labelSt}>RO Date</div>
              <input style={inpSt} type="date" value={aw.roDate} onChange={e => onUpdate(aw.id, 'roDate', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div style={labelSt}>Job Description</div>
              <input style={inpSt} value={aw.jobDesc} onChange={e => onUpdate(aw.id, 'jobDesc', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); onSave(aw.id); } }} placeholder="Describe the job…" />
            </div>
            <div>
              <div style={labelSt}>Parts Arrived</div>
              {aw.partsArrived === true ? (
                <div className="parts-here-badge" style={{ marginTop: 2 }}>
                  <span className="pha-icon">📦</span>
                  <span>Parts Here</span>
                  {aw.partsArrivedDate && <span className="pha-date">📅 {aw.partsArrivedDate}</span>}
                  <button
                    className="pha-undo"
                    onClick={() => {
                      if (window.confirm('Undo "Parts Here"?\n\nThis will clear the parts-arrived status and remove the arrival date. Only do this if it was marked by mistake.')) {
                        onTogglePartsArrived(aw.id, null);
                      }
                    }}
                    title="Mark parts as not arrived"
                  >Undo</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <ChipBtn active={aw.partsArrived === true}  color="green" onClick={() => onTogglePartsArrived(aw.id, aw.partsArrived === true ? null : true)}>✓ Yes</ChipBtn>
                  <ChipBtn active={aw.partsArrived === false} color="red"   onClick={() => onTogglePartsArrived(aw.id, aw.partsArrived === false ? null : false)}>✗ No</ChipBtn>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={labelSt}>Notes</div>
            <textarea
              value={aw.notes || ''}
              onChange={e => onUpdate(aw.id, 'notes', e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.blur();
                  onSave(aw.id);
                }
              }}
              placeholder="Add notes here… (Enter to save, Shift+Enter for new line)"
              rows={2}
              style={{ ...inpSt, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => onUpdateAndSave(aw.id, 'highPriority', !aw.highPriority)}
              style={{ background: aw.highPriority ? 'rgba(239,68,68,.28)' : 'rgba(255,255,255,.06)', border: `1px solid ${aw.highPriority ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.15)'}`, color: aw.highPriority ? '#fca5a5' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12, transition: 'all .15s' }}
            >{aw.highPriority ? '🚨 HIGH PRIORITY' : '⚡ High Priority'}</button>

            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setAdvisorPickerId(advisorPickerId === aw.id ? null : aw.id)}
                style={{ background: aw.advisor ? 'rgba(139,92,246,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${aw.advisor ? 'rgba(139,92,246,.5)' : 'rgba(255,255,255,.15)'}`, color: aw.advisor ? '#c4b5fd' : '#64748b', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
              >👤 {aw.advisor || 'Select Advisor'}</button>
              {advisorPickerId === aw.id && (
                <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: '#1e293b', border: '1px solid rgba(139,92,246,.4)', borderRadius: 10, padding: 8, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                  {aw.advisor && (
                    <button onClick={() => { onUpdateAndSave(aw.id, 'advisor', ''); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'rgba(239,68,68,.1)', border: 'none', color: '#f87171', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, marginBottom: 4 }}>✕ Clear</button>
                  )}
                  {advisorList.map(adv => (
                    <button key={adv} onClick={() => { onUpdateAndSave(aw.id, 'advisor', adv); setAdvisorPickerId(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: aw.advisor === adv ? 'rgba(139,92,246,.25)' : 'transparent', border: 'none', color: aw.advisor === adv ? '#c4b5fd' : '#cbd5e1', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13, fontWeight: aw.advisor === adv ? 800 : 400 }}>{adv}</button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => onSave(aw.id)}
              disabled={savingId === aw.id}
              style={{ background: 'rgba(251,191,36,.18)', border: '1px solid rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12, opacity: savingId === aw.id ? 0.6 : 1 }}
            >{savingId === aw.id ? '⏳ Saving…' : '💾 Save'}</button>

            {canAssign && onClaim && (
              <>
                <button
                  onClick={() => setTechPickerId(techPickerId === aw.id ? null : aw.id)}
                  style={{ background: 'rgba(167,139,250,.2)', border: '1px solid rgba(167,139,250,.45)', color: '#c4b5fd', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                >👤 Assign Tech</button>
                {techPickerId === aw.id && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>→</span>
                    {techList.map(tech => (
                      <button key={tech}
                        onClick={() => onClaim(aw, tech)}
                        disabled={moving}
                        style={{ background: 'rgba(167,139,250,.2)', border: '1px solid rgba(167,139,250,.4)', color: '#c4b5fd', borderRadius: 7, padding: '5px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
                      >{moving ? '⏳' : tech}</button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Move between the two unassigned pools — always reversible from the
                button that appears on the other side. */}
            {onMove && (
              <button
                onClick={() => onMove(aw)}
                disabled={moving}
                title={moveTitle}
                style={{ background: moveBg, border: `1px solid ${moveBorder}`, color: moveAccent, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 12, opacity: moving ? 0.5 : 1 }}
              >{moving ? '⏳ Moving…' : moveLabel}</button>
            )}

            {canDelete && (
              <button
                onClick={() => onDelete(aw.id)}
                style={{ marginLeft: 'auto', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)', color: '#f87171', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
              >🗑 Delete</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
