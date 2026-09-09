import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadApplicants, saveApplicant, deleteApplicant } from '../utils/github';
import { uploadResumeToS3 } from '../utils/s3';
import { verifyAccessCode, hasAccessCode } from '../utils/accessCode';

/* Employee Applicants — one hiring pipeline per manager.
 *
 * The parts manager's applicants are his and the service manager's are his;
 * neither sees the other's. The page asks for that manager's 4-digit code
 * before showing anything, so a terminal left open on the Manager Hub doesn't
 * put someone's resume on screen for the next person who walks up.
 */

const uid = () => `ap-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const POSITIONS = ['Technician', 'Advisor', 'Porter', 'Lube Technician', 'Parts Counter', 'Warranty Admin', 'Other'];

// Anyone filed before the list settled keeps their spot rather than dropping
// into "Other" — the old wording maps onto the role it became.
const LEGACY_POSITIONS = { 'Service Advisor': 'Advisor', 'Parts': 'Parts Counter', 'Lot / Porter': 'Porter', 'Detail': 'Other', 'Office': 'Other' };
const positionOf = (a) => LEGACY_POSITIONS[a.position] || a.position || 'Other';
const SOURCES = ['Indeed', 'Walk-in', 'Referral', 'Hyundai site', 'Facebook', 'Other'];

// ── Dates ────────────────────────────────────────────────────────────────────
// Stored as the value the datetime input gives (local wall time). Formatting a
// UTC timestamp would drift an interview "at 9am" onto the previous evening for
// anyone reading it in another timezone.
function prettyWhen(v) {
  if (!v) return '';
  const [d, t] = String(v).split('T');
  const [y, m, day] = (d || '').split('-').map(Number);
  if (!y) return v;
  const date = new Date(y, m - 1, day);
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!t) return label;
  const [hh, mm] = t.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${label} · ${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

// The value a datetime-local input expects: local wall time. toISOString() here
// would stamp a 9am interview as 1pm for anyone east of UTC.
const nowLocalStamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Where an applicant stands, worked out from what's filled in rather than kept
// as a separate field that can disagree with it.
function stageOf(a) {
  if (a.archived) return { key: 'archived', label: 'Archived', color: '#7d8ba3', bg: 'rgba(148,163,184,.12)', border: 'rgba(148,163,184,.3)' };
  if (a.considerHire === 'yes') return { key: 'hire', label: '★ Consider for hire', color: '#6ee7b7', bg: 'rgba(52,211,153,.14)', border: 'rgba(52,211,153,.45)' };
  if (a.considerHire === 'no') return { key: 'pass', label: 'Passed', color: '#fca5a5', bg: 'rgba(248,113,113,.12)', border: 'rgba(248,113,113,.35)' };
  if (a.interviewed === 'yes') return { key: 'decide', label: 'Needs a decision', color: '#fbbf24', bg: 'rgba(251,191,36,.14)', border: 'rgba(251,191,36,.4)' };
  if (a.interviewAt) {
    const day = String(a.interviewAt).slice(0, 10);
    const today = todayKey();
    if (day < today) return { key: 'overdue', label: 'Interview passed — log it', color: '#fdba74', bg: 'rgba(251,146,60,.14)', border: 'rgba(251,146,60,.45)' };
    if (day === today) return { key: 'today', label: 'Interview today', color: '#7dd3fc', bg: 'rgba(56,189,248,.16)', border: 'rgba(56,189,248,.5)' };
    return { key: 'scheduled', label: `Interview ${prettyWhen(a.interviewAt)}`, color: '#93c5fd', bg: 'rgba(96,165,250,.13)', border: 'rgba(96,165,250,.4)' };
  }
  return { key: 'new', label: 'Needs an interview date', color: '#cbd5e1', bg: 'rgba(255,255,255,.05)', border: 'rgba(148,163,184,.28)' };
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'today', label: 'Today & overdue' },
  { key: 'decide', label: 'Needs a decision' },
  { key: 'hire', label: 'Consider for hire' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'Everyone' },
];

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(2,6,23,.55)',
  border: '1px solid rgba(148,163,184,.25)', borderRadius: 10, padding: '9px 12px',
  color: '#e8f1ff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', outline: 'none',
};
const labelStyle = {
  display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em',
  color: '#7f93b0', textTransform: 'uppercase', marginBottom: 5,
};

export default function EmployeeApplicants({ currentUser, currentUserRecord, onBack, backLabel }) {
  const me = (currentUser || '').toUpperCase();
  const codeSet = hasAccessCode(currentUserRecord);

  const [unlocked, setUnlocked] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [checking, setChecking] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [role, setRole] = useState('all');       // which category is showing
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState(null);   // applicant whose resume is docked below

  useEffect(() => {
    if (!unlocked) return;
    let alive = true;
    loadApplicants(me)
      .then(list => { if (alive) setRows(list); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [unlocked, me]);

  async function submitCode(e) {
    e?.preventDefault?.();
    setChecking(true); setCodeErr('');
    try {
      const ok = await verifyAccessCode(codeInput.trim(), currentUserRecord?.applicantCode);
      if (ok) { setUnlocked(true); setCodeInput(''); }
      else setCodeErr('That code doesn’t match. Ask an admin if you’ve forgotten it.');
    } catch {
      setCodeErr('Could not check the code on this device.');
    } finally {
      setChecking(false);
    }
  }

  const persist = useCallback(async (next) => {
    setBusyId(next.id); setErr('');
    setRows(cur => cur.some(r => r.id === next.id) ? cur.map(r => (r.id === next.id ? next : r)) : [next, ...cur]);
    try {
      await saveApplicant(me, { ...next, updatedAt: new Date().toISOString(), updatedBy: me });
    } catch (e2) {
      setErr(e2.message || String(e2));
    } finally {
      setBusyId('');
    }
  }, [me]);

  async function remove(a) {
    if (!window.confirm(`Delete ${a.name || 'this applicant'} and their resume? This cannot be undone.\n\nUse Archive instead if you may want them later.`)) return;
    setBusyId(a.id); setErr('');
    const before = rows;
    setRows(cur => cur.filter(r => r.id !== a.id));
    try {
      await deleteApplicant(me, a);
    } catch (e2) {
      setRows(before);
      setErr(e2.message || String(e2));
    } finally {
      setBusyId('');
    }
  }

  // Sorted so the day's work is at the top: today and overdue first, then the
  // ones waiting on a decision, then everything upcoming by date.
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank = { today: 0, overdue: 1, decide: 2, scheduled: 3, new: 4, hire: 5, pass: 6, archived: 7 };
    return rows
      .filter(a => {
        const st = stageOf(a).key;
        if (filter === 'open') return !a.archived && st !== 'pass';
        if (filter === 'today') return st === 'today' || st === 'overdue';
        if (filter === 'decide') return st === 'decide';
        if (filter === 'hire') return st === 'hire';
        if (filter === 'archived') return !!a.archived;
        return true;
      })
      .filter(a => role === 'all' || positionOf(a) === role)
      .filter(a => !q || [a.name, a.phone, a.email, a.position].some(v => String(v || '').toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => {
        const ra = rank[stageOf(a).key] ?? 9, rb = rank[stageOf(b).key] ?? 9;
        if (ra !== rb) return ra - rb;
        return String(a.interviewAt || a.appliedAt || '').localeCompare(String(b.interviewAt || b.appliedAt || ''));
      });
  }, [rows, filter, role, search]);

  // Follow edits to whoever is open below, and drop the panel if they're deleted.
  const viewingLive = viewing ? rows.find(r => r.id === viewing.id) || null : null;
  useEffect(() => { if (viewing && !viewingLive) setViewing(null); }, [viewing, viewingLive]);

  // Counts for the role chips reflect the status filter above them, so "Needs a
  // decision" plus "Technician" reads as the number it actually shows.
  const roleCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const c = {};
    rows.forEach(a => {
      const st = stageOf(a).key;
      const passesStatus = filter === 'open' ? (!a.archived && st !== 'pass')
        : filter === 'today' ? (st === 'today' || st === 'overdue')
        : filter === 'decide' ? st === 'decide'
        : filter === 'hire' ? st === 'hire'
        : filter === 'archived' ? !!a.archived
        : true;
      if (!passesStatus) return;
      if (q && ![a.name, a.phone, a.email, a.position].some(v => String(v || '').toLowerCase().includes(q))) return;
      const p = positionOf(a);
      c[p] = (c[p] || 0) + 1;
    });
    return c;
  }, [rows, filter, search]);

  // Grouped for display: each role its own block, in the order the list defines,
  // with anything unrecognised last rather than hidden.
  const grouped = useMemo(() => {
    const byRole = new Map();
    view.forEach(a => {
      const p = positionOf(a);
      if (!byRole.has(p)) byRole.set(p, []);
      byRole.get(p).push(a);
    });
    const known = POSITIONS.filter(p => byRole.has(p));
    const extra = [...byRole.keys()].filter(p => !POSITIONS.includes(p)).sort();
    return [...known, ...extra].map(p => [p, byRole.get(p)]);
  }, [view]);

  const counts = useMemo(() => {
    const c = { today: 0, decide: 0, hire: 0 };
    rows.forEach(a => { const k = stageOf(a).key; if (k === 'today' || k === 'overdue') c.today++; if (k === 'decide') c.decide++; if (k === 'hire') c.hire++; });
    return c;
  }, [rows]);

  // ── Locked ────────────────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="adv-page">
        <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
          <div style={{ flex: 1 }}>
            <div className="adv-title">Employee Applicants</div>
            <div className="adv-sub">{me}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px' }}>
          <form onSubmit={submitCode} style={{
            width: '100%', maxWidth: 380, textAlign: 'center',
            border: '1px solid rgba(148,163,184,.22)', borderRadius: 18, padding: '34px 28px',
            background: 'linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))',
          }}>
            <div style={{ fontSize: 40 }}>🔒</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#e8f1ff', marginTop: 12 }}>Enter your code</div>
            {codeSet ? (
              <>
                <div style={{ fontSize: 13, color: '#8296b4', marginTop: 8, lineHeight: 1.6 }}>
                  Your applicants are private to you. Enter your 4-digit code to open them.
                </div>
                <input
                  autoFocus
                  value={codeInput}
                  onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 10)); setCodeErr(''); }}
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  style={{ ...inputStyle, marginTop: 18, textAlign: 'center', fontSize: 24, letterSpacing: '.5em', padding: '12px' }}
                />
                {codeErr && <div style={{ color: '#fca5a5', fontSize: 12.5, fontWeight: 700, marginTop: 10 }}>⚠ {codeErr}</div>}
                <button type="submit" disabled={checking || !codeInput}
                  style={{
                    marginTop: 16, width: '100%', padding: '11px', fontSize: 15, fontWeight: 800,
                    background: (checking || !codeInput) ? 'rgba(255,255,255,.06)' : 'rgba(96,165,250,.2)',
                    border: '1px solid rgba(96,165,250,.45)', color: (checking || !codeInput) ? '#7d8ba3' : '#93c5fd', borderRadius: 10,
                  }}>
                  {checking ? 'Checking…' : 'Unlock'}
                </button>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: '#fdba74', marginTop: 12, lineHeight: 1.7 }}>
                You don’t have a code yet. An admin sets one for you in
                <strong> Edit Dashboard → User Management</strong>.
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  // ── Unlocked ──────────────────────────────────────────────────────────────
  return (
    <div className="adv-page">
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="adv-title">Employee Applicants</div>
          <div className="adv-sub">
            {me}
            {counts.today > 0 && <span style={{ color: '#7dd3fc', fontWeight: 700 }}> · {counts.today} to interview</span>}
            {counts.decide > 0 && <span style={{ color: '#fbbf24', fontWeight: 700 }}> · {counts.decide} awaiting a decision</span>}
          </div>
        </div>
        <button className="secondary" onClick={() => setUnlocked(false)} title="Lock this page again">🔒 Lock</button>
        <button onClick={() => setAdding(true)}
          style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', borderRadius: 10, padding: '8px 18px', fontWeight: 800, fontSize: 13.5 }}>
          + Add Applicant
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 48px', paddingBottom: viewingLive ? 'calc(46vh + 32px)' : 48 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`adv-advisor-tab${filter === f.key ? ' adv-advisor-tab--active' : ''}`}
                style={{ fontSize: 12.5, padding: '6px 14px' }}>
                {f.label}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, email…"
              style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 180, padding: '7px 12px', fontSize: 13 }} />
          </div>

          {/* One category per role. Only roles with somebody in them show, so
              the row doesn't fill up with empty chips. */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', color: '#7f93b0', textTransform: 'uppercase', marginRight: 2 }}>Role</span>
            {[['all', 'All roles'], ...POSITIONS.filter(p => roleCounts[p]).map(p => [p, p]),
              ...Object.keys(roleCounts).filter(p => !POSITIONS.includes(p)).map(p => [p, p])].map(([key, label]) => (
              <button key={key} onClick={() => setRole(key)}
                className={`adv-advisor-tab${role === key ? ' adv-advisor-tab--active' : ''}`}
                style={{ fontSize: 12, padding: '5px 12px' }}>
                {label}
                {key !== 'all' && <span style={{ opacity: .65, fontWeight: 700 }}> {roleCounts[key]}</span>}
              </button>
            ))}
          </div>

          {err && <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13, marginBottom: 12 }}>⚠ {err}</div>}

          {adding && (
            <ApplicantForm
              onCancel={() => setAdding(false)}
              onSave={async (draft) => {
                await persist({ ...draft, id: uid(), appliedAt: new Date().toISOString() });
                setAdding(false);
              }}
            />
          )}

          {loading ? (
            <div style={{ color: '#7a92b8', fontSize: 14, padding: '20px 0' }}>Loading…</div>
          ) : !view.length ? (
            <div style={{ color: '#7a92b8', fontSize: 14, padding: '28px 0', textAlign: 'center', lineHeight: 1.7 }}>
              {rows.length ? 'Nobody matches that filter.' : 'No applicants yet. Add the first one above.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 26 }}>
              {grouped.map(([roleName, list]) => (
                <div key={roleName}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8fa7c8',
                  }}>
                    {roleName}
                    <span style={{ color: '#64748b', letterSpacing: 0 }}>{list.length}</span>
                    <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(148,163,184,.28),transparent)' }} />
                  </div>
                  <div style={{ display: 'grid', gap: 14 }}>
                    {list.map(a => (
                      <ApplicantCard
                        key={a.id}
                        applicant={a}
                        busy={busyId === a.id}
                        viewing={viewingLive?.id === a.id}
                        onView={show => setViewing(show ? a : null)}
                        onChange={patch => persist({ ...a, ...patch })}
                        onDelete={() => remove(a)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewingLive && <ResumeDock applicant={viewingLive} onClose={() => setViewing(null)} />}
    </div>
  );
}

/* ── Add form ─────────────────────────────────────────────────────────────── */
function ApplicantForm({ onCancel, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState(POSITIONS[0]);
  const [source, setSource] = useState(SOURCES[0]);
  const [interviewAt, setInterviewAt] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) { setError('A name is the one thing this needs.'); return; }
    setError(''); setBusy(file ? 'Uploading resume…' : 'Saving…');
    try {
      let resumeUrl = '', resumeName = '';
      if (file) {
        // Opaque key: an applicant's name shouldn't be readable from a URL.
        const ext = (file.name.split('.').pop() || 'pdf').replace(/[^a-z0-9]/gi, '').slice(0, 5);
        resumeUrl = await uploadResumeToS3(`${uid()}.${ext || 'pdf'}`, file);
        resumeName = file.name;
      }
      await onSave({
        name: name.trim(), phone: phone.trim(), email: email.trim(),
        position, source, interviewAt,
        interviewed: '', interviewedAt: '', interviewNotes: '',
        considerHire: '', resumeUrl, resumeName, archived: false,
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div style={{
      border: '1px solid rgba(96,165,250,.3)', borderRadius: 16, padding: '20px 22px', marginBottom: 18,
      background: 'linear-gradient(180deg,rgba(96,165,250,.08),rgba(96,165,250,.02))',
    }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: '#bfdbfe', marginBottom: 14 }}>New applicant</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <div><label style={labelStyle}>Name</label><input autoFocus value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" style={inputStyle} /></div>
        <div><label style={labelStyle}>Email</label><input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" style={inputStyle} /></div>
        <div>
          <label style={labelStyle}>Applying for</label>
          <select value={position} onChange={e => setPosition(e.target.value)} style={inputStyle}>
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Came from</label>
          <select value={source} onChange={e => setSource(e.target.value)} style={inputStyle}>
            {SOURCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Interview set for <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>(optional)</span></label>
          <input type="datetime-local" value={interviewAt} onChange={e => setInterviewAt(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={labelStyle}>Resume <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>(optional)</span></label>
        <input className="promo-file" type="file" accept=".pdf,.doc,.docx,image/*"
          onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'block' }} />
      </div>

      {error && <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700, marginTop: 12 }}>⚠ {error}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={save} disabled={!!busy}
          style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', borderRadius: 10, padding: '9px 20px', fontWeight: 800, fontSize: 13.5 }}>
          {busy || 'Save Applicant'}
        </button>
        <button className="secondary" onClick={onCancel} disabled={!!busy}>Cancel</button>
      </div>
    </div>
  );
}

/* ── Resume docked at the bottom ──────────────────────────────────────────────
   Half the screen, pinned to the bottom, so the applicant's details stay
   readable above it while you read their resume. */
function ResumeDock({ applicant: a, onClose }) {
  const [tall, setTall] = useState(false);
  const url = a.resumeUrl || '';

  // Same approach the bulletin viewer settled on: fetch the file and show it
  // through a blob URL so the browser's own PDF viewer renders it (real text,
  // selectable and searchable), falling back to Google's viewer when the fetch
  // is blocked. Pointing an iframe straight at the S3 URL renders blank in some
  // browsers, which is a confusing empty panel rather than a resume.
  const [blobUrl, setBlobUrl] = useState('');
  const [useGview, setUseGview] = useState(false);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false, made = '';
    setBlobUrl(''); setUseGview(false);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        made = URL.createObjectURL(await res.blob());
        if (!cancelled) setBlobUrl(made);
      } catch {
        if (!cancelled) setUseGview(true);
      }
    })();
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  const frameSrc = useGview
    ? `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`
    : blobUrl;
  const ext = (a.resumeName || url).split('.').pop().toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext);
  // Word documents can't render in a frame; nothing gained by pretending.
  const isOffice = ['doc', 'docx', 'rtf', 'pages'].includes(ext);

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, height: tall ? '78vh' : '46vh',
      background: '#0d1524', borderTop: '1px solid rgba(56,189,248,.35)',
      boxShadow: '0 -18px 50px rgba(2,6,23,.6)', zIndex: 60,
      display: 'flex', flexDirection: 'column', transition: 'height .18s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid rgba(148,163,184,.16)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 900, fontSize: 14, color: '#7dd3fc' }}>📄 {a.name}</span>
        {a.resumeName && <span style={{ fontSize: 12, color: '#64748b' }}>{a.resumeName}</span>}
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={() => setTall(t => !t)} style={{ fontSize: 12 }}>
          {tall ? '▼ Shorter' : '▲ Taller'}
        </button>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', textDecoration: 'none', border: '1px solid rgba(96,165,250,.4)', borderRadius: 8, padding: '5px 11px' }}>
            Open in a new tab ↗
          </a>
        )}
        <button className="secondary" onClick={onClose} style={{ fontSize: 12 }}>✕ Close</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, background: 'rgba(2,6,23,.5)' }}>
        {!url ? (
          <div style={{ color: '#7a92b8', fontSize: 14, padding: 28, textAlign: 'center' }}>
            No resume was uploaded for {a.name}.
          </div>
        ) : isImage ? (
          <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 12 }}>
            <img src={url} alt={`${a.name} resume`} style={{ maxWidth: '100%', objectFit: 'contain' }} />
          </div>
        ) : isOffice ? (
          <div style={{ color: '#cbd5e1', fontSize: 14, padding: 28, textAlign: 'center', lineHeight: 1.7 }}>
            This one is a Word document, which browsers can't show inline.
            <br />
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#7dd3fc', fontWeight: 700 }}>Open it in a new tab ↗</a>
          </div>
        ) : !frameSrc ? (
          <div style={{ color: '#7a92b8', fontSize: 13.5, padding: 24, textAlign: 'center' }}>Loading resume…</div>
        ) : (
          <iframe src={frameSrc} title={`${a.name} resume`} style={{ width: '100%', height: '100%', border: 'none' }} />
        )}
      </div>
    </div>
  );
}

/* ── One applicant ────────────────────────────────────────────────────────── */
function ApplicantCard({ applicant: a, busy, viewing, onView, onChange, onDelete }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(a.interviewNotes || '');
  const [downloading, setDownloading] = useState(false);
  const stage = stageOf(a);

  // Opening someone brings their resume up below without a second click; closing
  // them takes it away again.
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    onView(next && !!a.resumeUrl);
  }

  // Save it to the machine rather than viewing it. A cross-origin file ignores
  // the download attribute, so fetch the bytes and hand the browser a blob; if
  // that's blocked, opening it is better than doing nothing.
  async function downloadResume(e) {
    e.stopPropagation();
    if (!a.resumeUrl || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(a.resumeUrl);
      if (!res.ok) throw new Error('fetch failed');
      const href = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = href;
      link.download = a.resumeName || `${a.name || 'applicant'}-resume.pdf`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(href); link.remove(); }, 800);
    } catch {
      window.open(a.resumeUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => { setNotes(a.interviewNotes || ''); }, [a.interviewNotes]);

  const yesNo = (value, onPick, yesLabel = 'Yes', noLabel = 'No') => (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      {[['yes', yesLabel], ['no', noLabel]].map(([v, label]) => (
        <button key={v} onClick={() => onPick(value === v ? '' : v)}
          style={{
            padding: '5px 14px', fontSize: 12.5, fontWeight: 800, borderRadius: 999, cursor: 'pointer',
            background: value === v ? (v === 'yes' ? 'rgba(52,211,153,.2)' : 'rgba(248,113,113,.16)') : 'rgba(255,255,255,.05)',
            border: `1px solid ${value === v ? (v === 'yes' ? 'rgba(52,211,153,.6)' : 'rgba(248,113,113,.5)') : 'rgba(148,163,184,.25)'}`,
            color: value === v ? (v === 'yes' ? '#6ee7b7' : '#fca5a5') : '#94a3b8',
          }}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{
      border: `1px solid ${stage.border}`, borderRadius: 16, padding: '16px 18px',
      background: a.archived ? 'rgba(255,255,255,.02)' : 'linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015))',
      opacity: a.archived ? 0.75 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={toggleOpen}
          title={a.resumeUrl ? 'Open this applicant — their resume loads below' : 'Open this applicant'}
          style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit',
            fontSize: 17, fontWeight: 900, color: viewing ? '#7dd3fc' : '#e8f1ff',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(125,211,252,.4)', textUnderlineOffset: 4,
          }}>
          {a.name}
        </button>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: stage.color, background: stage.bg, border: `1px solid ${stage.border}`, borderRadius: 999, padding: '3px 10px' }}>
          {stage.label}
        </span>
        <div style={{ flex: 1 }} />
        {busy && <span style={{ fontSize: 12, color: '#7dd3fc' }}>Saving…</span>}
        <button className="secondary" onClick={toggleOpen} style={{ fontSize: 12.5 }}>
          {open ? 'Hide' : 'Details'}
        </button>
      </div>

      <div style={{ fontSize: 12.5, color: '#8296b4', marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>{positionOf(a)}</span>
        {a.phone && <a href={`tel:${a.phone}`} style={{ color: '#7dd3fc' }}>{a.phone}</a>}
        {a.email && <a href={`mailto:${a.email}`} style={{ color: '#7dd3fc' }}>{a.email}</a>}
        {a.resumeUrl && (
          <button onClick={downloadResume} disabled={downloading}
            title={`Download ${a.resumeName || 'the resume'} to this computer`}
            style={{ background: 'none', border: 'none', padding: 0, color: '#c4b5fd', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            {downloading ? '⏳ Downloading…' : '⬇ Download resume'}
          </button>
        )}
        {a.source && <span style={{ color: '#64748b' }}>via {a.source}</span>}
      </div>

      {open && (
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          {/* Role first: it decides which category they're filed under, and
              people get put in the wrong one. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Applying for</label>
              <select value={positionOf(a)} onChange={e => onChange({ position: e.target.value })} style={inputStyle}>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                {/* Keep an unrecognised value selectable rather than silently
                    re-filing them the moment this panel opens. */}
                {!POSITIONS.includes(positionOf(a)) && <option value={positionOf(a)}>{positionOf(a)}</option>}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Came from</label>
              <select value={a.source || SOURCES[0]} onChange={e => onChange({ source: e.target.value })} style={inputStyle}>
                {SOURCES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Contact — editable, because a typed phone number is usually wrong once */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input defaultValue={a.name || ''} key={`n-${a.id}-${a.name}`} style={inputStyle}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== a.name) onChange({ name: v }); }} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input defaultValue={a.phone || ''} key={`p-${a.id}-${a.phone}`} inputMode="tel" style={inputStyle}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (a.phone || '')) onChange({ phone: v }); }} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input defaultValue={a.email || ''} key={`e-${a.id}-${a.email}`} inputMode="email" style={inputStyle}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (a.email || '')) onChange({ email: v }); }} />
            </div>
          </div>

          {/* Scheduling */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Interview set for</label>
              <input type="datetime-local" value={a.interviewAt || ''} style={inputStyle}
                onChange={e => onChange({ interviewAt: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Actually interviewed on</label>
              <input type="datetime-local" value={a.interviewedAt || ''} style={inputStyle}
                onChange={e => onChange({ interviewedAt: e.target.value, interviewed: e.target.value ? 'yes' : a.interviewed })} />
            </div>
          </div>

          {/* Interviewed */}
          <div>
            <label style={labelStyle}>
              Interviewed <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: '#64748b' }}>— click the same button again to clear it</span>
            </label>
            {yesNo(a.interviewed, v => onChange({
              interviewed: v,
              // Saying yes without a date is the common case — stamp the time
              // they said it so the record isn't left half-filled.
              interviewedAt: v === 'yes' && !a.interviewedAt
                ? nowLocalStamp()
                : v === 'no' ? '' : a.interviewedAt,
            }))}
          </div>

          {a.interviewed === 'yes' && (
            <div>
              <label style={labelStyle}>Interview notes</label>
              <textarea
                rows={4}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { if (notes !== (a.interviewNotes || '')) onChange({ interviewNotes: notes }); }}
                placeholder="How did they come across? Experience, availability, pay expectations, references…"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
              />
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>Saves when you click out of the box.</div>
            </div>
          )}

          {/* Decision */}
          <div style={{ borderTop: '1px solid rgba(148,163,184,.14)', paddingTop: 14 }}>
            <label style={labelStyle}>
              Consider for hire <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: '#64748b' }}>— click again to clear</span>
            </label>
            {yesNo(a.considerHire, v => onChange({ considerHire: v }))}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="secondary" onClick={() => onChange({ archived: !a.archived })} style={{ fontSize: 12.5 }}>
              {a.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button className="secondary" onClick={onDelete} disabled={busy}
              style={{ fontSize: 12.5, color: '#fca5a5', borderColor: 'rgba(248,113,113,.35)' }}>
              Delete
            </button>
            <div style={{ flex: 1 }} />
            {a.appliedAt && <span style={{ fontSize: 11.5, color: '#64748b' }}>Added {new Date(a.appliedAt).toLocaleDateString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
