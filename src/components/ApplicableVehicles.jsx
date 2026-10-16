import React, { useState } from 'react';
import { applicableVehicles } from '../utils/vinLookup';

// A bulletin's Applicable Vehicles — model, model years and production dates —
// under a search result, so the tech can tell at a glance whether the car in
// the bay is even covered before opening the PDF. Read from the stored
// searchText (utils/vinLookup); renders nothing when the section isn't readable.
//
// `limit` caps the lines shown. `expandable` lets the "+N more" line open the
// rest; leave it off inside a clickable row, where a nested control would
// steal the row's click.
export default function ApplicableVehicles({ item, limit = 4, expandable = true, style }) {
  const [all, setAll] = useState(false);
  const rows = applicableVehicles(item);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, limit);
  const more = rows.length - shown.length;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', ...style }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: 0.4, textTransform: 'uppercase' }}>Applicable vehicles</span>
      {shown.map((r, i) => (
        <span key={i} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.45 }}>
          {r.years && <b style={{ color: '#e2e8f0' }}>{r.years}</b>}{r.years ? ' ' : ''}{r.model}
          {r.production && (
            <span style={{ color: '#86efac' }}> · built {r.production}</span>
          )}
        </span>
      ))}
      {more > 0 && (expandable ? (
        <button type="button" onClick={e => { e.stopPropagation(); setAll(true); }}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: '#6ee7f9', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
          + {more} more vehicle{more === 1 ? '' : 's'}
        </button>
      ) : (
        <span style={{ fontSize: 11.5, color: '#64748b' }}>+ {more} more vehicle{more === 1 ? '' : 's'}</span>
      ))}
    </div>
  );
}
