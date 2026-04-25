import React, { useState, useEffect } from 'react';
import { loadCompletedReviews } from '../utils/github';

function fmtDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Badge({ val, type }) {
  if (type === 'contacted') {
    const isYes = val === 'yes';
    return (
      <span style={{
        background: isYes ? 'rgba(34,197,94,.15)' : 'rgba(251,191,36,.15)',
        color: isYes ? '#86efac' : '#fde68a',
        border: `1px solid ${isYes ? 'rgba(34,197,94,.35)' : 'rgba(251,191,36,.35)'}`,
        borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        {isYes ? '✓ Yes' : '📞 Voicemail'}
      </span>
    );
  }
  if (type === 'satisfied') {
    const isYes = val === 'yes';
    return (
      <span style={{
        background: isYes ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
        color: isYes ? '#86efac' : '#fca5a5',
        border: `1px solid ${isYes ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)'}`,
        borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700,
      }}>
        {isYes ? '✓ Yes' : '✗ No'}
      </span>
    );
  }
  return null;
}

export default function SurveyReports({ advisorList, onBack }) {
  const [allReviews, setAllReviews]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterAdvisor, setFilterAdvisor] = useState('ALL');
  const [filterSatisfied, setFilterSatisfied] = useState('ALL');
  const [filterContacted, setFilterContacted] = useState('ALL');

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const results = await Promise.all(
        advisorList.map(async name => {
          const reviews = await loadCompletedReviews(name);
          return (reviews || []).map(r => ({ ...r, advisorName: name }));
        })
      );
      const combined = results.flat().sort((a, b) => {
        const da = new Date(b.submittedAt || 0);
        const db = new Date(a.submittedAt || 0);
        return da - db;
      });
      setAllReviews(combined);
      setLoading(false);
    }
    loadAll();
  }, [advisorList.join(',')]);

  const advisorOptions = ['ALL', ...advisorList];

  const filtered = allReviews.filter(r => {
    if (filterAdvisor !== 'ALL' && r.advisorName !== filterAdvisor) return false;
    if (filterSatisfied !== 'ALL' && r.satisfied !== filterSatisfied) return false;
    if (filterContacted !== 'ALL' && r.contacted !== filterContacted) return false;
    return true;
  });

  const notSatisfied = filtered.filter(r => r.satisfied === 'no').length;

  const filterBtnStyle = (active, color) => ({
    background: active ? (color === 'red' ? 'rgba(239,68,68,.2)' : color === 'green' ? 'rgba(34,197,94,.2)' : color === 'amber' ? 'rgba(251,191,36,.2)' : 'rgba(61,214,195,.15)') : 'rgba(255,255,255,.05)',
    border: `1px solid ${active ? (color === 'red' ? 'rgba(239,68,68,.5)' : color === 'green' ? 'rgba(34,197,94,.5)' : color === 'amber' ? 'rgba(251,191,36,.5)' : 'rgba(61,214,195,.4)') : 'rgba(255,255,255,.1)'}`,
    color: active ? (color === 'red' ? '#fca5a5' : color === 'green' ? '#86efac' : color === 'amber' ? '#fde68a' : '#6ee7f9') : '#64748b',
    borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700,
    fontSize: 12, transition: 'all .15s',
  });

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">📊 Survey Reports</div>
          <div className="adv-sub">All advisor submitted reviews</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Advisor Calendar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 32px' }}>

        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b', fontSize: 15 }}>
            Loading reviews from all advisors…
          </div>
        ) : allReviews.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
            <div style={{ color: '#64748b', fontSize: 16 }}>No submitted reviews yet.</div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>Advisors submit reviews from the Complete Review tab on their calendar.</div>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Reviews', value: allReviews.length, color: '#6ee7f9', bg: 'rgba(61,214,195,.1)', border: 'rgba(61,214,195,.25)' },
                { label: 'Advisors Reporting', value: new Set(allReviews.map(r => r.advisorName)).size, color: '#c4b5fd', bg: 'rgba(167,139,250,.1)', border: 'rgba(167,139,250,.25)' },
                { label: 'Customer Satisfied', value: allReviews.filter(r => r.satisfied === 'yes').length, color: '#86efac', bg: 'rgba(34,197,94,.1)', border: 'rgba(34,197,94,.25)' },
                { label: 'Not Satisfied', value: allReviews.filter(r => r.satisfied === 'no').length, color: '#fca5a5', bg: 'rgba(239,68,68,.1)', border: 'rgba(239,68,68,.25)' },
                { label: 'Voicemail', value: allReviews.filter(r => r.contacted === 'voicemail').length, color: '#fde68a', bg: 'rgba(251,191,36,.1)', border: 'rgba(251,191,36,.25)' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '16px 24px', minWidth: 120, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Advisor filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>ADVISOR:</span>
                <select
                  value={filterAdvisor}
                  onChange={e => setFilterAdvisor(e.target.value)}
                  style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.15)', color: '#e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
                >
                  {advisorOptions.map(a => <option key={a} value={a}>{a === 'ALL' ? 'All Advisors' : a}</option>)}
                </select>
              </div>

              {/* Satisfied filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>SATISFIED:</span>
                <button style={filterBtnStyle(filterSatisfied === 'ALL', 'cyan')} onClick={() => setFilterSatisfied('ALL')}>All</button>
                <button style={filterBtnStyle(filterSatisfied === 'yes', 'green')} onClick={() => setFilterSatisfied(filterSatisfied === 'yes' ? 'ALL' : 'yes')}>✓ Yes</button>
                <button style={filterBtnStyle(filterSatisfied === 'no', 'red')} onClick={() => setFilterSatisfied(filterSatisfied === 'no' ? 'ALL' : 'no')}>✗ No</button>
              </div>

              {/* Contacted filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>CONTACTED:</span>
                <button style={filterBtnStyle(filterContacted === 'ALL', 'cyan')} onClick={() => setFilterContacted('ALL')}>All</button>
                <button style={filterBtnStyle(filterContacted === 'yes', 'green')} onClick={() => setFilterContacted(filterContacted === 'yes' ? 'ALL' : 'yes')}>✓ Yes</button>
                <button style={filterBtnStyle(filterContacted === 'voicemail', 'amber')} onClick={() => setFilterContacted(filterContacted === 'voicemail' ? 'ALL' : 'voicemail')}>📞 Voicemail</button>
              </div>

              <span style={{ fontSize: 12, color: '#475569', marginLeft: 'auto' }}>
                Showing <strong style={{ color: '#e2e8f0' }}>{filtered.length}</strong> of {allReviews.length} reviews
              </span>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>No reviews match the current filters.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="adv-table" style={{ minWidth: 1000 }}>
                  <thead>
                    <tr>
                      <th>ADVISOR</th>
                      <th>CUSTOMER NAME</th>
                      <th>REPAIR ORDER</th>
                      <th>MODEL</th>
                      <th>SERVICE DATE</th>
                      <th>CONTACTED</th>
                      <th>SATISFIED</th>
                      <th>NOTES</th>
                      <th>SUBMITTED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, idx) => (
                      <tr key={idx} style={{ background: row.satisfied === 'no' ? 'rgba(239,68,68,.05)' : '' }}>
                        <td>
                          <span style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.25)', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>
                            {row.advisorName}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.customerName || '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 13, color: '#6ee7f9' }}>{row.repairOrder || '—'}</td>
                        <td style={{ color: '#cbd5e1' }}>{row.model || '—'}</td>
                        <td style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(row.serviceDate)}</td>
                        <td><Badge val={row.contacted} type="contacted" /></td>
                        <td><Badge val={row.satisfied} type="satisfied" /></td>
                        <td style={{ color: '#94a3b8', fontSize: 13, maxWidth: 200 }}>{row.notes || <span style={{ color: '#334155' }}>—</span>}</td>
                        <td style={{ color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(row.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
