import React, { useEffect, useMemo, useState } from 'react';
import { loadAdditionalTimeIndex, approveAdditionalTimeRequest } from '../utils/github';

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
};

function StatusPill({ status }) {
  const approved = status === 'approved';
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      background: approved ? 'rgba(74,222,128,.15)' : 'rgba(251,191,36,.15)',
      border: `1px solid ${approved ? 'rgba(74,222,128,.5)' : 'rgba(251,191,36,.5)'}`,
      color: approved ? '#4ade80' : '#fbbf24',
      borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800,
      letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {approved ? '✅ Time Approved' : '⏳ Waiting for Approval'}
    </span>
  );
}

// One list serving both audiences: a tech gets their own requests read-only,
// a manager gets everyone's with an Approve button. Keeping it in one component
// means the two views can never drift out of sync on what a status means.
export default function AdditionalTimeReview({
  currentUser, currentUserDisplay, canApprove = false, embedded = false, onBack,
}) {
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [approving, setApproving] = useState('');

  const me = (currentUser || '').toUpperCase();

  async function load() {
    setError('');
    try {
      const all = await loadAdditionalTimeIndex();
      setRows(Array.isArray(all) ? all : []);
    } catch (e) {
      setError(e.message || 'Could not load requests.');
      setRows([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const visible = useMemo(() => {
    const all = rows || [];
    // A tech only ever sees their own submissions.
    const mine = canApprove ? all : all.filter(r => (r.tech || '').toUpperCase() === me);
    // Waiting-for-approval first, then newest first — the manager's queue reads
    // top-down, and a tech sees what's still outstanding without scrolling.
    return mine.slice().sort((a, b) => {
      const aPend = a.status !== 'approved', bPend = b.status !== 'approved';
      if (aPend !== bPend) return aPend ? -1 : 1;
      return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
    });
  }, [rows, canApprove, me]);

  const pendingCount = visible.filter(r => r.status !== 'approved').length;

  async function handleApprove(row) {
    setApproving(row.id); setError('');
    try {
      const next = await approveAdditionalTimeRequest(row.id, currentUserDisplay || currentUser || '');
      setRows(Array.isArray(next) ? next : rows);
    } catch (e) {
      setError(e.message || 'Approve failed.');
    } finally {
      setApproving('');
    }
  }

  const body = (
    <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>
          {rows === null ? 'Loading…'
            : visible.length === 0 ? (canApprove ? 'No additional time has been submitted yet.' : 'You have not submitted any additional time yet.')
            : `${visible.length} request${visible.length === 1 ? '' : 's'}${pendingCount ? ` · ${pendingCount} waiting for approval` : ''}`}
        </div>
        <button onClick={load} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.45)', color: '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {!canApprove && visible.length > 0 && (
        <div style={{ background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.3)', color: '#fcd34d', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          Your time counts only once a manager marks it <strong>Time Approved</strong>.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map(r => {
          const open = openId === r.id;
          return (
            <div key={r.id} style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${r.status === 'approved' ? 'rgba(74,222,128,.3)' : 'rgba(251,191,36,.35)'}`,
              borderRadius: 12, overflow: 'hidden',
            }}>
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 15 }}>
                    RO {r.ro || '—'}
                    {r.hours ? <span style={{ color: '#fbbf24', fontWeight: 700 }}> · {r.hours} hrs</span> : null}
                  </div>
                  <div style={{ color: '#7a92b8', fontSize: 12, marginTop: 3 }}>
                    {canApprove ? `${r.techDisplay || r.tech || 'Unknown tech'} · ` : ''}{fmtDate(r.submittedAt)}
                  </div>
                </div>
                <StatusPill status={r.status} />
                <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{open ? '▲' : '▼'}</span>
              </button>

              {open && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: '14px 0', fontSize: 13 }}>
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Technician</span>
                    <span style={{ color: '#e2e8f0' }}>{r.techDisplay || r.tech || '—'}</span>
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Repair Order</span>
                    <span style={{ color: '#e2e8f0' }}>{r.ro || '—'}</span>
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Flat Rate Hours</span>
                    <span style={{ color: '#e2e8f0' }}>{r.hours || '— not given —'}</span>
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Submitted</span>
                    <span style={{ color: '#e2e8f0' }}>{fmtDate(r.submittedAt)}</span>
                    {r.status === 'approved' && (
                      <>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Approved</span>
                        <span style={{ color: '#4ade80', fontWeight: 700 }}>
                          {fmtDate(r.approvedAt)}{r.approvedBy ? ` · by ${r.approvedBy}` : ''}
                        </span>
                      </>
                    )}
                  </div>

                  {r.photoUrl ? (
                    <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
                      <img src={r.photoUrl} alt={`Techline screenshot for RO ${r.ro}`}
                        style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)' }} />
                    </a>
                  ) : (
                    <div style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>⚠️ No screenshot was attached.</div>
                  )}

                  {canApprove && r.status !== 'approved' && (
                    <div style={{ marginTop: 14 }}>
                      <button
                        onClick={() => handleApprove(r)}
                        disabled={approving === r.id}
                        style={{
                          background: 'linear-gradient(180deg,#22c55e,#16a34a)', color: '#fff',
                          border: '1px solid rgba(74,222,128,.6)', borderRadius: 10,
                          padding: '12px 26px', fontSize: 15, fontWeight: 800,
                          cursor: approving === r.id ? 'wait' : 'pointer',
                        }}>
                        {approving === r.id ? '⏳ Approving…' : '✅ Approve Time'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (embedded) return <div style={{ padding: '4px 0' }}>{body}</div>;

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Additional Time Reviewal</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <button className="secondary" onClick={onBack}>← Technician Resources</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>{body}</div>
    </div>
  );
}
