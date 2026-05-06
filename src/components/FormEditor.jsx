import React, { useState } from 'react';

const inp = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13,
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
};

const FIELD_TYPES = [
  { value: 'textarea',          label: '📝 Text Answer (long)' },
  { value: 'text',              label: '✏️ Text Answer (short)' },
  { value: 'radio',             label: '🔘 Single Choice (radio)' },
  { value: 'yes_no_sometimes',  label: '✅ Yes / No / Acknowledge I can improve' },
  { value: 'yes_no',            label: '✅ Yes / No' },
  { value: 'rating_table',      label: '⭐ Rating Table (1–5)' },
  { value: 'rating',            label: '⭐ Single Rating (1–5)' },
];

const TYPE_COLORS = {
  textarea:         { bg: 'rgba(96,165,250,.12)',  border: 'rgba(96,165,250,.3)',  color: '#60a5fa' },
  text:             { bg: 'rgba(96,165,250,.08)',  border: 'rgba(96,165,250,.2)',  color: '#60a5fa' },
  radio:            { bg: 'rgba(167,139,250,.12)', border: 'rgba(167,139,250,.3)', color: '#a78bfa' },
  yes_no_sometimes: { bg: 'rgba(74,222,128,.1)',   border: 'rgba(74,222,128,.3)',  color: '#4ade80' },
  yes_no:           { bg: 'rgba(74,222,128,.08)',  border: 'rgba(74,222,128,.2)',  color: '#4ade80' },
  rating_table:     { bg: 'rgba(251,191,36,.1)',   border: 'rgba(251,191,36,.3)',  color: '#fbbf24' },
  rating:           { bg: 'rgba(251,191,36,.08)',  border: 'rgba(251,191,36,.2)',  color: '#fbbf24' },
};

function uid() { return Math.random().toString(36).slice(2, 9); }

// ── Inline editable text ────────────────────────────────────────────────────
function Editable({ value, onChange, placeholder, multiline, style = {} }) {
  if (multiline) {
    return (
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{ ...inp, resize: 'vertical', ...style }}
      />
    );
  }
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inp, ...style }}
    />
  );
}

