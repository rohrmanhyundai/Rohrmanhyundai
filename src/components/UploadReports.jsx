import React, { useEffect, useRef, useState } from 'react';
import SortableTiles from './SortableTiles';
import { loadGithubFile } from '../utils/github';
import { uploadAppointmentFile, shortMD } from '../utils/appointmentList';

// ── Upload Reports ────────────────────────────────────────────────────────────
// Manager Hub's one-stop shop for every report the site takes. Each card opens
// the screen where that report is uploaded — already on the right tab — and
// Back returns here, so the manager can work down the list. The upload logic
// stays on those screens (preview, confirm, save); this page just gets you
// there. The DMS Appointment List needs no preview, so it uploads right here.
// Press and hold a card to rearrange; the order is saved per manager.

const FREQ = {
  daily:   { label: 'Daily',     color: '#4ade80' },
  weekly:  { label: 'Weekly',    color: '#60a5fa' },
  monthly: { label: 'Monthly',   color: '#c4b5fd' },
  asneeded:{ label: 'As needed', color: '#94a3b8' },
};

// `open` is the key App.jsx maps to a destination (see UPLOAD_LAUNCH there).
export const REPORTS = [
  { key: 'advisorPerf', icon: '📊', title: 'Advisor Performance Report', file: '.html + .pdf', freq: 'daily', color: '#6ee7f9',
    desc: 'Tekion Pay Type View (.html) and SA Totals (.pdf). Fills advisor MTD hours, ROs, ELR and add-on % on the dashboard.',
    where: 'Opens Edit Dashboard → Advisors. Save Changes when done.' },
  { key: 'techHours', icon: '🔧', title: 'Tech Flagged Hours', file: '.html', freq: 'daily', color: '#a78bfa',
    desc: 'Tech Performance report (Pay Type View) for one day. Fills that weekday on the tech hours board.',
    where: 'Opens Edit Dashboard → Technicians. Save Changes when done.' },
  { key: 'weekCloseout', icon: '🗓', title: 'Close Out Week', file: '.html', freq: 'weekly', color: '#60a5fa',
    desc: 'Whole-week Tech Performance report. Finalises Tech Live Pay for the week and resets the board.',
    where: 'Opens Edit Dashboard → Technicians — click Close Out Week → Upload Week Report.' },
  { key: 'roUpload', icon: '📤', title: 'Open RO Report', file: '.xlsx', freq: 'daily', color: '#34d399',
    desc: 'Open repair order export. Updates WIP, Cars Awaiting, missing notes and Open RO Attention.',
    last: 'ro' },
  { key: 'appointments', icon: '📅', title: 'DMS Appointment List', file: '.xlsx', freq: 'daily', color: '#fbbf24', inline: true,
    desc: 'Fills every advisor\'s prep sheet, puts "Any Service Advisor" appointments in the open pool, and matches deferred work.',
    last: 'appointments' },
  { key: 'deferred', icon: '🔧', title: 'Deferred Services', file: '.pdf', freq: 'weekly', color: '#fb923c',
    desc: 'DMS Deferred Services report. Feeds the Deferred Service follow-up list and prep-sheet deferred matching.' },
  { key: 'grossReport', icon: '🎯', title: 'Gross Report', file: '.pdf', freq: 'daily', color: '#f472b6',
    desc: 'Daily labor & parts gross. Fills Goal Forecast actuals and the dashboard gauges.' },
  { key: 'advisorGoals', icon: '📈', title: 'Advisor Daily Hours', file: '.xlsx', freq: 'daily', color: '#c4b5fd',
    desc: 'Advisor Performance summary (.xlsx). Fills each advisor\'s daily hours and HRS/RO in Advisor Forecast.' },
  { key: 'surveys', icon: '📞', title: 'Service Invitation List', file: '.xlsx', freq: 'weekly', color: '#6ee7b7',
    desc: 'DMS survey export. Feeds After Call Reviews and Survey Reports.' },
  { key: 'payroll', icon: '💰', title: 'Payroll — Tech Performance', file: '.html', freq: 'weekly', color: '#facc15',
    desc: 'Weekly technician pay sheet. Needs the payroll access code; Save week when done.',
    last: 'payroll' },
  { key: 'cashDash', icon: '💵', title: 'Cash Dash Tech Hours', file: '.xlsx', freq: 'monthly', color: '#22c55e',
    desc: 'Full-month tech booked hours. Only takes uploads while the Cash Dash season is active.' },
  { key: 'histReports', icon: '🗂', title: 'Historical Advisor Reports', file: '.html + .pdf', freq: 'asneeded', color: '#93c5fd',
    desc: 'Backfill a past month\'s advisor performance into Performance Reports.' },
  { key: 'chargeAccounts', icon: '💳', title: 'Charge Account List', file: '.pdf', freq: 'asneeded', color: '#a5b4fc',
    desc: 'Approved charge accounts, customer IDs and tax-exempt status.',
    last: 'charge' },
  { key: 'hotRepairs', icon: '🚨', title: 'Hot Repairs & Recalls', file: '.pdf', freq: 'asneeded', color: '#f87171',
    desc: 'Hot repair and recall / TSB bulletins for the Recalls/TSB Bulletins page.' },
  { key: 'warrantyContacts', icon: '🛡', title: 'Warranty Company Contacts', file: '.docx .rtf .txt .csv', freq: 'asneeded', color: '#5eead4',
    desc: 'Aftermarket warranty company contact list.' },
  { key: 'documents', icon: '📁', title: 'Document Library', file: '.pdf .doc .docx', freq: 'asneeded', color: '#67e8f9',
    desc: 'Forms and reference documents for advisors and techs.',
    last: 'documents' },
  { key: 'reviewForm', icon: '⭐', title: 'Review Form Template', file: '.pdf', freq: 'asneeded', color: '#f9a8d4',
    desc: 'The PDF that builds the tech / manager review forms in Employee Review.' },
];

