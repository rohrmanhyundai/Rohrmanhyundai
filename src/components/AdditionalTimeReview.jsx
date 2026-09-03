import React, { useEffect, useMemo, useState } from 'react';
import {
  loadAdditionalTimeIndex, approveAdditionalTimeRequest,
  declineAdditionalTimeRequest, removeAdditionalTimeRequest,
} from '../utils/github';

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
};

const isPending = (r) => r.status !== 'approved' && r.status !== 'declined';

function StatusPill({ status }) {
  const tone = status === 'approved'
    ? { bg: 'rgba(74,222,128,.15)', line: 'rgba(74,222,128,.5)', fg: '#4ade80', text: '✅ Time Approved' }
    : status === 'declined'
    ? { bg: 'rgba(248,113,113,.15)', line: 'rgba(248,113,113,.5)', fg: '#f87171', text: '🚫 Declined' }
    : { bg: 'rgba(251,191,36,.15)', line: 'rgba(251,191,36,.5)', fg: '#fbbf24', text: '⏳ Waiting for Approval' };
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      background: tone.bg, border: `1px solid ${tone.line}`, color: tone.fg,
      borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800,
      letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {tone.text}
    </span>
  );
}

// Techline and diag requests live in the same index; the badge is how a
// manager tells at a glance which rule they're approving against.
function KindPill({ kind }) {
  const diag = kind === 'diag';
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      background: diag ? 'rgba(192,132,252,.15)' : 'rgba(56,189,248,.15)',
      border: `1px solid ${diag ? 'rgba(192,132,252,.5)' : 'rgba(56,189,248,.5)'}`,
      color: diag ? '#c084fc' : '#38bdf8',
      borderRadius: 20, padding: '4px 10px', fontSize: 10.5, fontWeight: 800,
      letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {diag ? '⏱️ Diag Time' : '☎️ Tech Line'}
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
  // Manager's edits to the hours, keyed by request id. Only what's actually
  // been typed lives here — an untouched row falls back to the tech's ask, so
  // approving without editing grants exactly what was requested.
  const [hoursDraft, setHoursDraft] = useState({});
  // Note the manager types back to the tech, keyed the same way. Required when
  // the hours are changed or the request is declined — a tech shouldn't have to
  // guess why they got less time than they asked for.
  const [noteDraft, setNoteDraft] = useState({});
  const [declining, setDeclining] = useState('');
  const [removing, setRemoving] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

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
      const aPend = isPending(a), bPend = isPending(b);
      if (aPend !== bPend) return aPend ? -1 : 1;
      return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
    });
  }, [rows, canApprove, me]);

  const pendingCount = visible.filter(isPending).length;

  async function handleApprove(row) {
    const granted = (hoursDraft[row.id] ?? row.hours ?? '').trim();
    const note = (noteDraft[row.id] || '').trim();
    if (granted !== (row.hours || '').trim() && !note) {
      setError('You changed the hours — add a note telling the tech why.');
      return;
    }
    setApproving(row.id); setError('');
    try {
      const next = await approveAdditionalTimeRequest(row.id, currentUserDisplay || currentUser || '', granted, note);
      setRows(Array.isArray(next) ? next : rows);
    } catch (e) {
      setError(e.message || 'Approve failed.');
    } finally {
      setApproving('');
    }
  }

  async function handleDecline(row) {
    const note = (noteDraft[row.id] || '').trim();
    if (!note) { setError('Add a note telling the tech why the request was declined.'); return; }
    setDeclining(row.id); setError('');
    try {
      const next = await declineAdditionalTimeRequest(row.id, currentUserDisplay || currentUser || '', note);
      setRows(Array.isArray(next) ? next : rows);
    } catch (e) {
      setError(e.message || 'Decline failed.');
    } finally {
      setDeclining('');
    }
  }

  async function handleRemove(row) {
    setRemoving(row.id); setError('');
    try {
      const next = await removeAdditionalTimeRequest(row.id);
      setRows(Array.isArray(next) ? next : (rows || []).filter(r => r.id !== row.id));
      setConfirmDelete('');
      if (openId === row.id) setOpenId(null);
    } catch (e) {
      setError(e.message || 'Delete failed.');
    } finally {
      setRemoving('');
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
          Your time counts only once a manager marks it <strong>Time Approved</strong>. A manager can change the hours or decline a request — open one to see what was approved and any note they left you.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map(r => {
          const open = openId === r.id;
          const requested = (r.hours || '').trim();
          const granted = (r.approvedHours || '').trim() || requested;
          const headHours = r.status === 'approved' ? granted : requested;
          const adjusted = r.status === 'approved' && requested && granted && granted !== requested;
          return (
            <div key={r.id} style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${r.status === 'approved' ? 'rgba(74,222,128,.3)'
                : r.status === 'declined' ? 'rgba(248,113,113,.35)' : 'rgba(251,191,36,.35)'}`,
              borderRadius: 12, overflow: 'hidden',
            }}>
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 15 }}>
                    RO {r.ro || '—'}
                    {headHours ? (
                      <span style={{
                        color: r.status === 'approved' ? '#4ade80' : r.status === 'declined' ? '#f87171' : '#fbbf24',
                        fontWeight: 700,
                        textDecoration: r.status === 'declined' ? 'line-through' : 'none',
                      }}> · {headHours} hrs</span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 6 }}><KindPill kind={r.kind} /></div>
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
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Request</span>
                    <span style={{ color: '#e2e8f0' }}>{r.kind === 'diag' ? 'Additional diag time' : 'Tech Line additional time'}</span>
                    {r.kind === 'diag' && (
                      <>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Reason</span>
                        <span style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{r.description || '— not given —'}</span>
                      </>
                    )}
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Hours Requested</span>
                    <span style={{ color: '#e2e8f0' }}>{requested || '— not given —'}</span>
                    <span style={{ color: '#7a92b8', fontWeight: 700 }}>Submitted</span>
                    <span style={{ color: '#e2e8f0' }}>{fmtDate(r.submittedAt)}</span>
                    {r.status === 'approved' && (
                      <>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Hours Approved</span>
                        <span style={{ color: '#4ade80', fontWeight: 800 }}>
                          {granted || '— not given —'}
                          {adjusted ? <span style={{ color: '#fbbf24', fontWeight: 700 }}> (changed from {requested})</span> : null}
                        </span>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Approved</span>
                        <span style={{ color: '#4ade80', fontWeight: 700 }}>
                          {fmtDate(r.approvedAt)}{r.approvedBy ? ` · by ${r.approvedBy}` : ''}
                        </span>
                      </>
                    )}
                    {r.status === 'declined' && (
                      <>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Declined</span>
                        <span style={{ color: '#f87171', fontWeight: 700 }}>
                          {fmtDate(r.declinedAt)}{r.declinedBy ? ` · by ${r.declinedBy}` : ''}
                        </span>
                      </>
                    )}
                    {r.managerNote && (
                      <>
                        <span style={{ color: '#7a92b8', fontWeight: 700 }}>Note from Manager</span>
                        <span style={{
                          color: '#fcd34d', fontWeight: 600, whiteSpace: 'pre-wrap',
                          background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)',
                          borderRadius: 8, padding: '8px 10px',
                        }}>
                          {r.managerNote}
                        </span>
                      </>
                    )}
                  </div>

                  {r.photoUrl ? (
                    <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
                      <img src={r.photoUrl} alt={r.kind === 'diag' ? `Repair order photo for RO ${r.ro}` : `Techline screenshot for RO ${r.ro}`}
                        style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)' }} />
                    </a>
                  ) : (
                    <div style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>
                      {r.kind === 'diag' ? '⚠️ No repair order photo was attached.' : '⚠️ No screenshot was attached.'}
                    </div>
                  )}

                  {r.kind === 'diag' && (
                    <div style={{ marginTop: 12, color: '#fcd34d', fontSize: 12.5, fontWeight: 600 }}>
                      Diag time requires clock time punched on the repair order.
                    </div>
                  )}

                  {canApprove && isPending(r) && (() => {
                    const draft = hoursDraft[r.id] ?? requested;
                    const note = noteDraft[r.id] || '';
                    const changed = draft.trim() !== requested;
                    const busy = approving === r.id || declining === r.id;
                    return (
                      <div style={{
                        marginTop: 14, padding: '14px 16px', borderRadius: 12,
                        background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.25)',
                      }}>
                        <label style={{ color: '#7a92b8', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                          Hours to Approve
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <input
                            value={draft}
                            onChange={e => setHoursDraft(d => ({ ...d, [r.id]: e.target.value }))}
                            placeholder="e.g. 1.5"
                            inputMode="decimal"
                            style={{
                              width: 120, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                              border: `1px solid ${changed ? 'rgba(251,191,36,.6)' : 'rgba(255,255,255,0.15)'}`,
                              borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 16, fontWeight: 700,
                            }}
                          />
                          {changed && (
                            <button
                              type="button"
                              onClick={() => setHoursDraft(d => { const n = { ...d }; delete n[r.id]; return n; })}
                              style={{ background: 'none', border: 'none', color: '#7a92b8', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
                              Reset to {requested || 'requested'}
                            </button>
                          )}
                        </div>
                        <div style={{ color: changed ? '#fbbf24' : '#7a92b8', fontSize: 12.5, marginTop: 8, fontWeight: 600, lineHeight: 1.45 }}>
                          {changed
                            ? `Tech asked for ${requested || 'nothing'} — approving ${draft.trim() || 'nothing'} instead.`
                            : 'Change this before approving if the tech asked for more or less than you want to give.'}
                        </div>

                        {/* The tech sees this on their own page, so it's required
                            whenever the answer isn't simply "yes, as asked". */}
                        <label style={{ color: '#7a92b8', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', display: 'block', margin: '14px 0 6px' }}>
                          Note to Tech {changed && <span style={{ color: '#f87171' }}>*required — you changed the hours</span>}
                        </label>
                        <textarea
                          value={note}
                          onChange={e => setNoteDraft(d => ({ ...d, [r.id]: e.target.value }))}
                          rows={3}
                          placeholder={changed
                            ? 'Why did you change the time? The tech sees this.'
                            : 'Optional — anything you want the tech to see. Required to decline.'}
                          style={{
                            width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                            border: `1px solid ${changed && !note.trim() ? 'rgba(248,113,113,.6)' : 'rgba(255,255,255,0.15)'}`,
                            borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 15,
                            lineHeight: 1.45, resize: 'vertical', fontFamily: 'inherit',
                          }}
                        />

                        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleApprove(r)}
                            disabled={busy}
                            style={{
                              background: 'linear-gradient(180deg,#22c55e,#16a34a)', color: '#fff',
                              border: '1px solid rgba(74,222,128,.6)', borderRadius: 10,
                              padding: '12px 26px', fontSize: 15, fontWeight: 800,
                              cursor: busy ? 'wait' : 'pointer',
                            }}>
                            {approving === r.id
                              ? '⏳ Approving…'
                              : `✅ Approve ${draft.trim() ? `${draft.trim()} hrs` : 'Time'}`}
                          </button>
                          <button
                            onClick={() => handleDecline(r)}
                            disabled={busy}
                            style={{
                              background: 'rgba(248,113,113,.12)', color: '#fca5a5',
                              border: '1px solid rgba(248,113,113,.5)', borderRadius: 10,
                              padding: '12px 22px', fontSize: 15, fontWeight: 800,
                              cursor: busy ? 'wait' : 'pointer',
                            }}>
                            {declining === r.id ? '⏳ Declining…' : '🚫 Decline'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Delete is available on any request, in any state, but never
                      as a one-click action sitting next to Approve. */}
                  {canApprove && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      {confirmDelete === r.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>
                            Delete RO {r.ro} for good? This can't be undone.
                          </span>
                          <button
                            onClick={() => handleRemove(r)}
                            disabled={removing === r.id}
                            style={{
                              background: 'linear-gradient(180deg,#ef4444,#b91c1c)', color: '#fff',
                              border: '1px solid rgba(248,113,113,.6)', borderRadius: 8,
                              padding: '8px 18px', fontSize: 13, fontWeight: 800,
                              cursor: removing === r.id ? 'wait' : 'pointer',
                            }}>
                            {removing === r.id ? '⏳ Deleting…' : 'Yes, delete it'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete('')}
                            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(r.id)}
                          style={{ background: 'none', border: 'none', color: '#7a92b8', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                          🗑 Delete this request
                        </button>
                      )}
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
