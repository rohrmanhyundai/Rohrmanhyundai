import React from 'react';

// ── Shared styles ────────────────────────────────────────────────────────────
const fieldLabel = {
  fontSize: 14,
  fontWeight: 700,
  color: '#e2e8f0',
  marginBottom: 12,
  lineHeight: 1.5,
};

const sectionBox = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14,
  padding: '22px 26px',
  marginBottom: 20,
};

const sectionHead = {
  fontWeight: 900,
  fontSize: 15,
  color: '#e2e8f0',
  marginBottom: 6,
  paddingBottom: 10,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const inpStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.13)',
  borderRadius: 9,
  color: '#e2e8f0',
  padding: '10px 13px',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  resize: 'vertical',
};

// ── Radio field ───────────────────────────────────────────────────────────────
function RadioField({ field, value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {(field.options || []).map(opt => {
        const selected = value === opt;
        return (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: readOnly ? 'default' : 'pointer', userSelect: 'none' }}>
            <div
              onClick={() => !readOnly && onChange(opt)}
              style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${selected ? '#60a5fa' : 'rgba(255,255,255,0.25)'}`,
                background: selected ? 'rgba(96,165,250,0.2)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}>
              {selected && <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#60a5fa' }} />}
            </div>
            <span style={{ fontSize: 14, color: selected ? '#e2e8f0' : '#94a3b8' }}>{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

// ── Yes / No / Sometimes field ────────────────────────────────────────────────
function YesNoSometimesField({ field, value, onChange, readOnly, options }) {
  const opts = options || ['Yes', 'No', 'Sometimes'];
  const colors = { Yes: '#4ade80', No: '#f87171', Sometimes: '#fbbf24' };
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {opts.map(opt => {
        const selected = value === opt;
        const color = colors[opt] || '#a5b4fc';
        return (
          <button
            key={opt}
            onClick={() => !readOnly && onChange(selected ? '' : opt)}
            disabled={readOnly}
            style={{
              padding: '8px 22px',
              borderRadius: 30,
              border: `2px solid ${selected ? color : 'rgba(255,255,255,0.15)'}`,
              background: selected ? `${color}22` : 'transparent',
              color: selected ? color : '#64748b',
              fontWeight: 800,
              fontSize: 13,
              cursor: readOnly ? 'default' : 'pointer',
              transition: 'all .15s',
            }}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Rating table field (rows × 1-N rating) ────────────────────────────────────
function RatingTableField({ field, value = {}, onChange, readOnly }) {
  const max = field.maxRating || 5;
  const ratings = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 700, fontSize: 12, borderBottom: '1px solid rgba(255,255,255,.08)', width: '55%' }}>Area</th>
            {ratings.map(r => (
              <th key={r} style={{ textAlign: 'center', padding: '8px 8px', color: '#64748b', fontWeight: 700, fontSize: 12, borderBottom: '1px solid rgba(255,255,255,.08)', minWidth: 38 }}>{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(field.items || []).map((item, idx) => {
            const itemVal = value[item.id] ?? null;
            return (
              <tr key={item.id} style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,.02)' : 'transparent' }}>
                <td style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 13, lineHeight: 1.4 }}>{item.label}</td>
                {ratings.map(r => {
                  const selected = itemVal === r;
                  return (
                    <td key={r} style={{ textAlign: 'center', padding: '10px 8px' }}>
                      <div
                        onClick={() => !readOnly && onChange({ ...value, [item.id]: selected ? null : r })}
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          border: `2px solid ${selected ? '#60a5fa' : 'rgba(255,255,255,.2)'}`,
                          background: selected ? 'rgba(96,165,250,.25)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          margin: '0 auto', cursor: readOnly ? 'default' : 'pointer',
                          color: selected ? '#60a5fa' : '#475569',
                          fontWeight: 900, fontSize: 11,
                          transition: 'all .15s',
                        }}>
                        {r}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────────
export default function ReviewFormRenderer({ formDef, values = {}, onChange, readOnly = false }) {
  if (!formDef || !formDef.sections) {
    return <div style={{ color: '#475569', fontSize: 14, padding: 20, textAlign: 'center' }}>No form definition loaded.</div>;
  }

  function handleChange(fieldId, val) {
    if (readOnly || !onChange) return;
    onChange({ ...values, [fieldId]: val });
  }

  return (
    <div>
      {formDef.sections.map(section => (
        <div key={section.id} style={sectionBox}>
          <div style={sectionHead}>{section.title}</div>
          {section.description && (
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 1.6, fontStyle: 'italic' }}>{section.description}</div>
          )}

          {section.fields.map((field, fi) => (
            <div key={field.id} style={{ marginBottom: fi < section.fields.length - 1 ? 24 : 0, paddingBottom: fi < section.fields.length - 1 ? 22 : 0, borderBottom: fi < section.fields.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <div style={fieldLabel}>{field.label}</div>

              {field.type === 'radio' && (
                <RadioField field={field} value={values[field.id]} onChange={v => handleChange(field.id, v)} readOnly={readOnly} />
              )}

              {field.type === 'yes_no_sometimes' && (
                <YesNoSometimesField field={field} value={values[field.id]} onChange={v => handleChange(field.id, v)} readOnly={readOnly} options={['Yes', 'No', 'Sometimes']} />
              )}

              {field.type === 'yes_no' && (
                <YesNoSometimesField field={field} value={values[field.id]} onChange={v => handleChange(field.id, v)} readOnly={readOnly} options={['Yes', 'No']} />
              )}

              {field.type === 'rating_table' && (
                <RatingTableField field={field} value={values[field.id] || {}} onChange={v => handleChange(field.id, v)} readOnly={readOnly} />
              )}

              {field.type === 'rating' && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {Array.from({ length: field.maxRating || 5 }, (_, i) => i + 1).map(r => {
                    const selected = values[field.id] === r;
                    return (
                      <div
                        key={r}
                        onClick={() => !readOnly && handleChange(field.id, selected ? null : r)}
                        style={{
                          width: 44, height: 44, borderRadius: '50%',
                          border: `2px solid ${selected ? '#60a5fa' : 'rgba(255,255,255,.2)'}`,
                          background: selected ? 'rgba(96,165,250,.2)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: readOnly ? 'default' : 'pointer',
                          color: selected ? '#60a5fa' : '#64748b',
                          fontWeight: 900, fontSize: 16,
                          transition: 'all .15s',
                        }}>
                        {r}
                      </div>
                    );
                  })}
                </div>
              )}

              {field.type === 'textarea' && (
                <textarea
                  value={values[field.id] || ''}
                  onChange={e => handleChange(field.id, e.target.value)}
                  rows={field.rows || 4}
                  placeholder={readOnly ? '' : (field.placeholder || 'Type your answer here…')}
                  readOnly={readOnly}
                  style={{ ...inpStyle, color: readOnly ? '#94a3b8' : '#e2e8f0' }}
                />
              )}

              {field.type === 'text' && (
                <input
                  type="text"
                  value={values[field.id] || ''}
                  onChange={e => handleChange(field.id, e.target.value)}
                  placeholder={readOnly ? '' : (field.placeholder || 'Your answer…')}
                  readOnly={readOnly}
                  style={{ ...inpStyle, resize: 'none' }}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