// The next shop day (skips Sunday) — the appointment list is uploaded the day before.
const nextShopDay = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const when = (t) => {
  const d = new Date(t);
  if (!t || isNaN(d)) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// "Last uploaded" for the reports whose files are small enough to check on
// open. Five reads, once — the shared token is rate-limited.
async function loadLastUploads() {
  const [ro, pay, charge, docs, appt] = await Promise.all([
    loadGithubFile('data/ro-status.json').catch(() => null),
    loadGithubFile('data/payroll/index.json').catch(() => null),
    loadGithubFile('data/charge-accounts.json').catch(() => null),
    loadGithubFile('data/documents/index.json').catch(() => null),
    loadGithubFile(`data/appointments/${nextShopDay()}.json`).catch(() => null),
  ]);
  const out = {};
  if (ro && ro.updatedAt) out.ro = { at: ro.updatedAt, by: ro.by };
  const weeks = Object.values((pay && pay.weeks) || {}).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  if (weeks[0]) out.payroll = { at: weeks[0].savedAt, by: weeks[0].by, note: `week of ${shortMD(weeks[0].start)}` };
  if (charge && charge.savedAt) out.charge = { at: charge.savedAt };
  if (Array.isArray(docs) && docs[0]) out.documents = { at: docs[0].uploadedAt, by: docs[0].uploadedBy };
  out.appointments = appt && appt.uploadedAt
    ? { at: appt.uploadedAt, by: appt.uploadedBy, note: `${shortMD(nextShopDay())} list` }
    : { missing: `${shortMD(nextShopDay())} not uploaded yet` };
  return out;
}

export default function UploadReports({ currentUser, advisorList = [], onBack, onOpen }) {
  const [last, setLast] = useState({});
  const [apptBusy, setApptBusy] = useState(false);
  const [apptMsg, setApptMsg] = useState('');
  const apptRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadLastUploads().then(l => { if (!cancelled) setLast(l); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function uploadAppointments(file) {
    if (!file) return;
    setApptMsg(''); setApptBusy(true);
    try {
      const { dates, byDate, defCount, autoCount } = await uploadAppointmentFile(file, { advisorList, by: currentUser });
      const total = dates.reduce((n, d) => n + byDate[d].length, 0);
      setApptMsg(`✓ ${total} appointments for ${dates.map(shortMD).join(', ')}`
        + (defCount ? ` · ${defCount} with deferred work` : '')
        + (autoCount ? ` · ${autoCount} auto-assigned` : ''));
      loadLastUploads().then(setLast).catch(() => {});
    } catch (e) {
      setApptMsg('⚠️ ' + (e.message || 'Upload failed'));
    } finally {
      setApptBusy(false);
      if (apptRef.current) apptRef.current.value = '';
    }
  }

  const chip = (text, color) => (
    <span style={{ fontSize: 10.5, fontWeight: 800, color, border: `1px solid ${color}66`, background: 'rgba(2,6,23,.4)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{text}</span>
  );

  function LastLine({ r }) {
    const l = r.last && last[r.last];
    if (!r.last) return null;
    if (!l) return <div style={{ fontSize: 11.5, color: '#475569' }}>Checking last upload…</div>;
    if (l.missing) return <div style={{ fontSize: 11.5, fontWeight: 800, color: '#fbbf24' }}>⚠ {l.missing}</div>;
    // Daily reports want today's upload; the appointment list only has to exist.
    const fresh = r.freq !== 'daily' || r.key === 'appointments' || new Date(l.at).toDateString() === new Date().toDateString();
    return (
      <div style={{ fontSize: 11.5, fontWeight: 700, color: fresh ? '#4ade80' : '#fbbf24' }}>
        {fresh ? '✓' : '⚠'} Last: {when(l.at)}{l.by ? ` · ${l.by}` : ''}{l.note ? ` · ${l.note}` : ''}
      </div>
    );
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Upload Reports</div>
          <div className="adv-sub">Every report the site takes, in one place</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Manager Hub</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 40px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, lineHeight: 1.5 }}>
            Click a card to go straight to that upload — <b style={{ color: '#cbd5e1' }}>Back</b> brings you here to do the next one.
            Press and hold a card to put them in the order you work.
          </div>

          <SortableTiles
            hubKey="uploadReports"
            currentUser={currentUser}
            items={REPORTS}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}
          >
            {r => (
              <div
                onClick={r.inline ? undefined : () => onOpen(r.key)}
                style={{
                  height: '100%', boxSizing: 'border-box', cursor: r.inline ? 'default' : 'pointer',
                  background: 'linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02))',
                  border: '1px solid rgba(148,163,184,.2)', borderTop: `3px solid ${r.color}`,
                  borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8,
                  transition: 'transform .15s, box-shadow .15s',
                }}
                onMouseEnter={e => { if (!r.inline) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.3)'; } }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{r.icon}</span>
                  <span style={{ fontWeight: 900, fontSize: 15.5, color: r.color, lineHeight: 1.2 }}>{r.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {chip(r.file, '#cbd5e1')}
                  {chip(FREQ[r.freq].label, FREQ[r.freq].color)}
                </div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>{r.desc}</div>
                {r.where && <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4 }}>{r.where}</div>}
                <div style={{ flex: 1 }} />
                <LastLine r={r} />
                {r.inline ? (
                  <>
                    <input ref={apptRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                      onChange={e => uploadAppointments(e.target.files && e.target.files[0])} />
                    <button onClick={() => apptRef.current && apptRef.current.click()} disabled={apptBusy}
                      style={{ alignSelf: 'flex-start', background: 'linear-gradient(180deg,rgba(251,191,36,.3),rgba(245,158,11,.2))', borderColor: 'rgba(251,191,36,.55)', color: '#fef3c7', fontWeight: 800 }}>
                      {apptBusy ? '⏳ Uploading…' : '📤 Choose file'}
                    </button>
                    {apptMsg && <div style={{ fontSize: 12, fontWeight: 700, color: apptMsg.startsWith('⚠') ? '#fca5a5' : '#4ade80' }}>{apptMsg}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: r.color }}>Open upload →</div>
                )}
              </div>
            )}
          </SortableTiles>
        </div>
      </div>
    </div>
  );
}