// ── Move / Delete row of buttons ─────────────────────────────────────────────
function MoveDelete({ onUp, onDown, onDelete, disableUp, disableDown, label = 'item' }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      <button onClick={onUp}  disabled={disableUp}  title="Move up"   style={{ background: 'none', border: '1px solid rgba(255,255,255,.12)', color: '#64748b', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
      <button onClick={onDown} disabled={disableDown} title="Move down" style={{ background: 'none', border: '1px solid rgba(255,255,255,.12)', color: '#64748b', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↓</button>
      <button onClick={onDelete} title={`Remove ${label}`} style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
    </div>
  );
}

// ── Field editor ─────────────────────────────────────────────────────────────
function FieldEditor({ field, sectionIdx, fieldIdx, total, dispatch }) {
  const [collapsed, setCollapsed] = useState(false);
  const tc = TYPE_COLORS[field.type] || TYPE_COLORS.text;
  const typeName = FIELD_TYPES.find(t => t.value === field.type)?.label || field.type;

  function update(patch) { dispatch({ type: 'UPDATE_FIELD', sectionIdx, fieldIdx, patch }); }
  function addOption()   { update({ options: [...(field.options || []), 'New option'] }); }
  function setOption(i, v) { const opts = [...(field.options || [])]; opts[i] = v; update({ options: opts }); }
  function removeOption(i)  { update({ options: (field.options || []).filter((_, idx) => idx !== i) }); }
  function moveOption(i, d) {
    const opts = [...(field.options || [])];
    const j = i + d; if (j < 0 || j >= opts.length) return;
    [opts[i], opts[j]] = [opts[j], opts[i]]; update({ options: opts });
  }
  function addItem()    { update({ items: [...(field.items || []), { id: uid(), label: 'New item', hasComment: false }] }); }
  function setItem(i, v) { const items = [...(field.items || [])]; items[i] = { ...items[i], label: v }; update({ items }); }
  function removeItem(i)  { update({ items: (field.items || []).filter((_, idx) => idx !== i) }); }
  function moveItem(i, d) {
    const items = [...(field.items || [])];
    const j = i + d; if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]]; update({ items });
  }

  return (
    <div style={{ background: 'rgba(0,0,0,.2)', border: `1px solid ${tc.border}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>

      {/* Field header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: tc.bg, cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)}>
        <span style={{ fontSize: 10, fontWeight: 900, color: tc.color, background: `${tc.bg}`, border: `1px solid ${tc.border}`, borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {typeName}
        </span>
        <span style={{ flex: 1, fontSize: 13, color: '#cbd5e1', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field.label || '(no label)'}</span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <MoveDelete
            onUp={()     => dispatch({ type: 'MOVE_FIELD', sectionIdx, fieldIdx, dir: -1 })}
            onDown={()   => dispatch({ type: 'MOVE_FIELD', sectionIdx, fieldIdx, dir:  1 })}
            onDelete={()  => dispatch({ type: 'REMOVE_FIELD', sectionIdx, fieldIdx })}
            disableUp={fieldIdx === 0} disableDown={fieldIdx === total - 1}
            label="field"
          />
          <button onClick={e => { e.stopPropagation(); setCollapsed(c => !c); }}
            style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#64748b', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {/* Field body */}
      {!collapsed && (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Type selector */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Field Type</div>
            <select value={field.type} onChange={e => update({ type: e.target.value })}
              style={{ ...inp, maxWidth: 280 }}>
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Label */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Question / Label</div>
            <Editable value={field.label} onChange={v => update({ label: v })} placeholder="Enter question text…" multiline />
          </div>

          {/* Radio options */}
          {field.type === 'radio' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Options (one per line — add descriptions to clarify)</div>
              {(field.options || []).map((opt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(167,139,250,.5)', flexShrink: 0 }} />
                  <input
                    type="text" value={opt}
                    onChange={e => setOption(i, e.target.value)}
                    placeholder="Option text (e.g. Level 2 — 3+ years, independent diagnostics)"
                    style={{ ...inp, flex: 1 }}
                  />
                  <MoveDelete onUp={() => moveOption(i,-1)} onDown={() => moveOption(i,1)} onDelete={() => removeOption(i)} disableUp={i===0} disableDown={i===(field.options||[]).length-1} label="option" />
                </div>
              ))}
              <button onClick={addOption} style={{ background: 'rgba(167,139,250,.1)', border: '1px dashed rgba(167,139,250,.4)', color: '#a78bfa', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700, marginTop: 4 }}>+ Add Option</button>
            </div>
          )}

          {/* Rating table items */}
          {field.type === 'rating_table' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Rating Items</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Max Rating:</span>
                  <select value={field.maxRating || 5} onChange={e => update({ maxRating: +e.target.value })}
                    style={{ ...inp, width: 70, padding: '4px 8px' }}>
                    {[3,4,5,6,7,10].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              {(field.items || []).map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid rgba(251,191,36,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fbbf24', flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <input
                    type="text" value={item.label}
                    onChange={e => setItem(i, e.target.value)}
                    placeholder="Skill area or item to rate…"
                    style={{ ...inp, flex: 1 }}
                  />
                  <MoveDelete onUp={() => moveItem(i,-1)} onDown={() => moveItem(i,1)} onDelete={() => removeItem(i)} disableUp={i===0} disableDown={i===(field.items||[]).length-1} label="item" />
                </div>
              ))}
              <button onClick={addItem} style={{ background: 'rgba(251,191,36,.1)', border: '1px dashed rgba(251,191,36,.4)', color: '#fbbf24', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700, marginTop: 4 }}>+ Add Rating Item</button>
            </div>
          )}

          {/* Textarea rows */}
          {field.type === 'textarea' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>Default rows:</span>
              <select value={field.rows || 4} onChange={e => update({ rows: +e.target.value })}
                style={{ ...inp, width: 80, padding: '4px 8px' }}>
                {[2,3,4,5,6,8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          {/* Min words — text + textarea */}
          {(field.type === 'textarea' || field.type === 'text') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#64748b' }} title="The reviewer must type at least this many words before they can submit. Set to 0 to disable.">
                Minimum words required:
              </span>
              <input
                type="number"
                min={0}
                value={field.minWords ?? 0}
                onChange={e => update({ minWords: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                style={{ ...inp, width: 90, padding: '4px 8px' }}
              />
              <span style={{ fontSize: 11, color: '#475569' }}>(0 = no minimum)</span>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Section editor ────────────────────────────────────────────────────────────
function SectionEditor({ section, sectionIdx, totalSections, dispatch }) {
  const [addingType, setAddingType] = useState('textarea');

  function addField() {
    const base = { id: uid(), type: addingType, label: '' };
    if (addingType === 'radio')        base.options = ['Option 1', 'Option 2'];
    if (addingType === 'rating_table') base.items = [{ id: uid(), label: 'Item 1' }], base.maxRating = 5;
    dispatch({ type: 'ADD_FIELD', sectionIdx, field: base });
  }

  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 16, padding: '18px 20px', marginBottom: 20 }}>

      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Section Title</div>
          <Editable value={section.title} onChange={v => dispatch({ type: 'UPDATE_SECTION', sectionIdx, patch: { title: v } })} placeholder="Section title…" style={{ fontSize: 15, fontWeight: 700 }} />
        </div>
        <div style={{ flexShrink: 0, marginTop: 20 }}>
          <MoveDelete
            onUp={()    => dispatch({ type: 'MOVE_SECTION', sectionIdx, dir: -1 })}
            onDown={()  => dispatch({ type: 'MOVE_SECTION', sectionIdx, dir:  1 })}
            onDelete={()  => { if (window.confirm('Remove this entire section?')) dispatch({ type: 'REMOVE_SECTION', sectionIdx }); }}
            disableUp={sectionIdx === 0} disableDown={sectionIdx === totalSections - 1}
            label="section"
          />
        </div>
      </div>

      {/* Section description */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Section Description / Instructions (optional)</div>
        <Editable value={section.description} onChange={v => dispatch({ type: 'UPDATE_SECTION', sectionIdx, patch: { description: v } })} placeholder="Instructions shown at the top of this section…" multiline />
      </div>

      {/* Fields */}
      <div style={{ marginBottom: 14 }}>
        {(section.fields || []).length === 0 && (
          <div style={{ color: '#334155', fontSize: 13, fontStyle: 'italic', padding: '10px 0' }}>No fields yet — add one below.</div>
        )}
        {(section.fields || []).map((field, fi) => (
          <FieldEditor key={field.id} field={field} sectionIdx={sectionIdx} fieldIdx={fi} total={section.fields.length} dispatch={dispatch} />
        ))}
      </div>

      {/* Add field row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={addingType} onChange={e => setAddingType(e.target.value)}
          style={{ ...inp, flex: 1, maxWidth: 300, padding: '7px 10px' }}>
          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={addField}
          style={{ background: 'rgba(96,165,250,.15)', border: '1px solid rgba(96,165,250,.4)', color: '#60a5fa', borderRadius: 9, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}>
          + Add Field
        </button>
      </div>
    </div>
  );
}

// ── Reducer ───────────────────────────────────────────────────────────────────
function reduce(state, action) {
  const sections = state.sections.map(s => ({ ...s, fields: [...(s.fields || [])] }));

  switch (action.type) {
    case 'SET': return action.def;

    case 'SET_TITLE': return { ...state, title: action.value };

    case 'ADD_SECTION':
      return { ...state, sections: [...sections, { id: uid(), title: 'New Section', description: '', fields: [] }] };

    case 'REMOVE_SECTION':
      return { ...state, sections: sections.filter((_, i) => i !== action.sectionIdx) };

    case 'MOVE_SECTION': {
      const j = action.sectionIdx + action.dir;
      if (j < 0 || j >= sections.length) return state;
      const arr = [...sections]; [arr[action.sectionIdx], arr[j]] = [arr[j], arr[action.sectionIdx]];
      return { ...state, sections: arr };
    }

    case 'UPDATE_SECTION':
      return { ...state, sections: sections.map((s, i) => i === action.sectionIdx ? { ...s, ...action.patch } : s) };

    case 'ADD_FIELD':
      return { ...state, sections: sections.map((s, i) => i === action.sectionIdx ? { ...s, fields: [...(s.fields || []), action.field] } : s) };

    case 'REMOVE_FIELD':
      return { ...state, sections: sections.map((s, i) => i === action.sectionIdx ? { ...s, fields: s.fields.filter((_, fi) => fi !== action.fieldIdx) } : s) };

    case 'MOVE_FIELD': {
      const s = { ...sections[action.sectionIdx] };
      const fields = [...s.fields];
      const j = action.fieldIdx + action.dir;
      if (j < 0 || j >= fields.length) return state;
      [fields[action.fieldIdx], fields[j]] = [fields[j], fields[action.fieldIdx]];
      s.fields = fields;
      return { ...state, sections: sections.map((sec, i) => i === action.sectionIdx ? s : sec) };
    }

    case 'UPDATE_FIELD': {
      const s = { ...sections[action.sectionIdx] };
      s.fields = s.fields.map((f, fi) => fi === action.fieldIdx ? { ...f, ...action.patch } : f);
      return { ...state, sections: sections.map((sec, i) => i === action.sectionIdx ? s : sec) };
    }

    default: return state;
  }
}

// ── Main FormEditor ───────────────────────────────────────────────────────────
export default function FormEditor({ initialDef, onSave, onCancel, saving, title, subtitle }) {
  const [def, dispatch] = React.useReducer(reduce, initialDef || { title: '', sections: [] });

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div className="adv-topbar">
        <div>
          <div className="adv-title">{title || '✏️ Edit Review Form'}</div>
          <div className="adv-sub">{subtitle || 'Customize questions, options, and sections'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} className="secondary">✕ Cancel</button>
          <button
            onClick={() => onSave(def)}
            disabled={saving}
            style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 10, padding: '9px 24px', cursor: 'pointer', fontWeight: 900, fontSize: 14 }}>
            {saving ? '⏳ Saving…' : '💾 Save Form'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* How to use banner */}
          <div style={{ background: 'linear-gradient(135deg,rgba(99,102,241,.1),rgba(79,70,229,.06))', border: '1px solid rgba(99,102,241,.3)', borderRadius: 14, padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 28 }}>✏️</span>
            <div>
              <div style={{ fontWeight: 900, color: '#a5b4fc', fontSize: 14, marginBottom: 4 }}>Customize Your Review Form</div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7 }}>
                Edit question labels, add descriptions to skill levels, reorder or remove fields, and add new questions. Changes only affect <strong style={{ color: '#a5b4fc' }}>this form</strong> — the tech form and manager form are edited separately.
              </div>
            </div>
          </div>

          {/* Form title */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Form Title</div>
            <input
              type="text"
              value={def.title || ''}
              onChange={e => dispatch({ type: 'SET_TITLE', value: e.target.value })}
              placeholder="e.g. Technician Self-Evaluation Form"
              style={{ ...inp, fontSize: 16, fontWeight: 700, padding: '10px 14px' }}
            />
          </div>

          {/* Sections */}
          {(def.sections || []).map((section, si) => (
            <SectionEditor key={section.id} section={section} sectionIdx={si} totalSections={def.sections.length} dispatch={dispatch} />
          ))}

          {/* Add section */}
          <button
            onClick={() => dispatch({ type: 'ADD_SECTION' })}
            style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '2px dashed rgba(255,255,255,.15)', color: '#64748b', borderRadius: 14, padding: '16px', cursor: 'pointer', fontWeight: 800, fontSize: 14, marginBottom: 24 }}>
            + Add New Section
          </button>

          {/* Save at bottom too */}
          <button
            onClick={() => onSave(def)}
            disabled={saving}
            style={{ width: '100%', background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.5)', color: '#4ade80', borderRadius: 12, padding: '14px', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>
            {saving ? '⏳ Saving…' : '💾 Save Form'}
          </button>

        </div>
      </div>
    </div>
  );
}
