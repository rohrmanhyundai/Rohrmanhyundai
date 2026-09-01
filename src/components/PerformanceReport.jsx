import React, { useState, useEffect, useRef } from 'react';
import { loadGithubFile, saveGithubFile, loadCoaching, loadDashboardData, loadUsers, recordCoachingView } from '../utils/github';
import { parseAdvisorReportHtml, advisorFieldsFromRow } from '../utils/advisorPerfReport';
import { parseAdvisorSaTotalsPdf } from '../utils/advisorSaTotalsPdf';
import { canonicalAdvisorFirst, firstNameUpper } from '../utils/advisorAliases';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${String(+y).slice(2)}`;
}

function weekOfYear(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const jan1 = new Date(y, 0, 1);
  return Math.ceil((Math.floor((date - jan1) / 86400000) + 1) / 7);
}

function pct(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

function num(val, decimals = 1) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function money(val) {
  if (val === null || val === undefined || val === '') return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The fields a re-uploaded report can revise, and how each reads on screen.
// CSI, Roh$50 Hrs/RO and Daily Avg aren't on either report, so an upload never
// touches them.
const UPLOAD_FIELDS = [
  { key: 'mtd_hours',        label: 'MTD Hrs',      fmt: v => num(v, 1) },
  { key: 'ro_count',         label: 'MTD ROs',      fmt: v => (v === null || v === undefined || v === '' ? '—' : String(v)) },
  { key: 'hours_per_ro',     label: 'Hrs/RO',       fmt: v => num(v, 2) },
  { key: 'elr',              label: 'ELR',          fmt: pct },
  { key: 'coupon_labor',     label: 'Coupon Labor', fmt: money },
  { key: 'total_sales',      label: 'Total Sales',  fmt: money },
  { key: 'coupon_usage_pct', label: 'Coupon Usage', fmt: pct },
  { key: 'align',            label: 'Alignment',    fmt: pct },
  { key: 'tires',            label: 'Tires',        fmt: pct },
  { key: 'valvoline',        label: 'Valvoline',    fmt: pct },
  { key: 'asr',              label: 'ASR',          fmt: pct },
];

function StatBox({ label, value, color = '#6ee7f9', compact = false }) {
  const pad   = compact ? '10px 10px' : '14px 18px';
  const min   = compact ? 72 : 100;
  const valFs = compact ? 18 : 22;
  return (
    <div style={{ flex: compact ? '1 1 0' : '0 0 auto', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: pad, minWidth: min, textAlign: 'center' }}>
      <div style={{ fontSize: valFs, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{label}</div>
    </div>
  );
}

function TrendIcon({ curr, prev, higher = true }) {
  if (prev === undefined || prev === null || curr === undefined || curr === null) return null;
  const a = parseFloat(curr), b = parseFloat(prev);
  if (isNaN(a) || isNaN(b) || a === b) return null;
  const up = a > b;
  const good = higher ? up : !up;
  return <span style={{ marginLeft: 4, fontSize: 11, color: good ? '#4ade80' : '#f87171' }}>{up ? '▲' : '▼'}</span>;
}

// ─────────────────────────────────────────────────────────────
// ADVISOR VIEW — daily snapshots grouped by month
// ─────────────────────────────────────────────────────────────
function AdvisorReport({ entries, username, canDelete = false, canUpload = false, onEntriesChange }) {
  // Coaching reports — same source as the tech view.
  const [coachingReports, setCoachingReports] = useState([]);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  useEffect(() => {
    if (!username) return;
    setCoachingLoading(true);
    loadCoaching(username)
      .then(d => setCoachingReports(Array.isArray(d) ? d : []))
      .finally(() => setCoachingLoading(false));
  }, [username]);
  const latestCoachingTs = coachingReports[0]?.generatedAt
    ? new Date(coachingReports[0].generatedAt).getTime()
    : 0;
  const seenKey = username ? `coachingSeen:${username}` : null;
  const [coachingSeenTs, setCoachingSeenTs] = useState(() => {
    if (!seenKey) return 0;
    return parseInt(localStorage.getItem(seenKey) || '0', 10) || 0;
  });
  useEffect(() => {
    if (!seenKey) return;
    setCoachingSeenTs(parseInt(localStorage.getItem(seenKey) || '0', 10) || 0);
  }, [seenKey]);
  const coachingUnseen = latestCoachingTs > 0 && latestCoachingTs > coachingSeenTs;
  useEffect(() => {
    if (!showCoaching || !seenKey || !latestCoachingTs) return;
    if (latestCoachingTs > coachingSeenTs) {
      localStorage.setItem(seenKey, String(latestCoachingTs));
      setCoachingSeenTs(latestCoachingTs);
    }
    // Also record the view on the server so the manager can see when the
    // recipient actually opened their report. Best-effort; errors swallowed.
    const ids = (coachingReports || []).map(r => r.id).filter(Boolean);
    if (ids.length > 0) recordCoachingView(username, ids);
  }, [showCoaching, latestCoachingTs, seenKey, coachingSeenTs, username, coachingReports]);

  // Collect unique months from entries
  const monthKeys = [...new Set(entries.map(e => e.month || e.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  const currentMonthKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  // Default to the current calendar month if we have data for it; otherwise the latest month available.
  const defaultMonth = monthKeys.includes(currentMonthKey) ? currentMonthKey : (monthKeys[0] || '');
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [showAllDays, setShowAllDays] = useState(false);

  useEffect(() => {
    if (monthKeys.length && !monthKeys.includes(selectedMonth)) setSelectedMonth(defaultMonth);
  }, [monthKeys.join(',')]);

  useEffect(() => { setShowAllDays(false); }, [selectedMonth]);

  const monthEntries = entries
    .filter(e => (e.month || e.date?.slice(0, 7)) === selectedMonth)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const latest = monthEntries[0];

  const [yr, mo] = selectedMonth ? selectedMonth.split('-') : ['', ''];
  const monthLabel = yr && mo ? `${MONTHS[parseInt(mo) - 1]} ${yr}` : selectedMonth;

  // ── Upload Report — revise a finished month, every advisor at once ────────
  // Accounting keeps posting after the last day of the month, so the snapshots
  // captured on the 31st go stale. One upload rewrites the selected month's
  // latest snapshot for EVERY advisor the report lists — not just the one whose
  // page this is — because the report covers the whole drive at once. The .html
  // carries the hours / RO / ELR / coupon figures, the SA Totals .pdf the
  // penetration %. Existing snapshots are revised in place; nobody gains a day.
  const uploadInputRef = useRef(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadPreview, setUploadPreview] = useState(null);

  useEffect(() => { setUploadPreview(null); setUploadMsg(''); }, [selectedMonth]);

  // Hrs/RO and Coupon Usage % are derived from the imported figures, never read
  // off the report — same rule the dashboard importer follows.
  function deriveUploadFields(fields) {
    const hrs = parseFloat(fields.mtd_hours), ros = parseFloat(fields.ro_count);
    if (ros > 0 && !isNaN(hrs)) fields.hours_per_ro = Math.round((hrs / ros) * 100) / 100;
    const sales = parseFloat(fields.total_sales), coupon = parseFloat(fields.coupon_labor);
    if (sales > 0 && !isNaN(coupon)) fields.coupon_usage_pct = Math.round((coupon / sales) * 10000) / 10000;
    return fields;
  }

  async function readUploadedReport(file) {
    setUploadMsg(''); setUploadPreview(null);
    if (!file || !selectedMonth) return;
    setUploadBusy(true);
    try {
      const ext = (file.name || '').toLowerCase().split('.').pop();
      // Report name -> roster first name; the roster name is already canonical.
      const byFirst = {};      // ROSTER FIRST NAME -> revised fields
      const reportName = {};   // ... -> the name as printed, for the preview
      const collapsed = [];    // rows with no Pay Type breakdown to net out
      let kind = '';

      if (ext === 'html' || ext === 'htm') {
        kind = 'html';
        const { rows } = parseAdvisorReportHtml(await file.text());
        for (const row of rows) {
          const first = canonicalAdvisorFirst(row.name);
          if (!first) continue;
          byFirst[first] = deriveUploadFields(advisorFieldsFromRow(row));
          reportName[first] = row.name;
          if (!row.detailed) collapsed.push(row.name);
        }
      } else if (ext === 'pdf') {
        kind = 'pdf';
        const parsed = await parseAdvisorSaTotalsPdf(file);
        for (const [key, val] of Object.entries(parsed)) {
          const first = canonicalAdvisorFirst(key);
          if (!first) continue;
          const { reportName: rn, ...rest } = val;
          byFirst[first] = rest;
          reportName[first] = rn || key;
        }
      } else {
        throw new Error('Unsupported file type — upload the Advisor Performance Report (.html) or the SA Totals report (.pdf).');
      }

      if (!Object.keys(byFirst).length) throw new Error('No advisor rows found in this report.');

      // Which fields this file actually carries. Without this, a column the
      // report doesn't have is indistinguishable from one that simply matched,
      // and a silently-missing Coupon Labor would look like "no change".
      const present = new Set();
      for (const f of Object.values(byFirst)) for (const k of Object.keys(f)) present.add(k);
      const expected = kind === 'pdf'
        ? ['align', 'tires', 'valvoline', 'asr']
        : ['mtd_hours', 'ro_count', 'hours_per_ro', 'elr', 'coupon_labor', 'total_sales', 'coupon_usage_pct'];
      const carried = UPLOAD_FIELDS.filter(f => expected.includes(f.key) && present.has(f.key)).map(f => f.label);
      const absent  = UPLOAD_FIELDS.filter(f => expected.includes(f.key) && !present.has(f.key)).map(f => f.label);

      // Only people on the roster as advisors get written — the report can list
      // names that aren't ours, and a first name can collide with a technician.
      setUploadMsg('⏳ Matching advisors…');
      // loadUsers() hands back { users, sharedSaveCode, ... }, not a bare array.
      const loaded = await loadUsers().catch(() => null);
      const roster = (loaded?.users || [])
        .filter(u => u.role === 'advisor' || u.role === 'lead advisor')
        .map(u => String(u.username || '').toUpperCase());

      const targets = [];   // { username, entries, date, fields, changes }
      const skipped = [];   // human-readable reasons, shown under the preview
      for (const first of Object.keys(byFirst).sort()) {
        const shown = reportName[first] || first;
        if (roster.length && !roster.includes(first)) { skipped.push(`${shown} — not an advisor on the roster`); continue; }
        setUploadMsg(`⏳ Reading ${first}'s snapshots…`);
        // The advisor whose page this is already has their file in state.
        const saved = first === firstNameUpper(username)
          ? entries
          : await loadGithubFile(`data/performance-reports/${first}.json`)
              .then(d => (Array.isArray(d) ? d : []))
              .catch(() => []);
        const inMonth = saved
          .filter(e => (e.month || (e.date || '').slice(0, 7)) === selectedMonth)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (!inMonth.length) { skipped.push(`${shown} — no ${monthLabel} snapshot to revise`); continue; }

        const target = inMonth[0];
        const fields = byFirst[first];
        // Only surface fields whose value actually moved — a revision is usually
        // a handful of numbers, and showing the unchanged ones buries them.
        const changes = UPLOAD_FIELDS
          .filter(f => fields[f.key] !== undefined && fields[f.key] !== null)
          .map(f => ({ ...f, from: target[f.key], to: fields[f.key] }))
          .filter(c => String(c.from ?? '') !== String(c.to))
          // A difference too small to see once rounded (a re-derived Coupon
          // Usage landing on 2.61% vs a stored 2.62%, say) reads as a bogus
          // "2.6% → 2.6%" row, so it isn't a revision worth showing or writing.
          .filter(c => c.fmt(c.from) !== c.fmt(c.to));
        targets.push({ username: first, entries: saved, date: target.date, fields, changes });
      }

      setUploadPreview({ fileName: file.name, kind, targets, skipped, carried, absent });
      setUploadMsg(collapsed.length
        ? `⚠️ Not expanded in this report, so Internal hours were NOT subtracted and their MTD Hrs read high: ${collapsed.join(', ')}. Re-save the page in Pay Type View with every advisor expanded.`
        : '');
    } catch (err) {
      setUploadMsg('❌ ' + (err?.message || err));
    } finally {
      setUploadBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  async function applyUpload() {
    if (!uploadPreview) return;
    setUploadBusy(true);
    const saved = [], failed = [];
    try {
      // One file per advisor, written in turn so a mid-run failure names the
      // advisor it stopped on and the rest stay untouched.
      for (const t of uploadPreview.targets) {
        if (!t.changes.length) continue;
        setUploadMsg(`⏳ Saving ${t.username}…`);
        const next = t.entries.map(e =>
          e.date === t.date && (e.month || (e.date || '').slice(0, 7)) === selectedMonth
            ? { ...e, ...t.fields, revisedAt: new Date().toISOString(), revisedFrom: uploadPreview.kind }
            : e
        );
        try {
          await saveGithubFile(
            `data/performance-reports/${t.username}.json`, next,
            `Revise ${t.date} snapshot for ${t.username} from uploaded ${uploadPreview.kind}`
          );
          saved.push(t.username);
          if (t.username === firstNameUpper(username)) onEntriesChange && onEntriesChange(next);
        } catch (err) {
          failed.push(`${t.username} (${err?.message || err})`);
        }
      }
      const parts = [];
      if (saved.length)  parts.push(`✅ Revised ${monthLabel} for ${saved.length} advisor${saved.length === 1 ? '' : 's'}: ${saved.join(', ')}`);
      if (failed.length) parts.push(`❌ Failed: ${failed.join('; ')}`);
      setUploadMsg(parts.join(' · ') || 'Nothing to revise.');
      if (!failed.length) setUploadPreview(null);
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <div>
      {/* Month selector */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Select Month</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canUpload && selectedMonth && monthEntries.length > 0 && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".html,.htm,.pdf"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files && e.target.files[0]; if (f) readUploadedReport(f); }}
              />
              <button
                onClick={() => uploadInputRef.current && uploadInputRef.current.click()}
                disabled={uploadBusy}
                style={{
                  background: 'rgba(96,165,250,.18)',
                  border: '1px solid rgba(96,165,250,.5)',
                  color: '#bfdbfe',
                  borderRadius: 8, padding: '5px 12px', fontWeight: 800, fontSize: 12,
                  cursor: uploadBusy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
                title={`Re-upload the report (.html or .pdf) to revise ${monthLabel} for EVERY advisor it lists, after accounting closes the month. You'll see what changes before anything is written.`}
              >
                {uploadBusy ? '⏳ Reading…' : '⬆ Upload Report'}
              </button>
            </>
          )}
          {canDelete && selectedMonth && (
            <button
              onClick={async () => {
                if (!username || !selectedMonth) return;
                const [y, m] = selectedMonth.split('-');
                const label = `${MONTHS[parseInt(m)-1]} ${y}`;
                const count = entries.filter(e => (e.month || (e.date || '').slice(0, 7)) === selectedMonth).length;
                if (!window.confirm(`Delete ${count} snapshot${count === 1 ? '' : 's'} for ${label}?\n\nThis permanently removes the month from ${username}'s performance history. It cannot be undone.`)) return;
                try {
                  const kept = entries.filter(e => (e.month || (e.date || '').slice(0, 7)) !== selectedMonth);
                  await saveGithubFile(`data/performance-reports/${username}.json`, kept, `Delete ${selectedMonth} for ${username}`);
                  onEntriesChange && onEntriesChange(kept);
                } catch (err) {
                  alert('Delete failed: ' + (err?.message || err));
                }
              }}
              style={{
                background: 'rgba(239,68,68,.18)',
                border: '1px solid rgba(239,68,68,.5)',
                color: '#f87171',
                borderRadius: 8, padding: '5px 12px', fontWeight: 800, fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
              title="Permanently delete every snapshot in the selected month"
            >
              🗑 Delete {(() => { const [y, m] = selectedMonth.split('-'); return `${MONTHS[parseInt(m)-1].slice(0,3)} ${y}`; })()}
            </button>
          )}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {monthKeys.map(mk => {
            const [y, m] = mk.split('-');
            const lbl = `${MONTHS[parseInt(m)-1].slice(0,3)} ${y}`;
            return (
              <button key={mk} onClick={() => setSelectedMonth(mk)} style={{
                background: selectedMonth === mk ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
                border: `1px solid ${selectedMonth === mk ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
                color: selectedMonth === mk ? '#6ee7f9' : '#64748b',
                borderRadius: 8, padding: '5px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}>{lbl}</button>
            );
          })}
        </div>

        {/* Upload preview — nothing is written until the changes are confirmed. */}
        {(uploadMsg || uploadPreview) && (
          <div style={{ marginTop: 12, background: 'rgba(96,165,250,.07)', border: '1px solid rgba(96,165,250,.28)', borderRadius: 12, padding: '12px 16px' }}>
            {uploadMsg && (
              <div style={{
                fontSize: 12, fontWeight: 700, lineHeight: 1.5, marginBottom: uploadPreview ? 10 : 0,
                color: uploadMsg.startsWith('❌') ? '#f87171' : uploadMsg.startsWith('⚠️') ? '#fbbf24' : '#4ade80',
              }}>{uploadMsg}</div>
            )}
            {uploadPreview && (() => {
              const targets = uploadPreview.targets || [];
              const changed = targets.filter(t => t.changes.length > 0);
              const unchanged = targets.filter(t => t.changes.length === 0).map(t => t.username);
              const total = changed.reduce((n, t) => n + t.changes.length, 0);
              return (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#bfdbfe', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 6 }}>
                  {uploadPreview.fileName} → {monthLabel}, all advisors
                </div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
                  Read from this file: {(uploadPreview.carried || []).join(', ') || 'nothing'}
                  {(uploadPreview.absent || []).length > 0 && (
                    <span style={{ color: '#fbbf24' }}> · No column for {uploadPreview.absent.join(', ')} — left untouched</span>
                  )}
                </div>

                {changed.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 12 }}>
                    Every number this report carries already matches the saved snapshots — nothing to revise.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
                    {changed.map(t => (
                      <div key={t.username}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0', marginBottom: 4 }}>
                          {t.username}
                          <span style={{ marginLeft: 8, fontWeight: 600, color: '#64748b' }}>{fmtDate(t.date)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 10, borderLeft: '2px solid rgba(96,165,250,.25)' }}>
                          {t.changes.map(c => (
                            <div key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                              <span style={{ minWidth: 104, color: '#64748b', fontWeight: 700 }}>{c.label}</span>
                              <span style={{ color: '#64748b', textDecoration: 'line-through' }}>{c.fmt(c.from)}</span>
                              <span style={{ color: '#475569' }}>→</span>
                              <span style={{ color: '#6ee7f9', fontWeight: 800 }}>{c.fmt(c.to)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {unchanged.length > 0 && (
                  <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 8 }}>
                    Already matching, nothing written: {unchanged.join(', ')}
                  </div>
                )}
                {(uploadPreview.skipped || []).length > 0 && (
                  <div style={{ fontSize: 11.5, color: '#fbbf24', marginBottom: 10, lineHeight: 1.5 }}>
                    Skipped — {uploadPreview.skipped.join(' · ')}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={applyUpload}
                    disabled={uploadBusy || changed.length === 0}
                    style={{
                      background: changed.length === 0 ? 'rgba(255,255,255,.04)' : 'rgba(61,214,195,.2)',
                      border: `1px solid ${changed.length === 0 ? 'rgba(255,255,255,.1)' : 'rgba(61,214,195,.5)'}`,
                      color: changed.length === 0 ? '#475569' : '#6ee7f9',
                      borderRadius: 8, padding: '6px 16px', fontWeight: 800, fontSize: 12.5,
                      cursor: (uploadBusy || changed.length === 0) ? 'not-allowed' : 'pointer',
                    }}
                  >{uploadBusy ? '⏳ Saving…' : `Apply ${total} change${total === 1 ? '' : 's'} to ${changed.length} advisor${changed.length === 1 ? '' : 's'}`}</button>
                  <button
                    onClick={() => { setUploadPreview(null); setUploadMsg(''); }}
                    disabled={uploadBusy}
                    style={{
                      background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)',
                      color: '#94a3b8', borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: 12.5,
                      cursor: uploadBusy ? 'not-allowed' : 'pointer',
                    }}
                  >Cancel</button>
                </div>
              </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Coaching Report toggle — sits up top so the advisor sees it immediately */}
      <div style={{ display: 'flex', gap: 10, marginBottom: showCoaching ? 12 : 20, flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowCoaching(s => !s)}
          className={coachingUnseen ? 'coaching-glow' : ''}
          style={{
            background: coachingUnseen
              ? 'rgba(168,85,247,.28)'
              : showCoaching ? 'rgba(168,85,247,.18)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${coachingUnseen ? 'rgba(168,85,247,.85)' : showCoaching ? 'rgba(168,85,247,.4)' : 'rgba(255,255,255,.1)'}`,
            color: coachingUnseen ? '#e9d5ff' : showCoaching ? '#c4b5fd' : '#94a3b8',
            borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: 1,
            position: 'relative',
          }}
        >
          <span>{showCoaching ? '▼' : '▶'}</span>
          <span>🎯 Coaching Report {coachingReports.length > 0 && `(${coachingReports.length})`}</span>
          {coachingUnseen && (
            <span style={{
              fontSize: 9, fontWeight: 900, color: '#fff',
              background: '#a855f7', borderRadius: 999,
              padding: '2px 8px', letterSpacing: .5,
              boxShadow: '0 0 12px rgba(168,85,247,.85)',
            }}>NEW</span>
          )}
        </button>
      </div>

      {showCoaching && (
        <div style={{ background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.2)', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
          {coachingLoading ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>⏳ Loading coaching reports…</div>
          ) : coachingReports.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>
              No coaching reports yet. Your manager will generate one soon.
            </div>
          ) : (
            coachingReports.map((r, i) => (
              <div key={r.id || i} style={{ marginBottom: i < coachingReports.length - 1 ? 24 : 0, paddingBottom: i < coachingReports.length - 1 ? 24 : 0, borderBottom: i < coachingReports.length - 1 ? '1px solid rgba(168,85,247,.18)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {r.weekLabel || (r.weekStart && r.weekEnd ? `Week of ${r.weekStart} – ${r.weekEnd}` : 'Latest report')}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Generated {new Date(r.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <CoachingReportBody text={r.report} />
              </div>
            ))
          )}
        </div>
      )}

      {!selectedMonth || monthEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>No entries for this month.</div>
      ) : (
        <>
          {/* Month summary — latest snapshot */}
          <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.1),rgba(110,231,249,.06))', border: '1px solid rgba(61,214,195,.25)', borderRadius: 16, padding: '18px 22px', marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              📌 {monthLabel} — Latest ({fmtDate(latest?.date)})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {(() => {
                const RED = '#f87171';
                const ok = (v, goal) => v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) >= goal;
                const c = (v, goal, base) => ok(v, goal) ? base : RED;
                return <>
                  <StatBox label="CSI · Goal 910"             value={latest?.csi || '—'}            color={c(latest?.csi, 910, '#4ade80')} />
                  <StatBox label="Hrs/RO · Goal 1.4"          value={num(latest?.hours_per_ro, 2)}  color={c(latest?.hours_per_ro, 1.4, '#6ee7f9')} />
                  <StatBox label="Roh$50 Hrs/RO · Goal 1.2"   value={num(latest?.roh50_hrs_ro, 2)}  color={c(latest?.roh50_hrs_ro, 1.2, '#6ee7f9')} />
                  <StatBox label="MTD Hrs · Goal 300"         value={num(latest?.mtd_hours, 1)}     color={c(latest?.mtd_hours, 300, '#6ee7f9')} />
                  <StatBox label="Daily Avg"                  value={num(latest?.daily_avg, 2)}     color="#c4b5fd" />
                  <StatBox label="Alignment · Goal 10%"       value={pct(latest?.align)}            color={c(latest?.align, 0.10, '#fbbf24')} />
                  <StatBox label="Tires · Goal 15%"           value={pct(latest?.tires)}            color={c(latest?.tires, 0.15, '#fbbf24')} />
                  <StatBox label="Valvoline · Goal 25%"       value={pct(latest?.valvoline)}        color={c(latest?.valvoline, 0.25, '#fbbf24')} />
                  <StatBox label="ASR · Goal 21%"             value={pct(latest?.asr)}              color={c(latest?.asr, 0.21, '#fdba74')} />
                  <StatBox label="ELR · Goal 88%"             value={pct(latest?.elr)}              color={c(latest?.elr, 0.88, '#fdba74')} />
                  <StatBox label="Coupon Usage · Target 5-7%" value={pct(latest?.coupon_usage_pct)} color="#fbbf24" />
                </>;
              })()}
            </div>
          </div>

          {/* Daily breakdown table */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>
              Daily Breakdown — {monthEntries.length} snapshot{monthEntries.length !== 1 ? 's' : ''} this month
            </div>
            {monthEntries.length > 1 && (
              <button onClick={() => setShowAllDays(s => !s)} style={{
                background: showAllDays ? 'rgba(61,214,195,.18)' : 'rgba(61,214,195,.08)',
                border: '1px solid rgba(61,214,195,.35)',
                color: '#3dd6c3', borderRadius: 8, padding: '6px 14px',
                fontWeight: 800, fontSize: 12, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: .5,
              }}>
                {showAllDays ? '▲ Show Latest Only' : `▼ Show All ${monthEntries.length} Days`}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="adv-table" style={{ minWidth: 1200, tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>DATE</th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>CSI<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 910</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>HRS/RO<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 1.4</span></th>
                  <th style={{ minWidth: 110 }}>ROH$50<br />HRS/RO<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 1.2</span></th>
                  <th style={{ minWidth: 100, whiteSpace: 'nowrap' }}>MTD HRS<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 300</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>DAILY AVG</th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>ALIGNMENT<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 10%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>TIRES<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 15%</span></th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>VALVOLINE<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 25%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>ASR<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 21%</span></th>
                  <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>ELR<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Goal 88%</span></th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>COUPON<br />USAGE<br /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>Target 5-7%</span></th>
                </tr>
              </thead>
              <tbody>
                {(showAllDays ? monthEntries : monthEntries.slice(0, 1)).map((e, i) => {
                  const prev = monthEntries[i + 1];
                  return (
                    <tr key={i} style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                      <td style={{ whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip', color: '#94a3b8', fontWeight: i === 0 ? 700 : 400, minWidth: 110 }}>
                        {fmtShort(e.date)}
                        {i === 0 && <div style={{ fontSize: 9, color: '#3dd6c3', fontWeight: 800, marginTop: 2 }}>LATEST</div>}
                      </td>
                      <td style={{ color: '#4ade80', fontWeight: 700 }}>
                        {e.csi || '—'}<TrendIcon curr={e.csi} prev={prev?.csi} />
                      </td>
                      <td>{num(e.hours_per_ro, 2)}<TrendIcon curr={e.hours_per_ro} prev={prev?.hours_per_ro} /></td>
                      <td>{num(e.roh50_hrs_ro, 2)}<TrendIcon curr={e.roh50_hrs_ro} prev={prev?.roh50_hrs_ro} /></td>
                      <td style={{ color: '#6ee7f9' }}>{num(e.mtd_hours, 1)}<TrendIcon curr={e.mtd_hours} prev={prev?.mtd_hours} /></td>
                      <td>{num(e.daily_avg, 2)}<TrendIcon curr={e.daily_avg} prev={prev?.daily_avg} /></td>
                      <td>{pct(e.align)}<TrendIcon curr={e.align} prev={prev?.align} /></td>
                      <td>{pct(e.tires)}<TrendIcon curr={e.tires} prev={prev?.tires} /></td>
                      <td>{pct(e.valvoline)}<TrendIcon curr={e.valvoline} prev={prev?.valvoline} /></td>
                      <td>{pct(e.asr)}<TrendIcon curr={e.asr} prev={prev?.asr} /></td>
                      <td>{pct(e.elr)}<TrendIcon curr={e.elr} prev={prev?.elr} /></td>
                      <td style={{ color: '#fbbf24' }}>
                        {pct(e.coupon_usage_pct)}
                        <TrendIcon curr={e.coupon_usage_pct} prev={prev?.coupon_usage_pct} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Trending report */}
          <TrendingReport entries={entries} selectedMonth={selectedMonth} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TRENDING REPORT — daily / weekly / month-over-month
// ─────────────────────────────────────────────────────────────
const TREND_METRICS = [
  { key: 'csi',          label: 'CSI',           fmt: v => Math.round(v).toString(),    fmtDelta: d => Math.abs(Math.round(d)).toString(),         goal: 910,  isPct: false },
  { key: 'hours_per_ro', label: 'Hrs/RO',        fmt: v => v.toFixed(2),                fmtDelta: d => Math.abs(d).toFixed(2),                     goal: 1.4,  isPct: false },
  { key: 'roh50_hrs_ro', label: 'Roh$50 Hrs/RO', fmt: v => v.toFixed(2),                fmtDelta: d => Math.abs(d).toFixed(2),                     goal: 1.2,  isPct: false },
  { key: 'mtd_hours',    label: 'MTD Hrs',       fmt: v => v.toFixed(1),                fmtDelta: d => Math.abs(d).toFixed(1),                     goal: 300,  isPct: false },
  { key: 'daily_avg',    label: 'Daily Avg',     fmt: v => v.toFixed(2),                fmtDelta: d => Math.abs(d).toFixed(2),                     goal: null, isPct: false },
  { key: 'align',        label: 'Alignment',     fmt: v => (v * 100).toFixed(1) + '%',  fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts',    goal: 0.10, isPct: true  },
  { key: 'tires',        label: 'Tires',         fmt: v => (v * 100).toFixed(1) + '%',  fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts',    goal: 0.15, isPct: true  },
  { key: 'valvoline',    label: 'Valvoline',     fmt: v => (v * 100).toFixed(1) + '%',  fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts',    goal: 0.25, isPct: true  },
  { key: 'asr',          label: 'ASR',           fmt: v => (v * 100).toFixed(1) + '%',  fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts',    goal: 0.21, isPct: true  },
  { key: 'elr',          label: 'ELR',           fmt: v => (v * 100).toFixed(1) + '%',  fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts',    goal: 0.88, isPct: true  },
  { key: 'coupon_usage_pct', label: 'Coupon Usage', fmt: v => (v * 100).toFixed(1) + '%', fmtDelta: d => (Math.abs(d) * 100).toFixed(1) + ' pts', goal: null, isPct: true },
];

function avgOf(entries, key) {
  const vals = entries.map(e => parseFloat(e[key])).filter(v => !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// Coupon figures (coupon_labor / total_sales / coupon_usage_pct) are
// month-to-date cumulative and RESET at the start of each month. Averaging
// daily snapshots would drag in pre-reset / prior-month values, so for these
// we want the LATEST snapshot within the period instead of an average.
// `entries` is expected to be sorted newest-first, so the first valid value
// for the key is the most recent one.
const COUPON_KEYS = new Set(['coupon_usage_pct', 'coupon_labor', 'total_sales']);
function latestOf(entries, key) {
  for (const e of entries) {
    const v = parseFloat(e[key]);
    if (!isNaN(v)) return v;
  }
  return null;
}
// Use latest-in-period for monthly-reset coupon metrics, average for the rest.
function periodVal(entries, key) {
  return COUPON_KEYS.has(key) ? latestOf(entries, key) : avgOf(entries, key);
}

// One horizontal row per metric: direction icon · label · big value · delta %.
// Designed to be scannable at a glance — color tells the story.
function TrendRow({ curr, prev, metric, sub, extra }) {
  const empty = curr === null || curr === undefined || isNaN(curr);

  let dir = null, pctChange = null;
  if (!empty && prev !== null && prev !== undefined && !isNaN(prev)) {
    const diff = curr - prev;
    if (Math.abs(diff) > 1e-9) {
      dir = diff > 0 ? 'up' : 'down';
      if (Math.abs(prev) > 1e-9) pctChange = (diff / prev) * 100;
    }
  }

  // Direction styling — green for improving, red for worsening, gray for flat.
  const dirColor = dir === 'up' ? '#4ade80' : dir === 'down' ? '#f87171' : '#64748b';
  const dirBg    = dir === 'up' ? 'rgba(74,222,128,.14)' : dir === 'down' ? 'rgba(248,113,113,.14)' : 'rgba(100,116,139,.12)';
  const arrow    = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '–';

  // Value color — neutral unless the goal exists AND is missed (kept subtle so it doesn't overpower direction).
  const missGoal = !empty && metric.goal !== null && curr < metric.goal;
  const valColor = empty ? '#475569' : missGoal ? '#fda4af' : '#f1f5f9';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px',
      borderRadius: 10,
      background: dir ? dirBg : 'rgba(255,255,255,.02)',
      borderLeft: `3px solid ${dir ? dirColor : 'rgba(148,163,184,.25)'}`,
    }}>
      {/* Direction badge */}
      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: dir ? `${dirColor}26` : 'rgba(100,116,139,.15)',
        color: dirColor, fontWeight: 900, fontSize: 15, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{arrow}</div>

      {/* Label + tiny "vs prev" */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1', letterSpacing: .4, textTransform: 'uppercase' }}>{metric.label}</div>
        {sub && (
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, letterSpacing: .4, textTransform: 'uppercase' }}>{sub}</div>
        )}
        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>
          {empty ? 'no data' : dir ? `vs ${metric.fmt(prev)}` : 'unchanged'}
        </div>
      </div>

      {/* Big current value */}
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: 19, color: valColor, lineHeight: 1, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>
          {empty ? '—' : metric.fmt(curr)}
        </div>
        {extra && (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap' }}>{extra}</div>
        )}
        {dir && pctChange !== null && (
          <div style={{ fontSize: 10, fontWeight: 800, color: dirColor, marginTop: 2, whiteSpace: 'nowrap' }}>
            {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%
          </div>
        )}
        {dir && pctChange === null && (
          <div style={{ fontSize: 10, fontWeight: 800, color: dirColor, marginTop: 2, whiteSpace: 'nowrap' }}>
            {arrow} new
          </div>
        )}
      </div>
    </div>
  );
}

function TrendingReport({ entries, selectedMonth }) {
  if (!entries || entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Daily: latest vs day-before
  const dToday = sorted[0] || null;
  const dPrev  = sorted[1] || null;

  // Weekly: most-recent 7 entries vs the 7 before
  const thisWeek = sorted.slice(0, 7);
  const lastWeek = sorted.slice(7, 14);

  // Monthly: selected month avg vs previous month avg
  const inMonth = (e, mk) => (e.month || (e.date || '').slice(0, 7)) === mk;
  const allMonthKeys = [...new Set(sorted.map(e => e.month || (e.date || '').slice(0, 7)))].sort().reverse();
  const curIdx       = allMonthKeys.indexOf(selectedMonth);
  const prevMonthKey = curIdx >= 0 ? allMonthKeys[curIdx + 1] : null;
  const thisMonthEntries = sorted.filter(e => inMonth(e, selectedMonth));
  const prevMonthEntries = prevMonthKey ? sorted.filter(e => inMonth(e, prevMonthKey)) : [];

  const dailyAvail   = !!dToday;
  const weeklyAvail  = thisWeek.length > 0;
  const monthlyAvail = thisMonthEntries.length > 0;

  const labelMonth = (mk) => {
    if (!mk) return '—';
    const [y, m] = mk.split('-');
    return `${MONTHS[parseInt(m)-1].slice(0,3)} ${y}`;
  };

  const renderCard = ({ accent, icon, title, sub, available, getCurr, getPrev, getExtra }) => {
    // Pre-compute direction tallies so the card header can show a quick
    // "wins vs losses" summary the advisor can read at a glance.
    let ups = 0, downs = 0, flats = 0;
    if (available) {
      for (const m of TREND_METRICS) {
        const c = getCurr(m), p = getPrev(m);
        if (c === null || c === undefined || isNaN(c) || p === null || p === undefined || isNaN(p)) continue;
        const d = c - p;
        if (Math.abs(d) < 1e-9) flats++;
        else if (d > 0) ups++;
        else downs++;
      }
    }
    const trendVerdict = ups > downs ? 'up' : downs > ups ? 'down' : 'flat';
    const verdictColor = trendVerdict === 'up' ? '#4ade80' : trendVerdict === 'down' ? '#f87171' : '#94a3b8';

    return (
      <div style={{
        flex: 1, minWidth: 300,
        background: `linear-gradient(160deg, rgba(15,23,42,.92), rgba(15,23,42,.7))`,
        border: `1px solid ${accent}33`,
        borderRadius: 18,
        boxShadow: `0 4px 24px ${accent}1f, inset 0 1px 0 rgba(255,255,255,.04)`,
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${accent}, ${accent}55, transparent)` }} />
        <div style={{ padding: '16px 16px 18px' }}>
          {/* Card title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: `${accent}1f`, border: `1px solid ${accent}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
              }}>{icon}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#e2e8f0', letterSpacing: .3 }}>{title}</div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{sub}</div>
              </div>
            </div>
            {available && (ups + downs + flats) > 0 && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
                padding: '4px 10px', borderRadius: 10,
                background: `${verdictColor}1a`, border: `1px solid ${verdictColor}55`,
              }}>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase' }}>Trend</div>
                <div style={{ fontSize: 12, fontWeight: 900, color: verdictColor, lineHeight: 1 }}>
                  {ups}↑ &nbsp;{downs}↓
                </div>
              </div>
            )}
          </div>

          {/* Metric rows */}
          {available ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
              {TREND_METRICS.map(m => {
                // Coupon Usage gets two extras: a small target band under the
                // label, and the underlying $ Coupon Labor next to the value.
                let rowSub, rowExtra;
                if (m.key === 'coupon_usage_pct') {
                  rowSub = 'Target 5–7%';
                  const ex = getExtra ? getExtra(m) : null;
                  if (ex != null && !isNaN(ex)) {
                    rowExtra = '$' + Number(ex).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' labor';
                  }
                }
                return (
                  <TrendRow key={m.key} curr={getCurr(m)} prev={getPrev(m)} metric={m} sub={rowSub} extra={rowExtra} />
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
              No data yet — fills in as snapshots accumulate.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(61,214,195,.25), rgba(110,231,249,.15))',
          border: '1px solid rgba(61,214,195,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        }}>📈</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#e2e8f0', letterSpacing: .3 }}>Trending Report</div>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>How you're trending across periods</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {renderCard({
          accent: '#3dd6c3', icon: '⚡', title: 'Daily',
          sub: `${dToday ? fmtDate(dToday.date) : '—'}  vs  ${dPrev ? fmtDate(dPrev.date) : '—'}`,
          available: dailyAvail,
          getCurr: m => dToday ? parseFloat(dToday[m.key]) : null,
          getPrev: m => dPrev ? parseFloat(dPrev[m.key]) : null,
          getExtra: m => m.key === 'coupon_usage_pct' && dToday ? parseFloat(dToday.coupon_labor) : null,
        })}
        {renderCard({
          accent: '#a78bfa', icon: '📅', title: 'Weekly Average',
          sub: `Last ${thisWeek.length} day${thisWeek.length !== 1 ? 's' : ''}  vs  prior ${lastWeek.length} day${lastWeek.length !== 1 ? 's' : ''}`,
          available: weeklyAvail,
          getCurr: m => periodVal(thisWeek, m.key),
          getPrev: m => periodVal(lastWeek, m.key),
          getExtra: m => m.key === 'coupon_usage_pct' ? latestOf(thisWeek, 'coupon_labor') : null,
        })}
        {renderCard({
          accent: '#fbbf24', icon: '🗓', title: 'Month-Over-Month',
          sub: `${labelMonth(selectedMonth)} (${thisMonthEntries.length})  vs  ${labelMonth(prevMonthKey)} (${prevMonthEntries.length})`,
          available: monthlyAvail,
          getCurr: m => periodVal(thisMonthEntries, m.key),
          getPrev: m => periodVal(prevMonthEntries, m.key),
          getExtra: m => m.key === 'coupon_usage_pct' ? latestOf(thisMonthEntries, 'coupon_labor') : null,
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EFFICIENCY GAUGE SVG
// ─────────────────────────────────────────────────────────────
function EfficiencyGauge({ label, pct, sub, accentA, accentB }) {
  const noData   = isNaN(pct) || pct === null || pct === undefined;
  const p        = Math.max(0, Math.min(1.2, noData ? 0 : pct));
  const angle    = Math.PI * (1 - p / 1.2);
  const nx       = 110 + 72 * Math.cos(angle);
  const ny       = 100 - 72 * Math.sin(angle);
  const needleColor = noData ? '#334155' : p >= 1 ? '#4ade80' : p >= 0.8 ? '#fbbf24' : '#f87171';
  const glowColor   = noData ? 'transparent' : p >= 1 ? 'rgba(74,222,128,.35)' : p >= 0.8 ? 'rgba(251,191,36,.35)' : 'rgba(248,113,113,.35)';
  const total    = Math.PI * 78;
  const prog     = total * (p / 1.2);
  const pctLabel = noData ? '—' : (pct * 100).toFixed(1) + '%';
  const gid      = `gg-${label.replace(/\s+/g,'')}`;

  // Tick marks at 0, 25, 50, 75, 100, 120%
  const ticks = [0, 0.25, 0.5, 0.75, 1.0, 1.2].map(v => {
    const a = Math.PI * (1 - v / 1.2);
    const r1 = 85, r2 = 92;
    return {
      x1: 110 + r1 * Math.cos(a), y1: 100 - r1 * Math.sin(a),
      x2: 110 + r2 * Math.cos(a), y2: 100 - r2 * Math.sin(a),
      label: (v * 100) + '%',
      lx: 110 + 104 * Math.cos(a), ly: 100 - 104 * Math.sin(a),
    };
  });

  return (
    <div style={{
      flex: 1, minWidth: 200,
      background: `linear-gradient(145deg, rgba(15,23,42,0.95), rgba(15,23,42,0.8))`,
      border: `1px solid ${accentA}33`,
      borderRadius: 20,
      padding: '20px 16px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      boxShadow: `0 0 32px ${accentA}18, inset 0 1px 0 rgba(255,255,255,.06)`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow blob */}
      <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', width: 160, height: 160, borderRadius: '50%', background: `radial-gradient(circle, ${accentA}18 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ fontSize: 10, fontWeight: 800, color: accentA, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10, zIndex: 1 }}>{label}</div>

      <svg viewBox="0 -14 220 134" style={{ width: '100%', maxWidth: 220, zIndex: 1 }}>
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={accentA} />
            <stop offset="100%" stopColor={accentB} />
          </linearGradient>
          <filter id={`glow-${gid}`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id={`nglow-${gid}`}>
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Track background */}
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="16" strokeLinecap="round" />
        {/* Inner shadow track */}
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(0,0,0,.4)" strokeWidth="18" strokeLinecap="round" />
        <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="14" strokeLinecap="round" />

        {/* Progress arc */}
        {!noData && (
          <>
            <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke={`url(#${gid})`} strokeWidth="14" strokeLinecap="round"
              strokeDasharray={`${prog} ${total}`} filter={`url(#glow-${gid})`} opacity="0.5" />
            <path d="M 32 100 A 78 78 0 0 1 188 100" fill="none" stroke={`url(#${gid})`} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${prog} ${total}`} />
          </>
        )}

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="rgba(255,255,255,.2)" strokeWidth={i === 4 ? 2 : 1} />
            <text x={t.lx} y={t.ly + 3} fill="rgba(255,255,255,.25)" fontSize="8" textAnchor="middle">{t.label}</text>
          </g>
        ))}

        {/* Needle glow */}
        {!noData && <line x1="110" y1="100" x2={nx} y2={ny} stroke={glowColor} strokeWidth="12" strokeLinecap="round" />}
        {/* Needle */}
        <line x1="110" y1="100" x2={nx} y2={ny} stroke={needleColor} strokeWidth="4" strokeLinecap="round" filter={!noData ? `url(#nglow-${gid})` : undefined} />
        {/* Hub */}
        <circle cx="110" cy="100" r="10" fill="#0f172a" stroke={noData ? '#334155' : accentA} strokeWidth="2" />
        <circle cx="110" cy="100" r="5" fill={needleColor} />
      </svg>

      {/* Big number */}
      <div style={{ fontSize: 32, fontWeight: 900, color: noData ? '#334155' : needleColor, marginTop: -4, lineHeight: 1,
        textShadow: noData ? 'none' : `0 0 20px ${glowColor}` }}>
        {pctLabel}
      </div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 6, textAlign: 'center', lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TECH VIEW — weekly snapshots (Sat–Fri)
// ─────────────────────────────────────────────────────────────
// Render a coaching report (## sections, bullets, bold) as a colorful styled UI
export function CoachingReportBody({ text }) {
  if (!text) return null;
  const sections = [];
  let current = { title: '', body: [] };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current.title || current.body.length) sections.push(current);
      current = { title: m[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.title || current.body.length) sections.push(current);

  // Style per section title
  const themeFor = (title) => {
    const t = title.toLowerCase();
    if (t.includes('summary'))            return { emoji: '🌟', color: '#6ee7f9', bg: 'rgba(110,231,249,.08)',  border: 'rgba(110,231,249,.3)'  };
    if (t.includes("what's working") || t.includes('strengths')) return { emoji: '✅', color: '#4ade80', bg: 'rgba(74,222,128,.08)',   border: 'rgba(74,222,128,.3)'   };
    if (t.includes('focus') || t.includes('improve')) return { emoji: '🎯', color: '#fbbf24', bg: 'rgba(251,191,36,.08)',  border: 'rgba(251,191,36,.3)'  };
    if (t.includes('action'))             return { emoji: '🚀', color: '#f472b6', bg: 'rgba(244,114,182,.08)', border: 'rgba(244,114,182,.3)' };
    if (t.includes('wip') || t.includes('watch')) return { emoji: '🔧', color: '#60a5fa', bg: 'rgba(96,165,250,.08)',  border: 'rgba(96,165,250,.3)'  };
    return { emoji: '💡', color: '#c4b5fd', bg: 'rgba(196,181,253,.08)', border: 'rgba(196,181,253,.3)' };
  };

  // Render bold inline (**foo**) → <strong>; rest as plain text
  const renderInline = (s, theme) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={i} style={{ color: theme.color, fontWeight: 800 }}>{p.slice(2, -2)}</strong>;
      }
      return <span key={i}>{p}</span>;
    });
  };

  const renderBody = (lines, theme) => {
    const out = [];
    let buf = [];
    const flushPara = () => {
      if (!buf.length) return;
      out.push(<p key={`p${out.length}`} style={{ margin: '6px 0', color: '#cbd5e1', lineHeight: 1.6 }}>{renderInline(buf.join(' '), theme)}</p>);
      buf = [];
    };
    let listType = null; // 'ul' | 'ol'
    let listItems = [];
    const flushList = () => {
      if (!listItems.length) return;
      const Tag = listType === 'ol' ? 'ol' : 'ul';
      out.push(
        <Tag key={`l${out.length}`} style={{ margin: '6px 0 6px 4px', paddingLeft: 22, color: '#cbd5e1', lineHeight: 1.65 }}>
          {listItems.map((it, i) => (
            <li key={i} style={{ marginBottom: 4, paddingLeft: 4 }}>{renderInline(it, theme)}</li>
          ))}
        </Tag>
      );
      listItems = [];
      listType = null;
    };

    for (const line of lines) {
      const t = line.trim();
      if (!t) { flushPara(); flushList(); continue; }
      const ul = t.match(/^[-•]\s+(.*)$/);
      const ol = t.match(/^(\d+)\.\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listType !== 'ul') flushList();
        listType = 'ul';
        listItems.push(ul[1]);
      } else if (ol) {
        flushPara();
        if (listType !== 'ol') flushList();
        listType = 'ol';
        listItems.push(ol[2]);
      } else {
        flushList();
        buf.push(t);
      }
    }
    flushPara();
    flushList();
    return out;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sections.map((s, i) => {
        const th = themeFor(s.title);
        return (
          <div key={i} style={{
            background: th.bg, border: `1px solid ${th.border}`, borderLeft: `4px solid ${th.color}`,
            borderRadius: 12, padding: '14px 18px',
          }}>
            <div style={{
              fontWeight: 900, fontSize: 13, color: th.color,
              textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 18 }}>{th.emoji}</span>
              <span>{s.title}</span>
            </div>
            <div style={{ fontSize: 13.5 }}>
              {renderBody(s.body, th)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TechReport({ entries, username }) {
  // Group by year for filter
  const years = [...new Set(entries.map(e => e.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const [selectedYear, setSelectedYear] = useState(years[0] || String(new Date().getFullYear()));
  const [showHistory, setShowHistory] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [coachingReports, setCoachingReports] = useState([]);
  const [coachingLoading, setCoachingLoading] = useState(false);
  useEffect(() => {
    if (!username) return;
    setCoachingLoading(true);
    loadCoaching(username)
      .then(d => setCoachingReports(Array.isArray(d) ? d : []))
      .finally(() => setCoachingLoading(false));
  }, [username]);

  // Has there been a coaching report generated since this user last viewed
  // the section? If so, glow the toggle button to draw attention.
  const latestCoachingTs = coachingReports[0]?.generatedAt
    ? new Date(coachingReports[0].generatedAt).getTime()
    : 0;
  const seenKey = username ? `coachingSeen:${username}` : null;
  const [coachingSeenTs, setCoachingSeenTs] = useState(() => {
    if (!seenKey) return 0;
    return parseInt(localStorage.getItem(seenKey) || '0', 10) || 0;
  });
  useEffect(() => {
    if (!seenKey) return;
    setCoachingSeenTs(parseInt(localStorage.getItem(seenKey) || '0', 10) || 0);
  }, [seenKey]);
  const coachingUnseen = latestCoachingTs > 0 && latestCoachingTs > coachingSeenTs;
  // Mark seen when the user opens the section.
  useEffect(() => {
    if (!showCoaching || !seenKey || !latestCoachingTs) return;
    if (latestCoachingTs > coachingSeenTs) {
      localStorage.setItem(seenKey, String(latestCoachingTs));
      setCoachingSeenTs(latestCoachingTs);
    }
    const ids = (coachingReports || []).map(r => r.id).filter(Boolean);
    if (ids.length > 0) recordCoachingView(username, ids);
  }, [showCoaching, latestCoachingTs, seenKey, coachingSeenTs, username, coachingReports]);

  const filtered = entries
    .filter(e => e.date?.startsWith(selectedYear))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const latest = filtered[0];

  // ── Efficiency gauge calculations ──────────────────────────
  const allSorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Derive goal % live from total ÷ goal so it always matches the TOTAL HRS
  // shown. The stored goal_pct can go stale when a week's daily hours change
  // after the snapshot was taken (e.g. auto-filled days), which previously
  // dragged the gauge averages off. Fall back to the stored value only if
  // total/goal isn't usable.
  const goalPctOf = (e) => {
    const g = parseFloat(e?.goal);
    const t = parseFloat(e?.total);
    if (g > 0 && Number.isFinite(t)) return t / g;
    return parseFloat(e?.goal_pct) || 0;
  };

  const avgPct = arr => arr.length
    ? arr.reduce((s, e) => s + goalPctOf(e), 0) / arr.length
    : NaN;

  // Only average COMPLETED weeks. The current in-progress week is usually just a
  // day or two in (e.g. only Monday entered), so counting its partial ratio
  // against full weeks unfairly tanks the gauges. A week counts once it has
  // fully ended (weekEnd before today). Fall back to all entries if nothing has
  // completed yet (e.g. a brand-new tech) so the gauges aren't blank.
  const _now = new Date();
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const isCompletedWeek = (e) => { const end = e?.weekEnd || e?.date; return end ? end < todayStr : true; };
  const completedSorted = allSorted.filter(isCompletedWeek);
  const gaugeSource = completedSorted.length ? completedSorted : allSorted;
  const threeWeekEntries  = gaugeSource.slice(0, 3);
  const sixWeekEntries    = gaugeSource.slice(0, 6);
  const threeMonthEntries = gaugeSource.slice(0, 13);
  const threeWeekPct  = avgPct(threeWeekEntries);
  const sixWeekPct    = avgPct(sixWeekEntries);
  const threeMonthPct = avgPct(threeMonthEntries);

  return (
    <div>
      {/* Efficiency Gauges */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <EfficiencyGauge
          label="Last 3 Weeks"
          pct={threeWeekPct}
          sub={threeWeekEntries.length ? `${threeWeekEntries.length} week${threeWeekEntries.length !== 1 ? 's' : ''} averaged` : 'No data'}
          accentA="#3dd6c3"
          accentB="#6ee7f9"
        />
        <EfficiencyGauge
          label="Last 6 Weeks"
          pct={sixWeekPct}
          sub={sixWeekEntries.length ? `${sixWeekEntries.length} week${sixWeekEntries.length !== 1 ? 's' : ''} averaged` : 'No data'}
          accentA="#a78bfa"
          accentB="#c4b5fd"
        />
        <EfficiencyGauge
          label="Last 3 Months"
          pct={threeMonthPct}
          sub={threeMonthEntries.length ? `${threeMonthEntries.length} week${threeMonthEntries.length !== 1 ? 's' : ''} averaged` : 'No data'}
          accentA="#f97316"
          accentB="#fbbf24"
        />
      </div>

      {/* Year selector */}
      {years.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {years.map(y => (
            <button key={y} onClick={() => setSelectedYear(y)} style={{
              background: selectedYear === y ? 'rgba(61,214,195,.2)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${selectedYear === y ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
              color: selectedYear === y ? '#6ee7f9' : '#64748b',
              borderRadius: 8, padding: '5px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
            }}>{y}</button>
          ))}
        </div>
      )}

      {/* Latest week highlight */}
      {latest && (
        <div style={{ background: 'linear-gradient(135deg,rgba(61,214,195,.1),rgba(110,231,249,.06))', border: '1px solid rgba(61,214,195,.25)', borderRadius: 16, padding: '18px 22px', marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            📌 Latest — {latest.label || fmtDate(latest.date)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <StatBox compact label="Total Hrs"  value={num(latest.total, 1)}    color="#4ade80" />
            <StatBox compact label="Goal"       value={num(latest.goal, 1)}     color="#6ee7f9" />
            <StatBox compact label="Goal %"     value={pct(goalPctOf(latest))}  color={goalPctOf(latest) >= 1 ? '#4ade80' : goalPctOf(latest) >= .8 ? '#fbbf24' : '#f87171'} />
            <StatBox compact label="Pacing"     value={num(latest.pacing, 1)}   color="#c4b5fd" />
            <StatBox compact label="Mon"        value={num(latest.mon, 1)}      color="#94a3b8" />
            <StatBox compact label="Tue"        value={num(latest.tue, 1)}      color="#94a3b8" />
            <StatBox compact label="Wed"        value={num(latest.wed, 1)}      color="#94a3b8" />
            <StatBox compact label="Thu"        value={num(latest.thu, 1)}      color="#94a3b8" />
            <StatBox compact label="Fri"        value={num(latest.fri, 1)}      color="#94a3b8" />
            <StatBox compact label="Sat"        value={num(latest.sat, 1)}      color="#94a3b8" />
          </div>
        </div>
      )}

      {/* Toggle row: Weekly History + AI Coaching */}
      <div style={{ display: 'flex', gap: 10, marginBottom: (showHistory || showCoaching) ? 12 : 0, flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowHistory(s => !s)}
          style={{
            background: showHistory ? 'rgba(61,214,195,.15)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${showHistory ? 'rgba(61,214,195,.4)' : 'rgba(255,255,255,.1)'}`,
            color: showHistory ? '#3dd6c3' : '#94a3b8',
            borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: 1,
          }}
        >
          <span>{showHistory ? '▼' : '▶'}</span>
          <span>Weekly History — {filtered.length} week{filtered.length !== 1 ? 's' : ''} in {selectedYear}</span>
        </button>
        <button
          onClick={() => setShowCoaching(s => !s)}
          className={coachingUnseen ? 'coaching-glow' : ''}
          style={{
            background: coachingUnseen
              ? 'rgba(168,85,247,.28)'
              : showCoaching ? 'rgba(168,85,247,.18)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${coachingUnseen ? 'rgba(168,85,247,.85)' : showCoaching ? 'rgba(168,85,247,.4)' : 'rgba(255,255,255,.1)'}`,
            color: coachingUnseen ? '#e9d5ff' : showCoaching ? '#c4b5fd' : '#94a3b8',
            borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 13,
            cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: 1,
            position: 'relative',
          }}
        >
          <span>{showCoaching ? '▼' : '▶'}</span>
          <span>🎯 Coaching Report {coachingReports.length > 0 && `(${coachingReports.length})`}</span>
          {coachingUnseen && (
            <span style={{
              fontSize: 9, fontWeight: 900, color: '#fff',
              background: '#a855f7', borderRadius: 999,
              padding: '2px 8px', letterSpacing: .5,
              boxShadow: '0 0 12px rgba(168,85,247,.85)',
            }}>NEW</span>
          )}
        </button>
      </div>

      {showCoaching && (
        <div style={{ background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.2)', borderRadius: 14, padding: '20px 24px', marginBottom: 16 }}>
          {coachingLoading ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>⏳ Loading coaching reports…</div>
          ) : coachingReports.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>
              No coaching reports yet. Your manager will generate one soon.
            </div>
          ) : (
            coachingReports.map((r, i) => (
              <div key={r.id || i} style={{ marginBottom: i < coachingReports.length - 1 ? 24 : 0, paddingBottom: i < coachingReports.length - 1 ? 24 : 0, borderBottom: i < coachingReports.length - 1 ? '1px solid rgba(168,85,247,.18)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {r.weekLabel || (r.weekStart && r.weekEnd ? `Week of ${r.weekStart} – ${r.weekEnd}` : 'Latest report')}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Generated {new Date(r.generatedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <CoachingReportBody text={r.report} />
              </div>
            ))
          )}
        </div>
      )}
      {showHistory && (filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No entries for {selectedYear}.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="adv-table" style={{ minWidth: 800 }}>
            <tbody>
              {filtered.map((e, i) => {
                const prev = filtered[i + 1];
                const gp   = goalPctOf(e);

                // Dates for each day column, derived from this row's weekStart
                const dayD = (offset) => {
                  if (!e.weekStart) return '';
                  const d = new Date(e.weekStart + 'T00:00:00');
                  d.setDate(d.getDate() + offset);
                  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                };

                const DayCell = ({ val }) => (
                  <td style={{ color: '#94a3b8', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {num(val, 1)}
                  </td>
                );

                // Header row showing day names + this row's dates
                const headerRow = (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>DATE</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>WEEK</th>
                    <th>TOTAL HRS</th>
                    <th>GOAL</th>
                    <th>GOAL %</th>
                    <th>PACING</th>
                    {[['SAT',0],['MON',2],['TUE',3],['WED',4],['THU',5],['FRI',6]].map(([day, offset]) => (
                      <th key={day} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {day}{e.weekStart ? <span style={{ marginLeft: 5, fontWeight: 400, color: '#64748b', fontSize: 11 }}>{dayD(offset)}</span> : null}
                      </th>
                    ))}
                  </tr>
                );

                return (
                  <React.Fragment key={i}>
                  {headerRow}
                  <tr style={{ background: i === 0 ? 'rgba(61,214,195,.04)' : '' }}>
                    <td style={{ whiteSpace: 'nowrap', color: '#94a3b8', fontSize: 12 }}>
                      {e.weekStart && e.weekEnd
                        ? <>{fmtShort(e.weekStart)} – {fmtShort(e.weekEnd)}</>
                        : fmtDate(e.date)}
                      {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#3dd6c3', fontWeight: 800 }}>LATEST</span>}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap', color: '#6ee7f9', fontWeight: 700, fontSize: 12 }}>
                      Wk {weekOfYear(e.weekStart)}
                      {e.vacationHours > 0 && <span title={`Includes ${e.vacationHours}h vacation`} style={{ marginLeft: 5, fontSize: 10, color: '#60a5fa' }}>🏖</span>}
                      {e.trainingHours > 0 && <span title={`Includes ${e.trainingHours}h training`} style={{ marginLeft: 4, fontSize: 10, color: '#a78bfa' }}>📚</span>}
                      {e.holidayHours  > 0 && <span title={`Includes ${e.holidayHours}h holiday`}  style={{ marginLeft: 4, fontSize: 10, color: '#fbbf24' }}>🎉</span>}
                    </td>
                    <td style={{ fontWeight: 700, color: '#4ade80' }}>
                      {num(e.total, 1)}<TrendIcon curr={e.total} prev={prev?.total} />
                    </td>
                    <td style={{ color: '#6ee7f9' }}>{num(e.goal, 1)}</td>
                    <td style={{ fontWeight: 700, color: gp >= 1 ? '#4ade80' : gp >= .8 ? '#fbbf24' : '#f87171' }}>
                      {pct(gp)}<TrendIcon curr={gp} prev={prev ? goalPctOf(prev) : undefined} />
                    </td>
                    <td style={{ color: '#c4b5fd' }}>{num(e.pacing, 1)}</td>
                    <DayCell val={e.sat} />
                    <DayCell val={e.mon} />
                    <DayCell val={e.tue} />
                    <DayCell val={e.wed} />
                    <DayCell val={e.thu} />
                    <DayCell val={e.fri} />
                  </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function PerformanceReport({ currentUser, role, onBack, canDelete = false, canUpload = false }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const username = (currentUser || '').toUpperCase();
  const isAdvisor = (role || '').toLowerCase() === 'advisor';
  const isTech    = (role || '').toLowerCase() === 'technician';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadGithubFile(`data/performance-reports/${username}.json`).then(d => Array.isArray(d) ? d : []),
      loadDashboardData().then(d => d?.data?.advisors || []).catch(() => []),
    ]).then(([saved, advisors]) => {
      // Pull a few fields straight from the live Advisor Performance editor
      // (where the manager edits them), so the latest snapshot in the report
      // always reflects the current dashboard — not just what was captured at
      // the last "Send to Reports" event. Coupon Labor specifically is
      // entered/imported on the advisor card and should show here immediately.
      const me = advisors.find(a => (a.name || '').toUpperCase() === username);
      const merged = [...saved];
      if (me && merged.length > 0) {
        const liveCoupon = me.coupon_labor != null && me.coupon_labor !== '' ? parseFloat(me.coupon_labor) : null;
        const liveSales  = me.total_sales  != null && me.total_sales  !== '' ? parseFloat(me.total_sales)  : null;
        const liveUsage  = (liveCoupon != null && liveSales != null && liveSales > 0)
          ? liveCoupon / liveSales
          : (me.coupon_usage_pct != null && me.coupon_usage_pct !== '' ? parseFloat(me.coupon_usage_pct) : null);
        merged[0] = {
          ...merged[0],
          coupon_labor:      liveCoupon ?? merged[0].coupon_labor,
          total_sales:       liveSales  ?? merged[0].total_sales,
          coupon_usage_pct:  liveUsage  ?? merged[0].coupon_usage_pct,
        };
      }
      setEntries(merged);
    }).finally(() => setLoading(false));
  }, [username]);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar">
        <div>
          <div className="adv-title">📊 My Performance Reports</div>
          <div className="adv-sub">
            {username}
            {isAdvisor && ' · Daily snapshots by month'}
            {isTech    && ' · Weekly snapshots (Sat–Fri)'}
          </div>
        </div>
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#64748b' }}>⏳ Loading your reports…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontWeight: 900, fontSize: 18, color: '#94a3b8', marginBottom: 8 }}>No Reports Yet</div>
              <div style={{ fontSize: 14, color: '#475569' }}>
                {isAdvisor
                  ? 'Your manager will send your first daily snapshot soon. Numbers are saved each time your manager clicks "Send to Reports".'
                  : 'Your manager will send your first weekly snapshot soon. Each week (Sat–Fri) gets its own entry.'}
              </div>
            </div>
          ) : isAdvisor ? (
            <AdvisorReport entries={entries} username={username} canDelete={canDelete} canUpload={canUpload} onEntriesChange={setEntries} />
          ) : isTech ? (
            <TechReport entries={entries} username={username} />
          ) : (
            <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Role not recognized.</div>
          )}

        </div>
      </div>
    </div>
  );
}
