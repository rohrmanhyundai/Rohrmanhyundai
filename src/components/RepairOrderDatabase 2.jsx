import React, { useEffect, useMemo, useState } from 'react';
import { loadRoArchive, saveRoArchive, loadWipData, saveWipData, loadAwaitingData, saveAwaitingData } from '../utils/github';

// Strip the archive bookkeeping fields before pushing a row back into a live list.
function unwrap(entry) {
  const out = { ...entry };
  delete out._archiveId;
  delete out._archivedAt;
  delete out._archivedBy;
  delete out._source;
  delete out._sourceTech;
  return out;
}

function fmt(dt) {
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return dt; }
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

export default function RepairOrderDatabase({ onBack, currentUser }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all'); // all | wip | awaiting
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    loadRoArchive()
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (sourceFilter !== 'all' && (e._source || '').toLowerCase() !== sourceFilter) return false;
      if (!q) return true;
      const hay = [
        e.ro, e.jobDesc, e.notes, e.advisor, e.tech, e._sourceTech, e._archivedBy,
      ].map(x => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [entries, query, sourceFilter]);

  async function restoreEntry(entry) {
    const where = entry._source === 'awaiting' ? 'the Cars Awaiting list' : `${entry._sourceTech || 'WIP'}'s WIP list`;
    if (!window.confirm(`Restore RO ${entry.ro || '?'} back to ${where}?\n\nThis re-adds the row and removes it from the database.`)) return;
    setBusyId(entry._archiveId);
    setStatus('⏳ Restoring…');
    try {
      const clean = unwrap(entry);
      if (entry._source === 'awaiting') {
        const list = await loadAwaitingData();
        await saveAwaitingData([clean, ...(list || []).filter(r => r.id !== clean.id)]);
      } else {
        const tech = entry._sourceTech;
        if (!tech) throw new Error('Original tech is unknown — cannot restore. Use Delete Forever or contact admin.');
        const list = await loadWipData(tech);
        await saveWipData(tech, [clean, ...(list || []).filter(r => r.id !== clean.id)]);
      }
      const next = entries.filter(e => e._archiveId !== entry._archiveId);
      await saveRoArchive(next);
      setEntries(next);
      setStatus(`✅ Restored RO ${entry.ro || '?'} to ${where}.`);
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      setStatus('❌ ' + (err?.message || err));
    } finally {
      setBusyId(null);
    }
  }

  async function purgeEntry(entry) {
    if (!window.confirm(`Permanently delete RO ${entry.ro || '?'} from the archive?\n\nThis cannot be undone.`)) return;
    setBusyId(entry._archiveId);
    setStatus('⏳ Deleting…');
    try {
      const next = entries.filter(e => e._archiveId !== entry._archiveId);
      await saveRoArchive(next);
      setEntries(next);
      setStatus(`✅ Deleted RO ${entry.ro || '?'} from the archive.`);
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      setStatus('❌ ' + (err?.message || err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">🗂 Repair Order Database</div>
          <div className="adv-sub">Every RO deleted from WIP or Cars Awaiting is stored here. Search, restore, or purge.</div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="🔍 Search by RO #, advisor, tech, job description, notes…"
              style={{ flex: 1, minWidth: 320, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none' }}
            />
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, padding: '10px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              <option value="all">All sources</option>
              <option value="wip">From WIP</option>
              <option value="awaiting">From Cars Awaiting</option>
            </select>
            {(query || sourceFilter !== 'all') && (
              <button
                onClick={() => { setQuery(''); setSourceFilter('all'); }}
                style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
              {loading ? 'Loading…' : `${filtered.length} of ${entries.length} entries`}
            </div>
          </div>

          {status && (
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: status.startsWith('✅') ? '#4ade80' : status.startsWith('❌') ? '#f87171' : '#fbbf24' }}>
              {status}
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div style={{ color: '#64748b', padding: 60, textAlign: 'center' }}>⏳ Loading archive…</div>
          ) : entries.length === 0 ? (
            <div style={{ color: '#64748b', padding: 60, textAlign: 'center' }}>No deleted ROs in the archive yet. When anyone deletes a row from WIP or Cars Awaiting, it'll show up here.</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#64748b', padding: 60, textAlign: 'center' }}>No matches.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(e => {
                const isWip = (e._source || '').toLowerCase() === 'wip';
                const sourceColor = isWip ? '#60a5fa' : '#fbbf24';
                const sourceBg = isWip ? 'rgba(96,165,250,.12)' : 'rgba(251,191,36,.12)';
                const sourceBorder = isWip ? 'rgba(96,165,250,.4)' : 'rgba(251,191,36,.4)';
                return (
                  <div key={e._archiveId} style={{
                    background: 'rgba(255,255,255,.02)',
                    border: '1px solid rgba(255,255,255,.06)',
                    borderRadius: 12, padding: '12px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 90, fontWeight: 900, color: '#e2e8f0', fontSize: 15 }}>{e.ro || '—'}</div>
                      <div style={{
                        fontSize: 10, fontWeight: 800, color: sourceColor,
                        background: sourceBg, border: `1px solid ${sourceBorder}`,
                        borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: .5,
                      }}>
                        {isWip ? `WIP · ${e._sourceTech || '?'}` : 'Awaiting'}
                      </div>
                      {e.advisor && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: .5 }}>👤 {e.advisor}</div>
                      )}
                      {e.tech && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: .5 }}>🔧 {e.tech}</div>
                      )}
                      {e.highPriority && (
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#f87171', background: 'rgba(248,113,113,.15)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 6, padding: '2px 8px' }}>HIGH PRIORITY</div>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => restoreEntry(e)}
                          disabled={busyId === e._archiveId}
                          style={{ background: 'rgba(34,197,94,.18)', border: '1px solid rgba(34,197,94,.45)', color: '#86efac', borderRadius: 8, padding: '5px 12px', fontWeight: 800, fontSize: 12, cursor: busyId === e._archiveId ? 'not-allowed' : 'pointer' }}
                        >♻ Restore</button>
                        <button
                          onClick={() => purgeEntry(e)}
                          disabled={busyId === e._archiveId}
                          style={{ background: 'rgba(239,68,68,.16)', border: '1px solid rgba(239,68,68,.5)', color: '#f87171', borderRadius: 8, padding: '5px 12px', fontWeight: 800, fontSize: 12, cursor: busyId === e._archiveId ? 'not-allowed' : 'pointer' }}
                        >🗑 Delete Forever</button>
                      </div>
                    </div>

                    <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 8, lineHeight: 1.4 }}>
                      {e.jobDesc || <span style={{ color: '#64748b', fontStyle: 'italic' }}>(no job description)</span>}
                    </div>
                    {e.notes && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>📝 {e.notes}</div>
                    )}

                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: '#64748b' }}>
                      {e.roDate && <span>RO date {fmtDate(e.roDate)}</span>}
                      {e.etaParts && <span>Parts ETA {e.etaParts}</span>}
                      {e.etaCompletion && <span>Completion ETA {e.etaCompletion}</span>}
                      {e.partsArrived === true && <span style={{ color: '#86efac', fontWeight: 700 }}>Parts arrived{e.partsArrivedDate ? ` (${e.partsArrivedDate})` : ''}</span>}
                      {e.partsArrived === false && <span style={{ color: '#fbbf24' }}>Parts pending</span>}
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11, color: '#475569' }}>
                      Deleted by <span style={{ color: '#94a3b8', fontWeight: 700 }}>{e._archivedBy || '?'}</span> on {fmt(e._archivedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
